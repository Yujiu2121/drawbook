import { notFound } from "next/navigation";
import { ViewTransition, type ReactNode } from "react";

import { ActivityFeed } from "@/components/activity-feed";
import { Blade, PHASE_WORD, Sheet } from "@/components/cell";
import { Ceremony, CeremonyLedger } from "@/components/ceremony";
import { Countdown, CountdownRules } from "@/components/countdown";
import { ArrivalScroll } from "@/components/row-link";
import { activeDeadline, isInverted, isLive, serialOf, utcStamp } from "@/lib/cell";
import { MOCK_RAFFLES, NOW, VIEWER, nonceOf, raffleById } from "@/lib/mock-raffles";
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
import { AuditRecompute, PresentHalf, TakeTicket, type PresentableStub } from "./counter";

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
 * EVERYTHING ELSE ON THIS PAGE IS A SERVER COMPONENT. The pool figure, the deadlines, the ticket
 * bed, the facts, the holdings, the winners and the audit are all pure functions of the record,
 * rendered once into static HTML. Three small islands are mounted inside it and no more: the
 * countdown and its two meters (a clock), the counter (buy and reveal), and, on raffle 0004
 * alone, the ceremony. Each takes server-rendered nodes as props rather than data to re-render.
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

/**
 * WHAT A VOID RAFFLE ACTUALLY HANDED BACK, and the one arithmetic correction in this port.
 *
 * `summarize` hard-zeroes `forfeited` on the void branch, correctly: on void nothing is forfeited.
 * So `pool` there is the creator's deposit plus the ticket revenue and it leaves the reveal bonds
 * out entirely. The design this ports printed that pool under the word "Refunded", and the app it
 * replaces printed it under "Returned in full", and both were short by exactly the quantity the
 * sentence beside them promised: every ticket AND every bond back.
 *
 * Raffle 0005: 1.50 deposit + 5 x 0.02 tickets = 1.60 pool, + 5 x 0.01 bonds = 1.65 returned.
 *
 * It is computed here rather than added to `summarize` because `lib/raffle.ts` belongs to another
 * hand this pass, and because "returned" is a fact about one phase rather than a field every
 * raffle has.
 */
function returnedTotal(raffle: Raffle): number {
  const { pool, sold } = summarize(raffle);
  return pool + sold * raffle.config.revealBond;
}

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
    case "void":
      return `${formatRLO(config.prize)} deposit + ${s.sold} tickets + ${s.sold} bonds`;
  }
}

/** The lead: what happened here, in one paragraph, in the tense the phase is actually in. */
function leadParagraph(raffle: Raffle): string {
  const { config, phase } = raffle;
  const s = summarize(raffle);

  switch (phase) {
    case "selling":
      return s.available > 0
        ? `${s.sold} of ${config.supply} tickets are gone and ${s.available} are still open, so the pool grows by ${formatRLO(config.ticketPrice)} RLO with every one taken. Taking one publishes a hash bound to your address, this raffle and this exact index. The number behind that hash stays in your browser until you reveal it, which is what stops anyone, the creator included, from knowing the seed early.`
        : `Every ticket is taken, so the sale closes itself and the reveal window opens. Nothing more can be bought here.`;
    case "revealing":
      return `Sold out. ${s.revealed} of ${s.sold} holders have revealed; ${s.outstanding} stubs are still silent. Each silent one forfeits ${formatRLO(config.revealBond)} RLO into the pool when reveals close, and its nonce never enters the seed.`;
    case "drawn":
      return `Settled. ${s.revealed} of ${s.sold} stubs were revealed, so ${s.outstanding} bonds went into the pool and ${s.outstanding} nonces stayed out of the seed. The seed was every revealed nonce sorted and hashed together with the chain value read at the draw, and the winners below are what that seed produces when the computation is run again from the published record.`;
    case "void":
      return `Void. Reveals closed with nobody having revealed, so there was no seed material and nothing honest to draw from. Every ticket and every bond was refunded in full and the creator's deposit went back too, which is ${formatRLO(returnedTotal(raffle))} RLO and not the ${formatRLO(s.pool)} RLO the record calls the pool: that figure never counted the reveal bonds, because on the void branch nothing is forfeited.`;
  }
}

/**
 * The three instants, as one bounded strip.
 *
 * Each cell names its own deadline rather than pointing at a neighbour: the design this ports
 * said "at the instant above", and at 390px the auto-fit grid had put the SALE deadline above it,
 * two days wrong. Nothing here refers to anything but itself.
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
      term: phase === "selling" ? "Reveals open" : settled ? "Reveals closed" : "Reveals close",
      when: utcStamp(config.revealDeadline),
    },
    {
      term: settled ? "Draw fired" : "Draw fires",
      when: utcStamp(config.revealDeadline),
    },
  ];

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] border border-bound">
      {cells.map((cell) => (
        <div key={cell.term} className="border-r border-bound px-3.5 py-3 last:border-r-0">
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
 */
