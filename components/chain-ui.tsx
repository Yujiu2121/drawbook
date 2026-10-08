"use client";

/**
 * THE PIECES EVERY ON-CHAIN PAGE SHARES.
 *
 * /create, /r/[address] and the live list on /raffles all talk to the deployed raffle program
 * through lib/chain, and all three need the same handful of things the mock pages never did: money
 * as an exact bigint rather than a float, a clock that is the real wall clock rather than the pinned
 * NOW, the wallet read through its store, and one way of saying what a transaction did. They live
 * here once so the three pages cannot drift into three dialects of the same refusal.
 *
 * WHY A SECOND CLOCK. lib/clock.ts starts at the pinned instant in lib/mock-raffles.ts, which is
 * load-bearing for the sample raffles: their commitments are real digests and their draws must
 * reproduce. An on-chain raffle has the opposite requirement. Its deadlines are milliseconds on the
 * chain's own clock, so a countdown measured from a pinned July instant would be two months wrong,
 * which is exactly the bug the old /create had when it printed deadlines in the past. `useNow`
 * below reads `Date.now()`, and it publishes zero on the server and through hydration so the first
 * client render matches the HTML; a caller treats zero as "not started yet".
 *
 * WHY BIGINT. Every amount on chain is a u64 of kelvin. A float can hold 2^53 exactly, which is
 * about nine million RLO, so the figures on a testnet raffle would survive it, but a parse of
 * "0.1" through Number gives 0.1000000000000000055 and a ticket price that is one kelvin off is a
 * ticket price the program records as something nobody typed. So amounts are parsed digit by digit
 * into bigint and printed digit by digit out of it, and no float ever touches one.
 */

import { useSyncExternalStore, type ReactNode } from "react";

import { countdownLadder, utcShort, utcStamp } from "@/lib/cell";
import { ChainError, type Outcome } from "@/lib/chain/actions";
import { storagePersists } from "@/lib/chain/nonces";
import { cleanTitle, errorMessage, type ChainPhase } from "@/lib/chain/program";
import { RIALO_RPC } from "@/lib/rialo-rpc";
import { WALLET_STORAGE_KEY } from "@/lib/wallet";
import {
  getServerSnapshot as walletServerSnapshot,
  getSnapshot as walletSnapshot,
  subscribe as walletSubscribe,
} from "@/lib/wallet-store";

/* ------------------------------------------------------------------- money */

/*
  BigInt literals need an ES2020 target and tsconfig targets ES2017, so the constants are built
  with the BigInt function rather than written with the n suffix.
*/
export const ZERO = BigInt(0);
export const KELVIN_PER_RLO = BigInt(1_000_000_000);

/** Group the whole part in threes, the way formatRLO in lib/raffle.ts does through toLocaleString. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Kelvin as RLO, exactly. Up to nine decimals, trailing zeros trimmed, but never fewer than the
 * mock pages print (three below one RLO, two above), so a figure here and a figure on a sample
 * raffle read in the same voice.
 */
export function formatKelvin(kelvin: bigint): string {
  const negative = kelvin < ZERO;
  const abs = negative ? -kelvin : kelvin;
  const whole = abs / KELVIN_PER_RLO;
  let frac = (abs % KELVIN_PER_RLO).toString().padStart(9, "0").replace(/0+$/, "");
  const min = whole === ZERO ? 3 : 2;
  if (frac.length < min) frac = frac.padEnd(min, "0");
  return `${negative ? "-" : ""}${groupThousands(whole.toString())}.${frac}`;
}

/**
 * Kelvin as a monument figure inside a glyph budget, or null when it cannot fit honestly.
 *
 * --text-pool allows six glyphs and --text-monument eight (app/globals.css measures why), and an
 * exact nine-decimal pool would run off a phone. So the figure is TRUNCATED, never rounded, to
 * whatever decimals the budget leaves: a monument may understate a pool by less than its last digit
 * but must never claim money that is not there. A figure that truncates to zero while the pool is
 * not zero returns null, and the caller prints the exact figure at a smaller size instead, because
 * "0.000" over a real deposit is a lie of the same kind.
 */
