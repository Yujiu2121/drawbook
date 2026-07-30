import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { HeroFigure, Panel } from "./panel";
import {
  formatCountdown,
  formatRLO,
  secondsBetween,
  summarize,
  type Address,
  type Phase,
  type Raffle,
} from "@/lib/raffle";

/**
 * The board.
 *
 * One raffle is promoted to a panel with a single large figure. An earlier version put three
 * display-size figures side by side, which meant nothing was the subject and the page read as busy.
 * Only the prize pool is large now; the countdown sits under it in the accent colour, and everything
 * else is a row.
 */

const PHASE_LABEL: Record<Phase, string> = {
  selling: "Selling",
  revealing: "Revealing",
  drawn: "Drawn",
  void: "Void",
};

export function deadlineOf(raffle: Raffle) {
  return raffle.phase === "selling"
    ? raffle.config.commitDeadline
    : raffle.config.revealDeadline;
}

export function isOpen(raffle: Raffle) {
  return raffle.phase === "selling" || raffle.phase === "revealing";
}

function Featured({ raffle, viewer, now }: { raffle: Raffle; viewer: Address; now: Date }) {
  const s = summarize(raffle);
  const mine = raffle.tickets.filter((t) => t.holder === viewer).length;
  const seconds = secondsBetween(now, deadlineOf(raffle));
  const selling = raffle.phase === "selling";

  return (
    <Panel
      label={selling ? "Closing next" : "Awaiting reveals"}
      right={
        <span className="tnum">{String(raffle.config.id).padStart(4, "0")}</span>
      }
    >
      <HeroFigure value={formatRLO(s.pool)} unit="RLO prize pool" />

      <div className="border-t border-line px-4 py-3 text-center">
        <span className="label">
          {selling ? "Sale closes in" : "Reveals close in"}
        </span>
        <span className="tnum ml-2 text-lg text-accent">{formatCountdown(seconds)}</span>
      </div>

      <div className="border-t border-line px-4 py-4">
        <h3 className="text-base">{raffle.config.title}</h3>
        <p className="mt-1.5 text-sm text-text-2">
          <span className="tnum text-text">{formatRLO(raffle.config.ticketPrice)}</span> RLO a
          ticket, <span className="tnum text-text">{raffle.config.winners}</span>{" "}
          {raffle.config.winners === 1 ? "winner" : "winners"},{" "}
          <span className="tnum text-text">{selling ? s.available : s.outstanding}</span>{" "}
          {selling ? "tickets left" : "reveals outstanding"}
          {mine > 0 && (
            <>
              {". You hold "}
              <span className="tnum text-accent">{mine}</span>
            </>
          )}
          .
        </p>

        <Link
          href={`/raffle/${raffle.config.id}`}
          className="mt-4 inline-flex items-center gap-2 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-page transition-transform active:translate-y-px"
        >
          {selling ? "Buy a ticket" : "Reveal"}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </Link>
      </div>
    </Panel>
  );
}

/**
 * One grid template shared by the header and every row. The number of children must equal the
 * number of columns at each breakpoint, or the extra child silently wraps onto a second row.
 * `hidden` children are display:none and leave the grid entirely, which is how the mobile variant
 * drops to three columns.
 *
 * Desktop: No, Raffle, Pool, Sold, Closes.
 * Mobile:  No, Raffle, Pool.
 */
const COLS = "grid grid-cols-[2.5rem_1fr_5rem] sm:grid-cols-[2.75rem_1fr_6rem_4.5rem_5.5rem]";

function Row({ raffle, viewer, now }: { raffle: Raffle; viewer: Address; now: Date }) {
  const { config, phase } = raffle;
  const s = summarize(raffle);
  const mine = raffle.tickets.filter((t) => t.holder === viewer).length;
  const open = isOpen(raffle);
  const remaining = open ? formatCountdown(secondsBetween(now, deadlineOf(raffle))) : null;

  return (
    <li>
      <Link
        href={`/raffle/${config.id}`}
        data-row=""
        className={`${COLS} items-center gap-x-3 border-b border-line px-4 py-3 transition-colors last:border-b-0 hover:bg-raised`}
      >
        <span className="tnum text-xs text-text-3">{String(config.id).padStart(4, "0")}</span>

        <span className="min-w-0">
          <span className="flex items-baseline gap-2">
            <span className={`truncate text-sm ${open ? "text-text" : "text-text-2"}`}>
              {config.title}
            </span>
            {mine > 0 && (
              <span
                className="tnum shrink-0 border border-accent px-1 text-[10px] text-accent"
                title={`You hold ${mine} ${mine === 1 ? "ticket" : "tickets"}`}
              >
                <span aria-hidden="true">{mine}</span>
                <span className="sr-only">
                  you hold {mine} {mine === 1 ? "ticket" : "tickets"}
                </span>
              </span>
            )}
          </span>
          <span className="mt-1 flex items-baseline gap-2 sm:hidden">
            <span className="text-xs text-text-3">{PHASE_LABEL[phase]}</span>
            {remaining && <span className="tnum text-xs text-accent">{remaining}</span>}
          </span>
        </span>

        <span className="tnum text-right text-base">{formatRLO(s.pool)}</span>

        <span className="tnum hidden text-right text-sm text-text-3 sm:block">
          {s.sold}/{config.supply}
        </span>
        <span
          className={`tnum hidden text-right text-sm sm:block ${
            open ? "text-accent" : "text-text-3"
          }`}
        >
          {remaining ?? PHASE_LABEL[phase]}
        </span>
      </Link>
    </li>
  );
}

function Board({ label, raffles, viewer, now }: {
  label: string;
  raffles: Raffle[];
  viewer: Address;
  now: Date;
}) {
  if (raffles.length === 0) return null;

  return (
    <Panel label={label} right={<span className="tnum">{raffles.length}</span>}>
      <div
        data-row=""
        className={`${COLS} items-end gap-x-3 border-b border-line px-4 py-2 label`}
      >
        <span>No</span>
        <span>Raffle</span>
        <span className="text-right">Pool</span>
        <span className="hidden text-right sm:block">Sold</span>
        <span className="hidden text-right sm:block">Closes</span>
      </div>
      <ul>
        {raffles.map((raffle) => (
          <Row key={raffle.config.id} raffle={raffle} viewer={viewer} now={now} />
        ))}
      </ul>
    </Panel>
  );
}

export function RaffleBoard({
  raffles,
  viewer,
  now,
}: {
  raffles: Raffle[];
  viewer: Address;
  now: Date;
}) {
  const open = raffles
    .filter(isOpen)
    .sort((a, b) => deadlineOf(a).localeCompare(deadlineOf(b)));
  const settled = raffles.filter((r) => !isOpen(r)).sort((a, b) => b.config.id - a.config.id);
  const [featured, ...rest] = open;

  return (
    <div className="flex flex-col gap-5">
      {featured ? (
        <Featured raffle={featured} viewer={viewer} now={now} />
      ) : (
        <Panel label="Nothing open">
          <div className="px-4 py-12 text-center">
            <p className="text-lg">Every draw has settled</p>
            <p className="mt-2 text-sm text-text-2">
              The next raffle deployed will show up here.
            </p>
            <Link
              href="/create"
              className="mt-5 inline-flex items-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-medium text-page"
            >
              Deploy the first one
              <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </Link>
          </div>
        </Panel>
      )}

      <Board label="Also open" raffles={rest} viewer={viewer} now={now} />
      <Board label="Settled" raffles={settled} viewer={viewer} now={now} />
    </div>
  );
}