function Clock({ raffle }: { raffle: Raffle }) {
  const deadline = activeDeadline(raffle);

  return (
    <div className="mt-[clamp(20px,2.6vw,30px)]">
      <Cap>{raffle.phase === "selling" ? "Sale closes in" : "Reveals close in"}</Cap>

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
            Example holder
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
          What a purchase publishes
        </Head2>
        <Well>
          <Formula>
            {`commitment = SHA256( "rialo-raffle-v1|commit|${config.id}|<ticket>|" ‖ <your address> ‖ "|" ‖ <your nonce> )`}
          </Formula>
        </Well>
        <Note className="mt-3">
          That hash is the whole of what leaves the browser. It binds the nonce to your address,
          to this raffle and to one exact index, so a commitment cannot be lifted off one ticket
          and reused on another. The nonce itself is posted later, at reveal, and until then
          nobody can compute the seed, the creator included.
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
          The chain value does not exist yet. It arrives with the block that fires the draw, which
          is why staying silent to move the seed is a bet nobody can price, and why this panel
          cannot be computed until reveals close.
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
        <Note className="mt-3">
          Recomputed while this page was rendered, from the {s.revealed} public nonces and the
          chain value alone, with the same SHA-256 the program uses: the winners it produces are{" "}
          <span className="figure text-fg">{audit.winners.map(pad2).join(", ")}</span>, which is
          what the record says. Nothing was read back from the record except to compare, and
          anyone holding the published data can run it.
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

/* ------------------------------------------------------------------------- route */

export default async function RafflePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raffle = raffleById(Number(id));
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
   * The stubs that could be presented right now. Their nonces come from the demo's table, which
   * stands in for the browser storage a real holder would keep them in, and a stub with no nonce
   * on record is dropped rather than offered with an empty field.
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

  /** What one of the example holder's tickets did, in the tense it is now in. */
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
      <ArrivalScroll />

      {/*
        THE ONE NAMED ELEMENT ON THIS ROUTE. Full bleed, first in the document, outside every
        boundary. Its own aria-label is the raffle's state as a sentence, so the largest object on
        the page announces as one image rather than as forty anonymous marks.
      */}
      <ViewTransition name={`cell-${config.id}`}>
        <Blade raffle={raffle} />
      </ViewTransition>

      <div className="px-pad pt-[clamp(24px,4vw,52px)]">
        <div className="grid items-start gap-[clamp(22px,3vw,44px)] lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          {/* ---------------------------------------------------------- the subject */}
          <div className="min-w-0">
            <Cap>
              {phase === "void" ? "Returned" : "Pool"} &middot; raffle {serialOf(raffle)} &middot;{" "}
              {PHASE_WORD[phase]}
            </Cap>

            <div className="monument mt-1.5 text-pool">
              {formatRLO(phase === "void" ? returnedTotal(raffle) : s.pool)}
            </div>

            <Cap className="mt-2.5">RLO{subtitle ? ` · ${subtitle}` : ""}</Cap>

            <h1 className="font-serif mt-[22px] mb-[18px] text-display">{config.title}</h1>

            <Deadlines raffle={raffle} />

            {isLive(raffle) && <Clock raffle={raffle} />}

            <p className="mt-[22px] max-w-[58ch] text-lg text-fg-2">{leadParagraph(raffle)}</p>

            <section aria-labelledby="sheet-heading" className="mt-[clamp(26px,3vw,38px)]">
              <Head2 id="sheet-heading" className="mb-2.5">
                The ticket sheet &middot; {config.supply} cells
              </Head2>

              {/*
                Read-only, and `mine` is the example holder rather than a wallet. The ring is a
                claim about whose ticket it is, and this page has read no wallet: it was rendered
                before any browser opened it. The caption under the bed says which claim it is.
              */}
              <Sheet raffle={raffle} mine={heldIndices} />

              {heldIndices.length > 0 && (
                <Note className="mt-2.5">
                  The ringed cells belong to the example holder described below, not to you.
                </Note>
              )}
            </section>

            {/* ------------------------------------------------------- the counter */}
            {phase === "selling" && next && (
              <div className="mt-[clamp(26px,3vw,38px)] border-t border-rule pt-6">
                <TakeTicket
                  offer={{
                    raffleId: config.id,
                    ticketIndex: next.index,
                    ticketPriceKelvin: config.ticketPrice,
                    revealBondKelvin: config.revealBond,
                    commitDeadline: config.commitDeadline,
                  }}
                  /*
                    The face is rendered here and handed in as a node, which is the pattern every
                    island in this port follows: the page stays a Server Component and the client
                    boundary closes around the state and nothing else.
                  */
                  face={
                    <div className="min-w-0">
                      <Cap>Next open ticket</Cap>
                      <div
                        className="monument mt-1.5"
                        style={{ fontSize: "var(--text-title)" }}
                      >
                        {pad2(next.index)}
                      </div>
                      <Note className="mt-2.5">
                        {formatRLO(config.ticketPrice)} RLO for the ticket and{" "}
                        {formatRLO(config.revealBond)} RLO as a reveal bond, which comes back to
                        you when you present your half before{" "}
                        {utcStamp(config.revealDeadline)}. Stay silent and the bond goes to the
                        pool.
                      </Note>
                    </div>
                  }
                />
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
                <Fact term="Pool">{formatRLO(s.pool)} RLO</Fact>
                {phase === "void" && (
                  <Fact term="Returned to holders">{formatRLO(returnedTotal(raffle))} RLO</Fact>
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
                The example holder
              </Head2>

              {held.length === 0 ? (
                <Note>The example holder has none of this raffle&rsquo;s tickets.</Note>
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
              <Note className="mt-2.5">
                These belong to one recorded sample address kept in the demo record, not to any
                wallet. Nothing was read from a browser to build this page and no adapter ran. It
                is here as a worked example, so the bed can show what a held ticket and a
                presented half look like.
              </Note>
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
        />
      )}
    </main>
  );
}
