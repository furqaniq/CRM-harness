import { describe, expect, it } from "vitest";
import { EMPTY_SERVER_FORM, argSkeleton, buildServerConfig, parseArgsLine, parseToolArgs, statusDotClass, statusLabel, type ServerForm } from "./form";

function form(overrides: Partial<ServerForm> = {}): ServerForm {
  return { ...EMPTY_SERVER_FORM, ...overrides };
}

describe("buildServerConfig", () => {
  it("builds an http server with bearer auth", () => {
    const config = buildServerConfig(
      form({ name: "Staging CRM", endpoint: "https://staging.test/mcp", authType: "bearer", token: " tok " }),
    );
    expect(config).toEqual({
      id: "staging-crm",
      name: "Staging CRM",
      transport: "http",
      url: "https://staging.test/mcp",
      auth: { type: "bearer", token: "tok" },
      enabled: true,
    });
  });

  it("builds a stdio server from a command line plus extra args", () => {
    const config = buildServerConfig(form({ name: "Local", transport: "stdio", endpoint: "node server.mjs", args: "--port 1234" }));
    expect(config).toMatchObject({
      transport: "stdio",
      command: "node",
      args: ["server.mjs", "--port", "1234"],
    });
  });

  it("explains what is missing in plain language", () => {
    expect(() => buildServerConfig(form())).toThrow("Give the server a name.");
    expect(() => buildServerConfig(form({ name: "X" }))).toThrow("Enter the server URL.");
    expect(() => buildServerConfig(form({ name: "X", endpoint: "ftp://no" }))).toThrow(
      "The URL must start with http:// or https://.",
    );
    expect(() =>
      buildServerConfig(form({ name: "X", transport: "stdio" })),
    ).toThrow("Enter the command to run for the stdio server.");
    expect(() =>
      buildServerConfig(form({ name: "X", endpoint: "https://x.test", authType: "bearer" })),
    ).toThrow("Paste the bearer token.");
    expect(() =>
      buildServerConfig(form({ name: "X", endpoint: "https://x.test", authType: "header", headerValue: "v" })),
    ).toThrow("Give the header a name.");
    expect(() => buildServerConfig(form({ name: "Same", endpoint: "https://a.test" }), ["same"])).toThrow(
      /would reuse the id "same"/,
    );
  });
});

describe("parseToolArgs", () => {
  it("accepts an empty box and a real object", () => {
    expect(parseToolArgs("")).toEqual({});
    expect(parseToolArgs(' { "query": "Ada" } ')).toEqual({ query: "Ada" });
  });

  it("rejects anything that is not a JSON object", () => {
    expect(() => parseToolArgs("{oops")).toThrow(/not valid JSON/);
    expect(() => parseToolArgs("[1,2]")).toThrow(/must be a JSON object/);
    expect(() => parseToolArgs('"text"')).toThrow(/must be a JSON object/);
  });
});

describe("status presentation", () => {
  it("labels every state for the UI", () => {
    expect(statusLabel("connected")).toBe("Connected");
    expect(statusLabel("error")).toBe("Needs attention");
    expect(statusLabel("disabled")).toBe("Disabled");
    expect(statusLabel("connecting")).toBe("Connecting…");
    expect(statusLabel("disconnected")).toBe("Not connected");
    expect(statusDotClass("connected")).toBe("bg-ok");
    expect(statusDotClass("error")).toBe("bg-bad");
  });
});

describe("parseArgsLine", () => {
  it("splits on whitespace and drops blanks", () => {
    expect(parseArgsLine("  a   b-c ")).toEqual(["a", "b-c"]);
    expect(parseArgsLine("")).toEqual([]);
  });
});

describe("argSkeleton", () => {
  it("starts from required arguments with values of the right kind", () => {
    const skeleton = argSkeleton({
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
        stage: { type: "string", enum: ["new", "offer"] },
        exact: { type: "boolean" },
        tags: { type: "array" },
        filter: { type: "object" },
        extra: { type: "string" },
      },
      required: ["limit", "query"],
    });
    expect(JSON.parse(skeleton)).toEqual({ limit: 0, query: "", stage: "new", exact: false, tags: [], filter: {} });
  });

  it("is an empty object when the schema declares nothing", () => {
    expect(argSkeleton(undefined)).toBe("{}");
    expect(argSkeleton({ type: "object" })).toBe("{}");
  });
});
