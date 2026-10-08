/**
 * Rialo JSON-RPC client, against the live public testnet by default.
 *
 * The method names and parameter shapes below were established by probing the node directly, not
 * taken from documentation, because the published documentation disagrees with itself. Three
 * different devnet endpoints are published; `api.devnet.rialo.xyz` does not resolve at all.
 *
 * Rialo is NOT Solana-RPC compatible, so `@solana/web3.js` cannot be pointed at it:
 *   - params are a single-element array holding a struct, not positional values; the one
 *     exception is `sendTransaction`, which takes `[base64, { encoding: "base64" }]`
 *   - `getBalance` takes `{ address }`, `requestAirdrop` takes `{ pubkey, kelvins }`
 *   - balances are `kelvin`, not lamports
 *   - there is no `getLatestBlockhash`; replay protection is `configHashPrefix` + `validFrom`
 *   - there is no WebSocket or pubsub in the 39-method surface, so state is polled
 *
 * Re-probed on testnet on 2026-10-07 against node 0.21.0-alpha.0: the Subscriber program
 * (reactive predicates) deployed and executable, Token-2022 deployed on the RISC-V loader, the
 * DKG committee answering, and an open faucet.
 */

export const RIALO_TESTNET = "https://testnet.rialo.io:4101";
export const RIALO_DEVNET = "https://devnet.rialo.io:4101";

/**
 * The endpoint every client in the app talks to. `NEXT_PUBLIC_RIALO_RPC` lets the same build be
 * pointed at a local network for testing; it is written out literally so Next can inline it into
 * the browser bundle at build time, which it only does for a literal `process.env.NAME`.
 */
const configuredRpc = process.env.NEXT_PUBLIC_RIALO_RPC;
export const RIALO_RPC: string =
  typeof configuredRpc === "string" && configuredRpc.length > 0 ? configuredRpc : RIALO_TESTNET;

/** 1 RLO = 1e9 kelvin. */
export const KELVIN = 1_000_000_000;

/**
 * The most the testnet faucet grants in one call. Established by asking for more and reading the
 * refusal, not from documentation. Exceeding it fails with JSON-RPC code -32004, so callers should
 * clamp rather than retry.
 */
export const FAUCET_MAX_KELVIN = 1 * KELVIN;

/**
 * Fields are declared and assigned explicitly rather than using TypeScript parameter properties,
 * because node's strip-only type removal rejects those, and scripts/ runs these modules directly.
 */
export class RialoRpcError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "RialoRpcError";
    this.code = code;
  }
}

interface Context {
  slot: number;
  api_version: string;
}

/** An account as the raffle library needs it: exact kelvins and decoded bytes. */
export interface RawAccount {
  owner: string;
  kelvins: bigint;
  data: Uint8Array;
  executable: boolean;
}

/** One entry of `getSignatureStatuses`. Null in the array means the node has not seen it yet. */
export interface SignatureStatus {
  slot: number;
  /**
   * Null on success. The node sends the failure in two shapes: a bare string for a whole-
   * transaction failure ("ProgramAccountNotFound") and an object for an instruction's failure
   * ({"InstructionError":[1,{"Custom":7}]}), both seen on a local network on 2026-10-07.
   */
  err: unknown;
  executed: boolean;
}

export interface SignatureInfo {
  signature: string;
  blockHeight: number;
  /** Milliseconds, like the chain clock. Null when the node does not know the block time. */
  blockTime: number | null;
  err?: unknown;
}

/** The parts of `getTransaction` the raffle library reads. Everything else is passed through. */
export interface RawTransaction {
  block_height?: number;
  block_time?: number | null;
  transaction?: unknown;
  meta?: {
    err: unknown;
    fee?: number;
    logMessages?: string[] | null;
    computeUnitsConsumed?: number;
  } | null;
}

/**
 * Read `configHashPrefix` out of the raw response text.
 *
 * The value is a full u64, and JSON.parse turns every number into a double, which rounds anything
 * above 2^53: on 2026-10-07 testnet answered 11774740490753875893 and JSON.parse produced
 * 11774740490753876000. A transaction signed with the rounded value is refused with
 * InvalidConfigHashPrefix, so the digits are taken from the text before any parsing happens.
 */
export function parseConfigHashPrefix(text: string): bigint {
  const match = /"configHashPrefix"\s*:\s*(\d+)/.exec(text);
  if (!match) throw new RialoRpcError(-1, "getRecentValidatorConfigHash: no configHashPrefix in response");
  return BigInt(match[1]);
}

/**
 * Rewrite named integer fields as decimal strings before JSON.parse sees them, so a u64 survives
 * intact and can be turned into a bigint. A field name only matches as a JSON key, never inside a
 * string value, because inside a string its quotes arrive escaped.
 */
function quoteIntegers(text: string, fields: string[]): string {
  let out = text;
  for (const field of fields) {
    out = out.replace(new RegExp(`"${field}"\\s*:\\s*(\\d+)`, "g"), `"${field}":"$1"`);
  }
  return out;
}

let nextId = 1;

