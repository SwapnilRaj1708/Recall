import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, type SyncedSettings } from '@recall/core';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMIZATION_MIRROR_KEY,
  CUSTOMIZATION_VAR,
  customizationVars,
} from '../src/customize.js';

/**
 * Customize, as the styles every surface reads.
 *
 * Two promises are pinned here. Someone who never touches Customize sees
 * exactly what they saw before it existed — no variable is written at all. And
 * the pre-paint bootstraps, which apply the mirrored variables before any
 * module loads and so cannot import this, accept everything this writes and
 * nothing else.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BOOTSTRAPS = [
  'apps/desktop/public/theme-bootstrap.js',
  'apps/extension/public/theme-bootstrap.js',
  'apps/mobile/public/theme-bootstrap.js',
];

const with_ = (patch: Partial<SyncedSettings>) => customizationVars({ ...DEFAULT_SETTINGS, ...patch });

describe('turning settings into styles', () => {
  it('writes nothing for someone who never customised', () => {
    expect(customizationVars(DEFAULT_SETTINGS)).toEqual({});
  });

  it('maps every task option', () => {
    expect(
      with_({
        taskFontSize: 18,
        taskColor: '#d9a441',
        taskCompletedColor: '#555555',
        taskTypeface: 'mono',
        taskWeight: 'bold',
        taskItalic: true,
        taskMargins: { left: 2, top: 4, right: 0, bottom: 8 },
      }),
    ).toMatchObject({
      '--rc-task-font-size': '18px',
      '--rc-task-color': '#d9a441',
      '--rc-task-done-color': '#555555',
      '--rc-task-font-weight': '700',
      '--rc-task-font-style': 'italic',
      '--rc-task-margin-left': '2px',
      '--rc-task-margin-top': '4px',
      '--rc-task-margin-bottom': '8px',
    });
  });

  it('leaves out a margin of zero rather than writing it', () => {
    expect(with_({ taskMargins: { left: 0, top: 3, right: 0, bottom: 0 } })).toEqual({
      '--rc-task-margin-top': '3px',
    });
  });

  it('condenses the condensed typeface rather than only naming a font that may be missing', () => {
    expect(with_({ taskTypeface: 'condensed' })['--rc-task-font-stretch']).toBe('condensed');
  });

  it('paints a chosen widget background at the chosen opacity', () => {
    expect(with_({ widgetBackground: '#102030', widgetOpacity: 0.5 })['--rc-widget-bg']).toBe(
      'rgb(16 32 48 / 0.5)',
    );
  });

  it('applies opacity alone to the theme surface, so light and dark still differ', () => {
    expect(with_({ widgetOpacity: 0.4 })['--rc-widget-bg']).toBe(
      'rgb(var(--rc-surface-base) / 0.4)',
    );
  });

  it('distinguishes no border from the default border', () => {
    expect(with_({ widgetBorder: 'none' })['--rc-widget-border']).toBe('transparent');
    expect(with_({ widgetBorder: null })['--rc-widget-border']).toBeUndefined();
  });

  it('turns corner choices into radii', () => {
    expect(with_({ widgetCorners: 'none' })['--rc-widget-radius']).toBe('0px');
    expect(with_({ widgetCorners: 'large' })['--rc-widget-radius']).toBe('20px');
  });
});

describe('the pre-paint bootstraps', () => {
  const everything = with_({
    widgetBackground: '#102030',
    widgetOpacity: 0.5,
    widgetBorder: '#abcdef',
    widgetCorners: 'small',
    taskFontSize: 16,
    taskColor: '#111111',
    taskCompletedColor: '#222222',
    taskTypeface: 'condensed',
    taskWeight: 'medium',
    taskItalic: true,
    taskMargins: { left: 1, top: 2, right: 3, bottom: 4 },
  });

  it.each(BOOTSTRAPS)('%s reads the mirror the app writes', (file) => {
    expect(readFileSync(join(ROOT, file), 'utf8')).toContain(`'${CUSTOMIZATION_MIRROR_KEY}'`);
  });

  it.each(BOOTSTRAPS)('%s accepts exactly the variable names Customize owns', (file) => {
    expect(readFileSync(join(ROOT, file), 'utf8')).toContain(CUSTOMIZATION_VAR.source);
  });

  it.each(BOOTSTRAPS)('%s accepts every value the app can write', (file) => {
    // Pulled out of the script itself, so this tests the filter that ships.
    const source = readFileSync(join(ROOT, file), 'utf8');
    const match = /(\/\^\[#[^\n]*?\$\/)\.test\(value\)/.exec(source);
    expect(match, 'value filter not found').not.toBeNull();
    const filter = new RegExp(match![1]!.slice(1, -1));
    for (const [name, value] of Object.entries(everything)) {
      expect(CUSTOMIZATION_VAR.test(name), name).toBe(true);
      expect(filter.test(value), `${name}: ${value}`).toBe(true);
    }
    // And refuses something that could end the declaration it is put in.
    expect(filter.test('red; background: url(x)')).toBe(false);
  });
});
