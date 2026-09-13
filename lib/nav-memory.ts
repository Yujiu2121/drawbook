/**
 * Where the board was when you left it.
 *
 * This is the scroll half of the view transition, and nothing else. No rects, no FLIP, no flyer.
 *
 * The reason it exists is a measured cutoff in the browser: a shared element that is not captured
 * in the viewport gets no morph at all, cache warm or cold. A board row at top 1305 in an 800px
 * viewport produced only `::view-transition-old(root)`; the same row at top 556 produced the full
 * group. Ten pixels of visibility is enough, so it is a capture rule rather than a timing race.
 * On the return trip Next would otherwise scroll the board to 0, which puts four of the five rows
 * off screen at both 1280x800 and 390x844, and the hero then fades into nothing with no error and
 * no warning to find it by. So the app owns the scroll on both directions: the row link records
 * where the board stood, the back link puts it back, and the destination row is captured.
 *
 * Module-level state is the whole mechanism. A client navigation keeps the same JS bundle alive,
 * so a value written on the board is still here when the detail route asks for it. It does not
 * survive a reload, a deep link or a hard navigation, and it should not: there is no board scroll
 * to return to on a document that has only just loaded.
 *
 * Two rules for callers.
 *
 * 1. Client only. Every consumer is a client island, and the `typeof window` guards below make the
 *    module inert if it is ever pulled into a Server Component by accident. Mutable module state in
 *    a server process is shared by every request at once, so a silent no-op there is the only safe
 *    behaviour; a leaked scroll position would be one visitor's page state handed to another.
 *
 * 2. `recall` is single-shot. It hands the memory over and forgets it, so one navigation can never
 *    place the scroll twice and an old position can never be applied to a trip that did not come
 *    from the board. That makes exactly one consumer per navigation the contract: the back link,
 *    at navigate time. A second caller in the same trip reads null, which is a silent miss rather
 *    than a crash, so keep the consumption in one place.
 */

export interface NavMemory {
  /** The raffle whose row was clicked, so the consumer can confirm the row it is aiming at. */
  rid: number;
  /** Document scroll offset in CSS pixels, clamped at 0. */
  scrollY: number;
}

let memory: NavMemory | null = null;

/**
 * Record the board's position on the way out. Called from the row link's `onNavigate`, before the
 * router commits, which is the last moment the board's own scroll offset is still the document's.
 *
 * A later call replaces an earlier one, so what is held is always the most recent departure.
 */
export function remember(rid: number, scrollY: number): void {
  if (typeof window === "undefined") return;
  memory = {
    rid,
    // A non-finite offset would scroll to the top without complaining, which reads as a bug in the
    // transition rather than in the number that caused it. Store the honest floor instead.
    scrollY: Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0,
  };
}

/**
 * Take the remembered position, once. Returns null when there is nothing to restore, which is the
 * ordinary case for a deep link, a reload, or any arrival at the board that did not come from it.
 */
export function recall(): NavMemory | null {
  if (typeof window === "undefined") return null;
  const held = memory;
  memory = null;
  return held;
}
