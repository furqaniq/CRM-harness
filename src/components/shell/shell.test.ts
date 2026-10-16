import { describe, expect, it } from "vitest";
import { isActive, NAV, RAIL_NAV, titleFor } from "./nav";
import { formatTokens, INITIAL_TOKEN_METER, usedPercent } from "./tokenMeter";

describe("rail navigation", () => {
  it("exposes the eight rail entries from spec section 1, in order", () => {
    expect(RAIL_NAV.map((item) => item.railLabel)).toEqual([
      "Home",
      "Agents",
      "Skills",
      "Loops",
      "MCP",
      "Models",
      "Runs",
      "Tests",
    ]);
  });

  it("keeps Settings out of the rail but reachable by URL", () => {
    expect(RAIL_NAV.some((item) => item.key === "settings")).toBe(false);
    expect(NAV.some((item) => item.href === "/settings")).toBe(true);
  });

  it("routes Models to /providers and Tests to /tests", () => {
    expect(NAV.find((item) => item.key === "models")?.href).toBe("/providers");
    expect(NAV.find((item) => item.key === "tests")?.href).toBe("/tests");
  });
});

describe("isActive", () => {
  it("matches the home route exactly", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/agents", "/")).toBe(false);
  });

  it("matches a section and its sub-routes only", () => {
    expect(isActive("/agents", "/agents")).toBe(true);
    expect(isActive("/agents/leads", "/agents")).toBe(true);
    expect(isActive("/loops", "/agents")).toBe(false);
    expect(isActive("/mcp-servers", "/mcp")).toBe(false);
  });
});

describe("titleFor", () => {
  it("labels the shell top bar from the current route", () => {
    expect(titleFor("/")).toBe("Chat");
    expect(titleFor("/tests")).toBe("Test Lab");
    expect(titleFor("/loops/nightly")).toBe("Loops and Routines");
    expect(titleFor("/does-not-exist")).toBe("Maple Harness");
  });
});

describe("token meter", () => {
  it("derives the percentage from used and limit", () => {
    expect(usedPercent(INITIAL_TOKEN_METER)).toBe(47);
    expect(usedPercent({ yourUsed: 0, yourLimit: 2811, companyUsedPercent: 0 })).toBe(0);
    expect(usedPercent({ yourUsed: 5000, yourLimit: 2811, companyUsedPercent: 0 })).toBe(100);
  });

  it("never reports a percentage for a zero limit", () => {
    expect(usedPercent({ yourUsed: 10, yourLimit: 0, companyUsedPercent: 0 })).toBe(0);
  });

  it("formats counts with thousands separators", () => {
    expect(formatTokens(1310)).toBe("1,310");
    expect(formatTokens(2811)).toBe("2,811");
  });
});
