/**
 * Summary shown to the model in place of an oversized tool result. It must
 * carry an exact item count whenever one is derivable — the spec's rule is
 * that agents say how many items they actually covered and never claim "all"
 * from a sample — and a short preview so the first row is still visible
 * without fetching the artifact.
 */
export interface ResultSummary {
  /** e.g. "a list of 1,044 items" or "a JSON object with 12 fields". */
  summary: string;
  /** Present only when the payload really is a list. */
  itemCount?: number;
  /** First slice of the payload, bounded so the message stays small. */
  preview: string;
}

const PREVIEW_CHARS = 300;

/** Fields worth looking inside when the payload is an object wrapping a list. */
const LIST_KEYS = ["items", "results", "records", "rows", "data", "list", "entries"];

export function summarizeResult(content: string): ResultSummary {
  const trimmed = content.trim();
  const fallback = { summary: "text", preview: clip(content) };

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return {
          summary: `a list of ${parsed.length.toLocaleString("en-US")} items`,
          itemCount: parsed.length,
          preview: clip(content),
        };
      }
      if (parsed !== null && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        for (const key of LIST_KEYS) {
          const value = record[key];
          if (Array.isArray(value)) {
            return {
              summary: `an object whose "${key}" holds ${value.length.toLocaleString("en-US")} items`,
              itemCount: value.length,
              preview: clip(content),
            };
          }
        }
        // Any other array-valued field still counts — tools wrap lists under
        // their own names ("automations", "leads"). Longest array wins.
        let listKey: string | null = null;
        let listLength = 0;
        for (const [key, value] of Object.entries(record)) {
          if (Array.isArray(value) && value.length >= listLength) {
            listKey = key;
            listLength = value.length;
          }
        }
        if (listKey !== null) {
          return {
            summary: `an object whose "${listKey}" holds ${listLength.toLocaleString("en-US")} items`,
            itemCount: listLength,
            preview: clip(content),
          };
        }
        const fields = Object.keys(record).length;
        return {
          summary: `a JSON object with ${fields} field${fields === 1 ? "" : "s"}`,
          preview: clip(content),
        };
      }
      return { summary: "a JSON value", preview: clip(content) };
    } catch {
      // Not JSON after all — fall through to the text description.
    }
  }

  if (trimmed === "") return { summary: "empty output", preview: "" };
  const lines = content.split("\n").length;
  return { ...fallback, summary: `${lines} line${lines === 1 ? "" : "s"} of text` };
}

function clip(text: string): string {
  if (text.length <= PREVIEW_CHARS) return text;
  return `${text.slice(0, PREVIEW_CHARS)}…`;
}
