/**
 * The document clock.
 *
 * `lib/mock-raffles.ts` is pinned at `NOW` so commitments verify and reloads reproduce, but a
 * countdown is the monument of this interface and a frozen one is a dead one. So the clock does
 * the only honest thing available: it starts at the pinned instant and adds the time this tab has
 * been open.
 *
 * Time passing is not a chain event, and nothing here pretends one happened. Two tabs opened an
 * hour apart will disagree, and that is true of any clock.
 *
 * This module is presentation only, by construction. Every raffle's `phase` is a literal in the
 * SPECS table, never computed from the clock, so a passing second can never move a raffle between
 * phases or change a pool, a commitment or a winner. The one thing a caller may do with a crossed
 * deadline is stop offering an action the program would now reject.
 *
 * The shape is the one `lib/wallet-store.ts` already proves: a module store read through
 * `useSyncExternalStore`, because the value is owned by the browser rather than by React.
 *
 * Hydration is the whole reason for the shape. `getServerSnapshot()` returns 0 and `getSnapshot()`
 * also returns 0 until `subscribe` first runs, and `t0` is captured inside `subscribe`, never at
 * module scope. React calls `subscribe` after the hydration commit, so the server HTML and the
 * hydration render produce byte identical countdown strings no matter how slow the load was. A
 * `t0` captured at module scope would start counting at script evaluation and drift by however
 * long hydration took, which is a mismatch on every countdown on the page.
 *
 * No directive, so both sides may import it. Only `subscribe` touches the browser.
 */

import { NOW } from "./mock-raffles.ts";

/** The pinned instant, in milliseconds. Every figure in the app derives from this same `NOW`. */
export const PINNED_MS = NOW.getTime();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "30 Jul 2026 09:00 UTC". Derived, so the sentence below cannot outlive the pin. */
export const PINNED_STAMP =
  `${NOW.getUTCDate()} ${MONTHS[NOW.getUTCMonth()]} ${NOW.getUTCFullYear()} ` +
  `${pad2(NOW.getUTCHours())}:${pad2(NOW.getUTCMinutes())} UTC`;

/** The note that has to sit near any countdown. Stating the pin is cheaper than being caught at it. */
export const CLOCK_NOTE =
  `The countdowns advance from a pinned instant, ${PINNED_STAMP}, plus the time this tab has been ` +
  `open. Time passing is not a chain event, so nothing here pretends one happened. Two tabs opened ` +
  `an hour apart will disagree, and that is true of any clock.`;

/* ------------------------------------------------------------------ store */

/** Whole seconds since the first subscribe. Zero on the server and through hydration. */
let current = 0;
/** Captured on the first subscribe, which is the first moment a browser is certainly present. */
let t0 = 0;
let started = false;
let frame: number | null = null;

const listeners = new Set<() => void>();

/**
 * The published second. Stable between ticks, which `useSyncExternalStore` requires: a snapshot
 * that recomputed `Date.now()` on every read would re-render forever.
 */
export function getSnapshot(): number {
  return current;
}

/** Always zero. The server renders the pinned instant exactly, and so does the hydration pass. */
export function getServerSnapshot(): number {
  return 0;
}

/**
 * One animation frame loop for the whole document, gated on visibility, publishing an integer
 * second. It runs only while something is subscribed, and a drawn or void raffle subscribes to
 * nothing because it renders an absolute stamp, so a settled route costs no frames at all.
 */
function tick(): void {
  frame = requestAnimationFrame(tick);
  // A hidden tab has nothing to update. Frames are throttled or stopped there anyway, and the
  // elapsed figure is read off the wall clock rather than accumulated, so nothing is lost.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  publish();
}

function publish(): void {
  const next = Math.floor((Date.now() - t0) / 1000);
  // Never publish a second already published, and never publish one earlier. A system clock that
  // steps backwards must not make a deadline appear to recede.
  if (next <= current) return;
  current = next;
  for (const notify of listeners) notify();
}

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  if (!started) {
    started = true;
    // First subscribe only. A resubscribe keeps the original origin, so the seconds that passed
    // while nothing was counting are still counted.
    if (t0 === 0) t0 = Date.now();
    // Guard rather than assume: a test runner or any host without frames leaves the clock at the
    // pinned instant, which is still a correct reading, just a still one.
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(tick);
    }
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      frame = null;
      started = false;
    }
  };
}

/* ----------------------------------------------------------------- derive */

/**
 * The pinned instant plus tab time, in milliseconds.
 *
 * Pass the snapshot a component rendered with. Defaulting to the live module value is right for a
 * non-React caller and wrong inside render, where the value React handed you is the only one that
 * agrees with the rest of the commit.
 */
export function nowMs(elapsed: number = current): number {
  return PINNED_MS + elapsed * 1000;
}

/**
 * Whole seconds left on a deadline, clamped at zero.
 *
 * Zero is the closed sentinel: the format ladder in `lib/cell.ts` prints "closed" at or below it.
 * Clamping here rather than there means no caller can hand a negative figure to a ladder, and a
 * crossed deadline reads the same on every surface.
 */
export function secondsUntil(deadlineISO: string, elapsed: number = current): number {
  return Math.max(0, Math.round((Date.parse(deadlineISO) - nowMs(elapsed)) / 1000));
}

/** True once a deadline has been crossed, so a control can stop offering what would now be rejected. */
export function hasClosed(deadlineISO: string, elapsed: number = current): boolean {
  return secondsUntil(deadlineISO, elapsed) <= 0;
}
