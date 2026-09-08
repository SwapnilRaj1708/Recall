/**
 * Translating between Tauri's accelerator syntax and what a Windows user reads.
 *
 * Tauri writes shortcuts in a cross-platform spelling — `CommandOrControl` so
 * that one string means Ctrl on Windows and Cmd on macOS. That is the right
 * thing to *store*, and the wrong thing to show: nobody has a key labelled
 * CommandOrControl. Recall ships on Windows, so the settings screen reads and
 * writes `Ctrl+Shift+Space` while the shell keeps registering the accelerator
 * form.
 *
 * Translating only at the edge, rather than storing the display spelling, keeps
 * one canonical value in preferences and in the OS registration.
 */

/** Accelerator token (lowercased) → what the key is called on a Windows keyboard. */
const TO_DISPLAY: Record<string, string> = {
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  command: 'Ctrl',
  cmd: 'Ctrl',
  super: 'Win',
  meta: 'Win',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  backslash: '\\',
  slash: '/',
  comma: ',',
  period: '.',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  minus: '-',
  equal: '=',
  plus: '+',
  bracketleft: '[',
  bracketright: ']',
};

/** The reverse, for the spellings a person is likely to type. */
const TO_ACCELERATOR: Record<string, string> = {
  ctrl: 'CommandOrControl',
  control: 'CommandOrControl',
  ctl: 'CommandOrControl',
  cmd: 'CommandOrControl',
  command: 'CommandOrControl',
  win: 'Super',
  windows: 'Super',
  meta: 'Super',
  super: 'Super',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  '+': 'Plus',
  plus: 'Plus',
  '\\': 'Backslash',
  '/': 'Slash',
  ',': 'Comma',
  '.': 'Period',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
};

/**
 * Split on `+`, but not on a `+` that *is* the key.
 *
 * `Ctrl+Shift++` is a real shortcut, and a naive split produces an empty final
 * token that then registers nothing.
 */
function tokenize(value: string): string[] {
  const parts = value.split('+');
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.trim();
    // An empty piece between two separators means the key itself was `+`.
    if (part === '' && i > 0 && i < parts.length - 1) {
      tokens.push('+');
      i++;
      continue;
    }
    if (part !== '') tokens.push(part);
  }
  return tokens;
}

/** `CommandOrControl+Shift+Space` → `Ctrl+Shift+Space`. */
export function toDisplayHotkey(accelerator: string): string {
  return tokenize(accelerator)
    .map((token) => TO_DISPLAY[token.toLowerCase()] ?? capitalize(token))
    .join('+');
}

/** `ctrl + shift + space` → `CommandOrControl+Shift+Space`. */
export function toAcceleratorHotkey(display: string): string {
  return tokenize(display)
    .map((token) => TO_ACCELERATOR[token.toLowerCase()] ?? capitalize(token))
    .join('+');
}

/** Single letters and digits go up; named keys keep their conventional casing. */
function capitalize(token: string): string {
  if (token.length === 1) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
}
