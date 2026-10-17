import type { ToolContext, ToolExecutor } from "../loop/types";
import { inferToolClass } from "../tools/classify";
import { IdempotencyStore, stableKey, type IdempotencyOptions } from "./idempotency";
import { RecordLocks, recordKeyFromArgs } from "./locks";
import { verifyWrite, type VerifyMapping } from "./verify";

export interface CoordinatorOptions {
  /** Shared per-record locks; one map is created when none is passed. */
  locks?: RecordLocks;
  /** Shared idempotency store; one is created when none is passed. */
  idempotency?: IdempotencyStore;
  /** Per-tool verify-with mapping (write tool → read tool). */
  verifyWith?: VerifyMapping;
  /** TTL for the identical-send guard (default: 10 minutes). */
  idempotencyOptions?: IdempotencyOptions;
}

/**
 * Write coordination (spec §4): wrap every write/live-effect tool with
 * per-record locking, idempotency and read-after-write verification.
 *
 * - Reads and destructive tools pass through untouched (destructive calls are
 *   the policy engine's problem, not the coordinator's).
 * - Identical in-flight calls collapse to one execution; identical completed
 *   live-effect calls (sends) return the earlier result for the guard window.
 * - Calls that name a record (`lead_id`, `contact_id`, `id`) take that
 *   record's lock, so concurrent changes serialize and none is lost.
 * - When a verify mapping exists, the mapped read tool runs against the
 *   written record and the model-visible result gains an honest `verified`
 *   flag (true only when the read-back matched).
 */
export function coordinateTools(
  tools: readonly ToolExecutor[],
  options: CoordinatorOptions = {},
): ToolExecutor[] {
  const locks = options.locks ?? new RecordLocks();
  const idempotency =
    options.idempotency ??
    new IdempotencyStore(options.idempotencyOptions ?? {});
  const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));

  return tools.map((tool) => {
    const name = tool.definition.name;
    const toolClass = inferToolClass({ name, description: tool.definition.description });
    if (toolClass === "read" || toolClass === "destructive") return tool;

    const reuseCompleted = toolClass === "live-effect";

    return {
      definition: tool.definition,
      async execute(args: Record<string, unknown>, ctx: ToolContext) {
        const call = async (): Promise<unknown> => {
          const body = async (): Promise<unknown> => {
            const result = await tool.execute(args, ctx);
            return stampVerification(name, result, options.verifyWith, byName, ctx);
          };
          const recordKey = recordKeyFromArgs(args);
          return recordKey === null ? body() : locks.withLock(recordKey, body);
        };
        return idempotency.run(stableKey(name, args), call, reuseCompleted);
      },
    };
  });
}

async function stampVerification(
  writeTool: string,
  result: unknown,
  mapping: VerifyMapping | undefined,
  tools: ReadonlyMap<string, ToolExecutor>,
  ctx: ToolContext,
): Promise<unknown> {
  if (mapping === undefined) return result;
  const outcome = await verifyWrite({ writeTool, result, mapping, tools, ctx });
  if (outcome === null) return result;
  if (result === null || typeof result !== "object") return result;
  return {
    ...(result as Record<string, unknown>),
    verified: outcome.verified,
    ...(outcome.verified || outcome.reason === undefined
      ? {}
      : { verified_note: outcome.reason }),
  };
}
