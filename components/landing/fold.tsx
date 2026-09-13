"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * THE FOLD, AND THE ONE CLIENT ISLAND ON THE LANDING.
 *
 * The opening is the reason this direction was chosen, so it is worth stating what it actually
 * is. Every ticket in Drawbook is on the screen as a cell. They sweep in column by column. Then
 * the cells that fall inside the sentence stand aside, and the sentence rises into the channel
 * they open. The headline and the field are one object, and the whole pitch is delivered without
 * a click.
 *
 * WHAT THIS COMPONENT IS ALLOWED TO BE. It holds three refs and a timer. Nothing here renders a
 * cell, a row or a figure: the muster bands, the figure line and the miniboard are all Server
 * Components handed in as props, so the largest markup on the landing ships as HTML and this
 * island only ever adds and removes classes on top of it. That is also why the whole fold is
 * inside it rather than just the field: moving a pointer over a band drives that raffle's row
 * below, and keeping both subtrees under one root means that wiring is delegation on this
 * element rather than a query against the document.
 *
 * THE OPENING IS OPT-IN, WHICH IS THE POINT. app/cell.css renders the field VISIBLE. This island
 * folds it in a layout effect (`data-run="armed"`, which is `scaleX(0)` with no transition),
 * then releases it on the next frame. Anyone whose script never runs gets the field, the
 * sentence and the figures, all present and all still. The cost is stated in the port report:
 * with no script the sentence is not cut out of the field it stands on, so it overlaps the
 * cells behind it.
 *
 * EVERY DURATION HERE IS READ OUT OF THE TOKEN LAYER rather than retyped, because a stagger that
 * disagrees with `--t-blade` by 40ms is invisible in a screenshot and wrong in motion. The two
 * numbers that are NOT tokens are the 22ms column step, which components/cell.tsx writes into
 * each cell as `--cell-delay` and which is repeated here only to know when the sweep ends, and
 * the clearing's own 300ms, which exists nowhere else.
 */

/** Must equal COLUMN_STEP_MS in components/cell.tsx. Used only to time the act that follows. */
const COLUMN_STEP_MS = 22;

/** The clearing: how long one cell takes to stand aside, and how long the wave takes to cross. */
const CLEAR_MS = 300;
const CLEAR_WAVE_MS = 300;

/** The sentence: one word's rise, and the step between words. */
const WORD_MS = 520;
const WORD_STEP_MS = 60;

/** The figure line, which is a fade because a figure that slides is a figure that is hard to read. */
const FIGURE_MS = 320;

/** A beat between the sweep landing and the sentence starting. Without it the two acts overlap. */
const BEAT_MS = 100;

/** `useLayoutEffect` warns when a Client Component is server-rendered, which this one is. */
const useArmEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Read a duration token off an element. `--t-blade` is `260ms`, so `parseFloat` is the whole
 * parser; a token in seconds would need more, and there are none.
 */
function tokenMs(el: Element, name: string, fallback: number): number {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && raw.endsWith("ms") ? n : fallback;
}

export interface MusterProps {
  /** The landing sentence. Split on spaces here, so each word gets its own rise. */
  sentence: string;
  /** `<MusterBands raffles={MOCK_RAFFLES} />`, rendered on the server. */
  bands: ReactNode;
  /** The figure line, rendered on the server. It fades in with the sentence. */
  figures: ReactNode;
  /** The miniboard, rendered on the server. Its rows carry `data-rid` so the bands can drive them. */
  children: ReactNode;
}

/**
 * The fold: the field, the sentence cut out of it, the figures, and the miniboard.
 */
