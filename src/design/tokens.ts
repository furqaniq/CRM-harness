/**
 * Design tokens from spec section 1, mirrored from src/app/globals.css.
 * tokens.test.ts asserts the CSS file carries the same values.
 */
export const COLORS = {
  /** Black canvas */
  bg: "#0c0d10",
  /** Surface */
  s1: "#121417",
  s2: "#16181c",
  /** CRM rail */
  s3: "#1e2126",
  /** Hover */
  s4: "#2c3037",
  /** CRM orange (primary accent) */
  o5: "#f09830",
  o4: "#f29b34",
  /** CRM light */
  o3: "#f5b365",
  o6: "#e08818",
  /** Ring yellow */
  y4: "#f7c948",
  /** Text */
  tx: "#f4f1ed",
  dim: "#a8a29a",
  faint: "#6f6a64",
  ok: "#22a06b",
  bad: "#e5484d",
  info: "#4c8dff",
} as const;

export const BORDER = "rgba(255, 255, 255, 0.08)";

/** Yellow-to-orange gradient ring around the prompt box. */
export const RING_GRADIENT =
  "linear-gradient(135deg, #f7c948, #f09830 55%, #e8761a)";

/** Layout constants from spec section 1. */
export const LAYOUT = {
  /** Icon rail width */
  rail: 64,
  /** Collapsible panel width */
  panel: 260,
} as const;
