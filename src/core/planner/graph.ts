import type { PlanTask } from "./types";

/**
 * Validate the task graph before anything runs (spec §4: "Planner builds a
 * task graph with dependencies"). Returns every problem in plain language —
 * duplicate ids, unknown or self references, cycles — or an empty list.
 */
export function validatePlan(tasks: readonly PlanTask[]): string[] {
  const errors: string[] = [];
  if (tasks.length === 0) return ["The plan has no tasks."];

  const seen = new Set<string>();
  for (const task of tasks) {
    if (task.id.trim() === "") {
      errors.push("Every task needs a non-empty id.");
      continue;
    }
    if (seen.has(task.id)) errors.push(`Duplicate task id "${task.id}".`);
    seen.add(task.id);
    if (task.agent.trim() === "") errors.push(`Task "${task.id}" has no agent.`);
    if (task.task.trim() === "") errors.push(`Task "${task.id}" has no task text.`);
  }

  for (const task of tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (dependency === task.id) {
        errors.push(`Task "${task.id}" depends on itself.`);
      } else if (!seen.has(dependency)) {
        errors.push(`Task "${task.id}" depends on unknown task "${dependency}".`);
      }
    }
  }

  const cycle = findCycle(tasks);
  if (cycle !== null) {
    errors.push(`The plan has a dependency cycle: ${cycle.join(" → ")}.`);
  }
  return errors;
}

/**
 * Topological waves: every task whose dependencies are all satisfied joins the
 * current wave. Tasks inside one wave have no ordering between them, so the
 * runner fans them out concurrently. Assumes validatePlan() passed.
 */
export function planWaves(tasks: readonly PlanTask[]): PlanTask[][] {
  const done = new Set<string>();
  const waves: PlanTask[][] = [];
  let placed = 0;

  while (placed < tasks.length) {
    const wave = tasks.filter(
      (task) =>
        !done.has(task.id) &&
        (task.dependsOn ?? []).every((dependency) => done.has(dependency)),
    );
    if (wave.length === 0) {
      // Unsatisfiable (cycle or missing dep) — stop rather than loop forever.
      const stuck = tasks.filter((task) => !done.has(task.id));
      if (stuck.length === 0) break;
      waves.push(stuck);
      break;
    }
    for (const task of wave) done.add(task.id);
    placed = done.size;
    waves.push(wave);
  }
  return waves;
}

function findCycle(tasks: readonly PlanTask[]): string[] | null {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  function visit(id: string): string[] | null {
    const current = state.get(id);
    if (current === "done") return null;
    if (current === "visiting") {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dependency)) continue;
      const found = visit(dependency);
      if (found) return found;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  }

  for (const task of tasks) {
    const found = visit(task.id);
    if (found) return found;
  }
  return null;
}
