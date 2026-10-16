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
  script: MockScriptStep[];
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

export function createMockProvider(
  options: MockProviderOptions = { script: DEFAULT_SCRIPT },
): ChatProvider {
  const delayMs = options.delayMs ?? 0;

  return {
    kind: "mock",
    model: options.model ?? "mock-model",
    async *stream(_request, signal): AsyncIterable<ProviderEvent> {
      for (const step of options.script) {
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
