import type {
  ChatProvider,
  ProviderEvent,
  StopReason,
  TokenUsage,
} from "./types";

export interface MockScriptStep {
  type: "text" | "tool_call" | "usage" | "done";
  text?: string;
  toolCall?: { id: string; name: string; arguments: string };
  usage?: TokenUsage;
  stop?: StopReason;
}

export interface MockProviderOptions {
  /** Scripted steps replayed on every stream call. */
  script?: MockScriptStep[];
  /** One script per stream call; the last one repeats when the calls run out. */
  scripts?: MockScriptStep[][];
  /** Milliseconds between steps. 0 replays without waiting. */
  delayMs?: number;
  model?: string;
}

const DEFAULT_SCRIPT: MockScriptStep[] = [{ type: "done", stop: "end" }];

function toEvent(step: MockScriptStep): ProviderEvent {
  switch (step.type) {
    case "text":
      return { type: "text_delta", text: step.text ?? "" };
    case "tool_call":
      return {
        type: "tool_call",
        call: step.toolCall ?? { id: "call_0", name: "noop", arguments: "{}" },
      };
    case "usage":
      return {
        type: "usage",
        inputTokens: step.usage?.inputTokens ?? 0,
        outputTokens: step.usage?.outputTokens ?? 0,
      };
    case "done":
      return { type: "done", stop: step.stop ?? "end" };
  }
}

export function createMockProvider(options: MockProviderOptions = {}): ChatProvider {
  const delayMs = options.delayMs ?? 0;
  const scripts: MockScriptStep[][] =
    options.scripts && options.scripts.length > 0
      ? options.scripts
      : [options.script ?? DEFAULT_SCRIPT];
  let streamCall = 0;

  return {
    kind: "mock",
    model: options.model ?? "mock-model",
    async *stream(_request, signal): AsyncIterable<ProviderEvent> {
      const script = scripts[Math.min(streamCall, scripts.length - 1)];
      streamCall += 1;
      for (const step of script) {
        if (delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
        if (signal?.aborted) {
          yield { type: "done", stop: "cancelled" };
          return;
        }
        yield toEvent(step);
      }
    },
  };
}
