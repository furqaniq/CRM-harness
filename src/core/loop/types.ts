import type {
  ChatProvider,
  Message,
  ModelConfig,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from "../providers/types";

/** The four budgets an agent run can exhaust (spec §4 Agent loop). */
export type LimitKind = "steps" | "time" | "tokens" | "cost";

export type RunStop = "end" | "length" | "cancelled" | "error" | "limit";

export interface RunLimits {
  /** Model calls per run. */
  maxSteps: number;
  /** Wall clock milliseconds per run. */
  maxTimeMs: number;
  /** Input + output tokens per run. */
  maxTokens: number;
  /** USD per run, from the model pricing table. */
  maxCostUsd: number;
}

/**
 * Interactive chat defaults. Guesses until real runs exist (spec §11); the
 * per-child budget used by subagents is applied by the subagent runner instead.
 */
export const DEFAULT_RUN_LIMITS: RunLimits = {
  maxSteps: 24,
  maxTimeMs: 120_000,
  maxTokens: 120_000,
  maxCostUsd: 1,
};

export interface ToolContext {
  runId: string;
  parentRunId?: string;
  stepId: number;
  callId: string;
  name: string;
  /** Aborted on cancellation and on any run limit. */
  signal: AbortSignal;
}

export type MaybePromise<T> = T | Promise<T>;

export interface ToolExecutor {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolContext): MaybePromise<unknown>;
}

/** Every event carries the run id and, for subagents, the parent run id. */
export interface LoopEventBase {
  runId: string;
  parentRunId?: string;
}

export type LoopEvent = LoopEventBase &
  (
    | {
        type: "run_start";
        modelId: string;
        model: string;
        role: string;
        startedAt: number;
        systemChars: number;
        messageCount: number;
      }
    | { type: "step_start"; stepId: number; modelId: string; model: string }
    | { type: "text_delta"; stepId: number; text: string }
    | {
        /** Emitted for every call of a step before any of them runs, so a shared step id proves they started together. */
        type: "tool_start";
        stepId: number;
        callId: string;
        name: string;
        input: Record<string, unknown> | null;
        rawArguments: string;
      }
    | {
        type: "tool_result";
        stepId: number;
        callId: string;
        name: string;
        content: string;
        isError: boolean;
        durationMs: number;
      }
    | {
        type: "usage";
        stepId: number;
        inputTokens: number;
        outputTokens: number;
      }
    | {
        type: "model_error";
        stepId: number;
        modelId: string;
        message: string;
        /** True when the run will retry on the next model in the fallback chain. */
        willFallback: boolean;
      }
    | {
        type: "run_end";
        stop: RunStop;
        limit?: LimitKind;
        usage: TokenUsage;
        costUsd: number;
        steps: number;
        durationMs: number;
        fallbacks: number;
        finalText: string;
      }
  );

export interface LoopModel {
  config: ModelConfig;
  provider: ChatProvider;
}

export interface RunSummary {
  runId: string;
  parentRunId?: string;
  stop: RunStop;
  limit?: LimitKind;
  usage: TokenUsage;
  costUsd: number;
  steps: number;
  durationMs: number;
  fallbacks: number;
  modelId: string;
  finalText: string;
  /** Full transcript including assistant tool calls and tool results. */
  messages: Message[];
}

export type { Message, TokenUsage, ToolCall, ToolDefinition };
