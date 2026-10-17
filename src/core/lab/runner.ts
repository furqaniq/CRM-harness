import { runChecks } from "./checks";
import type {
  LabModuleReport,
  LabReport,
  LabRow,
  LabRowResult,
  RunEvidence,
  SafetyClass,
} from "./types";

export type LabExecutor = (row: LabRow) => Promise<RunEvidence>;

const DEFAULT_SAFETY: SafetyClass[] = ["safe-read", "safe-qa"];

export interface RunLabOptions {
  /** Safety classes allowed to run; live rows need explicit opt-in (spec §9). */
  safety?: SafetyClass[];
}

/**
 * Runs lab rows through an executor and grades them with the deterministic
 * checks (layer 1). Rows outside the allowed safety classes are skipped, not
 * failed. The report carries a pass rate per module.
 */
export async function runLab(
  rows: readonly LabRow[],
  execute: LabExecutor,
  options: RunLabOptions = {},
): Promise<LabReport> {
  const allowed = new Set<SafetyClass>(options.safety ?? DEFAULT_SAFETY);
  const runId = `lab_${Date.now().toString(36)}`;
  const startedAt = Date.now();
  const results: LabRowResult[] = [];

  for (const row of rows) {
    if (!allowed.has(row.safety)) {
      results.push({
        row,
        status: "skipped",
        evidence: [],
        failures: [`safety class "${row.safety}" requires explicit opt-in`],
        runId,
      });
      continue;
    }
    try {
      const evidence = await execute(row);
      const outcome = runChecks(row.checks, evidence);
      results.push({
        row,
        status: outcome.failures.length === 0 ? "passed" : "failed",
        evidence: outcome.evidence,
        failures: outcome.failures,
        runId,
      });
    } catch (error) {
      results.push({
        row,
        status: "failed",
        evidence: [],
        failures: [`row execution failed: ${error instanceof Error ? error.message : String(error)}`],
        runId,
      });
    }
  }

  const ran = results.filter((result) => result.status !== "skipped");
  const modules = new Map<string, { total: number; passed: number }>();
  for (const result of ran) {
    const bucket = modules.get(result.row.module) ?? { total: 0, passed: 0 };
    bucket.total += 1;
    if (result.status === "passed") bucket.passed += 1;
    modules.set(result.row.module, bucket);
  }
  const moduleReports: LabModuleReport[] = [...modules.entries()].map(([module, bucket]) => ({
    module,
    total: bucket.total,
    passed: bucket.passed,
    passRate: bucket.total === 0 ? 0 : bucket.passed / bucket.total,
  }));

  const passed = ran.filter((result) => result.status === "passed").length;
  return {
    runId,
    startedAt,
    results,
    modules: moduleReports,
    total: ran.length,
    passed,
    passRate: ran.length === 0 ? 0 : passed / ran.length,
    skipped: results.length - ran.length,
  };
}
