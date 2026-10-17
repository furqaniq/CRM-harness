import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { MODEL_ROLES, type ModelRole } from "../providers/types";
import { TOOL_CLASSES, type ToolClass } from "../tools/classify";
import type { PolicyMode } from "../policy/types";
import type { AgentSpec } from "./types";

export const AGENT_FILE = "AGENT.md";
export const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** One agent seed file, parsed. Invalid files are listed too, with reasons. */
export interface AgentEntry {
  name: string;
  displayName: string;
  description: string;
  modelRole: string;
  toolGlobs: string[];
  skills: string[];
  canSpawn: boolean;
  policy: Partial<Record<ToolClass, PolicyMode>>;
  limits: { steps?: number; timeMs?: number; tokens?: number; costUsd?: number };
  /** The prompt body — the child's system prompt. */
  body: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const POLICY_MODES: PolicyMode[] = ["auto", "ask", "deny"];
const TRUE_WORDS = new Set(["true", "yes", "on"]);
const FALSE_WORDS = new Set(["false", "no", "off"]);

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function listOf(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function boolOf(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (TRUE_WORDS.has(normalized)) return true;
  if (FALSE_WORDS.has(normalized)) return false;
  return false;
}

function numberOf(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isModelRole(value: string): value is ModelRole {
  return (MODEL_ROLES as string[]).includes(value);
}

function isToolClass(value: string): value is ToolClass {
  return (TOOL_CLASSES as string[]).includes(value);
}

function emptyEntry(name: string): AgentEntry {
  return {
    name,
    displayName: "",
    description: "",
    modelRole: "worker",
    toolGlobs: [],
    skills: [],
    canSpawn: false,
    policy: {},
    limits: {},
    body: "",
    valid: false,
    errors: [],
    warnings: [],
  };
}

/**
 * Parses an AGENT.md seed file: frontmatter fields (spec §5) then the prompt
 * body. The format is deliberately small — `key: value`, comma lists for tools
 * and skills, and `policy.<class>: auto|ask|deny`.
 */
export function parseAgentFile(text: string, folder: string): AgentEntry {
  const entry = emptyEntry(folder);
  const normalized = text.replace(/\r\n?/g, "\n");

  if (!normalized.startsWith("---")) {
    entry.errors.push('missing frontmatter — start the file with "---", then the agent fields');
    return entry;
  }

  const lines = normalized.split("\n");
  let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      close = index;
      break;
    }
  }
  if (close === -1) {
    entry.errors.push("frontmatter has no closing --- line");
    return entry;
  }

  const fields = new Map<string, string>();
  for (let index = 1; index < close; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) {
      entry.errors.push(`frontmatter line ${index + 1} is not "key: value"`);
      continue;
    }
    const key = line.slice(0, colon).trim();
    fields.set(key, unquote(line.slice(colon + 1).trim()));
  }

  entry.body = lines.slice(close + 1).join("\n").replace(/^\n+/, "").trimEnd();

  entry.name = fields.get("name")?.trim() ?? "";
  entry.displayName = fields.get("displayName")?.trim() ?? "";
  entry.description = fields.get("description")?.trim() ?? "";
  entry.modelRole = fields.get("modelRole")?.trim() ?? "worker";
  entry.toolGlobs = listOf(fields.get("tools") ?? "");
  entry.skills = listOf(fields.get("skills") ?? "");
  entry.canSpawn = boolOf(fields.get("canSpawn") ?? "false");

  for (const [key, value] of fields) {
    if (key.startsWith("policy.")) {
      const className = key.slice("policy.".length);
      if (!isToolClass(className)) {
        entry.errors.push(`unknown policy class "${className}" — use ${TOOL_CLASSES.join(", ")}`);
        continue;
      }
      if (!(POLICY_MODES as string[]).includes(value)) {
        entry.errors.push(`policy.${className} must be auto, ask or deny`);
        continue;
      }
      entry.policy[className] = value as PolicyMode;
    }
  }

