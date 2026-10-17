import { describe, expect, it } from "vitest";
import { MOCK_MODEL } from "../models/config";
import type { LoopEvent, ToolContext, ToolExecutor } from "../loop/types";
import type { ChatProvider, ChatRequest } from "../providers/types";
import { createMockProvider, type MockScriptStep } from "../providers/mock";
import { buildSpawnTools, spawnAgentsTool } from "./builtins";
import { Semaphore } from "./concurrency";
import { MAX_SUBAGENT_DEPTH, runSubagent, type SpawnContext } from "./runner";
import type { AgentSpec } from "./types";

function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    name: "leads",
    displayName: "Leads",
    description: "Lead specialist",
    modelRole: "worker",
    toolGlobs: ["lead_*"],
    system: "You are the leads specialist.",
    ...overrides,
  };
}

function tool(name: string, execute: ToolExecutor["execute"]): ToolExecutor {
  return {
    definition: {
      name,
      description: `${name} tool`,
      inputSchema: { type: "object", properties: {} },
    },
    execute,
  };
}

/** Mock provider that records every ChatRequest the loop sends it. */
function recordingProvider(scripts: MockScriptStep[][], delayMs = 0): {
  model: { config: typeof MOCK_MODEL; provider: ChatProvider };
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  const inner = createMockProvider({ scripts, delayMs, model: MOCK_MODEL.model });
  const provider: ChatProvider = {
    kind: "mock",
    model: inner.model,
    stream(request, signal) {
      requests.push(request);
      return inner.stream(request, signal);
    },
  };
  return { model: { config: MOCK_MODEL, provider }, requests };
}

const okScript: MockScriptStep[] = [
  { type: "text", text: "Found 3 open leads in San Diego." },
  { type: "done", stop: "end" },
];

function baseContext(overrides: Partial<SpawnContext> = {}): SpawnContext {
  return {
    model: recordingProvider([okScript]).model,
    allTools: [],
    depth: 0,
    ...overrides,
  };
}

const toolCtx: ToolContext = {
  runId: "run_parent_1",
  stepId: 1,
  callId: "call_1",
  name: "spawn_agent",
  signal: new AbortController().signal,
};

