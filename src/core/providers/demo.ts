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

      const rule = pickToolRule(prompt, request.tools, request.messages);
      if (rule !== null) {
        const args = JSON.stringify(rule.args);
        yield { type: "usage", inputTokens: 0, outputTokens: estimateTokens(`${rule.tool}${args}`) };
        yield {
          type: "tool_call",
          call: { id: `demo_${stepsIn(request.messages)}_1`, name: rule.tool, arguments: args },
        };
        yield { type: "done", stop: "tool_calls" };
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

interface DemoToolRule {
  match: RegExp;
  tool: string;
  args: (prompt: string, messages: Message[]) => Record<string, unknown>;
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
 */
const TOOL_RULES: DemoToolRule[] = [
  {
    match: /\b(delet|remov|archiv|destroy|merg)\w*/i,
    tool: "lead_delete",
    args: () => ({ lead_id: "L-1001" }),
    alwaysPropose: true,
  },
  { match: /\bautomation/i, tool: "automation_list", args: () => ({}) },
  {
    match: /\bhow many\b[\s\S]*\bleads?\b/i,
    tool: "lead_count",
    args: (prompt) => ({ status: /\bopen\b/i.test(prompt) ? "open" : "" }),
  },
  {
    match: /\b(email|sms|text)\b|\bsend\b/i,
    tool: "send_email",
    args: () => ({ to: "ada@example.test", subject: "Following up", body: DEMO_SEND_BODY }),
  },
  {
    match: /\b(conversation|inbox)\b/i,
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
): { tool: string; args: Record<string, unknown> } | null {
  const available = new Set((tools ?? []).map((tool) => tool.name));
  for (const rule of TOOL_RULES) {
    if (!rule.match.test(prompt)) continue;
    if (rule.alwaysPropose !== true && !available.has(rule.tool)) continue;
    if (rule.when !== undefined && !rule.when(prompt, messages)) continue;
    return { tool: rule.tool, args: rule.args(prompt, messages) };
  }
  return null;
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
      if (typeof record.count === "number") {
        return [
          `That returned ${record.count} item${record.count === 1 ? "" : "s"}. `,
          "The details are in the tool result in the trace.",
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
