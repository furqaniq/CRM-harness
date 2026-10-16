import { openMcp, toolResultText, type McpClient, type OpenMcpDeps } from "./client";
import { DEFAULT_MCP_SERVERS } from "./defaults";
import { McpError } from "./rpc";
import {
  DEFAULT_MCP_RATE_LIMIT,
  DEFAULT_MCP_TIMEOUT_MS,
  type McpServerConfig,
  type McpServerStatus,
} from "./types";
import { createToolRegistry, type ToolEntry, type ToolEntryPatch, type ToolRegistry } from "../tools/registry";

export interface McpServerView {
  config: McpServerConfig;
  status: McpServerStatus;
}

export interface McpSnapshot {
  servers: McpServerView[];
  tools: ToolEntry[];
}

export interface TestResult {
  ok: boolean;
  message: string;
  toolCount?: number;
}

export interface CallResult {
  ok: boolean;
  text: string;
  isError: boolean;
}

export interface McpManager {
  snapshot(): McpSnapshot;
  get(serverId: string): McpServerView | null;
  add(config: McpServerConfig): void;
  update(serverId: string, patch: Partial<McpServerConfig>): void;
  remove(serverId: string): Promise<void>;
  setTool(key: string, patch: ToolEntryPatch): ToolEntry | null;
  test(serverId: string): Promise<TestResult>;
  discover(serverId: string): Promise<TestResult>;
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<CallResult>;
}

export interface McpManagerOptions extends OpenMcpDeps {
  seed?: McpServerConfig[];
  registry?: ToolRegistry;
  openImpl?: (config: McpServerConfig, deps: OpenMcpDeps) => Promise<McpClient>;
  now?: () => number;
}

interface Live {
  client: McpClient;
}

