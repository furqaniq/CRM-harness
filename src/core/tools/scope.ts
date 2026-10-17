import { matchesDenyPattern } from "./classify";
import { matchesAnyGlob } from "./glob";

/**
 * Tool scoping (spec §5): "Each agent gets only its own tools; tool names are
 * those in the workbooks." Patterns are globs over tool names.
 *
 * Two rules are deliberately strict:
 * - An empty pattern list means *no* tools. Scoping fails closed, never open.
 * - A tool whose name hits the global deny pattern (delete, remove, archive,
 *   destroy, merge) is never in anybody's scope — the spec's don't list says
 *   not to give any agent such a tool "even if a server offers one", so it is
 *   filtered out of context entirely, not just blocked at call time.
 */
export function scopeTools<T>(
  tools: readonly T[],
  patterns: readonly string[],
  nameOf: (tool: T) => string,
): T[] {
  return tools.filter((tool) => {
    const name = nameOf(tool);
    if (matchesDenyPattern(name)) return false;
    return matchesAnyGlob(name, patterns);
  });
}
