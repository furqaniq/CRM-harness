import { describe, expect, it } from "vitest";
import { createArtifactStore } from "./store";
import { readArtifactTool } from "./tool";

function seed(store = createArtifactStore(), content = "abcdefghij") {
  const handle = store.create({ content, summary: "a list of 2 items", itemCount: 2 });
  return { store, handle, tool: readArtifactTool(store) };
}

async function read(
  tool: ReturnType<typeof readArtifactTool>,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const output = await tool.execute(args, {
    runId: "r",
    stepId: 1,
    callId: "c1",
    name: "read_artifact",
    signal: new AbortController().signal,
  });
  return output as Record<string, unknown>;
}

describe("readArtifactTool", () => {
  it("returns the default window from the start", async () => {
    const { tool, handle } = seed(createArtifactStore(), "x".repeat(30_000));
    const slice = await read(tool, { handle: handle.id, offset: undefined });
    expect(slice.offset).toBe(0);
    expect(slice.returnedChars).toBe(8_000);
    expect(slice.nextOffset).toBe(8_000);
    expect(slice.content).toHaveLength(8_000);
  });

  it("pages through with offset and reports the end", async () => {
    const { tool, handle } = seed();
    const first = await read(tool, { handle: handle.id, offset: 0, limit: 4 });
    expect(first.content).toBe("abcd");
    expect(first.nextOffset).toBe(4);

    const last = await read(tool, { handle: handle.id, offset: 4, limit: 100 });
    expect(last.content).toBe("efghij");
    expect(last.nextOffset).toBeNull();
    expect(last.itemCount).toBe(2);
    expect(last.summary).toBe("a list of 2 items");
  });

  it("clamps limit to one window and offset to the payload", async () => {
    const { tool, handle } = seed();
    const clamped = await read(tool, { handle: handle.id, limit: 10_000_000 });
    expect(clamped.returnedChars).toBe(10);

    const past = await read(tool, { handle: handle.id, offset: 999 });
    expect(past.content).toBe("");
    expect(past.nextOffset).toBeNull();
  });

  it("refuses a missing or unknown handle in plain language", async () => {
    const { tool } = seed();
    await expect(read(tool, { handle: "" })).rejects.toThrow(/needs a "handle"/);
    await expect(read(tool, { handle: "art_missing" })).rejects.toThrow(/Unknown artifact handle/);
    await expect(read(tool, {})).rejects.toThrow(/needs a "handle"/);
  });
});
