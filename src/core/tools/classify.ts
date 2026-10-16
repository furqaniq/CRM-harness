/**
 * Tool classification feeds the policy engine (S7): read, write, live-effect
 * or destructive. The spec's rule is "inferred from name and MCP hints,
 * editable", so every answer here is a default a human can change on the
 * tool row.
 *
 * A tool we cannot classify becomes `live-effect` (policy: ask) rather than
 * something that runs unattended — asking is recoverable, running is not.
 */

export type ToolClass = "read" | "write" | "live-effect" | "destructive";

export const TOOL_CLASSES: ToolClass[] = ["read", "write", "live-effect", "destructive"];

/** The spec's global deny pattern: these words beat every allow list. */
export const DENY_WORDS = ["delete", "remove", "archive", "destroy", "merge"] as const;

const READ_VERBS = new Set([
  "get",
  "list",
  "search",
  "find",
  "query",
  "read",
  "fetch",
  "view",
  "count",
  "show",
  "explain",
  "preview",
  "check",
  "compare",
  "diff",
  "inspect",
  "history",
]);

const WRITE_VERBS = new Set([
  "create",
  "add",
  "new",
  "update",
  "set",
  "edit",
  "rename",
  "assign",
  "transfer",
  "insert",
  "upsert",
  "tag",
  "attach",
  "detach",
  "mark",
  "duplicate",
  "import",
  "restore",
  "apply",
  "move",
  "link",
  "unlink",
  "enable",
  "disable",
  "note",
  "comment",
  "log",
]);

/** Actions that reach beyond the CRM: messages, posts, bookings, publishing. */
const LIVE_EFFECT_VERBS = new Set([
  "send",
  "publish",
  "post",
  "schedule",
  "book",
  "cancel",
  "call",
  "text",
  "email",
  "notify",
  "invite",
  "subscribe",
  "unsubscribe",
  "enroll",
  "start",
  "pause",
  "resume",
  "activate",
  "close",
  "approve",
  "reject",
  "submit",
  "trigger",
  "run",
  "render",
  "upload",
  "download",
  "share",
]);

function tokensOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+|\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

export interface ClassifyInput {
  name: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

export function inferToolClass(input: ClassifyInput): ToolClass {
  const hints = input.annotations;
  if (hints?.destructiveHint === true) return "destructive";

  const tokens = tokensOf(input.name);
  const words = [...tokens, ...tokensOf(input.description ?? "")];

  // The deny pattern beats every other signal — including a server's own
  // read-only claim, which is a claim, not a guarantee.
  if (words.some((word) => (DENY_WORDS as readonly string[]).includes(word))) return "destructive";
  if (hints?.readOnlyHint === true) return "read";
  if (words.some((word) => LIVE_EFFECT_VERBS.has(word))) return "live-effect";
  if (words.some((word) => READ_VERBS.has(word))) return "read";
  if (words.some((word) => WRITE_VERBS.has(word))) return "write";
  return "live-effect";
}

/** "lead_search" -> "Lead search" for display labels and empty label fields. */
export function humanizeToolName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\-\s]+/)
    .filter(Boolean);
  if (words.length === 0) return name;
  const joined = words.join(" ");
  // Sentence case, per the spec's voice rules.
  return joined.charAt(0).toUpperCase() + joined.slice(1).toLowerCase();
}
