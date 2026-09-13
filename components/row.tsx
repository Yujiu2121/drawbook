import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

import { PHASE_WORD, Strip } from "./cell";
import { COUNTDOWN_RESERVE, isLive, serialOf, utcShort } from "@/lib/cell";
import { formatRLO, summarize, type Raffle } from "@/lib/raffle";

/**
 * THE BOARD ROW.
 *
 * One raffle, one line: serial, title, phase, the strip of every ticket in it, the pool, and the
 * clock. It is the same object on /raffles and on the landing's miniboard, because a raffle that
 * reads one way on one screen and another way on the next is two raffles.
 *
 * PURE MARKUP. Every rule that draws this row lives in app/cell.css under `.row`, `.a-*` and
 * `.phase-tag`; every colour is a role token, so the row follows `.inv` into the record slab with
 * no second definition and no branch here. The only things this file decides are which strings go
 * in which area and which of them come out of lib.
 *
 * NO CLIENT DIRECTIVE, deliberately. The board and the landing both render this on the server, and
 * the two things on the row that genuinely move under the viewer arrive as slots: the countdown
 * island, and (on the board only) the strip already wrapped in its view transition.
 *
 * NOTHING HERE IS A NAMED VIEW TRANSITION. A transition name may be written in exactly two files
 * in the whole product, components/row-link.tsx and app/raffle/[id]/page.tsx. Raffle 0004 appears
 * on the landing twice over, in the miniboard and in the ceremony, and a second element claiming
 * `cell-4` does not error: React silently applies the name to one of them and the morph then
 * anchors by tree order rather than by design.
 *
 * TWO COMPOSITIONS, ONE ROW
 *
 *   The landing miniboard, and any list that just links:
 *
 *     <div className="rows">
 *       <RaffleRow raffle={r} mini countdown={<Countdown raffle={r} />} />
 *     </div>
 *
 *   The board, where the row is the navigation and its strip is the source of the morph:
 *
 *     <RowLink id={id} {...rowContainerProps(r)} aria-label={rowLabel(r)}>
 *       <RaffleRowCells
 *         raffle={r}
 *         strip={<NamedStrip id={id}><Strip raffle={r} /></NamedStrip>}
 *         countdown={<Countdown raffle={r} />}
 *       />
 *     </RowLink>
 *
 * `.rows` AROUND THE LIST IS NOT OPTIONAL. The row opens by translating 4px to the right, a
 * transform's overflow propagates to the document, and a full bleed row without `.rows`
 * (`overflow-x: clip`) gives the whole page a 4px horizontal scrollbar on hover.
 *
 * CONTRAST, COMPUTED (WCAG 2.x relative luminance, white on black = 21.00), each pair against the
 * surface it actually sits on rather than against the page:
 *
 *   row text        --fg / --panel-2     13.82 light,  15.01 inverted
 *   row text        --fg / --phase       12.55          (a revealing raffle sits on --phase)
 *   sub label       --fg-3 / --panel-2    5.27 light,   5.65 inverted
 *   sub label       --fg-3 / --phase      4.79
 *   drawn tag       --event / --panel-2   6.49 light,   8.01 inverted
 *   void tag        --fg-3 / --panel-2    5.27 light,   5.65 inverted
 *   tag boundary    --bound / --panel-2   4.77 light,   5.65 inverted   (needs 3:1, not 4.5)
 *   tag boundary    --bound / --phase     4.33
 *
 * The floor is 4.79 on an 11px label, which clears AA for small text. The pool figure, the title
 * and the countdown are all --fg and never fall below 12.55.
 */

/**
 * A mini row is the landing's miniboard row, and the miniboard sits inside the landing's own
 * measure, which has already spent `--pad` on its gutter. `.row` pays that gutter again because on
 * /raffles the row is full bleed, so the mini variant hands it back. This is the whole of the
 * inline style budget for this component.
 */
const MINI_ROW_STYLE: CSSProperties = { paddingInline: 0 };

export interface RaffleRowProps {
  raffle: Raffle;
  /**
   * The landing miniboard. Two differences and no others: the strip drops from 10px to 6px, a mark
   * rather than a meter, and the row gives back the gutter its container already paid.
   */
  mini?: boolean;
  /**
   * The clock, as a slot, because a live raffle's countdown is the one figure on the row that
   * changes under the viewer and it therefore has to be a client island. Pass
   * `<Countdown raffle={r} />`. Left out, a raffle that has stopped moving still prints its
   * absolute instant, dead still, on the server; a live one prints nothing rather than a figure
   * that was true when the page was built.
   */
  countdown?: ReactNode;
  /**
   * The strip, as a slot, so that the board can hand in the same strip already wrapped in the
   * navigation's single named view transition:
   *
   *   strip={<NamedStrip id={id}><Strip raffle={r} /></NamedStrip>}
   *
   * Left out, the row builds its own, which is what the landing miniboard and every unnamed list
   * want. The name itself never appears here: see the note at the top of this file.
   */
  strip?: ReactNode;
}

