import { describe, expect, it } from "vitest";
import { byteLength, createArtifactStore } from "../artifacts/store";
import { MOCK_MODEL } from "../models/config";
import { createMockProvider, type MockScriptStep } from "../providers/mock";
import type { ChatProvider, Message, ModelConfig, ModelPricing, ProviderEvent } from "../providers/types";
import { collectRun, runAgent, type LoopModel } from "./run";
import type { LoopEvent, ToolApprovalRequest, ToolExecutor } from "./types";

function user(content: string): Message {
  return { role: "user", content };
}

function scriptedModel(
  id: string,
  scripts: MockScriptStep[][],
  options: { pricing?: ModelPricing; delayMs?: number } = {},
): LoopModel {
  const config: ModelConfig = {
    ...MOCK_MODEL,
    id,
    label: id,
    ...(options.pricing ? { pricing: options.pricing } : {}),
  };
  return {
    config,
    provider: createMockProvider({
      scripts,
      model: config.model,
      ...(options.delayMs !== undefined ? { delayMs: options.delayMs } : {}),
    }),
  };
}

function tool(name: string, execute: ToolExecutor["execute"]): ToolExecutor {
  return {
    definition: {
      name,
      description: `${name} test tool`,
      inputSchema: { type: "object", properties: {} },
    },
    execute,
  };
}

function typesOf(events: LoopEvent[]): string[] {
  return events.map((event) => event.type);
}

/** A provider that emits `prior` events and then fails, for fallback tests. */
function failingProvider(model: string, message: string, prior: ProviderEvent[] = []): ChatProvider {
  return {
    kind: "mock",
    model,
    async *stream(): AsyncIterable<ProviderEvent> {
      for (const event of prior) yield event;
      throw new Error(message);
    },
  };
}

function waitAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

