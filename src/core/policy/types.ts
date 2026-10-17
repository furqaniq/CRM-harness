import type { ToolClass } from "../tools/classify";

/** What the harness does with a tool call (spec §5): run it, ask, or deny it. */
export type PolicyMode = "auto" | "ask" | "deny";

/**
 * Interactive chat (a person can be asked) or a routine/loop with nobody
 * watching (nobody can be asked — spec §6: unattended "cannot ask").
 */
export type PolicyEnvironment = "interactive" | "unattended";

/**
 * One level of policy (workspace, agent or routine — spec §5 "Policy per
 * workspace, agent and routine"). Scopes are ordered least specific first, so
 * a routine's classes override the agent's, which override the workspace's.
 */
export interface PolicyScope {
  /** Per-class modes; the most specific scope that sets a class wins. */
  classes?: Partial<Record<ToolClass, PolicyMode>>;
  /** Globs that run automatically, beating class defaults. */
  allow?: string[];
  /** Globs that never run, beating class defaults and allow lists. */
  deny?: string[];
}

/** Where a decision came from — kept small and honest for traces and audit. */
export type PolicyRule =
  | "global-deny-pattern"
  | "deny-list"
  | "allow-list"
  | "scope-class"
  | "class-default"
  | "unattended-live-effect"
  | "owner-mode"
  | "unattended-cannot-ask"
  | "agent-policy";

export interface PolicyDecision {
  decision: PolicyMode;
  rule: PolicyRule;
  /** Plain language, safe to show in a trace (no internal names). */
  reason: string;
}

/**
 * Spec defaults: read auto, write auto, live-effect ask, destructive deny.
 * The live-effect default is further modified by environment and Owner mode
 * inside the engine; the table here is the starting point.
 */
export const DEFAULT_CLASS_POLICY: Record<ToolClass, PolicyMode> = {
  read: "auto",
  write: "auto",
  "live-effect": "ask",
  destructive: "deny",
};

export interface PolicyContext {
  environment: PolicyEnvironment;
  /** Owner mode (interactive only): live-effect tools run auto only with it. */
  ownerMode?: boolean;
  /** Ordered least specific first: workspace, then agent, then routine. */
  scopes?: PolicyScope[];
}
