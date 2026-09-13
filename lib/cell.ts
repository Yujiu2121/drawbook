/**
 * THE CELL VOCABULARY, AS PURE FUNCTIONS.
 *
 * Sweep / Cell says a raffle is a grid of cells and one cell is the same object at every scale:
 * a 6px sliver in a board row, a band in the landing muster, an 88px square in the ticket sheet,
 * a viewport-scale blade on a detail page. What changes between those scales is geometry, which
 * is CSS. What does not change is which cell means what, which is this file.
 *
 * Three things live here, and they are here rather than in a component because both sides of the
 * React boundary need them:
 *
 *   1. `cellState`, the `data-s` value the cell CSS switches on. A Server Component renders it
 *      into static HTML; a client island re-renders it after a selection.
 *   2. The column counts a sheet and a muster band are laid out on, as `--cols` / `--cols-n`.
 *      The narrow count is applied by a media query in app/cell.css, NOT by a `window.innerWidth`
 *      read, so a 20-cell sheet and a 112-cell muster stay entirely on the server.
 *   3. The countdown format ladder, plus the width the countdown reserves so the row grid does
 *      not move when the ladder changes unit under an open tab.
 *
 * There is deliberately no "use client" directive. Adding one would drag every Server Component
 * that imports a column count across the boundary, which is the failure mode the whole port is
 * arranged to avoid.
 *
 * Nothing in here reads `Date.now()`, touches `window`, or derives a phase, a pool, a commitment
 * or a winner. It is presentation only: a passing second can change how a figure is spelled and
 * nothing else.
 */

import type { Raffle, Ticket } from "./raffle.ts";

/** Two digits, always. Every fixed-width figure in this file goes through it. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/* ------------------------------------------------------------------ the cell */

/**
 * The `data-s` value on a cell.
 *
 * 0 unsold, 1 sold, 2 revealed, 3 winner, 4 refunded.
 *
 * 4 is new in the port and it exists because of a real defect: in the preview a refunded ticket
 * on the void raffle rendered as state 1, so raffle 0005, the one raffle where nothing happened,
 * looked exactly as busy as a raffle mid-sale. A refunded cell is bought, then unbought, and
 * app/cell.css draws it as the sold block struck through by a single hairline.
 */
export type CellState = 0 | 1 | 2 | 3 | 4;

/**
 * One ticket to one cell state.
 *
 * Order matters. Void is tested first because on the void branch nothing was drawn and nothing a
 * holder did afterwards survives: the money went back, so the cell must say so even if a nonce
 * happens to sit on the ticket. Winner is tested before revealed because a winner is by
 * definition revealed and the stronger fact wins the cell.
 *
 * There is no state for "sold but silent while reveals are open", though that stub has a bond at
 * risk and must not read like a sold ticket in a raffle still selling. That distinction is
 * carried by `data-phase` on the sheet, so a cell keeps one meaning per value and the CSS makes
 * the same geometry out of the opposite material: a revealed stub has light at its foot, a silent
 * one has a grey shelf.
 */
export function cellState(raffle: Raffle, ticket: Ticket): CellState {
  if (ticket.holder === null) return 0;
  if (raffle.phase === "void") return 4;
  if (raffle.winningTickets.includes(ticket.index)) return 3;
  return ticket.nonce ? 2 : 1;
}

/** A raffle renders inverted, light on ink, once it has left the floor. */
export function isInverted(raffle: Raffle): boolean {
  return raffle.phase === "drawn" || raffle.phase === "void";
}

/** Still on the floor: something about this raffle can still change. */
export function isLive(raffle: Raffle): boolean {
  return raffle.phase === "selling" || raffle.phase === "revealing";
}

/** The deadline a live raffle is counting toward. Selling counts to the commit close, everything after it to the reveal close. */
export function activeDeadline(raffle: Raffle): string {
  return raffle.phase === "selling"
    ? raffle.config.commitDeadline
    : raffle.config.revealDeadline;
}

/**
 * The four-digit serial. Printed on rows, sheets, blades and payloads, so it has exactly one
 * definition: the app had three copies of this and they are collapsed here rather than in
 * lib/raffle.ts only because raffle.ts belongs to another hand this pass.
 */
export function serialOf(raffle: Raffle | number): string {
  const id = typeof raffle === "number" ? raffle : raffle.config.id;
  return String(id).padStart(4, "0");
}

/* --------------------------------------------------------------- the columns */

