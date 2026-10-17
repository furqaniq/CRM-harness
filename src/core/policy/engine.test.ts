import { describe, expect, it } from "vitest";
import { createToolRegistry } from "../tools/registry";
import { createPolicyEngine, decideToolCall, policyEngineFromRegistry } from "./engine";
import type { PolicyContext, PolicyEnvironment } from "./types";

function ctx(environment: PolicyEnvironment, extra: Partial<PolicyContext> = {}): PolicyContext {
  return { environment, ownerMode: true, ...extra };
}

const INTERACTIVE_OWNER = ctx("interactive", { ownerMode: true });
const INTERACTIVE_NO_OWNER = ctx("interactive", { ownerMode: false });
const UNATTENDED = ctx("unattended");

describe("decideToolCall — spec defaults", () => {
  type ClassName = "read" | "write" | "live-effect" | "destructive";
  const matrix: [label: string, className: ClassName, context: PolicyContext, expected: "auto" | "ask" | "deny"][] = [
    ["read auto with Owner mode on", "read", INTERACTIVE_OWNER, "auto"],
    ["read auto with Owner mode off", "read", INTERACTIVE_NO_OWNER, "auto"],
    ["read auto unattended", "read", UNATTENDED, "auto"],
    ["write auto in chat", "write", INTERACTIVE_OWNER, "auto"],
    ["write auto unattended", "write", UNATTENDED, "auto"],
    ["live-effect auto with Owner mode on", "live-effect", INTERACTIVE_OWNER, "auto"],
    ["live-effect asks with Owner mode off", "live-effect", INTERACTIVE_NO_OWNER, "ask"],
    ["live-effect denied unattended", "live-effect", UNATTENDED, "deny"],
    ["destructive denied with Owner mode on", "destructive", INTERACTIVE_OWNER, "deny"],
    ["destructive denied with Owner mode off", "destructive", INTERACTIVE_NO_OWNER, "deny"],
    ["destructive denied unattended", "destructive", UNATTENDED, "deny"],
  ];

  for (const [label, className, context, expected] of matrix) {
    it(label, () => {
      const decision = decideToolCall({ name: "some_tool", className }, context);
      expect(decision.decision).toBe(expected);
    });
  }

  it("names a rule and a plain-language reason", () => {
    const decision = decideToolCall(
      { name: "send_email", className: "live-effect" },
      INTERACTIVE_OWNER,
    );
    expect(decision.rule).toBe("class-default");
    expect(decision.reason).toBe("live-effect tools are auto by default.");
  });
});

describe("decideToolCall — global deny pattern", () => {
  it("denies every deny-pattern tool name, beating a * allow list", () => {
    const context = ctx("interactive", { scopes: [{ allow: ["*"] }] });
    for (const name of ["lead_delete", "remove_lead", "campaign_archive", "destroy_db", "merge_records"]) {
      const decision = decideToolCall({ name, className: "read" }, context);
      expect(decision.decision).toBe("deny");
      expect(decision.rule).toBe("global-deny-pattern");
      expect(decision.reason).toContain("delete, remove, archive, destroy, merge");
    }
  });

  it("denies deny-pattern names unattended even when allowlisted", () => {
    const decision = decideToolCall(
      { name: "lead_delete", className: "destructive" },
      ctx("unattended", { scopes: [{ allow: ["*"] }] }),
    );
    expect(decision.decision).toBe("deny");
    expect(decision.rule).toBe("global-deny-pattern");
  });
});

describe("decideToolCall — scope lists", () => {
  it("a deny glob denies a read tool", () => {
    const decision = decideToolCall(
      { name: "lead_update_stage", className: "write" },
      ctx("interactive", { scopes: [{ deny: ["lead_update_*"] }] }),
    );
    expect(decision.decision).toBe("deny");
    expect(decision.rule).toBe("deny-list");
  });

  it("deny globs from every scope apply", () => {
    const decision = decideToolCall(
      { name: "customer_update", className: "write" },
      ctx("interactive", {
        scopes: [{ deny: ["customer_*"] }, { allow: ["customer_*"] }],
      }),
    );
    expect(decision.decision).toBe("deny");
    expect(decision.rule).toBe("deny-list");
  });

  it("an allow glob beats the class default", () => {
    const decision = decideToolCall(
      { name: "conversation_close", className: "destructive" },
      ctx("interactive", { scopes: [{ allow: ["conversation_close"] }] }),
    );
    expect(decision.decision).toBe("auto");
    expect(decision.rule).toBe("allow-list");
  });

  it("allowlists are how unattended runs keep a live-effect tool", () => {
    const denied = decideToolCall({ name: "send_email", className: "live-effect" }, UNATTENDED);
    expect(denied.decision).toBe("deny");

    const allowed = decideToolCall(
      { name: "send_email", className: "live-effect" },
      ctx("unattended", { scopes: [{ allow: ["send_*"] }] }),
    );
    expect(allowed.decision).toBe("auto");
    expect(allowed.rule).toBe("allow-list");
  });
});

