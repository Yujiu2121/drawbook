"use client";

/**
 * THE SORT CONTROL, AND THE ONLY CLIENT CODE ON /raffles.
 *
 * The board that this replaces was a Client Component from its first line to its last, and its own
 * header comment named the single reason: the row's rise was a spring, and a spring needs a
 * hovered state in React to animate between. That spring is now two CSS transforms in
 * app/cell.css, so the whole board went back to the server and exactly one thing was left that a
 * server cannot do: reordering a list because somebody asked for a different order.
 *
 * WHAT CROSSES THE BOUNDARY, AND WHAT DELIBERATELY DOES NOT
 * Each row arrives as `node`, a ReactNode the server already rendered, plus three primitives to
 * sort it by. A `Raffle` is never passed: it carries its whole ticket table, every commitment and
 * every nonce, and handing three of them to this island would ship all of that into the browser so
 * that a button could compare two numbers. The rows themselves stay server markup; this file only
 * decides what order they are in.
 *
 * THE REORDER IS THE ONE PLACE IN THIS PRODUCT WHERE FLIP IS THE RIGHT TOOL.
 * Everywhere else a list changes because the route changed, and a route change is a view
 * transition. Here the document does not change at all: the same five elements are still on the
 * page and only their positions differ, which is exactly the case `layout` was built for. Motion
 * measures each row before and after the commit and animates the delta back to zero, so nothing
 * reflows and nothing repaints beyond one composited transform per row.
 *
 * THE STAGGER IS COMPUTED FROM THE MOVE, NOT FROM THE INDEX.
 * `delay = 40ms x (1 - |d| / max)`, where `d` is how many places a row travels. The row that moves
 * furthest starts immediately and the rows that barely move start last, so the set arrives
 * together rather than sweeping from the top. `d` is counted in places rather than in pixels
 * because every row on this board is one line of the same grid, so places and pixels are the same
 * measurement, and places are the one the server and the client agree on without a read.
 *
 * REDUCED MOTION REMOVES IT RATHER THAN SHORTENING IT. `layout` is switched off entirely, so the
 * rows are simply in their new order on the next frame. A 320ms version of a movement somebody
 * asked not to see is still the movement.
 *
 * CONTRAST, COMPUTED (WCAG 2.x relative luminance, 0.03928 knee,
 * L = 0.2126R + 0.7152G + 0.0722B, sanity-checked at #ffffff on #000000 = 21.00):
 *
 *   resting button   --fg / --panel        15.01    text
 *   resting boundary --bound / --panel      5.18    boundary, needs 3:1
 *   pressed button   --panel / --fg        15.01    text, the pair inverted
 *   group label      --fg-3 / --panel       5.73    text
 *
 * Nothing here is under 5.18, and the pressed state is a fill rather than a tint, so which button
 * is active survives a greyscale print and does not depend on the hue at all.
 */

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/** The three orders the board offers, and the labels printed on their buttons. */
const ORDERS = [
  { key: "deadline", label: "Deadline" },
  { key: "pool", label: "Pool" },
  { key: "supply", label: "Supply" },
] as const;

export type SortKey = (typeof ORDERS)[number]["key"];

export interface LiveRow {
  /** The raffle id. The animation key, and the only thing that has to be stable across a sort. */
  id: number;
  /** The active deadline as epoch milliseconds. Sorted ascending: soonest to close, first. */
  deadline: number;
  /** The pool in kelvin. Sorted descending: the largest prize, first. */
  pool: number;
  /**
   * How many tickets the raffle has in all. Sorted descending: the largest raffle, first.
   *
   * This used to be the fill fraction under the same "Supply" label, which sorted fullest first.
   * On this record that is exactly the deadline order (the fullest raffles are the ones about to
   * close), so pressing Supply moved nothing and read as a dead button. The word on the button is
   * the field it sorts by now.
   */
  supply: number;
  /** The row itself, rendered on the server. */
  node: ReactNode;
}

