/**
 * Finding the links in a task's text.
 *
 * Tasks are captured in a hurry and pasted from anywhere, so a link arrives
 * however it was copied: mid-sentence, at the end of one, wrapped in brackets,
 * followed by a full stop. Only `http(s)://` and `www.` are recognised. A bare
 * `example.com` is too easily a filename or a typo to underline uninvited, and
 * a link the user did not mean is worse than one they have to paste properly.
 *
 * The Android widget renders the same text natively and duplicates these rules
 * in `Links.kt`; a test keeps the two in step.
 */

export type TextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string };

/** Where a link starts and how far it may run, before trailing punctuation is trimmed. */
export const LINK_SOURCE = String.raw`\b(?:https?://|www\.)[^\s<>"]+`;

/** Punctuation that ends the sentence around a link far more often than the link itself. */
export const LINK_TRAILING = `.,;:!?'`;

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

const count = (text: string, char: string): number => text.split(char).length - 1;

/**
 * Drop what the sentence contributed rather than the link.
 *
 * A closing bracket is kept when the link opened one itself — Wikipedia's
 * `Foo_(bar)` — and dropped when it closes a bracket the sentence opened.
 */
function trimTrailing(candidate: string): string {
  let end = candidate.length;
  while (end > 0) {
    const last = candidate[end - 1]!;
    if (LINK_TRAILING.includes(last)) {
      end -= 1;
      continue;
    }
    const opener = CLOSERS[last];
    if (opener) {
      const body = candidate.slice(0, end);
      if (count(body, last) > count(body, opener)) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return candidate.slice(0, end);
}

/**
 * The address to open, or null when the text only looks like a link.
 *
 * Anything that reaches an `href` is one of the two web schemes, by
 * construction: the pattern requires them, and this checks again after
 * parsing rather than trusting that.
 */
export function hrefFor(raw: string): string | null {
  const absolute = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(absolute);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Split text into plain runs and links, in order.
 *
 * Joining every segment's `text` gives back the input exactly, so rendering
 * the segments never changes what the task says.
 */
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(new RegExp(LINK_SOURCE, 'gi'))) {
    const start = match.index;
    const raw = trimTrailing(match[0]);
    const href = raw ? hrefFor(raw) : null;
    if (href === null) continue;

    if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) });
    segments.push({ kind: 'link', text: raw, href });
    cursor = start + raw.length;
  }

  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}
