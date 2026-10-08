/**
 * Rialo transactions without a dependency: the message compiler, a Web Crypto Ed25519 signer, and
 * a send that waits for execution.
 *
 * WHY NOT @rialo/ts-cdk
 * ---------------------
 * The project holds six runtime dependencies as a policy, and the CDK would be a seventh with its
 * own curve library inside. The wire format is small enough to write out, and this encoder was
 * checked byte for byte against @rialo/ts-cdk 0.18.1 on 2026-10-07, both the message and the
 * signed transaction, then executed on a local network. scripts/verify-chain.ts freezes fixtures
 * produced by the CDK so a change here that drifts from it fails offline.
 *
 * The message is a Solana legacy message with Rialo's replay protection in place of the recent
 * blockhash:
 *
 *   header (3 bytes) ‖ compact-u16 key count ‖ keys ‖ validFrom u64 LE (ms) ‖
 *   configHashPrefix u64 LE ‖ occ flag (1 byte) ‖ compact-u16 instruction count ‖ instructions
 *
 * and a transaction is compact-u16 signature count ‖ 64-byte signatures ‖ message.
 */

import { decodeBase58, encodeBase58 } from "../base58.ts";
import { bytesToBase64, RialoClient, RialoRpcError } from "../rialo-rpc.ts";

export interface AccountMeta {
  pubkey: Uint8Array;
  isSigner: boolean;
  isWritable: boolean;
}

export interface Instruction {
  programId: Uint8Array;
  accounts: AccountMeta[];
  data: Uint8Array;
}

/** A key that can sign: the 32-byte public key and the Web Crypto private key behind it. */
export interface TxSigner {
  publicKey: Uint8Array;
  privateKey: CryptoKey;
}

export interface CompiledMessage {
  bytes: Uint8Array;
  /** The public keys whose signatures the transaction needs, in the order they must appear. */
  signers: Uint8Array[];
}

/**
 * Where a failed transaction stands, so a page never calls a purchase that may have landed a
 * failure.
 *
 * - "not-sent": it never left this browser (a check here, or the node could not be reached before
 *   sending). Nothing was charged.
 * - "refused": the node answered and refused it, or it was never executed and is now too old to
 *   be. It is not on chain and nothing was charged.
 * - "failed": the chain executed it and it failed there. The fee was charged and the signature is
 *   a receipt.
 * - "unknown": it was sent, and this page lost contact with the network before it could tell
 *   whether it landed. The signature is the thing to check before trying again.
 */
export type Outcome = "not-sent" | "refused" | "failed" | "unknown";

/**
 * Raised when the chain refuses or fails a transaction. `code` is the raffle program's custom
 * error code when the raffle program itself refused (never a code from a program it called, and
 * never a check made in this browser), and null for anything else, so a page can only ever explain
 * a refusal with the program's own words when the program really said it. `signature` is set on
 * every error raised after the transaction was signed, whatever the outcome.
 */
export class ChainError extends Error {
  code: number | null;
  logs: string[];
  signature: string | null;
  outcome: Outcome;
  /** On a Create whose outcome is not known, the raffle account it would have made. */
  raffle: string | null;
  /**
   * Which instruction of the transaction failed, 0-based, when the node named one
   * ({"InstructionError":[2,…]}), and null otherwise. A transaction is atomic, so this says why the
   * whole of it did not land, not that the instructions before it did. Create reads it to tell a
   * refused schedule (index 2) from a refused raffle.
   */
  instruction: number | null;

  constructor(
    message: string,
    code: number | null = null,
    logs: string[] = [],
    signature: string | null = null,
    outcome: Outcome = signature === null ? "not-sent" : "failed",
    instruction: number | null = null,
  ) {
    super(message);
    this.name = "ChainError";
    this.code = code;
    this.logs = logs;
    this.signature = signature;
    this.outcome = outcome;
    this.raffle = null;
    this.instruction = instruction;
  }
}

/* ------------------------------------------------------------------ bytes */

/** Solana's compact-u16 ("shortvec"): 7 bits per byte, high bit set while more bytes follow. */
function pushCompactU16(out: number[], n: number) {
  if (n < 0 || n > 0xffff) throw new Error(`compact-u16 out of range: ${n}`);
  let rest = n;
  for (;;) {
    const low = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(low);
      return;
    }
    out.push(low | 0x80);
  }
}

