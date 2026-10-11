/**
 * Reading typography for the two written pages, in DRUM, on the Senja dusk.
 *
 * THIS FILE IS THE WHOLE KIT FOR /learn AND /docs. Both routes are built from the fifteen exports
 * below and nothing else, so the primitives carry the system and the two pages carry the argument.
 * That includes their links and their controls: a page that writes its own class lists is how a
 * dead class name gets in (the token reset in app/globals.css compiles an unknown name to nothing,
 * with a green build), so the styling lives here once, in role names and named steps that exist.
 * Every export is a pure Server Component: no state, no effect, no client directive, and no scroll
 * spy on the contents list, because a list of anchors does not need to watch the viewport to be
 * useful.
 *
 * THE ROOMS ARE LIT AT DUSK, AND THE WORDS STAY STILL. The page is the dusk ground under the haze,
 * and the furniture is the same material the rest of Drum is made of: the contents list and the
 * note are warm cards, the formulas sit in a recess well, the head is set in the headline face
 * with its ramp. There is motion, and all of it is on decoration: the head rises once when the
 * page opens, each section's hairline draws in once as it scrolls up into view, and the contents
 * rows lean two pixels toward the pointer. Body text never fades, slides or waits for a scroll,
 * because a reader who came to understand the scheme is already concentrating, and a paragraph
 * that performs at them takes that concentration away. Under reduced motion all three are gone
 * and every element is drawn at rest. No three.js, no cursor glow and no tilt on these routes.
 *
 * THE MATERIAL RULE THAT DECIDES EVERY CLASS BELOW. What the machine produced is set into the
 * page; what a person wrote sits on it. A formula, a payload and an inline identifier go into the
 * recess, the same well the ticket bed and the payload block are cut into, because they are all
 * quotations from the program. Headings, prose, lists and the note stay on the page or on a card,
 * because they are somebody talking. That is also why the note is a card and not a well: putting
 * the author's own aside into the well would claim the program said it.
 *
 * ROLES ONLY. Every colour here is a role token from app/globals.css, mapped through
 * `@theme inline`, so an ancestor carrying `.inv` (the record tone, one step into wine) moves the
 * surfaces with no second rule here. Neither written page sits in `.inv` today; the wine column
 * below is there so a block that later does is already checked.
 *
 * COMPUTED CONTRAST, every pair in this file against the surface it actually sits on (WCAG 2.x,
 * sRGB relative luminance, white on black = 21.00; the card is its ramp's top stop composited over
 * dusk, #29131b, its brightest and therefore its worst point; the hover row is 8% line over that):
 *
 *                                          dusk   card   hover  wine   recess
 *     body, headings, note, values  fg     16.38  14.92  13.10  14.98  17.03
 *     lead, contents links          fg-2    9.70   8.84   7.76   8.87
 *     contents head, fact keys      fg-3    5.58   5.08          5.10
 *     eyebrow, numerals, Note       event  13.45  12.25  10.76  12.30  13.98
 *     link underline, note edge     bound   3.97   3.62          3.63          (3:1 needed)
 *     hairlines, decorative         rule    1.70   1.55          1.55          never text
 *
 *     the list marker, non-text     cell-sold on dusk 3.17, the apricot foot on cell-sold 4.24
 *     focus ring                    apricot at a 2px offset: 13.45 on dusk, 12.25 on a card,
 *                                   13.98 in the recess around a scrolling formula
 *
 * fg-3 never goes into the recess and never onto a hover row (4.46 there), and nothing in this file
 * goes onto glass: the contents and the note are cards, which sit on the page rather than over the
 * drum canvas, and these routes have no canvas.
 */

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { BUTTON, BUTTON_PRIMARY } from "@/lib/controls";

/**
 * The measure.
 *
 * 62ch, the product's one reading width, used here rather than a second number. Body text stops
 * being comfortable to track back from somewhere near this at 15px, and the whole point of having
 * one measure is that a paragraph on /docs and a paragraph on the landing are the same paragraph.
 */