  const steps = numberOf(fields.get("limitSteps") ?? "");
  const timeMs = numberOf(fields.get("limitTimeMs") ?? "");
  const tokens = numberOf(fields.get("limitTokens") ?? "");
  const costUsd = numberOf(fields.get("limitCostUsd") ?? "");
  if (steps !== null) entry.limits.steps = steps;
  if (timeMs !== null) entry.limits.timeMs = timeMs;
  if (tokens !== null) entry.limits.tokens = tokens;
  if (costUsd !== null) entry.limits.costUsd = costUsd;

  const known = new Set([
    "name",
    "displayName",
    "description",
    "modelRole",
    "tools",
    "skills",
    "canSpawn",
    "limitSteps",
    "limitTimeMs",
    "limitTokens",
    "limitCostUsd",
  ]);
  for (const key of fields.keys()) {
    if (!known.has(key) && !key.startsWith("policy.")) {
      entry.warnings.push(`unknown frontmatter field "${key}"`);
    }
  }

  if (entry.name === "") entry.errors.push("name is required");
  else if (!AGENT_NAME_PATTERN.test(entry.name)) {
    entry.errors.push("name must be 1–64 lowercase letters, numbers or dashes");
  } else if (entry.name !== folder) {
    entry.errors.push(`frontmatter name "${entry.name}" does not match its folder "${folder}"`);
  }
  if (entry.displayName === "") entry.errors.push("displayName is required");
  if (entry.description === "") entry.errors.push("description is required");
  if (!isModelRole(entry.modelRole)) {
    entry.errors.push(`modelRole must be one of ${MODEL_ROLES.join(", ")}`);
  }
  for (const skill of entry.skills) {
    if (!AGENT_NAME_PATTERN.test(skill)) {
      entry.errors.push(`skill name "${skill}" is not a lowercase skill slug`);
    }
  }
  if (entry.body.trim() === "") entry.errors.push("the prompt body is empty");

  entry.valid = entry.errors.length === 0;
  return entry;
}

/** Valid agent specs for spawning; invalid seed files are left out. */
export function agentsFrom(entries: readonly AgentEntry[]): AgentSpec[] {
  const specs: AgentSpec[] = [];
  for (const entry of entries) {
    if (!entry.valid) continue;
    const spec: AgentSpec = {
      name: entry.name,
      displayName: entry.displayName,
      description: entry.description,
      modelRole: entry.modelRole as ModelRole,
      toolGlobs: entry.toolGlobs,
      canSpawn: entry.canSpawn,
      system: entry.body,
      ...(entry.skills.length > 0 ? { skills: entry.skills } : {}),
      ...(Object.keys(entry.policy).length > 0 ? { policy: entry.policy } : {}),
      ...(Object.keys(entry.limits).length > 0
        ? {
            limits: {
              ...(entry.limits.steps !== undefined ? { maxSteps: entry.limits.steps } : {}),
              ...(entry.limits.timeMs !== undefined ? { maxTimeMs: entry.limits.timeMs } : {}),
              ...(entry.limits.tokens !== undefined ? { maxTokens: entry.limits.tokens } : {}),
              ...(entry.limits.costUsd !== undefined ? { maxCostUsd: entry.limits.costUsd } : {}),
            },
          }
        : {}),
    };
    specs.push(spec);
  }
  return specs;
}

export interface AgentCatalogOptions {
  /** Defaults to `MAPLE_AGENTS_DIR` or `<cwd>/agents`. */
  dir?: string;
}

/** Reads every folder under `agents/` that holds an AGENT.md, sorted by name. */
export async function loadAgentCatalog(options: AgentCatalogOptions = {}): Promise<AgentEntry[]> {
  const dir = path.resolve(options.dir ?? process.env.MAPLE_AGENTS_DIR ?? path.join(process.cwd(), "agents"));
  let folders: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    folders = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }

  const catalog: AgentEntry[] = [];
  for (const folder of folders) {
    try {
      const text = await readFile(path.join(dir, folder, AGENT_FILE), "utf8");
      catalog.push(parseAgentFile(text, folder));
    } catch {
      const entry = emptyEntry(folder);
      entry.errors.push(`no ${AGENT_FILE} in this folder`);
      catalog.push(entry);
    }
  }
  return catalog;
}
