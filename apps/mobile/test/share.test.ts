import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_TEXT_LENGTH, createTask, normalizeText, toRow } from '@recall/core';
import { describe, expect, it } from 'vitest';
import { buildWidgetState, sameWidgetState } from '../src/widget.js';

/**
 * Sharing into Recall from other apps.
 *
 * The receiving side is native and never starts the webview, so it repeats a
 * few of the app's rules in Kotlin: how a captured text is tidied, and what a
 * task row looks like when it is sent straight to the server. These pin the
 * copies to the originals; a drift would show up as a shared link that reads
 * differently from a typed one, or a push the server rejects.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri/gen/android/app/src/main');
const kotlin = (name: string) =>
  readFileSync(join(ROOT, 'java/com/swapnil/recall', name), 'utf8');
const manifest = readFileSync(join(ROOT, 'AndroidManifest.xml'), 'utf8');

describe('the share receiver', () => {
  const receiver = kotlin('ShareReceiverActivity.kt');

  it('appears in the share sheet for text, which is how apps share links', () => {
    const declaration = /<activity[^>]*ShareReceiverActivity[\s\S]*?<\/activity>/.exec(manifest)?.[0];
    expect(declaration).toBeDefined();
    expect(declaration).toContain('android.intent.action.SEND');
    expect(declaration).toContain('android:mimeType="text/plain"');
    expect(declaration).toContain('android:exported="true"');
  });

  it('has no window, so the app shared from stays on screen', () => {
    const declaration = /<activity[^>]*ShareReceiverActivity[\s\S]*?<\/activity>/.exec(manifest)![0];
    expect(declaration).toContain('Theme.NoDisplay');
    // That theme requires finishing before onResume; finishing in onCreate does.
    expect(receiver).toMatch(/override fun onCreate[\s\S]*finish\(\)/);
    expect(receiver).not.toMatch(/override fun onResume/);
  });

  it('tidies text the way every other capture is tidied', () => {
    expect(receiver).toContain('MAX_TEXT_LENGTH = ' + MAX_TEXT_LENGTH);
    expect(receiver).toContain('Regex("\\\\s+")');
    // The rule being mirrored, so a change to it is noticed here.
    expect(normalizeText('  watch\n https://youtu.be/x  ')).toBe('watch https://youtu.be/x');
  });

  it('saves into the queue before trying the network', () => {
    const capture = receiver.indexOf('WidgetActions.capture');
    const push = receiver.indexOf('DirectSync.pushCapture');
    expect(capture).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(capture);
  });
});

describe('sending a shared task straight to the server', () => {
  const sync = kotlin('DirectSync.kt');

  it('builds the same row the app sends', () => {
    const fields = Object.keys(toRow(createTask('x', 'a0')));
    const body = sync.slice(sync.indexOf('private fun row('), sync.indexOf('private fun post('));
    const built = [...body.matchAll(/\.put\("([a-z_]+)"/g)].map((match) => match[1]);
    expect(built.sort()).toEqual(fields.sort());
  });

  it('goes through push_tasks, like every other write', () => {
    expect(sync).toContain('/rest/v1/rpc/push_tasks');
  });

  it('never refreshes the session itself', () => {
    // Refresh tokens rotate; a second holder using one signs the user out.
    expect(sync).not.toMatch(/refresh_token|grant_type/);
  });
});

describe('positions in the widget snapshot', () => {
  it('carries a run of positions, so shares in a row do not tie', () => {
    const state = buildWidgetState([], true, undefined, { top: ['Zz', 'Zy'], bottom: ['a1', 'a2'] });
    expect(state.positions).toEqual({ top: ['Zz', 'Zy'], bottom: ['a1', 'a2'] });
  });

  it('writes a new snapshot when they change', () => {
    const before = buildWidgetState([], true, undefined, { top: ['Zz'], bottom: ['a1'] });
    const after = buildWidgetState([], true, undefined, { top: ['Zy'], bottom: ['a1'] });
    expect(sameWidgetState(before, after)).toBe(false);
  });

  it('is read by a receiver that never hands out the same position twice', () => {
    // The fix for two shared links landing in no particular order: each share
    // takes the next unused position, counted per snapshot.
    const sync = kotlin('DirectSync.kt');
    expect(sync).toContain('positions.getOrNull(used)');
    expect(sync).toContain('.put("used", used + 1)');
    expect(sync).toContain('state.publishedAt');
  });
});
