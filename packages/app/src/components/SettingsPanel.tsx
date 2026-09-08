import { ACCENT_PRESETS, Button, Switch, cx, type ThemeMode } from '@recall/ui';
import type { ReactNode } from 'react';
import { useRecall, useSyncStatus, useTaskActions } from '../context.js';
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

        <Slider
          label="Transparency"
          hint="Most visible on the desktop widget, the only window with your desktop behind it."
          value={theme.surfaceAlpha}
          min={0.35}
          max={1}
          step={0.01}
          // The slider reads left-to-right as "more transparent", so it is
          // inverted relative to the alpha it writes.
          format={(v) => `${Math.round((1 - v) * 100)}%`}
          onChange={(surfaceAlpha) => setPreferences({ theme: { ...theme, surfaceAlpha } })}
        />

        <Slider
          label="Row height"
          value={theme.rowHeight}
          min={26}
          max={56}
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
      </Section>

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
