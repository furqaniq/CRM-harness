import { humanizeToolName } from "../tools/classify";
import type { ChatProvider, Message, ModelConfig, ProviderEvent, ToolDefinition } from "./types";

export const DEMO_MODEL_ID = "demo-model";
export const DEMO_MODEL_LABEL = "Demo model (scripted)";

export const DEMO_MODEL_CONFIG: ModelConfig = {
  id: DEMO_MODEL_ID,
  kind: "mock",
  label: DEMO_MODEL_LABEL,
  model: DEMO_MODEL_ID,
  capabilities: { tools: true, streaming: true, vision: false },
  pricing: { inputPerMTok: 0, outputPerMTok: 0 },
};

export interface DemoProviderOptions {
  /** Milliseconds between streamed chunks. */
  delayMs?: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function lastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user") return message.content;
  }
  return "";
}

/**
 * The M1 placeholder answer. It says plainly that it is scripted and that no
 * CRM record was touched, so a demo reply can never read as real work.
 */
export function demoReplyChunks(prompt: string): string[] {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (trimmed === "") {
    return [
      "Go ahead and type a message, and I will stream the answer back. ",
      "You are on the scripted demo model for now, so nothing here reads or writes a CRM record.",
    ];
  }
  const short = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  return [
    `You asked: "${short}". `,
    "Streaming, the step trace, token and cost accounting, the step/time/token/cost limits and Stop are all running on the real agent loop. ",
    "This answer comes from the scripted demo model, so no CRM record was read or written. Point Providers at a real key and the same loop drives a real model; MCP tools, policy and the simulator arrive with the next milestones.",
  ];
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Input-aware scripted stand-in used by the chat route until a provider key is
 * configured. Deliberately not registered in the provider registry, so config
 * driven code can never select it by accident.
 *
 * When the run offers tools, the demo model routes the prompt to one of them
 * by keyword (a stand-in for a real model's tool choice) and then answers from
 * whatever the tool actually returned — the summary, the policy decision, the
 * artifact note — never from a canned script keyed to a specific answer.
 */
export function createDemoProvider(options: DemoProviderOptions = {}): ChatProvider {
  const delayMs = options.delayMs ?? 50;

  return {
    kind: "mock",
    model: DEMO_MODEL_ID,
    async *stream(request, signal): AsyncIterable<ProviderEvent> {
      const prompt = lastUserText(request.messages);
      const inputText = [request.system ?? "", ...request.messages.map((m) => m.content)].join(
        "\n",
      );
      yield { type: "usage", inputTokens: estimateTokens(inputText), outputTokens: 0 };

      const last = request.messages.at(-1);
      if (last?.role === "tool") {
        // A "… then …" prompt gets its second call after the first result, so
        // dependent tool calls land in a later step than the ones before them.
        const toolResults = request.messages.filter((message) => message.role === "tool").length;
        if (toolResults === 1) {
          const clause = prompt.split(/\bthen\b/i)[1]?.trim() ?? "";
          if (clause !== "") {
            const followUp = pickToolRule(clause, request.tools, request.messages);
            if (followUp !== null) {
              yield {
                type: "usage",
                inputTokens: 0,
                outputTokens: estimateTokens(followUp.map((call) => call.name).join("")),
              };
              yield* toolCallEvents(followUp, request.messages);
              yield { type: "done", stop: "tool_calls" };
              return;
            }
          }
        }
        // Second turn: the transcript's last message is the tool result.
        const chunks = toolFollowUpChunks(last.content, last.isError === true);
        for (const chunk of chunks) {
          await wait(delayMs, signal);
          if (signal?.aborted) {
            yield { type: "done", stop: "cancelled" };
            return;
          }
          yield { type: "text_delta", text: chunk };
        }
        yield {
          type: "usage",
          inputTokens: 0,
          outputTokens: estimateTokens(chunks.join("")),
        };
        yield { type: "done", stop: "end" };
        return;
      }

      const calls = pickToolRule(prompt, request.tools, request.messages);
      if (calls !== null) {
        const serialized = calls.map((call) => JSON.stringify(call.args)).join("");
        yield { type: "usage", inputTokens: 0, outputTokens: estimateTokens(serialized) };
        yield* toolCallEvents(calls, request.messages);
        yield { type: "done", stop: "tool_calls" };
        return;
      }

      // `/skill` pre-injects a body into the system prompt; say so instead of
      // pretending the scripted model reasoned about it.
      const skill = request.system?.match(/Skill in effect: ([a-z0-9][a-z0-9-]*)/);
      if (skill) {
        const chunks = [
          `Following the "${skill[1]}" skill for this turn. `,
          "Its body is pre-loaded in the system prompt; a real model would apply it to your request now.",
        ];
        for (const chunk of chunks) {
          await wait(delayMs, signal);
          if (signal?.aborted) {
            yield { type: "done", stop: "cancelled" };
            return;
          }
          yield { type: "text_delta", text: chunk };
        }
        yield {
          type: "usage",
          inputTokens: 0,
          outputTokens: estimateTokens(chunks.join("")),
        };
        yield { type: "done", stop: "end" };
        return;
      }

      const chunks = demoReplyChunks(prompt);
      for (const chunk of chunks) {
        await wait(delayMs, signal);
        if (signal?.aborted) {
          yield { type: "done", stop: "cancelled" };
          return;
        }
        yield { type: "text_delta", text: chunk };
      }

      yield {
        type: "usage",
        inputTokens: 0,
        outputTokens: estimateTokens(chunks.join("")),
      };
      yield { type: "done", stop: "end" };
    },
  };
}

function stepsIn(messages: Message[]): number {
  return messages.filter((message) => message.role === "assistant").length + 1;
}

interface DemoCall {
  name: string;
  args: Record<string, unknown>;
}

interface DemoToolRule {
  match: RegExp;
  tool: string;
  args: (prompt: string, messages: Message[]) => Record<string, unknown>;
  /**
   * Extra calls emitted in the same model turn — the loop runs them in one
   * step, which is how a prompt can produce parallel tool calls (the trace
   * then proves they share a step id).
   */
  extraCalls?: { tool: string; args: Record<string, unknown> }[];
  /**
   * Propose the call even when the tool is not on offer. A real model guesses
   * tool names; the loop asks policy first, so the delete-shaped call gets the
   * global deny pattern's answer without ever reaching an executor.
   */
  alwaysPropose?: boolean;
  /** Skip the rule unless this also holds (e.g. an artifact handle exists). */
  when?: (prompt: string, messages: Message[]) => boolean;
}

const DEMO_SEND_BODY =
  "Following up on your application. (Simulator outbox — nothing leaves the CRM.)";

/**
 * Keyword routing, first match wins. Reads reach for tools the run actually
 * offers; the delete rule deliberately reaches for a delete tool so the
 * policy engine's global deny pattern is visible end to end.
 *
 * The two spawn rules sit near the top and are gated on the spawn tools being
 * offered: the chat root offers them (so "in parallel" fans out to lanes), a
 * specialist child does not (it runs the direct tool itself instead).
 */
const CREATE_LEAD = /\b(?:create|add|make|new)\b[^.?!]*\blead\b/i;

const TOOL_RULES: DemoToolRule[] = [
  {
    // `@agent <task>`: the user addressed one specialist directly.
    match: /^\s*@([a-z0-9][a-z0-9-]*)\b/i,
    tool: "spawn_agent",
    args: (prompt) => {
      const match = prompt.match(/^\s*@([a-z0-9][a-z0-9-]*)\b[\s,:-]*([\s\S]*)$/i);
      return {
        agent: (match?.[1] ?? "").toLowerCase(),
        task: (match?.[2] ?? "").trim(),
      };
    },
  },
  {
    match: /\b(delet|remov|archiv|destroy|merg)\w*/i,
    tool: "lead_delete",
    args: () => ({ lead_id: "L-1001" }),
    alwaysPropose: true,
  },
  {
    // Skills load on demand: the body is not in the prompt, only the catalog.
    match: /\buse\s+(?:the\s+)?([a-z0-9][a-z0-9-]*)\s+skill\b/i,
    tool: "read_skill",
    args: (prompt) => ({ name: skillNameFrom(prompt) }),
  },
  {
    match: /\b(?:in parallel|simultaneously|side by side|at the same time|two agents)\b/i,
    tool: "spawn_agents",
    args: () => ({
      agents: [
        { agent: "leads", task: "How many leads are open right now?" },
        { agent: "inbox", task: "List the conversations that are waiting for a reply." },
      ],
    }),
  },
  {
    match: CREATE_LEAD,
    tool: "spawn_agent",
    args: (prompt) => ({ agent: "leads", task: prompt }),
  },
  {
    // Two reads in one turn: the loop runs them together, in one step.
    match: /\b(?:together|both at once)\b/i,
    tool: "branch_list",
    args: () => ({}),
    extraCalls: [{ tool: "lead_count", args: { status: "" } }],
  },
  { match: /\bautomation/i, tool: "automation_list", args: () => ({}) },
  {
    match: /\bhow many\b[\s\S]*\bleads?\b|\bcount\b[\s\S]*\bleads?\b/i,
    tool: "lead_count",
    args: (prompt) => ({ status: /\bopen\b/i.test(prompt) ? "open" : "" }),
  },
  {
    match: /\b(email|sms|text)\b|\bsend\b/i,
    tool: "send_email",
    args: () => ({ to: "ada@example.test", subject: "Following up", body: DEMO_SEND_BODY }),
  },
  {
    match: /\bconversations?\b|\binbox\b/i,
    tool: "conversation_list",
    args: (prompt) => ({ waiting_only: /\bwait/i.test(prompt) }),
  },
  { match: /\bbranch/i, tool: "branch_list", args: () => ({}) },
  {
    match: /\bartifact\b|\bslice\b/i,
    tool: "read_artifact",
    when: (_prompt, messages) => findArtifactHandle(messages) !== null,
    args: (_prompt, messages) => ({ handle: findArtifactHandle(messages), limit: 2_000 }),
  },
  {
    match: CREATE_LEAD,
    tool: "lead_create",
    args: (prompt) => ({ name: extractLeadName(prompt) }),
  },
  {
    match: /\b(lead|find|search|look)\w*/i,
    tool: "lead_search",
    args: (prompt) => ({ query: extractQuery(prompt) }),
  },
];

/** Newest handle wins: the transcript's last art_… reference is the one to read. */
function findArtifactHandle(messages: Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const found = messages[index].content.match(/art_[a-z0-9]+(?:_[a-z0-9]+)*/i);
    if (found) return found[0];
  }
  return null;
}

function pickToolRule(
  prompt: string,
  tools: ToolDefinition[] | undefined,
  messages: Message[],
): DemoCall[] | null {
  const available = new Set((tools ?? []).map((tool) => tool.name));
  for (const rule of TOOL_RULES) {
    if (!rule.match.test(prompt)) continue;
    if (rule.alwaysPropose !== true && !available.has(rule.tool)) continue;
    if (rule.when !== undefined && !rule.when(prompt, messages)) continue;
    const calls: DemoCall[] = [{ name: rule.tool, args: rule.args(prompt, messages) }];
    for (const extra of rule.extraCalls ?? []) {
      if (available.has(extra.tool)) calls.push({ name: extra.tool, args: extra.args });
    }
    return calls;
  }
  return null;
}

function* toolCallEvents(
  calls: DemoCall[],
  messages: Message[],
): Generator<ProviderEvent, void, void> {
  const step = stepsIn(messages);
  for (const [index, call] of calls.entries()) {
    yield {
      type: "tool_call",
      call: {
        id: `demo_${step}_${index + 1}`,
        name: call.name,
        arguments: JSON.stringify(call.args),
      },
    };
  }
}

function extractQuery(prompt: string): string {
  const quoted = prompt.match(/["']([^"']+)["']/);
  if (quoted) return quoted[1].trim();
  const after = prompt.match(
    /\b(?:find|search(?:\s+for)?|look\s+up|about|named|called)\s+(.{1,40}?)(?:\?|\.|,|$)/i,
  );
  if (after) {
    return after[1]
      .replace(/^(?:the|a|an|lead|leads|contact|contacts)\s+/i, "")
      .trim();
  }
  return "";
}

/** "use the never-delete skill" → "never-delete". */
function skillNameFrom(prompt: string): string {
  return prompt.match(/\buse\s+(?:the\s+)?([a-z0-9][a-z0-9-]*)\s+skill\b/i)?.[1] ?? "";
}

/** "Create a lead named Ada Harness" → "Ada Harness"; a plain fallback otherwise. */
function extractLeadName(prompt: string): string {
  const named = prompt.match(/\b(?:named|called)\s+(.{1,60}?)(?:\?|\.|,|$)/i);
  if (named) return named[1].trim();
  return "New lead from the demo";
}

/**
 * The scripted model's second turn: read the tool result and say what it
 * actually holds — a policy denial, a failure, an artifact summary, a count,
 * an outbox queue — instead of pretending to have thought about it.
 */
function toolFollowUpChunks(content: string, isError: boolean): string[] {
  if (isError) {
    if (content.startsWith("Denied by policy")) {
      return [
        "I cannot do that from here — the call is blocked by policy. ",
        "Deleting, removing, archiving, destroying and merging have to be done in the CRM itself. I can list the matching records instead if that helps.",
      ];
    }
    const short = content.length > 180 ? `${content.slice(0, 180)}…` : content;
    return [`That tool run failed: ${short} `, "Nothing was changed."];
  }
  if (content.includes("Large result stored as artifact")) {
    // The handle must land in the assistant text: the UI round-trips only
    // role+content, and the next turn needs the handle to page the artifact.
    const handle = content.match(/art_[a-z0-9]+(?:_[a-z0-9]+)*/i)?.[0];
    const label = handle ? ` — handle ${handle}` : "";
    return [
      `That list is large, so it is stored as an artifact${label}. The summary in the trace carries the exact count. `,
      "Ask me to read a slice of it if you need more of the detail.",
    ];
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed !== null && typeof parsed === "object") {
      if (Array.isArray(parsed)) {
        const entries = parsed.filter(isSpawnResult);
        if (entries.length > 0) return spawnBatchChunks(entries);
      }
      const record = parsed as Record<string, unknown>;
      if (record.queued !== undefined) {
        return [
          "Queued to the outbox — the simulator never sends to the outside world. ",
          `The outbox now holds ${record.outbox_size} message(s).`,
        ];
      }
      if (typeof record.content === "string" && typeof record.returnedChars === "number") {
        const more = record.nextOffset === null ? "" : " There is more after that slice.";
        return [
          `Here is that slice — ${record.returnedChars} characters, straight from the artifact.`,
          more,
        ];
      }
      if (typeof record.skill === "string" && typeof record.body === "string") {
        return [
          `Loaded the "${record.skill}" skill — ${record.body.length} characters of guidance are now in context. `,
          "The body is in the trace above; a real model would follow it from here.",
        ];
      }
      if (typeof record.count === "number") {
        return [
          `That returned ${record.count} item${record.count === 1 ? "" : "s"}. `,
          "The details are in the tool result in the trace.",
        ];
      }
      if (isSpawnResult(record)) return spawnChunks(record);
      if (record.verified === true) {
        return [
          "The record was saved and then read back from the CRM — verified. ",
          "Nothing else was changed.",
        ];
      }
      if (record.verified === false) {
        const reason =
          typeof record.verified_note === "string" ? record.verified_note : "no reason given";
        return [
          `The write went through but could not be confirmed by reading it back: ${shorten(reason, 160)} `,
          "Treat it as unconfirmed and check the record in the CRM.",
        ];
      }
    }
  } catch {
    // Not JSON — fall through to the generic note.
  }
  return [
    "The tool ran; its result is in the trace above. ",
    "A real model would turn that into the answer for you.",
  ];
}

