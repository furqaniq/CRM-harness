import { describe, expect, it } from "vitest";
import { bodyToChunks, parseTransportFrame, readSse, type TransportFrame } from "@/core/events/sse";
import { POST } from "./route";

const URL = "http://localhost/api/chat";

function chatRequest(body: unknown): Request {
  return new Request(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function readAll(response: Response): Promise<TransportFrame[]> {
  const frames: TransportFrame[] = [];
  const body = response.body;
  if (!body) return frames;
  for await (const frame of readSse(bodyToChunks(body))) {
    const parsed = parseTransportFrame(frame.data);
    if (parsed) frames.push(parsed);
  }
  return frames;
}

function textOf(frames: TransportFrame[]): string {
  return frames
    .filter((frame) => frame.type === "text_delta")
    .map((frame) => (frame.type === "text_delta" ? frame.text : ""))
    .join("");
}

describe("POST /api/chat", () => {
  it("rejects a body it cannot trust", async () => {
    expect((await POST(chatRequest({}))).status).toBe(400);
    expect((await POST(chatRequest({ messages: [] }))).status).toBe(400);
    expect((await POST(chatRequest({ messages: [{ role: "tool", content: "x" }] }))).status).toBe(
      400,
    );
    expect((await POST(chatRequest("not an object"))).status).toBe(400);
    expect((await POST(new Request(URL, { method: "POST", body: "{oops" }))).status).toBe(400);
  });

  it("streams one run as SSE frames that end in run_end", async () => {
    const response = await POST(
      chatRequest({ messages: [{ role: "user", content: "how many leads are open?" }] }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");

    const frames = await readAll(response);
    const types = frames.map((frame) => frame.type);

    expect(types[0]).toBe("run_start");
    expect(types.at(-2)).toBe("run_end");
    expect(types.at(-1)).toBe("stream_end");
    expect(types).toContain("text_delta");
    expect(textOf(frames)).toContain("how many leads are open?");

    const start = frames[0];
    expect(start.type === "run_start" && start.runId).toBeTruthy();
    const end = frames.at(-2);
    expect(end?.type === "run_end" && end.stop).toBe("end");
    expect(end?.type === "run_end" && end.usage.outputTokens).toBeGreaterThan(0);
    expect(end?.type === "run_end" && end.usage.inputTokens).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown run id", async () => {
    const response = await POST(chatRequest({ cancelRunId: "run_nope" }));
    expect(response.status).toBe(404);
  });

  it("cancels an active run when its id is posted", async () => {
    const response = await POST(chatRequest({ messages: [{ role: "user", content: "stop me" }] }));
    const body = response.body;
    expect(body).toBeTruthy();

    const iterator = readSse(bodyToChunks(body as ReadableStream<Uint8Array>));
    const first = await iterator.next();
    expect(first.done).toBe(false);
    const runId = first.value ? (parseTransportFrame(first.value.data)?.runId ?? null) : null;
    expect(runId).toBeTruthy();

    const cancel = await POST(chatRequest({ cancelRunId: runId }));
    expect(cancel.status).toBe(202);
    expect(await cancel.json()).toEqual({ cancelled: true });

    let ended: TransportFrame | null = null;
    for await (const frame of iterator) {
      const parsed = parseTransportFrame(frame.data);
      if (parsed?.type === "run_end") ended = parsed;
    }

    expect(ended?.type === "run_end" && ended.stop).toBe("cancelled");
  });
});
