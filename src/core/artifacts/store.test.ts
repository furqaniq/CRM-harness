import { describe, expect, it } from "vitest";
import {
  ARTIFACT_THRESHOLD_BYTES,
  artifactizeResult,
  byteLength,
  createArtifactStore,
  formatBytes,
} from "./store";

const pad = (text: string, size: number) => text.padEnd(size, " ");

describe("byteLength and formatBytes", () => {
  it("measures UTF-8 bytes, not UTF-16 units", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("é")).toBe(2);
  });

  it("formats sizes the way traces show them", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(20 * 1024)).toBe("20.0 KB");
    expect(formatBytes(270.44 * 1024)).toBe("270.4 KB");
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1.2 MB");
  });
});

describe("ArtifactStore", () => {
  it("stores content and returns a handle with the summary and size", () => {
    const store = createArtifactStore();
    const handle = store.create({
      content: "automation list payload",
      summary: "a list of 3 items",
      itemCount: 3,
      sourceTool: "automation_list",
      runId: "run_1",
    });

    expect(handle.id).toMatch(/^art_/);
    expect(handle.bytes).toBe(byteLength("automation list payload"));
    expect(handle.itemCount).toBe(3);
    expect(store.count()).toBe(1);

    const record = store.get(handle.id);
    expect(record).not.toBeNull();
    expect(record?.content).toBe("automation list payload");
    expect(record?.sourceTool).toBe("automation_list");
    expect(record?.runId).toBe("run_1");
    expect(store.get("art_missing")).toBeNull();
  });
});

describe("artifactizeResult", () => {
  const store = () => createArtifactStore();

  it("passes results at or under the threshold through untouched", () => {
    const under = pad("x", ARTIFACT_THRESHOLD_BYTES);
    expect(artifactizeResult(store(), { content: under, toolName: "t", runId: "r" })).toBeNull();

    const at = "x".repeat(ARTIFACT_THRESHOLD_BYTES);
    expect(artifactizeResult(store(), { content: at, toolName: "t", runId: "r" })).toBeNull();
  });

  it("stores an oversized list with its exact count and a short message", () => {
    const items = Array.from({ length: 1_044 }, (_, i) => ({
      id: `auto_${i}`,
      name: `Automation ${i}`,
      note: "n".repeat(250),
    }));
    const payload = JSON.stringify(items);
    expect(byteLength(payload)).toBeGreaterThan(270 * 1024);

    const stores = store();
    const handled = artifactizeResult(stores, {
      content: payload,
      toolName: "automation_list",
      runId: "run_9",
    });

    expect(handled).not.toBeNull();
    if (!handled) throw new Error("expected an artifact");
    expect(handled.handle.itemCount).toBe(1_044);
    expect(handled.message).toContain(handled.handle.id);
    expect(handled.message).toContain("1,044 items");
    expect(handled.message.length).toBeLessThan(1_500);
    expect(handled.message).not.toContain(payload.slice(500, 800));
    expect(stores.get(handled.handle.id)?.content).toBe(payload);
  });

  it("honours a custom threshold", () => {
    const handled = artifactizeResult(store(), {
      content: "1234567890",
      toolName: "t",
      runId: "r",
      threshold: 5,
    });
    expect(handled?.handle.bytes).toBe(10);
  });
});
