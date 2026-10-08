"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";

import {
  Cap,
  NETWORK,
  Note,
  PRIMARY,
  PhaseTag,
  RefusalBlock,
  SECONDARY,
  Signature,
  Waiting,
  ZERO,
  CHAIN_PHASE_WORD,
  cleanTitle,
  describeError,
  figureKelvin,
  formatKelvin,
  ladder,
  secondsLeft,
  stampMs,
  stampSecondsMs,
  storageKeeps,
  useNow,
  useWallet,
  type Refusal,
} from "@/components/chain-ui";
import { isAddress } from "@/lib/base58";
import { sheetVars } from "@/lib/cell";
import {
  ChainError,
  buyTicket,
  canReveal,
  claimAll,
  drawRaffle,
  fetchRaffle,
  fetchSchedule,
  raffleActivity,
  reclaimSchedule,
  revealTicket,
  scheduleState,
  type ScheduleRead,
  type ScheduleState,
} from "@/lib/chain/actions";
import { loadNonces } from "@/lib/chain/nonces";
import {
  PROGRAM_ID,
  auditDraw,
  payoutOf,
  phaseOf,
  type ChainPhase,
  type ChainRaffle,
  type ChainTicket,
} from "@/lib/chain/program";
import { DUE_WINDOW_MS, drawAt } from "@/lib/chain/subscriber";
import { shortAddress } from "@/lib/raffle";
import { connect, refreshBalance } from "@/lib/wallet-store";

/**
 * ONE RAFFLE, READ FROM THE CHAIN.
 *
 * The same page as a sample raffle at /raffle/[id], built from the same parts (the blade, the pool
 * at --text-pool, the serif title, the deadlines strip, the ticket sheet, the facts table, the
 * audit) with one difference that changes everything about it: nothing here is a record that was
 * true when the site was built. Every figure is decoded from the raffle account by lib/chain, the
 * account is polled every four seconds and again after every action, and the phase is computed from
 * that account against the real wall clock.
 *
 * NO FAKE SUCCESS. Every action below says it is done only after lib/chain reports the transaction
 * executed, and shows that transaction's signature. A refusal from the program is decoded into the
 * plain-English sentence for its error code and printed in reversed print, never in a colour: the
 * signal hue in this product means a winner, and the system has no error colour on purpose.
 *
 * THE AUTOMATIC DRAW IS SCHEDULED, NOT PROMISED. A raffle made since the schedule shipped asks
 * Rialo's Subscriber program, in its Create transaction, to send Draw five seconds after reveals close
 * (lib/chain/subscriber.ts). The page reads that subscription account back, decodes it, and calls it
 * scheduled only when it is exactly that Draw on this raffle and the node does not say it has let it
 * go (getSubscription); it shows what Rialo sent once it fired,
 * with the signature. The Draw button stays: it is hidden only in the half minute when Rialo's draw
 * is due, and comes back if it does not arrive, if it was refused, or if there is no schedule. A
 * person drawing first is fine: the later trigger is refused as already settled and changes nothing.
 * It fired on testnet on 2026-10-08 with nobody pressing anything, which is why the copy may say
 * Rialo sends it "by itself"; raffles made before the schedule have none, and the page says so.
 *
 * THE AUDIT IS A REAL CHECK. "Recompute in this tab" runs auditDraw from lib/chain/program over the
 * account's own bytes: the revealed nonces, the chain value the program read at the draw, and the
 * winners it flagged. It rebuilds the seed with SHA-256 and replays the winner selection, then
 * compares. It can say "does not match", and if the program and the library ever disagreed it would.
 *
 * WIDTH. The page is laid out from 360px up with no horizontal scroll: every long string (an
 * address, a signature, a seed) is set in the narrow `digest` instance and allowed to break, and
 * the blade tightens its gaps for large raffles because 200 columns of 2px gaps is wider than a
 * phone before a single cell is drawn.
 */

/** Two digits on a ticket number, as everywhere a cell is drawn. Three past 99, naturally. */
const pad2 = (n: number) => String(n).padStart(2, "0");

/** How often the account is read while the page is open. */
const POLL_MS = 4000;

/**
 * The instant an action started. A named function rather than an inline Date.now() because the
 * purity lint cannot see that `act` below only ever runs from a click handler, and reads every
 * call inside the component body as a call during render. It is not: render never calls this.
 */
function startedAt(): number {
  return Date.now();
}

/** The wall clock inside a read, named for the same reason as `startedAt`: no render calls it. */
function wallClock(): number {
  return Date.now();
}

/**
 * A failure that brings its own heading. A reveal run that revealed some tickets and not others
 * uses it (each ticket is revealed on its own, so one that cannot be revealed never blocks the
 * rest), and so does a Draw that found the raffle already settled, which is not a fault to shout.
 */
class TitledError extends Error {
  title: string;

  constructor(title: string, message: string) {
    super(message);
    this.name = "TitledError";
    this.title = title;
  }
}

/* ------------------------------------------------------------------- derived */

/** The `data-s` value app/cell.css switches on: 0 unsold, 1 sold, 2 revealed, 3 won, 4 refunded. */
function cellOf(r: ChainRaffle, t: ChainTicket): 0 | 1 | 2 | 3 | 4 {
  if (t.holder === null) return 0;
  if (r.status === "void") return 4;
  if (t.won) return 3;
  return t.revealed ? 2 : 1;
}

/** What one ticket is doing now, in words, in the tense its raffle is in. */
function ticketWord(r: ChainRaffle, t: ChainTicket, phase: ChainPhase): string {
  if (t.holder === null) return "Unsold";
  if (r.status === "void") return t.paid ? "Refunded" : "Refund not claimed yet";
  if (t.won) return `Won, draw ${t.winRank}${t.paid ? ", paid" : ", not claimed yet"}`;
  if (t.revealed) return "Revealed";
  if (phase === "selling") return "Committed";
  if (phase === "revealing") return "Not revealed yet";
  return "Never revealed, bond forfeit";
}

/** The pool figure the head prints, and the caption that says what it is made of. */
function poolOf(r: ChainRaffle, phase: ChainPhase): { cap: string; kelvin: bigint; sub: string } {
  const sold = BigInt(r.sold);
  const winnersWord = (n: number) => (n === 1 ? "one winner" : `${n} winners`);
  const winners = winnersWord(r.winners);
  switch (phase) {
    case "selling":
    case "revealing":
      return { cap: "Pool", kelvin: r.prize + sold * r.ticketPrice, sub: `still growing · ${winners}` };
    case "ready":
      return {
        cap: "Pool",
        kelvin: r.prize + sold * r.ticketPrice + BigInt(r.sold - r.revealed) * r.revealBond,
        // Only revealed tickets can win, so fewer reveals than winners means fewer winners.
        sub:
          r.revealed > 0
            ? `at the draw · ${winnersWord(Math.min(r.winners, r.revealed))}`
            : "nothing revealed · void at the draw",
      };
    case "drawn":
      return {
        cap: "Pool",
        kelvin: r.pool,
        sub:
          r.effectiveWinners > 1
            ? `${formatKelvin(r.perWinner)} RLO to each of ${r.effectiveWinners} winners`
            : "to one winner",
      };
    case "void":
      return {
        cap: "Returned",
        kelvin: r.prize + sold * (r.ticketPrice + r.revealBond),
        sub: `deposit + ${r.sold} tickets + ${r.sold} bonds`,
      };
  }
}