/**
 * The attributes the row's container carries, wherever that container is. Exported so the board's
 * `<Link>` and the landing's `<Link>` cannot drift: `.row` is a grid and `data-phase` is what
 * paints a revealing raffle on `--phase` instead of `--panel-2`.
 */
export function rowContainerProps(raffle: Raffle, mini = false) {
  return {
    className: "row",
    "data-phase": raffle.phase,
    style: mini ? MINI_ROW_STYLE : undefined,
  };
}

/**
 * The row's accessible name.
 *
 * The whole row is one link, so without this its computed name is every string inside it read out
 * in one breath, ending with a countdown that is different by the time the sentence finishes.
 * Exported so that the board's `<RowLink>` and the landing's row give the same name for the same
 * raffle, and so that nothing that ticks gets into it.
 */
export function rowLabel(raffle: Raffle): string {
  const s = summarize(raffle);
  return (
    `Raffle ${serialOf(raffle)}, ${raffle.config.title}. ` +
    `${PHASE_WORD[raffle.phase]}, ${s.sold} of ${raffle.config.supply} tickets sold, ` +
    `pool ${formatRLO(s.pool)} RLO.`
  );
}

/**
 * The six grid areas, as a fragment. Use this when the container is not the default link: the
 * board wraps it in `<RowLink>`, which is the `<a>` and which owns the strip.
 *
 * DOM order does not fix visual order here. `.row` places every child by `grid-area`, so a
 * container that appends `.a-strip` after these five still gets the strip in the fourth column.
 */
export function RaffleRowCells({ raffle, mini = false, countdown, strip }: RaffleRowProps) {
  const s = summarize(raffle);
  const live = isLive(raffle);

  return (
    <>
      {/* Width 87 at 11px, the serial instance. The size is inline rather than `text-label`
          because `text-label` also carries the 0.14em label tracking and would overwrite the
          serial's own 0.06em: both are utilities and `text-label` is emitted second. */}
      <span className="a-serial serial" style={{ fontSize: "var(--text-label)" }}>
        {serialOf(raffle)}
      </span>

      <span className="a-title">
        <b>{raffle.config.title}</b>
        <span className="label text-fg-3">
          <span className="whitespace-nowrap">
            {s.sold} of {raffle.config.supply} sold
          </span>
          {s.revealed > 0 ? (
            <>
              {" "}
              <span className="whitespace-nowrap">{"·"} {s.revealed} revealed</span>
            </>
          ) : null}
        </span>
      </span>

      <span className="a-phase">
        {/* data-phase, not a colour class: app/cell.css tints the drawn tag with --event and the
            void tag with --fg-3, and both roles already flip inside .inv. */}
        <span className="phase-tag label" data-phase={raffle.phase}>
          {PHASE_WORD[raffle.phase]}
        </span>
      </span>

      <span className="a-strip">
        {strip ?? <Strip raffle={raffle} scale={mini ? "mini" : undefined} />}
      </span>

      <span className="a-pool">
        <span className="figure text-sm">{formatRLO(s.pool)}</span>{" "}
        <span className="label text-fg-3">RLO</span>
      </span>

      {/* The reservation sits on the grid cell, and the cell carries the mono face, so the 8ch
          resolves against the figure's own advance width. Raffle 0001 reads `3d 03h` now and
          crosses to `HH:MM:SS` after about 27 hours of an open tab; without this the narrow
          layout's auto column would move the moment it does. */}
      <span className="a-count figure text-sm" style={COUNTDOWN_RESERVE}>
        {countdown ??
          (live ? null : (
            <span className="text-fg-3">{utcShort(raffle.config.revealDeadline)}</span>
          ))}
      </span>
    </>
  );
}

/**
 * The whole row, as a link to the raffle. This is the landing miniboard's row and the shape any
 * plain list of raffles wants.
 *
 * It is a link and not a div because the row's open gesture is real: `.row:hover` translates it
 * and magnifies its strip, and a surface that moves under the pointer and then does nothing is a
 * lie about the affordance.
 *
 * It is a plain `<Link>` rather than `<RowLink>` on purpose, and the reason is not the view
 * transition name (`<RowLink>` only names one when its strip is wrapped in `<NamedStrip>`). It is
 * the scroll. `<RowLink>` takes `scroll={false}` and writes the current `scrollY` into
 * lib/nav-memory so that the back link can put the board back where it was. A landing row writing
 * the landing's own offset into that store would hand /raffles a scroll position from a different
 * document. Leaving the board's navigation to the board keeps one owner for that, which is the
 * only way the return trip can be reasoned about.
 */
export function RaffleRow(props: RaffleRowProps) {
  const { raffle, mini = false } = props;

  return (
    <Link
      href={`/raffle/${raffle.config.id}`}
      aria-label={rowLabel(raffle)}
      {...rowContainerProps(raffle, mini)}
    >
      <RaffleRowCells {...props} />
    </Link>
  );
}
