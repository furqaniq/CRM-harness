/**
 * JSON-RPC 2.0 over newline-delimited messages, which is how MCP frames both
 * the stdio transport and the message bodies of the HTTP transports.
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return "id" in message && ("result" in message || "error" in message);
}

export function encodeLine(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseLine(line: string): JsonRpcMessage | null {
  const text = line.trim();
  if (text === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const message = parsed as Record<string, unknown>;
  if (message.jsonrpc !== "2.0") return null;
  if (typeof message.method === "string") {
    if ("id" in message && (typeof message.id === "string" || typeof message.id === "number")) {
      return message as unknown as JsonRpcRequest;
    }
    return message as unknown as JsonRpcNotification;
  }
  if ("id" in message) return message as unknown as JsonRpcResponse;
  return null;
}

export class McpError extends Error {
  /** Safe to render in the UI: what happened, in words, without a stack. */
  readonly plain: string;

  constructor(plain: string, options?: { cause?: unknown }) {
    super(plain, options);
    this.name = "McpError";
    this.plain = plain;
  }
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface JsonRpcTransport {
  send(message: JsonRpcRequest | JsonRpcNotification): Promise<void>;
  close(): Promise<void>;
}

export interface RpcChannel {
  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  handle(message: JsonRpcMessage): void;
  close(): Promise<void>;
}

/**
 * A channel owns request ids, timeouts and shutdown. Transports feed it
 * inbound messages and implement the outbound write.
 */
export function createRpcChannel(transport: JsonRpcTransport, what: string): RpcChannel {
  let nextId = 1;
  const pending = new Map<number | string, Pending>();
  let closed = false;

  function settle(id: number | string, outcome: "resolve" | "reject", value: unknown) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (outcome === "resolve") entry.resolve(value);
    else entry.reject(value);
  }

  return {
    async request(method, params, timeoutMs) {
      if (closed) throw new McpError(`${what} is closed.`);
      const id = nextId++;
      const message: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      const answer = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new McpError(
              `${what} did not answer "${method}" within ${Math.round(timeoutMs / 1000)}s. The server may be busy or unreachable.`,
            ),
          );
        }, timeoutMs);
        pending.set(id, { method, resolve, reject, timer });
      });
      // If the outbound write fails the caller never awaits `answer`; keep it
      // from surfacing as an unhandled rejection.
      answer.catch(() => undefined);
      try {
        await transport.send(message);
      } catch (error) {
        const entry = pending.get(id);
        if (entry) {
          pending.delete(id);
          clearTimeout(entry.timer);
        }
        throw error instanceof McpError
          ? error
          : new McpError(`Could not reach ${what}: ${error instanceof Error ? error.message : String(error)}`, {
              cause: error,
            });
      }
      return answer;
    },

    async notify(method, params) {
      if (closed) return;
      await transport.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
    },

    handle(message) {
      if (!isResponse(message)) return;
      const id = message.id;
      if (id === null || id === undefined) return;
      const entry = pending.get(id);
      const method = entry?.method ?? "the request";
      if (message.error) {
        const code = message.error.code;
        const text = message.error.message || "unknown error";
        settle(
          id,
          "reject",
          new McpError(`${what} refused "${method}": ${text} (code ${code}).`),
        );
        return;
      }
      settle(id, "resolve", message.result);
    },

    async close() {
      if (closed) return;
      closed = true;
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new McpError(`${what} closed before "${entry.method}" answered.`));
      }
      pending.clear();
      await transport.close();
    },
  };
}
