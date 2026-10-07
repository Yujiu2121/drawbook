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
  ChainError,
  compileMessage,
  customErrorCode,
  failureText,
  INSUFFICIENT_FUNDS,
  refusalText,
  sendAndConfirm,
  signatureOf,
  signTransaction,
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

console.log(
  failures === 0
    ? "\nCHAIN VERIFIED: the library matches the SDK, the spec and an independent recomputation."
    : `\nCHAIN HAS ${failures} FAILING CHECKS.`,
);
process.exit(failures === 0 ? 0 : 1);
