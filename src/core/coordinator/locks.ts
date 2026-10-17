/**
 * Per-record locking (spec §4 Write coordinator): "several changes to one
 * record serialize and none is lost." Each record key gets a promise chain;
 * waiters run in arrival order and the chain is pruned when the last holder
 * finishes so the map cannot grow without bound.
 */
export class RecordLocks {
  private readonly chains = new Map<string, Promise<unknown>>();

  get size(): number {
    return this.chains.size;
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const waited = previous.then(
      () => undefined,
      () => undefined,
    );
    const result = waited.then(() => fn());
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.chains.get(key) === tail) this.chains.delete(key);
    }
  }
}

/**
 * Lock key for one record from a tool's arguments: the first `<module>_id`
 * (or `id`) string value, so `lead_update_status { lead_id }` and
 * `lead_transfer { lead_id }` land on the same `lead:L-1001` lock while other
 * records stay parallel. Returns null when the call names no record (creates).
 */
export function recordKeyFromArgs(args: Record<string, unknown>): string | null {
  const direct = args.id;
  if (typeof direct === "string" && direct !== "") return `record:${direct}`;
  for (const [key, value] of Object.entries(args)) {
    if (!key.endsWith("_id")) continue;
    if (typeof value === "string" && value !== "") {
      return `${key.replace(/_id$/, "")}:${value}`;
    }
    if (typeof value === "number") return `${key.replace(/_id$/, "")}:${String(value)}`;
  }
  return null;
}
