"use client";

/**
 * The counter: the two places on a sample raffle's page where a hand meets the drum.
 *
 * Every raffle at /raffle/[id] is a sample: fixed demonstration data in lib/mock-raffles.ts, not
 * an account on any chain. The raffles that really are on Rialo testnet live at /r/[address], and
 * their buy, reveal, draw and claim are signed transactions in components/chain-raffle.tsx. So
 * nothing in this file signs, sends or composes anything for a chain, and both controls say what
 * they are in the sentence beside them:
 *
 *   CHECK A REVEAL is a worked example. The stubs are the sample holder's and their nonces come
 *   from the sample record, standing in for the browser storage a real holder keeps them in. The
 *   press runs the check a reveal is held to, in this tab, and shows it.
 *
 *   RECOMPUTE re-runs the draw from the public nonces and the chain value. On a sample the record
 *   was produced by this same code, so the recomputation cannot disagree with it: it demonstrates
 *   the method rather than testing anyone, and the note under it says exactly that.
 *
 * WHAT THIS FILE NO LONGER DOES, AND WHY
 * It used to hold a third control that composed a `buy_ticket` JSON payload from the connected
 * wallet and printed it as "the exact payload that would be posted", with a sentence saying no
 * raffle program was deployed. Both halves stopped being true the day the program went live: the
 * sentence is false, and the program's real Buy instruction is a tag, a ticket number and a
 * commitment over fixed-width bytes, nothing like that JSON. The reveal panel printed a matching
 * `reveal` payload for the same reason. Those payloads are gone rather than relabelled. The buy
 * stub on the page is now server markup that points at a live raffle, and the reveal panel keeps
 * only the check, which is true of any commit-reveal scheme including the program's.
 *
 * A CONTROL STOPS OFFERING WHAT WOULD NOW BE REFUSED
 * The reveal check reads `lib/clock.ts`, the same published second the countdown on the page
 * reads, and closes when the sample's reveal window passes under an open tab. A check already on
 * screen is taken down at the same instant rather than left beside the sentence saying reveals
 * have closed, which was two contradicting statements on one screen. The server and the first
 * hydration render agree, because the clock publishes zero from both until the first frame.
 *
 * CONTRAST, COMPUTED against the surface each token sits on, formula sanity-checked at white on
 * black = 21.00, and read back out of the browser as rendered rather than only off the palette.
 *
 *   light  --fg 15.01 / --fg-2 7.60 / --fg-3 5.73 / --bound 5.18 on --panel
 *          --fg 11.86 / --fg-2 6.01 / --fg-3 4.53 on --recess, the well
 *          --panel on --fg 15.01, the pressed control and the refusal
 *   inv    --fg 15.01 / --fg-2 7.49 / --fg-3 5.65 / --bound 5.65 on --panel
 *          --fg 11.15 / --fg-3 5.57 on --recess, the audit well on a settled raffle
 *
 * NO SIGNAL HUE IS SPENT HERE. `--event` is ceremonial in this system: a winner, a payout, a
 * countdown in its final hour. A control or a refusal in that hue would make a button the only
 * iris on the page.
 */

import { useState, useSyncExternalStore } from "react";

import { utcStamp } from "@/lib/cell";
import {
  getServerSnapshot as clockServerSnapshot,
  getSnapshot as clockSnapshot,
  hasClosed,
  subscribe as clockSubscribe,
} from "@/lib/clock";
import {
  commitmentFor,
  deriveSeed,
  deriveWinners,
  shortAddress,
  type Address,
} from "@/lib/raffle";

/** Ticket numbers are two digits everywhere a cell is drawn, so they are two digits here too. */
const pad2 = (n: number) => String(n).padStart(2, "0");

/* --------------------------------------------------------------------- the chrome */

/**
 * The shared control shell. Same border, same padding and same transition as the back link and the
 * two wallet chips, so a control in the page reads as the same object as a control in the bar.
 */
const CONTROL =
  "label inline-flex items-center justify-center gap-2 border px-3.5 py-2.5 transition-colors duration-[var(--t-open)] ease-settle";

/** The secondary action: a bounded control on the page surface, filling with ink under the hand. */
const SECONDARY = `${CONTROL} border-bound text-fg hover:bg-panel-2 active:translate-y-px`;

/** The pressed state of a secondary control, which is how the checked stub names itself. */
const SECONDARY_ON = `${CONTROL} border-fg bg-fg text-panel`;

