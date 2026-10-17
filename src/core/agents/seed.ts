import type { AgentSpec } from "./types";

/**
 * Interim specialist roster for the chat route (S13). The spec's seed files
 * (`agents/*.md`) land in S16 and will replace this roster with file-driven
 * agents, per-agent policies and skills; until then the same `AgentSpec`
 * shape is filled inline so subagent spawning is real, not a stub.
 */
export const INTERIM_AGENTS: readonly AgentSpec[] = [
  {
    name: "leads",
    displayName: "Leads agent",
    description: "Counts, searches and updates mortgage leads and their pipeline records.",
    modelRole: "worker",
    toolGlobs: ["lead_*", "pipeline_*"],
    system:
      "You are the leads specialist of the Maple mortgage CRM. Do exactly the task you were " +
      "given, using only your own tools, and answer with a short factual report of what you " +
      "found or changed. Never invent records. If the task is impossible with your tools, say " +
      "so plainly.",
  },
  {
    name: "inbox",
    displayName: "Inbox agent",
    description: "Reads conversations, tasks and templates; reports what is waiting for a reply.",
    modelRole: "worker",
    toolGlobs: ["conversation_*", "task_*", "template_*"],
    system:
      "You are the inbox specialist of the Maple mortgage CRM. Do exactly the task you were " +
      "given, using only your own tools, and answer with a short factual report of what you " +
      "found or changed. Never invent records. If the task is impossible with your tools, say " +
      "so plainly.",
  },
  {
    name: "contacts",
    displayName: "Contacts agent",
    description: "Works with contacts, branches, campaigns and automations.",
    modelRole: "worker",
    toolGlobs: ["customer_*", "branch_*", "campaign_*", "drip_*", "automation_*"],
    system:
      "You are the contacts specialist of the Maple mortgage CRM. Do exactly the task you were " +
      "given, using only your own tools, and answer with a short factual report of what you " +
      "found or changed. Never invent records. If the task is impossible with your tools, say " +
      "so plainly.",
  },
];
