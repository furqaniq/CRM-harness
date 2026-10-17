import { describe, expect, it } from "vitest";
import type { LoopEvent } from "@/core/loop/types";
import {
  chatReducer,
  formatSeconds,
  humanToolLabel,
  initialChatState,
  runHeadline,
  runMeta,
  type ChatState,
} from "./chatState";

const RUN = "run_t";

function runStart(): LoopEvent {
  return {
    runId: RUN,
    type: "run_start",
    modelId: "demo-model",
    model: "demo-model",
    role: "Demo model (scripted)",
    startedAt: 1_000,
    systemChars: 120,
    messageCount: 1,
  };
}

function stepStart(stepId: number): LoopEvent {
  return { runId: RUN, type: "step_start", stepId, modelId: "demo-model", model: "demo-model" };
}

function textDelta(text: string): LoopEvent {
  return { runId: RUN, type: "text_delta", stepId: 1, text };
}

function usage(inputTokens: number, outputTokens: number): LoopEvent {
  return { runId: RUN, type: "usage", stepId: 1, inputTokens, outputTokens };
}

function runEnd(
  over: Partial<Extract<LoopEvent, { type: "run_end" }>> = {},
): LoopEvent {
  return {
    runId: RUN,
    type: "run_end",
    stop: "end",
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    steps: 1,
    durationMs: 950,
    fallbacks: 0,
    finalText: "",
    ...over,
  };
}

function startRun(prompt: string): ChatState {
  let state = chatReducer(initialChatState(), { type: "send", content: prompt });
  state = chatReducer(state, { type: "event", event: runStart() });
  state = chatReducer(state, { type: "event", event: stepStart(1) });
  return state;
}

