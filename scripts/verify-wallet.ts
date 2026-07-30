/**
 * Verify base58, then exercise the real Rialo testnet end to end with the app's own client:
 * health, version, deployed programs, a fresh keypair, a faucet grant, and the balance moving.
 *
 * This talks to a live network. Run: node scripts/verify-wallet.ts
 */

import { decodeBase58, encodeBase58, isAddress } from "../lib/base58.ts";
import { createWallet, ed25519Available, shortAddress } from "../lib/wallet.ts";
import { FAUCET_MAX_KELVIN, KELVIN, formatKelvinAsRLO, RialoRpcError, testnet } from "../lib/rialo-rpc.ts";

let failures = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` :: ${detail}` : ""}`);
}
const hex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));

console.log("base58 against published vectors");
{
  ok('encode([0]) is "1"', encodeBase58(new Uint8Array([0])) === "1");
  ok('encode(three zero bytes) is "111"', encodeBase58(new Uint8Array(3)) === "111");
  ok(
    '"Hello World!" encodes to 2NEpo7TZRRrLZSi2U',
    encodeBase58(new TextEncoder().encode("Hello World!")) === "2NEpo7TZRRrLZSi2U",
  );
  ok(
    "0x0000287fb4cd encodes to 11233QC4",
    encodeBase58(hex("0000287fb4cd")) === "11233QC4",
  );
  ok(
    "32 zero bytes encode to the all-ones system address",
    encodeBase58(new Uint8Array(32)) === "1".repeat(32),
  );

  // Round-trip random buffers of every length that matters.
  let mismatches = 0;
  for (let n = 0; n <= 64; n += 1) {
    for (let t = 0; t < 8; t += 1) {
      const bytes = new Uint8Array(n);
      crypto.getRandomValues(bytes);
      const back = decodeBase58(encodeBase58(bytes));
      if (back.length !== bytes.length || back.some((b, i) => b !== bytes[i])) mismatches += 1;
    }
  }
  ok("round-trips all lengths 0..64, 8 samples each", mismatches === 0, `${mismatches} bad`);

  ok(
    "the Subscriber program id is a valid 32-byte address",
    isAddress("Subscriber111111111111111111111111111111111"),
  );
  ok("rejects a string with a non-base58 character", !isAddress("0OIl" + "1".repeat(40)));
  ok("shortAddress keeps both ends", shortAddress("A".repeat(44)) === "AAAA…AAAA");
}

console.log("\nlive testnet: node identity");
{
  const health = await testnet.health();
  ok("getHealth is ok", health === "ok", health);

  const version = await testnet.version();
  ok("getVersion answers", typeof version === "string" && version.length > 0, version);

  const epoch = await testnet.epochInfo();
  ok("epoch info looks like a running chain", epoch.blockHeight > 1_000_000, JSON.stringify(epoch));
  console.log(
    `        node ${version}, epoch ${epoch.epoch}, height ${epoch.blockHeight.toLocaleString("en-US")}, ${epoch.transactionCount.toLocaleString("en-US")} transactions`,
  );
}

console.log("\nlive testnet: are the primitives this dApp needs actually deployed?");
{
  const subscriber = await testnet.accountInfo("Subscriber111111111111111111111111111111111");
  ok(
    "the Subscriber program (reactive predicates) is deployed and executable",
    subscriber !== null && subscriber.executable,
    JSON.stringify(subscriber),
  );

  const token = await testnet.accountInfo("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  ok(
    "Token-2022 is deployed and executable",
    token !== null && token.executable,
    token ? `owner ${token.owner}, ${token.space} bytes` : "missing",
  );
  if (token) console.log(`        token program loader: ${token.owner}`);

  const dkg = await testnet.secretSharingPubkey();
  ok(
    "the validator DKG committee answers with a threshold key",
    /^[0-9a-f]{64}$/.test(dkg.pubkey),
    dkg.pubkey,
  );

  const cfg = await testnet.configHashPrefix();
  ok(
    "replay protection prefix is available (Rialo's blockhash substitute)",
    typeof cfg.configHashPrefix === "number",
    String(cfg.configHashPrefix),
  );
}

console.log("\nlive testnet: a fresh wallet, funded for real");
{
  const canSign = await ed25519Available();
  ok("Ed25519 is available in this runtime", canSign);

  const wallet = await createWallet();
  ok("the generated address is a valid 32-byte base58 address", isAddress(wallet.address));
  ok("it reports signing capability truthfully", wallet.canSign === canSign);
  console.log(`        address ${wallet.address}`);

  const before = await testnet.balance(wallet.address);
  ok("a brand new address starts at zero", before === 0, String(before));

  // The faucet caps a single grant; asking for more is refused, not trimmed.
  let overAsk = "";
  try {
    await testnet.requestAirdrop(wallet.address, 5 * KELVIN + 1);
  } catch (error) {
    overAsk = error instanceof RialoRpcError ? error.message : String(error);
  }
  ok(
    "the client clamps to the faucet cap instead of being refused",
    overAsk === "",
    overAsk,
  );

  const signature = await testnet.requestAirdrop(wallet.address, FAUCET_MAX_KELVIN);
  ok("the faucet returns a transaction signature", isAddress(signature) || signature.length > 60, signature);
  console.log(`        airdrop signature ${signature.slice(0, 24)}…`);

  // No pubsub on this chain, so poll.
  let after = 0;
  for (let i = 0; i < 15; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    after = await testnet.balance(wallet.address);
    if (after > 0) break;
  }
  ok(
    `the balance actually moved on chain (${formatKelvinAsRLO(after)} RLO)`,
    after >= FAUCET_MAX_KELVIN,
    `${before} -> ${after}`,
  );
}

console.log(
  failures === 0
    ? "\nWALLET AND TESTNET VERIFIED: the chain path works end to end."
    : `\n${failures} FAILING CHECKS.`,
);
process.exit(failures === 0 ? 0 : 1);
