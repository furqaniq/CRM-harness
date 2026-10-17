import type { ToolContext, ToolExecutor } from "../loop/types";
import { DEFAULT_PARALLEL_LIMIT, Semaphore } from "./concurrency";
import { MAX_SUBAGENT_DEPTH, runSubagent, type SpawnContext } from "./runner";
import type { AgentSpec, SpawnResult, SpawnTask } from "./types";

export interface SpawnToolDeps {
  /** Agents the current run may spawn, looked up by `name`. */
  agents: readonly AgentSpec[];
  /** The current run's spawn context (its depth, tools, policy, event fan-in). */
  context: SpawnContext;
  /** Shared limiter; `buildSpawnTools` creates one when none is passed. */
  limiter?: Semaphore;
}

/**
 * The built-ins every orchestrator run gets (spec §4): `spawn_agent` for one
 * child, `spawn_agents` for a concurrent batch. Offered only while the current
 * run is shallow enough to have children — at max depth they are not in the
 * context at all, and `execute` refuses again as defence in depth.
 */
export function buildSpawnTools(deps: SpawnToolDeps): ToolExecutor[] {
  if (deps.context.depth >= MAX_SUBAGENT_DEPTH) return [];
  const shared: SpawnToolDeps = {
    ...deps,
    limiter: deps.limiter ?? new Semaphore(DEFAULT_PARALLEL_LIMIT),
  };
  return [spawnAgentTool(shared), spawnAgentsTool(shared)];
}

export function spawnAgentTool(deps: SpawnToolDeps): ToolExecutor {
  return {
    definition: {
      name: "spawn_agent",
      description:
        "Run one specialist agent in a fresh context on a single task. Returns a structured " +
        "result: status (ok, partial, failed, needs_input), summary, writes with a verified " +
        "flag, errors, and a question when the agent needs input.",
      inputSchema: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: `Agent name. Known agents: ${agentNames(deps).join(", ")}`,
          },
          task: { type: "string", description: "The task for the agent." },
          inputs: {
            type: "object",
            description: "Optional fresh inputs (strings) the agent should use instead of history.",
            additionalProperties: { type: "string" },
          },
        },
        required: ["agent", "task"],
      },
    },
    async execute(args, ctx) {
      const request = parseSpawnRequest(args);
      if ("error" in request) return request.error;
      return spawnOne(deps, request.agent, request.task, ctx);
    },
  };
}

export function spawnAgentsTool(deps: SpawnToolDeps): ToolExecutor {
  const limiter = deps.limiter ?? new Semaphore(DEFAULT_PARALLEL_LIMIT);
  return {
    definition: {
      name: "spawn_agents",
      description:
        "Run several specialist agents concurrently, each in its own fresh context. Siblings " +
        "are isolated: one agent failing does not stop the others. Returns an array of " +
        "structured results.",
      inputSchema: {
        type: "object",
        properties: {
          agents: {
            type: "array",
            description: "Tasks to run concurrently (capped at 6 in flight).",
            items: {
              type: "object",
              properties: {
                agent: { type: "string", description: "Agent name." },
                task: { type: "string", description: "The task for the agent." },
                inputs: {
                  type: "object",
                  description: "Optional fresh inputs (strings).",
                  additionalProperties: { type: "string" },
                },
              },
              required: ["agent", "task"],
            },
          },
        },
        required: ["agents"],
      },
    },
    async execute(args) {
      const items = parseSpawnBatch(args);
      if ("error" in items) return items.error;
      // allSettled: siblings survive each other's failures (spec §4).
      const settled = await Promise.allSettled(
        items.map((item) =>
          spawnOne({ ...deps, limiter }, item.agent, item.task, undefined, item.inputs),
        ),
      );
      return settled.map((outcome, index) =>
        outcome.status === "fulfilled"
          ? outcome.value
          : failedResult(
              items[index].agent,
              `Spawn failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`,
            ),
      );
    },
  };
}

async function spawnOne(
  deps: SpawnToolDeps,
  agentName: string,
  task: string,
  ctx?: ToolContext,
  inputs?: Record<string, string>,
): Promise<SpawnResult> {
  const spec = deps.agents.find((candidate) => candidate.name === agentName);
  if (!spec) {
    return failedResult(
      agentName,
      `Unknown agent "${agentName}". Known agents: ${agentNames(deps).join(", ")}.`,
    );
  }

  const childDepth = deps.context.depth + 1;
  if (childDepth > MAX_SUBAGENT_DEPTH) {
    return failedResult(agentName, `Subagent depth limit reached (${MAX_SUBAGENT_DEPTH}).`);
  }

  const spawnTask: SpawnTask = { prompt: task, ...(inputs ? { inputs } : {}) };
  return runSubagent(spec, spawnTask, {
    ...deps.context,
    depth: deps.context.depth,
    ...(deps.limiter !== undefined ? { limiter: deps.limiter } : {}),
    // Child events carry the spawning run's id so the trace can group lanes.
    ...(ctx?.runId !== undefined ? { parentRunId: ctx.runId } : {}),
  });
}

interface ParsedSpawnRequest {
  agent: string;
  task: string;
  inputs?: Record<string, string>;
}

function parseSpawnRequest(args: Record<string, unknown>): ParsedSpawnRequest | { error: string } {
  const agent = typeof args.agent === "string" ? args.agent.trim() : "";
  const task = typeof args.task === "string" ? args.task.trim() : "";
  if (agent === "" || task === "") {
    return { error: "spawn_agent needs an \"agent\" name and a \"task\"." };
  }
  const inputs = parseInputs(args.inputs);
  return {
    agent,
    task,
    ...(inputs !== undefined ? { inputs } : {}),
  };
}

function parseSpawnBatch(args: Record<string, unknown>): Array<Omit<ParsedSpawnRequest, "inputs"> & { inputs?: Record<string, string> }> | { error: string } {
  const list = Array.isArray(args.agents) ? args.agents : null;
  if (list === null || list.length === 0) {
    return { error: 'spawn_agents needs a non-empty "agents" array.' };
  }
  const items: Array<Omit<ParsedSpawnRequest, "inputs"> & { inputs?: Record<string, string> }> = [];
  for (const entry of list) {
    const parsed =
      entry !== null && typeof entry === "object"
        ? parseSpawnRequest(entry as Record<string, unknown>)
        : { error: "Each agents[] entry needs an object with agent and task." };
    if ("error" in parsed) return parsed;
    items.push(parsed);
  }
  return items;
}

function parseInputs(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const inputs: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") inputs[key] = entry;
    else inputs[key] = String(entry);
  }
  return inputs;
}

function agentNames(deps: SpawnToolDeps): string[] {
  return deps.agents.map((agent) => agent.name);
}

function failedResult(agent: string, error: string): SpawnResult {
  return {
    agent,
    status: "failed",
    summary: "",
    writes: [],
    errors: [error],
    runId: "",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
