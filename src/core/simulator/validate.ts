/**
 * Validate-against-company-lists (spec §6 skill): statuses, sources, loan
 * types and stages come from the company's own lists; invented values are
 * refused with the closest real one offered, never silently accepted.
 */

export class CompanyListError extends Error {
  constructor(field: string, value: string, allowed: string[], suggestion: string | null) {
    const hint = suggestion === null ? "" : ` Did you mean "${suggestion}"?`;
    super(
      `"${value}" is not on the company's ${field} list.${hint} Allowed: ${allowed.join(", ")}.`,
    );
    this.name = "CompanyListError";
  }
}

export function assertInList(field: string, value: string, allowed: string[]): void {
  const exact = allowed.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
  if (exact !== undefined) return;
  throw new CompanyListError(field, value, allowed, closestMatch(value, allowed));
}

/** Nearest allowed value by edit distance; null when nothing is close. */
export function closestMatch(value: string, allowed: string[]): string | null {
  const target = value.toLowerCase();
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of allowed) {
    const distance = editDistance(target, candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  const tolerance = Math.max(2, Math.floor(target.length / 3));
  return best !== null && bestDistance <= tolerance ? best : null;
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[cols - 1];
}