async function call<T>(
  endpoint: string,
  method: string,
  params: unknown[] = [],
  exactIntegers: string[] = [],
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    cache: "no-store",
    signal,
  });

  /*
   * The body is read before the HTTP status is judged, and deliberately so. This node answers
   * application-level refusals with a non-2xx status AND a useful JSON-RPC error: asking the
   * faucet for more than it will give returns 503 carrying
   * "Requested amount (2 RLO) exceeds maximum allowed (1 RLO)", and a rejected transaction
   * returns 422 carrying "Transaction validation failed: InvalidConfigHashPrefix". Checking
   * `response.ok` first throws that explanation away and reports a bare "HTTP 503", which is
   * actively misleading.
   */
  // The envelope type is named rather than written inline: `as typeof body` would narrow to the
  // declared initial value of null and collapse to `never`.
  type Envelope = { result?: T; error?: { code: number; message: string } };

  let body: Envelope | null = null;
  try {
    const text = await response.text();
    body = JSON.parse(exactIntegers.length > 0 ? quoteIntegers(text, exactIntegers) : text) as Envelope;
  } catch {
    body = null;
  }

  if (body?.error) throw new RialoRpcError(body.error.code, `${method}: ${body.error.message}`);

  if (!response.ok) {
    throw new RialoRpcError(response.status, `${method}: HTTP ${response.status}`);
  }

  return body?.result as T;
}

/** Same as `call`, but hands back the raw text, for values JSON.parse would damage. */
async function callText(endpoint: string, method: string, params: unknown[] = []): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    cache: "no-store",
  });
  const text = await response.text();

  // The same body-before-status rule as `call`; only the success path differs.
  let error: { code: number; message: string } | undefined;
  try {
    error = (JSON.parse(text) as { error?: { code: number; message: string } }).error;
  } catch {
    error = undefined;
  }
  if (error) throw new RialoRpcError(error.code, `${method}: ${error.message}`);
  if (!response.ok) throw new RialoRpcError(response.status, `${method}: HTTP ${response.status}`);
  return text;
}

/** Standard base64, without Buffer, so the same code runs in the browser and under node. */
export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Built in chunks rather than with one spread, which overflows the argument limit on large input.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x2000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  }
  return btoa(binary);
}

interface WireAccount {
  kelvin: string;
  owner: string;
  data: [string, string] | string[];
  executable: boolean;
  space?: number;
}

function toRawAccount(wire: WireAccount): RawAccount {
  const [encoded, encoding] = wire.data;
  if (encoding !== undefined && encoding !== "base64") {
    throw new RialoRpcError(-1, `account data arrived as ${encoding}, expected base64`);
  }
  return {
    owner: wire.owner,
    kelvins: BigInt(wire.kelvin),
    data: encoded ? base64ToBytes(encoded) : new Uint8Array(0),
    executable: wire.executable,
  };
}

export class RialoClient {
  endpoint: string;

  constructor(endpoint: string = RIALO_RPC) {
    this.endpoint = endpoint;
  }

  health(): Promise<string> {
    return call<string>(this.endpoint, "getHealth");
  }

  version(): Promise<string> {
    return call<string>(this.endpoint, "getVersion");
  }

  blockHeight(): Promise<{ value: number; context: Context }> {
    return call(this.endpoint, "getBlockHeight").then((v) =>
      typeof v === "number"
        ? { value: v, context: { slot: v, api_version: "" } }
        : (v as { value: number; context: Context }),
    );
  }

  epochInfo(): Promise<{
    absoluteSlot: number;
    blockHeight: number;
    epoch: number;
    transactionCount: number;
  }> {
    return call(this.endpoint, "getEpochInfo");
  }

  /** Balance in kelvin. Returns 0 for an address the chain has never seen. */
  async balance(address: string): Promise<number> {
    const res = await call<{ value: number; context: Context }>(this.endpoint, "getBalance", [
      { address },
    ]);
    return res.value;
  }

  async accountInfo(address: string): Promise<{
    kelvin: number;
    owner: string;
    executable: boolean;
    space: number;
  } | null> {
    const res = await call<{
      value: { kelvin: number; owner: string; executable: boolean; space: number } | null;
    }>(this.endpoint, "getAccountInfo", [{ address }]);
    return res.value;
  }

  /**
   * Ask the faucet for kelvin. Resolves to the transaction signature.
   * Clamped to FAUCET_MAX_KELVIN, because asking for more is refused outright rather than
   * partially filled.
   */
  requestAirdrop(pubkey: string, kelvins: number = FAUCET_MAX_KELVIN): Promise<string> {
    return call<string>(this.endpoint, "requestAirdrop", [
      { pubkey, kelvins: Math.min(kelvins, FAUCET_MAX_KELVIN) },
    ]);
  }

  /**
   * Replay protection, as JSON.parse renders it.
   *
   * @deprecated The number is rounded to a double and must never be signed with; it is kept only
   * because scripts/verify-wallet.ts reads its type. Sign with `getConfigHashPrefix()`.
   */
  configHashPrefix(): Promise<{ version: number; configHashPrefix: number }> {
    return call(this.endpoint, "getRecentValidatorConfigHash");
  }

