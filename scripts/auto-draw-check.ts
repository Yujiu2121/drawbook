/**
 * Check the automatic draw end to end against a running network: a raffle is created through
 * lib/chain/actions.ts with its Draw scheduled on Rialo's Subscriber program, two buyers buy and
 * reveal, nobody presses Draw, and the script waits for the reveal deadline to pass and for Rialo to
 * send Draw by itself. Then it checks what the node shows: the triggered transaction is one Draw on
 * this raffle, it ran, the raffle is drawn, and auditDraw recomputes the same winners from the
 * account's own data. Last, the creator reclaims the schedule deposit, the winner claims, and the
 * buyers send what is left back to the payer.
 *
 * It is written to run on testnet as well as on a local network, so it spends little and never
 * asks a public faucet for anything. Every coin comes from the payer wallet file. A local faucet
 * may top the payer up, only when asked with --fund-from-local-faucet, and the script refuses that
 * flag for any endpoint that is not on this machine.
 *
 *   node scripts/auto-draw-check.ts <rpc-url> <payer-keypair.json> [--fund-from-local-faucet] [--edge-cases]
 *
 * The payer file is a 64-byte JSON array (32-byte seed, then the 32-byte public key), the form the
 * Rialo CLI writes. Its contents are never printed; only its address is.
 *
 * --edge-cases adds three raffles that run alongside the main one, for the local network: a raffle
 * settled by hand before its schedule is due (Rialo's Draw is then refused as already settled and
 * changes nothing), one whose creator reclaims the deposit before it is due (nothing fires), and one
 * whose creator cannot cover the deposit (Rialo refuses the schedule and the raffle is created
 * without it). Each prints PASS or FAIL lines like the rest.
 *
 * Exit status: 0 when every check passed, 1 when any failed, 2 when the arguments were refused.
 */

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [rpcUrl, payerFile] = args.filter((a) => !a.startsWith("--"));
const LOCAL = typeof rpcUrl === "string" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(rpcUrl);

if (!rpcUrl || !payerFile) {
  console.error("usage: node scripts/auto-draw-check.ts <rpc-url> <payer-keypair.json> [--fund-from-local-faucet] [--edge-cases]");
  process.exit(2);
}
for (const flag of flags) {
  if (flag !== "--fund-from-local-faucet" && flag !== "--edge-cases") {
    console.error(`unknown flag ${flag}`);
    process.exit(2);
  }
}
if (flags.has("--fund-from-local-faucet") && !LOCAL) {
  // The public faucets rate-limit by IP, and a live demonstration may need that grant.
  console.error(`refusing --fund-from-local-faucet for ${rpcUrl}: only a faucet on this machine may be asked`);
  process.exit(2);
}

// Read once by lib/rialo-rpc.ts at import, so it is set before the library loads.
process.env.NEXT_PUBLIC_RIALO_RPC = rpcUrl;

/* buyTicket refuses to send unless a ticket's secret survives a reload; node has no localStorage. */
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

const { RialoClient } = await import("../lib/rialo-rpc.ts");
const { decodeBase58, encodeBase58 } = await import("../lib/base58.ts");
const actions = await import("../lib/chain/actions.ts");
const program = await import("../lib/chain/program.ts");
const sub = await import("../lib/chain/subscriber.ts");
const tx = await import("../lib/chain/tx.ts");
type Wallet = import("../lib/wallet.ts").Wallet;
type Instruction = import("../lib/chain/tx.ts").Instruction;

const client = new RialoClient(rpcUrl);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ZERO = BigInt(0);

