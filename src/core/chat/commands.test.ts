import { describe, expect, it } from "vitest";
import { parseAgentCommand, parseSkillCommand } from "./commands";

describe("chat commands", () => {
  it("parses /skill with and without a message", () => {
    expect(parseSkillCommand("/skill never-delete delete lead L-1001")).toEqual({
      name: "never-delete",
      rest: "delete lead L-1001",
    });
    expect(parseSkillCommand("/skill entity-resolution")).toEqual({
      name: "entity-resolution",
      rest: "",
    });
    expect(parseSkillCommand("  /SKILL Never-Delete  please")).toEqual({
      name: "never-delete",
      rest: "please",
    });
    expect(parseSkillCommand("/skill")).toEqual({ name: "", rest: "" });
    expect(parseSkillCommand("/skills please")).toBeNull();
    expect(parseSkillCommand("show me the never-delete skill")).toBeNull();
  });

  it("parses @agent mentions only at the start of a turn", () => {
    expect(parseAgentCommand("@leads How many leads are open?")).toEqual({
      name: "leads",
      task: "How many leads are open?",
    });
    expect(parseAgentCommand("@inbox: check waiting conversations")).toEqual({
      name: "inbox",
      task: "check waiting conversations",
    });
    expect(parseAgentCommand("@leads")).toEqual({ name: "leads", task: "" });
    expect(parseAgentCommand("email me at ada@example.test")).toBeNull();
    expect(parseAgentCommand("ask @leads something")).toBeNull();
  });
});
