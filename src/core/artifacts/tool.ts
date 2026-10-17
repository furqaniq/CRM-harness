import type { ToolExecutor } from "../loop/types";
import { READ_ARTIFACT_TOOL_NAME, type ArtifactStore } from "./store";

/** One read never returns more than the artifact threshold, so a fetch stays small. */
const MAX_WINDOW_CHARS = 20_000;
const DEFAULT_WINDOW_CHARS = 8_000;

/**
 * The read-artifact tool (spec §5: "offer a read-artifact tool"). Slices the
 * stored payload by character offset so a 270 KB result comes back in windows
 * instead of one giant context hit. It is classed `read` by inference, so
 * policy lets it run anywhere other read tools run.
 */
export function readArtifactTool(store: ArtifactStore): ToolExecutor {
  return {
    definition: {
      name: READ_ARTIFACT_TOOL_NAME,
      description:
        "Read a stored artifact (a large tool result) in slices. Pass the handle from the large-result message, plus offset and limit to page through it.",
      inputSchema: {
        type: "object",
        properties: {
          handle: { type: "string", description: "Artifact handle, e.g. art_abc_3" },
          offset: { type: "number", description: "Character offset to start at (default 0)" },
          limit: { type: "number", description: `Maximum characters to return (default ${DEFAULT_WINDOW_CHARS}, max ${MAX_WINDOW_CHARS})` },
        },
        required: ["handle"],
      },
    },
    execute(args) {
      const handle = typeof args.handle === "string" ? args.handle.trim() : "";
      if (handle === "") {
        throw new Error('read_artifact needs a "handle" string from the large-result message.');
      }
      const record = store.get(handle);
      if (!record) {
        throw new Error(
          `Unknown artifact handle "${handle}". Handles come from a large tool result and last until the server restarts.`,
        );
      }

      const offset = clampInt(args.offset, 0, record.content.length, 0);
      const limit = clampInt(args.limit, 1, MAX_WINDOW_CHARS, DEFAULT_WINDOW_CHARS);
      const content = record.content.slice(offset, offset + limit);
      const nextOffset = offset + content.length;

      return {
        handle: record.id,
        bytes: record.bytes,
        summary: record.summary,
        ...(record.itemCount !== undefined ? { itemCount: record.itemCount } : {}),
        offset,
        returnedChars: content.length,
        nextOffset: nextOffset < record.content.length ? nextOffset : null,
        content,
      };
    },
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}
