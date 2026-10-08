/**
 * THE SCHEDULED DRAW: Rialo's Subscriber program, asked to send Draw once reveals have closed.
 *
 * Rialo has a native program, `Subscriber111…`, that holds subscriptions: a predicate (a topic, an
 * event account, a time window) and the instructions to run when an event matches it. The clock is
 * an event like any other, so a OneShot subscription on topic "clock" with a time window that opens
 * at `reveal_deadline + 5 s` and holds the raffle's own Draw instruction is a draw that arrives by
 * itself. The node builds that transaction with the subscriber (the creator) as the only signer and
 * fee payer, so it is byte for byte the solitary Draw the creator could have sent by hand, and the
 * raffle program's guards (codes 17 and 18) pass without any change to the program.
 *
 * WHY NOT `subscribe_to` FROM THE OFFICIAL CRATE. It appends a Subscriber Destroy to every OneShot's
 * instructions, so the triggered transaction would be [Draw, Destroy], and Draw refuses with 17
 * because it is no longer alone. That was run on a local network on 2026-10-08: the draw was
 * refused, the transaction rolled back, the OneShot was spent and never retried. So the Subscribe
 * instruction is encoded here from `SubscriberInstruction::Subscribe` directly, with no Destroy. The
 * cost is that the subscription account outlives its firing and keeps its rent until the creator
 * reclaims it (Destroy, then Unsubscribe), which the raffle page offers once the raffle is settled.
 *
 * THE BYTES ARE LEGACY BINCODE (1.3.3), not borsh: a u32 little-endian variant tag, then the fields,
 * every integer little-endian, every Vec and String a u64 length then its items, every Option a u8
 * flag then the value. scripts/verify-chain.ts freezes the output against bytes produced by the
 * official rialo-subscriber-interface 0.21.0-alpha.0 crate and against a transaction the Rialo CLI
 * sent, so a change here that drifts from either fails offline. program/SPEC.md has the layout.
 *
 * WHAT IS NOT PUBLISHED. The Subscriber program and the node's matcher are closed source. That a
 * OneShot without the Destroy is accepted and fires exactly once is observed behaviour of the
 * 0.21.0-alpha.0 build, not a documented promise, which is why the page keeps Draw as a button and
 * never says the draw is guaranteed.
 *
 * Pure and synchronous, like program.ts: nothing here touches the network.
 */

import { decodeBase58, encodeBase58 } from "../base58.ts";
import { concat, sha256, utf8 } from "../sha256.ts";
import {
  drawIx,
  errorMessage,
  INSTRUCTIONS_SYSVAR_ID,
  PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  U64_MAX,
  type ChainRaffle,
} from "./program.ts";
import { customErrorCode, failureText, type AccountMeta, type Instruction } from "./tx.ts";

export const SUBSCRIBER_PROGRAM_ID = "Subscriber111111111111111111111111111111111";
export const CLOCK_SYSVAR_ID = "SysvarC1ock11111111111111111111111111111111";
/** `rialo_events_core::types::CLOCK_TOPIC`: the clock emits an event on this topic every block. */
export const CLOCK_TOPIC = "clock";
/** The PDA seed the Subscriber program derives a subscription account from. */
export const SUBSCRIBE_SEED = "rialo_subscribe";

/**
 * How long after the reveal deadline the draw is scheduled. A triggered transaction reads a clock
 * about one block behind the block time that matched it: across six local firings Draw saw a time
 * 41 to 102 ms BEFORE the window opened, so a window opening exactly at the deadline was refused
 * with NotReady (13) and, being a OneShot, never retried. One second worked and so did three; five
 * covers a stall of about forty testnet blocks for the price of a five-second wait.
 */
export const DRAW_MARGIN_MS = 5000;

/** What the node charged the subscriber for each firing, success or not (local and devnet, 2026-10-08). */
export const FIRING_FEE = BigInt(5000);

