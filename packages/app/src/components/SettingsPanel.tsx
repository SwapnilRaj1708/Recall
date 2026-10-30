import {
  SETTING_LIMITS,
  type SyncedSettings,
  type TaskMargins,
  type TaskTypeface,
  type TaskWeight,
  type WidgetCorners,
} from '@recall/core';
import { ACCENT_PRESETS, Button, Switch, THEME_LIMITS, cx, type ThemeMode } from '@recall/ui';
import type { ReactNode } from 'react';
import { useRecall, useSyncStatus, useSyncedSettings, useTaskActions } from '../context.js';
import styles from './SettingsPanel.module.css';

export interface SettingsPanelProps {
  /** Slot for controls only one host has — window behaviour, autostart, hotkeys. */
  platformSection?: ReactNode;
  onSignOutBlocked?: (pendingCount: number) => void;
}

const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/**
 * Every control here writes a design token, which is why one settings screen
 * can restyle four applications. Nothing in this panel knows what a widget or
 * a popup is.
 */
export function SettingsPanel({ platformSection, onSignOutBlocked }: SettingsPanelProps) {
  const { preferences, setPreferences, authState, signOut } = useRecall();
  const status = useSyncStatus();
  const actions = useTaskActions();
  const { settings, updateSettings } = useSyncedSettings();
  const { theme } = preferences;

  const handleSignOut = () => {
    // Signing out clears the local cache, so anything still queued would go
    // with it. Refuse and say why rather than losing the user's captures.
    if (actions.hasUnsyncedWork()) {
      onSignOutBlocked?.(status.pending + status.failed);
      return;
    }
    void signOut();
  };

  return (
    <div className={styles.panel}>
      <Section title="Appearance">
        <Row label="Theme">
          <div className={styles.segmented} role="radiogroup" aria-label="Theme">
            {THEME_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={theme.mode === mode.value}
                className={cx(styles.segment, theme.mode === mode.value && styles.segmentActive)}
                onClick={() => setPreferences({ theme: { ...theme, mode: mode.value } })}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Accent">
          <div className={styles.swatches}>
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={cx(
                  styles.swatch,
                  theme.accent.toLowerCase() === preset.value.toLowerCase() &&
                    styles.swatchActive,
                )}
                style={{ background: preset.value }}
                title={preset.name}
                aria-label={preset.name}
                onClick={() => setPreferences({ theme: { ...theme, accent: preset.value } })}
              />
            ))}
          </div>
        </Row>

        {/*
          Transparency used to live here. It only ever affected the widget, so
          it moved to Customize, beside the colour it applies to.
        */}
        <Slider
          label="Row height"
          value={theme.rowHeight}
          min={THEME_LIMITS.rowHeight.min}
          max={THEME_LIMITS.rowHeight.max}
          step={1}
          format={(v) => `${v}px`}
          onChange={(rowHeight) => setPreferences({ theme: { ...theme, rowHeight } })}
        />

        <Slider
          label="Text size"
          value={theme.fontScale}
          min={0.85}
          max={1.4}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(fontScale) => setPreferences({ theme: { ...theme, fontScale } })}
        />
      </Section>

      <Section title="List">
        <Row label="Show completed tasks" hint="Keeps finished items visible under the open ones.">
          <Switch
            checked={preferences.showCompleted}
            onChange={(showCompleted) => setPreferences({ showCompleted })}
            label="Show completed tasks"
          />
        </Row>
        <Row
          label="Add tasks to the bottom"
          hint="New tasks go at the end of the list instead of the top."
        >
          <Switch
            checked={settings.addToBottom}
            onChange={(addToBottom) => updateSettings({ addToBottom })}
            label="Add tasks to the bottom"
          />
        </Row>
        <Row
          label="Clear completed tasks daily"
          hint="At midnight, finished tasks are deleted. Recoverable for 30 days."
        >
          <Switch
            checked={settings.autoClearCompleted}
            onChange={(autoClearCompleted) => updateSettings({ autoClearCompleted })}
            label="Clear completed tasks daily"
          />
        </Row>
      </Section>

      <CustomizeSection settings={settings} update={updateSettings} />

      {platformSection ? <Section title="Windows">{platformSection}</Section> : null}

      <Section title="Sync">
        <Row label="Status">
          <span className={styles.value}>
            {!status.online
              ? 'Offline'
              : status.failed > 0
                ? `${status.failed} change${status.failed === 1 ? '' : 's'} not saved`
                : status.pending > 0
                  ? `${status.pending} pending`
                  : status.live
                    ? 'Live'
                    : 'Connecting'}
          </span>
        </Row>
        <Row label="Last synced">
          <span className={styles.value}>
            {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'Never'}
          </span>
        </Row>
        {status.error ? <p className={styles.error}>{status.error}</p> : null}
        <div className={styles.buttonRow}>
          <Button size="sm" onClick={() => void actions.syncNow()}>
            Sync now
          </Button>
          {status.failed > 0 ? (
            <Button size="sm" variant="primary" onClick={() => actions.retryFailed()}>
              Retry {status.failed} failed
            </Button>
          ) : null}
        </div>
      </Section>

      <Section title="Account">
        <Row label="Signed in as">
          <span className={styles.value}>
            {authState.status === 'signed-in' ? (authState.email ?? authState.userId) : 'Not signed in'}
          </span>
        </Row>
        {authState.status === 'signed-in' ? (
          <div className={styles.buttonRow}>
            <Button size="sm" variant="danger" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------- customize */

const CORNERS: { value: WidgetCorners | null; label: string }[] = [
  { value: null, label: 'Default' },
  { value: 'none', label: 'None' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const TYPEFACES: { value: TaskTypeface; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
  { value: 'condensed', label: 'Condensed' },
];

const WEIGHTS: { value: TaskWeight; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'medium', label: 'Medium' },
  { value: 'bold', label: 'Bold' },
];

/**
 * The look of the list and the widgets, set once for every device.
 *
 * Every control has a way back to "Default", which is not a colour or a size
 * but "whatever this surface did before": the desktop and phone widgets have
 * different natural corners and borders, and light and dark themes different
 * natural text colours, and a stored value would freeze one of them.
 */
function CustomizeSection({
  settings,
  update,
}: {
  settings: SyncedSettings;
  update: (patch: Partial<SyncedSettings>) => void;
}) {
  return (
    <Section title="Customize">
      <p className={styles.note}>Applies on every device you are signed in on.</p>

      <h4 className={styles.subsectionTitle}>Widget</h4>
      <ColorField
        label="Background"
        value={settings.widgetBackground}
        onChange={(widgetBackground) => update({ widgetBackground })}
      />
      <Slider
        label="Transparency"
        hint="Of the widget background, on the desktop and the phone."
        value={settings.widgetOpacity}
        min={0}
        max={1}
        step={0.01}
        // Reads left-to-right as "more transparent", so it is inverted
        // relative to the opacity it writes.
        format={(v) => `${Math.round((1 - v) * 100)}%`}
        onChange={(widgetOpacity) => update({ widgetOpacity })}
      />
      <ColorField
        label="Border"
        value={settings.widgetBorder === 'none' ? null : settings.widgetBorder}
        none={settings.widgetBorder === 'none'}
        onChange={(widgetBorder) => update({ widgetBorder })}
        onNone={() => update({ widgetBorder: 'none' })}
      />
      <Row label="Rounded corners">
        <Segmented
          label="Rounded corners"
          options={CORNERS}
          value={settings.widgetCorners}
          onChange={(widgetCorners) => update({ widgetCorners })}
        />
      </Row>

      <h4 className={styles.subsectionTitle}>Tasks</h4>
      <OptionalSlider
        label="Font size"
        value={settings.taskFontSize}
        min={SETTING_LIMITS.taskFontSize.min}
        max={SETTING_LIMITS.taskFontSize.max}
        fallback={14}
        unit="px"
        onChange={(taskFontSize) => update({ taskFontSize })}
      />
      <ColorField
        label="Font colour"
        value={settings.taskColor}
        onChange={(taskColor) => update({ taskColor })}
      />
      <ColorField
        label="Completed font colour"
        value={settings.taskCompletedColor}
        onChange={(taskCompletedColor) => update({ taskCompletedColor })}
      />
      <Row label="Typeface">
        <Segmented
          label="Typeface"
          options={TYPEFACES}
          value={settings.taskTypeface}
          onChange={(taskTypeface) => update({ taskTypeface })}
        />
      </Row>
      <Row label="Weight">
        <Segmented
          label="Weight"
          options={WEIGHTS}
          value={settings.taskWeight}
          onChange={(taskWeight) => update({ taskWeight })}
        />
      </Row>
      <Row label="Italic">
        <Switch
          checked={settings.taskItalic}
          onChange={(taskItalic) => update({ taskItalic })}
          label="Italic"
        />
      </Row>
      <MarginsField value={settings.taskMargins} onChange={(taskMargins) => update({ taskMargins })} />
    </Section>
  );
}

/** A colour with a way back to Default, and for borders to none at all. */
function ColorField({
  label,
  value,
  none = false,
  onChange,
  onNone,
}: {
  label: string;
  value: string | null;
  none?: boolean;
  onChange: (value: string | null) => void;
  onNone?: () => void;
}) {
  const isDefault = value === null && !none;
  return (
    <Row label={label}>
      <div className={styles.inlineGroup}>
        <input
          type="color"
          className={cx(styles.colorInput, (isDefault || none) && styles.colorInputIdle)}
          // A picker cannot show "no colour"; grey is a neutral place to start.
          value={value ?? '#888888'}
          aria-label={`${label} colour`}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className={cx(styles.chip, isDefault && styles.chipActive)}
          aria-pressed={isDefault}
          onClick={() => onChange(null)}
        >
          Default
        </button>
        {onNone ? (
          <button
            type="button"
            className={cx(styles.chip, none && styles.chipActive)}
            aria-pressed={none}
            onClick={onNone}
          >
            None
          </button>
        ) : null}
      </div>
    </Row>
  );
}

function Segmented<T extends string | null>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={cx(styles.segment, value === option.value && styles.segmentActive)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A slider whose resting state is "Default" rather than a number. */
function OptionalSlider({
  label,
  value,
  min,
  max,
  fallback,
  unit,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  fallback: number;
  unit: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>
        <span>{label}</span>
      </div>
      <div className={styles.sliderGroup}>
        <input
          type="range"
          className={cx(styles.slider, value === null && styles.sliderIdle)}
          min={min}
          max={max}
          step={1}
          value={value ?? fallback}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <button
          type="button"
          className={cx(styles.chip, value === null && styles.chipActive)}
          aria-pressed={value === null}
          title={value === null ? undefined : 'Back to the default size'}
          onClick={() => onChange(null)}
        >
          {value === null ? 'Default' : `${value}${unit}`}
        </button>
      </div>
    </div>
  );
}

const SIDES: { key: keyof TaskMargins; label: string }[] = [
  { key: 'left', label: 'Left' },
  { key: 'top', label: 'Top' },
  { key: 'right', label: 'Right' },
  { key: 'bottom', label: 'Bottom' },
];

function MarginsField({
  value,
  onChange,
}: {
  value: TaskMargins;
  onChange: (value: TaskMargins) => void;
}) {
  const { min, max } = SETTING_LIMITS.taskMargin;
  return (
    <Row label="Margins" hint="Space around each task, in pixels.">
      <div className={styles.inlineGroup}>
        {SIDES.map((side) => (
          <label key={side.key} className={styles.marginField}>
            <span className={styles.marginLabel}>{side.label}</span>
            <input
              type="number"
              className={styles.marginInput}
              min={min}
              max={max}
              step={1}
              value={value[side.key]}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) onChange({ ...value, [side.key]: next });
              }}
            />
          </label>
        ))}
      </div>
    </Row>
  );
}

/* ---------------------------------------------------------------- pieces */

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>
        <span>{label}</span>
        {hint ? <span className={styles.rowHint}>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>
        <span>{label}</span>
        {hint ? <span className={styles.rowHint}>{hint}</span> : null}
      </div>
      <div className={styles.sliderGroup}>
        <input
          type="range"
          className={styles.slider}
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className={styles.sliderValue}>{format(value)}</span>
      </div>
    </div>
  );
}
