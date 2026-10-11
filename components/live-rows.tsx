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
 * THE ROWS ARRIVE ONCE, AND ONLY ON A COLD LOAD. The list's wrapper is server-rendered with
 * data-enter="cold", which app/cell.css turns into the rows rising in one after another from the
 * very first paint, with no script needed. A client render (every soft navigation, and above all
 * the return trip from a raffle page) renders no attribute, so a row the reader is coming back to
 * is at rest in the first frame. The attribute is removed once the entry has finished, by DOM
 * rather than by React, because a reorder moves the row elements and a moved element whose rule
 * still matched would play its entry again. The reasons are written out beside the rule in
 * app/cell.css.
 *
 * THE LIGHT UNDER THE POINTER is one delegated listener per list, here, on a fine pointer only:
 * it writes --mx and --my on the row under the pointer and app/cell.css paints the pool.
 *
 * CONTRAST, COMPUTED (WCAG 2.x relative luminance, 0.03928 knee,
 * L = 0.2126R + 0.7152G + 0.0722B, sanity-checked at #ffffff on #000000 = 21.00):
 *
 *   resting button   --fg / --panel        16.38    text
 *   resting boundary --bound / --panel      3.97    boundary, needs 3:1
 *   hovered button   --fg / --panel-2      15.06    text
 *   pressed button   wine on the paper ramp 15.80 at the top stop, 12.29 at the bottom
 *   group label      --fg-3 / --panel       5.58    text
 *
 * The pressed state is a fill rather than a tint, the paper `cta` against an empty pill, so which
 * order the board is in survives a greyscale print and does not depend on the hue at all.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
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

/*
  THE COLD-LOAD MARK, rendered on the server and on no client render.

  It is the one place in the board where the server and the first client render disagree, and it
  is deliberate: the HTML has to carry the mark so the entry can run from the first paint, and the
  browser's own render must not, so a soft navigation never plays it. `suppressHydrationWarning`
  on the wrapper covers exactly that one attribute; React leaves a hydrated attribute it was not
  told about where it is, and since its prop is undefined on every client render it never touches
  it again. useEnterCleanup below removes it.
*/
function coldMark(): "cold" | undefined {
  return typeof window === "undefined" ? "cold" : undefined;
}

/**
 * Take the cold-load mark off once every entry animation inside the list has finished, so a later
 * reorder, which moves row elements, cannot replay the entry on the rows it moves.
 */
function useEnterCleanup(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !el.hasAttribute("data-enter")) return;
    let alive = true;
    const running = el.getAnimations({ subtree: true }).map((a) => a.finished);
    void Promise.allSettled(running).then(() => {
      if (alive) el.removeAttribute("data-enter");
    });
    return () => {
      alive = false;
    };
  }, [ref]);
}

/**
 * THE LIGHT UNDER THE POINTER: one delegated listener for a whole list of rows.
 *
 * It writes --mx and --my, in the hovered row's own pixels, on that row; app/cell.css paints a soft
 * apricot pool there under the text. A mouse or a pen on a fine pointer only, at most once a frame,
 * and nothing else: no state, no re-render, and no listener per row. The row is measured as it is
 * drawn, translated 4px and all, which is the box the pool is painted in.
 *
 * Exported for components/chain-list.tsx, whose rows are the same object.
 */
export function useRowLight(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0;
    let last: PointerEvent | null = null;

    const paint = () => {
      frame = 0;
      const e = last;
      if (e === null || !(e.target instanceof Element)) return;
      const row = e.target.closest<HTMLElement>(".row");
      if (row === null || !el.contains(row)) return;
      const box = row.getBoundingClientRect();
      row.style.setProperty("--mx", `${Math.round(e.clientX - box.left)}px`);
      row.style.setProperty("--my", `${Math.round(e.clientY - box.top)}px`);
    };

    const move = (e: PointerEvent) => {
      if ((e.pointerType !== "mouse" && e.pointerType !== "pen") || !fine.matches) return;
      last = e;
      if (frame === 0) frame = window.requestAnimationFrame(paint);
    };

    el.addEventListener("pointermove", move, { passive: true });
    return () => {
      el.removeEventListener("pointermove", move);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [ref]);
}

/**
 * A list of rows that is not sorted: the record. The same wrapper the floor uses, so it carries the
 * cold-load entry and the light under the pointer, and nothing else.
 */
export function Rows({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEnterCleanup(ref);
  useRowLight(ref);

  return (
    <div ref={ref} className="rows" data-enter={coldMark()} suppressHydrationWarning>
      {children}
    </div>
  );
}

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
  const list = useRef<HTMLDivElement>(null);
  useEnterCleanup(list);
  useRowLight(list);

  const shown = order(rows, by);

  /*
    The stagger is worked out here rather than in a render pass, because it is a fact about one
    transition between two orders and not about the order the list is currently in. Computing it
    while rendering would need the previous order kept in a ref and mutated mid-render, which
    React's double invocation in development quietly turns into a list of zeroes.
  */
  function pick(next: SortKey) {
    if (next === by) return;

    // A reader who sorts before the rows have finished arriving gets them at rest at once: the
    // reorder is about to move the elements, and a moved row must not start its entry again.
    list.current?.removeAttribute("data-enter");

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
              className="label rounded-pill border border-bound bg-panel px-3.5 py-2.5 text-fg transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--t-open)] ease-settle hover:bg-panel-2 aria-pressed:cta"
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
          right, and a transform's overflow reaches the document. See app/cell.css. The entry
          and the light are this wrapper's, never the motion.div's: the reorder below writes that
          element's transform, and the entry's lives on the row inside it. */}
      <div ref={list} className="rows" data-enter={coldMark()} suppressHydrationWarning>
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
