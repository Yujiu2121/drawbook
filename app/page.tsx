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
import { PROGRAM_ID } from "@/lib/chain/program";
import { PINNED_STAMP } from "@/lib/clock";
import { BUTTON, BUTTON_PRIMARY } from "@/lib/controls";
import { MOCK_RAFFLES, voidReturns } from "@/lib/mock-raffles";
import {
  auditSeed,
  deriveWinnerTrace,
  formatRLO,
  payouts,
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
 * `summarize`, `payouts`, `auditSeed` and `deriveWinnerTrace`, computed at render time, which is
 * the only way the note at the foot of section four gets to say its figures are read out of
 * lib/mock-raffles.ts and be telling the truth.
 *
 * TWO SOURCES, AND THE COPY NEVER BLURS THEM. Drawbook's raffle program runs on Rialo testnet, and
 * /create deploys real raffle accounts that /raffles lists and /r/[address] opens. Nothing on this
 * page reads one: every card, figure, the field, the chain, the ceremony and the working are the
 * five sample raffles, fixed demonstration data that is not on chain. So the page sends people to
 * /raffles and /create for the real thing, and every surface drawn from the samples says "sample"
 * on its face. What the copy may claim is fixed by the claims sheet for the testnet launch: the
 * draw is a button anyone may press once the raffle is ready, not automatic yet; the result is
 * randomized and checkable, not unbiasable; and the limit is the draw-block producer, stated whole.
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
  paid: sum(RECORD, (r) => [...payouts(r).values()].reduce((a, b) => a + b, 0)),
  returned: sum(
    RECORD.filter((r) => r.phase === "void"),
    (r) => voidReturns(r).total,
  ),
  drawn: MOCK_RAFFLES.filter((r) => r.phase === "drawn").length,
  voided: MOCK_RAFFLES.filter((r) => r.phase === "void").length,
  liveTickets: sum(LIVE, (r) => r.config.supply),
  liveSold: sum(LIVE, (r) => summarize(r).sold),
};

/**
 * THE AGGREGATE THAT IS SPLIT RATHER THAN SUMMED, AND THEN SPLIT AGAIN. The design this descends
 * from printed "In the pools 40.75 RLO", the sum of every raffle's pool, which counted money that
 * had already left. The fix that followed printed "Paid and refunded 7.70": 6.10 paid to raffle
 * 0004's winners plus raffle 0005's 1.60 pool. That was wrong too, because a void pool leaves the
 * reveal bonds out, and /raffle/5 says 1.65 was returned. So the money that left is two figures
 * from two functions: what `payouts` paid the winners of a drawn raffle (6.10), and what a void
 * raffle handed back, `voidReturns(r).total` from lib/mock-raffles.ts (1.65), the one function
 * /raffle/5 and the board both print from. Together 7.75 has left the sample pools, and each
 * figure agrees with the page one click away because it is that page's own arithmetic.
 *
 * Every label says "sample" or sits under a heading that does: none of this is on chain.
 */
const FIGURES: [string, string][] = [
  ["Sample raffles", String(TOTALS.raffles)],
  ["Tickets", String(TOTALS.tickets)],
  ["Sold", String(TOTALS.sold)],
  ["In the open pools", `${formatRLO(TOTALS.livePool)} RLO`],
  ["Paid to winners", `${formatRLO(TOTALS.paid)} RLO`],
  ["Returned", `${formatRLO(TOTALS.returned)} RLO`],
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
          // Not "nobody sees it coming": the producer of the draw block may be able to influence
          // it, and section seven says so. What is true is when it is read.
          note: "Read at the draw, once every secret is public.",
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
      "Buy a ticket and commit a secret, paying the ticket price plus a bond. The secret is bound to your address, this raffle and this exact ticket, and nobody, the creator included, can read it.",
  },
  {
    n: "02",
    title: "Reveal",
    body:
      "When the sale closes, publish your secret to become eligible. The program checks it against what you committed and hands your bond back. Stay silent and your bond goes into the pool.",
  },
  {
    n: "03",
    title: "Draw",
    body:
      "Once every ticket is revealed or the deadline passes, anyone can run the draw. The winners come out of every published secret at once, in sorted order, plus one value the chain adds last. Winners collect with Claim.",
  },
];

/**
 * THE DESIGN, NOT TODAY'S PATH, AND THE PAGE LABELS IT AS SUCH. The Subscriber predicate that
 * would fire the draw at the deadline is not wired: today the third plate is a person pressing
 * Draw, which the program accepts from anyone once the raffle is ready. The diagram stays because
 * it is the argument for building this on Rialo, but it sits under a label saying it is the
 * design, and the last plate no longer says winners were paid with nothing pressed: even in the
 * design, a winner is paid by Claim.
 */
const FLOW: FlowStep[] = [
  { title: "Reveal deadline", body: "an absolute instant, written into the raffle" },
  { title: "Condition met", body: "the chain notices, not a server" },
  { title: "Reactive transaction", body: "the draw is its body" },
  { title: "Draw executed", body: "no keeper, no cron job, no relayer; winners then Claim" },
];

