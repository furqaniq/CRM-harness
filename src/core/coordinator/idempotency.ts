/**
 * Idempotency (spec §4 Write coordinator): identical in-flight calls collapse
 * to one execution, and live-effect calls (sends) get a ten-minute guard so
 * an identical resend returns the earlier result instead of sending twice.
 */

/** Stable JSON: keys sorted so argument order never changes the identity. */
export function stableKey(...parts: unknown[]): string {
  return JSON.stringify(canonicalize(parts));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  return value;
}

interface CompletedEntry {
  at: number;
  result: unknown;
}

export interface IdempotencyOptions {
  /** Guard window for completed identical calls (spec: 10 minutes). */
  ttlMs?: number;
  /** Injectable clock so the guard is testable. */
  now?: () => number;
}

/** Spec default: 10-minute identical-send guard. */
export const SEND_GUARD_TTL_MS = 10 * 60_000;

export class IdempotencyStore {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly completed = new Map<string, CompletedEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: IdempotencyOptions = {}) {
    this.ttlMs = options.ttlMs ?? SEND_GUARD_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Run `fn` under the key.
   * - An identical call that is still running returns its promise: the two
   *   callers share one execution (collapse to one create).
   * - When `reuseCompleted` is set, an identical call finished inside the TTL
   *   returns the earlier result without executing (the send guard).
   */
  async run<T>(key: string, fn: () => Promise<T>, reuseCompleted = false): Promise<T> {
    this.prune();

    const existing = this.inflight.get(key);
    if (existing !== undefined) return existing as Promise<T>;

    if (reuseCompleted) {
      const entry = this.completed.get(key);
      if (entry !== undefined && this.now() - entry.at < this.ttlMs) {
        return entry.result as T;
      }
    }

    const promise = fn();
    this.inflight.set(key, promise);
    try {
      const result = await promise;
      this.completed.set(key, { at: this.now(), result });
      return result;
    } finally {
      this.inflight.delete(key);
    }
  }

  private prune(): void {
    if (this.completed.size === 0) return;
    const cutoff = this.now() - this.ttlMs;
    for (const [key, entry] of this.completed) {
      if (entry.at < cutoff) this.completed.delete(key);
    }
  }
}
