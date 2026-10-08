/**
 * Prove lib/chain/ and lib/rialo-rpc.ts agree with program/SPEC.md and with the reference SDK,
 * offline. Every expected value here comes from somewhere other than the code under test: the
 * transaction fixtures were produced by @rialo/ts-cdk 0.18.1, the hashes are recomputed with
 * node:crypto, the account buffers are written field by field from the spec's offset table, and
 * the winners are re-derived by an independent implementation of the spec's keystream.
 *
 * Run: node scripts/verify-chain.ts
 */

import { createHash } from "node:crypto";
import { decodeBase58, encodeBase58 } from "../lib/base58.ts";
import { deriveWinners } from "../lib/raffle.ts";
import { parseConfigHashPrefix, RialoClient, RialoRpcError } from "../lib/rialo-rpc.ts";
import { findNonce, loadNonces, rafflesWithSecrets, saveNonce, storagePersists } from "../lib/chain/nonces.ts";
import {
  accountLength,
  auditDraw,
  buyIx,
  drawIx,
  INSTRUCTIONS_SYSVAR_ID,
  claimableIndices,
  commitmentV2,
  createFits,
  createIx,
  decodeRaffle,
  encodeBuy,
  encodeClaim,
  encodeCreate,
  encodeDraw,
  encodeReveal,
  encodeTitle,
  errorMessage,
  HEADER_LEN,
  payoutOf,
  phaseOf,
  PROGRAM_ID,
  seedV2,
  systemCreateAccountIx,
  TICKET_LEN,
  U64_MAX,
  type CreateParams,
} from "../lib/chain/program.ts";
import {
  CLOCK_SYSVAR_ID,
  decodeSubscription,
  destroyScheduleIx,
  drawSchedule,
  DUE_WINDOW_MS,
  encodeDestroy,
  encodeSubscribe,
  encodeSubscription,
  encodeUnsubscribe,
  findProgramAddress,
  isDrawbookSchedule,
  isOnCurve,
  readFiring,
  reclaimScheduleIxs,
  SCHEDULE_LEN,
  scheduleAddress,
  scheduleNonce,
  scheduleNonceText,
  scheduleState,
  subscribeDrawIx,
  SUBSCRIBER_PROGRAM_ID,
  type ScheduleRead,
  type Subscription,
} from "../lib/chain/subscriber.ts";
import {
  ChainError,
  compileMessage,
  customErrorCode,
  failedInstruction,
  failureText,
  INSUFFICIENT_FUNDS,
  refusalText,
  sendAndConfirm,
  signatureOf,
  signTransaction,
  type Instruction,
  type TxSigner,
} from "../lib/chain/tx.ts";

