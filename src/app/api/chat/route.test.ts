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

  it("runs two specialist agents side by side inside one step (PAR-04 lanes)", async () => {
    const response = await POST(
      chatRequest({
        messages: [userTurn("check open leads and waiting conversations in parallel")],
      }),
    );
    const frames = await readAll(response);

    const spawnStart = frames.find(
      (frame) => frame.type === "tool_start" && frame.name === "spawn_agents",
    );
    if (spawnStart?.type !== "tool_start") throw new Error("expected a spawn_agents call");

    const rootStart = frames.find(
      (frame) => frame.type === "run_start" && frame.parentRunId === undefined,
    );
    if (rootStart?.type !== "run_start") throw new Error("expected the root run_start");
    expect(spawnStart.stepId).toBeGreaterThan(0);

    const childStarts = frames.filter(
      (frame) => frame.type === "run_start" && frame.parentRunId !== undefined,
    );
    expect(childStarts).toHaveLength(2);
    const labels = childStarts.map((frame) =>
      frame.type === "run_start" ? frame.agentLabel : undefined,
    );
    // Spawn order is not guaranteed; both lanes being present is.
    expect([...labels].sort()).toEqual(["Inbox agent", "Leads agent"]);
    for (const frame of childStarts) {
      if (frame.type !== "run_start") continue;
      expect(frame.parentRunId).toBe(rootStart.runId);
      expect(frame.runId).not.toBe(rootStart.runId);
    }

    // Both children started before the first one finished: one step, two lanes.
    const firstEnded = frames.findIndex(
      (frame) => frame.type === "run_end" && frame.parentRunId !== undefined,
    );
    for (const start of childStarts) {
      expect(frames.indexOf(start)).toBeLessThan(firstEnded);
    }

    const childTools = frames
      .filter((frame) => frame.type === "tool_start" && frame.parentRunId !== undefined)
      .map((frame) => (frame.type === "tool_start" ? frame.name : ""));
    expect(childTools).toContain("lead_count");
    expect(childTools).toContain("conversation_list");

    const spawnResult = frames.find(
      (frame) => frame.type === "tool_result" && frame.name === "spawn_agents",
    );
    if (spawnResult?.type !== "tool_result") throw new Error("expected the spawn result");
    expect(spawnResult.isError).toBe(false);
    expect(spawnResult.content).toContain('"agent":"leads"');
    expect(spawnResult.content).toContain('"agent":"inbox"');
    expect(spawnResult.content).toContain('"status":"ok"');

    const runEnds = frames.filter((frame) => frame.type === "run_end");
    const rootEnd = runEnds.find(
      (frame) => frame.type === "run_end" && frame.parentRunId === undefined,
    );
    expect(rootEnd).toBeDefined();
    // Both lanes closed inside the parent's step; the root's run_end comes last.
    expect(runEnds).toHaveLength(3);
    expect(runEnds.at(-1)).toBe(rootEnd);
    expect(textOf(frames)).toContain("Ran 2 agents side by side");
  });

  it("makes exactly one verified record through a specialist (PAR-17)", async () => {
    const leadsBefore = getAppSimulator().db.data.leads.length;
    const response = await POST(
      chatRequest({ messages: [userTurn("Create a lead named Ada Harness")] }),
    );
    const frames = await readAll(response);

    const spawnStart = frames.find(
      (frame) => frame.type === "tool_start" && frame.name === "spawn_agent",
    );
    if (spawnStart?.type !== "tool_start") throw new Error("expected a spawn_agent call");

    const childStart = frames.find(
      (frame) => frame.type === "run_start" && frame.parentRunId !== undefined,
    );
    if (childStart?.type !== "run_start") throw new Error("expected a child run");
    expect(childStart.agentLabel).toBe("Leads agent");

    const createResult = frames.find(
      (frame) => frame.type === "tool_result" && frame.name === "lead_create",
    );
    if (createResult?.type !== "tool_result") throw new Error("expected the lead_create result");
    // The create ran inside the child's own run, not the root's.
    expect(createResult.runId).toBe(childStart.runId);
    expect(createResult.runId).not.toBe(childStart.parentRunId);
    expect(createResult.isError).toBe(false);
    expect(createResult.content).toContain('"verified":true');

    const spawnResult = frames.find(
      (frame) => frame.type === "tool_result" && frame.name === "spawn_agent",
    );
    if (spawnResult?.type !== "tool_result") throw new Error("expected the spawn result");
    expect(spawnResult.content).toContain('"status":"ok"');
    expect(spawnResult.content).toContain('"verified":true');
    expect(spawnResult.content).toContain('"tool":"lead_create"');

    // Exactly one new record, named by the prompt — nothing else changed.
    const leads = getAppSimulator().db.data.leads;
    expect(leads).toHaveLength(leadsBefore + 1);
    expect(leads.at(-1)?.name).toBe("Ada Harness");
    expect(textOf(frames)).toContain("verified");
  });

  it("addresses one specialist directly with @agent", async () => {
    const response = await POST(
      chatRequest({ messages: [userTurn("@leads How many leads are open?")] }),
    );
    expect(response.status).toBe(200);

    const frames = await readAll(response);
    const children = frames.filter(
      (frame) => frame.type === "run_start" && frame.parentRunId !== undefined,
    );
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ agentLabel: "Leads agent" });

    const toolNames = frames
      .filter((frame) => frame.type === "tool_start")
      .map((frame) => (frame.type === "tool_start" ? frame.name : ""));
    expect(toolNames[0]).toBe("spawn_agent");
    expect(textOf(frames)).toContain("Leads agent");
  });

  it("rejects unknown agents and unusable /skill commands before streaming", async () => {
    const unknownAgent = await POST(
      chatRequest({ messages: [userTurn("@nobody do something")] }),
    );
    expect(unknownAgent.status).toBe(404);
    expect((await unknownAgent.json()).error).toContain('No agent named "nobody"');

    const noTask = await POST(chatRequest({ messages: [userTurn("@leads")] }));
    expect(noTask.status).toBe(400);

    const unknownSkill = await POST(
      chatRequest({ messages: [userTurn("/skill no-such-skill")] }),
    );
    expect(unknownSkill.status).toBe(404);
    expect((await unknownSkill.json()).error).toContain('No skill named "no-such-skill"');

    const noName = await POST(chatRequest({ messages: [userTurn("/skill")] }));
    expect(noName.status).toBe(400);
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
