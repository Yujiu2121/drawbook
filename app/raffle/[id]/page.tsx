import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewTransition, type ReactNode } from "react";

import { ActivityFeed } from "@/components/activity-feed";
import { Blade, PHASE_WORD, Sheet } from "@/components/cell";
import { Ceremony, CeremonyLedger } from "@/components/ceremony";
import { Countdown, CountdownRules } from "@/components/countdown";
import { ArrivalScroll } from "@/components/row-link";
import { activeDeadline, isInverted, isLive, serialOf, utcStamp } from "@/lib/cell";
import { CLOCK_NOTE, PINNED_STAMP } from "@/lib/clock";
import { BUTTON, BUTTON_PRIMARY } from "@/lib/controls";
import {
  MOCK_RAFFLES,
  NOW,
  VIEWER,
  VIEWER_LABEL,
  nonceOf,
  raffleBySegment,
  voidReturns,
} from "@/lib/mock-raffles";
import {
  activityOf,
  auditWinners,
  deriveWinnerTrace,
  formatRLO,
  payouts,
  shortAddress,
  summarize,
  type Raffle,
  type Ticket,
} from "@/lib/raffle";
import { AuditRecompute, PresentHalf, type PresentableStub } from "./counter";

/**
 * ONE RAFFLE, AT BLADE SCALE.
 *
 * The route opens with the same object the board row carried, grown: `<Blade>` is the strip at
 * scale three, and it is the ONE element on this page wrapped in a view transition name. The
 * board names `cell-${id}` on the strip (components/row-link.tsx) and this file names it on the
 * blade, so a navigation is two rectangles of the same grid interpolating into each other and
 * not a page replacing a page.
 *
 * THREE THINGS ABOUT THAT NAME, AND ALL THREE ARE LOAD-BEARING.
 *
 * 1. IT IS THE ONLY ONE. Not one name per cell: 201 named groups were measured at
 *    `transition.ready` 220ms with a single animation frame collected in two seconds, because
 *    snapshotting each named element blocks the main thread. Two files in this app may spell a
 *    transition name and this is the second of them.
 * 2. IT IS IN THE SYNCHRONOUS SHELL. There is no streaming boundary anywhere in this file, and
 *    that is a deliberate absence rather than an omission: everything this page reads is a
 *    synchronous module read over MOCK_RAFFLES, so a boundary would buy nothing and would put the
 *    morphing box behind a fallback with no blade in it. React's boundary element is not spelled
 *    once in the markup below, which is the cheapest possible proof that the named cell is
 *    outside every one of them: the requirement is a grep away rather than a tree-read away.
 * 3. IT SITS AT THE TOP OF THE DOCUMENT, under the fixed masthead and nothing else. The morph
 *    only fires when BOTH rectangles are captured in the viewport at their own end of the
 *    navigation, and `<ArrivalScroll />` below puts this page at scrollY 0 inside the update
 *    callback. A blade further down the page is a blade that is not there to be captured.
 *
 * EVERY RAFFLE ON THIS ROUTE IS A SAMPLE, AND THE PAGE SAYS SO BEFORE IT SAYS ANYTHING ELSE.
 * The five ids here are the fixed demonstration record in lib/mock-raffles.ts, kept in the site's
 * code. Raffles that really exist on Rialo testnet live at /r/[address] and are read from the
 * chain. So the first thing under the blade is the notice that this one is not on chain, with the
 * way to the live ones, and no control on this page signs, sends or pretends to: the buy stub
 * points at a live raffle instead of printing a payload, and the reveal and the recompute say they
 * are worked examples over sample data.
 *
 * EVERYTHING ELSE ON THIS PAGE IS A SERVER COMPONENT. The pool figure, the deadlines, the ticket
 * bed, the facts, the holdings, the winners and the audit are all pure functions of the record,
 * rendered once into static HTML. Three small islands are mounted inside it and no more: the
 * countdown and its two meters (a clock), the counter (the reveal check and the recompute), and,
 * on raffle 0004 alone, the ceremony. Each takes server-rendered nodes as props rather than data
 * to re-render.
 *
 * NOTHING IS EMBEDDED. Every figure below comes from `summarize`, `payouts`, `auditWinners`,
 * `activityOf` and `deriveWinnerTrace` over the real `MOCK_RAFFLES`. There is no literal ticket
 * count, pool, seed or winner anywhere in this file. That is not tidiness either: the design this
 * ports carried its own copy of the data and its two arithmetic bugs came from exactly there, and
 * one of them is repaired below rather than reproduced. See `returnedTotal`.
 */

export function generateStaticParams() {
  return MOCK_RAFFLES.map((r) => ({ id: String(r.config.id) }));
}

/**
 * THE FIVE PRERENDERED IDS ARE THE WHOLE ROUTE.
 *
 * Left at its default, an id outside the list above was rendered on demand, and two things went
 * wrong at once. `/raffle/01`, `/1.0`, `/1e0` and `/0x4` each served a real raffle with a 200 at a
 * duplicate URL. And an unknown id hit `notFound()` during that on-demand render, which Next answers
 * with an empty error document: no lang, no fonts, no text until the client bundle hydrates, and a
 * blank page for good without script. With this off, anything not in the list gets the prerendered
 * not-found inside the site shell. The parse below is strict as well, so the lookup refuses a
 * non-canonical id even if this line is ever removed.
 */