function pushU64LE(out: number[], value: bigint) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, value, true);
  for (const x of b) out.push(x);
}

function compareKeys(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 32; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  return compareKeys(a, b) === 0;
}

/* ---------------------------------------------------------------- compile */

/**
 * Compile instructions into the message bytes the signers sign.
 *
 * Account order follows the CDK exactly, because the node checks signatures against the first
 * `numRequiredSignatures` keys: the fee payer first, then signer-writable, signer-readonly,
 * writable, readonly, each group sorted bytewise by public key. Flags of a key that appears more
 * than once are OR-ed together.
 */
export function compileMessage(args: {
  payer: Uint8Array;
  instructions: Instruction[];
  validFrom: bigint;
  configHashPrefix: bigint;
  occ?: boolean;
}): CompiledMessage {
  const table = new Map<string, AccountMeta>();
  const order: string[] = [];
  const add = (pubkey: Uint8Array, isSigner: boolean, isWritable: boolean) => {
    if (pubkey.length !== 32) throw new Error("public keys are 32 bytes");
    const key = encodeBase58(pubkey);
    const existing = table.get(key);
    if (existing) {
      existing.isSigner ||= isSigner;
      existing.isWritable ||= isWritable;
    } else {
      table.set(key, { pubkey, isSigner, isWritable });
      order.push(key);
    }
  };

  add(args.payer, true, true);
  for (const ix of args.instructions) {
    for (const meta of ix.accounts) add(meta.pubkey, meta.isSigner, meta.isWritable);
    add(ix.programId, false, false);
  }

  const priority = (e: AccountMeta) => (e.isSigner && e.isWritable ? 0 : e.isSigner ? 1 : e.isWritable ? 2 : 3);
  const payerKey = encodeBase58(args.payer);
  const rest = order
    .filter((key) => key !== payerKey)
    .map((key) => table.get(key)!)
    .sort((a, b) => priority(a) - priority(b) || compareKeys(a.pubkey, b.pubkey));
  const keys = [table.get(payerKey)!, ...rest];
  const indexOf = (pubkey: Uint8Array) => keys.findIndex((e) => sameKey(e.pubkey, pubkey));

  const out: number[] = [
    keys.filter((e) => e.isSigner).length,
    keys.filter((e) => e.isSigner && !e.isWritable).length,
    keys.filter((e) => !e.isSigner && !e.isWritable).length,
  ];
  pushCompactU16(out, keys.length);
  for (const e of keys) for (const x of e.pubkey) out.push(x);
  pushU64LE(out, args.validFrom);
  pushU64LE(out, args.configHashPrefix);
  out.push(args.occ ? 1 : 0);
  pushCompactU16(out, args.instructions.length);
  for (const ix of args.instructions) {
    out.push(indexOf(ix.programId));
    pushCompactU16(out, ix.accounts.length);
    for (const meta of ix.accounts) out.push(indexOf(meta.pubkey));
    pushCompactU16(out, ix.data.length);
    for (const x of ix.data) out.push(x);
  }

  return {
    bytes: new Uint8Array(out),
    signers: keys.filter((e) => e.isSigner).map((e) => e.pubkey),
  };
}

/**
 * Sign a compiled message with every key it needs, placing each signature at its signer's slot.
 * Signers may be passed in any order; a missing one is an error here rather than a refusal from
 * the node with no explanation.
 */
export async function signTransaction(message: CompiledMessage, signers: TxSigner[]): Promise<Uint8Array> {
  const signatures: Uint8Array[] = [];
  for (const needed of message.signers) {
    const signer = signers.find((s) => sameKey(s.publicKey, needed));
    if (!signer) throw new ChainError(`missing a signature from ${encodeBase58(needed)}`);
    const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", signer.privateKey, message.bytes as BufferSource));
    signatures.push(signature);
  }

  const prefix: number[] = [];
  pushCompactU16(prefix, signatures.length);
  const tx = new Uint8Array(prefix.length + 64 * signatures.length + message.bytes.length);
  tx.set(prefix, 0);
  signatures.forEach((s, i) => tx.set(s, prefix.length + 64 * i));
  tx.set(message.bytes, prefix.length + 64 * signatures.length);
  return tx;
}

