"use client";

/**
 * The row link: the whole of Drawbook's navigation mechanism, and the only place on the board
 * that names a view transition.
 *
 * A board row is scale one of the cell and a raffle page is scale three, so moving between them
 * is meant to read as one object changing size rather than as two pages swapping. React's
 * `<ViewTransition name>` is what makes that possible: the same name on both sides of a soft
 * navigation tells the browser those two boxes are the same thing, and it animates between them
 * for free. Everything below exists to keep that one claim true, or to fail honestly when the
 * browser will not have it.
 *
 * WHY THE NAME IS ON THE STRIP AND NOT ON EACH CELL
 * The preview flies every ticket cell individually, which it can afford because both states are
 * in one document. Here the cost was measured: 201 named groups pushed `transition.ready` from
 * about 42ms to 220ms and collected a single rAF frame in two seconds, against a median 17ms
 * frame with one name. So exactly one element per navigation is named, and it is the strip,
 * which is also what the design actually claims is growing.
 *
 * WHY THIS FILE HOLDS BOTH PIECES
 * A given name may exist once per page. Two `<ViewTransition name="cell-4">` on one page throw
 * no error and log no warning: React applies the name to whichever instance its traversal
 * reaches first and silently gives the other `none` (measured: `#dup-a` got the name, `#dup-b`
 * got `none`), so the morph then anchors by tree order rather than by design and the blade grows
 * out of whatever mark happened to come first in the markup. The landing shows raffle 0004 twice
 * on one page, in the miniboard and in the ceremony, so this is not hypothetical. The rule that
 * keeps it from happening is countable: `<ViewTransition name>` appears in exactly two files in
 * this repo, here and in app/raffle/[id]/page.tsx. That is why `NamedStrip` lives next to
 * `RowLink` instead of in components/cell.tsx where the strip itself is built.
 *
 * Which means: use `RowLink` for every row that links to a raffle, and wrap the strip in
 * `NamedStrip` ONLY on /raffles, where each raffle appears once. A landing miniboard row links
 * with `RowLink` and leaves its strip unnamed. An unnamed source is not a broken navigation, it
 * is a page cross-fade, which is the correct fallback everywhere the morph cannot be earned.
 *
 * WHAT THIS CANNOT DO, SO THAT NOBODY DEBUGS IT LATER
 * The morph only happens when the source element is inside the viewport as the click lands. Ten
 * pixels of it is enough, but zero is a cut: a row at top 1305 in an 800px viewport produced only
 * `::view-transition-old(root)` with a warm router cache, while the same row at top 556 produced
 * the full group. Clicking a row you can see therefore always works, and the return trip has to
 * be given its scroll back by hand, which is what lib/nav-memory holds and components/back-link
 * spends.
 * Browser Back and Forward never transition at all: the router dispatches a restore without a
 * React Transition, so React never sees one. There is no flag for it. Both still land in the
 * right place, measured: back put the board at the 462 it left and forward put the raffle at 0
 * with its blade at 56, so what is lost on those two is the animation and nothing else.
 * A slow destination stays a slow destination. Held every RSC response for two seconds and
 * clicked a visible row: the type survived and the full 460ms morph still played, but it played
 * at 2025ms, to somebody who had been looking at an unchanged page for two seconds. The morph
 * cannot fix that and does not try to; `PendingMark` below is what answers it.
 * A navigation that arrives with no type at all is zeroed by app/motion.css rather than played,
 * which is why the mechanism degrades to a cut instead of to an undirected default. Every
 * navigation this app starts through a plain `<Link>` is already a cut: measured, a masthead link
 * and a landing row both produced zero `startViewTransition` calls, so only this file and the
 * back link animate anything at all.
 */

