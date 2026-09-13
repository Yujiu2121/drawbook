import Link from "next/link";

/**
 * The Drawbook mark: one revealed ticket, at 13 pixels.
 *
 * SWEEP / CELL draws the same cell at four scales, a 6px sliver in a board row, a 22px sliver when
 * that row opens, an 88px square in the ticket bed, and the whole viewport during the draw. The mark
 * is that cell at its smallest, in the one state worth putting on every page: sold and revealed. A
 * revealed cell in the ticket bed is a solid ink square with the signal band across its bottom 36%
 * (`app/cell.css`, `.c[data-s="2"]`), and this is the same rectangle with nothing added. So the mark
 * is not a picture of the product, it is a piece of it, and it needs no explaining anywhere the bed
 * is on screen.
 *
 * That replaces the old drawn-stub mark, which was built for a system of hairline rules and a
 * 32-unit grid. Cell has no hairline vocabulary at this size: a 1px rule inside a 13px box is 8% of
 * the box and reads as noise. A filled chip survives 13px because it has no interior detail to lose.
 *
 * THE BAND IS `--iris-lift`, NOT `--iris`, AND THAT IS THE WHOLE POINT OF THIS FILE.
 * The approved preview paints the band `--iris` inside an `--ink` square, which computes 2.13:1, the
 * exact ratio the system bans as a hard rule. WCAG 1.4.11 exempts logotypes, so it is not a
 * conformance failure, but it would be the system breaking its own rule in the element that repeats
 * on every page, which is the worst possible place to keep an exception. `--iris-lift` on `--ink` is
 * 8.01:1, which is what the rule asks for, and the two hues are near enough at 13px that nothing is
 * lost but the contradiction.
 *
 * WHY THIS FILE NAMES RAW PALETTE TOKENS WHEN NOTHING ELSE MAY.
 * `app/globals.css` exposes roles as utilities and keeps the raw hex names out of the class layer on
 * purpose, so that no component can write `text-ink` inside an inverted block. The band has no role
 * to name, and `app/cell.css` reached the same dead end: it declares `--cell-mark: var(--iris-lift)`
 * on `.c` and calls it "the one raw palette name in this file", because `--event` is `--iris` on
 * light and `--iris-lift` under `.inv`, which is the wrong way round for anything painted on ink.
 * `--cell-mark` lives on `.c` and this is not a `.c`, so the value is written out here once, with
 * the same argument behind it.
 *
 * WHERE THE MARK PARTS COMPANY WITH A REAL CELL, AND WHY.
 * A sold cell is `--cell-sold` in both palettes, deliberately: ink blocking light does not stop
 * blocking light because the surface around it inverted, and an inverted ticket bed is `--bound`
 * rather than ink, so the ink cell still reads on it. A wordmark has no bed. Under `.inv` it sits
 * straight on the ink panel, where an ink chip is 1.00:1 and simply gone. So the chip is `--fg`,
 * which is the same ink on a light page and paper on a dark one, and the band follows it:
 *
 *   light page   chip `--fg` (ink)    band `--iris-lift`   8.01:1
 *   .inv block   chip `--fg` (paper)  band `--iris`        7.05:1
 *
 * Both computed with the WCAG formula against the surface each one actually sits on, which here is
 * the chip rather than the page. Holding `--iris-lift` inside an inverted footer would have been
 * 1.87:1, a band that vanishes, which is why the variant exists rather than a single fixed hue.
 *
 * THE MARK NEVER ANIMATES AND NEVER ANSWERS THE POINTER. The signal hue is ceremonial: a winner, a
 * paid stamp, a countdown inside its final hour. A cursor resting on a logo is not a ceremony, and a
 * colour that a mouse can summon stops being the colour that only a settled draw can. The previous
 * mark faded two bars one ink step under hover; Cell drops even that, because the masthead is a
 * fixed panel and a logo that twitches is the kind of motion this system spent its whole budget
 * avoiding. Focus is still visible: the `:focus-visible` rule in `app/globals.css` rings the link.
 *
 * The favicon and touch icon under `app/` are separate assets and keep their own colour. Browser
 * chrome sits outside this system's semantic field.
 */

/**
 * The chip alone, for places that carry the name some other way.
 *
 * Sized by the caller through `className`, never by content, so a webfont swap cannot move it. The
 * viewBox is 100 units square and the band is the bottom 36 of them, the same share `app/cell.css`
 * gives a revealed cell, chosen there as the largest that still reads as a mark on a 7px sliver. A
 * percentage rather than a unit count is what lets one drawing serve 13px and 64px.
 */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {/* The cell. `--fg` rather than `--cell-sold` so the chip inverts with its block: a sold cell
          stays ink under `.inv`, which inside an ink footer would be an invisible square. */}
      <rect x="0" y="0" width="100" height="100" className="fill-fg" />
      {/* The reveal band. See the contrast note above before changing either value. */}
      <rect
        x="0"
        y="64"
        width="100"
        height="36"
        className="fill-[var(--iris-lift)] [.inv_&]:fill-[var(--iris)]"
      />
    </svg>
  );
}

/**
 * Mark plus name, as one link home.
 *
 * The name is set in `serial`, the width-87 mono instance `app/globals.css` defines for the wordmark
 * and for a raffle's four-digit serial. That pairing is the argument: the product's name is written
 * in the same hand as the number on a ticket, because it is the same book.
 *
 * The preview sets the name at 12px with 0.1em of tracking. This sets it at `text-sm`, the 13px step
 * the type scale actually owns, and takes `serial`'s own 0.06em with it. Measured in Chromium
 * against the real subset face: the preview's setting is 73.61px wide, this one is 70.25px. The same
 * footprint, on the scale, without a tenth size invented for one word.
 *
 * The chip is 13px, matching the preview and slightly exceeding the cap height of the type beside it,
 * which is the normal relationship for a lockup, since the chip has no ascenders to carry it. The gap
 * is 8px; the viewBox is cropped flush to the artwork, so there is no built-in margin to borrow.
 *
 * THE `text-fg` IS NOT REDUNDANT. `color` inherits its computed value, so a wordmark that inherits
 * from `body` carries ink into an inverted footer and disappears, even though `.inv` has already
 * swapped `--fg` underneath it. Naming the role on the link itself re-resolves it per element: ink
 * on a light page, paper inside `.inv`, 15.01:1 on the panel either way. Verified in Chromium by
 * dropping the lockup into an `.inv` block, where without this the word renders rgb(22, 20, 44) on
 * rgb(22, 20, 44). A caller that wants a quieter wordmark should set the colour on a wrapper rather
 * than pass a second `text-*` here, since the two would have equal specificity.
 *
 * `nameClassName` exists for the masthead, which hides the name below 480px and keeps the chip. The
 * accessible name is on the link rather than the text, so the link is still announced when the word
 * is not painted. It leads with "Drawbook", so the visible label stays a prefix of the accessible
 * one.
 */
export function Wordmark({
  className = "",
  nameClassName = "",
}: {
  className?: string;
  nameClassName?: string;
}) {
  return (
    <Link
      href="/"
      aria-label="Drawbook, home"
      className={`text-fg inline-flex items-center gap-2 ${className}`}
    >
      <LogoMark className="h-[13px] w-[13px]" />
      <span className={`serial text-sm uppercase ${nameClassName}`}>Drawbook</span>
    </Link>
  );
}
