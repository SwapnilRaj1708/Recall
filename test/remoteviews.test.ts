import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAYOUTS = join(ROOT, 'apps/mobile/src-tauri/gen/android/app/src/main/res/layout');

/**
 * The home-screen widget's layouts have to be inflatable by `RemoteViews`.
 *
 * A widget is not rendered by the app: the launcher inflates it in its own
 * process, and for that reason only a short allowlist of view classes is
 * permitted. A plain `View` is not on it — which is easy to get wrong, because
 * it is the obvious choice for a hairline divider and is valid in every other
 * Android layout.
 *
 * Nothing catches it before the device. It compiles, it packages, it installs,
 * and then the launcher refuses the widget with "Couldn't add widget" and no
 * further explanation. That exact failure shipped once here, from a divider.
 *
 * https://developer.android.com/reference/android/widget/RemoteViews
 */
const REMOTE_VIEWS_ALLOWED = new Set([
  // Layouts
  'AdapterViewFlipper',
  'FrameLayout',
  'GridLayout',
  'GridView',
  'LinearLayout',
  'ListView',
  'RelativeLayout',
  'StackView',
  'ViewFlipper',
  // Widgets
  'AnalogClock',
  'Button',
  'Chronometer',
  'ImageButton',
  'ImageView',
  'ProgressBar',
  'TextView',
  'ViewStub',
]);

/** Layouts inflated by the launcher, rather than by the app itself. */
function widgetLayouts(): string[] {
  if (!existsSync(LAYOUTS)) return [];
  return readdirSync(LAYOUTS).filter(
    (name) => name.startsWith('widget_') && name.endsWith('.xml'),
  );
}

/** Element names, ignoring attributes, comments and closing tags. */
function elementsIn(xml: string): string[] {
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '');
  return [...withoutComments.matchAll(/<([A-Za-z][\w.]*)/g)].map((match) => match[1]!);
}

describe('widget layouts', () => {
  const layouts = widgetLayouts();

  it('finds the layouts this suite is meant to cover', () => {
    // Vacuously passing here would be worse than not testing at all: the
    // failure it guards against is invisible until the widget is on a phone.
    expect(layouts).toContain('widget_root.xml');
    expect(layouts).toContain('widget_item.xml');
  });

  it.each(layouts)('%s uses only elements RemoteViews can inflate', (layout) => {
    const used = elementsIn(readFileSync(join(LAYOUTS, layout), 'utf8'));
    expect(used.length).toBeGreaterThan(0);

    const unsupported = [...new Set(used)].filter((tag) => !REMOTE_VIEWS_ALLOWED.has(tag));
    expect(
      unsupported,
      `${layout} uses ${unsupported.join(', ')}, which RemoteViews cannot inflate — ` +
        'the launcher will refuse the widget with "Couldn\'t add widget"',
    ).toEqual([]);
  });

  it('rejects a plain View, the case that actually shipped', () => {
    // Guarding the guard: if the allowlist were ever loosened to "anything
    // capitalised", every case above would pass while the widget stayed broken.
    expect(REMOTE_VIEWS_ALLOWED.has('View')).toBe(false);
    expect(elementsIn('<LinearLayout><View /></LinearLayout>')).toContain('View');
  });

  it('reads element names without being confused by comments', () => {
    // The layouts document this very constraint by naming View in prose.
    const xml = '<!-- a plain View is not allowed --><FrameLayout />';
    expect(elementsIn(xml)).toEqual(['FrameLayout']);
  });
});
