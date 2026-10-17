import { describe, expect, it, beforeEach } from "vitest";
import type { LoopEvent } from "@/core/loop/types";
import { bodyToChunks, parseTransportFrame, readSse, type TransportFrame } from "@/core/events/sse";
import { getAppSimulator } from "@/core/simulator";
import { POST } from "@/app/api/chat/route";
import { firstSentence, runChecks } from "./checks";
import { LAB_ROWS } from "./rows";
import { runLab } from "./runner";
import type { LabRow, RunEvidence } from "./types";

const RUN = "run_lab";

function toolStart(name: string, stepId: number, callId = `c${stepId}${name}`): LoopEvent {
  return {
    runId: RUN,
    type: "tool_start",
    stepId,
    callId,
    name,
    input: null,
    rawArguments: "{}",
  };
}

function toolResult(name: string, stepId: number, content: string, callId = `c${stepId}${name}`): LoopEvent {
  return {
    runId: RUN,
    type: "tool_result",
    stepId,
    callId,
    name,
    content,
    isError: false,
    durationMs: 5,
  };
}

function childStart(runId: string, agentLabel: string): LoopEvent {
  return {
    runId,
    parentRunId: RUN,
    type: "run_start",
    modelId: "demo-model",
    model: "demo-model",
    role: "Demo model (scripted)",
    agentLabel,
    startedAt: 0,
    systemChars: 10,
    messageCount: 1,
  };
}

function evidence(events: LoopEvent[], text: string): RunEvidence {
  return { events, text };
}

describe("deterministic lab checks", () => {
  it("recognises tool calls and refusals", () => {
    const events = [toolStart("lead_count", 1), toolResult("lead_count", 1, '{"count":4}')];
    expect(runChecks([{ kind: "tool_called", tool: "lead_count" }], evidence(events, "4 items")).failures).toEqual([]);
    expect(runChecks([{ kind: "tool_called", tool: "lead_search" }], evidence(events, "x")).failures).toEqual([
      "lead_search was not called",
    ]);
    expect(
      runChecks([{ kind: "tool_not_called", tool: "lead_delete" }], evidence(events, "x")).failures,
    ).toEqual([]);
    expect(
      runChecks([{ kind: "tool_not_called", tool: "lead_count" }], evidence(events, "x")).failures,
    ).toEqual(["lead_count was called but must not be"]);
  });

  it("proves parallel calls share one step and dependent ones do not", () => {
    const parallel = evidence(
      [toolStart("branch_list", 2), toolStart("lead_count", 2, "c2b")],
      "done",
    );
    expect(
      runChecks(
        [{ kind: "parallel_share_step", tools: ["branch_list", "lead_count"] }],
        parallel,
      ).failures,
    ).toEqual([]);

    const split = evidence([toolStart("branch_list", 1), toolStart("lead_count", 2)], "done");
    expect(
      runChecks([{ kind: "parallel_share_step", tools: ["branch_list", "lead_count"] }], split)
        .failures,
    ).toEqual(["expected one shared step, got steps 1, 2"]);

    expect(
      runChecks([{ kind: "steps_sequential", tools: ["branch_list", "lead_count"] }], split)
        .failures,
    ).toEqual([]);
    expect(
      runChecks([{ kind: "steps_sequential", tools: ["branch_list", "lead_count"] }], parallel)
        .failures,
    ).toEqual(["dependent tools shared step 2 (branch_list, lead_count)"]);
  });

  it("checks for the coordinator's read-back stamp", () => {
    const verified = evidence(
      [toolResult("lead_create", 1, '{"created":{"id":"L-9"},"verified":true}')],
      "saved",
    );
    expect(runChecks([{ kind: "read_back_present" }], verified).failures).toEqual([]);
    expect(
      runChecks([{ kind: "read_back_present" }], evidence([toolResult("lead_create", 1, "{}")], "x"))
        .failures,
    ).toEqual(["no write result carries a verified read-back"]);
  });

  it("counts subagent runs by parentRunId", () => {
    const events = [childStart("run_c1", "Leads agent"), childStart("run_c2", "Inbox agent")];
    expect(runChecks([{ kind: "children_started", count: 2 }], evidence(events, "x")).failures).toEqual([]);
    expect(runChecks([{ kind: "children_started", count: 3 }], evidence(events, "x")).failures).toEqual([
      "expected 3 subagent run(s), saw 2",
    ]);
  });

  it("wants the finding first, not a hedge", () => {
    expect(firstSentence("There are 4 open leads across all branches. Details follow")).toBe(
      "There are 4 open leads across all branches",
    );
    expect(
      runChecks(
        [{ kind: "first_line_finding" }],
        evidence([], "There are 4 open leads."),
      ).failures,
    ).toEqual([]);
    expect(
      runChecks([{ kind: "first_line_finding" }], evidence([], "Sure — let me look.")).failures,
    ).toEqual(['answer opens with a hedge: "Sure — let me look"']);
    expect(runChecks([{ kind: "first_line_finding" }], evidence([], "   ")).failures).toEqual([
      "answer opens with an empty line",
    ]);
  });

  it("flags internal ids and raw tool names but not artifact handles", () => {
    expect(
      runChecks([{ kind: "no_internal_ids" }], evidence([], "4 open leads.")).failures,
    ).toEqual([]);
    expect(
      runChecks([{ kind: "no_internal_ids" }], evidence([], "L-1001 is open.")).failures,
    ).toEqual(['record id in the answer: "L-1001"']);
    expect(
      runChecks([{ kind: "no_internal_ids" }], evidence([], "Called lead_count now.")).failures,
    ).toEqual(['raw internal name in the answer: "lead_count"']);
    expect(
      runChecks([{ kind: "no_internal_ids" }], evidence([], "Slice from art_abc123_9.")).failures,
    ).toEqual([]);
  });

  it("rejects confirmation questions on clear writes and enforces limits", () => {
    expect(
      runChecks([{ kind: "no_confirmation_question" }], evidence([], "Saved and verified."))
        .failures,
    ).toEqual([]);
    expect(
      runChecks([{ kind: "no_confirmation_question" }], evidence([], "Created. Should I do more?"))
        .failures,
    ).toEqual(["answer asks the user to confirm a clear write"]);
    expect(runChecks([{ kind: "max_chars", limit: 10 }], evidence([], "0123456789")).failures).toEqual([]);
    expect(runChecks([{ kind: "max_chars", limit: 10 }], evidence([], "01234567890")).failures).toEqual([
      "answer is 11 characters (limit 10)",
    ]);
  });

  it("surfaces text that must appear", () => {
    expect(
      runChecks([{ kind: "text_contains", text: "artifact" }], evidence([], "stored as an artifact"))
        .failures,
    ).toEqual([]);
    expect(
      runChecks([{ kind: "text_contains", text: "outbox" }], evidence([], "queued")).failures,
    ).toEqual(['answer does not contain "outbox"']);
  });
});