/**
 * How long past the scheduled time the page waits for the triggered Draw before calling it late
 * and offering the button again. Firings were seen about half a second after the window opened;
 * thirty seconds is a margin for a slow node, not an expectation.
 */
export const DUE_WINDOW_MS = 30_000;

const ZERO = BigInt(0);
const ONE = BigInt(1);

/* ----------------------------------------------------------- the PDA */

/*
  Edwards25519 arithmetic, only as much as the on-curve test needs. A program-derived address is a
  hash that is NOT a point on the curve, so no private key can exist for it; finding one means
  trying bumps from 255 down until the hash fails to decompress. BigInt arithmetic is slow next to
  a curve library, but this runs a handful of times per page and each try is well under a
  millisecond, so it is not worth a dependency.
*/
const P = (ONE << BigInt(255)) - BigInt(19);
const modP = (a: bigint) => ((a % P) + P) % P;

function powMod(base: bigint, exponent: bigint): bigint {
  let result = ONE;
  let b = modP(base);
  let e = exponent;
  while (e > ZERO) {
    if ((e & ONE) === ONE) result = (result * b) % P;
    b = (b * b) % P;
    e >>= ONE;
  }
  return result;
}

/** The curve constant d = -121665 / 121666. */
const D = modP(-BigInt(121665) * powMod(BigInt(121666), P - BigInt(2)));

/**
 * Whether 32 bytes decompress to a point on Edwards25519, as curve25519-dalek's
 * `CompressedEdwardsY::decompress().is_some()` decides it: y is the low 255 bits reduced mod p (the
 * sign bit is ignored, as dalek ignores it when deciding validity), and the point exists when
 * x² = (y² - 1) / (d·y² + 1) has a square root. x² = 0 is a square. d·y² + 1 is never 0 because d
 * is not a square.
 */
export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) throw new Error("a curve point is 32 bytes");
  let y = ZERO;
  for (let i = 31; i >= 0; i -= 1) {
    y = (y << BigInt(8)) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  }
  y = modP(y);
  const y2 = (y * y) % P;
  const u = modP(y2 - ONE);
  const v = modP(D * y2 + ONE);
  const x2 = (u * powMod(v, P - BigInt(2))) % P;
  if (x2 === ZERO) return true;
  // Euler's criterion: a non-zero x² is a square exactly when x²^((p-1)/2) is 1.
  return powMod(x2, (P - ONE) >> ONE) === ONE;
}

/**
 * `Pubkey::find_program_address`: the first bump from 255 down whose
 * sha256(seeds ‖ bump ‖ program id ‖ "ProgramDerivedAddress") is off the curve.
 */
export function findProgramAddress(seeds: Uint8Array[], programId: Uint8Array): [Uint8Array, number] {
  for (const seed of seeds) {
    if (seed.length > 32) throw new Error("a PDA seed is at most 32 bytes");
  }
  const marker = utf8("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump -= 1) {
    const candidate = sha256(concat(...seeds, new Uint8Array([bump]), programId, marker));
    if (!isOnCurve(candidate)) return [candidate, bump];
  }
  throw new Error("no program address found for these seeds");
}

/**
 * The nonce that names a raffle's schedule: the UTF-8 bytes of the first 32 characters of the
 * raffle's base58 address. It is unique per raffle, anyone can derive it from the raffle alone, and
 * it is exactly what the node makes of the same 32-character string in `getSubscription`
 * (`Nonce::from(&str)`, raw bytes, zero padded up to 32). A 32-byte key never encodes to fewer than
 * 32 characters, so the padding never happens in practice; it is kept to match the node exactly.
 */
export function scheduleNonceText(raffle: string): string {
  return raffle.slice(0, 32);
}

export function scheduleNonce(raffle: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(utf8(scheduleNonceText(raffle)).subarray(0, 32));
  return out;
}

function key(address: string): Uint8Array {
  const bytes = decodeBase58(address);
  if (bytes.length !== 32) throw new Error(`not an address: ${address}`);
  return bytes;
}

