import Link from "next/link";

import { Strip, PHASE_WORD } from "@/components/cell";
import { Countdown } from "@/components/countdown";
import { activeDeadline, isInverted, isLive, serialOf } from "@/lib/cell";
import { voidReturns } from "@/lib/mock-raffles";
import { formatRLO, summarize, type Raffle } from "@/lib/raffle";

/**
 * THE RAFFLE CARD.
 *
 * The landing's invitation to one raffle. It is NOT the board row, and the difference is the
 * point: /raffles is a list you scan, where a row's job is to be comparable with the row above
 * it, and this is the first raffle a visitor has ever seen, where the job is to say what is on
 * offer and what it costs. So the prize is the largest thing on the card and the serial is the
 * smallest, which is the exact inversion of the row's own hierarchy.
 *
 * NOTHING HERE IS A SECOND DEFINITION OF ANYTHING. The strip is `<Strip>` from components/cell.tsx,
 * the same element the board draws, at the same scale the board draws it, with the same per-ticket
 * states: this card's progress indicator is every ticket in the raffle rather than a percentage bar
 * over the top of them. The countdown is `<Countdown>`, the one island in the product that ticks.
 * The phase word is `PHASE_WORD`. Every figure is `summarize` at render time.
 *
 * A SERVER COMPONENT, with the countdown as its only island. Five cards cost five clocks and
 * nothing else.
 *
 * THE INVERSION IS THE SYSTEM'S OWN AND NOT A CARD STYLE. A raffle that has left the floor renders
 * light on ink, exactly as it does in the board's record slab and in the landing's miniboard
 * before it. `isInverted` is the one place that decides, so a settled raffle cannot read as
 * settled on one screen and live on the next.
 *
 * WHY A CLOSED CARD PRINTS A DATE AND NOT A CLOCK. A countdown to an instant that has already
 * passed is a zero, and five zeroes down a record row say nothing. The settled and void cards
 * print when they closed instead, which is the fact a reader of the record actually wants.
 *
 * CONTRAST for every pair on this card is computed in the header of app/story.css, against the
 * surface each one sits on rather than against the page. The floor is 4.53.
 *
 * EVERY CARD IS A SAMPLE, AND SAYS SO ON ITS FACE. The landing draws these from lib/mock-raffles.ts,
 * fixed demonstration data that is not on chain. The raffles on chain are listed on /raffles. So
 * the serial reads "Sample 0001", the accessible name starts with "Sample raffle", and a card still
 * on the floor offers "Open sample" rather than "Enter raffle": nothing on a sample page is signed
 * or sent, and a call to action that says "enter" would promise a transaction that does not exist.
 */

/** The wording under the clock, which is a different question in each phase. */
function clockLabel(raffle: Raffle): string {
  switch (raffle.phase) {
    case "selling":
      return "Sale closes in";
    case "revealing":
      return "Reveals close in";
    case "drawn":
      return "Settled";
    default:
      return "Refunded";
  }
}

