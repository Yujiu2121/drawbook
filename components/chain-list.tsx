"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";

import {
  CHAIN_PHASE_WORD,
  NETWORK,
  PhaseTag,
  cleanTitle,
  describeError,
  figureKelvin,
  formatKelvin,
  ladder,
  shortMs,
  useNow,
} from "@/components/chain-ui";
import { COUNTDOWN_RESERVE } from "@/lib/cell";
import { listRaffles } from "@/lib/chain/actions";
import { phaseOf, type ChainPhase, type ChainRaffle } from "@/lib/chain/program";
import { shortAddress } from "@/lib/raffle";

/**
 * THE RAFFLES THAT ARE ACTUALLY ON CHAIN, AT THE TOP OF THE BOARD.
 *
 * Everything else on /raffles is a Server Component over the fixed sample record, and stays one.
 * This list cannot be: it is whatever accounts the raffle program owns right now, read from the
 * node in the browser with listRaffles() and read again every thirty seconds while the tab is
 * visible, so a raffle deployed in another tab appears here without a reload.
 *
 * ANYONE CAN DEPLOY, SO ROWS ARE CHEAP TO ADD. Every read downloads every raffle account (up to
 * about 17 KB each), so the read is spaced out and paused while the tab is hidden, the list shows at
 * most MAX_ROWS rows, a title has its control and bidirectional characters removed before it is
 * printed, and each row names its creator's address, so a look-alike title cannot pass for someone
 * else's raffle on the title alone.
 *
 * SAME ROW, DIFFERENT SOURCE. Each entry is the board's own `.row` grid from app/cell.css (serial,
 * title, stage, strip, pool, clock) so a live raffle and a sample read as the same object. The
 * serial column carries the first four characters of the account address, because a live raffle
 * has no small number: its address is its identity, and the full one is on its page.
 *
 * NO VIEW TRANSITION NAME. The sample rows name their strips for the morph into /raffle/[id]; a
 * live row goes to /r/[address], which names nothing, so naming this strip would start a morph with
 * nowhere to land.
 */

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; raffles: ChainRaffle[]; stale: string | null };

const READ_MS = 30_000;

/** The most rows the list prints. The rest are counted, not drawn. */
const MAX_ROWS = 40;

/** What the pool column prints: the money the raffle holds for its winners at this moment. */
function poolNow(r: ChainRaffle, phase: ChainPhase): bigint {
  const sold = BigInt(r.sold);
  if (phase === "drawn") return r.pool;
  if (phase === "void") return r.prize + sold * (r.ticketPrice + r.revealBond);
  if (phase === "ready") {
    return r.prize + sold * r.ticketPrice + BigInt(r.sold - r.revealed) * r.revealBond;
  }
  return r.prize + sold * r.ticketPrice;
}

/** The order a visitor wants: what can still be entered, soonest to close first, then the record. */
function order(raffles: ChainRaffle[], now: number) {
  const rank = (p: ChainPhase) => (p === "selling" ? 0 : p === "revealing" ? 1 : p === "ready" ? 2 : 3);
  return raffles
    .map((r) => ({ r, phase: phaseOf(r, now) }))
    .sort((a, b) => {
      const byRank = rank(a.phase) - rank(b.phase);
      if (byRank !== 0) return byRank;
      if (a.phase === "selling") return a.r.commitDeadline - b.r.commitDeadline;
      if (a.phase === "revealing") return a.r.revealDeadline - b.r.revealDeadline;
      return (b.r.drawnAt || b.r.createdAt) - (a.r.drawnAt || a.r.createdAt);
    });
}

function ChainRow({ r, phase, now }: { r: ChainRaffle; phase: ChainPhase; now: number }) {
  const pool = poolNow(r, phase);
  const dense = r.supply > 60;
  const title = cleanTitle(r.title) || "Untitled raffle";
  const clock =
    phase === "selling"
      ? ladder(r.commitDeadline, now)
      : phase === "revealing"
        ? ladder(r.revealDeadline, now)
        : phase === "ready"
          ? "draw"
          : shortMs(r.drawnAt || r.revealDeadline);

  return (
    <Link
      href={`/r/${r.address}`}
      className="row"
      data-phase={phase}
      aria-label={`${title}, on ${NETWORK}, created by ${shortAddress(r.creator, 4, 4)}. ${CHAIN_PHASE_WORD[phase]}, ${r.sold} of ${r.supply} tickets sold, pool ${formatKelvin(pool)} RLO.`}
    >
      <span className="a-serial serial" style={{ fontSize: "var(--text-label)" }} title={r.address}>
        {r.address.slice(0, 4)}
      </span>

      <span className="a-title">
        <b>{title}</b>
        <span className="block text-sm text-fg-3">
          <span className="whitespace-nowrap" title={r.creator}>
            by <span className="mono">{shortAddress(r.creator, 4, 4)}</span>
          </span>{" "}
          <span className="whitespace-nowrap">
            {"·"} {r.sold} of {r.supply} tickets sold
          </span>
          {r.revealed > 0 ? (
            <>
              {" "}
              <span className="whitespace-nowrap">{"·"} {r.revealed} revealed</span>
            </>
          ) : null}
        </span>
      </span>

      <span className="a-phase">
        <PhaseTag phase={phase} />
      </span>

      <span className="a-strip">
        {/* Past 60 tickets the strip drops its 1px gaps, or 200 gaps would be wider than the column. */}
        <span
          className="strip"
          role="img"
          aria-label={`${r.sold} of ${r.supply} tickets sold`}
          style={{ "--n": String(r.supply), ...(dense ? { gap: "0px" } : {}) } as CSSProperties}
        >
          {r.tickets.map((t) => (
            <i
              key={t.index}
              className="c"
              data-s={
                t.holder === null ? 0 : r.status === "void" ? 4 : t.won ? 3 : t.revealed ? 2 : 1
              }
            />
          ))}
        </span>
      </span>

      <span className="a-pool">
        <span className="figure text-sm">{figureKelvin(pool, 8) ?? formatKelvin(pool)}</span>{" "}
        <span className="label text-fg-3">RLO</span>
      </span>

      <span className="a-count figure text-sm" style={COUNTDOWN_RESERVE}>
        <span className={phase === "drawn" || phase === "void" ? "text-fg-3" : ""}>{clock}</span>
      </span>
    </Link>
  );
}

