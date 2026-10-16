import { formatUsd } from "@/core/models/config";
import type { LimitKind, LoopEvent, RunStop, TokenUsage } from "@/core/loop/types";

export type ChatStatus = "idle" | "starting" | "streaming" | "stopping";

export interface TraceEntry {
  stepId: number;
  callId?: string;
  name?: string;
  label: string;
  status: "running" | "done" | "error";
  durationMs?: number;
}

export interface RunTrace {
  runId: string;
  modelId: string;
  model: string;
  steps: number;
  startedAt: number;
  durationMs?: number;
  stop?: RunStop;
  limit?: LimitKind;
  usage?: TokenUsage;
  costUsd?: number;
  entries: TraceEntry[];
  /** Raw model ids, tool names and errors — shown only behind Advanced. */
  raw: string[];
}

export interface PendingRun {
  content: string;
  trace: RunTrace;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  note?: string;
  trace?: RunTrace;
}

export interface ChatState {
  status: ChatStatus;
  messages: ChatMessage[];
  pending: PendingRun | null;
  notice: string | null;
  usage: TokenUsage;
  costUsd: number;
  runs: number;
}

export type ChatAction =
  | { type: "send"; content: string }
  | { type: "event"; event: LoopEvent }
  | { type: "request_stop" }
  | { type: "stream_error" }
  | { type: "stream_closed" };

export function initialChatState(): ChatState {
  return {
    status: "idle",
    messages: [],
    pending: null,
    notice: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    runs: 0,
  };
}

