import { describe, expect, it } from "vitest";
import { bodyToChunks, encodeSse, parseTransportFrame, readSse, type SseMessage } from "./sse";

async function* chunks(parts: string[]): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for (const part of parts) yield encoder.encode(part);
}

async function collect(source: AsyncIterable<SseMessage>): Promise<SseMessage[]> {
  const out: SseMessage[] = [];
  for await (const message of source) out.push(message);
  return out;
}

describe("sse encoding", () => {
  it("round-trips a frame split across chunk boundaries", async () => {
    const payload = { type: "text_delta", runId: "r1", text: "hello\nworld" };
    const encoded = encodeSse(payload);
    const parts = [encoded.slice(0, 5), encoded.slice(5, 14), encoded.slice(14)];

    const received = await collect(readSse(chunks(parts)));

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].data)).toEqual(payload);
  });

  it("keeps a payload with newlines and unicode on a single data line", () => {
    const encoded = encodeSse({ type: "x", runId: "r", text: "line\nline \"quoted\" ✓" });
    const lines = encoded.split("\n");

    // data line, then the blank line that terminates the frame.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^data: /);
    expect(lines.slice(1)).toEqual(["", ""]);
    expect(lines[0]).toContain("\\n");
    expect(lines[0]).toContain("✓");
  });

  it("parses several frames, named events and comment heartbeats", async () => {
    const raw = 'data: {"a":1}\n\n: keep-alive\n\nevent: ping\ndata: hi\n\ndata: {"b":2}\n\n';

    const received = await collect(readSse(chunks([raw])));

    expect(received.map((message) => message.data)).toEqual(['{"a":1}', "hi", '{"b":2}']);
    expect(received[1].event).toBe("ping");
  });

  it("flushes a trailing frame with no final blank line", async () => {
    const received = await collect(readSse(chunks(['data: {"last":true}\n'])));

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].data)).toEqual({ last: true });
  });

  it("reads a fetch response body through bodyToChunks", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(encodeSse({ type: "run_start", runId: "r1" })));
        controller.enqueue(encoder.encode(encodeSse({ type: "run_end", runId: "r1" })));
        controller.close();
      },
    });

    const received = await collect(readSse(bodyToChunks(body)));

    expect(received.map((message) => JSON.parse(message.data).type)).toEqual([
      "run_start",
      "run_end",
    ]);
  });
});

describe("parseTransportFrame", () => {
  it("accepts frames that carry a type and a run id", () => {
    expect(parseTransportFrame('{"type":"run_end","runId":"r1"}')).toMatchObject({
      type: "run_end",
      runId: "r1",
    });
  });

  it("ignores anything it cannot trust", () => {
    expect(parseTransportFrame("not json")).toBeNull();
    expect(parseTransportFrame('"a string"')).toBeNull();
    expect(parseTransportFrame('{"type":"run_end"}')).toBeNull();
    expect(parseTransportFrame('{"runId":"r1"}')).toBeNull();
  });
});