let failures = 0;
let passes = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail && !condition ? ` :: ${detail}` : ""}`);
}
function info(text: string) {
  console.log(`  INFO  ${text}`);
}
function errorText(error: unknown): string {
  const e = error as { message?: string; code?: unknown; logs?: string[] };
  return `${e.message ?? String(error)}${e.code !== undefined && e.code !== null ? ` [code ${String(e.code)}]` : ""}${
    e.logs?.length ? `\n          ${e.logs.join("\n          ")}` : ""
  }`;
}
/** Run a step whose failure ends the check: everything after it depends on it. */
async function must<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    const value = await run();
    ok(label, true);
    return value;
  } catch (error) {
    ok(label, false, errorText(error));
    console.log(`\nAUTO-DRAW CHECK STOPPED at "${label}". ${passes} passed, ${failures} failed.`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------- wallets */

/** The payer, from a 64-byte JSON keypair. The public half is checked against the private half. */
async function loadPayer(path: string): Promise<Wallet> {
  let bytes: Uint8Array;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 64) throw new Error("expected a JSON array of 64 numbers");
    bytes = Uint8Array.from(parsed as number[]);
  } catch (error) {
    console.error(`could not read the payer keypair at ${path}: ${(error as Error).message}`);
    process.exit(2);
  }
  // PKCS#8 for an Ed25519 seed is a fixed 16-byte prefix and the 32 seed bytes.
  const pkcs8 = new Uint8Array([0x30, 0x2e, 2, 1, 0, 0x30, 5, 6, 3, 0x2b, 0x65, 0x70, 4, 0x22, 4, 0x20, ...bytes.subarray(0, 32)]);
  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const derived = new Uint8Array(Buffer.from(String(jwk.x), "base64url"));
  if (encodeBase58(derived) !== encodeBase58(bytes.subarray(32))) {
    console.error(`the payer keypair at ${path} does not match its own public key`);
    process.exit(2);
  }
  // Re-imported without extractability, so nothing later in this process can export the key.
  const signing = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  return { address: encodeBase58(derived), canSign: true, privateKey: signing };
}

async function freshWallet(): Promise<Wallet> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const address = encodeBase58(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  return { address, canSign: true, privateKey: pair.privateKey };
}

const balance = async (w: Wallet | string) => BigInt(await client.balance(typeof w === "string" ? w : w.address));
const signer = (w: Wallet) => ({ publicKey: decodeBase58(w.address), privateKey: w.privateKey as CryptoKey });

/** System Transfer: u32 2 ‖ u64 kelvins, from (signer, writable) to (writable). */
function transferIx(from: Wallet, to: string, kelvins: bigint): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, kelvins, true);
  return {
    programId: decodeBase58(program.SYSTEM_PROGRAM_ID),
    accounts: [
      { pubkey: decodeBase58(from.address), isSigner: true, isWritable: true },
      { pubkey: decodeBase58(to), isSigner: false, isWritable: true },
    ],
    data,
  };
}

function send(payer: Wallet, instructions: Instruction[]): Promise<string> {
  return tx.sendAndConfirm(
    client,
    { payer: decodeBase58(payer.address), instructions, signers: [signer(payer)] },
    { errorProgram: decodeBase58(program.PROGRAM_ID), explain: program.errorMessage },
  );
}

/**
 * The chain's own clock in ms. Rialo's Clock sysvar is 24 bytes, not Solana's 40: slot,
 * epoch_start_timestamp, unix_timestamp, so unix_timestamp is the i64 at offset 16.
 */
async function chainNow(): Promise<number> {
  const account = await client.getAccountInfo(sub.CLOCK_SYSVAR_ID);
  if (!account || account.data.length < 24) throw new Error("could not read the clock sysvar");
  return Number(new DataView(account.data.buffer, account.data.byteOffset).getBigInt64(16, true));
}

/* --------------------------------------------------------------- setup */

console.log(`auto-draw check against ${rpcUrl} (${LOCAL ? "a local network" : "a remote network; no faucet will be asked"})`);
const payer = await loadPayer(payerFile);
info(`payer ${payer.address}`);
try {
  info(`node version ${await client.version()}`);
} catch {
  info("node version not reported");
}

const SUPPLY = 2;
const PRIZE = BigInt(1_000_000);
const PRICE = BigInt(1_000_000);
const BOND = BigInt(500_000);
const FEE = BigInt(5000);
const rawRent = await client.getMinimumBalanceForRentExemption(program.accountLength(SUPPLY));
const minimum = await client.getMinimumBalanceForRentExemption(0);
const { deposit } = await actions.scheduleCost();
/*
  Each buyer: the ticket and bond, the 50,000 headroom buyTicket checks for, the minimum an account
  keeps, and a few fees (buy, reveal, claim, the sweep back). What is not spent comes back.
*/
const PER_BUYER = PRICE + BOND + BigInt(50_000) + minimum + FEE * BigInt(10);
const edge = flags.has("--edge-cases");
const budget =
  rawRent + PRIZE + deposit + FEE * BigInt(20) + PER_BUYER * BigInt(2) + minimum +
  (edge ? (rawRent + deposit + FEE * BigInt(10)) * BigInt(2) + BigInt(6_000_000) : ZERO);
info(`raffle rent ${rawRent}, schedule deposit ${deposit} (rent for ${sub.SCHEDULE_LEN} bytes), budget ${budget} kelvin`);

let start = await balance(payer);
if (start < budget && flags.has("--fund-from-local-faucet")) {
  for (let i = 0; i < 5 && start < budget; i += 1) {
    await client.requestAirdrop(payer.address);
    for (let j = 0; j < 40 && (await balance(payer)) <= start; j += 1) await sleep(250);
    start = await balance(payer);
  }
  info(`payer topped up from the local faucet to ${start}`);
}
if (start < budget) {
  console.error(`the payer holds ${start} kelvin and this check needs about ${budget}; fund ${payer.address} and run again`);
  process.exit(2);
}

console.log("\nsetup");
const deployed = await client.getAccountInfo(program.PROGRAM_ID);
ok("the raffle program is deployed and executable", deployed !== null && deployed.executable);
const subscriberProgram = await client.getAccountInfo(sub.SUBSCRIBER_PROGRAM_ID);
ok("Rialo's Subscriber program is there and executable", subscriberProgram !== null && subscriberProgram.executable);
const skew = (await chainNow()) - Date.now();
info(`chain clock minus this machine's clock: ${skew} ms`);

