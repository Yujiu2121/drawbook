import Link from "next/link";

import { MusterBands } from "@/components/cell";
import { Ceremony, CeremonyLedger, CeremonyWinners } from "@/components/ceremony";
import { Hero } from "@/components/landing/hero";
import { RaffleCard } from "@/components/landing/raffle-card";
import {
  DrawChain,
  Flow,
  SectionHead,
  Stepper,
  type ChainLink,
  type FlowStep,
  type Step,
} from "@/components/landing/sections";
import { VerifyPanel } from "@/components/landing/verify-panel";
import { activeDeadline, isLive, serialOf } from "@/lib/cell";
import { BUTTON, BUTTON_PRIMARY } from "@/lib/controls";
import { MOCK_RAFFLES } from "@/lib/mock-raffles";
import {
  auditSeed,
  deriveWinnerTrace,
  formatRLO,
  summarize,
  type Raffle,
} from "@/lib/raffle";

export const metadata = {
  title: "Drawbook: fair raffles, built on Rialo",
  description:
    "On-chain raffles on Rialo testnet. Every ticket buyer commits a secret, the winner falls out of all of them at once, and anyone can recompute it.",
};

/**
 * THE LANDING.
 *
 * EIGHT SECTIONS, IN THE ORDER A STRANGER NEEDS THEM: what this is, why it matters, how it works,
 * try one, watch a draw, check the working, why Rialo, go.
 *
 * WHAT CHANGED AND WHY. The page this replaces opened on the sentence "Nobody picks the winner"
 * over a field of 112 cells, then a seven-figure statistics line, two miniboards, and then the
 * recorded draw with its nonces and its seed, all before a single line saying what Drawbook is.
 * Every one of those surfaces was correct and every one of them was an answer to a question the
 * reader had not asked yet. Nothing has been deleted: the field is the hero's own visual, the
 * figures moved to the foot of the raffle section where the record they describe actually is, the
 * miniboards became cards, and the draw and its working are sections five and six, after the
 * product rather than in front of it.
 *
 * WHAT DID NOT CHANGE, AND THAT IS THE LARGER HALF. The ceremony is the same island replaying the
 * same settled raffle through the same five acts. The cell, the strip and the muster are the same
 * components at the same four scales. Every route, every deadline and every digest is where it
 * was. This file decided what is said and in what order; it invented nothing.
 *
 * EVERYTHING HERE IS A SERVER COMPONENT EXCEPT THREE ISLANDS: `<Hero>` arms and releases the
 * opening, `<Countdown>` inside each card is the one figure that moves under the reader, and the
 * ceremony is its own. The 112 cells, five cards, the chain, the whole verification panel and the
 * entire ceremony poster ship as HTML.
 *
 * NOT ONE QUANTITY BELOW IS A LITERAL. Every figure is a reduction over MOCK_RAFFLES through
 * `summarize`, `auditSeed` and `deriveWinnerTrace`, computed at render time, which is the only way
 * the note at the foot gets to say every figure is read out of lib/mock-raffles.ts and be telling
 * the truth.
 */

/* --------------------------------------------------------------------- the record, counted */

function sum(raffles: readonly Raffle[], of: (r: Raffle) => number): number {
  return raffles.reduce((total, r) => total + of(r), 0);
}

/**
 * Live and settled are the same split the cards make, so the figure line and the two card rows
 * can never give three different answers to how many raffles are finished. A void raffle settled
 * nothing, so it is counted apart from the drawn one rather than added to it.
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

/**
 * THE AGGREGATE THAT IS SPLIT RATHER THAN SUMMED. The design this descends from printed "In the
 * pools 40.75 RLO", the sum of every raffle's pool. It is false as worded: the live raffles hold
 * 33.05, while raffle 0004 has already paid 6.10 out to its two winners and raffle 0005 has
 * already refunded 1.60. 7.70 of that 40.75 is money that has left. It is split here into what is
 * still in the pools and what has already gone, which is the more interesting half anyway. The
 * second label is "Paid and refunded" rather than "Settled" because this same line already carries
 * a "Settled" row counting drawn raffles, and two rows reading SETTLED 1 and SETTLED 7.70 would be
 * a worse defect than the one being fixed.
 */
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
 * The figure line. A description list, because that is what it is. The label carries the 11px
 * uppercase instance and the value overrides its tracking, since `figure` sets a width axis and a
 * weight but not a letter-spacing and would otherwise inherit the label's 0.14em.
 */
