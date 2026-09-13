"use client";

/**
 * THE CEREMONY.
 *
 * The largest client island in Drawbook, and the only one that animates for more than a third of
 * a second. It replays raffle 0004's settled draw: 20 tickets sold, 18 revealed, 2 bonds
 * forfeited, one chain value, one seed, two winners. It replays history and it does nothing else.
 * There is no live raffle it can settle, no spin, no near miss and no acceleration into a result.
 *
 * THE STATIC RECORD IS THE PRIMARY COMPOSITION, NOT A FALLBACK
 * ------------------------------------------------------------
 * `<Record>` below prints the whole draw as a document: the sorted nonces, the preimage, the
 * seed, the two draw steps with the pool size each one sampled from, and the winners. It is what
 * this section shows at rest, what it shows with JavaScript switched off, and what it shows
 * under `prefers-reduced-motion`. The animation adds pacing to an argument the document already
 * makes in full. That is the right way round: a reader who never presses the button loses the
 * choreography and loses no fact.
 *
 * The preview this is ported from had two separate compositions for this, a poster frame and a
 * reduced-motion fallback, which is two places for the same facts to drift apart. There is one
 * here.
 *
 * WHAT IS HANDED IN, AND WHY
 * --------------------------
 * `poster` and `ledger` are ReactNodes rendered by the calling Server Component, so the section
 * is complete in the server's HTML before a byte of this island has been fetched. `trace` is
 * `deriveWinnerTrace(...)` from lib/raffle.ts, which is where the cursor's stopping points come
 * from. The preview hardcoded those as `pickIndices = [14, 8]`, which is a hand-copied constant
 * inside the one surface whose whole job is to be checkable. There is no constant here: every
 * index, count, digest, address and amount on this surface is computed from lib/mock-raffles.ts
 * and lib/raffle.ts at render time.
 *
 * `<CeremonyLedger>` and `<CeremonyWinners>` are exported so both call sites hand in the same
 * two nodes rather than each writing their own version of a ledger that must agree with this
 * file's figures.
 *
 * THE LEDGER DOES NOT PROGRESS, AND THAT IS A CORRECTION
 * ------------------------------------------------------
 * The preview's ledger rewrote itself act by act, printing SEED "not derived yet" and WINNERS
 * "not drawn yet" during the replay. Raffle 0004 was drawn in July and the seed is printed three
 * inches to the left while that row claims it is not derived. The record does not become unknown
 * because somebody pressed a button. The ledger handed in here is the settled record and it
 * stays true for the whole sequence; the single figure above it is this island's own, and it
 * moves, because what it counts genuinely changes as the acts run.
 *
 * WHY NOTHING HERE IS NAMED FOR A VIEW TRANSITION
 * -----------------------------------------------
 * A shared-element name may be applied in exactly two files in this repo, components/row-link.tsx
 * and app/raffle/[id]/page.tsx, and this file deliberately does not spell the two-word React
 * element that applies one, so the sweep that counts the files mentioning it still counts two.
 * The reason for the rule: this section shows raffle 0004 on the landing, where the live
 * miniboard also shows raffle 0004. Two identical names on one page produce no error and no
 * warning. React applies the name to one instance and silently drops the other, and the morph
 * then anchors by tree order rather than by design. So there is no name in this file, at any
 * scale.
 *
 * BOTH HALVES OF THE REDUCED MOTION GUARD
 * ---------------------------------------
 * A CSS `@media (prefers-reduced-motion: reduce)` blanket has no effect whatever on the duration
 * of a `element.animate()` call, so the CSS half of the system cannot switch this island off.
 * The JS half is here: `useReducedMotion()` from motion gates the sequence, a live `matchMedia`
 * read gates it again at the moment of the press, and the controls swap for a sentence after
 * hydration so the button is not offered to somebody whose answer is already no.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";

import { serialOf, utcStamp } from "@/lib/cell";
import { MOCK_RAFFLES, VIEWER } from "@/lib/mock-raffles";
import {
  deriveSeed,
  deriveWinnerTrace,
  formatRLO,
  payouts,
  shortAddress,
  summarize,
  type DrawStep,
  type Raffle,
  type Ticket,
} from "@/lib/raffle";
import { concat, fromHex, sha256, toHex, utf8 } from "@/lib/sha256";

/* ===================================================================== the record

   Everything below this line is derived once, at module scope, from the real modules. Nothing here
   reads a random source or a wall clock, so the server render and the hydration render are
   identical and the draw reproduces on every reload. */

/** The one raffle this surface may show. Settled, audited, and the only one with a draw to replay. */
export const CEREMONY_RAFFLE_ID = 4;

function recordedRaffle(): Raffle {
  const found = MOCK_RAFFLES.find((r) => r.config.id === CEREMONY_RAFFLE_ID);
  // Unreachable against lib/mock-raffles.ts, which builds five fixed specs. Loud rather than
  // silent if that ever stops being true: a ceremony with no record is not a ceremony.
  if (!found) throw new Error(`ceremony: raffle ${CEREMONY_RAFFLE_ID} is not in MOCK_RAFFLES`);
  return found;
}

