"use client";

/**
 * The counter: the three places on this page where a hand meets the drum.
 *
 * Taking a ticket, presenting a half and recomputing the draw are the only interactive things on
 * the raffle page. None of them is wired, because no raffle program is deployed on Rialo testnet
 * yet, so the first two terminate in the exact payload that would be posted, with the sentence
 * saying so, and the third computes a real SHA-256 in this tab and says that it did. There is no
 * spinner, no toast and no fabricated success anywhere in this file.
 *
 * WHY THREE EXPORTS AND NOT THREE FILES
 * The audit button is one control with one piece of state. A thirteenth client island for it would
 * cost another boundary, another flight payload and another file to keep honest, and it belongs
 * with the other two unwired controls rather than beside the server-rendered formula it checks.
 *
 * THE FACE IS RENDERED ON THE SERVER AND HANDED IN
 * `face: ReactNode` is the pattern every island in this port follows: the route stays a Server
 * Component, renders the cells, the sheet and the tables, and drops the result into the slot this
 * island leaves for it. Nothing in here re-renders the ticket field, and no raffle object crosses
 * the boundary: every prop below is a scalar or a list of public strings, so the flight payload
 * carries no commitment and no unrevealed nonce.
 *
 * THE HONESTY DEFECT THIS FILE EXISTS TO NOT CARRY OVER
 * The design this ports gates both flows on a connected wallet, correctly, because `commitmentFor`
 * binds the holder address into the digest. It then composes that commitment from a synthetic
 * address that is not derived from any keypair, so the interface asks you to connect a wallet and
 * then hands you a purchase bound to an address you do not hold. The real wallet in
 * `lib/wallet.ts` is a genuine Ed25519 public key, different in every browser.
 *
 * The split here is by flow, and each half says which it is:
 *
 *   BUYING is yours. `buyer` is read from `lib/wallet-store.ts` at the moment of the press and the
 *   commitment is composed from it. There is no viewer constant in this file, so the payload
 *   cannot name one. With no wallet connected there is no payload at all, and the control says
 *   why rather than printing one that would bind a stranger.
 *
 *   REVEALING is a worked example, and is labelled as one. The stubs a real holder could present
 *   are the ones whose nonces exist, and in this book those are the example holder's, recorded in
 *   `lib/mock-raffles.ts` rather than held by anyone. The panel names that address instead of
 *   calling it yours, and the nonce it publishes is the one the book recorded, standing in for the
 *   browser storage a real holder would keep it in.
 *
 * A CONTROL STOPS OFFERING WHAT WOULD NOW BE REJECTED
 * Both flows read `lib/clock.ts`, which is the same published second the countdown on this page
 * reads, and both close themselves when their deadline passes under an open tab. `buy_ticket` is
 * rejected for a raffle that is no longer selling and `reveal` for one whose window has shut, and
 * a control that goes on composing a payload the program would throw on is a small lie told
 * politely. The server and the first hydration render agree, because the clock publishes zero from
 * both until the first frame.
 *
 * CONTRAST, COMPUTED against the surface each token sits on, formula sanity-checked at white on
 * black = 21.00, and read back out of the browser as rendered rather than only off the palette.
 *
 *   light  --fg 15.01 / --fg-2 7.60 / --fg-3 5.73 / --bound 5.18 on --panel
 *          --fg 11.86 / --fg-2 6.01 / --fg-3 4.53 on --recess, the payload well
 *          --fg-3 5.27 / --bound 4.77 on --panel-2, which is the disabled control
 *          --panel on --fg 15.01, the reversed control and the refusal, 7.60 on its hover
 *   inv    --fg 15.01 / --fg-2 7.49 / --fg-3 5.65 / --bound 5.65 on --panel
 *          --fg 11.15 / --fg-3 5.57 on --recess, the audit well on a settled raffle
 *
 * Every text pair clears AA at its size and every boundary clears the 3:1 that SC 1.4.11 asks of a
 * control. The tightest is the 11px well label at 4.53 on light, which is the tightest passing pair
 * in the system and is documented as such in app/globals.css.
 *
 * NO SIGNAL HUE IS SPENT HERE. `--event` is ceremonial in this system: a winner, a payout, a
 * countdown in its final hour. The design this ports fills its two print buttons with it, which
 * would make the only iris on a selling raffle a button rather than a result. A control that is
 * the page's primary action is full ink instead, which is what this material model already says a
 * pressed surface is.
 */

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";

import { serialOf, utcStamp } from "@/lib/cell";
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
  formatRLO,
  newNonce,
  shortAddress,
  type Address,
} from "@/lib/raffle";
import {
  getServerSnapshot as walletServerSnapshot,
  getSnapshot as walletSnapshot,
  subscribe as walletSubscribe,
} from "@/lib/wallet-store";