/** A transaction's id is the base58 of its first signature, the fee payer's. */
export function signatureOf(tx: Uint8Array): string {
  // One signature or more always fits in the single-byte form of compact-u16.
  return encodeBase58(tx.subarray(1, 65));
}

/* ------------------------------------------------------------ error codes */

/**
 * Pull a custom error code out of a failed transaction, but only when the raffle program itself
 * refused. The Create transaction runs the System program first, and Buy and Create call it from
 * inside the program to move kelvins; its custom codes overlap the raffle's (System 1 is
 * "insufficient funds", raffle 1 is BadInstruction), so a code is never attributed without knowing
 * whose it is.
 *
 * A program that fails because a program it called failed logs the callee's failure line first,
 * then its own with the same code, and the status names the outer instruction. So when any other
 * program's failure line comes before the raffle program's, the code belongs to that other program
 * and this returns null, from the logs and from the status alike.
 *
 * Two sources, in order: the program's own failure line in the logs, which names the program, and
 * the status error, which names the instruction index.
 */
export function customErrorCode(
  err: unknown,
  logs: string[],
  instructions: Instruction[] | null,
  programId: Uint8Array,
): number | null {
  const program = encodeBase58(programId);
  for (const line of logs) {
    const failed = /^Program (\w+) failed: (.*)$/.exec(line);
    if (!failed) continue;
    // The first failure line decides: another program's means a call the raffle made failed.
    if (failed[1] !== program) return null;
    const custom = /^custom program error: 0x([0-9a-fA-F]+)/.exec(failed[2]);
    return custom ? parseInt(custom[1], 16) : null;
  }

  const text = errorText(err);
  if (text && instructions) {
    // The status carries {"InstructionError":[1,{"Custom":7}]}; a message may carry the Rust Debug
    // form InstructionError(1, Custom(7)) instead. Both are accepted.
    const m = /InstructionError\D*?(\d+)\D*?Custom\D*?(\d+)/.exec(text);
    if (m) {
      const ix = instructions[Number(m[1])];
      // Logs that name another program as having failed rule the status out, as above.
      const calleeFailed = logs.some((line) => /^Program \w+ failed/.test(line) && !line.startsWith(`Program ${program} `));
      if (ix && sameKey(ix.programId, programId) && !calleeFailed) return Number(m[2]);
    }
  }
  return null;
}

/**
 * The 0-based index of the instruction a failed transaction names, or null when the failure is not
 * an instruction's (a fee payer short of the fee, a stale timestamp). Reads the status object
 * {"InstructionError":[2,{"Custom":1}]} and the Debug text InstructionError(2, Custom(1)) alike.
 */
export function failedInstruction(err: unknown): number | null {
  const text = errorText(err);
  if (!text) return null;
  const m = /InstructionError\W*(\d+)/.exec(text);
  return m ? Number(m[1]) : null;
}