const RAFFLE = recordedRaffle();
const SUMMARY = summarize(RAFFLE);
const PAYOUTS = payouts(RAFFLE);
const SERIAL = serialOf(RAFFLE);
const CHAIN_SEED = RAFFLE.chainSeed ?? "";

/** Sold but silent: the two holders who let their bond go rather than reveal. */
const SILENT: Ticket[] = RAFFLE.tickets.filter((t) => t.holder !== null && t.nonce === null);

/** The revealed tickets in the order the record has them arriving. */
const ARRIVALS: Ticket[] = RAFFLE.tickets
  .filter((t) => t.nonce !== null)
  .slice()
  .sort((a, b) => ((a.revealedAt ?? "") < (b.revealedAt ?? "") ? -1 : 1));

/** The same set sorted, which is the order `deriveSeed` hashes them in. */
const SORTED_NONCES: string[] = ARRIVALS.map((t) => t.nonce as string).sort();

/** The seed, recomputed here from public data rather than read back off the record. */
const SEED = deriveSeed(RAFFLE.config.id, SORTED_NONCES, CHAIN_SEED);

/**
 * THE PREIMAGE, AND THE PROOF THAT IT IS THE PREIMAGE.
 *
 * `DOMAIN` is private to lib/raffle.ts, so the prefix printed in act 2 is the one string on this
 * surface that could drift away from the function it describes. Rather than trust it, the bytes
 * are assembled here exactly as `deriveSeed` assembles them and hashed: if the digest does not
 * come back equal to the seed, the prefix is wrong and act 2 says so instead of printing it.
 * That check costs one SHA-256 over about 300 bytes, once, at module load.
 */
const PREIMAGE_PREFIX = `rialo-raffle-v1|seed|${RAFFLE.config.id}|`;
const PREIMAGE_VERIFIED =
  toHex(
    sha256(
      concat(
        utf8(PREIMAGE_PREFIX),
        ...SORTED_NONCES.flatMap((n) => [fromHex(n), utf8("|")]),
        fromHex(CHAIN_SEED),
      ),
    ),
  ) === SEED;

