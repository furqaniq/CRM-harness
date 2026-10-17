import { createArtifactStore } from "@/core/artifacts/store";
import { encodeSse } from "@/core/events/sse";
import { makeRunId, runAgent } from "@/core/loop/run";
import { errorMessage } from "@/core/loop/tools";
import { createPolicyEngine } from "@/core/policy/engine";
import { DEMO_MODEL_CONFIG, createDemoProvider } from "@/core/providers/demo";
import type { Message } from "@/core/providers/types";
import { getAppSimulator } from "@/core/simulator";
import { inferToolClass } from "@/core/tools/classify";

const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 32_000;

/**
 * Persona placeholder until the seed files land in M4 (`SOUL.maple.md` is one
 * of the inputs the spec expects but does not ship).
 */
const CHAT_SYSTEM = [
  "You are Maple, the assistant inside the Maple mortgage CRM.",
  "Answer in the user's language, lead with the finding, and stay on this company's data.",
  "Never expose internal ids, raw tool names or stack traces in user-facing text.",
  "Say when a view is limited by role or ownership, and say how many records you actually covered.",
].join(" ");

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

  const iterator = runAgent({
    model: { config: DEMO_MODEL_CONFIG, provider: createDemoProvider() },
    messages,
    system: CHAT_SYSTEM,
    tools: simulator.tools({ role: "owner", userId: "u_owner" }),
    policy: (name) => policy.decide(name),
    artifacts: chatArtifacts,
    runId,
    signal: abort.signal,
    maxContextTokens: 60_000,
  });

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
        const { value, done } = await iterator.next();
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
      const closable = iterator as AsyncGenerator<unknown, unknown>;
      void closable.return(undefined).catch(() => undefined);
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
