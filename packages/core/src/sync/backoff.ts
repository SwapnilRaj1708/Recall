export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** Fraction of the delay that is randomised, to stop several clients retrying in lockstep. */
  jitter?: number;
  random?: () => number;
}

/**
 * Exponential backoff with jitter, capped so a long outage still retries about
 * once a minute rather than drifting into hours.
 */
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const { baseMs = 1_000, maxMs = 60_000, jitter = 0.3, random = Math.random } = options;
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const spread = exponential * jitter;
  return Math.round(exponential - spread / 2 + random() * spread);
}
