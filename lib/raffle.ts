/**
 * The raffle: a commit-reveal draw.
 *
 * Pure, React-free, and the executable specification for the Rialo program that replaces it.
 *
 * WHY COMMIT-REVEAL AND NOT THE CHAIN'S RANDOMNESS
 * ------------------------------------------------
 * Rialo does expose native randomness: `rialo_s_random_seed::get_random_seed() -> u64`, backed
 * by the `rlo_get_random_seed` syscall. It is real and it is one line. But it returns a bare
 * u64 with no proof, no commitment and nothing auditable, there is no VRF or beacon anywhere in
 * the platform, and its entropy source is described publicly only as "a random seed from the
 * bank". If that seed derives from state a block producer controls, a producer can grind the
 * winner. For a raffle, whose entire product is that the draw is fair, that is not good enough.
 *
 * So the seed is built from the participants instead:
 *
 *   seed = SHA256( DOMAIN ‖ raffleId ‖ sort(revealed nonces) ‖ chainSeed )
 *
 * Every ticket buyer commits to a secret nonce when they buy. After the sale closes they reveal
 * it. The winner comes out of the hash of all revealed nonces, so no single participant can
 * steer it, and anyone can recompute the whole thing from public data.
 *
 * Nonces are sorted before hashing so that the order in which people reveal cannot change the
 * outcome, which would otherwise hand an advantage to whoever reveals last.
 *
 * WHAT THIS DOES AND DOES NOT GUARANTEE
 * -------------------------------------
 * Withholding a reveal does change the seed, which is the classic last-revealer bias. Two things
 * blunt it. First, `chainSeed` is only known at the draw, so a griefer cannot work out whether
 * aborting helps them. Second, failing to reveal forfeits the reveal bond. Biasing the draw
 * therefore requires a party who BOTH controls block production AND reveals last. That is a real
 * and stateable limit, not a claim of perfection: this is unbiasable against any ordinary
 * participant, and it is honest to call the result verifiable, which a bare `get_random_seed()`
 * would not be.
 */

// Explicit extension so scripts/ can run this file directly under node's type stripping,
// without a bundler in the loop. Turbopack resolves it identically.
import { concat, fromHex, sha256, toHex, utf8 } from "./sha256.ts";

/** Binds every hash in this module to this scheme, so digests cannot be replayed elsewhere. */
const DOMAIN = "rialo-raffle-v1";

/** 1 RLO = 1e9 kelvin. Kelvin is Rialo's base unit, its rename of lamports. */
export const KELVIN_PER_RLO = 1_000_000_000;

export type Address = string;

export type Phase =
  /** Tickets on sale. Each purchase carries a commitment. */
  | "selling"
  /** Sale closed, either sold out or past the commit deadline. Holders reveal now. */
  | "revealing"
  /** Winners resolved from the revealed nonces and paid. */
  | "drawn"
  /** Nobody revealed, so there is nothing to draw from. Everyone is refunded. */
  | "void";

export interface RaffleConfig {
  id: number;
  title: string;
  creator: Address;
  /** Deposited by the creator, in kelvin. */
  prize: number;
  /** Per ticket, in kelvin. */
  ticketPrice: number;
  /** Locked at purchase, forfeited to the pool if the holder never reveals. */
  revealBond: number;
  /** Total tickets. */
  supply: number;
  /** How many tickets win. Capped at the number of revealed tickets at draw time. */
  winners: number;
  /** ISO. Sale and commit close here, or earlier if the last ticket sells. */
  commitDeadline: string;
  /** ISO. Reveals close here and the draw fires. */
  revealDeadline: string;
}

export interface Ticket {
  /** 1-based. */
  index: number;
  holder: Address | null;
  /** Hex SHA-256 committed at purchase. Null while the ticket is unsold. */
  commitment: string | null;
  /** Hex nonce, present once revealed. */
  nonce: string | null;
  /** ISO instant the ticket was bought. Absent while unsold. */
  boughtAt?: string;
  /** ISO instant the nonce was revealed. Absent until revealed. */
  revealedAt?: string;
}

export interface Raffle {
  config: RaffleConfig;
  tickets: Ticket[];
  phase: Phase;
  /** Set at the draw, hex. In production this is `get_random_seed()` rendered as 8 bytes. */
  chainSeed: string | null;
  /** Ticket indices that won, in the order they were drawn. */
  winningTickets: number[];
}

/* ------------------------------------------------------------- commitments */

/**
 * The commitment a buyer publishes. It binds the nonce to the holder, the raffle and the exact
 * ticket, so a commitment cannot be lifted from one ticket and reused on another.
 */
