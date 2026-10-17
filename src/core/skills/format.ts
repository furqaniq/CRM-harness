import type { SkillFile } from "./types";

export const SKILL_FILE = "SKILL.md";
export const MAX_BODY_CHARS = 100_000;
export const MAX_DESCRIPTION_CHARS = 240;
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_CATALOG_ENTRIES = 60;

/** Plain-language failure the UI and the API can show as-is. */
export class SkillError extends Error {}

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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

export function validateFields(
  name: string,
  description: string,
  body: string,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (name.trim() === "") {
    errors.push("name is required");
  } else if (!NAME_PATTERN.test(name)) {
    errors.push(
      "name must be 1–64 lowercase letters, numbers or dashes, starting with a letter or number",
    );
  }
  if (description.trim() === "") {
    errors.push("description is required");
  } else if (description.length > MAX_DESCRIPTION_CHARS) {
    errors.push(`description must be ${MAX_DESCRIPTION_CHARS} characters or fewer`);
  } else if (description.length > 160) {
    warnings.push(
      "description is over 160 characters — it sits in every prompt, so shorter is better",
    );
  }
  if (body.length > MAX_BODY_CHARS) {
    errors.push(`body must be ${MAX_BODY_CHARS.toLocaleString("en-US")} characters or fewer`);
  }
  if (body.trim() === "") {
    warnings.push("body is empty — loading this skill would add nothing");
  }
  return { errors, warnings };
}

/**
 * Reads `name:` / `description:` from the YAML-ish frontmatter the spec asks
 * for (a folder per skill, a description and a body). Deliberately small: one
 * `key: value` per line, no nesting — anything else is a plain error.
 */
export function parseSkillFile(text: string): SkillFile {
  const normalized = text.replace(/\r\n?/g, "\n");
  const errors: string[] = [];
  const warnings: string[] = [];
  let name = "";
  let description = "";
  let body = normalized;

  if (!normalized.startsWith("---")) {
    errors.push('missing frontmatter — start the file with "---", then name: and description: lines');
  } else {
    const lines = normalized.split("\n");
    let close = -1;
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === "---") {
        close = index;
        break;
      }
    }
    if (close === -1) {
      errors.push("frontmatter has no closing --- line");
    } else {
      for (let index = 1; index < close; index += 1) {
        const line = lines[index];
        if (line.trim() === "" || line.trim().startsWith("#")) continue;
        const colon = line.indexOf(":");
        if (colon <= 0) {
          errors.push(`frontmatter line ${index + 1} is not "key: value"`);
          continue;
        }
        const key = line.slice(0, colon).trim().toLowerCase();
        const value = unquote(line.slice(colon + 1).trim());
        if (key === "name") name = value;
        else if (key === "description") description = value;
        else warnings.push(`unknown frontmatter field "${key}"`);
      }
      body = lines.slice(close + 1).join("\n").replace(/^\n+/, "");
    }
  }

  const checked = validateFields(name, description, body);
  return {
    name,
    description,
    body,
    errors: [...errors, ...checked.errors],
    warnings: [...warnings, ...checked.warnings],
  };
}

export function serializeSkillFile(skill: { name: string; description: string; body: string }): string {
  const description = skill.description.replace(/\s+/g, " ").trim();
  return `---\nname: ${skill.name}\ndescription: ${description}\n---\n\n${skill.body.trim()}\n`;
}

/**
 * The only part of a skill that reaches the system prompt: its name and
 * description. Bodies load on demand through `read_skill`.
 */
export function catalogPrompt(entries: readonly { name: string; description: string }[]): string {
  if (entries.length === 0) return "";
  const shown = entries.slice(0, MAX_CATALOG_ENTRIES);
  const omitted = entries.length - shown.length;
  const lines = [
    "Skills available in this workspace (names and descriptions only — a skill's body is not in context):",
    ...shown.map((entry) => `- ${entry.name}: ${entry.description.trim()}`),
    ...(omitted > 0 ? [`(${omitted} more skill${omitted === 1 ? "" : "s"} are not listed.)`] : []),
    "When a task matches a skill's description, call read_skill with that skill's name to load its full guidance before acting.",
  ];
  return lines.join("\n");
}
