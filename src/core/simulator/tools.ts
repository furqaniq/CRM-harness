import type { ToolExecutor } from "../loop/types";
import type { JsonSchema } from "../providers/types";
import type { SimulatorDb } from "./db";
import type { Lead, Role, User } from "./types";
import { assertInList } from "./validate";

/**
 * The CRM simulator's tools (spec §6): the spec §5 families, backed by seeded
 * data and the real CRM's constraints — company lists refuse invented values,
 * unsubscribed contacts vanish from search, no delete tool exists anywhere,
 * two branches are named San Diego, a branch with no agent refuses transfers,
 * sends only reach an outbox, a duplicate send is blocked, and the automation
 * list really is about 270 KB.
 *
 * The tool *names* are the spec's, so policy classes them by inference:
 * lead_search → read, lead_create → write, send_email → live-effect.
 */

export interface SimulatorToolOptions {
  /** Whose session this is: a normal user only sees their own branch's inbox. */
  role: Role;
  userId: string;
}

const OBJECT: JsonSchema = { type: "object", properties: {} };

function props(spec: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties: spec, ...(required.length > 0 ? { required } : {}) };
}

const STRING: JsonSchema = { type: "string" };
const BOOLEAN: JsonSchema = { type: "boolean" };

function argString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value.trim() : "";
}

function argBool(args: Record<string, unknown>, name: string): boolean {
  return args[name] === true;
}

function fail(message: string): never {
  throw new Error(message);
}

function ok(payload: Record<string, unknown>): Record<string, unknown> {
  return payload;
}

