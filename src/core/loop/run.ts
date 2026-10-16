import { costUsd } from "../models/config";
import type { ChatRequest, Message, StopReason, TokenUsage, ToolCall } from "../providers/types";
import { assembleRequest } from "./context";
import {
  buildToolMap,
  errorMessage,
  parseArguments,
  toToolContent,
  toolContext,
} from "./tools";
import {
  DEFAULT_RUN_LIMITS,
  type LimitKind,
  type LoopEvent,
  type LoopModel,
  type RunLimits,
  type RunStop,
  type RunSummary,
  type ToolExecutor,
} from "./types";

export type {
  LimitKind,
  LoopEvent,
  LoopModel,
  RunLimits,
  RunStop,
  RunSummary,
  ToolContext,
  ToolExecutor,
} from "./types";

export interface RunOptions {
  model: LoopModel;
  /** Tried in order when a provider call fails before producing any output. */
  fallbacks?: LoopModel[];
  messages: Message[];
  system?: string;
  tools?: ToolExecutor[];
  limits?: Partial<RunLimits>;
  temperature?: number;
  /** Output cap for a single model call (distinct from the run token budget). */
  maxOutputTokens?: number;
  /** Trim oldest turns when the conversation estimate exceeds this. */
  maxContextTokens?: number;
  runId?: string;
  parentRunId?: string;
  signal?: AbortSignal;
  /** Injectable clock so time limits are testable. */
  now?: () => number;
}

export interface CollectedRun {
  events: LoopEvent[];
  summary: RunSummary;
  text: string;
}

let runSequence = 0;

export function makeRunId(): string {
  runSequence += 1;
  return `run_${Date.now().toString(36)}_${runSequence.toString(36)}`;
}

