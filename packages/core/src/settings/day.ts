/**
 * Day boundaries for the end-of-day clear-out, in the device's own time zone.
 *
 * "End of the day" means the user's day, so these use local time on purpose.
 * Date arithmetic is done by constructing dates from calendar fields rather
 * than adding 24 hours, which is wrong on the two days a year that are 23 or
 * 25 hours long.
 */

export function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function nextLocalMidnight(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}
