import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LINK_SOURCE, LINK_TRAILING, hrefFor, splitLinks } from '../src/links.js';

/**
 * Which part of a task is a link.
 *
 * Getting this wrong is visible in both directions: a full stop swallowed into
 * the address opens a page that does not exist, and a link cut short at a
 * `=` or a bracket opens the wrong one. Most of the cases below are shapes of
 * link that actually sit in the task list — Instagram share links ending in
 * base64 padding, Google Docs paths, Wikipedia titles with brackets.
 */

const links = (text: string) =>
  splitLinks(text).flatMap((segment) => (segment.kind === 'link' ? [segment.text] : []));

describe('finding links', () => {
  it('leaves text without a link as one plain run', () => {
    expect(splitLinks('Buy milk')).toEqual([{ kind: 'text', text: 'Buy milk' }]);
  });

  it('finds a link on its own', () => {
    expect(splitLinks('https://example.com/a')).toEqual([
      { kind: 'link', text: 'https://example.com/a', href: 'https://example.com/a' },
    ]);
  });

  it('finds a link in the middle of a sentence', () => {
    expect(splitLinks('read https://example.com/a tonight')).toEqual([
      { kind: 'text', text: 'read ' },
      { kind: 'link', text: 'https://example.com/a', href: 'https://example.com/a' },
      { kind: 'text', text: ' tonight' },
    ]);
  });

  it('finds every link in a task', () => {
    expect(links('compare http://a.com and https://b.com/x')).toEqual([
      'http://a.com',
      'https://b.com/x',
    ]);
  });

  it.each([
    ['Instagram share links ending in padding', 'https://www.instagram.com/p/DdRfIMWDVOu/?stkn=MXVrd2F3ODZoOXN3aw=='],
    ['query strings and fragments', 'https://example.com/search?q=a&b=c#top'],
    ['Google Docs paths', 'https://docs.google.com/document/u/0/d/1oaNT7EBO5mDkfYrfdD8c6qVCroyRsycQaw8AdLnsqws/mobilebasic'],
    ['brackets the link opened itself', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
  ])('keeps %s whole', (_shape, url) => {
    expect(links(`see ${url} later`)).toEqual([url]);
  });

  it.each([
    ['a full stop', 'Read https://example.com/a.', 'https://example.com/a'],
    ['a comma', 'https://example.com/a, then sleep', 'https://example.com/a'],
    ['a question mark', 'did you see https://example.com/a?', 'https://example.com/a'],
    ['a bracket the sentence opened', '(see https://example.com/a)', 'https://example.com/a'],
    ['a quote', "the 'https://example.com/a' one", 'https://example.com/a'],
  ])('leaves out %s that ends the sentence', (_what, text, url) => {
    expect(links(text)).toEqual([url]);
  });

  it('treats www. as a web address', () => {
    expect(splitLinks('www.example.com/a')).toEqual([
      { kind: 'link', text: 'www.example.com/a', href: 'https://www.example.com/a' },
    ]);
  });

  it('is not fooled by capitals', () => {
    expect(links('HTTPS://EXAMPLE.COM/A')).toEqual(['HTTPS://EXAMPLE.COM/A']);
  });

  it.each([
    ['a bare domain', 'get.kekka'],
    ['another scheme', 'ftp://example.com/file'],
    ['a script URL', 'javascript:alert(1)'],
    ['a scheme with nothing after it', 'https:// later'],
    ['a scheme glued to a word', 'xhttps://example.com'],
  ])('does not link %s', (_what, text) => {
    expect(links(text)).toEqual([]);
  });

  it.each([
    'Buy milk',
    'read https://example.com/a. tonight',
    '(see https://en.wikipedia.org/wiki/Foo_(bar)), and www.b.com!',
    'https://a.com https://b.com',
    '',
  ])('never changes what the task says: %j', (text) => {
    expect(splitLinks(text).map((segment) => segment.text).join('')).toBe(text);
  });
});

describe('what a link opens', () => {
  it.each(['javascript:alert(1)', 'data:text/html,hi', 'file:///C:/x'])(
    'refuses anything but the web: %s',
    (raw) => {
      // The pattern cannot produce these, but the href is checked again after
      // parsing rather than trusting that it never will.
      const href = hrefFor(raw);
      if (href !== null) expect(href).toMatch(/^https?:\/\//);
    },
  );

  it('adds a scheme to a www. address', () => {
    expect(hrefFor('www.example.com')).toBe('https://www.example.com/');
  });
});

describe('the Android widget agrees', () => {
  /**
   * The home-screen widget is native and cannot import this module, so
   * `Links.kt` repeats the pattern and the trailing punctuation. If the two
   * drifted, a link would be underlined in one place and not the other.
   */
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const kotlin = readFileSync(
    join(ROOT, 'apps/mobile/src-tauri/gen/android/app/src/main/java/com/swapnil/recall/Links.kt'),
    'utf8',
  );

  it('uses the same pattern', () => {
    expect(kotlin).toContain(`"""${LINK_SOURCE}"""`);
  });

  it('trims the same punctuation', () => {
    expect(kotlin).toContain(`"${LINK_TRAILING}"`);
  });
});
