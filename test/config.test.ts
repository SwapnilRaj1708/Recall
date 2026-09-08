import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  headers: unknown[];
}

/**
 * Vercel looks for `vercel.json` inside the project's Root Directory, not at
 * the repository root. Importing this monorepo, Vercel detects the Vite app and
 * proposes `apps/web` as the root — at which point a config sitting at the
 * repository root is simply invisible, the framework preset takes over, and the
 * deploy fails looking for the wrong output directory.
 *
 * Rather than depend on one dashboard setting being right, both locations carry
 * a config, each with paths relative to itself. These tests keep the pair
 * honest: the routing must be identical, and both must point at the same build
 * output, so it cannot matter which root Vercel picks.
 */
const CONFIGS = {
  'vercel.json': 'vercel.json',
  'apps/web/vercel.json': 'apps/web/vercel.json',
} as const;

function readConfig(file: string): VercelConfig {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as VercelConfig;
}

describe.each(Object.values(CONFIGS))('%s', (file) => {
  it('builds the web app', () => {
    // Either spelling is fine; what matters is that it is the web app's build.
    expect(readConfig(file).buildCommand).toMatch(/@recall\/web build$|^pnpm build$/);
  });

  it('points at the build output, resolved from its own directory', () => {
    const config = readConfig(file);
    const resolved = resolve(dirname(join(ROOT, file)), config.outputDirectory);
    // Both configs must name the same real directory, whichever is in force.
    expect(resolved).toBe(resolve(ROOT, 'apps/web/dist'));
  });

  it('has a rewrite whose source is a usable regular expression', () => {
    const [rewrite] = readConfig(file).rewrites;
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
    const source = readConfig(file).rewrites[0]!.source;
    expect(new RegExp(`^${source}$`).test(path)).toBe(rewritten);
  });
});

describe('the two Vercel configs', () => {
  it('route identically, so the deploy does not depend on which root is used', () => {
    const root = readConfig(CONFIGS['vercel.json']);
    const web = readConfig(CONFIGS['apps/web/vercel.json']);
    expect(web.rewrites).toEqual(root.rewrites);
    expect(web.headers).toEqual(root.headers);
  });

  it('differ only where the path has to differ', () => {
    expect(readConfig(CONFIGS['vercel.json']).outputDirectory).toBe('apps/web/dist');
    expect(readConfig(CONFIGS['apps/web/vercel.json']).outputDirectory).toBe('dist');
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

describe('Android resources', () => {
  /**
   * Walked from disk rather than listed from git.
   *
   * The first version of this asked `git ls-files`, which lists only *tracked*
   * files — so a resource written but not yet committed was invisible, and the
   * suite passed against a file deliberately broken to check it. A test that
   * cannot see new work is worse than no test, because it reports confidence
   * it does not have.
   */
  const ANDROID_MAIN = join(ROOT, 'apps/mobile/src-tauri/gen/android/app/src/main');

  /** Relative to ANDROID_MAIN, so the case names stay readable. */
  function xmlFilesUnder(dir: string, prefix = ''): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return xmlFilesUnder(join(dir, entry.name), relative);
      return entry.name.endsWith('.xml') ? [relative] : [];
    });
  }

  const files = xmlFilesUnder(ANDROID_MAIN);
  const read = (file: string) => readFileSync(join(ANDROID_MAIN, file), 'utf8');

  it('finds the resource files this suite is meant to cover', () => {
    // Includes the widget's own layouts, colours and provider metadata; a
    // count this low would mean the walk is looking in the wrong place.
    expect(files.length).toBeGreaterThan(8);
    expect(files.some((file) => file.endsWith('recall_widget_info.xml'))).toBe(true);
    expect(files.some((file) => file.endsWith('widget_colors.xml'))).toBe(true);
  });

  /**
   * XML forbids "--" inside a comment. It is an easy thing to write by
   * accident here, because the widget's colours are documented by naming the
   * CSS custom properties they copy — and those are spelled `--rc-accent`.
   * AAPT rejects it, but only after a Rust cross-compile and a Gradle run.
   */
  it.each(files)('%s has no "--" inside an XML comment', (file) => {
    const raw = read(file);
    for (const match of raw.matchAll(/<!--([\s\S]*?)-->/g)) {
      expect(match[1], `illegal "--" in a comment in ${file}`).not.toContain('--');
    }
  });

  it.each(files)('%s is well-formed enough to have balanced comments', (file) => {
    const raw = read(file);
    const opens = (raw.match(/<!--/g) ?? []).length;
    const closes = (raw.match(/-->/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});
