import { planWaves, validatePlan } from "./graph";
import type { SpawnResult } from "../agents/types";
import type { PlanRunResult, PlanTask, PlanTaskResult } from "./types";

export interface RunPlanOptions {
  /** Validate first; throws a plain-language error when the graph is broken. */
  tasks: readonly PlanTask[];
  /**
   * Runs one task and returns its structured result. The planner stamps the
   * plan id, wave index and skipped flag. Unexpected throws are recorded as
   * failed tasks so siblings survive (spec §4: failures stay isolated).
   */
  spawn: (task: PlanTask) => Promise<SpawnResult>;
}

/**
 * Execute a task graph: validate, then run wave by wave, every task of a wave
 * concurrently. A task runs only when every dependency finished ok or partial;
 * otherwise it is skipped with the reason, without touching the agent.
 */
export async function runPlan(options: RunPlanOptions): Promise<PlanRunResult> {
  const errors = validatePlan(options.tasks);
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }

  const waves = planWaves(options.tasks).map((wave) => wave.map((task) => task.id));
  const results: PlanTaskResult[] = [];
  const byId = new Map(options.tasks.map((task) => [task.id, task]));
  const outcomes = new Map<string, PlanTaskResult>();

  let waveIndex = 0;
  for (const wave of planWaves(options.tasks)) {
    waveIndex += 1;
    const settled = await Promise.all(
      wave.map(async (task) => {
        const blocking = (task.dependsOn ?? []).flatMap((dependency) => {
          const outcome = outcomes.get(dependency);
          if (!outcome) return [];
          return outcome.status === "ok" || outcome.status === "partial"
            ? []
            : [outcome];
        });
        if (blocking.length > 0) {
          return skipResult(task, waveIndex - 1, blocking, byId);
        }
        try {
          const outcome = await options.spawn(task);
          return { ...outcome, id: task.id, wave: waveIndex - 1, skipped: false };
        } catch (error) {
          return failedResult(
            task,
            waveIndex - 1,
            `Spawn failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
    for (const result of settled) {
      results.push(result);
      outcomes.set(result.id, result);
    }
  }

  return { waves, results };
}

/** Skipped results carry the dependency's actual status, not a guess. */
function skipResult(
  task: PlanTask,
  wave: number,
  blocking: readonly PlanTaskResult[],
  byId: Map<string, PlanTask>,
): PlanTaskResult {
  const detail = blocking
    .map((outcome) => {
      const label = byId.get(outcome.id)?.agent ?? outcome.agent;
      return `"${outcome.id}" (${label}) ended ${outcome.status}`;
    })
    .join(", ");
  return {
    ...failedResult(task, wave, `Skipped: dependency not usable — ${detail}.`),
    skipped: true,
  };
}

function failedResult(task: PlanTask, wave: number, error: string): PlanTaskResult {
  return {
    id: task.id,
    agent: task.agent,
    wave,
    skipped: false,
    status: "failed",
    summary: "",
    writes: [],
    errors: [error],
    runId: "",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
