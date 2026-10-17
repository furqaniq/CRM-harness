import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  NAME_PATTERN,
  SKILL_FILE,
  SkillError,
  approxTokens,
  catalogPrompt,
  parseSkillFile,
  serializeSkillFile,
  validateFields,
} from "./format";
import type {
  SkillDraft,
  SkillEntry,
  SkillExport,
  SkillFile,
  SkillImportResult,
  SkillTestResult,
} from "./types";

export interface SkillStore {
  /** Folder this store reads (shown in the UI as a relative label). */
  dirLabel(): string;
  list(): Promise<SkillEntry[]>;
  get(name: string): Promise<SkillFile | null>;
  save(draft: SkillDraft): Promise<SkillEntry>;
  remove(name: string): Promise<void>;
  /** Accepts a JSON bundle or a single SKILL.md with frontmatter. */
  importText(text: string): Promise<SkillImportResult>;
  exportOne(name: string): Promise<SkillExport>;
  exportAll(): Promise<SkillExport>;
  test(name: string): Promise<SkillTestResult>;
}

export interface SkillStoreOptions {
  /** Defaults to `MAPLE_SKILLS_DIR` or `<cwd>/skills`. */
  dir?: string;
}

export const MAX_IMPORT_TEXT_CHARS = 500_000;

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function lineCount(body: string): number {
  const trimmed = body.trim();
  return trimmed === "" ? 0 : trimmed.split("\n").length;
}

function toEntry(file: SkillFile, folder: string): SkillEntry {
  const errors = [...file.errors];
  if (file.name !== "" && file.name !== folder) {
    errors.push(`frontmatter name "${file.name}" does not match its folder "${folder}"`);
  }
  return {
    name: folder,
    description: file.description,
    valid: errors.length === 0,
    errors,
    warnings: file.warnings,
    chars: file.body.length,
    lines: lineCount(file.body),
  };
}

/** Guard against traversal: the slug is checked again before any path join. */
function requireName(name: string): string {
  if (!NAME_PATTERN.test(name)) {
    throw new SkillError(
      "Skill names use lowercase letters, numbers and dashes only — check the name and try again.",
    );
  }
  return name;
}

interface RawSkill {
  name: string;
  description: string;
  body: string;
}

function rawSkill(value: unknown, position: number): RawSkill {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SkillError(`Imported skill ${position + 1} is not an object.`);
  }
  const record = value as Record<string, unknown>;
  const name = record.name;
  const description = record.description;
  const body = record.body;
  if (typeof name !== "string" || name.trim() === "") {
    throw new SkillError(`Imported skill ${position + 1} has no name.`);
  }
  if (typeof description !== "string") {
    throw new SkillError(`Imported skill "${name}" has no description.`);
  }
  if (typeof body !== "string") {
    throw new SkillError(`Imported skill "${name}" has no body (use an empty string if intentional).`);
  }
  return { name: name.trim(), description, body };
}

function skillsFromJson(value: unknown): RawSkill[] {
  if (Array.isArray(value)) return value.map((item, index) => rawSkill(item, index));
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.skills)) {
      return record.skills.map((item, index) => rawSkill(item, index));
    }
    return [rawSkill(value, 0)];
  }
  throw new SkillError("Imported JSON must be a skill, a list of skills, or { skills: [...] }.");
}