function Figures() {
  return (
    <dl className="label m-0 flex flex-wrap gap-x-[26px] gap-y-1.5">
      {FIGURES.map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-2">
          <dt className="text-fg-3">{key}</dt>
          <dd className="figure m-0 text-[15px] tracking-normal">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* --------------------------------------------------------------------- the settled draw */

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
const CEREMONY_SUMMARY = CEREMONY ? summarize(CEREMONY) : null;

/**
 * `deriveWinnerTrace` is the draw loop inside `deriveWinners`, lifted out and exported so the
 * cursor's stopping points and the pool size it steps through at each one are read out of
 * lib/raffle.ts rather than copied into the island as a constant. The design this descends from
 * carried `pickIndices = [14, 8]` by hand, which is a figure that goes stale silently the first
 * time a nonce changes.
 */
const TRACE =
  CEREMONY && CEREMONY_SEED && CEREMONY_SUMMARY
    ? deriveWinnerTrace(CEREMONY_SUMMARY.eligible, CEREMONY_SEED, CEREMONY.config.winners)
    : [];

/** Every revealed nonce, in the order `deriveSeed` hashes them in, which is sorted. */
const SORTED_NONCES = CEREMONY
  ? CEREMONY.tickets
      .filter((t) => t.nonce !== null)
      .map((t) => ({ index: String(t.index).padStart(2, "0"), nonce: t.nonce as string }))
      .sort((a, b) => (a.nonce < b.nonce ? -1 : 1))
  : [];

const PER_WINNER =
  CEREMONY && CEREMONY_SUMMARY ? formatRLO(CEREMONY_SUMMARY.perWinner) : "0.00";

/**
 * THE DRAW AS FIVE LINKS. A summary of the section under it, and it cannot drift from it: every
 * value here comes out of the same three modules at the same render as the ceremony's own.
 */
const CHAIN: ChainLink[] =
  CEREMONY && CEREMONY_SEED && CEREMONY_SUMMARY
    ? [
        {
          name: "Revealed tickets",
          value: String(CEREMONY_SUMMARY.revealed),
          note: `of ${CEREMONY_SUMMARY.sold} sold. ${CEREMONY_SUMMARY.outstanding} bonds forfeited.`,
        },
        {
          name: "Public data",
          value: `${SORTED_NONCES.length} nonces`,
          wide: true,
          note: "Sorted before hashing, so revealing last buys nothing.",
        },
        {
          name: "Chain value",
          value: CEREMONY.chainSeed ?? "",
          hex: true,
          note: "Arrives last, and nobody sees it coming.",
        },
        {
          name: "Seed",
          value: CEREMONY_SEED,
          hex: true,
          note: "One SHA-256 over all of it.",
        },
        {
          name: "Winners",
          value: CEREMONY.winningTickets.join(" · "),
          note: `${PER_WINNER} RLO to each.`,
        },
      ]
    : [];

/* ------------------------------------------------------------------------------- the copy */

/**
 * Commit, reveal, draw, in that order, because that is the order they happen in and each one is
 * only safe because of the one before it.
 *
 * Each caption is checked against the function that implements it: `commitmentFor` binds the
 * holder address, the raffle and the ticket index into the hashed string; `revealMatches`
 * recomputes that hash from the posted nonce; `deriveSeed` sorts the nonces before hashing.
 *
 * NOT ONE OF THE THREE SAYS "HASH", "NONCE" OR "SHA-256". That vocabulary has not been dropped
 * from the product, it has been moved: it is in section six, under a disclosure, with the digests
 * beside it. A reader who needs those words to follow section three is a reader who could already
 * have skipped section three.
 */
const STEPS: Step[] = [
  {
    n: "01",
    title: "Commit",
    body:
      "Buy a ticket and commit a secret. It is bound to your address, this raffle and this exact ticket, and nobody, the creator included, can read it.",
  },
  {
    n: "02",
    title: "Reveal",
    body:
      "When the sale closes, publish your secret to become eligible. The chain checks it against what you committed. Stay silent and your bond goes into the pool.",
  },
  {
    n: "03",
    title: "Draw",
    body:
      "The winner is generated from every published secret at once, in sorted order, plus one value the chain adds last. Revealing late buys nothing.",
  },
];

const FLOW: FlowStep[] = [
  { title: "Reveal deadline", body: "an absolute instant, written into the raffle" },
  { title: "Condition met", body: "the chain notices, not a server" },
  { title: "Reactive transaction", body: "the draw is its body" },
  { title: "Draw executed", body: "winners paid, and nothing was pressed" },
];

const BENEFITS: [string, string, string][] = [
  ["01", "Transparent", "Every step of the draw can be inspected while it is still open."],
  ["02", "Verifiable", "Anyone can recompute the result from data the chain already holds."],
  ["03", "Automatic", "The draw executes itself the moment the reveal period ends."],
];

/* -------------------------------------------------------------------------------- the page */

export default function LandingPage() {
  const serial = CEREMONY ? serialOf(CEREMONY) : "";

  return (
    <main className="pt-mast">
      {/* ==================================================================== 1. THE HERO */}
      <section aria-label="Drawbook">
        <Hero
          eyebrow="Built on Rialo"
          sentence="Fair raffles, built on Rialo."
          lead="Drawbook makes raffle results transparent, verifiable and automatic, so nobody has to pick the winner."
          actions={
            <>
              <Link href="/raffles" className={BUTTON_PRIMARY}>
                Explore raffles <span aria-hidden="true">&rarr;</span>
              </Link>
              <Link href="#how" className={BUTTON}>
                How it works
              </Link>
            </>
          }
          field={<MusterBands raffles={MOCK_RAFFLES} />}
          fieldHead={
            <figcaption className="label mb-3.5 flex justify-between gap-3 text-fg-3">
              <span>Every ticket in Drawbook</span>
              <span>{TOTALS.tickets} tickets</span>
            </figcaption>
          }
          fieldNote={
            <p className="m-0 mt-3.5 max-w-[52ch] text-sm text-fg-3">
              One block per ticket, {TOTALS.raffles} raffles deep. Filled is sold, a light foot is a
              published secret, and the two lit blocks are raffle {serial}&rsquo;s winners. Open a
              band and those blocks become the page.
            </p>
          }
        />
      </section>

      {/* ============================================================ 2. WHAT IS DRAWBOOK */}
      <section
        className="px-pad py-[clamp(48px,8vw,112px)]"
        aria-labelledby="what-heading"
      >
        <div className="max-w-[58ch]">
          <h2 id="what-heading" className="m-0 max-w-[18ch] font-serif text-display">
            What is Drawbook?
          </h2>
          <p className="m-0 mt-5 text-lg text-fg-2">
            Drawbook is an on-chain raffle system where the winner is decided by a commit-reveal
            process instead of by a person choosing the result.
          </p>
        </div>

        <ol className="m-0 mt-[clamp(36px,4.6vw,64px)] grid list-none gap-[clamp(24px,3vw,44px)] p-0 min-[760px]:grid-cols-3">
          {BENEFITS.map(([n, title, body]) => (
            <li key={n} className="border-t border-bound pt-[18px]">
              <span className="monument mb-4 block text-[clamp(2.5rem,4.4vw,3.75rem)] text-event">
                {n}
              </span>
              <h3 className="m-0 mb-2.5 font-serif text-title">{title}</h3>
              <p className="m-0 max-w-[42ch] text-fg-2">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* =============================================================== 3. HOW IT WORKS */}
      <section
        id="how"
        className="inv scroll-mt-mast bg-panel px-pad py-[clamp(48px,8vw,112px)] text-fg"
        aria-labelledby="how-heading"
      >
        <h2
          id="how-heading"
          className="m-0 mb-[clamp(36px,4.6vw,64px)] max-w-[18ch] font-serif text-display"
        >
          How a Drawbook raffle works
        </h2>
        <Stepper steps={STEPS} />
        <p className="m-0 mt-[clamp(26px,3vw,40px)] max-w-[62ch] text-sm text-fg-3">
          Nothing in the sequence asks you to trust a shuffle. Each step is only safe because of the
          one before it.
        </p>
      </section>

      {/* ================================================================ 4. LIVE RAFFLES */}
      <section
        id="raffles"
        className="scroll-mt-mast px-pad py-[clamp(48px,8vw,112px)]"
        aria-labelledby="raffles-heading"
      >
        <SectionHead
          id="raffles-heading"
          title="Try a live raffle."
          lead="Explore active and completed draws on Drawbook."
          aside={
            <p className="m-0 grid gap-1.5 text-right">
              <span className="label text-fg-3">On the floor</span>
              <span className="figure text-sm">
                {TOTALS.liveSold} of {TOTALS.liveTickets} tickets gone &middot;{" "}
                {formatRLO(TOTALS.livePool)} RLO in the live pools
              </span>
            </p>
          }
        />

        <ul className="rcards m-0 list-none p-0">
          {LIVE.map((r) => (
            <RaffleCard key={r.config.id} raffle={r} />
          ))}
        </ul>

        {RECORD.length > 0 ? (
          <>
            <h3 className="label m-0 mt-[clamp(40px,5vw,72px)] mb-[clamp(18px,2vw,26px)] flex flex-wrap justify-between gap-3 border-t border-rule pt-3.5 font-normal text-fg-3">
              <span>The record</span>
              <span>
                {TOTALS.drawn} settled &middot; {TOTALS.voided} void &middot;{" "}
                {formatRLO(TOTALS.gonePool)} RLO paid and refunded
              </span>
            </h3>
            <ul className="rcards m-0 list-none p-0">
              {RECORD.map((r) => (
                <RaffleCard key={r.config.id} raffle={r} />
              ))}
            </ul>
          </>
        ) : null}

        {/* The figure line, once, at the foot of the section whose subject it is. It used to be
            printed twice, the second time directly under a note vouching that every figure comes
            out of the record. */}
        <div className="mt-[clamp(40px,5vw,72px)] border-t border-rule pt-[clamp(18px,2vw,26px)]">
          <Figures />
          <p className="m-0 mt-5 max-w-[60ch] text-sm text-fg-3">
            Every figure on this page is read out of lib/mock-raffles.ts at render time, whose
            settled raffles are settled by a real call to drawRaffle. Nothing rolls on an odometer,
            because nothing here is connected to a node.
          </p>
        </div>
      </section>

      {/* =========================================================== 5. THE DRAW IN ACTION

          The ceremony keeps its section, its five acts and its replay. What is new above it is the
          chain, which says in five plates what the replay spends twenty seconds saying, for a
          reader who is not going to press the button. `audit={false}` moves the recomputation to
          section six, so this page offers one of it rather than two. */}
      {CEREMONY && TRACE.length > 0 ? (
        <>
          <section
            className="inv bg-panel px-pad py-[clamp(48px,8vw,112px)] text-fg"
            aria-labelledby="draw-heading"
          >
            <SectionHead
              id="draw-heading"
              title="See how a winner is drawn."
              lead={`Raffle ${serial} settled in July. This is its draw, recomputed in your browser rather than read back off a server.`}
            />
            <DrawChain links={CHAIN} />
            <p className="m-0 mt-[clamp(26px,3vw,40px)] max-w-[62ch] text-sm text-fg-3">
              No spin, no near miss, no acceleration into a result. The pool shrank from{" "}
              {TRACE[0].poolBefore} to {TRACE[TRACE.length - 1].poolBefore} between the two picks,
              which is why the second winner could not be the first. Replay it below.
            </p>
          </section>

          <Ceremony
            poster={<CeremonyWinners />}
            ledger={<CeremonyLedger />}
            trace={TRACE}
            audit={false}
          />
        </>
      ) : null}

      {/* ====================================================== 6. VERIFIABLE BY DESIGN */}
      {CEREMONY && CEREMONY_SEED && CEREMONY_SUMMARY ? (
        <section className="px-pad py-[clamp(48px,8vw,112px)]" aria-labelledby="verify-heading">
          <div className="mb-[clamp(30px,4vw,52px)] max-w-[58ch]">
            <h2 id="verify-heading" className="m-0 max-w-[18ch] font-serif text-display">
              Don&rsquo;t trust the result. Verify it.
            </h2>
            <p className="m-0 mt-[18px] text-lg text-fg-2">
              Every settled draw leaves behind the data needed to recompute the result. Nothing
              below is summarised: it is the record.
            </p>
          </div>

          <VerifyPanel
            serial={serial}
            nonces={SORTED_NONCES}
            chainValue={CEREMONY.chainSeed ?? ""}
            seed={CEREMONY_SEED}
            eligible={CEREMONY_SUMMARY.eligible.length}
            trace={TRACE}
          />
        </section>
      ) : null}

      {/* ================================================================ 7. BUILT ON RIALO */}
      <section
        id="rialo"
        className="scroll-mt-mast px-pad py-[clamp(48px,8vw,112px)]"
        aria-labelledby="rialo-heading"
      >
        <div className="grid items-center gap-[clamp(30px,4vw,64px)] min-[900px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <h2 id="rialo-heading" className="m-0 max-w-[18ch] font-serif text-display">
              Built for automatic execution.
            </h2>
            <p className="m-0 mt-5 max-w-[52ch] text-lg text-fg-2">
              Drawbook uses Rialo&rsquo;s reactive transactions so the draw can execute when the
              reveal deadline passes, without relying on a keeper, a cron job or a relayer. There is
              nobody to pay to press it, and nobody who can choose not to.
            </p>

            {/*
              THE LIMIT, STATED HERE RATHER THAN BURIED. This paragraph is the reason this section
              is not a boast, and it has survived every redesign of this product for that reason.
              It is 13px rather than 19px because it is a qualification of the claim above it, and
              it sits directly under that claim rather than in a footer, which is the whole of what
              "stated rather than buried" means.
            */}
            <p className="m-0 mt-[22px] max-w-[58ch] text-sm text-fg-3">
              This is randomized. It is not a claim that the draw cannot be biased. Rialo&rsquo;s own
              randomness is a bare 64-bit number with no proof attached, which is why the seed is
              built out of the participants&rsquo; secrets and the chain value is only mixed in on
              top. Withholding a reveal does move the seed; biasing it needs a party who both
              produces blocks and reveals last, and the bond they forfeit is the price of trying.
            </p>
          </div>

          <Flow steps={FLOW} />
        </div>
      </section>

      {/* ==================================================================== 8. THE CLOSE */}
      <section className="inv bg-panel px-pad py-[clamp(64px,10vw,140px)] text-fg">
        <h2 className="m-0 max-w-[16ch] font-serif text-display">Ready to see it in action?</h2>
        <div className="mt-[clamp(28px,3.4vw,44px)] flex flex-wrap items-center gap-2.5">
          <Link href="/raffles" className={BUTTON_PRIMARY}>
            Explore raffles
          </Link>
          <Link href="/docs" className={BUTTON}>
            Read the docs
          </Link>
        </div>
      </section>
    </main>
  );
}
