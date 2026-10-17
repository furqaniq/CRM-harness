import type { SimulatorData } from "./types";

/**
 * Seed data for the CRM simulator (spec §6). The quirks live in the data
 * itself: two branches named San Diego, one branch with no agent, a lead and
 * a contact sharing one record, unsubscribed contacts, and an automation list
 * that really is about 270 KB so the artifact path has something honest to
 * handle.
 */

const PAD = ".".repeat(220);

function automationCount(): number {
  return 950;
}

export function seedData(): SimulatorData {
  const automations = Array.from({ length: automationCount() }, (_, i) => ({
    id: `auto_${i + 1}`,
    name: `Automation ${i + 1}: follow-up sequence for pipeline stage ${i % 7}`,
    enabled: i % 4 === 0,
    trigger: ["lead_created", "stage_changed", "task_overdue", "form Submitted"][i % 4],
    actions: ["send_email", "create_task", "add_tag", "notify_owner"].slice(0, (i % 3) + 1),
    note: `Configured by the ops team. ${i % 2 === 0 ? "Reviewed quarterly." : "Needs review."} ${PAD}`,
  }));

  return {
    company: {
      id: "co_maple",
      name: "Maple Home Lending",
      nmls: "123456",
      timezone: "America/Los_Angeles",
    },
    branches: [
      { id: "br_sd_1", name: "San Diego", city: "San Diego", agentCount: 6 },
      { id: "br_sd_2", name: "San Diego", city: "San Diego", agentCount: 3 },
      { id: "br_oc", name: "Orange County", city: "Irvine", agentCount: 5 },
      { id: "br_rno", name: "Reno", city: "Reno", agentCount: 0 },
      { id: "br_sac", name: "Sacramento", city: "Sacramento", agentCount: 4 },
    ],
    users: [
      { id: "u_owner", name: "Avery Chen", role: "owner", branchId: "br_sd_1" },
      { id: "u_morgan", name: "Morgan Lee", role: "user", branchId: "br_sd_1" },
      { id: "u_sam", name: "Sam Ortiz", role: "user", branchId: "br_oc" },
      { id: "u_jordan", name: "Jordan Kim", role: "user", branchId: "br_sac" },
    ],
    leads: [
      {
        id: "L-1001",
        name: "Ada Lovelace",
        email: "ada@example.test",
        phone: "+1 619 555 0101",
        status: "open",
        source: "website",
        stage: "application",
        loanType: "purchase",
        branchId: "br_sd_1",
        ownerId: "u_owner",
        tags: ["warm", "fha"],
        createdAt: "2026-09-02T10:00:00Z",
        twinContactId: "C-1001",
      },
      {
        id: "L-1002",
        name: "Grace Hopper",
        email: "grace@example.test",
        phone: "+1 619 555 0102",
        status: "open",
        source: "referral",
        stage: "pre-approval",
        loanType: "conventional",
        branchId: "br_sd_2",
        ownerId: "u_morgan",
        tags: ["referral"],
        createdAt: "2026-09-05T14:30:00Z",
      },
      {
        id: "L-1003",
        name: "Alan Turing",
        email: "alan@example.test",
        phone: "+1 702 555 0103",
        status: "closed",
        source: "zillow",
        stage: "funded",
        loanType: "va",
        branchId: "br_oc",
        ownerId: "u_sam",
        tags: ["vip"],
        createdAt: "2026-07-19T09:15:00Z",
      },
      {
        id: "L-1004",
        name: "Katherine Johnson",
        email: "katherine@example.test",
        phone: "+1 916 555 0104",
        status: "open",
        source: "website",
        stage: "application",
        loanType: "purchase",
        branchId: "br_sac",
        ownerId: "u_jordan",
        tags: [],
        createdAt: "2026-10-01T16:45:00Z",
      },
      {
        id: "L-1005",
        name: "Ada Byron",
        email: "ada.byron@example.test",
        phone: "+1 619 555 0199",
        status: "open",
        source: "sign_call",
        stage: "lead",
        loanType: "refinance",
        branchId: "br_sd_1",
        ownerId: "u_owner",
        tags: ["duplicate-check"],
        createdAt: "2026-10-10T11:00:00Z",
      },
    ],
    contacts: [
      {
        id: "C-1001",
        name: "Ada Lovelace",
        email: "ada@example.test",
        phone: "+1 619 555 0101",
        subscribed: true,
        tags: ["warm"],
      },
      {
        id: "C-1002",
        name: "Nikola Tesla",
        email: "nikola@example.test",
        phone: "+1 619 555 0105",
        subscribed: false,
        tags: ["unsubscribed-2026"],
      },
      {
        id: "C-1003",
        name: "Marie Curie",
        email: "marie@example.test",
        phone: "+1 702 555 0106",
        subscribed: true,
        tags: ["past-client"],
      },
      {
        id: "C-1004",
        name: "Rosalind Franklin",
        email: "rosalind@example.test",
        phone: "+1 916 555 0107",
        subscribed: true,
        tags: [],
      },
    ],
    pipelines: [
      { id: "pl_purchase", name: "Purchase", stages: ["lead", "pre-approval", "application", "processing", "funded"] },
      { id: "pl_refi", name: "Refinance", stages: ["lead", "application", "processing", "funded"] },
    ],
    campaigns: [
      { id: "cp_fall", name: "Fall refinance rates", status: "draft", channel: "email", enrolled: 0 },
      { id: "cp_past", name: "Past client check-in", status: "live", channel: "email", enrolled: 48 },
    ],
    drips: [
      { id: "dr_nurture", name: "New lead nurture", status: "draft", steps: 4 },
      { id: "dr_active", name: "Application follow-up", status: "live", steps: 6 },
    ],
    automations,
    conversations: [
      ...Array.from({ length: 22 }, (_, i) => ({
        id: `cv_${i + 1}`,
        leadId: `L-100${(i % 5) + 1}`,
        channel: (["sms", "email", "voicemail"] as const)[i % 3],
        snippet:
          i < 3
            ? "Customer asked about rates and is waiting on a reply."
            : "Routine back-and-forth; nothing is waiting on us.",
        waiting: i < 3,
        branchId: i % 2 === 0 ? "br_sd_1" : "br_sd_2",
        ownerId: i % 3 === 0 ? "u_owner" : "u_morgan",
      })),
    ],
    templates: [
      {
        id: "tp_rate_check",
        name: "Rate check reply",
        channel: "email",
        body: "Hi {name}, thanks for asking — current rates depend on the loan type and points. Happy to run numbers.",
      },
      {
        id: "tp_sms_appt",
        name: "Appointment confirmation",
        channel: "sms",
        body: "Hi {name}, confirming our appointment. Reply STOP to unsubscribe.",
      },
      {
        id: "tp_voicemail_followup",
        name: "Voicemail follow-up",
        channel: "voicemail",
        body: "Hi {name}, following up on your application. Call us back any time.",
      },
    ],
    tasks: [
      { id: "tk_1", title: "Call Ada about pre-approval docs", due: "2026-10-20", leadId: "L-1001", done: false },
      { id: "tk_2", title: "Send Grace the rate sheet", due: "2026-10-18", leadId: "L-1002", done: false },
      { id: "tk_3", title: "File Alan's funded packet", due: "2026-10-12", leadId: "L-1003", done: true },
    ],
    tags: ["warm", "fha", "referral", "vip", "past-client", "duplicate-check"],
    statuses: ["open", "nurturing", "closed", "lost"],
    sources: ["website", "referral", "zillow", "sign_call", "past_client"],
    loanTypes: ["purchase", "refinance", "conventional", "va", "heloc"],
    stages: ["lead", "pre-approval", "application", "processing", "funded"],
    outbox: [],
    sentKeys: [],
  };
}