export function createSkillStore(options: SkillStoreOptions = {}): SkillStore {
  const dir = path.resolve(options.dir ?? process.env.MAPLE_SKILLS_DIR ?? path.join(process.cwd(), "skills"));

  function folderOf(name: string): string {
    return path.join(dir, requireName(name));
  }

  async function parsedAt(name: string): Promise<SkillFile | null> {
    const file = path.join(folderOf(name), SKILL_FILE);
    try {
      return parseSkillFile(await readFile(file, "utf8"));
    } catch (error) {
      if (isErrno(error, "ENOENT")) return null;
      throw error;
    }
  }

  async function readEntry(folder: string): Promise<SkillEntry> {
    try {
      const parsed = parseSkillFile(await readFile(path.join(dir, folder, SKILL_FILE), "utf8"));
      return toEntry(parsed, folder);
    } catch (error) {
      const message = isErrno(error, "ENOENT")
        ? `no ${SKILL_FILE} in this folder`
        : "the skill file could not be read";
      return {
        name: folder,
        description: "",
        valid: false,
        errors: [message],
        warnings: [],
        chars: 0,
        lines: 0,
      };
    }
  }

  async function list(): Promise<SkillEntry[]> {
      let folders: string[];
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        folders = entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b));
      } catch (error) {
        if (isErrno(error, "ENOENT")) return [];
        throw error;
      }
      return Promise.all(folders.map((folder) => readEntry(folder)));
  }

  async function get(name: string): Promise<SkillFile | null> {
      const parsed = await parsedAt(name);
      if (parsed === null) return null;
      const entry = toEntry(parsed, name);
      return {
        name,
        description: parsed.description,
        body: parsed.body,
        errors: entry.errors,
        warnings: parsed.warnings,
      };
  }

  async function save(draft: SkillDraft): Promise<SkillEntry> {
      requireName(draft.name);
      const checked = validateFields(draft.name, draft.description, draft.body);
      if (checked.errors.length > 0) {
        throw new SkillError(checked.errors.join(" "));
      }
      const folder = folderOf(draft.name);
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, SKILL_FILE), serializeSkillFile(draft), "utf8");
      return readEntry(draft.name);
  }

  async function remove(name: string): Promise<void> {
      const folder = folderOf(name);
      try {
        await stat(folder);
      } catch (error) {
        if (isErrno(error, "ENOENT")) throw new SkillError(`No skill named "${name}".`);
        throw error;
      }
      await rm(folder, { recursive: true, force: true });
  }

  async function importText(text: string): Promise<SkillImportResult> {
    if (text.length > MAX_IMPORT_TEXT_CHARS) {
      throw new SkillError("Import text is too large — split it into smaller imports.");
    }
    const trimmed = text.trim();
    if (trimmed === "") throw new SkillError("Paste a JSON skill bundle or a SKILL.md file.");

    let skills: RawSkill[];
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new SkillError("That text starts like JSON but does not parse — check the brackets.");
      }
      skills = skillsFromJson(parsed);
    } else {
      const file = parseSkillFile(text);
      if (file.errors.length > 0) {
        throw new SkillError(`That SKILL.md is not valid: ${file.errors.join(" ")}`);
      }
      skills = [{ name: file.name, description: file.description, body: file.body }];
    }

    const seen = new Set<string>();
    for (const [index, skill] of skills.entries()) {
      const checked = validateFields(skill.name, skill.description, skill.body);
      if (checked.errors.length > 0) {
        throw new SkillError(
          `Imported skill ${index + 1}${skill.name ? ` ("${skill.name}")` : ""}: ${checked.errors.join(" ")}`,
        );
      }
      if (seen.has(skill.name)) {
        throw new SkillError(`"${skill.name}" appears twice in the import.`);
      }
      seen.add(skill.name);
    }

    const existing = new Set((await list()).map((entry) => entry.name));
    const added: string[] = [];
    const updated: string[] = [];
    for (const skill of skills) {
      await save(skill);
      if (existing.has(skill.name)) updated.push(skill.name);
      else added.push(skill.name);
    }
    return { added, updated };
  }

  async function exportOne(name: string): Promise<SkillExport> {
    const skill = await get(name);
    if (skill === null) throw new SkillError(`No skill named "${name}".`);
    return { fileName: `${name}.md`, text: serializeSkillFile(skill) };
  }

  async function exportAll(): Promise<SkillExport> {
    const entries = await list();
    const skills: RawSkill[] = [];
    for (const entry of entries) {
      if (!entry.valid) continue;
      const skill = await get(entry.name);
      if (skill !== null) {
        skills.push({ name: skill.name, description: skill.description, body: skill.body });
      }
    }
    return {
      fileName: "skills.json",
      text: `${JSON.stringify({ skills }, null, 2)}\n`,
    };
  }

  async function test(name: string): Promise<SkillTestResult> {
    const skill = await get(name);
    if (skill === null) throw new SkillError(`No skill named "${name}".`);
    return {
      name,
      valid: skill.errors.length === 0,
      errors: skill.errors,
      warnings: skill.warnings,
      chars: skill.body.length,
      lines: lineCount(skill.body),
      approxTokens: approxTokens(skill.body),
      preview: skill.body.slice(0, 600),
    };
  }

  return {
    dirLabel: () => "skills/",
    list,
    get,
    save,
    remove,
    importText,
    exportOne,
    exportAll,
    test,
  };
}

let appStore: SkillStore | null = null;

/** Process-wide store so the chat route and the Skills page see the same folder. */
export function getAppSkillStore(): SkillStore {
  appStore ??= createSkillStore();
  return appStore;
}

export { catalogPrompt };
