# Drawbook raffle program: interface specification

The on-chain raffle for Drawbook, on Rialo testnet. This file is the contract between three
pieces that are built separately and must agree byte for byte: the Rust program in
`program/`, the browser library in `lib/chain/`, and the pages that call it.

`lib/raffle.ts` remains the executable specification of the draw. The program reproduces its
winner selection exactly (`deriveWinnerTrace`), so a page can audit an on-chain draw with the
existing `deriveWinners`. Only the preimages change, from text to fixed-width bytes, because a
program should not format base58 and decimal strings to hash them.

## Identity

| What | Value |
| --- | --- |
| Program id | `74LNM1Hn6BCQpHyzHYkqrQP4H6N1At3CsiZ6CH4UsMG6` |
| Program keypair | held by the deployer outside the repository; never commit it |
| Upgrade authority / deployer | `GGZaSfv9RY7uNLVTdMhdb1yJgoAsARaBsmpRp1T7Sjor`, key held outside the repository |
| Testnet RPC | `https://testnet.rialo.io:4101` (never `-n testnet`; that preset does not resolve) |
| System program | `11111111111111111111111111111111` |
| Units | 1 RLO = 1e9 kelvin. All amounts are u64 kelvin. |
| Clock | `Clock::get()?.unix_timestamp` is **milliseconds** on Rialo. All times are u64 ms. |

The same program keypair is used on the local network and on testnet, so the id is identical
on both and the browser library hardcodes it once.

## Raffle account layout

One account per raffle, owned by the program, created by the client with a fresh keypair in the
same transaction as `Create`. All integers little-endian unless stated otherwise.

```
HEADER_LEN = 208      TICKET_LEN = 84      len = HEADER_LEN + TICKET_LEN * supply
MIN_SUPPLY = 2        MAX_SUPPLY = 200     NONCE_LEN = 16      TITLE_LEN = 32
MAGIC = b"DRWBOOK1"
```

| Offset | Size | Field | Notes |
| ---: | ---: | --- | --- |
| 0 | 8 | magic | `DRWBOOK1`; all zero means uninitialised |
| 8 | 1 | version | `1` |
| 9 | 1 | status | `0` open, `1` drawn, `2` void |
| 10 | 2 | supply | u16 |
| 12 | 2 | winners | u16, as configured |
| 14 | 2 | sold | u16 |
| 16 | 2 | revealed | u16 |
| 18 | 2 | effective_winners | u16, `min(winners, revealed)`, set at draw |
| 20 | 4 | last_reveal_slot | u32, low 32 bits of the slot of the latest Reveal; Draw refuses to run in that slot |
| 24 | 32 | creator | pubkey |
| 56 | 8 | prize | u64 kelvin, deposited at Create |
| 64 | 8 | ticket_price | u64 kelvin |
| 72 | 8 | reveal_bond | u64 kelvin |
| 80 | 8 | commit_deadline | u64 ms; the sale closes here or when sold out |
| 88 | 8 | reveal_deadline | u64 ms; reveals close here |
| 96 | 8 | created_at | u64 ms, chain clock at Create |
| 104 | 8 | drawn_at | u64 ms, 0 until the draw |
| 112 | 8 | chain_seed | u64 from `get_random_seed()` at the draw, 0 until then |
| 120 | 32 | seed | the draw seed, zero until the draw |
| 152 | 8 | pool | u64 kelvin, set at the draw |
| 160 | 8 | per_winner | u64 kelvin, `pool / effective_winners`, set at the draw |
| 168 | 1 | creator_refunded | u8, void path only |
| 169 | 7 | reserved | zero |
| 176 | 32 | title | UTF-8, zero padded |
| 208 | 84 × supply | tickets | ticket `i` (1-based) at `208 + 84 * (i - 1)` |

Ticket record, 84 bytes:

| Offset | Size | Field | Notes |
| ---: | ---: | --- | --- |
| 0 | 32 | holder | zero while unsold |
| 32 | 32 | commitment | sha256, see below |
| 64 | 16 | nonce | zero until revealed |
| 80 | 1 | flags | bit0 revealed, bit1 won, bit2 paid |
| 81 | 1 | reserved | zero |
| 82 | 2 | win_rank | u16, 1-based order drawn; 0 when not a winner |