/** Ticket numbers are two digits everywhere a cell is drawn, so they are two digits here too. */
const pad2 = (n: number) => String(n).padStart(2, "0");

/* --------------------------------------------------------------------- the chrome */

/**
 * The shared control shell. Same border, same padding and same transition as the back link and the
 * two wallet chips, so a control in the page reads as the same object as a control in the bar.
 */
const CONTROL =
  "label inline-flex items-center justify-center gap-2 border px-3.5 py-2.5 transition-colors duration-[var(--t-open)] ease-settle";

/**
 * The primary action, in reversed print: full ink, panel lettering. Hover steps to --fg-2 rather
 * than lifting, because nothing in this room casts a shadow to lift out of, and the press is a
 * single-pixel translate, which is a transform and repaints nothing.
 */
const PRIMARY = `${CONTROL} border-fg bg-fg text-panel hover:border-fg-2 hover:bg-fg-2 active:translate-y-px disabled:cursor-not-allowed disabled:border-bound disabled:bg-panel-2 disabled:text-fg-3`;

/** The secondary action: a bounded control on the page surface, filling with ink under the hand. */
const SECONDARY = `${CONTROL} border-bound text-fg hover:bg-panel-2 active:translate-y-px`;

/** The pressed state of a secondary control, which is how the presented half names itself. */
const SECONDARY_ON = `${CONTROL} border-fg bg-fg text-panel`;

/**
 * The payload well: a recess in the panel, and the one element allowed to scroll sideways.
 *
 * A payload is the one artifact in this product that has to be exact enough to copy, so it is not
 * wrapped and not broken: a 64-character commitment with a line break in it is no longer the string
 * that would be posted. It scrolls instead, and because it scrolls it also takes a tabindex, since
 * a scroll container that only a pointer can reach is unreachable from a keyboard.
 */
const WELL = "recess overflow-x-auto bg-recess px-4 py-3.5";
/**
 * The same recess where the content breaks on its own and there is nothing to scroll.
 *
 * Both wells carry the bare `recess` class as well as the `bg-recess` utility, and it is not
 * decoration: `app/globals.css` ends with `.inv .recess { --fg-3: var(--paper-2) }`, which is how
 * the system's one remaining failing pair, --paper-3 on --line-inv at 4.20, is removed by
 * construction. The utility paints the surface; the class is what tells a label sitting on it that
 * there is no third text weight inside an inverted well. The audit control renders on a settled
 * raffle, which is inverted, so without the class its labels would be that 4.20.
 */
const WELL_STATIC = "recess bg-recess px-4 py-3.5";
const PRE = "mono text-sm leading-[1.7] whitespace-pre text-fg";
const NOTE = "max-w-[62ch] text-sm text-fg-2";
const LEDGER_TERM = "label text-fg-3";
const LEDGER_VALUE = "digest mt-1 text-sm leading-relaxed text-fg";

const NOT_WIRED_BUY =
  "Not submitted. No raffle program is deployed on Rialo testnet yet, so this is the exact payload that would be posted, next to the half of the pair that would never leave this browser. The nonce came from crypto.getRandomValues in this tab and the commitment above is a real SHA-256 of it, computed here.";

const NOT_WIRED_REVEAL =
  "Not submitted, and no spinner ran. No raffle program is deployed on Rialo testnet yet, so this is the exact payload that would be posted, and the check the program would run on it.";

/* --------------------------------------------------------------------------- buy */

export interface Offer {
  raffleId: number;
  /** The lowest unsold ticket, which is the one a purchase would take. */
  ticketIndex: number;
  ticketPriceKelvin: number;
  revealBondKelvin: number;
  /**
   * ISO. The sale and the commit window close here, and the control closes with them.
   *
   * There is deliberately no `buyer` on this interface. The address a commitment binds is read
   * from the connected wallet inside the component, so no call site can hand it a constant.
   */
  commitDeadline: string;
}

interface Taken {
  nonce: string;
  /** The address this payload binds, kept so a later wallet change cannot silently misdescribe it. */
  buyer: Address;
  payload: string;
}

