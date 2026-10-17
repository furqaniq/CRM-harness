import { describe, expect, it } from "vitest";
import { EventMux } from "./mux";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function collect<T>(merged: AsyncGenerator<T, void, void>): Promise<T[]> {
  const items: T[] = [];
  let next = await merged.next();
  while (!next.done) {
    items.push(next.value);
    next = await merged.next();
  }
  return items;
}

describe("EventMux", () => {
  it("interleaves side-channel events while the parent is mid-flight", async () => {
    const mux = new EventMux<number>();
    async function* parent(): AsyncGenerator<number> {
      yield 1;
      await sleep(40);
      yield 2;
      return;
    }
    const merged = mux.merge(parent());

    const seen: number[] = [];
    const pull = async () => {
      const next = await merged.next();
      if (!next.done) seen.push(next.value);
    };

    await pull(); // 1
    setTimeout(() => mux.push(9), 5);
    await pull(); // 9 arrives while the parent's timer is pending, before 2
    await pull(); // 2
    const rest = await collect(merged);

    expect(seen).toEqual([1, 9, 2]);
    expect(rest).toEqual([]);
  });

  it("drains events pushed before the first pull, then runs the parent", async () => {
    const mux = new EventMux<string>();
    mux.push("early");
    async function* parent(): AsyncGenerator<string> {
      yield "parent";
      return;
    }

    expect(await collect(mux.merge(parent()))).toEqual(["early", "parent"]);
  });

  it("keeps queue order when several events land between pulls", async () => {
    const mux = new EventMux<number>();
    const gate = deferred();
    async function* parent(): AsyncGenerator<number> {
      yield 0;
      await gate.promise;
      yield 100;
      return;
    }
    const merged = mux.merge(parent());

    const seen: number[] = [];
    const first = await merged.next();
    if (!first.done) seen.push(first.value);
    mux.push(1);
    mux.push(2);
    mux.push(3);
    gate.resolve();
    seen.push(...(await collect(merged)));

    expect(seen).toEqual([0, 1, 2, 3, 100]);
  });

  it("ends only after the parent is done and the queue is empty", async () => {
    const mux = new EventMux<number>();
    async function* parent(): AsyncGenerator<number> {
      yield 1;
      return;
    }
    const merged = mux.merge(parent());

    expect((await merged.next()).value).toBe(1);
    // A late child event must still stream out before the merge ends.
    mux.push(3);
    expect((await merged.next()).value).toBe(3);
    expect((await merged.next()).done).toBe(true);
  });

  it("closes the parent when the merge is closed early", async () => {
    const mux = new EventMux<number>();
    let closed = false;
    async function* parent(): AsyncGenerator<number> {
      try {
        yield 1;
        yield 2;
        yield 3;
      } finally {
        closed = true;
      }
    }
    const merged = mux.merge(parent());

    await merged.next();
    await merged.return(undefined);
    expect(closed).toBe(true);
    expect((await merged.next()).done).toBe(true);
  });

  it("propagates a parent failure to the consumer", async () => {
    const mux = new EventMux<number>();
    async function* parent(): AsyncGenerator<number> {
      yield 1;
      throw new Error("parent exploded");
    }
    const merged = mux.merge(parent());

    await expect(merged.next()).resolves.toMatchObject({ value: 1, done: false });
    await expect(merged.next()).rejects.toThrow("parent exploded");
  });
});
