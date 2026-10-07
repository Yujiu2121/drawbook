/**
 * The Drawbook raffle program as the browser sees it: its account layout, its hashes, its
 * instructions and its error codes, all from program/SPEC.md, which is the contract between this
 * file and the Rust program. Pure and synchronous; nothing here touches the network.
 *
 * The draw itself is not reimplemented. `auditDraw` recomputes the seed from the nonces stored on
 * chain and runs `deriveWinners` from lib/raffle.ts over the revealed tickets, which is the same
 * keystream and the same ordered removal the program runs, then compares the result with what the
 * program wrote. Any difference means the recorded draw is not the one the public data produces.
 */

import { decodeBase58, encodeBase58 } from "../base58.ts";
import { deriveWinners } from "../raffle.ts";
import { concat, fromHex, sha256, toHex, utf8 } from "../sha256.ts";
import type { Instruction } from "./tx.ts";

export const PROGRAM_ID = "74LNM1Hn6BCQpHyzHYkqrQP4H6N1At3CsiZ6CH4UsMG6";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

export const HEADER_LEN = 208;
export const TICKET_LEN = 84;
export const MIN_SUPPLY = 2;
export const MAX_SUPPLY = 200;
export const NONCE_LEN = 16;
export const TITLE_LEN = 32;

/** "DRWBOOK1": a raffle account starts with these eight bytes once Create has run. */
const MAGIC = utf8("DRWBOOK1");

export const TAG = { create: 0, buy: 1, reveal: 2, draw: 3, claim: 4 } as const;

export type ChainStatus = "open" | "drawn" | "void";
export type ChainPhase = "selling" | "revealing" | "ready" | "drawn" | "void";

export interface ChainTicket {
  index: number;
  holder: string | null;
  commitment: string | null;
  nonce: string | null;
  revealed: boolean;
  won: boolean;
  paid: boolean;
  winRank: number;
}

export interface ChainRaffle {
  address: string;
  status: ChainStatus;
  supply: number;
  winners: number;
  sold: number;
  revealed: number;
  effectiveWinners: number;
  creator: string;
  prize: bigint;
  ticketPrice: bigint;
  revealBond: bigint;
  commitDeadline: number;
  revealDeadline: number;
  createdAt: number;
  drawnAt: number;
  chainSeed: bigint;
  seed: string | null;
  pool: bigint;
  perWinner: bigint;
  creatorRefunded: boolean;
  title: string;
  tickets: ChainTicket[];
  kelvins: bigint;
}

const FLAG_REVEALED = 1;
const FLAG_WON = 2;
const FLAG_PAID = 4;

/** Bytes a raffle account of `supply` tickets occupies. */
export function accountLength(supply: number): number {
  return HEADER_LEN + TICKET_LEN * supply;
}

/* ----------------------------------------------------------------- decode */

const isZero = (bytes: Uint8Array) => bytes.every((b) => b === 0);

/**
 * Read a raffle account. Throws when the bytes are not an initialised raffle, so a caller listing
 * every account the program owns can skip anything that is not one.
 */
export function decodeRaffle(address: string, data: Uint8Array, kelvins: bigint): ChainRaffle {
  if (data.length < HEADER_LEN) throw new Error(`raffle account too short: ${data.length} bytes`);
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (data[i] !== MAGIC[i]) throw new Error("not an initialised raffle account");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u64 = (at: number) => view.getBigUint64(at, true);
  const ms = (at: number) => Number(view.getBigUint64(at, true));

  const supply = u16(10);
  if (supply < MIN_SUPPLY || supply > MAX_SUPPLY) throw new Error(`raffle supply out of range: ${supply}`);
  if (data.length < accountLength(supply)) throw new Error("raffle account shorter than its supply");

  const statusByte = data[9];
  const status: ChainStatus = statusByte === 1 ? "drawn" : statusByte === 2 ? "void" : "open";

  const seedBytes = data.subarray(120, 152);
  const titleBytes = data.subarray(176, 208);
  let titleEnd = titleBytes.length;
  while (titleEnd > 0 && titleBytes[titleEnd - 1] === 0) titleEnd -= 1;

  const tickets: ChainTicket[] = [];
  for (let i = 0; i < supply; i += 1) {
    const at = HEADER_LEN + TICKET_LEN * i;
    const holder = data.subarray(at, at + 32);
    const commitment = data.subarray(at + 32, at + 64);
    const nonce = data.subarray(at + 64, at + 80);
    const flags = data[at + 80];
    const sold = !isZero(holder);
    const revealed = (flags & FLAG_REVEALED) !== 0;
    tickets.push({
      index: i + 1,
      holder: sold ? encodeBase58(holder) : null,
      commitment: sold ? toHex(commitment) : null,
      nonce: revealed ? toHex(nonce) : null,
      revealed,
      won: (flags & FLAG_WON) !== 0,
      paid: (flags & FLAG_PAID) !== 0,
      winRank: u16(at + 82),
    });
  }

  return {
    address,
    status,
    supply,
    winners: u16(12),
    sold: u16(14),
    revealed: u16(16),
    effectiveWinners: u16(18),
    creator: encodeBase58(data.subarray(24, 56)),
    prize: u64(56),
    ticketPrice: u64(64),
    revealBond: u64(72),
    commitDeadline: ms(80),
    revealDeadline: ms(88),
    createdAt: ms(96),
    drawnAt: ms(104),
    chainSeed: u64(112),
    seed: isZero(seedBytes) ? null : toHex(seedBytes),
    pool: u64(152),
    perWinner: u64(160),
    creatorRefunded: data[168] !== 0,
    title: new TextDecoder().decode(titleBytes.subarray(0, titleEnd)),
    tickets,
    kelvins,
  };
}

