import Link from "next/link";
import { DiscordLogo, XLogo } from "@phosphor-icons/react/dist/ssr";

import { Wordmark } from "./logo";

/**
 * One footer for every route, mounted once from the root layout.
 *
 * THE FOOTER IS A SLAB FLOATING ON THE PAGE, THE SAME WIDTH AS THE MASTHEAD PILL. It used to be the
 * one inverted block of chrome, ink on a lit page. On a dusk ground there is nothing to invert, so
 * it is now the preview's footer card: a 28px-radius slab of the faint slab ramp under a hairline,
 * with one low wine glow in its top right corner, the same light the haze hangs over the page. The
 * slab is inset 12px past the gutter on each side, exactly as the pill is, so the two pieces of
 * chrome frame every page at the same width, top and bottom.
 *
 * NO `.inv`. The record tone means a raffle that has left the floor, and the footer is not one.
 * Every pair below is written in role names and read against the slab, not the page.
 *
 * THE GLOW SITS BEHIND NO --fg-3. It is a radial wine light at 30%, decorative, drawn by the slab's
 * `::before` under the grid (the grid is `relative`, so it paints above it). At its peak the slab
 * is darkest-red enough that --fg-3 would fall to 4.43, so nothing here is --fg-3: the column heads
 * are apricot and the links and glyphs are --fg-2.
 *
 * CONTRAST, COMPUTED against the slab with every rgba composited over dusk first, formula
 * sanity-checked at white on black = 21.00. The second figure is the worst point, under the glow.
 *
 *     --fg     the wordmark, a hovered link      15.23 | 13.00
 *     --fg-2   the sentence, a resting link      9.01 | 7.70
 *     --event  the three column heads           12.50 | 10.67, and the focus ring
 *     --rule   the hairline under each head      decorative, never text
 *
 * ONE ENTRANCE, ON SCROLL, AND ONLY WHERE CSS CAN DO IT ALONE. The slab rises into place as it
 * enters the viewport, driven by a scroll timeline (`animation-timeline: view()`), inside
 * `@supports` and only with no reduced-motion preference. So the footer stays a Server Component
 * with no script, a browser without scroll timelines simply shows it, and because the entrance is
 * tied to scroll position rather than to a clock, the slab is always at rest once the page is
 * scrolled to its end. It is a 24px rise with no fade, for the reason written beside ENTER below.
 *
 * WHY THERE IS NO PROGRAM ID, NO BOTTOM BAR AND NO NEW LINE OF COPY HERE. The preview footer has
 * all three. The program id is in /docs where it is explained; a bottom bar would be a second
 * sentence on every page, and the one sentence that is here may claim only what is true
 * everywhere.
 *
 * THE LINK TARGETS ARE 31.5px TALL RATHER THAN 14px, which is the one measured defect the previous
 * system had here. Measured in Chromium at 390: a bare 13px inline anchor is a 14px-high hit area,
 * and with 10px between rows WCAG 2.2's 2.5.8 was met only through its spacing exception, which is a
 * pass you have to argue rather than one you can see. Making each anchor `inline-block` lets it take
 * its own 19.5px line box, `py-1.5` adds six pixels either side, and the target measures 31.5px:
 * past the 24px minimum outright, no exception invoked. The list's own spacing then comes off
 * entirely, because the padding is the spacing. When this was fixed the footer measured 639px at
 * 390 against 643px for the layout that had the defect, so nothing moved; the targets simply
 * exist. Re-measured on the slab in Chromium at 390, 1280 and 1920: eight links at 31.5px, the
 * wordmark at 27.5px and the two glyphs at 34px.
 *
 * `inline-block` and not `block`, because a target the full width of its column is a hover firing
 * 150px to the right of a four-letter word, which reads as a bug rather than as generosity.
 *
 * THE CONTENT IS UNCHANGED FROM THE SYSTEM BEFORE THIS ONE, deliberately. Three columns of real
 * destinations rather than a wall of links: the product, the writing about it, and the chain it runs
 * on. External links say where they go, because a link that leaves the site without warning is a
 * small betrayal of the reader.
 *
 * The full disclosure about which parts are live and which are sample data is not here. It lives in
 * the first and the "What does not hold" sections of /docs, where someone looking for it will
 * actually be, rather than as a paragraph of small print under every page.
 *
 * THE ONE SENTENCE UNDER THE WORDMARK IS ON EVERY PAGE, SO IT MAY CLAIM ONLY WHAT IS TRUE
 * EVERYWHERE. It used to promise that no party could choose the winner, which is wider than the
 * truth: whoever produces the draw block may be able to grind the chain's value. It now names the
 * network, says "randomized and checkable", and points at where the limits are written down.
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
      // "How it works", the masthead's own word for /learn and the page's eyebrow. The footer
      // used to say "Learn", so one route answered to two names a scroll apart.
      { label: "How it works", href: "/learn" },
      { label: "Docs", href: "/docs" },
      // Drawbook's own source, public since 2026-10-07: the program, its spec and its tests are
      // what make "checkable" more than a word, so the claim links to the evidence. A third row
      // here does not grow the footer, because the Rialo column is already taller.
      { label: "Source on GitHub", href: "https://github.com/Yujiu2121/drawbook", external: true },
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

      Rialo's GitHub is deliberately absent (Drawbook's own repository is under Read). Rialo's own
      homepage links github.com/rialo, which belongs to an
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

/*
  The slab's one entrance, driven by scroll rather than a clock (the header has why). Every piece
  is gated twice: on no reduced-motion preference and on support for scroll timelines. The longhands
  are written one by one rather than through `animation`, because the shorthand resets
  `animation-timeline`, and two utilities naming the same property are ordered by the stylesheet,
  not by this string. `animation-duration: auto` is what a scroll-driven animation runs on. Each
  class is a whole literal so Tailwind's scanner can see it; a composed string compiles to nothing.

  The keyframe is the footer's own, `footrise`, a 24px rise and NOTHING ELSE. Not `rise` from
  app/globals.css, because that one also fades from 0, and a scroll-driven fade rests wherever the
  reader stops scrolling: park with the slab half in view and its text would sit at half opacity,
  under every contrast floor in this file. A translate leaves the text at full strength at every
  scroll position. It is declared beside the markup through React's hoisted <style>, which renders
  once into <head> on the server and is deduplicated by its href.
*/
const ENTER = [
  "motion-safe:supports-[animation-timeline:view()]:[animation-name:footrise]",
  "motion-safe:supports-[animation-timeline:view()]:[animation-duration:auto]",
  "motion-safe:supports-[animation-timeline:view()]:[animation-timing-function:linear]",
  "motion-safe:supports-[animation-timeline:view()]:[animation-fill-mode:both]",
  "motion-safe:supports-[animation-timeline:view()]:[animation-timeline:view()]",
  "motion-safe:supports-[animation-timeline:view()]:[animation-range:entry_0%_entry_100%]",
].join(" ");

