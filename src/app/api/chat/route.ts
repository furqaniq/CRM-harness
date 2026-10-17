import { buildSpawnTools } from "@/core/agents/builtins";
import { agentsFrom, loadAgentCatalog } from "@/core/agents/files";
import type { SpawnContext } from "@/core/agents/runner";
import { INTERIM_AGENTS } from "@/core/agents/seed";
import { parseAgentCommand, parseSkillCommand } from "@/core/chat/commands";
import { createArtifactStore } from "@/core/artifacts/store";
import { coordinateTools } from "@/core/coordinator";
import { EventMux } from "@/core/events/mux";
import { encodeSse } from "@/core/events/sse";
import { makeRunId, runAgent } from "@/core/loop/run";
import { errorMessage } from "@/core/loop/tools";
import type { LoopEvent } from "@/core/loop/types";
import { loadPersona } from "@/core/persona";
import { createPolicyEngine } from "@/core/policy/engine";
import { DEMO_MODEL_CONFIG, createDemoProvider } from "@/core/providers/demo";
import type { Message } from "@/core/providers/types";
import { getAppSimulator } from "@/core/simulator";
import {
  buildReadSkillTool,
  catalogPrompt,
  getAppSkillStore,
  type SkillEntry,
} from "@/core/skills";
import { inferToolClass } from "@/core/tools/classify";

const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 32_000;

/**
 * Read-after-write checks for the simulator's write tools (spec §4): each
 * write names the read that proves it; mappings stay data, and the argument
 * name comes from the read tool's own schema.
 */
const SIM_VERIFY_WITH: Record<string, string> = {
  lead_create: "lead_get",
  lead_update_status: "lead_get",
  lead_transfer: "lead_get",
  customer_create: "customer_get",
  customer_update: "customer_get",
};

/** Abort handles for runs started by this server process (dev and single-instance hosts). */
const activeRuns = new Map<string, AbortController>();

/**
 * Artifacts live for the life of this server process (in-memory until storage
 * lands — a known gap). One store per process keeps a handle valid across the
 * turns of a chat session.
 */
const chatArtifacts = createArtifactStore();

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function parseMessages(value: unknown): Message[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null;
  const messages: Message[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (typeof content !== "string" || content.length > MAX_CONTENT_CHARS) return null;
    if (role === "user" || role === "assistant") {
      messages.push({ role, content });
      continue;
    }
    return null;
  }
  return messages;
}

