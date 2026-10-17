import { describe, expect, it } from "vitest";
import { GET } from "./route";

interface AgentJson {
  name: string;
  valid: boolean;
  displayName: string;
  canSpawn: boolean;
  policy: Record<string, string>;
}

describe("agents API", () => {
  it("lists every seeded agent and validates it", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { agents: AgentJson[]; dir: string };
    expect(body.dir).toBe("agents/");
    expect(body.agents.length).toBeGreaterThanOrEqual(14);

    const invalid = body.agents.filter((agent) => !agent.valid).map((agent) => agent.name);
    expect(invalid).toEqual([]);

    const names = body.agents.map((agent) => agent.name);
    expect(names).toEqual(expect.arrayContaining(["maple", "leads", "inbox", "willa", "verifier"]));

    const maple = body.agents.find((agent) => agent.name === "maple");
    expect(maple?.canSpawn).toBe(true);
    expect(body.agents.find((agent) => agent.name === "verifier")?.policy).toEqual({
      write: "deny",
      "live-effect": "deny",
    });
  });
});