/** Display label; the raw tool name stays in the trace behind Advanced (spec section 1). */
export function humanToolLabel(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  if (words === "") return "Tool";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export function runHeadline(trace: RunTrace): string {
  const duration = trace.durationMs === undefined ? "" : ` in ${formatSeconds(trace.durationMs)}`;
  switch (trace.stop) {
    case undefined:
      return "Working";
    case "end":
      return `Answered${duration}`;
    case "cancelled":
      return `Stopped${duration}`;
    case "length":
      return `Hit the output limit${duration}`;
    case "error":
      return "Run failed";
    case "limit":
      return `Stopped at the ${trace.limit ?? "run"} limit${duration}`;
  }
}

export function runMeta(trace: RunTrace): string[] {
  const parts: string[] = [];
  const usage = trace.usage;
  const tokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  if (tokens > 0) parts.push(`${tokens.toLocaleString("en-US")} tokens`);
  if (trace.costUsd !== undefined && trace.costUsd > 0) parts.push(formatUsd(trace.costUsd));
  if (trace.steps > 0) parts.push(`${trace.steps} ${trace.steps === 1 ? "step" : "steps"}`);
  return parts;
}

function stopNote(stop: RunStop, limit: LimitKind | undefined): string | null {
  switch (stop) {
    case "end":
      return null;
    case "cancelled":
      return "Stopped by you.";
    case "length":
      return "The model hit its output limit.";
    case "error":
      return "The run ended with an error.";
    case "limit":
      switch (limit) {
        case "steps":
          return "Stopped at the step limit.";
        case "time":
          return "Stopped at the time limit.";
        case "tokens":
          return "Stopped at the token budget.";
        case "cost":
          return "Stopped at the spend cap.";
        default:
          return "Stopped at a run limit.";
      }
  }
}

function finalize(state: ChatState, note: string | null): ChatState {
  if (!state.pending) {
    return { ...state, status: "idle", ...(note ? { notice: note } : {}) };
  }

  const { content, trace } = state.pending;
  const closed: RunTrace = {
    ...trace,
    durationMs: trace.durationMs ?? Date.now() - trace.startedAt,
    stop: trace.stop ?? "cancelled",
  };
  const trimmed = content.trim();
  const messages =
    trimmed === ""
      ? state.messages
      : [...state.messages, { role: "assistant" as const, content, ...(note ? { note } : {}), trace: closed }];

  return {
    ...state,
    status: "idle",
    pending: null,
    messages,
    runs: state.runs + 1,
    notice: note ?? state.notice,
  };
}

function applyEvent(state: ChatState, event: LoopEvent): ChatState {
  switch (event.type) {
    case "run_start": {
      return {
        ...state,
        status: "streaming",
        notice: null,
        pending: {
          content: "",
          trace: {
            runId: event.runId,
            modelId: event.modelId,
            model: event.model,
            steps: 0,
            startedAt: event.startedAt,
            entries: [],
            raw: [`model ${event.model} (${event.modelId})`, `system ${event.systemChars} chars`, `${event.messageCount} messages`],
          },
        },
      };
    }
    case "step_start": {
      if (!state.pending) return state;
      const trace = state.pending.trace;
      return {
        ...state,
        pending: {
          ...state.pending,
          trace: {
            ...trace,
            steps: event.stepId,
            modelId: event.modelId,
            model: event.model,
            raw: [...trace.raw, `step ${event.stepId} · ${event.model}`],
          },
        },
      };
    }
    case "text_delta": {
      if (!state.pending) return state;
      return {
        ...state,
        pending: { ...state.pending, content: state.pending.content + event.text },
      };
    }
    case "tool_start": {
      if (!state.pending) return state;
      const trace = state.pending.trace;
      const input = event.input === null ? "" : ` ${JSON.stringify(event.input)}`;
      return {
        ...state,
        pending: {
          ...state.pending,
          trace: {
            ...trace,
            entries: [
              ...trace.entries,
              {
                stepId: event.stepId,
                callId: event.callId,
                name: event.name,
                label: humanToolLabel(event.name),
                status: "running" as const,
              },
            ],
            raw: [...trace.raw, `${event.name}${input}`],
          },
        },
      };
    }
    case "tool_result": {
      if (!state.pending) return state;
      const trace = state.pending.trace;
      return {
        ...state,
        pending: {
          ...state.pending,
          trace: {
            ...trace,
            entries: trace.entries.map((entry) =>
              entry.callId === event.callId
                ? {
                    ...entry,
                    status: event.isError ? ("error" as const) : ("done" as const),
                    durationMs: event.durationMs,
                  }
                : entry,
            ),
            raw: [...trace.raw, event.isError ? `${event.name} failed: ${event.content}` : `${event.name} ok (${event.durationMs}ms)`],
          },
        },
      };
    }
    case "usage": {
      if (!state.pending) return state;
      return {
        ...state,
        usage: {
          inputTokens: state.usage.inputTokens + event.inputTokens,
          outputTokens: state.usage.outputTokens + event.outputTokens,
        },
      };
    }
    case "model_error": {
      if (!state.pending) return state;
      const trace = state.pending.trace;
      return {
        ...state,
        pending: {
          ...state.pending,
          trace: {
            ...trace,
            raw: [
              ...trace.raw,
              event.message,
              ...(event.willFallback ? ["falling back to the next model"] : []),
            ],
          },
        },
      };
    }
    case "run_end": {
      if (!state.pending) return state;
      const { content, trace } = state.pending;
      const note = stopNote(event.stop, event.limit);
      const closed: RunTrace = {
        ...trace,
        durationMs: event.durationMs,
        stop: event.stop,
        limit: event.limit,
        usage: event.usage,
        costUsd: event.costUsd,
      };
      const trimmed = content.trim();
      const messages =
        trimmed === ""
          ? state.messages
          : [
              ...state.messages,
              {
                role: "assistant" as const,
                content,
                ...(note ? { note } : {}),
                trace: closed,
              },
            ];
      return {
        ...state,
        status: "idle",
        pending: null,
        messages,
        runs: state.runs + 1,
        costUsd: state.costUsd + event.costUsd,
        notice: note,
      };
    }
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send": {
      if (state.status !== "idle" || action.content.trim() === "") return state;
      return {
        ...state,
        status: "starting",
        notice: null,
        messages: [...state.messages, { role: "user", content: action.content }],
      };
    }
    case "request_stop": {
      if (state.status !== "starting" && state.status !== "streaming") return state;
      return { ...state, status: "stopping" };
    }
    case "event":
      return applyEvent(state, action.event);
    case "stream_error":
      return finalize(state, "The run stopped before it finished. Try again.");
    case "stream_closed": {
      if (state.status === "idle") return state;
      return finalize(
        state,
        state.status === "stopping"
          ? "Stopped by you."
          : "The connection dropped before the run finished.",
      );
    }
  }
}
