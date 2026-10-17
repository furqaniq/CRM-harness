import { describe, expect, it, beforeEach } from "vitest";
import { bodyToChunks, parseTransportFrame, readSse, type TransportFrame } from "@/core/events/sse";
import { getAppSimulator } from "@/core/simulator";
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

function userTurn(content: string): { role: "user"; content: string } {
  return { role: "user", content };
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    getAppSimulator().reset();
  });

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
    const response = await POST(chatRequest({ messages: [userTurn("hello there")] }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");

    const frames = await readAll(response);
    const types = frames.map((frame) => frame.type);

    expect(types[0]).toBe("run_start");
    expect(types.at(-2)).toBe("run_end");
    expect(types.at(-1)).toBe("stream_end");
    expect(types).toContain("text_delta");
    expect(textOf(frames)).toContain("hello there");

    const start = frames[0];
    expect(start.type === "run_start" && start.runId).toBeTruthy();
    const end = frames.at(-2);
    expect(end?.type === "run_end" && end.stop).toBe("end");
    expect(end?.type === "run_end" && end.usage.outputTokens).toBeGreaterThan(0);
    expect(end?.type === "run_end" && end.usage.inputTokens).toBeGreaterThan(0);
  });

  it("runs a CRM tool and answers from its result", async () => {
    const response = await POST(
      chatRequest({ messages: [userTurn("how many leads are open?")] }),
    );
    const frames = await readAll(response);
    const types = frames.map((frame) => frame.type);

    expect(types).toContain("tool_start");
    expect(types).toContain("tool_result");
    const start = frames.find((frame) => frame.type === "tool_start");
    expect(start?.type === "tool_start" && start.name).toBe("lead_count");
    const result = frames.find((frame) => frame.type === "tool_result");
    expect(result?.type === "tool_result" && result.isError).toBe(false);
    expect(result?.type === "tool_result" && result.content).toContain('"count":4');
    expect(textOf(frames)).toContain("4 items");
  });

  it("denies a delete-shaped call through the global deny pattern", async () => {
    const response = await POST(
      chatRequest({ messages: [userTurn("delete lead L-1001 for me")] }),
    );
    const frames = await readAll(response);

    const start = frames.find((frame) => frame.type === "tool_start");
    expect(start?.type === "tool_start" && start.name).toBe("lead_delete");
    expect(start?.type === "tool_start" && start.policy?.decision).toBe("deny");
    const result = frames.find((frame) => frame.type === "tool_result");
    expect(result?.type === "tool_result" && result.isError).toBe(true);
    expect(result?.type === "tool_result" && result.content).toContain("Denied by policy");
    expect(textOf(frames)).toContain("blocked by policy");
  });

  it("stores the 270 KB automation list as an artifact and answers from the summary", async () => {
    const response = await POST(chatRequest({ messages: [userTurn("list the automations")] }));
    const frames = await readAll(response);

    const result = frames.find((frame) => frame.type === "tool_result");
    if (result?.type !== "tool_result") throw new Error("expected a tool_result");
    expect(result.artifact?.itemCount).toBe(950);
    expect(result.content).toContain("Large result stored as artifact");
    expect(result.content.length).toBeLessThan(2_000);
    expect(textOf(frames)).toContain("artifact");
  });

  it("queues an email to the outbox and says so", async () => {
    const response = await POST(
      chatRequest({ messages: [userTurn("email Ada about her application")] }),
    );
    const frames = await readAll(response);

    const result = frames.find((frame) => frame.type === "tool_result");
    if (result?.type !== "tool_result") throw new Error("expected a tool_result");
    expect(result.isError).toBe(false);
    expect(result.content).toContain("Queued to the outbox");
    expect(getAppSimulator().db.data.outbox).toHaveLength(1);
    expect(textOf(frames)).toContain("outbox");
  });

  it("blocks a live-effect call when Owner mode is off (ask, no approver)", async () => {
    const response = await POST(
      chatRequest({
        messages: [userTurn("email Ada about her application")],
        ownerMode: false,
      }),
    );
    const frames = await readAll(response);

    const result = frames.find((frame) => frame.type === "tool_result");
    if (result?.type !== "tool_result") throw new Error("expected a tool_result");
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Blocked, approval needed");
    expect(getAppSimulator().db.data.outbox).toHaveLength(0);
  });

  it("returns 404 for an unknown run id", async () => {
    const response = await POST(chatRequest({ cancelRunId: "run_nope" }));
    expect(response.status).toBe(404);
  });

  it("cancels an active run when its id is posted", async () => {
    const response = await POST(chatRequest({ messages: [userTurn("stop me")] }));
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
