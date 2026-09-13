import Link from "next/link";
import { DiscordLogo, XLogo } from "@phosphor-icons/react/dist/ssr";

import { Wordmark } from "./logo";

/**
 * One footer for every route, mounted once from the root layout.
 *
 * THE FOOTER IS THE PRODUCT'S ONE INVERTED BLOCK OF CHROME, and that is the only colour decision in
 * this file. `.inv` flips the seventeen role tokens on this element, so everything below is written
 * once, in role names, and comes out ink-on-paper at the foot of a lit page without a single
 * inverted colour being named here. The material model earns it: the page is a lit panel and this
 * is where the light stops. A dark mass closes the scroll the way a lightbox has a frame, and it
 * separates the four in-product destinations from the argument above them without a divider, a tint
 * or a second light source, none of which exist in this room.
 *
 * WHAT `.inv` ACTUALLY BUYS, spelled out because it is easy to write one class and assume magic.
 * `globals.css` maps roles with `@theme inline`, so `bg-panel` emits `var(--panel)` rather than a
 * value already resolved at `:root`, and `.inv` redefining `--panel` repaints every descendant that
 * names it. Two of those redefinitions are the point: inside `.inv`, `--bound` becomes `--paper-3`
 * and `--event` becomes `--iris-lift`, which is what stops this block reproducing the two pairs the
 * system bans outright (`--edge` on `--ink` is 2.90, `--iris` on `--ink` is 2.13). The focus ring
 * below is never declared and is correct anyway, at 8.01, because `:focus-visible` in the base
 * layer draws `var(--event)` and `--event` follows the block.
 *
 * `text-fg` ON THE FOOTER ITSELF IS NOT OPTIONAL. `body` sets `color: var(--fg)`, which resolves to
 * ink once, at `body`, and then inherits as a computed colour. Children of `.inv` inherit that ink
 * unless something inside the block re-reads the role, so a footer that only set `bg-panel` would be
 * ink on ink: 1.00, invisible, and invisible in a way no linter catches. Every text pair here is
 * therefore given a role explicitly rather than left to inherit. Verified in Chromium: the rendered
 * footer is rgb(233, 234, 246) on rgb(22, 20, 44).
 *
 * CONTRAST, COMPUTED AGAINST THE SURFACE EACH PAIR ACTUALLY SITS ON, which inside this block is
 * `--panel` = `--ink`, not the page. Same WCAG formula as the token file, sanity-checked at
 * white-on-black = 21.00, and every value below recomputed from the hexes rather than copied:
 *
 *     --fg    on --panel  15.01   the wordmark, a hovered link
 *     --fg-2  on --panel   7.49   the sentence under the wordmark, a resting link
 *     --fg-3  on --panel   5.65   the three column labels, the two social glyphs
 *     --event on --panel   8.01   the focus ring, from the base layer
 *     --rule  on --panel   1.35   the hairline under each label: decorative, never text
 *
 * The tightest text pair is 5.65 at 11px, which clears AA's 4.5 for normal text with room to spare.
 * The two social glyphs are non-text and answer to SC 1.4.11's 3:1 instead; 5.65 clears that too.
 * The hairline is the one thing here that is meant to be almost unreadable, and it is declared as
 * `--rule`, which the system defines as a separator that is never a control and never text, so it
 * carries no ratio requirement. The wordmark's own chip and reveal band are argued in `logo.tsx`
 * and come out 15.01 and 7.05 inside this block.
 *
 * WHY THERE IS NO RULE ALONG THE TOP OF THE BLOCK. A line would have to work in two situations and
 * works in neither. Above a lit page the change of material already draws the edge, better than a
 * hairline can. Below an inverted section, which is how a settled raffle's archive slab ends, the
 * only separator token available inside `.inv` is `--line-inv` at 1.35, so the line would not be
 * seen at all and the two dark blocks would merge regardless. The top padding does that job
 * honestly: where the footer follows ink, the two read as one closing mass, which is true.
 *
 * THIS BLOCK COVERS THE DIFFUSION FILM, AND IT IS MEANT TO. `globals.css` hangs a fixed grain off
 * `body::after` at 5.5% and warns that anything painting an opaque `--panel` across the full width
 * hides it. That warning is aimed at a layout wrapper quietly killing the grain on every route. Here
 * the surface really is a different material, the same trade the masthead makes at the other end of
 * the page, and the film has no business diffusing a block whose whole job is that the light stops.
 *
 * FULL BLEED, LIKE THE MASTHEAD AND EVERY BLOCK IN THE SYSTEM. The block is never centred: `--pad`
 * is the product's single gutter and `px-pad` is the whole horizontal story on every surface, so the
 * first column sits under the masthead's mark at every width. The grid inside it is argued at its
 * own comment below.
 *
 * THE LINK TARGETS ARE 31.5px TALL RATHER THAN 14px, which is the one measured defect the previous
 * system had here. Measured in Chromium at 390: a bare 13px inline anchor is a 14px-high hit area,
 * and with 10px between rows WCAG 2.2's 2.5.8 was met only through its spacing exception, which is a
 * pass you have to argue rather than one you can see. Making each anchor `inline-block` lets it take
 * its own 19.5px line box, `py-1.5` adds six pixels either side, and the target measures 31.5px:
 * past the 24px minimum outright, no exception invoked. The list's own spacing then comes off
 * entirely, because the padding is the spacing. Re-measured at 390, the nine link targets are 32px
 * tall to the pixel grid and the whole footer is 639px, against 643px for the layout that had the
 * defect. Nothing moved; the targets simply exist now.
 *
 * `inline-block` and not `block`, because a target the full width of its column is a hover firing
 * 150px to the right of a four-letter word, which reads as a bug rather than as generosity.
 *
 * THE CONTENT IS UNCHANGED FROM THE SYSTEM BEFORE THIS ONE, deliberately. Three columns of real
 * destinations rather than a wall of links: the product, the writing about it, and the chain it runs
 * on. External links say where they go, because a link that leaves the site without warning is a
 * small betrayal of the reader.
 *
 * The disclosure about which parts are live and which are sample data is not here. It lives in the
 * Status section of /docs, where someone looking for it will actually be, rather than as a paragraph
 * of small print under every page.
 */

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "Raffles", href: "/raffles" },
      { label: "Deploy a raffle", href: "/create" },
    ],
  },
  {
    heading: "Read",
    links: [
      { label: "Learn", href: "/learn" },
      { label: "Docs", href: "/docs" },
    ],
  },
  {
    heading: "Rialo",
    links: [
      { label: "rialo.io", href: "https://rialo.io", external: true },
      { label: "Rialo docs", href: "https://rialo.io/docs", external: true },
      { label: "Rialo learn", href: "https://learn.rialo.io", external: true },
    ],
    /*
      Rialo's channels, under Rialo's heading.

      Drawbook has no accounts of its own, and an unlabelled row of social icons in a footer is read
      by everyone as "follow us". Sitting these under the column already headed Rialo makes the
      ownership obvious without a disclaimer, which is why they are here rather than in a bottom bar.

      GitHub is deliberately absent. Rialo's own homepage links github.com/rialo, which belongs to an
      unrelated account registered in 2015 whose only repository is a tutorial last touched in 2016.
      The real one, SubzeroLabs/rialo, is private. Verified 2026-08-12; worth re-checking rather than
      assuming it stays wrong.

      Telegram was removed from this list on purpose and stays removed. See the two most recent
      commits that touched this file.
    */
    social: [
      { label: "Rialo on X", href: "https://x.com/RialoHQ", Icon: XLogo },
      { label: "Rialo on Discord", href: "https://discord.gg/RialoProtocol", Icon: DiscordLogo },
    ],
  },
];