/** The subscription account: PDA ["rialo_subscribe", creator, nonce] of the Subscriber program. */
export function scheduleAddressBytes(creator: Uint8Array, raffle: string): Uint8Array {
  return findProgramAddress([utf8(SUBSCRIBE_SEED), creator, scheduleNonce(raffle)], key(SUBSCRIBER_PROGRAM_ID))[0];
}

export function scheduleAddress(creator: string, raffle: string): string {
  return encodeBase58(scheduleAddressBytes(key(creator), raffle));
}

/* ----------------------------------------------------------- bincode */

export type SubscriptionKind = "Persistent" | "OneShot";

/** `rialo_subscriber_interface::instruction::Subscription`, field for field. */
export interface Subscription {
  subscriber: Uint8Array;
  topic: string;
  eventAccount: Uint8Array | null;
  /** Milliseconds, start inclusive, end exclusive. */
  timestampRange: [bigint, bigint] | null;
  instructions: Instruction[];
  kind: SubscriptionKind;
  /** Inclusive commit range. The node rebases it to the commit the Subscribe ran in. */
  activeCommits: [bigint, bigint];
}

class Writer {
  parts: Uint8Array[] = [];

  bytes(b: Uint8Array) {
    this.parts.push(b);
  }

  u8(n: number) {
    this.parts.push(new Uint8Array([n]));
  }

  u32(n: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    this.parts.push(b);
  }

  u64(n: bigint) {
    if (n < ZERO || n > U64_MAX) throw new RangeError(`u64 out of range: ${n}`);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    this.parts.push(b);
  }

  key(k: Uint8Array) {
    if (k.length !== 32) throw new Error("public keys are 32 bytes");
    this.parts.push(k);
  }

  done(): Uint8Array {
    return concat(...this.parts);
  }
}

function writeSubscription(w: Writer, s: Subscription) {
  w.key(s.subscriber);
  const topic = utf8(s.topic);
  w.u64(BigInt(topic.length));
  w.bytes(topic);
  if (s.eventAccount) {
    w.u8(1);
    w.key(s.eventAccount);
  } else {
    w.u8(0);
  }
  if (s.timestampRange) {
    w.u8(1);
    w.u64(s.timestampRange[0]);
    w.u64(s.timestampRange[1]);
  } else {
    w.u8(0);
  }
  w.u64(BigInt(s.instructions.length));
  for (const ix of s.instructions) {
    w.key(ix.programId);
    w.u64(BigInt(ix.accounts.length));
    for (const meta of ix.accounts) {
      w.key(meta.pubkey);
      w.u8(meta.isSigner ? 1 : 0);
      w.u8(meta.isWritable ? 1 : 0);
    }
    w.u64(BigInt(ix.data.length));
    w.bytes(ix.data);
  }
  w.u32(s.kind === "OneShot" ? 1 : 0);
  w.u64(s.activeCommits[0]);
  w.u64(s.activeCommits[1]);
}

/** A Subscription as the bytes the subscription account stores, with no header. */
export function encodeSubscription(s: Subscription): Uint8Array {
  const w = new Writer();
  writeSubscription(w, s);
  return w.done();
}

/** `SubscriberInstruction::Subscribe { nonce, handler }`: u32 0 ‖ nonce[32] ‖ Subscription. */
export function encodeSubscribe(nonce: Uint8Array, s: Subscription): Uint8Array {
  if (nonce.length !== 32) throw new Error("a nonce is 32 bytes");
  const w = new Writer();
  w.u32(0);
  w.bytes(nonce);
  writeSubscription(w, s);
  return w.done();
}

/** `SubscriberInstruction::Unsubscribe { nonce }`: u32 1 ‖ nonce[32]. */
export function encodeUnsubscribe(nonce: Uint8Array): Uint8Array {
  if (nonce.length !== 32) throw new Error("a nonce is 32 bytes");
  const w = new Writer();
  w.u32(1);
  w.bytes(nonce);
  return w.done();
}