export function Article({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  // `min-w-0` because this is a grid item, and a grid item's automatic minimum width is its
  // min-content width. Without it the widest unbreakable thing inside (a formula in a well) sets
  // the column's floor, and on a phone the whole page scrolled sideways to 466px instead of the
  // formula scrolling inside its own box.
  return <div className={`min-w-0 max-w-[62ch] ${className}`}>{children}</div>;
}

/**
 * The standing index, and the reading-room layout that holds it.
 *
 * Both pages give every section an anchor, and a reference document has its contents at the
 * front; the list is what makes the ids do any work, and it is also what earns the measure. A 62ch
 * column alone under a full-width head leaves a field of nothing to its right, and the head rule
 * closing over both looked like a rule drawn past its own text.
 *
 * The index is FIRST in the DOM and second in the grid. Reading order therefore matches a printed
 * document, a keyboard reaches the sections before the prose rather than after all of it, and on a
 * narrow screen, where the two columns collapse, the list simply sits at the top of the document
 * where a contents list belongs. Ordering it the other way would have needed a visual swap, which
 * is the thing that leaves tab order walking backwards up the page.
 *
 * It is a plain `<ol>` of anchors and it stays one. A scroll spy would make this file a client
 * component, ship an observer to highlight a row nobody is looking at, and buy nothing a reader
 * cannot already see from where the page is.
 *
 * It sits on a card: the faint card ramp under a hairline, rounded to the card step. Each row is
 * the whole link, so the target is the full row rather than the words alone; under the pointer the
 * row takes an 8% line tint, its words step from fg-2 to fg, and it leans 2px to the right, which
 * is a translate and repaints nothing. The lean is motion-safe only.
 */
export function Reading({
  contents,
  children,
}: {
  /** Section id and its heading, in page order. Must match the H2 ids below. */
  contents: [string, string][];
  children: React.ReactNode;
}) {
  return (
    // `justify-between` on the grid rather than a `1fr` filler track. The two tracks then sit under
    // the two ends of the head rule, so the rule reads as spanning the document instead of
    // overshooting a narrow column; with the page on the gutter, that puts the contents card's
    // right edge on the same line as the masthead's and the footer's.
    //
    // Below `lg` the single track is written out as `minmax(0,1fr)` rather than left implicit. An
    // implicit track is `auto`, which sizes to the article's min-content, and that is the other
    // half of how a code block used to widen /docs to 466px on a 390px phone.
    <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,62ch)_19rem] lg:justify-between">
      <nav
        aria-label="Contents"
        // The sticky offset is read from --mast rather than written as a number, so the index
        // clears the masthead at whatever height that route gives it. The card is capped at the
        // height left below that offset and scrolls inside itself past it: sticky never scrolls,
        // so on a short lg window (a landscape tablet, a small laptop) the last rows would
        // otherwise sit off-screen and unreachable until the page ran out.
        className="card rounded-card p-5 lg:sticky lg:top-[calc(var(--mast)+1.5rem)] lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100dvh-var(--mast)-3rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain"
      >
        <h2 className="label border-b border-rule pb-2.5 text-fg-3">Contents</h2>
        {/* `-mx-2.5` pulls the rows' own padding back out, so the numerals line up under the
            "Contents" head while the hover tint still has room either side of the words. */}
        <ol className="-mx-2.5 mt-3 space-y-0.5">
          {contents.map(([id, heading], i) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="flex gap-3 rounded-[10px] px-2.5 py-1.5 text-sm text-fg-2 transition-[color,background-color,translate] duration-[var(--t-open)] ease-settle hover:bg-[rgba(var(--line-rgb),0.08)] hover:text-fg motion-safe:hover:translate-x-0.5"
              >
                {/* The numeral is furniture on the room, so it is stated rather than read out twice.
                    `label-b` is the narrow mono at full weight: a label that is also a number you
                    may need to find in the page. Apricot, the signal, because it is a marker. */}
                <span aria-hidden="true" className="label-b pt-0.5 text-label text-event">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{heading}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <Article className="lg:col-start-1 lg:row-start-1">{children}</Article>
    </div>
  );
}

/**
 * A section head.
 *
 * `headline-sub` at the title step: Archivo 700 at width 108, the face Drum uses for a head one
 * step below the display. A reference document is an argument made in sections, and the width is
 * what tells a reader that a new one has started; the hairline above it does the rest, which is
 * closer to how a printed reference separates its sections than any amount of extra size. The
 * first head in an article drops both the rule and the space above it, because the page title
 * block already closes on a rule and two rules a few lines apart read as a mistake.
 *
 * THE HAIRLINE DRAWS IN, ONCE, AND ONLY AS DECORATION. It is a `::before` rather than a border so
 * it can move: on a browser with scroll-driven animations, and with reduced motion off, it grows
 * out from the left edge and fades up over the first 3rem of scroll after it crosses the bottom
 * edge: about the head's own height, so the rule is whole by the time the head is fully on
 * screen. The range is a length, not `entry`, because the timeline's subject is the 1px rule
 * itself, whose entry range is one pixel long and would turn the draw into a pop. A wider range
 * (a fifth of the viewport) let the rule rest half drawn for as long as a reader stopped with a
 * head near the bottom edge, which read as a rendering fault. It runs on the scroll position, not on a clock, so
 * it never replays on its own, a head the page loads or jumps to is simply drawn, and scrolling
 * back below the bottom edge is the only way to see it move again. The keyframes are `cellin`, the cell's own arrival from
 * 35% scale, read from the left edge: the system's one entrance for a mark, not a new one. Where
 * scroll timelines are missing, or motion is reduced, the rule is a static hairline. The words
 * themselves never move.
 *
 * `scroll-mt` is derived from --mast, not guessed, so following a contents link parks the heading
 * below the masthead on every route.
 */
export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="headline-sub relative mt-16 scroll-mt-[calc(var(--mast)+1.5rem)] pt-6 text-title text-fg before:absolute before:inset-x-0 before:top-0 before:h-px before:origin-left before:bg-rule first:mt-0 first:pt-0 first:before:hidden motion-safe:supports-[animation-timeline:view()]:before:[animation-name:cellin] motion-safe:supports-[animation-timeline:view()]:before:[animation-duration:auto] motion-safe:supports-[animation-timeline:view()]:before:[animation-timing-function:linear] motion-safe:supports-[animation-timeline:view()]:before:[animation-fill-mode:both] motion-safe:supports-[animation-timeline:view()]:before:[animation-timeline:view()] motion-safe:supports-[animation-timeline:view()]:before:[animation-range:cover_0px_cover_3rem]"
    >
      {children}
    </h2>
  );
}

