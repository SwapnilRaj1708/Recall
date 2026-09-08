import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The repository's own configuration files have to parse.
 *
 * This exists because `vercel.json` shipped with `sw\.js` inside a JSON string.
 * `\.` is not a valid JSON escape, so the file had never been readable — and
 * nothing caught it, because a config file is not imported by any test and not
 * type-checked by `tsc`. The failure surfaced at the worst possible moment: on
 * the hosting provider, during the first deploy, as "invalid vercel.json".
 *
 * Escaping a regex inside JSON is exactly the kind of thing that looks right,
 * so the test parses the files rather than trusting a reading of them.
 */

/** Tracked JSON config files, from git so build output and deps are excluded. */
function trackedJsonFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '*.json'], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes('node_modules'));
}

describe('repository configuration', () => {
  const files = trackedJsonFiles();

  it('tracks the config files this suite is meant to cover', () => {
    // A silently empty file list would make every case below vacuously pass.
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain('vercel.json');
  });

  it.each(files)('%s is valid JSON', (file) => {
    const raw = readFileSync(join(ROOT, file), 'utf8');
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });
});

interface VercelConfig {
  buildCommand: string;
  outputDirectory: string;
  rewrites: { source: string; destination: string }[];
}

/**
 * Read lazily, inside each case.
 *
 * Parsing at module scope would turn a malformed file into a collection error —
 * vitest reports "no tests" and never names the one assertion that was written
 * to catch it, which is a worse signal than the bug deserves.
 */
function vercelConfig(): VercelConfig {
  return JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as VercelConfig;
}

describe('vercel.json', () => {
  it('builds the web app out of the workspace and serves what it produced', () => {
    const config = vercelConfig();
    // Vercel does not understand a pnpm workspace on its own; these two lines
    // are the whole reason the deploy needs no settings in the dashboard.
    expect(config.buildCommand).toContain('@recall/web');
    expect(config.outputDirectory).toBe('apps/web/dist');
  });

  it('has a rewrite whose source is a usable regular expression', () => {
    const [rewrite] = vercelConfig().rewrites;
    expect(rewrite).toBeDefined();
    expect(() => new RegExp(`^${rewrite!.source}$`)).not.toThrow();
  });

  it.each([
    ['/', true],
    ['/anything-else', true],
    ['/assets/index-abc123.js', false],
    ['/assets/index-abc123.css', false],
    ['/sw.js', false],
    ['/workbox-abc123.js', false],
    ['/registerSW.js', false],
    ['/manifest.webmanifest', false],
    ['/icon-192.png', false],
  ])('%s → rewritten to index.html: %s', (path, rewritten) => {
    // A single-page app needs unknown paths to reach index.html, but the
    // service worker, its precache manifest and the hashed assets must be
    // served as themselves. Rewriting sw.js would break offline capture
    // silently — the app would look fine until the network went away.
    const source = vercelConfig().rewrites[0]!.source;
    expect(new RegExp(`^${source}$`).test(path)).toBe(rewritten);
  });
});

describe('the deploy will find what it expects', () => {
  it('names a build script that exists in the web package', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'apps/web/package.json'), 'utf8')) as {
      name: string;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe('@recall/web');
    expect(pkg.scripts.build).toBeTruthy();
  });

  it('keeps a lockfile, since the install command requires a frozen one', () => {
    expect(existsSync(join(ROOT, 'pnpm-lock.yaml'))).toBe(true);
  });
});
