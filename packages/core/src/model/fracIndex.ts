import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Ordering uses fractional indices rather than integer positions.
 *
 * Moving one task rewrites exactly one field on one row, so a reorder is a
 * single small mutation that merges cleanly against concurrent edits. Integer
 * positions would require renumbering every following row, turning one drag
 * into dozens of conflicting writes.
 */

/**
 * True when `key` is a well-formed fractional index.
 *
 * These keys encode their own length in the first character, so a plausible
 * looking string such as `"c0"` is actually malformed. Anything that reaches us
 * from outside this module — the database, a hand-edited row, a future client
 * with a bug — has to be checked before it is used as an anchor.
 */
export function isValidPosition(key: string | null | undefined): key is string {
  if (typeof key !== 'string' || key.length === 0) return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop an unusable anchor rather than throw.
 *
 * A single malformed key would otherwise make the whole list permanently
 * un-reorderable, which is a much worse outcome than one task landing at the
 * edge instead of exactly where it was dropped.
 */
const anchor = (key: string | null): string | null => (isValidPosition(key) ? key : null);

/** A key that sorts before everything currently in `positions`. */
export function positionBefore(first: string | null): string {
  return generateKeyBetween(null, anchor(first));
}

/** A key that sorts after everything currently in `positions`. */
export function positionAfter(last: string | null): string {
  return generateKeyBetween(anchor(last), null);
}

/** A key strictly between two neighbours. Either side may be null (list edge). */
export function positionBetween(before: string | null, after: string | null): string {
  const low = anchor(before);
  const high = anchor(after);
  // Dropping one side can invert the pair; when that happens, treat the
  // surviving key as the only constraint we can honour.
  if (low !== null && high !== null && low >= high) return generateKeyBetween(low, null);
  return generateKeyBetween(low, high);
}

/** `count` evenly spaced keys between two neighbours, for seeding or bulk insert. */
export function positionsBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  return generateNKeysBetween(before, after, count);
}

/**
 * New captures land at the top of the list.
 *
 * This is deliberate: the thing just remembered is the thing most at risk of
 * being forgotten, so it belongs where the eye already is.
 */
export function positionForNewCapture(existing: readonly { position: string }[]): string {
  let smallest: string | null = null;
  for (const t of existing) {
    // Ignore malformed keys when picking the anchor, so one bad row cannot
    // stop new captures — the single thing that must never fail.
    if (!isValidPosition(t.position)) continue;
    if (smallest === null || t.position < smallest) smallest = t.position;
  }
  return positionBefore(smallest);
}

export function compareByPosition(a: { position: string }, b: { position: string }): number {
  if (a.position < b.position) return -1;
  if (a.position > b.position) return 1;
  return 0;
}
