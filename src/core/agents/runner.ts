import { READ_ARTIFACT_TOOL_NAME } from "../artifacts/store";
import type { ArtifactStore } from "../artifacts/store";
import { collectRun } from "../loop/run";
import type {
  LoopEvent,
  LoopModel,
  RunLimits,
  RunSummary,
  ToolExecutor,
  ToolPolicy,
} from "../loop/types";
import type { Message, ModelRole } from "../providers/types";
import { inferToolClass } from "../tools/classify";
import { scopeTools } from "../tools/scope";
import { Semaphore } from "./concurrency";
import type { AgentSpec, SpawnResult, SpawnTask, SubagentWrite } from "./types";

/** Spec §11: max subagent depth is 2. The chat root run is depth 0. */
export const MAX_SUBAGENT_DEPTH = 2;

/** Summary cap so a chatty child cannot bloat the parent's context. */
const SUMMARY_CHARS = 4_000;

export interface SpawnContext {
  /** Model for children whose role has no separate mapping. */
  model: LoopModel;
  /** Role → model mapping (spec: agents refer to roles, never model ids). */
  modelForRole?: (role: ModelRole) => LoopModel | undefined;
  /** The full tool universe; each child gets only what its globs allow. */
  allTools: readonly ToolExecutor[];
  /** The spawning run's policy; children never widen it. */
  policy?: ToolPolicy;
  /** Oversized child results still become artifacts (spec §4 Large results). */
  artifacts?: ArtifactStore;
  /** Depth of the spawning run; this child runs at depth + 1. */
  depth: number;
  /** Run id of the spawning run — child events carry it as parentRunId. */
  parentRunId?: string;
  /** Shared limiter (default: six parallel). */
  limiter?: Semaphore;
  /** Default budgets; an AgentSpec's limits narrow them per child. */
  limits?: Partial<RunLimits>;
  signal?: AbortSignal;
  /** Trace fan-in: every child loop event, already carrying parentRunId. */
  onEvent?: (event: LoopEvent) => void;
}

/**
 * Run one subagent with a fresh context (spec §4 Subagents): the child sees
 * only its own system prompt, its task and its inputs — never the parent's
 * conversation — and only the tools its globs allow. Depth, concurrency and
 * per-child budgets are enforced here; policy decisions pass through the
 * caller's policy unchanged, and anything outside the child's scope is denied
 * even if the model guesses its name (no privilege widening).
 */
export async function runSubagent(
  spec: AgentSpec,
  task: SpawnTask,
  context: SpawnContext,
): Promise<SpawnResult> {
  const childDepth = context.depth + 1;

  if (childDepth > MAX_SUBAGENT_DEPTH) {
    return failedResult(spec, [
      `Subagent depth limit reached (${MAX_SUBAGENT_DEPTH}). Raise the plan's depth or do this task directly.`,
    ]);
  }

  const scoped = scopeTools(
    context.allTools,
    spec.toolGlobs,
    (tool) => tool.definition.name,
  ).filter((tool) => spec.canSpawn === true || !isSpawnTool(tool));

  const inScope = new Set(scoped.map((tool) => tool.definition.name));
  const policy: ToolPolicy | undefined =
    context.policy === undefined
      ? undefined
      : (name) => {
          if (name !== READ_ARTIFACT_TOOL_NAME && !inScope.has(name)) {
            return {
              decision: "deny",
              rule: "deny-list",
              reason: `"${name}" is outside ${spec.displayName}'s tool scope, so the agent cannot call it.`,
            };
          }
          return context.policy!(name);
        };

  const model = context.modelForRole?.(spec.modelRole) ?? context.model;
  const runLimits: Partial<RunLimits> | undefined =
    context.limits !== undefined || spec.limits !== undefined
      ? { ...context.limits, ...spec.limits }
      : undefined;

  const execute = () =>
    collectRun({
      model,
      messages: [taskMessage(task)],
      system: spec.system,
      tools: [...scoped],
      agentLabel: spec.displayName,
      ...(context.onEvent !== undefined ? { onEvent: context.onEvent } : {}),
      ...(policy !== undefined ? { policy } : {}),
      ...(context.artifacts !== undefined ? { artifacts: context.artifacts } : {}),
      ...(runLimits !== undefined ? { limits: runLimits } : {}),
      ...(context.signal !== undefined ? { signal: context.signal } : {}),
      ...(context.parentRunId !== undefined ? { parentRunId: context.parentRunId } : {}),
    });

  let collected;
  try {
    collected =
      context.limiter === undefined
        ? await execute()
        : await context.limiter.run(execute);
  } catch (error) {
    return failedResult(spec, [errorText(error)]);
  }

  return deriveResult(spec, collected.summary, collected.events);
}

