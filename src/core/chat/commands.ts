/**
 * Chat commands (spec §6 UI): `/skill <name> [message]` loads a skill for the
 * turn, `@<agent> <task>` addresses one specialist directly. Parsing is
 * separate from execution so it is testable without the route.
 */
export interface SkillCommand {
  name: string;
  /** The prompt with the command removed; may be empty. */
  rest: string;
}

export interface AgentCommand {
  name: string;
  /** The task with the mention removed; may be empty. */
  task: string;
}

export function parseSkillCommand(text: string): SkillCommand | null {
  if (!/^\s*\/skill\b/i.test(text)) return null;
  const match = text.match(/^\s*\/skill\s+([a-z0-9][a-z0-9-]*)\s*([\s\S]*)$/i);
  if (!match) return { name: "", rest: "" };
  return { name: match[1].toLowerCase(), rest: match[2].trim() };
}

export function parseAgentCommand(text: string): AgentCommand | null {
  const match = text.match(/^\s*@([a-z0-9][a-z0-9-]*)\b[\s,:-]*([\s\S]*)$/i);
  if (!match) return null;
  return { name: match[1].toLowerCase(), task: match[2].trim() };
}
