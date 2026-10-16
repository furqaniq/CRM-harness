import type { ChatProvider, Message, ModelConfig, ProviderEvent } from "./types";

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