Tickets are sold in order: the next ticket is always `sold + 1`.

## Hashes

```
commitment = sha256( "drawbook-v2|commit|"            19 ASCII bytes
                     ‖ raffle_address                  32 bytes
                     ‖ ticket_index                    u16 little-endian
                     ‖ holder                          32 bytes
                     ‖ nonce )                         16 bytes

seed       = sha256( "drawbook-v2|seed|"               17 ASCII bytes
                     ‖ raffle_address                  32 bytes
                     ‖ revealed nonces, sorted ascending bytewise, concatenated (16 bytes each)
                     ‖ chain_seed )                    u64 BIG-endian, 8 bytes
```

Winner selection is `deriveWinnerTrace(eligible, hex(seed), effective_winners)` from
`lib/raffle.ts`, reproduced exactly:

- `eligible` is the revealed ticket indices in ascending order (1-based).
- Keystream block `k` (k = 0, 1, 2, ...) is `sha256(seed ‖ "|draw|" ‖ ASCII decimal of k)`.
- Each sample is the next 6 bytes of the current block read **big-endian** as an integer. A block
  yields 5 samples (30 of its 32 bytes); when fewer than 6 bytes remain, the next block is made.
- For each draw: `pick = sample % pool.len()`, `winner = pool.remove(pick)` (an ordered removal
  that keeps the remaining order, exactly like `Array.prototype.splice`), `win_rank = draw number`.

Payout: `pool = prize + sold * ticket_price + (sold - revealed) * reveal_bond`, each winner gets
`per_winner = pool / effective_winners` (integer division), and the ticket with `win_rank == 1`
also gets the remainder `pool - per_winner * effective_winners`. Bonds of revealed tickets are
refunded at reveal time, so the account always holds `rent reserve + pool` after the draw.

## Instructions

Instruction data starts with a one-byte tag. Errors are `ProgramError::Custom(code)` with the
codes listed at the end, so the browser can explain a refusal.

### 0 Create

Data (77 bytes): `tag ‖ prize u64 ‖ ticket_price u64 ‖ reveal_bond u64 ‖ supply u16 ‖ winners u16 ‖
commit_deadline u64 ‖ reveal_deadline u64 ‖ title [32]`.

Accounts: `0` creator (signer, writable), `1` raffle (writable), `2` system program.

The client sends two instructions in one transaction: System `CreateAccount` (from creator, new
account = raffle keypair, kelvins = rent-exempt minimum for `len`, space = `len`, owner = program
id), then `Create`. Both the creator and the raffle keypair sign.

Checks: raffle owned by the program; data length is exactly `len` for `supply`; magic is zero;
`MIN_SUPPLY <= supply <= MAX_SUPPLY`; `1 <= winners <= supply`; `ticket_price >= 1`;
`now < commit_deadline <= now + 31 days`; `commit_deadline + 1 minute <= reveal_deadline <=
commit_deadline + 7 days`. The ceilings stop one unrevealed ticket from locking every kelvin for
years; the reveal floor stops a creator who holds a ticket from closing reveals before anyone else
can reveal and collecting their bonds. Then a CPI system transfer of `prize` from creator to
raffle (skipped when prize is 0), and the header is written with `created_at = now`.

### 1 Buy

Data (35 bytes): `tag ‖ ticket_index u16 ‖ commitment [32]`.

Accounts: `0` buyer (signer, writable), `1` raffle (writable), `2` system program.

Checks: initialised; status open; `now < commit_deadline`; `sold < supply`;
`ticket_index == sold + 1` (so a commitment that binds the wrong index is refused rather than
becoming unrevealable). Then a CPI system transfer of `ticket_price + reveal_bond` from buyer to
raffle; holder and commitment are written and `sold += 1`.

### 2 Reveal

Data (19 bytes): `tag ‖ ticket_index u16 ‖ nonce [16]`.

Accounts: `0` holder (signer, writable), `1` raffle (writable).

Checks: status open; the sale is closed (`now >= commit_deadline` or `sold == supply`);
`now < reveal_deadline`; `1 <= ticket_index <= sold`; signer is the ticket's holder; not already
revealed; the recomputed commitment equals the stored one. Then the nonce is stored, the revealed
flag set, `revealed += 1`, `last_reveal_slot` set to the current slot, and the bond is refunded by moving `reveal_bond` kelvin directly from
the raffle account to the holder.

