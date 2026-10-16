import type { McpServerConfig } from "./types";

/**
 * Servers that ship with the harness: the spec's preconfigured "Maple CRM"
 * entry (disabled until someone points it at a real endpoint) plus a bundled
 * local demo server so the manager can be exercised end to end without one.
 */
export const MAPLE_CRM_SERVER: McpServerConfig = {
  id: "maple-crm",
  name: "Maple CRM",
  transport: "http",
  url: "https://crm.maple.example/mcp",
  auth: { type: "none" },
  enabled: false,
  note: "Preconfigured placeholder — point it at your Maple CRM MCP endpoint.",
};

export const DEMO_LOCAL_SERVER: McpServerConfig = {
  id: "demo-local",
  name: "Demo CRM (local)",
  transport: "stdio",
  command: "node",
  args: ["scripts/demo-mcp-server.mjs"],
  auth: { type: "none" },
  enabled: true,
  note: "Bundled demo server — its tools are samples, not the real Maple CRM.",
};

export const DEFAULT_MCP_SERVERS: McpServerConfig[] = [MAPLE_CRM_SERVER, DEMO_LOCAL_SERVER];
