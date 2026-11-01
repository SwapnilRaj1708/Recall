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
 * Where a new capture lands: the top of the list unless the user chose the
 * bottom.
 *
 * The top is the default on purpose: the thing just remembered is the thing
 * most at risk of being forgotten, so it belongs where the eye already is.
 * Some people read a list as a queue instead, oldest first, and for them the
 * bottom is where new work belongs.
 */
export function positionForNewCapture(
  existing: readonly { position: string }[],
  placement: 'top' | 'bottom' = 'top',
): string {
  return positionsForNewCaptures(existing, placement, 1)[0]!;
}

/**
 * Positions for several captures made in a row, in the order to use them.
 *
 * Each one lands beyond the last — above it at the top, below it at the
 * bottom — so a run of captures keeps the order it was made in. This is for a
 * capturer that cannot see the list as it changes: the phone's share receiver
 * sends links straight to the server from a snapshot the app left it, and
 * handing every share the same "top" key from that snapshot gave them all the
 * same position, in no particular order.
 *
 * The first key is exactly what `positionForNewCapture` returns.
 */
export function positionsForNewCaptures(
  existing: readonly { position: string }[],
  placement: 'top' | 'bottom',
  count: number,
): string[] {
  let smallest: string | null = null;
  let largest: string | null = null;
  for (const t of existing) {
    // Ignore malformed keys when picking the anchor, so one bad row cannot
    // stop new captures — the single thing that must never fail.
    if (!isValidPosition(t.position)) continue;
    if (smallest === null || t.position < smallest) smallest = t.position;
    if (largest === null || t.position > largest) largest = t.position;
  }
  if (placement === 'bottom') return generateNKeysBetween(anchor(largest), null, count);
  // Generated in ascending order; the one nearest the current top is used first.
  return generateNKeysBetween(null, anchor(smallest), count).reverse();
}

/**
 * List order: by position, and among equal positions the newest first.
 *
 * Positions should be unique, but two can match — two devices capturing at
 * the top while both offline compute the same key from the same list — and
 * without a rule for ties those tasks would sit in whatever order a sort
 * happened to leave them, possibly different on each device. Newest first
 * matches where a capture normally lands, and the id makes it total.
 */
export function compareTasksInOrder(
  a: { position: string; createdAt: string; id: string },
  b: { position: string; createdAt: string; id: string },
): number {
  return (
    compareByPosition(a, b) ||
    (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function compareByPosition(a: { position: string }, b: { position: string }): number {
  if (a.position < b.position) return -1;
  if (a.position > b.position) return 1;
  return 0;
}