/* ------------------------------------------------------- create, schedule */

console.log("\ncreate a raffle with its draw scheduled");
// Deadlines from the chain's clock, so a machine clock that runs ahead or behind cannot misplace them.
const t0 = (await chainNow()) + 2_000;
const params = {
  title: "Auto-draw check",
  prize: PRIZE,
  ticketPrice: PRICE,
  revealBond: BOND,
  supply: SUPPLY,
  winners: 1,
  commitDeadline: t0 + 60_000,
  revealDeadline: t0 + 120_000,
};
const created = await must("createRaffle sends CreateAccount, Create and Subscribe in one transaction", () =>
  actions.createRaffle(payer, params),
);
const raffle = created.raffle;
info(`raffle ${raffle}`);
info(`create ${created.signature}`);
ok("the draw is scheduled, not refused", created.schedule !== null && created.scheduleError === null, String(created.scheduleError));
ok("for the reveal deadline + 5 s", created.drawAt === params.revealDeadline + sub.DRAW_MARGIN_MS);
const scheduleAt = params.revealDeadline + sub.DRAW_MARGIN_MS;
const scheduleAddress = sub.scheduleAddress(payer.address, raffle);
ok("at the subscription address derived from the creator and the raffle", created.schedule === scheduleAddress);
info(`schedule ${scheduleAddress}`);

const account = await client.getAccountInfo(scheduleAddress);
ok("the Subscriber program owns the subscription account", account !== null && account.owner === sub.SUBSCRIBER_PROGRAM_ID, account?.owner);
ok(`it holds ${sub.SCHEDULE_LEN} bytes and exactly their rent`, account !== null && account.data.length === sub.SCHEDULE_LEN && account.kelvins === deposit, `${account?.data.length} ${account?.kelvins}`);
let decoded: ReturnType<typeof sub.decodeSubscription> | null = null;
try {
  decoded = account ? sub.decodeSubscription(account.data) : null;
} catch (error) {
  info(`decode failed: ${(error as Error).message}`);
}
const r0 = await actions.fetchRaffle(raffle);
ok("it decodes as exactly Drawbook's schedule for this raffle", decoded !== null && r0 !== null && sub.isDrawbookSchedule(decoded, r0));
ok(
  "the node rebased the commit window to the Subscribe's commit and kept the open end",
  decoded !== null && decoded.activeCommits[0] > ZERO && decoded.activeCommits[1] === program.U64_MAX,
  decoded ? `${decoded.activeCommits[0]}..=${decoded.activeCommits[1]}` : "",
);
const matcher = await client.getSubscription(payer.address, sub.scheduleNonceText(raffle)).catch(() => null);
info(`getSubscription: ${matcher ? `${matcher.kind}, topic ${matcher.topic}, ${matcher.instructions.length} instruction(s)` : "not found"}`);
ok("the matcher holds it as a OneShot with one instruction", matcher !== null && matcher.kind === "OneShot" && matcher.instructions.length === 1);

/* ------------------------------------------------------- the edge raffles */

