/**
 * Drive lib/chain/actions.ts through a whole raffle on a LOCAL network: fund two fresh wallets from
 * the local faucet, create, buy twice, reveal twice, draw, claim, then read it all back and audit
 * the draw. A second raffle that sells nothing checks the void path and the creator's refund, and
 * two deliberate refusals check that a program error code survives the trip back to the browser.
 *
 * It refuses any endpoint that is not on this machine, because it asks the faucet for funds and
 * the public faucets must not be called from scripts.
 *
 * Run: node scripts/smoke-chain.ts [http://127.0.0.1:PORT]
 *   or with NEXT_PUBLIC_RIALO_RPC set; otherwise the URL is read from the local network's
 *   localnet.json in the build scratchpad (SMOKE_LOCALNET_JSON overrides its path).
 */

import { existsSync, readFileSync } from "node:fs";

const LOCALNET_JSON =
  process.env.SMOKE_LOCALNET_JSON ??
  "/tmp/claude-0/-root-rialo/c8fdf082-2256-4c19-ae6c-0f7a4c9519c0/scratchpad/build/localnet.json";

/** The first local http URL anywhere in the file, whatever the key is called. */
function urlFromLocalnetJson(): string | null {
  if (!existsSync(LOCALNET_JSON)) return null;
  const found = /"(http:\/\/(?:127\.0\.0\.1|localhost):\d+[^"]*)"/.exec(readFileSync(LOCALNET_JSON, "utf8"));
  return found ? found[1] : null;
}

const rpcUrl = process.argv[2] ?? process.env.NEXT_PUBLIC_RIALO_RPC ?? urlFromLocalnetJson();
if (!rpcUrl || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(rpcUrl)) {
  console.error(`smoke-chain runs against a local network only; got ${rpcUrl ?? "nothing"}`);
  process.exit(2);
}

// Set before the library loads, because lib/rialo-rpc.ts reads it once at import.
process.env.NEXT_PUBLIC_RIALO_RPC = rpcUrl;

/*
 * The browser's localStorage, on a Map. buyTicket refuses to send when a ticket's secret would not
 * survive a reload, and node has no localStorage, so without this every purchase would be refused.
 */
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true, writable: true });
const { RialoClient, KELVIN } = await import("../lib/rialo-rpc.ts");
const { encodeBase58 } = await import("../lib/base58.ts");
const actions = await import("../lib/chain/actions.ts");
const program = await import("../lib/chain/program.ts");
const tx = await import("../lib/chain/tx.ts");
const nonces = await import("../lib/chain/nonces.ts");
type Wallet = import("../lib/wallet.ts").Wallet;

