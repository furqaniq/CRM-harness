import type { LoopEvent } from "../loop/types";
import type { LabCheck, RunEvidence } from "./types";

export interface CheckOutcome {
  failures: string[];
  evidence: string[];
}

interface ToolStart {
  name: string;
  stepId: number;
  runId: string;
}

function toolStarts(events: LoopEvent[]): ToolStart[] {
  const starts: ToolStart[] = [];
  for (const event of events) {
    if (event.type === "tool_start") {
      starts.push({ name: event.name, stepId: event.stepId, runId: event.runId });
    }
  }
  return starts;
}

/** First sentence of the answer — the finding the spec wants on line one. */
export function firstSentence(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  const sentence = line.split(/[.!?]/)[0] ?? "";
  return sentence.trim();
}

const HEDGE = /^(?:sure|okay|ok|certainly|of course|let me|i (?:will|can|have|'ll)|great|absolutely)\b/i;

const ID_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:run|msg)_[a-z0-9]+(?:_[a-z0-9]+)*\b/gi, label: "run or message id" },
  { pattern: /\b[A-Z]{1,4}-\d{3,}\b/g, label: "record id" },
  {
    // Raw snake_case names (tools and fields). Artifact handles are excluded:
    // the chat deliberately shows art_… so the next turn can page the slice.
    pattern: /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g,
    label: "raw internal name",
  },
];

const QUESTION_PATTERNS = [
  /\?\s*$/,
  /\b(?:should i|shall i|do you want|would you like|can i go ahead|ready to (?:proceed|confirm))\b/i,
];

/** Run one row's checks against its trace and answer; layer 1 grading. */
export function runChecks(checks: LabCheck[], evidence: RunEvidence): CheckOutcome {
  const failures: string[] = [];
  const passed: string[] = [];
  const starts = toolStarts(evidence.events);

  for (const check of checks) {
    const failure = checkOne(check, evidence, starts);
    if (failure === null) passed.push(evidenceFor(check, evidence, starts));
    else failures.push(failure);
  }
  return { failures, evidence: passed };
}

function checkOne(
  check: LabCheck,
  evidence: RunEvidence,
  starts: ToolStart[],
): string | null {
  switch (check.kind) {
    case "tool_called": {
      const start = starts.find((candidate) => candidate.name === check.tool);
      return start === undefined ? `${check.tool} was not called` : null;
    }
    case "tool_not_called": {
      return starts.some((candidate) => candidate.name === check.tool)
        ? `${check.tool} was called but must not be`
        : null;
    }
    case "text_contains": {
      return evidence.text.includes(check.text)
        ? null
        : `answer does not contain "${check.text}"`;
    }
    case "parallel_share_step": {
      const missing = check.tools.filter(
        (tool) => !starts.some((candidate) => candidate.name === tool),
      );
      if (missing.length > 0) return `missing tool call(s): ${missing.join(", ")}`;
      const stepIds = new Set(
        starts
          .filter((candidate) => check.tools.includes(candidate.name))
          .map((candidate) => candidate.stepId),
      );
      return stepIds.size === 1
        ? null
        : `expected one shared step, got steps ${[...stepIds].sort((a, b) => a - b).join(", ")}`;
    }
    case "steps_sequential": {
      const missing = check.tools.filter(
        (tool) => !starts.some((candidate) => candidate.name === tool),
      );
      if (missing.length > 0) return `missing tool call(s): ${missing.join(", ")}`;
      const relevant = starts.filter((candidate) => check.tools.includes(candidate.name));
      const byStep = new Map<number, Set<string>>();
      for (const start of relevant) {
        const names = byStep.get(start.stepId) ?? new Set<string>();
        names.add(start.name);
        byStep.set(start.stepId, names);
      }
      for (const [stepId, names] of byStep) {
        if (names.size > 1) {
          return `dependent tools shared step ${stepId} (${[...names].join(", ")})`;
        }
      }
      return byStep.size >= 2 ? null : `expected at least two steps, saw one`;
    }
    case "read_back_present": {
      const verified = evidence.events.some(
        (event) =>
          event.type === "tool_result" && event.content.includes('"verified":true'),
      );
      return verified ? null : "no write result carries a verified read-back";
    }
    case "children_started": {
      const childStarts = evidence.events.filter(
        (event) => event.type === "run_start" && event.parentRunId !== undefined,
      );
      return childStarts.length >= check.count
        ? null
        : `expected ${check.count} subagent run(s), saw ${childStarts.length}`;
    }
    case "first_line_finding": {
      const first = firstSentence(evidence.text);
      if (first === "") return "answer opens with an empty line";
      if (first.length > 200) return `opening line is too long (${first.length} chars)`;
      if (HEDGE.test(first)) return `answer opens with a hedge: "${first.slice(0, 60)}"`;
      return null;
    }
    case "no_internal_ids": {
      for (const { pattern, label } of ID_PATTERNS) {
        const found = [...evidence.text.matchAll(pattern)].map((match) => {
          const token = match[0];
          // art_… handles are the one deliberate id-shaped string (M2 paging).
          if (token.toLowerCase().startsWith("art_")) return null;
          return token;
        }).filter((token): token is string => token !== null);
        if (found.length > 0) return `${label} in the answer: "${found[0]}"`;
      }
      return null;
    }
    case "no_confirmation_question": {
      return QUESTION_PATTERNS.some((pattern) => pattern.test(evidence.text.trim()))
        ? "answer asks the user to confirm a clear write"
        : null;
    }
    case "max_chars": {
      return evidence.text.length <= check.limit
        ? null
        : `answer is ${evidence.text.length} characters (limit ${check.limit})`;
    }
  }
}

function evidenceFor(check: LabCheck, evidence: RunEvidence, starts: ToolStart[]): string {
  switch (check.kind) {
    case "tool_called": {
      const start = starts.find((candidate) => candidate.name === check.tool);
      return `${check.tool} called in step ${start?.stepId ?? "?"}`;
    }
    case "tool_not_called":
      return `${check.tool} not called`;
    case "text_contains":
      return `answer contains "${check.text}"`;
    case "parallel_share_step": {
      const stepIds = new Set(
        starts
          .filter((candidate) => check.tools.includes(candidate.name))
          .map((candidate) => candidate.stepId),
      );
      return `${check.tools.join(" + ")} share step ${[...stepIds][0]}`;
    }
    case "steps_sequential": {
      const stepIds = [
        ...new Set(
          starts
            .filter((candidate) => check.tools.includes(candidate.name))
            .map((candidate) => candidate.stepId),
        ),
      ].sort((a, b) => a - b);
      return `${check.tools.join(" then ")} in steps ${stepIds.join(", ")}`;
    }
    case "read_back_present":
      return "write result carries verified: true";
    case "children_started":
      return `${check.count} subagent run(s) started`;
    case "first_line_finding":
      return `opens with "${firstSentence(evidence.text).slice(0, 60)}"`;
    case "no_internal_ids":
      return "no internal ids or raw tool names in the answer";
    case "no_confirmation_question":
      return "no confirmation question";
    case "max_chars":
      return `${evidence.text.length} chars ≤ ${check.limit}`;
  }
}
