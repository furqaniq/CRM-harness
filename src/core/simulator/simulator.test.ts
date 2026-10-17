import { describe, expect, it } from "vitest";
import type { ToolExecutor } from "../loop/types";
import { matchesDenyPattern } from "../tools/classify";
import { createSimulator } from "./index";

function callContext(name: string) {
  return {
    runId: "run_test",
    stepId: 1,
    callId: "c1",
    name,
    signal: new AbortController().signal,
  };
}

async function call(
  tools: ToolExecutor[],
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const tool = tools.find((candidate) => candidate.definition.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  const output = await tool.execute(args, callContext(name));
  return output as Record<string, unknown>;
}

async function callFails(tools: ToolExecutor[], name: string, args: Record<string, unknown> = {}): Promise<string> {
  try {
    await call(tools, name, args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`${name} was expected to fail`);
}

describe("simulator tools", () => {
  it("offers no tool whose name hits the global deny pattern", () => {
    const tools = createSimulator().tools();
    const names = tools.map((tool) => tool.definition.name);
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) {
      expect(matchesDenyPattern(name), `${name} must not match the deny pattern`).toBe(false);
    }
  });

  it("serves an automation list that really is about 270 KB", async () => {
    const tools = createSimulator().tools();
    const result = await call(tools, "automation_list");
    const payload = JSON.stringify(result);
    expect(payload.length).toBeGreaterThan(270 * 1024);
    expect(result.count).toBe(950);
  });

  it("finds several people named Ada so the model has to ask which", async () => {
    const tools = createSimulator().tools();
    const result = await call(tools, "lead_search", { query: "Ada" });
    expect(result.count).toBe(2);
  });

  it("hides unsubscribed contacts from search", async () => {
    const tools = createSimulator().tools();
    const visible = await call(tools, "customer_search", { query: "Tesla" });
    expect(visible.count).toBe(0);
    expect(visible.note).toMatch(/unsubscribed contacts never appear/i);

    const found = await call(tools, "customer_search", { query: "Curie" });
    expect(found.count).toBe(1);
  });

  it("refuses invented company-list values and suggests the real one", async () => {
    const tools = createSimulator().tools();
    const message = await callFails(tools, "lead_update_status", {
      lead_id: "L-1001",
      status: "opne",
    });
    expect(message).toContain('Did you mean "open"?');
    expect(message).toContain("Allowed: open, nurturing, closed, lost");
  });

  it("asks which San Diego when a branch name is shared", async () => {
    const tools = createSimulator().tools();
    const message = await callFails(tools, "lead_transfer", {
      lead_id: "L-1001",
      branch: "San Diego",
    });
    expect(message).toContain("2 branches match");
    expect(message).toContain("Which one?");
  });

  it("refuses a transfer to a branch with no agents and changes nothing", async () => {
    const tools = createSimulator().tools();
    const message = await callFails(tools, "lead_transfer", {
      lead_id: "L-1001",
      branch: "Reno",
    });
    expect(message).toContain("no agents");
    expect(message).toContain("Nothing was changed");
  });

  it("transfers to an unambiguous branch and reads the record back", async () => {
    const tools = createSimulator().tools();
    const result = await call(tools, "lead_transfer", {
      lead_id: "L-1001",
      branch: "Orange County",
    });
    const updated = result.updated as { branch: string };
    expect(updated.branch).toBe("Orange County");
    expect(result.note).toMatch(/read back/i);
  });

  it("queues sends to the outbox only and blocks an identical resend", async () => {
    const tools = createSimulator().tools();
    const first = await call(tools, "send_email", {
      to: "ada@example.test",
      subject: "Rate update",
      body: "Sharing this week's rates.",
    });
    const queued = first.queued as { channel: string };
    expect(queued.channel).toBe("email");
    expect(first.note).toMatch(/never sends to the outside world/i);

    const duplicate = await callFails(tools, "send_email", {
      to: "ada@example.test",
      subject: "Rate update",
      body: "Sharing this week's rates.",
    });
    expect(duplicate).toContain("Duplicate send blocked");

    const different = await call(tools, "send_email", {
      to: "ada@example.test",
      subject: "Rate update",
      body: "Different wording is a different message.",
    });
    expect(different.outbox_size).toBe(2);
  });

  it("scopes conversations by role", async () => {
    const ownerTools = createSimulator().tools({ role: "owner", userId: "u_owner" });
    const owner = await call(ownerTools, "conversation_list");
    expect(owner.count).toBe(22);
    expect(owner.scope).toContain("owner");

    const userTools = createSimulator().tools({ role: "user", userId: "u_morgan" });
    const user = await call(userTools, "conversation_list");
    expect(user.count).toBeLessThan(22);
    expect(user.count).toBeGreaterThan(0);
    expect(user.scope).toMatch(/your branch/i);

    const waiting = await call(ownerTools, "conversation_list", { waiting_only: true });
    expect(waiting.count).toBe(3);
  });

  it("will not start a draft drip by tool", async () => {
    const tools = createSimulator().tools();
    const message = await callFails(tools, "drip_start", { drip_id: "dr_nurture" });
    expect(message).toContain("draft drip cannot be started by tool");
  });

  it("enforces the create-pipeline permission gap", async () => {
    const userTools = createSimulator().tools({ role: "user", userId: "u_morgan" });
    const denied = await callFails(userTools, "pipeline_create", { name: "HELOC" });
    expect(denied).toContain("cannot create a pipeline");

    const ownerTools = createSimulator().tools({ role: "owner", userId: "u_owner" });
    const created = await call(ownerTools, "pipeline_create", {
      name: "HELOC",
      stages: ["lead", "application"],
    });
    expect((created.created as { name: string }).name).toBe("HELOC");
  });

  it("refuses tags that are not on the company list and suggests the closest", async () => {
    const tools = createSimulator().tools();
    const message = await callFails(tools, "customer_update", {
      contact_id: "C-1003",
      tags: ["warmm"],
    });
    expect(message).toContain('Did you mean "warm"?');
  });

  it("shows the shared lead/contact record on read-back", async () => {
    const tools = createSimulator().tools();
    const result = await call(tools, "lead_get", { lead_id: "L-1001" });
    const lead = result.lead as { twin_contact?: string };
    expect(lead.twin_contact).toContain("same person as a contact");
  });

  it("fails branch_list only on the 4th call while the quirk switch is on", async () => {
    const simulator = createSimulator({ quirks: { intermittentBranchList: true } });
    const tools = simulator.tools();
    await call(tools, "branch_list");
    await call(tools, "branch_list");
    await call(tools, "branch_list");
    const message = await callFails(tools, "branch_list");
    expect(message).toContain("unavailable");
    const recovered = await call(tools, "branch_list");
    expect(recovered.branches).toHaveLength(5);

    const quiet = createSimulator().tools();
    for (let i = 0; i < 8; i += 1) await call(quiet, "branch_list");
  });

  it("writes the campaign step into the wrong field when the bug switch is on", async () => {
    const simulator = createSimulator({ quirks: { campaignStepWrongField: true } });
    const tools = simulator.tools();
    const result = await call(tools, "campaign_step_update", {
      campaign_id: "cp_fall",
      step: 2,
      text: "Step two text",
    });
    const campaign = result.updated as { name: string };
    expect(campaign.name).toBe("Step two text");
    expect(result.warning).toMatch(/known step-update bug/i);
  });

  it("snapshots and restores, and reset returns to the seed", async () => {
    const simulator = createSimulator();
    const tools = simulator.tools();
    simulator.snapshot("before");
    await call(tools, "lead_create", { name: "New Person", email: "new@example.test" });
    expect(simulator.db.data.leads).toHaveLength(6);

    expect(simulator.restore("before")).toBe(true);
    expect(simulator.db.data.leads).toHaveLength(5);
    expect(simulator.restore("missing")).toBe(false);

    await call(tools, "lead_create", { name: "Another", email: "another@example.test" });
    simulator.reset();
    expect(simulator.db.data.leads).toHaveLength(5);
    expect(simulator.db.data.outbox).toHaveLength(0);
  });
});
