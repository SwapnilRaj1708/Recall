import { Row } from '@recall/app';
import { Kbd, Switch, TextInput } from '@recall/ui';
import { useEffect, useState } from 'react';
import { toAcceleratorHotkey, toDisplayHotkey } from './hotkey.js';
import { desktop } from './tauri.js';

export interface DesktopSettingsProps {
  alwaysOnTop: boolean;
  onAlwaysOnTopChange: (value: boolean) => void;
  hotkey: string;
  onHotkeyChange: (value: string) => void;
}

/**
 * The Windows-only half of the settings screen, injected into the shared
 * SettingsPanel so appearance and platform options read as one list.
 */
export function DesktopSettings({
  alwaysOnTop,
  onAlwaysOnTopChange,
  hotkey,
  onHotkeyChange,
}: DesktopSettingsProps) {
  const [autostart, setAutostart] = useState(false);
  const [widgetVisible, setWidgetVisible] = useState(true);
  // Shown in Windows spelling; converted back to an accelerator on save.
  const [hotkeyDraft, setHotkeyDraft] = useState(() => toDisplayHotkey(hotkey));
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  // Autostart, window visibility and the hotkey are owned by the OS and the
  // shell, not by our preferences file, so they are read back rather than
  // assumed. The hotkey in particular can fail at startup when another
  // application already owns the combination — and quick capture silently
  // doing nothing is the worst failure this app has, so it is surfaced here.
  useEffect(() => {
    void desktop.getAutostart().then(setAutostart).catch(() => {});
    void desktop.isWidgetVisible().then(setWidgetVisible).catch(() => {});
    void desktop
      .getHotkeyStatus()
      .then((status) => {
        if (status.accelerator) setHotkeyDraft(toDisplayHotkey(status.accelerator));
        setHotkeyError(status.registered ? null : (status.error ?? null));
      })
      .catch(() => {});
  }, []);

  const applyHotkey = async (typed: string) => {
    const accelerator = toAcceleratorHotkey(typed);
    try {
      await desktop.setGlobalHotkey(accelerator);
      setHotkeyError(null);
      // Echo back what the shell accepted, so a loose spelling tidies itself up.
      setHotkeyDraft(toDisplayHotkey(accelerator));
      onHotkeyChange(accelerator);
    } catch (error) {
      // Usually means another application already owns the combination.
      setHotkeyError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <Row label="Show the widget" hint="The always-visible list on your desktop.">
        <Switch
          checked={widgetVisible}
          label="Show the widget"
          onChange={() => {
            void desktop.toggleWidget().then(setWidgetVisible);
          }}
        />
      </Row>

      <Row label="Keep the widget on top" hint="Stays visible over other windows.">
        <Switch
          checked={alwaysOnTop}
          label="Keep the widget on top"
          onChange={(next) => {
            void desktop.setWidgetAlwaysOnTop(next);
            onAlwaysOnTopChange(next);
          }}
        />
      </Row>

      <Row label="Start with Windows" hint="Recall opens in the tray when you sign in.">
        <Switch
          checked={autostart}
          label="Start with Windows"
          onChange={(next) => {
            setAutostart(next);
            void desktop.setAutostart(next).catch(() => setAutostart(!next));
          }}
        />
      </Row>

      <Row
        label="Quick capture shortcut"
        hint={
          hotkeyError
            ? 'Not active — another application owns this combination.'
            : 'Works from anywhere in Windows.'
        }
      >
        <TextInput
          value={hotkeyDraft}
          error={hotkeyError ?? undefined}
          onChange={(event) => setHotkeyDraft(event.target.value)}
          onBlur={() => void applyHotkey(hotkeyDraft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void applyHotkey(hotkeyDraft);
          }}
          aria-label="Quick capture shortcut"
          style={{ width: 220 }}
        />
      </Row>

      <Row label="In the main window">
        <span style={{ display: 'flex', gap: 'var(--rc-space-3)' }}>
          <Kbd>Ctrl+N</Kbd>
          <Kbd>Ctrl+F</Kbd>
        </span>
      </Row>
    </>
  );
}