/**
 * The one breakpoint the cell grids switch on, in px. The preview read `window.innerWidth < 760`
 * in JS; the port turns that into a media query so the count is decided before any JS runs and
 * the server's HTML is already correct at both widths.
 *
 * app/cell.css must use exactly this number:
 *
 *   .sheet, .mband { grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); }
 *   @media (max-width: 759px) {
 *     .sheet, .mband { grid-template-columns: repeat(var(--cols-n), minmax(0, 1fr)); }
 *   }
 */
export const NARROW_MAX_PX = 759;

/** A wide and a narrow column count for one grid. Both are emitted at once, and CSS picks. */
export interface Columns {
  /** Columns at >= 760px, the `--cols` custom property. */
  wide: number;
  /** Columns at <= 759px, the `--cols-n` custom property. */
  narrow: number;
}

/**
 * The widest column count at most `max` that divides `supply` exactly and still leaves at least
 * `minRows` rows.
 *
 * Divisors, because a ragged last row would make the cell size a lie: the muster claims every
 * ticket in Drawbook as one solid rectangle, and a band with four empty slots on its bottom row
 * reads as four unsold tickets that do not exist. `minRows` is what stops a 12-cell raffle
 * collapsing to a single line where a 40-cell one gets four, which would make the cell size a
 * fact about nothing.
 *
 * The search floor is half of `max`, because 1 divides everything and a one-column sheet of 13
 * cells is a far worse answer than a tidy two-row grid with three empty slots. A supply with no
 * divisor in that window (a prime, say) falls back to exactly `minRows` rows and accepts the
 * ragged edge. No supply in MOCK_RAFFLES takes that branch: all five land on a divisor.
 */
function gridColumns(supply: number, max: number, minRows: number): number {
  const floor = Math.ceil(max / 2);
  for (let d = Math.min(max, supply); d >= floor; d--) {
    if (supply % d === 0 && supply / d >= minRows) return d;
  }
  return Math.min(max, Math.max(1, Math.ceil(supply / minRows)));
}

/**
 * The ticket sheet: the 88px cell, the one a reader can point at.
 *
 * Wide caps at 12 columns so a cell never shrinks below the size its index number needs, and
 * asks for two rows minimum so the sheet reads as a sheet and not as a strip. Narrow caps at 6
 * and asks for three rows, which is what keeps a 390px cell square and tappable.
 *
 * Over MOCK_RAFFLES this reproduces the approved preview exactly:
 *   supply 40 -> 10 / 5, 24 -> 12 / 6, 20 -> 10 / 5, 16 -> 8 / 4, 12 -> 6 / 4.
 */
export function sheetColumns(supply: number): Columns {
  return {
    wide: gridColumns(supply, 12, 2),
    narrow: gridColumns(supply, 6, 3),
  };
}

/**
 * The landing muster: every ticket in Drawbook at viewport scale, one band per raffle, edge to
 * edge. The band is wider than a sheet and its cells are smaller, so the cap is 20 and one row
 * is allowed: a 16-ticket raffle is a single line of 16 and that is the point, the band height
 * is a fact about supply.
 *
 * Over MOCK_RAFFLES: 40 -> 20 / 10, 24 -> 12 / 6, 20 -> 20 / 10, 16 -> 16 / 8, 12 -> 12 / 6.
 */
export function musterColumns(supply: number): Columns {
  const wide = gridColumns(supply, 20, 1);
  // Halving keeps a band's narrow layout a clean stack of its wide one: every band doubles its
  // row count at the same breakpoint, so the muster stays a rectangle instead of reshuffling.
  const half = wide / 2;
  const narrow = Number.isInteger(half) && supply % half === 0 ? half : gridColumns(supply, 10, 1);
  return { wide, narrow };
}

/** Rows a grid of `supply` cells takes at `cols` columns. The muster band flexes on this. */
export function rowsFor(supply: number, cols: number): number {
  return Math.ceil(supply / cols);
}

/**
 * The custom properties a sheet carries. Both counts are emitted; app/cell.css switches between
 * them in a `@media (max-width: 759px)` block, so the server ships one HTML for both widths and
 * no layout depends on a measurement that only exists in a browser.
 *
 * Returned as a plain record of strings. A caller spreads it into `style` with a cast, because
 * React's CSSProperties does not admit custom properties without one.
 */
export function sheetVars(supply: number): Record<string, string> {
  const { wide, narrow } = sheetColumns(supply);
  return {
    "--cols": String(wide),
    "--cols-n": String(narrow),
    "--n": String(supply),
  };
}

