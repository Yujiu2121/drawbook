/**
 * Check lib/sha256.ts against the FIPS 180-4 vectors, plus the padding boundaries where hand
 * written SHA-256 usually breaks (55, 56, 63, 64, 119 and 120 bytes), plus a cross-check
 * against node:crypto over random inputs.
 *
 * Run: node scripts/verify-sha256.ts
 */

import { createHash, randomBytes } from "node:crypto";
import { sha256, sha256Hex, toHex, fromHex, utf8 } from "../lib/sha256.ts";

let failures = 0;

function check(label: string, actual: string, expected: string) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        expected ${expected}`);
    console.log(`        actual   ${actual}`);
  }
}

console.log("FIPS 180-4 published vectors");
check(
  '""',
  sha256Hex(""),
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
);
check(
  '"abc"',
  sha256Hex("abc"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);
check(
  "448-bit message",
  sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
  "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
);
check(
  "896-bit message",
  sha256Hex(
    "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
  ),
  "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
);
check(
  '1,000,000 x "a"',
  sha256Hex("a".repeat(1_000_000)),
  "cd c7 6e 5c 99 14 fb 92 81 a1 c7 e2 84 d7 3e 67 f1 80 9a 48 a4 97 20 0e 04 6d 39 cc c7 11 2c d0"
    .replace(/ /g, ""),
);

console.log("\npadding boundaries (byte lengths around each 64-byte block edge)");
for (const n of [54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 128]) {
  const input = randomBytes(n);
  const mine = toHex(sha256(new Uint8Array(input)));
  const theirs = createHash("sha256").update(input).digest("hex");
  check(`${String(n).padStart(3)} bytes`, mine, theirs);
}

console.log("\ncross-check against node:crypto, 400 random inputs of random length");
let mismatches = 0;
for (let i = 0; i < 400; i += 1) {
  const n = Math.floor(Math.random() * 600);
  const input = randomBytes(n);
  const mine = toHex(sha256(new Uint8Array(input)));
  const theirs = createHash("sha256").update(input).digest("hex");
  if (mine !== theirs) mismatches += 1;
}
check("all 400 agree", String(mismatches), "0");

console.log("\nhex round-trip");
const sample = "0f1e2d3c4b5a69788796a5b4c3d2e1f00123456789abcdeffedcba9876543210";
check("fromHex then toHex", toHex(fromHex(sample)), sample);
check("0x prefix tolerated", toHex(fromHex(`0x${sample}`)), sample);
check("utf8 length of a 3-byte codepoint", String(utf8("€").length), "3");

console.log(
  failures === 0
    ? "\nSHA-256 VERIFIED: every vector and cross-check agrees."
    : `\nSHA-256 BROKEN: ${failures} failing checks.`,
);
process.exit(failures === 0 ? 0 : 1);
