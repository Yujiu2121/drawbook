/**
 * Base58 in the Bitcoin/Solana alphabet, which is what Rialo uses for addresses and signatures.
 *
 * Written out rather than pulled from a package because it is thirty lines, it has to run in the
 * browser, and a wrong implementation would produce addresses that look right and are not.
 * Verified round-trip against known vectors in scripts/verify-wallet.ts.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const INDEX: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i += 1) INDEX[ALPHABET[i]] = i;

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Leading zero bytes are encoded as leading '1's rather than being absorbed by the base change.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  // Repeated division of the whole number, held as a little-endian digit array in base 58.
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let d = 0; d < digits.length; d += 1) {
      const value = digits[d] * 256 + carry;
      digits[d] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let out = "1".repeat(zeros);
  for (let d = digits.length - 1; d >= 0; d -= 1) out += ALPHABET[digits[d]];
  return out;
}

export function decodeBase58(text: string): Uint8Array {
  if (text.length === 0) return new Uint8Array(0);

  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;

  const bytes: number[] = [];
  for (let i = zeros; i < text.length; i += 1) {
    const value = INDEX[text[i]];
    if (value === undefined) throw new Error(`not base58: ${text[i]}`);
    let carry = value;
    for (let b = 0; b < bytes.length; b += 1) {
      const total = bytes[b] * 58 + carry;
      bytes[b] = total % 256;
      carry = Math.floor(total / 256);
    }
    while (carry > 0) {
      bytes.push(carry % 256);
      carry = Math.floor(carry / 256);
    }
  }

  const out = new Uint8Array(zeros + bytes.length);
  for (let b = 0; b < bytes.length; b += 1) out[zeros + b] = bytes[bytes.length - 1 - b];
  return out;
}

/** True when `text` decodes to exactly 32 bytes, which is what a Rialo address is. */
export function isAddress(text: string): boolean {
  try {
    return decodeBase58(text).length === 32;
  } catch {
    return false;
  }
}
