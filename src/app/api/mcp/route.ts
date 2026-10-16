import { NextResponse } from "next/server";
import { getAppMcpManager } from "@/core/mcp/manager";
import { parseMcpJson } from "@/core/mcp/import";
import { McpError } from "@/core/mcp/rpc";
import {
  type McpAuthConfig,
  type McpServerConfig,
  type McpTransportKind,
} from "@/core/mcp/types";
import type { ToolEntryPatch } from "@/core/tools/registry";

const TRANSPORTS: McpTransportKind[] = ["stdio", "http", "sse"];

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getAppMcpManager().snapshot());
}

export async function POST(request: Request): Promise<NextResponse> {
  const manager = getAppMcpManager();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  try {
    const body = (payload ?? {}) as Record<string, unknown>;
    switch (body.action) {
      case "add": {
        manager.add(parseServerConfig(body.config));
        return NextResponse.json({ snapshot: manager.snapshot() });
      }
      case "update": {
        const serverId = requireString(body.serverId, "serverId");
        const patch = parseServerPatch(body.patch);
        manager.update(serverId, patch);
        return NextResponse.json({ snapshot: manager.snapshot() });
      }
      case "remove": {
        await manager.remove(requireString(body.serverId, "serverId"));
        return NextResponse.json({ snapshot: manager.snapshot() });
      }
      case "test": {
        const result = await manager.test(requireString(body.serverId, "serverId"));
        return NextResponse.json({ result, snapshot: manager.snapshot() });
      }
      case "discover": {
        const result = await manager.discover(requireString(body.serverId, "serverId"));
        return NextResponse.json({ result, snapshot: manager.snapshot() });
      }
      case "call": {
        const result = await manager.callTool(
          requireString(body.serverId, "serverId"),
          requireString(body.toolName, "toolName"),
          parseArgs(body.args),
        );
        return NextResponse.json({ result });
      }
      case "setTool": {
        const entry = manager.setTool(requireString(body.key, "key"), parseToolPatch(body.patch));
        if (!entry) throw new McpError("That tool is no longer in the registry — rediscover the server.");
        return NextResponse.json({ entry, snapshot: manager.snapshot() });
      }
      case "import": {
        const text = requireString(body.json, "json");
        const servers = parseMcpJson(text);
        const taken = new Set<string>();
        for (const server of servers) {
          if (manager.get(server.id) || taken.has(server.id)) {
            throw new McpError(
              `"${server.name}" would reuse the id "${server.id}" — rename it in the file and import again.`,
            );
          }
          taken.add(server.id);
        }
        const added = servers.map((server) => {
          manager.add(server);
          return server.name;
        });
        return NextResponse.json({ added, snapshot: manager.snapshot() });
      }
      default:
        return NextResponse.json(
          { error: 'Unknown action — expected add, update, remove, test, discover, call, setTool or import.' },
          { status: 400 },
        );
    }
  } catch (error) {
    const message = error instanceof McpError ? error.message : "That request could not be completed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new McpError(`"${field}" is required.`);
  return value;
}

function isTransport(value: string): value is McpTransportKind {
  return (TRANSPORTS as string[]).includes(value);
}

function parseArgs(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new McpError("Tool arguments must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function parseServerConfig(value: unknown): McpServerConfig {
  if (typeof value !== "object" || value === null) throw new McpError("A server config object is required.");
  const raw = value as Record<string, unknown>;
  const name = requireString(raw.name, "name");
  const transport = raw.transport;
  if (typeof transport !== "string" || !isTransport(transport)) {
    throw new McpError(`"transport" must be one of ${TRANSPORTS.join(", ")}.`);
  }
  const auth = parseAuth(raw.auth);
  const note = typeof raw.note === "string" && raw.note.trim() !== "" ? raw.note : undefined;

  if (transport === "stdio") {
    const command = requireString(raw.command, "command");
    return {
      id: typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id : slugOf(name),
      name,
      transport,
      command,
      ...(Array.isArray(raw.args) ? { args: raw.args.map(String) } : {}),
      ...(raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)
        ? { env: Object.fromEntries(Object.entries(raw.env as object).map(([k, v]) => [k, String(v)])) }
        : {}),
      auth,
      enabled: raw.enabled !== false,
      ...(note ? { note } : {}),
    };
  }

  const url = requireString(raw.url, "url");
  return {
    id: typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id : slugOf(name),
    name,
    transport,
    url,
    auth,
    enabled: raw.enabled !== false,
    ...(note ? { note } : {}),
  };
}

function parseServerPatch(value: unknown): Partial<McpServerConfig> {
  if (typeof value !== "object" || value === null) throw new McpError("A patch object is required.");
  const raw = value as Record<string, unknown>;
  const patch: Partial<McpServerConfig> = {};
  if (raw.name !== undefined) patch.name = requireString(raw.name, "name");
  if (raw.transport !== undefined) {
    if (typeof raw.transport !== "string" || !isTransport(raw.transport)) {
      throw new McpError(`"transport" must be one of ${TRANSPORTS.join(", ")}.`);
    }
    patch.transport = raw.transport;
  }
  if (raw.url !== undefined) patch.url = requireString(raw.url, "url");
  if (raw.command !== undefined) patch.command = requireString(raw.command, "command");
  if (raw.args !== undefined) {
    if (!Array.isArray(raw.args)) throw new McpError('"args" must be an array.');
    patch.args = raw.args.map(String);
  }
  if (raw.auth !== undefined) patch.auth = parseAuth(raw.auth);
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") throw new McpError('"enabled" must be true or false.');
    patch.enabled = raw.enabled;
  }
  if (raw.note !== undefined) patch.note = raw.note === null ? undefined : String(raw.note);
  return patch;
}

function parseAuth(value: unknown): McpAuthConfig {
  if (value === undefined || value === null) return { type: "none" };
  if (typeof value !== "object") throw new McpError('"auth" must be an object like { type: "none" }.');
  const raw = value as Record<string, unknown>;
  if (raw.type === "bearer") return { type: "bearer", token: requireString(raw.token, "auth.token") };
  if (raw.type === "header") {
    return { type: "header", name: requireString(raw.name, "auth.name"), value: requireString(raw.value, "auth.value") };
  }
  if (raw.type === "oauth") {
    throw new McpError("OAuth arrives with the secrets milestone — use bearer or header auth for now.");
  }
  return { type: "none" };
}

function parseToolPatch(value: unknown): ToolEntryPatch {
  if (typeof value !== "object" || value === null) throw new McpError("A patch object is required.");
  const raw = value as Record<string, unknown>;
  const patch: ToolEntryPatch = {};
  if (raw.label !== undefined) patch.label = String(raw.label);
  if (raw.className !== undefined) {
    if (!["read", "write", "live-effect", "destructive"].includes(String(raw.className))) {
      throw new McpError('"className" must be read, write, live-effect or destructive.');
    }
    patch.className = raw.className as ToolEntryPatch["className"];
  }
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") throw new McpError('"enabled" must be true or false.');
    patch.enabled = raw.enabled;
  }
  if (raw.verifyWith !== undefined) patch.verifyWith = raw.verifyWith === null ? null : String(raw.verifyWith);
  return patch;
}

function slugOf(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base === "" ? "server" : base;
}
