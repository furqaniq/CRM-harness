import { useSyncExternalStore } from "react";
import type { TokenUsage } from "@/core/loop/types";

/**
 * Session token meter for the side panel.
 *
 * The bar's denominator is a placeholder session budget until workspace spend
 * caps land in M7 (spec section 4: "spend caps; feeds the token meter"). Used,
 * runs and cost are real: they are recorded from each run's `run_end` event.
 */
export const SESSION_TOKEN_BUDGET = 100_000;

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  runs: number;
}

export interface TokenMeter {
  yourUsed: number;
  yourLimit: number;
  runs: number;
  costUsd: number;
}

export const EMPTY_SESSION_USAGE: SessionUsage = {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  runs: 0,
};

export function totalTokens(usage: Pick<SessionUsage, "inputTokens" | "outputTokens">): number {
  return usage.inputTokens + usage.outputTokens;
}

export function recordRun(
  current: SessionUsage,
  run: { usage: TokenUsage; costUsd: number },
): SessionUsage {
  return {
    inputTokens: current.inputTokens + run.usage.inputTokens,
    outputTokens: current.outputTokens + run.usage.outputTokens,
    costUsd: current.costUsd + run.costUsd,
    runs: current.runs + 1,
  };
}

export function meterFromSession(usage: SessionUsage): TokenMeter {
  return {
    yourUsed: totalTokens(usage),
    yourLimit: SESSION_TOKEN_BUDGET,
    runs: usage.runs,
    costUsd: usage.costUsd,
  };
}

export function usedPercent(meter: Pick<TokenMeter, "yourUsed" | "yourLimit">): number {
  if (meter.yourLimit <= 0) return 0;
  return Math.min(100, Math.round((meter.yourUsed / meter.yourLimit) * 100));
}

export function formatTokens(value: number): string {
  return value.toLocaleString("en-US");
}

let snapshot: SessionUsage = EMPTY_SESSION_USAGE;
const listeners = new Set<() => void>();

export function getSessionUsage(): SessionUsage {
  return snapshot;
}

export function subscribeSessionUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordSessionRun(run: { usage: TokenUsage; costUsd: number }): void {
  snapshot = recordRun(snapshot, run);
  for (const listener of listeners) listener();
}

export function resetSessionUsage(): void {
  snapshot = EMPTY_SESSION_USAGE;
  for (const listener of listeners) listener();
}

export function useSessionUsage(): SessionUsage {
  return useSyncExternalStore(subscribeSessionUsage, getSessionUsage, getSessionUsage);
}
