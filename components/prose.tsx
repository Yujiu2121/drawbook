/**
 * Reading typography for the two written pages, in SWEEP / CELL.
 *
 * THIS FILE IS THE WHOLE PORT OF /learn AND /docs. Both routes are built from the twelve exports
 * below and nothing else, so the primitives carry the system and the two pages carry the argument.
 * Every export is a pure Server Component: no state, no effect, no client directive, and no scroll
 * spy on the contents list, because a list of seven anchors does not need to watch the viewport to
 * be useful.
 *
 * THE ROOMS ARE STILL QUIET, AND NOW THEY ARE LIT. Cell's ground is the light source and ink is
 * where light is blocked, so a reading page is the plainest statement the system can make: flat
 * light, hairlines, ink. There is no shadow here because there is none anywhere, no tint because a
 * tint is not a material, and no motion, because a reader who came to understand the scheme is
 * already concentrating and a page that performs at them is taking that concentration away.
 *
 * THE MATERIAL RULE THAT DECIDES EVERY CLASS BELOW. What the machine produced is set into the
 * page; what a person wrote sits on it. A formula, a payload and an inline identifier go into the
 * recess, which is the same well the ticket bed and the payload block are cut into, because they
 * are all quotations from the program. Headings, prose, lists and the note stay on the panel,
 * because they are somebody talking. That is also why the note is a pair of rules rather than a
 * recessed block: putting the author's own aside into the well would claim the program said it.
 *
 * ROLES ONLY, so an inverted block needs no second rule. Every colour here is named through a role
 * token from app/globals.css, and the theme maps those with `@theme inline`, so any ancestor
 * carrying `.inv` repaints all of it. Verified by rendering this whole set inside `.inv` at 1280:
 * text-fg becomes paper, bg-recess becomes the inverted well, the fact rules and the note's two
 * bound rules follow, and the list marker inverts with them, with no second declaration anywhere in
 * this file. Neither written page wraps a block in `.inv` today, so nothing here depends on it; the
 * point is that a block that later does costs nothing to support.
 *
 * COMPUTED CONTRAST, every text pair in this file, against the surface it actually sits on
 * (sRGB relative luminance, white on black = 21.00):
 *
 *     on the panel                        light   inverted
 *     body, headings, note      fg        15.01     15.01
 *     lead, contents links      fg-2       7.60      7.49
 *     eyebrow, fact keys        fg-3       5.73      5.65
 *     note rules (3:1 needed)   bound      5.18      5.65
 *
 *     in the recess well
 *     formula, payload, inline  fg        11.86     11.15
 *     focus ring (3:1 needed)   event      5.57      5.95
 *
 *     non-text marks
 *     list marker (3:1 needed)  fg        15.01     15.01
 *     focus ring on a link      event      7.05      8.01
 *     hairlines, decorative     rule       1.71      1.35   never text, never a control
 *
 * The tightest pair in the whole system is fg-3 on the recess at 4.53, which is why nothing in
 * this file ever puts fg-3 into a well. Fact keys are fg-3 and the facts table has no fill.
 */

/**
 * The measure.
 *
 * 62ch, which is Cell's one reading width and is used here rather than a second number. Body text
 * stops being comfortable to track back from somewhere near this at 15px, and the whole point of
 * having one measure is that a paragraph on /docs and a paragraph on the landing are the same
 * paragraph.
 */
export function Article({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`max-w-[62ch] ${className}`}>{children}</div>;
}

