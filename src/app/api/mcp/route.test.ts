import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

interface ServerRow {
  config: {
    id: string;
    name: string;
    transport: string;
    url?: string;
    command?: string;
    args?: string[];
    auth?: { type: string; token?: string };
    enabled?: boolean;
    note?: string;
  };
  status: { state: string; message?: string; toolCount?: number };
}

interface ToolRow {
  key: string;
  toolName: string;
  label: string;
  className: string;
  enabled: boolean;
}

interface Snapshot {
  servers: ServerRow[];
  tools: ToolRow[];
}

interface Body {
  error?: string;
  added?: string[];
  snapshot?: Snapshot;
  servers?: ServerRow[];
  tools?: ToolRow[];
  result?: { ok: boolean; message?: string; text?: string };
  entry?: { label?: string; className?: string };
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function json(response: Response): Promise<Body> {
  return (await response.json()) as Body;
}

function snapshotOf(body: Body): Snapshot {
  if (body.snapshot) return body.snapshot;
  return { servers: body.servers ?? [], tools: body.tools ?? [] };
}

function findServer(snapshot: Snapshot, id: string): ServerRow {
  const server = snapshot.servers.find((row) => row.config.id === id);
  if (!server) throw new Error(`server ${id} missing from snapshot`);
  return server;
}

describe("GET /api/mcp", () => {
  it("returns the shipped servers with the Maple CRM entry disabled", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const snapshot = snapshotOf(await json(response));
    expect(snapshot.servers.map((server) => server.config.name)).toContain("Maple CRM");
    expect(snapshot.servers.map((server) => server.config.name)).toContain("Demo CRM (local)");
    expect(findServer(snapshot, "maple-crm").status.state).toBe("disabled");
    expect(Array.isArray(snapshot.tools)).toBe(true);
  });
});

describe("POST /api/mcp", () => {
  it("rejects a body it cannot trust", async () => {
    const malformed = await POST(
      new Request("http://localhost/api/mcp", { method: "POST", body: "not json" }),
    );
    expect(malformed.status).toBe(400);
    expect((await json(malformed)).error).toMatch(/JSON body/);

    const unknown = await post({ action: "teleport" });
    expect(unknown.status).toBe(400);
    expect((await json(unknown)).error).toMatch(/Unknown action/);

    const badTransport = await post({
      action: "add",
      config: { name: "X", transport: "carrier-pigeon", url: "https://x.test" },
    });
    expect(badTransport.status).toBe(400);
    expect((await json(badTransport)).error).toMatch(/transport.*stdio, http, sse/);

    const missingUrl = await post({ action: "add", config: { name: "Y", transport: "http" } });
    expect(missingUrl.status).toBe(400);
    expect((await json(missingUrl)).error).toMatch(/"url" is required/);

    const oauth = await post({
      action: "add",
      config: { name: "Z", transport: "http", url: "https://z.test", auth: { type: "oauth" } },
    });
    expect(oauth.status).toBe(400);
    expect((await json(oauth)).error).toMatch(/OAuth arrives with the secrets milestone/);
  });

  it("adds, updates and removes a server", async () => {
    const added = await post({
      action: "add",
      config: { name: "Staging CRM", transport: "http", url: "https://staging.test/mcp" },
    });
    expect(added.status).toBe(200);
    expect(snapshotOf(await json(added)).servers.map((server) => server.config.id)).toContain("staging-crm");

    const duplicate = await post({
      action: "add",
      config: { name: "Staging CRM", transport: "http", url: "https://staging.test/mcp" },
    });
    expect(duplicate.status).toBe(400);
    expect((await json(duplicate)).error).toMatch(/already exists/);

    const updated = await post({
      action: "update",
      serverId: "staging-crm",
      patch: { enabled: false, note: "off until staging is up" },
    });
    expect(updated.status).toBe(200);
    expect(findServer(snapshotOf(await json(updated)), "staging-crm")).toMatchObject({
      status: { state: "disabled", message: "off until staging is up" },
    });

    const removed = await post({ action: "remove", serverId: "staging-crm" });
    expect(removed.status).toBe(200);
    expect(snapshotOf(await json(removed)).servers.some((server) => server.config.id === "staging-crm")).toBe(false);
  });

  it("imports a .mcp.json file", async () => {
    const imported = await post({
      action: "import",
      json: JSON.stringify({
        mcpServers: {
          "Research MCP": { url: "https://research.test/mcp", headers: { Authorization: "Bearer tok" } },
        },
      }),
    });
    expect(imported.status).toBe(200);
    const payload = await json(imported);
    expect(payload.added).toEqual(["Research MCP"]);
    const server = findServer(snapshotOf(payload), "research-mcp");
    expect(server.config).toMatchObject({ transport: "http", url: "https://research.test/mcp" });
    expect(server.config.auth).toEqual({ type: "bearer", token: "tok" });

    const clash = await post({
      action: "import",
      json: JSON.stringify({ mcpServers: { "Research MCP": { url: "https://research.test/mcp" } } }),
    });
    expect(clash.status).toBe(400);
    expect((await json(clash)).error).toMatch(/would reuse the id "research-mcp"/);

    const broken = await post({ action: "import", json: "{oops" });
    expect(broken.status).toBe(400);
    expect((await json(broken)).error).toMatch(/not valid JSON/);

    await post({ action: "remove", serverId: "research-mcp" });
  });

  it("tests, discovers and calls the bundled stdio server", async () => {
    const tested = await json(await post({ action: "test", serverId: "demo-local" }));
    expect(tested.result?.ok).toBe(true);
    expect(tested.result?.message).toMatch(/Demo CRM \(local\) answered in \d+ms and listed 6 tools/);
    expect(findServer(snapshotOf(tested), "demo-local").status.state).toBe("connected");

    const discovered = await json(await post({ action: "discover", serverId: "demo-local" }));
    expect(snapshotOf(discovered).tools.map((tool) => tool.toolName)).toContain("lead_search");

    const set = await post({
      action: "setTool",
      key: "demo-local:lead_search",
      patch: { label: "Find leads", enabled: true, className: "read" },
    });
    expect(set.status).toBe(200);
    const payload = await json(set);
    expect(payload.entry).toMatchObject({ label: "Find leads", className: "read" });

    const called = await json(
      await post({ action: "call", serverId: "demo-local", toolName: "lead_search", args: { query: "Ada" } }),
    );
    expect(called.result?.ok).toBe(true);
    expect(called.result?.text).toContain("Ada Lovelace");

    const missingTool = await json(await post({ action: "call", serverId: "demo-local", toolName: "nope" }));
    expect(missingTool.result?.ok).toBe(false);
    expect(missingTool.result?.text).toMatch(/Unknown tool/);
  });

  it("explains a call to a disabled server", async () => {
    const result = await json(await post({ action: "call", serverId: "maple-crm", toolName: "get_company" }));
    expect(result.error).toMatch(/Maple CRM is disabled/);
  });
});
