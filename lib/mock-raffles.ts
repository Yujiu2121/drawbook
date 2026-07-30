/**
 * MOCK DATA. Every address, nonce and amount below is sample data, not real.
 *
 * Two things are deliberately real rather than faked:
 *
 * 1. **The commitments are genuine SHA-256 digests** of the nonces below, and the settled
 *    raffles are settled by running the actual `drawRaffle`. So the reveal flow really verifies
 *    and the finished raffles really audit. A demo that fakes its hashes cannot demonstrate a
 *    commit-reveal draw, it can only assert one.
 *
 * 2. **Everything is derived deterministically** from fixed strings, never from Math.random or
 *    Date.now. Values randomised at module load would differ between the server render and
 *    client hydration, and would make the draw irreproducible across reloads.
 *
 * In production a holder's nonce exists only in their own browser. Here every nonce is kept so
 * the demo can show other holders revealing theirs.
 */

import { sha256Hex } from "./sha256.ts";
import {
  commitmentFor,
  drawRaffle,
  KELVIN_PER_RLO,
  type Address,
  type Phase,
  type Raffle,
  type RaffleConfig,
  type Ticket,
} from "./raffle.ts";

/** Fixed so the interface does not shift under the demo. */
export const NOW = new Date("2026-07-30T09:00:00Z");

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * A synthetic 44-character base58 address: correct alphabet and length, so the interface is laid
 * out against realistic strings. These are not derived from any keypair.
 */
function fakeAddress(label: string): Address {
  const material = sha256Hex(`address|${label}`) + sha256Hex(`address-2|${label}`);
  let out = "";
  for (let i = 0; i < 44; i += 1) {
    out += BASE58[Number.parseInt(material.slice(i * 2, i * 2 + 2), 16) % 58];
  }
  return out;
}

/** Deterministic 16-byte nonce for one ticket. */
function nonceFor(raffleId: number, ticketIndex: number): string {
  return sha256Hex(`nonce|${raffleId}|${ticketIndex}`).slice(0, 32);
}

/** Stand-in for `get_random_seed()`: 8 bytes, hex, deterministic per raffle. */
function chainSeedFor(raffleId: number): string {
  return sha256Hex(`chain-seed|${raffleId}`).slice(0, 16);
}

/**
 * `count` distinct indices from 1..supply, chosen by ranking the range with a keyed hash. Stable
 * across renders, and scattered rather than striped so the ticket sheet looks bought-into.
 */
function scatter(supply: number, count: number, key: string): number[] {
  return Array.from({ length: supply }, (_, i) => i + 1)
    .map((index) => ({ index, rank: sha256Hex(`${key}|${index}`) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : 1))
    .slice(0, count)
    .map((t) => t.index)
    .sort((a, b) => a - b);
}

export const VIEWER: Address = fakeAddress("viewer");

const HOLDERS: Address[] = Array.from({ length: 22 }, (_, i) => fakeAddress(`holder-${i}`));
const CREATORS: Address[] = Array.from({ length: 5 }, (_, i) => fakeAddress(`creator-${i}`));

const rlo = (n: number) => Math.round(n * KELVIN_PER_RLO);

interface Spec {
  config: RaffleConfig;
  phase: Phase;
  /** Ticket indices that are sold. Everything else is still available. */
  sold: number[];
  /** Of the sold tickets, the ones whose holder has revealed. */
  revealed: number[];
  /** Sold tickets that belong to the viewer. */
  mine: number[];
}

const SPECS: Spec[] = [
  // Selling, roughly half gone. This is the one the demo drives.
  {
    config: {
      id: 1,
      title: "Founder pass, seat 14",
      creator: CREATORS[0],
      prize: rlo(12),
      ticketPrice: rlo(0.25),
      revealBond: rlo(0.1),
      supply: 40,
      winners: 1,
      commitDeadline: "2026-08-02T12:00:00Z",
      revealDeadline: "2026-08-03T12:00:00Z",
    },
    phase: "selling",
    sold: scatter(40, 17, "r1"),
    revealed: [],
    mine: [4, 21],
  },

  // Selling, two short of closing itself when the last ticket goes.
  {
    config: {
      id: 2,
      title: "Devnet validator slot",
      creator: CREATORS[1],
      prize: rlo(4.5),
      ticketPrice: rlo(0.05),
      revealBond: rlo(0.02),
      supply: 24,
      winners: 3,
      commitDeadline: "2026-07-31T18:00:00Z",
      revealDeadline: "2026-08-01T18:00:00Z",
    },
    phase: "selling",
    sold: scatter(24, 22, "r2"),
    revealed: [],
    mine: [9],
  },

  // Sold out, reveals open, several still outstanding. The viewer owes one.
  {
    config: {
      id: 3,
      title: "Cold storage kit",
      creator: CREATORS[2],
      prize: rlo(8),
      ticketPrice: rlo(0.2),
      revealBond: rlo(0.08),
      supply: 16,
      winners: 2,
      commitDeadline: "2026-07-29T10:00:00Z",
      revealDeadline: "2026-07-31T10:00:00Z",
    },
    phase: "revealing",
    sold: Array.from({ length: 16 }, (_, i) => i + 1),
    revealed: [1, 2, 3, 5, 6, 8, 9, 10, 12, 13, 15],
    mine: [6, 11],
  },

  // Settled by the real draw, so its audit trail is genuine.
  {
    config: {
      id: 4,
      title: "Workshop ticket, two seats",
      creator: CREATORS[3],
      prize: rlo(3),
      ticketPrice: rlo(0.15),
      revealBond: rlo(0.05),
      supply: 20,
      winners: 2,
      commitDeadline: "2026-07-24T09:00:00Z",
      revealDeadline: "2026-07-26T09:00:00Z",
    },
    phase: "drawn",
    sold: Array.from({ length: 20 }, (_, i) => i + 1),
    revealed: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20],
    mine: [3, 17],
  },

  // Nobody revealed, so there was nothing honest to draw from.
  {
    config: {
      id: 5,
      title: "Mystery box",
      creator: CREATORS[4],
      prize: rlo(1.5),
      ticketPrice: rlo(0.02),
      revealBond: rlo(0.01),
      supply: 12,
      winners: 1,
      commitDeadline: "2026-07-20T09:00:00Z",
      revealDeadline: "2026-07-22T09:00:00Z",
    },
    phase: "void",
    sold: scatter(12, 5, "r5"),
    revealed: [],
    mine: [],
  },
];