/* ------------------------------------------------------------------ phase */

/** Whether tickets can no longer be bought: past the commit deadline, or sold out. */
export function saleClosed(r: ChainRaffle, nowMs: number): boolean {
  return nowMs >= r.commitDeadline || r.sold >= r.supply;
}

/**
 * Where the raffle stands at `nowMs`, by the same rules the program applies. "ready" means Draw
 * would succeed now: reveals have closed, or the sale is closed and every sold ticket is revealed,
 * which also covers a raffle that sold nothing.
 */
export function phaseOf(r: ChainRaffle, nowMs: number): ChainPhase {
  if (r.status === "drawn") return "drawn";
  if (r.status === "void") return "void";
  if (!saleClosed(r, nowMs)) return "selling";
  if (nowMs >= r.revealDeadline || r.revealed === r.sold) return "ready";
  return "revealing";
}

/* ----------------------------------------------------------------- hashes */

function fixedHex(hex: string, length: number, what: string): Uint8Array {
  const bytes = fromHex(hex);
  if (bytes.length !== length) throw new Error(`${what} must be ${length} bytes, got ${bytes.length}`);
  return bytes;
}

function addressBytes(address: string): Uint8Array {
  const bytes = decodeBase58(address);
  if (bytes.length !== 32) throw new Error(`not an address: ${address}`);
  return bytes;
}

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

/** The largest u64, the most any amount or time on chain can be. */
export const U64_MAX = BigInt("18446744073709551615");

/**
 * A u64, little-endian. Out of range is an error rather than a wrap: setBigUint64 silently keeps
 * the low 64 bits, so 2^64 + 1 kelvin would go on chain as 1 kelvin.
 */