let failures = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail && !condition ? ` :: ${detail}` : ""}`);
}
function section(name: string) {
  console.log(`\n${name}`);
}

const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const bytesOf = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));
const big = (text: string) => BigInt(text);
const nodeSha = (...parts: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};

/* ------------------------------------------------------------- fixtures */

/*
 * Frozen from @rialo/ts-cdk 0.18.1 on 2026-10-07 (TransactionBuilder, createAccount, signAll),
 * with Ed25519 secret keys of 32 repeated bytes 0x11, 0x22 and 0x33. Ed25519 signatures are
 * deterministic, so a Web Crypto signature over the same message must equal the SDK's byte for byte.
 */
const FIXTURE = {
  seeds: { creator: 0x11, raffle: 0x22, buyer: 0x33 },
  pubkeys: {
    creator: "F25s3DdjXdCxYBhh2z8FBusVEMT4b9bGNFVKJi3wFoF4",
    raffle: "Bow1CGKGDB9mNxeWdw85E2aCthQ1oZX4oFEe7fYT17ew",
    buyer: "2btLJAAb1S3x6hZYdVyAePjqtQYi2ZBSRGy4569RZu8h",
  },
  validFrom: big("1791340000000"),
  configHashPrefix: big("11774740490753875893"),
  rent: big("4677120"),
  nonce: "00112233445566778899aabbccddeeff",
  commitment: "1d2c31de01a785736fd5af1fea471146e37d57480e6ef9d127c770a0dbd091ac",
  createAccountData:
    "00000000005e47000000000020020000000000005a00c372ce98b29a88b7e3926a4987fc274b97a608f2d272ef2bddf0c8d7281b",
  createTx:
    "022753d6ba4c1dbef1550fc0ab9d38d34f5d212673b84629357ef6897565b9f94890a842c7ec89b7eb5e60dadcd9fab2147894639b04ca0fbc0a8f2985deb1af0a84966a39c24be6832d7d94b77596ac04aebc422afc0757dd5a7a1dfab26c0fdaf119eec46230663b05da3ffcef4e3081ca767c0111ff2954698a681f59b9d00702000204d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f000000000000000000000000000000000000000000000000000000000000000005a00c372ce98b29a88b7e3926a4987fc274b97a608f2d272ef2bddf0c8d7281b00332f14a1010000b51fcb51174868a30002020200013400000000005e47000000000020020000000000005a00c372ce98b29a88b7e3926a4987fc274b97a608f2d272ef2bddf0c8d7281b03030001024d0000e1f505000000008096980000000000404b4c000000000004000200c05a3814a101000080824114a10100004669787475726520726166666c65000000000000000000000000000000000000",
  buyTx:
    "01aef35f4676c384773e916d0e8a723773761d0ba9aa4ff13bd61344cf6d1d68a310d38dfe825cdd031adc506b8a10f51127c5757efc02ec9d697dc87e2dbef10a0100020417cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080cea09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f000000000000000000000000000000000000000000000000000000000000000005a00c372ce98b29a88b7e3926a4987fc274b97a608f2d272ef2bddf0c8d7281b00332f14a1010000b51fcb51174868a300010303000102230101001d2c31de01a785736fd5af1fea471146e37d57480e6ef9d127c770a0dbd091ac",
};

const FIXTURE_PARAMS: CreateParams = {
  title: "Fixture raffle",
  prize: big("100000000"),
  ticketPrice: big("10000000"),
  revealBond: big("5000000"),
  supply: 4,
  winners: 2,
  commitDeadline: 1791340600000,
  revealDeadline: 1791341200000,
};

/** A Web Crypto key from a raw 32-byte Ed25519 seed, through the fixed PKCS#8 prefix. */
async function signerFromSeed(byte: number): Promise<TxSigner> {
  const pkcs8 = new Uint8Array([...bytesOf("302e020100300506032b657004220420"), ...new Uint8Array(32).fill(byte)]);
  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  // Web Crypto has no private-to-public call, but the private JWK carries the public key as `x`.
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  return { publicKey: new Uint8Array(Buffer.from(jwk.x as string, "base64url")), privateKey };
}

section("transaction encoder against @rialo/ts-cdk fixtures");
{
  const creator = await signerFromSeed(FIXTURE.seeds.creator);
  const raffle = await signerFromSeed(FIXTURE.seeds.raffle);
  const buyer = await signerFromSeed(FIXTURE.seeds.buyer);
  ok("creator key derives the SDK's address", encodeBase58(creator.publicKey) === FIXTURE.pubkeys.creator);
  ok("raffle key derives the SDK's address", encodeBase58(raffle.publicKey) === FIXTURE.pubkeys.raffle);
  ok("buyer key derives the SDK's address", encodeBase58(buyer.publicKey) === FIXTURE.pubkeys.buyer);

  const len = accountLength(FIXTURE_PARAMS.supply);
  const createAccount = systemCreateAccountIx(creator.publicKey, raffle.publicKey, FIXTURE.rent, len, decodeBase58(PROGRAM_ID));
  ok("System CreateAccount data equals the SDK's", hexOf(createAccount.data) === FIXTURE.createAccountData);
  ok("System CreateAccount data is 52 bytes", createAccount.data.length === 52);

  const createMessage = compileMessage({
    payer: creator.publicKey,
    instructions: [createAccount, createIx(creator.publicKey, raffle.publicKey, FIXTURE_PARAMS)],
    validFrom: FIXTURE.validFrom,
    configHashPrefix: FIXTURE.configHashPrefix,
  });
  ok("the Create transaction needs two signatures", createMessage.signers.length === 2);
  ok("the fee payer signs first", encodeBase58(createMessage.signers[0]) === FIXTURE.pubkeys.creator);

  // Signers handed over in the wrong order on purpose: placement must follow the message.
  const createTx = await signTransaction(createMessage, [raffle, creator]);
  ok("two-signer Create transaction is byte-identical to the SDK's", hexOf(createTx) === FIXTURE.createTx, hexOf(createTx));
  ok("its id is the fee payer's signature", signatureOf(createTx) === encodeBase58(bytesOf(FIXTURE.createTx).subarray(1, 65)));

  const commitment = commitmentV2(FIXTURE.pubkeys.raffle, 1, FIXTURE.pubkeys.buyer, FIXTURE.nonce);
  ok("fixture commitment is unchanged", commitment === FIXTURE.commitment);
  const buyMessage = compileMessage({
    payer: buyer.publicKey,
    instructions: [buyIx(buyer.publicKey, raffle.publicKey, 1, commitment)],
    validFrom: FIXTURE.validFrom,
    configHashPrefix: FIXTURE.configHashPrefix,
  });
  const buyTx = await signTransaction(buyMessage, [buyer]);
  ok("one-signer Buy transaction is byte-identical to the SDK's", hexOf(buyTx) === FIXTURE.buyTx, hexOf(buyTx));

  let refused = false;
  try {
    await signTransaction(createMessage, [creator]);
  } catch {
    refused = true;
  }
  ok("signing without the raffle key is refused locally", refused);
}

/* ------------------------------------------------------ configHashPrefix */

section("configHashPrefix is read as an exact u64");
{
  const text = '{"jsonrpc":"2.0","id":1,"result":{"version":0,"configHashPrefix":11774740490753875893}}';
  const exact = parseConfigHashPrefix(text);
  ok("parsed from the raw text exactly", exact === big("11774740490753875893"), exact.toString());
  const lossy = BigInt((JSON.parse(text) as { result: { configHashPrefix: number } }).result.configHashPrefix);
  ok("JSON.parse really would have rounded it", lossy !== exact, lossy.toString());
  ok("the u64 maximum survives", parseConfigHashPrefix('{"configHashPrefix": 18446744073709551615}') === big("18446744073709551615"));
}

/* ------------------------------------------------- RPC shapes, with fetch stubbed */

section("RPC client shapes (fetch stubbed, nothing leaves this machine)");
{
  const realFetch = globalThis.fetch;
  const requests: { method: string; params: unknown }[] = [];
  let respond: (method: string, params: unknown) => { status: number; text: string } = () => ({ status: 200, text: "{}" });
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown };
    requests.push(body);
    const r = respond(body.method, body.params);
    return new Response(r.text, { status: r.status });
  }) as typeof fetch;

  try {
    const client = new RialoClient("http://stub.invalid");

    respond = () => ({
      status: 200,
      text: '{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":{"kelvin":9007199254740993,"owner":"74LNM1Hn6BCQpHyzHYkqrQP4H6N1At3CsiZ6CH4UsMG6","data":["AQID","base64"],"executable":false,"rentEpoch":18446744073709551615,"space":3}}}',
    });
    const account = await client.getAccountInfo("F25s3DdjXdCxYBhh2z8FBusVEMT4b9bGNFVKJi3wFoF4");
    ok("getAccountInfo keeps kelvins above 2^53 exact", account?.kelvins === big("9007199254740993"), String(account?.kelvins));
    ok("getAccountInfo decodes base64 data", account !== null && hexOf(account.data) === "010203");
    ok("getAccountInfo sends { address }", JSON.stringify(requests.at(-1)?.params) === '[{"address":"F25s3DdjXdCxYBhh2z8FBusVEMT4b9bGNFVKJi3wFoF4"}]');

    respond = () => ({ status: 200, text: '{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":null}}' });
    ok("getAccountInfo answers null for a missing account", (await client.getAccountInfo("11111111111111111111111111111111")) === null);

    respond = () => ({ status: 200, text: '{"jsonrpc":"2.0","id":1,"result":3507840}' });
    const rent = await client.getMinimumBalanceForRentExemption(376);
    ok("rent is read as a bigint", rent === big("3507840"));
    ok("rent sends { data_length }", JSON.stringify(requests.at(-1)?.params) === '[{"data_length":376}]');

    respond = () => ({ status: 200, text: '{"jsonrpc":"2.0","id":1,"result":"SIG"}' });
    await client.sendTransaction("AAEC");
    ok("sendTransaction uses positional params", JSON.stringify(requests.at(-1)?.params) === '["AAEC",{"encoding":"base64"}]');

    respond = () => ({
      status: 422,
      text: '{"jsonrpc":"2.0","id":1,"error":{"code":-32002,"message":"Transaction validation failed: InvalidConfigHashPrefix"}}',
    });
    let refusal = "";
    try {
      await client.sendTransaction("AAEC");
    } catch (error) {
      refusal = error instanceof Error ? error.message : "";
    }
    ok("a 422 refusal keeps the node's explanation", refusal.includes("InvalidConfigHashPrefix"), refusal);

    respond = () => ({ status: 200, text: '{"jsonrpc":"2.0","id":1,"result":{"version":0,"configHashPrefix":11774740490753875893}}' });
    ok("getConfigHashPrefix is exact end to end", (await client.getConfigHashPrefix()) === big("11774740490753875893"));

    const page = (keys: string[], next: string | null) =>
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          value: keys.map((k) => ({ pubkey: k, account: { kelvin: 1, owner: PROGRAM_ID, data: ["", "base64"], executable: false, space: 0 } })),
          pagination: { has_more: next !== null, next_cursor: next },
        },
      });
    requests.length = 0;
    respond = (_m, params) => {
      const after = (params as { config: { after?: string } }[])[0].config.after;
      return { status: 200, text: after ? page(["C"], null) : page(["A", "B"], "B") };
    };
    const owned = await client.getAccountsByOwner(PROGRAM_ID);
    ok("getAccountsByOwner follows the cursor to the end", owned.map((o) => o.address).join("") === "ABC");
    const first = (requests[0].params as { owner: string; filter: { type: string } }[])[0];
    ok("getAccountsByOwner asks for programAccounts", first.owner === PROGRAM_ID && first.filter.type === "programAccounts");
  } finally {
    globalThis.fetch = realFetch;
  }
}

/* ---------------------------------------------------------- instructions */

section("instruction data lengths and layouts");
{
  const create = encodeCreate(FIXTURE_PARAMS);
  const v = new DataView(create.buffer, create.byteOffset, create.byteLength);
  ok("Create is 77 bytes", create.length === 77, String(create.length));
  ok("Create tag 0", create[0] === 0);
  ok("Create prize u64 LE at 1", v.getBigUint64(1, true) === FIXTURE_PARAMS.prize);
  ok("Create ticket_price at 9", v.getBigUint64(9, true) === FIXTURE_PARAMS.ticketPrice);
  ok("Create reveal_bond at 17", v.getBigUint64(17, true) === FIXTURE_PARAMS.revealBond);
  ok("Create supply u16 at 25", v.getUint16(25, true) === 4);
  ok("Create winners u16 at 27", v.getUint16(27, true) === 2);
  ok("Create commit_deadline at 29", v.getBigUint64(29, true) === BigInt(FIXTURE_PARAMS.commitDeadline));
  ok("Create reveal_deadline at 37", v.getBigUint64(37, true) === BigInt(FIXTURE_PARAMS.revealDeadline));
  ok(
    "Create title zero padded at 45",
    Buffer.from(create.subarray(45, 59)).toString() === "Fixture raffle" && create.subarray(59).every((b) => b === 0),
  );

  const buy = encodeBuy(258, FIXTURE.commitment);
  ok("Buy is 35 bytes", buy.length === 35);
  ok("Buy tag 1, index u16 LE", buy[0] === 1 && buy[1] === 2 && buy[2] === 1);
  ok("Buy commitment at 3", hexOf(buy.subarray(3)) === FIXTURE.commitment);

  const reveal = encodeReveal(3, FIXTURE.nonce);
  ok("Reveal is 19 bytes", reveal.length === 19);
  ok("Reveal tag 2, index, nonce", reveal[0] === 2 && reveal[1] === 3 && reveal[2] === 0 && hexOf(reveal.subarray(3)) === FIXTURE.nonce);

  const draw = encodeDraw();
  ok("Draw is 1 byte, tag 3", draw.length === 1 && draw[0] === 3);

  const claim = encodeClaim(0x0102);
  ok("Claim is 3 bytes, tag 4, index u16 LE", claim.length === 3 && claim[0] === 4 && claim[1] === 2 && claim[2] === 1);

  // "a" then two-byte characters puts byte 32 in the middle of one, so the cut must step back.
  const long = encodeTitle("a" + "é".repeat(20));
  ok(
    "a long title is cut at a character boundary",
    long.length === 32 && long[31] === 0 && Buffer.from(long.subarray(0, 31)).toString() === "a" + "é".repeat(15),
  );
}

/* --------------------------------------------------------------- hashes */

const RAFFLE = FIXTURE.pubkeys.raffle;
const HOLDERS = [FIXTURE.pubkeys.buyer, FIXTURE.pubkeys.creator, "11111111111111111111111111111112"];

function u16le(n: number) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

section("commitmentV2 and seedV2 against node:crypto");
{
  const nonce = "ffeeddccbbaa99887766554433221100";
  const expected = nodeSha(
    Buffer.from("drawbook-v2|commit|"),
    decodeBase58(RAFFLE),
    u16le(5),
    decodeBase58(HOLDERS[0]),
    bytesOf(nonce),
  );
  ok("commit domain string is 19 bytes", Buffer.from("drawbook-v2|commit|").length === 19);
  ok("commitmentV2 equals node:crypto", commitmentV2(RAFFLE, 5, HOLDERS[0], nonce) === hexOf(expected));
  ok("commitmentV2 binds the index", commitmentV2(RAFFLE, 6, HOLDERS[0], nonce) !== hexOf(expected));
  ok("commitmentV2 binds the holder", commitmentV2(RAFFLE, 5, HOLDERS[1], nonce) !== hexOf(expected));

  const nonces = ["c0".repeat(16), "0a".repeat(16), "ff".repeat(16), "0b".repeat(16)];
  const chainSeed = big("81985529216486895"); // 0x0123456789abcdef
  const sorted = [...nonces].sort();
  const chainBE = bytesOf("0123456789abcdef");
  const expectedSeed = nodeSha(Buffer.from("drawbook-v2|seed|"), decodeBase58(RAFFLE), ...sorted.map(bytesOf), chainBE);
  ok("seed domain string is 17 bytes", Buffer.from("drawbook-v2|seed|").length === 17);
  ok("seedV2 equals node:crypto (sorted nonces, chain seed big-endian)", seedV2(RAFFLE, nonces, chainSeed) === hexOf(expectedSeed));
  ok("seedV2 ignores reveal order", seedV2(RAFFLE, [...nonces].reverse(), chainSeed) === hexOf(expectedSeed));
  ok("seedV2 sorts uppercase hex the same as lowercase", seedV2(RAFFLE, nonces.map((n) => n.toUpperCase()), chainSeed) === hexOf(expectedSeed));
}

/* ------------------------------------------------- account buffers + audit */

/** The spec's keystream, written again from its prose with node:crypto, to check the audit with. */
function independentWinners(eligible: number[], seedHex: string, count: number): number[] {
  const pool = [...eligible];
  const out: number[] = [];
  let block = Buffer.alloc(0);
  let at = 0;
  let k = 0;
  while (out.length < Math.min(count, eligible.length)) {
    if (block.length - at < 6) {
      block = createHash("sha256").update(Buffer.from(seedHex, "hex")).update(`|draw|${k}`).digest();
      k += 1;
      at = 0;
    }
    const sample = block.readUIntBE(at, 6);
    at += 6;
    out.push(pool.splice(sample % pool.length, 1)[0]);
  }
  return out;
}

interface TicketSpec {
  holder: string | null;
  nonce?: string;
  revealed?: boolean;
  won?: boolean;
  paid?: boolean;
  winRank?: number;
}

/** Write a raffle account straight from the spec's offset table, without the library's help. */
function buildAccount(h: {
  status: number;
  supply: number;
  winners: number;
  effectiveWinners: number;
  creator: string;
  prize: bigint;
  ticketPrice: bigint;
  revealBond: bigint;
  commitDeadline: number;
  revealDeadline: number;
  createdAt: number;
  drawnAt: number;
  chainSeed: bigint;
  seed: string | null;
  pool: bigint;
  perWinner: bigint;
  creatorRefunded: boolean;
  title: string;
  tickets: TicketSpec[];
}): Uint8Array {
  const data = new Uint8Array(HEADER_LEN + TICKET_LEN * h.supply);
  const v = new DataView(data.buffer);
  data.set(Buffer.from("DRWBOOK1"), 0);
  data[8] = 1;
  data[9] = h.status;
  const sold = h.tickets.filter((t) => t.holder).length;
  const revealed = h.tickets.filter((t) => t.revealed).length;
  v.setUint16(10, h.supply, true);
  v.setUint16(12, h.winners, true);
  v.setUint16(14, sold, true);
  v.setUint16(16, revealed, true);
  v.setUint16(18, h.effectiveWinners, true);
  data.set(decodeBase58(h.creator), 24);
  v.setBigUint64(56, h.prize, true);
  v.setBigUint64(64, h.ticketPrice, true);
  v.setBigUint64(72, h.revealBond, true);
  v.setBigUint64(80, BigInt(h.commitDeadline), true);
  v.setBigUint64(88, BigInt(h.revealDeadline), true);
  v.setBigUint64(96, BigInt(h.createdAt), true);
  v.setBigUint64(104, BigInt(h.drawnAt), true);
  v.setBigUint64(112, h.chainSeed, true);
  if (h.seed) data.set(bytesOf(h.seed), 120);
  v.setBigUint64(152, h.pool, true);
  v.setBigUint64(160, h.perWinner, true);
  data[168] = h.creatorRefunded ? 1 : 0;
  data.set(Buffer.from(h.title), 176);
  h.tickets.forEach((t, i) => {
    const at = HEADER_LEN + TICKET_LEN * i;
    if (!t.holder) return;
    data.set(decodeBase58(t.holder), at);
    const nonce = t.nonce ?? "00".repeat(16);
    data.set(bytesOf(commitmentV2(RAFFLE, i + 1, t.holder, nonce)), at + 32);
    if (t.revealed) data.set(bytesOf(nonce), at + 64);
    data[at + 80] = (t.revealed ? 1 : 0) | (t.won ? 2 : 0) | (t.paid ? 4 : 0);
    v.setUint16(at + 82, t.winRank ?? 0, true);
  });
  return data;
}

const NONCES = [
  "1f".repeat(16),
  "a3b1c2d4e5f60718293a4b5c6d7e8f90",
  "77".repeat(16),
  "0123456789abcdeffedcba9876543210",
  "e0".repeat(16),
];
const PRICE = big("10000000");
const BOND = big("5000000");
const PRIZE = big("100000000");
const CHAIN_SEED = big("16045690984833335023"); // 0xdeadbeefdeadbeef, above 2^63 on purpose

/** A drawn raffle: six tickets, five sold, ticket 3 never revealed, two winners. */
function drawnFixture() {
  const revealedIdx = [1, 2, 4, 5];
  const seed = hexOf(
    nodeSha(
      Buffer.from("drawbook-v2|seed|"),
      decodeBase58(RAFFLE),
      ...revealedIdx.map((i) => NONCES[i - 1]).sort().map(bytesOf),
      bytesOf("deadbeefdeadbeef"),
    ),
  );
  const winners = independentWinners(revealedIdx, seed, 2);
  const sold = 5;
  const revealed = 4;
  const pool = PRIZE + BigInt(sold) * PRICE + BigInt(sold - revealed) * BOND;
  const perWinner = pool / BigInt(2);
  const tickets: TicketSpec[] = [1, 2, 3, 4, 5, 6].map((i) => {
    if (i === 6) return { holder: null };
    const rank = winners.indexOf(i) + 1;
    return {
      holder: HOLDERS[i % HOLDERS.length],
      nonce: NONCES[i - 1],
      revealed: i !== 3,
      won: rank > 0,
      winRank: rank,
    };
  });
  const header = {
    status: 1,
    supply: 6,
    winners: 2,
    effectiveWinners: 2,
    creator: FIXTURE.pubkeys.creator,
    prize: PRIZE,
    ticketPrice: PRICE,
    revealBond: BOND,
    commitDeadline: 1791340600000,
    revealDeadline: 1791341200000,
    createdAt: 1791340000000,
    drawnAt: 1791341300000,
    chainSeed: CHAIN_SEED,
    seed,
    pool,
    perWinner,
    creatorRefunded: false,
    title: "Audit fixture",
    tickets,
  };
  return { header, seed, winners, pool, perWinner, revealedIdx };
}

section("decodeRaffle on a hand-built account");
{
  const f = drawnFixture();
  const data = buildAccount(f.header);
  ok("account length is 208 + 84 * supply", data.length === accountLength(6) && accountLength(6) === 712);
  const r = decodeRaffle(RAFFLE, data, big("123456789"));
  ok("status drawn", r.status === "drawn");
  ok("supply, winners, sold, revealed, effective winners", r.supply === 6 && r.winners === 2 && r.sold === 5 && r.revealed === 4 && r.effectiveWinners === 2);
  ok("creator", r.creator === FIXTURE.pubkeys.creator);
  ok("prize, price, bond", r.prize === PRIZE && r.ticketPrice === PRICE && r.revealBond === BOND);
  ok("deadlines and times in ms", r.commitDeadline === 1791340600000 && r.revealDeadline === 1791341200000 && r.createdAt === 1791340000000 && r.drawnAt === 1791341300000);
  ok("chain seed above 2^63 kept exact", r.chainSeed === CHAIN_SEED);
  ok("seed as hex", r.seed === f.seed);
  ok("pool and per winner", r.pool === f.pool && r.perWinner === f.perWinner);
  ok("title trimmed of padding", r.title === "Audit fixture");
  ok("kelvins passed through", r.kelvins === big("123456789"));
  ok("six tickets, 1-based", r.tickets.length === 6 && r.tickets[0].index === 1 && r.tickets[5].index === 6);
  ok("unsold ticket has no holder, commitment or nonce", r.tickets[5].holder === null && r.tickets[5].commitment === null && r.tickets[5].nonce === null);
  ok("unrevealed ticket hides its nonce", r.tickets[2].holder !== null && r.tickets[2].nonce === null && !r.tickets[2].revealed);
  ok("revealed ticket shows its nonce", r.tickets[0].nonce === NONCES[0] && r.tickets[0].revealed);
  ok(
    "commitment decoded as stored",
    r.tickets[1].commitment === commitmentV2(RAFFLE, 2, HOLDERS[2], NONCES[1]),
  );
  ok("win ranks decoded", f.winners.every((w, i) => r.tickets[w - 1].won && r.tickets[w - 1].winRank === i + 1));

  let threw = false;
  try {
    decodeRaffle(RAFFLE, new Uint8Array(712), big("0"));
  } catch {
    threw = true;
  }
  ok("an uninitialised account is refused", threw);
}

section("auditDraw is a real comparison against chain data");
{
  const f = drawnFixture();
  ok("the independent keystream agrees with lib/raffle.ts deriveWinners", f.winners.join() === deriveWinners(f.revealedIdx, f.seed, 2).join());

  const audit = auditDraw(decodeRaffle(RAFFLE, buildAccount(f.header), big("0")));
  ok("consistent account audits true", audit?.matches === true);
  ok("audit seed equals the independently computed seed", audit?.seed === f.seed);
  ok("audit winners equal the independent winners", audit?.winners.join() === f.winners.join());

  const tamper = (edit: (h: ReturnType<typeof drawnFixture>["header"]) => void, raw?: (d: Uint8Array) => void) => {
    const g = drawnFixture();
    edit(g.header);
    const data = buildAccount(g.header);
    if (raw) raw(data);
    return auditDraw(decodeRaffle(RAFFLE, data, big("0")))?.matches;
  };

  const [w1, w2] = f.winners;
  ok(
    "swapped win ranks audit false",
    tamper((h) => {
      h.tickets[w1 - 1].winRank = 2;
      h.tickets[w2 - 1].winRank = 1;
    }) === false,
  );
  ok(
    "one win rank moved to a non-winner audits false",
    tamper((h) => {
      const loser = f.revealedIdx.find((i) => !f.winners.includes(i))!;
      h.tickets[w2 - 1].won = false;
      h.tickets[w2 - 1].winRank = 0;
      h.tickets[loser - 1].won = true;
      h.tickets[loser - 1].winRank = 2;
    }) === false,
  );
  ok(
    "one tampered nonce audits false",
    tamper(() => {}, (d) => {
      d[HEADER_LEN + TICKET_LEN * 0 + 64] ^= 0x01;
    }) === false,
  );
  ok(
    "a tampered chain seed audits false",
    tamper((h) => {
      h.chainSeed = h.chainSeed - BigInt(1);
    }) === false,
  );
  ok(
    "a tampered stored seed audits false",
    tamper(() => {}, (d) => {
      d[120] ^= 0x80;
    }) === false,
  );
  ok("an open raffle has nothing to audit", auditDraw(decodeRaffle(RAFFLE, buildAccount({ ...f.header, status: 0 }), big("0"))) === null);
}

/* ---------------------------------------------------------- phase, payouts */

section("phaseOf, payoutOf and claimableIndices follow the spec");
{
  const f = drawnFixture();
  const open = (tickets: TicketSpec[], supply = 6) =>
    decodeRaffle(
      RAFFLE,
      buildAccount({ ...f.header, status: 0, supply, effectiveWinners: 0, seed: null, chainSeed: big("0"), pool: big("0"), perWinner: big("0"), drawnAt: 0, tickets }),
      big("0"),
    );
  const before = f.header.commitDeadline - 1;
  const between = f.header.commitDeadline + 1;
  const after = f.header.revealDeadline;

  const partly = open([{ holder: HOLDERS[0] }, { holder: HOLDERS[1], nonce: NONCES[1], revealed: true }, { holder: null }, { holder: null }, { holder: null }, { holder: null }]);
  ok("selling before the commit deadline", phaseOf(partly, before) === "selling");
  ok("revealing after it while reveals are outstanding", phaseOf(partly, between) === "revealing");
  ok("ready at the reveal deadline", phaseOf(partly, after) === "ready");

  const soldOut = open([{ holder: HOLDERS[0] }, { holder: HOLDERS[1] }], 2);
  ok("sold out closes the sale early", phaseOf(soldOut, before) === "revealing");
  const allRevealed = open([{ holder: HOLDERS[0], revealed: true }, { holder: HOLDERS[1], revealed: true }], 2);
  ok("sold out and fully revealed is ready at once", phaseOf(allRevealed, before) === "ready");
  const empty = open([{ holder: null }, { holder: null }], 2);
  ok("no sales: ready as soon as the sale closes", phaseOf(empty, before) === "selling" && phaseOf(empty, between) === "ready");

  const drawn = decodeRaffle(RAFFLE, buildAccount(f.header), big("0"));
  ok("drawn is drawn", phaseOf(drawn, after) === "drawn");
  const [w1, w2] = f.winners;
  const rem = f.pool - f.perWinner * BigInt(2);
  ok("first winner gets per_winner plus the remainder", payoutOf(drawn, w1) === f.perWinner + rem);
  ok("second winner gets per_winner", payoutOf(drawn, w2) === f.perWinner);
  ok("winners' payouts sum to the pool", payoutOf(drawn, w1) + payoutOf(drawn, w2) === f.pool);
  ok("a loser gets nothing", payoutOf(drawn, f.revealedIdx.find((i) => !f.winners.includes(i))!) === big("0"));
  const paidHeader = drawnFixture().header;
  paidHeader.tickets[w1 - 1].paid = true;
  ok("a paid winner gets nothing more", payoutOf(decodeRaffle(RAFFLE, buildAccount(paidHeader), big("0")), w1) === big("0"));

  const voidHeader = { ...drawnFixture().header, status: 2, effectiveWinners: 0, seed: null, chainSeed: big("0"), pool: big("0"), perWinner: big("0") };
  voidHeader.tickets = voidHeader.tickets.map((t) => ({ ...t, revealed: false, won: false, winRank: 0 }));
  const voided = decodeRaffle(RAFFLE, buildAccount(voidHeader), big("0"));
  ok("void: creator is refunded the prize at index 0", payoutOf(voided, 0) === PRIZE);
  ok("void: a holder is refunded price and bond", payoutOf(voided, 1) === PRICE + BOND);
  ok("void: an unsold ticket refunds nothing", payoutOf(voided, 6) === big("0"));
  ok(
    "void: the creator's claimable list starts with the prize",
    claimableIndices(voided, FIXTURE.pubkeys.creator).join() === [0, ...[1, 2, 3, 4, 5].filter((i) => HOLDERS[i % 3] === FIXTURE.pubkeys.creator)].join(),
  );
  ok("drawn: a holder's claimable list is their unpaid wins", claimableIndices(drawn, HOLDERS[w1 % 3]).includes(w1));
}

/* ---------------------------------------------------------------- errors */

section("refusals are attributed to the program that made them");
{
  const raffleKey = decodeBase58(FIXTURE.pubkeys.raffle);
  const creator = decodeBase58(FIXTURE.pubkeys.creator);
  const program = decodeBase58(PROGRAM_ID);
  const ixs = [
    systemCreateAccountIx(creator, raffleKey, FIXTURE.rent, 544, program),
    createIx(creator, raffleKey, FIXTURE_PARAMS),
  ];
  ok("program failure log gives the code", customErrorCode(null, [`Program ${PROGRAM_ID} failed: custom program error: 0x7`], ixs, program) === 7);
  ok("a hex code above 9 is read as hex", customErrorCode(null, [`Program ${PROGRAM_ID} failed: custom program error: 0x10`], ixs, program) === 16);
  ok("Debug-rendered status error on the program's instruction", customErrorCode("InstructionError(1, Custom(5))", [], ixs, program) === 5);
  ok("object status error, as the node sends it, on the program's instruction", customErrorCode({ InstructionError: [1, { Custom: 12 }] }, [], ixs, program) === 12);
  ok("an object status error on the System instruction is not a raffle code", customErrorCode({ InstructionError: [0, { Custom: 1 }] }, [], ixs, program) === null);
  ok("a System program code is not read as a raffle code", customErrorCode("InstructionError(0, Custom(1))", [], ixs, program) === null);
  ok(
    "another program's failure log is ignored",
    customErrorCode(null, ["Program 11111111111111111111111111111111 failed: custom program error: 0x1"], ixs, program) === null,
  );
  ok("every spec code has its own sentence", Array.from({ length: 16 }, (_, i) => errorMessage(i + 1)).every((m, _, all) => !m.includes("(error") && all.indexOf(m) === all.lastIndexOf(m)));
}

section("a failing call the program made is not the program's refusal (BC-4)");
{
  const program = decodeBase58(PROGRAM_ID);
  const buyer = decodeBase58(FIXTURE.pubkeys.buyer);
  const raffleKey = decodeBase58(FIXTURE.pubkeys.raffle);
  const ixs = [buyIx(buyer, raffleKey, 1, FIXTURE.commitment)];
  // The lines the node logged on 2026-10-07 for a 0.07 RLO ticket bought by a wallet holding 0.002.
  const cpiLogs = [
    `Program ${PROGRAM_ID} invoke [1]`,
    "Program 11111111111111111111111111111111 invoke [2]",
    "Transfer: insufficient kelvins 1995000, need 70000000",
    "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
    `Program ${PROGRAM_ID} failed: custom program error: 0x1`,
  ];
  ok("the System program's code inside a Buy is not raffle error 1, from the logs", customErrorCode(null, cpiLogs, ixs, program) === null);
  ok(
    "nor from the status, which names the Buy instruction",
    customErrorCode({ InstructionError: [0, { Custom: 1 }] }, cpiLogs, ixs, program) === null,
  );
  ok("the raffle's own refusal on the same instruction still gives its code", customErrorCode({ InstructionError: [0, { Custom: 7 }] }, [`Program ${PROGRAM_ID} failed: custom program error: 0x7`], ixs, program) === 7);
  ok("insufficient kelvins in the logs reads as the plain sentence", failureText({ InstructionError: [0, { Custom: 1 }] }, cpiLogs) === INSUFFICIENT_FUNDS);
  ok(
    "InsufficientFundsForRent on the fee payer says the wallet is short",
    failureText({ InsufficientFundsForRent: { account_index: 0 } }, []).startsWith(INSUFFICIENT_FUNDS),
  );
  ok(
    "InsufficientFundsForRent on another account says that address needs a little RLO first",
    /needs a little RLO first/.test(failureText({ InsufficientFundsForRent: { account_index: 1 } }, [])),
  );
  ok("TimestampTooStale is worded as the device clock", /device clock is behind/.test(refusalText("sendTransaction: Transaction validation failed: TimestampTooStale")));
}

section("amounts past a u64 are refused, never wrapped (BC-7)");
{
  const over = U64_MAX + BigInt(1);
  let threw = false;
  try {
    encodeCreate({ ...FIXTURE_PARAMS, ticketPrice: over });
  } catch (error) {
    threw = error instanceof RangeError;
  }
  ok("encodeCreate throws a RangeError for 2^64 kelvin rather than writing 0", threw);
  ok("u64 max itself still encodes", encodeCreate({ ...FIXTURE_PARAMS, prize: U64_MAX, ticketPrice: big("1"), revealBond: big("0"), supply: 2 }).length === 77);
  const base = { prize: big("0"), ticketPrice: big("1"), revealBond: big("0"), supply: 2 };
  ok("createFits accepts a raffle that fits exactly", createFits({ ...base, prize: U64_MAX - big("2") }));
  ok("createFits refuses one kelvin more, as the program's checked sum does", !createFits({ ...base, prize: U64_MAX - big("1") }));
  ok("createFits counts the bond in every ticket", !createFits({ prize: big("0"), ticketPrice: U64_MAX / big("2"), revealBond: big("1"), supply: 2 }));
}

/** A Storage on a Map, standing in for the browser's localStorage. `broken` makes every call throw. */
class MemoryStorage {
  private map = new Map<string, string>();
  broken = false;
  get length() {
    if (this.broken) throw new Error("SecurityError");
    return this.map.size;
  }
  key(i: number) {
    if (this.broken) throw new Error("SecurityError");
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    if (this.broken) throw new Error("SecurityError");
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.broken) throw new Error("SecurityError");
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    if (this.broken) throw new Error("SecurityError");
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

section("a saved nonce is never overwritten, and a reveal picks the one that matches (BC-1, BC-11)");
{
  const store = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true, writable: true });
  const raffle = FIXTURE.pubkeys.raffle;
  const holder = FIXTURE.pubkeys.buyer;
  const first = "0102030405060708090a0b0c0d0e0f10";
  const second = "f0e0d0c0b0a090807060504030201000";

  ok("storage that keeps a write reports that it does", storagePersists());
  ok("saveNonce reports a write that read back", saveNonce(raffle, 1, holder, first));
  // The second tab, or the second press after a lost response, saves its own nonce for ticket 1.
  ok("a second nonce for the same ticket number is saved too", saveNonce(raffle, 1, holder, second));
  const both = loadNonces(raffle, 1, holder);
  ok("both candidates are kept", both.length === 2 && both.includes(first) && both.includes(second), JSON.stringify(both));
  ok("findNonce picks the first when the chain holds the first's commitment", findNonce(raffle, 1, holder, commitmentV2(raffle, 1, holder, first)) === first);
  ok("findNonce picks the second when the chain holds the second's commitment", findNonce(raffle, 1, holder, commitmentV2(raffle, 1, holder, second)) === second);
  ok("findNonce returns null when no candidate opens the commitment", findNonce(raffle, 1, holder, "00".repeat(32)) === null);
  ok("ticket 1's candidates are not ticket 12's", loadNonces(raffle, 12, holder).length === 0);
  ok("another holder's ticket 1 is separate", loadNonces(raffle, 1, FIXTURE.pubkeys.creator).length === 0);

  // A secret stored by the earlier build, one value under the ticket's own key, is still found.
  const legacy = "aabbccddeeff00112233445566778899";
  store.setItem(`drawbook-nonce-v2:${raffle}:3:${holder}`, legacy);
  ok("a secret saved by the earlier build is still read", findNonce(raffle, 3, holder, commitmentV2(raffle, 3, holder, legacy)) === legacy);
  ok("rafflesWithSecrets names the raffle once", rafflesWithSecrets(holder).join() === raffle);
  ok("rafflesWithSecrets ignores other holders", rafflesWithSecrets("11111111111111111111111111111111").length === 0);

  store.broken = true;
  ok("blocked storage is reported as not persisting", !storagePersists());
  ok("saveNonce reports false when storage refuses", !saveNonce(raffle, 4, holder, first));
  ok("the in-memory copy still carries it for this page view", loadNonces(raffle, 4, holder).includes(first));
  store.broken = false;
}

section("a transaction that may have landed is never reported as failed (BC-3)");
{
  const payer = await signerFromSeed(0x33);
  const program = decodeBase58(PROGRAM_ID);
  const raffleKey = decodeBase58(FIXTURE.pubkeys.raffle);
  const args = {
    payer: payer.publicKey,
    instructions: [buyIx(payer.publicKey, raffleKey, 1, FIXTURE.commitment)],
    signers: [payer],
  };
  type Status = { slot: number; err: unknown; executed: boolean } | null;
  /** A node stand-in: `send` decides what sending does, `status` answers each poll in turn. */
  const fakeClient = (send: () => Promise<string>, status: (n: number) => Promise<Status>, logs: string[] = []) => {
    let polls = 0;
    return {
      getConfigHashPrefix: async () => FIXTURE.configHashPrefix,
      sendTransaction: send,
      getSignatureStatuses: async () => [await status(polls++)],
      // Indexed only when it executed and failed; otherwise the node has no such transaction.
      getTransaction: async () =>
        logs.length > 0 ? { meta: { err: { InstructionError: [0, { Custom: 1 }] }, logMessages: logs } } : null,
    } as unknown as RialoClient;
  };
  const dropped = async (): Promise<string> => {
    throw new TypeError("fetch failed");
  };
  const options = { errorProgram: program, explain: errorMessage };
  const attempt = async (client: RialoClient, extra: { validityMs?: number; timeoutMs?: number } = {}) => {
    try {
      return { signature: await sendAndConfirm(client, args, { ...options, ...extra }), error: null };
    } catch (error) {
      return { signature: null, error: error as ChainError };
    }
  };

  const landed = await attempt(fakeClient(dropped, async (n) => (n < 2 ? null : { slot: 1, err: null, executed: true })));
  ok("a lost send response is followed up, and the purchase that landed resolves as landed", landed.signature !== null && landed.error === null, landed.error?.message);

  const unreachable = await attempt(
    fakeClient(dropped, async () => {
      throw new TypeError("fetch failed");
    }),
    { validityMs: 6_000, timeoutMs: 1_200 },
  );
  ok(
    "a node that cannot be reached after sending gives outcome unknown, with the signature",
    unreachable.error instanceof ChainError && unreachable.error.outcome === "unknown" && unreachable.error.signature !== null,
    `${unreachable.error?.outcome} ${unreachable.error?.message}`,
  );

  const expired = await attempt(fakeClient(dropped, async () => null), { validityMs: 5_600 });
  ok(
    "a node that answers 'not executed' past the validity window gives outcome refused",
    expired.error instanceof ChainError && expired.error.outcome === "refused" && expired.error.signature !== null,
    `${expired.error?.outcome} ${expired.error?.message}`,
  );

  const refused = await attempt(
    fakeClient(async () => {
      throw new RialoRpcError(-32002, "sendTransaction: Transaction validation failed: TimestampTooStale");
    }, async () => null),
  );
  ok(
    "a refusal from the node itself is outcome refused, worded as the clock",
    refused.error?.outcome === "refused" && refused.error.signature !== null && /device clock/.test(refused.error.message),
    `${refused.error?.outcome} ${refused.error?.message}`,
  );

  const proxy = await attempt(
    fakeClient(async () => {
      throw new RialoRpcError(502, "sendTransaction: HTTP 502");
    }, async (n) => (n < 1 ? null : { slot: 1, err: null, executed: true })),
  );
  ok("a bare HTTP 502 on send is not taken as a refusal; the landed transaction resolves", proxy.signature !== null, proxy.error?.message);

  const cpi = await attempt(
    fakeClient(
      async () => "sig",
      async () => ({ slot: 1, err: { InstructionError: [0, { Custom: 1 }] }, executed: true }),
      [
        "Transfer: insufficient kelvins 1995000, need 70000000",
        "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
        `Program ${PROGRAM_ID} failed: custom program error: 0x1`,
      ],
    ),
  );
  ok(
    "an executed Buy that ran out of RLO is outcome failed, no raffle code, the plain sentence",
    cpi.error?.outcome === "failed" && cpi.error.code === null && cpi.error.message === INSUFFICIENT_FUNDS,
    `${cpi.error?.outcome} ${cpi.error?.code} ${cpi.error?.message}`,
  );
}

/* ------------------------------------------------- the scheduled draw */

/*
 * Frozen from the official rialo-subscriber-interface 0.21.0-alpha.0 crate (bincode 1.3.3) on
 * 2026-10-08, by two small Rust programs in the build scratchpad: `enc-test` ran the crate's own
 * subscribe_to() for a Draw action (subscriber 0x11 x 32, nonce 0x22 x 32, clock window from
 * 1_700_000_000_000), and `enc-drawbook` serialised SubscriberInstruction::Subscribe directly for the
 * exact schedule Drawbook sends, with the FIXTURE creator and raffle above and a reveal deadline of
 * 1_791_341_200_000. The CLI vector is the data of a `rialo client create-subscription` transaction
 * sent on the local network the same day, whose subscription address the node logged.
 */
const SUB = {
  crate: {
    persistent:
      "000000002222222222222222222222222222222222222222222222222222222222222222111111111111111111111111" +
      "11111111111111111111111111111111111111110500000000000000636c6f636b0106a7d51718c774c928566398691d" +
      "5eb68b5eb8a39b4b6d5c73555b2100000000010068e5cf8b010000ffffffffffffffff01000000000000005a00c372ce" +
      "98b29a88b7e3926a4987fc274b97a608f2d272ef2bddf0c8d7281b030000000000000011111111111111111111111111" +
      "111111111111111111111111111111111111110101222222222222222222222222222222222222222222222222222222" +
      "2222222222000106a7d517187bd16635dad40455fdc2c0c124c68f215675a5dbbacb5f08000000000001000000000000" +
      "0003000000000000000000000000ffffffffffffffff",
    oneShotWithDestroy:
      "000000002222222222222222222222222222222222222222222222222222222222222222111111111111111111111111" +
      "11111111111111111111111111111111111111110500000000000000636c6f636b0106a7d51718c774c928566398691d" +
      "5eb68b5eb8a39b4b6d5c73555b2100000000010068e5cf8b010000ffffffffffffffff02000000000000005a00c372ce" +
      "98b29a88b7e3926a4987fc274b97a608f2d272ef2bddf0c8d7281b030000000000000011111111111111111111111111" +
      "111111111111111111111111111111111111110101222222222222222222222222222222222222222222222222222222" +
      "2222222222000106a7d517187bd16635dad40455fdc2c0c124c68f215675a5dbbacb5f08000000000001000000000000" +
      "000306a2ff24bca701c080b02a3db2f28da829f3187804e7e3a67f0d1e8e000000000200000000000000111111111111" +
      "1111111111111111111111111111111111111111111111111111010189d9a774281b1c4c0190bfc57bcab4eab0cfeeff" +
      "a475107ac30c39f0d76c675e000124000000000000000300000022222222222222222222222222222222222222222222" +
      "22222222222222222222010000000000000000000000ffffffffffffffff",
  },
  drawbook: {
    nonceText: "Bow1CGKGDB9mNxeWdw85E2aCthQ1oZX4",
    nonce:
      "426f773143474b474442396d4e7865576477383545326143746851316f5a5834",
    address: "3MuNPUJTgC35h8FVuuFozDpSaHdzkXF2jytEzyaCQS6z",
    subscription:
      "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c97787370500000000000000636c6f636b0106a7" +
      "d51718c774c928566398691d5eb68b5eb8a39b4b6d5c73555b21000000000108964114a1010000ffffffffffffffff01" +
      "000000000000005a00c372ce98b29a88b7e3926a4987fc274b97a608f2d272ef2bddf0c8d7281b0300000000000000d0" +
      "4ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c97787370100a09aa5f47a6759802ff955f8dc2d2a" +
      "14a5c99d23be97f864127ff9383455a4f0000106a7d517187bd16635dad40455fdc2c0c124c68f215675a5dbbacb5f08" +
      "0000000000010000000000000003010000000000000000000000ffffffffffffffff",
    subscribe:
      "00000000426f773143474b474442396d4e7865576477383545326143746851316f5a5834d04ab232742bb4ab3a1368bd" +
      "4615e4e6d0224ab71a016baf8520a332c97787370500000000000000636c6f636b0106a7d51718c774c928566398691d" +
      "5eb68b5eb8a39b4b6d5c73555b21000000000108964114a1010000ffffffffffffffff01000000000000005a00c372ce" +
      "98b29a88b7e3926a4987fc274b97a608f2d272ef2bddf0c8d7281b0300000000000000d04ab232742bb4ab3a1368bd46" +
      "15e4e6d0224ab71a016baf8520a332c97787370100a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9" +
      "383455a4f0000106a7d517187bd16635dad40455fdc2c0c124c68f215675a5dbbacb5f08000000000001000000000000" +
      "0003010000000000000000000000ffffffffffffffff",
    destroy:
      "03000000426f773143474b474442396d4e7865576477383545326143746851316f5a5834",
  },
  cli: {
    subscriber: "5fzWmikt4gxDzmgDzrpGyEVA5cAHwuJTURyHvAvHEejp",
    nonceText: "xcheck",
    address: "4U2NCPKrQmWUXNC6WoBwL8zEqbrRRvsUAzKk3JFKotmU",
    probe: "3areKYqk5cMDhRttLw7UngvgapHwGASerFCuTa4hpRZo",
    data:
      "0000000078636865636b0000000000000000000000000000000000000000000000000000456bd9540cb66e41b5447246" +
      "0bc81735b41d038d9a5a236dab3f2c5de1cacbcf11000000000000006e657665722d66697265732d746f706963000001" +
      "000000000000002663ac2dd5d9032d5c3e7efcdf2e920d4ecdd43bff38db3f95771d48807f5cc6010000000000000006" +
      "a7d517187bd16635dad40455fdc2c0c124c68f215675a5dbbacb5f08000000000001000000000000000000000000a311" +
      "0000000000008b15000000000000",
  },
  /** Bumps below 255 from the crate's find_program_address, creator F25s… and nonce "n<i>". */
  bumps: [
    ["n0", "8LFfDBG4gb7XFJHaxLN9fCcb88Q6Xiqz4KeE6DsyDVCB", 253],
    ["n1", "2Xx8cpvKbsnAA6JUwuYZkeat3vvTcxyZCM96q7yFvBSy", 255],
    ["n99", "2zNLXnm6ZtnVXs5tjpAoajMBjK6uuCkQgakovMEimyc2", 247],
    ["n191", "CZJAw28MnJ6ejspob8anF6hGae1ML8Jnj57cRnNsPnpS", 245],
    ["n284", "BsCf2L8oBL4cvyfk5q4wqh21KHSEM3vobg6vpHnsi8zM", 243],
  ] as [string, string, number][],
  revealDeadline: 1791341200000,
};

/** A string nonce as `Nonce::from(&str)` makes it: raw UTF-8, zero padded to 32 bytes. */
const nonceOf = (text: string) => {
  const out = new Uint8Array(32);
  out.set(Buffer.from(text, "utf8"));
  return out;
};
const subscriberKey = decodeBase58(SUBSCRIBER_PROGRAM_ID);

section("the Subscribe encoding against the official crate and the CLI");
{
  const seed11 = new Uint8Array(32).fill(0x11);
  const nonce22 = new Uint8Array(32).fill(0x22);
  const [pda, bump] = findProgramAddress([Buffer.from("rialo_subscribe"), seed11, nonce22], subscriberKey);
  ok("the crate's subscription address, bump 255", encodeBase58(pda) === "AH7MF2W6F69dDyVRLqCdJUVBSZNkub6GapckfyDWVuZX" && bump === 255, `${encodeBase58(pda)} ${bump}`);
  const creator = decodeBase58(FIXTURE.pubkeys.creator);
  for (const [text, address, expected] of SUB.bumps) {
    const [found, b] = findProgramAddress([Buffer.from("rialo_subscribe"), creator, nonceOf(text)], subscriberKey);
    ok(`the crate's address for nonce "${text}", bump ${expected}`, encodeBase58(found) === address && b === expected, `${encodeBase58(found)} ${b}`);
  }
  const [cliAddress] = findProgramAddress([Buffer.from("rialo_subscribe"), decodeBase58(SUB.cli.subscriber), nonceOf(SUB.cli.nonceText)], subscriberKey);
  ok("the subscription address the CLI's transaction used", encodeBase58(cliAddress) === SUB.cli.address);

  // Web Crypto's own Ed25519 public keys are curve points by construction; a PDA never is.
  let allOn = true;
  for (let i = 0; i < 16; i += 1) {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    allOn &&= isOnCurve(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  }
  ok("isOnCurve accepts sixteen fresh Ed25519 public keys", allOn);
  ok("isOnCurve rejects the PDAs found above", !isOnCurve(pda) && !isOnCurve(cliAddress));

  const probeIx = {
    programId: decodeBase58(SUB.cli.probe),
    accounts: [{ pubkey: decodeBase58(INSTRUCTIONS_SYSVAR_ID), isSigner: false, isWritable: false }],
    data: new Uint8Array([0]),
  };
  const cliData = encodeSubscribe(nonceOf(SUB.cli.nonceText), {
    subscriber: decodeBase58(SUB.cli.subscriber),
    topic: "never-fires-topic",
    eventAccount: null,
    timestampRange: null,
    instructions: [probeIx],
    kind: "Persistent",
    activeCommits: [big("4515"), big("5515")],
  });
  ok("a Persistent topic subscription is byte-identical to the CLI's (206 bytes)", hexOf(cliData) === SUB.cli.data, hexOf(cliData));

  // The crate's vectors used a Draw whose subscriber meta is signer AND writable, so this one does too.
  const crateDraw = {
    programId: decodeBase58(PROGRAM_ID),
    accounts: [
      { pubkey: seed11, isSigner: true, isWritable: true },
      { pubkey: nonce22, isSigner: false, isWritable: true },
      { pubkey: decodeBase58(INSTRUCTIONS_SYSVAR_ID), isSigner: false, isWritable: false },
    ],
    data: new Uint8Array([3]),
  };
  const crateSub = (kind: "Persistent" | "OneShot", instructions: Instruction[]): Subscription => ({
    subscriber: seed11,
    topic: "clock",
    eventAccount: decodeBase58(CLOCK_SYSVAR_ID),
    timestampRange: [big("1700000000000"), U64_MAX],
    instructions,
    kind,
    activeCommits: [big("0"), U64_MAX],
  });
  const persistent = encodeSubscribe(nonce22, crateSub("Persistent", [crateDraw]));
  ok("a Persistent clock subscription is byte-identical to the crate's (310 bytes)", hexOf(persistent) === SUB.crate.persistent && persistent.length === 310);
  const destroy = {
    programId: subscriberKey,
    accounts: [
      { pubkey: seed11, isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
    ],
    data: encodeDestroy(nonce22),
  };
  ok("Unsubscribe and Destroy data equal the crate's", hexOf(encodeUnsubscribe(nonce22)) === "01000000" + "22".repeat(32) && hexOf(encodeDestroy(nonce22)) === "03000000" + "22".repeat(32));
  const withDestroy = encodeSubscribe(nonce22, crateSub("OneShot", [crateDraw, destroy]));
  ok("subscribe_to's OneShot, Destroy appended, is reproduced byte for byte (462 bytes)", hexOf(withDestroy) === SUB.crate.oneShotWithDestroy && withDestroy.length === 462);
}

section("Drawbook's schedule is exactly the bytes the crate makes for it");
{
  const creator = decodeBase58(FIXTURE.pubkeys.creator);
  const raffle = FIXTURE.pubkeys.raffle;
  ok("the nonce is the raffle address's first 32 characters", scheduleNonceText(raffle) === SUB.drawbook.nonceText);
  ok("as raw UTF-8 bytes, as the crate's Nonce::from(&str) has them", hexOf(scheduleNonce(raffle)) === SUB.drawbook.nonce);
  ok("the subscription address equals the crate's", scheduleAddress(FIXTURE.pubkeys.creator, raffle) === SUB.drawbook.address);

  const ix = subscribeDrawIx(creator, raffle, SUB.revealDeadline);
  ok("Subscribe data is byte-identical to the crate's SubscriberInstruction::Subscribe (310 bytes)", hexOf(ix.data) === SUB.drawbook.subscribe && ix.data.length === 310, hexOf(ix.data));
  ok("Subscribe goes to the Subscriber program", encodeBase58(ix.programId) === SUBSCRIBER_PROGRAM_ID);
  ok(
    "its accounts: creator signer+writable, subscription writable, System readonly",
    ix.accounts.length === 3 &&
      encodeBase58(ix.accounts[0].pubkey) === FIXTURE.pubkeys.creator && ix.accounts[0].isSigner && ix.accounts[0].isWritable &&
      encodeBase58(ix.accounts[1].pubkey) === SUB.drawbook.address && !ix.accounts[1].isSigner && ix.accounts[1].isWritable &&
      encodeBase58(ix.accounts[2].pubkey) === "11111111111111111111111111111111" && !ix.accounts[2].isSigner && !ix.accounts[2].isWritable,
  );
  const stored = encodeSubscription(drawSchedule(creator, decodeBase58(raffle), SUB.revealDeadline));
  ok("the account the Subscriber stores is the crate's 274 bytes", hexOf(stored) === SUB.drawbook.subscription && stored.length === 274);
  ok("SCHEDULE_LEN, computed from the encoding, is 274", SCHEDULE_LEN === 274);

  const decoded = decodeSubscription(stored);
  ok("one action, and no Destroy after it", decoded.instructions.length === 1);
  const draw = drawIx(creator, decodeBase58(raffle));
  ok(
    "the action is byte for byte the Draw a person sends (caller signer, read-only)",
    encodeBase58(decoded.instructions[0].programId) === PROGRAM_ID &&
      hexOf(decoded.instructions[0].data) === "03" &&
      decoded.instructions[0].accounts.every(
        (m, i) => hexOf(m.pubkey) === hexOf(draw.accounts[i].pubkey) && m.isSigner === draw.accounts[i].isSigner && m.isWritable === draw.accounts[i].isWritable,
      ),
  );
  ok("OneShot, topic clock on the clock sysvar", decoded.kind === "OneShot" && decoded.topic === "clock" && decoded.eventAccount !== null && encodeBase58(decoded.eventAccount) === CLOCK_SYSVAR_ID);
  ok(
    "the window opens at the reveal deadline + 5 s and never closes",
    decoded.timestampRange !== null && decoded.timestampRange[0] === BigInt(SUB.revealDeadline + 5000) && decoded.timestampRange[1] === U64_MAX,
  );
  ok("active for every commit", decoded.activeCommits[0] === big("0") && decoded.activeCommits[1] === U64_MAX);

  const d = destroyScheduleIx(creator, raffle);
  ok("Destroy data equals the crate's", hexOf(d.data) === SUB.drawbook.destroy);
  ok(
    "Destroy accounts: creator signer+writable, subscription writable",
    d.accounts.length === 2 && d.accounts[0].isSigner && d.accounts[0].isWritable && encodeBase58(d.accounts[1].pubkey) === SUB.drawbook.address && d.accounts[1].isWritable && !d.accounts[1].isSigner,
  );

  const reclaim = reclaimScheduleIxs(creator, raffle);
  ok(
    "reclaiming is Destroy then Unsubscribe, both on the schedule account, creator signing",
    reclaim.length === 2 &&
      hexOf(reclaim[0].data) === SUB.drawbook.destroy &&
      hexOf(reclaim[1].data) === "01" + SUB.drawbook.destroy.slice(2) &&
      reclaim.every((ix) => encodeBase58(ix.programId) === SUBSCRIBER_PROGRAM_ID && ix.accounts.length === 2 && ix.accounts[0].isSigner && ix.accounts[0].isWritable && encodeBase58(ix.accounts[1].pubkey) === SUB.drawbook.address && ix.accounts[1].isWritable),
  );

  const twoActions = decodeSubscription(bytesOf(SUB.crate.oneShotWithDestroy).subarray(36));
  ok("the crate's subscribe_to OneShot decodes to two actions", twoActions.instructions.length === 2 && twoActions.kind === "OneShot");
  const refuses = (bytes: Uint8Array) => {
    try {
      decodeSubscription(bytes);
      return false;
    } catch {
      return true;
    }
  };
  ok("a trailing byte is refused", refuses(concatBytes(stored, new Uint8Array([0]))));
  ok("a truncated account is refused", refuses(stored.subarray(0, 273)));
  const badKind = stored.slice();
  badKind[274 - 20] = 2;
  ok("a kind other than 0 or 1 is refused", refuses(badKind));
  const hugeTopic = stored.slice();
  hugeTopic[32 + 7] = 0xff;
  ok("a topic length past the cap is refused before allocating", refuses(hugeTopic));
}

function concatBytes(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

section("only the exact schedule counts as scheduled");
{
  const creator = decodeBase58(FIXTURE.pubkeys.creator);
  const raffleKey = decodeBase58(FIXTURE.pubkeys.raffle);
  const r = { address: FIXTURE.pubkeys.raffle, creator: FIXTURE.pubkeys.creator, revealDeadline: SUB.revealDeadline };
  const base = () => drawSchedule(creator, raffleKey, SUB.revealDeadline);
  ok("Drawbook's own schedule is accepted", isDrawbookSchedule(base(), r));
  const variants: [string, (s: Subscription) => void][] = [
    ["an extra instruction (the Destroy subscribe_to appends)", (s) => s.instructions.push(destroyScheduleIx(creator, FIXTURE.pubkeys.raffle))],
    ["Persistent", (s) => { s.kind = "Persistent"; }],
    ["another raffle's Draw", (s) => { s.instructions = [drawIx(creator, decodeBase58(FIXTURE.pubkeys.buyer))]; }],
    ["a window opening before the reveal deadline", (s) => { s.timestampRange = [BigInt(SUB.revealDeadline - 1), U64_MAX]; }],
    ["a window that closes", (s) => { s.timestampRange = [BigInt(SUB.revealDeadline + 5000), BigInt(SUB.revealDeadline + 60_000)]; }],
    ["a commit window that ends", (s) => { s.activeCommits = [big("0"), big("1000")]; }],
    ["another subscriber", (s) => { s.subscriber = decodeBase58(FIXTURE.pubkeys.buyer); }],
    ["a Draw whose caller is writable", (s) => { s.instructions[0].accounts[0].isWritable = true; }],
    ["another topic", (s) => { s.topic = "clocks"; }],
    ["no event account", (s) => { s.eventAccount = null; }],
  ];
  for (const [what, edit] of variants) {
    const s = base();
    edit(s);
    ok(`refused: ${what}`, !isDrawbookSchedule(s, r));
  }
}

section("scheduleState reads the schedule the way the raffle page shows it");
{
  const r = { address: FIXTURE.pubkeys.raffle, creator: FIXTURE.pubkeys.creator, revealDeadline: SUB.revealDeadline };
  const at = SUB.revealDeadline + 5000;
  const deposit = big("2797920");
  const account = { owner: SUBSCRIBER_PROGRAM_ID, kelvins: deposit, data: bytesOf(SUB.drawbook.subscription) };
  const read = (over: Partial<ScheduleRead>): ScheduleRead => ({ address: SUB.drawbook.address, account: null, history: false, held: null, firing: null, ...over });
  const fired = { signature: "SIG", at: at + 400, isDraw: true, ok: true, code: null, reason: null };

  ok("no account, no history: none", scheduleState(r, read({}), at).kind === "none");
  ok("no account but a Subscribe/Destroy behind it: withdrawn", scheduleState(r, read({ history: true }), at).kind === "withdrawn");
  const waiting = scheduleState(r, read({ account, history: true }), at - 1);
  ok("before the time: scheduled, at reveal deadline + 5 s, with its deposit", waiting.kind === "scheduled" && waiting.at === at && waiting.deposit === deposit);
  ok("from the time: due", scheduleState(r, read({ account, history: true }), at).kind === "due");
  ok("due until the window passes", scheduleState(r, read({ account, history: true }), at + DUE_WINDOW_MS - 1).kind === "due");
  ok("then late", scheduleState(r, read({ account, history: true }), at + DUE_WINDOW_MS).kind === "late");
  const sent = scheduleState(r, read({ account, history: true, firing: fired }), at + 1000);
  ok("a triggered Draw: sent, with the deposit still held", sent.kind === "sent" && sent.firing.ok && sent.deposit === deposit && sent.at === at);
  const reclaimed = scheduleState(r, read({ history: true, firing: fired }), at + 1000);
  ok("sent and reclaimed: still sent, nothing left to reclaim", reclaimed.kind === "sent" && reclaimed.deposit === null);
  const refused = scheduleState(r, read({ account, history: true, firing: { ...fired, ok: false, code: 14, reason: errorMessage(14) } }), at + 1000);
  ok("a triggered Draw the program refused is still sent, with its code", refused.kind === "sent" && !refused.firing.ok && refused.firing.code === 14);
  ok(
    "a triggered transaction that is not a Draw is not the draw",
    scheduleState(r, read({ account, history: true, firing: { ...fired, isDraw: false } }), at - 1).kind === "scheduled",
  );
  const updated = encodeSubscription({ ...drawSchedule(decodeBase58(r.creator), decodeBase58(r.address), r.revealDeadline), kind: "Persistent" });
  ok("an account Updated into something else: unrecognised", scheduleState(r, read({ account: { ...account, data: updated } }), at).kind === "unrecognised");
  ok("garbage in the account: unrecognised", scheduleState(r, read({ account: { ...account, data: new Uint8Array(9) } }), at).kind === "unrecognised");
  ok("an account another program owns is not a schedule", scheduleState(r, read({ account: { ...account, owner: PROGRAM_ID } }), at).kind === "none");
  // The node's word on whether it still holds the subscription (getSubscription).
  const heldAt = scheduleState(r, read({ account, history: true, held: true }), at - 1);
  ok("held by the node, before the time: scheduled", heldAt.kind === "scheduled" && heldAt.at === at);
  const dropped = scheduleState(r, read({ account, history: true, held: false }), at - 1);
  ok("the node says it no longer holds it, before the time: dropped, never scheduled", dropped.kind === "dropped" && dropped.deposit === deposit);
  ok("not held from the time on reads as due: a firing not listed yet looks the same", scheduleState(r, read({ account, history: true, held: false }), at).kind === "due");
  ok("an unanswered getSubscription changes nothing", scheduleState(r, read({ account, history: true, held: null }), at - 1).kind === "scheduled");
  ok("not held, but a Draw was sent: sent", scheduleState(r, read({ account, history: true, held: false, firing: fired }), at - 1).kind === "sent");
}

section("a triggered transaction, as the node returns it, is read for what it did");
{
  const raffle = { address: FIXTURE.pubkeys.raffle, creator: FIXTURE.pubkeys.creator };
  // The shape of triggered Draw 3kiz7e7r… on the local network, 2026-10-08, with this fixture's keys.
  const tx = (err: unknown, logs: string[], instructions: unknown[]) => ({
    transaction: {
      signatures: ["SIG"],
      message: {
        accountKeys: [FIXTURE.pubkeys.creator, FIXTURE.pubkeys.raffle, INSTRUCTIONS_SYSVAR_ID, PROGRAM_ID],
        header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 2 },
        instructions,
      },
      validFrom: 1791414750645,
    },
    meta: { err, fee: 5000, logMessages: logs },
  });
  const draw = { accounts: [0, 1, 2], data: "4", programIdIndex: 3 };
  const good = readFiring("SIG", tx(null, [`Program ${PROGRAM_ID} success`], [draw]), raffle);
  ok("a lone Draw that ran: a Draw, ok, at its block time", good !== null && good.isDraw && good.ok && good.at === 1791414750645 && good.code === null);
  const early = readFiring(
    "SIG",
    tx({ InstructionError: [0, { Custom: 13 }] }, [`Program ${PROGRAM_ID} failed: custom program error: 0xd`], [draw]),
    raffle,
  );
  ok("a Draw refused as NotReady carries code 13 and the program's sentence", early !== null && early.isDraw && !early.ok && early.code === 13 && early.reason === errorMessage(13));
  const pair = readFiring("SIG", tx(null, [], [draw, draw]), raffle);
  ok("two instructions are not the draw", pair !== null && !pair.isDraw);
  const other = readFiring("SIG", tx(null, [], [{ ...draw, accounts: [0, 2, 1] }]), raffle);
  ok("a Draw on another account is not this raffle's draw", other !== null && !other.isDraw);
  ok("no transaction: nothing to read", readFiring("SIG", null, raffle) === null);
}

section("the failing instruction is named, so Create can tell a refused schedule from a refused raffle");
{
  ok("object form", failedInstruction({ InstructionError: [2, "InvalidArgument"] }) === 2);
  ok("object form with a custom code", failedInstruction({ InstructionError: [2, { Custom: 1 }] }) === 2);
  ok("Debug form", failedInstruction("InstructionError(2, Custom(1))") === 2);
  ok("a whole-transaction failure names none", failedInstruction("InsufficientFundsForFee") === null);
  ok("no error, no index", failedInstruction(null) === null);
}

section("Subscriber RPC shapes (fetch stubbed)");
{
  const realFetch = globalThis.fetch;
  const requests: { method: string; params: unknown }[] = [];
  let respond: (method: string) => { status: number; text: string } = () => ({ status: 200, text: "{}" });
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown };
    requests.push(body);
    const r = respond(body.method);
    return new Response(r.text, { status: r.status });
  }) as typeof fetch;
  try {
    const client = new RialoClient("http://stub.invalid");
    respond = () => ({ status: 200, text: '{"jsonrpc":"2.0","id":1,"result":{"version":0,"transactions":[{"signature":"S1","blockNumber":7065}]}}' });
    const t = await client.getTriggeredTransactions(SUB.drawbook.address, 5);
    ok("getTriggeredTransactions sends [address, limit as a string]", JSON.stringify(requests.at(-1)?.params) === `["${SUB.drawbook.address}","5"]`);
    ok("and reads {signature, blockNumber}", t.length === 1 && t[0].signature === "S1" && t[0].blockNumber === 7065);
    respond = () => ({ status: 200, text: '{"jsonrpc":"2.0","id":1,"result":{"version":0,"transactions":[]}}' });
    ok("an empty list is empty", (await client.getTriggeredTransactions(SUB.drawbook.address)).length === 0);

    respond = () => ({
      status: 200,
      text: `{"jsonrpc":"2.0","id":1,"result":{"version":0,"context":{"slot":1,"api_version":"0.21.0-alpha.0"},"subscription":{"kind":"OneShot","topic":"clock","instructions":[],"subscriber":"${FIXTURE.pubkeys.creator}","event_account":"${CLOCK_SYSVAR_ID}","timestamp_range":[1791341205000,18446744073709551615]}}}`,
    });
    const s = await client.getSubscription(FIXTURE.pubkeys.creator, SUB.drawbook.nonceText);
    ok("getSubscription sends {subscriber, nonce} as a struct", JSON.stringify(requests.at(-1)?.params) === `[{"subscriber":"${FIXTURE.pubkeys.creator}","nonce":"${SUB.drawbook.nonceText}"}]`);
    ok("and reads the subscription", s !== null && s.kind === "OneShot" && s.topic === "clock");
    respond = () => ({ status: 404, text: '{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Subscription not found: Subscription not found"}}' });
    ok("not found is null, not an error", (await client.getSubscription(FIXTURE.pubkeys.creator, "nothing")) === null);
  } finally {
    globalThis.fetch = realFetch;
  }
}