/**
 * A subordinate head.
 *
 * Archivo at its normal width, not the headline face: a sub-head has to sit under a 22-30px
 * section head without competing with it. Weight and the space above it are what separate it from
 * the body it introduces.
 */
export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-10 text-lg font-semibold text-fg">{children}</h3>;
}

/** Body. Full chalk, because on a reading page the body IS the primary text. */
export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-5 text-base text-fg">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-5 space-y-3">{children}</ul>;
}

/**
 * A list item, marked with a cell.
 *
 * The marker is the product's own object at its smallest scale, and the logo at its smallest: a
 * 7px sold cell with its revealed apricot foot across the bottom 36%, the same rectangle the
 * masthead mark draws and app/cell.css draws for a revealed ticket. It is square, as the mark is.
 * A non-text mark, so 3:1 is the floor: cell-sold on dusk is 3.17 and the foot on the cell 4.24.
 * A grid rather than a list-style marker so the second line of a wrapped item aligns to the text
 * and not to the square.
 */
export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[7px_minmax(0,1fr)] gap-x-4 text-base text-fg">
      <span
        aria-hidden="true"
        className="relative mt-[0.52em] block h-[7px] w-[7px] overflow-hidden bg-cell-sold after:absolute after:inset-x-0 after:bottom-0 after:h-[36%] after:bg-event"
      />
      <span>{children}</span>
    </li>
  );
}

/**
 * Inline code, for identifiers and short expressions.
 *
 * Set into the line rather than laid on it: the recess is the same well a formula and a payload
 * are cut into, at the size of two words, with a 6px corner. `box-decoration-clone` gives each
 * line of a wrapped identifier its own padding and corners, so a program id broken over two lines
 * reads as two pieces of one well rather than a box sliced open. The `mono` class is carrying the
 * width axis, not the family. Tailwind's preflight already gives every `<code>` and `<pre>` Martian
 * Mono through --default-mono-font-family, but it also writes `font-variation-settings: normal`,
 * and Martian Mono's default width instance is 112.5. Width 100 is the product's figure width, so
 * the class is what stops an identifier inside a sentence rendering 7% wider than the same
 * identifier in the formula three lines below it.
 */
export function C({ children }: { children: React.ReactNode }) {
  // `wrap-anywhere` because an identifier has no spaces to break at. A 44-character program id
  // or `rialo_s_random_seed::get_random_seed()` is wider than a 320px phone's measure, and an
  // inline token that cannot break pushes the page sideways however the grid is sized.
  return (
    <code className="mono box-decoration-clone rounded-[6px] bg-recess px-1.5 py-0.5 text-sm text-fg wrap-anywhere">
      {children}
    </code>
  );
}

