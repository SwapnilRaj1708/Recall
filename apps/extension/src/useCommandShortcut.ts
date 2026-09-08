import { useEffect, useState } from 'react';

/**
 * The shortcut Chrome actually assigned, which is not necessarily the one the
 * manifest asked for.
 *
 * `suggested_key` really is only a suggestion. If the combination is already
 * claimed — by Chrome itself, or by another extension — Chrome silently assigns
 * nothing, and the manifest's value becomes a lie the UI would otherwise repeat
 * back to the user. Reading the live binding is the only honest source.
 */
export function useCommandShortcut(commandName = '_execute_action'): string | null {
  const [shortcut, setShortcut] = useState<string | null>(null);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.commands?.getAll) return;
    void chrome.commands.getAll().then((commands) => {
      const command = commands.find((c) => c.name === commandName);
      setShortcut(command?.shortcut && command.shortcut.length > 0 ? command.shortcut : null);
    });
  }, [commandName]);

  return shortcut;
}