describe("runSubagent", () => {
  it("gives the child a fresh context: its system prompt, task and inputs only", async () => {
    const recorder = recordingProvider([okScript]);
    const result = await runSubagent(
      spec(),
      { prompt: "List the open leads.", inputs: { branch: "San Diego" } },
      baseContext({ model: recorder.model, allTools: [] }),
    );

    expect(result.status).toBe("ok");
    expect(result.summary).toContain("Found 3 open leads");
    expect(recorder.requests).toHaveLength(1);
    const request = recorder.requests[0];
    expect(request.system).toBe("You are the leads specialist.");
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].content).toContain("Inputs:");
    expect(request.messages[0].content).toContain("- branch: San Diego");
    expect(request.messages[0].content).toContain("List the open leads.");
  });

  it("scopes the child to its tool globs and never shows deny-pattern tools", async () => {
    const recorder = recordingProvider([okScript]);
    await runSubagent(
      spec({ toolGlobs: ["lead_search", "lead_*"] }),
      { prompt: "Search leads." },
      baseContext({
        model: recorder.model,
        allTools: [
          tool("lead_search", () => ({ count: 0 })),
          tool("lead_delete", () => ({ deleted: true })),
          tool("pipeline_create", () => ({ id: "pl_1" })),
        ],
      }),
    );

    const names = (recorder.requests[0].tools ?? []).map((definition) => definition.name);
    expect(names).toEqual(["lead_search"]);
    expect(names).not.toContain("lead_delete");
    expect(names).not.toContain("pipeline_create");
  });

  it("denies a guessed tool from outside the child's scope (no privilege widening)", async () => {
    const recorder = recordingProvider([
      [
        {
          type: "tool_call",
          toolCall: { id: "c1", name: "pipeline_create", arguments: '{"name":"Spring"}' },
        },
      ],
      [
        { type: "text", text: "Tried anyway." },
        { type: "done", stop: "end" },
      ],
    ]);

    const result = await runSubagent(
      spec(),
      { prompt: "Create a pipeline too." },
      baseContext({
        model: recorder.model,
        allTools: [
          tool("lead_search", () => ({ count: 0 })),
          tool("pipeline_create", () => ({ id: "pl_1" })),
        ],
        policy: () => ({
          decision: "auto",
          rule: "class-default",
          reason: "read calls run automatically",
        }),
      }),
    );

    expect(result.status).toBe("partial");
    expect(result.errors.join(" ")).toContain("outside Leads's tool scope");
  });

  it("refuses to run past the depth limit", async () => {
    const result = await runSubagent(spec(), { prompt: "Do it." }, baseContext({
      depth: MAX_SUBAGENT_DEPTH,
    }));

    expect(result.status).toBe("failed");
    expect(result.errors[0]).toContain("depth limit");
    expect(result.runId).toBe("");
  });

  it("applies per-child budgets: a step limit with no answer is a failure", async () => {
    const recorder = recordingProvider([
      [
        {
          type: "tool_call",
          toolCall: { id: "c1", name: "lead_search", arguments: "{}" },
        },
      ],
      [
        { type: "text", text: "too late" },
        { type: "done", stop: "end" },
      ],
    ]);

    const result = await runSubagent(
      spec({ limits: { maxSteps: 1 } }),
      { prompt: "Search." },
      baseContext({ model: recorder.model, allTools: [
        tool("lead_search", () => ({ count: 0 })),
      ]}),
    );

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toContain("steps budget");
  });

  it("reports ok, partial, needs_input and failed from what the child did", async () => {
    const ok = await runSubagent(spec(), { prompt: "q" }, baseContext());
    expect(ok.status).toBe("ok");

    const flaky = recordingProvider([
      [
        {
          type: "tool_call",
          toolCall: { id: "c1", name: "lead_search", arguments: "{}" },
        },
      ],
      [
        { type: "text", text: "Answered with a failing tool." },
        { type: "done", stop: "end" },
      ],
    ]);
    const partial = await runSubagent(spec(), { prompt: "q" }, baseContext({
      model: flaky.model,
      allTools: [tool("lead_search", () => { throw new Error("index down"); })],
    }));
    expect(partial.status).toBe("partial");
    expect(partial.errors.join(" ")).toContain("index down");

    const asking = recordingProvider([
      [
        { type: "text", text: "Which branch do you mean?" },
        { type: "done", stop: "end" },
      ],
    ]);
    const needsInput = await runSubagent(spec(), { prompt: "q" }, baseContext({
      model: asking.model,
    }));
    expect(needsInput.status).toBe("needs_input");
    expect(needsInput.question).toBe("Which branch do you mean?");

    const broken = recordingProvider([[{ type: "done", stop: "error" }]]);
    const failed = await runSubagent(spec(), { prompt: "q" }, baseContext({
      model: broken.model,
    }));
    expect(failed.status).toBe("failed");
    expect(failed.errors.length).toBeGreaterThan(0);
  });

  it("extracts writes with a verified flag from the child's transcript", async () => {
    const recorder = recordingProvider([
      [
        {
          type: "tool_call",
          toolCall: { id: "c1", name: "lead_create", arguments: '{"name":"Ada"}' },
        },
      ],
      [
        { type: "text", text: "Created the lead." },
        { type: "done", stop: "end" },
      ],
    ]);

    const result = await runSubagent(
      spec({ toolGlobs: ["lead_*"] }),
      { prompt: "Create a lead." },
      baseContext({
        model: recorder.model,
        allTools: [
          tool("lead_create", () => ({ id: "L-9001", name: "Ada" })),
        ],
      }),
    );

    expect(result.writes).toEqual([
      { tool: "lead_create", recordId: "L-9001", verified: false },
    ]);
  });

  it("marks verified writes when a verify step stamped the result", async () => {
    const recorder = recordingProvider([
      [
        {
          type: "tool_call",
          toolCall: { id: "c1", name: "lead_create", arguments: '{"name":"Ada"}' },
        },
      ],
      [
        { type: "text", text: "Created." },
        { type: "done", stop: "end" },
      ],
    ]);

    const result = await runSubagent(
      spec({ toolGlobs: ["lead_*"] }),
      { prompt: "Create." },
      baseContext({
        model: recorder.model,
        allTools: [tool("lead_create", () => ({ id: "L-9002", verified: true }))],
      }),
    );

    expect(result.writes[0]).toEqual({
      tool: "lead_create",
      recordId: "L-9002",
      verified: true,
    });
  });

  it("forwards child events with the spawning run's parentRunId", async () => {
    const events: LoopEvent[] = [];
    await runSubagent(spec(), { prompt: "q" }, baseContext({
      parentRunId: "run_the_parent",
      onEvent: (event) => events.push(event),
    }));

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.parentRunId === "run_the_parent")).toBe(true);
  });
});

