import type { LoopEvent } from "../loop/types";

/**
 * Safety classes from the Test Lab spec: safe rows run by default; live rows
 * would require explicit opt-in and a confirmed test company (no live rows
 * exist yet — everything runs against the simulator).
 */
export type SafetyClass = "safe-read" | "safe-qa" | "live";

/**
 * Layer 1 of lab grading: deterministic checks over the event trace and the
 * final text (spec §9). The LLM judge layer and gold set are later work.
 */
export type LabCheck =
  | { kind: "tool_called"; tool: string }
  | { kind: "tool_not_called"; tool: string }
  | { kind: "text_contains"; text: string }
  /** Every listed tool called, all in one shared step id. */
  | { kind: "parallel_share_step"; tools: string[] }
  /** Every listed tool called, no step containing two of them. */
  | { kind: "steps_sequential"; tools: string[] }
  /** A write's result carries the coordinator's verified stamp. */
  | { kind: "read_back_present" }
  | { kind: "children_started"; count: number }
  /** First line opens with the finding, not a hedge. */
  | { kind: "first_line_finding" }
  /** No record/run ids or raw snake_case tool names in the user-facing text. */
  | { kind: "no_internal_ids" }
  | { kind: "no_confirmation_question" }
  | { kind: "max_chars"; limit: number };

export interface LabRow {
  id: string;
  module: string;
  prompt: string;
  safety: SafetyClass;
  checks: LabCheck[];
  /** Extra chat-request fields (e.g. Owner mode off). */
  body?: { ownerMode?: boolean };
  comment: string;
}

/** What one row produced: every event (parent and children) plus the answer. */
export interface RunEvidence {
  events: LoopEvent[];
  text: string;
}

export interface LabRowResult {
  row: LabRow;
  status: "passed" | "failed" | "skipped";
  /** Plain-language notes for the checks that passed (evidence column). */
  evidence: string[];
  failures: string[];
  runId: string;
}

export interface LabModuleReport {
  module: string;
  total: number;
  passed: number;
  passRate: number;
}

export interface LabReport {
  runId: string;
  startedAt: number;
  results: LabRowResult[];
  modules: LabModuleReport[];
  total: number;
  passed: number;
  passRate: number;
  skipped: number;
}