export function commitmentFor(
  nonce: string,
  holder: Address,
  raffleId: number,
  ticketIndex: number,
): string {
  return toHex(sha256(utf8(`${DOMAIN}|commit|${raffleId}|${ticketIndex}|${holder}|${nonce}`)));
}

/** True when `nonce` is the preimage of the ticket's commitment. */
export function revealMatches(ticket: Ticket, raffleId: number, nonce: string): boolean {
  if (!ticket.holder || !ticket.commitment) return false;
  return commitmentFor(nonce, ticket.holder, raffleId, ticket.index) === ticket.commitment;
}

/** A fresh 16-byte nonce from the platform CSPRNG, hex encoded. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/* ------------------------------------------------------------------- seed */

/**
 * The draw seed. Deterministic, and recomputable by anyone holding the public reveal set, which
 * is the property that makes the result checkable rather than merely asserted.
 */
export function deriveSeed(
  raffleId: number,
  revealedNonces: string[],
  chainSeed: string,
): string {
  // Sorted so reveal order cannot influence the outcome.
  const sorted = [...revealedNonces].sort();
  const parts = [utf8(`${DOMAIN}|seed|${raffleId}|`)];
  for (const nonce of sorted) parts.push(fromHex(nonce), utf8("|"));
  parts.push(fromHex(chainSeed));
  return toHex(sha256(concat(...parts)));
}

/** One step of the draw: where the keystream landed, and which ticket was sitting there. */
export interface DrawStep {
  /** Position in the remaining pool, that is `sample % poolBefore`. */
  pick: number;
  /** How many tickets were still in the pool when this step ran. */
  poolBefore: number;
  /** The ticket index this step drew and removed from the pool. */
  winner: number;
}

/**
 * The draw, with its working kept rather than discarded: the same partial Fisher-Yates shuffle
 * `deriveWinners` performs, recording each step's pool position and pool size. A ceremony that
 * shows the draw needs those internals, and reading them back out of the real function is what
 * keeps the shown draw and the recorded winners the same computation.
 */
export function deriveWinnerTrace(eligible: number[], seed: string, count: number): DrawStep[] {
  const pool = [...eligible];
  const take = Math.min(count, pool.length);
  const steps: DrawStep[] = [];
  const seedBytes = fromHex(seed);

  let counter = 0;
  // Annotated, not inferred: `new Uint8Array(0)` narrows to Uint8Array<ArrayBuffer>, which will
  // not accept the Uint8Array<ArrayBufferLike> that sha256 returns.
  let stream: Uint8Array = new Uint8Array(0);
  let at = 0;

  /** 48 bits per sample: far above any realistic ticket supply, so modulo bias is negligible. */
  function nextSample(): number {
    if (at + 6 > stream.length) {
      stream = sha256(concat(seedBytes, utf8(`|draw|${counter}`)));
      counter += 1;
      at = 0;
    }
    let value = 0;
    for (let i = 0; i < 6; i += 1) value = value * 256 + stream[at + i];
    at += 6;
    return value;
  }

  for (let i = 0; i < take; i += 1) {
    const poolBefore = pool.length;
    const pick = nextSample() % poolBefore;
    const winner = pool[pick];
    pool.splice(pick, 1);
    steps.push({ pick, poolBefore, winner });
  }

  return steps;
}

/**
 * Pick `count` distinct ticket indices from `eligible`, using a partial Fisher-Yates shuffle
 * driven by a SHA-256 keystream over the seed. Deterministic for a given seed, and unbiased
 * because each draw takes a fresh 6-byte sample reduced modulo a shrinking range.
 */
export function deriveWinners(eligible: number[], seed: string, count: number): number[] {
  return deriveWinnerTrace(eligible, seed, count).map((step) => step.winner);
}

/* --------------------------------------------------------------- derived */

export interface RaffleSummary {
  sold: number;
  available: number;
  revealed: number;
  /** Sold tickets whose holder has not revealed yet. */
  outstanding: number;
  /** Creator deposit + ticket revenue + forfeited bonds. */
  pool: number;
  /** Bonds lost by holders who never revealed. */
  forfeited: number;
  /** How many tickets actually win, once capped by the reveal count. */
  effectiveWinners: number;
  /** Per winner, in kelvin. The first winner absorbs the integer remainder. */
  perWinner: number;
  soldOut: boolean;
  /** Ticket indices eligible to be drawn: sold and revealed. */
  eligible: number[];
}

