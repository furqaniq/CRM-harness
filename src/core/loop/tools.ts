import type { ToolContext, ToolExecutor } from "./types";

export type ParsedArguments =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * The provider hands us raw JSON text; the loop owns parsing so a malformed
 * call becomes a tool error the model can see instead of a thrown exception.
 * An empty payload means "no arguments", which several providers emit.
 */
export function parseArguments(raw: string): ParsedArguments {
  const text = raw.trim();
  if (text === "") return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: `Tool arguments must be a JSON object, got: ${text.slice(0, 200)}` };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

/** Tool output may be a ready string or a value the harness serialises. */
export function toToolContent(output: unknown): string {
  if (output === undefined || output === null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function buildToolMap(tools: ToolExecutor[] | undefined): Map<string, ToolExecutor> {
  const map = new Map<string, ToolExecutor>();
  for (const tool of tools ?? []) map.set(tool.definition.name, tool);
  return map;
}

export function toolContext(
  base: { runId: string; parentRunId?: string; stepId: number; signal: AbortSignal },
  call: { id: string; name: string },
): ToolContext {
  return {
    runId: base.runId,
    ...(base.parentRunId ? { parentRunId: base.parentRunId } : {}),
    stepId: base.stepId,
    callId: call.id,
    name: call.name,
    signal: base.signal,
  };
}
