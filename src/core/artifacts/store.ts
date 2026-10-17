import { summarizeResult } from "./summarize";

/**
 * Large-result artifacts (spec §5 "Large results"): a tool result over the
 * size limit is stored whole, and the model gets a summary plus a handle
 * instead of the raw payload. The spec's start value for the threshold is
 * 20 KB (spec §11 Numbers).
 */
export const ARTIFACT_THRESHOLD_BYTES = 20 * 1024;

export interface ArtifactRecord {
  id: string;
  createdAt: number;
  bytes: number;
  /** Plain-language description of the payload (how many items, what kind). */
  summary: string;
  /** Exact item count when the payload is a list; undefined otherwise. */
  itemCount?: number;
  content: string;
  sourceTool?: string;
  runId?: string;
}

export interface ArtifactHandle {
  id: string;
  bytes: number;
  summary: string;
  itemCount?: number;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

let artifactSequence = 0;

/**
 * In-process artifact store. Handles stay valid for the life of the server
 * process; persistence (and therefore cross-restart reads) arrives with
 * storage — recorded as a known gap until then.
 */
export class ArtifactStore {
  private records = new Map<string, ArtifactRecord>();

  create(input: {
    content: string;
    summary: string;
    itemCount?: number;
    sourceTool?: string;
    runId?: string;
    now?: () => number;
  }): ArtifactHandle {
    artifactSequence += 1;
    const id = `art_${Date.now().toString(36)}_${artifactSequence.toString(36)}`;
    const record: ArtifactRecord = {
      id,
      createdAt: (input.now ?? Date.now)(),
      bytes: byteLength(input.content),
      summary: input.summary,
      ...(input.itemCount !== undefined ? { itemCount: input.itemCount } : {}),
      content: input.content,
      ...(input.sourceTool !== undefined ? { sourceTool: input.sourceTool } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
    };
    this.records.set(id, record);
    return {
      id,
      bytes: record.bytes,
      summary: record.summary,
      ...(record.itemCount !== undefined ? { itemCount: record.itemCount } : {}),
    };
  }

  get(id: string): ArtifactRecord | null {
    return this.records.get(id) ?? null;
  }

  count(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
  }
}

export function createArtifactStore(): ArtifactStore {
  return new ArtifactStore();
}

/** 270.4 KB, 1.2 MB — one decimal for KB, none above, so traces stay short. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** The tool the model uses to fetch an artifact back in slices. */
export const READ_ARTIFACT_TOOL_NAME = "read_artifact";

export interface Artifactized {
  /** Model-facing tool result: summary + handle, never the payload itself. */
  message: string;
  handle: ArtifactHandle;
}

/**
 * Stores `content` when it is over the threshold and returns the short
 * message the model sees instead; null means the result fits and should pass
 * through untouched. The message gives the exact item count when one is
 * derivable, a preview, and the handle to read the full result back.
 */
export function artifactizeResult(
  store: ArtifactStore,
  input: { content: string; toolName: string; runId: string; threshold?: number },
): Artifactized | null {
  const threshold = input.threshold ?? ARTIFACT_THRESHOLD_BYTES;
  if (byteLength(input.content) <= threshold) return null;

  const { summary, itemCount, preview } = summarizeResult(input.content);
  const handle = store.create({
    content: input.content,
    summary,
    ...(itemCount !== undefined ? { itemCount } : {}),
    sourceTool: input.toolName,
    runId: input.runId,
  });
  const count = itemCount !== undefined ? ` — ${itemCount.toLocaleString("en-US")} items` : "";
  const message = [
    `Large result stored as artifact ${handle.id} (${formatBytes(handle.bytes)}${count}): ${summary}.`,
    `Preview: ${preview}`,
    `Only this summary is in your context; the full payload is not. Call ${READ_ARTIFACT_TOOL_NAME} with handle "${handle.id}" to read it in slices (offset/limit).`,
  ].join("\n");
  return { message, handle };
}
