import { describe, expect, it } from "vitest";
import { summarizeResult } from "./summarize";

describe("summarizeResult", () => {
  it("counts a JSON array exactly", () => {
    const summary = summarizeResult(JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]));
    expect(summary.summary).toBe("a list of 3 items");
    expect(summary.itemCount).toBe(3);
    expect(summary.preview).toContain('"id":1');
  });

  it("counts a list field inside an object", () => {
    const summary = summarizeResult(
      JSON.stringify({ total: 142, results: [{ id: "a" }, { id: "b" }] }),
    );
    expect(summary.summary).toBe('an object whose "results" holds 2 items');
    expect(summary.itemCount).toBe(2);
  });

  it("describes an object without a list field", () => {
    const summary = summarizeResult(JSON.stringify({ name: "Maple", branches: 3 }));
    expect(summary.summary).toBe("a JSON object with 2 fields");
    expect(summary.itemCount).toBeUndefined();
  });

  it("describes text by its line count", () => {
    const summary = summarizeResult("one\ntwo\nthree");
    expect(summary.summary).toBe("3 lines of text");
    expect(summary.preview).toBe("one\ntwo\nthree");
  });

  it("handles empty output and JSON that is not a structure", () => {
    expect(summarizeResult("").summary).toBe("empty output");
    expect(summarizeResult("   ").summary).toBe("empty output");
    expect(summarizeResult("123").summary).toBe("1 line of text");
    expect(summarizeResult("[not json").summary).toBe("1 line of text");
  });

  it("clips the preview at 300 characters", () => {
    const summary = summarizeResult("y".repeat(500));
    expect(summary.preview.length).toBe(301);
    expect(summary.preview.endsWith("…")).toBe(true);
  });
});