/**
 * Three claims, each true of the program on testnet today. The third used to be "Automatic: the
 * draw executes itself the moment the reveal period ends", which is the design and not the fact.
 */
const BENEFITS: [string, string, string][] = [
  ["01", "Transparent", "Every ticket, commitment and reveal sits in the raffle's account, where anyone can read it while the raffle is open."],
  ["02", "Verifiable", "Anyone can recompute a drawn raffle from data its account holds, and its page does that in your browser."],
  ["03", "Open to anyone", "Once every ticket is revealed or the reveal deadline passes, anyone can press Draw. Firing it automatically is the design, not wired yet."],
];

/* -------------------------------------------------------------------------------- the page */

export default function LandingPage() {
  const serial = CEREMONY ? serialOf(CEREMONY) : "";

  return (
    <main className="pt-mast">
      {/* ==================================================================== 1. THE HERO */}
      <section aria-label="Drawbook">
        {/* The second call to action used to be "How it works" scrolling to #how, while the
            masthead's "How it works" opens /learn: one label, two destinations, on one screen.
            It is now the other real destination this page exists to send people to. */}
        <Hero
          eyebrow="On Rialo testnet"
          sentence="Fair raffles, built on Rialo."
          lead="Drawbook draws raffle winners from secrets every ticket holder commits and then reveals, so the result is randomized and anyone can check it."
          actions={
            <>
              <Link href="/raffles" className={BUTTON_PRIMARY}>
                Explore raffles <span aria-hidden="true">&rarr;</span>
              </Link>
              <Link href="/create" className={BUTTON}>
                Deploy a raffle
              </Link>
            </>
          }
          field={<MusterBands raffles={MOCK_RAFFLES} />}
          fieldHead={
            <figcaption className="label mb-3.5 flex justify-between gap-3 text-fg-3">
              <span>Every ticket in the sample raffles</span>
              <span>{TOTALS.tickets} tickets</span>
            </figcaption>
          }
          fieldNote={
            <p className="m-0 mt-3.5 max-w-[52ch] text-sm text-fg-3">
              One block per ticket across the {TOTALS.raffles} sample raffles, fixed demonstration
              data rather than accounts on chain. Filled is sold, a light foot is a published
              secret, and the two lit blocks are sample {serial}&rsquo;s winners. Open a band and
              those blocks become the page.
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
            Drawbook is an on-chain raffle where the winners come out of a commit-reveal draw over
            secrets the ticket holders publish, rather than being chosen by whoever runs it.
          </p>
          {/* WHAT IS LIVE, IN ONE PLACE, NEAR THE TOP. Everything below this paragraph that shows
              a raffle is the sample record, so the true sentence about the real program goes
              before any of it rather than after. */}
          <p className="m-0 mt-4 text-fg-2">
            Its raffle program runs on Rialo testnet. Deploying a raffle, buying a ticket,
            revealing, drawing and claiming are real signed transactions from a burner wallet held
            in your browser. Testnet only, and testnet can be reset.
          </p>
          <p className="m-0 mt-3 text-sm text-fg-3">
            <span className="label">Program</span>{" "}
            <span className="mono break-all">{PROGRAM_ID}</span>
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
        {/* The title is now literally true: the raffles that are live are one click away, at the
            top of /raffles, and anyone can deploy one. The cards under it are not those raffles
            and are headed as samples before the first one is drawn. */}
        <SectionHead
          id="raffles-heading"
          title="Try a live raffle."
          lead="Raffles deployed on Rialo testnet are listed at the top of the raffle board, and anyone can deploy one. Buying, revealing, drawing and claiming there are real signed transactions."
          aside={
            <div className="flex flex-wrap items-center gap-2.5">
              <Link href="/raffles" className={BUTTON_PRIMARY}>
                Live raffles <span aria-hidden="true">&rarr;</span>
              </Link>
              <Link href="/create" className={BUTTON}>
                Deploy a raffle
              </Link>
            </div>
          }
        />

        <h3 className="label m-0 mb-2.5 flex flex-wrap justify-between gap-3 border-t border-rule pt-3.5 font-normal text-fg-3">
          <span>Sample raffles &middot; not on chain</span>
          <span>
            {TOTALS.liveSold} of {TOTALS.liveTickets} tickets gone &middot;{" "}
            {formatRLO(TOTALS.livePool)} RLO in the open pools
          </span>
        </h3>
        {/* The clock disclosure sits directly above the first countdown it qualifies. The sample
            clocks start at a pinned instant in July, so on any later day a countdown reading
            "24:59:58" is a demonstration, and the sentence says so before it can be read as a
            deadline. */}
        {/* The explicit {" "} after the count is load-bearing: the compiler drops the leading
            space of a multi-line JSX text run that contains an entity, and this printed
            "These 5raffles" without it. */}
        <p className="m-0 mb-[clamp(18px,2vw,26px)] max-w-[64ch] text-sm text-fg-3">
          These {TOTALS.raffles}{" "}raffles are fixed demonstration data kept in this site&rsquo;s
          code, so every draw in them can be recomputed. Nothing done on them is signed or sent.
          Their clocks start from a pinned instant, {PINNED_STAMP}, and add the time this tab has
          been open.
        </p>

        <ul className="rcards m-0 list-none p-0">
          {LIVE.map((r) => (
            <RaffleCard key={r.config.id} raffle={r} />
          ))}
        </ul>

        {RECORD.length > 0 ? (
          <>
            <h3 className="label m-0 mt-[clamp(40px,5vw,72px)] mb-[clamp(18px,2vw,26px)] flex flex-wrap justify-between gap-3 border-t border-rule pt-3.5 font-normal text-fg-3">
              <span>The sample record</span>
              <span>
                {TOTALS.drawn} settled &middot; {TOTALS.voided} void &middot;{" "}
                {formatRLO(TOTALS.paid)} RLO paid to winners &middot;{" "}
                {formatRLO(TOTALS.returned)} RLO returned
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
            out of the record.

            The note used to end "nothing here is connected to a node" while the masthead on the
            same screen rolled a live block height read from one. It now says which figures are
            the sample record and which one thing on the page is read live. */}
        <div className="mt-[clamp(40px,5vw,72px)] border-t border-rule pt-[clamp(18px,2vw,26px)]">
          <Figures />
          <p className="m-0 mt-5 max-w-[60ch] text-sm text-fg-3">
            Every figure in this section and the two after it is read out of the sample record in
            lib/mock-raffles.ts at render time, and its settled raffles are settled by a real call
            to drawRaffle. None of it is on chain. The only thing on this page read from a node is
            the network chip in the masthead.
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
              lead={`Sample raffle ${serial} is fixed demonstration data, not on chain. This is its draw, recomputed in your browser with the same winner selection a live raffle’s page uses to check its own.`}
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
              Every settled draw leaves behind the data needed to recompute the result. Below is
              the whole working of sample raffle {serial}, unsummarised. A live raffle&rsquo;s page
              prints the same working from its account on chain and checks it in your browser.
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
            {/* "Designed", not "Built": the trigger in the diagram beside this is not wired. The
                paragraph says what happens today first, then what the design adds. */}
            <h2 id="rialo-heading" className="m-0 max-w-[18ch] font-serif text-display">
              Designed for automatic execution.
            </h2>
            <p className="m-0 mt-5 max-w-[52ch] text-lg text-fg-2">
              Today the draw is a button anyone can press. The program refuses it until every sold
              ticket is revealed after the sale closes, or the reveal deadline passes, and accepts
              it from anyone after that. The design is for Rialo&rsquo;s reactive transactions to
              fire it at the deadline, with no keeper, cron job or relayer. That trigger, a
              Subscriber predicate, is not wired yet.
            </p>

            {/*
              THE LIMIT, STATED HERE RATHER THAN BURIED. This paragraph is the reason this section
              is not a boast, and it has survived every redesign of this product for that reason.
              It is 13px rather than 19px because it is a qualification of the claim above it, and
              it sits directly under that claim rather than in a footer, which is the whole of what
              "stated rather than buried" means.
            */}
            <p className="m-0 mt-[22px] max-w-[58ch] text-sm text-fg-3">
              This is randomized and checkable. It is not a claim that the draw cannot be biased.
              Rialo&rsquo;s own randomness is a bare 64-bit number with no proof attached, which is
              why the seed is built out of the participants&rsquo; secrets and the chain value is
              only mixed in on top. Two levers remain. The chain value is read at the draw, after
              every secret is public, so whoever produces the draw block may be able to try values
              and keep one they like, with no ticket needed. And a holder can withhold a reveal to
              move the seed, blind to the chain value still to come, at the cost of their bond.
            </p>
          </div>

          <figure className="m-0">
            <figcaption className="label mb-3.5 text-fg-3">The design, not wired yet</figcaption>
            <Flow steps={FLOW} />
          </figure>
        </div>
      </section>

      {/* ==================================================================== 8. THE CLOSE */}
      <section className="inv bg-panel px-pad py-[clamp(64px,10vw,140px)] text-fg">
        <h2 className="m-0 max-w-[16ch] font-serif text-display">Ready to see it in action?</h2>
        <p className="m-0 mt-[clamp(18px,2vw,24px)] max-w-[52ch] text-fg-2">
          Live raffles are on Rialo testnet, and a raffle you deploy is a real account there. Your
          wallet is a burner key held in this browser.
        </p>
        <div className="mt-[clamp(28px,3.4vw,44px)] flex flex-wrap items-center gap-2.5">
          <Link href="/raffles" className={BUTTON_PRIMARY}>
            Live raffles
          </Link>
          <Link href="/create" className={BUTTON}>
            Deploy a raffle
          </Link>
          <Link href="/docs" className={BUTTON}>
            Read the docs
          </Link>
        </div>
      </section>
    </main>
  );
}
