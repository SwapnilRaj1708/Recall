import {
  SPRINGS,
  Spring,
  VelocityTracker,
  haptic,
  prefersReducedMotion,
  project,
  rubberband,
} from '@recall/ui';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

/**
 * Motion for the task list: rows sliding into place when the list changes,
 * and reordering by dragging a row.
 *
 * Both work on the same principle — the row is always somewhere real on
 * screen, and any new motion starts from there. A row that moves because a
 * task was added above it slides from where it was; a row picked up by its
 * handle follows the finger exactly; a row let go continues at the speed it
 * was thrown and settles into the slot it was heading for.
 */

const rowsOf = (list: HTMLElement | null): HTMLElement[] =>
  list ? [...list.querySelectorAll<HTMLElement>(':scope > li[data-task-id]')] : [];

const topWithin = (row: HTMLElement, list: HTMLElement): number =>
  row.getBoundingClientRect().top - list.getBoundingClientRect().top;

/**
 * Rows slide to their new places instead of jumping.
 *
 * The classic FLIP: after each change, every row that moved is put back where
 * it was with a transform and released to its new place with a spring. New
 * rows fade in where they land. Positions are measured on screen, transforms
 * included, so a row that is mid-slide when the list changes again starts
 * from where it visibly is.
 *
 * Returns `record`, for code that moves rows itself and needs the next
 * comparison to start from where it left them.
 */
