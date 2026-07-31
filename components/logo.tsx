import Link from "next/link";

/**
 * The Drawbook mark: a stack of raffle stubs with one drawn out of it.
 *
 * The name is the brief. A drawbook is the bound book of numbered stubs a raffle draws from, so the
 * mark is three stubs and the one that got pulled, rather than anything from the usual vocabulary of
 * either crypto (hexagons, orbits, interlocking blocks) or ticketing (the perforated stub with a
 * notch on each side, which every event app already owns).
 *
 * Everything is a rectangle on a 32-unit grid. That is not minimalism for its own sake, it is the
 * same geometry the rest of the product is built from: zero radius on surfaces, hairline rules, and
 * figures set on a tabular grid. A mark with curves in it would be the only curve in the system.
 *
 * WHY THE DRAWN STUB RUNS PAST THE RIGHT EDGE. Three equal bars stacked inside a square is a
 * hamburger menu, and at 16px in a tab strip that is all anyone would see. Colour does not rescue it;
 * a 2px champagne row among 2px grey rows is just a lighter smudge. Breaking the frame changes the
 * silhouette instead, which survives being 16 pixels tall. Earlier passes tried a shorter offset, a
 * thicker drawn bar and a solid book with etched seams, and all of them collapsed to mush at true
 * size. This was checked by rendering and looking, not by reasoning about it.
 *
 * COLOUR IS DELIBERATELY DIFFERENT INSIDE THE APP. Champagne is the product's only accent and it
 * means something specific: a live countdown, a ticket that is yours, a winner. A permanently
 * champagne mark in the masthead would spend that meaning on chrome, which is exactly the dilution
 * the palette was designed to avoid. So in-product the drawn stub is --text and the mark reads as
 * quiet monochrome; it turns champagne only on hover, which is the accent behaving correctly, since
 * the drawn stub IS the winner. The favicon and the touch icon keep champagne permanently: browser
 * chrome is outside the app's semantic field, and there is nothing there for it to compete with.
 */

/** Content spans x 6..32 and y 3..29, so the viewBox is cropped to it: a square 26 units on a side. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="6 3 26 26"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <rect x="6" y="3" width="13" height="6" className="fill-text-3" />
      <rect x="6" y="23" width="13" height="6" className="fill-text-3" />
      {/*
        The drawn stub. Fill transitions rather than transforms: the rect already ends flush with the
        viewBox edge, so translating it on hover would clip it against its own frame. The global
        prefers-reduced-motion rule in globals.css collapses this transition to nothing.
      */}
      <rect
        x="12"
        y="13"
        width="20"
        height="6"
        className="fill-text transition-colors duration-200 group-hover:fill-accent"
      />
    </svg>
  );
}

/**
 * Mark plus name, as one link home.
 *
 * The mark is set at 16px against 15px type, chosen by rendering 14 through 18 in the live masthead
 * and comparing. Below 16 the mark reads as incidental punctuation before the word; above it, it
 * starts to outweigh the word it is supposed to introduce. Slightly exceeding the cap height of the
 * type is the normal relationship for a lockup, since the mark has no ascenders to carry it.
 *
 * The gap is 10px rather than the 8 that would look right for most marks, because this viewBox is
 * cropped flush to the artwork on all four sides. There is no built-in margin to borrow from.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2.5 text-base font-medium tracking-tight ${className}`}
    >
      <LogoMark className="h-4 w-4" />
      Drawbook
    </Link>
  );
}