### 3 Draw

Data (1 byte): `tag`.

Accounts: `0` caller (signer), `1` raffle (writable), `2` the instructions sysvar
`Sysvar1nstructions1111111111111111111111111`. Anyone may call it.

Draw must run alone: it refuses with 17 unless the third account is the instructions sysvar, it is
called directly by the transaction (stack height 1, not through CPI), and it is the only
instruction in its transaction (instruction count 1, current index 0). Otherwise anything sharing
the transaction could read the result and make the whole transaction fail when it dislikes it,
then try again in the next block. It also refuses with 18 when a raffle with reveals would be drawn
in the same slot as its latest Reveal, because every transaction in a block reads the same
`get_random_seed()` value, so a reveal in the draw's own block could be decided after computing
the outcome. Both were measured on the local network on 2026-10-07: the stack height is 1 at
transaction level and 2 inside a CPI, the seed is identical for every transaction in a slot and
differs between slots, and the RPC offers no `simulateTransaction`.

Ready when status is open and either reveals have closed (`now >= reveal_deadline`), or the sale
is closed and every sold ticket is revealed (`revealed == sold`). The second case lets a raffle
whose holders all revealed settle at once instead of idling until the deadline. A raffle with no
sales becomes ready as soon as its sale closes.

If `revealed == 0`: status becomes void, `drawn_at = now`, and nothing else changes.

Otherwise: `chain_seed = get_random_seed()`, compute the seed and winners as above, set the won
flag and `win_rank` on each winner, store `chain_seed`, `seed`, `effective_winners`, `pool`,
`per_winner`, `drawn_at = now`, and status drawn. Kelvins do not move here.

The draw-block limit is real and is stated rather than hidden: `chain_seed` is read at the draw,
after every nonce is public, so whoever produces the draw block could try candidate chain values
if they can influence that value at all. An ordinary caller cannot: the draw runs alone, one block
after the last reveal, and nothing can preview a block's value ahead of time. A holder can still
withhold a reveal, which costs the bond and is blind, since the draw block's value is unknown.

### 4 Claim

Data (3 bytes): `tag ‖ ticket_index u16`.

Accounts: `0` raffle (writable), `1` recipient (writable). No signer is required: the money can
only go to the recorded owner, so anyone may push a payout.

- Drawn: the ticket must be a winner and not yet paid, and recipient must be its holder. Amount is
  `per_winner`, plus the remainder when `win_rank == 1`. Sets the paid flag.
- Void, `ticket_index == 0`: recipient must be the creator and `creator_refunded == 0`. Amount is
  `prize`. Sets `creator_refunded`.
- Void, `ticket_index >= 1`: the ticket must be sold and not paid, and recipient must be its holder.
  Amount is `ticket_price + reveal_bond`. Sets the paid flag.

Kelvins move directly from the raffle account to the recipient. Several Claims may share one
transaction.

## Error codes

| Code | Name | Meaning |
| ---: | --- | --- |
| 1 | BadInstruction | unknown tag or wrong data length |
| 2 | BadAccount | wrong owner, wrong size, missing signer or writable flag |
| 3 | AlreadyInitialised | Create on a used account |
| 4 | NotInitialised | magic missing |
| 5 | BadConfig | supply, winners, price or deadlines out of range |
| 6 | SaleClosed | Buy after the deadline or when sold out |
| 7 | WrongTicket | Buy index is not `sold + 1`, or the index is out of range |
| 8 | RevealsNotOpen | Reveal before the sale closed |
| 9 | RevealsClosed | Reveal at or after the reveal deadline |
| 10 | NotHolder | signer or recipient is not the ticket's holder (or creator) |
| 11 | AlreadyRevealed | |
| 12 | CommitmentMismatch | the nonce does not hash to the commitment |
| 13 | NotReady | Draw before it is ready |
| 14 | AlreadySettled | Draw on a drawn or void raffle |
| 15 | NothingToClaim | not a winner, already paid, or the raffle is not settled |
| 16 | Arithmetic | overflow or an account would go below zero |
| 17 | DrawMustRunAlone | Draw is not the only, directly called instruction, or the sysvar account is wrong |
| 18 | TooSoon | Draw in the same slot as the latest Reveal; one block later it succeeds |