interface Edge {
  name: string;
  raffle: string;
  schedule: string | null;
  drawAt: number;
}
const edges: Edge[] = [];
if (edge) {
  console.log("\nedge cases, alongside");
  // Their schedules fall due well after the main raffle's, so the fee the main check measures while
  // it waits is that raffle's alone.
  const short = { ...params, prize: ZERO, commitDeadline: (await chainNow()) + 15_000, revealDeadline: scheduleAt + 20_000 };
  for (const name of ["settled by hand", "reclaimed early"]) {
    try {
      const made = await actions.createRaffle(payer, { ...short, title: `Auto-draw ${name}` });
      ok(`${name}: created with its schedule`, made.schedule !== null, String(made.scheduleError));
      edges.push({ name, raffle: made.raffle, schedule: made.schedule, drawAt: short.revealDeadline + sub.DRAW_MARGIN_MS });
    } catch (error) {
      ok(`${name}: created with its schedule`, false, errorText(error));
    }
  }

  // A creator who can cover the raffle but not the deposit: the Subscribe fails at instruction 2,
  // and createRaffle must create the raffle again without it rather than give up.
  const poor = await freshWallet();
  const grant = rawRent + minimum + BigInt(1_000_000);
  try {
    await send(payer, [transferIx(payer, poor.address, grant)]);
    const made = await actions.createRaffle(poor, { ...short, title: "Auto-draw refused schedule" });
    ok("refused schedule: the raffle is created anyway", (await actions.fetchRaffle(made.raffle)) !== null);
    ok("refused schedule: reported as not scheduled, with Rialo's reason", made.schedule === null && made.drawAt === null && typeof made.scheduleError === "string" && made.scheduleError.length > 0, String(made.scheduleError));
    ok("refused schedule: the refused attempt is kept as a receipt", typeof made.scheduleSignature === "string");
    info(`refused schedule reason: ${made.scheduleError}`);
    const read = await actions.fetchSchedule((await actions.fetchRaffle(made.raffle))!);
    ok("refused schedule: the page reads it as not scheduled", sub.scheduleState({ ...short, address: made.raffle, creator: poor.address }, read, await chainNow()).kind === "none");
    // What is left goes back; the raffle's rent stays with the raffle, as every raffle's does.
    const left = await balance(poor);
    if (left > FEE) await send(poor, [transferIx(poor, payer.address, left - FEE)]).catch((error) => info(`sweep from the poor creator failed: ${errorText(error)}`));
  } catch (error) {
    ok("refused schedule: createRaffle falls back", false, errorText(error));
  }
}

/* ---------------------------------------------------------- buy, reveal */

console.log("\ntwo buyers buy and reveal; nobody presses Draw");
const alice = await freshWallet();
const bob = await freshWallet();
await must("fund two fresh buyers from the payer", () =>
  send(payer, [transferIx(payer, alice.address, PER_BUYER), transferIx(payer, bob.address, PER_BUYER)]),
);
const a = await must("alice buys", () => actions.buyTicket(alice, raffle));
const b = await must("bob buys", () => actions.buyTicket(bob, raffle));
await must("alice reveals", () => actions.revealTicket(alice, raffle, a.ticketIndex));
await must("bob reveals", () => actions.revealTicket(bob, raffle, b.ticketIndex));
let r = (await actions.fetchRaffle(raffle))!;
ok("sold 2, revealed 2, still open", r.sold === 2 && r.revealed === 2 && r.status === "open");
ok("ready early (every ticket revealed), and left for Rialo", program.phaseOf(r, Date.now() + skew) === "ready");
const before = sub.scheduleState(r, await actions.fetchSchedule(r), await chainNow());
ok("the page reads it as scheduled, for the reveal deadline + 5 s", before.kind === "scheduled" && before.at === scheduleAt, before.kind);

if (edge) {
  const byHand = edges.find((e) => e.name === "settled by hand");
  const early = edges.find((e) => e.name === "reclaimed early");
  // Both sold nothing, so they are ready once their sale closes, long before their schedule.
  const sale = await actions.fetchRaffle(edges[0]?.raffle ?? raffle);
  while (sale && (await chainNow()) < sale.commitDeadline + 1_000) await sleep(1_000);
  for (const e of [byHand, early]) {
    if (!e) continue;
    try {
      await actions.drawRaffle(payer, e.raffle);
      ok(`${e.name}: settled by hand before its schedule`, (await actions.fetchRaffle(e.raffle))?.status === "void");
    } catch (error) {
      ok(`${e.name}: settled by hand before its schedule`, false, errorText(error));
    }
  }
  if (early) {
    try {
      const got = await actions.reclaimSchedule(payer, early.raffle);
      ok("reclaimed early: Destroy + Unsubscribe closed the account before it was due", (await client.getAccountInfo(early.schedule!)) === null && got.kelvin === deposit);
      ok("reclaimed early: the matcher no longer holds it", (await client.getSubscription(payer.address, sub.scheduleNonceText(early.raffle))) === null);
    } catch (error) {
      ok("reclaimed early: Destroy + Unsubscribe closed the account before it was due", false, errorText(error));
    }
  }
}

