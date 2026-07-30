/**
 * Wallet and chain state, held outside React.
 *
 * A module store rather than component state, for two reasons. The wallet is app-global, and
 * reading it is asynchronous: seeding component state from an effect is what
 * `react-hooks/set-state-in-effect` exists to stop, and `useSyncExternalStore` is the sanctioned
 * way to read something the browser owns.
 *
 * Balance and block height are polled. Rialo's 38-method RPC surface has no WebSocket or pubsub,
 * so polling is not a shortcut here, it is the only option.
 */

import { FAUCET_MAX_KELVIN, RialoRpcError, testnet } from "./rialo-rpc.ts";
import { connectInjectedWallet, createWallet, forgetWallet, loadWallet, type Wallet } from "./wallet.ts";

export type Status = "idle" | "loading" | "ready" | "error";

export interface ChainState {
  status: Status;
  wallet: Wallet | null;
  /** Kelvin. Null until the first successful read. */
  balance: number | null;
  /** Testnet block height, so liveness is visible as data rather than as a blinking dot. */
  height: number | null;
  /** Comes free with getEpochInfo, so showing it costs no extra call. */
  txCount: number | null;
  epoch: number | null;
  /** Fetched once; the node build does not change under us. */
  version: string | null;
  /** True while a faucet request is in flight. */
  funding: boolean;
  /** Set when the injected-wallet path was tried and nothing was found. */
  usedLocalKey: boolean;
  error: string | null;
}

const INITIAL: ChainState = {
  status: "idle",
  wallet: null,
  balance: null,
  height: null,
  txCount: null,
  epoch: null,
  version: null,
  funding: false,
  usedLocalKey: false,
  error: null,
};

/**
 * getSnapshot has to return a stable reference between changes or React re-renders forever, so
 * the state object is replaced only when something actually differs.
 */
let current: ChainState = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<ChainState>) {
  const next = { ...current, ...patch };
  const changed = (Object.keys(next) as (keyof ChainState)[]).some((k) => next[k] !== current[k]);
  if (!changed) return;
  current = next;
  for (const notify of listeners) notify();
}

export function getSnapshot(): ChainState {
  return current;
}

export function getServerSnapshot(): ChainState {
  return INITIAL;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  if (!started) {
    started = true;
    void bootstrap();
    // 6s: brisk enough that a faucet grant appears while you are still looking at the button,
    // slow enough not to hammer a shared testnet node.
    pollTimer = setInterval(() => void poll(), 6000);
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      started = false;
    }
  };
}

async function bootstrap() {
  set({ status: "loading" });
  try {
    const wallet = await loadWallet();
    set({ wallet, status: "ready" });
  } catch (error) {
    set({ status: "error", error: describe(error) });
  }
  void poll();
}

async function poll() {
  try {
    // One call carries height, transaction count and epoch together.
    const info = await testnet.epochInfo();
    set({
      height: info.blockHeight,
      txCount: info.transactionCount,
      epoch: info.epoch,
      error: null,
    });
  } catch (error) {
    set({ error: describe(error) });
    return;
  }

  if (current.version === null) {
    try {
      set({ version: await testnet.version() });
    } catch {
      // Not worth surfacing; the node build is decoration next to the height.
    }
  }

  const address = current.wallet?.address;
  if (!address) return;
  try {
    set({ balance: await testnet.balance(address) });
  } catch {
    // Leave the last known balance rather than flashing a zero on a transient failure.
  }
}

/**
 * Prefer a real Rialo wallet extension, fall back to a burner key held in this browser.
 *
 * The fallback is the expected path today: Rialo registers the Wallet Standard namespace
 * `rialo:*`, so Solana wallets are not discovered, and no public Rialo extension has shipped.
 */
export async function connect() {
  set({ status: "loading", error: null });
  try {
    const injected = connectInjectedWallet();
    if (injected) {
      set({
        wallet: { address: injected.address, canSign: true },
        usedLocalKey: false,
        status: "ready",
      });
    } else {
      const wallet = await createWallet();
      set({ wallet, usedLocalKey: true, status: "ready" });
    }
    await poll();
  } catch (error) {
    set({ status: "error", error: describe(error) });
  }
}

export function disconnect() {
  forgetWallet();
  set({ wallet: null, balance: null, usedLocalKey: false, error: null });
}

/** Ask the testnet faucet. Clamped by the client, since over-asking is refused outright. */
export async function fund() {
  const address = current.wallet?.address;
  if (!address || current.funding) return;

  set({ funding: true, error: null });
  try {
    await testnet.requestAirdrop(address, FAUCET_MAX_KELVIN);
    // The grant lands a slot or two later, so read until it shows or the attempts run out.
    for (let i = 0; i < 12; i += 1) {
      await sleep(1000);
      const balance = await testnet.balance(address);
      if (current.balance === null || balance !== current.balance) {
        set({ balance });
        break;
      }
    }
  } catch (error) {
    set({ error: describe(error) });
  } finally {
    set({ funding: false });
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  if (error instanceof RialoRpcError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