/*
  One class string for every destination in the block, because there are nine of them and nine
  chances to write a slightly different hover. `--t-open` and `ease-settle` are what the masthead's
  links use, so the two pieces of chrome respond at the same speed and with the same landing.
  Verified compiled, not assumed: the resting anchor computes `0.2s cubic-bezier(0.2, 0.8, 0.2, 1)`.
*/
const LINK =
  "inline-block py-1.5 text-sm text-fg-2 transition-colors duration-[var(--t-open)] ease-settle hover:text-fg";

export function SiteFooter() {
  return (
    <footer className="inv bg-panel text-fg px-pad py-[clamp(40px,6vw,80px)]">
      {/*
        THE BLOCK IS FULL BLEED AND THE INDEX INSIDE IT SPANS IT, which is the same shape every block
        in this system has, and the reason the cap that used to sit here is gone.

        The problem the cap was solving is real. With `1.4fr repeat(3, 0.6fr)` and nothing else, a
        2560 page gives a 1019px first column holding a 38ch sentence and three 436px hairlines each
        naming two links, which is four stacks that happen to share a background rather than one
        index. But a `max-width` on the grid solved it by leaving the whole index in the left half of
        the block: measured in Chromium, at 1920 the columns stopped at x=1236 while the masthead
        above them ran to x=1864, and at 2560 there were 1268px of empty ink to the right of the last
        link. That does not read as restraint, it reads as a layout that fell over to one side.

        So the ceiling is on each link column instead of on the block. Below `xl` the proportional
        track keeps the narrow columns from crowding the sentence (at 1024: 356px and three of
        152.6px). From `xl` up the three link columns stop at 200px, which is the width they had
        arrived at naturally by then, and the first column absorbs every pixel after that. The index
        therefore ends on `--pad` at every width, aligned with the masthead's right edge, and the
        switch is invisible: at 1280 the tracks go from 458.5/196.5 to 448/200.
      */}
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,0.6fr)] xl:grid-cols-[1fr_repeat(3,minmax(0,200px))]">
        <div>
          {/*
            `-my-1 py-1` is a target, not a spacing change. The lockup's line box is 19.5px, which
            is under WCAG 2.2 2.5.8's 24px and passed only through the spacing exception, since the
            nearest other target is a column away. Four pixels of padding either side make the
            target 27.5px outright, and the matching negative margin means the margin box is still
            19.5px, so the sentence below it does not move: the footer measures 639px at 390 with
            and without this pair. Measured both ways in Chromium, not reasoned about.
          */}
          <Wordmark className="-my-1 py-1" />
          <p className="mt-3.5 max-w-[38ch] text-sm text-fg-2">
            On-chain raffles settled by a commit-reveal draw, so nobody picks the winner.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.heading} aria-label={column.heading}>
            {/*
              The heading sits on a hairline that runs the width of its column, so the foot of the
              page reads as a ruled index rather than as four unattached stacks of text. Inside this
              block that rule is `--line-inv`, which is nearly the surface it is drawn on. It is
              meant to be: it gives the eye an edge to align the column against without adding a
              second structure competing with the type.
            */}
            <h2 className="label border-b border-rule pb-2.5 text-fg-3">{column.heading}</h2>
            <ul className="mt-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  {"external" in link && link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={LINK}
                    >
                      {link.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <Link href={link.href} className={LINK}>
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>

            {/*
              An 18px glyph is an 18px tap target, which is less than half what a thumb needs.
              `p-2` grows each target to 34px, measured, without moving the glyph: the row's negative
              left margin cancels the 8px of padding on the first icon, so the X sits on the same
              vertical as the text links above it. The 8px of padding the row now carries along its
              top is why `mt-1.5` is smaller than the `mt-3` this row used to take; the gap you see
              between "Rialo learn" and the glyphs is unchanged.
            */}
            {column.social && (
              <ul className="-ml-2 mt-1.5 flex items-center gap-5">
                {column.social.map(({ label, href, Icon }) => (
                  <li key={href}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block p-2 text-fg-3 transition-colors duration-[var(--t-open)] ease-settle hover:text-fg"
                    >
                      {/*
                        Filled rather than the outline weight used elsewhere. XLogo is a solid
                        letterform at every weight, so at `regular` it sits beside an outlined
                        Discord and reads a full step heavier than it. Filling both evens them out
                        and matches how the brands actually draw their marks, which is also simply
                        more legible at 18px than a hairline glyph.
                      */}
                      <Icon size={18} weight="fill" aria-hidden="true" />
                      <span className="sr-only">{label} (opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        ))}
      </div>
    </footer>
  );
}