/** What a winning ticket was paid, or is owed: the share, plus the remainder on the first drawn. */
function winningsOf(r: ChainRaffle, t: ChainTicket): bigint {
  if (!t.won) return ZERO;
  const remainder = r.pool - r.perWinner * BigInt(r.effectiveWinners);
  return r.perWinner + (t.winRank === 1 ? remainder : ZERO);
}

/**
 * The lead paragraph: what is happening here, in the tense the raffle is actually in. `rialoSends`
 * is true while reveals are closed and Rialo's scheduled Draw is on its way, when the page offers no
 * button and so must not say "anyone can press Draw".
 */
function leadOf(r: ChainRaffle, phase: ChainPhase, rialoSends = false): string {
  const open = r.supply - r.sold;
  switch (phase) {
    case "selling":
      return `${r.sold} of ${r.supply} tickets are gone and ${open} ${open === 1 ? "is" : "are"} still open. A ticket costs ${formatKelvin(r.ticketPrice)} RLO plus a ${formatKelvin(r.revealBond)} RLO reveal bond. Buying one publishes a hash bound to your address, this raffle and the ticket's number; the secret behind that hash stays in your browser until you reveal it, which is what stops anyone, the creator included, from knowing the seed early.`;
    case "revealing":
      return `The sale has closed with ${r.sold} of ${r.supply} sold, and ${r.revealed} of ${r.sold} holders have revealed. A holder who is still silent at the deadline forfeits a ${formatKelvin(r.revealBond)} RLO bond into the pool, and their secret never enters the seed.`;
    case "ready":
      if (rialoSends && r.sold === 0) {
        return "The sale closed with no tickets sold. Rialo's Subscriber program is set to send Draw now, which settles the raffle as void; the creator can then claim the prize back.";
      }
      if (rialoSends && r.revealed === 0) {
        return "Reveals have closed with nothing revealed, so there is no secret to draw from. Rialo's Subscriber program is set to send Draw now, which settles the raffle as void; every ticket, every bond and the prize can then be claimed back.";
      }
      if (r.sold === 0) {
        return "The sale closed with no tickets sold. Pressing Draw settles the raffle as void, and the creator can then claim the prize back.";
      }
      if (r.revealed === 0) {
        return "Reveals have closed and nobody revealed, so there is no secret to draw from. Pressing Draw settles the raffle as void, and every ticket, every bond and the prize can then be claimed back.";
      }
      if (rialoSends) {
        return `Reveals have closed and ${r.revealed} secrets are public. Rialo's Subscriber program is set to send Draw now, with nobody pressing anything: the program reads the chain's random value, hashes it with those secrets, and records the winners.`;
      }
      return `${r.revealed === r.sold ? "Every sold ticket has been revealed, so the draw does not have to wait for the deadline." : "Reveals have closed."} ${r.revealed} secrets are public. Anyone can press Draw: the program reads the chain's random value, hashes it with those secrets, and records the winners.`;
    case "drawn":
      return `Settled. ${r.revealed} of ${r.sold} tickets were revealed, so ${r.sold - r.revealed} ${r.sold - r.revealed === 1 ? "bond went" : "bonds went"} into the pool. The seed is every revealed secret, sorted and hashed with the chain value read at the draw, and the winners below are what that seed produces. This tab can run the computation again from the account's own data.`;
    case "void":
      return "Void. Nobody revealed before the deadline, so there was no secret to draw from and nothing honest to pick a winner with. Every ticket and bond goes back to its holder and the prize to the creator, each through Claim.";
  }
}

/* ------------------------------------------------------------ the schedule */

/**
 * The "Automatic draw" fact, in a few words. The facts column is narrow, so the sentence that
 * explains each state lives in the action panel; this is the state itself. A raffle someone settled
 * by hand before Rialo's draw was due is said calmly: the later Draw is turned away and changes
 * nothing, which is the design working, not a fault.
 */
/**
 * How far before the scheduled second a settlement still counts as "at the due time". The program's
 * clock trails the block time by about 40-100 ms (six firings, local and testnet, 2026-10-08); two
 * seconds is generous, and a hand-pressed Draw that close to the deadline is indistinguishable anyway.
 */
const DUE_CLOCK_MARGIN_MS = 2_000;

function scheduleWord(s: ScheduleState | null, r: ChainRaffle, settled: boolean): string {
  if (s === null) return "reading";
  if (settled && (s.kind === "scheduled" || s.kind === "due" || s.kind === "late" || s.kind === "dropped")) {
    // "Before it was due" only when the chain says so, and with room for the clock: Rialo's own Draw
    // reads a clock 40-100 ms behind the block that fired it, so its drawn_at lands just before the
    // scheduled second, and for a moment after it lands the node has not listed the firing yet.
    // Measured on the live site 2026-10-08: that window showed "settled before it was due" for half
    // a second on a raffle Rialo drew itself. Within the margin it is said as what it most likely is.
    if (r.drawnAt >= s.at - DUE_CLOCK_MARGIN_MS) {
      return s.kind === "late" ? "Settled; no Draw from Rialo seen" : "Settled at its due time; confirming it was Rialo";
    }
    return "Not needed, settled before it was due";
  }
  if (s.kind === "sent" && !s.firing.ok && s.firing.code === 14) {
    return "Sent by Rialo after the raffle was settled; changed nothing";
  }
  switch (s.kind) {
    case "none":
      return "Not scheduled";
    case "withdrawn":
      return "Withdrawn by the creator";
    case "unrecognised":
      return "Not a plain Draw, not counted";
    case "scheduled":
      return `${stampSecondsMs(s.at)}, via Rialo's Subscriber`;
    case "due":
      return `Due ${stampSecondsMs(s.at)}, via Rialo's Subscriber`;
    case "late":
      return `Was due ${stampSecondsMs(s.at)}, not arrived`;
    case "dropped":
      return "Rialo reports it no longer holds it";
    case "sent":
      return s.firing.ok
        ? `Sent by Rialo${s.firing.at !== null ? `, ${stampSecondsMs(s.firing.at)}` : ""}`
        : `Sent by Rialo, refused${s.firing.code !== null ? ` (error ${s.firing.code})` : ""}`;
  }
}

/** True while Rialo's Draw is on its way and the page should wait for it rather than offer a button. */
function rialoSending(s: ScheduleState | null, r: ChainRaffle, now: number): boolean {
  return s !== null && (s.kind === "scheduled" || s.kind === "due") && now >= r.revealDeadline;
}

/* --------------------------------------------------------------- small pieces */

/** A section heading in caption voice, as on a sample raffle. */
function Head2({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <h2 id={id} className={`label text-fg-3 ${className}`}>
      {children}
    </h2>
  );
}

/** The well: cut into the page. `recess` beside `bg-recess` is the hook that keeps --fg-3 legible inside `.inv`. */
function Well({ children }: { children: ReactNode }) {
  return <div className="recess overflow-x-auto bg-recess px-4 py-3.5">{children}</div>;
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <pre className="mono text-sm leading-[1.7] break-normal whitespace-pre-wrap [overflow-wrap:anywhere]">
      {children}
    </pre>
  );
}

/** One row of the facts table: the term in label voice, the quantity hard right. */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <tr>
      <th className="w-[40%] border-b border-rule py-2.5 pr-3 text-left align-top font-normal text-fg-3">
        {term}
      </th>
      <td className="figure border-b border-rule py-2.5 text-right align-top break-normal [overflow-wrap:anywhere]">
        {children}
      </td>
    </tr>
  );
}

/** A long hex or base58 value inside a fact row: narrow, and allowed to break anywhere. */
function Long({ children }: { children: string }) {
  return <span className="digest text-sm select-all">{children}</span>;
}

