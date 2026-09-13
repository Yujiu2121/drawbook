import Link from "next/link";

import { MusterBands } from "@/components/cell";
import { Ceremony, CeremonyLedger, CeremonyWinners } from "@/components/ceremony";
import { Countdown } from "@/components/countdown";
import { Muster } from "@/components/landing/fold";
import { RaffleRowCells, rowContainerProps, rowLabel } from "@/components/row";
import { activeDeadline, isLive } from "@/lib/cell";
import { MOCK_RAFFLES } from "@/lib/mock-raffles";
import {
  auditSeed,
  deriveWinnerTrace,
  formatRLO,
  summarize,
  type Raffle,
} from "@/lib/raffle";

export const metadata = {
  title: "Drawbook: nobody picks the winner",
  description:
    "On-chain raffles on Rialo testnet. Every ticket buyer commits a secret, the winner falls out of all of them at once, and anyone can recompute it.",
};

/**
 * THE LANDING.
 *
 * Five surfaces and no illustration: the fold, the ceremony, three step slabs, the argument, the
 * record. The fold is the whole pitch. Every ticket in Drawbook is on the screen as a cell, the
 * cells sweep in, and then the ones that fall inside the sentence stand aside so the sentence can
 * be read out of the space they leave. The headline and the product are one object, which is the
 * claim the old seven-section landing had to make in prose.
 *
 * EVERYTHING ON THIS PAGE IS A SERVER COMPONENT EXCEPT TWO ISLANDS. `<Muster>` arms and releases
 * the opening; `<Countdown>` is the one figure that changes under the reader. The 112 cells, the
 * five rows, every figure and the whole ceremony poster ship as HTML.
 *
 * NOT ONE QUANTITY BELOW IS A LITERAL. Every figure is a reduction over MOCK_RAFFLES through
 * `summarize`, computed at render time, which is the only way the footer note gets to say every
 * figure is read out of lib/mock-raffles.ts and be telling the truth.
 *
 * THE AGGREGATE THAT WAS FIXED RATHER THAN PORTED. The design this ports prints "In the pools
 * 40.75 RLO", the sum of every raffle's pool. It is false as worded: the live raffles hold 33.05,
 * while raffle 0004 has already paid 6.10 out to its two winners and raffle 0005 has already
 * refunded 1.60. 7.70 of that 40.75 is money that has left. Worse, the line appears twice, the
 * second time directly under a note vouching that every figure comes out of the record. It is
 * split here into what is still in the pools and what has already gone, which is the more
 * interesting half anyway. The second label is "Paid and refunded" rather than the plan's
 * "Settled" because this same line already carries a "Settled" row counting drawn raffles, and
 * two rows reading SETTLED 1 and SETTLED 7.70 would be a worse defect than the one being fixed.
 */

/** The sentence. Sixteen characters of measure, four words, one rise each. */
const MANIFESTO = "Nobody picks the winner.";

/* ------------------------------------------------------------------- the record */

function sum(raffles: readonly Raffle[], of: (r: Raffle) => number): number {
  return raffles.reduce((total, r) => total + of(r), 0);
}

/**
 * Counted out of the record, once, at render time.
 *
 * Live and settled are the same split the miniboard makes, so the figure line and the two
 * miniboard headers can never give three different answers to how many raffles are finished. A
 * void raffle settled nothing, so it is counted apart from the drawn one rather than added to it.
 */
const LIVE = MOCK_RAFFLES.filter(isLive).sort(
  (a, b) => Date.parse(activeDeadline(a)) - Date.parse(activeDeadline(b)),
);
const RECORD = MOCK_RAFFLES.filter((r) => !isLive(r));

const TOTALS = {
  raffles: MOCK_RAFFLES.length,
  tickets: sum(MOCK_RAFFLES, (r) => r.config.supply),
  sold: sum(MOCK_RAFFLES, (r) => summarize(r).sold),
  livePool: sum(LIVE, (r) => summarize(r).pool),
  gonePool: sum(RECORD, (r) => summarize(r).pool),
  drawn: MOCK_RAFFLES.filter((r) => r.phase === "drawn").length,
  voided: MOCK_RAFFLES.filter((r) => r.phase === "void").length,
  liveTickets: sum(LIVE, (r) => r.config.supply),
  liveSold: sum(LIVE, (r) => summarize(r).sold),
};

const FIGURES: [string, string][] = [
  ["Raffles", String(TOTALS.raffles)],
  ["Tickets", String(TOTALS.tickets)],
  ["Sold", String(TOTALS.sold)],
  ["In the live pools", `${formatRLO(TOTALS.livePool)} RLO`],
  ["Paid and refunded", `${formatRLO(TOTALS.gonePool)} RLO`],
  ["Settled", String(TOTALS.drawn)],
  ["Void", String(TOTALS.voided)],
];

/**
 * The figure line, twice: once under the field and once in the record block at the foot.
 *
 * A description list, because that is what it is. The label carries the 11px uppercase instance
 * and the value overrides its tracking, since `figure` sets a width axis and a weight but not a
 * letter-spacing and would otherwise inherit the label's 0.14em.
 */
