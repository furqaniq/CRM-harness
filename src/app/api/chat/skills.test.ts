import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LoopEvent } from "@/core/loop/types";
import { bodyToChunks, parseTransportFrame, readSse } from "@/core/events/sse";
import { POST } from "./route";

const SKILL = `---
name: starter
description: A starter skill for the chat test.
---

Follow the starter guidance exactly.
`;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maple-chat-skills-"));
  await mkdir(path.join(dir, "starter"), { recursive: true });
  await writeFile(path.join(dir, "starter", "SKILL.md"), SKILL, "utf8");
  process.env.MAPLE_SKILLS_DIR = dir;
});

afterAll(async () => {
  delete process.env.MAPLE_SKILLS_DIR;
  await rm(dir, { recursive: true, force: true });
});

async function chat(prompt: string): Promise<{ events: LoopEvent[]; text: string }> {
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    }),
  );
  expect(response.ok).toBe(true);
  if (!response.body) throw new Error("no stream");

  const events: LoopEvent[] = [];
  let text = "";
  for await (const frame of readSse(bodyToChunks(response.body))) {
    const parsed = parseTransportFrame(frame.data);
    if (!parsed) continue;
    if (parsed.type === "stream_end" || parsed.type === "stream_error") continue;
    events.push(parsed);
    if (parsed.type === "text_delta") text += parsed.text;
  }
  return { events, text };
}

describe("skills in chat", () => {
  it("loads a skill body on demand instead of putting it in the prompt", async () => {
    const { events, text } = await chat("use the starter skill");

    const calls = events.filter((event) => event.type === "tool_start");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "tool_start", name: "read_skill" });

    const results = events.filter((event) => event.type === "tool_result");
    expect(results).toHaveLength(1);
    expect(results[0].type === "tool_result" ? results[0].content : "").toContain(
      "Follow the starter guidance exactly.",
    );

    expect(text).toContain('Loaded the "starter" skill');
  });

  it("pre-injects a skill for one turn with the /skill command", async () => {
    const { events, text } = await chat("/skill starter");

    expect(events.some((event) => event.type === "tool_start")).toBe(false);
    expect(text).toContain('Following the "starter" skill for this turn');
  });
});