describe("chat reducer", () => {
  it("streams a reply and commits it with its trace on run_end", () => {
    let state = startRun("open leads?");
    state = chatReducer(state, { type: "event", event: textDelta("There are 12 ") });
    state = chatReducer(state, { type: "event", event: textDelta("open leads.") });
    state = chatReducer(state, { type: "event", event: usage(10, 5) });
    state = chatReducer(state, {
      type: "event",
      event: runEnd({ costUsd: 0.002, usage: { inputTokens: 10, outputTokens: 5 } }),
    });

    expect(state.status).toBe("idle");
    expect(state.pending).toBeNull();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      content: "There are 12 open leads.",
    });
    expect(state.messages[1].trace).toMatchObject({
      runId: RUN,
      stop: "end",
      steps: 1,
      durationMs: 950,
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: 0.002,
    });
    expect(state.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(state.costUsd).toBe(0.002);
    expect(state.runs).toBe(1);
    expect(state.notice).toBeNull();
  });

  it("reports a stop in plain language", () => {
    let state = startRun("slow down");
    state = chatReducer(state, { type: "event", event: textDelta("partial") });
    state = chatReducer(state, { type: "request_stop" });
    expect(state.status).toBe("stopping");

    state = chatReducer(state, { type: "event", event: runEnd({ stop: "cancelled" }) });

    expect(state.status).toBe("idle");
    expect(state.messages[1].note).toBe("Stopped by you.");
    expect(state.messages[1].content).toBe("partial");
    expect(state.messages[1].trace?.stop).toBe("cancelled");
  });

  it("names each limit in words the user can act on", () => {
    const cases: [Extract<LoopEvent, { type: "run_end" }>["limit"], string][] = [
      ["steps", "Stopped at the step limit."],
      ["time", "Stopped at the time limit."],
      ["tokens", "Stopped at the token budget."],
      ["cost", "Stopped at the spend cap."],
    ];

    for (const [limit, note] of cases) {
      let state = startRun("push it");
      state = chatReducer(state, { type: "event", event: textDelta("so far") });
      state = chatReducer(state, { type: "event", event: runEnd({ stop: "limit", limit }) });
      expect(state.messages[1].note).toBe(note);
      expect(state.messages[1].trace?.limit).toBe(limit);
    }
  });

  it("finalises a run whose stream dies without run_end", () => {
    let dropped = startRun("hello");
    dropped = chatReducer(dropped, { type: "event", event: textDelta("partial") });
    dropped = chatReducer(dropped, { type: "stream_closed" });
    expect(dropped.status).toBe("idle");
    expect(dropped.messages[1]).toMatchObject({
      content: "partial",
      note: "The connection dropped before the run finished.",
    });
    expect(dropped.runs).toBe(1);

    let stopped = startRun("hello");
    stopped = chatReducer(stopped, { type: "event", event: textDelta("halfway") });
    stopped = chatReducer(stopped, { type: "request_stop" });
    stopped = chatReducer(stopped, { type: "stream_closed" });
    expect(stopped.messages[1].note).toBe("Stopped by you.");
    expect(stopped.messages[1].content).toBe("halfway");
  });

  it("keeps a failed connection free of stack traces", () => {
    let state = chatReducer(initialChatState(), { type: "send", content: "hi" });
    state = chatReducer(state, { type: "stream_error" });

    expect(state.status).toBe("idle");
    expect(state.notice).toBe("The run stopped before it finished. Try again.");
    expect(state.messages).toHaveLength(1);
    expect(state.runs).toBe(0);
  });

  it("ignores a second send while a run is active", () => {
    const state = startRun("first");
    const second = chatReducer(state, { type: "send", content: "second" });

    expect(second.messages).toHaveLength(1);
    expect(second.status).toBe("streaming");
  });

  it("shows human tool labels and keeps raw names behind Advanced", () => {
    let state = startRun("find Ada");
    state = chatReducer(state, { type: "event", event: textDelta("Looking that up.") });
    state = chatReducer(state, {
      type: "event",
      event: {
        runId: RUN,
        type: "tool_start",
        stepId: 1,
        callId: "c1",
        name: "search_leads",
        input: { query: "Ada" },
        rawArguments: '{"query":"Ada"}',
      },
    });
    state = chatReducer(state, {
      type: "event",
      event: {
        runId: RUN,
        type: "tool_result",
        stepId: 1,
        callId: "c1",
        name: "search_leads",
        content: "[]",
        isError: false,
        durationMs: 320,
      },
    });
    state = chatReducer(state, { type: "event", event: runEnd() });

    const trace = state.messages[1].trace;
    expect(trace?.entries[0]).toMatchObject({
      label: "Search leads",
      status: "done",
      durationMs: 320,
    });
    expect(trace?.raw.some((line) => line.includes("search_leads"))).toBe(true);
    expect(trace?.raw.some((line) => line.includes('"query":"Ada"'))).toBe(true);
    expect(trace?.entries[0].label).not.toContain("search_leads");
  });

  it("surfaces a model error in the raw trace only", () => {
    let state = startRun("hello");
    state = chatReducer(state, {
      type: "event",
      event: {
        runId: RUN,
        type: "model_error",
        stepId: 1,
        modelId: "demo-model",
        message: "429 rate limited",
        willFallback: true,
      },
    });

    expect(state.pending?.trace.raw).toContain("429 rate limited");
    expect(state.pending?.trace.raw).toContain("falling back to the next model");
    expect(state.notice).toBeNull();
  });

  it("clears the notice on the next send", () => {
    let state = chatReducer(initialChatState(), { type: "send", content: "hi" });
    state = chatReducer(state, { type: "stream_error" });
    expect(state.notice).not.toBeNull();

    state = chatReducer(state, { type: "send", content: "again" });
    expect(state.notice).toBeNull();
  });
});

