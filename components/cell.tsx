/**
 * THE CELL, AT FOUR SCALES.
 *
 * Sweep / Cell rests on one claim: a raffle is a grid of cells, and one cell is the same object
 * wherever you meet it. A 10px sliver inside a board row, a band of the landing muster, an
 * 88px square in a ticket bed, a viewport-scale blade on a detail page. Only the geometry
 * changes, and geometry is app/cell.css. What does not change is which cell means what, which
 * is lib/cell.ts. This file is the third piece: the markup, emitted once so that no route
 * writes its own cells and then drifts.
 *
 * EVERYTHING HERE IS A SERVER COMPONENT. There is no client directive in this file and there
 * must never be one: a strip of 40 cells, a bed of 24 and a field of 112 are the largest pieces of
 * markup in the app, and they are all pure functions of MOCK_RAFFLES. They ship as HTML.
 * Interaction is added around them by small islands (components/row-link.tsx for the board,
 * app/raffle/[id]/counter.tsx for the ticket bed, the landing's own island for the muster),
 * never inside them.
 *
 * NOTHING HERE IS NAMED FOR A VIEW TRANSITION.
 * A transition name may appear in exactly two files in this app, components/row-link.tsx and
 * app/raffle/[id]/page.tsx, and the reason is measured rather than stylistic. The design this
 * ports flies every cell individually: 201 named view-transition groups put `transition.ready`
 * at 220ms and collected one animation frame in two seconds, because snapshotting each named
 * element blocks the main thread. A transition in this app therefore carries EXACTLY ONE named
 * element: the strip on the board, growing into the blade on the route it opens. One name per
 * navigation, no matter how many cells are inside the box that moves.
 *
 * The names in this file are the names of those two greps, spelled around rather than out: the
 * final sweep counts the files that mention them and a comment would read as a third call site.
 *
 * THE DATA IS NEVER EMBEDDED. Every figure, state and label below is derived at render time
 * from lib/raffle.ts and whatever raffle the caller hands in. There is no local copy of a
 * ticket list anywhere in this file, which is what makes a unit bug or a stale preimage
 * impossible here rather than merely absent.
 *
 * CALL SITES
 *
 *   <Strip raffle={r} />                     inside a board row (components/row.tsx)
 *   <Strip raffle={r} scale="mini" />        inside the landing miniboard
 *   <Blade raffle={r} />                     the detail route's hero (app/raffle/[id]/page.tsx)
 *   <Sheet raffle={r} />                     the ticket bed, read-only
 *   <Sheet raffle={r} interactive mine={…} selected={…} />   the bed inside the counter island
 *   <div className="muster"><MusterBands raffles={MOCK_RAFFLES} /></div>
 *
 * MusterBands emits the bands and nothing else. The `.muster` element around them belongs to
 * the landing's island, which needs a ref on it to arm and release the opening, and a Server
 * Component cannot hold that ref.
 */

import Link from "next/link";
import type { CSSProperties } from "react";

import { cellState, musterColumns, musterVars, rowsFor, serialOf, sheetVars } from "@/lib/cell";
import { summarize, type Phase, type Raffle, type Ticket } from "@/lib/raffle";

/* ----------------------------------------------------------------------- words */

/** The phase, as it is printed and as it is announced. One definition, four values. */
export const PHASE_WORD: Record<Phase, string> = {
  selling: "Selling",
  revealing: "Revealing",
  drawn: "Drawn",
  void: "Void",
};

/**
 * What one cell means, in words, for the cells that are real controls.
 *
 * These are the five `data-s` values of lib/cell.ts spelled out. State 1 is deliberately not
 * just "sold": a sold ticket whose holder has not revealed has a bond at risk, and "sold" alone
 * would hide the only fact about it that can still change.
 */
const STATE_WORD = [
  "unsold",
  "sold, not yet revealed",
  "revealed",
  "winner",
  "refunded",
] as const;

/** Two digits on a ticket serial, so a bed of forty reads as one column of figures. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The accessible name for a whole field of cells.
 *
 * A strip, a blade and a read-only bed are one image of a raffle's state, not forty controls,
 * so each is `role="img"` with this sentence on it. Announcing forty empty elements is the
 * failure this avoids, and it is a real one: the field is the largest thing on three routes.
 */
