import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "./route";

const VALID = `---
name: starter
description: A starter skill for the API tests.
---

Follow the starter guidance exactly.
`;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maple-skills-api-"));
  process.env.MAPLE_SKILLS_DIR = dir;
});

afterAll(async () => {
  delete process.env.MAPLE_SKILLS_DIR;
  await rm(dir, { recursive: true, force: true });
});

function request(payload: unknown): Request {
  return new Request("http://localhost/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function post(payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await POST(request(payload));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("skills API", () => {
  it("starts with an empty folder", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ skills: [], dir: "skills/" });
  });

  it("saves a skill, then lists and reads it back", async () => {
    const saved = await post({
      action: "save",
      skill: { name: "starter", description: "A starter skill", body: "Do the thing." },
    });
    expect(saved.status).toBe(200);
    expect((saved.body.entry as { valid: boolean }).valid).toBe(true);

    const listed = (await (await GET()).json()) as { skills: { name: string }[] };
    expect(listed.skills.map((skill) => skill.name)).toEqual(["starter"]);

    const read = await post({ action: "get", name: "starter" });
    expect(read.status).toBe(200);
    expect((read.body.skill as { body: string }).body.trim()).toBe("Do the thing.");
  });

  it("rejects invalid saves and missing skills in plain language", async () => {
    const bad = await post({
      action: "save",
      skill: { name: "Bad Name", description: "x", body: "y" },
    });
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toContain("Skill names use lowercase letters");

    const missing = await post({ action: "get", name: "nope" });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('No skill named "nope".');

    const unknown = await post({ action: "nope" });
    expect(unknown.status).toBe(400);
    expect(String(unknown.body.error)).toContain("Unknown action");
  });

  it("imports, tests and exports", async () => {
    await post({ action: "remove", name: "starter" });
    const imported = await post({ action: "import", text: VALID });
    expect(imported.status).toBe(200);
    expect(imported.body.added).toEqual(["starter"]);

    const tested = await post({ action: "test", name: "starter" });
    expect(tested.status).toBe(200);
    expect((tested.body.result as { valid: boolean }).valid).toBe(true);

    const exported = await post({ action: "export", name: "starter" });
    expect(exported.body.fileName).toBe("starter.md");
    expect(String(exported.body.text)).toContain("name: starter");

    const all = await post({ action: "exportAll" });
    expect(all.body.fileName).toBe("skills.json");
  });

  it("removes a skill", async () => {
    const removed = await post({ action: "remove", name: "starter" });
    expect(removed.status).toBe(200);
    expect(removed.body.skills).toEqual([]);
  });
});