describe("subagent lanes", () => {
  const CHILD = "run_child_1";

  function childStart(over: Partial<Extract<LoopEvent, { type: "run_start" }>> = {}): LoopEvent {
    return {
      runId: CHILD,
      parentRunId: RUN,
      type: "run_start",
      modelId: "demo-model",
      model: "demo-model",
      role: "Demo model (scripted)",
      agentLabel: "Leads agent",
      startedAt: 1_100,
      systemChars: 90,
      messageCount: 1,
      ...over,
    };
  }

  function childToolStart(callId: string, name: string): LoopEvent {
    return {
      runId: CHILD,
      parentRunId: RUN,
      type: "tool_start",
      stepId: 1,
      callId,
      name,
      input: {},
      rawArguments: "{}",
    };
  }

  function childToolEnd(callId: string, name: string, content: string): LoopEvent {
    return {
      runId: CHILD,
      parentRunId: RUN,
      type: "tool_result",
      stepId: 1,
      callId,
      name,
      content,
      isError: false,
      durationMs: 40,
    };
  }

  function childEnd(over: Partial<Extract<LoopEvent, { type: "run_end" }>> = {}): LoopEvent {
    return {
      runId: CHILD,
      parentRunId: RUN,
      type: "run_end",
      stop: "end",
      usage: { inputTokens: 60, outputTokens: 20 },
      costUsd: 0,
      steps: 1,
      durationMs: 320,
      fallbacks: 0,
      finalText: "4 open leads.",
      ...over,
    };
  }

  it("builds lanes from child events without touching the parent reply", () => {
    let state = startRun("check both");
    state = chatReducer(state, { type: "event", event: childStart() });
    state = chatReducer(state, {
      type: "event",
      event: childStart({ runId: "run_child_2", agentLabel: "Inbox agent" }),
    });
    state = chatReducer(state, { type: "event", event: childToolStart("c1", "lead_count") });
    state = chatReducer(state, {
      type: "event",
      event: { ...childStart(), type: "usage", stepId: 1, inputTokens: 60, outputTokens: 20 },
    });
    state = chatReducer(state, { type: "event", event: childToolEnd("c1", "lead_count", '{"count":4}') });
    state = chatReducer(state, { type: "event", event: childEnd() });

    const trace = state.pending?.trace;
    expect(trace?.lanes).toHaveLength(2);
    expect(trace?.lanes[0]).toMatchObject({
      runId: CHILD,
      label: "Leads agent",
      status: "done",
      durationMs: 320,
      stop: "end",
      content: "4 open leads.",
    });
    expect(trace?.lanes[0].entries[0]).toMatchObject({
      label: "Lead count",
      status: "done",
      durationMs: 40,
    });
    expect(trace?.lanes[1]).toMatchObject({ label: "Inbox agent", status: "running" });
    // The child's run_end must not close the parent's run or reply.
    expect(state.pending).not.toBeNull();
    expect(state.messages).toHaveLength(1);
    expect(state.pending?.content).toBe("");
    // Child usage still counts toward the session totals.
    expect(state.usage).toEqual({ inputTokens: 60, outputTokens: 20 });
  });

  it("keeps lanes on the committed trace after the parent answers", () => {
    let state = startRun("check both");
    state = chatReducer(state, { type: "event", event: childStart() });
    state = chatReducer(state, { type: "event", event: childEnd() });
    state = chatReducer(state, { type: "event", event: textDelta("Both done.") });
    state = chatReducer(state, { type: "event", event: runEnd() });

    const trace = state.messages[1].trace;
    expect(trace?.lanes).toHaveLength(1);
    expect(trace?.lanes[0]).toMatchObject({ label: "Leads agent", status: "done" });
    expect(state.messages[1].content).toBe("Both done.");
  });

  it("labels a lane that did not send a display name", () => {
    let state = startRun("check");
    state = chatReducer(state, {
      type: "event",
      event: childStart({ agentLabel: undefined }),
    });
    expect(state.pending?.trace.lanes[0].label).toBe("Specialist");
  });

  it("ignores child events that belong to another run", () => {
    let state = startRun("check both");
    const before = state.pending;
    state = chatReducer(state, {
      type: "event",
      event: { ...childStart(), parentRunId: "run_other" },
    });
    state = chatReducer(state, {
      type: "event",
      event: { ...childEnd(), parentRunId: "run_other" },
    });
    expect(state.pending).toEqual(before);
  });
});

describe("trace formatting", () => {
  it("humanises tool names for display", () => {
    expect(humanToolLabel("search_leads")).toBe("Search leads");
    expect(humanToolLabel("get-campaign")).toBe("Get campaign");
    expect(humanToolLabel("")).toBe("Tool");
  });

  it("turns milliseconds into a short duration", () => {
    expect(formatSeconds(0)).toBe("0.0s");
    expect(formatSeconds(1234)).toBe("1.2s");
  });

  it("writes the headline the way the spec trace does", () => {
    const base = {
      runId: RUN,
      modelId: "demo-model",
      model: "demo-model",
      steps: 1,
      startedAt: 0,
      entries: [],
      lanes: [],
      raw: [],
    };

    expect(runHeadline({ ...base, stop: "end", durationMs: 300 })).toBe("Answered in 0.3s");
    expect(runHeadline({ ...base, stop: "cancelled", durationMs: 400 })).toBe("Stopped in 0.4s");
    expect(runHeadline({ ...base, stop: "limit", limit: "cost" })).toBe(
      "Stopped at the cost limit",
    );
    expect(runHeadline({ ...base })).toBe("Working");
  });

  it("summarises tokens, cost and steps", () => {
    const meta = runMeta({
      runId: RUN,
      modelId: "demo-model",
      model: "demo-model",
      steps: 2,
      startedAt: 0,
      stop: "end",
      usage: { inputTokens: 1200, outputTokens: 40 },
      costUsd: 0.004,
      entries: [],
      lanes: [],
      raw: [],
    });

    expect(meta).toEqual(["1,240 tokens", "$0.0040", "2 steps"]);
  });
});