/** A status error as one line of text, whichever of the node's two shapes it arrived in. */
export function errorText(err: unknown): string | null {
  if (err === null || err === undefined) return null;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/* ------------------------------------------------------------------- send */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How far behind the browser's clock `validFrom` is stamped. The node refuses a transaction stamped
 * even two seconds ahead of its own clock (TimestampInFuture), and a browser's clock is not the
 * node's.
 */
const BACKDATE_MS = 5_000;

/**
 * How long after `validFrom` a transaction can still be executed. The node accepts one up to about
 * two minutes old (measured on testnet, 2026-10-07) and refuses it as TimestampTooStale after that,
 * so once this has passed, plus a margin for the two clocks disagreeing, a transaction the node has
 * never executed never will be.
 */
const VALIDITY_MS = 120_000;
const CLOCK_MARGIN_MS = 30_000;

export interface SendOptions {
  /** Whose custom error codes to report in ChainError.code. */
  errorProgram: Uint8Array;
  /** Turns a code into the sentence the ChainError carries. */
  explain?: (code: number) => string;
  /**
   * How long after `validFrom` the node may still execute the transaction, clock margin included.
   * Defaults to about two and a half minutes; scripts/verify-chain.ts shortens it to test the
   * verdicts without waiting.
   */
  validityMs?: number;
  /**
   * How long to keep checking a sent transaction before giving up. Defaults to the end of its
   * validity window, because before that a transaction that has not landed still can.
   */
  timeoutMs?: number;
}

/** True when the node itself answered with a refusal, rather than the request going missing. */
function nodeAnswered(error: unknown): error is RialoRpcError {
  // A bare "HTTP 502" with no JSON-RPC body is a proxy or a dropped connection, not the node.
  return error instanceof RialoRpcError && !/: HTTP \d+$/.test(error.message);
}

/**
 * Compile, sign, send, and wait until the chain reports the transaction executed.
 *
 * A transaction that may have landed is never reported as failed. If the response to the send is
 * lost (a dropped connection on mobile data, say), the node may still have accepted it, so this
 * keeps asking about that same signature until its validity window has passed: by then it has
 * either landed, which resolves normally, or it never can, which is a plain refusal. Only when the
 * node cannot be reached at all through that window does this give up, with outcome "unknown" and
 * the signature to check. On failure the logs are fetched so the error can name the program's
 * refusal rather than a bare "failed".
 */
export async function sendAndConfirm(
  client: RialoClient,
  args: { payer: Uint8Array; instructions: Instruction[]; signers: TxSigner[] },
  options: SendOptions,
): Promise<string> {
  const explain = (code: number | null, fallback: string) =>
    code !== null && options.explain ? options.explain(code) : fallback;

  let signature = "";
  let validFrom = 0;

  // One retry, for the case where the config hash rolled over between reading and sending.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let configHashPrefix: bigint;
    try {
      configHashPrefix = await client.getConfigHashPrefix();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      throw new ChainError(`Could not reach the network, so nothing was sent: ${text}`);
    }
    validFrom = Date.now() - BACKDATE_MS;
    const message = compileMessage({
      payer: args.payer,
      instructions: args.instructions,
      validFrom: BigInt(validFrom),
      configHashPrefix,
    });
    const tx = await signTransaction(message, args.signers);
    signature = signatureOf(tx);
    try {
      const answered = await client.sendTransaction(bytesToBase64(tx));
      if (typeof answered === "string" && answered.length > 0) signature = answered;
      break;
    } catch (error) {
      if (!nodeAnswered(error)) break; // The node may have it; find out below.
      const text = error.message;
      if (attempt === 0 && /InvalidConfigHashPrefix/.test(text)) continue;
      if (/AlreadyProcessed/.test(text)) break; // Already on chain: confirm it like any other.
      const code = customErrorCode(text, logsIn(text), args.instructions, options.errorProgram);
      throw new ChainError(explain(code, refusalText(text)), code, [], signature, "refused", failedInstruction(text));
    }
  }

  const started = Date.now();
  const expiresAt = validFrom + (options.validityMs ?? VALIDITY_MS + CLOCK_MARGIN_MS);
  const giveUpAt = options.timeoutMs !== undefined ? started + options.timeoutMs : expiresAt;
  /** When the node last answered that it had not executed the transaction. */
  let lastNotFound = 0;
  let delay = 400;
  for (;;) {
    let status: Awaited<ReturnType<RialoClient["getSignatureStatuses"]>>[number] = null;
    let answered = false;
    try {
      [status] = await client.getSignatureStatuses([signature]);
      answered = true;
    } catch {
      // A dropped read is not a failed transaction; keep asking until the window has passed.
    }

    if (status && (status.executed || status.err)) {
      if (!status.err) return signature;
      const logs = await fetchLogs(client, signature);
      const code = customErrorCode(status.err, logs, args.instructions, options.errorProgram);
      throw new ChainError(
        explain(code, failureText(status.err, logs)),
        code,
        logs,
        signature,
        "failed",
        failedInstruction(status.err),
      );
    }
    if (answered) lastNotFound = Date.now();

    if (Date.now() > giveUpAt) {
      // One last look through the transaction index, in case the status cache let it go.
      const landed = await client.getTransaction(signature).catch(() => null);
      if (landed?.meta) {
        if (landed.meta.err === null || landed.meta.err === undefined) return signature;
        const logs = Array.isArray(landed.meta.logMessages) ? landed.meta.logMessages : [];
        const code = customErrorCode(landed.meta.err, logs, args.instructions, options.errorProgram);
        throw new ChainError(
          explain(code, failureText(landed.meta.err, logs)),
          code,
          logs,
          signature,
          "failed",
          failedInstruction(landed.meta.err),
        );
      }
      // The node answered "not executed" after the window closed: it never can be now.
      if (lastNotFound > expiresAt) {
        throw new ChainError(
          "The network never executed this transaction, and it is now too old to be executed, so nothing was charged. It is safe to try again.",
          null,
          [],
          signature,
          "refused",
        );
      }
      throw new ChainError(
        "This page lost contact with the network after sending, so it cannot tell whether the transaction landed. Check the transaction below, or reload this page, before trying again.",
        null,
        [],
        signature,
        "unknown",
      );
    }
    await sleep(delay);
    delay = Math.min(delay * 1.5, 1500);
  }
}

