/** Record shapes for the CRM simulator (spec §6: mock CRM with real constraints). */

export type Role = "owner" | "user";

export interface Company {
  id: string;
  name: string;
  nmls: string;
  timezone: string;
}

export interface Branch {
  id: string;
  name: string;
  city: string;
  /** Branches with no active agent refuse transfers (quirk). */
  agentCount: number;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  branchId: string;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  source: string;
  stage: string;
  loanType: string;
  branchId: string;
  ownerId: string;
  tags: string[];
  createdAt: string;
  /** Shared-record quirk: this lead id is also a contact id. */
  twinContactId?: string;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Unsubscribed contacts vanish from search (quirk). */
  subscribed: boolean;
  tags: string[];
}

export interface Pipeline {
  id: string;
  name: string;
  stages: string[];
}

export interface Campaign {
  id: string;
  name: string;
  status: "draft" | "live" | "paused";
  channel: "email" | "sms";
  enrolled: number;
}

export interface Drip {
  id: string;
  name: string;
  status: "draft" | "live" | "paused";
  steps: number;
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  actions: string[];
  note: string;
}

export interface Conversation {
  id: string;
  leadId: string;
  channel: "sms" | "email" | "voicemail";
  snippet: string;
  waiting: boolean;
  branchId: string;
  ownerId: string;
}

export interface Template {
  id: string;
  name: string;
  channel: "email" | "sms" | "voicemail";
  body: string;
}

export interface Task {
  id: string;
  title: string;
  due: string;
  leadId?: string;
  done: boolean;
}

export interface OutboxMessage {
  id: string;
  channel: "email" | "sms";
  to: string;
  subject?: string;
  body: string;
  createdAt: string;
}

export interface SimulatorData {
  company: Company;
  branches: Branch[];
  users: User[];
  leads: Lead[];
  contacts: Contact[];
  pipelines: Pipeline[];
  campaigns: Campaign[];
  drips: Drip[];
  automations: Automation[];
  conversations: Conversation[];
  templates: Template[];
  tasks: Task[];
  tags: string[];
  statuses: string[];
  sources: string[];
  loanTypes: string[];
  stages: string[];
  outbox: OutboxMessage[];
  /** Sends already made, for the duplicate-send guard. */
  sentKeys: string[];
}

/** Quirk switches — every real-CRM bug is off/on here, never hidden in tool code. */
export interface QuirkSwitches {
  /** branch_list fails ~1 in N calls (seeded alternation, not randomness). */
  intermittentBranchList: boolean;
  /** campaign_step_update writes into the wrong field (the real CRM bug). */
  campaignStepWrongField: boolean;
}