export function buildSimulatorTools(db: SimulatorDb, options: SimulatorToolOptions): ToolExecutor[] {
  const currentUser: User =
    db.data.users.find((user) => user.id === options.userId) ?? db.data.users[0];

  const tools: ToolExecutor[] = [
    // ── admin ────────────────────────────────────────────────────────────
    {
      definition: {
        name: "get_company",
        description: "Company profile: legal name, NMLS id, timezone and the company's value lists.",
        inputSchema: OBJECT,
      },
      execute: () =>
        ok({
          company: db.data.company,
          lists: {
            statuses: db.data.statuses,
            sources: db.data.sources,
            loan_types: db.data.loanTypes,
            stages: db.data.stages,
            tags: db.data.tags,
          },
        }),
    },
    {
      definition: {
        name: "list_users",
        description: "Users of this CRM with role and branch. Users cannot be created or re-roled by tool.",
        inputSchema: OBJECT,
      },
      execute: () => ok({ users: db.data.users }),
    },
    {
      definition: {
        name: "branch_list",
        description: "Branches with city and agent count.",
        inputSchema: OBJECT,
      },
      execute: () => {
        if (db.nextBranchListFails()) {
          fail("The branch list is unavailable right now (the CRM's known flaky endpoint). Nothing was changed — try again.");
        }
        return ok({ branches: db.data.branches, note: "Several branches may share a name; use the branch id when you need one." });
      },
    },

    // ── leads ────────────────────────────────────────────────────────────
    {
      definition: {
        name: "lead_search",
        description: "Search leads by free text (name, email, phone), status or source.",
        inputSchema: props({ query: STRING, status: STRING, source: STRING }),
      },
      execute: (args) => {
        const query = argString(args, "query").toLowerCase();
        const status = argString(args, "status");
        const source = argString(args, "source");
        if (status !== "") assertInList("status", status, db.data.statuses);
        if (source !== "") assertInList("source", source, db.data.sources);
        const matches = db.data.leads.filter((lead) => {
          if (status !== "" && lead.status !== status) return false;
          if (source !== "" && lead.source !== source) return false;
          if (query === "") return true;
          return (
            lead.name.toLowerCase().includes(query) ||
            lead.email.toLowerCase().includes(query) ||
            lead.phone.includes(query)
          );
        });
        return ok({
          count: matches.length,
          leads: matches,
          ...(matches.length === 0 ? { note: "No lead matches that search." } : {}),
        });
      },
    },
    {
      definition: {
        name: "lead_get",
        description: "Fetch one lead by id, with branch and owner names.",
        inputSchema: props({ lead_id: STRING }, ["lead_id"]),
      },
      execute: (args) => {
        const lead = db.data.leads.find((candidate) => candidate.id === argString(args, "lead_id"));
        if (!lead) fail("No lead with that id.");
        return ok({ lead: withNames(db, lead) });
      },
    },
    {
      definition: {
        name: "lead_count",
        description: "Count leads, optionally filtered by status.",
        inputSchema: props({ status: STRING }),
      },
      execute: (args) => {
        const status = argString(args, "status");
        if (status !== "") assertInList("status", status, db.data.statuses);
        const leads = status === "" ? db.data.leads : db.data.leads.filter((lead) => lead.status === status);
        return ok({ status: status === "" ? "all" : status, count: leads.length });
      },
    },
    {
      definition: {
        name: "lead_create",
        description: "Create a lead. Status, source, loan type and stage must come from the company lists.",
        inputSchema: props(
          { name: STRING, email: STRING, phone: STRING, status: STRING, source: STRING, loan_type: STRING, branch_id: STRING },
          ["name"],
        ),
      },
      execute: (args) => {
        const name = argString(args, "name");
        if (name === "") fail("A lead needs a name.");
        const status = argString(args, "status") || "open";
        const source = argString(args, "source") || "website";
        const loanType = argString(args, "loan_type") || "purchase";
        assertInList("status", status, db.data.statuses);
        assertInList("source", source, db.data.sources);
        assertInList("loan type", loanType, db.data.loanTypes);
        const branchId = argString(args, "branch_id") || currentUser.branchId;
        const branch = db.data.branches.find((candidate) => candidate.id === branchId);
        if (!branch) fail(`No branch with id ${branchId}. Use branch_list for the real branches.`);
        const lead: Lead = {
          id: db.nextId("L"),
          name,
          email: argString(args, "email"),
          phone: argString(args, "phone"),
          status,
          source,
          stage: "lead",
          loanType,
          branchId,
          ownerId: currentUser.id,
          tags: [],
          createdAt: new Date().toISOString(),
        };
        db.data.leads.push(lead);
        return ok({ created: withNames(db, lead), note: "Read back after the write — this is the stored record." });
      },
    },
    {
      definition: {
        name: "lead_update_status",
        description: "Move a lead to another status (company list).",
        inputSchema: props({ lead_id: STRING, status: STRING }, ["lead_id", "status"]),
      },
      execute: (args) => {
        const lead = findLead(db, argString(args, "lead_id"));
        const status = argString(args, "status");
        assertInList("status", status, db.data.statuses);
        lead.status = status;
        return ok({ updated: withNames(db, lead) });
      },
    },
    {
      definition: {
        name: "lead_transfer",
        description: "Transfer a lead to a branch. A branch with no agent refuses the transfer; a shared branch name asks which one.",
        inputSchema: props({ lead_id: STRING, branch: STRING }, ["lead_id", "branch"]),
      },
      execute: (args) => {
        const lead = findLead(db, argString(args, "lead_id"));
        const branchQuery = argString(args, "branch").toLowerCase();
        if (branchQuery === "") fail("Name the branch to transfer to.");
        const matches = db.data.branches.filter(
          (branch) => branch.name.toLowerCase().includes(branchQuery) || branch.id === branchQuery,
        );
        if (matches.length === 0) fail(`No branch matches "${argString(args, "branch")}".`);
        if (matches.length > 1) {
          fail(
            `${matches.length} branches match "${argString(args, "branch")}": ` +
              matches.map((branch) => `${branch.name} (${branch.id}, ${branch.agentCount} agents)`).join("; ") +
              ". Which one?",
          );
        }
        const branch = matches[0];
        if (branch.agentCount === 0) {
          fail(
            `${branch.name} has no agents, so a transfer there would strand the lead. Nothing was changed.`,
          );
        }
        lead.branchId = branch.id;
        return ok({ updated: withNames(db, lead), note: "Read back after the write." });
      },
    },
    {
      definition: {
        name: "lead_history",
        description: "Timeline of known events for one lead.",
        inputSchema: props({ lead_id: STRING }, ["lead_id"]),
      },
      execute: (args) => {
        const lead = findLead(db, argString(args, "lead_id"));
        return ok({
          lead_id: lead.id,
          events: [
            { at: lead.createdAt, what: `Lead created from ${lead.source}` },
            { at: lead.createdAt, what: `Entered stage ${lead.stage}` },
            ...(lead.status === "closed" ? [{ at: "2026-10-05T12:00:00Z", what: "Marked closed" }] : []),
          ],
        });
      },
    },

    // ── contacts ─────────────────────────────────────────────────────────
    {
      definition: {
        name: "customer_search",
        description: "Search subscribed contacts by name, email or phone. Unsubscribed contacts do not appear.",
        inputSchema: props({ query: STRING }, ["query"]),
      },
      execute: (args) => {
        const query = argString(args, "query").toLowerCase();
        const matches = db.data.contacts.filter(
          (contact) =>
            contact.subscribed &&
            (contact.name.toLowerCase().includes(query) ||
              contact.email.toLowerCase().includes(query) ||
              contact.phone.includes(query)),
        );
        return ok({
          count: matches.length,
          contacts: matches,
          ...(matches.length === 0
            ? { note: "No subscribed contact matches. Unsubscribed contacts never appear in search." }
            : {}),
        });
      },
    },
    {
      definition: {
        name: "customer_get",
        description: "Fetch one contact by id.",
        inputSchema: props({ contact_id: STRING }, ["contact_id"]),
      },
      execute: (args) => {
        const contact = db.data.contacts.find((candidate) => candidate.id === argString(args, "contact_id"));
        if (!contact) fail("No contact with that id.");
        return ok({ contact });
      },
    },
    {
      definition: {
        name: "customer_create",
        description: "Create a subscribed contact.",
        inputSchema: props({ name: STRING, email: STRING, phone: STRING }, ["name"]),
      },
      execute: (args) => {
        const name = argString(args, "name");
        if (name === "") fail("A contact needs a name.");
        const contact = {
          id: db.nextId("C"),
          name,
          email: argString(args, "email"),
          phone: argString(args, "phone"),
          subscribed: true,
          tags: [] as string[],
        };
        db.data.contacts.push(contact);
        return ok({ created: contact });
      },
    },
    {
      definition: {
        name: "customer_update",
        description: "Update a contact. Tags must already exist on the company tag list; there is no tag-create tool.",
        inputSchema: props({ contact_id: STRING, name: STRING, email: STRING, tags: { type: "array", items: STRING } }, ["contact_id"]),
      },
      execute: (args) => {
        const contact = db.data.contacts.find((candidate) => candidate.id === argString(args, "contact_id"));
        if (!contact) fail("No contact with that id.");
        const name = argString(args, "name");
        if (name !== "") contact.name = name;
        const email = argString(args, "email");
        if (email !== "") contact.email = email;
        const tags = args.tags;
        if (Array.isArray(tags)) {
          for (const tag of tags) {
            if (typeof tag !== "string") fail("Tags are strings.");
            assertInList("tag", tag, db.data.tags);
          }
          contact.tags = tags as string[];
        }
        return ok({ updated: contact, note: "Read back after the write." });
      },
    },

    // ── outreach ─────────────────────────────────────────────────────────
    {
      definition: {
        name: "pipeline_list",
        description: "Pipelines with their stages.",
        inputSchema: OBJECT,
      },
      execute: () => ok({ pipelines: db.data.pipelines }),
    },
    {
      definition: {
        name: "pipeline_create",
        description: "Create a pipeline. Owners only — a normal user gets a permission error.",
        inputSchema: props({ name: STRING, stages: { type: "array", items: STRING } }, ["name"]),
      },
      execute: (args) => {
        if (currentUser.role !== "owner") {
          fail(`${currentUser.name} cannot create a pipeline — that is an owner permission in this CRM.`);
        }
        const stages = Array.isArray(args.stages) ? (args.stages as string[]) : ["lead"];
        const pipeline = { id: db.nextId("pl"), name: argString(args, "name"), stages };
        db.data.pipelines.push(pipeline);
        return ok({ created: pipeline });
      },
    },
    {
      definition: {
        name: "campaign_list",
        description: "Campaigns with status, channel and enrollment count.",
        inputSchema: OBJECT,
      },
      execute: () => ok({ campaigns: db.data.campaigns }),
    },
    {
      definition: {
        name: "campaign_create",
        description: "Create a campaign as a draft, off, with nobody enrolled.",
        inputSchema: props({ name: STRING, channel: STRING }, ["name"]),
      },
      execute: (args) => {
        const raw = argString(args, "channel") || "email";
        if (raw !== "email" && raw !== "sms") fail('Channel must be "email" or "sms".');
        const channel: "email" | "sms" = raw === "email" ? "email" : "sms";
        const campaign = {
          id: db.nextId("cp"),
          name: argString(args, "name"),
          status: "draft" as const,
          channel,
          enrolled: 0,
        };
        db.data.campaigns.push(campaign);
        return ok({ created: campaign, note: "Created as a draft with nobody enrolled." });
      },
    },
    {
      definition: {
        name: "campaign_step_update",
        description: "Update the text of one campaign step.",
        inputSchema: props({ campaign_id: STRING, step: { type: "number" }, text: STRING }, ["campaign_id", "step", "text"]),
      },
      execute: (args) => {
        const campaign = db.data.campaigns.find((candidate) => candidate.id === argString(args, "campaign_id"));
        if (!campaign) fail("No campaign with that id.");
        const text = argString(args, "text");
        if (db.quirks.campaignStepWrongField) {
          // The real CRM's bug, on a switch: the step text lands in the name.
          campaign.name = text;
          return ok({
            updated: campaign,
            warning: "Read-back shows the campaign name changed, not a step — this CRM has a known step-update bug. Nothing else was touched.",
          });
        }
        return ok({ updated: campaign, note: `Step ${args.step} saved.` });
      },
    },
    {
      definition: {
        name: "drip_list",
        description: "Drips with status and step count.",
        inputSchema: OBJECT,
      },
      execute: () => ok({ drips: db.data.drips }),
    },
    {
      definition: {
        name: "drip_create",
        description: "Create a drip as a draft with no enrollees.",
        inputSchema: props({ name: STRING, steps: { type: "number" } }, ["name"]),
      },
      execute: (args) => {
        const drip = {
          id: db.nextId("dr"),
          name: argString(args, "name"),
          status: "draft" as const,
          steps: typeof args.steps === "number" ? args.steps : 1,
        };
        db.data.drips.push(drip);
        return ok({ created: drip, note: "Created as a draft. A draft drip cannot be started by tool." });
      },
    },
    {
      definition: {
        name: "drip_start",
        description: "Start a paused drip. Draft drips cannot be started by tool.",
        inputSchema: props({ drip_id: STRING }, ["drip_id"]),
      },
      execute: (args) => {
        const drip = db.data.drips.find((candidate) => candidate.id === argString(args, "drip_id"));
        if (!drip) fail("No drip with that id.");
        if (drip.status === "draft") {
          fail(`"${drip.name}" is a draft, and a draft drip cannot be started by tool. Publish it in the CRM first.`);
        }
        if (drip.status === "live") {
          return ok({ drip, note: "Already live — nothing changed." });
        }
        drip.status = "live";
        return ok({ updated: drip, note: "Read back after the write." });
      },
    },

    // ── automations ──────────────────────────────────────────────────────
    {
      definition: {
        name: "automation_list",
        description: "Every automation with its trigger, actions and notes. A large list — about 270 KB.",
        inputSchema: OBJECT,
      },
      execute: () =>
        ok({
          count: db.data.automations.length,
          automations: db.data.automations,
        }),
    },
    {
      definition: {
        name: "automation_get",
        description: "Fetch one automation by id.",
        inputSchema: props({ automation_id: STRING }, ["automation_id"]),
      },
      execute: (args) => {
        const automation = db.data.automations.find(
          (candidate) => candidate.id === argString(args, "automation_id"),
        );
        if (!automation) fail("No automation with that id.");
        return ok({ automation });
      },
    },

    // ── inbox ────────────────────────────────────────────────────────────
    {
      definition: {
        name: "conversation_list",
        description: "Conversations. A normal user sees their own branch; an owner sees every branch.",
        inputSchema: props({ waiting_only: BOOLEAN }),
      },
      execute: (args) => {
        let conversations = db.visibleConversations(options.role, currentUser.id);
        if (argBool(args, "waiting_only")) {
          conversations = conversations.filter((conversation) => conversation.waiting);
        }
        return ok({
          count: conversations.length,
          scope:
            options.role === "owner"
              ? "all branches (owner)"
              : `your branch (${db.data.branches.find((branch) => branch.id === currentUser.branchId)?.name ?? "unknown"})`,
          conversations,
        });
      },
    },
    {
      definition: {
        name: "template_list",
        description: "Message templates by channel.",
        inputSchema: props({ channel: STRING }),
      },
      execute: (args) => {
        const channel = argString(args, "channel");
        const templates =
          channel === "" ? db.data.templates : db.data.templates.filter((template) => template.channel === channel);
        return ok({ count: templates.length, templates });
      },
    },
    {
      definition: {
        name: "send_email",
        description: "Queue an email to the outbox. An identical message inside 10 minutes is blocked.",
        inputSchema: props({ to: STRING, subject: STRING, body: STRING }, ["to", "body"]),
      },
      execute: (args) => queueSend(db, "email", args),
    },
    {
      definition: {
        name: "send_sms",
        description: "Queue an SMS to the outbox. An identical message inside 10 minutes is blocked.",
        inputSchema: props({ to: STRING, body: STRING }, ["to", "body"]),
      },
      execute: (args) => queueSend(db, "sms", args),
    },

    // ── schedule ─────────────────────────────────────────────────────────
    {
      definition: {
        name: "task_list",
        description: "Tasks with due dates and done state.",
        inputSchema: OBJECT,
      },
      execute: () => ok({ count: db.data.tasks.length, tasks: db.data.tasks }),
    },
    {
      definition: {
        name: "task_create",
        description: "Create a task, optionally linked to a lead.",
        inputSchema: props({ title: STRING, due: STRING, lead_id: STRING }, ["title"]),
      },
      execute: (args) => {
        const title = argString(args, "title");
        if (title === "") fail("A task needs a title.");
        const leadId = argString(args, "lead_id");
        if (leadId !== "" && !db.data.leads.some((lead) => lead.id === leadId)) {
          fail(`No lead with id ${leadId}; the task was not created.`);
        }
        const task = {
          id: db.nextId("tk"),
          title,
          due: argString(args, "due"),
          ...(leadId !== "" ? { leadId } : {}),
          done: false,
        };
        db.data.tasks.push(task);
        return ok({ created: task });
      },
    },
  ];

  return tools;
}

