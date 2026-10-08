/**
 * Where a buyer's secret nonces live between buying a ticket and revealing it.
 *
 * The nonce is the only thing that can open a commitment, and the chain never sees it until the
 * reveal, so losing it forfeits the reveal bond and the ticket's chance to win. It is kept in this
 * browser's localStorage and saved before the purchase is sent, so a refresh or a closed tab
 * mid-purchase cannot strand a ticket that did land.
 *
 * NOTHING IS EVER OVERWRITTEN. Every attempt to buy a ticket number saves its own candidate under
 * its own key, `drawbook-nonce-v2:<raffle>:<ticket>:<holder>:<nonce>`, and a reveal picks the one
 * candidate whose commitment equals the one recorded on chain. One key per candidate rather than a
 * list under one key, because two tabs appending to the same list read and write it without a lock
 * and one append can be lost; two tabs writing different keys cannot collide. Two tabs pressing Buy
 * at once, or a second press after a lost response, used to overwrite the secret of the ticket that
 * actually landed, which then could never be revealed.
 *
 * Every storage access is wrapped, because private browsing and blocked site data make
 * localStorage throw. An in-memory copy backs it up for the rest of the page view, and saveNonce
 * reads its write back and says whether it stuck, so a page can refuse to buy a ticket whose secret
 * would not survive a reload.
 */

import { commitmentV2 } from "./program.ts";

const PREFIX = "drawbook-nonce-v2";

/** Candidate key to nonce, for this page view, whatever storage does. */
const memory = new Map<string, string>();

const NONCE_HEX = /^[0-9a-f]{32}$/;

/** The ticket's own key. Before candidates existed the nonce was stored under exactly this key. */
function ticketKey(raffle: string, ticketIndex: number, holder: string): string {
  return `${PREFIX}:${raffle}:${ticketIndex}:${holder}`;
}

/** Whether `key` is this ticket's: the old single key, or one of its candidates. */
function belongs(key: string, ticket: string): boolean {
  // The colon matters: ticket 1's prefix must not also match ticket 12's keys.
  return key === ticket || key.startsWith(`${ticket}:`);
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Every key in storage, or none when storage refuses. */
function storedKeys(): string[] {
  const s = storage();
  if (!s) return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < s.length; i += 1) {
      const key = s.key(i);
      if (key !== null) keys.push(key);
    }
  } catch {
    // Storage refused partway; what was read is still usable.
  }
  return keys;
}

/**
 * Save one candidate nonce for a ticket number, beside any saved before it. Returns true only when
 * the write reads back from localStorage, which is what makes it survive a reload; false means it
 * lives in this page view alone.
 */
export function saveNonce(raffle: string, ticketIndex: number, holder: string, nonceHex: string): boolean {
  const key = `${ticketKey(raffle, ticketIndex, holder)}:${nonceHex}`;
  memory.set(key, nonceHex);
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(key, nonceHex);
    return s.getItem(key) === nonceHex;
  } catch {
    return false;
  }
}

/** Every candidate nonce this browser holds for a ticket number, from storage and this page view. */
export function loadNonces(raffle: string, ticketIndex: number, holder: string): string[] {
  const ticket = ticketKey(raffle, ticketIndex, holder);
  const found = new Set<string>();
  const s = storage();
  for (const key of storedKeys()) {
    if (!belongs(key, ticket)) continue;
    try {
      const value = s?.getItem(key);
      if (typeof value === "string" && NONCE_HEX.test(value)) found.add(value);
    } catch {
      // Unreadable; the in-memory copy below may still have it.
    }
  }
  for (const [key, value] of memory) if (belongs(key, ticket)) found.add(value);
  return [...found];
}

/**
 * The candidate that opens the commitment recorded on chain for this ticket, or null when none of
 * the candidates this browser holds does. This is the only nonce a reveal should ever send.
 */
export function findNonce(raffle: string, ticketIndex: number, holder: string, commitmentHex: string): string | null {
  for (const nonce of loadNonces(raffle, ticketIndex, holder)) {
    if (commitmentV2(raffle, ticketIndex, holder, nonce) === commitmentHex) return nonce;
  }
  return null;
}

/**
 * Whether localStorage takes a write and gives it back. False in a browser set to block site data,
 * where a ticket's secret and the wallet's key would be gone at the next reload.
 */
export function storagePersists(): boolean {
  const s = storage();
  if (!s) return false;
  const probe = `${PREFIX}:probe`;
  try {
    s.setItem(probe, "1");
    const back = s.getItem(probe);
    s.removeItem(probe);
    return back === "1";
  } catch {
    return false;
  }
}

/**
 * The raffles in which `holder` bought, or tried to buy, a ticket from this browser, read from the
 * secrets stored here. A candidate is saved before every purchase is sent, so this can include a
 * raffle where the purchase never landed; it cannot miss one bought here.
 */
export function rafflesWithSecrets(holder: string): string[] {
  const raffles = new Set<string>();
  const keys = [...storedKeys(), ...memory.keys()];
  for (const key of keys) {
    const parts = key.split(":");
    if (parts[0] !== PREFIX || parts.length < 4) continue;
    if (parts[3] === holder) raffles.add(parts[1]);
  }
  return [...raffles];
}
