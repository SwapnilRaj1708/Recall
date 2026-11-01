import { useEffect, useState } from 'react';

/**
 * Motion that behaves like a physical object rather than a script.
 *
 * Everything that a person can touch — a dragged task, a sheet being pulled
 * down — is driven by a spring, because a spring has no fixed duration and no
 * fixed path: give it a new target mid-flight and it simply turns towards it,
 * keeping the velocity it already has. That is what makes motion
 * interruptible, and interruptibility is what makes it feel alive.
 *
 * The parameters are Apple's two designer-facing ones rather than physics:
 *
 *   dampingRatio  1 settles without overshoot; below 1 it bounces.
 *   response      roughly how long it takes to get there, in seconds. Not a
 *                 duration — the settle time falls out of the physics.
 *
 * The rule for choosing: critically damped everywhere, and bounce only when
 * the gesture itself carried momentum.
 */

export interface SpringConfig {
  dampingRatio: number;
  response: number;
}

/** Apple's shipped values, named for what they are used for. */
export const SPRINGS = {
  /** The house default: smooth, no overshoot. */
  default: { dampingRatio: 1, response: 0.35 },
  /** Repositioning something, such as a dropped task settling into its slot. */
  move: { dampingRatio: 1, response: 0.4 },
  /** A sheet or drawer released after a drag, which carried momentum. */
  drawer: { dampingRatio: 0.8, response: 0.3 },
} as const satisfies Record<string, SpringConfig>;

/**
 * Where a flick would come to rest.
 *
 * Apple's projection, from the Designing Fluid Interfaces sample code: the
 * exponential-decay form that scroll views use, not the textbook v²/2a. A
 * release is judged by where it is heading, not where the finger let go.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Resistance past a boundary: the further over, the less it follows.
 *
 * A hard stop reads as frozen; giving way less and less reads as "responsive,
 * but there is nothing more here".
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Velocity from the last few pointer samples.
 *
 * The finger's speed at release is what the following animation inherits, so
 * it is measured over a short recent window rather than from the last two
 * events, which are noisy, or the whole gesture, which is stale.
 */
export class VelocityTracker {
  private samples: { t: number; value: number }[] = [];

  constructor(private readonly windowMs = 100) {}

  add(value: number, t: number = performance.now()): void {
    this.samples.push({ t, value });
    const cutoff = t - this.windowMs;
    while (this.samples.length > 2 && this.samples[0]!.t < cutoff) this.samples.shift();
  }

  /** Units per second. */
  velocity(): number {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.t === first.t) return 0;
    return ((last.value - first.value) / (last.t - first.t)) * 1000;
  }

  reset(): void {
    this.samples = [];
  }
}

/** Below this the eye cannot tell the value from the target. */
const REST_DISTANCE = 0.1;
const REST_VELOCITY = 2;
/** Integration step. Small enough to be stable for any spring used here. */
const STEP = 1 / 480;

/**
 * One animated number, driven by a spring.
 *
 * `to` can be called at any moment, including mid-flight: the motion continues
 * from the current value and velocity towards the new target, which is the
 * whole point. `value` and `velocity` are always the live, on-screen ones, so
 * a gesture that grabs the thing mid-animation starts exactly where it is.
 */
export class Spring {
  value: number;
  velocity = 0;
  private target: number;
  private config: SpringConfig = SPRINGS.default;
  private frame: number | null = null;
  private last = 0;
  private onRest: (() => void) | null = null;

  constructor(
    initial: number,
    private readonly onUpdate: (value: number) => void,
    private readonly frames: {
      request: (callback: (time: number) => void) => number;
      cancel: (handle: number) => void;
    } = {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (handle) => cancelAnimationFrame(handle),
    },
  ) {
    this.value = initial;
    this.target = initial;
  }

  get running(): boolean {
    return this.frame !== null;
  }

  /** Animate towards `target`, keeping the current velocity unless one is given. */
  to(target: number, config: SpringConfig = SPRINGS.default, options: { velocity?: number; onRest?: () => void } = {}): void {
    this.target = target;
    this.config = config;
    if (options.velocity !== undefined) this.velocity = options.velocity;
    this.onRest = options.onRest ?? null;

    if (prefersReducedMotion()) {
      // No travel at all: the destination, at once. Callers fade instead.
      this.jump(target);
      this.onRest?.();
      return;
    }

    if (this.frame === null) {
      this.last = 0;
      this.frame = this.frames.request(this.tick);
    }
  }

  /** Set the value immediately — for following a finger 1:1 — and stop animating. */
  jump(value: number): void {
    this.stop();
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.onUpdate(value);
  }

  /** Freeze where it is, keeping the live value and velocity for whoever grabs it next. */
  stop(): void {
    if (this.frame !== null) this.frames.cancel(this.frame);
    this.frame = null;
  }

  /** Advance by `seconds` of simulated time. Exposed for tests. */
  step(seconds: number): boolean {
    const { dampingRatio, response } = this.config;
    const stiffness = ((2 * Math.PI) / response) ** 2;
    const damping = (4 * Math.PI * dampingRatio) / response;
    let remaining = Math.min(seconds, 0.064);
    while (remaining > 0) {
      const dt = Math.min(STEP, remaining);
      const acceleration = -stiffness * (this.value - this.target) - damping * this.velocity;
      this.velocity += acceleration * dt;
      this.value += this.velocity * dt;
      remaining -= dt;
    }
    const resting =
      Math.abs(this.value - this.target) < REST_DISTANCE && Math.abs(this.velocity) < REST_VELOCITY;
    if (resting) {
      this.value = this.target;
      this.velocity = 0;
    }
    return resting;
  }

  private tick = (time: number): void => {
    const seconds = this.last === 0 ? 1 / 60 : (time - this.last) / 1000;
    this.last = time;
    const resting = this.step(seconds);
    this.onUpdate(this.value);
    if (resting) {
      this.frame = null;
      const done = this.onRest;
      this.onRest = null;
      done?.();
      return;
    }
    this.frame = this.frames.request(this.tick);
  };
}

export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A light tap of the vibration motor, on touch devices only.
 *
 * Reserved for moments that commit something — completing a task, dropping a
 * dragged one — and fired in the same frame as the visual change, so the two
 * read as one event. Feedback on every touch would teach people to ignore it.
 */
export function haptic(kind: 'light' | 'medium' = 'light'): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (typeof matchMedia === 'function' && !matchMedia('(pointer: coarse)').matches) return;
  try {
    navigator.vibrate(kind === 'light' ? 8 : 14);
  } catch {
    /* Some hosts throw rather than ignore; feedback is never worth an error. */
  }
}

/**
 * Keep something mounted while it animates out.
 *
 * `state` drives a CSS transition between an open and a closed style. CSS
 * transitions — unlike keyframe animations — reverse from wherever they are,
 * so reopening something halfway through closing turns it around smoothly
 * instead of finishing the exit first. That is the interruptibility rule,
 * applied to things that are opened and closed rather than dragged.
 */
export function usePresence(
  open: boolean,
  exitMs: number,
): { mounted: boolean; state: 'open' | 'closed' } {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two frames: one to mount in the closed style, one to transition out of it.
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);

  return { mounted, state: shown ? 'open' : 'closed' };
}
