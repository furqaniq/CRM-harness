import { describe, expect, it } from "vitest";
import { scopeTools } from "./scope";

const TOOLS = [
  "lead_search",
  "lead_get",
  "lead_update_stage",
  "lead_delete",
  "customer_list",
  "contact_group_add",
  "campaign_archive",
  "send_email",
];

function scoped(patterns: string[]): string[] {
  return scopeTools(TOOLS, patterns, (name) => name);
}

describe("scopeTools", () => {
  it("fails closed: an empty scope gets no tools", () => {
    expect(scoped([])).toEqual([]);
  });

  it("keeps only the tools the globs name", () => {
    expect(scoped(["lead_*"])).toEqual(["lead_search", "lead_get", "lead_update_stage"]);
    expect(scoped(["lead_get", "customer_list"])).toEqual(["lead_get", "customer_list"]);
    expect(scoped(["*_delete", "send_email"])).toEqual(["send_email"]);
  });

  it("* is the explicit way to scope every tool", () => {
    expect(scoped(["*"])).toEqual([
      "lead_search",
      "lead_get",
      "lead_update_stage",
      "customer_list",
      "contact_group_add",
      "send_email",
    ]);
  });

  it("never lets a deny-pattern tool into any scope, even *", () => {
    expect(scoped(["*"]).some((name) => /delete|remove|archive|destroy|merge/.test(name))).toBe(
      false,
    );
    expect(scoped(["lead_delete"])).toEqual([]);
    expect(scoped(["campaign_archive"])).toEqual([]);
  });

  it("works on registry-shaped entries via a name accessor", () => {
    const entries = TOOLS.map((name) => ({ toolName: name }));
    const out = scopeTools(entries, ["lead_*"], (entry) => entry.toolName);
    expect(out.map((entry) => entry.toolName)).toEqual([
      "lead_search",
      "lead_get",
      "lead_update_stage",
    ]);
  });
});
