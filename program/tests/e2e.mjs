// End-to-end test of the Drawbook raffle program against a live Rialo node.
//
//   node program/tests/e2e.mjs <rpc-url> [payer]
//
// <payer> is where the money for the test comes from. "faucet" (the default) asks the node's own
// faucet for a grant, and is refused for anything but a localhost URL: the public testnet faucet
// is rate limited per IP and must not be spent by a test. Otherwise <payer> is the path to a
// 64-byte JSON keypair file holding a funded key, which pays every fee and funds the test wallets
// by plain transfers. Add --no-stress to skip the 200-ticket draw.
//
// No dependencies. Transactions are encoded and signed here with Web Crypto Ed25519, using the
// same encoder that was checked byte for byte against @rialo/ts-cdk, and the only repo code
// imported is the hashing and draw specification the program has to agree with.
//
// One wallet (the sponsor) pays every transaction fee and every participant only co-signs. That
// is what lets the test assert that each participant's balance moved by exactly what the raffle
// says, to the kelvin, with no fee arithmetic in the way.

import { readFileSync } from "node:fs";
import { decodeBase58, encodeBase58 } from "../../lib/base58.ts";
import { concat, sha256, toHex, utf8 } from "../../lib/sha256.ts";
import { deriveWinnerTrace, deriveWinners } from "../../lib/raffle.ts";

const RPC = process.argv[2];
const PAYER = process.argv.slice(3).find((a) => !a.startsWith("--")) ?? "faucet";
const STRESS = !process.argv.includes("--no-stress");
if (!RPC) {
  console.error("usage: node program/tests/e2e.mjs <rpc-url> [faucet|keypair.json] [--no-stress]");
  process.exit(2);
}
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(RPC);
if (PAYER === "faucet" && !LOCAL) {
  console.error("refusing to use a faucet that is not on localhost; pass a funded keypair file");
  process.exit(2);
}

const PROGRAM_ADDRESS = "EQGb5xL2bgRuEFxY2FN25eFrgKDhTpZjRUbEQtYmoLLR";
const PROGRAM_ID = decodeBase58(PROGRAM_ADDRESS);
const SYSTEM_ID = new Uint8Array(32);
const IX_SYSVAR = decodeBase58("Sysvar1nstructions1111111111111111111111111");
// Optional: a local-only helper program whose instruction 1 calls Draw through CPI, to confirm the
// program refuses a draw that is not called directly. Pass its id as CPI_HELPER to include it.
const CPI_HELPER = process.env.CPI_HELPER ? decodeBase58(process.env.CPI_HELPER) : null;
const HEADER_LEN = 208;
const TICKET_LEN = 84;

/* ------------------------------------------------------------------ reporting */

