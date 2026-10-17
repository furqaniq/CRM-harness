import { describe, expect, it } from "vitest";
import { MOCK_MODEL } from "../models/config";
import { createMockProvider, type MockScriptStep } from "../providers/mock";
import { spawnAgentsTool, type SpawnToolDeps } from "../agents/builtins";
import type { ToolContext } from "../loop/types";
import type { SpawnResult } from "../agents/types";
import { planWaves, validatePlan } from "./graph";
import { runPlan } from "./runner";
import type { PlanTask, PlanTaskResult } from "./types";

function task(id: string, dependsOn?: string[]): PlanTask {
  return {
    id,
    agent: "worker",
    task: `task ${id}`,
    ...(dependsOn ? { dependsOn } : {}),
  };
}

function outcome(id: string, status: SpawnResult["status"] = "ok", wave = 0): PlanTaskResult {
  return {
    id,
    agent: "worker",
    wave,
    skipped: false,
    status,
    summary: `${id} done`,
    writes: [],
    errors: [],
    runId: `run_${id}`,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

describe("validatePlan", () => {
  it("accepts a healthy graph", () => {
    expect(validatePlan([task("a"), task("b", ["a"])]).map((id) => id)).toEqual([]);
  });

  it("reports empty plans, duplicates, unknown and self dependencies", () => {
    expect(validatePlan([])).toEqual(["The plan has no tasks."]);
    const errors = validatePlan([
      task("a"),
      task("a"),
      task("b", ["ghost"]),
      task("c", ["c"]),
    ]);
    expect(errors.join(" ")).toContain('Duplicate task id "a"');
    expect(errors.join(" ")).toContain('unknown task "ghost"');
    expect(errors.join(" ")).toContain("depends on itself");
  });

  it("finds dependency cycles", () => {
    const errors = validatePlan([task("a", ["b"]), task("b", ["c"]), task("c", ["a"])]);
    expect(errors.join(" ")).toContain("dependency cycle");
  });
});

describe("planWaves", () => {
  it("puts independent tasks in one wave and chains into ordered waves", () => {
    const chain = planWaves([task("a"), task("b", ["a"]), task("c", ["b"])]);
    expect(chain.map((wave) => wave.map((t) => t.id))).toEqual([["a"], ["b"], ["c"]]);

    const fanout = planWaves([
      task("a"),
      task("b", ["a"]),
      task("c", ["a"]),
      task("d", ["b", "c"]),
    ]);
    expect(fanout.map((wave) => wave.map((t) => t.id))).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("keeps unrelated tasks together in input order", () => {
    const waves = planWaves([task("x"), task("y"), task("z")]);
    expect(waves).toHaveLength(1);
    expect(waves[0].map((t) => t.id)).toEqual(["x", "y", "z"]);
  });
});

describe("runPlan", () => {
  it("fans a wave out concurrently and records each wave index", async () => {
    let active = 0;
    let peak = 0;
    const results = await runPlan({
      tasks: [task("a"), task("b"), task("c", ["b"])],
      spawn: async (node) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { ...outcome(node.id), summary: node.id };
      },
    });

    expect(peak).toBeGreaterThanOrEqual(2);
    expect(results.waves).toEqual([["a", "b"], ["c"]]);
    const byId = new Map(results.results.map((result) => [result.id, result]));
    expect(byId.get("a")?.wave).toBe(0);
    expect(byId.get("b")?.wave).toBe(0);
    expect(byId.get("c")?.wave).toBe(1);
    expect(byId.get("c")?.status).toBe("ok");
  });

  it("skips dependants of a failed dependency but runs its siblings", async () => {
    const ran: string[] = [];
    const results = await runPlan({
      tasks: [
        task("root"),
        task("bad", ["root"]),
        task("good", ["root"]),
        task("after_bad", ["bad"]),
        task("after_good", ["good"]),
      ],
      spawn: async (node) => {
        ran.push(node.id);
        if (node.id === "bad") {
          return { ...outcome("bad"), status: "failed", errors: ["agent crashed"] };
        }
        return outcome(node.id);
      },
    });

    const byId = new Map(results.results.map((result) => [result.id, result]));
    expect(byId.get("good")?.status).toBe("ok");
    expect(byId.get("after_good")?.status).toBe("ok");
    expect(byId.get("after_bad")?.status).toBe("failed");
    expect(byId.get("after_bad")?.skipped).toBe(true);
    expect(byId.get("after_bad")?.errors[0]).toContain('ended failed');
    expect(ran).not.toContain("after_bad");
  });

  it("does not run dependants when a dependency needs input", async () => {
    const results = await runPlan({
      tasks: [task("ask"), task("next", ["ask"])],
      spawn: async (node) =>
        node.id === "ask"
          ? { ...outcome("ask"), status: "needs_input", question: "Which branch?" }
          : outcome(node.id),
    });

    const byId = new Map(results.results.map((result) => [result.id, result]));
    expect(byId.get("next")?.skipped).toBe(true);
    expect(byId.get("next")?.errors[0]).toContain("ended needs_input");
  });

  it("turns an unexpected throw into a failed task, not a crashed plan", async () => {
    const results = await runPlan({
      tasks: [task("boom"), task("fine")],
      spawn: async (node) => {
        if (node.id === "boom") throw new Error("kaboom");
        return outcome(node.id);
      },
    });

    const byId = new Map(results.results.map((result) => [result.id, result]));
    expect(byId.get("boom")?.status).toBe("failed");
    expect(byId.get("boom")?.errors[0]).toContain("kaboom");
    expect(byId.get("fine")?.status).toBe("ok");
  });

  it("refuses to run an invalid plan", async () => {
    await expect(
      runPlan({ tasks: [task("a", ["a"])], spawn: async (node) => outcome(node.id) }),
    ).rejects.toThrow("depends on itself");
  });
});

describe("spawn_agents with depends_on (planner path)", () => {
  const toolCtx: ToolContext = {
    runId: "run_parent",
    stepId: 1,
    callId: "c1",
    name: "spawn_agents",
    signal: new AbortController().signal,
  };

  function deps(scripts: MockScriptStep[][]): SpawnToolDeps {
    return {
      agents: [
        {
          name: "worker",
          displayName: "Worker",
          description: "does things",
          modelRole: "worker",
          toolGlobs: [],
          system: "sys",
        },
      ],
      context: {
        model: { config: MOCK_MODEL, provider: createMockProvider({ scripts }) },
        allTools: [],
        depth: 0,
      },
    };
  }

  it("runs independent entries concurrently and ordered entries as waves", async () => {
    const tool = spawnAgentsTool(deps([
      [{ type: "text", text: "first done" }, { type: "done", stop: "end" }],
      [{ type: "text", text: "second done" }, { type: "done", stop: "end" }],
    ]));

    const results = (await tool.execute(
      {
        agents: [
          { id: "lookup", agent: "worker", task: "Find the branch." },
          {
            id: "announce",
            agent: "worker",
            task: "Write the announcement.",
            depends_on: ["lookup"],
          },
        ],
      },
      toolCtx,
    )) as PlanTaskResult[];

    expect(results.map((result) => result.id)).toEqual(["lookup", "announce"]);
    expect(results.every((result) => result.status === "ok")).toBe(true);
    expect(results[1].wave).toBe(1);
    expect(results[0].wave).toBe(0);
  });

  it("skips the dependent when its dependency fails, without calling the agent", async () => {
    let calls = 0;
    const provider = createMockProvider({
      scripts: [[{ type: "done", stop: "error" }]],
    });
    const tool = spawnAgentsTool({
      agents: [
        {
          name: "worker",
          displayName: "Worker",
          description: "d",
          modelRole: "worker",
          toolGlobs: [],
          system: "sys",
        },
      ],
      context: {
        model: {
          config: MOCK_MODEL,
          provider: {
            kind: "mock",
            model: "mock-model",
            stream(request, signal) {
              calls += 1;
              return provider.stream(request, signal);
            },
          },
        },
        allTools: [],
        depth: 0,
      },
    });

    const results = (await tool.execute(
      {
        agents: [
          { id: "one", agent: "worker", task: "Fail please." },
          { id: "two", agent: "worker", task: "Depends on one.", depends_on: ["one"] },
        ],
      },
      toolCtx,
    )) as PlanTaskResult[];

    expect(calls).toBe(1);
    expect(results[0].status).toBe("failed");
    expect(results[1]).toMatchObject({ status: "failed", skipped: true });
    expect(results[1].errors[0]).toContain("Skipped");
  });

  it("surfaces a broken graph as an honest tool error", async () => {
    const tool = spawnAgentsTool(deps([]));
    await expect(
      tool.execute(
        {
          agents: [
            { id: "a", agent: "worker", task: "x", depends_on: ["ghost"] },
          ],
        },
        toolCtx,
      ),
    ).rejects.toThrow("unknown task");
  });
});
