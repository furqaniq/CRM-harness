import { describe, expect, it, vi } from "vitest";
import { McpError, createRpcChannel, encodeLine, parseLine, type JsonRpcTransport } from "./rpc";

describe("jsonrpc framing", () => {
  it("round-trips requests, notifications and responses", () => {
    const request = encodeLine({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(request.endsWith("\n")).toBe(true);
    expect(parseLine(request)).toEqual({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(parseLine(encodeLine({ jsonrpc: "2.0", method: "notifications/initialized" }))).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(parseLine(encodeLine({ jsonrpc: "2.0", id: 2, result: { ok: true } }))).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  it("rejects lines that are not jsonrpc messages", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("not json")).toBeNull();
    expect(parseLine('{"hello":1}')).toBeNull();
    expect(parseLine('{"jsonrpc":"1.0","id":1}')).toBeNull();
    expect(parseLine("[1,2]")).toBeNull();
  });
});

function stubTransport(sent: unknown[] = []): JsonRpcTransport & { sent: unknown[]; closed: boolean } {
  return {
    sent,
    closed: false,
    async send(message) {
      sent.push(message);
    },
    async close() {
      this.closed = true;
    },
  };
}

describe("rpc channel", () => {
  it("answers a request with the matching id", async () => {
    const transport = stubTransport();
    const channel = createRpcChannel(transport, "MCP server \"x\"");
    const pending = channel.request("initialize", { protocolVersion: "2025-06-18" }, 1_000);
    const sent = transport.sent[0] as { id: number };
    channel.handle({ jsonrpc: "2.0", id: sent.id, result: { serverInfo: { name: "x" } } });
    await expect(pending).resolves.toEqual({ serverInfo: { name: "x" } });
  });

  it("surfaces a server error as a plain-language McpError naming the method", async () => {
    const transport = stubTransport();
    const channel = createRpcChannel(transport, 'MCP server "demo"');
    const pending = channel.request("tools/list", {}, 1_000);
    const sent = transport.sent[0] as { id: number };
    channel.handle({ jsonrpc: "2.0", id: sent.id, error: { code: -32601, message: "no such method" } });
    await expect(pending).rejects.toThrowError(McpError);
    await expect(pending).rejects.toThrow(/refused "tools\/list": no such method \(code -32601\)/);
  });

  it("times out with a sentence a person can act on", async () => {
    vi.useFakeTimers();
    try {
      const transport = stubTransport();
      const channel = createRpcChannel(transport, 'MCP server "slow"');
      const pending = channel.request("tools/list", {}, 5_000);
      const assertion = expect(pending).rejects.toThrow(/did not answer "tools\/list" within 5s/);
      await vi.advanceTimersByTimeAsync(5_100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails pending requests when the channel closes", async () => {
    const transport = stubTransport();
    const channel = createRpcChannel(transport, 'MCP server "gone"');
    const pending = channel.request("tools/list", {}, 5_000);
    await channel.close();
    await expect(pending).rejects.toThrow(/closed before "tools\/list" answered/);
    expect(transport.closed).toBe(true);
  });

  it("maps a transport failure to a reachability message", async () => {
    const transport: JsonRpcTransport = {
      async send() {
        throw new Error("ECONNREFUSED");
      },
      async close() {},
    };
    const channel = createRpcChannel(transport, 'MCP server "down"');
    await expect(channel.request("initialize", {}, 1_000)).rejects.toThrow(
      /Could not reach MCP server "down": ECONNREFUSED/,
    );
  });
});