/**
 * THE BLADE: every ticket at viewport scale, the same `.blade` the sample raffles open with.
 *
 * Not wrapped in a view transition name. Two files in this app may spell one and this is not one of
 * them: a live raffle's row on the board is a different object from its strip here, and an
 * unpaired name is a morph with nothing to morph from. The gap tightens past 60 tickets, because at
 * the stylesheet's 2px a 200-ticket blade spends 398px on gaps alone, wider than a phone.
 */
function ChainBlade({ raffle, label }: { raffle: ChainRaffle; label: string }) {
  const dense = raffle.supply > 60;
  return (
    <div
      className="blade"
      role="img"
      aria-label={label}
      style={
        {
          "--n": String(raffle.supply),
          ...(dense ? { gap: "1px", padding: "1px" } : {}),
        } as CSSProperties
      }
    >
      {raffle.tickets.map((t) => (
        <i key={t.index} className="c" data-s={cellOf(raffle, t)} data-i={t.index} />
      ))}
    </div>
  );
}

/**
 * The sheet's column counts and its widest extent.
 *
 * sheetColumns in lib/cell.ts was tuned on the sample supplies (12 to 40) and asks for at least two
 * rows, so a two-ticket raffle, which a live demonstration is, falls through to ONE column and each
 * cell becomes a square the width of the page. A real raffle can be any size from 2, so up to a
 * dozen tickets get one column each, and the bed is capped at about the 88px cell the design
 * specifies: a two-ticket sheet is two tickets, not two posters.
 */
function chainSheetStyle(supply: number): CSSProperties {
  const vars = sheetVars(supply);
  const wide = supply <= 12 ? supply : Number(vars["--cols"]);
  const narrow = supply <= 6 ? supply : Number(vars["--cols-n"]);
  return {
    ...vars,
    "--cols": String(wide),
    "--cols-n": String(narrow),
    maxWidth: `${wide * 92}px`,
  } as CSSProperties;
}

