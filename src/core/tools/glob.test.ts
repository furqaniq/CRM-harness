import { describe, expect, it } from "vitest";
import { globToRegExp, matchesAnyGlob, matchesGlob } from "./glob";

describe("matchesGlob", () => {
  it("matches exact names only", () => {
    expect(matchesGlob("lead_search", "lead_search")).toBe(true);
    expect(matchesGlob("lead_search", "lead_searc")).toBe(false);
    expect(matchesGlob("lead_search", "lead")).toBe(false);
  });

  it("runs * across any characters, including separators", () => {
    expect(matchesGlob("lead_search", "lead_*")).toBe(true);
    expect(matchesGlob("lead_search", "*_search")).toBe(true);
    expect(matchesGlob("lead_search", "*")).toBe(true);
    expect(matchesGlob("lead_search", "search_*")).toBe(false);
    expect(matchesGlob("lead_search", "lead_search.extra")).toBe(false);
  });

  it("matches exactly one character with ?", () => {
    expect(matchesGlob("a1", "a?")).toBe(true);
    expect(matchesGlob("a12", "a?")).toBe(false);
    expect(matchesGlob("lead", "lea?")).toBe(true);
  });

  it("treats regex metacharacters in names as literals", () => {
    expect(matchesGlob("lead.search", "lead.search")).toBe(true);
    expect(matchesGlob("leadXsearch", "lead.search")).toBe(false);
    expect(matchesGlob("a+b", "a+b")).toBe(true);
    expect(globToRegExp("a+b").source).toBe("^a\\+b$");
  });

  it("treats ** like *", () => {
    expect(matchesGlob("lead_search", "lead**search")).toBe(true);
    expect(matchesGlob("lead_search", "**")).toBe(true);
  });

  it("is case-sensitive, like tool names", () => {
    expect(matchesGlob("lead_search", "Lead_search")).toBe(false);
  });
});

describe("matchesAnyGlob", () => {
  it("matches when any pattern matches and treats undefined as nothing", () => {
    expect(matchesAnyGlob("lead_get", ["lead_*", "contact_*"])).toBe(true);
    expect(matchesAnyGlob("contact_get", ["lead_*", "contact_*"])).toBe(true);
    expect(matchesAnyGlob("other", ["lead_*"])).toBe(false);
    expect(matchesAnyGlob("lead_get", undefined)).toBe(false);
    expect(matchesAnyGlob("lead_get", [])).toBe(false);
  });
});