function findLead(db: SimulatorDb, id: string): Lead {
  const lead = db.data.leads.find((candidate) => candidate.id === id);
  if (!lead) fail(`No lead with id ${id}.`);
  return lead;
}

function withNames(db: SimulatorDb, lead: Lead): Record<string, unknown> {
  return {
    ...lead,
    branch: db.data.branches.find((branch) => branch.id === lead.branchId)?.name ?? "unknown",
    owner: db.data.users.find((user) => user.id === lead.ownerId)?.name ?? "unknown",
    ...(lead.twinContactId
      ? { twin_contact: `${lead.twinContactId} is the same person as a contact — one record, two views.` }
      : {}),
  };
}

function queueSend(
  db: SimulatorDb,
  channel: "email" | "sms",
  args: Record<string, unknown>,
): Record<string, unknown> {
  const to = argString(args, "to");
  const body = argString(args, "body");
  if (to === "" || body === "") fail(`A ${channel} needs a recipient and a body.`);
  const key = `${channel}|${to.toLowerCase()}|${body}`;
  if (db.data.sentKeys.includes(key)) {
    fail(
      "Duplicate send blocked: an identical message already went to this outbox within the last 10 minutes. Nothing new was queued.",
    );
  }
  const message = {
    id: db.nextId("ob"),
    channel,
    to,
    ...(channel === "email" ? { subject: argString(args, "subject") } : {}),
    body,
    createdAt: new Date().toISOString(),
  };
  db.data.outbox.push(message);
  db.data.sentKeys.push(key);
  return ok({
    queued: message,
    outbox_size: db.data.outbox.length,
    note: "Queued to the outbox only — the simulator never sends to the outside world.",
  });
}
