import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthState } from '../model/types.js';
import type { SupabaseRemote } from './remote.js';

/**
 * How a host opens the Google consent screen and gets the redirect back.
 *
 * The three surfaces differ only here: the web app navigates away and returns
 * on load, the extension uses `chrome.identity.launchWebAuthFlow`, and the
 * desktop app opens the system browser against a loopback listener. Everything
 * downstream of the redirect is identical, so it lives in one place.
 */
export interface OAuthLauncher {
  /** The URL Supabase should redirect to once Google is done. */
  redirectTo(): Promise<string> | string;
  /** Open `authorizeUrl` and resolve with the full redirect URL that came back. */
  launch(authorizeUrl: string): Promise<string>;
}

export class AuthController {
  private state: AuthState = { status: 'loading' };
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly client: SupabaseClient,
    private readonly remote?: SupabaseRemote,
  ) {}

  getState(): AuthState {
    return this.state;
  }

  getUserId(): string | null {
    return this.state.status === 'signed-in' ? this.state.userId : null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Resolve the stored session before the first render, so a returning user
   * never sees a sign-in screen flash before their list appears.
   */
  async init(): Promise<AuthState> {
    const { data, error } = await this.client.auth.getSession();
    if (error) this.setState({ status: 'signed-out', error: error.message });
    else this.applySession(data.session);

    const { data: sub } = this.client.auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
    });
    this.unsubscribe = () => sub.subscription.unsubscribe();

    return this.state;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Web app: navigate to Google and come back to `redirectTo` on this origin. */
  async signInWithGoogleRedirect(redirectTo: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        // Ask for a refresh token so the session survives a browser restart
        // and the user signs in once rather than every day.
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    if (error) this.setState({ status: 'signed-out', error: error.message });
  }

  /**
   * Extension and desktop: the host opens the consent screen itself and hands
   * back the redirect URL, which carries the PKCE authorisation code.
   */
  async signInWithGoogleExternal(launcher: OAuthLauncher): Promise<void> {
    try {
      const redirectTo = await launcher.redirectTo();
      const { data, error } = await this.client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (error || !data.url) throw error ?? new Error('Could not build the sign-in URL');

      const callbackUrl = await launcher.launch(data.url);
      const code = new URL(callbackUrl).searchParams.get('code');
      if (!code) {
        const described = new URL(callbackUrl).searchParams.get('error_description');
        throw new Error(described ?? 'Sign-in was cancelled');
      }

      const exchanged = await this.client.auth.exchangeCodeForSession(code);
      if (exchanged.error) throw exchanged.error;
      this.applySession(exchanged.data.session);
    } catch (error) {
      this.setState({
        status: 'signed-out',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
    this.setState({ status: 'signed-out' });
  }

  private applySession(session: { user?: { id: string; email?: string | null } } | null): void {
    if (session?.user) {
      this.setState({
        status: 'signed-in',
        userId: session.user.id,
        email: session.user.email ?? null,
      });
    } else {
      this.setState({ status: 'signed-out' });
    }
  }

  private setState(next: AuthState): void {
    const changed =
      this.state.status !== next.status ||
      (next.status === 'signed-in' &&
        this.state.status === 'signed-in' &&
        this.state.userId !== next.userId) ||
      (next.status === 'signed-out' &&
        this.state.status === 'signed-out' &&
        this.state.error !== next.error);
    if (!changed) return;

    this.state = next;
    // The realtime channel filters on user id, so the remote has to learn about
    // an identity change before anything tries to sync.
    this.remote?.setUser(next.status === 'signed-in' ? next.userId : null);
    for (const listener of this.listeners) listener();
  }
}
