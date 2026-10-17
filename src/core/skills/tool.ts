import type { ToolExecutor } from "../loop/types";
import type { SkillFile } from "./types";

/**
 * The on-demand half of the skills design (spec §4): only names and
 * descriptions sit in the prompt, and the model loads a body by name when the
 * task matches. Read-classed, so policy leaves it on auto.
 */
export function buildReadSkillTool(
  load: (name: string) => Promise<SkillFile | null>,
): ToolExecutor {
  return {
    definition: {
      name: "read_skill",
      description:
        "Load the full guidance of one skill by name. Use when the task matches a skill from the catalog.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The skill name exactly as it appears in the catalog.",
          },
        },
        required: ["name"],
      },
    },
    async execute(args) {
      const name = args.name;
      if (typeof name !== "string" || name.trim() === "") {
        throw new Error('read_skill needs a "name" — use a skill name from the catalog.');
      }
      const skill = await load(name.trim());
      if (skill === null) {
        throw new Error(`No skill named "${name.trim()}" is installed in this workspace.`);
      }
      if (skill.errors.length > 0) {
        throw new Error(`The skill "${skill.name}" is not usable: ${skill.errors.join(" ")}`);
      }
      return { skill: skill.name, description: skill.description, body: skill.body };
    },
  };
}
