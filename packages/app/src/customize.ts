import { CORNER_RADIUS, DEFAULT_SETTINGS, type SyncedSettings } from '@recall/core';

/**
 * Customize, as CSS custom properties.
 *
 * Every surface styles its task rows and its widget panel from a handful of
 * `--rc-task-*` and `--rc-widget-*` variables with defaults in tokens.css, so
 * applying the user's choices is writing those variables onto the root — the
 * same mechanism the theme uses — and a choice put back to "Default" is the
 * variable being removed, which lets the stylesheet's own default return.
 *
 * Only what differs from the default is emitted. That is what keeps a user
 * who never opens Customize on exactly the look they had before it existed.
 */

export type CustomizationVars = Record<string, string>;

/** The variables this module may set; anything else in the root's style is left alone. */
export const CUSTOMIZATION_VAR = /^--rc-(task|widget)-[a-z-]+$/;

/** Where the computed variables are mirrored for the pre-paint bootstraps. */
export const CUSTOMIZATION_MIRROR_KEY = 'recall.customize';

const TYPEFACES: Record<Exclude<SyncedSettings['taskTypeface'], 'system'>, string> = {
  serif: "Georgia, 'Noto Serif', 'Times New Roman', serif",
  mono: "'Cascadia Mono', Consolas, 'Roboto Mono', ui-monospace, monospace",
  condensed: "'Roboto Condensed', 'sans-serif-condensed', 'Bahnschrift SemiCondensed', 'Arial Narrow', sans-serif",
};

const WEIGHTS: Record<SyncedSettings['taskWeight'], string> = {
  regular: '400',
  medium: '500',
  bold: '700',
};

function rgb(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${round(alpha)})`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function customizationVars(settings: SyncedSettings): CustomizationVars {
  const vars: CustomizationVars = {};

  // Widget panel. Opacity only takes effect with a background to apply it to,
  // so the theme's own surface colour stands in when none was chosen.
  if (
    settings.widgetBackground !== null ||
    settings.widgetOpacity !== DEFAULT_SETTINGS.widgetOpacity
  ) {
    vars['--rc-widget-bg'] = settings.widgetBackground
      ? rgb(settings.widgetBackground, settings.widgetOpacity)
      : `rgb(var(--rc-surface-base) / ${round(settings.widgetOpacity)})`;
  }
  if (settings.widgetBorder === 'none') vars['--rc-widget-border'] = 'transparent';
  else if (settings.widgetBorder) vars['--rc-widget-border'] = settings.widgetBorder;
  if (settings.widgetCorners) {
    vars['--rc-widget-radius'] = `${CORNER_RADIUS[settings.widgetCorners]}px`;
  }

  // Task rows.
  if (settings.taskFontSize !== null) vars['--rc-task-font-size'] = `${settings.taskFontSize}px`;
  if (settings.taskColor) vars['--rc-task-color'] = settings.taskColor;
  if (settings.taskCompletedColor) vars['--rc-task-done-color'] = settings.taskCompletedColor;
  if (settings.taskTypeface !== 'system') {
    vars['--rc-task-font-family'] = TYPEFACES[settings.taskTypeface];
    if (settings.taskTypeface === 'condensed') vars['--rc-task-font-stretch'] = 'condensed';
  }
  if (settings.taskWeight !== 'regular') vars['--rc-task-font-weight'] = WEIGHTS[settings.taskWeight];
  if (settings.taskItalic) vars['--rc-task-font-style'] = 'italic';

  const { left, top, right, bottom } = settings.taskMargins;
  if (left) vars['--rc-task-margin-left'] = `${left}px`;
  if (top) vars['--rc-task-margin-top'] = `${top}px`;
  if (right) vars['--rc-task-margin-right'] = `${right}px`;
  if (bottom) vars['--rc-task-margin-bottom'] = `${bottom}px`;

  return vars;
}

/**
 * Write the variables onto an element, removing any this module set before
 * that are no longer wanted. Also mirrors them for the pre-paint bootstrap, so
 * the next window to open paints customised from its first frame.
 */
export function applyCustomization(root: HTMLElement, vars: CustomizationVars): void {
  const style = root.style;
  for (let i = style.length - 1; i >= 0; i--) {
    const name = style.item(i);
    if (CUSTOMIZATION_VAR.test(name) && !(name in vars)) style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);

  try {
    localStorage.setItem(CUSTOMIZATION_MIRROR_KEY, JSON.stringify(vars));
  } catch {
    /* No mirror: the first frame uses defaults, which is all it costs. */
  }
}
