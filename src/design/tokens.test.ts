import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BORDER, COLORS, LAYOUT, RING_GRADIENT } from "./tokens";

const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/0\.(\d)/g, ".$1");
}

describe("design tokens", () => {
  it("declares every color token in globals.css with the same value", () => {
    for (const [name, value] of Object.entries(COLORS)) {
      const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
      expect(match, `token --${name} missing from globals.css`).toBeTruthy();
      expect(normalized(match![1])).toBe(normalized(value));
    }
  });

  it("declares the border token", () => {
    const match = css.match(/--bd:\s*([^;]+);/);
    expect(match).toBeTruthy();
    expect(normalized(match![1])).toBe(normalized(BORDER));
  });

  it("declares the prompt ring gradient", () => {
    const match = css.match(/--ring:\s*([^;]+);/);
    expect(match).toBeTruthy();
    expect(normalized(match![1])).toBe(normalized(RING_GRADIENT));
  });

  it("maps tokens into the Tailwind theme", () => {
    for (const name of Object.keys(COLORS)) {
      expect(css).toContain(`--color-${name}: var(--${name})`);
    }
    expect(css).toContain("--color-bd: var(--bd)");
  });

  it("exposes a 64px rail and 260px panel", () => {
    expect(LAYOUT).toEqual({ rail: 64, panel: 260 });
  });

  it("uses a dark color scheme", () => {
    expect(css).toContain("color-scheme: dark");
  });
});