export function figureKelvin(kelvin: bigint, budget = 6): string | null {
  if (kelvin < ZERO) return null;
  const whole = (kelvin / KELVIN_PER_RLO).toString();
  if (whole.length > budget) return null;
  const room = budget - whole.length - 1;
  if (room <= 0) return whole === "0" && kelvin > ZERO ? null : whole;

  let frac = (kelvin % KELVIN_PER_RLO).toString().padStart(9, "0").slice(0, room);
  frac = frac.replace(/0+$/, "");
  const min = Math.min(room, whole === "0" ? 3 : 2);
  if (frac.length < min) frac = frac.padEnd(min, "0");
  const text = `${whole}.${frac}`;
  if (kelvin > ZERO && /^0\.0*$/.test(text)) return null;
  return text;
}

/** What `parseRLO` returns: the exact kelvin, or the sentence that says why the text is not money. */
export type Parsed = { kelvin: bigint; error: null } | { kelvin: null; error: string };

/**
 * Parse an RLO amount typed by a person into exact kelvin.
 *
 * Accepts a comma or a full stop as the decimal separator, because both are how people write a
 * decimal and the form is read by people in both habits. There is therefore no thousands separator
 * at all: a comma is always the decimal point, so "1,500" is one and a half, and the specimen beside
 * the form prints back what was read before anything is signed. Two separators are refused rather
 * than guessed at, since guessing is how a prize ends up a thousand times too large. At most nine
 * decimals, because a kelvin is the ninth and a tenth is a fraction of the smallest unit there is.
 */
export function parseRLO(text: string): Parsed {
  const t = text.trim();
  if (t === "") return { kelvin: null, error: "Enter an amount." };
  const separators = (t.match(/[.,]/g) ?? []).length;
  if (separators > 1) {
    return { kelvin: null, error: "Use one decimal separator and no thousands separators." };
  }
  const m = /^(\d*)[.,]?(\d*)$/.exec(t);
  if (!m || (m[1] === "" && m[2] === "")) {
    return { kelvin: null, error: "Digits only, with a comma or a full stop for the decimals." };
  }
  if (m[2].length > 9) {
    return { kelvin: null, error: "At most nine decimals: a kelvin is 0.000000001 RLO." };
  }
  const whole = BigInt(m[1] === "" ? "0" : m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(9, "0"));
  return { kelvin: whole * KELVIN_PER_RLO + frac, error: null };
}

/**
 * `cleanTitle` lives in lib/chain/program.ts, beside the decoder that reads the title bytes, because
 * the server needs it too: /r/[address] prints the same cleaned title in the tab. A function
 * imported from this module into a Server Component would arrive as a client reference, not as the
 * function. It is re-exported here so the pages keep one import for the kit.
 */
export { cleanTitle };

/** UTF-8 length, which is what the 32-byte title field on chain actually counts. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/* ----------------------------------------------------------------- network */

/**
 * Which network this build talks to, in words, read off the same RIALO_RPC constant every client in
 * the app is built on (NEXT_PUBLIC_RIALO_RPC, testnet by default). A button that says "testnet"
 * while the build is pointed at a local network would be the first false sentence on the page, so
 * the name is derived rather than written.
 */
export const NETWORK = /testnet\.rialo\.io/.test(RIALO_RPC)
  ? "testnet"
  : /devnet/.test(RIALO_RPC)
    ? "devnet"
    : "local network";

/* ------------------------------------------------------------------- clock */

let nowValue = 0;
let nowTimer: ReturnType<typeof setInterval> | null = null;
const nowListeners = new Set<() => void>();

