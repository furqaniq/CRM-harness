import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PERSONA, PERSONA_FILE, loadPersona } from "./index";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maple-persona-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("persona", () => {
  it("reads the editable file when it exists", async () => {
    await writeFile(path.join(dir, PERSONA_FILE), "You are Maple, edited.\n", "utf8");
    const persona = await loadPersona({ dir });
    expect(persona).toEqual({ text: "You are Maple, edited.", source: "file" });
  });

  it("falls back to the built-in persona when the file is missing or empty", async () => {
    const missing = await loadPersona({ dir });
    expect(missing).toEqual({ text: DEFAULT_PERSONA, source: "default" });

    await writeFile(path.join(dir, PERSONA_FILE), "   \n", "utf8");
    const empty = await loadPersona({ dir });
    expect(empty.text).toBe(DEFAULT_PERSONA);
    expect(empty.source).toBe("default");
    expect(empty.error).toContain("empty");
  });

  it("ships a seeded persona file that loads", async () => {
    const persona = await loadPersona();
    expect(persona.source).toBe("file");
    expect(persona.text).toContain("Maple Assistant");
    expect(persona.text).toContain("Never delete");
  });
});