const client = new RialoClient(rpcUrl);
const RLO = BigInt(KELVIN);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail && !condition ? ` :: ${detail}` : ""}`);
}
async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const value = await run();
    console.log(`  ok    ${label} (${Date.now() - started} ms)`);
    return value;
  } catch (error) {
    const e = error as { message?: string; code?: unknown; logs?: string[] };
    console.log(`  FAIL  ${label}: ${e.message ?? String(error)}${e.code !== undefined ? ` [code ${String(e.code)}]` : ""}`);
    if (e.logs?.length) console.log(`        logs:\n          ${e.logs.join("\n          ")}`);
    console.log(`\nSMOKE STOPPED at "${label}".`);
    process.exit(1);
  }
}

async function freshWallet(): Promise<Wallet> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const address = encodeBase58(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  return { address, canSign: true, privateKey: pair.privateKey };
}

async function fund(wallet: Wallet, kelvins: number = KELVIN) {
  await client.requestAirdrop(wallet.address, kelvins);
  for (let i = 0; i < 60; i += 1) {
    if ((await client.balance(wallet.address)) > 0) return;
    await sleep(500);
  }
  throw new Error(`faucet grant to ${wallet.address} never arrived`);
}

const balance = async (w: Wallet) => BigInt(await client.balance(w.address));

/** Expect a ChainError carrying `code`; returns what actually happened, for the report. */
async function expectCode(code: number, run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "it succeeded";
  } catch (error) {
    if (error instanceof actions.ChainError && error.code === code) return "ok";
    const e = error as { message?: string; code?: unknown; logs?: string[] };
    return `code ${String(e.code)}: ${e.message}${e.logs?.length ? `\n          ${e.logs.join("\n          ")}` : ""}`;
  }
}

console.log(`local network ${rpcUrl}`);

console.log("\nsetup");
const deployed = await step("program is deployed and executable", async () => {
  const account = await client.getAccountInfo(program.PROGRAM_ID);
  if (!account) throw new Error(`no account at ${program.PROGRAM_ID}`);
  if (!account.executable) throw new Error(`${program.PROGRAM_ID} is not executable`);
  return account;
});
void deployed;
const alice = await freshWallet();
const bob = await freshWallet();
await step("fund two fresh wallets from the local faucet", async () => {
  await Promise.all([fund(alice), fund(bob)]);
});
console.log(`        alice ${alice.address}\n        bob   ${bob.address}`);

/* ---------------------------------------------------------- the drawn path */

console.log("\na raffle that draws");
const prize = RLO / BigInt(10);
const ticketPrice = RLO / BigInt(100);
const revealBond = RLO / BigInt(200);
const now = Date.now();
const params = {
  title: "Smoke raffle",
  prize,
  ticketPrice,
  revealBond,
  supply: 2,
  winners: 1,
  commitDeadline: now + 5 * 60_000,
  revealDeadline: now + 10 * 60_000,
};

const cost = await step("createCost", () => actions.createCost(params.supply, prize));
const rent = await client.getMinimumBalanceForRentExemption(program.accountLength(params.supply));
ok("createCost is rent + prize + a small fee allowance", cost > rent + prize && cost - rent - prize < RLO / BigInt(1000), cost.toString());

const created = await step("createRaffle", () => actions.createRaffle(alice, params));
const raffle = created.raffle;
console.log(`        raffle ${raffle}`);

let r = await step("fetchRaffle after create", async () => {
  const got = await actions.fetchRaffle(raffle);
  if (!got) throw new Error("fetchRaffle returned null");
  return got;
});
ok("status open, nothing sold", r.status === "open" && r.sold === 0 && r.revealed === 0);
ok("creator, title and config as sent", r.creator === alice.address && r.title === "Smoke raffle" && r.supply === 2 && r.winners === 1);
ok("prize, price, bond as sent", r.prize === prize && r.ticketPrice === ticketPrice && r.revealBond === revealBond);
ok("deadlines as sent", r.commitDeadline === params.commitDeadline && r.revealDeadline === params.revealDeadline);
ok("created_at is the chain clock in ms, near now", Math.abs(r.createdAt - Date.now()) < 120_000, String(r.createdAt));
ok("account holds rent + prize", r.kelvins === rent + prize, `${r.kelvins} vs ${rent + prize}`);
ok("phase is selling", program.phaseOf(r, Date.now()) === "selling");

const wrongIndex = await expectCode(7, () =>
  tx.sendAndConfirm(
    client,
    {
      payer: tx.addressBytes(bob.address),
      instructions: [
        program.buyIx(tx.addressBytes(bob.address), tx.addressBytes(raffle), 2, program.commitmentV2(raffle, 2, bob.address, "00".repeat(16))),
      ],
      signers: [{ publicKey: tx.addressBytes(bob.address), privateKey: bob.privateKey! }],
    },
    { errorProgram: tx.addressBytes(program.PROGRAM_ID), explain: program.errorMessage },
  ),
);
ok("a Buy for ticket 2 while ticket 1 is next comes back as WrongTicket (7)", wrongIndex === "ok", wrongIndex);

/* A wallet too poor for a ticket: refused here in words, and on chain without a raffle code. */
const poor = await freshWallet();
await step("fund a third wallet with 0.002 RLO", () => fund(poor, 2_000_000));
const shortBuy = await actions.buyTicket(poor, raffle).then(
  () => null,
  (error: InstanceType<typeof actions.ChainError>) => error,
);
ok(
  "buyTicket from a short wallet is refused before sending, in words, with no program code",
  shortBuy instanceof actions.ChainError && shortBuy.code === null && shortBuy.outcome === "not-sent" && shortBuy.message.startsWith(tx.INSUFFICIENT_FUNDS),
  `${shortBuy?.outcome} ${shortBuy?.code} ${shortBuy?.message}`,
);
const shortOnChain = await tx
  .sendAndConfirm(
    client,
    {
      payer: tx.addressBytes(poor.address),
      instructions: [
        program.buyIx(tx.addressBytes(poor.address), tx.addressBytes(raffle), 1, program.commitmentV2(raffle, 1, poor.address, "00".repeat(16))),
      ],
      signers: [{ publicKey: tx.addressBytes(poor.address), privateKey: poor.privateKey! }],
    },
    { errorProgram: tx.addressBytes(program.PROGRAM_ID), explain: program.errorMessage },
  )
  .then(
    () => null,
    (error: InstanceType<typeof tx.ChainError>) => error,
  );
ok(
  "the same Buy sent anyway fails on chain as 'not enough RLO', not as raffle error 1",
  shortOnChain instanceof tx.ChainError && shortOnChain.code === null && shortOnChain.outcome === "failed" && shortOnChain.message === tx.INSUFFICIENT_FUNDS,
  `${shortOnChain?.outcome} ${shortOnChain?.code} ${shortOnChain?.message}`,
);

/* Both buy at once: one lands first, the other gets WrongTicket and tries again for the next. */
const [boughtA, boughtB] = await step("buyTicket alice and bob at the same moment", () =>
  Promise.all([actions.buyTicket(alice, raffle), actions.buyTicket(bob, raffle)]),
);
ok("they hold different tickets, 1 and 2", [boughtA.ticketIndex, boughtB.ticketIndex].sort().join() === "1,2", `${boughtA.ticketIndex} ${boughtB.ticketIndex}`);
const aliceTicket = boughtA.ticketIndex;
const bobTicket = boughtB.ticketIndex;

// A second tab, or a second press after a lost response, saves another secret for alice's ticket.
nonces.saveNonce(raffle, aliceTicket, alice.address, "ab".repeat(16));
ok("alice's ticket number now has two saved secrets", nonces.loadNonces(raffle, aliceTicket, alice.address).length >= 2);

r = (await actions.fetchRaffle(raffle))!;
ok(
  "sold 2, holders recorded",
  r.sold === 2 && r.tickets[aliceTicket - 1].holder === alice.address && r.tickets[bobTicket - 1].holder === bob.address,
);
ok("commitments match what the library computes", r.tickets[0].commitment !== null && r.tickets[1].commitment !== null);
ok("account holds rent + prize + 2 x (price + bond)", r.kelvins === rent + prize + BigInt(2) * (ticketPrice + revealBond), r.kelvins.toString());
ok("sold out moves the phase to revealing", program.phaseOf(r, Date.now()) === "revealing");

const soldOut = await expectCode(6, () =>
  tx.sendAndConfirm(
    client,
    {
      payer: tx.addressBytes(bob.address),
      instructions: [
        program.buyIx(tx.addressBytes(bob.address), tx.addressBytes(raffle), 3, program.commitmentV2(raffle, 3, bob.address, "00".repeat(16))),
      ],
      signers: [{ publicKey: tx.addressBytes(bob.address), privateKey: bob.privateKey! }],
    },
    { errorProgram: tx.addressBytes(program.PROGRAM_ID), explain: program.errorMessage },
  ),
);
ok("a Buy on a sold-out raffle comes back as SaleClosed (6)", soldOut === "ok", soldOut);

const tooEarly = await expectCode(13, () => actions.drawRaffle(bob, raffle));
ok("Draw before reveals finish comes back as NotReady (13)", tooEarly === "ok", tooEarly);

const bobBeforeReveal = await balance(bob);
await step("revealTicket alice, picking the secret that matches out of two", () => actions.revealTicket(alice, raffle, aliceTicket));
await step("revealTicket bob", () => actions.revealTicket(bob, raffle, bobTicket));
const bobAfterReveal = await balance(bob);
ok("bob's bond came back at reveal (less the fee)", bobAfterReveal - bobBeforeReveal > revealBond - BigInt(100_000), `${bobAfterReveal - bobBeforeReveal}`);

r = (await actions.fetchRaffle(raffle))!;
ok("both revealed, nonces public", r.revealed === 2 && r.tickets.every((t) => t.revealed && t.nonce !== null));
ok("all revealed makes the raffle ready at once", program.phaseOf(r, Date.now()) === "ready");

await step("drawRaffle (bob calls it)", () => actions.drawRaffle(bob, raffle));
r = (await actions.fetchRaffle(raffle))!;
ok("status drawn", r.status === "drawn", r.status);
ok("chain seed, seed, drawn_at recorded", r.seed !== null && r.drawnAt > 0, `${r.chainSeed} ${r.seed}`);
ok("one effective winner", r.effectiveWinners === 1 && r.tickets.filter((t) => t.won).length === 1);
const expectedPool = prize + BigInt(2) * ticketPrice;
ok("pool = prize + sold x price (no forfeits)", r.pool === expectedPool && r.perWinner === expectedPool, `${r.pool} ${r.perWinner}`);
const audit = program.auditDraw(r);
ok("auditDraw().matches === true against the chain's own data", audit?.matches === true, JSON.stringify(audit));
console.log(`        chain_seed ${r.chainSeed}  seed ${r.seed}  winner ticket ${audit?.winners.join(",")}`);

const winnerIndex = r.tickets.find((t) => t.won)!.index;
const winner = winnerIndex === aliceTicket ? alice : bob;
const loser = winnerIndex === aliceTicket ? bob : alice;
ok("payoutOf the winner is the whole pool", program.payoutOf(r, winnerIndex) === expectedPool);

const loserClaims = await step("claimAll for the loser", () => actions.claimAll(loser, raffle));
ok("the loser has nothing to claim", loserClaims.length === 0);
const winnerBefore = await balance(winner);
const winnerClaims = await step("claimAll for the winner", () => actions.claimAll(winner, raffle));
ok("the winner's claim is one transaction", winnerClaims.length === 1);
ok("claimAll reports the amount it claimed", winnerClaims[0]?.kelvin === expectedPool, String(winnerClaims[0]?.kelvin));
const winnerAfter = await balance(winner);
ok("the winner received the pool (less the fee)", winnerAfter - winnerBefore > expectedPool - BigInt(100_000), `${winnerAfter - winnerBefore}`);
r = (await actions.fetchRaffle(raffle))!;
ok("winning ticket marked paid", r.tickets[winnerIndex - 1].paid);
ok("the account is back to its rent reserve", r.kelvins === rent, `${r.kelvins} vs ${rent}`);
const again = await step("claimAll for the winner again", () => actions.claimAll(winner, raffle));
ok("nothing left to claim", again.length === 0);

const listed = await step("listRaffles", () => actions.listRaffles());
ok("listRaffles includes the raffle, decoded", listed.some((x) => x.address === raffle && x.status === "drawn"));
const activity = await step("raffleActivity", () => actions.raffleActivity(raffle));
// Seven succeeded (create, two buys, two reveals, draw, one claim). The refusals on purpose, the
// short wallet's Buy and a race lost to WrongTicket, failed and are left out.
const rawSignatures = await client.getSignaturesForAddress(raffle, { limit: 100 });
ok("activity lists exactly the seven successful transactions", activity.length === 7, `${activity.length} of ${rawSignatures.length} raw`);
ok("activity carries block times in ms", activity.every((a) => a.at === null || Math.abs(a.at - Date.now()) < 3_600_000), JSON.stringify(activity.slice(0, 2)));
ok("activity includes the create and the claim", activity.some((a) => a.signature === created.signature) && activity.some((a) => a.signature === winnerClaims[0]?.signature));

/* ----------------------------------------------------------- the void path */

console.log("\na raffle that sells nothing and goes void");
const voidParams = { ...params, title: "Smoke void", commitDeadline: Date.now() + 8_000, revealDeadline: Date.now() + 80_000 };
const voidCreated = await step("createRaffle with an 8 s sale", () => actions.createRaffle(alice, voidParams));
const voidRaffle = voidCreated.raffle;
await sleep(Math.max(0, voidParams.commitDeadline - Date.now()) + 2_000);
let v = (await actions.fetchRaffle(voidRaffle))!;
ok("no sales: ready once the sale closes", program.phaseOf(v, Date.now()) === "ready");
await step("drawRaffle on the empty raffle", () => actions.drawRaffle(bob, voidRaffle));
v = (await actions.fetchRaffle(voidRaffle))!;
ok("status void", v.status === "void", v.status);
ok("auditDraw has nothing to audit on a void raffle", program.auditDraw(v) === null);
ok("payoutOf index 0 is the prize", program.payoutOf(v, 0) === prize);
const aliceBefore = await balance(alice);
const refund = await step("claimAll for the creator", () => actions.claimAll(alice, voidRaffle));
ok("one refund transaction", refund.length === 1);
const aliceAfter = await balance(alice);
ok("the creator got the prize back (less the fee)", aliceAfter - aliceBefore > prize - BigInt(100_000), `${aliceAfter - aliceBefore}`);
v = (await actions.fetchRaffle(voidRaffle))!;
ok("creator_refunded set", v.creatorRefunded);

console.log(
  failures === 0
    ? "\nSMOKE PASSED: every action ran on chain and the draw audits against chain data."
    : `\nSMOKE HAS ${failures} FAILING CHECKS.`,
);
process.exit(failures === 0 ? 0 : 1);
