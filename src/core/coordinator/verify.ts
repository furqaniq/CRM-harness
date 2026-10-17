import type { ToolContext, ToolExecutor } from "../loop/types";

/** Per-tool "verify with" mapping: write tool → the read tool that proves it. */
export type VerifyMapping = Record<string, string>;

export interface VerifyOutcome {
  verified: boolean;
  /** Plain language, kept next to the result when verification fails. */
  reason?: string;
}

/**
 * Automatic read-after-write verification (spec §4 Write coordinator). The
 * read tool's argument name comes from its own input schema (first `*_id` or
 * `id` property), so mappings stay data — no per-tool code. Returns null when
 * there is nothing to verify (no mapping, or the write named no record), so
 * the coordinator can leave the result untouched.
 */
export async function verifyWrite(options: {
  writeTool: string;
  result: unknown;
  mapping: VerifyMapping;
  tools: ReadonlyMap<string, ToolExecutor>;
  ctx: ToolContext;
}): Promise<VerifyOutcome | null> {
  const readName = options.mapping[options.writeTool];
  if (readName === undefined) return null;

  const recordId = recordIdOf(options.result);
  if (recordId === null) return null;

  const readTool = options.tools.get(readName);
  if (readTool === undefined) {
    return {
      verified: false,
      reason: `Verification could not run: read tool "${readName}" is not available.`,
    };
  }

  const idProperty = schemaIdProperty(readTool);
  if (idProperty === null) {
    return {
      verified: false,
      reason: `Verification could not run: "${readName}" exposes no id argument.`,
    };
  }

  let readResult: unknown;
  try {
    readResult = await readTool.execute({ [idProperty]: recordId }, {
      ...options.ctx,
      name: readName,
    });
  } catch (error) {
    return {
      verified: false,
      reason: `Read-back failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (readResult === null || typeof readResult !== "object") {
    return { verified: false, reason: "Read-back returned nothing for that record." };
  }

  const readId = recordIdOf(readResult);
  if (readId !== null && readId !== recordId) {
    return {
      verified: false,
      reason: `Read-back returned a different record (${readId}).`,
    };
  }
  return { verified: true };
}

/** First id-shaped property the read tool's schema accepts: `lead_id`, `id`. */
function schemaIdProperty(readTool: ToolExecutor): string | null {
  const schema = readTool.definition.inputSchema;
  const properties = schema.properties;
  if (!properties) return null;
  if (typeof properties.id !== "undefined") return "id";
  for (const key of Object.keys(properties)) {
    if (key.endsWith("_id")) return key;
  }
  return null;
}

/** The record id a write result names: `id`, `record.id`, or any `*_id`. */
function recordIdOf(result: unknown): string | null {
  if (result === null || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const direct = record.id;
  if (typeof direct === "string" && direct !== "") return direct;
  if (typeof direct === "number") return String(direct);
  for (const [key, value] of Object.entries(record)) {
    if (!key.endsWith("_id")) continue;
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number") return String(value);
  }
  for (const nested of ["record", "result", "lead", "contact", "customer", "created", "updated"]) {
    const inner = record[nested];
    if (inner !== null && typeof inner === "object") {
      const innerId = (inner as Record<string, unknown>).id;
      if (typeof innerId === "string" && innerId !== "") return innerId;
    }
  }
  return null;
}