export function ChainRaffleList() {
  const now = useNow();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const raffles = await listRaffles();
        if (alive) setState({ kind: "ready", raffles, stale: null });
      } catch (error) {
        const message = describeError(error).text;
        if (!alive) return;
        // Keep a list that was read once rather than blanking it on one failed read.
        setState((prev) => (prev.kind === "ready" ? { ...prev, stale: message } : { kind: "error", message }));
      }
    };
    // Only while the tab is visible: a hidden board has nobody reading it. Coming back reads at once.
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const onVisibility = () => {
      if (visible()) void read();
    };
    void read();
    const id = setInterval(() => {
      if (visible()) void read();
    }, READ_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const rows = state.kind === "ready" && now > 0 ? order(state.raffles, now) : [];
  const liveCount = rows.filter(({ phase }) => phase !== "drawn" && phase !== "void").length;
  const meta =
    state.kind === "ready"
      ? [`${state.raffles.length} on ${NETWORK}`, `${liveCount} live`]
      : [`on ${NETWORK}`];

  return (
    <section aria-labelledby="chain-floor" className="border-b border-rule">
      <div className="px-pad pt-[clamp(26px,3.4vw,44px)] pb-[clamp(16px,2vw,24px)]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
          <h2 id="chain-floor" className="m-0 font-serif text-title">
            On chain
          </h2>
          <p className="label text-fg-3">
            {meta.map((part, i) => (
              <span key={part}>
                {i > 0 ? <span aria-hidden="true"> {"·"} </span> : null}
                <span className="whitespace-nowrap">{part}</span>
              </span>
            ))}
          </p>
        </div>
        <p className="mt-3 max-w-[58ch] text-sm text-fg-2">
          Raffles deployed to the Drawbook program on {NETWORK}. These are real: a ticket here is a
          signed transaction that moves {NETWORK} RLO, and the draw runs inside the program. Open one
          to buy, reveal, draw or claim.
        </p>
      </div>

      {state.kind === "loading" || (state.kind === "ready" && now === 0) ? (
        <p className="px-pad pb-[clamp(20px,3vw,32px)] text-sm text-fg-3">
          Reading the raffle program&rsquo;s accounts from {NETWORK}.
        </p>
      ) : state.kind === "error" ? (
        <p className="px-pad pb-[clamp(20px,3vw,32px)] text-sm text-fg-3">
          The {NETWORK} node did not answer ({state.message}). Trying again every thirty seconds.
        </p>
      ) : rows.length === 0 ? (
        <div className="px-pad pb-[clamp(20px,3vw,32px)]">
          {/* No deploy button even here: the masthead carries one on every route, and this page's
              header explains why a third copy does not belong on it. */}
          <p className="max-w-[58ch] text-sm text-fg-2">
            No raffle has been deployed to the program yet. The first one created from Deploy in the
            bar above will be the first row here.
          </p>
        </div>
      ) : (
        <>
          <div className="rowhead label" aria-hidden="true">
            <span className="a-serial">Acct</span>
            <span className="a-title">Raffle</span>
            <span className="a-phase">Stage</span>
            <span className="a-strip">Tickets</span>
            <span className="a-pool">Pool</span>
            <span className="a-count">Closes</span>
          </div>
          <div className="rows">
            {rows.slice(0, MAX_ROWS).map(({ r, phase }) => (
              <ChainRow key={r.address} r={r} phase={phase} now={now} />
            ))}
          </div>
          {rows.length > MAX_ROWS && (
            <p className="px-pad py-3 text-sm text-fg-3">
              Showing the first {MAX_ROWS} of {rows.length}, open ones first. Each raffle has its own
              address; a link to one opens it whatever this list shows.
            </p>
          )}
          {state.kind === "ready" && state.stale && (
            <p className="px-pad py-3 text-sm text-fg-3">
              The last read failed ({state.stale}); the list is as it was last read.
            </p>
          )}
        </>
      )}
    </section>
  );
}