export function summarize(raffle: Raffle): RaffleSummary {
  const { config, tickets, phase } = raffle;

  const soldTickets = tickets.filter((t) => t.holder !== null);
  const revealedTickets = soldTickets.filter((t) => t.nonce !== null);
  const sold = soldTickets.length;
  const revealed = revealedTickets.length;
  const outstanding = sold - revealed;

  // Bonds are only forfeited once reveals have closed. Before that they are merely outstanding.
  const forfeitedCount = phase === "drawn" || phase === "void" ? outstanding : 0;
  const forfeited = phase === "void" ? 0 : forfeitedCount * config.revealBond;

  const pool = config.prize + sold * config.ticketPrice + forfeited;
  const effectiveWinners = Math.min(config.winners, revealed);
  const perWinner = effectiveWinners > 0 ? Math.floor(pool / effectiveWinners) : 0;

  return {
    sold,
    available: config.supply - sold,
    revealed,
    outstanding,
    pool,
    forfeited,
    effectiveWinners,
    perWinner,
    soldOut: sold === config.supply,
    eligible: revealedTickets.map((t) => t.index),
  };
}

/** Kelvin owed to each winning ticket, first winner absorbing the rounding remainder. */
export function payouts(raffle: Raffle): Map<number, number> {
  const { pool, effectiveWinners, perWinner } = summarize(raffle);
  const out = new Map<number, number>();
  if (raffle.winningTickets.length === 0 || effectiveWinners === 0) return out;
  for (const index of raffle.winningTickets) out.set(index, perWinner);
  const remainder = pool - perWinner * effectiveWinners;
  if (remainder > 0) {
    const first = raffle.winningTickets[0];
    out.set(first, (out.get(first) ?? 0) + remainder);
  }
  return out;
}

export function ticketsOf(raffle: Raffle, holder: Address): Ticket[] {
  return raffle.tickets.filter((t) => t.holder === holder);
}

/* ------------------------------------------------------------ transitions */

/**
 * Buy one ticket, publishing a commitment. The caller keeps the nonce; only its hash goes on
 * chain, which is what stops anyone, including the creator, from knowing the seed early.
 */
export function buyTicket(
  raffle: Raffle,
  ticketIndex: number,
  holder: Address,
  nonce: string,
): Raffle {
  if (raffle.phase !== "selling") throw new Error("the sale is closed");
  const ticket = raffle.tickets.find((t) => t.index === ticketIndex);
  if (!ticket) throw new Error(`no ticket ${ticketIndex}`);
  if (ticket.holder) throw new Error(`ticket ${ticketIndex} is already sold`);

  const commitment = commitmentFor(nonce, holder, raffle.config.id, ticketIndex);
  const tickets = raffle.tickets.map((t) =>
    t.index === ticketIndex ? { ...t, holder, commitment } : t,
  );

  // Selling the last ticket closes the sale immediately. On Rialo this is an emitted event
  // topic that a subscription is watching, not a poll.
  const soldOut = tickets.every((t) => t.holder !== null);
  return { ...raffle, tickets, phase: soldOut ? "revealing" : "selling" };
}

/** Close the sale because the commit deadline passed. Absolute-timestamp predicate. */
export function closeSale(raffle: Raffle): Raffle {
  if (raffle.phase !== "selling") return raffle;
  return { ...raffle, phase: "revealing" };
}

/** Reveal a nonce. Rejected unless it hashes to the commitment already on chain. */
export function reveal(raffle: Raffle, ticketIndex: number, nonce: string): Raffle {
  if (raffle.phase !== "revealing") throw new Error("reveals are not open");
  const ticket = raffle.tickets.find((t) => t.index === ticketIndex);
  if (!ticket) throw new Error(`no ticket ${ticketIndex}`);
  if (ticket.nonce) throw new Error(`ticket ${ticketIndex} is already revealed`);
  if (!revealMatches(ticket, raffle.config.id, nonce)) {
    throw new Error(`nonce does not match the commitment on ticket ${ticketIndex}`);
  }

  return {
    ...raffle,
    tickets: raffle.tickets.map((t) => (t.index === ticketIndex ? { ...t, nonce } : t)),
  };
}

/**
 * Fire the draw. On Rialo this is the body of a reactive transaction whose predicate is the
 * absolute reveal deadline, so no bot triggers it.
 *
 * `chainSeed` is injected rather than generated so the draw is reproducible in tests and so the
 * caller decides where it comes from: `get_random_seed()` on chain, the CSPRNG in the browser.
 */
export function drawRaffle(raffle: Raffle, chainSeed: string): Raffle {
  if (raffle.phase !== "revealing") throw new Error("the raffle is not ready to draw");

  const { eligible } = summarize(raffle);
  // No reveals means no seed material, so there is nothing honest to draw from.
  if (eligible.length === 0) {
    return { ...raffle, phase: "void", chainSeed, winningTickets: [] };
  }

  const nonces = raffle.tickets
    .filter((t) => t.nonce !== null)
    .map((t) => t.nonce as string);
  const seed = deriveSeed(raffle.config.id, nonces, chainSeed);
  const winningTickets = deriveWinners(eligible, seed, raffle.config.winners);

  return { ...raffle, phase: "drawn", chainSeed, winningTickets };
}

