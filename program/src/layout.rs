//! The raffle account's byte layout, exactly as program/SPEC.md fixes it.
//!
//! Hand-rolled rather than borsh or serde because the layout is a contract with a browser library
//! written separately, and a fixed table of offsets is the one form both sides can check against
//! the spec line by line. It also keeps a serialisation framework out of a blob whose deploy rent
//! has to fit a 1 RLO faucet grant.

pub const HEADER_LEN: usize = 208;
pub const TICKET_LEN: usize = 84;
pub const MIN_SUPPLY: u16 = 2;
pub const MAX_SUPPLY: u16 = 200;
pub const NONCE_LEN: usize = 16;
pub const TITLE_LEN: usize = 32;
pub const MAGIC: &[u8; 8] = b"DRWBOOK1";

/// The longest sale a raffle may run, from Create to its commit deadline. 31 days, so a form that
/// offers 30 is never refused over a few seconds of clock difference between browser and chain.
/// Without a ceiling one holder who never reveals could lock every kelvin until the year 9999.
pub const MAX_SALE_MS: u64 = 31 * 24 * 60 * 60 * 1000;
/// The reveal window, from commit deadline to reveal deadline: at least a minute, so holders have
/// a real chance to reveal and a creator cannot collect their bonds by closing it at once, and at
/// most seven days, so an unrevealed ticket cannot hold everyone's money for long.
pub const MIN_REVEAL_MS: u64 = 60 * 1000;
pub const MAX_REVEAL_MS: u64 = 7 * 24 * 60 * 60 * 1000;
pub const VERSION: u8 = 1;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_DRAWN: u8 = 1;
pub const STATUS_VOID: u8 = 2;

// Header offsets.
pub const H_MAGIC: usize = 0;
pub const H_VERSION: usize = 8;
pub const H_STATUS: usize = 9;
pub const H_SUPPLY: usize = 10;
pub const H_WINNERS: usize = 12;
pub const H_SOLD: usize = 14;
pub const H_REVEALED: usize = 16;
pub const H_EFFECTIVE_WINNERS: usize = 18;
/// Low 32 bits of the slot of the most recent Reveal. Draw refuses to run in that same slot,
/// because every transaction in a block reads the same get_random_seed() value. Only equality is
/// ever tested, so keeping 32 bits of the slot loses nothing that matters.
pub const H_LAST_REVEAL_SLOT: usize = 20;
pub const H_CREATOR: usize = 24;
pub const H_PRIZE: usize = 56;
pub const H_TICKET_PRICE: usize = 64;
pub const H_REVEAL_BOND: usize = 72;
pub const H_COMMIT_DEADLINE: usize = 80;
pub const H_REVEAL_DEADLINE: usize = 88;
pub const H_CREATED_AT: usize = 96;
pub const H_DRAWN_AT: usize = 104;
pub const H_CHAIN_SEED: usize = 112;
pub const H_SEED: usize = 120;
pub const H_POOL: usize = 152;
pub const H_PER_WINNER: usize = 160;
pub const H_CREATOR_REFUNDED: usize = 168;
pub const H_TITLE: usize = 176;

// Offsets inside one 84-byte ticket record.
pub const T_HOLDER: usize = 0;
pub const T_COMMITMENT: usize = 32;
pub const T_NONCE: usize = 64;
pub const T_FLAGS: usize = 80;
pub const T_WIN_RANK: usize = 82;

pub const FLAG_REVEALED: u8 = 1;
pub const FLAG_WON: u8 = 2;
pub const FLAG_PAID: u8 = 4;

/// Account length for a given supply. Computed in usize, where 208 + 84 × 65535 cannot overflow,
/// so an out-of-range supply in Create data yields a length mismatch rather than a wrap.
pub fn account_len(supply: u16) -> usize {
    HEADER_LEN + TICKET_LEN * supply as usize
}

/// Byte offset of ticket `index` (1-based). Callers range-check `index` against `sold` or
/// `supply` first, so `index - 1` never underflows.
pub fn ticket_at(index: u16) -> usize {
    HEADER_LEN + TICKET_LEN * (index as usize - 1)
}

pub fn get_u16(d: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([d[at], d[at + 1]])
}

pub fn get_u32(d: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([d[at], d[at + 1], d[at + 2], d[at + 3]])
}

pub fn put_u32(d: &mut [u8], at: usize, v: u32) {
    d[at..at + 4].copy_from_slice(&v.to_le_bytes());
}

pub fn put_u16(d: &mut [u8], at: usize, v: u16) {
    d[at..at + 2].copy_from_slice(&v.to_le_bytes());
}

pub fn get_u64(d: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[at..at + 8]);
    u64::from_le_bytes(b)
}

pub fn put_u64(d: &mut [u8], at: usize, v: u64) {
    d[at..at + 8].copy_from_slice(&v.to_le_bytes());
}