function abortPromise(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

interface ToolOutcome {
  call: ToolCall;
  content: string;
  isError: boolean;
  durationMs: number;
}

/**
 * The agent loop (spec §4): assemble context, stream the model, run its tool
 * calls in parallel, repeat until a final answer or a limit. Emits one typed
 * event stream for the UI, run log and Test Lab; the returned summary carries
 * the transcript so routines, subagents and tests can use it as a library.
 */
export async function* runAgent(options: RunOptions): AsyncGenerator<LoopEvent, RunSummary> {
  const now = options.now ?? Date.now;
  const runId = options.runId ?? makeRunId();
  const parentRunId = options.parentRunId;
  const base = parentRunId !== undefined ? { runId, parentRunId } : { runId };
  const limits: RunLimits = { ...DEFAULT_RUN_LIMITS, ...options.limits };
  const tools = buildToolMap(options.tools);
  const toolDefinitions = [...tools.values()].map((tool) => tool.definition);
  const candidates: LoopModel[] = [options.model, ...(options.fallbacks ?? [])];

  const startedAt = now();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });

  let internalLimit: LimitKind | undefined;
  const hitLimit = (kind: LimitKind) => {
    if (internalLimit === undefined) internalLimit = kind;
    controller.abort();
  };

  let messages: Message[] = [...options.messages];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let cost = 0;
  let steps = 0;
  let fallbacks = 0;
  let modelIndex = 0;
  let finalText = "";
  let stepText = "";
  let stepCalls: ToolCall[] = [];
  let stop: RunStop = "end";
  let limit: LimitKind | undefined;

  yield {
    ...base,
    type: "run_start",
    modelId: candidates[0].config.id,
    model: candidates[0].provider.model,
    role: candidates[0].config.label,
    startedAt,
    systemChars: options.system?.length ?? 0,
    messageCount: messages.length,
  };

  try {
    for (;;) {
      if (internalLimit !== undefined) {
        stop = "limit";
        limit = internalLimit;
        break;
      }
      if (controller.signal.aborted) {
        stop = "cancelled";
        break;
      }
      if (steps >= limits.maxSteps) {
        stop = "limit";
        limit = "steps";
        break;
      }
      if (now() - startedAt >= limits.maxTimeMs) {
        stop = "limit";
        limit = "time";
        break;
      }
      if (usage.inputTokens + usage.outputTokens >= limits.maxTokens) {
        stop = "limit";
        limit = "tokens";
        break;
      }
      if (cost >= limits.maxCostUsd) {
        stop = "limit";
        limit = "cost";
        break;
      }

      const active = candidates[modelIndex];
      const stepId = (steps += 1);
      yield {
        ...base,
        type: "step_start",
        stepId,
        modelId: active.config.id,
        model: active.provider.model,
      };

      const request: ChatRequest = assembleRequest({
        model: active.provider.model,
        ...(options.system !== undefined ? { system: options.system } : {}),
        messages,
        ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxOutputTokens !== undefined
          ? { maxTokens: options.maxOutputTokens }
          : {}),
        ...(options.maxContextTokens !== undefined
          ? { maxContextTokens: options.maxContextTokens }
          : {}),
      });

      let text = "";
      let produced = false;
      let providerStop: StopReason = "end";
      const calls: ToolCall[] = [];
      let failure: unknown = null;
      stepText = "";
      stepCalls = [];

      try {
        for await (const event of active.provider.stream(request, controller.signal)) {
          if (internalLimit !== undefined) break;
          if (controller.signal.aborted) break;
          if (now() - startedAt >= limits.maxTimeMs) {
            hitLimit("time");
            break;
          }
          switch (event.type) {
            case "text_delta": {
              produced = true;
              text += event.text;
              finalText += event.text;
              yield { ...base, type: "text_delta", stepId, text: event.text };
              break;
            }
            case "tool_call": {
              produced = true;
              calls.push(event.call);
              break;
            }
            case "usage": {
              usage = {
                inputTokens: usage.inputTokens + event.inputTokens,
                outputTokens: usage.outputTokens + event.outputTokens,
              };
              cost += costUsd(active.config, {
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
              });
              yield {
                ...base,
                type: "usage",
                stepId,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
              };
              if (usage.inputTokens + usage.outputTokens >= limits.maxTokens) hitLimit("tokens");
              else if (cost >= limits.maxCostUsd) hitLimit("cost");
              break;
            }
            case "done": {
              providerStop = event.stop;
              break;
            }
          }
        }
      } catch (error) {
        failure = error;
      }

      if (failure !== null) {
        const willFallback =
          !produced && modelIndex < candidates.length - 1 && !controller.signal.aborted;
        yield {
          ...base,
          type: "model_error",
          stepId,
          modelId: active.config.id,
          message: errorMessage(failure),
          willFallback,
        };
        if (willFallback) {
          modelIndex += 1;
          fallbacks += 1;
          continue;
        }
        stop = "error";
        break;
      }

      stepText = text;
      stepCalls = calls;

      if (internalLimit !== undefined) {
        stop = "limit";
        limit = internalLimit;
        break;
      }
      if (controller.signal.aborted) {
        stop = "cancelled";
        break;
      }

      if (calls.length > 0) {
        const prepared = calls.map((call) => ({
          call,
          parsed: parseArguments(call.arguments),
        }));
        for (const item of prepared) {
          yield {
            ...base,
            type: "tool_start",
            stepId,
            callId: item.call.id,
            name: item.call.name,
            input: item.parsed.ok ? item.parsed.value : null,
            rawArguments: item.call.arguments,
          };
        }

        const executions = prepared.map(async (item): Promise<ToolOutcome> => {
          const toolStarted = now();
          const duration = () => Math.max(0, now() - toolStarted);
          const executor: ToolExecutor | undefined = tools.get(item.call.name);
          if (!executor) {
            return {
              call: item.call,
              content: `Unknown tool: ${item.call.name}`,
              isError: true,
              durationMs: duration(),
            };
          }
          if (!item.parsed.ok) {
            return {
              call: item.call,
              content: `Invalid tool arguments: ${item.parsed.error}`,
              isError: true,
              durationMs: duration(),
            };
          }
          try {
            const output = await executor.execute(
              item.parsed.value,
              toolContext(
                {
                  runId,
                  ...(parentRunId !== undefined ? { parentRunId } : {}),
                  stepId,
                  signal: controller.signal,
                },
                { id: item.call.id, name: item.call.name },
              ),
            );
            return {
              call: item.call,
              content: toToolContent(output),
              isError: false,
              durationMs: duration(),
            };
          } catch (error) {
            return {
              call: item.call,
              content: errorMessage(error),
              isError: true,
              durationMs: duration(),
            };
          }
        });

        const raced = await Promise.race([
          Promise.all(executions).then((outcomes) => ({ settled: true as const, outcomes })),
          abortPromise(controller.signal).then(() => ({ settled: false as const, outcomes: [] })),
        ]);

        if (!raced.settled) {
          if (internalLimit !== undefined) {
            stop = "limit";
            limit = internalLimit;
          } else {
            stop = "cancelled";
          }
          break;
        }

        messages = [...messages, { role: "assistant", content: text, toolCalls: calls }];
        for (const outcome of raced.outcomes) {
          yield {
            ...base,
            type: "tool_result",
            stepId,
            callId: outcome.call.id,
            name: outcome.call.name,
            content: outcome.content,
            isError: outcome.isError,
            durationMs: outcome.durationMs,
          };
          messages.push({
            role: "tool",
            toolCallId: outcome.call.id,
            name: outcome.call.name,
            content: outcome.content,
            isError: outcome.isError,
          });
        }
        continue;
      }

      if (providerStop === "length") {
        stop = "length";
        break;
      }
      if (providerStop === "cancelled") {
        stop = "cancelled";
        break;
      }
      if (providerStop === "tool_calls") {
        yield {
          ...base,
          type: "model_error",
          stepId,
          modelId: active.config.id,
          message: "Provider reported tool calls but sent none",
          willFallback: false,
        };
        stop = "error";
        break;
      }
      stop = "end";
      break;
    }
  } finally {
    options.signal?.removeEventListener("abort", forwardAbort);
  }

  // The closing answer joins the transcript so the next turn sees it. A step
  // that stopped mid-tool-call is never appended: it would dangle without results.
  if (
    stepCalls.length === 0 &&
    stepText !== "" &&
    (stop === "end" || stop === "length" || stop === "cancelled")
  ) {
    messages = [...messages, { role: "assistant", content: stepText }];
  }

  const summary: RunSummary = {
    runId,
    ...(parentRunId !== undefined ? { parentRunId } : {}),
    stop,
    ...(limit !== undefined ? { limit } : {}),
    usage,
    costUsd: cost,
    steps,
    durationMs: Math.max(0, now() - startedAt),
    fallbacks,
    modelId: candidates[modelIndex].config.id,
    finalText,
    messages,
  };

  yield {
    ...base,
    type: "run_end",
    stop,
    ...(limit !== undefined ? { limit } : {}),
    usage,
    costUsd: cost,
    steps,
    durationMs: summary.durationMs,
    fallbacks,
    finalText,
  };

  return summary;
}

/** Convenience for routines, subagents and tests: run to completion and buffer the events. */
export async function collectRun(options: RunOptions): Promise<CollectedRun> {
  const events: LoopEvent[] = [];
  const iterator = runAgent(options);
  let next = await iterator.next();
  while (!next.done) {
    events.push(next.value);
    next = await iterator.next();
  }
  return { events, summary: next.value, text: next.value.finalText };
}
