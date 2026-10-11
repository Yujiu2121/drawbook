import Link from "next/link";

/**
 * The Drawbook mark: one revealed ticket, at 13 pixels.
 *
 * The product draws the same cell at every scale, a 6px sliver in a board row, a 22px sliver when
 * that row opens, an 88px square in the ticket bed, and the whole viewport during the draw. The mark
 * is that cell at its smallest, in the one state worth putting on every page: sold and revealed. A
 * revealed cell in the ticket bed is a rose square with the apricot band across its bottom 36%
 * (`app/cell.css`, `.c[data-s="2"]`), and this is the same rectangle with nothing added. So the mark
 * is not a picture of the product, it is a piece of it, and it needs no explaining anywhere the bed
 * is on screen.
 *
 * A filled chip, not a drawing of hairlines: a 1px rule inside a 13px box is 8% of the box and reads
 * as noise, while a filled chip survives 13px because it has no interior detail to lose. Square
 * corners for the same reason; a 3px radius on a 13px chip turns a ticket into a dot.
 *
 * IT IS PAINTED IN ROLES, SO IT CANNOT DRIFT FROM THE CELL IT IS.
 * The chip is `--cell-sold` and the band is `--event`, the same two roles `app/cell.css` gives a
 * revealed cell (its `--cell-mark` is `--event`). Neither moves with `.inv` any more: the record tone
 * steps the surfaces into wine and leaves the cells and the signal alone, so one painting serves
 * every surface and the old inverted variant is gone. Computed with the WCAG formula against what
 * each part actually sits on:
 *
 *   band on the chip         apricot on rose-sold     4.24
 *   chip on the page         rose-sold on dusk        3.17
 *   chip on the masthead     rose-sold on the glass   2.93
 *   chip in the record       rose-sold on wine        2.90
 *
 * The chip's edge falls under 3:1 on the glass and on wine. WCAG 1.4.11 exempts logotypes, and the
 * edge is not where the mark carries its meaning: the band is, at 4.24 everywhere, because it sits
 * on the chip rather than on the page. Lightening the chip to rescue its edge would put it back on
 * the palette's own #b85c63, where the band falls to 3.10, so the edge is the cost taken.
 *
 * THE MARK NEVER ANIMATES AND NEVER ANSWERS THE POINTER, and it never glows. Coral is a winner and
 * apricot is the signal; a cursor resting on a logo is neither, and a colour that a mouse can summon
 * stops being the colour that only a settled draw can. Focus is still visible: the `:focus-visible`
 * rule in `app/globals.css` rings the link.
 *
 * The favicon, the touch icon and the social card under `app/` are separate assets drawn with the
 * same three values on the dusk ground: chip #9a4a52, band #ffcfa8, ground #170c10.
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
      {/* The cell: a sold ticket, in the role a sold cell is painted in. */}
      <rect x="0" y="0" width="100" height="100" className="fill-cell-sold" />
      {/* The reveal band. See the contrast note above before changing either value. */}
      <rect x="0" y="64" width="100" height="36" className="fill-[var(--event)]" />
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
 * from an ancestor carries whatever that ancestor resolved, not the role. Naming the role on the link
 * itself re-resolves it per element: chalk at 16.38 on the page, 15.12 on the masthead glass and
 * 14.98 in the record tone. It was written when `.inv` still swapped `--fg` from ink to paper, and
 * without it the word rendered ink on ink in an inverted footer; the record tone no longer moves
 * `--fg`, but a role named at the element is the rule that keeps a future surface from repeating
 * that. A caller that wants a quieter wordmark should set the colour on a wrapper rather than pass
 * a second `text-*` here, since the two would have equal specificity.
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
