/**
 * Merges a parent event stream with side-channel events pushed while the
 * parent is mid-flight (subagent trace fan-in). The chat route pulls one
 * merged event per SSE frame, so a child lane streams live during the
 * parent's tool call instead of arriving as one dump when it finishes.
 */
export class EventMux<T> {
  private readonly queue: T[] = [];
  private release: () => void = () => {};
  private notify: Promise<void>;

  constructor() {
    this.notify = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  /** Accepts events from any time, including before the first pull. */
  push(item: T): void {
    this.queue.push(item);
    const wake = this.release;
    this.notify = new Promise<void>((resolve) => {
      this.release = resolve;
    });
    wake();
  }

  /**
   * Yields queued side-channel events as they land, interleaved with the
   * parent's own events in arrival order, and ends when the parent is done
   * and the queue is drained. Closing this generator closes the parent.
   */
  async *merge(parent: AsyncIterator<T, unknown>): AsyncGenerator<T, void, void> {
    let parentDone = false;
    let pending: Promise<IteratorResult<T, unknown>> | null = null;
    try {
      for (;;) {
        if (this.queue.length > 0) {
          yield this.queue.shift()!;
          continue;
        }
        if (parentDone) return;
        pending ??= parent.next();
        const raced = await Promise.race([
          pending.then((result) => ({ from: "parent" as const, result })),
          this.notify.then(() => ({ from: "push" as const })),
        ]);
        if (raced.from === "push") continue;
        pending = null;
        if (raced.result.done) {
          parentDone = true;
          continue;
        }
        yield raced.result.value;
      }
    } finally {
      try {
        await parent.return?.(undefined);
      } catch {
        /* the parent is already closed or failed; nothing left to release */
      }
    }
  }
}