/** `SubscriberInstruction::Destroy { nonce }`: u32 3 ‖ nonce[32]. */
export function encodeDestroy(nonce: Uint8Array): Uint8Array {
  if (nonce.length !== 32) throw new Error("a nonce is 32 bytes");
  const w = new Writer();
  w.u32(3);
  w.bytes(nonce);
  return w.done();
}

/*
  Limits for decoding bytes nobody here wrote. A subscription account belongs to whoever created
  it, so the reader refuses lengths that could not be honest rather than allocating whatever a
  length field claims.
*/
const MAX_TOPIC = 1024;
const MAX_INSTRUCTIONS = 64;
const MAX_ACCOUNTS = 256;
const MAX_DATA = 65_536;

/**
 * Read a subscription account's bytes. Throws on anything that is not exactly one Subscription,
 * trailing bytes included, so a page never describes bytes it only half understood.
 */
export function decodeSubscription(data: Uint8Array): Subscription {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 0;
  const need = (n: number) => {
    if (at + n > data.length) throw new Error("subscription data ends early");
  };
  const take = (n: number) => {
    need(n);
    const out = data.slice(at, at + n);
    at += n;
    return out;
  };
  const u8 = () => {
    need(1);
    return data[at++];
  };
  const u32 = () => {
    need(4);
    const v = view.getUint32(at, true);
    at += 4;
    return v;
  };
  const u64 = () => {
    need(8);
    const v = view.getBigUint64(at, true);
    at += 8;
    return v;
  };
  const length = (max: number, what: string) => {
    const n = u64();
    if (n > BigInt(max)) throw new Error(`${what} length ${n} is past ${max}`);
    return Number(n);
  };
  const flag = () => {
    const f = u8();
    if (f > 1) throw new Error(`option flag ${f}`);
    return f === 1;
  };

  const subscriber = take(32);
  const topic = new TextDecoder("utf-8", { fatal: true }).decode(take(length(MAX_TOPIC, "topic")));
  const eventAccount = flag() ? take(32) : null;
  const timestampRange: [bigint, bigint] | null = flag() ? [u64(), u64()] : null;
  const count = length(MAX_INSTRUCTIONS, "instruction list");
  const instructions: Instruction[] = [];
  for (let i = 0; i < count; i += 1) {
    const programId = take(32);
    const n = length(MAX_ACCOUNTS, "account list");
    const accounts: AccountMeta[] = [];
    for (let j = 0; j < n; j += 1) {
      const pubkey = take(32);
      const isSigner = u8();
      const isWritable = u8();
      if (isSigner > 1 || isWritable > 1) throw new Error("account flags are 0 or 1");
      accounts.push({ pubkey, isSigner: isSigner === 1, isWritable: isWritable === 1 });
    }
    instructions.push({ programId, accounts, data: take(length(MAX_DATA, "instruction data")) });
  }
  const kindTag = u32();
  if (kindTag > 1) throw new Error(`subscription kind ${kindTag}`);
  const activeCommits: [bigint, bigint] = [u64(), u64()];
  if (at !== data.length) throw new Error(`${data.length - at} bytes after the subscription`);

  return {
    subscriber,
    topic,
    eventAccount,
    timestampRange,
    instructions,
    kind: kindTag === 1 ? "OneShot" : "Persistent",
    activeCommits,
  };
}

/* ------------------------------------------------- Drawbook's schedule */

/** When the scheduled Draw is due for a raffle whose reveals close at `revealDeadline`. */
export function drawAt(revealDeadline: number): number {
  return revealDeadline + DRAW_MARGIN_MS;
}

/**
 * The one subscription Drawbook asks for: OneShot, topic "clock" on the clock sysvar, a window from
 * the reveal deadline plus the margin to the end of time (end exclusive, so it cannot expire before
 * a deadline up to the program's 38-day ceiling), active for every commit, and exactly one
 * instruction: the raffle's own Draw, signed by the creator, as `drawIx` writes it for a person.
 */
