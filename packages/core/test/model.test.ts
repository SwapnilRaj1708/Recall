import { describe, expect, it } from 'vitest';
import { Clock, isNewer, maxTimestamp } from '../src/model/clock.js';
import {
  compareByPosition,
  positionAfter,
  positionBefore,
  positionBetween,
  positionForNewCapture,
  positionsBetween,
  isValidPosition,
} from '../src/model/fracIndex.js';
import { isSameVersion, mergeAll, mergeTask } from '../src/model/merge.js';
import {
  createTask,
  isPurgeableTombstone,
  normalizeText,
  withCompleted,
  withDeleted,
  withPosition,
  withText,
} from '../src/model/task.js';

const BASE = Date.UTC(2026, 0, 1);

/** A clock fixed at BASE + offset, so every fixture in a test shares one era. */
const at = (offsetMs: number) => new Clock(() => BASE + offsetMs);
const clock = () => at(0);

describe('Clock', () => {
  it('never issues the same timestamp twice, even within one millisecond', () => {
    const c = new Clock(() => 1_700_000_000_000);
    const stamps = Array.from({ length: 100 }, () => c.now());
    expect(new Set(stamps).size).toBe(100);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it('does not go backwards when the wall clock is adjusted backwards', () => {
    let wall = 2_000;
    const c = new Clock(() => wall);
    const first = c.now();
    wall = 1_000; // NTP correction, timezone change, VM resume
    const second = c.now();
    expect(isNewer(second, first)).toBe(true);
  });

  it('jumps forward past timestamps seen from other devices', () => {
    const c = new Clock(() => 1_000);
    const remote = new Date(9_999_999).toISOString();
    c.observe(remote);
    expect(isNewer(c.now(), remote)).toBe(true);
  });

  it('ignores unparseable observations rather than corrupting the clock', () => {
    const c = new Clock(() => 5_000);
    c.observe('not a date');
    expect(c.now()).toBe(new Date(5_000).toISOString());
  });

  it('maxTimestamp picks the latest', () => {
    expect(maxTimestamp('2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });
});

describe('normalizeText', () => {
  it('collapses whitespace and trims, so pasted text behaves like typed text', () => {
    expect(normalizeText('  renew   my\n\npassport  ')).toBe('renew my passport');
  });

  it('caps length at the column limit', () => {
    expect(normalizeText('x'.repeat(5000))).toHaveLength(2000);
  });
});

describe('fractional indexing', () => {
  it('generates keys that sort between their neighbours', () => {
    const a = positionBefore(null);
    const b = positionAfter(a);
    const mid = positionBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('supports repeated insertion at the same midpoint without collision', () => {
    let low = positionBefore(null);
    let high = positionAfter(low);
    const seen = new Set([low, high]);
    for (let i = 0; i < 200; i++) {
      const mid = positionBetween(low, high);
      expect(seen.has(mid)).toBe(false);
      expect(low < mid && mid < high).toBe(true);
      seen.add(mid);
      high = mid;
    }
    expect(low < high).toBe(true);
  });

  it('keeps keys short when repeatedly appending', () => {
    let last: string | null = null;
    for (let i = 0; i < 500; i++) last = positionAfter(last);
    expect(last!.length).toBeLessThan(12);
  });

  it('keeps keys short when repeatedly prepending, which is the capture path', () => {
    let first: string | null = null;
    for (let i = 0; i < 500; i++) first = positionBefore(first);
    expect(first!.length).toBeLessThan(12);
  });

  it('positionsBetween produces an ordered run', () => {
    const keys = positionsBetween(null, null, 10);
    expect(keys).toHaveLength(10);
    expect([...keys].sort()).toEqual(keys);
  });

  it('new captures sort above everything already in the list', () => {
    const existing = positionsBetween(null, null, 5).map((position) => ({ position }));
    const fresh = positionForNewCapture(existing);
    for (const task of existing) expect(fresh < task.position).toBe(true);
  });

  it('new captures work against an empty list', () => {
    expect(typeof positionForNewCapture([])).toBe('string');
  });

  it('compareByPosition orders lexicographically', () => {
    const items = [{ position: 'a2' }, { position: 'a0' }, { position: 'a1' }];
    expect(items.sort(compareByPosition).map((i) => i.position)).toEqual(['a0', 'a1', 'a2']);
  });
});

describe('mergeTask', () => {
  const base = () => createTask('original', 'a0', clock());

  it('takes the incoming version when there is no local one', () => {
    const task = base();
    expect(mergeTask(undefined, task)).toEqual(task);
  });

  it('keeps concurrent edits to different fields — the reason for per-field clocks', () => {
    const original = base();

    // Phone renames the task.
    const renamed = withText(original, 'renamed on phone', at(1_000));
    // Desktop, offline and unaware, completes the same task.
    const completed = withCompleted(original, true, at(2_000));

    const merged = mergeTask(renamed, completed);

    expect(merged.text).toBe('renamed on phone');
    expect(merged.completed).toBe(true);
  });

  it('resolves same-field conflicts in favour of the newer clock', () => {
    const original = base();
    const older = withText(original, 'older', at(1_000));
    const newer = withText(original, 'newer', at(5_000));

    expect(mergeTask(older, newer).text).toBe('newer');
    expect(mergeTask(newer, older).text).toBe('newer');
  });

  it('keeps the incumbent on an exact tie, in both directions', () => {
    const original = base();
    const a = withText(original, 'a', at(1_000));
    const b = { ...withText(original, 'b', at(1_000)) };
    b.textUpdatedAt = a.textUpdatedAt;

    expect(mergeTask(a, b).text).toBe('a');
    expect(mergeTask(b, a).text).toBe('b');
  });

  it('moves `completed` and `completedAt` together so they cannot disagree', () => {
    const original = base();
    const done = withCompleted(original, true, at(5_000));
    const stillOpen = withCompleted(original, false, at(1_000));

    const merged = mergeTask(stillOpen, done);
    expect(merged.completed).toBe(true);
    expect(merged.completedAt).toBe(done.completedAt);

    const reverted = mergeTask(done, withCompleted(original, false, at(9_000)));
    expect(reverted.completed).toBe(false);
    expect(reverted.completedAt).toBeNull();
  });

  it('lets a newer delete win over an older edit', () => {
    const original = base();
    const edited = withText(original, 'edited', at(1_000));
    const deleted = withDeleted(original, true, at(5_000));

    const merged = mergeTask(edited, deleted);
    expect(merged.deletedAt).not.toBeNull();
    // The edit is still preserved, so restoring brings back the newer text.
    expect(merged.text).toBe('edited');
  });

  it('lets a newer undelete win over an older delete', () => {
    const original = base();
    const deleted = withDeleted(original, true, at(1_000));
    const restored = withDeleted(deleted, false, at(5_000));
    expect(mergeTask(deleted, restored).deletedAt).toBeNull();
  });

  it('is commutative — order of arrival cannot change the result', () => {
    const original = base();
    const a = withText(original, 'from A', at(3_000));
    const b = withPosition(original, 'zz', at(4_000));

    const ab = mergeTask(a, b);
    const ba = mergeTask(b, a);
    expect(isSameVersion(ab, ba)).toBe(true);
  });

  it('is idempotent — re-delivering the same version changes nothing', () => {
    const task = withText(base(), 'stable', at(3_000));
    expect(isSameVersion(mergeTask(task, task), task)).toBe(true);
  });

  it('keeps the earliest creation time so replicas agree', () => {
    const early = { ...base(), createdAt: '2020-01-01T00:00:00.000Z' };
    const late = { ...early, createdAt: '2026-01-01T00:00:00.000Z' };
    expect(mergeTask(late, early).createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(mergeTask(early, late).createdAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('derives updatedAt from the field clocks rather than trusting the wire value', () => {
    const task = withText(base(), 'x', at(8_000));
    const lying = { ...task, updatedAt: '1999-01-01T00:00:00.000Z' };
    expect(mergeTask(undefined, lying).updatedAt).toBe(task.textUpdatedAt);
  });

  it('refuses to merge two different tasks', () => {
    expect(() => mergeTask(base(), base())).toThrow(/different tasks/);
  });
});

describe('mergeAll', () => {
  it('reports only genuinely changed tasks, so echoes do not re-render the UI', () => {
    const task = createTask('a', 'a0', clock());
    const map = new Map([[task.id, task]]);

    expect(mergeAll(map, [task])).toHaveLength(0);

    const edited = withText(task, 'b', at(9_000));
    expect(mergeAll(map, [edited])).toHaveLength(1);
    expect(map.get(task.id)?.text).toBe('b');
  });

  it('inserts unseen tasks', () => {
    const map = new Map<string, ReturnType<typeof createTask>>();
    const task = createTask('new', 'a0', clock());
    expect(mergeAll(map, [task])).toHaveLength(1);
    expect(map.size).toBe(1);
  });
});

describe('tombstone retention', () => {
  it('keeps a fresh tombstone and purges an expired one', () => {
    const task = withDeleted(createTask('gone', 'a0', clock()), true, clock());
    const deletedAt = Date.parse(task.deletedAt!);
    expect(isPurgeableTombstone(task, deletedAt + 1_000)).toBe(false);
    expect(isPurgeableTombstone(task, deletedAt + 31 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  it('never purges a live task', () => {
    expect(isPurgeableTombstone(createTask('live', 'a0', clock()), Date.now())).toBe(false);
  });
});

describe('malformed position keys', () => {
  // Fractional index keys encode their own length in the first character, so
  // strings that look plausible ("c0", "b0") are actually invalid. One of these
  // reaching the list — from a hand-edited row, a bad migration, or a future
  // client bug — must not make the whole list un-reorderable.
  const MALFORMED = ['c0', 'b0', '', 'zzz', '!!', 'a', '0'];

  it.each(MALFORMED)('rejects %j as a valid key', (key) => {
    expect(isValidPosition(key)).toBe(false);
  });

  it.each(['a0', 'a1', 'Zz', 'a0V'])('accepts %j as a valid key', (key) => {
    expect(isValidPosition(key)).toBe(true);
  });

  it('rejects non-strings without throwing', () => {
    expect(isValidPosition(null)).toBe(false);
    expect(isValidPosition(undefined)).toBe(false);
  });

  it('still produces a usable key when an anchor is malformed', () => {
    for (const bad of MALFORMED) {
      expect(isValidPosition(positionAfter(bad))).toBe(true);
      expect(isValidPosition(positionBefore(bad))).toBe(true);
      expect(isValidPosition(positionBetween(bad, null))).toBe(true);
      expect(isValidPosition(positionBetween(null, bad))).toBe(true);
      expect(isValidPosition(positionBetween(bad, bad))).toBe(true);
      expect(isValidPosition(positionBetween('a0', bad))).toBe(true);
      expect(isValidPosition(positionBetween(bad, 'a0'))).toBe(true);
    }
  });

  it('keeps capture working when the list contains a malformed row', () => {
    const list = [{ position: 'a1' }, { position: 'c0' }, { position: 'a2' }];
    const fresh = positionForNewCapture(list);
    expect(isValidPosition(fresh)).toBe(true);
    // Still sorts above the rows we can actually reason about.
    expect(fresh < 'a1').toBe(true);
  });

  it('handles an inverted pair without throwing', () => {
    expect(isValidPosition(positionBetween('a2', 'a1'))).toBe(true);
  });
});
