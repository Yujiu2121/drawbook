/**
 * Rialo JSON-RPC client, against the live public testnet.
 *
 * The method names and parameter shapes below were established by probing the node directly, not
 * taken from documentation, because the published documentation disagrees with itself. Three
 * different devnet endpoints are published; `api.devnet.rialo.xyz` does not resolve at all.
 *
 * Rialo is NOT Solana-RPC compatible, so `@solana/web3.js` cannot be pointed at it:
 *   - params are a single-element array holding a struct, not positional values
 *   - `getBalance` takes `{ address }`, `requestAirdrop` takes `{ pubkey, kelvins }`
 *   - balances are `kelvin`, not lamports
 *   - there is no `getLatestBlockhash`; replay protection is `configHashPrefix` + `validFrom`
 *   - there is no WebSocket or pubsub in the 38-method surface, so state is polled
 *
 * Confirmed live on testnet at the time of writing: node 0.4.0-alpha.0, the Subscriber program
 * (reactive predicates) deployed and executable, Token-2022 deployed on the RISC-V loader, the
 * DKG committee answering, and an open faucet.
 */

export const RIALO_TESTNET = "https://testnet.rialo.io:4101";
export const RIALO_DEVNET = "https://devnet.rialo.io:4101";

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

let nextId = 1;

async function call<T>(endpoint: string, method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    cache: "no-store",
  });

  /*
   * The body is read before the HTTP status is judged, and deliberately so. This node answers
   * application-level refusals with a non-2xx status AND a useful JSON-RPC error: asking the
   * faucet for more than it will give returns 503 carrying
   * "Requested amount (2 RLO) exceeds maximum allowed (1 RLO)". Checking `response.ok` first
   * throws that explanation away and reports a bare "HTTP 503", which is actively misleading.
   */
  // The envelope type is named rather than written inline: `as typeof body` would narrow to the
  // declared initial value of null and collapse to `never`.
  type Envelope = { result?: T; error?: { code: number; message: string } };

  let body: Envelope | null = null;
  try {
    body = (await response.json()) as Envelope;
  } catch {
    body = null;
  }

  if (body?.error) throw new RialoRpcError(body.error.code, `${method}: ${body.error.message}`);

  if (!response.ok) {
    throw new RialoRpcError(response.status, `${method}: HTTP ${response.status}`);
  }

  return body?.result as T;
}

export class RialoClient {
  endpoint: string;

  constructor(endpoint: string = RIALO_TESTNET) {
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

  /** Replay protection. Rialo's stand-in for a recent blockhash. */
  configHashPrefix(): Promise<{ version: number; configHashPrefix: number }> {
    return call(this.endpoint, "getRecentValidatorConfigHash");
  }

  /** The validator DKG committee's joint public key, used for encrypted REX inputs. */
  secretSharingPubkey(): Promise<{ version: number; epoch: number; pubkey: string }> {
    return call(this.endpoint, "getSecretSharingPubkey");
  }

  transactionCount(): Promise<{ value: number; context: Context }> {
    return call(this.endpoint, "getTransactionCount");
  }
}

export const testnet = new RialoClient(RIALO_TESTNET);

/** Kelvin as RLO, for display. */
export function toRLO(kelvin: number): number {
  return kelvin / KELVIN;
}

export function formatKelvinAsRLO(kelvin: number, digits = 3): string {
  return (kelvin / KELVIN).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