const POOL_RLO = formatRLO(SUMMARY.pool);
const PER_WINNER_RLO = formatRLO(SUMMARY.perWinner);
const FORFEITED_RLO = formatRLO(SUMMARY.forfeited);
const SETTLED_STAMP = utcStamp(RAFFLE.config.revealDeadline);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function list(values: string[], joiner: string): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} ${joiner} ${values[values.length - 1]}`;
}

const SILENT_LIST = list(
  SILENT.map((t) => pad2(t.index)),
  "and",
);
const WINNER_LIST = list(
  RAFFLE.winningTickets.map((w) => pad2(w)),
  "and",
);

/* ========================================================================== shape */

/**
 * One step of the draw. Structurally the `DrawStep` that lib/raffle.ts exports, aliased rather
 * than restated so there is one name for the shape and a call site can import either.
 */
export type TraceStep = DrawStep;

export interface CeremonyProps {
  /**
   * The calling route's own contribution to the static record, printed at its foot. The landing
   * passes `<CeremonyWinners />`, because nothing else on that page prints the winners. The draw
   * route passes `null`, because its hero already does and one scroll should not contain raffle
   * 0004 twice.
   */
  poster: ReactNode;
  /** The settled ledger, server rendered. Pass `<CeremonyLedger />` unless you need another one. */
  ledger: ReactNode;
  /**
   * `deriveWinnerTrace(summarize(raffle).eligible, seed, raffle.config.winners)` for raffle 0004.
   * The cursor's stopping points and the pool sizes it walks are read from this and nowhere else.
   */
  trace: TraceStep[];
}

/* =========================================================== shared presentation */

const BUTTON =
  "label inline-flex items-center border border-bound px-2.5 py-1.5 text-fg transition-colors duration-[var(--t-open)] ease-settle hover:bg-fg hover:text-panel";
const BUTTON_PRIMARY =
  "label inline-flex items-center border border-event bg-event px-2.5 py-1.5 text-panel transition-colors duration-[var(--t-open)] ease-settle hover:border-fg hover:bg-fg";

/** A digest, a preimage or a payload: long, deliberately unreadable, and narrow enough to fit. */
const WELL = "digest bg-recess p-3.5 leading-[1.9] text-fg text-[clamp(8.5px,0.95vw,12px)]";

/** Running argument, set as prose. Never as a label: three of these are 140 characters long. */
const NOTE = "max-w-[62ch] text-sm text-fg-2";

function Caption({ children }: { children: ReactNode }) {
  return <p className="mb-[18px] max-w-[62ch] text-lg text-fg-2">{children}</p>;
}

/* ------------------------------------------------------------------- the ledger */

/**
 * THE LEDGER READS THE RECORD, END TO END.
 *
 * Nine rows, none of them typed. The preview's version had REVEALED and ELIGIBLE POOL as string
 * literals sitting on top of a data blob that was correct in every field, and both had gone
 * wrong: it printed 18 of 18 three lines under its own caption saying 20 sold, and 16 eligible,
 * which is the residue after both winners have been spliced out rather than the 18 that were
 * eligible to be drawn. A product whose argument is recompute it yourself dies at the first
 * quantity on the page that is a literal.
 *
 * Exported so both routes hand in the same node. It is a client component only because it lives
 * in this module; it holds no state, renders identically on the server, and the caller stays a
 * Server Component.
 */
export function CeremonyLedger() {
  const rows: [string, string][] = [
    ["Raffle", SERIAL],
    ["Sold", `${SUMMARY.sold} of ${RAFFLE.config.supply}`],
    ["Revealed", `${SUMMARY.revealed} of ${SUMMARY.sold}`],
    ["Bonds forfeited", `${FORFEITED_RLO} RLO`],
    ["Pool", `${POOL_RLO} RLO`],
    ["Chain seed", CHAIN_SEED],
    ["Seed", SEED],
    ["Eligible pool", String(SUMMARY.eligible.length)],
    ["Winners", RAFFLE.winningTickets.map((w) => pad2(w)).join(", ")],
  ];
  return (
    <dl className="m-0">
      {rows.map(([term, value]) => (
        <div
          key={term}
          className="flex items-baseline justify-between gap-3 border-b border-rule py-[9px]"
        >
          <dt className="label shrink-0 text-fg-3">{term}</dt>
          <dd className="figure m-0 min-w-0 text-right text-sm break-all text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ the winners */

/**
 * The two winning tickets, their payouts and their holders. Rendered at the end of the replay,
 * and exported for the landing to hand in as its `poster`, so there is one implementation of a
 * winner card rather than one here and one on app/page.tsx.
 *
 * Ticket 17 is held by the address lib/mock-raffles.ts calls VIEWER. That is a fact about the
 * demo record, so it is stated as one. It deliberately does not read "Yours": no wallet is
 * connected, this component knows nothing about one, and claiming a win for a reader who has not
 * connected anything would be the exact kind of flattery this product refuses everywhere else.
 */
export function CeremonyWinners() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {RAFFLE.winningTickets.map((index, k) => {
        const ticket = RAFFLE.tickets.find((t) => t.index === index);
        const amount = PAYOUTS.get(index) ?? 0;
        return (
          <div key={index} className="flex items-start gap-4 border border-bound p-4">
            <div className="monument shrink-0 text-[clamp(2.4rem,5vw,4rem)] text-event">
              {pad2(index)}
            </div>
            <div className="min-w-0">
              <div className="label text-fg-3">
                Winner {k + 1} of {SUMMARY.effectiveWinners}
              </div>
              <div className="figure mt-1.5 text-lg text-fg">{formatRLO(amount)} RLO</div>
              <div className="mono mt-1.5 text-sm break-all text-fg-2">
                {ticket?.holder ? shortAddress(ticket.holder, 8, 8) : "no holder"}
              </div>
              {ticket?.holder === VIEWER ? (
                <div className="label mt-1.5 inline-block border border-event px-1.5 py-0.5 text-event">
                  Demo viewer
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- the record */

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="label mb-2.5 text-fg-2">
        {n}. {title}
      </h3>
      {children}
    </section>
  );
}

/** The preimage, with its two computed ingredients marked. */
function Preimage() {
  return (
    <div className={WELL}>
      {PREIMAGE_VERIFIED ? (
        <span className="text-event">{PREIMAGE_PREFIX}</span>
      ) : (
        <span className="text-event">[the domain prefix did not verify against the seed]</span>
      )}
      {SORTED_NONCES.map((n) => `${n}|`).join("")}
      <span className="text-event">{CHAIN_SEED}</span>
    </div>
  );
}

/**
 * The draw itself, one row per sample: where the keystream landed, how big the pool was when it
 * landed there, and which ticket was standing in that position. These three numbers are the whole
 * draw, and they come out of `deriveWinnerTrace` rather than being narrated over it.
 */
function TraceRows({ trace }: { trace: TraceStep[] }) {
  return (
    <ol className="m-0 list-none p-0">
      {trace.map((step, k) => (
        <li
          key={step.winner}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule py-2.5"
        >
          <span className="label text-fg-3">
            Sample {k + 1} of {trace.length}
          </span>
          <span className="figure text-sm text-fg">
            index {step.pick} of {step.poolBefore} gives ticket {pad2(step.winner)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The complete draw as a document. At rest, with JavaScript off, and under reduced motion this is
 * what the section is. Note the word is "randomized" and never the two-word phrase this industry
 * uses for a draw it wants believed without checking: biasing this one needs a party who both
 * produces the block and reveals last, and the product says so rather than burying it.
 */
function Record({ poster, trace }: { poster: ReactNode; trace: TraceStep[] }) {
  return (
    <div className="col-start-1 row-start-1 grid gap-[clamp(18px,2.4vw,28px)]">
      <p className="max-w-[62ch] text-lg text-fg-2">
        Raffle {SERIAL} is settled. {SUMMARY.sold} tickets sold, {SUMMARY.revealed} revealed,{" "}
        {SUMMARY.outstanding} bonds forfeited into a pool of {POOL_RLO} RLO. Tickets {WINNER_LIST}{" "}
        won {PER_WINNER_RLO} RLO each, drawn from a seed anyone holding the public reveals can
        recompute. The replay walks exactly this and invents nothing.
      </p>

      <Step n={1} title={`the ${SORTED_NONCES.length} revealed nonces, sorted`}>
        <div className={WELL}>
          {SORTED_NONCES.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
        <p className={`${NOTE} mt-3`}>
          Sorted, because hashing them in the order they arrived would pay whoever reveals last.
        </p>
      </Step>

      <Step n={2} title="the preimage, chain value last">
        <Preimage />
        <p className={`${NOTE} mt-3`}>
          The last {CHAIN_SEED.length} characters are the chain value. It is the only ingredient
          nobody could know in advance, which is why staying silent to move the seed is a bet a
          griefer cannot price.
        </p>
      </Step>

      <Step n={3} title="the seed">
        <div className={WELL}>{SEED}</div>
      </Step>

      <Step
        n={4}
        title={`the draw, ${trace.length} samples without replacement`}
      >
        <TraceRows trace={trace} />
        <p className={`${NOTE} mt-3`}>
          Each sample is 48 bits of a SHA-256 keystream over the seed, reduced modulo the pool
          that is still standing. The pool shrinks between the samples, which is why the second
          winner could not be the first. The draw is randomized, not unbiasable by construction:
          anyone who both produced the block and revealed last could have moved it, and no one
          here could do both.
        </p>
      </Step>

      {poster ? <div>{poster}</div> : null}
    </div>
  );
}

/* ============================================================== the five acts */

const ACT_NAMES = [
  "Act 0. Silence",
  "Act 1. The gather",
  "Act 2. The fold",
  "Act 3. The pick",
  "Act 4. The result",
];

/** Every duration in the sequence, in milliseconds, in one place so the total can be printed. */
const T = {
  silence: 600,
  gatherStep: 38,
  gatherIn: 260,
  gatherTail: 320,
  sort: 420,
  sortHold: 420,
  foldHold: 600,
  bladeIn: 280,
  bladeOut: 300,
  foldTail: 300,
  pickIntro: 360,
  dropHold: 260,
  compactHold: 300,
  cursorMin: 64,
  cursorMax: 108,
  winHold: 360,
  removeHold: 120,
  regroupHold: 380,
  cursorOut: 300,
  result: 900,
} as const;

/**
 * THE CURSOR RAMP. One step per cell, from 64ms to 108ms across the walk, played with
 * `steps(1, end)` so the outline is only ever on a cell and never between two. It decelerates
 * into the winner rather than easing across it, which is the difference between a cursor that is
 * counting and a cursor that is hunting for suspense.
 */
function cursorDurations(target: number): number[] {
  const n = target + 1;
  const span = Math.max(1, n - 1);
  return Array.from({ length: n }, (_, k) =>
    T.cursorMin + Math.round((T.cursorMax - T.cursorMin) * (k / span)),
  );
}

function walkMs(target: number): number {
  return cursorDurations(target).reduce((a, b) => a + b, 0);
}

function totalMs(trace: TraceStep[]): number {
  let ms =
    T.silence +
    (ARRIVALS.length * T.gatherStep + T.gatherTail) +
    T.sort +
    T.sortHold +
    T.foldHold +
    T.bladeIn +
    T.bladeOut +
    T.foldTail +
    T.pickIntro +
    T.dropHold +
    T.compactHold;
  trace.forEach((step, k) => {
    ms += walkMs(step.pick) + T.winHold;
    if (k < trace.length - 1) ms += T.removeHold + T.regroupHold;
  });
  return ms + T.cursorOut + T.result;
}

/* ============================================================== the island */

type Phase = "idle" | "playing" | "done";

interface Figure {
  value: string;
  label: string;
}

const REST_FIGURE: Figure = {
  value: PER_WINNER_RLO,
  label: `RLO to each of ${SUMMARY.effectiveWinners} winners`,
};

export function Ceremony({ poster, ledger, trace }: CeremonyProps) {
  const preferReduced = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("idle");
  const [act, setAct] = useState(0);
  const [figure, setFigure] = useState<Figure>(REST_FIGURE);
  const [seedText, setSeedText] = useState("");
  const [pickStatus, setPickStatus] = useState("");
  const [drawn, setDrawn] = useState<number[]>([]);
  const [audit, setAudit] = useState<string[] | null>(null);
  // Set from an effect rather than at render: the preference is not knowable on the server, and a
  // control whose markup depends on it would not survive hydration.
  const [reduced, setReduced] = useState(false);

  const stripRef = useRef<HTMLDivElement>(null);
  const noncesRef = useRef<HTMLDivElement>(null);
  const bladeRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef(0);

  const seconds = useMemo(() => Math.round(totalMs(trace) / 1000), [trace]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  const reset = useCallback(() => {
    tokenRef.current += 1;
    setPhase("idle");
    setAct(0);
    setFigure(REST_FIGURE);
    setDrawn([]);
    setSeedText("");
    setPickStatus("");
  }, []);

  const play = useCallback(() => {
    // Both halves of the guard. The hook is the one the rest of the app uses; the live read is
    // the one that is still correct if the preference changed after this island mounted.
    if (preferReduced) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    tokenRef.current += 1;
    setDrawn([]);
    setSeedText("");
    setPickStatus("");
    setAct(0);
    setFigure({ value: String(SUMMARY.revealed), label: `of ${SUMMARY.sold} holders revealed` });
    setPhase("playing");
  }, [preferReduced]);

  /**
   * THE SEQUENCE. It starts when the acts have mounted, which is what makes every ref below
   * non-null without a single guard in the body of an act.
   *
   * Cancellation is a token plus a set of live animations. Every await checks the token, so a
   * Stop, a second press, or the component unmounting stops the sequence at its next boundary;
   * the animations are cancelled outright, which removes their fills; and the acts unmount, so
   * there is no element left holding a transform that nothing will clear.
   */
  useEffect(() => {
    if (phase !== "playing") return;

    const token = (tokenRef.current += 1);
    const alive = () => token === tokenRef.current;
    const live = new Set<Animation>();

    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const raf = () => new Promise((r) => requestAnimationFrame(() => r(null)));

    /**
     * Every animation this sequence creates is kept in `live` for the sequence's whole life, not
     * dropped once it finishes. Almost all of them are `fill: "forwards"`, and a finished fill is
     * still painting: dropping it from the set would leave a second replay setting inline styles
     * underneath eighteen fills that outrank them, which looks exactly like the island being
     * broken. Cleanup cancels the lot, which is what makes a replay start from the same frame
     * every time.
     */
    async function run(
      el: Element,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ): Promise<void> {
      const animation = el.animate(frames, options);
      live.add(animation);
      try {
        await animation.finished;
      } catch {
        // A cancelled animation rejects. That is the Stop path, not an error.
      }
    }

    function start(el: Element, frames: Keyframe[], options: KeyframeAnimationOptions): void {
      const animation = el.animate(frames, options);
      live.add(animation);
      animation.finished.catch(() => {});
    }

    const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)"; // --ease-settle
    const blade = "cubic-bezier(0.7, 0, 0.2, 1)"; // --ease-blade

    /* --- prepare every act in its playing state before the first one is shown. All five acts are
       mounted and only act 0 is visible, so nothing below is ever seen arriving. */

    const nonceRows = Array.from(
      noncesRef.current?.querySelectorAll<HTMLElement>("[data-nonce]") ?? [],
    );
    const rowHeight = nonceRows[0]?.getBoundingClientRect().height ?? 0;
    for (const [k, row] of nonceRows.entries()) {
      row.style.opacity = "0";
      row.style.transform = `translate(-14px, ${k * rowHeight}px)`;
    }

    const cells = Array.from(stripRef.current?.querySelectorAll<HTMLElement>("[data-pick]") ?? []);
    const cellBox = cells[0]?.getBoundingClientRect();
    const cellWidth = cellBox?.width ?? 0;
    const stepPx = cellWidth + 2; // the 2px gap between pick cells
    const cursor = cursorRef.current;
    if (cursor && cellBox) {
      cursor.style.width = `${cellWidth}px`;
      cursor.style.height = `${cellBox.height}px`;
      cursor.style.opacity = "0";
      cursor.style.transform = "translateX(0px)";
    }

    /** A resize invalidates every pixel measured above, so the sequence stands down rather than
        walking a cursor to a place the cells are no longer in. */
    const widthAtStart = stripRef.current?.getBoundingClientRect().width ?? 0;
    const onResize = () => {
      const now = stripRef.current?.getBoundingClientRect().width ?? 0;
      if (Math.abs(now - widthAtStart) > 4) reset();
    };
    window.addEventListener("resize", onResize);

    (async () => {
      /* ACT 0. SILENCE. */
      await wait(T.silence);
      if (!alive()) return;

      /* ACT 1. THE GATHER, then the sort. Transform and opacity only. */
      setAct(1);
      setFigure({ value: "00", label: "nonces gathered" });
      await raf();
      if (!alive()) return;

      for (const [k, row] of nonceRows.entries()) {
        const y = k * rowHeight;
        start(
          row,
          [
            { transform: `translate(-14px, ${y}px)`, opacity: 0 },
            { transform: `translate(0px, ${y}px)`, opacity: 1 },
          ],
          { duration: T.gatherIn, delay: k * T.gatherStep, easing: ease, fill: "both" },
        );
        setTimeout(() => {
          if (alive()) setFigure({ value: pad2(k + 1), label: "nonces gathered" });
        }, k * T.gatherStep + T.gatherIn);
      }
      await wait(nonceRows.length * T.gatherStep + T.gatherTail);
      if (!alive()) return;

      const sortedIndex = new Map(SORTED_NONCES.map((n, k) => [n, k]));
      for (const [k, row] of nonceRows.entries()) {
        const to = sortedIndex.get(row.dataset.nonce ?? "") ?? k;
        start(
          row,
          [
            { transform: `translate(0px, ${k * rowHeight}px)` },
            { transform: `translate(0px, ${to * rowHeight}px)` },
          ],
          { duration: T.sort, easing: ease, fill: "forwards" },
        );
      }
      setFigure({
        value: String(SORTED_NONCES.length),
        label: "sorted, so reveal order buys nothing",
      });
      await wait(T.sortHold);
      if (!alive()) return;

      /* ACT 2. THE FOLD. One blade crosses the block, the text swaps behind it, the blade leaves
         from the opposite edge. No opacity anywhere in the act change itself. */
      setAct(2);
      setSeedText("");
      setFigure({ value: String(SORTED_NONCES.length), label: "nonces plus one chain value" });
      await wait(T.foldHold);
      if (!alive()) return;

      const bladeEl = bladeRef.current;
      if (bladeEl) {
        bladeEl.style.transformOrigin = "left center";
        await run(bladeEl, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
          duration: T.bladeIn,
          easing: blade,
          fill: "forwards",
        });
        if (!alive()) return;
        setSeedText(SEED);
        await raf();
        await raf();
        if (!alive()) return;
        bladeEl.style.transformOrigin = "right center";
        await run(bladeEl, [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
          duration: T.bladeOut,
          easing: blade,
          fill: "forwards",
        });
        if (!alive()) return;
      }
      await wait(T.foldTail);
      if (!alive()) return;

      /* ACT 3. THE PICK. */
      setAct(3);
      setPickStatus(`${SUMMARY.eligible.length} eligible`);
      setFigure({ value: String(SUMMARY.eligible.length), label: "in the pool" });
      await wait(T.pickIntro);
      if (!alive()) return;

      // Everything that is not in the eligible pool leaves. The pool is `summarize(raffle).eligible`
      // rather than "all of them minus the silent ones", so an unsold ticket could never be walked
      // over by the cursor either. On this record the two sets are the same 18 tickets.
      const poolSlots = SUMMARY.eligible.map((index) =>
        cells.findIndex((c) => c.dataset.pick === String(index)),
      );
      const outSlots = cells.map((_, i) => i).filter((i) => !poolSlots.includes(i));
      for (const slot of outSlots) {
        const cell = cells[slot];
        if (cell) {
          start(
            cell,
            [
              { transform: "translate(0px, 0px)", opacity: 1 },
              { transform: "translate(0px, 8px)", opacity: 0 },
            ],
            { duration: T.gatherIn, easing: ease, fill: "forwards" },
          );
        }
      }
      await wait(T.dropHold);
      if (!alive()) return;

      // `pool` holds slot positions in the same order lib/raffle.ts holds the eligible ticket
      // indices, so a pick index out of the trace addresses the same ticket the real draw removed.
      let pool = poolSlots;
      const place = (from: number[], to: number[]) => {
        for (const [k, slot] of to.entries()) {
          const cell = cells[slot];
          if (!cell) continue;
          const was = from.indexOf(slot);
          const fromX = (was < 0 ? slot : was) * stepPx - slot * stepPx;
          start(
            cell,
            [
              { transform: `translateX(${fromX}px)` },
              { transform: `translateX(${k * stepPx - slot * stepPx}px)` },
            ],
            { duration: T.gatherIn, easing: ease, fill: "forwards" },
          );
        }
      };
      place(
        cells.map((_, i) => i),
        pool,
      );
      await wait(T.compactHold);
      if (!alive()) return;

      if (cursor) cursor.style.opacity = "1";

      for (const [round, step] of trace.entries()) {
        // A trace from another raffle, or one out of step with the pool on screen, would walk the
        // cursor off the end of the strip. Stop instead: the record below is still correct and
        // still says what was drawn, which is better than a cursor pointing at nothing.
        if (step.pick >= pool.length) break;
        const durations = cursorDurations(step.pick);
        const total = durations.reduce((a, b) => a + b, 0);
        const frames: Keyframe[] = [];
        let acc = 0;
        for (const [k, d] of durations.entries()) {
          frames.push({ transform: `translateX(${k * stepPx}px)`, offset: Math.min(1, acc / total) });
          acc += d;
        }
        frames.push({ transform: `translateX(${step.pick * stepPx}px)`, offset: 1 });

        if (cursor) {
          await run(cursor, frames, { duration: total, easing: "steps(1, end)", fill: "forwards" });
          if (!alive()) return;
        }

        const slot = pool[step.pick];
        const ticket = RAFFLE.tickets[slot];
        setDrawn((d) => [...d, step.winner]);
        setPickStatus(
          `Ticket ${pad2(ticket?.index ?? step.winner)} drawn at pool index ${step.pick} of ${step.poolBefore}`,
        );
        setFigure({
          value: pad2(step.winner),
          label: `drawn at pool index ${step.pick} of ${step.poolBefore}`,
        });
        await wait(T.winHold);
        if (!alive()) return;

        if (round < trace.length - 1) {
          const cell = cells[slot];
          if (cell) {
            start(
              cell,
              [
                { transform: `translateX(${step.pick * stepPx - slot * stepPx}px)`, opacity: 1 },
                {
                  transform: `translateX(${step.pick * stepPx - slot * stepPx}px) translateY(-14px)`,
                  opacity: 0,
                },
              ],
              { duration: T.gatherIn, easing: ease, fill: "forwards" },
            );
          }
          const before = pool;
          pool = pool.filter((x) => x !== slot);
          await wait(T.removeHold);
          if (!alive()) return;
          place(before, pool);
          setPickStatus(
            `${pool.length} tickets remain in the pool. The next pick cannot repeat the last one.`,
          );
          setFigure({ value: String(pool.length), label: "remain in the pool" });
          await wait(T.regroupHold);
          if (!alive()) return;
        }
      }

      if (cursor) cursor.style.opacity = "0";
      await wait(T.cursorOut);
      if (!alive()) return;

      /* ACT 4. THE RESULT. */
      setAct(4);
      setFigure(REST_FIGURE);
      await wait(T.result);
      if (!alive()) return;
      setPhase("done");
    })();

    return () => {
      tokenRef.current += 1;
      window.removeEventListener("resize", onResize);
      for (const animation of live) animation.cancel();
      live.clear();
    };
    // `reset` is stable and `trace` is the record; neither changes under a running sequence.
  }, [phase, trace, reset]);

  /**
   * RECOMPUTE IT. Not a demonstration of a computation, the computation: SHA-256 over the public
   * nonces and the chain value, in this tab, right now, and then a comparison against what the
   * record says. Nothing is read back out of the record except the two lines being compared.
   */
  const recompute = useCallback(() => {
    const nonces = RAFFLE.tickets.filter((t) => t.nonce !== null).map((t) => t.nonce as string);
    if (nonces.length === 0 || !RAFFLE.chainSeed) {
      setAudit([
        "No nonce was ever revealed, so there is no seed to recompute.",
        "That is what void means, and it is the correct answer rather than a failure.",
      ]);
      return;
    }
    const seed = deriveSeed(RAFFLE.config.id, nonces, RAFFLE.chainSeed);
    const steps = deriveWinnerTrace(SUMMARY.eligible, seed, RAFFLE.config.winners);
    const winners = steps.map((s) => s.winner);
    const matches =
      winners.length === RAFFLE.winningTickets.length &&
      winners.every((w, i) => w === RAFFLE.winningTickets[i]);
    setAudit([
      `recomputed seed     ${seed}`,
      `recorded seed       ${SEED}`,
      `recomputed winners  ${winners.join(", ")}`,
      `recorded winners    ${RAFFLE.winningTickets.join(", ")}`,
      `matches             ${matches ? "yes" : "no"}`,
    ]);
  }, []);

  const status =
    phase === "playing" ? ACT_NAMES[act] : phase === "done" ? "Settled. Nothing loops after this." : "The record";

  return (
    <section
      className="inv border-y border-rule bg-panel text-fg"
      aria-label={`The recorded draw of raffle ${SERIAL}`}
    >
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2.5 border-b border-rule px-pad py-4">
        <span className="label border border-bound px-2 py-1 text-fg-2">
          Recorded. Raffle {SERIAL}, settled {SETTLED_STAMP}
        </span>
        <span className="label text-fg-3" aria-live="polite">
          {status}
        </span>
        <span aria-hidden="true" className="hidden min-w-0 flex-1 sm:block" />
        {reduced ? (
          <span className={NOTE}>
            Motion is removed here rather than slowed. Every fact the replay carries is printed
            below as text, because the replay was only ever an argument about a hash.
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
            <span className="label text-fg-3">
              About {seconds} seconds. No spin, no near miss, no acceleration.
            </span>
            <button type="button" className={BUTTON_PRIMARY} onClick={play}>
              {phase === "idle" ? "Replay the draw" : "Replay again"}
            </button>
            {phase === "idle" ? null : (
              <button type="button" className={BUTTON} onClick={reset}>
                {phase === "done" ? "Show the record" : "Stop"}
              </button>
            )}
          </span>
        )}
      </div>

      <div className="grid gap-[clamp(20px,3vw,44px)] px-pad py-[clamp(18px,3vw,34px)] min-[980px]:grid-cols-[minmax(0,1.6fr)_minmax(230px,1fr)]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
          {phase === "idle" ? (
            <Record poster={poster} trace={trace} />
          ) : (
            <>
              {/* ACT 0 */}
              <Act on={act === 0}>
                <Caption>
                  Reveals closed on {SETTLED_STAMP}. {SUMMARY.revealed} of {SUMMARY.sold} holders
                  revealed. {SUMMARY.outstanding} bonds forfeited.
                </Caption>
                <p className={NOTE}>
                  Nothing that follows is simulated forward. Every figure is read out of the
                  settled record and recomputed in this tab as it is shown.
                </p>
              </Act>

              {/* ACT 1 */}
              <Act on={act === 1}>
                <Caption>
                  The {ARRIVALS.length} nonces that were revealed, in the order the record has them
                  arriving. Then the protocol sorts them, because a hash of an ordered list would
                  pay whoever reveals last.
                </Caption>
                <div
                  ref={noncesRef}
                  className="relative"
                  style={
                    {
                      "--nrow": "clamp(17px, 1.9vw, 24px)",
                      height: `calc(${ARRIVALS.length} * var(--nrow))`,
                    } as CSSProperties
                  }
                >
                  {ARRIVALS.map((t) => (
                    <div
                      key={t.index}
                      data-nonce={t.nonce ?? ""}
                      className="stream absolute top-0 left-0 flex h-[var(--nrow)] items-baseline gap-[clamp(8px,1vw,16px)] whitespace-nowrap text-[clamp(9px,1.3vw,16px)] text-fg will-change-transform"
                    >
                      <b className="label-b font-normal text-fg-2">{pad2(t.index)}</b>
                      <span>{t.nonce}</span>
                    </div>
                  ))}
                </div>
              </Act>

              {/* ACT 2 */}
              <Act on={act === 2}>
                <Caption>
                  One preimage. The domain string, the raffle id, every sorted nonce, and the chain
                  value that only exists at the draw.
                </Caption>
                <Preimage />
                <p className={`${NOTE} mt-3.5`}>
                  The last {CHAIN_SEED.length} characters are the chain value. It is the only
                  ingredient nobody could know in advance, which is why staying silent to move the
                  seed is a bet a griefer cannot price.
                </p>
                <div className="relative mt-[18px] overflow-hidden bg-recess p-4">
                  <div className="digest text-[clamp(10px,1.5vw,20px)] leading-[1.6] text-fg">
                    {seedText || "…"}
                  </div>
                  <div
                    ref={bladeRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 origin-left scale-x-0 bg-event will-change-transform"
                  />
                </div>
              </Act>

              {/* ACT 3 */}
              <Act on={act === 3}>
                <Caption>
                  {RAFFLE.config.supply} tickets. Tickets {SILENT_LIST} never revealed, so they are
                  not in the pool and no seed material came from them.
                </Caption>
                <div ref={stripRef} className="relative mt-[22px] flex gap-[2px]">
                  {RAFFLE.tickets.map((t) => {
                    const won = drawn.includes(t.index);
                    return (
                      <div
                        key={t.index}
                        data-pick={t.index}
                        className={`label-b relative flex h-[clamp(58px,13vh,116px)] min-w-0 flex-1 items-start justify-start border p-1 text-[clamp(8px,1vw,13px)] font-normal will-change-transform ${
                          won ? "border-cell-won bg-cell-won text-on-won" : "border-bound bg-panel text-fg-2"
                        }`}
                      >
                        {/* Twenty two-digit serials cannot fit across a 350px measure: below
                            760px the cell is the mark and the status line under it names the
                            ticket, rather than twenty labels overprinting each other. */}
                        <span className="relative z-[1] max-[759px]:hidden">{pad2(t.index)}</span>
                        {t.nonce ? (
                          <em
                            aria-hidden="true"
                            className="absolute inset-x-0 bottom-0 h-[36%] bg-event not-italic"
                          />
                        ) : null}
                      </div>
                    );
                  })}
                  <div
                    ref={cursorRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 left-0 border-2 border-event opacity-0 will-change-transform"
                  />
                </div>
                <div className="label mt-[22px] text-fg-2">{pickStatus}</div>
                <div className={`${WELL} mt-5`}>{SEED}</div>
                <p className={`${NOTE} mt-3`}>
                  The cursor is not searching. It walks to the index one 48-bit sample of this seed
                  reduces to, modulo the pool size, and stops there.
                </p>
              </Act>

              {/* ACT 4 */}
              <Act on={act === 4}>
                <Caption>
                  Sampling without replacement, exactly as deriveWinners does it. The pool shrank
                  between the two picks, which is why the second winner could not be the first.
                </Caption>
                <CeremonyWinners />
                <div className="mt-[clamp(18px,2.4vw,28px)]">
                  <TraceRows trace={trace} />
                </div>
              </Act>
            </>
          )}
        </div>

        <aside className="self-start">
          <div className="monument text-[clamp(3rem,6.4vw,5.5rem)] text-event">{figure.value}</div>
          <div className="label mt-2.5 mb-[18px] text-fg-3">{figure.label}</div>
          {ledger}
        </aside>
      </div>

      <div className="border-t border-rule px-pad py-4">
        <button type="button" className={BUTTON} onClick={recompute}>
          Recompute it
        </button>
        {audit ? (
          <pre className="mono mt-3.5 w-fit max-w-full overflow-x-auto bg-recess p-3.5 text-sm text-fg">
            {audit.join("\n")}
          </pre>
        ) : null}
        <p className={`${NOTE} mt-3`}>
          Recompute runs SHA-256 over the {SORTED_NONCES.length} public nonces and the chain value
          in this tab, then compares the result with the record. The draw is randomized. It is not
          unbiasable: moving it would take a party who both produces the block the chain value
          comes from and reveals last.
        </p>
      </div>
    </section>
  );
}

/**
 * One act. All five occupy the same grid cell, so the stage is as tall as the tallest of them and
 * does not resize when they swap. A hidden act still contributes to the grid's size, which is why
 * this costs no measurement and no reserved height.
 *
 * The swap has no opacity in it at all. The preview crossfaded two absolutely positioned
 * paragraphs through each other for 200ms, four times per replay: half a second of double
 * exposure in the one part of the product whose job is to be legible as an argument.
 */
function Act({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <div
      className="col-start-1 row-start-1"
      style={{ visibility: on ? "visible" : "hidden", pointerEvents: on ? "auto" : "none" }}
      aria-hidden={on ? undefined : true}
      inert={on ? undefined : true}
    >
      {children}
    </div>
  );
}
