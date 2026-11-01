import { describe, expect, it } from 'vitest';
import { AuthController, type SessionTokens } from '../src/supabase/auth.js';

/**
 * Following the access token.
 *
 * The phone's share receiver sends links to the server with the token the app
 * last held, so the app must hand over every new one — including silent
 * refreshes, which change nothing about who is signed in and so never reach
 * the ordinary auth subscribers.
 */

type AuthCallback = (event: string, session: unknown) => void;

function fakeClient(initial: unknown) {
  let callback: AuthCallback = () => {};
  const client = {
    auth: {
      getSession: async () => ({ data: { session: initial }, error: null }),
      onAuthStateChange: (cb: AuthCallback) => {
        callback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };
  return { client: client as never, emit: (event: string, session: unknown) => callback(event, session) };
}

const session = (token: string, user = 'user-1') => ({
  access_token: token,
  expires_at: 1_800_000_000,
  user: { id: user, email: 'someone@example.com' },
});

describe('access tokens', () => {
  it('reports the token of a restored session', async () => {
    const { client } = fakeClient(session('first'));
    const auth = new AuthController(client);
    const seen: (SessionTokens | null)[] = [];
    auth.onTokens((tokens) => seen.push(tokens));

    await auth.init();

    expect(seen.at(-1)).toEqual({ accessToken: 'first', expiresAt: 1_800_000_000, userId: 'user-1' });
  });

  it('reports a silent refresh, which ordinary subscribers never hear about', async () => {
    const { client, emit } = fakeClient(session('first'));
    const auth = new AuthController(client);
    await auth.init();
    let stateChanges = 0;
    auth.subscribe(() => stateChanges++);
    const seen: (string | undefined)[] = [];
    auth.onTokens((tokens) => seen.push(tokens?.accessToken));

    emit('TOKEN_REFRESHED', session('second'));

    expect(seen).toEqual(['first', 'second']);
    expect(stateChanges).toBe(0);
  });

  it('reports nothing once signed out', async () => {
    const { client, emit } = fakeClient(session('first'));
    const auth = new AuthController(client);
    await auth.init();
    const seen: (SessionTokens | null)[] = [];
    auth.onTokens((tokens) => seen.push(tokens));

    emit('SIGNED_OUT', null);

    expect(seen.at(-1)).toBeNull();
  });
});
