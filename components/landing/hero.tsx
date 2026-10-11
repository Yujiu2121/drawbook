"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import { drumAvailable } from "@/components/drum/drum-stage";

/**
 * THE OPENING, AND THE ONE CLIENT ISLAND IN THE HERO'S COPY.
 *
 * The sentence rises out of its own word boxes, once, and beside it is the drum: the 112 tickets
 * of the five sample raffles, turning slowly. Nothing here is still moving a second after the page
 * lands except the drum's own idle turn, which components/drum/drum-stage.tsx owns and stops off
 * screen.
 *
 * THE SLOT HOLDS TWO DRAWINGS OF THE SAME TICKETS. The server renders the muster, every ticket as
 * a cell in five bands, into the slot, and it is what a reader with no script, no WebGL or a
 * reduced-motion preference sees. The drum stage draws over the same box and, once it has drawn,
 * fades the muster out (app/drum.css). The slot's height is set by CSS alone, so neither drawing
 * moves anything when it arrives.
 *
 * WHAT THIS COMPONENT IS ALLOWED TO BE. Two refs and a few timers. It renders no cell, no figure
 * and no card: the muster, the drum stage, the caption and the calls to action are all handed in
 * already rendered. This island only adds and removes attributes on markup it did not write.
 *
 * THE OPENING IS OPT-IN, WHICH IS THE POINT. The words render in place. This island drops them
 * below their boxes in a layout effect and raises them on the frame after next. Anyone whose script
 * never runs gets the sentence, the lead and both calls to action, all present and all still.
 *
 * THE MUSTER'S SWEEP. When there is no drum to replace it, the muster still opens as it always
 * did: folded in the layout effect (`data-run="armed"`, scaleX(0) with no transition) and released
 * column by column. When the drum is going to draw over it, the sweep is skipped rather than
 * played under a crossfade.
 */

/** Must equal COLUMN_STEP_MS in components/cell.tsx. Used only to time the acts that follow. */
const COLUMN_STEP_MS = 22;

/** The sentence: one word's rise, and the step between words. */
const WORD_MS = 520;
const WORD_STEP_MS = 60;

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
  /**
   * The headline. Set as two lines, split at its first ", ", the second in the headline ramp;
   * each word gets its own rise.
   */
  sentence: string;
  /** The nineteen-pixel lead under it. */
  lead: string;
  /** The two calls to action, rendered by the server. */
  actions: ReactNode;
  /** `<MusterBands raffles={MOCK_RAFFLES} />`, rendered by the server. */
  field: ReactNode;
  /** The drum stage island, drawn over the field. */
  drum?: ReactNode;
  /** The caption under the field and the note under that, rendered by the server. */
  fieldHead: ReactNode;
  fieldNote: ReactNode;
}

/** "Fair raffles, built on Rialo." as ["Fair raffles,", "built on Rialo."]. */
function linesOf(sentence: string): string[] {
  const at = sentence.indexOf(", ");
  return at < 0 ? [sentence] : [sentence.slice(0, at + 1), sentence.slice(at + 2)];
}