/** The ticket sheet: one square cell per ticket with its number, ringed where the wallet holds it. */
function ChainSheet({
  raffle,
  phase,
  mine,
  label,
}: {
  raffle: ChainRaffle;
  phase: ChainPhase;
  mine: string | null;
  label: string;
}) {
  return (
    <div
      className="sheet"
      role="img"
      aria-label={label}
      data-phase={phase}
      style={chainSheetStyle(raffle.supply)}
    >
      {raffle.tickets.map((t) => (
        <div
          key={t.index}
          className="c"
          data-s={cellOf(raffle, t)}
          data-i={t.index}
          data-mine={mine !== null && t.holder === mine ? "1" : undefined}
          title={`Ticket ${pad2(t.index)}: ${ticketWord(raffle, t, phase)}${t.holder ? `, held by ${t.holder}` : ""}`}
        >
          <em>{pad2(t.index)}</em>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- the actions */

type ActionKind = "buy" | "reveal" | "draw" | "claim" | "reclaim";

/**
 * Where the one action in flight is. One at a time, on purpose: every action here spends from the
 * same wallet against the same account, and two in flight would race each other for the next
 * ticket number or the same claim.
 */
type Run =
  | { kind: "idle" }
  | { kind: "busy"; action: ActionKind; since: number; what: string }
  | { kind: "done"; action: ActionKind; text: string; sigs: { label: string; signature: string }[] }
  | {
      kind: "failed";
      action: ActionKind;
      refusal: Refusal;
      title?: string;
      sigs: { label: string; signature: string }[];
    };

/** The receipts of an action, each signature whole. */
function Receipts({ sigs }: { sigs: { label: string; signature: string }[] }) {
  if (sigs.length === 0) return null;
  return (
    <dl className="mt-3 grid gap-3">
      {sigs.map((s) => (
        <Signature key={s.signature} label={s.label} value={s.signature} />
      ))}
    </dl>
  );
}

function RunResult({ run }: { run: Run }) {
  if (run.kind === "busy") {
    return (
      <div className="mt-4">
        <Waiting since={run.since}>{run.what}</Waiting>
      </div>
    );
  }
  if (run.kind === "done") {
    return (
      <div className="mt-4 border border-bound px-4 py-3.5">
        <p className="label text-fg">Done, and executed on chain</p>
        <p className="mt-2 text-sm text-fg-2">{run.text}</p>
        <Receipts sigs={run.sigs} />
      </div>
    );
  }
  if (run.kind === "failed") {
    return (
      <div className="mt-4">
        <RefusalBlock refusal={run.refusal} title={run.title} />
        {run.sigs.length > 0 && (
          <div className="mt-3">
            <Note>Receipts from this attempt, each labelled with what it did:</Note>
            <Receipts sigs={run.sigs} />
          </div>
        )}
      </div>
    );
  }
  return null;
}

/* ------------------------------------------------------------------------ view */

type Load =
  | { kind: "invalid" }
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

export function ChainRaffleView({ address }: { address: string }) {
  const valid = isAddress(address);
  const now = useNow();
  const { wallet, status: walletStatus } = useWallet();

  const [raffle, setRaffle] = useState<ChainRaffle | null>(null);
  const [load, setLoad] = useState<Load>(valid ? { kind: "loading" } : { kind: "invalid" });
  const [stale, setStale] = useState<string | null>(null);
  const [activity, setActivity] = useState<{ signature: string; at: number | null }[] | null>(null);
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const [audit, setAudit] = useState<ReturnType<typeof auditDraw> | "pending" | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRead | null>(null);
  const reading = useRef(false);
  /*
    Set for the whole life of an action, synchronously, so a second press that arrives before React
    has re-rendered the button as disabled is dropped rather than sent: a double press on Buy is a
    second ticket paid for.
  */
  const inFlight = useRef(false);

  /* Read once per wallet: whether its key and a ticket's secret would survive a reload. */
  const walletAddress = wallet?.address ?? null;
  const keeps = useMemo(() => (walletAddress === null ? true : storageKeeps(walletAddress)), [walletAddress]);

  /*
    One read of the account, and of its transaction list when asked. The first statement is an
    await, so no state is set synchronously inside the effect that calls this. A read that fails
    after one has succeeded keeps the last good account on screen and says it is stale, rather than
    blanking a page someone is in the middle of using.
  */
  const refresh = useCallback(
    async (withActivity: boolean) => {
      if (reading.current) return;
      reading.current = true;
      let r: ChainRaffle | null = null;
      try {
        r = await fetchRaffle(address);
        setRaffle(r);
        setLoad(r ? { kind: "ready" } : { kind: "missing" });
        setStale(null);
      } catch (error) {
        const message = describeError(error).text;
        setStale(message);
        setLoad((prev) => (prev.kind === "loading" ? { kind: "error", message } : prev));
      } finally {
        reading.current = false;
      }
      /*
        The schedule with the transaction list, and on every read from the reveal deadline until
        Rialo's draw is past due, because that is the half minute in which it lands and the page is
        waiting on it instead of offering a button.
      */
      const clock = wallClock();
      const hot = r !== null && clock >= r.revealDeadline - POLL_MS && clock < drawAt(r.revealDeadline) + DUE_WINDOW_MS + POLL_MS;
      if (r !== null && (withActivity || hot)) {
        try {
          setSchedule(await fetchSchedule(r));
        } catch {
          // Secondary, like the transaction list: keep what was last read.
        }
      }
      if (withActivity) {
        try {
          setActivity(await raffleActivity(address));
        } catch {
          // The transaction list is secondary; keep whatever was last read.
        }
      }
    },
    [address],
  );

  useEffect(() => {
    if (!valid) return;
    let tick = 0;
    const poll = () => {
      // The transaction list every third read: it changes only when the account does, and the
      // account read already shows that change.
      void refresh(tick % 3 === 0);
      tick += 1;
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [valid, refresh]);

  /** Run one action: busy, then done with its signatures, or failed with the decoded refusal. */
  async function act(
    action: ActionKind,
    what: string,
    work: (record: (label: string, signature: string) => void) => Promise<string>,
  ) {
    if (inFlight.current || run.kind === "busy") return;
    inFlight.current = true;
    const sigs: { label: string; signature: string }[] = [];
    const record = (label: string, signature: string) => {
      sigs.push({ label, signature });
    };
    setRun({ kind: "busy", action, since: startedAt(), what });
    try {
      const text = await work(record);
      setRun({ kind: "done", action, text, sigs: [...sigs] });
    } catch (error) {
      setRun(
        error instanceof TitledError
          ? {
              kind: "failed",
              action,
              refusal: { text: error.message, code: null, logs: [] },
              title: error.title,
              sigs: [...sigs],
            }
          : { kind: "failed", action, refusal: describeError(error), sigs: [...sigs] },
      );
    } finally {
      inFlight.current = false;
    }
    setAudit(null);
    void refresh(true);
    void refreshBalance();
  }

  /* ------------------------------------------------------------ the unhappy states */

  if (load.kind !== "ready" || raffle === null || now === 0) {
    return (
      <main className="pt-mast pb-[clamp(48px,8vw,104px)]">
        <div className="px-gutter pt-[clamp(24px,4vw,52px)]">
          <BackToBoard />
          <h1 className="font-serif mt-[clamp(16px,2.4vw,28px)] text-display">
            {load.kind === "invalid"
              ? "Not an address"
              : load.kind === "missing"
                ? "No raffle here"
                : load.kind === "error"
                  ? "Could not read the chain"
                  : "Reading the raffle"}
          </h1>
          <p className="mt-4 max-w-[58ch] text-lg text-fg-2">
            {load.kind === "invalid"
              ? "That is not a Rialo address. A raffle address is 32 bytes written in base58, like the one the deploy page prints after a raffle is created."
              : load.kind === "missing"
                ? `Nothing on ${NETWORK} at this address is a Drawbook raffle. Either no account exists here, or it is not owned by the raffle program, or it does not carry a raffle header.`
                : load.kind === "error"
                  ? `The ${NETWORK} node did not answer: ${load.message}. This page keeps trying every few seconds.`
                  : `Reading the account from ${NETWORK}.`}
          </p>
          {load.kind !== "loading" && (
            <p className="digest mt-4 max-w-[58ch] text-sm text-fg-3">{address}</p>
          )}
        </div>
      </main>
    );
  }

  /* ------------------------------------------------------------------ the raffle */

  const r = raffle;
  const phase = phaseOf(r, now);
  const settled = phase === "drawn" || phase === "void";
  const me = wallet?.address ?? null;
  const canSign = wallet !== null && wallet.canSign && wallet.privateKey !== undefined;
  const busy = run.kind === "busy";

  /* The automatic draw, as read from Rialo; null until the first read answers. */
  const sched = schedule === null ? null : scheduleState(r, schedule, now);
  const waitingOnRialo = phase === "ready" && rialoSending(sched, r, now);
  const reclaimable =
    settled && me !== null && me === r.creator && sched !== null && sched.kind !== "none" && sched.kind !== "withdrawn"
      ? sched.deposit
      : null;

  const pool = poolOf(r, phase);
  const figure = figureKelvin(pool.kelvin, 6);
  const mine = me === null ? [] : r.tickets.filter((t) => t.holder === me);
  const winners = r.tickets.filter((t) => t.won).sort((a, b) => a.winRank - b.winRank);

  const fieldLabel = `${r.sold} of ${r.supply} tickets sold${
    r.status === "void" ? ", all refundable" : r.revealed > 0 ? `, ${r.revealed} revealed` : ""
  }${winners.length > 0 ? `, ${winners.length} drawn` : ""}`;

  /* What Claim would pay now, to this wallet and to everyone. Index 0 is the creator's refund. */
  const owed = (index: number) => (r.status === "open" ? ZERO : payoutOf(r, index));
  const mineOwed =
    me === null
      ? ZERO
      : mine.reduce((sum, t) => sum + owed(t.index), ZERO) +
        (r.status === "void" && r.creator === me ? owed(0) : ZERO);
  const allOwed =
    r.tickets.reduce((sum, t) => sum + owed(t.index), ZERO) + (r.status === "void" ? owed(0) : ZERO);

  /*
    The tickets this wallet could reveal, split by whether this browser holds the secret that opens
    each one's commitment as recorded on chain. A ticket number can have several saved secrets (two
    tabs, or a retried purchase), and only a match counts; a ticket whose saved secrets all fail to
    match says so in words and is never offered, so it cannot block the others.
  */
  const unrevealed = mine.filter((t) => !t.revealed);
  const withNonce = me === null ? [] : unrevealed.filter((t) => canReveal(r.address, t.index, me, t.commitment));
  const withoutNonce = unrevealed.filter((t) => !withNonce.includes(t));
  const mismatched = (t: ChainTicket) => me !== null && loadNonces(r.address, t.index, me).length > 0;

  const live = phase === "selling" || phase === "revealing";
  const deadline = phase === "selling" ? r.commitDeadline : r.revealDeadline;

  /* ------------------------------------------------------------ the action panel */

  function walletGate(verb: string): ReactNode {
    if (wallet === null) {
      return (
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void connect()}
            disabled={walletStatus === "loading"}
            className={`${PRIMARY} w-full sm:w-auto`}
          >
            {walletStatus === "loading" ? "Connecting" : "Connect a wallet"}
          </button>
          <Note>
            To {verb} you need a wallet that can sign. Connecting makes a key in this browser; the bar
            at the top shows its balance{NETWORK === "testnet" ? " and can ask the testnet faucet for funds" : ""}.
          </Note>
        </div>
      );
    }
    if (!canSign) {
      return (
        <Note className="mt-4">
          This wallet cannot sign in this browser, so it can receive but not {verb}.
        </Note>
      );
    }
    return null;
  }

  let panel: ReactNode;
  if (phase === "selling") {
    const total = r.ticketPrice + r.revealBond;
    const next = r.sold + 1;
    panel = (
      <>
        <Head2 id="act-heading">Buy a ticket</Head2>
        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <div className="min-w-0">
            <Cap>Next open ticket</Cap>
            <div className="monument mt-1.5 text-fg" style={{ fontSize: "var(--text-title)" }}>
              {pad2(next)}
            </div>
            <Note className="mt-2.5">
              {formatKelvin(r.ticketPrice)} RLO for the ticket and {formatKelvin(r.revealBond)} RLO
              as a reveal bond, {formatKelvin(total)} RLO in all. The bond comes back when you reveal
              before {stampMs(r.revealDeadline)}. The secret behind your ticket is made and saved in
              this browser before anything is sent, so reveal from this same browser.
            </Note>
            {mine.length > 0 && (
              <Note className="mt-2.5">
                This wallet already holds {mine.length === 1 ? "ticket" : "tickets"}{" "}
                <span className="figure text-fg">{mine.map((t) => pad2(t.index)).join(", ")}</span>.
              </Note>
            )}
          </div>
          <div className="min-w-0">
            {walletGate("buy a ticket") ??
              (!keeps ? (
                <Note>
                  This browser is not keeping what it stores for this site: site data is blocked, or
                  this is a private window. The wallet&rsquo;s key and a ticket&rsquo;s secret would be
                  gone at the next reload, and a ticket whose secret is gone cannot be revealed, so its
                  bond is lost. Buying is off until this site may store data; allow it and reload.
                </Note>
              ) : (
              <button
                type="button"
                disabled={busy}
                aria-busy={busy && run.action === "buy"}
                onClick={() =>
                  void act(
                    "buy",
                    "Signing in this browser and waiting for the chain to execute the purchase.",
                    async (record) => {
                      const sent = await buyTicket(wallet as NonNullable<typeof wallet>, r.address);
                      record(`Ticket ${pad2(sent.ticketIndex)} bought`, sent.signature);
                      return `Ticket ${pad2(sent.ticketIndex)} is yours. Its secret is saved in this browser, which is the only place it exists until you reveal it.`;
                    },
                  )
                }
                className={`${PRIMARY} w-full py-3.5`}
              >
                {busy && run.action === "buy" ? "Buying" : `Buy for ${formatKelvin(total)} RLO`}
              </button>
              ))}
          </div>
        </div>
      </>
    );
  } else if (phase === "revealing") {
    panel = (
      <>
        <Head2 id="act-heading">Reveal my tickets</Head2>
        <Note className="mt-3">
          Revealing publishes each ticket&rsquo;s secret so anyone can check it against the hash
          filed at purchase, puts it into the seed, and hands back its bond. Reveals close{" "}
          {stampMs(r.revealDeadline)}.
        </Note>
        {walletGate("reveal") ??
          (unrevealed.length === 0 ? (
            <Note className="mt-3">
              {mine.length > 0
                ? "Every ticket this wallet holds here is revealed. Nothing more to do until the draw."
                : "This wallet holds no tickets in this raffle."}
            </Note>
          ) : (
            <div className="mt-4">
              <ul className="grid gap-1.5">
                {unrevealed.map((t) => (
                  <li key={t.index} className="text-sm text-fg-2">
                    <span className="figure text-fg">Ticket {pad2(t.index)}</span>{" "}
                    {withNonce.includes(t)
                      ? "Its secret is in this browser."
                      : mismatched(t)
                        ? "This browser holds a secret for this ticket number, but not the one its commitment was made with, so it cannot be revealed from here. If another browser bought it, reveal from there; otherwise its bond goes to the pool."
                        : "Its secret is not in this browser. It was saved by the browser that bought it; reveal from there, or this ticket cannot be revealed and its bond goes to the pool."}
                  </li>
                ))}
              </ul>
              {withNonce.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  aria-busy={busy && run.action === "reveal"}
                  onClick={() =>
                    void act(
                      "reveal",
                      `Revealing ${withNonce.length === 1 ? "one ticket" : `${withNonce.length} tickets`}, one transaction each, and waiting for each to execute.`,
                      async (record) => {
                        // Each ticket on its own: one that fails is reported and the rest go on.
                        const failures: string[] = [];
                        for (const t of withNonce) {
                          try {
                            const sent = await revealTicket(wallet as NonNullable<typeof wallet>, r.address, t.index);
                            record(`Ticket ${pad2(t.index)} revealed`, sent.signature);
                          } catch (error) {
                            const d = describeError(error);
                            const code = d.code !== null ? ` (program error ${d.code})` : "";
                            failures.push(`Ticket ${pad2(t.index)}: ${d.text}${code}`);
                            if (d.signature && (d.outcome === "failed" || d.outcome === "unknown")) {
                              record(
                                `Ticket ${pad2(t.index)} ${d.outcome === "unknown" ? "not confirmed, check it" : "failed on chain"}`,
                                d.signature,
                              );
                            }
                          }
                        }
                        const done = withNonce.length - failures.length;
                        if (failures.length > 0) {
                          throw new TitledError(
                            done === 0 ? "Not revealed" : `${done} of ${withNonce.length} revealed`,
                            failures.join(" "),
                          );
                        }
                        return `${done === 1 ? "The secret is" : "The secrets are"} public now, ${done === 1 ? "its bond is" : "their bonds are"} back in your wallet, and ${done === 1 ? "it goes" : "they go"} into the seed.`;
                      },
                    )
                  }
                  className={`${PRIMARY} mt-4 w-full sm:w-auto`}
                >
                  {busy && run.action === "reveal"
                    ? "Revealing"
                    : withNonce.length === 1
                      ? `Reveal ticket ${pad2(withNonce[0].index)}`
                      : `Reveal ${withNonce.length} tickets`}
                </button>
              )}
              {withoutNonce.length > 0 && withNonce.length === 0 && (
                <Note className="mt-3">There is nothing this browser can reveal.</Note>
              )}
              {withNonce.length > 0 && secondsLeft(r.revealDeadline, now) <= 30 && (
                <Note className="mt-3">
                  Under 30 seconds left by this device&rsquo;s clock. The chain&rsquo;s own clock
                  decides, and a reveal that reaches it after the deadline is refused and the bond
                  goes to the pool.
                </Note>
              )}
            </div>
          ))}
      </>
    );
  } else if (phase === "ready" && sched !== null && sched.kind === "sent" && sched.firing.ok) {
    // The schedule was read after the account: Rialo's Draw has landed and the next read shows it.
    panel = (
      <>
        <Head2 id="act-heading">Draw</Head2>
        <Note className="mt-3">
          Rialo sent Draw{sched.firing.at !== null ? ` at ${stampSecondsMs(sched.firing.at)}` : ""} and it
          ran. Reading the settled raffle.
        </Note>
      </>
    );
  } else if (phase === "ready" && waitingOnRialo && sched !== null && "at" in sched && sched.at !== null) {
    /*
      Rialo's Draw is on its way: no button for half a minute, so a press does not race it. The
      button comes back by itself if the draw has not landed by then (the schedule reads "late").
    */
    panel = (
      <>
        <Head2 id="act-heading">Draw</Head2>
        <Note className="mt-3">
          Rialo&rsquo;s Subscriber program is set to send Draw at{" "}
          <span className="figure text-fg">{stampSecondsMs(sched.at)}</span>, five seconds after reveals
          close, in the creator&rsquo;s name and with nobody pressing anything.{" "}
          {sched.kind === "due" ? "It is due now; this page checks every few seconds." : ""}
        </Note>
        <Note className="mt-2.5">
          If it has not landed by {stampSecondsMs(sched.at + DUE_WINDOW_MS)}, a Draw button appears here and
          anyone can send it.
        </Note>
      </>
    );
  } else if (phase === "ready") {
    panel = (
      <>
        <Head2 id="act-heading">Draw</Head2>
        <Note className="mt-3">
          {r.revealed === 0
            ? "Anyone can press this. With nothing revealed the program settles the raffle as void, and everything becomes claimable back."
            : "Anyone can press this, not only the creator. The program reads the chain's random value, hashes it with every revealed secret, picks the winners and records them. The caller pays only the network fee."}
        </Note>
        {walletGate("run the draw") ?? (
          <button
            type="button"
            disabled={busy}
            aria-busy={busy && run.action === "draw"}
            onClick={() =>
              void act(
                "draw",
                "Signing in this browser and waiting for the chain to execute the draw.",
                async (record) => {
                  try {
                    const sent = await drawRaffle(wallet as NonNullable<typeof wallet>, r.address);
                    record("Draw", sent.signature);
                  } catch (error) {
                    // Already settled: Rialo's scheduled draw or another caller got there first. The
                    // raffle is settled either way, so this is said plainly rather than as a fault.
                    if (error instanceof ChainError && error.code === 14) {
                      if (error.signature) record("Draw, turned away", error.signature);
                      throw new TitledError(
                        "Already settled",
                        "Someone settled this raffle a moment earlier, Rialo's scheduled draw or another caller, so this Draw changed nothing. The result is on this page.",
                      );
                    }
                    throw error;
                  }
                  return r.revealed === 0
                    ? "The raffle is settled as void. Holders and the creator can claim their money back."
                    : "The draw ran on chain. The winners and the seed are below, and this tab can recompute them.";
                },
              )
            }
            className={`${PRIMARY} mt-4 w-full sm:w-auto`}
          >
            {busy && run.action === "draw" ? "Drawing" : "Draw now"}
          </button>
        )}
        {sched !== null && sched.kind === "scheduled" && (
          <Note className="mt-3">
            If nobody draws before then, Rialo&rsquo;s Subscriber program is set to send Draw at{" "}
            {stampSecondsMs(sched.at)}.
          </Note>
        )}
        {sched !== null && sched.kind === "late" && (
          <Note className="mt-3">
            Rialo&rsquo;s scheduled draw was due at {stampSecondsMs(sched.at)} and has not arrived, so
            the draw is a button again. If Rialo&rsquo;s arrives after someone presses it, the program
            turns it away and it changes nothing.
          </Note>
        )}
        {sched !== null && sched.kind === "dropped" && (
          <Note className="mt-3">
            This raffle&rsquo;s schedule account is still there, but Rialo&rsquo;s node reports that it no
            longer holds the Draw, so this page does not wait for it: anyone can press Draw.
          </Note>
        )}
        {sched !== null && sched.kind === "none" && (
          <Note className="mt-3">
            This raffle has no automatic draw: it was deployed before Drawbook began scheduling the
            draw with Rialo, or Rialo refused its schedule. It waits for someone to press Draw.
          </Note>
        )}
        {sched !== null && sched.kind === "sent" && !sched.firing.ok && (
          <Note className="mt-3">
            Rialo sent Draw{sched.firing.at !== null ? ` at ${stampSecondsMs(sched.firing.at)}` : ""}, and
            the program refused it: {sched.firing.reason} It does not retry, so the draw is a button
            again.
          </Note>
        )}
      </>
    );
  } else {
    panel = (
      <>
        <Head2 id="act-heading">Claim</Head2>
        <Note className="mt-3">
          {phase === "void"
            ? "Every ticket and bond is refundable to its holder, and the prize to the creator. Claim pays everything this wallet is owed here, in one transaction."
            : "Each winner claims their share; it can only be paid to the address on the winning ticket. Claim pays everything this wallet is owed here, in one transaction."}
        </Note>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-fg-3">Owed to this wallet</dt>
          <dd className="figure text-right text-fg">
            {me === null ? "no wallet" : `${formatKelvin(mineOwed)} RLO`}
          </dd>
          <dt className="text-fg-3">Unclaimed, everyone</dt>
          <dd className="figure text-right text-fg">{formatKelvin(allOwed)} RLO</dd>
        </dl>
        {walletGate("claim") ??
          (mineOwed > ZERO ? (
            <button
              type="button"
              disabled={busy}
              aria-busy={busy && run.action === "claim"}
              onClick={() =>
                void act(
                  "claim",
                  "Signing in this browser and waiting for the chain to execute the payout.",
                  async (record) => {
                    // Recorded as each batch lands, so a later batch failing keeps the earlier receipts.
                    let landed = 0;
                    const sent = await claimAll(wallet as NonNullable<typeof wallet>, r.address, (c) => {
                      landed += 1;
                      record(landed === 1 ? "Claim" : `Claim ${landed}`, c.signature);
                    });
                    const paid = sent.reduce((sum, c) => sum + c.kelvin, ZERO);
                    return sent.length === 0
                      ? "Nothing was owed to this wallet by the time the claim was built, so nothing was sent."
                      : `Paid ${formatKelvin(paid)} RLO into this wallet.`;
                  },
                )
              }
              className={`${PRIMARY} mt-4 w-full sm:w-auto`}
            >
              {busy && run.action === "claim" ? "Claiming" : `Claim ${formatKelvin(mineOwed)} RLO`}
            </button>
          ) : (
            <Note className="mt-3">
              {allOwed === ZERO
                ? "Every payout on this raffle has been made."
                : "Nothing here is owed to this wallet."}
            </Note>
          ))}
        {reclaimable !== null && sched !== null && (
          <div className="mt-6 border-t border-rule pt-5">
            <Head2>Schedule deposit</Head2>
            <Note className="mt-3">
              Rialo&rsquo;s Subscriber program holds{" "}
              <span className="figure text-fg">{formatKelvin(reclaimable)}</span>{" "}RLO of yours for this
              raffle&rsquo;s schedule.{" "}
              {sched.kind === "sent"
                ? "It has sent its Draw, so the deposit can come back."
                : sched.kind === "scheduled"
                  ? "The raffle is already settled, so the Draw it still holds would only be turned away. Reclaiming returns the deposit and cancels that Draw."
                  : "The raffle is settled, so the deposit can come back."}
            </Note>
            {walletGate("reclaim the deposit") ?? (
              <button
                type="button"
                disabled={busy}
                aria-busy={busy && run.action === "reclaim"}
                onClick={() =>
                  void act(
                    "reclaim",
                    "Signing in this browser and waiting for the chain to close the schedule account.",
                    async (record) => {
                      const sent = await reclaimSchedule(wallet as NonNullable<typeof wallet>, r.address);
                      record("Schedule deposit reclaimed", sent.signature);
                      return `The schedule account is closed and ${formatKelvin(sent.kelvin)} RLO is back in this wallet, less the network fee.`;
                    },
                  )
                }
                className={`${SECONDARY} mt-4 w-full sm:w-auto`}
              >
                {busy && run.action === "reclaim" ? "Reclaiming" : `Reclaim the schedule deposit, ${formatKelvin(reclaimable)} RLO`}
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  /* ------------------------------------------------------------------ render */

  return (
    <main
      className={`pt-mast pb-[clamp(48px,8vw,104px)] ${settled ? "inv bg-panel text-fg" : ""}`}
    >
      <ChainBlade raffle={r} label={fieldLabel} />

      <div className="px-gutter pt-[clamp(24px,4vw,52px)]">
        <BackToBoard />

        <div className="mt-[clamp(16px,2.4vw,28px)] grid items-start gap-[clamp(22px,3vw,44px)] lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          {/* ------------------------------------------------------------ the subject */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Cap>
                {pool.cap} &middot; on {NETWORK}
              </Cap>
              <PhaseTag phase={phase} />
            </div>

            {figure !== null ? (
              <div className="monument mt-2 text-pool">{figure}</div>
            ) : (
              <div className="figure mt-2 text-title [overflow-wrap:anywhere]">
                {formatKelvin(pool.kelvin)}
              </div>
            )}

            <Cap className="mt-2.5">RLO · {pool.sub}</Cap>

            <h1 className="font-serif mt-[22px] mb-[18px] text-display [overflow-wrap:anywhere]">
              {cleanTitle(r.title) || "Untitled raffle"}
            </h1>

            {/* The two deadlines, each naming itself, each with its own live distance. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] border border-bound">
              {[
                /*
                  Once a window is over the cell says "deadline", not "closed at". A sale that sold
                  out closed before its deadline and an early draw ends reveals before theirs, so
                  "Sale closed 04:20" beside "Settled 04:18" would be a sentence the facts contradict.
                */
                {
                  term: phase === "selling" ? "Sale closes" : "Sale deadline",
                  at: r.commitDeadline,
                  left: phase === "selling" ? ladder(r.commitDeadline, now) : null,
                },
                {
                  term: live ? "Reveals close" : "Reveal deadline",
                  at: r.revealDeadline,
                  left: live ? ladder(r.revealDeadline, now) : null,
                },
              ].map((cell) => (
                <div key={cell.term} className="border-r border-bound px-3.5 py-3 last:border-r-0">
                  <Cap>{cell.term}</Cap>
                  <div className="figure mt-1.5 text-sm">{stampMs(cell.at)}</div>
                  {cell.left !== null && (
                    <div className="figure mt-0.5 text-sm text-fg-3">in {cell.left}</div>
                  )}
                </div>
              ))}
            </div>

            {live && (
              <div className="mt-[clamp(20px,2.6vw,30px)]">
                <Cap>{phase === "selling" ? "Sale closes in" : "Reveals close in"}</Cap>
                <div
                  className={`monument mt-2.5 ${secondsLeft(deadline, now) < 3600 ? "text-event" : ""}`}
                  style={{ fontSize: "var(--text-title)" }}
                >
                  {ladder(deadline, now)}
                </div>
              </div>
            )}

            <p className="mt-[22px] max-w-[58ch] text-lg text-fg-2">{leadOf(r, phase, waitingOnRialo)}</p>

            {live && sched !== null && (sched.kind === "scheduled" || sched.kind === "due") && (
              <Note className="mt-3">
                The draw is scheduled: when reveals close, Rialo&rsquo;s Subscriber program is set to
                send Draw at <span className="figure text-fg">{stampSecondsMs(sched.at)}</span> by itself. If it
                does not arrive, anyone can press Draw.
              </Note>
            )}
            {live && sched !== null && sched.kind === "dropped" && (
              <Note className="mt-3">
                This raffle&rsquo;s schedule account is still there, but Rialo&rsquo;s node reports that it
                no longer holds the Draw. Once the raffle is ready to draw, anyone can press Draw.
              </Note>
            )}
            {/* Said where it matters: on a raffle older than the schedule, a missing automatic draw is
                its age, not a fault, and the reader is owed that before the deadline passes. */}
            {live && sched !== null && sched.kind === "none" && (
              <Note className="mt-3">
                This raffle has no automatic draw. It was deployed before Drawbook began scheduling the
                draw with Rialo, or Rialo refused its schedule, so once it is ready, someone has to
                press Draw.
              </Note>
            )}

            {stale && (
              <Note className="mt-3">
                The last read failed ({stale}). What is shown is the account as it was last read;
                this page keeps trying.
              </Note>
            )}

            {/* ------------------------------------------------------ the actions */}
            <section
              aria-labelledby="act-heading"
              className="mt-[clamp(26px,3vw,38px)] border-t border-rule pt-6"
            >
              {panel}
              <RunResult run={run} />
              <p role="status" aria-live="polite" className="sr-only">
                {run.kind === "done"
                  ? run.text
                  : run.kind === "failed"
                    ? `Not done. ${run.refusal.text}`
                    : ""}
              </p>
            </section>

            {/* -------------------------------------------------------- the sheet */}
            <section aria-labelledby="sheet-heading" className="mt-[clamp(26px,3vw,38px)]">
              <Head2 id="sheet-heading" className="mb-2.5">
                The ticket sheet &middot; {r.supply} cells
              </Head2>
              <ChainSheet raffle={r} phase={phase} mine={me} label={fieldLabel} />
              {mine.length > 0 && (
                <Note className="mt-2.5">The ringed cells are held by the wallet in the bar above.</Note>
              )}

              {r.sold > 0 && (
                <table className="mt-4 w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="label border-b border-rule pb-2 text-left font-normal text-fg-3">
                        No.
                      </th>
                      <th className="label border-b border-rule pb-2 text-left font-normal text-fg-3">
                        Holder
                      </th>
                      <th className="label border-b border-rule pb-2 text-right font-normal text-fg-3">
                        State
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.tickets
                      .filter((t) => t.holder !== null)
                      .map((t) => (
                        <tr key={t.index}>
                          <td className="figure border-b border-rule py-2 pr-3 align-top">{pad2(t.index)}</td>
                          <td className="mono border-b border-rule py-2 pr-3 align-top text-fg-2">
                            <span title={t.holder as string}>{shortAddress(t.holder as string, 4, 4)}</span>
                            {t.holder === me && <span className="label ml-2 text-fg">you</span>}
                          </td>
                          <td className="border-b border-rule py-2 text-right align-top text-fg-2">
                            {ticketWord(r, t, phase)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* ------------------------------------------------------ the winners */}
            {phase === "drawn" && winners.length > 0 && (
              <section aria-labelledby="winners-heading" className="mt-[clamp(26px,3vw,38px)]">
                <Head2 id="winners-heading" className="mb-2.5">
                  The draw
                </Head2>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-3 min-[760px]:grid-cols-2">
                  {winners.map((t) => (
                    <div key={t.index} className="flex items-start gap-4 border border-bound p-4">
                      <div className="monument text-event" style={{ fontSize: "clamp(2.4rem, 5vw, 4rem)" }}>
                        {pad2(t.index)}
                      </div>
                      <div className="min-w-0">
                        <Cap>
                          Winner {t.winRank} of {r.effectiveWinners}
                        </Cap>
                        <div className="figure mt-1.5 text-lg">{formatKelvin(winningsOf(r, t))} RLO</div>
                        <p className="digest mt-1.5 text-sm text-fg-2">{t.holder}</p>
                        <p className="label mt-2 text-fg-3">
                          {t.paid ? "Paid" : "Not claimed yet"}
                          {t.holder === me ? " · yours" : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* -------------------------------------------------------- the audit */}
            <section aria-labelledby="audit-heading" className="mt-[clamp(26px,3vw,38px)]">
              <Head2 id="audit-heading" className="mb-2.5">
                {phase === "selling" ? "What a purchase publishes" : "Audit"}
              </Head2>

              {phase === "selling" && (
                <>
                  <Well>
                    <Formula>
                      {`commitment = SHA256( "drawbook-v2|commit|" ‖ raffle address ‖ ticket number ‖ your address ‖ your secret )`}
                    </Formula>
                  </Well>
                  <Note className="mt-3">
                    That hash is all that leaves the browser at purchase. It binds the secret to your
                    address, this raffle and one exact ticket, so it cannot be lifted onto another.
                    The secret itself is posted at reveal, and until then nobody can compute the seed.
                  </Note>
                </>
              )}

              {(phase === "revealing" || phase === "ready") && (
                <>
                  <Well>
                    <Formula>
                      {`seed = SHA256( "drawbook-v2|seed|" ‖ raffle address ‖ sort(${r.revealed} secrets so far) ‖ <chain value, read at the draw> )`}
                    </Formula>
                  </Well>
                  <Note className="mt-3">
                    The chain value does not exist yet. The program reads it in the draw transaction,
                    after every secret is public, which is why staying silent to steer the seed is a
                    bet nobody can price. The limit is stated rather than hidden: whoever produces
                    the draw block could try candidate values if they can influence that read at all.
                  </Note>
                </>
              )}

              {phase === "void" && (
                <Well>
                  <Formula>
                    {"Nobody revealed, so there is no sorted secret list and no seed. None was derived and none can be: that is what void means, and it is the correct outcome rather than a failure."}
                  </Formula>
                </Well>
              )}

              {phase === "drawn" && (
                <>
                  <Well>
                    <Formula>
                      {`seed = SHA256( "drawbook-v2|seed|" ‖ ${r.address} ‖ sort(${r.revealed} secrets) ‖ u64be(${r.chainSeed.toString()}) )`}
                    </Formula>
                  </Well>
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setAudit("pending");
                        // A frame first, so the button visibly does something before a hash that is
                        // usually instant; the result is still computed from the account just read.
                        requestAnimationFrame(() => setAudit(auditDraw(r)));
                      }}
                      className={SECONDARY}
                    >
                      Recompute in this tab
                    </button>
                  </div>
                  <AuditResult raffle={r} audit={audit} winners={winners} />
                </>
              )}
            </section>
          </div>

          {/* --------------------------------------------------------------- the facts */}
          <div className="min-w-0">
            <Head2 className="mb-2.5">Facts, read from the account</Head2>
            <table className="w-full table-fixed border-collapse text-sm">
              <tbody>
                <Fact term="Raffle account">
                  <Long>{r.address}</Long>
                </Fact>
                <Fact term="Program">
                  <span title={PROGRAM_ID}>{shortAddress(PROGRAM_ID, 6, 6)}</span>
                </Fact>
                <Fact term="Creator">
                  <span title={r.creator}>{shortAddress(r.creator, 6, 6)}</span>
                  {r.creator === me && <span className="label ml-2 text-fg">you</span>}
                </Fact>
                <Fact term="Stage">{CHAIN_PHASE_WORD[phase]}</Fact>
                <Fact term="Prize deposited">{formatKelvin(r.prize)} RLO</Fact>
                <Fact term="Ticket price">{formatKelvin(r.ticketPrice)} RLO</Fact>
                <Fact term="Reveal bond">{formatKelvin(r.revealBond)} RLO</Fact>
                <Fact term="Supply">{r.supply}</Fact>
                <Fact term="Sold">{r.sold}</Fact>
                <Fact term="Revealed">{r.revealed}</Fact>
                <Fact term="Winners set">{r.winners}</Fact>
                <Fact term="Created">{stampMs(r.createdAt)}</Fact>
                <Fact term="Automatic draw">{scheduleWord(sched, r, settled)}</Fact>
                {sched !== null && sched.kind !== "none" && (
                  <Fact term="Schedule account">
                    <Long>{sched.address}</Long>
                  </Fact>
                )}
                {sched !== null && sched.kind === "sent" && (
                  <Fact term="Sent by Rialo">
                    <Long>{sched.firing.signature}</Long>
                  </Fact>
                )}
                {sched !== null && sched.kind !== "none" && (
                  <Fact term="Schedule deposit">
                    {sched.kind !== "withdrawn" && sched.deposit !== null
                      ? `${formatKelvin(sched.deposit)} RLO held`
                      : "returned to the creator"}
                  </Fact>
                )}
                {settled && <Fact term="Settled">{stampMs(r.drawnAt)}</Fact>}
                {phase === "drawn" && (
                  <>
                    <Fact term="Winners drawn">{r.effectiveWinners}</Fact>
                    <Fact term="Pool">{formatKelvin(r.pool)} RLO</Fact>
                    <Fact term="Per winner">{formatKelvin(r.perWinner)} RLO</Fact>
                    <Fact term="Chain value">
                      <Long>{r.chainSeed.toString()}</Long>
                    </Fact>
                    {r.seed && (
                      <Fact term="Seed">
                        <Long>{r.seed}</Long>
                      </Fact>
                    )}
                  </>
                )}
                {phase === "void" && (
                  <Fact term="Prize refunded">{r.creatorRefunded ? "yes" : "not yet"}</Fact>
                )}
                <Fact term="Account holds">{formatKelvin(r.kelvins)} RLO</Fact>
              </tbody>
            </table>

            {/* ------------------------------------------------------- activity */}
            <section aria-labelledby="activity-heading" className="mt-[26px]">
              <Head2 id="activity-heading" className="mb-2.5">
                Transactions on this account
              </Head2>
              {activity === null ? (
                <Note>Reading the transaction list.</Note>
              ) : activity.length === 0 ? (
                <Note>The node returned no transactions for this account.</Note>
              ) : (
                <ol className="grid">
                  {activity.slice(0, 12).map((a) => (
                    <li key={a.signature} className="border-b border-rule py-2.5">
                      <div className="label text-fg-3">
                        {a.at === null ? "time not reported" : stampMs(a.at < 1e12 ? a.at * 1000 : a.at)}
                        {sched !== null && sched.kind === "sent" && sched.firing.signature === a.signature
                          ? " · Draw, sent by Rialo"
                          : ""}
                      </div>
                      <div className="digest mt-1 text-sm text-fg select-all">{a.signature}</div>
                    </li>
                  ))}
                </ol>
              )}
              {activity !== null && activity.length > 12 && (
                <Note className="mt-2.5">The newest 12 of {activity.length}.</Note>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

/* --------------------------------------------------------------------- pieces */

function BackToBoard() {
  return (
    <Link
      href="/raffles"
      className="label inline-flex items-center gap-1.5 text-fg-3 transition-colors hover:text-fg"
    >
      <ArrowLeft size={12} weight="bold" aria-hidden="true" />
      All raffles
    </Link>
  );
}

/**
 * The recomputation, set beside the record it checks. A mismatch refuses in words and in reversed
 * print, never in the signal hue: a fraud dressed as a celebration would be the worst thing this
 * page could do.
 */
function AuditResult({
  raffle,
  audit,
  winners,
}: {
  raffle: ChainRaffle;
  audit: ReturnType<typeof auditDraw> | "pending" | null;
  winners: ChainTicket[];
}) {
  if (audit === null) return null;
  if (audit === "pending") return <Note className="mt-3">Recomputing.</Note>;

  const recorded = winners.map((t) => pad2(t.index)).join(", ") || "none";
  const rebuilt = audit.winners.map(pad2).join(", ") || "none";

  return (
    <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]">
      <div className="recess min-w-0 bg-recess px-4 py-3.5">
        <dl className="grid gap-4">
          <div>
            <dt className="label text-fg-3">Seed, recomputed here</dt>
            <dd className="digest mt-1 text-sm leading-relaxed text-fg">{audit.seed}</dd>
          </div>
          <div>
            <dt className="label text-fg-3">Seed on the account</dt>
            <dd className="digest mt-1 text-sm leading-relaxed text-fg">{raffle.seed ?? "none"}</dd>
          </div>
          <div>
            <dt className="label text-fg-3">Winners, recomputed here</dt>
            <dd className="figure mt-1 text-sm text-fg">{rebuilt}</dd>
          </div>
          <div>
            <dt className="label text-fg-3">Winners on the account</dt>
            <dd className="figure mt-1 text-sm text-fg">{recorded}</dd>
          </div>
        </dl>
      </div>

      <div className="min-w-0">
        {audit.matches ? (
          <p className="text-sm text-fg">Match. Same seed, same tickets, same order.</p>
        ) : (
          <p className="label bg-fg px-4 py-3 text-panel">
            Mismatch. The account does not agree with the recomputation.
          </p>
        )}
        <Note className="mt-3">
          Computed in this tab just now from the account&rsquo;s own data: the {raffle.revealed}{" "}
          revealed secrets, the chain value the program read at the draw, and SHA-256. The winner
          selection was replayed exactly as lib/raffle.ts defines it, and compared ticket by ticket
          with what the program flagged.
        </Note>
      </div>
    </div>
  );
}
