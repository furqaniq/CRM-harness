/**
 * Counting semaphore: at most `max` holders at once (spec §11 — max parallel
 * subagents 6). FIFO wake-up so batches cannot starve.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (!Number.isFinite(max) || max < 1) {
      throw new Error(`Semaphore limit must be >= 1, got ${max}`);
    }
  }

  get inFlight(): number {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    return () => this.release();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

/** The spec's default cap (§11 Tunable defaults): six parallel subagents. */
export const DEFAULT_PARALLEL_LIMIT = 6;