/**
 * The standing index, and the reading-room layout that holds it.
 *
 * Both pages already gave every section an anchor and neither page listed them anywhere, so the
 * anchors existed only for whoever knew to type one. A reference document has its contents at the
 * front; putting the list back is what makes the ids do any work, and it is also what earns the
 * measure. A 62ch column inside an 1180px page leaves a column of nothing to its right, and the
 * head rule closing over both looked like a rule drawn past its own text.
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
    // overshooting a narrow column, which is what it did while the article was alone beneath it.
    <div className="mt-12 grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,62ch)_17rem] lg:justify-between">
      <nav
        aria-label="Contents"
        // The sticky offset is read from --mast rather than written as a number, so the index
        // clears the masthead at whatever height that route gives it, including the taller wrapped
        // masthead on a narrow screen.
        className="lg:sticky lg:top-[calc(var(--mast)+1.5rem)] lg:col-start-2 lg:row-start-1 lg:self-start"
      >
        <h2 className="label border-b border-rule pb-2.5 text-fg-3">Contents</h2>
        <ol className="mt-4 space-y-2.5">
          {contents.map(([id, heading], i) => (
            <li key={id} className="flex gap-3">
              {/* The numeral is furniture on the room, so it is stated rather than read out twice.
                  `label-b` is the narrow mono at full weight: a label that is also a number you
                  may need to find in the page. */}
              <span aria-hidden="true" className="label-b pt-0.5 text-label text-fg-3">
                {String(i + 1).padStart(2, "0")}
              </span>
              <a
                href={`#${id}`}
                className="text-sm text-fg-2 transition-colors duration-[120ms] ease-linear hover:text-fg"
              >
                {heading}
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
 * Young Serif at the title step, which is the voice Cell keeps for an argument rather than for the
 * chrome. A reference document is an argument made in sections, and the serif is what tells a
 * reader that a new one has started; the hairline above it does the rest, which is closer to how a
 * printed reference separates its sections than any amount of extra size would be. The first head
 * in an article drops both the rule and the space above it, because the page title block already
 * closes on a rule and two rules a few lines apart read as a mistake.
 *
 * `scroll-mt` is derived from --mast, not guessed, so following a contents link parks the heading
 * below the masthead on every route and at every masthead height.
 */
export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="font-serif mt-16 scroll-mt-[calc(var(--mast)+1.5rem)] border-t border-rule pt-6 text-title text-fg first:mt-0 first:border-t-0 first:pt-0"
    >
      {children}
    </h2>
  );
}

/**
 * A subordinate head.
 *
 * Archivo, not the serif, and that is a rule rather than a preference: Young Serif is never set
 * below 28px in this system, and a sub-head has to sit under a 24px section head. Weight and the
 * space above it are what separate it from the body it introduces.
 */
export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-10 text-lg font-semibold text-fg">{children}</h3>;
}

/** Body. Full ink, because on a reading page the body IS the primary text. */
export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-5 text-base text-fg">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-5 space-y-3">{children}</ul>;
}

/**
 * A list item, marked with a cell.
 *
 * The marker is the product's own object at its smallest scale: a 7px square, the same square that
 * is a 6px sliver in a board row and the whole viewport during a draw. It is a square and not a
 * bullet because nothing in this system is round, and it is drawn in `--fg` so it inverts with the
 * block rather than needing a second rule. A grid rather than a list-style marker so the second
 * line of a wrapped item aligns to the text and not to the square.
 */
export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[7px_minmax(0,1fr)] gap-x-4 text-base text-fg">
      <span aria-hidden="true" className="mt-[0.52em] block h-[7px] w-[7px] bg-fg" />
      <span>{children}</span>
    </li>
  );
}

/**
 * Inline code, for identifiers and short expressions.
 *
 * Set into the line rather than laid on it: the recess is the same well a formula and a payload
 * are cut into, at the size of two words. The `mono` class is carrying the width axis, not the
 * family. Tailwind's preflight already gives every `<code>` and `<pre>` Martian Mono through
 * --default-mono-font-family, but it also writes `font-variation-settings: normal`, and Martian
 * Mono's default width instance is 112.5. Width 100 is the product's figure width, so the class
 * is what stops an identifier inside a sentence rendering 7% wider than the same identifier in
 * the formula three lines below it.
 */
