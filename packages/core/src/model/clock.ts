/**
 * Monotonic logical clock.
 *
 * Two mutations issued in the same millisecond must not receive the same
 * timestamp, or the second one loses the last-write-wins comparison and
 * silently does nothing. This clock never returns the same value twice and
 * never goes backwards, even if the OS wall clock is adjusted mid-session.
 */
export class Clock {
  private last = 0;
  private readonly source: () => number;

  constructor(source: () => number = Date.now) {
    this.source = source;
  }

  /** Strictly increasing ISO-8601 UTC timestamp with millisecond precision. */
  now(): string {
    const wall = this.source();
    this.last = wall > this.last ? wall : this.last + 1;
    return new Date(this.last).toISOString();
  }

  /**
   * Pull the clock forward past a timestamp observed from another device, so
   * our next local edit is ordered after it rather than tying with it.
   */
  observe(iso: string): void {
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t > this.last) this.last = t;
  }
}

/** Process-wide default clock. Tests inject their own. */
export const clock = new Clock();

/**
 * True when `a` is strictly newer than `b`.
 *
 * Strictness matters: on an exact tie the incumbent value is kept. The server
 * applies the identical rule, and every push returns the winning row, so a
 * client that loses a tie is corrected on the next round trip.
 */
export function isNewer(a: string, b: string): boolean {
  return a > b;
}

export function maxTimestamp(...values: string[]): string {
  let best = values[0] ?? new Date(0).toISOString();
  for (const v of values) if (v > best) best = v;
  return best;
}