export function RaffleCard({ raffle }: { raffle: Raffle }) {
  const { config } = raffle;
  const live = isLive(raffle);
  const { sold, pool } = summarize(raffle);
  const serial = serialOf(raffle);

  return (
    <li className={isInverted(raffle) ? "inv" : undefined}>
      <Link
        href={`/raffle/${config.id}`}
        className="rcard"
        data-phase={raffle.phase}
        aria-label={`Sample raffle ${serial}, ${config.title}, prize ${formatRLO(config.prize)} RLO, ${sold} of ${config.supply} tickets sold, ${PHASE_WORD[raffle.phase].toLowerCase()}`}
      >
        <div className="mb-[clamp(22px,2.6vw,32px)] flex items-center justify-between gap-2.5">
          <span className="label border border-bound px-2 py-1 text-fg-2">
            {PHASE_WORD[raffle.phase]}
          </span>
          <span className="label text-fg-3">
            Sample <span className="serial">{serial}</span>
          </span>
        </div>

        {/* The prize, and the largest thing on the card. --text-pool is the step this figure is
            drawn at everywhere else in the product, capped at six glyphs; the largest prize in
            the book is five, and the unit is a label beside it rather than part of the figure. */}
        <p className="m-0 flex items-baseline gap-[0.4em]">
          <span className="monument text-[clamp(2.75rem,4.4vw,4rem)]">
            {formatRLO(config.prize)}
          </span>
          <span className="label text-fg-3">RLO</span>
        </p>

        <h3 className="m-0 mt-3.5 text-lg leading-[1.3] font-medium">{config.title}</h3>

        <dl className="m-0 mt-[clamp(18px,2vw,24px)] flex flex-wrap gap-x-[22px] gap-y-1.5">
          <div className="grid gap-[3px]">
            <dt className="label text-fg-3">Ticket</dt>
            <dd className="figure m-0 text-sm">{formatRLO(config.ticketPrice)} RLO</dd>
          </div>
          <div className="grid gap-[3px]">
            <dt className="label text-fg-3">Sold</dt>
            <dd className="figure m-0 text-sm">
              {sold} / {config.supply}
            </dd>
          </div>
          {/* A void raffle's third fact is what it handed back, not its pool. `summarize` leaves the
              reveal bonds out of a void pool, so this is `voidReturns(r).total` from
              lib/mock-raffles.ts, the figure /raffle/5 and the board print: 1.65 for sample 0005. */}
          <div className="grid gap-[3px]">
            <dt className="label text-fg-3">{raffle.phase === "void" ? "Returned" : "Pool"}</dt>
            <dd className="figure m-0 text-sm">
              {formatRLO(raffle.phase === "void" ? voidReturns(raffle).total : pool)} RLO
            </dd>
          </div>
        </dl>

        <div className="mt-[clamp(18px,2vw,24px)]">
          <Strip raffle={raffle} />
        </div>
        <p className="label m-0 mt-2.5 text-fg-3">
          <span className="text-fg-2">{Math.round((sold / config.supply) * 100)}%</span> of tickets
          gone
        </p>

        {/* Wraps rather than squeezes. Both halves are held on one line, so where they do not
            fit side by side the call to action drops under the stamp instead of pushing the page
            wider. The two labels are the same length on purpose: "See the record" made a closed
            card's row 285px against 278 at 360, which is why its stamp used to break in two.
            "Open record" fits from 360 up; only at 320 does the call to action drop. */}
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3.5 gap-y-3 pt-[clamp(22px,2.6vw,30px)]">
          <span className="grid gap-[5px]">
            <span className="label text-fg-3">{clockLabel(raffle)}</span>
            {/* One element either way: `<Countdown>` already prints a stamp rather than a ladder
                when `live` is false, so a settled card gets "26 Jul 09:00" from the same component
                that ticks on a live one, and there is no second date formatter on this card.

                The two forms take different sizes because they are different lengths, not because
                a record card matters less. A live ladder is at most six glyphs ("3d 02h"); the
                stamp is twelve, and at the ladder's step it breaks over two lines and drags the
                card's own baseline away from the call to action beside it. The smaller step was
                not enough on its own: at 360px the stamp still shrank beside the nowrap call to
                action and broke as "26 Jul" over "09:00", so it is held on one line as well. */}
            <span
              className={`monument whitespace-nowrap leading-none ${live ? "text-[1.375rem]" : "text-[1rem]"}`}
            >
              <Countdown
                deadline={live ? activeDeadline(raffle) : config.revealDeadline}
                live={live}
              />
            </span>
          </span>
          <span className="label rcard-cta whitespace-nowrap text-fg">
            {live ? "Open sample" : "Open record"} <span aria-hidden="true">&rarr;</span>
          </span>
        </div>
      </Link>
    </li>
  );
}