export function drawSchedule(creator: Uint8Array, raffle: Uint8Array, revealDeadline: number): Subscription {
  return {
    subscriber: creator,
    topic: CLOCK_TOPIC,
    eventAccount: key(CLOCK_SYSVAR_ID),
    timestampRange: [BigInt(drawAt(revealDeadline)), U64_MAX],
    instructions: [drawIx(creator, raffle)],
    kind: "OneShot",
    activeCommits: [ZERO, U64_MAX],
  };
}

/** Bytes a Drawbook schedule account holds: 274. Computed from the encoding, never written down. */
export const SCHEDULE_LEN = encodeSubscription(drawSchedule(new Uint8Array(32), new Uint8Array(32), 0)).length;

/**
 * Subscribe, sent by the creator in the Create transaction. Accounts: the creator (signer, writable,
 * pays the account's rent), the subscription account (writable), the System program.
 */
export function subscribeDrawIx(creator: Uint8Array, raffle: string, revealDeadline: number): Instruction {
  return {
    programId: key(SUBSCRIBER_PROGRAM_ID),
    accounts: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: scheduleAddressBytes(creator, raffle), isSigner: false, isWritable: true },
      { pubkey: key(SYSTEM_PROGRAM_ID), isSigner: false, isWritable: false },
    ],
    data: encodeSubscribe(scheduleNonce(raffle), drawSchedule(creator, key(raffle), revealDeadline)),
  };
}

/**
 * Destroy, sent by the creator to move the subscription account's rent back to themselves. It does
 * NOT take the subscription out of the node's matcher: on the local network on 2026-10-08 a OneShot
 * whose account had been destroyed still fired at its time. See `reclaimScheduleIxs`.
 */
export function destroyScheduleIx(creator: Uint8Array, raffle: string): Instruction {
  return {
    programId: key(SUBSCRIBER_PROGRAM_ID),
    accounts: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: scheduleAddressBytes(creator, raffle), isSigner: false, isWritable: true },
    ],
    data: encodeDestroy(scheduleNonce(raffle)),
  };
}

/**
 * Unsubscribe: the instruction whose log line (`rialo_unsubscribe::<account>`) tells the node's
 * matcher to drop the subscription, which it does only once the account holds zero kelvin.
 */
export function unsubscribeScheduleIx(creator: Uint8Array, raffle: string): Instruction {
  return {
    programId: key(SUBSCRIBER_PROGRAM_ID),
    accounts: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: scheduleAddressBytes(creator, raffle), isSigner: false, isWritable: true },
    ],
    data: encodeUnsubscribe(scheduleNonce(raffle)),
  };
}

/**
 * Reclaiming a schedule: Destroy, which returns the rent, then Unsubscribe, which finds the account
 * empty and has the matcher drop the subscription, in one transaction. Run on the local network on
 * 2026-10-08: before the time it returned the deposit and nothing fired; after a firing it returned
 * the deposit just the same. Destroy alone returned the deposit but the Draw still fired, at the
 * creator's expense, and was turned away as already settled.
 */
