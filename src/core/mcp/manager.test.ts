import { describe, expect, it, vi } from "vitest";
import { createMcpManager } from "./manager";
import { McpError } from "./rpc";
import type { McpServerConfig, McpToolInfo } from "./types";
import { DEFAULT_MCP_SERVERS } from "./defaults";

const TOOLS: McpToolInfo[] = [
  { name: "lead_search", description: "Search leads", inputSchema: { type: "object" } },
  { name: "lead_delete", inputSchema: { type: "object" }, annotations: { destructiveHint: true } },
];

function config(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "demo",
    name: "Demo",
    transport: "stdio",
    command: "node",
    auth: { type: "none" },
    enabled: true,
    ...overrides,
  };
}

function fakeClient(overrides: Partial<ReturnType<typeof baseClient>> = {}) {
  return { ...baseClient(), ...overrides };
}

function baseClient() {
  return {
    serverInfo: { name: "fake", version: "1" },
    listTools: vi.fn(async () => TOOLS),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: '{"ok":true}' }] })),
    close: vi.fn(async () => {}),
  };
}

function managerWith(openImpl: ReturnType<typeof vi.fn>, seed: McpServerConfig[] = [config()]) {
  return createMcpManager({ seed, openImpl: openImpl as never });
}

describe("McpManager", () => {
  it("ships the preconfigured Maple CRM entry disabled", () => {
    const manager = createMcpManager({ seed: DEFAULT_MCP_SERVERS, openImpl: vi.fn() as never });
    const snapshot = manager.snapshot();
    expect(snapshot.servers.map((server) => server.config.name)).toEqual(["Maple CRM", "Demo CRM (local)"]);
    const maple = snapshot.servers[0];
    expect(maple.config.enabled).toBe(false);
    expect(maple.status.state).toBe("disabled");
    expect(maple.status.message).toContain("Preconfigured placeholder");
  });

  it("moves a server from disconnected to connected on a successful test", async () => {
    const client = fakeClient();
    const manager = managerWith(vi.fn(async () => client));
    expect(manager.get("demo")?.status.state).toBe("disconnected");

    const result = await manager.test("demo");
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Demo answered in \d+ms and listed 2 tools/);
    expect(manager.get("demo")?.status).toMatchObject({ state: "connected", toolCount: 2 });
    expect(client.listTools).toHaveBeenCalledTimes(1);
  });

  it("discovers tools into the registry and keeps settings on rediscovery", async () => {
    const manager = managerWith(vi.fn(async () => fakeClient()));
    await manager.discover("demo");
    expect(manager.snapshot().tools.map((tool) => tool.toolName)).toEqual(["lead_delete", "lead_search"]);

    manager.setTool("demo:lead_search", { enabled: false, label: "Find leads" });
    await manager.discover("demo");
    expect(manager.snapshot().tools).toHaveLength(2);
    expect(manager.snapshot().tools.find((tool) => tool.toolName === "lead_search")).toMatchObject({
      enabled: false,
      label: "Find leads",
    });
  });

  it("reports a failed connection in plain language and marks the status", async () => {
    const manager = managerWith(vi.fn(async () => { throw new McpError("Nothing is listening at /tmp/x (connection refused)."); }));
    const result = await manager.test("demo");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Nothing is listening at /tmp/x (connection refused).");
    expect(result.message).not.toContain("Error");
    expect(manager.get("demo")?.status).toMatchObject({ state: "error", message: result.message });
  });

  it("refuses to touch a disabled server with an actionable message", async () => {
    const openImpl = vi.fn(async () => fakeClient());
    const manager = managerWith(openImpl, [config({ enabled: false, note: "Waiting on a real endpoint." })]);
    await expect(manager.test("demo")).rejects.toThrow(/Demo is disabled\. Turn it on/);
    await expect(manager.callTool("demo", "lead_search", {})).rejects.toThrow(/Waiting on a real endpoint/);
    expect(openImpl).not.toHaveBeenCalled();
    expect(manager.get("demo")?.status.state).toBe("disabled");
  });

  it("enforces the per-server rate limit in words", async () => {
    let clock = 1_000;
    const client = fakeClient();
    const manager = createMcpManager({
      seed: [config({ rateLimitPerMinute: 2 })],
      openImpl: (async () => client) as never,
      now: () => clock,
    });
    await manager.callTool("demo", "lead_search", {});
    await manager.callTool("demo", "lead_search", {});
    clock += 1_000;
    await expect(manager.callTool("demo", "lead_search", {})).rejects.toThrow(
      /hit its rate limit — at most 2 calls a minute\. Try again in 59s/,
    );
    clock += 61_000;
    await expect(manager.callTool("demo", "lead_search", {})).resolves.toMatchObject({ ok: true });
  });

  it("drops the connection after a failed call so the next call reconnects", async () => {
    const client = fakeClient({
      callTool: vi
        .fn()
        .mockRejectedValueOnce(new McpError('MCP server "Demo" refused "tools/call": boom (code -32603).'))
        .mockResolvedValue({ content: [{ type: "text", text: "recovered" }] }),
    });
    const openImpl = vi.fn(async () => client);
    const manager = managerWith(openImpl);

    const failed = await manager.callTool("demo", "lead_search", {});
    expect(failed.ok).toBe(false);
    expect(failed.text).toContain('refused "tools/call": boom');
    expect(manager.get("demo")?.status.state).toBe("error");

    const second = await manager.callTool("demo", "lead_search", {});
    expect(second).toEqual({ ok: true, text: "recovered", isError: false });
    expect(openImpl).toHaveBeenCalledTimes(2);
    expect(client.close).toHaveBeenCalled();
  });

  it("keeps tool results that the server marks as errors", async () => {
    const client = fakeClient({
      callTool: vi.fn(async () => ({ content: [{ type: "text", text: "No lead with id x" }], isError: true })),
    });
    const manager = managerWith(vi.fn(async () => client));
    const result = await manager.callTool("demo", "lead_get", { lead_id: "x" });
    expect(result).toEqual({ ok: false, text: "No lead with id x", isError: true });
  });

  it("closes and forgets a server when disabled or removed", async () => {
    const client = fakeClient();
    const manager = managerWith(vi.fn(async () => client));
    await manager.discover("demo");
    expect(manager.snapshot().tools).toHaveLength(2);

    manager.update("demo", { enabled: false, note: "off for maintenance" });
    expect(manager.get("demo")?.status).toMatchObject({ state: "disabled", message: "off for maintenance" });
    expect(manager.snapshot().tools).toHaveLength(0);
    await vi.waitFor(() => expect(client.close).toHaveBeenCalled());

    await manager.remove("demo");
    expect(manager.get("demo")).toBeNull();
  });

  it("rejects duplicate ids and unknown servers plainly", async () => {
    const manager = managerWith(vi.fn());
    expect(() => manager.add(config())).toThrowError(McpError);
    expect(() => manager.add(config({ id: "other" }))).not.toThrow();
    await expect(manager.test("missing")).rejects.toThrow("That server no longer exists.");
    expect(manager.setTool("nope:tool", { enabled: false })).toBeNull();
  });
});