export const dynamicParams = false;

/**
 * A title per raffle, and one that says it is a sample.
 *
 * Without this all five inherited the layout's bare "Drawbook", so five tabs opened from the board
 * could not be told apart. `title` gets the layout's "%s · Drawbook" template.
 *
 * THERE IS DELIBERATELY NO openGraph OR twitter BLOCK HERE. A child's openGraph replaces the
 * layout's whole block rather than merging into it, and measured on `next build && next start`,
 * a raffle page that set its own lost og:image and twitter:image outright: the file-convention
 * image from app/opengraph-image.png did not survive the replacement. The layout's block already
 * resolves `url: "./"` against each route's own path, so inheriting it gives a correct og:url and
 * keeps the card image; the per-raffle words live in the title, the description and the canonical.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const raffle = raffleBySegment(id);
  if (!raffle) return {};

  return {
    title: `${raffle.config.title} · Sample raffle`,
    description: `Sample raffle ${serialOf(raffle)}, ${PHASE_WORD[raffle.phase].toLowerCase()}. Fixed demonstration data kept in the site's code, not on chain: every step of its commit-reveal draw can be recomputed in the browser.`,
    alternates: { canonical: `/raffle/${raffle.config.id}` },
  };
}

/**
 * THE RAFFLE THE CEREMONY REPLAYS, RESTATED HERE RATHER THAN IMPORTED, and this is a real
 * constraint rather than an oversight.
 *
 * components/ceremony.tsx exports `CEREMONY_RAFFLE_ID`, and importing it reads as the obvious
 * thing to do. It does not work. That file carries the client directive, and a plain VALUE
 * imported from a client module into a Server Component arrives as a client module REFERENCE
 * rather than as the number: `config.id === CEREMONY_RAFFLE_ID` is then false for every raffle in the book, with no
 * type error and no warning anywhere in the build. Measured: the prerendered 4.html lost the
 * entire stage, 0 occurrences of its own heading, and the build printed nothing. Components
 * imported from that module are fine, because a component IS the reference.
 *
 * So this is an identity rather than a quantity: no figure on this page is a literal, and this is
 * not a figure. If it ever needs to be shared, the fix is to move the constant into a plain module
 * that carries no directive, which is the note left for WO-R5 and WO-R4.
 */
const CEREMONY_RAFFLE_ID = 4;

/** Two digits on a ticket serial, so a list of them reads as one column of figures. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/*
 * WHAT A VOID RAFFLE HANDED BACK is `voidReturns` in lib/mock-raffles.ts, split by who it went
 * back to. Raffle 0005: the creator's 1.50 deposit back to the creator, and 5 x (0.02 ticket +
 * 0.01 bond) = 0.15 back to the holders, 1.65 in all. This page used to file the whole 1.65 under
 * "Returned to holders" while the board printed 1.60 under "Pool"; the board's void row and this
 * page now print the same total from the same function, and the creator's share has its own line.
 */

/* ------------------------------------------------------------------ small pieces */

/** The uppercase caption over a block. One voice, one colour, one size, defined once. */
function Cap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`label text-fg-3 ${className}`}>{children}</div>;
}

/**
 * The same caption when it is also the heading of a section.
 *
 * A separate component rather than a child of Cap, because a UA styles `h2` with its own 1.5em
 * and its own block margins: nesting the heading inside a label-sized div gives a caption 50%
 * larger than every other caption on the page, and the document outline then depends on which
 * of the two elements you happened to look at.
 */
function Head2({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2 id={id} className={`label text-fg-3 ${className}`}>
      {children}
    </h2>
  );
}

/**
 * The well: a formula, a preimage, a payload. Cut into the page rather than raised off it, which
 * is what `--recess` means.
 *
 * The bare `recess` class next to `bg-recess` is not a duplicate. `bg-recess` is the Tailwind
 * utility that paints the surface; `.recess` is the hook globals.css uses to lift `--fg-3` to
 * `--paper-2` inside an inverted well, where `--paper-3` on `--line-inv` would be 4.20 and fail.
 * Raffles 0004 and 0005 render inverted and both carry a note inside a well, so the hook is the
 * difference between 4.20 and 5.57 on two of the five routes.
 */
function Well({ children }: { children: ReactNode }) {
  return <div className="recess bg-recess overflow-x-auto px-4 py-3.5">{children}</div>;
}

/**
 * A formula or a payload, set to be read rather than to be pretty.
 *
 * `overflow-wrap: anywhere` with `word-break: normal`, never `break-all`: a 64-character digest
 * has to be able to wrap, but breaking inside a hex group leaves single characters stranded on a
 * line and a preimage is the one artifact here that has to be exact enough to copy.
 */
function Formula({ children }: { children: ReactNode }) {
  return (
    <pre className="mono text-sm leading-[1.7] break-normal whitespace-pre-wrap [overflow-wrap:anywhere]">
      {children}
    </pre>
  );
}

/** A caption under the thing it qualifies. Never wider than its own measure. */
function Note({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`max-w-[58ch] text-sm text-fg-3 ${className}`}>{children}</p>;
}