export function TakeTicket({ face, offer }: { face: ReactNode; offer: Offer }) {
  const { wallet } = useSyncExternalStore(walletSubscribe, walletSnapshot, walletServerSnapshot);
  const elapsed = useSyncExternalStore(clockSubscribe, clockSnapshot, clockServerSnapshot);
  const [taken, setTaken] = useState<Taken | null>(null);

  const gateId = useId();
  const closed = hasClosed(offer.commitDeadline, elapsed);
  const canCompose = wallet !== null && !closed;

  /**
   * A payload composed for one address and then read under another is the defect this file exists
   * to avoid, in slow motion. Rather than clearing it from an effect, the address it bound is kept
   * beside it and compared during render, and the mismatch is said out loud.
   */
  const stale = taken !== null && taken.buyer !== wallet?.address;

  function take() {
    if (!wallet || closed) return;

    // Generated here and kept here. Only the hash of it appears in the payload below, which is the
    // whole of commit-reveal in one press: the drum gets the commitment, the hand gets the nonce.
    const nonce = newNonce();
    const commitment = commitmentFor(nonce, wallet.address, offer.raffleId, offer.ticketIndex);

    setTaken({
      nonce,
      buyer: wallet.address,
      payload: JSON.stringify(
        {
          instruction: "buy_ticket",
          raffle_id: offer.raffleId,
          ticket_index: offer.ticketIndex,
          buyer: wallet.address,
          commitment,
          ticket_price_kelvin: offer.ticketPriceKelvin,
          reveal_bond_kelvin: offer.revealBondKelvin,
        },
        null,
        2,
      ),
    });
  }

  const gate = closed
    ? `The sale closed at ${utcStamp(offer.commitDeadline)}. buy_ticket is rejected for any raffle that is no longer selling, so there is no payload to compose.`
    : wallet === null
      ? "No wallet connected. The commitment binds your address, so a purchase cannot be composed until there is one. The bar above connects a testnet key held in this browser."
      : wallet.canSign
        ? "Buying publishes a hash bound to your address, this raffle and this ticket index, and nothing else."
        : "This browser has no Ed25519, so this address can receive but not sign. The payload below is still exact; posting it would need a signing key.";

  return (
    <section aria-labelledby="take-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule pb-3">
        <h2 id="take-heading" className="label">
          Take a ticket
        </h2>
        <span className="label text-fg-3">Raffle {serialOf(offer.raffleId)}</span>
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]">
        {/* The field, rendered on the server. This island never re-renders it. */}
        <div className="min-w-0">{face}</div>

        {/* The stub: what one ticket costs, which one is next, and the one control. */}
        <div className="flex flex-col gap-3 border border-bound p-4">
          <span className="label text-fg-3">Stub</span>

          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="figure text-title text-fg">
              {formatRLO(offer.ticketPriceKelvin)}
            </span>
            <span className="label text-fg-3">RLO</span>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-fg-3">Reveal bond</dt>
            <dd className="figure text-right text-fg">
              {formatRLO(offer.revealBondKelvin)} RLO
            </dd>
            <dt className="text-fg-3">Next free</dt>
            <dd className="figure text-right text-fg">{pad2(offer.ticketIndex)}</dd>
          </dl>

          <button
            type="button"
            onClick={take}
            disabled={!canCompose}
            aria-describedby={gateId}
            className={`${PRIMARY} mt-1 w-full`}
          >
            Print the buy payload
          </button>

          <p id={gateId} className="text-sm text-fg-2">
            {gate}
          </p>
        </div>
      </div>

      {/* The announcement is a sentence, not the payload: a screen reader should not be read three
          hundred characters of JSON because a button was pressed. The block itself is not live. */}
      <p role="status" aria-live="polite" className="sr-only">
        {taken
          ? `Buy payload composed for ticket ${pad2(offer.ticketIndex)}. Nothing was submitted.`
          : ""}
      </p>

      {taken && (
        <div className="mt-7 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)]">
          <div className="min-w-0">
            <span className="label text-fg-3">What would go on chain</span>
            <div
              className={`${WELL} mt-2`}
              tabIndex={0}
              role="group"
              aria-label="Buy payload, scrolls sideways"
            >
              <pre className={PRE}>{taken.payload}</pre>
            </div>
            <p className={`${NOTE} mt-3`}>{NOT_WIRED_BUY}</p>
            {stale && (
              <p className={`${NOTE} mt-3`}>
                The connected wallet changed after this was composed. It binds{" "}
                {shortAddress(taken.buyer, 4, 4)}, which is not the address connected now, so
                compose it again before reading it as yours.
              </p>
            )}
          </div>

          {/* The keepsake half, the only part of the pair that never leaves the browser. */}
          <div className="border border-bound p-4">
            <span className="label text-fg-3">Your half</span>
            <div className="figure text-title mt-1 text-fg">{pad2(offer.ticketIndex)}</div>

            <span className="label mt-4 block text-fg-3">Nonce, keep it</span>
            <p className="digest mt-1 text-sm leading-relaxed text-fg">{taken.nonce}</p>

            <p className={`${NOTE} mt-3`}>
              The chain only ever sees the commitment beside this. Lose the nonce and the ticket can
              never be revealed, and the bond goes to the pool.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ reveal */

export interface PresentableStub {
  index: number;
  holder: Address;
  commitment: string;
  /**
   * The holder's secret. In production it exists only in their own browser; this book recorded one
   * for each of the example holder's tickets so the flow can be shown at all, and the panel says so.
   */
  nonce: string;
}

interface Presented {
  index: number;
  nonce: string;
  rebuilt: string;
  committed: string;
  matches: boolean;
  payload: string;
}

export function PresentHalf({
  raffleId,
  stubs,
  revealDeadline,
}: {
  raffleId: number;
  stubs: PresentableStub[];
  /** ISO. Reveals close here and the control closes with them. */
  revealDeadline: string;
}) {
  const elapsed = useSyncExternalStore(clockSubscribe, clockSnapshot, clockServerSnapshot);
  const [shown, setShown] = useState<Presented | null>(null);

  const closed = hasClosed(revealDeadline, elapsed);
  const holder = stubs[0]?.holder ?? null;

  function present(stub: PresentableStub) {
    if (closed) return;

    const rebuilt = commitmentFor(stub.nonce, stub.holder, raffleId, stub.index);

    setShown({
      index: stub.index,
      nonce: stub.nonce,
      rebuilt,
      committed: stub.commitment,
      matches: rebuilt === stub.commitment,
      payload: JSON.stringify(
        {
          instruction: "reveal",
          raffle_id: raffleId,
          ticket_index: stub.index,
          nonce: stub.nonce,
        },
        null,
        2,
      ),
    });
  }

  return (
    <section aria-labelledby="present-heading" className="mt-7 border-t border-rule pt-6">
      <h2 id="present-heading" className="label">
        Present a half
      </h2>

      <p className={`${NOTE} mt-3`}>
        Reveals close {utcStamp(revealDeadline)}. Presenting a half publishes the nonce so anyone can
        hash it and check it against the commitment already filed in the drum.
      </p>

      {holder !== null && (
        <p className={`${NOTE} mt-3`}>
          A worked example, not your wallet. These stubs belong to the example holder{" "}
          <span className="mono whitespace-nowrap text-fg">{shortAddress(holder, 4, 4)}</span>, an address recorded
          in this book rather than one anybody holds, and their nonces come from the book too,
          standing in for the browser storage a real holder would keep them in. The program reads the
          holder off the ticket record and checks the signature against it, so nothing below is
          composed from the address in the bar above.
        </p>
      )}

      {closed ? (
        <p className={`${NOTE} mt-4`}>
          Reveals closed at {utcStamp(revealDeadline)}. reveal is rejected for any raffle whose
          window has passed, so there is no payload to compose. Every bond still silent at that
          instant is forfeit into the pool.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {stubs.map((stub) => {
            const on = shown?.index === stub.index;
            return (
              <button
                key={stub.index}
                type="button"
                onClick={() => present(stub)}
                aria-pressed={on}
                className={on ? SECONDARY_ON : SECONDARY}
              >
                Present {pad2(stub.index)}
              </button>
            );
          })}
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {shown
          ? `Reveal payload composed for ticket ${pad2(shown.index)}. The nonce ${
              shown.matches ? "hashes to the recorded commitment" : "does not hash to the recorded commitment"
            }. Nothing was submitted.`
          : ""}
      </p>

      {shown && (
        <div className="mt-6 grid items-start gap-5 lg:grid-cols-2">
          <div className="min-w-0">
            <span className="label text-fg-3">Reveal {pad2(shown.index)}</span>
            <div
              className={`${WELL} mt-2`}
              tabIndex={0}
              role="group"
              aria-label="Reveal payload, scrolls sideways"
            >
              <pre className={PRE}>{shown.payload}</pre>
            </div>
            <p className={`${NOTE} mt-3`}>{NOT_WIRED_REVEAL}</p>
          </div>

          <div className="min-w-0 border border-bound">
            <div className="border-b border-rule px-4 py-3">
              <span className="label text-fg-3">The check</span>
            </div>

            <dl className="grid gap-4 px-4 py-4">
              {[
                { term: "Nonce presented", value: shown.nonce },
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
                The two are the same string, so the program would accept the reveal and this nonce
                would go into the seed.
              </p>
            ) : (
              /* A refusal is reversed print, never a colour: the signal hue means a result. */
              <p className="label bg-fg px-4 py-3 text-panel">
                Refused. This nonce is not the preimage of that commitment.
              </p>
            )}
          </div>
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
            ? "Recomputed. The winners derived in this tab are the winners on the record."
            : "Recomputed. The winners derived in this tab are not the winners on the record."
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
              <p className="text-sm text-fg-2">
                Same tickets, same order.
              </p>
            ) : (
              <p className="label bg-fg px-4 py-3 text-panel">
                The recomputed winners are not the winners on the record.
              </p>
            )}

            <p className={`${NOTE} mt-3`}>
              Computed in this tab just now, from the {audit.nonces.length} public nonces and the
              chain value alone, with the same SHA-256 the program uses. The book stores the winning
              tickets and the chain value; the seed is stored nowhere, so the line beside this is
              that derivation run again rather than a figure read back.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