let failures = 0;
let passes = 0;
function check(label, ok, detail = "") {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
}
function info(text) {
  console.log(`     ${text}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ bytes */

function cu16(out, n) {
  if (n < 0x80) out.push(n);
  else if (n < 0x4000) out.push((n & 0x7f) | 0x80, n >> 7);
  else out.push((n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14);
}
const u16le = (v) => [v & 0xff, (v >> 8) & 0xff];
function u32le(v) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return [...b];
}
function u64le(v) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
  return [...b];
}
function u64be(v) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), false);
  return b;
}
const cmp32 = (a, b) => {
  for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
const b64 = (u8) => Buffer.from(u8).toString("base64");
const eqBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/* ------------------------------------------------------------------ rpc */

async function rpcRaw(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return r.text();
}
async function rpc(method, params) {
  const j = JSON.parse(await rpcRaw(method, params));
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
/** Read from the raw text: JSON.parse would round this u64 and every signature would fail. */
async function configHashPrefix() {
  const text = await rpcRaw("getRecentValidatorConfigHash", [{}]);
  const m = text.match(/"configHashPrefix"\s*:\s*(\d+)/);
  if (!m) throw new Error(`no configHashPrefix in ${text}`);
  return BigInt(m[1]);
}
const balance = async (addr) => BigInt((await rpc("getBalance", [{ address: addr }])).value);
async function accountInfo(addr) {
  const v = (await rpc("getAccountInfo", [{ address: addr, encoding: "base64" }])).value;
  if (!v) return null;
  const data = new Uint8Array(Buffer.from(Array.isArray(v.data) ? v.data[0] : v.data, "base64"));
  return { data, kelvins: BigInt(v.kelvin ?? v.kelvins), owner: v.owner };
}
const rentFor = async (len) => BigInt(await rpc("getMinimumBalanceForRentExemption", [{ data_length: len }]));

/* ------------------------------------------------------------------ wallets */

async function newWallet(name) {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { name, key: pair.privateKey, pub, addr: encodeBase58(pub) };
}

/** A 64-byte JSON keypair (32-byte seed then 32-byte public key). The contents are never logged. */
async function loadWallet(name, path) {
  const bytes = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
  if (bytes.length !== 64) throw new Error(`${path}: expected a 64-byte keypair`);
  const pkcs8 = concat(Uint8Array.from([0x30, 0x2e, 2, 1, 0, 0x30, 5, 6, 3, 0x2b, 0x65, 0x70, 4, 0x22, 4, 0x20]), bytes.slice(0, 32));
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const pub = new Uint8Array(Buffer.from(jwk.x, "base64url"));
  if (!eqBytes(pub, bytes.slice(32))) throw new Error(`${path}: public half does not match the seed`);
  return { name, key, pub, addr: encodeBase58(pub) };
}

/* ------------------------------------------------------------------ transactions */

/** The Rialo message layout, as proven identical to @rialo/ts-cdk. */
function compileMessage({ payer, instructions, validFrom, configHashPrefix }) {
  const table = new Map();
  const order = [];
  const add = (pubkey, s, w) => {
    const k = encodeBase58(pubkey);
    const e = table.get(k);
    if (e) {
      e.isSigner ||= s;
      e.isWritable ||= w;
    } else {
      table.set(k, { pubkey, isSigner: s, isWritable: w });
      order.push(k);
    }
  };
  add(payer, true, true);
  for (const ix of instructions) {
    for (const a of ix.accounts) add(a.pubkey, a.isSigner, a.isWritable);
    add(ix.programId, false, false);
  }
  const prio = (e) => (e.isSigner && e.isWritable ? 0 : e.isSigner ? 1 : e.isWritable ? 2 : 3);
  const pk = encodeBase58(payer);
  const keys = [
    table.get(pk),
    ...order.filter((k) => k !== pk).map((k) => table.get(k)).sort((a, b) => prio(a) - prio(b) || cmp32(a.pubkey, b.pubkey)),
  ];
  const idx = (p) => keys.findIndex((e) => cmp32(e.pubkey, p) === 0);
  const out = [
    keys.filter((e) => e.isSigner).length,
    keys.filter((e) => e.isSigner && !e.isWritable).length,
    keys.filter((e) => !e.isSigner && !e.isWritable).length,
  ];
  cu16(out, keys.length);
  for (const e of keys) out.push(...e.pubkey);
  out.push(...u64le(validFrom), ...u64le(configHashPrefix), 0);
  cu16(out, instructions.length);
  for (const ix of instructions) {
    out.push(idx(ix.programId));
    cu16(out, ix.accounts.length);
    for (const a of ix.accounts) out.push(idx(a.pubkey));
    cu16(out, ix.data.length);
    out.push(...ix.data);
  }
  return { bytes: new Uint8Array(out), signers: keys.filter((e) => e.isSigner).map((e) => encodeBase58(e.pubkey)) };
}

/** The custom error code in whatever shape the node reports a failure. */
function customCode(text) {
  const m = text.match(/"Custom"\s*:\s*(\d+)/) ?? text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (!m) return null;
  return m[0].includes("0x") ? Number.parseInt(m[1], 16) : Number(m[1]);
}

let sponsor;
/**
 * Sign with the sponsor (fee payer) plus every wallet in `signers`, send, and wait until the node
 * reports the transaction executed or failed. Returns the outcome rather than throwing, so a
 * refusal can be asserted on.
 */
async function send(instructions, signers = []) {
  const wallets = new Map([[sponsor.addr, sponsor], ...signers.map((w) => [w.addr, w])]);
  // validFrom a few seconds in the past: the node rejects a message dated even 2 s ahead of it.
  const msg = compileMessage({ payer: sponsor.pub, instructions, validFrom: BigInt(Date.now() - 4000), configHashPrefix: await configHashPrefix() });
  const sigs = [];
  cu16(sigs, msg.signers.length);
  for (const a of msg.signers) {
    const w = wallets.get(a);
    if (!w) throw new Error(`no key for signer ${a}`);
    sigs.push(...new Uint8Array(await crypto.subtle.sign("Ed25519", w.key, msg.bytes)));
  }
  const tx = concat(Uint8Array.from(sigs), msg.bytes);
  const text = await rpcRaw("sendTransaction", [b64(tx), { encoding: "base64" }]);
  const j = JSON.parse(text);
  if (j.error) return { ok: false, code: customCode(text), detail: text.slice(0, 400), logs: [] };
  const signature = j.result;
  let status = null;
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    const s = await rpc("getSignatureStatuses", [{ signatures: [signature] }]);
    status = s.value[0];
    if (status && (status.executed || status.err)) break;
  }
  let meta = null;
  for (let i = 0; i < 10 && !meta; i++) {
    try {
      meta = (await rpc("getTransaction", [{ signature }]))?.meta ?? null;
    } catch {
      await sleep(200);
    }
  }
  const err = status?.err ?? meta?.err ?? null;
  const logs = meta?.logMessages ?? [];
  const cu = logs.map((l) => l.match(new RegExp(`${PROGRAM_ADDRESS} consumed (\\d+)`))).filter(Boolean).map((m) => Number(m[1]));
  if (!status?.executed && !err) return { ok: false, code: null, detail: `not confirmed: ${JSON.stringify(status)}`, logs, signature };
  return { ok: !err, code: err ? customCode(JSON.stringify(err) + logs.join("\n")) : null, detail: err ? JSON.stringify(err) : "", logs, signature, cu };
}

async function mustSend(label, instructions, signers) {
  const r = await send(instructions, signers);
  if (!r.ok) {
    check(label, false, `${r.detail} ${r.logs.slice(-4).join(" | ")}`);
    throw new Error(`${label} failed; the remaining steps depend on it`);
  }
  return r;
}

async function expectRefusal(label, code, instructions, signers) {
  const r = await send(instructions, signers);
  check(`${label} refused with ${code}`, !r.ok && r.code === code, r.ok ? "it succeeded" : `got ${r.code}${r.code === null ? ` ${r.detail}` : ""}`);
}

/* ------------------------------------------------------------------ instructions */

const meta = (w, isSigner, isWritable) => ({ pubkey: w.pub ?? w, isSigner, isWritable });

function transferIx(from, to, kelvins) {
  return { programId: SYSTEM_ID, accounts: [meta(from, true, true), meta(to, false, true)], data: Uint8Array.from([...u32le(2), ...u64le(kelvins)]) };
}
function createAccountIx(from, account, kelvins, space) {
  return {
    programId: SYSTEM_ID,
    accounts: [meta(from, true, true), meta(account, true, true)],
    data: Uint8Array.from([...u32le(0), ...u64le(kelvins), ...u64le(space), ...PROGRAM_ID]),
  };
}
function createIx(creator, raffle, p) {
  const title = new Uint8Array(32);
  title.set(utf8(p.title).slice(0, 32));
  const data = Uint8Array.from([
    0, ...u64le(p.prize), ...u64le(p.ticketPrice), ...u64le(p.revealBond), ...u16le(p.supply), ...u16le(p.winners),
    ...u64le(p.commitDeadline), ...u64le(p.revealDeadline), ...title,
  ]);
  return { programId: PROGRAM_ID, accounts: [meta(creator, true, true), meta(raffle, false, true), meta(SYSTEM_ID, false, false)], data };
}
function buyIx(buyer, raffle, index, commitment) {
  return { programId: PROGRAM_ID, accounts: [meta(buyer, true, true), meta(raffle, false, true), meta(SYSTEM_ID, false, false)], data: Uint8Array.from([1, ...u16le(index), ...commitment]) };
}
function revealIx(holder, raffle, index, nonce) {
  return { programId: PROGRAM_ID, accounts: [meta(holder, true, true), meta(raffle, false, true)], data: Uint8Array.from([2, ...u16le(index), ...nonce]) };
}
function drawIx(caller, raffle, sysvar = IX_SYSVAR) {
  return { programId: PROGRAM_ID, accounts: [meta(caller, true, false), meta(raffle, false, true), meta(sysvar, false, false)], data: Uint8Array.from([3]) };
}
function claimIx(raffle, recipient, index) {
  return { programId: PROGRAM_ID, accounts: [meta(raffle, false, true), meta(recipient, false, true)], data: Uint8Array.from([4, ...u16le(index)]) };
}

/* ------------------------------------------------------------------ the spec's hashes, in JS */

function commitmentV2(raffle, index, holder, nonce) {
  return sha256(concat(utf8("drawbook-v2|commit|"), raffle, Uint8Array.from(u16le(index)), holder, nonce));
}
function seedV2(raffle, nonces, chainSeed) {
  // Lowercase hex orders exactly as the bytes do, so this is the spec's ascending bytewise sort.
  const sorted = nonces.map(toHex).sort().map((h) => Buffer.from(h, "hex"));
  return sha256(concat(utf8("drawbook-v2|seed|"), raffle, ...sorted, u64be(chainSeed)));
}

/* ------------------------------------------------------------------ decoding */

function decode(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u64 = (o) => dv.getBigUint64(o, true);
  const supply = u16(10);
  const tickets = [];
  for (let i = 1; i <= supply; i++) {
    const t = HEADER_LEN + TICKET_LEN * (i - 1);
    const flags = data[t + 80];
    tickets.push({
      index: i,
      holder: data.slice(t, t + 32),
      commitment: data.slice(t + 32, t + 64),
      nonce: data.slice(t + 64, t + 80),
      revealed: (flags & 1) !== 0,
      won: (flags & 2) !== 0,
      paid: (flags & 4) !== 0,
      reservedZero: data[t + 81] === 0,
      winRank: u16(t + 82),
    });
  }
  return {
    magic: Buffer.from(data.slice(0, 8)).toString("latin1"),
    version: data[8],
    status: data[9],
    supply,
    winners: u16(12),
    sold: u16(14),
    revealed: u16(16),
    effectiveWinners: u16(18),
    creator: data.slice(24, 56),
    prize: u64(56),
    ticketPrice: u64(64),
    revealBond: u64(72),
    commitDeadline: u64(80),
    revealDeadline: u64(88),
    createdAt: u64(96),
    drawnAt: u64(104),
    chainSeed: u64(112),
    seed: data.slice(120, 152),
    pool: u64(152),
    perWinner: u64(160),
    creatorRefunded: data[168],
    reservedZero: data.slice(20, 24).every((b) => b === 0) && data.slice(169, 176).every((b) => b === 0),
    title: Buffer.from(data.slice(176, 208)).toString("utf8").replace(/\0+$/, ""),
    tickets,
    len: data.length,
  };
}
const readRaffle = async (raffle) => {
  const a = await accountInfo(raffle.addr);
  return a ? { ...decode(a.data), kelvins: a.kelvins, owner: a.owner } : null;
};

/* ------------------------------------------------------------------ flows */

let skew = 0n; // chain clock minus local clock, measured at the first Create

async function createRaffle(label, creator, p) {
  const raffle = await newWallet(label);
  const len = HEADER_LEN + TICKET_LEN * p.supply;
  const rent = await rentFor(len);
  const before = Date.now();
  await mustSend(`${label}: create`, [createAccountIx(creator, raffle, rent, len), createIx(creator, raffle, p)], [creator, raffle]);
  const r = await readRaffle(raffle);
  if (skew === 0n) skew = r.createdAt - BigInt(before);
  return { raffle, rent, len };
}

/** Buy the next ticket: nonce and commitment made the way the browser library must make them. */
async function buy(raffle, buyer, index) {
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const commitment = commitmentV2(raffle.pub, index, buyer.pub, nonce);
  await mustSend(`buy ticket ${index}`, [buyIx(buyer, raffle, index, commitment)], [buyer]);
  return { index, holder: buyer, nonce, commitment };
}

async function waitForChainTime(ms) {
  for (;;) {
    const localTarget = Number(BigInt(ms) - skew) + 1500;
    const left = localTarget - Date.now();
    if (left <= 0) return;
    await sleep(Math.min(left, 2000));
  }
}

/** Recompute the draw in JS from public data and compare it with what the program wrote. */
function auditDraw(label, raffle, r) {
  const revealed = r.tickets.filter((t) => t.revealed);
  const seed = seedV2(raffle.pub, revealed.map((t) => t.nonce), r.chainSeed);
  check(`${label}: on-chain seed equals seedV2 recomputed in JS`, eqBytes(seed, r.seed), `${toHex(r.seed).slice(0, 16)}… vs ${toHex(seed).slice(0, 16)}…`);
  const eligible = revealed.map((t) => t.index);
  const expected = deriveWinners(eligible, toHex(seed), r.effectiveWinners);
  const trace = deriveWinnerTrace(eligible, toHex(r.seed), r.winners);
  const onChain = r.tickets.filter((t) => t.won).sort((a, b) => a.winRank - b.winRank).map((t) => t.index);
  check(`${label}: win_rank order equals deriveWinners from lib/raffle.ts`, JSON.stringify(onChain) === JSON.stringify(expected), `chain ${JSON.stringify(onChain)} js ${JSON.stringify(expected)}`);
  check(`${label}: win ranks are exactly 1..${r.effectiveWinners}`, JSON.stringify(r.tickets.filter((t) => t.won).map((t) => t.winRank).sort((a, b) => a - b)) === JSON.stringify(Array.from({ length: r.effectiveWinners }, (_, i) => i + 1)));
  check(`${label}: deriveWinnerTrace agrees step by step`, JSON.stringify(trace.map((s) => s.winner)) === JSON.stringify(onChain));
  return onChain;
}

/** The payout Claim should make for ticket `index` once the raffle is drawn. */
function payoutFor(r, index) {
  const t = r.tickets[index - 1];
  if (!t.won) return 0n;
  const remainder = r.pool - r.perWinner * BigInt(r.effectiveWinners);
  return r.perWinner + (t.winRank === 1 ? remainder : 0n);
}

/* ------------------------------------------------------------------ main */

console.log(`RPC ${RPC}`);
const program = await accountInfo(encodeBase58(PROGRAM_ID));
check(`program ${PROGRAM_ADDRESS.slice(0, 6)}…${PROGRAM_ADDRESS.slice(-5)} is deployed and executable`, !!program && program.owner === "RiscVLoader11111111111111111111111111111111", program ? `owner ${program.owner}, ${program.data.length} bytes` : "no account");

if (PAYER === "faucet") {
  sponsor = await newWallet("sponsor");
  await rpc("requestAirdrop", [{ pubkey: sponsor.addr, kelvins: 4_000_000_000 }]);
  for (let i = 0; i < 50 && (await balance(sponsor.addr)) === 0n; i++) await sleep(200);
} else {
  sponsor = await loadWallet("sponsor", PAYER);
}
info(`sponsor ${sponsor.addr} balance ${await balance(sponsor.addr)}`);

const creator = await newWallet("creator");
const alice = await newWallet("alice");
const bob = await newWallet("bob");
const carol = await newWallet("carol");
const RLO = 1_000_000_000n;
await mustSend("fund test wallets", [
  transferIx(sponsor, creator, (STRESS ? 400n : 100n) * RLO / 1000n),
  transferIx(sponsor, alice, (STRESS ? 300n : 50n) * RLO / 1000n),
  transferIx(sponsor, bob, 50n * RLO / 1000n),
  transferIx(sponsor, carol, 10n * RLO / 1000n),
]);
info(`creator ${creator.addr}  alice ${alice.addr}  bob ${bob.addr}  carol ${carol.addr}`);

const PRICE = 300_000n;
const BOND = 100_000n;
const T0 = Date.now();

/* ---- B and C start first, because they have to sit out their reveal deadline. */

console.log("\n# b) partial reveal (set up now, drawn after its deadline)");
const B = await createRaffle("B", creator, {
  title: "partial reveal", prize: 2_000_000n, ticketPrice: PRICE, revealBond: BOND, supply: 3, winners: 2,
  commitDeadline: T0 + 20_000 + Number(skew), revealDeadline: T0 + 82_000 + Number(skew),
});
info(`chain clock skew vs this machine: ${skew} ms`);
const bTickets = [await buy(B.raffle, alice, 1), await buy(B.raffle, bob, 2), await buy(B.raffle, alice, 3)];
await mustSend("B: reveal 1", [revealIx(alice, B.raffle, 1, bTickets[0].nonce)], [alice]);
await mustSend("B: reveal 2", [revealIx(bob, B.raffle, 2, bTickets[1].nonce)], [bob]);
await expectRefusal("d) draw too early (2 of 3 revealed, before reveal deadline)", 13, [drawIx(carol, B.raffle)], [carol]);

console.log("\n# c) void (set up now, drawn after its deadline)");
const C = await createRaffle("C", creator, {
  title: "nobody reveals", prize: 1_500_000n, ticketPrice: PRICE, revealBond: BOND, supply: 3, winners: 1,
  commitDeadline: Date.now() + 14_000 + Number(skew), revealDeadline: Date.now() + 76_000 + Number(skew),
});
const cTickets = [await buy(C.raffle, alice, 1), await buy(C.raffle, bob, 2)];
await expectRefusal("d) reveal before the sale closed", 8, [revealIx(alice, C.raffle, 1, cTickets[0].nonce)], [alice]);

/* ---- A: the happy path, with most refusals asserted along the way. */

console.log("\n# a) happy path");
const startA = { creator: await balance(creator.addr), alice: await balance(alice.addr), bob: await balance(bob.addr) };
const PRIZE_A = 1_000_001n; // pool 1_900_001 over 2 winners: per_winner 950_000, remainder 1
const pA = {
  title: "Drawbook e2e — happy path", prize: PRIZE_A, ticketPrice: PRICE, revealBond: BOND, supply: 3, winners: 2,
  commitDeadline: Date.now() + 120_000 + Number(skew), revealDeadline: Date.now() + 180_000 + Number(skew),
};
const A = await createRaffle("A", creator, pA);
let rA = await readRaffle(A.raffle);
check("A: account is program-owned and exactly 208 + 84 × 3 bytes", rA.owner === encodeBase58(PROGRAM_ID) && rA.len === 460, `owner ${rA.owner} len ${rA.len}`);
check("A: header fields decode as written", rA.magic === "DRWBOOK1" && rA.version === 1 && rA.status === 0 && rA.supply === 3 && rA.winners === 2 && rA.sold === 0 && rA.prize === PRIZE_A && rA.ticketPrice === PRICE && rA.revealBond === BOND && rA.commitDeadline === BigInt(pA.commitDeadline) && rA.revealDeadline === BigInt(pA.revealDeadline) && eqBytes(rA.creator, creator.pub) && rA.reservedZero);
check("A: title round-trips as UTF-8", rA.title === pA.title, JSON.stringify(rA.title));
check("A: created_at is the chain clock in ms", rA.createdAt > BigInt(T0) - 60_000n && rA.createdAt < BigInt(Date.now()) + 60_000n, `${rA.createdAt}`);
check("A: holds rent + prize after create", rA.kelvins === A.rent + PRIZE_A, `${rA.kelvins} vs ${A.rent + PRIZE_A}`);
check("A: creator paid exactly rent + prize", (await balance(creator.addr)) === startA.creator - A.rent - PRIZE_A);

const a1 = await buy(A.raffle, alice, 1);
{
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  await expectRefusal("d) buy with the wrong ticket index (3 when 2 is next)", 7, [buyIx(bob, A.raffle, 3, commitmentV2(A.raffle.pub, 3, bob.pub, nonce))], [bob]);
}
const a2 = await buy(A.raffle, bob, 2);
const a3 = await buy(A.raffle, alice, 3);
{
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  await expectRefusal("d) buy after the sale closed (sold out)", 6, [buyIx(carol, A.raffle, 4, commitmentV2(A.raffle.pub, 4, carol.pub, nonce))], [carol]);
}
rA = await readRaffle(A.raffle);
check("A: tickets recorded in order with holder and commitment", rA.sold === 3 && [a1, a2, a3].every((t) => eqBytes(rA.tickets[t.index - 1].holder, t.holder.pub) && eqBytes(rA.tickets[t.index - 1].commitment, t.commitment)));
check("A: holds rent + prize + 3 × (price + bond)", rA.kelvins === A.rent + PRIZE_A + 3n * (PRICE + BOND));

{
  const wrong = Uint8Array.from(a1.nonce);
  wrong[0] ^= 0xff;
  await expectRefusal("d) reveal with the wrong nonce", 12, [revealIx(alice, A.raffle, 1, wrong)], [alice]);
}
await expectRefusal("d) reveal by a non-holder", 10, [revealIx(carol, A.raffle, 2, a2.nonce)], [carol]);
const aliceBeforeReveal = await balance(alice.addr);
await mustSend("A: reveal 1", [revealIx(alice, A.raffle, 1, a1.nonce)], [alice]);
check("A: reveal refunds the bond to the holder at once", (await balance(alice.addr)) === aliceBeforeReveal + BOND);
await expectRefusal("d) double reveal", 11, [revealIx(alice, A.raffle, 1, a1.nonce)], [alice]);
await mustSend("A: reveal 2", [revealIx(bob, A.raffle, 2, a2.nonce)], [bob]);
await mustSend("A: reveal 3", [revealIx(alice, A.raffle, 3, a3.nonce)], [alice]);
rA = await readRaffle(A.raffle);
check("A: nonces stored and revealed flags set", rA.revealed === 3 && [a1, a2, a3].every((t) => rA.tickets[t.index - 1].revealed && eqBytes(rA.tickets[t.index - 1].nonce, t.nonce)));
check("A: holds rent + pool before the draw", rA.kelvins === A.rent + PRIZE_A + 3n * PRICE);

// The draw must run alone and be called directly, or anything sharing its transaction could read
// the outcome and make the transaction fail until the result suits it.
await expectRefusal("d) draw followed by another instruction", 17, [drawIx(carol, A.raffle), transferIx(sponsor, carol, 1n)], [carol]);
await expectRefusal("d) draw after another instruction", 17, [transferIx(sponsor, carol, 1n), drawIx(carol, A.raffle)], [carol]);
await expectRefusal("d) draw with a wrong account in place of the instructions sysvar", 17, [drawIx(carol, A.raffle, SYSTEM_ID)], [carol]);
if (CPI_HELPER) {
  const viaCpi = { programId: CPI_HELPER, accounts: [meta(carol, true, false), meta(A.raffle, false, true), meta(IX_SYSVAR, false, false), meta(PROGRAM_ID, false, false)], data: Uint8Array.from([1]) };
  await expectRefusal("d) draw called through another program (CPI)", 17, [viaCpi], [carol]);
} else {
  info("CPI_HELPER not set: the through-CPI refusal is not exercised in this run");
}
const drawA = await mustSend("A: draw", [drawIx(carol, A.raffle)], [carol]);
check("A: draw settles at once when every sold ticket is revealed", drawA.ok, `CU ${drawA.cu?.join(",")}`);
rA = await readRaffle(A.raffle);
check("A: status drawn, effective winners 2, drawn_at set", rA.status === 1 && rA.effectiveWinners === 2 && rA.drawnAt >= rA.createdAt);
check("A: pool and per_winner as specified", rA.pool === PRIZE_A + 3n * PRICE && rA.perWinner === (PRIZE_A + 3n * PRICE) / 2n, `pool ${rA.pool} per ${rA.perWinner}`);
check("A: chain_seed was read at the draw", rA.chainSeed !== 0n, `${rA.chainSeed}`);
const winnersA = auditDraw("A", A.raffle, rA);
check("A: kelvins did not move at the draw", rA.kelvins === A.rent + rA.pool);
await expectRefusal("d) double draw", 14, [drawIx(carol, A.raffle)], [carol]);

const holderOf = (r, i) => [alice, bob, carol, creator].find((w) => eqBytes(w.pub, r.tickets[i - 1].holder));
await expectRefusal("d) claim a winning ticket to the wrong recipient", 10, [claimIx(A.raffle, carol, winnersA[0])]);
const loserA = [1, 2, 3].find((i) => !winnersA.includes(i));
await expectRefusal("d) claim a ticket that did not win", 15, [claimIx(A.raffle, holderOf(rA, loserA), loserA)]);
// Both payouts in one transaction, pushed by the sponsor: Claim needs no signer.
await mustSend("A: claim both winners", winnersA.map((i) => claimIx(A.raffle, holderOf(rA, i), i)));
await expectRefusal("d) double claim", 15, [claimIx(A.raffle, holderOf(rA, winnersA[0]), winnersA[0])]);
const endA = { creator: await balance(creator.addr), alice: await balance(alice.addr), bob: await balance(bob.addr) };
const won = (w) => winnersA.filter((i) => holderOf(rA, i) === w).reduce((s, i) => s + payoutFor(rA, i), 0n);
check("A: alice moved by exactly −2 × price + her winnings", endA.alice - startA.alice === -2n * PRICE + won(alice), `${endA.alice - startA.alice}`);
check("A: bob moved by exactly −price + his winnings", endA.bob - startA.bob === -PRICE + won(bob), `${endA.bob - startA.bob}`);
check("A: winnings add up to the whole pool, remainder to rank 1", won(alice) + won(bob) === rA.pool);
const rA2 = await readRaffle(A.raffle);
check("A: account ends at exactly its rent reserve", rA2.kelvins === A.rent, `${rA2.kelvins} vs ${A.rent}`);
check("A: paid flags set on both winners", winnersA.every((i) => rA2.tickets[i - 1].paid));

/* ---- create refusals */

console.log("\n# d) create refusals");
await expectRefusal("d) create on an initialised account", 3, [createIx(creator, A.raffle, pA)], [creator]);
{
  const fresh = await newWallet("bad");
  const len = HEADER_LEN + TICKET_LEN * 3;
  const rent = await rentFor(len);
  const base = { title: "bad", prize: 0n, ticketPrice: PRICE, revealBond: BOND, supply: 3, winners: 2, commitDeadline: Date.now() + 60_000 + Number(skew), revealDeadline: Date.now() + 180_000 + Number(skew) };
  await expectRefusal("d) bad config: winners above supply", 5, [createAccountIx(creator, fresh, rent, len), createIx(creator, fresh, { ...base, winners: 4 })], [creator, fresh]);
  await expectRefusal("d) bad config: reveal deadline not after commit deadline", 5, [createAccountIx(creator, fresh, rent, len), createIx(creator, fresh, { ...base, revealDeadline: base.commitDeadline })], [creator, fresh]);
  await expectRefusal("d) bad config: commit deadline in the past", 5, [createAccountIx(creator, fresh, rent, len), createIx(creator, fresh, { ...base, commitDeadline: Date.now() - 60_000 + Number(skew) })], [creator, fresh]);
  await expectRefusal("d) bad config: sale longer than 31 days", 5, [createAccountIx(creator, fresh, rent, len), createIx(creator, fresh, { ...base, commitDeadline: Date.now() + 32 * 86_400_000, revealDeadline: Date.now() + 32 * 86_400_000 + 120_000 })], [creator, fresh]);
  await expectRefusal("d) bad config: reveal window under a minute", 5, [createAccountIx(creator, fresh, rent, len), createIx(creator, fresh, { ...base, revealDeadline: base.commitDeadline + 59_000 })], [creator, fresh]);
  await expectRefusal("d) bad config: reveal window over 7 days", 5, [createAccountIx(creator, fresh, rent, len), createIx(creator, fresh, { ...base, revealDeadline: base.commitDeadline + 7 * 86_400_000 + 1 })], [creator, fresh]);
  await expectRefusal("d) bad config: ticket price 0", 5, [createAccountIx(creator, fresh, rent, len), createIx(creator, fresh, { ...base, ticketPrice: 0n })], [creator, fresh]);
  const len1 = HEADER_LEN + TICKET_LEN;
  await expectRefusal("d) bad config: supply 1", 5, [createAccountIx(creator, fresh, await rentFor(len1), len1), createIx(creator, fresh, { ...base, supply: 1, winners: 1 })], [creator, fresh]);
  await expectRefusal("d) unknown instruction tag", 1, [{ programId: PROGRAM_ID, accounts: [meta(A.raffle, false, true)], data: Uint8Array.from([9]) }]);
  await expectRefusal("d) Create data one byte short", 1, [{ ...createIx(creator, A.raffle, pA), data: createIx(creator, A.raffle, pA).data.slice(0, 76) }], [creator]);
}

/* ---- C after its commit deadline: a late buy is refused. */

console.log("\n# c) void, continued");
await waitForChainTime(Number((await readRaffle(C.raffle)).commitDeadline));
{
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  await expectRefusal("d) buy after the commit deadline", 6, [buyIx(carol, C.raffle, 3, commitmentV2(C.raffle.pub, 3, carol.pub, nonce))], [carol]);
}

/* ---- B and C after their reveal deadlines. */

console.log("\n# b) partial reveal, continued");
const startB = { alice: await balance(alice.addr), bob: await balance(bob.addr) };
let rB = await readRaffle(B.raffle);
await waitForChainTime(Number(rB.revealDeadline));
await expectRefusal("d) reveal after the reveal deadline", 9, [revealIx(alice, B.raffle, 3, bTickets[2].nonce)], [alice]);
await mustSend("B: draw after the reveal deadline", [drawIx(carol, B.raffle)], [carol]);
rB = await readRaffle(B.raffle);
const poolB = 2_000_000n + 3n * PRICE + BOND;
check("B: drawn with 2 of 3 revealed", rB.status === 1 && rB.revealed === 2 && rB.effectiveWinners === 2);
check("B: the unrevealed ticket's bond is forfeited into the pool", rB.pool === poolB, `pool ${rB.pool} vs ${poolB}`);
check("B: holds rent + pool after the draw", rB.kelvins === B.rent + poolB);
const winnersB = auditDraw("B", B.raffle, rB);
check("B: the unrevealed ticket cannot win", !winnersB.includes(3) && !rB.tickets[2].won);
await expectRefusal("d) claim on the unrevealed ticket", 15, [claimIx(B.raffle, alice, 3)]);
await mustSend("B: claim both winners", winnersB.map((i) => claimIx(B.raffle, holderOf(rB, i), i)));
const endB = { alice: await balance(alice.addr), bob: await balance(bob.addr) };
const wonB = (w) => winnersB.filter((i) => holderOf(rB, i) === w).reduce((s, i) => s + payoutFor(rB, i), 0n);
check("B: payouts moved exactly", endB.alice - startB.alice === wonB(alice) && endB.bob - startB.bob === wonB(bob) && wonB(alice) + wonB(bob) === poolB);
check("B: account ends at exactly its rent reserve", (await readRaffle(B.raffle)).kelvins === B.rent);

console.log("\n# c) void, continued");
let rC = await readRaffle(C.raffle);
await waitForChainTime(Number(rC.revealDeadline));
const startC = { creator: await balance(creator.addr), alice: await balance(alice.addr), bob: await balance(bob.addr) };
await expectRefusal("d) claim before the raffle is settled", 15, [claimIx(C.raffle, alice, 1)]);
await mustSend("C: draw with no reveals", [drawIx(carol, C.raffle)], [carol]);
rC = await readRaffle(C.raffle);
check("C: status void, drawn_at set, no seed", rC.status === 2 && rC.drawnAt > 0n && rC.chainSeed === 0n && rC.seed.every((b) => b === 0) && rC.pool === 0n);
await expectRefusal("d) draw on a void raffle", 14, [drawIx(carol, C.raffle)], [carol]);
await expectRefusal("d) creator refund to the wrong recipient", 10, [claimIx(C.raffle, carol, 0)]);
await expectRefusal("d) refund of an unsold ticket", 7, [claimIx(C.raffle, carol, 3)]);
await mustSend("C: creator takes the prize back, holders take price + bond", [claimIx(C.raffle, creator, 0), claimIx(C.raffle, alice, 1), claimIx(C.raffle, bob, 2)]);
await expectRefusal("d) second creator refund", 15, [claimIx(C.raffle, creator, 0)]);
await expectRefusal("d) second holder refund", 15, [claimIx(C.raffle, alice, 1)]);
const endC = { creator: await balance(creator.addr), alice: await balance(alice.addr), bob: await balance(bob.addr) };
check("C: creator got exactly the prize back", endC.creator - startC.creator === 1_500_000n);
check("C: each holder got exactly price + bond back", endC.alice - startC.alice === PRICE + BOND && endC.bob - startC.bob === PRICE + BOND);
rC = await readRaffle(C.raffle);
check("C: creator_refunded and paid flags set", rC.creatorRefunded === 1 && rC.tickets[0].paid && rC.tickets[1].paid);
check("C: account ends at exactly its rent reserve", rC.kelvins === C.rent, `${rC.kelvins} vs ${C.rent}`);

/* ---- e) the largest raffle the spec allows, to measure the draw against the compute limit. */

if (STRESS) {
  console.log("\n# e) 200 tickets, 200 winners: the worst-case draw");
  const pE = { title: "max supply", prize: 0n, ticketPrice: 1n, revealBond: 0n, supply: 200, winners: 200, commitDeadline: Date.now() + 600_000 + Number(skew), revealDeadline: Date.now() + 900_000 + Number(skew) };
  const E = await createRaffle("E", creator, pE);
  const eTickets = [];
  for (let start = 1; start <= 200; start += 20) {
    const batch = [];
    for (let i = start; i < start + 20; i++) {
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      eTickets.push({ index: i, nonce });
      batch.push(buyIx(alice, E.raffle, i, commitmentV2(E.raffle.pub, i, alice.pub, nonce)));
    }
    await mustSend(`E: buy ${start}-${start + 19}`, batch, [alice]);
  }
  for (let start = 0; start < 200; start += 25) {
    await mustSend(`E: reveal ${start + 1}-${start + 25}`, eTickets.slice(start, start + 25).map((t) => revealIx(alice, E.raffle, t.index, t.nonce)), [alice]);
  }
  const drawE = await send([drawIx(carol, E.raffle)], [carol]);
  check("E: the 200-winner draw fits the compute budget", drawE.ok, drawE.ok ? `CU ${drawE.cu?.join(",")}` : `${drawE.detail} ${drawE.logs.slice(-3).join(" | ")}`);
  if (drawE.ok) {
    const rE = await readRaffle(E.raffle);
    auditDraw("E", E.raffle, rE);
    check("E: per_winner 1, remainder 0 (pool 200 over 200)", rE.pool === 200n && rE.perWinner === 1n);
  }
}

/* ---- optional: does lib/chain/program.ts (written in parallel) decode the same bytes? */

try {
  const chain = await import("../../lib/chain/program.ts");
  const a = await accountInfo(A.raffle.addr);
  const d = chain.decodeRaffle(A.raffle.addr, a.data, a.kelvins);
  const audit = chain.auditDraw(d);
  const winnersLib = d.tickets.filter((t) => t.won).sort((x, y) => x.winRank - y.winRank).map((t) => t.index);
  info(`XCHECK lib/chain/program.ts decodeRaffle: status=${d.status} sold=${d.sold} pool=${d.pool} winners=${JSON.stringify(winnersLib)} ${JSON.stringify(winnersLib) === JSON.stringify(winnersA) ? "agrees" : "DISAGREES"}`);
  info(`XCHECK lib/chain/program.ts auditDraw: ${audit ? `matches=${audit.matches} seed ${audit.seed === toHex(rA.seed) ? "agrees" : "DISAGREES"}` : "returned null"}`);
  const c = chain.commitmentV2(A.raffle.addr, 1, alice.addr, toHex(a1.nonce));
  info(`XCHECK lib/chain/program.ts commitmentV2: ${c === toHex(a1.commitment) ? "agrees" : "DISAGREES"}`);
} catch (e) {
  info(`XCHECK lib/chain/program.ts not checked: ${String(e?.message ?? e).slice(0, 160)}`);
}

console.log(`\n${failures === 0 ? "ALL PASS" : "FAILURES"}: ${passes} passed, ${failures} failed, ${Math.round((Date.now() - T0) / 1000)} s`);
process.exit(failures === 0 ? 0 : 1);