/*
  THE ORDER OUTLIVES THE BOARD, FOR THE LENGTH OF ONE VISIT.

  The choice used to live in `useState`, which resets when the page mounts again, so a reader who
  sorted by Pool, opened a row and came Back found the board in Deadline order. Worse, the back
  link restores the scroll the board had in Pool order, so the row they left from could land off
  screen and the return morph had nothing to shrink into.

  It is module memory read through `useSyncExternalStore`: a client navigation remounts the board
  inside the same bundle and its very first render already has the remembered order, so the
  restored scroll and the rows agree before anything paints. The server snapshot is always
  "deadline", which is also the first hydration render, so a cold load cannot mismatch. A reload
  starts over at Deadline on purpose: this is a convenience for one visit, not a preference, and
  nothing is written to storage.
*/
let remembered: SortKey = "deadline";
const sortListeners = new Set<() => void>();

function subscribeSort(onChange: () => void): () => void {
  sortListeners.add(onChange);
  return () => {
    sortListeners.delete(onChange);
  };
}

function setRemembered(next: SortKey): void {
  remembered = next;
  for (const notify of sortListeners) notify();
}

/** 320ms on the settling curve, the same pair app/globals.css publishes as --t-settle. */
const SETTLE = { duration: 0.32, ease: [0.2, 0.8, 0.2, 1] } as const;

/** The furthest-travelling row starts at 0 and the shortest at 40ms. */
const STAGGER_MS = 40;

function order(rows: readonly LiveRow[], by: SortKey): LiveRow[] {
  const sorted = rows.slice();
  if (by === "pool") return sorted.sort((a, b) => b.pool - a.pool || a.deadline - b.deadline);
  if (by === "supply") return sorted.sort((a, b) => b.supply - a.supply || a.deadline - b.deadline);
  return sorted.sort((a, b) => a.deadline - b.deadline);
}

export function LiveRows({ rows, head }: { rows: readonly LiveRow[]; head?: ReactNode }) {
  const reduce = useReducedMotion();
  const by = useSyncExternalStore(
    subscribeSort,
    () => remembered,
    () => "deadline" as SortKey,
  );
  const [delays, setDelays] = useState<Record<number, number>>({});

  const shown = order(rows, by);

  /*
    The stagger is worked out here rather than in a render pass, because it is a fact about one
    transition between two orders and not about the order the list is currently in. Computing it
    while rendering would need the previous order kept in a ref and mutated mid-render, which
    React's double invocation in development quietly turns into a list of zeroes.
  */
  function pick(next: SortKey) {
    if (next === by) return;

    const before = order(rows, by).map((row) => row.id);
    const after = order(rows, next);
    const moves = after.map((row, i) => before.indexOf(row.id) - i);
    const furthest = Math.max(1, ...moves.map(Math.abs));

    const next_delays: Record<number, number> = {};
    after.forEach((row, i) => {
      next_delays[row.id] = (STAGGER_MS * (1 - Math.abs(moves[i]) / furthest)) / 1000;
    });

    setDelays(next_delays);
    setRemembered(next);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 px-gutter pb-3.5">
        <span id="sort-by" className="label text-fg-3 mr-1">
          Sort
        </span>

        {/*
          A group of three toggles rather than a <select>. Every option is one word, all three fit
          on one line at 390, and which order the board is in is worth being able to read without
          opening anything. `aria-pressed` reports the state on each button, and the group takes
          its name from the visible word beside it.
        */}
        <div role="group" aria-labelledby="sort-by" className="flex flex-wrap gap-2.5">
          {ORDERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={by === key}
              onClick={() => pick(key)}
              className="label border border-bound bg-panel px-3.5 py-2.5 text-fg transition-colors duration-[var(--t-open)] ease-settle hover:border-fg hover:bg-fg hover:text-panel aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:text-panel"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* The column header, handed in by the board rather than built here: the header's six words
          belong to the row's grid, which this island does not own, and the board renders the same
          one over the record list. It sits under the sort control, because sorting changes which
          rows are under the header and not what the header says. */}
      {head}

      {/* `.rows` is not optional around any list of rows: an opened row translates 4px to the
          right, and a transform's overflow reaches the document. See app/cell.css. */}
      <div className="rows">
        {shown.map((row) => (
          <motion.div
            key={row.id}
            layout={reduce ? false : "position"}
            transition={{ layout: { ...SETTLE, delay: delays[row.id] ?? 0 } }}
          >
            {row.node}
          </motion.div>
        ))}
      </div>
    </>
  );
}
