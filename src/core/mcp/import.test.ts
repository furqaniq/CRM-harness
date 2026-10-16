import { describe, expect, it } from "vitest";
import { McpError } from "./rpc";
import { parseMcpJson, slug } from "./import";

describe("parseMcpJson", () => {
  it("reads stdio servers with env and args", () => {
    const servers = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          "Maple CRM": { command: "npx", args: ["-y", "@maple/crm-mcp"], env: { MAPLE_TOKEN: "x" } },
        },
      }),
    );
    expect(servers).toEqual([
      {
        id: "maple-crm",
        name: "Maple CRM",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@maple/crm-mcp"],
        env: { MAPLE_TOKEN: "x" },
        auth: { type: "none" },
        enabled: true,
      },
    ]);
  });

  it("reads http and legacy sse servers with bearer or header auth", () => {
    const servers = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          remote: { url: "https://example.test/mcp", headers: { Authorization: "Bearer sekrit" } },
          legacy: { url: "https://example.test/sse", type: "sse", headers: { "X-Api-Key": "abc" } },
        },
      }),
    );
    expect(servers).toMatchObject([
      { id: "remote", transport: "http", auth: { type: "bearer", token: "sekrit" } },
      { id: "legacy", transport: "sse", auth: { type: "header", name: "X-Api-Key", value: "abc" } },
    ]);
  });

  it("explains malformed input in plain language", () => {
    expect(() => parseMcpJson("{nope")).toThrowError(McpError);
    expect(() => parseMcpJson("{nope}")).toThrow(/not valid JSON/);
    expect(() => parseMcpJson(JSON.stringify({ servers: {} }))).toThrow(/No "mcpServers" object/);
    expect(() => parseMcpJson(JSON.stringify({ mcpServers: {} }))).toThrow(/empty/);
    expect(() => parseMcpJson(JSON.stringify({ mcpServers: { bad: {} } }))).toThrow(
      /has neither a command nor a url/,
    );
  });
});

describe("slug", () => {
  it("builds url-safe ids", () => {
    expect(slug("Maple CRM (staging)")).toBe("maple-crm-staging");
    expect(slug("  ")).toMatch(/^server-/);
  });
});
