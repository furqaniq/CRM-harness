import type { RunLimits } from "../loop/types";
import type { PolicyMode } from "../policy/types";
import type { ModelRole } from "../providers/types";
import type { ToolClass } from "../tools/classify";

/**
 * Structured status a child hands back (spec §4 Subagents). Derived by the
 * runner from the child's actual run — never asserted by the child itself.
 */
export type SubagentStatus = "ok" | "partial" | "failed" | "needs_input";

/**
 * One agent as its file will describe it (spec §5): name, display name,
 * description, model role, tool list (globs allowed), skills, can-spawn flag,
 * limits, then the prompt body. Policy per agent arrives with the seed files
 * (S16); today the child inherits the caller's policy plus its own scope.
 */
export interface AgentSpec {
  name: string;
  displayName: string;
  description: string;
  /** Agents refer to roles (orchestrator, worker, verifier…), never model ids. */
  modelRole: ModelRole;
  /** Glob patterns over tool names; empty means no tools (scoping fails closed). */
  toolGlobs: string[];
  skills?: string[];
  /** May this agent itself spawn children? */
  canSpawn?: boolean;
  /** Per-child budgets applied over the run defaults. */
  limits?: Partial<RunLimits>;
  /**
   * Optional per-agent policy by tool class (spec §5 "Policy per … agent").
   * It only narrows the caller's decision — an agent can turn auto into ask or
   * deny, never the other way round (no privilege widening).
   */
  policy?: Partial<Record<ToolClass, PolicyMode>>;
  /** The prompt body: the child's system prompt. */
  system: string;
}

/** The task handed to one child: task text plus fresh inputs, nothing else. */
export interface SpawnTask {
  prompt: string;
  inputs?: Record<string, string>;
}

/** One write the child performed, with read-after-write verification if any. */
export interface SubagentWrite {
  tool: string;
  recordId?: string;
  /** True only when a verify step actually confirmed the write (coordinator). */
  verified: boolean;
}

/** The structured result every spawn returns (spec §4 Subagents). */
export interface SpawnResult {
  agent: string;
  status: SubagentStatus;
  /** The child's final answer (capped), safe to show in a trace. */
  summary: string;
  /** Structured payload when the child's answer was JSON; otherwise absent. */
  data?: unknown;
  writes: SubagentWrite[];
  errors: string[];
  /** Set only for needs_input: the single question the child needs answered. */
  question?: string;
  runId: string;
  usage: { inputTokens: number; outputTokens: number };
}
