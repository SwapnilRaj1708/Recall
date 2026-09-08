import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION = resolve(HERE, '..');
const DIST = join(EXTENSION, 'dist');

/**
 * Checks that what Chrome will actually load is coherent.
 *
 * Chrome fails quietly here: a script the manifest references but the build
 * never emitted produces a 404 inside the popup, not a build error. That
 * exact bug shipped once during development, so it is worth a test.
 */
const built = existsSync(join(DIST, 'manifest.json'));
const describeIfBuilt = built ? describe : describe.skip;

describe('manifest source', () => {
  const manifest = JSON.parse(readFileSync(join(EXTENSION, 'manifest.json'), 'utf8'));

  it('is Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('pins the extension id, so its OAuth redirect URL can be allow-listed', () => {
    // Without `key`, Chrome derives the id from the install path and Google
    // sign-in breaks on every machine that is not the one it was set up on.
    expect(typeof manifest.key).toBe('string');
    expect(manifest.key.length).toBeGreaterThan(300);
  });

  it('asks only for the permissions it actually uses', () => {
    expect(new Set(manifest.permissions)).toEqual(
      new Set(['storage', 'alarms', 'identity', 'contextMenus']),
    );
    // Broad host access would be a real privacy cost for a to-do list.
    expect(manifest.host_permissions).toEqual(['https://*.supabase.co/*']);
  });

  it('declares the quick-capture entry points', () => {
    expect(manifest.omnibox?.keyword).toBe('r');
    expect(manifest.commands?._execute_action).toBeTruthy();
    expect(manifest.action?.default_popup).toBe('popup.html');
  });

  it('runs the background worker as a module', () => {
    // The worker imports the shared engine, which is ESM.
    expect(manifest.background?.type).toBe('module');
  });
});

describeIfBuilt('build output', () => {
  const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));

  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons as Record<string, string>),
  ];

  it.each(referenced)('emits %s', (file) => {
    expect(existsSync(join(DIST, file))).toBe(true);
  });

  it('emits every script the HTML pages reference', () => {
    for (const page of ['popup.html', 'options.html']) {
      const html = readFileSync(join(DIST, page), 'utf8');
      const sources = [...html.matchAll(/src="\.\/([^"]+)"/g)].map((match) => match[1]!);
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(existsSync(join(DIST, source)), `${page} references missing ${source}`).toBe(true);
      }
    }
  });

  it('emits every stylesheet the HTML pages reference', () => {
    for (const page of ['popup.html', 'options.html']) {
      const html = readFileSync(join(DIST, page), 'utf8');
      for (const match of html.matchAll(/href="\.\/([^"]+\.css)"/g)) {
        expect(existsSync(join(DIST, match[1]!))).toBe(true);
      }
    }
  });

  it('ships no remote script tags, which Manifest V3 forbids', () => {
    for (const page of ['popup.html', 'options.html']) {
      const html = readFileSync(join(DIST, page), 'utf8');
      expect(html).not.toMatch(/src="https?:\/\//);
    }
  });

  it('does not ship the private signing key', () => {
    expect(readdirSync(DIST)).not.toContain('key.pem');
  });
});

describeIfBuilt('popup sizing', () => {
  // Chrome sizes a popup from the rendered document. The bundled stylesheet is
  // injected after the page's own <style> and carries the design system's
  // `html, body { height: 100% }` reset — at equal specificity that wins, the
  // height collapses, and the popup renders as a thin strip. The page's sizing
  // rules must therefore outrank a bare element selector.
  const raw = readFileSync(join(DIST, 'popup.html'), 'utf8');
  // Comments in this file discuss `<style>` and CSS by name, so they have to go
  // before anything tries to parse the real markup.
  const html = raw.replace(/<!--[\s\S]*?-->/g, '');
  const styleBlock = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

  it('gives the popup an explicit pixel height', () => {
    expect(styleBlock).toMatch(/height:\s*\d+px/);
  });

  it('qualifies its sizing selectors so the bundled reset cannot override them', () => {
    const rules = [...styleBlock.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const sizing = rules.filter(([, , body]) => /height:\s*\d+px/.test(body!));
    expect(sizing.length).toBeGreaterThan(0);
    // A bare `html` or `html, body` would lose to the reset that loads later.
    for (const [, selector] of sizing) {
      expect(selector!.trim()).toMatch(/html\.[a-z-]+/i);
    }
  });

  it('still loads the bundled stylesheet after that block, which is why it matters', () => {
    const styleEnd = html.indexOf('</style>');
    const firstStylesheet = html.indexOf('rel="stylesheet"');
    if (firstStylesheet >= 0) expect(firstStylesheet).toBeGreaterThan(styleEnd);
  });
});
