/**
 * Reference surfaces.
 *
 * In Counterfoil the eye is supposed to go to the card stock, so everything that is merely true
 * rather than the subject lives on a plate: raffle facts, the activity log, form fields, the
 * fairness working. Plates are deliberately quiet. A plate that competes with a ticket has failed.
 *
 * The depth cue is one hairline of light along the top edge plus a wide ambient shadow, applied by
 * the `.plate` class. That is an object lit from above by the one lamp this room actually has.
 */

import type { CSSProperties, ReactNode } from "react";

export function Plate({
  label,
  children,
  right,
  index = 0,
  className = "",
}: {
  label: string;
  children: ReactNode;
  /** Optional figure or status pinned to the right of the label row. */
  right?: ReactNode;
  /** Position in the stack, so surfaces arrive in reading order rather than all at once. */
  index?: number;
  className?: string;
}) {
  return (
    <section
      className={`plate surface-in border border-line ${className}`}
      style={{ "--index": index } as CSSProperties}
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-line px-5 py-3">
        <span className="label">{label}</span>
        {right && <span className="tnum text-xs text-text-3">{right}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * The one number a plate is about, for reference contexts.
 *
 * The prize pool of a live raffle is NOT this: it is struck on the raffle's own ticket, because the
 * figure that matters most belongs on the object, not on the furniture around it.
 */
export function PlateFigure({
  value,
  unit,
  caption,
}: {
  value: string;
  unit?: string;
  caption?: string;
}) {
  return (
    <div className="px-5 py-10 text-center">
      <div className="board-figure text-[2.75rem] leading-none">{value}</div>
      {unit && <div className="label mt-4">{unit}</div>}
      {caption && <div className="mt-2 text-sm text-text-2">{caption}</div>}
    </div>
  );
}

/**
 * What a ticket is, at a glance.
 *
 * `mine` is ivory rather than coloured, deliberately. A stub is yours by possession, so the mark
 * for it is the material itself: your tickets are the only card stock in the row. The signal hue is
 * reserved for the ceremonial register, which here means a winner and nothing else, so the colour
 * that says "you won" can never be mistaken for the colour that says "this one is yours".
 */
export type PunchState = "open" | "sold" | "revealed" | "mine" | "won";

const PUNCH: Record<PunchState, string> = {
  open: "border border-line-2 bg-transparent",
  sold: "bg-line-2",
  revealed: "bg-text-2",
  mine: "bg-stock",
  won: "bg-signal-bright",
};

const PUNCH_WORD: Record<PunchState, string> = {
  open: "unsold",
  sold: "committed",
  revealed: "revealed",
  mine: "yours",
  won: "winner",
};

/**
 * The sheet, punched.
 *
 * This replaces a percentage bar, and the replacement is the point: a bar says how full a raffle is
 * and nothing else, while a punched sheet says which tickets are gone, which holders have revealed,
 * which are yours, and, once it has settled, which one won. The mechanism becomes visible without
 * anybody opening the docs.
 */
export function PunchSheet({
  states,
  label,
  note,
}: {
  states: PunchState[];
  label: string;
  note?: string;
}) {
  const sold = states.filter((s) => s !== "open").length;
  // Only the states actually present, in a fixed reading order rather than first-seen order, so
  // the legend does not reshuffle itself between two raffles that hold the same kinds of ticket.
  const present = new Set(states);
  const legend = (["open", "sold", "revealed", "mine", "won"] as PunchState[]).filter((s) =>
    present.has(s),
  );

  return (
    <div className="px-5 py-5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-text-2">{label}</span>
        <span className="tnum text-lg">
          <span className="text-text">{sold}</span>
          <span className="text-text-3"> / {states.length}</span>
        </span>
      </div>

      <div
        className="mt-4 flex flex-wrap gap-1.5"
        role="img"
        aria-label={`${sold} of ${states.length} tickets taken`}
      >
        {states.map((state, i) => (
          <span
            key={i}
            title={`Ticket ${String(i + 1).padStart(4, "0")}, ${PUNCH_WORD[state]}`}
            className={`block h-2.5 w-2.5 rounded-full ${PUNCH[state]}`}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {legend.map((state) => (
          <span key={state} className="label flex items-center gap-1.5">
            <span className={`block h-2 w-2 rounded-full ${PUNCH[state]}`} aria-hidden="true" />
            {PUNCH_WORD[state]}
          </span>
        ))}
      </div>

      {note && <p className="mt-4 text-xs text-text-3">{note}</p>}
    </div>
  );
}