export function reclaimScheduleIxs(creator: Uint8Array, raffle: string): Instruction[] {
  return [destroyScheduleIx(creator, raffle), unsubscribeScheduleIx(creator, raffle)];
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function sameInstruction(a: Instruction, b: Instruction): boolean {
  return (
    sameBytes(a.programId, b.programId) &&
    sameBytes(a.data, b.data) &&
    a.accounts.length === b.accounts.length &&
    a.accounts.every(
      (m, i) =>
        sameBytes(m.pubkey, b.accounts[i].pubkey) &&
        m.isSigner === b.accounts[i].isSigner &&
        m.isWritable === b.accounts[i].isWritable,
    )
  );
}

/**
 * Whether a subscription is exactly the schedule Drawbook makes for this raffle, and so one the page
 * may call "scheduled". The creator alone controls the subscription account and can Update it into
 * anything, so nothing short of the exact form is accepted: subscribed by the creator, OneShot,
 * topic "clock" on the clock sysvar, a window opening at or after the reveal deadline and never
 * closing, never-expiring commits, and one instruction byte-equal to this raffle's Draw. Anything
 * else (an extra instruction, Persistent, another raffle, a window that closes or opens early) is
 * not counted, and the page keeps Draw as a button.
 */
export function isDrawbookSchedule(
  s: Subscription,
  r: Pick<ChainRaffle, "address" | "creator" | "revealDeadline">,
): boolean {
  const creator = key(r.creator);
  if (!sameBytes(s.subscriber, creator)) return false;
  if (s.kind !== "OneShot" || s.topic !== CLOCK_TOPIC) return false;
  if (!s.eventAccount || !sameBytes(s.eventAccount, key(CLOCK_SYSVAR_ID))) return false;
  if (!s.timestampRange) return false;
  const [start, end] = s.timestampRange;
  if (start < BigInt(r.revealDeadline) || end !== U64_MAX) return false;
  if (s.activeCommits[1] !== U64_MAX) return false;
  return s.instructions.length === 1 && sameInstruction(s.instructions[0], drawIx(creator, key(r.address)));
}

/* ------------------------------------------------------- what it did */

/** A transaction the Subscriber sent from a raffle's schedule, as read back from the node. */
export interface Firing {
  signature: string;
  /** The block time it ran at, in ms (the node stamps a triggered transaction's validFrom with it). */
  at: number | null;
  /** It is one Draw instruction on this raffle and nothing else. */
  isDraw: boolean;
  /** It executed without error. */
  ok: boolean;
  /** The raffle program's refusal code, when it refused. */
  code: number | null;
  /** The refusal in words, when it failed. */
  reason: string | null;
}

interface WireMessage {
  accountKeys?: unknown;
  instructions?: unknown;
}

/**
 * Read a triggered transaction (`getTransaction`'s result) into a Firing for `raffle`. Pure, so the
 * shapes the node sends are checked offline. It is a Draw only when it holds one instruction, to the
 * raffle program, with data [3] and this raffle as its second account; anything else the schedule
 * might have sent after an Update is not described as the draw.
 */
export function readFiring(
  signature: string,
  tx: { transaction?: unknown; meta?: { err: unknown; logMessages?: string[] | null } | null } | null,
  raffle: Pick<ChainRaffle, "address" | "creator">,
): Firing | null {
  if (!tx || !tx.meta) return null;
  // validFrom sits beside the message, not inside it: {signatures, message, validFrom}.
  const wire = (tx.transaction ?? {}) as { message?: WireMessage; validFrom?: unknown };
  const message = wire.message ?? {};
  const keys = Array.isArray(message.accountKeys) ? (message.accountKeys as unknown[]).map(String) : [];
  const instructions = Array.isArray(message.instructions)
    ? (message.instructions as { programIdIndex?: unknown; accounts?: unknown; data?: unknown }[])
    : [];
  let isDraw = false;
  if (instructions.length === 1) {
    const ix = instructions[0];
    const accounts = Array.isArray(ix.accounts) ? (ix.accounts as number[]) : [];
    let data: Uint8Array | null = null;
    try {
      data = typeof ix.data === "string" ? decodeBase58(ix.data) : null;
    } catch {
      data = null;
    }
    isDraw =
      keys[Number(ix.programIdIndex)] === PROGRAM_ID &&
      data !== null &&
      data.length === 1 &&
      data[0] === 3 &&
      keys[accounts[1]] === raffle.address &&
      keys[accounts[2]] === INSTRUCTIONS_SYSVAR_ID;
  }
  const err = tx.meta.err;
  const ok = err === null || err === undefined;
  const logs = Array.isArray(tx.meta.logMessages) ? tx.meta.logMessages : [];
  const code = ok
    ? null
    : customErrorCode(err, logs, [drawIx(key(raffle.creator), key(raffle.address))], key(PROGRAM_ID));
  const at = typeof wire.validFrom === "number" ? wire.validFrom : null;
  return {
    signature,
    at,
    isDraw,
    ok,
    code,
    reason: ok ? null : code !== null ? errorMessage(code) : failureText(err, logs),
  };
}

/* ---------------------------------------------------- where it stands */

/** Everything the page reads about a raffle's schedule. See `fetchSchedule` in actions.ts. */
export interface ScheduleRead {
  /** The subscription account's address, derived from the creator and the raffle. */
  address: string;
  /** The account, or null when there is none (never made, or destroyed). */
  account: { owner: string; kelvins: bigint; data: Uint8Array } | null;
  /** Whether any transaction ever touched the account: a Subscribe, then perhaps a reclaim. */
  history: boolean;
  /**
   * Whether the node's `getSubscription` says it still holds the subscription: true, false (not
   * found), or null when that read failed. The account is only the creator's deposit; this is the
   * node's own word that the Draw is still queued, and the two can disagree (a Destroy alone closes
   * the account and leaves the Draw queued, local network 2026-10-08), so "scheduled" needs both.
   */
  held: boolean | null;
  /** The newest transaction the Subscriber sent from it, read back, or null. */
  firing: Firing | null;
}

export type ScheduleState =
  /** No schedule now and none ever: a raffle from before this feature, or Rialo refused it. */
  | { kind: "none"; address: string }
  /** There was one, and the creator destroyed it before it fired. */
  | { kind: "withdrawn"; address: string }
  /** The account exists but is not exactly Drawbook's schedule for this raffle. */
  | { kind: "unrecognised"; address: string; deposit: bigint }
  /** Waiting. "due" from the scheduled time for DUE_WINDOW_MS, "late" after that with no firing. */
  | { kind: "scheduled" | "due" | "late"; address: string; at: number; deposit: bigint }
  /**
   * The account is exactly Drawbook's schedule, but before its time the node answers that it does
   * not hold it, so nothing says it will be sent. The deposit is still the creator's to reclaim.
   */
  | { kind: "dropped"; address: string; at: number; deposit: bigint }
  /** Rialo sent Draw. `deposit` is what the account still holds, or null once it is reclaimed. */
  | { kind: "sent"; address: string; firing: Firing; at: number | null; deposit: bigint | null };

/**
 * Where a raffle's schedule stands at `now`, from what was read. Pure: the page and the offline
 * checks call the same function. A firing counts only when it was a Draw on this raffle; the
 * account's bytes are decoded and must be exactly Drawbook's form before anything is called
 * scheduled, because the creator could have Updated them into anything, and the node must not have
 * answered that it no longer holds the subscription.
 */
export function scheduleState(
  r: Pick<ChainRaffle, "address" | "creator" | "revealDeadline">,
  read: ScheduleRead,
  now: number,
): ScheduleState {
  const address = read.address;
  const account = read.account !== null && read.account.owner === SUBSCRIBER_PROGRAM_ID ? read.account : null;
  let schedule: Subscription | null = null;
  if (account) {
    try {
      schedule = decodeSubscription(account.data);
    } catch {
      schedule = null;
    }
  }
  const valid = schedule !== null && isDrawbookSchedule(schedule, r);
  const at = valid && schedule?.timestampRange ? Number(schedule.timestampRange[0]) : null;

  if (read.firing && read.firing.isDraw) {
    return { kind: "sent", address, firing: read.firing, at, deposit: account ? account.kelvins : null };
  }
  if (account && valid && at !== null) {
    // Before its time a held OneShot is always found, so "not found" means nothing is queued. From
    // its time on, "not found" is also what a firing that is not listed yet looks like, so it waits.
    if (read.held === false && now < at) return { kind: "dropped", address, at, deposit: account.kelvins };
    const kind = now < at ? "scheduled" : now < at + DUE_WINDOW_MS ? "due" : "late";
    return { kind, address, at, deposit: account.kelvins };
  }
  if (account) return { kind: "unrecognised", address, deposit: account.kelvins };
  if (read.history) return { kind: "withdrawn", address };
  return { kind: "none", address };
}
