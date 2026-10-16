import type { JsonSchema } from "../providers/types";

export type McpTransportKind = "stdio" | "http" | "sse";

export type McpAuthConfig =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "header"; name: string; value: string };

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportKind;
  /** Streamable HTTP or legacy SSE endpoint. */
  url?: string;
  /** stdio: program to spawn. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  auth: McpAuthConfig;
  enabled: boolean;
  /** Per-request budget; defaults to DEFAULT_MCP_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Local throttle on tool calls, per minute; defaults to 60. */
  rateLimitPerMinute?: number;
  /** Free-form note shown in the UI (why a server is disabled, etc.). */
  note?: string;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  annotations?: McpToolAnnotations;
}

export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: string; [key: string]: unknown };

export interface McpToolResult {
  content: McpContentBlock[];
  isError?: boolean;
  structuredContent?: unknown;
}

export type McpServerState = "disabled" | "disconnected" | "connecting" | "connected" | "error";

export interface McpServerStatus {
  state: McpServerState;
  /** Plain-language message for the UI; never a raw stack trace. */
  message?: string;
  checkedAt?: number;
  toolCount?: number;
}

export const DEFAULT_MCP_TIMEOUT_MS = 10_000;
export const DEFAULT_MCP_RATE_LIMIT = 60;