function nowSubscribe(onChange: () => void): () => void {
  nowListeners.add(onChange);
  if (nowTimer === null) {
    // Read at once rather than a second from now, so the first client render after hydration has a
    // real instant. React re-reads the snapshot after subscribing and re-renders on the change.
    nowValue = Date.now();
    nowTimer = setInterval(() => {
      nowValue = Date.now();
      for (const notify of nowListeners) notify();
    }, 1000);
  }
  return () => {
    nowListeners.delete(onChange);
    if (nowListeners.size === 0 && nowTimer !== null) {
      clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}

/**
 * The real wall clock in milliseconds, republished once a second. Zero on the server and during
 * hydration; see the header for why that is the contract rather than a defect.
 */
export function useNow(): number {
  return useSyncExternalStore(
    nowSubscribe,
    () => nowValue,
    () => 0,
  );
}

/** Whole seconds until `deadlineMs`, clamped at zero, for `countdownLadder` in lib/cell.ts. */
export function secondsLeft(deadlineMs: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
}

/** The countdown ladder on the real clock: `3d 03h`, `27:14:02`, `59:04`, `closed`. */
export function ladder(deadlineMs: number, now: number): string {
  return countdownLadder(secondsLeft(deadlineMs, now));
}

/**
 * The ISO form of a chain timestamp, or null when no Date can hold it. A Date reaches 8.64e15 ms
 * either side of 1970 and toISOString throws a RangeError past that, and a u64 deadline goes far
 * beyond it; a page that printed one used to crash outright.
 */
function isoOf(ms: number): string | null {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
  return new Date(ms).toISOString();
}

/** A chain timestamp in milliseconds, as the same UTC stamp the sample raffles print. Total. */
export function stampMs(ms: number): string {
  const iso = isoOf(ms);
  return iso === null ? "far in the future" : utcStamp(iso);
}

/** The same instant for a dense column (`30 Jul 09:00`). Total, like stampMs. */
export function shortMs(ms: number): string {
  const iso = isoOf(ms);
  return iso === null ? "far future" : utcShort(iso);
}

/* ------------------------------------------------------------------ wallet */

/**
 * Whether this browser will still have the wallet's key, and a ticket's secret, after a reload.
 * With site data blocked or a private window that forgets, localStorage refuses or drops every
 * write, so the key and the secrets live in this page view only: the wallet's balance, any refund
 * owed to it, and the reveal of any ticket bought now would all be gone at the next reload.
 */
export function storageKeeps(address: string): boolean {
  if (!storagePersists()) return false;
  try {
    const raw = globalThis.localStorage?.getItem(WALLET_STORAGE_KEY);
    return typeof raw === "string" && (JSON.parse(raw) as { address?: unknown }).address === address;
  } catch {
    return false;
  }
}

/** The wallet store, read the way every island in this app reads it. */
export function useWallet() {
  return useSyncExternalStore(walletSubscribe, walletSnapshot, walletServerSnapshot);
}

/* ------------------------------------------------------------------- words */

/**
 * The phase, printed. The first four are PHASE_WORD's own words from components/cell.tsx, so a
 * live raffle and a sample read the same; "ready" is new because a real raffle has a moment the
 * sample book never shows, after reveals close and before anybody has pressed Draw.
 */
export const CHAIN_PHASE_WORD: Record<ChainPhase, string> = {
  selling: "Selling",
  revealing: "Revealing",
  ready: "Ready",
  drawn: "Drawn",
  void: "Void",
};

/**
 * The tag for a phase. `data-phase` drives the colour in app/cell.css (drawn takes --event, void
 * --fg-3); "ready" has no rule there and so prints in --fg, which is right: it is the one moment a
 * raffle is waiting on a person rather than on the clock.
 */
export function PhaseTag({ phase }: { phase: ChainPhase }) {
  return (
    <span className="phase-tag label" data-phase={phase}>
      {CHAIN_PHASE_WORD[phase]}
    </span>
  );
}

/* ---------------------------------------------------------------- refusals */

export interface Refusal {
  /** One sentence in plain English. */
  text: string;
  /** The program's custom error code, when the chain gave one. */
  code: number | null;
  /** The transaction log lines, kept for anyone who wants to read what the node said. */
  logs: string[];
  /**
   * The transaction's signature, set on every failure after it was signed. Shown when the
   * transaction executed and failed (a landed failure is still a receipt) and when its outcome is
   * unknown (it is the thing to check); not when the node refused it, since that one is not on chain.
   */
  signature?: string | null;
  /** Where the transaction stands; see Outcome in lib/chain/tx.ts. */
  outcome?: Outcome;
}

/**
 * Any failure from lib/chain, as something a person can read. A ChainError with a code is a refusal
 * by the program and is translated through errorMessage in lib/chain/program; anything else is a
 * network or node failure and its own message is the most honest thing to show.
 */
export function describeError(error: unknown): Refusal {
  if (error instanceof ChainError) {
    return {
      text: error.code !== null ? errorMessage(error.code) : error.message,
      code: error.code,
      logs: error.logs ?? [],
      signature: error.signature ?? null,
      outcome: error.outcome,
    };
  }
  if (error instanceof Error) return { text: error.message, code: null, logs: [] };
  return { text: String(error), code: null, logs: [] };
}

/* ---------------------------------------------------------------- controls */

/**
 * The control shells, the same three the counter on a sample raffle uses, so a button on a live
 * raffle is the same object as a button on a sample. No signal hue: --event means a result in this
 * product, and a button is not one.
 */
const CONTROL =
  "label inline-flex items-center justify-center gap-2 border px-3.5 py-2.5 transition-colors duration-[var(--t-open)] ease-settle";

export const PRIMARY = `${CONTROL} border-fg bg-fg text-panel hover:border-fg-2 hover:bg-fg-2 active:translate-y-px disabled:cursor-not-allowed disabled:border-bound disabled:bg-panel-2 disabled:text-fg-3`;

export const SECONDARY = `${CONTROL} border-bound text-fg hover:bg-panel-2 active:translate-y-px disabled:cursor-not-allowed disabled:text-fg-3`;

/** The uppercase caption over a block. */
export function Cap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`label text-fg-3 ${className}`}>{children}</div>;
}