export function C({ children }: { children: React.ReactNode }) {
  return <code className="mono bg-recess px-1.5 py-0.5 text-sm text-fg">{children}</code>;
}

/**
 * A block of code or a formula: a quotation from the program, so it goes into the well.
 *
 * The well and the scroller are two elements. Padding belongs to the recess and the overflow
 * belongs to the `pre`, so a formula wider than the page scrolls inside its own gutter instead of
 * running its first character into the edge of the surface.
 *
 * The `pre` is focusable because it scrolls. On a narrow screen a formula is wider than the well,
 * and a region that can only be scrolled by dragging it is unreachable from a keyboard. It takes
 * the room's own focus ring from the base layer: `--event` on the recess is 5.57 on light and 5.95
 * inverted, both clear of the 3:1 a focus indicator has to make.
 */
export function Code({ children }: { children: string }) {
  return (
    <div className="mt-6 bg-recess px-4 py-3.5">
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
 * The gutter is 16px, not 24. The preview sets no horizontal padding on a facts cell at all and
 * lets the 44/56 split be the whole gutter; at 390 every pixel taken out of the key column is a
 * line added to a key. 16px is the smallest gutter that still keeps a long key and a long
 * right-aligned figure from meeting.
 *
 * No fill under it. The facts are quoted but they are not a payload, and the one pair in this
 * system that would fail is fact keys in a well: `--fg-3` on `--recess` is 4.53 on light, the
 * tightest passing pair there is, and it should not be asked to carry 13px type in an inverted
 * block as well. On the panel the same key is 5.73, and the rules between rows are the room's
 * hairline, which is what a printed rule between two measurements looks like.
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
 * Something the reader should not skip.
 *
 * It earns its weight without a hue and without a surface. `--event` is ceremonial and means a
 * winner, so borrowing it here would teach a reader that the colour means "pay attention" and then
 * leave them unable to tell a caution from a celebration. A recess would be worse: the well is
 * where the program's own output goes, and a note is the author speaking.
 *
 * So it is two rules and a label. The rules are `--bound` rather than `--rule`, which is the one
 * deliberate departure from the hairline everything else in this file uses: `--rule` is 1.71
 * against the panel, a separator you are meant to barely see, and a bracket that is meant to stop
 * you has to be visible on its own. `--bound` is 5.18 on light and 5.65 inverted.
 */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 border-y border-bound py-5">
      <span className="label text-fg-3">Note</span>
      <p className="mt-3 text-base text-fg">{children}</p>
    </div>
  );
}

/**
 * The page title block, shared by both written pages.
 *
 * A block, a serif title and a lead, which is how every argument in Cell opens. The serif is at
 * the display step, so it is never smaller than 36px and the one rule Young Serif has in this
 * system holds. Closes on a rule, so the reading rooms open the way a printed document does: a
 * standing head, a one-line statement of what the document is, and then the body begins under a
 * line that runs the full width of the page, index and all.
 *
 * THE MASTHEAD OFFSET LIVES HERE, NOT ON THE PAGE. `Masthead` is `position: fixed` and `--mast`
 * tall, and the repo's convention is that each route's own `<main>` carries `pt-mast`. Neither
 * written page does, and neither is in scope to be edited, so this block reserves the bar itself:
 * `calc(var(--mast) + 3.5rem)` is the masthead plus the 56px of air the head wants above its
 * eyebrow. It is read from the token rather than written as a number, so a route that ever gives
 * the bar a different height keeps the same air under it. A flat `pt-14` was 56px, which is
 * exactly `--mast`, so the eyebrow sat on the masthead's own hairline with nothing between them.
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
      <span className="label text-fg-3">{eyebrow}</span>
      <h1 className="font-serif mt-5 max-w-[16ch] text-display text-fg">{title}</h1>
      <p className="mt-7 max-w-[52ch] text-lg text-fg-2">{lede}</p>
    </header>
  );
}