interface SpawnResultLike {
  agent: string;
  status: string;
  summary: string;
  writes: { verified: boolean }[];
  errors: string[];
}

function isSpawnResult(value: unknown): value is SpawnResultLike {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.agent === "string" &&
    typeof record.status === "string" &&
    Array.isArray(record.writes)
  );
}

function agentLabel(name: string): string {
  return `${humanizeToolName(name)} agent`;
}

function spawnBatchChunks(entries: SpawnResultLike[]): string[] {
  const chunks = [
    `Ran ${entries.length} agents side by side. `,
    ...entries.map((entry) => {
      const answer = shorten(entry.summary.trim(), 140);
      return `${agentLabel(entry.agent)} — ${entry.status}${answer !== "" ? `. ${answer}` : ""} `;
    }),
  ];
  const verifiedWrites = entries.flatMap((entry) => entry.writes).filter((write) => write.verified);
  if (verifiedWrites.length > 0) {
    chunks.push(
      `${verifiedWrites.length} write${verifiedWrites.length === 1 ? "" : "s"} verified by reading the record back.`,
    );
  }
  return chunks;
}

function spawnChunks(result: SpawnResultLike): string[] {
  const label = agentLabel(result.agent);
  if (result.status === "needs_input") {
    return [`${label} needs one decision before it can finish: ${shorten(result.summary, 160)}`];
  }
  if (result.status === "failed") {
    const detail = shorten(result.errors.join(" ") || result.summary, 180);
    return [`${label} could not finish${detail !== "" ? `: ${detail}` : "."} `, "Nothing was changed by it."];
  }
  const verifiedWrites = result.writes.filter((write) => write.verified);
  const chunks = [`${label} finished — ${result.status}. `, shorten(result.summary.trim(), 200)];
  if (verifiedWrites.length > 0) {
    chunks.push(
      `${verifiedWrites.length} write${verifiedWrites.length === 1 ? "" : "s"} verified by reading the record back.`,
    );
  }
  return chunks.filter((chunk) => chunk.trim() !== "");
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
