import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SkillError,
  buildReadSkillTool,
  catalogPrompt,
  createSkillStore,
  parseSkillFile,
  serializeSkillFile,
  type SkillStore,
} from "./index";
import type { ToolContext } from "../loop/types";

const VALID = `---
name: starter
description: A starter skill for tests; it explains the flow.
---

Follow the starter guidance exactly.
Second line.
`;

function ctx(): ToolContext {
  return {
    runId: "run_test",
    stepId: 1,
    callId: "call_1",
    name: "read_skill",
    signal: new AbortController().signal,
  };
}

let dir: string;
let store: SkillStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maple-skills-"));
  store = createSkillStore({ dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSkill(folder: string, text: string): Promise<void> {
  await mkdir(path.join(dir, folder), { recursive: true });
  await writeFile(path.join(dir, folder, "SKILL.md"), text, "utf8");
}

describe("skill files", () => {
  it("parses frontmatter and keeps the body separate", () => {
    const parsed = parseSkillFile(VALID);
    expect(parsed.errors).toEqual([]);
    expect(parsed.name).toBe("starter");
    expect(parsed.description).toBe("A starter skill for tests; it explains the flow.");
    expect(parsed.body.trim()).toBe("Follow the starter guidance exactly.\nSecond line.");
  });

  it("accepts quoted values and a colon in the description", () => {
    const parsed = parseSkillFile(
      '---\nname: "quoted"\ndescription: "Trap: same-named branches"\n---\n\nBody\n',
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.name).toBe("quoted");
    expect(parsed.description).toBe("Trap: same-named branches");
  });

  it("reports plain-language problems", () => {
    expect(parseSkillFile("no frontmatter at all").errors[0]).toContain("missing frontmatter");
    expect(parseSkillFile("---\nname: x\ndescription: y").errors[0]).toContain("no closing ---");
    expect(parseSkillFile("---\nname x\ndescription: y\n---\n").errors.join(" ")).toContain(
      'frontmatter line 2 is not "key: value"',
    );
    expect(parseSkillFile("---\nname: Bad Name\ndescription: y\n---\n").errors.join(" ")).toContain(
      "lowercase letters, numbers or dashes",
    );
    expect(parseSkillFile("---\nname: ok\n---\n").errors.join(" ")).toContain("description is required");
  });

  it("warns without failing on empty bodies and long descriptions", () => {
    const parsed = parseSkillFile(`---\nname: ok\ndescription: ${"x".repeat(170)}\n---\n`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings.join(" ")).toContain("over 160 characters");
    expect(parsed.warnings.join(" ")).toContain("body is empty");
  });

  it("round-trips through serialize", () => {
    const text = serializeSkillFile({ name: "starter", description: "Line one\nline two", body: "Body" });
    const parsed = parseSkillFile(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.description).toBe("Line one line two");
    expect(parsed.body.trim()).toBe("Body");
  });
});

describe("skills folder", () => {
  it("lists valid skills and flags broken folders", async () => {
    await writeSkill("starter", VALID);
    await mkdir(path.join(dir, "empty"), { recursive: true });
    await writeSkill("mismatch", VALID);
    await mkdir(path.join(dir, "junk"), { recursive: true });
    await writeFile(path.join(dir, "junk", "SKILL.md"), "no frontmatter", "utf8");

    const entries = await store.list();
    expect(entries.map((entry) => entry.name)).toEqual(["empty", "junk", "mismatch", "starter"]);

    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    expect(byName.get("starter")?.valid).toBe(true);
    expect(byName.get("starter")?.chars).toBeGreaterThan(0);
    expect(byName.get("empty")?.errors[0]).toContain("no SKILL.md");
    expect(byName.get("mismatch")?.errors[0]).toContain("does not match its folder");
    expect(byName.get("junk")?.valid).toBe(false);
  });

  it("creates, reads, updates and removes a skill", async () => {
    const entry = await store.save({
      name: "starter",
      description: "A starter skill",
      body: "Step one.\nStep two.",
    });
    expect(entry.valid).toBe(true);
    expect(entry.lines).toBe(2);

    const read = await store.get("starter");
    expect(read?.body.trim()).toBe("Step one.\nStep two.");
    expect(await readFile(path.join(dir, "starter", "SKILL.md"), "utf8")).toContain("name: starter");

    await store.save({ name: "starter", description: "Updated", body: "New body" });
    expect((await store.get("starter"))?.description).toBe("Updated");

    await store.remove("starter");
    expect(await store.get("starter")).toBeNull();
    await expect(store.remove("starter")).rejects.toBeInstanceOf(SkillError);
  });

  it("refuses traversal names and invalid saves", async () => {
    await expect(store.get("../etc")).rejects.toBeInstanceOf(SkillError);
    await expect(
      store.save({ name: "../evil", description: "x", body: "y" }),
    ).rejects.toBeInstanceOf(SkillError);
    await expect(
      store.save({ name: "ok", description: "", body: "y" }),
    ).rejects.toThrow("description is required");
  });

  it("imports a JSON bundle, reporting added and updated", async () => {
    await store.save({ name: "existing", description: "old", body: "old body" });
    const bundle = JSON.stringify({
      skills: [
        { name: "existing", description: "new", body: "new body" },
        { name: "fresh", description: "fresh skill", body: "fresh body" },
      ],
    });
    const result = await store.importText(bundle);
    expect(result).toEqual({ added: ["fresh"], updated: ["existing"] });
    expect((await store.get("fresh"))?.body.trim()).toBe("fresh body");
  });

  it("imports a single SKILL.md", async () => {
    const result = await store.importText(VALID);
    expect(result.added).toEqual(["starter"]);
    expect((await store.get("starter"))?.description).toContain("A starter skill");
  });

  it("validates the whole import before writing anything", async () => {
    const bundle = JSON.stringify([
      { name: "good", description: "fine", body: "yes" },
      { name: "Bad Name", description: "broken", body: "no" },
    ]);
    await expect(store.importText(bundle)).rejects.toThrow("Imported skill 2");
    expect(await store.list()).toEqual([]);
  });

  it("exports one skill as SKILL.md and all as a re-importable bundle", async () => {
    await store.save({ name: "a", description: "A skill", body: "Alpha" });
    await store.save({ name: "b", description: "B skill", body: "Beta" });

    const one = await store.exportOne("a");
    expect(one.fileName).toBe("a.md");
    expect(parseSkillFile(one.text).body.trim()).toBe("Alpha");

    const all = await store.exportAll();
    expect(all.fileName).toBe("skills.json");
    const parsed = JSON.parse(all.text) as { skills: { name: string }[] };
    expect(parsed.skills.map((skill) => skill.name)).toEqual(["a", "b"]);

    const other = createSkillStore({ dir: path.join(dir, "..", "other") });
    const imported = await other.importText(all.text);
    expect(imported.added).toEqual(["a", "b"]);
    await rm(path.join(dir, "..", "other"), { recursive: true, force: true });
  });

  it("tests a skill and reports what would be injected", async () => {
    await writeSkill("starter", VALID);
    const result = await store.test("starter");
    expect(result.valid).toBe(true);
    expect(result.lines).toBe(2);
    expect(result.approxTokens).toBe(Math.ceil(result.chars / 4));
    expect(result.preview).toContain("Follow the starter guidance");
  });
});

describe("skill prompt and read_skill", () => {
  it("puts only names and descriptions in the catalog", async () => {
    await writeSkill("starter", VALID);
    const entries = await store.list();
    const prompt = catalogPrompt(entries);
    expect(prompt).toContain("- starter: A starter skill for tests");
    expect(prompt).not.toContain("Follow the starter guidance");
  });

  it("loads a body by name and fails plainly for unknown names", async () => {
    await writeSkill("starter", VALID);
    const tool = buildReadSkillTool((name) => store.get(name));
    expect(tool.definition.name).toBe("read_skill");

    const loaded = await tool.execute({ name: "starter" }, ctx());
    expect(loaded).toMatchObject({
      skill: "starter",
      description: "A starter skill for tests; it explains the flow.",
    });
    expect((loaded as { body: string }).body).toContain("Follow the starter guidance exactly.");

    await expect(tool.execute({ name: "missing" }, ctx())).rejects.toThrow('No skill named "missing"');
    await expect(tool.execute({}, ctx())).rejects.toThrow('read_skill needs a "name"');
  });
});
