import { describe, expect, it } from "vitest";
import { humanizeToolName, inferToolClass, DENY_WORDS } from "./classify";

describe("inferToolClass", () => {
  it("trusts MCP annotations first", () => {
    expect(inferToolClass({ name: "anything", annotations: { readOnlyHint: true } })).toBe("read");
    expect(inferToolClass({ name: "anything", annotations: { destructiveHint: true } })).toBe("destructive");
    expect(inferToolClass({ name: "lead_delete", annotations: { readOnlyHint: true } })).toBe("destructive");
  });

  it("classes the spec's tool families by name", () => {
    expect(inferToolClass({ name: "lead_search" })).toBe("read");
    expect(inferToolClass({ name: "get_company" })).toBe("read");
    expect(inferToolClass({ name: "list_users" })).toBe("read");
    expect(inferToolClass({ name: "lead_create" })).toBe("write");
    expect(inferToolClass({ name: "lead_update_stage" })).toBe("write");
    expect(inferToolClass({ name: "send_email" })).toBe("live-effect");
    expect(inferToolClass({ name: "campaign_publish" })).toBe("live-effect");
    expect(inferToolClass({ name: "lead_delete" })).toBe("destructive");
  });

  it("treats every deny-pattern word as destructive", () => {
    for (const word of DENY_WORDS) {
      expect(inferToolClass({ name: `lead_${word}_stage` })).toBe("destructive");
      expect(inferToolClass({ name: `contact_${word}` })).toBe("destructive");
    }
  });

  it("reads the description when the name is ambiguous", () => {
    expect(inferToolClass({ name: "crm_action", description: "List all open opportunities" })).toBe("read");
    expect(inferToolClass({ name: "crm_action", description: "Remove a branch and its users" })).toBe(
      "destructive",
    );
  });

  it("defaults an unrecognised tool to live-effect so policy asks first", () => {
    expect(inferToolClass({ name: "frobnicate_widget" })).toBe("live-effect");
  });

  it("classifies camelCase names too", () => {
    expect(inferToolClass({ name: "searchLeads" })).toBe("read");
    expect(inferToolClass({ name: "deleteLead" })).toBe("destructive");
  });
});

describe("humanizeToolName", () => {
  it("turns snake case into a display label", () => {
    expect(humanizeToolName("lead_search")).toBe("Lead search");
    expect(humanizeToolName("get_company")).toBe("Get company");
    expect(humanizeToolName("already human")).toBe("Already human");
  });
});