/**
 * The recess where the content breaks on its own and there is nothing to scroll.
 *
 * It carries the bare `recess` class as well as the `bg-recess` utility, and that is not
 * decoration: `app/globals.css` ends with `.inv .recess { --fg-3: var(--paper-2) }`, which is how
 * the system's one remaining failing pair, --paper-3 on --line-inv at 4.20, is removed by
 * construction. The audit control renders on a settled raffle, which is inverted, so without the
 * class its labels would be that 4.20.
 */
const WELL_STATIC = "recess bg-recess px-4 py-3.5";
const NOTE = "max-w-[62ch] text-sm text-fg-2";
const LEDGER_TERM = "label text-fg-3";
const LEDGER_VALUE = "digest mt-1 text-sm leading-relaxed text-fg";

/* ------------------------------------------------------------------------ reveal */

export interface PresentableStub {
  index: number;
  holder: Address;
  commitment: string;
  /**
   * The holder's secret. On a live raffle it exists only in their own browser; the sample record
   * keeps one for each of the sample holder's tickets so the check can be shown at all, and the
   * panel says so.
   */
  nonce: string;
}

interface Checked {
  index: number;
  nonce: string;
  rebuilt: string;
  committed: string;
  matches: boolean;
}

export function PresentHalf({
  raffleId,
  stubs,
  revealDeadline,
}: {
  raffleId: number;
  stubs: PresentableStub[];
  /** ISO. The sample's reveals close here and the control closes with them. */
  revealDeadline: string;
}) {
  const elapsed = useSyncExternalStore(clockSubscribe, clockSnapshot, clockServerSnapshot);
  const [checked, setChecked] = useState<Checked | null>(null);

  const closed = hasClosed(revealDeadline, elapsed);
  const holder = stubs[0]?.holder ?? null;
  /*
    Derived during render rather than cleared from an effect: once the window has passed, a check
    composed before it is simply not shown, on the same frame the closing sentence appears.
  */
  const shown = closed ? null : checked;

  function check(stub: PresentableStub) {
    if (closed) return;

    const rebuilt = commitmentFor(stub.nonce, stub.holder, raffleId, stub.index);

    setChecked({
      index: stub.index,
      nonce: stub.nonce,
      rebuilt,
      committed: stub.commitment,
      matches: rebuilt === stub.commitment,
    });
  }

  return (
    <section aria-labelledby="present-heading" className="mt-7 border-t border-rule pt-6">
      <h2 id="present-heading" className="label">
        Check a reveal
      </h2>

      <p className={`${NOTE} mt-3`}>
        Reveals close {utcStamp(revealDeadline)} on the sample clock. A reveal publishes the nonce
        behind a ticket, so anyone can hash it again and compare the result with the commitment
        filed when the ticket was bought.
      </p>

      {holder !== null && (
        <p className={`${NOTE} mt-3`}>
          A worked example on sample data, and nothing is sent. These stubs belong to the sample
          holder <span className="mono whitespace-nowrap text-fg">{shortAddress(holder, 4, 4)}</span>,
          an address kept in the sample record rather than one anybody holds, and their nonces come
          from the record too. On a live raffle the holder&rsquo;s own browser sends the nonce in a
          signed Reveal transaction, and the program runs this same comparison before it accepts it.
        </p>
      )}

      {closed ? (
        <p className={`${NOTE} mt-4`}>
          Reveals closed at {utcStamp(revealDeadline)} on the sample clock, so the check is no
          longer offered: a reveal after the window is refused, and every ticket still silent at
          that instant loses its bond to the pool.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {stubs.map((stub) => {
            const on = shown?.index === stub.index;
            return (
              <button
                key={stub.index}
                type="button"
                onClick={() => check(stub)}
                aria-pressed={on}
                className={on ? SECONDARY_ON : SECONDARY}
              >
                Check ticket {pad2(stub.index)}
              </button>
            );
          })}
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {shown
          ? `Checked ticket ${pad2(shown.index)}. The nonce ${
              shown.matches ? "hashes to the recorded commitment" : "does not hash to the recorded commitment"
            }. Nothing was sent.`
          : ""}
      </p>

      {shown && (
        <div className="mt-6 min-w-0 border border-bound">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule px-4 py-3">
            <span className="label text-fg-3">The check &middot; ticket {pad2(shown.index)}</span>
            <span className="label text-fg-3">Sample, not sent</span>
          </div>

          <dl className="grid gap-4 px-4 py-4">
            {[
              { term: "Nonce revealed", value: shown.nonce },
              { term: "Hashes to", value: shown.rebuilt },
              { term: "Committed at purchase", value: shown.committed },
            ].map((row) => (
              <div key={row.term}>
                <dt className={LEDGER_TERM}>{row.term}</dt>
                <dd className={LEDGER_VALUE}>{row.value}</dd>
              </div>
            ))}
          </dl>

          {shown.matches ? (
            <p className="border-t border-rule px-4 py-3 text-sm text-fg-2">
              The two are the same string, so a reveal of this nonce would be accepted and it would
              go into the seed.
            </p>
          ) : (
            /* A refusal is reversed print, never a colour: the signal hue means a result. */
            <p className="label bg-fg px-4 py-3 text-panel">
              Refused. This nonce is not the preimage of that commitment.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------- audit */

/**
 * Everything needed to re-derive a settled draw, and nothing that is not already public.
 *
 * A `Raffle` would have been one prop instead of six, and would have shipped every commitment and
 * every holder to the browser to print two numbers. These six fields are exactly the public record
 * the claim rests on: if recomputing the draw needed anything that is not in here, the draw would
 * not be checkable by a stranger, which is the whole product.
 */
export interface AuditInput {
  raffleId: number;
  /** The chain value read at the draw, hex. */
  chainSeed: string;
  /** Every revealed nonce, hex. Public from the moment its holder presented it. */
  nonces: string[];
  /** Ticket indices eligible for the draw, which is exactly the revealed ones. */
  eligible: number[];
  /** How many tickets the raffle draws, before the cap at the eligible count. */
  winnerCount: number;
  /** The winning tickets as the book records them, in draw order. */
  recordedWinners: number[];
}

interface Recomputed {
  seed: string;
  winners: number[];
  matches: boolean;
}

export function AuditRecompute({ audit }: { audit: AuditInput }) {
  const [out, setOut] = useState<Recomputed | null>(null);

  function recompute() {
    const seed = deriveSeed(audit.raffleId, audit.nonces, audit.chainSeed);
    const winners = deriveWinners(audit.eligible, seed, audit.winnerCount);

    setOut({
      seed,
      winners,
      matches:
        winners.length === audit.recordedWinners.length &&
        winners.every((w, i) => w === audit.recordedWinners[i]),
    });
  }

  return (
    <div>
      <button type="button" onClick={recompute} className={SECONDARY}>
        Recompute it here
      </button>

      <p role="status" aria-live="polite" className="sr-only">
        {out
          ? out.matches
            ? "Recomputed. The winners derived in this tab are the winners on the sample record."
            : "Recomputed. The winners derived in this tab are not the winners on the sample record."
          : ""}
      </p>

      {out && (
        <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]">
          <div className={`${WELL_STATIC} min-w-0`}>
            <dl className="grid gap-4">
              <div>
                <dt className={LEDGER_TERM}>Seed, recomputed here</dt>
                <dd className={LEDGER_VALUE}>{out.seed}</dd>
              </div>
              <div>
                <dt className={LEDGER_TERM}>Winners, recomputed here</dt>
                <dd className="figure mt-1 text-sm text-fg">
                  {out.winners.map(pad2).join(", ")}
                </dd>
              </div>
              <div>
                <dt className={LEDGER_TERM}>Winners on the record</dt>
                <dd className="figure mt-1 text-sm text-fg">
                  {audit.recordedWinners.map(pad2).join(", ")}
                </dd>
              </div>
            </dl>
          </div>

          <div className="min-w-0">
            {out.matches ? (
              <p className="text-sm text-fg-2">Same tickets, same order.</p>
            ) : (
              <p className="label bg-fg px-4 py-3 text-panel">
                The recomputed winners are not the winners on the record.
              </p>
            )}

            {/*
              The claim, sized to what it is. On a sample this re-runs the code that made the
              record, so it cannot come out differently and it must not be read as an audit. The
              same derivation on a live raffle's page runs against chain data and can fail.
            */}
            <p className={`${NOTE} mt-3`}>
              Computed in this tab just now, from the {audit.nonces.length} public nonces and the
              chain value alone. This is a sample, and its record was produced by this same code,
              so the result cannot differ: it shows the method rather than testing anyone. On a
              live raffle the page recomputes the draw from chain data, where it can fail.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