export function useListFlip(
  listRef: RefObject<HTMLElement | null>,
  order: string,
  /** Rows another animation is already driving, left alone here. */
  skip?: RefObject<Set<string>>,
): () => void {
  const positions = useRef(new Map<string, number>());
  const first = useRef(true);

  const record = useCallback(() => {
    const list = listRef.current;
    positions.current = new Map();
    if (!list) return;
    for (const row of rowsOf(list)) positions.current.set(row.dataset.taskId!, topWithin(row, list));
  }, [listRef]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || first.current || prefersReducedMotion()) {
      first.current = false;
      record();
      return;
    }

    for (const row of rowsOf(list)) {
      if (skip?.current?.has(row.dataset.taskId!)) continue;
      const before = positions.current.get(row.dataset.taskId!);
      if (before === undefined) {
        // Arriving: fade in where it lands, settling down into place.
        row.animate(
          [
            { opacity: 0, transform: 'translateY(-6px) scale(0.98)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
        continue;
      }
      const delta = before - topWithin(row, list);
      if (Math.abs(delta) < 0.5) continue;
      row.style.transition = 'none';
      row.style.transform = `translateY(${delta}px)`;
      row.getBoundingClientRect(); // commit the starting point before releasing it
      row.style.transition = 'transform var(--rc-spring-duration) var(--rc-spring)';
      row.style.transform = '';
      row.addEventListener(
        'transitionend',
        () => {
          row.style.transition = '';
        },
        { once: true },
      );
    }
    record();
  }, [listRef, order, record, skip]);

  return record;
}

const LIFTED = 'rc-lifted';
/** How close to the scroller's edge auto-scrolling begins, and how fast it goes at most. */
const EDGE = 48;
const MAX_SCROLL_SPEED = 14;

/**
 * Reordering by dragging a row by its handle.
 *
 * Pointer Events with capture, so it works the same for a mouse, a pen and a
 * finger — browser drag-and-drop never worked on a touch screen at all. The
 * row is moved directly every frame while held; the rows it passes step aside
 * on a spring; past either end of the list it resists rather than stopping.
 * On release the row's velocity is projected forward to choose the slot, so
 * a flick lands where it was thrown.
 *
 * The new order is saved at that instant, and the animation that follows is
 * only presentation: the list re-renders in its new order, the dropped row is
 * put back where it visibly was, and a spring carries it into its slot from
 * the finger's speed. Saving after the animation instead would make the move
 * depend on frames being drawn, and switch away mid-settle — or have the page
 * stop drawing — and it would be lost.
 */
export function useReorder({
  listRef,
  scrollerRef,
  order,
  onBeforeCommit,
  commit,
  animating,
}: {
  listRef: RefObject<HTMLElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  order: string;
  onBeforeCommit: () => void;
  commit: (id: string, index: number) => void;
  /** Rows this hook is animating itself, for the slide animation to leave alone. */
  animating: RefObject<Set<string>>;
}) {
  /** The dropped row, waiting for the new order to render before it can glide in. */
  const dropped = useRef<{
    row: HTMLElement;
    id: string;
    visualTop: number;
    velocity: number;
  } | null>(null);

  // The new order has rendered. Every other row is handled by the slide
  // animation; the dropped row is put back where it visibly was and released
  // into its new slot with the velocity it was thrown at.
  useLayoutEffect(() => {
    const list = listRef.current;
    const drop = dropped.current;
    if (!drop || !list) return;
    dropped.current = null;
    delete list.dataset.reordering;

    for (const row of rowsOf(list)) {
      row.style.transition = 'none';
      row.style.transform = '';
    }
    const offset = drop.visualTop - topWithin(drop.row, list);
    for (const row of rowsOf(list)) row.style.transition = '';
    drop.row.style.transition = 'none';

    const spring = new Spring(offset, (y) => {
      drop.row.style.transform = Math.abs(y) < 0.01 ? '' : `translateY(${y}px)`;
    });
    spring.jump(offset);
    spring.to(0, SPRINGS.move, {
      velocity: drop.velocity,
      onRest: () => {
        drop.row.style.transition = '';
        drop.row.style.transform = '';
        animating.current?.delete(drop.id);
      },
    });
  }, [animating, listRef, order]);

  return useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      const list = listRef.current;
      if (!list || event.button !== 0) return;
      event.preventDefault();

      const rows = rowsOf(list);
      const from = rows.findIndex((row) => row.dataset.taskId === id);
      const dragged = rows[from];
      if (!dragged) return;

      const tops = rows.map((row) => topWithin(row, list));
      const heights = rows.map((row) => row.offsetHeight);
      const last = rows.length - 1;
      // How far one row's worth of space is, gap included.
      const slot =
        from < last ? tops[from + 1]! - tops[from]! : from > 0 ? tops[from]! - tops[from - 1]! : heights[from]!;
      const min = tops[0]! - tops[from]!;
      const max = tops[last]! + heights[last]! - (tops[from]! + heights[from]!);
      const span = list.offsetHeight || 1;

      const scroller = scrollerRef.current;
      const startScroll = scroller?.scrollTop ?? 0;
      const startY = event.clientY;
      let pointerY = event.clientY;
      let target = from;

      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      list.dataset.reordering = 'true';
      dragged.classList.add(LIFTED);
      dragged.style.transition = 'none';
      haptic();

      const tracker = new VelocityTracker();
      const spring = new Spring(0, (y) => {
        dragged.style.transform = `translateY(${y}px)`;
      });

      // Past the first or last row it gives way less and less.
      const constrain = (y: number) =>
        y < min ? min + rubberband(y - min, span) : y > max ? max + rubberband(y - max, span) : y;

      // Which slot the row's centre is over, counting the other rows above it.
      const slotFor = (y: number) => {
        const centre = tops[from]! + heights[from]! / 2 + y;
        let index = 0;
        for (let k = 0; k < rows.length; k++) {
          if (k !== from && tops[k]! + heights[k]! / 2 < centre) index++;
        }
        return index;
      };

      const makeRoom = (index: number) => {
        for (let k = 0; k < rows.length; k++) {
          if (k === from) continue;
          const shift =
            from < index && k > from && k <= index ? -slot : from > index && k < from && k >= index ? slot : 0;
          rows[k]!.style.transform = shift ? `translateY(${shift}px)` : '';
        }
      };

      const offsetNow = () => pointerY - startY + ((scroller?.scrollTop ?? 0) - startScroll);

      const follow = () => {
        const offset = constrain(offsetNow());
        tracker.add(offset);
        spring.jump(offset);
        const next = slotFor(offset);
        if (next !== target) {
          target = next;
          makeRoom(target);
        }
      };

      // Near the top or bottom of the list's viewport, scroll it, faster the closer.
      let autoScroll = 0;
      const scrollTick = () => {
        if (scroller) {
          const box = scroller.getBoundingClientRect();
          const overTop = box.top + EDGE - pointerY;
          const overBottom = pointerY - (box.bottom - EDGE);
          const speed =
            overTop > 0
              ? -Math.min(MAX_SCROLL_SPEED, overTop / 3)
              : overBottom > 0
                ? Math.min(MAX_SCROLL_SPEED, overBottom / 3)
                : 0;
          if (speed !== 0) {
            scroller.scrollTop += speed;
            follow();
          }
        }
        autoScroll = requestAnimationFrame(scrollTick);
      };
      autoScroll = requestAnimationFrame(scrollTick);

      const onMove = (move: PointerEvent) => {
        pointerY = move.clientY;
        follow();
      };

      const finish = (cancelled: boolean) => {
        cancelAnimationFrame(autoScroll);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onCancel);

        const velocity = cancelled ? 0 : tracker.velocity();
        // Judged by where it was heading, with a shorter throw than a scroll view.
        const landing = cancelled ? from : slotFor(constrain(spring.value + project(velocity, 0.99)));
        target = landing;
        makeRoom(target);
        const resting =
          target > from
            ? tops[target]! + heights[target]! - (tops[from]! + heights[from]!)
            : target < from
              ? tops[target]! - tops[from]!
              : 0;

        dragged.classList.remove(LIFTED);
        haptic();

        if (target === from) {
          // Nowhere new: back into its own slot, from where it was let go.
          spring.to(0, SPRINGS.move, {
            velocity,
            onRest: () => {
              delete list.dataset.reordering;
              settle(list);
            },
          });
          return;
        }

        // Saved now. The slide animation is told where every row visibly is,
        // and the dropped row is held aside to be animated with its velocity.
        spring.stop();
        onBeforeCommit();
        animating.current?.add(id);
        dropped.current = {
          row: dragged,
          id,
          visualTop: topWithin(dragged, list),
          velocity,
        };
        commit(id, target);
      };

      const onUp = () => finish(false);
      const onCancel = () => finish(true);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onCancel);
    },
    [animating, commit, listRef, onBeforeCommit, scrollerRef],
  );
}

/** Remove every transform this code set, without animating the removal. */
function settle(list: HTMLElement | null): void {
  for (const row of rowsOf(list)) {
    row.style.transition = 'none';
    row.style.transform = '';
  }
  list?.getBoundingClientRect();
  for (const row of rowsOf(list)) row.style.transition = '';
}