function u64le(n: bigint): Uint8Array {
  if (n < BigInt(0) || n > U64_MAX) throw new RangeError(`u64 out of range: ${n}`);
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

/**
 * The program's own fits rule for Create: everything the raffle could ever hold, every ticket sold
 * with its bond plus the prize, must fit in a u64. Mirrored here so a form can refuse it in words
 * before the program refuses it with BadConfig.
 */
export function createFits(p: { prize: bigint; ticketPrice: bigint; revealBond: bigint; supply: number }): boolean {
  if (p.prize < BigInt(0) || p.ticketPrice < BigInt(0) || p.revealBond < BigInt(0)) return false;
  return (p.ticketPrice + p.revealBond) * BigInt(p.supply) + p.prize <= U64_MAX;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/**
 * The commitment a buyer sends with Buy, as lowercase hex. It binds the nonce to this raffle
 * account, this ticket and this holder, so it cannot be lifted onto another ticket.
 */
export function commitmentV2(raffle: string, ticketIndex: number, holder: string, nonceHex: string): string {
  return toHex(
    sha256(
      concat(
        utf8("drawbook-v2|commit|"),
        addressBytes(raffle),
        u16le(ticketIndex),
        addressBytes(holder),
        fixedHex(nonceHex, NONCE_LEN, "nonce"),
      ),
    ),
  );
}

/**
 * The draw seed, as lowercase hex. Nonces are sorted bytewise first, so the order in which holders
 * revealed cannot change it, and the chain's value goes last, big-endian, as the program writes it.
 */
export function seedV2(raffle: string, nonceHexes: string[], chainSeed: bigint): string {
  const nonces = nonceHexes.map((n) => fixedHex(n, NONCE_LEN, "nonce")).sort(compareBytes);
  const chain = new Uint8Array(8);
  new DataView(chain.buffer).setBigUint64(0, chainSeed, false);
  return toHex(sha256(concat(utf8("drawbook-v2|seed|"), addressBytes(raffle), ...nonces, chain)));
}

/**
 * Re-derive a drawn raffle's seed and winners from the chain's own public data, and compare them
 * with what the program recorded: the stored seed, and the tickets marked won in `win_rank` order.
 * Null until the raffle is drawn, because before that there is nothing recorded to check.
 */
export function auditDraw(r: ChainRaffle): { seed: string; winners: number[]; matches: boolean } | null {
  if (r.status !== "drawn") return null;

  const revealedTickets = r.tickets.filter((t) => t.revealed && t.nonce !== null);
  const eligible = revealedTickets.map((t) => t.index).sort((a, b) => a - b);
  const seed = seedV2(
    r.address,
    revealedTickets.map((t) => t.nonce as string),
    r.chainSeed,
  );
  const expectedCount = Math.min(r.winners, eligible.length);
  const winners = deriveWinners(eligible, seed, expectedCount);

  // What the program wrote: every ticket flagged won, ordered by the rank it was drawn at.
  const recorded = r.tickets.filter((t) => t.won).sort((a, b) => a.winRank - b.winRank);
  const ranksAreOneToN = recorded.every((t, i) => t.winRank === i + 1);
  const unflaggedRanks = r.tickets.some((t) => !t.won && t.winRank !== 0);

  const matches =
    r.seed === seed &&
    eligible.length === r.revealed &&
    r.effectiveWinners === expectedCount &&
    recorded.length === winners.length &&
    ranksAreOneToN &&
    !unflaggedRanks &&
    recorded.every((t, i) => t.index === winners[i]);

  return { seed, winners, matches };
}

/* ---------------------------------------------------------------- payouts */

/** The integer remainder of the pool, which the first winner drawn also receives. */
function remainder(r: ChainRaffle): bigint {
  return r.pool - r.perWinner * BigInt(r.effectiveWinners);
}

/**
 * What Claim would pay for `ticketIndex` right now, in kelvin; 0 when it would be refused. Index 0
 * is the creator's prize refund on a void raffle.
 */
export function payoutOf(r: ChainRaffle, ticketIndex: number): bigint {
  if (r.status === "open") return BigInt(0);

  if (r.status === "void" && ticketIndex === 0) {
    return r.creatorRefunded ? BigInt(0) : r.prize;
  }

  const ticket = r.tickets[ticketIndex - 1];
  if (!ticket || ticket.holder === null || ticket.paid) return BigInt(0);

  if (r.status === "void") return r.ticketPrice + r.revealBond;
  if (!ticket.won) return BigInt(0);
  return r.perWinner + (ticket.winRank === 1 ? remainder(r) : BigInt(0));
}

/**
 * Every Claim `address` could push right now, as ticket indices, with 0 standing for the creator's
 * prize refund on a void raffle. Entitlements that would pay nothing are left out, so an empty list
 * means there is genuinely nothing to collect.
 */
export function claimableIndices(r: ChainRaffle, address: string): number[] {
  const out: number[] = [];
  if (r.status === "void" && r.creator === address && payoutOf(r, 0) > BigInt(0)) out.push(0);
  for (const t of r.tickets) {
    if (t.holder === address && payoutOf(r, t.index) > BigInt(0)) out.push(t.index);
  }
  return out;
}

/* ----------------------------------------------------------------- errors */

const ERRORS: Record<number, string> = {
  1: "The program did not recognise that instruction.",
  2: "An account in the transaction was wrong: wrong owner, wrong size, or a missing signature.",
  3: "That raffle account is already in use.",
  4: "That account is not a raffle.",
  5: "Those raffle settings are out of range: check the supply, winners, ticket price and deadlines.",
  6: "The sale is closed: the deadline passed or every ticket is sold.",
  7: "Someone bought that ticket first. Try again for the next one.",
  8: "Reveals open once the sale closes.",
  9: "The reveal window has closed.",
  10: "Only the ticket's holder, or the raffle's creator, can do that.",
  11: "That ticket is already revealed.",
  12: "The secret does not match the commitment made at purchase.",
  13: "The draw is not ready yet: reveals are still open.",
  14: "This raffle is already settled.",
  15: "There is nothing to claim for that ticket.",
  16: "The amounts do not add up: an account would go below zero.",
  17: "The draw has to be the only instruction in its transaction, sent directly.",
  18: "The last reveal landed in this same block. The draw waits one block; try again.",
};

/** The program's refusal in plain English. */
export function errorMessage(code: number): string {
  return ERRORS[code] ?? `The raffle program refused the transaction (error ${code}).`;
}

/* ----------------------------------------------------------- instructions */

const programKey = () => decodeBase58(PROGRAM_ID);
/** The instructions sysvar. Draw reads it to prove it runs alone in its transaction. */
export const INSTRUCTIONS_SYSVAR_ID = "Sysvar1nstructions1111111111111111111111111";
const instructionsSysvarKey = () => decodeBase58(INSTRUCTIONS_SYSVAR_ID);
const systemKey = () => decodeBase58(SYSTEM_PROGRAM_ID);

/**
 * A title as the 32 bytes the account stores: UTF-8, zero padded, cut at a character boundary so a
 * long title never ends in half a character.
 */
export function encodeTitle(title: string): Uint8Array {
  const raw = utf8(title);
  let end = Math.min(raw.length, TITLE_LEN);
  // A continuation byte (10xxxxxx) at the cut means the character started before it.
  if (end < raw.length) while (end > 0 && (raw[end] & 0xc0) === 0x80) end -= 1;
  const out = new Uint8Array(TITLE_LEN);
  out.set(raw.subarray(0, end));
  return out;
}

export interface CreateParams {
  title: string;
  prize: bigint;
  ticketPrice: bigint;
  revealBond: bigint;
  supply: number;
  winners: number;
  commitDeadline: number;
  revealDeadline: number;
}

/** Create, 77 bytes. */
export function encodeCreate(p: CreateParams): Uint8Array {
  return concat(
    new Uint8Array([TAG.create]),
    u64le(p.prize),
    u64le(p.ticketPrice),
    u64le(p.revealBond),
    u16le(p.supply),
    u16le(p.winners),
    u64le(BigInt(p.commitDeadline)),
    u64le(BigInt(p.revealDeadline)),
    encodeTitle(p.title),
  );
}

/** Buy, 35 bytes. */
export function encodeBuy(ticketIndex: number, commitmentHex: string): Uint8Array {
  return concat(new Uint8Array([TAG.buy]), u16le(ticketIndex), fixedHex(commitmentHex, 32, "commitment"));
}

/** Reveal, 19 bytes. */
export function encodeReveal(ticketIndex: number, nonceHex: string): Uint8Array {
  return concat(new Uint8Array([TAG.reveal]), u16le(ticketIndex), fixedHex(nonceHex, NONCE_LEN, "nonce"));
}

/** Draw, 1 byte. */
export function encodeDraw(): Uint8Array {
  return new Uint8Array([TAG.draw]);
}

/** Claim, 3 bytes. */
export function encodeClaim(ticketIndex: number): Uint8Array {
  return concat(new Uint8Array([TAG.claim]), u16le(ticketIndex));
}

/** System CreateAccount: u32 tag 0, kelvins u64, space u64, owner, 52 bytes in all. */
export function encodeSystemCreateAccount(kelvins: bigint, space: number, owner: Uint8Array): Uint8Array {
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, 0, true);
  return concat(tag, u64le(kelvins), u64le(BigInt(space)), owner);
}

export function systemCreateAccountIx(
  from: Uint8Array,
  newAccount: Uint8Array,
  kelvins: bigint,
  space: number,
  owner: Uint8Array,
): Instruction {
  return {
    programId: systemKey(),
    accounts: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: newAccount, isSigner: true, isWritable: true },
    ],
    data: encodeSystemCreateAccount(kelvins, space, owner),
  };
}

