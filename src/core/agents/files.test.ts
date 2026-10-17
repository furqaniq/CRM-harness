import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_FILE,
  agentsFrom,
  loadAgentCatalog,
  parseAgentFile,
  type AgentEntry,
} from "./files";

const VALID = `---
name: leads
displayName: Leads agent
description: Lead specialist
modelRole: worker
tools: lead_*, direct_lead_*
skills: entity-resolution, verify-after-write
canSpawn: false
limitSteps: 8
limitTokens: 40000
policy.write: ask
policy.live-effect: deny
---

You are the leads specialist.
`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maple-agents-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeAgent(folder: string, text: string): Promise<void> {
  await mkdir(path.join(dir, folder), { recursive: true });
  await writeFile(path.join(dir, folder, AGENT_FILE), text, "utf8");
}

describe("agent seed files", () => {
  it("parses fields, lists, limits, policy and the body", () => {
    const entry = parseAgentFile(VALID, "leads");
    expect(entry.errors).toEqual([]);
    expect(entry.valid).toBe(true);
    expect(entry).toMatchObject({
      name: "leads",
      displayName: "Leads agent",
      modelRole: "worker",
      toolGlobs: ["lead_*", "direct_lead_*"],
      skills: ["entity-resolution", "verify-after-write"],
      canSpawn: false,
      limits: { steps: 8, tokens: 40000 },
      policy: { write: "ask", "live-effect": "deny" },
    });
    expect(entry.body).toBe("You are the leads specialist.");
  });

  it("reports broken frontmatter and mismatched names in plain language", () => {
    expect(parseAgentFile("no frontmatter", "leads").errors[0]).toContain("missing frontmatter");
    expect(parseAgentFile("---\nname: leads\n\nbody", "leads").errors[0]).toContain(
      "no closing ---",
    );
    const missing = parseAgentFile("---\nname: leads\n---\n\nbody", "leads");
    expect(missing.errors.join(" ")).toContain("displayName is required");
    expect(missing.errors.join(" ")).toContain("description is required");
    const mismatch = parseAgentFile(VALID, "inbox");
    expect(mismatch.errors.join(" ")).toContain('does not match its folder "inbox"');
    const role = parseAgentFile(VALID.replace("modelRole: worker", "modelRole: boss"), "leads");
    expect(role.errors.join(" ")).toContain("modelRole must be one of");
    const policy = parseAgentFile(VALID.replace("policy.write: ask", "policy.network: ask"), "leads");
    expect(policy.errors.join(" ")).toContain('unknown policy class "network"');
  });

  it("warns about unknown fields without failing", () => {
    const entry = parseAgentFile(VALID.replace("canSpawn: false", "canSpawn: false\ntemperature: 2"), "leads");
    expect(entry.errors).toEqual([]);
    expect(entry.warnings.join(" ")).toContain('unknown frontmatter field "temperature"');
  });

  it("loads a catalog sorted by folder and keeps broken files visible", async () => {
    await writeAgent("leads", VALID);
    await writeAgent("inbox", VALID.replaceAll("leads", "inbox"));
    await mkdir(path.join(dir, "empty"), { recursive: true });
    await writeFile(path.join(dir, "empty", AGENT_FILE), "broken", "utf8");

    const catalog = await loadAgentCatalog({ dir });
    expect(catalog.map((entry) => entry.name)).toEqual(["empty", "inbox", "leads"]);
    const byName = new Map(catalog.map((entry) => [entry.name, entry]));
    expect(byName.get("leads")?.valid).toBe(true);
    expect(byName.get("empty")?.errors.join(" ")).toContain("missing frontmatter");
  });

  it("maps valid files to spawn specs and drops invalid ones", () => {
    const valid = parseAgentFile(VALID, "leads");
    const broken: AgentEntry = { ...valid, name: "broken", valid: false, errors: ["x"] };
    const specs = agentsFrom([valid, broken]);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      name: "leads",
      modelRole: "worker",
      canSpawn: false,
      skills: ["entity-resolution", "verify-after-write"],
      policy: { write: "ask", "live-effect": "deny" },
      limits: { maxSteps: 8, maxTokens: 40000 },
    });
  });

  it("every seeded agent file loads and validates", async () => {
    const catalog = await loadAgentCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(14);
    const invalid = catalog
      .filter((entry) => !entry.valid)
      .map((entry) => ({ name: entry.name, errors: entry.errors }));
    expect(invalid).toEqual([]);
    expect(catalog.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["maple", "leads", "inbox", "willa", "reports", "verifier", "qa"]),
    );
    const maple = catalog.find((entry) => entry.name === "maple");
    expect(maple?.canSpawn).toBe(true);
    const verifier = catalog.find((entry) => entry.name === "verifier");
    expect(verifier?.policy).toEqual({ write: "deny", "live-effect": "deny" });
    expect(agentsFrom(catalog)).toHaveLength(catalog.length);
  });
});