/** The same for a muster band, plus the row counts the band's flex ratio is sized on. */
export function musterVars(supply: number): Record<string, string> {
  const { wide, narrow } = musterColumns(supply);
  return {
    "--cols": String(wide),
    "--cols-n": String(narrow),
    "--rows": String(rowsFor(supply, wide)),
    "--rows-n": String(rowsFor(supply, narrow)),
    "--n": String(supply),
  };
}

/* -------------------------------------------------------------- the countdown */

/** An hour out. The only clock reading in the system allowed to take the ceremonial hue. */
export const FINAL_HOUR_SECONDS = 3600;

/** Two days out. Above this the ladder drops seconds entirely. */
export const COARSE_SECONDS = 172_800;

/**
 * Which rung of the ladder a figure is on. The monument reads this to decide whether to fire its
 * alarm size and swap its eyebrow, and it fires on the rung change alone, never on a tick.
 */
export type CountdownTier = "closed" | "coarse" | "clock" | "final";

export function countdownTier(seconds: number): CountdownTier {
  if (seconds <= 0) return "closed";
  if (seconds >= COARSE_SECONDS) return "coarse";
  if (seconds >= FINAL_HOUR_SECONDS) return "clock";
  return "final";
}

/**
 * THE FORMAT LADDER. Six glyphs over 48 hours, eight under it, five in the final hour.
 *
 * The ladder exists because precision is a claim. Three days out, a seconds figure claims the
 * deadline is known to the second and invites a reader to watch it; inside the hour, the seconds
 * are the whole message. The rungs are:
 *
 *   >= 48h   `3d 03h`     6 glyphs
 *   >= 1h    `27:14:02`   8 glyphs
 *   > 0      `59:04`      5 glyphs
 *   <= 0     `closed`     6 glyphs
 *
 * Padded, so every rung is fixed width in a tabular face and a digit rolling from 9 to 10 moves
 * nothing. `seconds` is whole seconds remaining; a caller clamps at zero on its own side too.
 */
export function countdownLadder(seconds: number): string {
  if (seconds <= 0) return "closed";
  if (seconds >= COARSE_SECONDS) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3600);
    return `${days}d ${pad2(hours)}h`;
  }
  if (seconds >= FINAL_HOUR_SECONDS) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds % 60)}`;
  }
  return `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`;
}

/**
 * THE RESERVED WIDTH, IN `ch`.
 *
 * The ladder changes width under a tab that stays open: raffle 0001 reads `3d 03h` and crosses to
 * `HH:MM:SS` after about 27 hours, two glyphs wider. On the board that figure is the last column
 * of a grid, and on a detail page it is the monument, so an unreserved width would shunt a whole
 * row sideways or reflow a heading at the moment a reader is watching it. Eight covers every rung
 * including `closed`, and stays correct past a hundred days (`100d 03h`).
 *
 * `ch` rather than `px` because both sites set the figure in Martian Mono at different sizes, and
 * the reservation has to scale with the face rather than with a guess.
 */
export const COUNTDOWN_CH = 8;

/** `"8ch"`, ready for a `min-width`. Use `min-width`, not `width`: a right-aligned column should still be allowed to grow, never to shrink. */
export const COUNTDOWN_WIDTH = `${COUNTDOWN_CH}ch`;

/**
 * The reservation, ready to spread into a `style` prop on whatever element holds the figure:
 *
 *   <span className="cd" style={COUNTDOWN_RESERVE}>{countdownLadder(left)}</span>
 *
 * It is an export rather than three characters typed at each site because there are two sites,
 * they are owned by different files, and half-doing it is invisible until a tab has been open
 * for 27 hours. `fontVariantNumeric` rides along: the reservation is only true in a tabular face,
 * since a proportional `1` is narrower than a proportional `8` and eight glyphs would then be a
 * different width on every tick.
 */
export const COUNTDOWN_RESERVE = {
  minWidth: COUNTDOWN_WIDTH,
  fontVariantNumeric: "tabular-nums",
} as const;

/* ------------------------------------------------------------- the dead stamp */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The absolute instant, for a raffle that has stopped moving.
 *
 * A drawn or void raffle subscribes to no clock and renders this instead of a countdown: dead
 * still, because it is. UTC and never a locale, for two reasons. A locale-formatted date is
 * formatted against the machine's own zone, so the server would render one string and the
 * browser would hydrate a different one and React would warn. And the record is evidence: an
 * auditor quoting a draw time has to be quoting the same instant as everyone else reading it.
 */
export function utcStamp(iso: string): string {
  const d = new Date(iso);
  return (
    `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`
  );
}

/** The same instant for a dense column: `30 Jul 09:00`. */
export function utcShort(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
