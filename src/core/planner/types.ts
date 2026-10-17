import type { SpawnResult } from "../agents/types";

/** One node of the task graph the planner builds (spec §4 Subagents). */
export interface PlanTask {
  id: string;
  agent: string;
  task: string;
  inputs?: Record<string, string>;
  /** Ids that must finish (ok or partial) before this task runs. */
  dependsOn?: string[];
}

/** A task's outcome: its structured result plus its plan id and wave. */
export interface PlanTaskResult extends SpawnResult {
  id: string;
  wave: number;
  /** True when the task never ran because a dependency was not ok/partial. */
  skipped: boolean;
}

export interface PlanRunResult {
  /** Topological waves; tasks inside one wave run concurrently. */
  waves: string[][];
  results: PlanTaskResult[];
}
