import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { encodeSse } from "../events/sse";
import { openMcp, toolResultText } from "./client";
import { McpError } from "./rpc";
import type { McpServerConfig } from "./types";

const HTTP_SERVER: McpServerConfig = {
  id: "http-test",
  name: "HTTP server",
  transport: "http",
  url: "https://example.test/mcp",
  auth: { type: "bearer", token: "sekrit" },
  enabled: true,
  timeoutMs: 2_000,
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(handler: (message: { id?: number; method: string; params?: Record<string, unknown> }, init?: RequestInit) => Response): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : { method: "GET" };
    void url;
    return handler(body, init);
  }) as unknown as typeof fetch;
}

const HANDSHAKE = (id: number) => ({
  jsonrpc: "2.0",
  id,
  result: {
    protocolVersion: "2025-06-18",
    capabilities: { tools: {} },
    serverInfo: { name: "fake-server", version: "1.2.3" },
  },
});

describe("openMcp over streamable HTTP", () => {
  it("completes the handshake and lists tools from a JSON response", async () => {
    const fetchImpl = fakeFetch((message) => {
      if (!("id" in message)) return new Response(null, { status: 202 });
      if (message.method === "initialize") return jsonResponse(HANDSHAKE(message.id as number));
      if (message.method === "tools/list") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: [{ name: "lead_search", description: "Search leads", inputSchema: { type: "object" } }] },
        });
      }
      return new Response("{}", { status: 500 });
    });

    const client = await openMcp(HTTP_SERVER, { fetch: fetchImpl });
    expect(client.serverInfo).toEqual({ name: "fake-server", version: "1.2.3" });
    const tools = await client.listTools();
    expect(tools).toEqual([
      { name: "lead_search", description: "Search leads", inputSchema: { type: "object" } },
    ]);
    await client.close();
    // initialize, notifications/initialized, tools/list — one POST each.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const firstInit = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(String(firstInit.headers && (firstInit.headers as Record<string, string>).Authorization)).toBe(
      "Bearer sekrit",
    );
  });

  it("reads an event-stream response and paginates tools", async () => {
    const fetchImpl = fakeFetch((message) => {
      if (!("id" in message)) return new Response(null, { status: 202 });
      if (message.method === "initialize") return jsonResponse(HANDSHAKE(message.id as number));
      if (message.method === "tools/list") {
        const cursor = (message.params as { cursor?: string } | undefined)?.cursor;
        const page = cursor
          ? { tools: [{ name: "lead_get", inputSchema: { type: "object" } }], nextCursor: undefined }
          : { tools: [{ name: "lead_search", inputSchema: { type: "object" } }], nextCursor: "page-2" };
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(encodeSse({ jsonrpc: "2.0", id: message.id, result: page })));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 500 });
    });

    const client = await openMcp(HTTP_SERVER, { fetch: fetchImpl });
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["lead_search", "lead_get"]);
    await client.close();
  });

  it("explains a 401 without leaking anything else", async () => {
    const fetchImpl = fakeFetch(() => new Response("denied", { status: 401 }));
    await expect(openMcp(HTTP_SERVER, { fetch: fetchImpl })).rejects.toThrowError(McpError);
    await expect(openMcp(HTTP_SERVER, { fetch: fetchImpl })).rejects.toThrow(
      /refused the connection \(HTTP 401\). Check the auth settings/,
    );
  });

  it("explains a 404 and a stream that never speaks JSON-RPC", async () => {
    const notFound = fakeFetch(() => new Response("nope", { status: 404 }));
    await expect(openMcp(HTTP_SERVER, { fetch: notFound })).rejects.toThrow(/No MCP endpoint at https:\/\/example.test\/mcp/);

    const garbage = fakeFetch(() => new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }));
    await expect(openMcp(HTTP_SERVER, { fetch: garbage })).rejects.toThrow(/response that is not JSON-RPC/);
  });

  it("names DNS and refusal failures without the fetch jargon", async () => {
    const dnsFailure = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo research.test failed"), { code: "ENOTFOUND" }) });
    }) as unknown as typeof fetch;
    await expect(openMcp(HTTP_SERVER, { fetch: dnsFailure })).rejects.toThrow(
      /No server found at https:\/\/example.test\/mcp — check the hostname/,
    );

    const refused = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    }) as unknown as typeof fetch;
    await expect(openMcp(HTTP_SERVER, { fetch: refused })).rejects.toThrow(
      /Nothing is listening at https:\/\/example.test\/mcp \(connection refused\)/,
    );
  });

  it("surfaces a tool error as a result with isError", async () => {
    const fetchImpl = fakeFetch((message) => {
      if (!("id" in message)) return new Response(null, { status: 202 });
      if (message.method === "initialize") return jsonResponse(HANDSHAKE(message.id as number));
      if (message.method === "tools/call") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: "No lead with id lead_999" }], isError: true },
        });
      }
      return new Response("{}", { status: 500 });
    });
    const client = await openMcp(HTTP_SERVER, { fetch: fetchImpl });
    const result = await client.callTool("lead_get", { lead_id: "lead_999" });
    expect(result.isError).toBe(true);
    expect(toolResultText(result)).toBe("No lead with id lead_999");
    await client.close();
  });
});

describe("openMcp over stdio", () => {
  const STDIO_SERVER: McpServerConfig = {
    id: "demo-local",
    name: "Demo CRM (local)",
    transport: "stdio",
    command: "node",
    args: [path.resolve(process.cwd(), "scripts/demo-mcp-server.mjs")],
    auth: { type: "none" },
    enabled: true,
    timeoutMs: 5_000,
  };

  it("talks to the bundled demo server end to end", async () => {
    const client = await openMcp(STDIO_SERVER);
    expect(client.serverInfo?.name).toBe("demo-crm-mcp");

    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "lead_search",
      "lead_get",
      "lead_update_stage",
      "send_email",
      "lead_delete",
      "get_company",
    ]);
    expect(tools[0].annotations?.readOnlyHint).toBe(true);

    const found = await client.callTool("lead_search", { query: "Ada" });
    expect(toolResultText(found)).toContain("Ada Lovelace");

    const missing = await client.callTool("lead_get", { lead_id: "lead_999" });
    expect(missing.isError).toBe(true);
    expect(toolResultText(missing)).toBe("No lead with id lead_999");

    await client.close();
  });

  it("explains a missing command in plain language", async () => {
    const missing: McpServerConfig = { ...STDIO_SERVER, command: "definitely-not-a-real-binary-xyz" };
    await expect(openMcp(missing)).rejects.toThrow(/Could not find `definitely-not-a-real-binary-xyz`/);
  });
});

describe("openMcp over legacy SSE", () => {
  it("reads the endpoint event, posts the request and answers from the stream", async () => {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const events = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        c.enqueue(encoder.encode("event: endpoint\ndata: /messages?session=1\n\n"));
      },
    });

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      const body = JSON.parse(String(init.body));
      controller?.enqueue(encoder.encode(encodeSse({ jsonrpc: "2.0", id: body.id, result: HANDSHAKE(body.id).result })));
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const server: McpServerConfig = {
      id: "legacy",
      name: "Legacy server",
      transport: "sse",
      url: "https://example.test/sse",
      auth: { type: "none" },
      enabled: true,
      timeoutMs: 2_000,
    };

    const client = await openMcp(server, { fetch: fetchImpl });
    expect(client.serverInfo?.name).toBe("fake-server");
    expect(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0])).toBe(
      "https://example.test/messages?session=1",
    );
    await client.close();
  });
});