/** Recompute the seed of a settled raffle from public data alone. */
export function auditSeed(raffle: Raffle): string | null {
  if (!raffle.chainSeed) return null;
  const nonces = raffle.tickets
    .filter((t) => t.nonce !== null)
    .map((t) => t.nonce as string);
  if (nonces.length === 0) return null;
  return deriveSeed(raffle.config.id, nonces, raffle.chainSeed);
}

/**
 * Re-derive the winners of a settled raffle and confirm they match what is recorded. This is
 * the check a participant runs to satisfy themselves the draw was not tampered with.
 */
export function auditWinners(raffle: Raffle): { seed: string; winners: number[]; matches: boolean } | null {
  const seed = auditSeed(raffle);
  if (!seed) return null;
  const { eligible } = summarize(raffle);
  const winners = deriveWinners(eligible, seed, raffle.config.winners);
  const matches =
    winners.length === raffle.winningTickets.length &&
    winners.every((w, i) => w === raffle.winningTickets[i]);
  return { seed, winners, matches };
}

/* --------------------------------------------------------------- activity */

export type ActivityKind = "deployed" | "bought" | "revealed" | "drawn" | "void";

export interface Activity {
  kind: ActivityKind;
  /** ISO instant, so the feed can be ordered and shown as an age. */
  at: string;
  raffleId: number;
  ticketIndex?: number;
  actor?: Address;
  /** Kelvin, on a win. */
  amount?: number;
}

/**
 * The event log, derived from state rather than stored alongside it.
 *
 * On chain this would come from `getSignaturesForAddress` on the raffle account. Deriving it here
 * keeps one source of truth: a feed that can disagree with the board it sits next to is worse than
 * no feed.
 */
export function activityOf(raffle: Raffle): Activity[] {
  const { config, tickets, phase } = raffle;
  const out: Activity[] = [];

  // The sale opens one cadence before it closes; good enough to order the log truthfully.
  out.push({ kind: "deployed", at: earliestOf(raffle), raffleId: config.id });

  for (const ticket of tickets) {
    if (ticket.holder && ticket.boughtAt) {
      out.push({
        kind: "bought",
        at: ticket.boughtAt,
        raffleId: config.id,
        ticketIndex: ticket.index,
        actor: ticket.holder,
      });
    }
    if (ticket.nonce && ticket.revealedAt) {
      out.push({
        kind: "revealed",
        at: ticket.revealedAt,
        raffleId: config.id,
        ticketIndex: ticket.index,
        actor: ticket.holder ?? undefined,
      });
    }
  }

  if (phase === "drawn") {
    const paid = payouts(raffle);
    for (const index of raffle.winningTickets) {
      out.push({
        kind: "drawn",
        at: config.revealDeadline,
        raffleId: config.id,
        ticketIndex: index,
        actor: tickets[index - 1]?.holder ?? undefined,
        amount: paid.get(index),
      });
    }
  }

  if (phase === "void") {
    out.push({ kind: "void", at: config.revealDeadline, raffleId: config.id });
  }

  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

function earliestOf(raffle: Raffle): string {
  const bought = raffle.tickets
    .map((t) => t.boughtAt)
    .filter((at): at is string => typeof at === "string")
    .sort();
  if (bought.length > 0) {
    const first = new Date(bought[0]);
    first.setUTCMinutes(first.getUTCMinutes() - 30);
    return first.toISOString();
  }
  return raffle.config.commitDeadline;
}

/** Coarse age, so a feed reads as a feed without pretending to second precision. */
export function formatAge(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/* ----------------------------------------------------------------- format */

/** RLO with up to 4 decimal places, trailing zeros trimmed. */
export function formatRLO(kelvin: number): string {
  const rlo = kelvin / KELVIN_PER_RLO;
  const text = rlo.toLocaleString("en-US", {
    minimumFractionDigits: rlo < 1 ? 3 : 2,
    maximumFractionDigits: 4,
  });
  return text;
}

/** Shorten an address for a dense column, keeping both ends. */
export function shortAddress(address: Address, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** First 8 hex characters of a digest, for showing a commitment in a table. */
export function shortDigest(hex: string): string {
  return hex.slice(0, 8);
}

/** Whole seconds between two instants, never negative. */
export function secondsBetween(fromISO: string | Date, toISO: string): number {
  const from = typeof fromISO === "string" ? Date.parse(fromISO) : fromISO.getTime();
  return Math.max(0, Math.round((Date.parse(toISO) - from) / 1000));
}

/** Coarse "2d 4h" / "3h 12m" / "45s" countdown. */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "closed";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