/** One row of the facts table: the term on the left in label voice, the quantity hard right. */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <tr>
      <th className="w-[44%] border-b border-rule py-2.5 text-left align-top font-normal text-fg-3">
        {term}
      </th>
      <td className="figure border-b border-rule py-2.5 text-right align-top break-normal [overflow-wrap:anywhere]">
        {children}
      </td>
    </tr>
  );
}

/* ---------------------------------------------------------------------- the head */

/**
 * The unit line under the pool figure: what the figure is made of, or what it becomes.
 *
 * Every branch is a reading of the record at this instant and says so where it is provisional.
 * A selling raffle's pool grows with each ticket and a revealing one's grows with each bond
 * forfeited at the deadline, so neither may state a per-winner split as though it were settled.
 */
function poolSubtitle(raffle: Raffle): string | null {
  const { config, phase } = raffle;
  const s = summarize(raffle);
  const winners =
    config.winners === 1 ? "one winner" : `${config.winners} winners`;

  switch (phase) {
    case "selling":
    case "revealing":
      // Short on purpose. This line is set as a label, 11px uppercase at 0.14em, and a label is a
      // caption rather than a sentence: the 62-character version of it measured 510px and read as
      // shouting across half the measure. What makes the pool provisional is said once, in the
      // lead paragraph below, in a voice that can carry a clause.
      return `still growing \u00b7 ${winners}`;
    case "drawn":
      return s.effectiveWinners > 0
        ? `${formatRLO(s.perWinner)} RLO to each of ${s.effectiveWinners} winners`
        : null;
    case "void": {
      // Two amounts, each named for who it went back to. The old line read "1.50 deposit + 5
      // tickets + 5 bonds", one RLO figure added to two counts, under a total that a Facts row
      // then filed entirely under holders.
      const back = voidReturns(raffle);
      return `${formatRLO(back.creator)} to the creator · ${formatRLO(back.holders)} to holders`;
    }
  }
}

/**
 * The lead: what happened here, in one paragraph, in the tense the phase is actually in.
 *
 * Every branch counts TICKETS, never holders. `summarize` counts tickets, and one address can hold
 * several: raffle 0003 has 16 tickets across 15 holders, so "11 of 16 holders have revealed" was a
 * wrong count with the right numbers in it.
 */
function leadParagraph(raffle: Raffle): string {
  const { config, phase } = raffle;
  const s = summarize(raffle);

  switch (phase) {
    case "selling":
      return s.available > 0
        ? `${s.sold} of ${config.supply} tickets are gone in this sample and ${s.available} are still open, so its pool grows by ${formatRLO(config.ticketPrice)} RLO with every one taken. On a live raffle, buying a ticket files a hash bound to the buyer's address, the raffle and that exact ticket number. The number behind the hash stays in the buyer's browser until the reveal, so the seed cannot be worked out while tickets are on sale.`
        : `Every ticket is taken, so the sale closes itself and the reveal window opens. Nothing more can be bought here.`;
    case "revealing":
      return `Sold out. ${s.revealed} of ${s.sold} tickets have been revealed; ${s.outstanding} are still silent. Each silent ticket's ${formatRLO(config.revealBond)} RLO bond joins the pool when reveals close, and its nonce never enters the seed.`;
    case "drawn":
      return `Settled. ${s.revealed} of ${s.sold} tickets were revealed, so ${s.outstanding} bonds joined the pool and ${s.outstanding} nonces stayed out of the seed. The seed was every revealed nonce sorted and hashed together with the chain value, here a fixed stand-in, and the winners below are what that seed produces when the computation is run again from the published record.`;
    case "void": {
      const back = voidReturns(raffle);
      return `Void. Reveals closed with no ticket revealed, so there was no seed material and nothing honest to draw from. Every holder got their ticket price and their bond back, ${formatRLO(back.holders)} RLO across ${back.tickets} tickets, and the creator got the ${formatRLO(back.creator)} RLO deposit back: ${formatRLO(back.total)} RLO returned in all.`;
    }
  }
}

/**
 * The three instants, as one bounded strip.
 *
 * Each cell names its own deadline rather than pointing at a neighbour: the design this ports
 * said "at the instant above", and at 390px the auto-fit grid had put the SALE deadline above it,
 * two days wrong. Nothing here refers to anything but itself.
 *
 * THE WORDS. revealDeadline is when reveals CLOSE, in every phase: they open at the sale's close.
 * A selling raffle used to label it "Reveals open", the same instant the next cell called the draw.
 * And the third cell no longer says the draw "fires": the draw does not run itself. On chain it
 * becomes ready at this instant (or sooner, once every sold ticket is revealed) and anyone may
 * press Draw, so "Draw ready" is the true reading. A settled sample says what it became.
 *
 * THE GRID IS DECLARED, NOT AUTO-FIT. `repeat(auto-fit, minmax(150px, 1fr))` wrapped 2 + 1 on a
 * phone, kept cell two's right border against the container's own (a doubled edge that stopped
 * at row one) and drew nothing between the rows. Under 560px it is now a stacked list, one ruled
 * block per instant with the term over the stamp; from 560px it is three columns. Term and stamp
 * side by side was tried first and measured: at 360 the label plus a 21-glyph stamp needs about
 * 331px of a 318px line, so the stamp broke before "UTC".
 */