/**
 * Streams one agent run as server-sent `LoopEvent` frames. Cancellation works
 * two ways: the client aborts the fetch (stream cancel) or posts the run id
 * here, so Stop does not depend on connection teardown semantics.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Body must be JSON", 400);
  }

  const record: Record<string, unknown> =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  if (typeof record.cancelRunId === "string") {
    const controller = activeRuns.get(record.cancelRunId);
    if (!controller) return errorResponse("No active run with that id", 404);
    controller.abort();
    return Response.json({ cancelled: true }, { status: 202 });
  }

  const messages = parseMessages(record.messages);
  if (!messages) {
    return errorResponse(
      "messages must be a non-empty list of user and assistant turns",
      400,
    );
  }

  const runId = makeRunId();
  const abort = new AbortController();
  activeRuns.set(runId, abort);
  const onClientAbort = () => abort.abort();
  request.signal.addEventListener("abort", onClientAbort, { once: true });

  // Owner mode (default on, like the shell) gates live-effect tools to auto;
  // with it off they resolve to ask, and with no approver wired they are
  // blocked with the reason. Role/permission enforcement beyond Owner mode
  // arrives with auth (M7); the session is the owner's until then.
  const ownerMode = record.ownerMode !== false;
  const simulator = getAppSimulator();
  const policy = createPolicyEngine({
    environment: "interactive",
    ownerMode,
    classOf: (name) => inferToolClass({ name }),
  });

  // Skills: only names and descriptions go into the prompt (spec §6); bodies
  // are loaded on demand with the read_skill tool. A read failure just means
  // this turn runs without a catalog — chat does not depend on the folder.
  let skills: SkillEntry[] = [];
  try {
    skills = (await getAppSkillStore().list()).filter((skill) => skill.valid);
  } catch {
    skills = [];
  }

  // Seed files drive the roster and the persona (spec §5–6). If the folders
  // are missing (or every file is invalid) the interim inline roster keeps
  // subagent spawning usable.
  const persona = await loadPersona();
  const roster = agentsFrom(await loadAgentCatalog());
  const agents = roster.length > 0 ? roster : INTERIM_AGENTS;

  // Chat commands: `/skill <name>` pre-injects that skill's body for this
  // turn; `@<agent> <task>` addresses one specialist directly.
  let system = persona.text;
  let turnMessages = messages;
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (last?.role === "user") {
    const skillCommand = parseSkillCommand(last.content);
    if (skillCommand !== null) {
      if (skillCommand.name === "") {
        return errorResponse("Say which skill: /skill <name> <message>.", 400);
      }
      const skill = await getAppSkillStore().get(skillCommand.name);
      if (skill === null) {
        return errorResponse(`No skill named "${skillCommand.name}".`, 404);
      }
      if (skill.errors.length > 0) {
        return errorResponse(`The skill "${skill.name}" is not usable: ${skill.errors.join(" ")}`, 400);
      }
      system = `${system}\n\nSkill in effect: ${skill.name}\n\n${skill.body.trim()}`;
      turnMessages = [
        ...messages.slice(0, lastIndex),
        {
          role: "user",
          content:
            skillCommand.rest === ""
              ? "Apply this skill's guidance to the request."
              : skillCommand.rest,
        },
      ];
    } else {
      const agentCommand = parseAgentCommand(last.content);
      if (agentCommand !== null) {
        if (agentCommand.task === "") {
          return errorResponse(`Add a task after @${agentCommand.name}.`, 400);
        }
        const agent = agents.find((entry) => entry.name === agentCommand.name);
        if (agent === undefined) {
          return errorResponse(
            `No agent named "${agentCommand.name}". Try ${agents.map((entry) => entry.name).join(", ")}.`,
            404,
          );
        }
        system =
          `${system}\n\nThe user addressed the ${agent.displayName} agent directly. ` +
          `Call spawn_agent with agent "${agent.name}" and task "${agentCommand.task}" before composing the answer.`;
      }
    }
  }

  // Every simulator tool runs through the write coordinator: per-record
  // locking, in-flight idempotency, the 10-minute identical-send guard and
  // read-after-write verification — for the root run and for children alike,
  // since specialists draw from this same universe.
  const allTools = coordinateTools(
    simulator.tools({ role: "owner", userId: "u_owner" }),
    { verifyWith: SIM_VERIFY_WITH },
  );

  // Child trace fan-in: subagent events are pushed here while the parent's
  // spawn call is still running and streamed out live, so lanes render as
  // they work instead of arriving as one dump at the end.
  const mux = new EventMux<LoopEvent>();
  const spawnContext: SpawnContext = {
    model: { config: DEMO_MODEL_CONFIG, provider: createDemoProvider() },
    allTools,
    policy: (name) => policy.decide(name),
    artifacts: chatArtifacts,
    depth: 0,
    signal: abort.signal,
    onEvent: (event) => mux.push(event),
    skills: async (names) => {
      const loaded: { name: string; body: string }[] = [];
      for (const name of names) {
        const skill = await getAppSkillStore().get(name);
        if (skill !== null && skill.errors.length === 0) {
          loaded.push({ name: skill.name, body: skill.body });
        }
      }
      return loaded;
    },
  };

  const iterator = runAgent({
    model: { config: DEMO_MODEL_CONFIG, provider: createDemoProvider() },
    messages: turnMessages,
    system: skills.length > 0 ? `${system}\n\n${catalogPrompt(skills)}` : system,
    tools: [
      ...buildSpawnTools({ agents, context: spawnContext }),
      ...allTools,
      ...(skills.length > 0
        ? [buildReadSkillTool((name) => getAppSkillStore().get(name))]
        : []),
    ],
    policy: (name) => policy.decide(name),
    artifacts: chatArtifacts,
    runId,
    signal: abort.signal,
    maxContextTokens: 60_000,
  });
  const merged = mux.merge(iterator);

  const encoder = new TextEncoder();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    activeRuns.delete(runId);
    request.signal.removeEventListener("abort", onClientAbort);
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(encodeSse(payload)));
        } catch {
          // The client already went away; cancel() cleans the run up.
        }
      };
      try {
        const { value, done } = await merged.next();
        if (done) {
          send({ type: "stream_end", runId });
          try {
            controller.close();
          } catch {
            /* already cancelled */
          }
          finish();
          return;
        }
        send(value);
      } catch (error) {
        send({ type: "stream_error", runId, message: errorMessage(error) });
        try {
          controller.close();
        } catch {
          /* already cancelled */
        }
        finish();
      }
    },
    cancel() {
      abort.abort();
      finish();
      void merged.return(undefined).catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