/* ---------------------------------------------------------------- wait */

console.log("\nwait for the reveal deadline to pass and for Rialo to send Draw");
info(`reveal deadline ${new Date(params.revealDeadline).toISOString()}, scheduled ${new Date(scheduleAt).toISOString()}`);
let payerAtDeadline = ZERO;
let triggered: { signature: string; blockNumber: number }[] = [];
const giveUp = scheduleAt + 60_000;
for (;;) {
  const now = await chainNow();
  if (payerAtDeadline === ZERO && now >= params.revealDeadline - 1_500) payerAtDeadline = await balance(payer);
  if (now >= scheduleAt - 2_000) {
    triggered = await client.getTriggeredTransactions(scheduleAddress, 5);
    if (triggered.length > 0) break;
  }
  if (now > giveUp) break;
  await sleep(now < scheduleAt - 10_000 ? 3_000 : 500);
}
const seenAt = await chainNow();
ok("Rialo sent a transaction from the schedule", triggered.length > 0, `nothing by ${new Date(seenAt).toISOString()}`);
if (triggered.length === 0) {
  console.log(`\nAUTO-DRAW CHECK: Rialo did not send Draw within a minute of its time. ${passes} passed, ${failures} failed.`);
  process.exit(1);
}
info(`triggered ${triggered[0].signature} in block ${triggered[0].blockNumber}, seen ${seenAt - scheduleAt} ms after the scheduled time`);
ok("exactly one firing (a OneShot)", triggered.length === 1, String(triggered.length));

/* --------------------------------------------------------------- check */

console.log("\nwhat Rialo sent, and what it did");
let raw = await client.getTransaction(triggered[0].signature);
for (let i = 0; i < 10 && !raw?.meta; i += 1) {
  await sleep(500);
  raw = await client.getTransaction(triggered[0].signature);
}
r = (await actions.fetchRaffle(raffle))!;
const firing = sub.readFiring(triggered[0].signature, raw, r);
ok("it is one Draw instruction on this raffle and nothing else", firing !== null && firing.isDraw);
ok("it ran without error", firing !== null && firing.ok, firing?.reason ?? "");
const message = ((raw?.transaction ?? {}) as {
  message?: { accountKeys?: string[]; header?: { numRequiredSignatures?: number } };
}).message;
ok("the creator is its only signer and its fee payer", message?.accountKeys?.[0] === payer.address && message?.header?.numRequiredSignatures === 1);
ok("the node charged one firing fee of 5,000 kelvin", (raw?.meta as { fee?: number } | null | undefined)?.fee === 5000);
ok("the raffle is drawn", r.status === "drawn", r.status);
ok("after the reveal deadline, by the chain's clock", r.drawnAt >= r.revealDeadline, `${r.drawnAt - r.revealDeadline} ms`);
info(`drawn_at - reveal deadline = ${r.drawnAt - r.revealDeadline} ms; block time ${firing?.at ?? "?"}`);
ok("the node stamped it with its block time, at or after the scheduled time", firing !== null && firing.at !== null && firing.at >= scheduleAt, String(firing?.at));
const audit = program.auditDraw(r);
ok("auditDraw recomputes the same seed and winners from the account", audit?.matches === true, JSON.stringify(audit));
info(`winner ticket ${audit?.winners.join(",")}, chain value ${r.chainSeed}`);
const signatures = await client.getSignaturesForAddress(raffle, { limit: 20 });
ok("the raffle's own transaction list carries the triggered Draw", signatures.some((s) => s.signature === triggered[0].signature));
const payerAfterFiring = await balance(payer);
ok("the creator paid exactly the firing fee while waiting", payerAtDeadline - payerAfterFiring === FEE, `${payerAtDeadline - payerAfterFiring}`);
const after = sub.scheduleState(r, await actions.fetchSchedule(r), await chainNow());
ok("the page reads it as sent by Rialo, with the deposit still held", after.kind === "sent" && after.firing.ok && after.deposit === deposit, after.kind);
const spent = await client.getSubscription(payer.address, sub.scheduleNonceText(raffle)).catch(() => null);
ok("the matcher no longer holds the OneShot", spent === null);

