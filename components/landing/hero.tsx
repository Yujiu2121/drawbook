"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

/**
 * THE OPENING, AND THE ONLY CLIENT ISLAND ABOVE THE FOLD.
 *
 * Three acts and then it is over. The field sweeps in column by column; the sentence rises out of
 * its own word boxes; one rule crosses the field and leaves raffle 0004's two winners lit. Nothing
 * loops, nothing waits for a scroll, and nothing here is still moving a second and a half after
 * the page lands.
 *
 * WHAT REPLACED THE OLD FOLD, AND WHY. The previous opening cut the sentence out of the field by
 * measuring the word boxes against 112 cells and standing the intersecting ones aside. It was the
 * better picture and it had a real accessibility hole: with no script the sentence was not cut out
 * of anything, so it sat on top of the cells behind it and both became unreadable. That was
 * recorded as unfixed. Here the sentence and the field are beside each other, so the no-script
 * state is simply a headline next to a field, and the measurement, the resize listener and the
 * `document.fonts.ready` re-measure all go away with it.
 *
 * WHAT THIS COMPONENT IS ALLOWED TO BE. Three refs and two timers. It renders no cell, no figure
 * and no card: the field is `<MusterBands>` handed in as a prop and rendered on the server, and so
 * is everything under it. This island only adds and removes attributes on markup it did not write.
 *
 * THE OPENING IS OPT-IN, WHICH IS THE POINT. app/cell.css renders the field VISIBLE. This island
 * folds it in a layout effect (`data-run="armed"`, which is `scaleX(0)` with no transition) and
 * releases it on the frame after next. Anyone whose script never runs gets the field, the sentence
 * and both calls to action, all present and all still.
 *
 * EVERY DURATION IS READ OFF THE TOKEN LAYER rather than retyped, because a stagger that disagrees
 * with `--t-blade` by 40ms is invisible in a screenshot and wrong in motion. The one number that is
 * not a token is the 22ms column step, which components/cell.tsx writes into each cell as
 * `--cell-delay` and which is repeated here only to know when the sweep ends.
 */

/** Must equal COLUMN_STEP_MS in components/cell.tsx. Used only to time the acts that follow. */
const COLUMN_STEP_MS = 22;

/** The sentence: one word's rise, and the step between words. */
const WORD_MS = 520;
const WORD_STEP_MS = 60;

/** The draw line: how long it takes to cross, and how long it holds before it goes. */
const DRAW_MS = 900;
const DRAW_HOLD_MS = 260;

/** A beat between the sweep landing and the sentence starting. Without it the two acts overlap. */
const BEAT_MS = 100;

/** `useLayoutEffect` warns when a Client Component is server-rendered, which this one is. */
const useArmEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * False on the server and in the hydration render, true in a render that is not hydrating, which
 * for this component means a client-side navigation to "/". The store never changes, so nothing
 * subscribes; only the server/client snapshot split is used.
 */
const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * Read a duration token off an element. `--t-blade` is `260ms`, so `parseFloat` is the whole
 * parser; a token in seconds would need more, and there are none.
 */
function tokenMs(el: Element, name: string, fallback: number): number {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && raw.endsWith("ms") ? n : fallback;
}

export interface HeroProps {
  /** The eyebrow over the headline. */
  eyebrow: string;
  /** The headline. Split on spaces here, so each word gets its own rise. */
  sentence: string;
  /** The nineteen-pixel lead under it. */
  lead: string;
  /** The two calls to action, rendered by the server. */
  actions: ReactNode;
  /** `<MusterBands raffles={MOCK_RAFFLES} />`, rendered by the server. */
  field: ReactNode;
  /** The caption over the field and the note under it, rendered by the server. */
  fieldHead: ReactNode;
  fieldNote: ReactNode;
}