function fieldLabel(raffle: Raffle): string {
  const { sold, revealed } = summarize(raffle);
  const parts = [`${sold} of ${raffle.config.supply} tickets sold`];

  if (raffle.phase === "void") {
    parts.push("all refunded");
  } else {
    if (revealed > 0) parts.push(`${revealed} revealed`);
    if (raffle.winningTickets.length > 0) parts.push(`${raffle.winningTickets.length} drawn`);
  }

  return parts.join(", ");
}

/* ------------------------------------------------------------------- the strip */

/**
 * SCALE ONE. Every ticket in a raffle as a sliver in a board row.
 *
 * A `<span>` rather than a `<div>` because the row is an `<a>` and the landing's miniboard rows
 * sit inside links too: phrasing content nests legally in both, and `.strip` sets `display:
 * grid` regardless. The cells are `<i>` for the same reason, and because a cell is a mark
 * rather than a section.
 *
 * This element is the one the board names `cell-${id}` for the route morph, in
 * components/row-link.tsx. It is the
 * source rectangle of that morph, so nothing inside it is sized by its content: if a
 * webfont settled late and moved this box by a pixel, the morph would start from a rectangle
 * that no longer exists.
 */
export function Strip({
  raffle,
  scale,
}: {
  raffle: Raffle;
  /** `mini` is the 6px mark used by the landing miniboard, where the strip is a sign, not a meter. */
  scale?: "mini";
}) {
  return (
    <span
      className="strip"
      data-scale={scale}
      role="img"
      aria-label={fieldLabel(raffle)}
      style={{ "--n": String(raffle.config.supply) } as CSSProperties}
    >
      {raffle.tickets.map((ticket) => (
        <i key={ticket.index} className="c" data-s={cellState(raffle, ticket)} data-i={ticket.index} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------- the blade */

/**
 * SCALE THREE. The strip at viewport scale, and the destination of the route morph.
 *
 * Same geometry as the strip on purpose: one row, column flow, equal columns. The browser then
 * interpolates a box whose interior layout already agrees at both ends, so the cells scale
 * instead of reflowing, and the moving box carries no text of its own to smear.
 *
 * The `cell-${id}` name goes around this in app/raffle/[id]/page.tsx, in that route's
 * synchronous shell. It is not applied here, because a component cannot know whether it is the
 * page's one named element or a second copy of it, and two identical names on one page silently
 * resolve to one instance with no warning to find it by.
 */
export function Blade({ raffle }: { raffle: Raffle }) {
  return (
    <div
      className="blade"
      role="img"
      aria-label={fieldLabel(raffle)}
      style={{ "--n": String(raffle.config.supply) } as CSSProperties}
    >
      {raffle.tickets.map((ticket) => (
        <i key={ticket.index} className="c" data-s={cellState(raffle, ticket)} data-i={ticket.index} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- the sheet */

export interface SheetProps {
  raffle: Raffle;
  /**
   * Ticket indices to ring as held by the reader. The caller decides what "held" means and says
   * so in its own copy: this component will not guess, because the mock viewer's tickets and a
   * connected wallet's tickets are different claims and only one of them can be called yours.
   */
  mine?: Iterable<number>;
  /** The ticket an adjacent panel is currently describing. */
  selected?: number | null;
  /**
   * Emit a real `<button>` filling each cell. Off by default: a bed with no island around it is
   * an image, and a control that does nothing is worse than no control.
   *
   * The buttons carry no handler, because this is a Server Component. They carry
   * `data-ticket="N"`, and the client island that renders this bed as `children` listens once on
   * its own wrapper and reads `event.target.closest("button[data-ticket]")`. One listener, forty
   * controls, and the bed is still static HTML.
   */
  interactive?: boolean;
}

/**
 * SCALE TWO. The ticket bed: one square cell per ticket, carrying its serial.
 *
 * `--cols` and `--cols-n` are written here as inline custom properties and switched by the media
 * query at the foot of app/cell.css. The design this ports read `window.innerWidth` to pick
 * between them; that read was really a media query, and turning it back into one is what keeps a
 * 24-cell bed on the server with no hydration seam and no layout shift at 390px.
 *
 * Both counts divide the supply exactly, so the bed is always a full rectangle. A ragged last
 * row would read as unsold tickets that do not exist.
 */
export function Sheet({ raffle, mine, selected = null, interactive = false }: SheetProps) {
  const held = mine ? new Set(mine) : null;

  return (
    <div
      className="sheet"
      style={sheetVars(raffle.config.supply) as CSSProperties}
      /* The phase, so the bed can tell a silent stub in an open reveal window from a sold ticket
         in a raffle that is still selling. Same cell value, different fact. */
      data-phase={raffle.phase}
      {...(interactive
        ? {
            role: "group",
            /* The summary leads, so a reader meets the state of the raffle before its forty
               controls rather than after them. */
            "aria-label": `Tickets in raffle ${serialOf(raffle)}: ${fieldLabel(raffle)}`,
          }
        : { role: "img", "aria-label": fieldLabel(raffle) })}
    >
      {raffle.tickets.map((ticket) => (
        <SheetCell
          key={ticket.index}
          raffle={raffle}
          ticket={ticket}
          mine={held?.has(ticket.index) ?? false}
          selected={selected === ticket.index}
          interactive={interactive}
        />
      ))}
    </div>
  );
}

function SheetCell({
  raffle,
  ticket,
  mine,
  selected,
  interactive,
}: {
  raffle: Raffle;
  ticket: Ticket;
  mine: boolean;
  selected: boolean;
  interactive: boolean;
}) {
  const state = cellState(raffle, ticket);

  return (
    <div
      className="c"
      data-s={state}
      data-i={ticket.index}
      data-mine={mine ? "1" : undefined}
      data-selected={selected ? "1" : undefined}
    >
      {/* Absolutely positioned by app/cell.css, so the serial contributes nothing to the cell's
          size and a cell stays square whatever is printed on it. */}
      <em>{pad2(ticket.index)}</em>
      {interactive && (
        <button
          type="button"
          data-ticket={ticket.index}
          /* `aria-current`, not `aria-pressed`: the bed has one current ticket out of forty, and a
             toggle role would announce "not pressed" on every other cell in the raffle. */
          aria-current={selected ? "true" : undefined}
          aria-label={`Ticket ${pad2(ticket.index)}, ${STATE_WORD[state]}`}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the muster */

/**
 * SCALE FOUR. Every ticket in Drawbook, edge to edge, one band per raffle.
 *
 * A band is a real link to its raffle, not a box with a click handler bolted on. Three things
 * follow from that and all three are the point: the field works with no JavaScript at all, a
 * middle click opens a raffle in a new tab, and a screen reader meets five named destinations
 * instead of 112 anonymous marks.
 *
 * The link declares no transition type. Direction-aware choreography belongs to the board,
 * whose rows are the app's one designated morph source; a band is a different object at a
 * different scale and naming it too would put two `cell-N` names on one document.
 *
 * THE OPENING IS OPT-IN. The cells below are visible in the HTML and stay visible if no script
 * runs. The landing's island arms the field by setting `data-run="armed"` on the `.muster`
 * element before paint, which folds every cell to `scaleX(0)`, then clears it on the next frame,
 * which releases them along the `--cell-delay` written here. A field that started folded in the
 * stylesheet would be a blank hero for anyone whose island never ran.
 */
export function MusterBands({ raffles }: { raffles: readonly Raffle[] }) {
  return (
    <>
      {raffles.map((raffle) => (
        <MusterBand key={raffle.config.id} raffle={raffle} />
      ))}
    </>
  );
}

/** Column by column, 22ms apart: the sweep that gives the opening its direction. */
const COLUMN_STEP_MS = 22;

function MusterBand({ raffle }: { raffle: Raffle }) {
  const { config, tickets } = raffle;
  const { wide, narrow } = musterColumns(config.supply);
  const { sold } = summarize(raffle);

  const style = {
    ...musterVars(config.supply),
    /* The band's share of the field is its row count, so a cell is the same size in every band
       and the height of a band is a fact about supply. `--fr-n` is the same number at the narrow
       column count; see the note in the port report about the media query it still needs. */
    "--fr": String(rowsFor(config.supply, wide)),
    "--fr-n": String(rowsFor(config.supply, narrow)),
  } as CSSProperties;

  return (
    <Link
      href={`/raffle/${config.id}`}
      className="mband"
      data-rid={config.id}
      style={style}
      aria-label={`${config.title}, raffle ${serialOf(raffle)}, ${sold} of ${config.supply} sold, ${PHASE_WORD[raffle.phase].toLowerCase()}`}
    >
      {tickets.map((ticket, i) => (
        <i
          key={ticket.index}
          className="c"
          data-s={cellState(raffle, ticket)}
          data-i={ticket.index}
          style={
            {
              "--cell-delay": `${(i % wide) * COLUMN_STEP_MS}ms`,
              "--cell-delay-n": `${(i % narrow) * COLUMN_STEP_MS}ms`,
            } as CSSProperties
          }
        />
      ))}
    </Link>
  );
}
