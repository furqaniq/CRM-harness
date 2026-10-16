import type { LoopEvent } from "../loop/types";

export interface SseMessage {
  event?: string;
  data: string;
}

/** Server-sent frame for the harness's own streams (chat, run log, Test Lab). */
export function encodeSse(payload: unknown, event?: string): string {
  const body = JSON.stringify(payload);
  return `${event ? `event: ${event}\n` : ""}data: ${body}\n\n`;
}

function parseBlock(block: string): SseMessage | null {
  const data: string[] = [];
  let event: string | undefined;

  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  }

  if (data.length === 0) return null;
  return event === undefined ? { data: data.join("\n") } : { event, data: data.join("\n") };
}

/** Reads an SSE byte stream frame by frame, flushing a trailing frame at the end. */
export async function* readSse(
  chunks: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder();
  let buffer = "";

  const drain = function* (flush: boolean): Generator<SseMessage> {
    for (;;) {
      const index = buffer.indexOf("\n\n");
      if (index === -1) break;
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const message = parseBlock(block);
      if (message) yield message;
    }
    if (flush && buffer.trim() !== "") {
      const message = parseBlock(buffer);
      buffer = "";
      if (message) yield message;
    }
  };

  for await (const chunk of chunks) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    yield* drain(false);
  }
  buffer += decoder.decode();
  yield* drain(true);
}

/** Adapts a fetch response body to the chunk source `readSse` expects. */
export async function* bodyToChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export type TransportFrame =
  | LoopEvent
  | { type: "stream_end"; runId: string }
  | { type: "stream_error"; runId: string; message: string };

/** Minimal shape check: the client ignores frames it does not understand. */
export function parseTransportFrame(data: string): TransportFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;
  if (typeof frame.type !== "string" || typeof frame.runId !== "string") return null;
  return frame as unknown as TransportFrame;
}