export function Hero({
  eyebrow,
  sentence,
  lead,
  actions,
  field,
  fieldHead,
  fieldNote,
}: HeroProps) {
  const muster = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  /* Read once, on the first render, and kept: the store re-renders this component with `true`
     straight after hydration, but whether the FIRST commit was a hydration is what decides below. */
  const clientRender = useSyncExternalStore(noSubscribe, onClient, onServer);
  const mountedOnClient = useRef(clientRender);

  const words = sentence.split(" ");

  useArmEffect(() => {
    const musterEl = muster.current;
    const stageEl = stage.current;
    const headEl = heading.current;
    if (!musterEl || !stageEl || !headEl) return;

    const risers = Array.from(headEl.querySelectorAll<HTMLElement>("[data-riser]"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = window.matchMedia("(max-width: 759px)").matches;

    const blade = tokenMs(musterEl, "--t-blade", 260);
    const timers: number[] = [];

    /* ALREADY SEEN, SO NOT FOLDED. "Before the browser paints" is true of a client-side navigation
       to this page and false of a hard load: there the server's HTML has painted the headline and
       the field before this island hydrates, and arming at hydration hid content the visitor had
       already read, then raised it again. On a throttled phone that was a second of headline gone.
       So when this first commit was a hydration over HTML that has had a contentful paint, the
       fold and the rise are skipped and the hero stays as painted. Only the draw line runs, since
       it hides nothing: one stroke across a field that is already there. A browser without paint
       timing reports no paint and keeps the full opening, which is the old behaviour. */
    const seen =
      !mountedOnClient.current &&
      typeof performance !== "undefined" &&
      typeof performance.getEntriesByName === "function" &&
      performance.getEntriesByName("first-contentful-paint").length > 0;

    if (seen && !reduce) {
      timers.push(
        window.setTimeout(() => {
          stageEl.dataset.draw = "run";
        }, BEAT_MS * 3),
      );
      timers.push(
        window.setTimeout(
          () => {
            stageEl.dataset.draw = "done";
          },
          BEAT_MS * 3 + DRAW_MS + DRAW_HOLD_MS,
        ),
      );
      return () => {
        for (const t of timers) window.clearTimeout(t);
      };
    }

    /* ARM, BEFORE THE BROWSER PAINTS. The field folds to nothing and the sentence drops below the
       overflow of its own word boxes. Under a reduced-motion preference app/cell.css turns the
       fold into a no-op, so the field is simply already there and this whole block is skipped. */
    if (!reduce) {
      musterEl.dataset.run = "armed";
      for (const r of risers) {
        r.style.transition = "none";
        r.style.transform = "translateY(105%)";
      }
    }

    /* The stagger the server wrote is the wide column index. At the narrow layout every band
       doubles its row count, so the visual column is `--cell-delay-n`. Swapping it here keeps the
       sweep running down the columns you can actually see, and nothing after the opening reads
       either property. */
    if (narrow && !reduce) {
      for (const cell of Array.from(musterEl.querySelectorAll<HTMLElement>(".c"))) {
        const n = cell.style.getPropertyValue("--cell-delay-n");
        if (n) cell.style.setProperty("--cell-delay", n);
      }
    }

    const rise = () => {
      for (const [i, r] of risers.entries()) {
        r.style.transition = `transform ${WORD_MS}ms var(--ease-settle) ${i * WORD_STEP_MS}ms`;
        r.style.transform = "translateY(0)";
      }
      /* The draw line starts as the last word lands, not after it: the sentence names the
         product, and the line is the draw that the product is. */
      timers.push(
        window.setTimeout(() => {
          stageEl.dataset.draw = "run";
        }, (risers.length - 1) * WORD_STEP_MS + WORD_MS * 0.5),
      );
      timers.push(
        window.setTimeout(
          () => {
            stageEl.dataset.draw = "done";
          },
          (risers.length - 1) * WORD_STEP_MS + WORD_MS * 0.5 + DRAW_MS + DRAW_HOLD_MS,
        ),
      );
    };

    const release = () => {
      delete musterEl.dataset.run;

      // How long the last column waits before it starts. Bands differ, so take the widest.
      let maxCols = 0;
      for (const band of Array.from(musterEl.querySelectorAll<HTMLElement>(".mband"))) {
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

    if (reduce) return;

    /* RELEASE ON THE FRAME AFTER THE NEXT, AND THE SECOND FRAME IS NOT A SPARE.
       A layout effect runs inside the task that commits the render, and a `requestAnimationFrame`
       registered there fires in that SAME rendering opportunity, before the frame is painted. One
       frame therefore arms and releases with no style recalculation in between, the browser never
       holds a folded value to transition FROM, and the sweep silently does not happen: measured on
       the previous opening, every cell reported `transform: none` from the first sample to the last
       while the sentence animated correctly around them. Two frames give the fold one painted
       frame of its own, which is the frame the sweep starts from. */
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(release);
    });

    return () => {
      cancelAnimationFrame(frame);
      for (const t of timers) window.clearTimeout(t);
    };
  }, []);

  return (
    <div className="grid items-center gap-[clamp(30px,4vw,60px)] px-pad py-[clamp(40px,6vw,88px)] min-[1000px]:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)]">
      <div>
        <p className="label m-0 mb-[clamp(18px,2.4vw,30px)] flex items-center gap-2.5 text-fg-3">
          {/* The signal band, at the size it is on the mark. It is not a control, it never
              answers the pointer, and it is the same 36% proportion the logo draws. */}
          <span aria-hidden="true" className="block h-1.5 w-[22px] bg-event" />
          {eyebrow}
        </p>

        <h1 ref={heading} className="m-0 max-w-[15ch] font-serif text-manifesto text-fg">
          {words.map((word, i) => (
            <span key={`${word}-${i}`}>
              <span className="riser">
                <i data-riser="">{word}</i>
              </span>
              {i < words.length - 1 ? " " : null}
            </span>
          ))}
        </h1>

        <p className="m-0 mt-[clamp(20px,2.4vw,30px)] max-w-[46ch] text-lg text-fg-2">{lead}</p>

        <div className="mt-[clamp(24px,3vw,38px)] flex flex-wrap items-center gap-2.5">
          {actions}
        </div>
      </div>

      {/* The field. A figure, because it is one: every ticket in Drawbook, and the caption says so. */}
      <figure className="m-0 bg-panel-2 p-[clamp(14px,1.6vw,22px)]">
        {fieldHead}
        <div ref={stage} className="muster-stage relative">
          <div ref={muster} className="muster" data-scale="hero">
            {field}
          </div>
          <span aria-hidden="true" className="draw-line" />
        </div>
        {fieldNote}
      </figure>
    </div>
  );
}
