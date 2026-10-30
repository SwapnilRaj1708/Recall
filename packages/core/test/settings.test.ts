import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings/schema.js';
import { SettingsStore, combine } from '../src/settings/store.js';
import { nextLocalMidnight, startOfLocalDay } from '../src/settings/day.js';
import { MemoryStorage } from '../src/storage/memory.js';
import { FakeRemote, FakeServer } from '../src/testing/fakeServer.js';
import { makeClient, settle, textsOf } from './helpers.js';

/**
 * Settings that follow the account.
 *
 * The store is small, but it carries the same promise as the task list: a
 * change made anywhere, online or not, ends up everywhere, and two changes to
 * different settings never cost each other.
 */

let server: FakeServer;
beforeEach(() => {
  server = new FakeServer();
});

/** A device: its own store, storage and connection, with a clock it controls. */
function device(options: { storage?: MemoryStorage; userId?: string | null } = {}) {
  let tick = 0;
  let base = Date.UTC(2026, 0, 1);
  const remote = new FakeRemote(server, options.userId === undefined ? 'user-1' : options.userId);
  const storage = options.storage ?? new MemoryStorage();
  const store = new SettingsStore({
    storage,
    remote,
    now: () => new Date(base + tick++ * 1000).toISOString(),
    channelName: null,
  });
  return {
    store,
    remote,
    storage,
    /** Move this device's clock, to make its next change unambiguously later. */
    later: (ms: number) => {
      base += ms;
    },
  };
}

describe('validating settings', () => {
  it('falls back to defaults for anything malformed', () => {
    const settings = normalizeSettings({
      addToBottom: 'yes',
      widgetBackground: 'red',
      widgetOpacity: 7,
      taskFontSize: 400,
      taskTypeface: 'comic',
      taskMargins: { left: -5, top: 'x', right: 100 },
    });
    expect(settings.addToBottom).toBe(false);
    expect(settings.widgetBackground).toBeNull();
    expect(settings.widgetOpacity).toBe(1);
    expect(settings.taskFontSize).toBe(24);
    expect(settings.taskTypeface).toBe('system');
    expect(settings.taskMargins).toEqual({ left: 0, top: 0, right: 24, bottom: 0 });
  });

  it('accepts a border of none as a choice, distinct from the default', () => {
    expect(normalizeSettings({ widgetBorder: 'none' }).widgetBorder).toBe('none');
    expect(normalizeSettings({ widgetBorder: null }).widgetBorder).toBeNull();
  });

  it('starts from settings that change nothing about how anything looks', () => {
    expect(DEFAULT_SETTINGS.addToBottom).toBe(false);
    expect(DEFAULT_SETTINGS.autoClearCompleted).toBe(false);
    expect(DEFAULT_SETTINGS.taskColor).toBeNull();
    expect(DEFAULT_SETTINGS.widgetCorners).toBeNull();
  });
});