  /** Replay protection, exactly. Rialo's stand-in for a recent blockhash. */
  async getConfigHashPrefix(): Promise<bigint> {
    return parseConfigHashPrefix(await callText(this.endpoint, "getRecentValidatorConfigHash", [{}]));
  }

  /**
   * Submit a signed transaction. Resolves to its signature once the node has accepted it for
   * execution, which is not the same as executed: confirm with `getSignatureStatuses`.
   *
   * This is the one method that takes positional params. The struct form every other method uses
   * is refused here.
   */
  sendTransaction(base64: string): Promise<string> {
    return call<string>(this.endpoint, "sendTransaction", [base64, { encoding: "base64" }]);
  }

  async getSignatureStatuses(signatures: string[]): Promise<(SignatureStatus | null)[]> {
    const res = await call<{ value: (SignatureStatus | null)[] }>(
      this.endpoint,
      "getSignatureStatuses",
      [{ signatures }],
    );
    return res.value;
  }

  /**
   * The account with its data decoded and its kelvins exact, or null when it does not exist.
   * `signal` lets a caller that must not wait on a slow node, such as a page's metadata, give up.
   */
  async getAccountInfo(address: string, signal?: AbortSignal): Promise<RawAccount | null> {
    const res = await call<{ value: WireAccount | null }>(
      this.endpoint,
      "getAccountInfo",
      [{ address }],
      ["kelvin"],
      signal,
    );
    return res.value ? toRawAccount(res.value) : null;
  }

  /**
   * Every account owned by `owner`, following the cursor to the end.
   *
   * The `programAccounts` filter means "accounts whose owner field is this program", which is what
   * a program's data accounts are; the node's other two filters, `tokenAccounts` and
   * `stakeAccounts`, select by token or stake owner instead. It is passed explicitly because that
   * is the form the scan of the RISC-V loader's programs used, and the node's default is not
   * documented anywhere. Pages come back in pubkey order, with `after` as the cursor.
   */
  async getAccountsByOwner(
    owner: string,
    options: { pageSize?: number; maxPages?: number } = {},
  ): Promise<{ address: string; account: RawAccount }[]> {
    const pageSize = options.pageSize ?? 100;
    const maxPages = options.maxPages ?? 50;
    const out: { address: string; account: RawAccount }[] = [];
    let after: string | undefined;

    for (let page = 0; page < maxPages; page += 1) {
      const config: { limit: number; after?: string } = { limit: pageSize };
      if (after) config.after = after;
      const res = await call<{
        value: { pubkey: string; account: WireAccount }[];
        pagination?: { has_more?: boolean; next_cursor?: string | null };
      }>(
        this.endpoint,
        "getAccountsByOwner",
        [{ owner, filter: { type: "programAccounts" }, config }],
        ["kelvin"],
      );
      for (const entry of res.value) out.push({ address: entry.pubkey, account: toRawAccount(entry.account) });
      const next = res.pagination?.next_cursor;
      if (!res.pagination?.has_more || !next || next === after) break;
      after = next;
    }
    return out;
  }

  /** Newest first. `blockTime` is milliseconds. */
  async getSignaturesForAddress(
    address: string,
    config: { limit?: number; before?: string; until?: string } = {},
  ): Promise<SignatureInfo[]> {
    const res = await call<{ value: SignatureInfo[] }>(this.endpoint, "getSignaturesForAddress", [
      { address, config },
    ]);
    return res.value;
  }

  /** The transaction as the node returns it, logs included. Null when the node does not know it. */
  async getTransaction(signature: string): Promise<RawTransaction | null> {
    const res = await call<RawTransaction | null>(this.endpoint, "getTransaction", [{ signature }]);
    return res ?? null;
  }

  /** Rent-exempt minimum in kelvin. Measured as `(len + 128) * 6960` on testnet. */
  async getMinimumBalanceForRentExemption(len: number): Promise<bigint> {
    const res = await call<string>(
      this.endpoint,
      "getMinimumBalanceForRentExemption",
      [{ data_length: len }],
      ["result"],
    );
    return BigInt(res);
  }

  /** The validator DKG committee's joint public key, used for encrypted REX inputs. */
  secretSharingPubkey(): Promise<{ version: number; epoch: number; pubkey: string }> {
    return call(this.endpoint, "getSecretSharingPubkey");
  }

  transactionCount(): Promise<{ value: number; context: Context }> {
    return call(this.endpoint, "getTransactionCount");
  }
}

/** The client for the configured endpoint, `NEXT_PUBLIC_RIALO_RPC` or testnet. */
export const rialo = new RialoClient(RIALO_RPC);

/**
 * Kept under its old name for the wallet chip and its store. It follows `NEXT_PUBLIC_RIALO_RPC`
 * too, so a build pointed at a local network shows the balance, and asks the faucet, of the same
 * chain the raffle library writes to, rather than mixing two chains on one screen.
 */
export const testnet = rialo;

export function formatKelvinAsRLO(kelvin: number, digits = 3): string {
  return (kelvin / KELVIN).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
