/**
 * Glob matching for tool scopes, allow lists and deny lists (spec §5: an
 * agent's "tool list (globs allowed)"). `*` runs across any characters, `?`
 * matches one, and every other character is literal (`**` therefore behaves
 * like `*`, which is what tool names want). Matching is case-sensitive, like
 * the tool names themselves.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (const character of pattern) {
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function matchesGlob(name: string, pattern: string): boolean {
  return globToRegExp(pattern).test(name);
}

export function matchesAnyGlob(name: string, patterns: readonly string[] | undefined): boolean {
  return (patterns ?? []).some((pattern) => matchesGlob(name, pattern));
}
