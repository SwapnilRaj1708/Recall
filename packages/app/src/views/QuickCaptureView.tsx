import { Icon, Kbd } from '@recall/ui';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSyncStatus, useTaskActions } from '../context.js';
import styles from './views.module.css';

export interface QuickCaptureViewProps {
  /** Dismiss the window. Called on Escape and after a successful capture. */
  onDone: () => void;
  onCancel: () => void;
}

/**
 * The global-hotkey capture window.
 *
 * The whole surface is one text field, because the interaction it serves is
 * "I just remembered something and I am about to forget it again". No list, no
 * navigation, no confirmation — press the hotkey, type, press Enter, and the
 * window is gone before the thought is.
 */
export function QuickCaptureView({ onDone, onCancel }: QuickCaptureViewProps) {
  const actions = useTaskActions();
  const status = useSyncStatus();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Enter') return;

    event.preventDefault();
    const text = value.trim();
    if (text.length === 0) {
      onCancel();
      return;
    }

    // Do not await. The task is in memory and in the outbox by the time this
    // returns; making the user watch a spinner would defeat the point.
    void actions.capture(text);
    setValue('');
    setSaved(true);

    // Ctrl+Enter keeps the window open for a burst of related thoughts.
    if (event.ctrlKey || event.metaKey) {
      window.setTimeout(() => setSaved(false), 900);
      inputRef.current?.focus();
    } else {
      onDone();
    }
  };

  return (
    <div className={`${styles.quickCapture} rc-glass`}>
      <span className={styles.quickCaptureIcon}>
        <Icon name={saved ? 'check' : 'plus'} size={18} />
      </span>
      <input
        ref={inputRef}
        className={styles.quickCaptureInput}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (saved) setSaved(false);
        }}
        onKeyDown={onKeyDown}
        placeholder={saved ? 'Saved. Keep going…' : 'Remember…'}
        aria-label="Capture a task"
        autoComplete="off"
        spellCheck={false}
      />
      <span className={styles.quickCaptureHint}>
        {!status.online ? (
          <span title="Saved locally and queued">Offline</span>
        ) : (
          <>
            <Kbd>Enter</Kbd>
            <Kbd>Esc</Kbd>
          </>
        )}
      </span>
    </div>
  );
}
