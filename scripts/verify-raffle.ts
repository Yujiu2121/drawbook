/**
 * Prove the properties lib/raffle.ts claims. Every assertion here corresponds to a sentence in
 * that module's header or to an edge case the reference implementations get wrong.
 *
 * Run: node scripts/verify-raffle.ts
 */

import { randomBytes } from "node:crypto";
import { toHex } from "../lib/sha256.ts";
import {
  auditWinners,
  buyTicket,
  commitmentFor,
  deriveSeed,
  deriveWinners,
  drawRaffle,
  formatRLO,
  KELVIN_PER_RLO,
  payouts,
  reveal,
  revealMatches,
  summarize,
  type Raffle,
  type RaffleConfig,
} from "../lib/raffle.ts";

let failures = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail && !condition ? ` :: ${detail}` : ""}`);
}
function section(name: string) {
  console.log(`\n${name}`);
}

const hex = (n = 16) => toHex(new Uint8Array(randomBytes(n)));

function makeRaffle(over: Partial<RaffleConfig> = {}): Raffle {
  const config: RaffleConfig = {
    id: 7,
    title: "Test",
    creator: "CREATOR",
    prize: 2 * KELVIN_PER_RLO,
    ticketPrice: KELVIN_PER_RLO / 10,
    revealBond: KELVIN_PER_RLO / 20,
    supply: 20,
    winners: 3,
    commitDeadline: "2026-08-10T00:00:00Z",
    revealDeadline: "2026-08-11T00:00:00Z",
    ...over,
  };
  return {
    config,
    tickets: Array.from({ length: config.supply }, (_, i) => ({
      index: i + 1,
      holder: null,
      commitment: null,
      nonce: null,
    })),
    phase: "selling",
    chainSeed: null,
    winningTickets: [],
  };
}

/** Sell `count` tickets to distinct holders and return the nonces keyed by ticket index. */
function sell(raffle: Raffle, count: number) {
  const nonces = new Map<number, string>();
  let r = raffle;
  for (let i = 1; i <= count; i += 1) {
    const nonce = hex();
    nonces.set(i, nonce);
    r = buyTicket(r, i, `HOLDER_${i}`, nonce);
  }
  return { raffle: r, nonces };
}

function revealAll(raffle: Raffle, nonces: Map<number, string>, only?: number[]) {
  let r = raffle;
  for (const [index, nonce] of nonces) {
    if (only && !only.includes(index)) continue;
    r = reveal(r, index, nonce);
  }
  return r;
}

/* ------------------------------------------------------- commitment binding */

section("commitment binding");
{
  const nonce = hex();
  const c = commitmentFor(nonce, "ALICE", 7, 3);
  ok("same inputs give the same commitment", c === commitmentFor(nonce, "ALICE", 7, 3));
  ok("a different nonce changes it", c !== commitmentFor(hex(), "ALICE", 7, 3));
  ok("a different holder changes it", c !== commitmentFor(nonce, "BOB", 7, 3));
  ok("a different raffle changes it", c !== commitmentFor(nonce, "ALICE", 8, 3));
  ok("a different ticket changes it", c !== commitmentFor(nonce, "ALICE", 7, 4));

  const { raffle, nonces } = sell(makeRaffle(), 3);
  const closed = { ...raffle, phase: "revealing" as const };
  ok("the right nonce is accepted", revealMatches(closed.tickets[0], 7, nonces.get(1)!));
  ok("a wrong nonce is rejected", !revealMatches(closed.tickets[0], 7, hex()));
  ok(
    "another ticket's nonce is rejected",
    !revealMatches(closed.tickets[0], 7, nonces.get(2)!),
  );

  let threw = false;
  try {
    reveal(closed, 1, hex());
  } catch {
    threw = true;
  }
  ok("reveal() throws on a nonce that does not match", threw);
}

/* ----------------------------------------------------------- seed behaviour */

section("seed derivation");
{
  const nonces = [hex(), hex(), hex(), hex()];
  const chain = hex(8);
  const a = deriveSeed(7, nonces, chain);
  ok("deterministic", a === deriveSeed(7, nonces, chain));

  const shuffled = [...nonces].reverse();
  ok("independent of reveal order", a === deriveSeed(7, shuffled, chain));

  ok("changes with the chain seed", a !== deriveSeed(7, nonces, hex(8)));
  ok("changes with the raffle id", a !== deriveSeed(8, nonces, chain));
  ok("changes if one nonce changes", a !== deriveSeed(7, [...nonces.slice(1), hex()], chain));
  ok(
    "withholding a nonce changes it, which is the stated last-revealer caveat",
    a !== deriveSeed(7, nonces.slice(0, 3), chain),
  );
  ok("is 32 bytes of hex", /^[0-9a-f]{64}$/.test(a));
}

/* --------------------------------------------------------- winner selection */

section("winner selection");
{
  const eligible = Array.from({ length: 20 }, (_, i) => i + 1);
  const seed = deriveSeed(7, [hex(), hex()], hex(8));

  const w = deriveWinners(eligible, seed, 3);
  ok("deterministic for a seed", JSON.stringify(w) === JSON.stringify(deriveWinners(eligible, seed, 3)));
  ok("returns the requested count", w.length === 3, `got ${w.length}`);
  ok("winners are distinct", new Set(w).size === w.length, JSON.stringify(w));
  ok("winners come from the eligible set", w.every((x) => eligible.includes(x)));

  ok(
    "count is capped by the eligible pool, not padded",
    deriveWinners([5], seed, 5).length === 1,
  );
  ok("an empty pool yields nothing", deriveWinners([], seed, 3).length === 0);
  ok(
    "asking for exactly the pool size returns a permutation",
    new Set(deriveWinners(eligible, seed, 20)).size === 20,
  );
}

/* ------------------------------------------------------------- distribution */

section("distribution over 60000 independent seeds, 20 tickets, 1 winner");
{
  const eligible = Array.from({ length: 20 }, (_, i) => i + 1);
  const trials = 60_000;
  const counts = new Map<number, number>(eligible.map((i) => [i, 0]));
  for (let t = 0; t < trials; t += 1) {
    const seed = deriveSeed(7, [hex()], hex(8));
    const [winner] = deriveWinners(eligible, seed, 1);
    counts.set(winner, (counts.get(winner) ?? 0) + 1);
  }
  const expected = trials / eligible.length;
  let chi2 = 0;
  for (const c of counts.values()) chi2 += ((c - expected) ** 2) / expected;
  // df = 19; the 0.001 critical value is 43.82. Exceeding it means a real skew, not noise.
  ok(`chi-square ${chi2.toFixed(2)} < 43.82 (df 19, p 0.001)`, chi2 < 43.82);
  ok("every ticket won at least once", [...counts.values()].every((c) => c > 0));
}

section("distribution with 5 winners of 20, checking no positional bias");
{
  const eligible = Array.from({ length: 20 }, (_, i) => i + 1);
  const trials = 20_000;
  const counts = new Map<number, number>(eligible.map((i) => [i, 0]));
  for (let t = 0; t < trials; t += 1) {
    const seed = deriveSeed(7, [hex()], hex(8));
    for (const w of deriveWinners(eligible, seed, 5)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const expected = (trials * 5) / eligible.length;
  let chi2 = 0;
  for (const c of counts.values()) chi2 += ((c - expected) ** 2) / expected;
  ok(`chi-square ${chi2.toFixed(2)} < 43.82`, chi2 < 43.82);
}

/* ------------------------------------------------------- lifecycle & edges */

section("lifecycle");
{
  const { raffle, nonces } = sell(makeRaffle(), 12);
  ok("still selling below supply", raffle.phase === "selling");
  ok("sold count is right", summarize(raffle).sold === 12);
  ok("available count is right", summarize(raffle).available === 8);

  let threw = false;
  try {
    buyTicket(raffle, 1, "SOMEONE", hex());
  } catch {
    threw = true;
  }
  ok("a sold ticket cannot be bought twice", threw);

  const full = sell(makeRaffle({ supply: 4, winners: 2 }), 4).raffle;
  ok("selling the final ticket closes the sale on its own", full.phase === "revealing");

  const revealing = { ...raffle, phase: "revealing" as const };
  const partly = revealAll(revealing, nonces, [1, 2, 3, 4, 5, 6, 7]);
  const s = summarize(partly);
  ok("revealed count is right", s.revealed === 7, `got ${s.revealed}`);
  ok("outstanding count is right", s.outstanding === 5, `got ${s.outstanding}`);
  ok("bonds are not forfeited before the draw", s.forfeited === 0);

  const drawn = drawRaffle(partly, hex(8));
  ok("phase becomes drawn", drawn.phase === "drawn");
  ok("winners are capped at 3", drawn.winningTickets.length === 3);
  ok(
    "only revealed tickets can win",
    drawn.winningTickets.every((i) => i <= 7),
    JSON.stringify(drawn.winningTickets),
  );
  const ds = summarize(drawn);
  ok("the 5 non-revealers forfeit after the draw", ds.forfeited === 5 * drawn.config.revealBond);
}

section("edge cases the reference implementations get wrong");
{
  // The Somnia reference shows raffle #3 with 1/20 tickets sold and "5 WINNERS".
  const one = sell(makeRaffle({ supply: 20, winners: 5 }), 1).raffle;
  const closed = { ...one, phase: "revealing" as const };
  const nonce = hex();
  const bought = buyTicket(makeRaffle({ supply: 20, winners: 5 }), 1, "SOLO", nonce);
  const revealed = reveal({ ...bought, phase: "revealing" }, 1, nonce);
  const drawn = drawRaffle(revealed, hex(8));
  ok(
    "one revealed ticket cannot produce five winners",
    drawn.winningTickets.length === 1,
    JSON.stringify(drawn.winningTickets),
  );
  ok("effectiveWinners reflects the cap", summarize(drawn).effectiveWinners === 1);

  const nobody = drawRaffle(closed, hex(8));
  ok("zero reveals voids the raffle", nobody.phase === "void");
  ok("a void raffle has no winners", nobody.winningTickets.length === 0);
  ok("a void raffle forfeits nothing", summarize(nobody).forfeited === 0);

  let threw = false;
  try {
    drawRaffle(drawn, hex(8));
  } catch {
    threw = true;
  }
  ok("a settled raffle cannot be drawn twice", threw);
}

/* ------------------------------------------------------------------ payout */

section("payout conservation");
{
  for (const winners of [1, 2, 3, 7]) {
    const bought = sell(makeRaffle({ supply: 11, winners, prize: 3 * KELVIN_PER_RLO }), 11);
    const revealed = revealAll({ ...bought.raffle, phase: "revealing" }, bought.nonces);
    const drawn = drawRaffle(revealed, hex(8));
    const p = payouts(drawn);
    const total = [...p.values()].reduce((a, b) => a + b, 0);
    const s = summarize(drawn);
    ok(
      `${winners} winner(s): payouts sum exactly to the pool`,
      total === s.pool,
      `${total} vs ${s.pool}`,
    );
    ok(`${winners} winner(s): one entry per winning ticket`, p.size === drawn.winningTickets.length);
  }
}

/* ------------------------------------------------------------------- audit */

section("independent audit of a settled raffle");
{
  const bought = sell(makeRaffle({ supply: 15, winners: 4 }), 15);
  const revealed = revealAll({ ...bought.raffle, phase: "revealing" }, bought.nonces);
  const drawn = drawRaffle(revealed, hex(8));
  const audit = auditWinners(drawn);
  ok("audit recomputes the seed and winners", audit !== null);
  ok("recomputed winners match what was recorded", audit!.matches, JSON.stringify(audit));

  // Tamper with the recorded result and confirm the audit catches it.
  const tampered: Raffle = {
    ...drawn,
    winningTickets: [...drawn.winningTickets.slice(0, -1), 99],
  };
  ok("audit rejects a tampered winner list", auditWinners(tampered)!.matches === false);
}

/* ----------------------------------------------------------------- format */

section("formatting");
{
  ok("2 RLO", formatRLO(2 * KELVIN_PER_RLO) === "2.00", formatRLO(2 * KELVIN_PER_RLO));
  ok("0.1 RLO shows 3 dp", formatRLO(KELVIN_PER_RLO / 10) === "0.100", formatRLO(KELVIN_PER_RLO / 10));
  ok("thousands are grouped", formatRLO(1234 * KELVIN_PER_RLO) === "1,234.00", formatRLO(1234 * KELVIN_PER_RLO));
}

/* -------------------------------------------------------------- mock data */

section("mock data integrity");
{
  const { MOCK_RAFFLES, VIEWER, nonceOf } = await import("../lib/mock-raffles.ts");

  ok("five raffles", MOCK_RAFFLES.length === 5);
  const phases = MOCK_RAFFLES.map((r) => r.phase).join(",");
  ok("phases cover selling, revealing, drawn and void", phases === "selling,selling,revealing,drawn,void", phases);

  const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{44}$/;
  const addresses = new Set<string>([VIEWER]);
  for (const r of MOCK_RAFFLES) {
    addresses.add(r.config.creator);
    for (const t of r.tickets) if (t.holder) addresses.add(t.holder);
  }
  ok(
    `all ${addresses.size} addresses are 44 base58 characters`,
    [...addresses].every((a) => BASE58.test(a)),
  );

  let commitmentsOk = true;
  let nonceCoverage = true;
  for (const r of MOCK_RAFFLES) {
    for (const t of r.tickets) {
      if (!t.holder) {
        if (t.commitment !== null || t.nonce !== null) commitmentsOk = false;
        continue;
      }
      const n = nonceOf(r.config.id, t.index);
      if (!n) {
        nonceCoverage = false;
        continue;
      }
      if (commitmentFor(n, t.holder, r.config.id, t.index) !== t.commitment) commitmentsOk = false;
      if (t.nonce !== null && t.nonce !== n) commitmentsOk = false;
    }
  }
  ok("every sold ticket's commitment is the real hash of its nonce", commitmentsOk);
  ok("unsold tickets carry no commitment or nonce", commitmentsOk);
  ok("every sold ticket has a retrievable nonce", nonceCoverage);

  const drawn = MOCK_RAFFLES.find((r) => r.phase === "drawn")!;
  const audit = auditWinners(drawn);
  ok("the settled raffle audits against its own record", audit !== null && audit.matches);
  ok(
    "it drew the configured number of winners",
    drawn.winningTickets.length === drawn.config.winners,
    `${drawn.winningTickets.length} vs ${drawn.config.winners}`,
  );
  ok(
    "its winners had all revealed",
    drawn.winningTickets.every((i) => drawn.tickets[i - 1].nonce !== null),
  );
  const dp = payouts(drawn);
  ok(
    "its payouts sum to the pool",
    [...dp.values()].reduce((a, b) => a + b, 0) === summarize(drawn).pool,
  );

  const voided = MOCK_RAFFLES.find((r) => r.phase === "void")!;
  ok("the void raffle has no winners", voided.winningTickets.length === 0);
  ok("the void raffle forfeits nothing", summarize(voided).forfeited === 0);

  const revealing = MOCK_RAFFLES.find((r) => r.phase === "revealing")!;
  const rs = summarize(revealing);
  ok("the revealing raffle is sold out", rs.soldOut);
  ok("it still has reveals outstanding", rs.outstanding > 0, String(rs.outstanding));
  ok(
    "the viewer holds tickets in it, including one not yet revealed",
    revealing.tickets.some((t) => t.holder === VIEWER && t.nonce === null),
  );

  const selling = MOCK_RAFFLES[0];
  const ss = summarize(selling);
  ok("the first raffle is part sold", ss.sold > 0 && ss.available > 0, `${ss.sold}/${selling.config.supply}`);
  ok("the viewer holds tickets in it", selling.tickets.some((t) => t.holder === VIEWER));
}

console.log(
  failures === 0
    ? "\nRAFFLE VERIFIED: every claimed property holds."
    : `\nRAFFLE HAS ${failures} FAILING CHECKS.`,
);
process.exit(failures === 0 ? 0 : 1);