/** Fresh task message: inputs first, then the task. No parent history, ever. */
function taskMessage(task: SpawnTask): Message {
  const inputs = Object.entries(task.inputs ?? {});
  const parts: string[] = [];
  if (inputs.length > 0) {
    parts.push("Inputs:");
    for (const [key, value] of inputs) parts.push(`- ${key}: ${value}`);
    parts.push("");
  }
  parts.push(task.prompt);
  return { role: "user", content: parts.join("\n") };
}

/**
 * Derive the structured result from what the child actually did:
 * - failed: cancelled, a model error, a hard limit, or no answer at all;
 * - partial: it answered but at least one tool call failed;
 * - needs_input: it answered with a single trailing question;
 * - ok otherwise.
 * Writes come from the transcript's write/live-effect results, with verified
 * set only when a verify step stamped the result (S12 coordinator).
 */
function deriveResult(
  spec: AgentSpec,
  summary: RunSummary,
  events: LoopEvent[],
): SpawnResult {
  const errors: string[] = [];
  for (const event of events) {
    if (event.type === "model_error") errors.push(event.message);
  }

  const modelMessages = summary.messages;
  const toolErrors: string[] = [];
  for (const message of modelMessages) {
    if (message.role === "tool" && message.isError === true) {
      toolErrors.push(capped(message.content, 500));
    }
  }

  const text = summary.finalText.trim();
  let status: SpawnResult["status"];
  if (summary.stop === "cancelled") {
    errors.push("The run was cancelled before it finished.");
    status = "failed";
  } else if (summary.stop === "error") {
    if (errors.length === 0) errors.push("The model run failed before producing an answer.");
    status = "failed";
  } else if (text === "") {
    errors.push(
      summary.stop === "limit"
        ? `The run hit its ${summary.limit ?? "time or token"} budget before answering.`
        : "The run produced no answer.",
    );
    status = "failed";
  } else if (toolErrors.length > 0) {
    status = "partial";
    errors.push(...toolErrors);
  } else if (text.endsWith("?")) {
    status = "needs_input";
  } else {
    status = "ok";
  }

  const data = parseIfJsonObject(text);
  return {
    agent: spec.name,
    status,
    summary: capped(text, SUMMARY_CHARS),
    ...(data !== undefined ? { data } : {}),
    writes: writesOf(modelMessages),
    errors,
    ...(status === "needs_input" ? { question: capped(text, 500) } : {}),
    runId: summary.runId,
    usage: {
      inputTokens: summary.usage.inputTokens,
      outputTokens: summary.usage.outputTokens,
    },
  };
}

/** Write/live-effect results from the child's transcript, with ids and verification. */
function writesOf(messages: readonly Message[]): SubagentWrite[] {
  const writes: SubagentWrite[] = [];
  for (const message of messages) {
    if (message.role !== "tool" || message.isError === true) continue;
    const toolClass = inferToolClass({ name: message.name });
    if (toolClass !== "write" && toolClass !== "live-effect") continue;
    const parsed = parseIfJsonObject(message.content);
    const recordId =
      parsed !== undefined && typeof parsed === "object"
        ? recordIdOf(parsed as Record<string, unknown>)
        : undefined;
    const verified =
      parsed !== undefined &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).verified === true;
    writes.push({
      tool: message.name,
      ...(recordId !== undefined ? { recordId } : {}),
      verified,
    });
  }
  return writes;
}

/** Same nesting the coordinator's verify step reads (`created`/`updated` wrappers). */
const NESTED_RECORD_KEYS = ["record", "result", "lead", "contact", "customer", "created", "updated"];

function recordIdOf(record: Record<string, unknown>): string | undefined {
  const direct = record.id;
  if (typeof direct === "string" && direct !== "") return direct;
  if (typeof direct === "number") return String(direct);
  for (const [key, value] of Object.entries(record)) {
    if (!key.endsWith("_id")) continue;
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number") return String(value);
  }
  for (const nested of NESTED_RECORD_KEYS) {
    const inner = record[nested];
    if (inner !== null && typeof inner === "object") {
      const innerId = (inner as Record<string, unknown>).id;
      if (typeof innerId === "string" && innerId !== "") return innerId;
      if (typeof innerId === "number") return String(innerId);
    }
  }
  return undefined;
}

function parseIfJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function capped(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function isSpawnTool(tool: ToolExecutor): boolean {
  const name = tool.definition.name;
  return name === "spawn_agent" || name === "spawn_agents";
}

function failedResult(spec: AgentSpec, errors: string[]): SpawnResult {
  return {
    agent: spec.name,
    status: "failed",
    summary: "",
    writes: [],
    errors,
    runId: "",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
