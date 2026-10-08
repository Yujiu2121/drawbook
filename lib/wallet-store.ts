/**
 * Wallet and chain state, held outside React.
 *
 * A module store rather than component state, for two reasons. The wallet is app-global, and
 * reading it is asynchronous: seeding component state from an effect is what
 * `react-hooks/set-state-in-effect` exists to stop, and `useSyncExternalStore` is the sanctioned
 * way to read something the browser owns.
 *
 * Balance and block height are polled. Rialo's 39-method RPC surface has no WebSocket or pubsub,
 * so polling is not a shortcut here, it is the only option.
 */

import {
  FAUCET_MAX_KELVIN,
  RIALO_DEVNET,
  RIALO_RPC,
  RIALO_TESTNET,
  RialoRpcError,
  testnet,
} from "./rialo-rpc.ts";
import {
  WALLET_STORAGE_KEY,
  connectInjectedWallet,
  createWallet,
  forgetWallet,
  loadWallet,
  type Wallet,
} from "./wallet.ts";

/**
 * WHICH CHAIN THE CHIPS ARE TALKING TO, NAMED FROM THE ENDPOINT RATHER THAN ASSUMED.
 *
 * `NEXT_PUBLIC_RIALO_RPC` can point the same build at a local network, and the masthead used to say
 * "Testnet" whatever it was pointed at. A chip that names a chain is a claim, so it is derived from
 * the one string that decides it. Anything that is neither public endpoint is called "Local", which
 * is what every non-public endpoint in this project has been: a network on the developer's machine.
 * `faucet` is the same word in lower case, for the sentences that name whose faucet answered.
 */
export const NETWORK: { name: "Testnet" | "Devnet" | "Local"; faucet: string } =
  RIALO_RPC === RIALO_TESTNET || /(^|\/\/)testnet\.rialo\.io/.test(RIALO_RPC)
    ? { name: "Testnet", faucet: "testnet" }
    : RIALO_RPC === RIALO_DEVNET || /(^|\/\/)devnet\.rialo\.io/.test(RIALO_RPC)
      ? { name: "Devnet", faucet: "devnet" }
      : { name: "Local", faucet: "local" };

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
  /** True when the wallet is a burner key held in this browser, rather than an extension's. */
  usedLocalKey: boolean;
  /**
   * The last ACTION that failed: a connect or a faucet request. Kept apart from `rpcError` on
   * purpose. Both used to share one field, so a faucet refusal such as "IP rate limit exceeded" was
   * wiped by the next successful six-second poll, often before anyone had read it.
   */
  error: string | null;
  /** The raw message from the last poll, while the node is not answering. Null when it is. */
  rpcError: string | null;
  /** Polls failed in a row. The masthead's notice reads this so a single blip does not flash it. */
  rpcFailures: number;
  /** True while a Retry the reader pressed is in flight, so the control can show it is held. */
  retrying: boolean;
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
  rpcError: null,
  rpcFailures: 0,
  retrying: false,
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
    if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      started = false;
      if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    }
  };
}

/**
 * TABS SHARE ONE KEY, SO THEY HAVE TO AGREE ON IT.
 *
 * The browser fires `storage` in every OTHER tab of this origin when one tab writes or removes a
 * key, and never in the tab that wrote it. That is exactly the signal needed: a connect in one tab
 * now appears in the rest within the same frame, and a forget in one tab disconnects the rest,
 * instead of leaving them holding a key that no longer exists anywhere and still offering its
 * faucet (CHROME-N1). `key === null` is `localStorage.clear()`, which removes this key too.
 */
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== WALLET_STORAGE_KEY) return;
  void reloadWallet();
}

async function reloadWallet() {
  const wallet = await loadWallet();
  if ((wallet?.address ?? null) === (current.wallet?.address ?? null)) return;
  set({ wallet, balance: null, usedLocalKey: wallet !== null, error: null, status: "ready" });
  if (wallet) void refreshBalance();
}

async function bootstrap() {
  set({ status: "loading" });
  try {
    const wallet = await loadWallet();
    // Only burner keys are ever stored, so a stored wallet is always one.
    set({ wallet, usedLocalKey: wallet !== null, status: "ready" });
  } catch (error) {
    set({ status: "error", error: describe(error) });
  }
  void poll();
}

/** The poll in flight, shared, so Retry and the interval never run two at once. */
let inFlight: Promise<void> | null = null;

function poll(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = pollOnce().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Ask the node again now, rather than at the next six-second tick. This is the masthead's Retry.
 * It shares the in-flight poll when there is one, so pressing it twice costs one request.
 */
export async function retry(): Promise<void> {
  set({ retrying: true });
  try {
    await poll();
  } finally {
    set({ retrying: false });
  }
}

async function pollOnce() {
  try {
    // One call carries height, transaction count and epoch together.
    const info = await testnet.epochInfo();
    set({
      height: info.blockHeight,
      txCount: info.transactionCount,
      epoch: info.epoch,
      rpcError: null,
      rpcFailures: 0,
    });
  } catch (error) {
    set({ rpcError: describe(error), rpcFailures: current.rpcFailures + 1 });
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
 * The fallback is the path every connect takes today. Rialo registers the Wallet Standard namespace
 * `rialo:*`, so Solana wallets are not discovered, and the one Rialo extension there is, the "Rialo
 * Wallet" testnet extension on the Chrome Web Store, is not connected yet: `connectInjectedWallet`
 * in lib/wallet.ts says why its lookup finds nothing, and why the branch below could not sign.
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
      // createWallet loads the key this browser already holds when there is one, and only makes a
      // new key when there is none: another tab may have connected since this one booted, and a
      // connect here must pick that key up rather than replace it (CHROME-N1).
      const wallet = await createWallet();
      const same = wallet.address === current.wallet?.address;
      set({ wallet, usedLocalKey: true, status: "ready", balance: same ? current.balance : null });
    }
    await poll();
  } catch (error) {
    set({ status: "error", error: describe(error) });
  }
}

/**
 * Delete the burner key from this browser. Irreversible: there is no other copy. The masthead asks
 * before it calls this, and says what goes with the key; nothing else should call it unasked.
 */
export function disconnect() {
  forgetWallet();
  set({ wallet: null, balance: null, usedLocalKey: false, error: null });
}

/**
 * Read the connected wallet's balance now, rather than at the next six-second poll.
 *
 * The raffle pages call this after every confirmed transaction, because a balance that still shows
 * the figure from before a purchase reads as a purchase that cost nothing. It also resolves to the
 * figure it read, so a caller that has to compare money before sending (the deploy page checks the
 * cost of a raffle against it) can do so with a fresh number instead of a stale snapshot. Null when
 * there is no wallet or the node did not answer; the last known balance is left in place then, for
 * the same reason the poll leaves it.
 */
export async function refreshBalance(): Promise<number | null> {
  const address = current.wallet?.address;
  if (!address) return null;
  try {
    const balance = await testnet.balance(address);
    set({ balance });
    return balance;
  } catch {
    return null;
  }
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

/**
 * Whether a message is the browser saying the request never got an answer, in any engine's words:
 * Chromium "Failed to fetch", Firefox "NetworkError when attempting to fetch resource.", WebKit
 * "Load failed". The chrome prints a plain sentence for these instead of the engine's wording.
 */
export function isUnreachable(message: string | null): boolean {
  return message !== null && /failed to fetch|networkerror|load failed|network request failed/i.test(message);
}