function Deadlines({ raffle }: { raffle: Raffle }) {
  const { config, phase } = raffle;
  const settled = phase === "drawn" || phase === "void";

  const cells: { term: string; when: string }[] = [
    {
      term: phase === "selling" ? "Sale closes" : "Sale closed",
      when: utcStamp(config.commitDeadline),
    },
    {
      term: settled ? "Reveals closed" : "Reveals close",
      when: utcStamp(config.revealDeadline),
    },
    {
      term: phase === "drawn" ? "Drawn" : phase === "void" ? "Voided" : "Draw ready",
      when: utcStamp(config.revealDeadline),
    },
  ];

  return (
    <div className="grid grid-cols-1 border border-bound min-[560px]:grid-cols-3">
      {cells.map((cell) => (
        <div
          key={cell.term}
          className="border-b border-bound px-3.5 py-3 last:border-b-0 min-[560px]:border-r min-[560px]:border-b-0 min-[560px]:last:border-r-0"
        >
          <Cap>{cell.term}</Cap>
          <div className="figure mt-1.5 text-sm">{cell.when}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The clock, for a raffle that still has one.
 *
 * Two rules the surface owns rather than the component, both driven by `data-tier`, which
 * components/countdown.tsx publishes on the element precisely because a function prop cannot
 * cross the server boundary:
 *
 *   final hour  the figure takes the ceremonial hue. lib/cell.ts names this the one clock
 *               reading in the system allowed to. --event on --panel is 7.05 light, 8.01
 *               inverted, so it is a colour change that is also legible.
 *   coarse      the two meters are hidden. They are an hour long and a minute long, so more than
 *               48 hours out they are the second hand of a clock whose hour hand is off the page.
 *
 * Both are `:has()` on a wrapper rather than a prop, because the tier is only known on the
 * client and the server must not guess it: the server renders the same tier the first client
 * frame does, so nothing moves at hydration either way.
 *
 * The caption follows the same tier. Once the figure reads "closed", "Sale closes in" over it was
 * a contradiction on one line, so the wording swaps on `[data-tier=closed]` too. Under the meters
 * sits CLOCK_NOTE, because this clock runs from the pinned instant rather than from today and
 * the note that says so belongs beside the thing it qualifies.
 */
function Clock({ raffle }: { raffle: Raffle }) {
  const deadline = activeDeadline(raffle);
  const selling = raffle.phase === "selling";

  return (
    <div className="group mt-[clamp(20px,2.6vw,30px)]">
      <Cap>
        <span className="group-has-[[data-tier='closed']]:hidden">
          {selling ? "Sale closes in" : "Reveals close in"}
        </span>
        <span className="hidden group-has-[[data-tier='closed']]:inline">
          {selling ? "Sale closed on the sample clock" : "Reveals closed on the sample clock"}
        </span>
      </Cap>

      {/*
        The size is inline rather than a `text-*` utility on purpose. `monument` sets line-height
        0.82 and -0.045em tracking, and a type-step utility re-declares both through its own
        --tw-leading and --tw-tracking defaults; whichever Tailwind emits last wins, which is the
        same trap that made the board's serial carry an inline size. A token-valued font-size
        cannot lose that argument.
      */}
      <div
        className="monument mt-2.5 [&:has([data-tier=final])]:text-event"
        style={{ fontSize: "var(--text-title)" }}
      >
        <Countdown deadline={deadline} live />
      </div>

      <div className="[&:has([data-tier=coarse])]:hidden">
        <CountdownRules deadline={deadline} live />
      </div>

      <Note className="mt-3">{CLOCK_NOTE}</Note>
    </div>
  );
}

/* ------------------------------------------------------------------- the winners */

function WinnerCard({
  raffle,
  index,
  rank,
  of,
}: {
  raffle: Raffle;
  index: number;
  rank: number;
  of: number;
}) {
  const ticket = raffle.tickets[index - 1];
  const paid = payouts(raffle).get(index) ?? 0;

  return (
    <div className="flex items-start gap-4 border border-bound p-4">
      <div
        className="monument text-event"
        style={{ fontSize: "clamp(2.4rem, 5vw, 4rem)" }}
      >
        {pad2(index)}
      </div>
      <div className="min-w-0">
        <Cap>
          Winner {rank} of {of}
        </Cap>
        <div className="figure mt-1.5 text-lg">{formatRLO(paid)} RLO</div>
        <p className="mono mt-1.5 text-sm break-normal text-fg-2 [overflow-wrap:anywhere]">
          {ticket?.holder ? shortAddress(ticket.holder, 8, 8) : "unknown"}
        </p>
        {ticket?.holder === VIEWER && (
          <span className="label mt-2 inline-block border border-bound px-1.5 py-0.5 text-fg-2">
            {VIEWER_LABEL}
          </span>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- the audit */

/**
 * The formula, per phase, and the recomputation where one is possible.
 *
 * The design this ports rendered the derivation for any raffle carrying a chain value, which
 * includes the void one, so raffle 0005 printed the derivation of a seed that was never derived.
 * And it printed nothing at all on the revealing raffle, where the chain value not yet existing
 * is the single most interesting property of the scheme. Both are corrected: there are four
 * branches here and each says what is true of its own phase.
 */
function Audit({ raffle }: { raffle: Raffle }) {
  const { config, phase } = raffle;
  const s = summarize(raffle);
  const audit = auditWinners(raffle);

  if (phase === "selling") {
    return (
      <section aria-labelledby="audit-heading" className="mt-[26px]">
        <Head2 id="audit-heading" className="mb-2.5">
          What a ticket commits to
        </Head2>
        <Well>
          <Formula>
            {`commitment = SHA256( "rialo-raffle-v1|commit|${config.id}|<ticket>|" ‖ <holder address> ‖ "|" ‖ <nonce> )`}
          </Formula>
        </Well>
        <Note className="mt-3">
          That hash is the whole of what a purchase publishes. It binds the nonce to the
          holder&rsquo;s address, to the raffle and to one exact ticket number, so a commitment
          cannot be lifted off one ticket and reused on another. The nonce is published later, at
          the reveal, and until then the seed cannot be computed. This sample writes the inputs as
          text; the program on Rialo testnet hashes the same four inputs as fixed-width bytes.
        </Note>
      </section>
    );
  }

  if (phase === "revealing") {
    return (
      <section aria-labelledby="audit-heading" className="mt-[26px]">
        <Head2 id="audit-heading" className="mb-2.5">
          Audit
        </Head2>
        <Well>
          <Formula>
            {`seed = SHA256( "rialo-raffle-v1|seed|${config.id}|" ‖ sort(${s.revealed} nonces so far) each followed by "|" ‖ <known only at the draw> )`}
          </Formula>
        </Well>
        <Note className="mt-3">
          The chain value does not exist yet. It is read at the draw, after reveals close, so a
          holder who stays silent to steer the seed is betting blind and pays the bond for it, and
          this panel cannot be computed until then. That timing is also the limit: whoever
          produces the block the draw runs in may be able to influence the chain value. The draw
          is randomized and checkable, not beyond influence.
        </Note>
      </section>
    );
  }

  if (phase === "void") {
    return (
      <section aria-labelledby="audit-heading" className="mt-[26px]">
        <Head2 id="audit-heading" className="mb-2.5">
          Audit
        </Head2>
        <Well>
          <Formula>
            {`Nobody revealed, so there is no sorted nonce list and no preimage. No seed was derived and none can be: that is what void means, and it is the correct outcome rather than a failure. The chain value ${raffle.chainSeed ?? "none"} was recorded at the deadline and never used.`}
          </Formula>
        </Well>
      </section>
    );
  }

  if (!audit) return null;

  return (
    <section aria-labelledby="audit-heading" className="mt-[26px]">
      <Head2 id="audit-heading" className="mb-2.5">
        Audit
      </Head2>

      <Well>
        <Formula>
          {`seed = SHA256( "rialo-raffle-v1|seed|${config.id}|" ‖ sort(${s.revealed} nonces) each followed by "|" ‖ ${raffle.chainSeed} )`}
        </Formula>
      </Well>

      {audit.matches ? (
        /*
          WHAT THIS CHECK IS WORTH ON A SAMPLE, SAID IN THE SENTENCE THAT MAKES IT. The record's
          winners were produced by this same code when the site was built, so recomputing them
          here cannot come out differently: it shows the method, it does not test anyone. A live
          raffle's page runs the same derivation against what the chain recorded, and that one
          can fail. Leaving this implicit is how a demonstration gets read as an audit.
        */
        <Note className="mt-3">
          Recomputed while this page was rendered, from the {s.revealed} public nonces and the
          chain value alone: the winners it produces are{" "}
          <span className="figure text-fg">{audit.winners.map(pad2).join(", ")}</span>, which is
          what the record says. This is a sample whose record was made by the same code, so here
          the check shows the method and cannot fail. On a live raffle the page recomputes the draw
          from chain data, and that check can.
        </Note>
      ) : (
        /*
          A mismatch refuses in words and in reversed print, never in the ceremonial hue. That
          hue means a winner in this product, and a fraud dressed as a celebration would be the
          worst thing this page could do.
        */
        <div className="mt-3 border border-bound">
          <p className="label bg-fg px-4 py-3 text-panel">This draw does not check out</p>
          <div className="px-4 py-4">
            <Note>
              The winners on record are not the winners the published nonces produce. Nothing on
              this page should be trusted until that is explained.
            </Note>
            <table className="mt-4 w-full border-collapse text-sm">
              <tbody>
                <Fact term="Seed on record">{raffle.chainSeed}</Fact>
                <Fact term="Seed rebuilt here">{audit.seed}</Fact>
                <Fact term="Winners on record">{raffle.winningTickets.map(pad2).join(", ")}</Fact>
                <Fact term="Winners rebuilt here">{audit.winners.map(pad2).join(", ")}</Fact>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/*
        The reader's own recomputation, which is a different claim from the one above it. The Note
        says this server derived those winners while it rendered; the control says you derived them,
        in your tab, from the six public fields listed beside it. Both are true and only the second
        one is checkable by the person reading it, so the page carries both and never only the
        first. The island is components/../counter.tsx rather than a thirteenth one of its own.
      */}
      <div className="mt-4">
        <AuditRecompute
          audit={{
            raffleId: config.id,
            chainSeed: raffle.chainSeed as string,
            nonces: raffle.tickets
              .filter((t) => t.nonce !== null)
              .map((t) => t.nonce as string),
            eligible: s.eligible,
            winnerCount: config.winners,
            recordedWinners: raffle.winningTickets,
          }}
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the sample notice */

/**
 * WHAT THIS PAGE IS, BEFORE ANYTHING ON IT IS READ AS A RAFFLE SOMEONE CAN ENTER.
 *
 * The first block under the blade, on all five routes. It says three things plainly: this raffle
 * is fixed demonstration data and not an account on any chain, nothing here is signed or sent,
 * and its clock is pinned. Then it hands the reader to the two places where something real
 * happens: the live raffles at the top of /raffles, and /create.
 *
 * A bounded block rather than a surface change, because an inverted route has no second surface
 * to change to (--panel and --panel-2 are both ink inside `.inv`), and a boundary reads on both.
 * No hue: the one accent means a winner or a live clock, and a disclosure is neither. It is an
 * `aside` with its own name rather than a heading, so the raffle's title stays the page's first
 * heading and the outline does not open on a caveat.
 */
function SampleNotice({ raffle }: { raffle: Raffle }) {
  return (
    <aside
      aria-label="Sample raffle, not on chain"
      className="mb-[clamp(22px,3vw,36px)] flex flex-col gap-4 border border-bound px-4 py-4 min-[860px]:flex-row min-[860px]:items-center min-[860px]:justify-between min-[860px]:gap-8"
    >
      <div className="min-w-0">
        <p className="label text-fg">Sample raffle &middot; not on chain</p>
        <p className="mt-2 max-w-[68ch] text-sm text-fg-2">
          {`Raffle ${serialOf(raffle)} is one of ${MOCK_RAFFLES.length} samples: fixed demonstration data in this site’s code, not an account on Rialo. Nothing here can be bought, revealed or drawn, and nothing is signed or sent. Its clock runs from a pinned ${PINNED_STAMP}. Live raffles on Rialo testnet are at the top of Raffles.`}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2.5">
        <Link href="/raffles" className={BUTTON_PRIMARY}>
          Live raffles
        </Link>
        <Link href="/create" className={BUTTON}>
          Deploy a raffle
        </Link>
      </div>
    </aside>
  );
}

/**
 * THE BUY STUB, ON A RAFFLE THAT CANNOT BE BOUGHT.
 *
 * This used to be an island that composed a `buy_ticket` JSON payload from the connected wallet
 * and printed it as "the exact payload that would be posted", because no raffle program existed.
 * One does now, and its Buy instruction is a different thing entirely: a tag, a ticket number and
 * a commitment over fixed-width bytes, signed and sent. Printing an invented payload beside a real
 * program would be the lie the old honesty rule existed to prevent, so the stub keeps what is true
 * about this sample (the price, the bond, the next free number) and its one control goes to where
 * a ticket can genuinely be bought. No wallet is read and nothing is composed, so it needs no
 * client boundary at all.
 */
function SampleStub({ raffle, next }: { raffle: Raffle; next: Ticket }) {
  const { config } = raffle;

  return (
    <section aria-labelledby="take-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule pb-3">
        <h2 id="take-heading" className="label">
          Take a ticket
        </h2>
        <span className="label text-fg-3">Sample {serialOf(raffle)}</span>
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]">
        <div className="min-w-0">
          <Cap>Next open ticket</Cap>
          <div className="monument mt-1.5" style={{ fontSize: "var(--text-title)" }}>
            {pad2(next.index)}
          </div>
          <Note className="mt-2.5">
            {formatRLO(config.ticketPrice)} RLO for the ticket and {formatRLO(config.revealBond)}{" "}
            RLO as a reveal bond, which comes back at the reveal, before{" "}
            {utcStamp(config.revealDeadline)}. A ticket never revealed loses its bond to the pool.
          </Note>
        </div>

        <div className="flex flex-col gap-3 border border-bound p-4">
          <span className="label text-fg-3">Stub</span>

          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="figure text-title text-fg">{formatRLO(config.ticketPrice)}</span>
            <span className="label text-fg-3">RLO</span>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-fg-3">Reveal bond</dt>
            <dd className="figure text-right text-fg">{formatRLO(config.revealBond)} RLO</dd>
            <dt className="text-fg-3">Next free</dt>
            <dd className="figure text-right text-fg">{pad2(next.index)}</dd>
          </dl>

          <Link href="/raffles" className={`${BUTTON_PRIMARY} mt-1 justify-center`}>
            Buy on a live raffle
          </Link>

          <p className="text-sm text-fg-2">
            This is a sample, so its tickets cannot be bought. On a live raffle the same press
            makes a secret in your browser, files only its hash with the ticket, and sends a real
            signed Buy transaction from a testnet wallet held in this browser.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- route */

export default async function RafflePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raffle = raffleBySegment(id);
  if (!raffle) notFound();

  const { config, phase } = raffle;
  const s = summarize(raffle);
  const inverted = isInverted(raffle);
  const settled = phase === "drawn" || phase === "void";
  const audit = auditWinners(raffle);

  const held: Ticket[] = raffle.tickets.filter((t) => t.holder === VIEWER);
  const heldIndices = held.map((t) => t.index);
  const paid = payouts(raffle);
  const won = new Set(raffle.winningTickets);
  const next = raffle.tickets.find((t) => t.holder === null);

  /**
   * The stubs whose reveal can be checked right now. Their nonces come from the sample record,
   * which stands in for the browser storage a real holder would keep them in, and a stub with no
   * nonce on record is dropped rather than offered with an empty field.
   */
  const presentable: PresentableStub[] =
    phase === "revealing"
      ? held
          .filter((t) => t.nonce === null && t.holder !== null && t.commitment !== null)
          .map((t) => ({
            index: t.index,
            holder: t.holder as string,
            commitment: t.commitment as string,
            nonce: nonceOf(config.id, t.index) ?? "",
          }))
          .filter((stub) => stub.nonce !== "")
      : [];

  /** What one of the sample holder's tickets did, in the tense it is now in. */
  function heldStatus(ticket: Ticket): string {
    if (won.has(ticket.index)) return `Won ${formatRLO(paid.get(ticket.index) ?? 0)} RLO`;
    if (phase === "void") return "Refunded";
    if (ticket.nonce) return "Revealed";
    return phase === "revealing" ? "Not revealed" : "Held";
  }

  const subtitle = poolSubtitle(raffle);

  return (
    <main
      /*
        An inverted route is a different material, not a tint: a raffle that has left the floor is
        drawn on ink and the whole route follows through the role tokens, with no second rule
        anywhere below. It paints --panel because it genuinely is another surface; a lit route
        paints nothing at all, so the diffusion film under the body shows through it.
      */
      className={`pt-mast pb-[clamp(48px,8vw,104px)] ${inverted ? "inv bg-panel text-fg" : ""}`}
    >
      {/*
        The other half of the board's `scroll={false}`. The router places no scroll on a dive, so
        this page places its own, inside the transition's update callback. Without it the blade
        opens below the fold on any click from a scrolled board and the morph collects an old
        snapshot with nothing to grow into.
      */}
      <ArrivalScroll focusId="raffle-title" />

      {/*
        THE ONE NAMED ELEMENT ON THIS ROUTE. Full bleed, first in the document, outside every
        boundary. Its own aria-label is the raffle's state as a sentence, so the largest object on
        the page announces as one image rather than as forty anonymous marks.
      */}
      <ViewTransition name={`cell-${config.id}`}>
        <Blade raffle={raffle} />
      </ViewTransition>

      <div className="px-pad pt-[clamp(24px,4vw,52px)]">
        <SampleNotice raffle={raffle} />

        <div className="grid items-start gap-[clamp(22px,3vw,44px)] lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          {/* ---------------------------------------------------------- the subject */}
          <div className="min-w-0">
            <Cap>
              {phase === "void" ? "Returned" : "Pool"} &middot; sample {serialOf(raffle)} &middot;{" "}
              {PHASE_WORD[phase]}
            </Cap>

            <div className="monument mt-1.5 text-pool">
              {formatRLO(phase === "void" ? voidReturns(raffle).total : s.pool)}
            </div>

            <Cap className="mt-2.5">RLO{subtitle ? ` · ${subtitle}` : ""}</Cap>

            {/*
              `tabIndex={-1}` so a keyboard arrival from a board row can land here. Without it the
              row's own element was unmounted under the focus, focus fell to the body, and the next
              Tab went to the footer, past every control on this page. ArrivalScroll above moves
              focus here only after a row click, never on a cold load.
            */}
            <h1
              id="raffle-title"
              tabIndex={-1}
              className="font-serif mt-[22px] mb-[18px] text-display"
            >
              {config.title}
            </h1>

            <Deadlines raffle={raffle} />

            {isLive(raffle) && <Clock raffle={raffle} />}

            <p className="mt-[22px] max-w-[58ch] text-lg text-fg-2">{leadParagraph(raffle)}</p>

            <section aria-labelledby="sheet-heading" className="mt-[clamp(26px,3vw,38px)]">
              <Head2 id="sheet-heading" className="mb-2.5">
                The ticket sheet &middot; {config.supply} cells
              </Head2>

              {/*
                Read-only, and `mine` is the sample holder rather than a wallet. The ring is a
                claim about whose ticket it is, and this page has read no wallet: it was rendered
                before any browser opened it. The caption under the bed says which claim it is.
              */}
              <Sheet raffle={raffle} mine={heldIndices} />

              {heldIndices.length > 0 && (
                <Note className="mt-2.5">
                  The ringed cells belong to the sample holder described below, not to you.
                </Note>
              )}
            </section>

            {/* ------------------------------------------------------- the counter */}
            {phase === "selling" && next && (
              <div className="mt-[clamp(26px,3vw,38px)] border-t border-rule pt-6">
                <SampleStub raffle={raffle} next={next} />
              </div>
            )}

            {phase === "revealing" && presentable.length > 0 && (
              <PresentHalf
                raffleId={config.id}
                stubs={presentable}
                revealDeadline={config.revealDeadline}
              />
            )}

            {/* -------------------------------------------------------- the winners */}
            {phase === "drawn" && raffle.winningTickets.length > 0 && (
              <section aria-labelledby="winners-heading" className="mt-[clamp(26px,3vw,38px)]">
                <Head2 id="winners-heading" className="mb-2.5">
                  The draw
                </Head2>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-3 min-[760px]:grid-cols-2">
                  {raffle.winningTickets.map((index, i) => (
                    <WinnerCard
                      key={index}
                      raffle={raffle}
                      index={index}
                      rank={i + 1}
                      of={s.effectiveWinners}
                    />
                  ))}
                </div>
              </section>
            )}

            <Audit raffle={raffle} />
          </div>

          {/* ------------------------------------------------------------- the facts */}
          <div className="min-w-0">
            <Head2 id="facts-heading" className="mb-2.5">
              Facts
            </Head2>

            <table className="w-full border-collapse text-sm">
              <tbody>
                <Fact term="Creator">
                  <span title={config.creator}>{shortAddress(config.creator, 6, 6)}</span>
                </Fact>
                <Fact term="Prize deposited">{formatRLO(config.prize)} RLO</Fact>
                <Fact term="Ticket price">{formatRLO(config.ticketPrice)} RLO</Fact>
                <Fact term="Reveal bond">{formatRLO(config.revealBond)} RLO</Fact>
                <Fact term="Supply">{config.supply}</Fact>
                <Fact term="Sold">{s.sold}</Fact>
                <Fact term="Revealed">{s.revealed}</Fact>
                <Fact term="Outstanding">{s.outstanding}</Fact>
                <Fact term="Bonds forfeited">{formatRLO(s.forfeited)} RLO</Fact>
                <Fact term="Winners set">{config.winners}</Fact>
                {/*
                  A void raffle has no pool: nothing was drawn and nothing was paid to a winner.
                  It has three returns instead, each named for who received it, and the last is
                  the figure the board's row prints for this raffle.
                */}
                {phase === "void" ? (
                  <>
                    <Fact term="Back to the creator">
                      {formatRLO(voidReturns(raffle).creator)} RLO
                    </Fact>
                    <Fact term="Back to holders">{formatRLO(voidReturns(raffle).holders)} RLO</Fact>
                    <Fact term="Returned in all">{formatRLO(voidReturns(raffle).total)} RLO</Fact>
                  </>
                ) : (
                  <Fact term="Pool">{formatRLO(s.pool)} RLO</Fact>
                )}
                {settled && (
                  <Fact term="Winners drawn">
                    {raffle.winningTickets.length
                      ? raffle.winningTickets.map(pad2).join(", ")
                      : "none"}
                  </Fact>
                )}
                {raffle.chainSeed && <Fact term="Chain seed">{raffle.chainSeed}</Fact>}
                {audit && <Fact term="Seed">{audit.seed}</Fact>}
              </tbody>
            </table>

            {/* ----------------------------------------------------- the holdings */}
            <section aria-labelledby="held-heading" className="mt-[26px]">
              <Head2 id="held-heading" className="mb-2.5">
                {VIEWER_LABEL}
              </Head2>

              {held.length === 0 ? (
                <Note>The sample holder has none of this raffle&rsquo;s tickets.</Note>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {held.map((ticket) => (
                      <Fact key={ticket.index} term={`Ticket ${pad2(ticket.index)}`}>
                        {heldStatus(ticket)}
                      </Fact>
                    ))}
                  </tbody>
                </table>
              )}

              {/*
                THE HONESTY CALL, MADE HERE AND NOT DUCKED. This page was rendered before any
                browser opened it, so it has read no wallet and cannot know whose tickets these
                are. The record carries one sample address so the bed can show what holding and
                revealing look like; it is not derived from any keypair and it is not yours. The
                wallet in the masthead is a real key and a different address in every browser, and
                calling this one "your tickets" would be the product telling its first lie on the
                page whose whole argument is check it yourself.
              */}
              {held.length > 0 && (
                <Note className="mt-2.5">
                  These belong to one address kept in the sample record, not to any wallet and not
                  to you. Nothing was read from a browser to build this page. It is here as a
                  worked example, so the bed can show what a held ticket and a revealed one look
                  like.
                </Note>
              )}
            </section>

            <div className="mt-[26px]">
              <ActivityFeed events={activityOf(raffle)} now={NOW} limit={9} />
            </div>
          </div>
        </div>
      </div>

      {/*
        THE CEREMONY, ON THE ONE ROUTE THAT HAS A HISTORY TO REPLAY.
        It only ever replays what is recorded: raffle 0004's own settled draw, with its trace
        taken from the same `deriveWinnerTrace` the record was produced by rather than from a
        copied constant. No live raffle is ever settled to manufacture a result.
      */}
      {config.id === CEREMONY_RAFFLE_ID && audit && (
        <Ceremony
          /*
            No poster on this route, which is components/ceremony.tsx's own contract for it: the
            hero, the winner cards and the audit above already print raffle 0004's outcome, and
            handing the stage a second copy put the settled paragraph, the seed and the 3.05
            figure on one scroll twice. The landing is the page with nothing else to print and
            the one that passes <CeremonyWinners />.
          */
          poster={null}
          ledger={<CeremonyLedger />}
          trace={deriveWinnerTrace(s.eligible, audit.seed, config.winners)}
          /*
            No second recompute. The Audit section above already carries this page's one
            "Recompute it here", with the note that on a sample it re-runs the code that made the
            record and cannot fail. The stage's own footer would have offered the same SHA-256 a
            second time under a different label, and the landing already avoids exactly that
            duplicate with this same prop.
          */
          audit={false}
        />
      )}
    </main>
  );
}