describe("runAgent", () => {
  it("streams a plain answer to completion", async () => {
    const model = scriptedModel("mock", [
      [
        { type: "text", text: "Hello" },
        { type: "text", text: " world" },
        { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
        { type: "done", stop: "end" },
      ],
    ]);

    const { events, summary, text } = await collectRun({
      model,
      messages: [user("hi")],
      runId: "run_plain",
    });

    expect(typesOf(events)).toEqual([
      "run_start",
      "step_start",
      "text_delta",
      "text_delta",
      "usage",
      "run_end",
    ]);
    expect(text).toBe("Hello world");
    expect(summary.stop).toBe("end");
    expect(summary.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(summary.steps).toBe(1);
    expect(summary.costUsd).toBe(0);
    expect(summary.messages.at(-1)).toEqual({ role: "assistant", content: "Hello world" });
    expect((events.at(-1) as { finalText?: string }).finalText).toBe("Hello world");
  });

  it("carries the run id and parent run id on every event", async () => {
    const model = scriptedModel("mock", [[{ type: "done", stop: "end" }]]);
    const { events } = await collectRun({
      model,
      messages: [user("hi")],
      runId: "run_42",
      parentRunId: "run_7",
    });

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.runId).toBe("run_42");
      expect(event.parentRunId).toBe("run_7");
    }
  });

  it("runs a tool call and feeds the result back to the model", async () => {
    const model = scriptedModel("mock", [
      [
        {
          type: "tool_call",
          toolCall: { id: "c1", name: "search_leads", arguments: '{"query":"Ada"}' },
        },
        { type: "usage", usage: { inputTokens: 12, outputTokens: 8 } },
        { type: "done", stop: "tool_calls" },
      ],
      [
        { type: "text", text: "Found Ada Lovelace" },
        { type: "done", stop: "end" },
      ],
    ]);

    const search = tool("search_leads", (args) => ({ id: "L-1", query: args.query }));
    const { events, summary } = await collectRun({
      model,
      messages: [user("find Ada")],
      tools: [search],
    });

    const start = events.find((event) => event.type === "tool_start");
    const result = events.find((event) => event.type === "tool_result");
    expect(start).toMatchObject({
      stepId: 1,
      callId: "c1",
      name: "search_leads",
      input: { query: "Ada" },
    });
    expect(result).toMatchObject({
      stepId: 1,
      callId: "c1",
      isError: false,
      content: '{"id":"L-1","query":"Ada"}',
    });

    expect(summary.stop).toBe("end");
    expect(summary.steps).toBe(2);
    expect(summary.finalText).toBe("Found Ada Lovelace");
    expect(summary.messages).toHaveLength(4);
    expect(summary.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    const call = summary.messages[1];
    expect(call.role === "assistant" && call.toolCalls?.[0].name).toBe("search_leads");
    const resultMessage = summary.messages[2];
    expect(resultMessage.role === "tool" && resultMessage.toolCallId).toBe("c1");
  });

  it("starts every independent tool call of a step before any of them finishes", async () => {
    const order: string[] = [];
    let releaseAlpha!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseAlpha = resolve;
    });
    const alpha = tool("alpha", async () => {
      order.push("alpha:start");
      await gate;
      order.push("alpha:end");
      return "A";
    });
    const beta = tool("beta", () => {
      order.push("beta:start");
      releaseAlpha();
      return "B";
    });

    const model = scriptedModel("mock", [
      [
        { type: "tool_call", toolCall: { id: "c1", name: "alpha", arguments: "{}" } },
        { type: "tool_call", toolCall: { id: "c2", name: "beta", arguments: "{}" } },
        { type: "done", stop: "tool_calls" },
      ],
      [{ type: "text", text: "both done" }, { type: "done", stop: "end" }],
    ]);

    const { events, summary } = await collectRun({
      model,
      messages: [user("go")],
      tools: [alpha, beta],
    });

    const startIndexes = events
      .map((event, index) => ({ event, index }))
      .filter((entry) => entry.event.type === "tool_start");
    const resultIndexes = events
      .map((event, index) => ({ event, index }))
      .filter((entry) => entry.event.type === "tool_result");

    expect(startIndexes).toHaveLength(2);
    expect(resultIndexes).toHaveLength(2);
    expect(startIndexes.every((entry) => entry.event.type === "tool_start" && entry.event.stepId === 1)).toBe(true);
    expect(Math.max(...startIndexes.map((entry) => entry.index))).toBeLessThan(
      Math.min(...resultIndexes.map((entry) => entry.index)),
    );
    expect(order[0]).toBe("alpha:start");
    expect(order.indexOf("beta:start")).toBe(1);
    expect(order.indexOf("alpha:end")).toBeGreaterThan(order.indexOf("beta:start"));

    const toolMessages = summary.messages.filter((message) => message.role === "tool");
    expect(toolMessages.map((message) => message.role === "tool" && message.name)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("stops at the step limit instead of looping forever", async () => {
    const model = scriptedModel("mock", [
      [
        { type: "tool_call", toolCall: { id: "c1", name: "ping", arguments: "{}" } },
        { type: "done", stop: "tool_calls" },
      ],
    ]);
    const ping = tool("ping", () => "pong");

    const { events, summary } = await collectRun({
      model,
      messages: [user("go")],
      tools: [ping],
      limits: { maxSteps: 3 },
    });

    expect(summary.stop).toBe("limit");
    expect(summary.limit).toBe("steps");
    expect(summary.steps).toBe(3);
    expect(events.filter((event) => event.type === "tool_result")).toHaveLength(3);
    const end = events.at(-1);
    expect(end?.type).toBe("run_end");
    expect(end?.type === "run_end" && end.limit).toBe("steps");
  });

  it("stops at the time limit while the model is still streaming", async () => {
    const model = scriptedModel(
      "mock",
      [[{ type: "text", text: "too late" }, { type: "done", stop: "end" }]],
      { delayMs: 40 },
    );

    const { events, summary } = await collectRun({
      model,
      messages: [user("hi")],
      limits: { maxTimeMs: 10 },
    });

    expect(summary.stop).toBe("limit");
    expect(summary.limit).toBe("time");
    expect(events.some((event) => event.type === "text_delta")).toBe(false);
    expect(events.at(-1)?.type).toBe("run_end");
  });

  it("stops at the token budget", async () => {
    const model = scriptedModel("mock", [
      [
        { type: "text", text: "answer" },
        { type: "usage", usage: { inputTokens: 100, outputTokens: 50 } },
        { type: "done", stop: "end" },
      ],
    ]);

    const { events, summary } = await collectRun({
      model,
      messages: [user("hi")],
      limits: { maxTokens: 120 },
    });

    expect(summary.stop).toBe("limit");
    expect(summary.limit).toBe("tokens");
    expect(summary.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(events.some((event) => event.type === "usage")).toBe(true);
  });

  it("stops at the cost budget", async () => {
    const model = scriptedModel(
      "mock",
      [
        [
          { type: "text", text: "expensive" },
          { type: "usage", usage: { inputTokens: 10_000, outputTokens: 0 } },
          { type: "done", stop: "end" },
        ],
      ],
      { pricing: { inputPerMTok: 100, outputPerMTok: 100 } },
    );

    const { summary } = await collectRun({
      model,
      messages: [user("hi")],
      limits: { maxCostUsd: 0.5 },
    });

    expect(summary.stop).toBe("limit");
    expect(summary.limit).toBe("cost");
    expect(summary.costUsd).toBeCloseTo(1, 6);
  });

  it("cancels mid-stream when the signal aborts", async () => {
    let announceStreaming!: () => void;
    const streaming = new Promise<void>((resolve) => {
      announceStreaming = resolve;
    });
    const provider: ChatProvider = {
      kind: "mock",
      model: "streamer",
      async *stream(_request, signal): AsyncIterable<ProviderEvent> {
        yield { type: "text_delta", text: "partial " };
        announceStreaming();
        await waitAbort(signal);
        yield { type: "text_delta", text: "never shown" };
        yield { type: "done", stop: "end" };
      },
    };
    const controller = new AbortController();

    const run = collectRun({
      model: { config: { ...MOCK_MODEL, id: "streamer", label: "Streamer" }, provider },
      messages: [user("hi")],
      signal: controller.signal,
    });
    await streaming;
    controller.abort();
    const { events, summary } = await run;

    expect(summary.stop).toBe("cancelled");
    expect(summary.finalText).toBe("partial ");
    const end = events.at(-1);
    expect(end?.type).toBe("run_end");
    expect(end?.type === "run_end" && end.stop).toBe("cancelled");
  });

  it("cancels while a tool runs without leaving a dangling call", async () => {
    let announceStart!: () => void;
    const started = new Promise<void>((resolve) => {
      announceStart = resolve;
    });
    const hang = tool("hang", async () => {
      announceStart();
      await new Promise<void>(() => undefined);
      return "never";
    });
    const model = scriptedModel("mock", [
      [
        { type: "tool_call", toolCall: { id: "c1", name: "hang", arguments: "{}" } },
        { type: "done", stop: "tool_calls" },
      ],
    ]);
    const controller = new AbortController();

    const run = collectRun({
      model,
      messages: [user("hi")],
      tools: [hang],
      signal: controller.signal,
    });
    await started;
    controller.abort();
    const { events, summary } = await run;

    expect(summary.stop).toBe("cancelled");
    expect(events.some((event) => event.type === "tool_result")).toBe(false);
    expect(summary.messages).toHaveLength(1);
    expect(summary.messages[0].role).toBe("user");
  });

  it("reports a throwing tool as a tool error and keeps the run going", async () => {
    const model = scriptedModel("mock", [
      [
        { type: "tool_call", toolCall: { id: "c1", name: "boom", arguments: "{}" } },
        { type: "done", stop: "tool_calls" },
      ],
      [{ type: "text", text: "the tool failed" }, { type: "done", stop: "end" }],
    ]);
    const boom = tool("boom", () => {
      throw new Error("CRM is down");
    });

    const { summary } = await collectRun({ model, messages: [user("hi")], tools: [boom] });

    const result = summary.messages.find((message) => message.role === "tool");
    expect(result).toMatchObject({ content: "CRM is down", isError: true });
    expect(summary.stop).toBe("end");
    expect(summary.finalText).toBe("the tool failed");
  });

  it("rejects malformed tool arguments as a tool error", async () => {
    let called = false;
    const probe = tool("probe", () => {
      called = true;
      return "ok";
    });
    const model = scriptedModel("mock", [
      [
        { type: "tool_call", toolCall: { id: "c1", name: "probe", arguments: "{not json" } },
        { type: "done", stop: "tool_calls" },
      ],
      [{ type: "text", text: "bad args" }, { type: "done", stop: "end" }],
    ]);

    const { events, summary } = await collectRun({
      model,
      messages: [user("hi")],
      tools: [probe],
    });

    expect(called).toBe(false);
    const start = events.find((event) => event.type === "tool_start");
    expect(start?.type === "tool_start" && start.input).toBeNull();
    const result = summary.messages.find((message) => message.role === "tool");
    expect(result?.role === "tool" && result.isError).toBe(true);
    expect(result?.role === "tool" && result.content).toMatch(/Invalid tool arguments/);
  });

  it("flags an unknown tool instead of crashing", async () => {
    const model = scriptedModel("mock", [
      [
        { type: "tool_call", toolCall: { id: "c1", name: "nope", arguments: "{}" } },
        { type: "done", stop: "tool_calls" },
      ],
      [{ type: "text", text: "cannot" }, { type: "done", stop: "end" }],
    ]);

    const { summary } = await collectRun({ model, messages: [user("hi")] });

    const result = summary.messages.find((message) => message.role === "tool");
    expect(result?.role === "tool" && result.isError).toBe(true);
    expect(result?.role === "tool" && result.content).toMatch(/Unknown tool: nope/);
    expect(summary.stop).toBe("end");
  });

  it("falls back to the next model when a provider fails before any output", async () => {
    const failing: LoopModel = {
      config: { ...MOCK_MODEL, id: "primary", label: "Primary" },
      provider: failingProvider("primary", "429 rate limited"),
    };
    const backup = scriptedModel("backup", [
      [{ type: "text", text: "fallback answer" }, { type: "done", stop: "end" }],
    ]);

    const { events, summary } = await collectRun({
      model: failing,
      fallbacks: [backup],
      messages: [user("hi")],
    });

    const error = events.find((event) => event.type === "model_error");
    expect(error).toMatchObject({ willFallback: true, modelId: "primary" });
    expect(error?.type === "model_error" && error.message).toMatch(/429/);
    expect(summary.stop).toBe("end");
    expect(summary.fallbacks).toBe(1);
    expect(summary.modelId).toBe("backup");
    expect(summary.finalText).toBe("fallback answer");
  });

  it("does not fall back after partial output was streamed", async () => {
    const chatty: LoopModel = {
      config: { ...MOCK_MODEL, id: "chatty", label: "Chatty" },
      provider: failingProvider("chatty", "socket reset", [
        { type: "text_delta", text: "half an answer" },
      ]),
    };
    const backup = scriptedModel("backup", [
      [{ type: "text", text: "second try" }, { type: "done", stop: "end" }],
    ]);

    const { events, summary } = await collectRun({
      model: chatty,
      fallbacks: [backup],
      messages: [user("hi")],
    });

    const error = events.find((event) => event.type === "model_error");
    expect(error).toMatchObject({ willFallback: false });
    expect(summary.stop).toBe("error");
    expect(summary.fallbacks).toBe(0);
    expect(summary.finalText).toBe("half an answer");
  });

  it("stops with length when the provider hits its output cap", async () => {
    const model = scriptedModel("mock", [
      [{ type: "text", text: "truncated" }, { type: "done", stop: "length" }],
    ]);

    const { summary } = await collectRun({ model, messages: [user("hi")] });

    expect(summary.stop).toBe("length");
    expect(summary.messages.at(-1)).toEqual({ role: "assistant", content: "truncated" });
  });

  it("reports a protocol error when tool calls are promised but not sent", async () => {
    const model = scriptedModel("mock", [[{ type: "done", stop: "tool_calls" }]]);

    const { events, summary } = await collectRun({ model, messages: [user("hi")] });

    const error = events.find((event) => event.type === "model_error");
    expect(error?.type === "model_error" && error.willFallback).toBe(false);
    expect(summary.stop).toBe("error");
  });

  it("closes the event stream exactly once per run", async () => {
    const model = scriptedModel("mock", [[{ type: "done", stop: "end" }]]);
    const iterator = runAgent({ model, messages: [user("hi")], runId: "run_once" });

    const seen: LoopEvent[] = [];
    let next = await iterator.next();
    while (!next.done) {
      seen.push(next.value);
      next = await iterator.next();
    }

    expect(seen.filter((event) => event.type === "run_start")).toHaveLength(1);
    expect(seen.filter((event) => event.type === "run_end")).toHaveLength(1);
    expect(next.value.stop).toBe("end");
  });
});

describe("runAgent — policy enforcement", () => {
  type Case = { name: string; args?: string };

  function callThenAnswer({ name, args = "{}" }: Case): MockScriptStep[][] {
    return [
      [
        { type: "tool_call", toolCall: { id: "c1", name, arguments: args } },
        { type: "done", stop: "tool_calls" },
      ],
      [{ type: "text", text: "handled" }, { type: "done", stop: "end" }],
    ];
  }

  function resultContent(events: LoopEvent[]): { content: string; isError: boolean } {
    const result = events.find((event) => event.type === "tool_result");
    if (result?.type !== "tool_result") throw new Error("expected a tool_result event");
    return { content: result.content, isError: result.isError };
  }

  it("does not run a denied tool and gives the model the reason", async () => {
    let executed = 0;
    const send = tool("send_email", () => {
      executed += 1;
      return "queued";
    });
    const model = scriptedModel("mock", callThenAnswer({ name: "send_email" }));

    const { events, summary } = await collectRun({
      model,
      messages: [user("email Ada")],
      tools: [send],
      policy: (name) =>
        name === "send_email"
          ? {
              decision: "deny",
              rule: "deny-list",
              reason: "This tool is on the policy's deny list.",
            }
          : { decision: "auto", rule: "class-default", reason: "fine by default" },
    });

    expect(executed).toBe(0);
    const start = events.find((event) => event.type === "tool_start");
    expect(start?.type === "tool_start" && start.policy).toEqual({
      decision: "deny",
      reason: "This tool is on the policy's deny list.",
    });
    const result = resultContent(events);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Denied by policy: This tool is on the policy's deny list.");
    expect(result.content).toContain("The tool was not run.");
    expect(summary.stop).toBe("end");
    expect(summary.finalText).toBe("handled");
  });

  it("blocks an ask when no approver is connected", async () => {
    let executed = 0;
    const send = tool("send_email", () => {
      executed += 1;
      return "queued";
    });
    const model = scriptedModel("mock", callThenAnswer({ name: "send_email" }));

    const { events } = await collectRun({
      model,
      messages: [user("email Ada")],
      tools: [send],
      policy: () => ({
        decision: "ask",
        rule: "class-default",
        reason: "Live-effect actions need approval.",
      }),
    });

    expect(executed).toBe(0);
    const result = resultContent(events);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Blocked, approval needed");
    expect(result.content).toContain("No approver is connected");
  });

  it("runs an ask the approver accepts, with the request it was shown", async () => {
    let executed = 0;
    const send = tool("send_email", () => {
      executed += 1;
      return "queued";
    });
    const model = scriptedModel("mock", callThenAnswer({ name: "send_email", args: '{"to":"ada@example.test"}' }));
    const seen: ToolApprovalRequest[] = [];

    const { events } = await collectRun({
      model,
      messages: [user("email Ada")],
      tools: [send],
      runId: "run_ask",
      policy: () => ({
        decision: "ask",
        rule: "class-default",
        reason: "Live-effect actions need approval.",
      }),
      approve: (request) => {
        seen.push(request);
        return true;
      },
    });

    expect(executed).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      runId: "run_ask",
      stepId: 1,
      callId: "c1",
      name: "send_email",
      input: { to: "ada@example.test" },
      reason: "Live-effect actions need approval.",
    });
    const start = events.find((event) => event.type === "tool_start");
    expect(start?.type === "tool_start" && start.policy?.decision).toBe("ask");
    const result = resultContent(events);
    expect(result.isError).toBe(false);
    expect(result.content).toBe("queued");
  });

  it("blocks an ask the approver refuses", async () => {
    let executed = 0;
    const send = tool("send_email", () => {
      executed += 1;
      return "queued";
    });
    const model = scriptedModel("mock", callThenAnswer({ name: "send_email" }));

    const { events } = await collectRun({
      model,
      messages: [user("email Ada")],
      tools: [send],
      policy: () => ({ decision: "ask", rule: "class-default", reason: "needs a yes" }),
      approve: () => false,
    });

    expect(executed).toBe(0);
    const result = resultContent(events);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Blocked, not approved: needs a yes");
  });

  it("blocks an ask whose approval itself fails", async () => {
    let executed = 0;
    const send = tool("send_email", () => {
      executed += 1;
      return "queued";
    });
    const model = scriptedModel("mock", callThenAnswer({ name: "send_email" }));

    const { events } = await collectRun({
      model,
      messages: [user("email Ada")],
      tools: [send],
      policy: () => ({ decision: "ask", rule: "class-default", reason: "needs a yes" }),
      approve: () => {
        throw new Error("approver offline");
      },
    });

    expect(executed).toBe(0);
    const result = resultContent(events);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Approval failed: approver offline");
  });

  it("carries no policy field when policy resolves to auto", async () => {
    const search = tool("lead_search", () => ({ leads: [] }));
    const model = scriptedModel("mock", callThenAnswer({ name: "lead_search" }));

    const { events } = await collectRun({
      model,
      messages: [user("list leads")],
      tools: [search],
      policy: () => ({ decision: "auto", rule: "class-default", reason: "read tools are auto" }),
    });

    const start = events.find((event) => event.type === "tool_start");
    expect(start?.type === "tool_start" && start.policy).toBeUndefined();
    expect(resultContent(events).isError).toBe(false);
  });
});

describe("runAgent — large results (artifacts)", () => {
  function callThenAnswer(name: string, args: string): MockScriptStep[][] {
    return [
      [
        { type: "tool_call", toolCall: { id: "c1", name, arguments: args } },
        { type: "done", stop: "tool_calls" },
      ],
      [{ type: "text", text: "summarised" }, { type: "done", stop: "end" }],
    ];
  }

  it("stores a 270 KB result as an artifact and keeps only the summary in context", async () => {
    const items = Array.from({ length: 900 }, (_, i) => ({
      id: `auto_${i}`,
      name: `Automation number ${i}`,
      schedule: `every weekday at 09:00 for the whole pipeline row ${i}`.padEnd(300, "."),
    }));
    const payload = JSON.stringify(items);
    expect(byteLength(payload)).toBeGreaterThan(270 * 1024);

    const store = createArtifactStore();
    const list = tool("automation_list", () => payload);
    const model = scriptedModel("mock", callThenAnswer("automation_list", "{}"));

    const { events, summary } = await collectRun({
      model,
      messages: [user("list automations")],
      tools: [list],
      artifacts: store,
    });

    const result = events.find((event) => event.type === "tool_result");
    if (result?.type !== "tool_result") throw new Error("expected a tool_result");
    expect(result.isError).toBe(false);
    expect(result.artifact).toMatchObject({ itemCount: 900, bytes: byteLength(payload) });
    expect(result.content).toContain("Large result stored as artifact");
    expect(result.content).toContain("900 items");
    expect(result.content).toContain("read_artifact");
    expect(result.content.length).toBeLessThan(2_000);
    expect(result.content).not.toContain("Automation number 450");

    // The model's context got the summary; the payload lives in the store.
    const toolMessage = summary.messages.find((message) => message.role === "tool");
    expect(toolMessage?.role === "tool" && toolMessage.content).toBe(result.content);
    if (!result.artifact) throw new Error("expected artifact info on the tool_result");
    expect(store.get(result.artifact.id)?.content).toBe(payload);
  });

  it("adds read_artifact to the run without the caller passing it", async () => {
    const store = createArtifactStore();
    const handle = store.create({
      content: "four score and seven years ago",
      summary: "text",
      sourceTool: "something_big",
    });
    const model = scriptedModel(
      "mock",
      callThenAnswer("read_artifact", JSON.stringify({ handle: handle.id, offset: 0, limit: 10 })),
    );

    const { events } = await collectRun({
      model,
      messages: [user("read the artifact")],
      artifacts: store,
    });

    const result = events.find((event) => event.type === "tool_result");
    if (result?.type !== "tool_result") throw new Error("expected a tool_result");
    expect(result.isError).toBe(false);
    expect(result.content).toContain("four score");
    expect(result.content).toContain("nextOffset");
  });

  it("leaves results at or under the threshold alone", async () => {
    const store = createArtifactStore();
    const search = tool("lead_search", () => [{ id: "L-1", name: "Ada" }]);
    const model = scriptedModel("mock", callThenAnswer("lead_search", "{}"));

    const { events } = await collectRun({
      model,
      messages: [user("find Ada")],
      tools: [search],
      artifacts: store,
    });

    const result = events.find((event) => event.type === "tool_result");
    if (result?.type !== "tool_result") throw new Error("expected a tool_result");
    expect(result.artifact).toBeUndefined();
    expect(result.content).toBe('[{"id":"L-1","name":"Ada"}]');
    expect(store.count()).toBe(0);
  });
});
