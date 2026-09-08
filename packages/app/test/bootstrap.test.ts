import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_THEME, WIDGET_ALPHA_FACTOR, WIDGET_ROW_HEIGHT_DELTA } from '@recall/ui';
import { describe, expect, it } from 'vitest';
import { THEME_KEY } from '../src/settings.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * `theme-bootstrap.js` applies the theme before the first paint.
 *
 * It has to run before any module loads, so it cannot import from @recall/ui
 * and instead duplicates the key name and the widget's offsets. That
 * duplication already broke once: moving the theme to a shared key left the
 * bootstrap reading a record that no longer contained one, so every window
 * flashed default colours on open — a failure that only shows up in the first
 * frame, which is exactly where nobody is looking.
 *
 * These tests pin the duplicated constants to their real definitions.
 */

const BOOTSTRAPS = {
  desktop: 'apps/desktop/public/theme-bootstrap.js',
  extension: 'apps/extension/public/theme-bootstrap.js',
} as const;

const source = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

describe.each(Object.entries(BOOTSTRAPS))('%s theme bootstrap', (_surface, file) => {
  const code = source(file);

  it('reads the shared appearance record, not a per-surface one', () => {
    expect(code).toContain(THEME_KEY);
  });

  it('still falls back to a legacy inline theme, so upgrades do not flash', () => {
    expect(code).toContain('recall.preferences.');
  });

  it('clamps what it reads, since stored values can be anything', () => {
    // A corrupt rowHeight written straight into a CSS variable would render a
    // list of thousand-pixel rows before React ever gets a say.
    expect(code).toMatch(/clamp\(/);
  });

  it('validates the accent as a hex colour before writing it into CSS', () => {
    expect(code).toMatch(/\[0-9a-f\]\{6\}/i);
  });
});

describe('the desktop bootstrap and widgetTheme agree', () => {
  const code = source(BOOTSTRAPS.desktop);

  it('uses the same translucency factor', () => {
    expect(code).toContain(String(WIDGET_ALPHA_FACTOR));
  });

  it('uses the same row-height offset', () => {
    expect(code).toContain(String(WIDGET_ROW_HEIGHT_DELTA));
  });

  it('applies those only to the windows that sit over the desktop', () => {
    // The main window is opaque; giving it the widget's treatment would make
    // the settings dialog hard to read before React corrected it.
    expect(code).toMatch(/widget.*quick|quick.*widget/s);
  });
});

describe('the extension bootstrap matches opaqueTheme', () => {
  const code = source(BOOTSTRAPS.extension);

  it('pins transparency off, since a popup has nothing behind it', () => {
    expect(code).toMatch(/--rc-surface-alpha['"],\s*['"]1['"]/);
  });

  it('does not carry the widget offsets it has no use for', () => {
    expect(code).not.toContain(String(WIDGET_ALPHA_FACTOR));
  });
});

describe('defaults the bootstrap assumes', () => {
  it('matches the theme mode used when nothing is stored', () => {
    // Both scripts fall back to 'system'; if the default ever changed, the
    // first frame and every frame after it would disagree.
    expect(DEFAULT_THEME.mode).toBe('system');
    for (const file of Object.values(BOOTSTRAPS)) {
      expect(source(file)).toContain("|| 'system'");
    }
  });
});