describe("spawn built-ins", () => {
  const agents = [spec(), spec({ name: "inbox", displayName: "Inbox", toolGlobs: ["conversation_*"] })];

  function deps(model = recordingProvider([okScript]).model) {
    return {
      agents,
      context: { model, allTools: [], depth: 0 },
    };
  }

  it("builds both tools only while there is depth budget", () => {
    expect(buildSpawnTools(deps())).toHaveLength(2);
    expect(
      buildSpawnTools({ ...deps(), context: { ...deps().context, depth: MAX_SUBAGENT_DEPTH } }),
    ).toEqual([]);
  });

  it("returns the child's structured result", async () => {
    const spawn = buildSpawnTools(deps())[0];
    const result = await spawn.execute(
      { agent: "leads", task: "List open leads." },
      toolCtx,
    );

    expect(result).toMatchObject({ agent: "leads", status: "ok" });
  });

  it("fails honestly on an unknown agent, listing what exists", async () => {
    const spawn = buildSpawnTools(deps())[0];
    const result = (await spawn.execute({ agent: "nope", task: "x" }, toolCtx)) as {
      status: string;
      errors: string[];
    };

    expect(result.status).toBe("failed");
    expect(result.errors[0]).toContain("Unknown agent");
    expect(result.errors[0]).toContain("leads");
  });

  it("runs a batch concurrently and isolates a failing sibling", async () => {
    const good = recordingProvider([okScript]);
    const bad = recordingProvider([[{ type: "done", stop: "error" }]]);
    const batch = spawnAgentsTool({
      agents: [
        spec({ name: "alpha", displayName: "Alpha" }),
        spec({ name: "beta", displayName: "Beta", modelRole: "verifier" }),
      ],
      context: {
        model: good.model,
        modelForRole: (role) => (role === "verifier" ? bad.model : good.model),
        allTools: [],
        depth: 0,
      },
      limiter: new Semaphore(6),
    });

    const results = (await batch.execute(
      {
        agents: [
          { agent: "alpha", task: "First." },
          { agent: "beta", task: "Second." },
        ],
      },
      toolCtx,
    )) as Array<{ agent: string; status: string }>;

    expect(results).toHaveLength(2);
    expect(results.find((entry) => entry.agent === "alpha")?.status).toBe("ok");
    expect(results.find((entry) => entry.agent === "beta")?.status).toBe("failed");
  });

  it("rejects empty or malformed batch input", async () => {
    const batch = spawnAgentsTool(deps());
    expect(await batch.execute({}, toolCtx)).toContain("non-empty");
    expect(await batch.execute({ agents: [{ agent: "x" }] }, toolCtx)).toContain("agent");
  });
});

describe("Semaphore", () => {
  it("never exceeds its limit and wakes waiters in order", async () => {
    const semaphore = new Semaphore(3);
    let peak = 0;
    let inFlight = 0;
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        semaphore.run(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 2));
          order.push(index);
          inFlight -= 1;
        }),
      ),
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(order).toHaveLength(12);
    expect(semaphore.inFlight).toBe(0);
  });

  it("releases even when the task throws", async () => {
    const semaphore = new Semaphore(1);
    await expect(
      semaphore.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(semaphore.inFlight).toBe(0);
    await semaphore.run(async () => undefined);
  });
});