/**
 * A block of code or a formula: a quotation from the program, so it goes into the well.
 *
 * The well and the scroller are two elements. Padding belongs to the recess and the overflow
 * belongs to the `pre`, so a formula wider than the page scrolls inside its own gutter instead of
 * running its first character into the edge of the well. The well takes the well step's corner
 * and the room's hairline, so the cut reads on dusk, where the pit alone is a shade off the page.
 *
 * The `pre` is focusable because it scrolls. On a narrow screen a formula is wider than the well,
 * and a region that can only be scrolled by dragging it is unreachable from a keyboard. It takes
 * the room's own focus ring from the base layer: apricot, 13.98 on the recess around it.
 */
export function Code({ children }: { children: string }) {
  return (
    <div className="mt-6 rounded-well border border-rule bg-recess px-4 py-3.5">
      <pre className="mono overflow-x-auto text-sm leading-[1.7] text-fg" tabIndex={0}>
        {children}
      </pre>
    </div>
  );
}

/**
 * A table of stated facts.
 *
 * Every row here is a measurement or a probed value rather than a claim. It is a table and not a
 * description list because the two columns have to align down the page: a key column fixed at 44%
 * and a right-aligned figure column, so eight measured values read as one block of evidence rather
 * than eight separate lines.
 *
 * `table-fixed` is what makes the 44% mean anything, and it was measured rather than assumed. Under
 * the default auto layout a `width` on a cell is only a suggestion, and the figure column overrules
 * it: `break-words` is `overflow-wrap: break-word`, which breaks a long token when a line cannot
 * hold it but does NOT reduce the column's min-content width, so a 29-character URL claimed 196px
 * of a 350px phone and left the key 138px. Rendered at 390 that put "Deterministic for a given
 * seed" on three lines against a one-word answer. With a fixed layout the split is honoured, every
 * key falls to one or two lines, and the figure wraps instead. At 1280 the three layouts render
 * identically, so this costs nothing at the width the table was designed at.
 *
 * The gutter is 16px, not 24: at 390 every pixel taken out of the key column is a line added to a
 * key. 16px is the smallest gutter that still keeps a long key and a long right-aligned figure
 * from meeting.
 *
 * No fill under it. The facts are quoted but they are not a payload, so they sit on the bare page:
 * keys in fg-3 at 5.58, values in fg, and the room's hairline between rows, which is what a
 * printed rule between two measurements looks like. fg-3 is kept off the recess and off glass.
 */
export function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <table className="mt-6 w-full table-fixed border-collapse text-sm">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th
              scope="row"
              className="w-[44%] border-b border-rule py-2.5 pr-4 text-left align-top font-normal text-fg-3"
            >
              {k}
            </th>
            {/* The value is a quantity, so it takes the figure width. Tabular numerals are already
                on from the body rule, and long hex wraps between characters rather than pushing
                the table sideways on a phone. */}
            <td className="figure border-b border-rule py-2.5 text-right align-top break-words text-fg">
              {v}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A link inside running text.
 *
 * Full chalk, because it is part of the sentence, with the underline in `--bound` so it reads as a
 * link and not as emphasis: the underline is a non-text mark and `--bound` is 3.97 on dusk and
 * 3.62 on a card, clear of the 3:1 such a mark needs. Under the pointer the words and the underline
 * go apricot, the signal, 13.45 on dusk. Never coral: coral is a winner and nothing else.
 *
 * `href` starting with `#` or `/` stays inside the site through next/link.
 */
export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-fg underline decoration-bound underline-offset-4 transition-colors duration-[var(--t-open)] ease-settle hover:text-event hover:decoration-event"
    >
      {children}
    </Link>
  );
}

/**
 * The control a reading page ends on, in the product's two kinds.
 *
 * The class strings come from lib/controls.ts, the one definition of a button in Drawbook, which is
 * a plain module on purpose: a string imported from a client module reaches a Server Component as
 * a client reference, not as the string, and the class list would silently be empty. Primary is the
 * paper pill (`cta`: the paper ramp, wine ink, the wine glow, a 2px lift and a 1px press, all
 * motion-safe), with the arrow. Secondary is the bounded pill; it presses with a one-pixel
 * translate, which repaints nothing, and like the primary's press only with reduced motion off.
 */