const DAY_MS = 86_400_000;

/**
 * Purchase and reveal instants, spread deterministically across the window each action belongs to.
 * The activity feed needs real times to order itself, and a feed of invented "127d" labels that
 * cannot be reconciled with the deadlines beside it would be worse than none.
 */
function instantIn(fromMs: number, toMs: number, key: string): string {
  const span = Math.max(1, toMs - fromMs);
  const fraction = Number.parseInt(sha256Hex(key).slice(0, 8), 16) / 0x1_0000_0000;
  return new Date(fromMs + Math.floor(fraction * span)).toISOString();
}

function build(spec: Spec): Raffle {
  const revealedSet = new Set(spec.revealed);
  const soldSet = new Set(spec.sold);

  const commitMs = Date.parse(spec.config.commitDeadline);
  const revealMs = Date.parse(spec.config.revealDeadline);
  const nowMs = NOW.getTime();

  // The sale runs for a week up to its deadline, but never into the future.
  const saleOpen = commitMs - 7 * DAY_MS;
  const saleClose = Math.min(commitMs, nowMs);
  // Reveals only happen after the sale has closed, and likewise not in the future.
  const revealOpen = commitMs;
  const revealClose = Math.min(revealMs, nowMs);

  const tickets: Ticket[] = Array.from({ length: spec.config.supply }, (_, i) => {
    const index = i + 1;
    if (!soldSet.has(index)) return { index, holder: null, commitment: null, nonce: null };

    const holder = spec.mine.includes(index)
      ? VIEWER
      : HOLDERS[(index * 7) % HOLDERS.length];
    const nonce = nonceFor(spec.config.id, index);
    const revealed = revealedSet.has(index);

    return {
      index,
      holder,
      commitment: commitmentFor(nonce, holder, spec.config.id, index),
      nonce: revealed ? nonce : null,
      boughtAt: instantIn(saleOpen, saleClose, `bought|${spec.config.id}|${index}`),
      revealedAt: revealed
        ? instantIn(revealOpen, revealClose, `revealed|${spec.config.id}|${index}`)
        : undefined,
    };
  });

  const open: Raffle = {
    config: spec.config,
    tickets,
    phase: spec.phase === "selling" ? "selling" : "revealing",
    chainSeed: null,
    winningTickets: [],
  };

  // Run the genuine draw for anything already settled, so audits agree with the record.
  if (spec.phase === "drawn" || spec.phase === "void") {
    return drawRaffle(open, chainSeedFor(spec.config.id));
  }
  return open;
}

export const MOCK_RAFFLES: Raffle[] = SPECS.map(build);

/**
 * Every nonce, so the demo can reveal on behalf of any holder. In production a holder's nonce is
 * theirs alone and would live in their own browser storage.
 */
export const NONCES: Map<string, string> = new Map(
  MOCK_RAFFLES.flatMap((raffle) =>
    raffle.tickets
      .filter((t) => t.holder !== null)
      .map(
        (t) =>
          [`${raffle.config.id}:${t.index}`, nonceFor(raffle.config.id, t.index)] as [
            string,
            string,
          ],
      ),
  ),
);

export function nonceOf(raffleId: number, ticketIndex: number): string | undefined {
  return NONCES.get(`${raffleId}:${ticketIndex}`);
}

export function raffleById(id: number): Raffle | undefined {
  return MOCK_RAFFLES.find((r) => r.config.id === id);
}