export function Hero({
  eyebrow,
  sentence,
  lead,
  actions,
  field,
  drum,
  fieldHead,
  fieldNote,
}: HeroProps) {
  const muster = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  /* Read once, on the first render, and kept: the store re-renders this component with `true`
     straight after hydration, but whether the FIRST commit was a hydration is what decides below. */
  const clientRender = useSyncExternalStore(noSubscribe, onClient, onServer);
  const mountedOnClient = useRef(clientRender);

  const lines = linesOf(sentence);

  useArmEffect(() => {
    const musterEl = muster.current;
    const headEl = heading.current;
    if (!musterEl || !headEl) return;

    const risers = Array.from(headEl.querySelectorAll<HTMLElement>("[data-riser]"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const narrow = window.matchMedia("(max-width: 759px)").matches;

    const blade = tokenMs(musterEl, "--t-blade", 260);
    const timers: number[] = [];

    /* ALREADY SEEN, SO NOT FOLDED. "Before the browser paints" is true of a client-side navigation
       to this page and false of a hard load: there the server's HTML has painted the headline and
       the field before this island hydrates, and arming at hydration hid content the visitor had
       already read, then raised it again. On a throttled phone that was a second of headline gone.
       So when this first commit was a hydration over HTML that has had a contentful paint, the
       fold and the rise are skipped and the hero stays as painted. A browser without paint timing
       reports no paint and keeps the full opening. */
    const seen =
      !mountedOnClient.current &&
      typeof performance !== "undefined" &&
      typeof performance.getEntriesByName === "function" &&
      performance.getEntriesByName("first-contentful-paint").length > 0;
    if (seen) return;

    /* The drum will draw over the muster, so its sweep would play under a crossfade. Skip it. */
    const sweep = !drumAvailable();

    /* ARM, BEFORE THE BROWSER PAINTS. The sentence drops below the overflow of its own word
       boxes and, when it will sweep, the field folds to nothing. */
    if (sweep) musterEl.dataset.run = "armed";
    for (const r of risers) {
      r.style.transition = "none";
      r.style.transform = "translateY(105%)";
    }

    /* The stagger the server wrote is the wide column index. At the narrow layout every band
       doubles its row count, so the visual column is `--cell-delay-n`. Swapping it here keeps the
       sweep running down the columns you can actually see, and nothing after the opening reads
       either property. */
    if (sweep && narrow) {
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
    };

    const release = () => {
      if (!sweep) {
        rise();
        return;
      }
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

    /* RELEASE ON THE FRAME AFTER THE NEXT, AND THE SECOND FRAME IS NOT A SPARE.
       A layout effect runs inside the task that commits the render, and a `requestAnimationFrame`
       registered there fires in that SAME rendering opportunity, before the frame is painted. One
       frame therefore arms and releases with no style recalculation in between, the browser never
       holds a folded value to transition FROM, and the sweep silently does not happen: measured on
       an earlier opening, every cell reported `transform: none` from the first sample to the last
       while the sentence animated correctly around them. Two frames give the fold one painted
       frame of its own, which is the frame the sweep starts from. */
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(release);
    });

    return () => {
      cancelAnimationFrame(frame);
      for (const t of timers) window.clearTimeout(t);
      delete musterEl.dataset.run;
      for (const r of risers) {
        r.style.transition = "";
        r.style.transform = "";
      }
    };
  }, []);

  return (
    <div className="hero-grid">
      <div>
        <p className="label m-0 mb-[clamp(18px,2.4vw,30px)] flex items-center gap-3 text-event">
          <span aria-hidden="true" className="block h-px w-7 bg-event" />
          {eyebrow}
        </p>

        <h1 ref={heading} className="m-0 headline text-manifesto text-fg">
          {lines.map((line, li) => (
            <span key={line} className="hero-line">
              {line.split(" ").map((word, i, all) => (
                <span key={`${li}-${i}`}>
                  <span className="hero-word">
                    <i data-riser="" className={li > 0 ? "headline-ramp" : undefined}>
                      {word}
                    </i>
                  </span>
                  {i < all.length - 1 ? " " : null}
                </span>
              ))}
              {/* The space between the lines, for a reader that flattens the two blocks. */}
              {li < lines.length - 1 ? " " : null}
            </span>
          ))}
        </h1>

        <p className="m-0 mt-[clamp(20px,2.4vw,30px)] max-w-[34em] text-lg text-fg-2">{lead}</p>

        <div className="mt-[clamp(24px,3vw,38px)] flex flex-wrap items-center gap-3">{actions}</div>
      </div>

      {/* The field. A figure, because it is one: every ticket in Drawbook, and the caption says so. */}
      <figure className="hero-figure m-0">
        <div className="drumslot">
          <div ref={muster} className="muster" data-scale="hero">
            {field}
          </div>
          {drum}
        </div>
        <figcaption className="mt-3.5">
          {fieldHead}
          {fieldNote}
        </figcaption>
      </figure>
    </div>
  );
}