export function createMcpManager(options: McpManagerOptions = {}): McpManager {
  const { seed = [], registry = createToolRegistry(), openImpl = openMcp, now = () => Date.now() } = options;
  const configs = new Map<string, McpServerConfig>();
  const statuses = new Map<string, McpServerStatus>();
  const live = new Map<string, Live>();
  const callLog = new Map<string, number[]>();

  for (const config of seed) configs.set(config.id, config);

  function statusOf(id: string): McpServerStatus {
    const config = configs.get(id);
    const existing = statuses.get(id);
    if (config && !config.enabled) return { state: "disabled", ...(config.note ? { message: config.note } : {}) };
    return existing ?? { state: "disconnected" };
  }

  function setStatus(id: string, status: McpServerStatus): void {
    statuses.set(id, status);
  }

  async function closeLive(id: string): Promise<void> {
    const entry = live.get(id);
    if (!entry) return;
    live.delete(id);
    await entry.client.close().catch(() => undefined);
  }

  function requireConfig(serverId: string): McpServerConfig {
    const config = configs.get(serverId);
    if (!config) throw new McpError("That server no longer exists.");
    if (!config.enabled) {
      throw new McpError(
        `${config.name} is disabled. Turn it on before testing or calling its tools.${config.note ? ` (${config.note})` : ""}`,
      );
    }
    return config;
  }

  async function ensureClient(config: McpServerConfig): Promise<McpClient> {
    const cached = live.get(config.id);
    if (cached) return cached.client;
    setStatus(config.id, { state: "connecting" });
    try {
      const client = await openImpl(config, options);
      live.set(config.id, { client });
      return client;
    } catch (error) {
      const plain = error instanceof McpError ? error.message : String(error);
      setStatus(config.id, { state: "error", message: plain, checkedAt: now() });
      throw error instanceof McpError ? error : new McpError(plain, { cause: error });
    }
  }

  function checkRateLimit(config: McpServerConfig): void {
    const limit = config.rateLimitPerMinute ?? DEFAULT_MCP_RATE_LIMIT;
    const stamp = now();
    const recent = (callLog.get(config.id) ?? []).filter((at) => stamp - at < 60_000);
    if (recent.length >= limit) {
      const oldest = Math.min(...recent);
      const wait = Math.max(1, Math.ceil((60_000 - (stamp - oldest)) / 1000));
      throw new McpError(`${config.name} hit its rate limit — at most ${limit} calls a minute. Try again in ${wait}s.`);
    }
    recent.push(stamp);
    callLog.set(config.id, recent);
  }

  async function probe(config: McpServerConfig, syncTools: boolean): Promise<TestResult> {
    await closeLive(config.id);
    setStatus(config.id, { state: "connecting" });
    const startedAt = now();
    try {
      const client = await ensureClient(config);
      const tools = await client.listTools();
      const elapsed = now() - startedAt;
      if (syncTools) registry.syncServer(config.id, config.name, tools);
      setStatus(config.id, {
        state: "connected",
        checkedAt: now(),
        toolCount: tools.length,
        message: `Connected in ${elapsed}ms${client.serverInfo?.name ? ` to ${client.serverInfo.name}` : ""}.`,
      });
      return {
        ok: true,
        message: `${config.name} answered in ${elapsed}ms and listed ${tools.length} tool${tools.length === 1 ? "" : "s"}.`,
        toolCount: tools.length,
      };
    } catch (error) {
      await closeLive(config.id);
      const plain = error instanceof McpError ? error.message : String(error);
      setStatus(config.id, { state: "error", message: plain, checkedAt: now() });
      return { ok: false, message: plain };
    }
  }

  return {
    snapshot() {
      const servers = [...configs.values()].map((config) => ({ config, status: statusOf(config.id) }));
      return { servers, tools: registry.list() };
    },

    get(serverId) {
      const config = configs.get(serverId);
      return config ? { config, status: statusOf(serverId) } : null;
    },

    add(config) {
      if (configs.has(config.id)) throw new McpError(`A server with the id "${config.id}" already exists.`);
      configs.set(config.id, config);
      setStatus(config.id, { state: config.enabled ? "disconnected" : "disabled" });
    },

    update(serverId, patch) {
      const config = configs.get(serverId);
      if (!config) throw new McpError("That server no longer exists.");
      const next = { ...config, ...patch, id: config.id };
      configs.set(serverId, next);
      void closeLive(serverId);
      if (!next.enabled) {
        setStatus(serverId, { state: "disabled", ...(next.note ? { message: next.note } : {}) });
        registry.removeServer(serverId);
      } else if (statuses.get(serverId)?.state === "disabled") {
        setStatus(serverId, { state: "disconnected" });
      }
    },

    async remove(serverId) {
      await closeLive(serverId);
      configs.delete(serverId);
      statuses.delete(serverId);
      callLog.delete(serverId);
      registry.removeServer(serverId);
    },

    setTool(key, patch) {
      return registry.set(key, patch);
    },

    async test(serverId) {
      return probe(requireConfig(serverId), false);
    },

    async discover(serverId) {
      return probe(requireConfig(serverId), true);
    },

    async callTool(serverId, toolName, args) {
      const config = requireConfig(serverId);
      checkRateLimit(config);
      const client = await ensureClient(config);
      try {
        const result = await client.callTool(toolName, args);
        const text = toolResultText(result);
        const isError = result.isError === true;
        setStatus(config.id, {
          state: "connected",
          checkedAt: now(),
          ...(statusOf(config.id).toolCount !== undefined ? { toolCount: statusOf(config.id).toolCount } : {}),
          ...(isError ? { message: text.slice(0, 300) } : {}),
        });
        return { ok: !isError, text, isError };
      } catch (error) {
        await closeLive(config.id);
        const plain = error instanceof McpError ? error.message : String(error);
        setStatus(config.id, { state: "error", message: plain, checkedAt: now() });
        return { ok: false, text: plain, isError: true };
      }
    },
  };
}

/** In-process manager used by the app. Config lives until the server restarts (see Known gaps). */
let appManager: McpManager | null = null;

export function getAppMcpManager(): McpManager {
  if (!appManager) appManager = createMcpManager({ seed: DEFAULT_MCP_SERVERS });
  return appManager;
}

export const MCP_TIMEOUT_DEFAULT = DEFAULT_MCP_TIMEOUT_MS;