export function SiteFooter() {
  return (
    <footer className="px-[calc(var(--gutter)-12px)] pb-10 text-fg">
      <style href="site-footer-rise" precedence="default">
        {"@keyframes footrise{from{transform:translateY(24px)}}"}
      </style>
      <div className={`relative overflow-hidden rounded-slab border border-rule bg-[image:var(--ramp-slab)] p-[clamp(24px,4vw,48px)] before:pointer-events-none before:absolute before:top-[-60%] before:right-[-20%] before:h-[160%] before:w-[70%] before:bg-[radial-gradient(closest-side,rgba(var(--glow-rgb),.3),transparent)] ${ENTER}`}>
        {/*
          THE INDEX SPANS THE SLAB, and the reason the cap that used to sit here is gone.

          The problem the cap was solving is real. With `1.4fr repeat(3, 0.6fr)` and nothing else, a
          2560 page gives a 1019px first column holding a 38ch sentence and three 436px hairlines each
          naming two links, which is four stacks that happen to share a background rather than one
          index. But a `max-width` on the grid solved it by leaving the whole index in the left half of
          the block: measured in Chromium, at 1920 the columns stopped at x=1236 while the masthead
          above them ran to x=1864, and at 2560 there were 1268px of empty ink to the right of the last
          link. That does not read as restraint, it reads as a layout that fell over to one side.

          So the ceiling is on each link column instead of on the block. Below `xl` the proportional
          track keeps the narrow columns from crowding the sentence (inside the slab at 1024: 330px
          and three of 141.4px). From `xl` up the three link columns stop at 200px and the first
          column absorbs every pixel after that (at 1280 the tracks go from 425.7/182.4 to 374/200,
          measured on the slab). The index therefore ends on the slab's inner edge at every width,
          and the slab's outer edge is the masthead pill's. `relative` puts the grid above the
          glow, which is the slab's ::before.
        */}
        <div className="relative grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,0.6fr)] xl:grid-cols-[1fr_repeat(3,minmax(0,200px))]">
          <div>
            {/*
              `-my-1 py-1` is a target, not a spacing change. The lockup's line box is 19.5px, which
              is under WCAG 2.2 2.5.8's 24px and passed only through the spacing exception, since the
              nearest other target is a column away. Four pixels of padding either side make the
              target 27.5px outright, and the matching negative margin means the margin box is still
              19.5px, so the sentence below it does not move (the footer measured 639px at 390
              with and without this pair, both ways in Chromium, when it was added).
            */}
            <Wordmark className="-my-1 py-1" />
            <p className="mt-3.5 max-w-[38ch] text-sm text-fg-2">
              Commit-reveal raffles on Rialo testnet. The draw is randomized and checkable, and its
              limits are written down in Docs.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              {/*
                The heading sits on a hairline that runs the width of its column, so the foot of the
                page reads as a ruled index rather than as four unattached stacks of text. The rule is
                --rule, 1.55 on the slab, which is nearly the surface it is drawn on. It is meant to
                be: it gives the eye an edge to align the column against without adding a second
                structure competing with the type. The heading over it is apricot, the signal's
                label voice, the same as the eyebrows on the landing.
              */}
              <h2 className="label border-b border-rule pb-2.5 text-event">{column.heading}</h2>
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
                        className="block p-2 text-fg-2 transition-colors duration-[var(--t-open)] ease-settle hover:text-fg"
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
      </div>
    </footer>
  );
}
