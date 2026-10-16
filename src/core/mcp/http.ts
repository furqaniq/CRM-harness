import { bodyToChunks, readSse } from "../events/sse";
import { McpError, type JsonRpcMessage, type JsonRpcTransport, type RpcChannel, createRpcChannel, parseLine } from "./rpc";
import type { McpAuthConfig, McpServerConfig } from "./types";

export interface FetchDeps {
  fetch?: typeof fetch;
}

export function authHeaders(auth: McpAuthConfig): Record<string, string> {
  if (auth.type === "bearer") return { Authorization: `Bearer ${auth.token}` };
  if (auth.type === "header") return { [auth.name]: auth.value };
  return {};
}

function transportName(config: McpServerConfig): string {
  return `MCP server "${config.name}"`;
}

async function readResponseMessages(response: Response, config: McpServerConfig): Promise<JsonRpcMessage[]> {
  const contentType = response.headers.get("content-type") ?? "";
  const messages: JsonRpcMessage[] = [];

  if (contentType.includes("text/event-stream")) {
    if (!response.body) throw new McpError(`${transportName(config)} opened an empty event stream.`);
    for await (const frame of readSse(bodyToChunks(response.body))) {
      const message = parseLine(frame.data);
      if (message) messages.push(message);
    }
    return messages;
  }

  const text = await response.text();
  if (text.trim() === "") return messages;
  // Servers answer with either one JSON object or newline-delimited messages.
  for (const line of text.split("\n")) {
    const message = parseLine(line);
    if (message) messages.push(message);
  }
  if (messages.length === 0) throw new McpError(`${transportName(config)} sent a response that is not JSON-RPC.`);
  return messages;
}

export function postJsonRpc(
  fetchImpl: typeof fetch,
  config: McpServerConfig,
  message: JsonRpcMessage,
  timeoutMs: number,
): Promise<Response> {
  if (!config.url) throw new McpError(`${transportName(config)} has no URL.`);
  return fetchImpl(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...authHeaders(config.auth),
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error: unknown) => {
    if (error instanceof McpError) throw error;
    const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
    const code = cause?.code;
    if (code === "ECONNREFUSED") {
      throw new McpError(`Nothing is listening at ${config.url} (connection refused).`, { cause: error });
    }
    if (code === "ENOTFOUND") {
      throw new McpError(`No server found at ${config.url} — check the hostname.`, { cause: error });
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new McpError(`${transportName(config)} did not respond within ${Math.round(timeoutMs / 1000)}s.`, {
        cause: error,
      });
    }
    const detail = cause?.message ?? (error instanceof Error ? error.message : String(error));
    throw new McpError(`Could not reach ${config.url}: ${detail}`, { cause: error });
  });
}

/**
 * Streamable HTTP: one JSON-RPC message per POST, answered as a JSON document
 * or as an event stream.
 */
export function createHttpChannel(config: McpServerConfig, deps: FetchDeps = {}): RpcChannel {
  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;
  let push: ((message: JsonRpcMessage) => void) | null = null;

  const transport: JsonRpcTransport = {
    async send(message) {
      const response = await postJsonRpc(fetchImpl, config, message, timeoutMs);
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw httpStatusError(config, response.status);
      }
      const messages = await readResponseMessages(response, config);
      for (const parsed of messages) push?.(parsed);
    },
    async close() {
      /* connection-scoped: nothing to keep open */
    },
  };

  const channel = createRpcChannel(transport, transportName(config));
  push = (message) => channel.handle(message);
  return channel;
}

export function httpStatusError(config: McpServerConfig, status: number): McpError {
  const url = config.url ?? "the server";
  if (status === 401 || status === 403) {
    return new McpError(`${config.name} refused the connection (HTTP ${status}). Check the auth settings for ${url}.`);
  }
  if (status === 404) {
    return new McpError(`No MCP endpoint at ${url} (HTTP 404). Check the URL.`);
  }
  if (status === 405) {
    return new McpError(`${url} answered HTTP 405 — it may be a legacy SSE server rather than streamable HTTP.`);
  }
  if (status >= 500) return new McpError(`${config.name} is unhealthy (HTTP ${status}). Try again shortly.`);
  return new McpError(`${config.name} answered HTTP ${status}.`);
}

/** Legacy HTTP+SSE handshake: an event stream plus a message endpoint event. */
export function createLegacySseChannel(config: McpServerConfig, deps: FetchDeps = {}): RpcChannel {
  const fetchImpl = deps.fetch ?? fetch;
  let push: ((message: JsonRpcMessage) => void) | null = null;
  let endpoint: string | null = null;
  let started: Promise<void> | null = null;
  const timeoutMs = config.timeoutMs ?? 10_000;

  if (!config.url) throw new McpError(`${transportName(config)} has no URL.`);

  function ensureStarted(): Promise<void> {
    if (started) return started;
    started = (async () => {
      const response = await fetchImpl(config.url as string, {
        headers: { Accept: "text/event-stream", ...authHeaders(config.auth) },
        signal: AbortSignal.timeout(timeoutMs),
      }).catch((error: unknown) => {
        throw new McpError(
          `Could not open the event stream at ${config.url}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      });
      if (!response.ok) throw httpStatusError(config, response.status);
      if (!response.body) throw new McpError(`${config.name} opened an empty event stream.`);
      void (async () => {
        try {
          for await (const frame of readSse(bodyToChunks(response.body as ReadableStream<Uint8Array>))) {
            if (frame.event === "endpoint") {
              endpoint = new URL(frame.data, config.url as string).toString();
              continue;
            }
            const message = parseLine(frame.data);
            if (message) push?.(message);
          }
        } catch {
          // A dropped stream surfaces as request timeouts, which already carry
          // a plain-language message.
        }
      })();
    })();
    return started;
  }

  const transport: JsonRpcTransport = {
    async send(message) {
      await ensureStarted();
      // The endpoint event normally arrives before the first reply; give it a
      // moment rather than racing the POST to an empty path.
      const deadline = Date.now() + 2_000;
      while (!endpoint && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      if (!endpoint) {
        throw new McpError(`${config.name} never announced its message endpoint. Is this a legacy SSE server?`);
      }
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(config.auth) },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(timeoutMs),
      }).catch((error: unknown) => {
        throw new McpError(
          `Could not post to ${config.name}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw httpStatusError(config, response.status);
      }
      // Legacy servers answer on the stream; a 202 with no body is normal.
      await response.body?.cancel().catch(() => undefined);
    },
    async close() {
      /* the event stream ends with the response body */
    },
  };

  const channel = createRpcChannel(transport, transportName(config));
  push = (message) => channel.handle(message);
  return channel;
}