section("Create falls back to an unscheduled raffle only when Rialo refused the schedule (node stubbed)");
{
  const { createRaffle } = await import("../lib/chain/actions.ts");
  const creatorSigner = await signerFromSeed(0x11);
  const wallet = { address: encodeBase58(creatorSigner.publicKey), canSign: true, privateKey: creatorSigner.privateKey };
  const params = { ...FIXTURE_PARAMS, commitDeadline: Date.now() + 60_000, revealDeadline: Date.now() + 120_000 };

  /** A node stand-in: `failWith(n)` decides how the n-th sent transaction ends (null: it executes). */
  const stubNode = (failWith: (n: number) => { err: unknown; logs: string[] } | null) => {
    const sent: Uint8Array[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
      switch (body.method) {
        case "getMinimumBalanceForRentExemption":
          return reply("3507840");
        case "getRecentValidatorConfigHash":
          return new Response('{"jsonrpc":"2.0","id":1,"result":{"version":0,"configHashPrefix":11774740490753875893}}');
        case "sendTransaction":
          sent.push(new Uint8Array(Buffer.from(String(body.params[0]), "base64")));
          return reply(`SIG${sent.length}`);
        case "getSignatureStatuses": {
          const n = Number(String((body.params[0] as { signatures: string[] }).signatures[0]).slice(3));
          const f = failWith(n);
          return reply({ value: [{ slot: 1, err: f ? f.err : null, executed: true }] });
        }
        case "getTransaction": {
          const n = Number(String((body.params[0] as { signature: string }).signature).slice(3));
          const f = failWith(n);
          return reply({ meta: { err: f ? f.err : null, logMessages: f ? f.logs : [] } });
        }
        default:
          return reply(null);
      }
    }) as typeof fetch;
    return { sent, restore: () => (globalThis.fetch = realFetch) };
  };
  /** The message's instruction count and its second key (the raffle, the only other signer). */
  const shape = (tx: Uint8Array) => {
    const message = tx.subarray(1 + 64 * tx[0]);
    const keyCount = message[3];
    const raffle = encodeBase58(message.subarray(4 + 32, 4 + 64));
    const instructions = message[4 + 32 * keyCount + 8 + 8 + 1];
    return { instructions, raffle };
  };

  const subscriberLogs = [
    `Program ${PROGRAM_ID} invoke [1]`,
    `Program ${PROGRAM_ID} success`,
    `Program ${SUBSCRIBER_PROGRAM_ID} invoke [1]`,
    "only the creator of the subscription (payer) can be a signer",
    `Program ${SUBSCRIBER_PROGRAM_ID} failed: invalid program argument`,
  ];
  let node = stubNode((n) => (n === 1 ? { err: { InstructionError: [2, "InvalidArgument"] }, logs: subscriberLogs } : null));
  try {
    const made = await createRaffle(wallet, params);
    const [first, second] = node.sent.map(shape);
    ok("the first attempt carries three instructions, the second two", node.sent.length === 2 && first.instructions === 3 && second.instructions === 2, JSON.stringify([first, second]));
    ok("both attempts are the same raffle account, so a second prize cannot move", first.raffle === second.raffle && made.raffle === first.raffle);
    ok("the raffle is reported created by the second transaction", made.signature === "SIG2");
    ok("with no schedule, and Rialo's own reason", made.schedule === null && made.drawAt === null && made.scheduleError === "only the creator of the subscription (payer) can be a signer (invalid program argument)", String(made.scheduleError));
    ok("the refused attempt is kept as a receipt for its fee", made.scheduleSignature === "SIG1");
  } finally {
    node.restore();
  }

  node = stubNode(() => null);
  try {
    const made = await createRaffle(wallet, params);
    ok("when Rialo accepts: one transaction, scheduled at the reveal deadline + 5 s", node.sent.length === 1 && made.schedule === scheduleAddress(wallet.address, made.raffle) && made.drawAt === params.revealDeadline + 5000 && made.scheduleError === null);
  } finally {
    node.restore();
  }

  node = stubNode((n) => (n === 1 ? { err: { InstructionError: [1, { Custom: 5 }] }, logs: [`Program ${PROGRAM_ID} failed: custom program error: 0x5`] } : null));
  try {
    const refused = await createRaffle(wallet, params).then(() => null, (error: ChainError) => error);
    ok("a raffle the program refuses is not sent again", node.sent.length === 1 && refused instanceof ChainError && refused.code === 5 && refused.instruction === 1);
  } finally {
    node.restore();
  }
}

console.log(
  failures === 0
    ? "\nCHAIN VERIFIED: the library matches the SDK, the spec and an independent recomputation."
    : `\nCHAIN HAS ${failures} FAILING CHECKS.`,
);
process.exit(failures === 0 ? 0 : 1);