describe("lab runner", () => {
  it("grades rows, aggregates pass rates per module and skips live rows", async () => {
    const rows: LabRow[] = [
      {
        id: "T-01",
        module: "demo",
        prompt: "ok",
        safety: "safe-read",
        checks: [{ kind: "text_contains", text: "fine" }],
        comment: "",
      },
      {
        id: "T-02",
        module: "demo",
        prompt: "bad",
        safety: "safe-read",
        checks: [{ kind: "text_contains", text: "missing" }],
        comment: "",
      },
      {
        id: "T-03",
        module: "live",
        prompt: "external",
        safety: "live",
        checks: [{ kind: "text_contains", text: "anything" }],
        comment: "",
      },
    ];
    const report = await runLab(rows, async (row) =>
      evidence([], row.prompt === "ok" ? "all fine" : "not great"),
    );

    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.passRate).toBe(0.5);
    expect(report.skipped).toBe(1);
    expect(report.results[2]).toMatchObject({ status: "skipped" });
    expect(report.modules).toContainEqual({
      module: "demo",
      total: 2,
      passed: 1,
      passRate: 0.5,
    });
    expect(report.runId.startsWith("lab_")).toBe(true);
  });

  it("marks a row failed when the executor throws", async () => {
    const report = await runLab(
      [
        {
          id: "T-04",
          module: "demo",
          prompt: "boom",
          safety: "safe-read",
          checks: [{ kind: "text_contains", text: "x" }],
          comment: "",
        },
      ],
      async () => {
        throw new Error("stream died");
      },
    );
    expect(report.results[0].status).toBe("failed");
    expect(report.results[0].failures[0]).toContain("stream died");
  });
});

async function executeRow(row: LabRow): Promise<RunEvidence> {
  getAppSimulator().reset();
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: row.prompt }],
        ...(row.body ?? {}),
      }),
    }),
  );
  if (!response.ok || !response.body) throw new Error(`chat responded ${response.status}`);

  const frames: TransportFrame[] = [];
  for await (const frame of readSse(bodyToChunks(response.body))) {
    const parsed = parseTransportFrame(frame.data);
    if (parsed) frames.push(parsed);
  }
  const events = frames.filter(
    (frame): frame is LoopEvent => frame.type !== "stream_end" && frame.type !== "stream_error",
  );
  const text = frames
    .filter((frame) => frame.type === "text_delta")
    .map((frame) => (frame.type === "text_delta" ? frame.text : ""))
    .join("");
  return { events, text };
}

describe("safe row set against the chat route", () => {
  beforeEach(() => {
    getAppSimulator().reset();
  });

  it(
    "runs every row and reports a pass rate per module",
    async () => {
      const report = await runLab(LAB_ROWS, executeRow);

      const failed = report.results.filter((result) => result.status === "failed");
      expect(
        failed.map((result) => ({ id: result.row.id, failures: result.failures })),
        "every safe row should pass against the demo chat",
      ).toEqual([]);

      expect(report.total).toBe(LAB_ROWS.length);
      expect(report.passed).toBe(LAB_ROWS.length);
      expect(report.skipped).toBe(0);
      expect(report.passRate).toBe(1);

      const modules = report.modules.map((entry) => entry.module).sort();
      expect(modules).toEqual([
        "artifacts",
        "chat",
        "coordinator",
        "loop",
        "policy",
        "simulator",
        "subagents",
      ]);
      for (const entry of report.modules) {
        expect(entry.passRate, `${entry.module} pass rate`).toBe(1);
      }

      // The reported pass rates (also the numbers recorded in the spine).
      const table = report.modules
        .map((entry) => `${entry.module} ${entry.passed}/${entry.total}`)
        .join(", ");
      console.log(
        `Lab ${report.runId}: ${report.passed}/${report.total} passed (${table})`,
      );
    },
    120_000,
  );
});