describe('syncing settings', () => {
  it('applies a change at once and delivers it to another device', async () => {
    const phone = device();
    const desktop = device();
    await phone.store.start();
    await desktop.store.start();

    await phone.store.update({ addToBottom: true });
    expect(phone.store.get().addToBottom).toBe(true);
    await settle();

    await desktop.store.sync();
    expect(desktop.store.get().addToBottom).toBe(true);
  });

  it('keeps both of two changes made to different settings while apart', async () => {
    const phone = device();
    const desktop = device();
    await phone.store.start();
    await desktop.store.start();
    phone.remote.goOffline();

    await phone.store.update({ taskFontSize: 16 });
    await desktop.store.update({ widgetCorners: 'small' });
    await settle();

    phone.remote.goOnline();
    await phone.store.sync();
    await desktop.store.sync();

    for (const each of [phone, desktop]) {
      expect(each.store.get().taskFontSize).toBe(16);
      expect(each.store.get().widgetCorners).toBe('small');
    }
  });

  it('settles a setting changed in two places on the later change', async () => {
    const phone = device();
    const desktop = device();
    await phone.store.start();
    await desktop.store.start();
    phone.remote.goOffline();

    await phone.store.update({ taskColor: '#111111' });
    desktop.later(60_000);
    await desktop.store.update({ taskColor: '#222222' });
    await settle();

    phone.remote.goOnline();
    await phone.store.sync();
    await desktop.store.sync();

    expect(phone.store.get().taskColor).toBe('#222222');
    expect(desktop.store.get().taskColor).toBe('#222222');
  });

  it('keeps an offline change and delivers it later', async () => {
    const phone = device();
    await phone.store.start();
    phone.remote.goOffline();

    await phone.store.update({ autoClearCompleted: true });
    await settle();
    expect(phone.store.hasUnsyncedChanges()).toBe(true);

    phone.remote.goOnline();
    await phone.store.sync();
    expect(phone.store.hasUnsyncedChanges()).toBe(false);
    expect(server.getSettings('user-1').autoClearCompleted?.v).toBe(true);
  });

  it('survives a restart before the change was sent', async () => {
    const storage = new MemoryStorage();
    const first = device({ storage });
    await first.store.start();
    first.remote.goOffline();
    await first.store.update({ taskWeight: 'bold' });
    await settle();
    first.store.stop();

    const second = device({ storage });
    await second.store.start();
    expect(second.store.get().taskWeight).toBe('bold');
    await second.store.sync();
    expect(server.getSettings('user-1').taskWeight?.v).toBe('bold');
  });

  it('holds a change made before signing in and sends it once signed in', async () => {
    const phone = device({ userId: null });
    await phone.store.start();
    await phone.store.update({ addToBottom: true });
    await settle();
    expect(server.getSettings('user-1')).toEqual({});

    phone.remote.setUserId('user-1');
    await phone.store.sync();
    expect(server.getSettings('user-1').addToBottom?.v).toBe(true);
  });

  it('follows live updates from another device', async () => {
    const phone = device();
    const desktop = device();
    await phone.store.start();
    await desktop.store.start();
    phone.remote.connectRealtime();

    await desktop.store.update({ widgetOpacity: 0.5 });
    await settle();

    expect(phone.store.get().widgetOpacity).toBe(0.5);
  });

  it('forgets the account on reset', async () => {
    const phone = device();
    await phone.store.start();
    await phone.store.update({ taskItalic: true });
    await settle();

    await phone.store.reset();
    expect(phone.store.get()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('sharing settings between windows on one machine', () => {
  it('merges per key rather than letting one window overwrite another', () => {
    const merged = combine(
      { stamped: { addToBottom: { v: true, t: '2026-01-01T00:00:02Z' } }, dirty: ['addToBottom'] },
      {
        stamped: {
          addToBottom: { v: false, t: '2026-01-01T00:00:01Z' },
          taskItalic: { v: true, t: '2026-01-01T00:00:03Z' },
        },
        dirty: ['taskItalic'],
      },
    );
    expect(merged.stamped.addToBottom?.v).toBe(true);
    expect(merged.stamped.taskItalic?.v).toBe(true);
    expect(merged.dirty.sort()).toEqual(['addToBottom', 'taskItalic']);
  });

  it('treats a write one window has already sent as sent', () => {
    const write = { v: true, t: '2026-01-01T00:00:02Z' };
    const merged = combine(
      { stamped: { addToBottom: write }, dirty: ['addToBottom'] },
      { stamped: { addToBottom: write }, dirty: [] },
    );
    expect(merged.dirty).toEqual([]);
  });
});

describe('where new tasks go', () => {
  it('puts them at the top by default', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    await engine.capture('first');
    await engine.capture('second');
    expect(textsOf(engine.getOpenTasks())).toEqual(['second', 'first']);
  });

  it('puts them at the bottom when asked to', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    engine.setNewTaskPlacement('bottom');
    await engine.capture('first');
    await engine.capture('second');
    await engine.capture('third');
    expect(textsOf(engine.getOpenTasks())).toEqual(['first', 'second', 'third']);
  });
});

describe('clearing completed tasks at the end of the day', () => {
  it('deletes what was finished before the cutoff and leaves the rest', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    const old = await engine.capture('finished yesterday');
    const fresh = await engine.capture('finished today');
    await engine.capture('still open');
    await engine.setCompleted(old!.id, true);
    await engine.setCompleted(fresh!.id, true);

    // Between the two completions, which the client's clock stamps 10ms apart.
    const yesterday = engine.getTasks().find((t) => t.id === old!.id)!;
    const cutoff = new Date(Date.parse(yesterday.completedAt!) + 5);

    expect(await engine.clearCompletedBefore(cutoff)).toBe(1);
    expect(textsOf(engine.getCompletedTasks())).toEqual(['finished today']);
    expect(textsOf(engine.getOpenTasks())).toEqual(['still open']);
  });

  it('deletes recoverably, the same way as by hand', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    const task = await engine.capture('done');
    await engine.setCompleted(task!.id, true);

    await engine.clearCompletedBefore(new Date(Date.UTC(2100, 0, 1)));

    expect(textsOf(engine.getDeletedTasks())).toEqual(['done']);
    await engine.restore(task!.id);
    expect(textsOf(engine.getCompletedTasks())).toEqual(['done']);
  });
});

describe('local day boundaries', () => {
  it('finds the start of today and the next midnight in local time', () => {
    const now = new Date(2026, 9, 31, 23, 59, 30);
    expect(startOfLocalDay(now)).toEqual(new Date(2026, 9, 31));
    expect(nextLocalMidnight(now)).toEqual(new Date(2026, 10, 1));
  });
});
