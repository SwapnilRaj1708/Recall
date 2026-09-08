import { Button, Icon, SkeletonList, cx } from '@recall/ui';
import { useState, type ReactNode } from 'react';
import { useRecall, useTasks } from '../context.js';
import styles from './AuthGate.module.css';

export interface AuthGateProps {
  children: ReactNode;
  compact?: boolean;
}

/**
 * Decides whether this surface can show the list.
 *
 * The interesting case is "signed out but we still hold a cached list". That
 * happens when a refresh token finally expires, and blocking the UI behind a
 * sign-in wall at that moment would hide tasks the user can already see on
 * their phone — and would strand anything still in the outbox. So the list
 * stays visible with a banner, and only a genuinely empty, signed-out surface
 * gets the sign-in screen.
 */
export function AuthGate({ children, compact = false }: AuthGateProps) {
  const { authState } = useRecall();
  const { all } = useTasks();

  if (authState.status === 'loading') {
    return (
      <div className={styles.loading}>
        <SkeletonList rows={compact ? 3 : 5} />
      </div>
    );
  }

  if (authState.status === 'signed-out') {
    if (all.length === 0) return <SignIn compact={compact} error={authState.error} />;
    return (
      <div className={styles.stack}>
        <ReconnectBanner />
        {children}
      </div>
    );
  }

  return <>{children}</>;
}

export function SignIn({ compact, error }: { compact?: boolean; error?: string }) {
  const { signIn } = useRecall();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx(styles.signIn, compact && styles.signInCompact)}>
      <div className={styles.mark} aria-hidden="true">
        <Icon name="inbox" size={compact ? 22 : 28} />
      </div>
      <h1 className={styles.title}>Recall</h1>
      {!compact ? (
        <p className={styles.subtitle}>
          One list, on every screen you use. Sign in once and it stays signed in.
        </p>
      ) : null}

      {/*
        A neutral surface rather than the accent colour: Google's mark keeps its
        own colours, and their branding terms require it to sit on white or a
        light neutral, not on an arbitrary brand background.
      */}
      <Button variant="secondary" size="lg" icon="google" onClick={() => void start()} disabled={busy}>
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </Button>

      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}

function ReconnectBanner() {
  const { signIn } = useRecall();
  return (
    <div className={styles.banner} role="status">
      <Icon name="cloud-off" size={14} />
      <span className={styles.bannerText}>
        Signed out — showing your last synced list. Changes are saved locally.
      </span>
      <Button size="sm" variant="ghost" onClick={() => void signIn()}>
        Sign in
      </Button>
    </div>
  );
}
