import { describe, expect, it } from "vitest";
import type { ToolContext, ToolExecutor } from "../loop/types";
import { coordinateTools } from "./coordinator";
import { IdempotencyStore, stableKey } from "./idempotency";
import { RecordLocks, recordKeyFromArgs } from "./locks";
import { verifyWrite } from "./verify";

const ctx: ToolContext = {
  runId: "run_1",
  stepId: 1,
  callId: "c1",
  name: "tool",
  signal: new AbortController().signal,
};

function tool(
  name: string,
  execute: ToolExecutor["execute"],
  inputSchema: ToolExecutor["definition"]["inputSchema"] = {
    type: "object",
    properties: {},
  },
): ToolExecutor {
  return { definition: { name, description: `${name} tool`, inputSchema }, execute };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("RecordLocks", () => {
  it("serializes holders of one record and never overlaps them", async () => {
    const locks = new RecordLocks();
    const order: string[] = [];
    let active = 0;
    let peak = 0;

    await Promise.all(
      ["first", "second", "third"].map((label) =>
        locks.withLock("lead:L-1", async () => {
          active += 1;
          peak = Math.max(peak, active);
          await sleep(3);
          order.push(label);
          active -= 1;
        }),
      ),
    );

    expect(order).toEqual(["first", "second", "third"]);
    expect(peak).toBe(1);
    expect(locks.size).toBe(0);
  });

  it("keeps different records parallel and releases on throw", async () => {
    const locks = new RecordLocks();
    let active = 0;
    let peak = 0;
    const done: string[] = [];

    await Promise.all([
      locks.withLock("lead:A", async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(5);
        active -= 1;
        done.push("a");
      }),
      locks.withLock("lead:B", async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(5);
        active -= 1;
        done.push("b");
      }),
    ]);
    expect(done.sort()).toEqual(["a", "b"]);
    expect(peak).toBe(2);

    await expect(
      locks.withLock("lead:C", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await locks.withLock("lead:C", async () => "reusable");
    expect(locks.size).toBe(0);
  });
});

describe("recordKeyFromArgs", () => {
  it("maps id arguments to a per-record key and creates to null", () => {
    expect(recordKeyFromArgs({ lead_id: "L-1001" })).toBe("lead:L-1001");
    expect(recordKeyFromArgs({ contact_id: "C-1001" })).toBe("contact:C-1001");
    expect(recordKeyFromArgs({ id: "X" })).toBe("record:X");
    expect(recordKeyFromArgs({ name: "Ada", status: "open" })).toBeNull();
  });
});

describe("IdempotencyStore", () => {
  it("collapses identical in-flight calls to one execution", async () => {
    const store = new IdempotencyStore();
    let calls = 0;
    const run = () =>
      store.run("k", async () => {
        calls += 1;
        await sleep(5);
        return { id: "L-1" };
      });

    const [a, b] = await Promise.all([run(), run()]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  it("reuses a completed result only inside the guard window", async () => {
    let clock = 1_000;
    const store = new IdempotencyStore({ ttlMs: 60_000, now: () => clock });
    let calls = 0;
    const run = () =>
      store.run(
        "send",
        async () => {
          calls += 1;
          return { queued: true, call: calls };
        },
        true,
      );

    expect(await run()).toEqual({ queued: true, call: 1 });
    clock += 1_000;
    expect(await run()).toEqual({ queued: true, call: 1 });
    clock += 120_000;
    expect(await run()).toEqual({ queued: true, call: 2 });
    expect(calls).toBe(2);
  });

  it("does not reuse completed results when the guard is off", async () => {
    const store = new IdempotencyStore();
    let calls = 0;
    const run = () =>
      store.run("write", async () => {
        calls += 1;
        return calls;
      });
    await run();
    await run();
    expect(calls).toBe(2);
  });

  it("stableKey ignores argument order", () => {
    expect(stableKey("t", { a: 1, b: 2 })).toBe(stableKey("t", { b: 2, a: 1 }));
    expect(stableKey("t", { a: 1 })).not.toBe(stableKey("t", { a: 2 }));
  });
});

describe("verifyWrite", () => {
  function toolsFixture(): ToolExecutor[] {
    return [
      tool(
        "lead_get",
        async (args) => {
          if (args.lead_id !== "L-1001") throw new Error('No lead with that id.');
          return { id: "L-1001", name: "Ada", status: "open" };
        },
        { type: "object", properties: { lead_id: { type: "string" } }, required: ["lead_id"] },
      ),
      tool("lead_get_plain", async () => ({ anything: true }), {
        type: "object",
        properties: {},
      }),
    ];
  }

  it("reads the written record back through the mapped tool", async () => {
    const map = new Map(toolsFixture().map((entry) => [entry.definition.name, entry]));
    const outcome = await verifyWrite({
      writeTool: "lead_create",
      result: { id: "L-1001", name: "Ada" },
      mapping: { lead_create: "lead_get" },
      tools: map,
      ctx,
    });
    expect(outcome).toEqual({ verified: true });
  });

  it("reports an honest failure when the record cannot be read back", async () => {
    const map = new Map(toolsFixture().map((entry) => [entry.definition.name, entry]));
    const outcome = await verifyWrite({
      writeTool: "lead_create",
      result: { id: "L-404" },
      mapping: { lead_create: "lead_get" },
      tools: map,
      ctx,
    });
    expect(outcome?.verified).toBe(false);
    expect(outcome?.reason).toContain("Read-back failed");
  });

  it("verifies nothing without a mapping or without a record id", async () => {
    const map = new Map(toolsFixture().map((entry) => [entry.definition.name, entry]));
    expect(
      await verifyWrite({
        writeTool: "lead_create",
        result: { id: "L-1001" },
        mapping: {},
        tools: map,
        ctx,
      }),
    ).toBeNull();
    expect(
      await verifyWrite({
        writeTool: "lead_create",
        result: { queued: true },
        mapping: { lead_create: "lead_get" },
        tools: map,
        ctx,
      }),
    ).toBeNull();
  });
});

describe("coordinateTools", () => {
  function fixture() {
    const state = new Map<string, { status: string; updates: number }>();
    state.set("L-1001", { status: "open", updates: 0 });
    state.set("L-2002", { status: "open", updates: 0 });
    let sends = 0;
    let creates = 0;
    let interleaved = false;
    let activeUpdate: string | null = null;

    const tools: ToolExecutor[] = [
      tool("lead_get", async (args) => {
        const record = state.get(String(args.lead_id));
        if (!record) throw new Error("No lead with that id.");
        return { id: String(args.lead_id), ...record };
      }, {
        type: "object",
        properties: { lead_id: { type: "string" } },
        required: ["lead_id"],
      }),
      tool("lead_update_status", async (args) => {
        const id = String(args.lead_id);
        if (activeUpdate !== null && activeUpdate !== id) interleaved = true;
        activeUpdate = id;
        const record = state.get(id);
        if (!record) throw new Error("No lead with that id.");
        await sleep(5);
        record.status = String(args.status);
        record.updates += 1;
        activeUpdate = null;
        return { id, status: record.status, updates: record.updates };
      }, {
        type: "object",
        properties: { lead_id: { type: "string" }, status: { type: "string" } },
        required: ["lead_id", "status"],
      }),
      tool("lead_create", async (args) => {
        creates += 1;
        await sleep(5);
        return { id: `L-${9000 + creates}`, name: String(args.name ?? "New") };
      }),
      tool("send_email", async () => {
        sends += 1;
        return { queued: true, message_id: `msg_${sends}`, sends };
      }),
      tool("lead_delete", async () => ({ deleted: true })),
    ];
    return {
      state,
      tools,
      counters: {
        sends: () => sends,
        creates: () => creates,
        interleaved: () => interleaved,
      },
    };
  }

  it("leaves reads and destructive tools untouched", () => {
    const { tools } = fixture();
    const coordinated = coordinateTools(tools);
    expect(coordinated[0]).toBe(tools[0]);
    expect(coordinated.find((entry) => entry.definition.name === "lead_delete")).toBe(
      tools.find((entry) => entry.definition.name === "lead_delete"),
    );
  });

  it("serializes concurrent changes to one record and loses none", async () => {
    const { tools, state, counters } = fixture();
    const [leadGet, update] = coordinateTools(tools).reduce(
      (acc, entry) => {
        if (entry.definition.name === "lead_get") acc[0] = entry;
        if (entry.definition.name === "lead_update_status") acc[1] = entry;
        return acc;
      },
      [null as ToolExecutor | null, null as ToolExecutor | null],
    );

    await Promise.all([
      update!.execute({ lead_id: "L-1001", status: "nurturing" }, ctx),
      update!.execute({ lead_id: "L-1001", status: "closed" }, ctx),
    ]);

    const record = state.get("L-1001")!;
    expect(record.updates).toBe(2);
    expect(record.status).toBe("closed");
    expect(counters.interleaved()).toBe(false);
    const readBack = await leadGet!.execute({ lead_id: "L-1001" }, ctx);
    expect(readBack).toMatchObject({ status: "closed", updates: 2 });
  });

  it("keeps different records parallel (no cross-record lock)", async () => {
    const { tools, counters } = fixture();
    const update = coordinateTools(tools).find(
      (entry) => entry.definition.name === "lead_update_status",
    )!;

    await Promise.all([
      update.execute({ lead_id: "L-1001", status: "closed" }, ctx),
      update.execute({ lead_id: "L-2002", status: "closed" }, ctx),
    ]);

    // The fixture flags overlap between *different* records: seeing it proves
    // the two updates ran at the same time instead of queueing on one lock.
    expect(counters.interleaved()).toBe(true);
  });

  it("collapses identical in-flight creates into one record", async () => {
    const { tools, counters } = fixture();
    const create = coordinateTools(tools).find(
      (entry) => entry.definition.name === "lead_create",
    )!;

    const [a, b] = await Promise.all([
      create.execute({ name: "Ada Byron" }, ctx),
      create.execute({ name: "Ada Byron" }, ctx),
    ]);

    expect(counters.creates()).toBe(1);
    expect(a).toEqual(b);
    expect((a as { id: string }).id).toBe("L-9001");
  });

  it("does not send twice: identical sends reuse the result for 10 minutes", async () => {
    let clock = 0;
    const { tools, counters } = fixture();
    const send = coordinateTools(tools, {
      idempotencyOptions: { ttlMs: 10 * 60_000, now: () => clock },
    }).find((entry) => entry.definition.name === "send_email")!;

    const first = await send.execute({ to: "ada@example.test" }, ctx);
    clock += 60_000;
    const second = await send.execute({ to: "ada@example.test" }, ctx);
    expect(second).toEqual(first);
    expect(counters.sends()).toBe(1);

    clock += 11 * 60_000;
    await send.execute({ to: "ada@example.test" }, ctx);
    expect(counters.sends()).toBe(2);
  });

  it("stamps an honest verified flag through the verify mapping", async () => {
    const { tools } = fixture();
    const coordinated = coordinateTools(tools, {
      verifyWith: { lead_create: "lead_get", lead_update_status: "lead_get" },
    });
    const create = coordinated.find((entry) => entry.definition.name === "lead_create")!;
    const update = coordinated.find(
      (entry) => entry.definition.name === "lead_update_status",
    )!;

    const created = (await create.execute({ name: "New Lead" }, ctx)) as Record<string, unknown>;
    // The fixture's lead_get only knows L-1001, so the new id cannot be read back.
    expect(created.verified).toBe(false);
    expect(String(created.verified_note)).toContain("Read-back failed");

    const updated = (await update.execute(
      { lead_id: "L-1001", status: "nurturing" },
      ctx,
    )) as Record<string, unknown>;
    expect(updated.verified).toBe(true);
    expect(updated.status).toBe("nurturing");
  });
});