describe("decideToolCall — per-class scope policy", () => {
  it("the most specific scope wins (agent over workspace, routine over agent)", () => {
    const decision = decideToolCall(
      { name: "lead_get", className: "read" },
      ctx("interactive", {
        scopes: [{ classes: { read: "deny" } }, { classes: { read: "ask" } }],
      }),
    );
    expect(decision.decision).toBe("ask");
    expect(decision.rule).toBe("scope-class");

    const overridden = decideToolCall(
      { name: "lead_get", className: "read" },
      ctx("interactive", { scopes: [{ classes: { read: "ask" } }, { classes: { read: "auto" } }] }),
    );
    expect(overridden.decision).toBe("auto");
  });

  it("an explicit live-effect auto still needs Owner mode in chat", () => {
    const decision = decideToolCall(
      { name: "send_email", className: "live-effect" },
      ctx("interactive", { ownerMode: false, scopes: [{ classes: { "live-effect": "auto" } }] }),
    );
    expect(decision.decision).toBe("ask");
    expect(decision.rule).toBe("owner-mode");
  });

  it("an explicit live-effect auto is denied unattended unless allowlisted", () => {
    const decision = decideToolCall(
      { name: "send_email", className: "live-effect" },
      ctx("unattended", { scopes: [{ classes: { "live-effect": "auto" } }] }),
    );
    expect(decision.decision).toBe("deny");
    expect(decision.rule).toBe("unattended-live-effect");

    const allowlisted = decideToolCall(
      { name: "send_email", className: "live-effect" },
      ctx("unattended", {
        scopes: [{ classes: { "live-effect": "auto" } }, { allow: ["send_email"] }],
      }),
    );
    expect(allowlisted.decision).toBe("auto");
  });

  it("ask becomes deny when the run is unattended", () => {
    const decision = decideToolCall(
      { name: "lead_update_stage", className: "write" },
      ctx("unattended", { scopes: [{ classes: { write: "ask" } }] }),
    );
    expect(decision.decision).toBe("deny");
    expect(decision.rule).toBe("unattended-cannot-ask");
  });
});

describe("createPolicyEngine", () => {
  it("infers classes from names when no lookup is given", () => {
    const engine = createPolicyEngine({ environment: "interactive", ownerMode: false });
    expect(engine.decide("lead_get").decision).toBe("auto");
    expect(engine.decide("send_email").decision).toBe("ask");
    expect(engine.decide("lead_delete").decision).toBe("deny");
    expect(engine.decide("lead_delete").rule).toBe("global-deny-pattern");
  });

  it("uses the supplied class lookup", () => {
    const engine = createPolicyEngine({
      environment: "interactive",
      ownerMode: true,
      classOf: (name) => (name === "odd_tool" ? "live-effect" : "read"),
    });
    expect(engine.decide("odd_tool").decision).toBe("auto");
    expect(engine.decide("odd_tool").rule).toBe("class-default");
    expect(engine.context.environment).toBe("interactive");
  });
});

describe("policyEngineFromRegistry", () => {
  it("resolves model names to the operator-edited class", () => {
    const registry = createToolRegistry();
    registry.syncServer("demo", "Demo CRM", [
      { name: "lead_search", inputSchema: {} },
      { name: "lead_delete", inputSchema: {} },
      { name: "send_email", inputSchema: {} },
    ]);
    // The operator reclassed send_email as read-only on the tool row.
    const email = registry.list().find((entry) => entry.toolName === "send_email");
    if (!email) throw new Error("expected send_email in the registry");
    registry.set(email.key, { className: "read" });

    const engine = policyEngineFromRegistry(registry, {
      environment: "interactive",
      ownerMode: false,
    });
    expect(engine.decide("lead_search").decision).toBe("auto");
    // Without the edit this would be "ask" (Owner mode is off).
    expect(engine.decide("send_email").decision).toBe("auto");
    expect(engine.decide("send_email").rule).toBe("class-default");
    expect(engine.decide("lead_delete").decision).toBe("deny");
  });

  it("falls back to inference for names the registry has never seen", () => {
    const registry = createToolRegistry();
    const engine = policyEngineFromRegistry(registry, { environment: "interactive" });
    expect(engine.decide("mystery_send").decision).toBe("auto");
    expect(engine.decide("mystery_send").rule).toBe("class-default");
  });
});