/** A caption under the thing it qualifies. */
export function Note({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`max-w-[62ch] text-sm text-fg-2 ${className}`}>{children}</p>;
}

/**
 * A transaction signature, whole. Never shortened: the signature is the receipt, and the only
 * reason to print it is that someone can look it up, which a shortened one defeats. `select-all`
 * so one click takes the whole string.
 */
export function Signature({ value, label = "Signature" }: { value: string; label?: string }) {
  return (
    <div className="min-w-0">
      <dt className="label text-fg-3">{label}</dt>
      <dd className="digest mt-1 text-sm leading-relaxed text-fg select-all">{value}</dd>
    </div>
  );
}

/**
 * Seconds a pending action has been waiting, so a slow confirmation reads as slow, not as stuck.
 * Past twenty seconds it also says why it is still waiting: lib/chain keeps checking a sent
 * transaction until its validity window has passed, about two minutes, because before then one
 * that has not landed still can, and calling it failed would invite a second, paid, attempt.
 */
export function Waiting({ since, children }: { since: number; children: ReactNode }) {
  const now = useNow();
  const seconds = now > since ? Math.floor((now - since) / 1000) : 0;
  return (
    <div aria-live="polite">
      <p className="text-sm text-fg-2">
        {children} <span className="figure text-fg-3 whitespace-nowrap">{seconds}s</span>
      </p>
      {seconds >= 20 && (
        <p className="mt-1.5 text-sm text-fg-3">
          Still checking. A transaction can land for about two minutes after it is signed, so this
          page keeps asking until it has landed or no longer can. Starting the same action in another
          tab meanwhile could pay twice.
        </p>
      )}
    </div>
  );
}

/**
 * A refusal, in reversed print and never in a colour. The signal hue means a winner here, and the
 * system has no error colour on purpose; full ink with panel lettering is a louder step than a hue
 * change would be and it spends nothing from the signal budget.
 */
export function RefusalBlock({ refusal, title }: { refusal: Refusal; title?: string }) {
  const unknown = refusal.outcome === "unknown";
  // A refused transaction is not on chain, so its signature would be a receipt for nothing.
  const showSignature = refusal.signature && refusal.outcome !== "refused" && refusal.outcome !== "not-sent";
  return (
    <div className="border border-bound" role="alert">
      <p className="label bg-fg px-4 py-3 text-panel">
        {title ?? (unknown ? "Not confirmed: it may have landed" : "Not done")}
      </p>
      <div className="px-4 py-3.5">
        <p className="text-sm text-fg">{refusal.text}</p>
        {refusal.code !== null && (
          <p className="figure mt-1.5 text-sm text-fg-3">Program error {refusal.code}</p>
        )}
        {showSignature ? (
          <dl className="mt-2.5">
            <Signature label={unknown ? "Transaction to check" : "Transaction"} value={refusal.signature as string} />
          </dl>
        ) : null}
        {refusal.logs.length > 0 && (
          <details className="mt-2.5">
            <summary className="label cursor-pointer text-fg-3">What the node logged</summary>
            <pre className="mono recess mt-2 overflow-x-auto bg-recess px-3 py-2.5 text-sm leading-[1.6] whitespace-pre text-fg">
              {refusal.logs.join("\n")}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
