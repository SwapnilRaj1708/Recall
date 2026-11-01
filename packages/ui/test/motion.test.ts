import { describe, expect, it } from 'vitest';
import { SPRINGS, Spring, VelocityTracker, project, rubberband } from '../src/motion.js';

/**
 * The physics behind every drag and sheet.
 *
 * These are the properties the interaction depends on rather than exact
 * numbers: a spring arrives, a critically damped one never overshoots, a
 * retarget keeps the speed it already had, and a boundary gives way less the
 * further past it you pull.
 */

/** A spring that never schedules frames; time is advanced by hand. */
const manual = (initial = 0) => {
  const seen: number[] = [];
  const spring = new Spring(initial, (value) => seen.push(value), {
    request: () => 1,
    cancel: () => {},
  });
  return { spring, seen };
};

function run(spring: Spring, seconds: number, onStep?: (value: number) => void): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    const resting = spring.step(1 / 60);
    onStep?.(spring.value);
    if (resting) return;
  }
}

describe('springs', () => {
  it('arrive at their target', () => {
    const { spring } = manual(0);
    spring.to(100);
    run(spring, 2);
    expect(spring.value).toBe(100);
    expect(spring.velocity).toBe(0);
  });

  it('never overshoot when critically damped', () => {
    const { spring } = manual(0);
    spring.to(100, SPRINGS.default);
    let max = 0;
    run(spring, 2, (value) => (max = Math.max(max, value)));
    expect(max).toBeLessThanOrEqual(100);
  });

  it('overshoot a little when underdamped, as a released drawer should', () => {
    const { spring } = manual(0);
    spring.to(100, SPRINGS.drawer);
    let max = 0;
    run(spring, 2, (value) => (max = Math.max(max, value)));
    expect(max).toBeGreaterThan(100);
    expect(max).toBeLessThan(105);
  });

  it('settle in about the time Apple’s response suggests', () => {
    const { spring } = manual(0);
    spring.to(100, SPRINGS.default);
    let elapsed = 0;
    while (!spring.step(1 / 60) && elapsed < 3) elapsed += 1 / 60;
    expect(elapsed).toBeGreaterThan(0.3);
    expect(elapsed).toBeLessThan(1);
  });

  it('keep their velocity when retargeted mid-flight, rather than stopping dead', () => {
    const { spring } = manual(0);
    spring.to(100);
    run(spring, 0.1);
    const before = spring.velocity;
    expect(before).toBeGreaterThan(0);

    spring.to(-100);
    // Still travelling the old way for a moment: no brick wall at the reversal.
    expect(spring.velocity).toBe(before);
    spring.step(1 / 60);
    expect(spring.velocity).toBeLessThan(before);
  });

  it('start from a handed-off velocity, as a released drag does', () => {
    const { spring } = manual(0);
    spring.to(0, SPRINGS.move, { velocity: 800 });
    spring.step(1 / 60);
    expect(spring.value).toBeGreaterThan(0);
  });

  it('jump straight to a value for 1:1 tracking', () => {
    const { spring, seen } = manual(0);
    spring.jump(42);
    expect(spring.value).toBe(42);
    expect(seen.at(-1)).toBe(42);
  });
});

describe('momentum projection', () => {
  it('uses Apple’s exponential decay', () => {
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(-1000)).toBeCloseTo(-499, 0);
    expect(project(0)).toBe(0);
  });

  it('throws further with a lower deceleration rate given', () => {
    expect(project(1000, 0.99)).toBeLessThan(project(1000, 0.998));
  });
});

describe('rubber-banding', () => {
  it('gives nothing at the boundary and less than the pull beyond it', () => {
    expect(rubberband(0, 300)).toBe(0);
    expect(rubberband(100, 300)).toBeGreaterThan(0);
    expect(rubberband(100, 300)).toBeLessThan(100);
  });

  it('resists more the further it is pulled', () => {
    const near = rubberband(50, 300) / 50;
    const far = rubberband(400, 300) / 400;
    expect(far).toBeLessThan(near);
  });

  it('is symmetric', () => {
    expect(rubberband(-80, 300)).toBeCloseTo(-rubberband(80, 300));
  });
});

describe('release velocity', () => {
  it('measures the recent movement, in units per second', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(10, 16);
    tracker.add(20, 32);
    expect(tracker.velocity()).toBeCloseTo(625, 0);
  });

  it('forgets samples older than its window', () => {
    const tracker = new VelocityTracker(100);
    tracker.add(0, 0);
    tracker.add(500, 50);
    tracker.add(500, 400);
    tracker.add(500, 416);
    expect(tracker.velocity()).toBe(0);
  });
});
