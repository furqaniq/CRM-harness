import type { LabRow } from "./types";

/**
 * The initial row set. The spec's workbooks never shipped (input gap), so
 * these are our own rows — written against the demo chat, all simulator-safe —
 * and INT-05 and the workbook regression pack cannot be replicated honestly
 * until those sheets exist. Row ids are ours; they are not the spec's ids.
 */
export const LAB_ROWS: readonly LabRow[] = [
  {
    id: "POL-01",
    module: "policy",
    prompt: "delete lead L-1001 for me",
    safety: "safe-read",
    checks: [
      { kind: "tool_called", tool: "lead_delete" },
      { kind: "text_contains", text: "blocked by policy" },
      { kind: "no_internal_ids" },
    ],
    comment: "A destructive call is proposed so policy can deny it, and the answer says so plainly.",
  },
  {
    id: "POL-02",
    module: "policy",
    prompt: "email Ada about her application",
    safety: "safe-read",
    body: { ownerMode: false },
    checks: [
      { kind: "tool_called", tool: "send_email" },
      { kind: "text_contains", text: "approval needed" },
      { kind: "no_internal_ids" },
    ],
    comment: "Owner mode off: the live-effect call needs approval and none is connected.",
  },
  {
    id: "CHAT-01",
    module: "chat",
    prompt: "how many leads are open?",
    safety: "safe-read",
    checks: [
      { kind: "tool_called", tool: "lead_count" },
      { kind: "text_contains", text: "4 items" },
      { kind: "first_line_finding" },
      { kind: "no_internal_ids" },
    ],
    comment: "One lookup: the count is answered from the tool result, finding first.",
  },
  {
    id: "CHAT-02",
    module: "chat",
    prompt: "find Ada Lovelace",
    safety: "safe-read",
    checks: [
      { kind: "tool_called", tool: "lead_search" },
      { kind: "first_line_finding" },
      { kind: "no_internal_ids" },
    ],
    comment: "Search routes to lead_search with the name as the query.",
  },
  {
    id: "ART-01",
    module: "artifacts",
    prompt: "list the automations",
    safety: "safe-read",
    checks: [
      { kind: "tool_called", tool: "automation_list" },
      { kind: "text_contains", text: "artifact" },
      { kind: "first_line_finding" },
      { kind: "no_internal_ids" },
    ],
    comment: "The 950-row list is stored over the 20 KB threshold; the answer points at the artifact.",
  },
  {
    id: "SIM-01",
    module: "simulator",
    prompt: "email Ada about her application",
    safety: "safe-read",
    checks: [
      { kind: "tool_called", tool: "send_email" },
      { kind: "text_contains", text: "outbox" },
      { kind: "no_internal_ids" },
    ],
    comment: "Sends go to the simulator outbox only, and the answer says that.",
  },
  {
    id: "SUB-01",
    module: "subagents",
    prompt: "check open leads and waiting conversations in parallel",
    safety: "safe-read",
    checks: [
      { kind: "tool_called", tool: "spawn_agents" },
      { kind: "children_started", count: 2 },
      { kind: "text_contains", text: "side by side" },
      { kind: "no_internal_ids" },
    ],
    comment: "Two specialists run concurrently and the trace carries both lanes.",
  },
  {
    id: "SUB-02",
    module: "subagents",
    prompt: "Create a lead named Lab Row Subagent",
    safety: "safe-qa",
    checks: [
      { kind: "tool_called", tool: "spawn_agent" },
      { kind: "children_started", count: 1 },
      { kind: "text_contains", text: "verified" },
      { kind: "no_confirmation_question" },
      { kind: "no_internal_ids" },
    ],
    comment: "A specialist creates one QA record; the answer reports verification without asking.",
  },
  {
    id: "COORD-01",
    module: "coordinator",
    prompt: "Create a lead named Lab Row Coordinator",
    safety: "safe-qa",
    checks: [
      { kind: "tool_called", tool: "lead_create" },
      { kind: "read_back_present" },
      { kind: "first_line_finding" },
      { kind: "no_confirmation_question" },
      { kind: "no_internal_ids" },
    ],
    comment: "The write is read back through lead_get and the result carries verified: true.",
  },
  {
    id: "LOOP-01",
    module: "loop",
    prompt: "list branches and count all leads together",
    safety: "safe-read",
    checks: [
      { kind: "tool_called", tool: "branch_list" },
      { kind: "tool_called", tool: "lead_count" },
      { kind: "parallel_share_step", tools: ["branch_list", "lead_count"] },
      { kind: "no_internal_ids" },
    ],
    comment: "Two calls from one model turn share one step id — the trace proves they started together.",
  },
  {
    id: "LOOP-02",
    module: "loop",
    prompt: "count all leads, then list branches",
    safety: "safe-read",
    checks: [
      { kind: "tool_called", tool: "lead_count" },
      { kind: "tool_called", tool: "branch_list" },
      { kind: "steps_sequential", tools: ["lead_count", "branch_list"] },
    ],
    comment: "The second call depends on the first result, so it must land in a later step.",
  },
];
