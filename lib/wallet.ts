/**
 * A testnet keypair held in the browser.
 *
 * WHY THIS AND NOT "CONNECT WALLET" TO AN EXTENSION
 * ------------------------------------------------
 * Rialo publishes a first-party React wallet library, `@rialo/frost`, built on the Wallet
 * Standard. But Rialo registers its own namespace, `rialo:*`, not `solana:*`, which means
 * Phantom, Solflare and `@solana/wallet-adapter` are not discovered as Rialo wallets at all. An
 * extension has to speak `rialo:*` specifically.
 *
 * One such extension exists for testnet: "Rialo Wallet" on the Chrome Web Store (item
 * dbmgekigjgnahdnfgfpdognodiegpmcg). Drawbook does not connect to it yet; see
 * `connectInjectedWallet()` below for why the lookup there finds nothing. The working path is a
 * keypair generated here. That is a real Ed25519 keypair, it
 * produces a real address, the faucet really funds it and the balance really comes back from the
 * chain. It is a burner: the key never leaves this browser and it holds testnet value only.
 *
 * Ed25519 in Web Crypto is used rather than a bundled curve library so there is no dependency to
 * audit. If the browser lacks it, the wallet still works for receiving and reading balances, and
 * `canSign` reports false so nothing silently pretends to be able to sign.
 */

import { encodeBase58 } from "./base58.ts";

/**
 * Exported so the store can listen for the `storage` event on exactly this key: that event is how a
 * second tab learns that the first one connected, or forgot, the wallet they share.
 */
export const WALLET_STORAGE_KEY = "drawbook-testnet-key-v1";
const STORAGE_KEY = WALLET_STORAGE_KEY;

export interface Wallet {
  /** base58 of the 32-byte public key. */
  address: string;
  /** False when the browser has no Ed25519, in which case this address can receive but not sign. */
  canSign: boolean;
  /** Present only when canSign. Never serialised anywhere but this browser's localStorage. */
  privateKey?: CryptoKey;
}

interface StoredWallet {
  address: string;
  /** JWK of the private key, or null when Ed25519 was unavailable at generation time. */
  jwk: JsonWebKey | null;
}

/** Whether this browser can produce a signing key at all. */
export async function ed25519Available(): Promise<boolean> {
  if (typeof crypto === "undefined" || !crypto.subtle) return false;
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}

async function addressFromPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return encodeBase58(new Uint8Array(raw));
}

/**
 * Create a new burner keypair and persist it, unless this browser already holds one.
 *
 * NEVER OVERWRITE A STORED KEY. The key is the only copy there is: it is not derived from anything,
 * it is not backed up, and it may hold faucet grants and the right to reveal tickets bought from it.
 * Every tab of this origin shares one localStorage, so a second tab that booted before the first
 * one connected used to generate a fresh key here and write it straight over the first one, and the
 * first key, with its balance, was gone for good (CHROME-N1). So storage is read again immediately
 * before the write, after the slow part (key generation is async), and if a key has appeared in the
 * meantime that key is loaded and the new one is thrown away unused. localStorage is synchronous,
 * so nothing can land between that read and the write that follows it.
 */
export async function createWallet(): Promise<Wallet> {
  const before = await loadWallet();
  if (before) return before;

  if (await ed25519Available()) {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;

    const address = await addressFromPublicKey(pair.publicKey);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const raced = await persistIfAbsent({ address, jwk });
    if (raced) return raced;
    return { address, canSign: true, privateKey: pair.privateKey };
  }

  // No Ed25519: still produce a valid 32-byte address so the faucet and balance reads work.
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const address = encodeBase58(raw);
  const raced = await persistIfAbsent({ address, jwk: null });
  if (raced) return raced;
  return { address, canSign: false };
}

/**
 * Write the key only if no key is stored. Resolves to the wallet that was already there when one
 * was, or null when this key was written (or storage refused it, in which case the new key still
 * works for this page view, as it always has).
 */
async function persistIfAbsent(wallet: StoredWallet): Promise<Wallet | null> {
  if (read() !== null) return loadWallet();
  persist(wallet);
  return null;
}

export async function loadWallet(): Promise<Wallet | null> {
  const stored = read();
  if (!stored) return null;

  if (!stored.jwk) return { address: stored.address, canSign: false };

  try {
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      stored.jwk,
      { name: "Ed25519" },
      true,
      ["sign"],
    );
    return { address: stored.address, canSign: true, privateKey };
  } catch {
    // The key was stored by a browser that could do Ed25519 and this one cannot.
    return { address: stored.address, canSign: false };
  }
}

export function forgetWallet() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be blocked; nothing to clean up in that case.
  }
}

function persist(wallet: StoredWallet) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
  } catch {
    // Private browsing can refuse storage. The wallet still works for this page view.
  }
}

function read(): StoredWallet | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredWallet;
    return typeof parsed?.address === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Look for a browser extension that speaks Rialo's Wallet Standard namespace.
 *
 * It returns null today, even with the "Rialo Wallet" testnet extension installed. Wallet Standard
 * wallets announce themselves through window events (`wallet-standard:register-wallet` and
 * `wallet-standard:app-ready`), not through a `navigator.wallets.get()`, so this lookup never sees
 * one; Solana wallets would not qualify anyway, because they register under `solana:*`. And a
 * match would still not sign: the store marks it `canSign` with no private key, which `signerOf`
 * in lib/chain/actions.ts refuses. Connecting that extension is future work, not a switch.
 */
export function connectInjectedWallet(): { name: string; address: string } | null {
  const registry = (
    globalThis as unknown as {
      navigator?: { wallets?: { get?: () => unknown[] } };
    }
  ).navigator?.wallets;

  const wallets = typeof registry?.get === "function" ? registry.get() : [];
  for (const candidate of wallets) {
    const w = candidate as { name?: string; chains?: string[]; accounts?: { address?: string }[] };
    if (w.chains?.some((chain) => chain.startsWith("rialo:"))) {
      const address = w.accounts?.[0]?.address;
      if (address) return { name: w.name ?? "Rialo wallet", address };
    }
  }
  return null;
}

/** Shorten an address for a dense row, keeping both ends so it stays identifiable. */
export function shortAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
