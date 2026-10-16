import { createHttpChannel, createLegacySseChannel, type FetchDeps } from "./http";
import { McpError, type RpcChannel } from "./rpc";
import { createStdioChannel, type SpawnDeps } from "./stdio";
import {
  DEFAULT_MCP_TIMEOUT_MS,
  type McpContentBlock,
  type McpServerConfig,
  type McpToolInfo,
  type McpToolResult,
} from "./types";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const CLIENT_INFO = { name: "Maple Harness", version: "0.1.0" };

export interface McpClient {
  serverInfo: { name?: string; version?: string } | null;
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}

export interface OpenMcpDeps extends FetchDeps, SpawnDeps {}

export function createChannel(config: McpServerConfig, deps: OpenMcpDeps = {}): RpcChannel {
  if (config.transport === "stdio") return createStdioChannel(config, deps);
  if (config.transport === "sse") return createLegacySseChannel(config, deps);
  return createHttpChannel(config, deps);
}

/**
 * Connects, completes the MCP handshake and returns a client. Every failure
 * leaves the caller with a `McpError` whose `plain` text can go straight to
 * the UI.
 */
export async function openMcp(config: McpServerConfig, deps: OpenMcpDeps = {}): Promise<McpClient> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
  const channel = createChannel(config, deps);

  try {
    const handshake = (await channel.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
      timeoutMs,
    )) as { serverInfo?: { name?: string; version?: string }; protocolVersion?: string } | undefined;

    await channel.notify("notifications/initialized");
    const serverInfo = handshake?.serverInfo ?? null;

    return {
      serverInfo,
      async listTools() {
        const tools: McpToolInfo[] = [];
        let cursor: string | undefined;
        for (;;) {
          const page = (await channel.request(
            "tools/list",
            cursor ? { cursor } : {},
            timeoutMs,
          )) as { tools?: unknown[]; nextCursor?: string } | undefined;
          for (const tool of page?.tools ?? []) tools.push(normalizeTool(tool));
          cursor = page?.nextCursor;
          if (!cursor) break;
        }
        return tools;
      },
      async callTool(name, args) {
        const result = (await channel.request(
          "tools/call",
          { name, arguments: args },
          timeoutMs,
        )) as { content?: unknown; isError?: boolean; structuredContent?: unknown } | undefined;
        if (!result) return { content: [] };
        if (!Array.isArray(result.content)) {
          return {
            content: [{ type: "text", text: JSON.stringify(result.structuredContent ?? result) }],
            ...(result.isError ? { isError: true } : {}),
          };
        }
        return {
          content: result.content as McpContentBlock[],
          ...(result.isError ? { isError: true } : {}),
          ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
        };
      },
      close: () => channel.close(),
    };
  } catch (error) {
    await channel.close().catch(() => undefined);
    throw toMcpError(error, config);
  }
}

function normalizeTool(raw: unknown): McpToolInfo {
  const tool = (raw ?? {}) as Record<string, unknown>;
  const name = typeof tool.name === "string" ? tool.name : "unnamed_tool";
  return {
    name,
    ...(typeof tool.description === "string" ? { description: tool.description } : {}),
    inputSchema:
      tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
        ? (tool.inputSchema as McpToolInfo["inputSchema"])
        : {},
    ...(tool.annotations && typeof tool.annotations === "object"
      ? { annotations: tool.annotations as McpToolInfo["annotations"] }
      : {}),
  };
}

export function toMcpError(error: unknown, config: McpServerConfig): McpError {
  if (error instanceof McpError) return error;
  return new McpError(`${config.name} failed: ${error instanceof Error ? error.message : String(error)}`, {
    cause: error,
  });
}

/** Plain text of a tool result — what the model and the console show. */
export function toolResultText(result: McpToolResult): string {
  const parts: string[] = [];
  for (const block of result.content) {
    if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else {
      try {
        parts.push(JSON.stringify(block));
      } catch {
        parts.push(String(block));
      }
    }
  }
  if (result.structuredContent !== undefined && parts.length === 0) {
    try {
      parts.push(JSON.stringify(result.structuredContent));
    } catch {
      parts.push(String(result.structuredContent));
    }
  }
  return parts.join("\n");
}