export function Action({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  const kind = primary ? BUTTON_PRIMARY : `${BUTTON} motion-safe:active:translate-y-px`;
  return (
    <Link href={href} className={kind}>
      {children}
      {primary && <ArrowRight size={14} weight="bold" aria-hidden="true" />}
    </Link>
  );
}

/**
 * A reference table: several columns of left-aligned text, for the places where a description has
 * to line up down the page (error codes, the instructions at a glance).
 *
 * Facts is for a measured value against its name and right-aligns the value; this is for words
 * against words, so nothing is right-aligned. `table-fixed` with stated column widths for the same
 * reason Facts uses it: under the auto layout the widest token sets a column's floor and a phone
 * gets a sideways scroll. Cells wrap, and the first column is set in the figure face because in
 * every table on these pages it is a number or an identifier.
 *
 * The header row is `fg-3` labels on a `--rule` hairline, the same head the contents list and the
 * footer columns carry. No fill under it, for the reason Facts gives.
 */
export function Table({
  head,
  widths,
  rows,
}: {
  head: string[];
  /** One CSS width per column, for example ["4.5rem", "auto"]. */
  widths: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <table className="mt-6 w-full table-fixed border-collapse text-sm">
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col" className="label border-b border-rule pb-2.5 pr-4 text-left align-bottom text-fg-3 last:pr-0">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, r) => (
          <tr key={r}>
            {cells.map((cell, c) => (
              <td
                key={c}
                className={`border-b border-rule py-2.5 pr-4 text-left align-top text-fg last:pr-0 ${
                  c === 0 ? "figure" : ""
                } wrap-break-word`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Something the reader should not skip.
 *
 * A card, because the author is speaking: never the recess, which is where the program's own
 * output goes. Its edge is `--bound` rather than the card's usual `--rule`, the one deliberate
 * departure from the hairline everything else in this file uses: `--rule` is 1.55 against the
 * card, a separator you are meant to barely see, and a bracket that is meant to stop you has to be
 * visible on its own. `--bound` is 3.62 there and 3.97 at the card's dusk end. The label is
 * apricot, the signal, which is what a marker is for; coral would claim a winner.
 */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 rounded-[18px] border border-bound bg-[image:var(--ramp-card)] px-5 py-5 sm:px-6">
      <span className="label text-event">Note</span>
      <p className="mt-3 text-base text-fg">{children}</p>
    </div>
  );
}

/**
 * The page title block, shared by both written pages.
 *
 * An eyebrow, a title and a lead, which is how every argument in Drum opens: the eyebrow is an
 * apricot label behind a short apricot rule, the title is the headline face at the display step
 * under the headline ramp (chalk into apricot by 55%, 13.45 at its apricot end on dusk), and the
 * lead is fg-2. It closes on a rule, so the reading rooms open the way a printed document does: a
 * standing head, a one-line statement of what the document is, and then the body begins under a
 * line that runs the full width of the page, index and all.
 *
 * THE HEAD RISES ONCE. The three parts come up 34px and in, one after another, on the `rise`
 * keyframes every Drum entrance uses, in pure CSS so they run with no script. The fill is
 * BACKWARDS only: each part is held hidden through its delay, and when it lands the animation lets
 * go of it entirely rather than holding a transform that would keep a stacking context alive.
 * Under reduced motion nothing animates and the head is simply there.
 *
 * THE MASTHEAD OFFSET LIVES HERE, NOT ON THE PAGE. `Masthead` is `position: fixed` and `--mast`
 * tall, and the repo's convention is that each route's own `<main>` carries `pt-mast`. Neither
 * written page does, so this block reserves the bar itself: `calc(var(--mast) + 3.5rem)` is the
 * masthead plus the 56px of air the head wants above its eyebrow. It is read from the token rather
 * than written as a number, so a route that ever gives the bar a different height keeps the same
 * air under it.
 */
export function PageHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="border-b border-rule pt-[calc(var(--mast)+3.5rem)] pb-10">
      <span className="label flex items-center gap-3 text-event before:h-px before:w-7 before:shrink-0 before:bg-event motion-safe:animate-[rise_var(--t-rise)_var(--ease-rise)_backwards]">
        {eyebrow}
      </span>
      <h1 className="headline headline-ramp mt-5 max-w-[16ch] text-display motion-safe:animate-[rise_var(--t-rise)_var(--ease-rise)_calc(var(--t-stagger)*2)_backwards]">
        {title}
      </h1>
      <p className="mt-7 max-w-[52ch] text-lg text-fg-2 motion-safe:animate-[rise_var(--t-rise)_var(--ease-rise)_calc(var(--t-stagger)*4)_backwards]">
        {lede}
      </p>
    </header>
  );
}
