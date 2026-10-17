import { DENY_WORDS, inferToolClass, matchesDenyPattern, type ToolClass } from "../tools/classify";
import { matchesAnyGlob } from "../tools/glob";
import type { ToolRegistry } from "../tools/registry";
import {
  DEFAULT_CLASS_POLICY,
  type PolicyContext,
  type PolicyDecision,
  type PolicyMode,
  type PolicyScope,
} from "./types";

/**
 * The policy engine (spec §5): decides auto / ask / deny for one tool call.
 *
 * Resolution order, most forceful first:
 *  1. The global deny pattern on the tool name (delete, remove, archive,
 *     destroy, merge) — beats every allow list.
 *  2. A scope's deny globs.
 *  3. A scope's allow globs — explicit operator intent, so it beats class
 *     defaults (including destructive) once the deny pattern has passed.
 *  4. The most specific scope's per-class mode, else the spec's defaults:
 *     read auto, write auto, live-effect ask, destructive deny — with the
 *     live-effect default adjusted for environment and Owner mode (auto in
 *     interactive chat with Owner mode on, ask with it off, denied
 *     unattended).
 *  5. Environment gates: live-effect cannot run auto unattended unless
 *     allowlisted (the allow step already covered that), an explicit
 *     live-effect auto is downgraded to ask without Owner mode, and "ask"
 *     becomes deny when nobody is there to ask.
 *
 * The decision reason is plain language so it can be shown in a trace and
 * returned to the model when a call is blocked.
 */
export function decideToolCall(
  tool: { name: string; className: ToolClass },
  ctx: PolicyContext,
): PolicyDecision {
  const scopes: PolicyScope[] = ctx.scopes ?? [];
  const ownerMode = ctx.ownerMode ?? true;
  const unattended = ctx.environment === "unattended";

  if (matchesDenyPattern(tool.name)) {
    return {
      decision: "deny",
      rule: "global-deny-pattern",
      reason: `The tool name matches the global deny pattern (${DENY_WORDS.join(", ")}), which beats every allow list.`,
    };
  }

  if (matchesAnyGlob(tool.name, scopes.flatMap((scope) => scope.deny ?? []))) {
    return {
      decision: "deny",
      rule: "deny-list",
      reason: "This tool is on the policy's deny list.",
    };
  }

  if (matchesAnyGlob(tool.name, scopes.flatMap((scope) => scope.allow ?? []))) {
    return {
      decision: "auto",
      rule: "allow-list",
      reason: "This tool is on the policy's allow list, so it runs automatically.",
    };
  }

  const explicit = explicitClassMode(scopes, tool.className);
  const base = explicit ?? defaultClassMode(tool.className, { unattended, ownerMode });

  if (tool.className === "live-effect" && base === "auto" && unattended) {
    return {
      decision: "deny",
      rule: "unattended-live-effect",
      reason: "Live-effect actions are denied in unattended runs unless they are allowlisted.",
    };
  }
  if (tool.className === "live-effect" && base === "auto" && !ownerMode) {
    return {
      decision: "ask",
      rule: "owner-mode",
      reason: "Live-effect actions run automatically only with Owner mode on; this call needs approval.",
    };
  }
  if (base === "ask" && unattended) {
    return {
      decision: "deny",
      rule: "unattended-cannot-ask",
      reason: "This run is unattended, so nobody can approve an ask.",
    };
  }

  return {
    decision: base,
    rule: explicit !== undefined ? "scope-class" : "class-default",
    reason:
      explicit !== undefined
        ? `The policy sets ${tool.className} tools to ${base}.`
        : `${tool.className} tools are ${base} by default.`,
  };
}

/** The most specific scope that names this class wins (workspace < agent < routine). */
function explicitClassMode(scopes: PolicyScope[], className: ToolClass): PolicyMode | undefined {
  let found: PolicyMode | undefined;
  for (const scope of scopes) {
    const mode = scope.classes?.[className];
    if (mode !== undefined) found = mode;
  }
  return found;
}

function defaultClassMode(
  className: ToolClass,
  env: { unattended: boolean; ownerMode: boolean },
): PolicyMode {
  if (className !== "live-effect") return DEFAULT_CLASS_POLICY[className];
  if (env.unattended) return "deny";
  return env.ownerMode ? "auto" : "ask";
}

export interface PolicyEngineOptions extends PolicyContext {
  /** Resolves a tool's class; defaults to inference from the name alone. */
  classOf?: (toolName: string) => ToolClass;
}

export interface PolicyEngine {
  context: PolicyContext;
  decide(toolName: string): PolicyDecision;
}

export function createPolicyEngine(options: PolicyEngineOptions): PolicyEngine {
  const classOf = options.classOf ?? ((name: string) => inferToolClass({ name }));
  const context: PolicyContext = {
    environment: options.environment,
    ...(options.ownerMode !== undefined ? { ownerMode: options.ownerMode } : {}),
    ...(options.scopes !== undefined ? { scopes: options.scopes } : {}),
  };
  return {
    context,
    decide: (toolName) => decideToolCall({ name: toolName, className: classOf(toolName) }, context),
  };
}

/**
 * Engine over a registry snapshot: model-facing names resolve to the class
 * the operator set on the tool row, and names the registry has never seen
 * fall back to inference. The snapshot is taken once so a run sees the same
 * classes it was given.
 */
export function policyEngineFromRegistry(registry: ToolRegistry, ctx: PolicyContext): PolicyEngine {
  const classes = new Map<string, ToolClass>();
  for (const { entry, modelName } of registry.modelTools()) {
    classes.set(modelName, entry.className);
  }
  return createPolicyEngine({
    ...ctx,
    classOf: (name) => classes.get(name) ?? inferToolClass({ name }),
  });
}