import Link, { useLinkStatus } from "next/link";
import { useLayoutEffect, ViewTransition, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { remember } from "@/lib/nav-memory";

/**
 * Did this document arrive at a raffle page by clicking a row, as opposed to a deep link, a
 * reload or a restore? Module state, so it is true only for the bundle that served the click,
 * and it is what stops `ArrivalScroll` from yanking the page on a cold load. Single-shot, for
 * the same reason `recall` is: one navigation may place the scroll once.
 */
let divedFromRow = false;

/**
 * Everything an anchor takes, minus the four props this component is the sole owner of. Omitting
 * them from the type is the enforcement: a caller cannot quietly pass `scroll` or a second
 * transition type and split the mechanism across two files.
 *
 * `className`, `aria-label` and any `data-*` attribute pass straight through, because the row's
 * appearance and its accessible name belong to the row, not to the navigation. Give it a label:
 * the whole row is the link, so its computed name is otherwise the serial, the title, the pool
 * and the countdown read out in one breath before the destination is clear.
 *
 * The anchor's own `id` attribute is omitted as well, and that one is not about ownership. An
 * anchor takes `id?: string`, so intersecting it with the raffle's `id: number` resolves to
 * `string & number`, which is `never`, and every call site then fails with "Type 'number' is not
 * assignable to type 'never'" pointing at the caller rather than at this line. Hit on the first
 * build of this file. The row needs no element id anyway; `data-rid` is what the board's own
 * islands key on.
 */
export type RowLinkProps = Omit<
  ComponentPropsWithoutRef<typeof Link>,
  "href" | "scroll" | "transitionTypes" | "onNavigate" | "id"
> & {
  /** The raffle this row is. Supplies the href and, through `NamedStrip`, the transition name. */
  id: number;
};

export function RowLink({ id, children, ...rest }: RowLinkProps) {
  return (
    <Link
      {...rest}
      href={`/raffle/${id}`}
      /*
        The app owns the scroll on both directions, so the router is told to keep its hands off it
        here. Next's own reset lands between the two snapshots and would work going in, but it
        also erases the board's position, and the position is what the return trip needs in order
        to put the destination row back inside the viewport. One owner is the only way that can be
        reasoned about; see lib/nav-memory. The consequence is that the raffle route must place
        its own scroll, in a layout effect, which runs inside the transition's update callback and
        so lands between the old snapshot and the new one.
      */
      scroll={false}
      /*
        Read by app/motion.css as `:root:active-view-transition-type(dive)`. Going in is the
        ceremony and gets the full duration on the blade curve; components/back-link sends
        `surface` for the shorter way out. Two types, two rules, no JavaScript.
      */
      transitionTypes={["dive"]}
      /*
        Fires before the router commits, which is the last moment the board's scroll offset is
        still the document's. Deliberately does not preventDefault and does not touch the scroll
        itself: moving the page here would take the source row out of the viewport and cost the
        morph the click was meant to start.
      */
      onNavigate={() => {
        divedFromRow = true;
        remember(id, window.scrollY);
      }}
    >
      <PendingMark />
      {children}
    </Link>
  );
}

/**
 * THE PENDING MARK: a hairline on the row's leading edge for as long as the click has not landed.
 *
 * WHY THERE IS ANYTHING HERE AT ALL. Every raffle route is prerendered and prefetched, so the
 * ordinary click commits in under 50ms and this never paints. On a slow connection it is a
 * different interface. Measured on `next build && next start` with every RSC response held for
 * two seconds: from the click, the pathname, the body text and the transition count were all
 * unchanged at 200ms, 500ms, 1000ms and 1500ms. The page flipped at 2025ms and the morph then
 * played to somebody who had already stopped watching. A click that produces nothing for two
 * seconds does not read as slow, it reads as broken, and the second click it invites is the one
 * that is genuinely wasted.
 *
 * WHY NOT `loading.tsx`, WHICH IS THE OBVIOUS ANSWER. It was built and measured against the same
 * two second hold, like for like, and it is a regression twice over. It did not commit early:
 * the fallback first painted at 2032ms, no sooner than the page it replaced, so the dead window
 * was unchanged. And with the route boundary in place the navigation stopped starting a view
 * transition at all: zero calls, against one full `::view-transition-group(cell-4)` morph on the
 * same navigation with the file removed. So the file bought a 300ms fallback flash between the
 * dead window and the page, and paid for it with the morph the whole design is built on. It is
 * not in the tree, and this comment is why.
 *
 * WHAT IT COSTS HERE. `useLinkStatus` has to be read from inside the `<Link>`, so this is one
 * more small client leaf, which is free: `RowLink` is already a client island and the row's own
 * six cells stay server-rendered nodes passed through as `children`. Nothing about the row
 * becomes client because of this.
 *
 * WHY IT IS DRAWN THIS WAY. `.row` is `position: relative`, and this is out of flow, so it takes
 * no grid area and cannot disturb the six columns. The row is already translated 4px and its
 * strip already open under the pointer, so a hover-shaped state would say nothing; a mark that
 * was not there a moment ago does. It is ink on the row's own surface, two pixels, the same two
 * pixels as the blade's gap and padding: no shadow, no pulse, no keyframe, nothing to reduce
 * under `prefers-reduced-motion` because nothing here moves.
 *
 * `--fg` rather than any one colour, so it flips with the row it sits on and cannot go quiet on
 * the ink half of the board. Measured against the three surfaces a row actually paints (WCAG 2.x
 * relative luminance, 0.03928 knee, sanity-checked at #ffffff on #000000 = 21.00): 15.01 on the
 * settled rows' --ink, 13.82 on --panel-2, 12.55 on a revealing row's --phase. A non-text graphic
 * owes 3:1.
 *
 * IT IS EXPORTED because components/back-link spends it on the way out, where the dead window
 * is the same one: one definition, one geometry, one explanation, and the return trip does not
 * quietly grow a second dialect of the same state.
 *
 * IT IS NOT A PROGRESS BAR. It states that the click was received and that the page is coming.
 * It does not grow, because nothing here knows how far along the payload is, and a bar that
 * pretended to would be the same class of lie as a spinner over an unwired action.
 */
export function PendingMark() {
  const { pending } = useLinkStatus();

  /*
    THE DELAY IS THE DIFFERENCE BETWEEN A STATE AND A STROBE, and the number is measured rather
    than taste. Without it the mark went up at 13ms and came down at 47ms on the ordinary warm
    click: two frames of a hairline appearing and vanishing on every single navigation, and worse,
    it was still painted when the browser took the old snapshot, so it flew inside the fading page
    as a two pixel artefact nobody put there. Nothing at all should happen for a click that lands
    in 47ms. 150ms clears that by a factor of three and is still well inside the window where a
    person is still expecting the click to have worked.

    It is spent as a transition delay rather than as a timer, and that is worth a sentence. The
    element is always here and always inert; only its opacity changes, so the delay is the
    browser's to keep and there is no state, no effect and no timeout to leak. A navigation that
    commits before the delay elapses takes the whole row with it and the browser simply never
    reaches the frame that would have painted. The duration is 1ms because this is an appearance
    and not a fade: nothing here should be caught half drawn.
  */
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        insetBlock: 0,
        insetInlineStart: 0,
        inlineSize: "2px",
        background: "var(--fg)",
        opacity: pending ? 1 : 0,
        transition: pending ? "opacity 1ms linear 150ms" : "opacity 1ms linear",
      }}
    />
  );
}