function Figures() {
  return (
    <dl className="label m-0 flex flex-wrap gap-x-[26px] gap-y-[6px]">
      {FIGURES.map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-2">
          <dt className="text-fg-3">{key}</dt>
          <dd className="figure m-0 text-[15px] tracking-normal">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ----------------------------------------------------------------- the miniboard */

/**
 * A miniboard row.
 *
 * It is built from `RaffleRowCells` inside a plain `<Link>` rather than from `RaffleRow`, for one
 * reason: the container needs `data-rid` so the field above can drive it. Moving a pointer onto a
 * band opens that raffle's row, because a band and a row are the same object at two scales, and
 * the copy on this page says so.
 *
 * It is deliberately NOT `<RowLink>`. That component writes the current scrollY into
 * lib/nav-memory so the board can be put back where it was left, and a landing row writing the
 * landing's offset into it would hand /raffles a scroll position from a different document.
 */
function MiniRow({ raffle }: { raffle: Raffle }) {
  const live = isLive(raffle);

  return (
    <Link
      href={`/raffle/${raffle.config.id}`}
      data-rid={raffle.config.id}
      aria-label={rowLabel(raffle)}
      {...rowContainerProps(raffle, true)}
    >
      <RaffleRowCells
        raffle={raffle}
        mini
        countdown={
          <Countdown deadline={live ? activeDeadline(raffle) : raffle.config.revealDeadline} live={live} />
        }
      />
    </Link>
  );
}

/** The two heads over the two halves of the miniboard. Same shape, opposite surfaces. */
function MiniHead({ left, right }: { left: string; right: string }) {
  return (
    <div className="label flex flex-wrap justify-between gap-4 py-[11px] text-fg-3">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

/* ------------------------------------------------------------- the ceremony host */

/**
 * The settled raffle the replay walks, and the walk itself.
 *
 * `deriveWinnerTrace` is the draw loop inside `deriveWinners`, lifted out and exported so the
 * cursor's two stopping points and the pool size it steps through at each one are read out of
 * lib/raffle.ts rather than copied into the island as a constant. The design this ports carried
 * `pickIndices = [14, 8]` by hand, which is a figure that goes stale silently the first time a
 * nonce changes.
 *
 * The trace is computed here, on the server, and handed in: the island never derives anything.
 */
/*
  components/ceremony.tsx pins raffle 0004 and exports `CEREMONY_RAFFLE_ID`, and that constant is
  deliberately NOT imported here. Every export of a module carrying the client directive reaches a
  Server Component as a client reference rather than as its value, so `raffleById(CEREMONY_RAFFLE_ID)`
  returned undefined, the guard below went false and the entire ceremony vanished from the page with
  no error, no warning and a build that passed. Found by rendering and counting sections. The settled
  raffle is found in the record instead, which is where it lives anyway. The two-word directive is
  spelled around rather than out, because the final sweep counts the files that mention it.
*/
const CEREMONY = MOCK_RAFFLES.find((r) => r.phase === "drawn") ?? null;
const CEREMONY_SEED = CEREMONY ? auditSeed(CEREMONY) : null;
const TRACE =
  CEREMONY && CEREMONY_SEED
    ? deriveWinnerTrace(
        summarize(CEREMONY).eligible,
        CEREMONY_SEED,
        CEREMONY.config.winners,
      )
    : [];

/* -------------------------------------------------------------------- the steps */

/**
 * Commit, reveal, draw, in that order, because that is the order they happen in and each one is
 * only safe because of the one before it.
 *
 * Each caption is checked against the function that implements it: `commitmentFor` binds the
 * holder address, the raffle and the ticket index into the hashed string; `revealMatches`
 * recomputes that hash from the posted nonce; `deriveSeed` sorts the nonces before hashing, which
 * is the whole of the answer to "what stops the last revealer choosing the winner".
 */
const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "Commit",
    body:
      "Every buyer publishes a hash of a secret nonce, bound to their address, this raffle and this exact ticket. Nobody, including the creator, can read the number that decides the draw.",
  },
  {
    n: "02",
    title: "Reveal",
    body:
      "When the sale closes, holders post the nonce itself. The chain checks it against the commitment already recorded. A holder who stays silent forfeits their reveal bond into the pool.",
  },
  {
    n: "03",
    title: "Draw",
    body:
      "The seed is the hash of the domain, the raffle id, every revealed nonce in sorted order, and one value from the chain that arrives last. Sorted, so revealing late buys nothing.",
  },
];

/* ---------------------------------------------------------------------- the page */

export default function LandingPage() {
  return (
    <main className="pt-mast">
      {/* ----------------------------------------------------------------- the fold */}
      <section aria-label="Every ticket in Drawbook">
        <Muster sentence={MANIFESTO} bands={<MusterBands raffles={MOCK_RAFFLES} />} figures={<Figures />}>
          <div className="mt-[clamp(12px,1.8vh,20px)] border-t border-bound">
            {/* The record is a slab here too, not only on /raffles. Inversion is how this system
                says a raffle has left the floor, and it cannot mean that on only one screen. It
                bleeds back out to the viewport edge, because the fold's own gutter is already
                paid by the wrapper around it. */}
            {RECORD.length > 0 ? (
              <div className="inv mx-[calc(var(--pad)*-1)] bg-panel px-pad text-fg">
                <MiniHead
                  left="The record"
                  right={`${TOTALS.drawn} settled · ${TOTALS.voided} void`}
                />
                <div className="rows [&>a:last-child]:border-b-0">
                  {RECORD.map((r) => (
                    <MiniRow key={r.config.id} raffle={r} />
                  ))}
                </div>
              </div>
            ) : null}

            <MiniHead
              left={`On the floor · the same ${TOTALS.tickets} cells as the field above`}
              right={`${LIVE.length} live · ${TOTALS.liveSold} of ${TOTALS.liveTickets} tickets gone`}
            />
            <div className="rows">
              {LIVE.map((r) => (
                <MiniRow key={r.config.id} raffle={r} />
              ))}
            </div>
            <p className="label py-[11px] text-fg-3">
              Each band above is one raffle&rsquo;s tickets, and so is the row beside it. Open
              either and those cells become the page.
            </p>
          </div>
        </Muster>
      </section>

      {/*
        THE CEREMONY. components/ceremony.tsx owns the section, the five acts and the controls;
        this page owns what is printed inside it and still readable with no script. The landing
        hands in the winners, because nothing else on this page prints them, and the settled
        ledger. The replay only ever replays this history: nothing here settles a live raffle to
        manufacture a result.
      */}
      {CEREMONY && TRACE.length > 0 ? (
        <Ceremony poster={<CeremonyWinners />} ledger={<CeremonyLedger />} trace={TRACE} />
      ) : null}

      {/* ----------------------------------------------------------------- the steps */}
      <section className="inv bg-panel text-fg" aria-label="How a Drawbook raffle works">
        {STEPS.map((step, i) => (
          <div
            key={step.n}
            className={`grid grid-cols-[minmax(0,1fr)] items-end gap-[14px] px-pad py-[clamp(32px,6vw,72px)] min-[900px]:grid-cols-[minmax(0,42%)_minmax(0,1fr)] min-[900px]:gap-[clamp(28px,5vw,72px)] ${
              i < STEPS.length - 1 ? "border-b border-rule" : ""
            }`}
          >
            <div className="monument text-monument text-event">{step.n}</div>
            <div>
              <h3 className="m-0 font-serif text-title">{step.title}</h3>
              <p className="m-0 mt-[14px] max-w-[54ch] text-lg text-fg-2">{step.body}</p>
            </div>
          </div>
        ))}
      </section>

      {/* -------------------------------------------------------------- the argument */}
      <section
        className="grid gap-[clamp(22px,3vw,56px)] px-pad py-[clamp(36px,7vw,88px)] min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
        aria-labelledby="rialo-heading"
      >
        <div className="max-w-[52ch]">
          <h2 id="rialo-heading" className="m-0 mb-[0.5em] font-serif text-display">
            No bot fires the draw.
          </h2>
          <p className="m-0 text-lg text-fg-2">
            On Rialo the draw is the body of a reactive transaction whose predicate is an absolute
            instant. The reveal deadline passes and the program runs. There is no keeper, no cron,
            no relayer to pay and nobody who can choose not to press it.
          </p>
        </div>

        <div className="max-w-[52ch]">
          <h2 className="label m-0 mb-[16px] text-fg-3">What it does not claim</h2>
          <p className="m-0 text-lg text-fg-2">
            This is randomized. It is not a claim that the draw cannot be biased. Rialo&rsquo;s own
            randomness is a bare 64-bit number with no proof attached, which is why the seed is
            built out of the participants&rsquo; nonces and the chain value is only mixed in on top.
          </p>
          <p className="m-0 mt-[18px] text-lg text-fg-2">
            Withholding a reveal does move the seed. Two things blunt it: the chain value is only
            known at the draw, so a griefer is betting blind, and the bond they forfeit is the price
            of that bet. Biasing the draw needs a party who both produces blocks and reveals last.
            That is a real limit and it is stated here rather than buried.
          </p>
        </div>
      </section>

      {/* ----------------------------------------------------------------- the record */}
      <section className="inv bg-panel px-pad py-[clamp(36px,7vw,88px)] text-fg" aria-labelledby="record-heading">
        <h2 id="record-heading" className="label m-0 mb-[14px] text-fg-3">
          The record, right now
        </h2>
        <Figures />
        <p className="m-0 mt-[22px] max-w-[60ch] text-sm text-fg-3">
          Every figure on this page is read out of lib/mock-raffles.ts at render time, whose settled
          raffles are settled by a real call to drawRaffle. Nothing rolls on an odometer, because
          nothing here is connected to a node.
        </p>
      </section>
    </main>
  );
}
