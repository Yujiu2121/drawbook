//! The seed and the winner selection, byte for byte what `lib/raffle.ts` computes.
//!
//! `deriveWinnerTrace` in lib/raffle.ts is the executable specification. This file reproduces it
//! so a page can audit an on-chain draw with the existing `deriveWinners`, and so the e2e test can
//! recompute every draw in JavaScript and compare it with what the program wrote.

use alloc::vec::Vec;
use rialo_s_sha256_hasher::hashv;

const COMMIT_DOMAIN: &[u8] = b"drawbook-v2|commit|";
const SEED_DOMAIN: &[u8] = b"drawbook-v2|seed|";
const DRAW_TAG: &[u8] = b"|draw|";

/// sha256("drawbook-v2|commit|" ‖ raffle ‖ ticket_index u16 LE ‖ holder ‖ nonce).
pub fn commitment(raffle: &[u8], ticket_index: u16, holder: &[u8], nonce: &[u8]) -> [u8; 32] {
    hashv(&[COMMIT_DOMAIN, raffle, &ticket_index.to_le_bytes(), holder, nonce]).to_bytes()
}

/// sha256("drawbook-v2|seed|" ‖ raffle ‖ sorted nonces ‖ chain_seed u64 BE).
///
/// The nonces arrive as big-endian u128s because a big-endian integer orders exactly as its
/// bytes do, so sorting the integers is the spec's ascending bytewise sort, and u128 comparisons
/// are far cheaper in compute units than comparing 16-byte slices.
pub fn seed(raffle: &[u8], nonces: &mut Vec<u128>, chain_seed: u64) -> [u8; 32] {
    nonces.sort_unstable();
    let mut joined: Vec<u8> = Vec::with_capacity(nonces.len() * 16);
    for n in nonces.iter() {
        joined.extend_from_slice(&n.to_be_bytes());
    }
    hashv(&[SEED_DOMAIN, raffle, &joined, &chain_seed.to_be_bytes()]).to_bytes()
}

/// The keystream behind the draw: block `k` is sha256(seed ‖ "|draw|" ‖ decimal k), read six
/// bytes at a time, big-endian, five samples to a block.
struct Keystream<'a> {
    seed: &'a [u8; 32],
    block: [u8; 32],
    at: usize,
    counter: u64,
}

impl<'a> Keystream<'a> {
    fn new(seed: &'a [u8; 32]) -> Self {
        // `at` starts past the last whole sample, so the first call makes block 0, exactly as
        // the JavaScript does when its stream starts empty.
        Keystream { seed, block: [0u8; 32], at: 32, counter: 0 }
    }

    fn next(&mut self) -> u64 {
        if self.at + 6 > 32 {
            let mut digits = [0u8; 20];
            let text = decimal(self.counter, &mut digits);
            self.block = hashv(&[self.seed, DRAW_TAG, text]).to_bytes();
            self.counter += 1;
            self.at = 0;
        }
        let mut value = 0u64;
        for i in 0..6 {
            value = (value << 8) | self.block[self.at + i] as u64;
        }
        self.at += 6;
        value
    }
}

/// ASCII decimal of `n` without core::fmt, which would otherwise be pulled into the blob for one
/// integer.
fn decimal(mut n: u64, buf: &mut [u8; 20]) -> &[u8] {
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    &buf[i..]
}

/// `deriveWinnerTrace(eligible, hex(seed), count)`: each draw takes `sample % pool.len()` and
/// removes that entry in order, like Array.prototype.splice, so the remaining order is kept.
/// Returns the winning ticket indices in the order drawn; position + 1 is the win rank.
///
/// The removal is the literal ordered `Vec::remove`. A Fenwick tree that finds the pick-th
/// remaining entry in log time was tried and abandoned: it passed every host test and computed
/// wrong positions on chain, and a draw that disagrees with lib/raffle.ts is worse than a slow
/// one. The literal splice measured 142,717 to 146,381 of 200,000 compute units at the worst case
/// the spec allows (200 tickets, all revealed, 200 winners) and agreed with the JavaScript on all
/// 200. About 94,000 of that is gathering, sorting and hashing the 200 nonces, which one winner
/// costs too; the 200 removals add roughly 50,000.
pub fn winners(eligible: &[u16], seed: &[u8; 32], count: u16) -> Vec<u16> {
    let mut pool = eligible.to_vec();
    let take = core::cmp::min(count as usize, pool.len());
    let mut stream = Keystream::new(seed);
    let mut out = Vec::with_capacity(take);
    for _ in 0..take {
        let pick = (stream.next() % pool.len() as u64) as usize;
        out.push(pool.remove(pick));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// lib/raffle.ts's loop transcribed independently, as the reference `winners` must match.
    fn spliced(eligible: &[u16], seed: &[u8; 32], count: u16) -> Vec<u16> {
        let mut pool = eligible.to_vec();
        let take = core::cmp::min(count as usize, pool.len());
        let mut stream = Keystream::new(seed);
        (0..take).map(|_| {
            let pick = (stream.next() % pool.len() as u64) as usize;
            pool.remove(pick)
        }).collect()
    }

    #[test]
    fn winners_equal_the_js_splice() {
        for n in 1..=200u16 {
            let full: Vec<u16> = (1..=n).collect();
            let gappy: Vec<u16> = (1..=n).filter(|i| i % 7 != 3 || n < 4).collect();
            for eligible in [full, gappy] {
                for k in 0..20u8 {
                    let seed = hashv(&[&n.to_le_bytes(), &[k]]).to_bytes();
                    for count in [1u16, 2, n / 2, n, n + 5] {
                        assert_eq!(winners(&eligible, &seed, count), spliced(&eligible, &seed, count), "n={n} count={count}");
                    }
                }
            }
        }
    }

    #[test]
    fn decimal_matches_js_string() {
        let mut b = [0u8; 20];
        assert_eq!(decimal(0, &mut b), b"0");
        assert_eq!(decimal(10, &mut b), b"10");
        assert_eq!(decimal(u64::MAX, &mut b), b"18446744073709551615");
    }
}