/* ------------------------------------------------------ reclaim, claim, sweep */

console.log("\nreclaim the deposit, claim, and return what is left");
const payerBeforeReclaim = await balance(payer);
const reclaimed = await must("the creator reclaims the schedule deposit (Destroy + Unsubscribe)", () => actions.reclaimSchedule(payer, raffle));
ok("the subscription account is closed", (await client.getAccountInfo(scheduleAddress)) === null);
const payerAfterReclaim = await balance(payer);
ok("the deposit came back, less the fee", payerAfterReclaim - payerBeforeReclaim === reclaimed.kelvin - FEE, `${payerAfterReclaim - payerBeforeReclaim}`);
const listed = await client.getTriggeredTransactions(scheduleAddress, 5);
ok("the triggered Draw is still listed after the account is gone", listed.some((t) => t.signature === triggered[0].signature));
r = (await actions.fetchRaffle(raffle))!;
const afterReclaim = sub.scheduleState(r, await actions.fetchSchedule(r), await chainNow());
ok("the page still reads it as sent by Rialo, with nothing left to reclaim", afterReclaim.kind === "sent" && afterReclaim.deposit === null, afterReclaim.kind);

const winner = r.tickets.find((t) => t.won)?.holder === alice.address ? alice : bob;
const claims = await must("the winner claims", () => actions.claimAll(winner, raffle));
ok("the winner was paid the pool", claims.reduce((sum, c) => sum + c.kelvin, ZERO) === r.pool, `${claims.map((c) => c.kelvin).join("+")} vs ${r.pool}`);

for (const w of [alice, bob]) {
  const left = await balance(w);
  if (left <= FEE) continue;
  try {
    await send(w, [transferIx(w, payer.address, left - FEE)]);
  } catch (error) {
    info(`could not return ${left - FEE} kelvin from ${w.address}: ${errorText(error)}`);
  }
}

/* ------------------------------------------------------------ edge ends */

if (edge) {
  console.log("\nedge cases, after their schedules were due");
  const last = Math.max(...edges.map((e) => e.drawAt)) + 20_000;
  while ((await chainNow()) < last) await sleep(1_000);
  for (const e of edges) {
    if (!e.schedule) continue;
    const fired = await client.getTriggeredTransactions(e.schedule, 5);
    const er = (await actions.fetchRaffle(e.raffle))!;
    if (e.name === "reclaimed early") {
      ok("reclaimed early: nothing fired after the Destroy", fired.length === 0, fired.map((f) => f.signature).join(","));
      continue;
    }
    ok(`${e.name}: Rialo still sent its Draw`, fired.length === 1, String(fired.length));
    if (fired.length === 0) continue;
    let rawEdge = await client.getTransaction(fired[0].signature);
    for (let i = 0; i < 10 && !rawEdge?.meta; i += 1) {
      await sleep(500);
      rawEdge = await client.getTransaction(fired[0].signature);
    }
    const f = sub.readFiring(fired[0].signature, rawEdge, er);
    ok(`${e.name}: the program turned it away as already settled (14), changing nothing`, f !== null && f.isDraw && !f.ok && f.code === 14 && er.status === "void", `${f?.code} ${f?.reason}`);
    const st = sub.scheduleState(er, await actions.fetchSchedule(er), await chainNow());
    ok(`${e.name}: the page reads it as sent and refused`, st.kind === "sent" && !st.firing.ok && st.firing.code === 14, st.kind);
    try {
      await actions.reclaimSchedule(payer, e.raffle);
      ok(`${e.name}: its deposit is reclaimed afterwards`, (await client.getAccountInfo(e.schedule)) === null);
    } catch (error) {
      ok(`${e.name}: its deposit is reclaimed afterwards`, false, errorText(error));
    }
  }
}

const end = await balance(payer);
info(`payer ${start} -> ${end} kelvin (spent ${start - end}: raffle rent stays with each raffle, plus fees)`);
console.log(
  failures === 0
    ? `\nAUTO-DRAW CHECK PASSED: ${passes} checks. Rialo sent Draw by itself and the draw audits against the chain's data.`
    : `\nAUTO-DRAW CHECK HAS ${failures} FAILING CHECKS (${passes} passed).`,
);
process.exit(failures === 0 ? 0 : 1);