/** Logs of a failed transaction. The index can trail the status by a moment, so try a few times. */
async function fetchLogs(client: RialoClient, signature: string): Promise<string[]> {
  for (let i = 0; i < 4; i += 1) {
    try {
      const tx = await client.getTransaction(signature);
      const logs = tx?.meta?.logMessages;
      if (Array.isArray(logs)) return logs;
      if (tx?.meta) return [];
    } catch {
      // Not indexed yet; wait and ask again.
    }
    await sleep(500);
  }
  return [];
}

/** A send-time refusal sometimes carries simulation logs inside its message; pick them out. */
function logsIn(text: string): string[] {
  return text.split(/\\n|\n|", "|","/).filter((line) => line.startsWith("Program "));
}

/** The plain sentence for a wallet that cannot cover what it is sending. */
export const INSUFFICIENT_FUNDS = "This wallet does not hold enough RLO for that, fees included.";

/**
 * An executed transaction's failure that no raffle code explains, in words where possible. Exported
 * for scripts/verify-chain.ts, which checks each shape the node was seen to send.
 */
export function failureText(err: unknown, logs: string[]): string {
  const text = errorText(err) ?? "";
  if (logs.some((line) => /insufficient (kelvins|funds|lamports)/i.test(line))) return INSUFFICIENT_FUNDS;
  // {"InsufficientFundsForRent":{"account_index":1}}: an account would be left holding more than
  // nothing but less than the minimum an account must keep. Index 0 is always the fee payer.
  const rent = /InsufficientFundsForRent\D*(\d+)?/.exec(text);
  if (rent) {
    if (rent[1] === "0") {
      return `${INSUFFICIENT_FUNDS} After this it would hold less than the small minimum every account has to keep on chain (about 0.0009 RLO), so add a little RLO and try again.`;
    }
    return "The address receiving this payment holds too little RLO to exist on chain yet. It needs a little RLO first (about 0.0009 RLO, from the faucet), then this can be sent again.";
  }
  if (/InsufficientFunds/i.test(text)) return INSUFFICIENT_FUNDS;
  return `The transaction failed: ${text}`;
}

/** The node's validation errors, in words a person can act on. Exported for the verify script. */
export function refusalText(text: string): string {
  if (/TimestampInFuture/.test(text)) {
    return "Your device clock is ahead of the chain's, so the network refuses what this browser signs. Set the clock to automatic and try again.";
  }
  if (/TimestampTooStale/.test(text)) {
    return "Your device clock is behind the chain's by more than about two minutes, so the network treats everything this browser signs as already expired. Set the clock to automatic and try again; trying again without that cannot work.";
  }
  if (/InsufficientFundsForRent/.test(text)) return failureText(text, []);
  if (/InsufficientFunds|insufficient/i.test(text)) return INSUFFICIENT_FUNDS;
  if (/AlreadyProcessed/.test(text)) return "That exact transaction was already sent.";
  return `The network refused the transaction: ${text}`;
}

/** Decode a base58 address, failing with a ChainError rather than a bare parse error. */
export function addressBytes(address: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(address);
  } catch {
    throw new ChainError(`not an address: ${address}`);
  }
  if (bytes.length !== 32) throw new ChainError(`not an address: ${address}`);
  return bytes;
}
