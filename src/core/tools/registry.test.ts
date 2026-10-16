import { describe, expect, it } from "vitest";
import type { McpToolInfo } from "../mcp/types";
import { createToolRegistry } from "./registry";

function tool(name: string, extra: Partial<McpToolInfo> = {}): McpToolInfo {
  return { name, inputSchema: { type: "object" }, ...extra };
}

describe("ToolRegistry", () => {
  it("discovers tools with a class, a human label and enabled by default", () => {
    const registry = createToolRegistry();
    registry.syncServer("demo", "Demo CRM", [
      tool("lead_search", { description: "Search leads" }),
      tool("lead_delete", { annotations: { destructiveHint: true } }),
      tool("send_email"),
    ]);

    const entries = registry.list();
    expect(entries.map((entry) => [entry.toolName, entry.className, entry.label, entry.enabled])).toEqual([
      ["lead_delete", "destructive", "Lead delete", true],
      ["lead_search", "read", "Lead search", true],
      ["send_email", "live-effect", "Send email", true],
    ]);
    expect(entries[1].description).toBe("Search leads");
    expect(entries.every((entry) => entry.serverId === "demo")).toBe(true);
  });

  it("keeps operator settings across rediscovery and drops removed tools", () => {
    const registry = createToolRegistry();
    registry.syncServer("demo", "Demo CRM", [tool("lead_search"), tool("lead_get")]);
    registry.set("demo:lead_search", { enabled: false, label: "Find leads", className: "write", verifyWith: "S-01" });

    registry.syncServer("demo", "Demo CRM", [tool("lead_search"), tool("lead_update_stage")]);

    const search = registry.get("demo:lead_search");
    expect(search).toMatchObject({
      enabled: false,
      label: "Find leads",
      className: "write",
      verifyWith: "S-01",
    });
    expect(registry.get("demo:lead_get")).toBeNull();
    expect(registry.get("demo:lead_update_stage")).toMatchObject({ enabled: true, label: "Lead update stage" });
    expect(registry.list()).toHaveLength(2);
  });

  it("removes a whole server", () => {
    const registry = createToolRegistry();
    registry.syncServer("a", "A", [tool("get_company")]);
    registry.syncServer("b", "B", [tool("list_users")]);
    registry.removeServer("a");
    expect(registry.list().map((entry) => entry.serverId)).toEqual(["b"]);
  });

  it("exposes only enabled tools to the model and qualifies name collisions", () => {
    const registry = createToolRegistry();
    registry.syncServer("prod", "Production CRM", [tool("get_company")]);
    registry.syncServer("staging", "Staging CRM", [tool("get_company")]);
    registry.syncServer("staging", "Staging CRM", [tool("get_company"), tool("list_users")]);
    registry.set("staging:list_users", { enabled: false });

    const model = registry.modelTools();
    const names = model.map((item) => item.modelName).sort();
    expect(names).toEqual(["get_company", "staging_get_company"]);
    expect(model.every((item) => item.entry.serverId !== "staging" || item.modelName === "staging_get_company")).toBe(
      true,
    );
  });

  it("clears verifyWith when set to null", () => {
    const registry = createToolRegistry();
    registry.syncServer("demo", "Demo", [tool("lead_search")]);
    registry.set("demo:lead_search", { verifyWith: "S-09" });
    expect(registry.get("demo:lead_search")?.verifyWith).toBe("S-09");
    registry.set("demo:lead_search", { verifyWith: null });
    expect(registry.get("demo:lead_search")?.verifyWith).toBeUndefined();
  });

  it("returns null for an unknown key", () => {
    const registry = createToolRegistry();
    expect(registry.set("nope:tool", { enabled: false })).toBeNull();
    expect(registry.get("nope:tool")).toBeNull();
  });
});