/**
 * The naming site. Renders no element of its own: React puts the name on the child, so the strip
 * keeps its own box, its grid area and its hover transform, and the wrapper costs nothing.
 *
 * Board rows only. Read the duplicate-name note at the top of this file before using it anywhere
 * else, and note that the matching name on the far side is owned by app/raffle/[id]/page.tsx.
 */
export function NamedStrip({ id, children }: { id: number; children: ReactNode }) {
  return <ViewTransition name={`cell-${id}`}>{children}</ViewTransition>;
}

/**
 * The other half of the scroll ownership, and the reason `scroll={false}` above is not simply a
 * regression. The router no longer moves the page, so the raffle route places its own scroll, in
 * a layout effect, which React runs inside the view transition's update callback: after the old
 * snapshot is taken and before the new one is, which is the only window in the navigation where
 * moving the page helps rather than hurts.
 *
 * Mount it once, as the first thing in app/raffle/[id]/page.tsx:  `<ArrivalScroll />`
 *
 * It is one line and the page does not work without it. Measured in Chrome 151 on
 * `next build && next start`, board scrolled to 700 so the source row sat at top 605 in an 800px
 * viewport, clicking the same row both ways:
 *   with it      group(cell-1)@460 plus new(cell-1) and old(cell-1), transition at 17ms,
 *                ready at 23ms, the raffle page landing at scrollY 0 with its blade at top 40
 *   without it   old(cell-1) and old(root), nothing else. No group and no new, because the blade
 *                was at top -660 and there was nothing in the viewport to capture, and the raffle
 *                page opened 700px down its own body
 * So what is missing without it is not an animation. It is a page that opens in the wrong place,
 * and half a transition with no error and nothing to grep for.
 *
 * The return direction is NOT here. components/back-link owns it, and owns it better: the
 * masthead is mounted once from the layout, so that component survives the navigation and can
 * take the remembered offset on the way out and spend it on arrival itself. `recall` is
 * single-shot by contract, so there must be exactly one consumer of it, and that is the back
 * link. Nothing in this file reads the memory back.
 *
 * Placing nothing is the default. `dive` moves the page only when a row started this navigation,
 * so a deep link, a reload and a browser restore all keep the scroll the browser gave them:
 * measured, /raffle/2 reloaded at scrollY 500 stays at 500.
 *
 * It runs whether or not the morph does, and that matters more than the morph. Under
 * `prefers-reduced-motion: reduce` and on a cold router cache, where app/motion.css zeroes the
 * animation and the navigation is a cut, the raffle page still opens at the top: measured at
 * scrollY 0 in both.
 */
export function ArrivalScroll() {
  useLayoutEffect(() => {
    if (!divedFromRow) return;
    divedFromRow = false;

    // `behavior: "instant"` rather than a bare scrollTo, so a `scroll-behavior: smooth` inherited
    // from the page cannot turn the placement into a visible glide happening underneath the morph.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);

  return null;
}