## Browser library contract (`lib/chain/`)

Pages import only these names, so the library and the pages can be written in parallel.

```ts
// lib/chain/program.ts
export const PROGRAM_ID: string;                 // "74LNM1Hn6BCQpHyzHYkqrQP4H6N1At3CsiZ6CH4UsMG6"
export const HEADER_LEN = 208, TICKET_LEN = 84, MIN_SUPPLY = 2, MAX_SUPPLY = 200;
export type ChainStatus = "open" | "drawn" | "void";
export type ChainPhase = "selling" | "revealing" | "ready" | "drawn" | "void";
export interface ChainTicket {
  index: number; holder: string | null; commitment: string | null; nonce: string | null;
  revealed: boolean; won: boolean; paid: boolean; winRank: number;
}
export interface ChainRaffle {
  address: string; status: ChainStatus; supply: number; winners: number; sold: number;
  revealed: number; effectiveWinners: number; creator: string;
  prize: bigint; ticketPrice: bigint; revealBond: bigint;
  commitDeadline: number; revealDeadline: number; createdAt: number; drawnAt: number;
  chainSeed: bigint; seed: string | null; pool: bigint; perWinner: bigint;
  creatorRefunded: boolean; title: string; tickets: ChainTicket[]; kelvins: bigint;
}
export function accountLength(supply: number): number;
export function decodeRaffle(address: string, data: Uint8Array, kelvins: bigint): ChainRaffle;
export function phaseOf(r: ChainRaffle, nowMs: number): ChainPhase;
export function commitmentV2(raffle: string, ticketIndex: number, holder: string, nonceHex: string): string; // hex
export function seedV2(raffle: string, nonceHexes: string[], chainSeed: bigint): string;                   // hex
export function auditDraw(r: ChainRaffle): { seed: string; winners: number[]; matches: boolean } | null;
export function payoutOf(r: ChainRaffle, ticketIndex: number): bigint;   // what Claim would pay now
export function errorMessage(code: number): string;                      // plain-English refusal

// lib/chain/actions.ts  (every function signs with the browser wallet and waits for execution)
export interface Sent { signature: string }
export function createRaffle(wallet: Wallet, p: {
  title: string; prize: bigint; ticketPrice: bigint; revealBond: bigint;
  supply: number; winners: number; commitDeadline: number; revealDeadline: number;
}): Promise<Sent & { raffle: string }>;
export function buyTicket(wallet: Wallet, raffle: string): Promise<Sent & { ticketIndex: number }>;
export function revealTicket(wallet: Wallet, raffle: string, ticketIndex: number): Promise<Sent>;
export function drawRaffle(wallet: Wallet, raffle: string): Promise<Sent>;
export function claimAll(wallet: Wallet, raffle: string): Promise<Sent[]>;   // every unpaid entitlement
export function fetchRaffle(raffle: string): Promise<ChainRaffle | null>;
export function listRaffles(): Promise<ChainRaffle[]>;                      // getAccountsByOwner(PROGRAM_ID)
export function raffleActivity(raffle: string): Promise<{ signature: string; at: number | null }[]>;
export function createCost(supply: number, prize: bigint): Promise<bigint>; // rent + prize + fees
export class ChainError extends Error { code: number | null; logs: string[] }

// lib/chain/nonces.ts  (localStorage, every access in try/catch)
export function saveNonce(raffle: string, ticketIndex: number, holder: string, nonceHex: string): boolean; // true when it reads back
export function loadNonces(raffle: string, ticketIndex: number, holder: string): string[];  // every candidate for that number
export function findNonce(raffle: string, ticketIndex: number, holder: string, commitmentHex: string): string | null; // the one a reveal sends
```

`buyTicket` generates the nonce with `newNonce()` from `lib/raffle.ts`, reads `sold` to pick
`ticket_index = sold + 1`, saves the nonce **before** sending (a refresh after sending must not
lose it), and retries once with a fresh index if the program answers `WrongTicket`.

The RPC endpoint comes from `process.env.NEXT_PUBLIC_RIALO_RPC`, defaulting to testnet, so the
same build can be pointed at a local network for testing.
