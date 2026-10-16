import { McpError } from "./rpc";
import type { McpAuthConfig, McpServerConfig, McpTransportKind } from "./types";

interface RawServer {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  type?: unknown;
  transport?: unknown;
  headers?: unknown;
  auth?: unknown;
  enabled?: unknown;
  note?: unknown;
}

/**
 * Reads a `.mcp.json` in the widely used `mcpServers` shape and turns each
 * entry into harness config. stdio is recognised by `command`, HTTP by `url`,
 * and `type: "sse"` selects the legacy transport.
 */
export function parseMcpJson(text: string): McpServerConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new McpError(`That file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = parsed as { mcpServers?: unknown };
  if (!root || typeof root !== "object" || !root.mcpServers || typeof root.mcpServers !== "object") {
    throw new McpError('No "mcpServers" object found — expected { "mcpServers": { ... } }.');
  }

  const servers: McpServerConfig[] = [];
  for (const [name, raw] of Object.entries(root.mcpServers as Record<string, RawServer>)) {
    servers.push(toConfig(name, raw ?? {}));
  }
  if (servers.length === 0) throw new McpError('The "mcpServers" object is empty.');
  return servers;
}

function toConfig(name: string, raw: RawServer): McpServerConfig {
  const id = slug(name);
  const auth = authFrom(raw);
  const type = typeof raw.type === "string" ? raw.type : undefined;
  const declaredTransport = typeof raw.transport === "string" ? raw.transport : undefined;

  if (typeof raw.command === "string") {
    return {
      id,
      name,
      transport: "stdio",
      command: raw.command,
      ...(Array.isArray(raw.args) ? { args: raw.args.map(String) } : {}),
      ...(raw.env && typeof raw.env === "object" ? { env: recordOf(raw.env) } : {}),
      auth,
      enabled: true,
    };
  }

  if (typeof raw.url === "string") {
    const transport: McpTransportKind =
      type === "sse" || declaredTransport === "sse" ? "sse" : "http";
    return { id, name, transport, url: raw.url, auth, enabled: true };
  }

  throw new McpError(`"${name}" has neither a command nor a url — nothing to connect to.`);
}

function authFrom(raw: RawServer): McpAuthConfig {
  if (raw.auth && typeof raw.auth === "object") {
    const auth = raw.auth as { type?: unknown; token?: unknown; name?: unknown; value?: unknown };
    if (auth.type === "bearer" && typeof auth.token === "string") return { type: "bearer", token: auth.token };
    if (auth.type === "header" && typeof auth.name === "string" && typeof auth.value === "string") {
      return { type: "header", name: auth.name, value: auth.value };
    }
    return { type: "none" };
  }
  if (raw.headers && typeof raw.headers === "object") {
    const headers = recordOf(raw.headers);
    const authorization = headers.Authorization ?? headers.authorization;
    if (typeof authorization === "string") {
      const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
      return match ? { type: "bearer", token: match[1] } : { type: "header", name: "Authorization", value: authorization };
    }
    const [first, value] = Object.entries(headers)[0] ?? [];
    if (first && typeof value === "string") return { type: "header", name: first, value };
  }
  return { type: "none" };
}

function recordOf(value: object): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) output[key] = String(item);
  return output;
}

export function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base === "" ? `server-${Math.random().toString(36).slice(2, 8)}` : base;
}