export function createIx(creator: Uint8Array, raffle: Uint8Array, p: CreateParams): Instruction {
  return {
    programId: programKey(),
    accounts: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: raffle, isSigner: false, isWritable: true },
      { pubkey: systemKey(), isSigner: false, isWritable: false },
    ],
    data: encodeCreate(p),
  };
}

export function buyIx(buyer: Uint8Array, raffle: Uint8Array, ticketIndex: number, commitmentHex: string): Instruction {
  return {
    programId: programKey(),
    accounts: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: raffle, isSigner: false, isWritable: true },
      { pubkey: systemKey(), isSigner: false, isWritable: false },
    ],
    data: encodeBuy(ticketIndex, commitmentHex),
  };
}

export function revealIx(holder: Uint8Array, raffle: Uint8Array, ticketIndex: number, nonceHex: string): Instruction {
  return {
    programId: programKey(),
    accounts: [
      { pubkey: holder, isSigner: true, isWritable: true },
      { pubkey: raffle, isSigner: false, isWritable: true },
    ],
    data: encodeReveal(ticketIndex, nonceHex),
  };
}

export function drawIx(caller: Uint8Array, raffle: Uint8Array): Instruction {
  return {
    programId: programKey(),
    accounts: [
      { pubkey: caller, isSigner: true, isWritable: false },
      { pubkey: raffle, isSigner: false, isWritable: true },
      { pubkey: instructionsSysvarKey(), isSigner: false, isWritable: false },
    ],
    data: encodeDraw(),
  };
}

export function claimIx(raffle: Uint8Array, recipient: Uint8Array, ticketIndex: number): Instruction {
  return {
    programId: programKey(),
    accounts: [
      { pubkey: raffle, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
    ],
    data: encodeClaim(ticketIndex),
  };
}
