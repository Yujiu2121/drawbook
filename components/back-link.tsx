"use client";

import { useLayoutEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";

import { PendingMark } from "@/components/row-link";
import { recall } from "@/lib/nav-memory";

/**
 * The way out of a raffle, and the half of the morph that does not come for free.
 *
 * This is the designated replacement for the browser's Back button. A browser back never fires
 * `onNavigate` and never starts a view transition, so it is an honest instant cut; this link is a
 * real push, so it gets `surface` and the cell shrinks back into its row.
 *
 * WHY THE SCROLL RESTORE IS THE WHOLE COMPONENT
 * A shared element that is not captured inside the viewport gets no morph at all. Measured, warm
 * cache, same link: a board row at `top: 1305` in an 800px viewport produced only
 * `::view-transition-old(root)`, while the same row at `top: 556` produced the full
 * `group(cell-1)` + `-new` + `-old`. Ten pixels of visibility is enough, so it is a capture rule
 * rather than a timing race. Re-measured against this board on `next build && next start`: with
 * the board at 0, rows 0004, 0005 and 0003 sit at top 489, 565 and 748 and are captured, while
 * 0002 and 0001 sit at 824 and 900 and are not; at 390x844 the last two sit at 964 and 1120. Two
 * of five raffles would come back as a cut with no error and nothing to grep for. So the app owns
 * the scroll on both directions. The row link records where the board stood; this link puts it
 * back, and the destination row is in the viewport when the browser takes the new snapshot.
 *
 * AND WHEN THERE IS NOTHING TO PUT BACK, IT AIMS INSTEAD. A deep link, a reload, or an arrival
 * from the landing has no board offset to restore, and the top of the board is not always enough:
 * measured, /raffle/1 deep-linked and then left by this link produced a `surface` transition with
 * no group at all, because row 0001 was at top 900. `boardTopFor` below is what closed that, and
 * the same trip now produces the full `::view-transition-group(cell-1)`.
 *
 * WHERE THE RESTORE HAS TO SIT, AND WHY IT IS NOT IN `onNavigate`
 * `onNavigate` runs while the detail page is still the document (next/dist/client/app-dir/link.js
 * calls it before `startTransition(dispatchNavigateAction)`), so a scroll written there would be
 * clamped to the detail page's own height and then thrown away. The memory is TAKEN there, because
 * `recall` is single-shot and the contract is one consumer per navigation, and it is APPLIED in the
 * layout effect below, which React runs inside the view transition's update callback: the DOM is
 * the board, the browser has not captured the new state yet, and a scroll placed here is the scroll
 * the snapshot is taken at.
 *
 * The one trap in that placement, found by probe: Next's own scroll handling has NOT applied when a
 * layout effect runs. This component sits in the masthead, which is an earlier sibling of <main>,
 * so its layout effect flushes BEFORE the router's ScrollAndFocusHandler and would lose a fight
 * with it. `scroll={false}` is what makes there be no fight: it dispatches
 * `ScrollBehavior.NoScroll`, which neutralises the navigation's scroll targets
 * (next/dist/client/components/segment-cache/navigation.js, the NoScroll branch) so the handler
 * returns before touching `scrollTop`. Removing `scroll={false}` does not merely lose the restore,
 * it silently reinstates the bug the restore exists to fix.
 *
 * `behavior: "instant"` rather than a bare `scrollTo(0, y)` so the placement cannot be turned into
 * a visible 400ms glide by a `scroll-behavior: smooth` inherited from the page.
 *
 * This component stays MOUNTED across the navigation, because the masthead is mounted once from the
 * layout. That is what lets one instance take the memory on the way out and spend it on arrival;
 * it renders nothing at all off a detail route, but the fiber and the ref below survive.
 */

const BOARD = "/raffles";

/** `/raffle/5`, with or without the trailing slash. Captures the id so the memory can be checked. */
const DETAIL = /^\/raffle\/(\d+)\/?$/;

/**
 * WHERE THE BOARD OPENS WHEN THERE IS NOTHING TO REMEMBER.
 *
 * The top of the board, unless the top of the board does not show the row this trip is leaving, in
 * which case the least scroll that does.
 *
 * This is the second half of the capture rule and it is worth stating plainly. A shared element
 * that is not inside the viewport when the browser takes its snapshot gets no morph at all, so the
 * destination row has to be on screen for the cell to shrink back into it. Measured at 1280x800 on
 * `next build && next start`: a deep link to /raffle/3 followed by this link put row 0003 at top
 * 748 and produced the full `::view-transition-group(cell-3)`, while the identical trip from
 * /raffle/1, whose row sits at top 900, produced a `surface` transition with no group at all. The
 * board is five rows and three of them are above the fold at 1280x800; the two that are not are the
 * only raffles that could ever land as a cut, and this is what stops them.
 *
 * It moves the page as little as it can. The row's bottom edge is brought to the bottom of the
 * viewport and no further, so the board still opens as near its own top as the row allows rather
 * than centred on a row the reader has not asked to be centred on. A row that is already inside the
 * first screenful moves nothing, and a board whose row is missing falls back to the top, which is
 * the honest answer when there is nothing to aim at.
 *
 * It reads the geometry at arrival rather than at click, because at click the board does not exist
 * yet: this runs in a layout effect, inside the transition's update callback, when the DOM is
 * already the board and the snapshot has not been taken.
 */
function boardTopFor(rid: number): number {
  // `.row` rather than the href alone: the board is the only place a raffle is a row, so if the
  // page ever grows a second link to the same raffle in a feed or a note, this still aims at the
  // cell that carries the transition name rather than at whichever anchor comes first.
  const row = document.querySelector<HTMLElement>(`a.row[href="/raffle/${rid}"]`);
  if (row === null) return 0;

  // Top of the row in document coordinates, which is what the current offset has to be taken out of.
  const top = row.getBoundingClientRect().top + window.scrollY;
  const overshoot = top + row.offsetHeight - window.innerHeight;

  return overshoot > 0 ? Math.round(overshoot) : 0;
}

export function BackLink({ className = "" }: { className?: string }) {
  const pathname = usePathname();

  /**
   * The trip this link is responsible for placing, taken at click and spent on arrival.
   *
   * Null means "no navigation of ours is in flight", which is what keeps the effect below off every
   * other way of reaching the board: the masthead's own Raffles link, a footer link, a browser back.
   * Those carry Next's default scroll behaviour and this component must not touch them.
   *
   * `y` is the board's remembered offset, and null there is a different thing from null here: it
   * means this trip has no memory to spend, which is the ordinary case for a deep link, a reload,
   * or an arrival at the raffle from somewhere that is not the board. `scroll={false}` means Next
   * places no scroll at all, so a trip with no memory still has to place one, or the board inherits
   * whatever offset the detail page happened to be left at, which is a position nobody chose.
   */
  const pending = useRef<{ y: number | null; rid: number } | null>(null);

  useLayoutEffect(() => {
    if (pathname !== BOARD) return;

    const trip = pending.current;
    if (trip === null) return;
    pending.current = null;

    window.scrollTo({ top: trip.y ?? boardTopFor(trip.rid), left: 0, behavior: "instant" });
  }, [pathname]);

  const detail = DETAIL.exec(pathname);
  if (detail === null) return null;

  const rid = Number(detail[1]);

  return (
    <Link
      href={BOARD}
      scroll={false}
      transitionTypes={["surface"]}
      onNavigate={() => {
        // Single-shot by contract, so it is taken on every departure even when it will not be
        // spent: that is what stops one trip's position being applied to a later one. It is spent
        // only when it names the raffle we are actually leaving, and a trip with nothing to spend
        // carries a null offset rather than no trip at all, because `boardTopFor` still has a page
        // to place and a row to aim it at.
        const held = recall();
        pending.current = { y: held !== null && held.rid === rid ? held.scrollY : null, rid };
      }}
      aria-label="Back to all raffles"
      /*
        `relative` is for the pending mark below, which is out of flow and pinned to this chip's
        leading edge. Everything else here is the chip: a hairline box, the label face, and the
        surface it takes under the pointer. The minimum height is the wallet chip's, one label line
        plus padding and border, so the arrow-only form below 640 stays as tall as its neighbours.
      */
      className={`label relative inline-flex min-h-[calc(1.4em+0.75rem+2px)] items-center gap-1.5 border border-bound px-2 py-1.5 text-fg transition-colors duration-[var(--t-open)] ease-settle hover:bg-panel-2 ${className}`}
    >
      {/*
        The way back is prerendered and prefetched like the way in, so this paints on a slow
        connection and on nothing else. It is the same mark the board rows carry, from the same
        definition: see the note on `PendingMark` in components/row-link.tsx for the measurement
        that put it there and for why `loading.tsx` is not the answer it looks like.
      */}
      <PendingMark />
      <ArrowLeft size={11} weight="bold" aria-hidden="true" />
      {/* The word leaves below 640 and the arrow stays, with the full name on aria-label. At 360 a
          connected phone has no 40px to spare in the bar, and an arrow pointing left beside the
          mark is the one icon in the chrome that needs no word. */}
      <span className="hidden sm:inline">Back</span>
    </Link>
  );
}
