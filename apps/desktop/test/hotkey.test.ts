import { describe, expect, it } from 'vitest';
import { toAcceleratorHotkey, toDisplayHotkey } from '../src/hotkey.js';

/**
 * The settings screen showed `CommandOrControl+Shift+Space`, which is Tauri's
 * cross-platform accelerator spelling and not the name of any key on a Windows
 * keyboard. The value was correct — the shell really had fallen back to that
 * combination — so the fix belongs at the display edge, leaving one canonical
 * spelling in preferences and in the OS registration.
 */

describe('reading an accelerator', () => {
  it('names the key a Windows user is actually pressing', () => {
    expect(toDisplayHotkey('CommandOrControl+Shift+Space')).toBe('Ctrl+Shift+Space');
    expect(toDisplayHotkey('CommandOrControl+Alt+Space')).toBe('Ctrl+Alt+Space');
    expect(toDisplayHotkey('CmdOrCtrl+Alt+N')).toBe('Ctrl+Alt+N');
  });

  it('spells punctuation keys as the symbol on the keycap', () => {
    expect(toDisplayHotkey('CommandOrControl+Shift+Backslash')).toBe('Ctrl+Shift+\\');
  });

  it('calls the Windows key Win, not Ctrl', () => {
    // Super and Meta are a different physical key; folding them into Ctrl would
    // describe a shortcut the user cannot press.
    expect(toDisplayHotkey('Super+Space')).toBe('Win+Space');
    expect(toDisplayHotkey('Meta+Space')).toBe('Win+Space');
  });

  it('leaves keys it has no opinion about alone', () => {
    expect(toDisplayHotkey('CommandOrControl+F12')).toBe('Ctrl+F12');
  });
});

describe('writing an accelerator', () => {
  it('turns what a person types back into the stored spelling', () => {
    expect(toAcceleratorHotkey('Ctrl+Shift+Space')).toBe('CommandOrControl+Shift+Space');
    expect(toAcceleratorHotkey('ctrl + alt + n')).toBe('CommandOrControl+Alt+N');
    expect(toAcceleratorHotkey('Win+K')).toBe('Super+K');
  });

  it('accepts the accelerator spelling unchanged, for anyone who types it', () => {
    expect(toAcceleratorHotkey('CommandOrControl+Shift+Space')).toBe(
      'CommandOrControl+Shift+Space',
    );
  });

  it('names punctuation the way the shortcut registrar expects', () => {
    expect(toAcceleratorHotkey('Ctrl+Shift+\\')).toBe('CommandOrControl+Shift+Backslash');
  });
});

describe('round trips', () => {
  it.each([
    'CommandOrControl+Alt+Space',
    'CommandOrControl+Shift+Space',
    'CommandOrControl+Alt+N',
    'CommandOrControl+Shift+Backslash',
    'CommandOrControl+Alt+Backslash',
  ])('survives display and back for %s', (accelerator) => {
    // These five are the shell's fallback chain: every one of them has to make
    // it to the screen and back without changing what gets registered.
    expect(toAcceleratorHotkey(toDisplayHotkey(accelerator))).toBe(accelerator);
  });

  it('handles a shortcut whose key is the separator', () => {
    // `Ctrl+Shift++` splits into an empty token that would otherwise register
    // nothing at all.
    expect(toDisplayHotkey('CommandOrControl+Shift+Plus')).toBe('Ctrl+Shift++');
    expect(toAcceleratorHotkey('Ctrl+Shift++')).toBe('CommandOrControl+Shift+Plus');
  });

  it('does not invent a shortcut out of empty input', () => {
    expect(toDisplayHotkey('')).toBe('');
    expect(toAcceleratorHotkey('')).toBe('');
  });
});