export function Muster({ sentence, bands, figures, children }: MusterProps) {
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const figline = useRef<HTMLDivElement>(null);

  const words = sentence.split(" ");

  /**
   * THE CLEARING. Which cells of the field fall inside the sentence.
   *
   * The word boxes are inset vertically to the ink rather than to the line box, so the channel
   * traces the words instead of clearing whole rows of the field. The wave runs left to right,
   * on the same axis and the same direction as the sweep that brought the cells in.
   *
   * Recomputed, instantly, whenever the sentence could have moved: a resize, a rotate, or the
   * moment the webfont settles and a 16ch measure reflows.
   */
  const applyClearing = useCallback((instant: boolean) => {
    const fieldEl = field.current;
    const headEl = heading.current;
    if (!fieldEl || !headEl) return;

    const boxes = Array.from(headEl.querySelectorAll<HTMLElement>("[data-word]")).map((w) => {
      const r = w.getBoundingClientRect();
      const padX = r.height * 0.05;
      const padY = r.height * 0.24;
      return { l: r.left - padX, r: r.right + padX, t: r.top + padY, b: r.bottom - padY };
    });
    if (boxes.length === 0) return;

    const cells = Array.from(fieldEl.querySelectorAll<HTMLElement>(".c"));

    /* UNCLEAR FIRST, THEN MEASURE. `.off` is a transform, and getBoundingClientRect reports the
       TRANSFORMED box, so measuring a cell that has already collapsed asks whether a point is
       inside the sentence rather than whether a cell is. Measured: recomputing over collapsed
       cells eroded the channel from 34 cells to 15 on the second pass, and the reduced-motion
       path, whose two passes run in the same frame, shipped the eroded one. Nothing is painted
       between here and the apply loop below, so the field never flickers back. */
    for (const cell of cells) {
      if (cell.classList.contains("off")) {
        cell.style.transition = "none";
        cell.style.transformOrigin = "";
        cell.classList.remove("off");
      }
    }

    const hit: { cell: HTMLElement; left: number; top: number }[] = [];

    for (const cell of cells) {
      const b = cell.getBoundingClientRect();
      if (boxes.some((w) => b.left < w.r && b.right > w.l && b.top < w.b && b.bottom > w.t)) {
        hit.push({ cell, left: b.left, top: b.top });
      }
    }

    hit.sort((a, b) => a.left - b.left || a.top - b.top);
    const span = Math.max(1, hit.length);

    hit.forEach(({ cell }, i) => {
      // app/cell.css gives every muster cell `transform-origin: left center`, because that is the
      // axis the sweep runs on. A cell standing aside collapses to its own middle instead.
      cell.style.transformOrigin = "center";
      cell.style.transition = instant
        ? "none"
        : `transform ${CLEAR_MS}ms var(--ease-settle) ${Math.round((i / span) * CLEAR_WAVE_MS)}ms`;
      cell.classList.add("off");
    });
  }, []);

  useArmEffect(() => {
    const rootEl = root.current;
    const fieldEl = field.current;
    const headEl = heading.current;
    const figEl = figline.current;
    if (!rootEl || !fieldEl || !headEl || !figEl) return;

    const risers = Array.from(headEl.querySelectorAll<HTMLElement>("[data-riser]"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = window.matchMedia("(max-width: 759px)").matches;

    const blade = tokenMs(fieldEl, "--t-blade", 260);
    const timers: number[] = [];
    let done = false;

    /* ARM, before the browser paints. The field folds to nothing and the sentence drops below the
       overflow of its own word boxes. Under a reduced-motion preference app/cell.css turns the
       fold into a no-op, so the field is simply already there and only the clearing still runs. */
    fieldEl.dataset.run = "armed";
    if (!reduce) {
      for (const r of risers) {
        r.style.transition = "none";
        r.style.transform = "translateY(105%)";
      }
      figEl.style.transition = "none";
      figEl.style.opacity = "0";
    }

    /* The stagger the server wrote is the wide column index. At the narrow layout every band
       doubles its row count, so the visual column is `--cell-delay-n`, which app/cell.css does
       not yet switch to. Doing it here keeps the sweep running down the columns you can see.
       This only ever affects the opening: nothing after it reads --cell-delay. */
    if (narrow) {
      for (const cell of Array.from(fieldEl.querySelectorAll<HTMLElement>(".c"))) {
        const n = cell.style.getPropertyValue("--cell-delay-n");
        if (n) cell.style.setProperty("--cell-delay", n);
      }
    }

    const rise = () => {
      applyClearing(reduce);
      risers.forEach((r, i) => {
        r.style.transition = reduce
          ? "none"
          : `transform ${WORD_MS}ms var(--ease-settle) ${i * WORD_STEP_MS}ms`;
        r.style.transform = "translateY(0)";
      });
      figEl.style.transition = reduce ? "none" : `opacity ${FIGURE_MS}ms linear`;
      figEl.style.opacity = "1";
      done = true;

      /* Measure once more when the webfont has settled, always, not only if it settles after
         this point. Under a reduced-motion preference the clearing runs on the first frame, and
         at that moment the sentence may still be set in the fallback face: measured, that was 15
         cells cut instead of 34, and the difference is a visibly ragged channel. Re-running is a
         rect read over 112 cells and a class toggle, so it is cheaper than getting it wrong. */
      if (document.fonts) void document.fonts.ready.then(() => applyClearing(true));
    };

    const release = () => {
      delete fieldEl.dataset.run;

      if (reduce) {
        rise();
        return;
      }

      // How long the last column waits before it starts. Bands differ, so take the widest.
      let maxCols = 0;
      for (const band of Array.from(fieldEl.querySelectorAll<HTMLElement>(".mband"))) {
        const cols = Number.parseInt(
          band.style.getPropertyValue(narrow ? "--cols-n" : "--cols") || "0",
          10,
        );
        if (Number.isFinite(cols)) maxCols = Math.max(maxCols, cols);
      }

      timers.push(
        window.setTimeout(rise, blade + Math.max(0, maxCols - 1) * COLUMN_STEP_MS + BEAT_MS),
      );
    };

    /* RELEASE ON THE FRAME AFTER THE NEXT, AND THE SECOND FRAME IS NOT A SPARE.
       A layout effect runs inside the task that commits the render, and a `requestAnimationFrame`
       registered there fires in that SAME rendering opportunity, before the frame is painted. One
       frame therefore arms and releases with no style recalculation in between, the browser never
       holds a folded value to transition FROM, and the sweep silently does not happen: measured,
       every cell reported `transform: none` from the first sample to the last while the sentence
       and the figures animated correctly around them. Two frames give the fold one painted frame
       of its own, which is the frame the sweep starts from. */
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(release);
    });

    /* The sentence can move without anything being clicked: a resize, a rotate, or the webfont
       landing and a 16ch measure reflowing under it. Recompute, instantly, but never before the
       opening has run, or the clearing would fight the sweep. */
    let reflow = 0;
    const recompute = () => {
      window.clearTimeout(reflow);
      reflow = window.setTimeout(() => {
        if (done) applyClearing(true);
      }, 150);
    };
    window.addEventListener("resize", recompute);

    /* THE FIELD IS THE BOARD. Moving a pointer onto a band drives that raffle's row below it,
       because they are the same object at two scales. Delegated, so 112 cells and five rows cost
       two listeners; `pointerover` and `focusin` rather than enter and focus, because those do
       not bubble. */
    const drive = (target: EventTarget | null, on: boolean) => {
      const band = (target as Element | null)?.closest?.(".mband");
      const rid = band?.getAttribute("data-rid");
      if (!rid) return;
      const row = rootEl.querySelector<HTMLElement>(`.row[data-rid="${rid}"]`);
      row?.classList.toggle("hot", on);
    };
    const over = (e: Event) => drive(e.target, true);
    const out = (e: Event) => drive(e.target, false);
    rootEl.addEventListener("pointerover", over);
    rootEl.addEventListener("pointerout", out);
    rootEl.addEventListener("focusin", over);
    rootEl.addEventListener("focusout", out);

    return () => {
      cancelAnimationFrame(frame);
      for (const t of timers) window.clearTimeout(t);
      window.clearTimeout(reflow);
      window.removeEventListener("resize", recompute);
      rootEl.removeEventListener("pointerover", over);
      rootEl.removeEventListener("pointerout", out);
      rootEl.removeEventListener("focusin", over);
      rootEl.removeEventListener("focusout", out);
    };
  }, [applyClearing]);

  return (
    <div ref={root}>
      {/* The field keeps its own height, and the sentence hangs off its bottom edge. Nothing here
          is a stacking trick: the heading is the only thing in the fold with a z-index, and it is
          2 because the cells inside it are position: relative for their reveal bars. */}
      <div className="relative mb-[clamp(14px,2.2vh,26px)]">
        <div ref={field} className="muster">
          {bands}
        </div>

        <h1
          ref={heading}
          className="pointer-events-none absolute bottom-[clamp(8px,1.6vh,24px)] left-[var(--pad)] right-[var(--pad)] z-[2] m-0 max-w-[16ch] font-serif text-manifesto text-fg"
        >
          {words.map((word, i) => (
            <span key={`${word}-${i}`}>
              {/* overflow-hidden on the word box is what makes the rise a rise: the glyphs travel
                  from below their own line and there is nothing to see until they clear it. */}
              <span data-word="" className="inline-block overflow-hidden align-bottom">
                <i data-riser="" className="inline-block not-italic">
                  {word}
                </i>
              </span>
              {i < words.length - 1 ? " " : null}
            </span>
          ))}
        </h1>
      </div>

      <div className="px-pad">
        <div ref={figline} style={{ opacity: 1 } as CSSProperties}>
          {figures}
        </div>
        {children}
      </div>
    </div>
  );
}
