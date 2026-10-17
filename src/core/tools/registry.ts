import type { JsonSchema } from "../providers/types";
import { humanizeToolName, inferToolClass, type ToolClass } from "./classify";
import { scopeTools } from "./scope";
import type { McpToolInfo } from "../mcp/types";

export interface ToolEntry {
  /** `${serverId}:${toolName}` — stable across label/class edits. */
  key: string;
  serverId: string;
  serverName: string;
  toolName: string;
  description?: string;
  inputSchema: JsonSchema;
  className: ToolClass;
  /** Display label shown in traces; defaults to a humanised tool name. */
  label: string;
  enabled: boolean;
  /** How the operator wants this tool proven before it is trusted (spec: verify-with). */
  verifyWith?: string;
}

export interface ToolEntryPatch {
  label?: string;
  className?: ToolClass;
  enabled?: boolean;
  verifyWith?: string | null;
}

type Knowledge = Pick<ToolEntry, "className" | "label" | "enabled" | "verifyWith">;

/**
 * Aggregates tools discovered from every MCP server. Per-tool settings
 * (enable, class, display label, verify-with) survive rediscovery; tools that
 * disappear from a server are dropped.
 */
export class ToolRegistry {
  private entries = new Map<string, ToolEntry>();
  private knowledge = new Map<string, Knowledge>();

  syncServer(serverId: string, serverName: string, tools: McpToolInfo[]): ToolEntry[] {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${serverId}:`)) this.entries.delete(key);
    }
    const synced: ToolEntry[] = [];
    for (const tool of tools) {
      const key = `${serverId}:${tool.name}`;
      const remembered = this.knowledge.get(key);
      const entry: ToolEntry = {
        key,
        serverId,
        serverName,
        toolName: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema ?? {},
        className: remembered?.className ?? inferToolClass({ name: tool.name, ...toolContext(tool) }),
        label: remembered?.label ?? humanizeToolName(tool.name),
        enabled: remembered?.enabled ?? true,
        ...(remembered?.verifyWith ? { verifyWith: remembered.verifyWith } : {}),
      };
      this.entries.set(key, entry);
      synced.push(entry);
    }
    return synced;
  }

  removeServer(serverId: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${serverId}:`)) this.entries.delete(key);
    }
  }

  set(key: string, patch: ToolEntryPatch): ToolEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const next: ToolEntry = { ...entry };
    if (patch.label !== undefined) next.label = patch.label;
    if (patch.className !== undefined) next.className = patch.className;
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.verifyWith !== undefined) {
      if (patch.verifyWith === null || patch.verifyWith === "") delete next.verifyWith;
      else next.verifyWith = patch.verifyWith;
    }
    this.entries.set(key, next);
    this.knowledge.set(key, {
      className: next.className,
      label: next.label,
      enabled: next.enabled,
      ...(next.verifyWith ? { verifyWith: next.verifyWith } : {}),
    });
    return next;
  }

  list(filter?: { serverId?: string; enabled?: boolean }): ToolEntry[] {
    const all = [...this.entries.values()].sort((a, b) =>
      a.serverName === b.serverName
        ? a.toolName.localeCompare(b.toolName)
        : a.serverName.localeCompare(b.serverName),
    );
    return all.filter(
      (entry) =>
        (filter?.serverId === undefined || entry.serverId === filter.serverId) &&
        (filter?.enabled === undefined || entry.enabled === filter.enabled),
    );
  }

  get(key: string): ToolEntry | null {
    return this.entries.get(key) ?? null;
  }

  /**
   * This scope's tools (spec §5: an agent's "tool list (globs allowed)").
   * Deny-pattern tools are never included — scoping keeps them out of the
   * model's context entirely, while policy blocks them at call time too.
   */
  scoped(patterns: readonly string[]): ToolEntry[] {
    return scopeTools(this.list({ enabled: true }), patterns, (entry) => entry.toolName);
  }

  /**
   * Names to expose to the model. Tool names are unique per MCP server, so a
   * collision is qualified with the server name (`server_tool`) and the
   * original name kept for routing the call back.
   */
  modelTools(): { entry: ToolEntry; modelName: string }[] {
    const seen = new Set<string>();
    const output: { entry: ToolEntry; modelName: string }[] = [];
    for (const entry of this.list({ enabled: true })) {
      let modelName = entry.toolName;
      if (seen.has(modelName)) modelName = `${sanitize(entry.serverId)}_${entry.toolName}`;
      let attempt = modelName;
      let suffix = 2;
      while (seen.has(attempt)) attempt = `${modelName}_${suffix++}`;
      modelName = attempt;
      seen.add(modelName);
      output.push({ entry, modelName });
    }
    return output;
  }
}

function toolContext(tool: McpToolInfo): { description?: string; annotations?: McpToolInfo["annotations"] } {
  return {
    ...(tool.description ? { description: tool.description } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  };
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
