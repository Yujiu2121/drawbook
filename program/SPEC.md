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
| Program keypair | held outside the repository; never commit it |
| Upgrade authority | `GGZaSfv9RY7uNLVTdMhdb1yJgoAsARaBsmpRp1T7Sjor`, still recorded in the program account. The program **can no longer be upgraded by anyone** (the README says why); a changed program would need a new program id. |
| Testnet RPC | `https://testnet.rialo.io:4101` (never `-n testnet`; that preset does not resolve) |
| System program | `11111111111111111111111111111111` |
| Units | 1 RLO = 1e9 kelvin. All amounts are u64 kelvin. |
| Clock | `Clock::get()?.unix_timestamp` is **milliseconds** on Rialo. All times are u64 ms. |

The same program keypair is used on the local network and on testnet, so the id is identical
on both and the browser library hardcodes it once. The program-id keypair survived, so after a
testnet reset the same blob can be deployed to the same id again from any funded key, which then
becomes the new upgrade authority. Short of a reset, everything below is fixed as deployed, which is
why the scheduled draw (below) was built with no change to the program.

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

## Scheduled draw (Rialo's Subscriber program)

Since 2026-10-08 the browser asks Rialo to send Draw by itself. Nothing in the program changed:
the Subscriber program sends the same solitary Draw the creator could send by hand, so codes 17
and 18, the signer rule and the time bounds all apply to it unchanged. Raffles created before the
schedule was added have no subscription and are drawn only by someone sending Draw.

**Seen on testnet, 2026-10-08.** Raffle `AtVDa7C3qhFpjivN7vaqgsXP8p2UzKbSd6Z1zfqZmE9w` (2 tickets,
one-minute reveal window, both revealed) was drawn by the triggered transaction
`3uHik9GzcRC844SV78DrQg1GJ8GP4sEbQkLFEshQWzoJS7cZwJNymgcN1ThRLNVZN4RZ55NxwFovSptDQsY3v3qH` in block
29220468, 123 ms after the window opened and 5,123 ms after the reveal deadline, with nobody
sending Draw. It held one instruction, Draw (data `03`, keys creator, raffle, instructions sysvar),
with the creator as the only signer and fee payer, no Destroy and no ComputeBudget; it used 4,411 of
200,000 compute units and cost the creator 5,000 kelvin. `drawn_at` was 23 ms *before* the window
opened, the lag described under "Timing margin". `getTriggeredTransactions` and
`getSignaturesForAddress(raffle)` both list exactly that one transaction, and `auditDraw` matches.
Reclaiming afterwards returned the 2,797,920-kelvin deposit less a 5,000 fee. Node build
`ed0c9639e542`, the same as the local network the encoding was first run on.

### What is sent

`Create` goes out as three instructions in one transaction, signed by the creator and the raffle
keypair: System `CreateAccount`, raffle `Create`, then a Subscriber `Subscribe`. The raffle and its
schedule exist together or not at all.

| What | Value |
| --- | --- |
| Subscriber program | `Subscriber111111111111111111111111111111111` (native, closed source) |
| Subscribe accounts | `0` creator (signer, writable; pays the rent), `1` subscription account (writable), `2` System program |
| Destroy, Unsubscribe accounts | `0` creator (signer, writable; receives the rent), `1` subscription account (writable) |
| Nonce | the UTF-8 bytes of the first 32 characters of the raffle's base58 address (a 32-byte key never encodes shorter) |
| Subscription account | PDA `["rialo_subscribe", creator, nonce]` of the Subscriber program |
| Encoding | legacy bincode 1.3.3: u32 LE variant tag, integers LE, `Vec`/`String` as u64 length + items, `Option` as u8 flag + value |

Subscribe data, 310 bytes:

| Offset | Bytes | Field |
| ---: | ---: | --- |
| 0 | 4 | u32 `0`, Subscribe |
| 4 | 32 | nonce |
| 36 | 32 | subscriber = creator |
| 68 | 13 | topic: u64 `5` ‖ `"clock"` |
| 81 | 33 | event_account: `01` ‖ `SysvarC1ock11111111111111111111111111111111` |
| 114 | 17 | timestamp_range: `01` ‖ u64 start ‖ u64 end; start = `reveal_deadline + 5000` ms, end = `u64::MAX` (exclusive) |
| 131 | 8 | u64 `1`: one action |
| 139 | 32 | action program id = this program |
| 171 | 8 | u64 `3`: three accounts |
| 179 | 34 | creator, signer `01`, writable `00` |
| 213 | 34 | raffle, signer `00`, writable `01` |
| 247 | 34 | `Sysvar1nstructions1111111111111111111111111`, `00 00` |
| 281 | 9 | u64 `1` ‖ data `03` (Draw) |
| 290 | 4 | u32 `1`: OneShot |
| 294 | 16 | active_commits: u64 `0` ‖ u64 `u64::MAX` (the node rebases the start to the Subscribe's commit) |

Bytes 36..310 are what the subscription account stores, 274 bytes with no header, so its rent is
`(274 + 128) × 6960 = 2,797,920` kelvin on testnet today; the browser asks
`getMinimumBalanceForRentExemption` for the encoded length rather than writing the figure down.
Destroy data is `u32 3 ‖ nonce` and Unsubscribe data `u32 1 ‖ nonce`, 36 bytes each. `scripts/verify-chain.ts` freezes all of it against
bytes from the official `rialo-subscriber-interface` 0.21.0-alpha.0 crate and a transaction sent by
the Rialo CLI.

**No Destroy in the action, on purpose.** The crate's `subscribe_to` appends a Subscriber `Destroy`
to every OneShot, so the triggered transaction would be `[Draw, Destroy]` and Draw would refuse
with 17. That was run on a local network: refused, rolled back, spent, never retried, its rent
stranded. Allowing one trailing Destroy in the program was rejected: it is not needed, the program
can no longer be upgraded, and it would reopen the retry the rule closes (an earlier transaction
from the creator in the trigger's block could compute the outcome, every transaction in a block
reading the same `get_random_seed()`, and destroy the subscription only when it dislikes it,
failing the triggered `[Draw, Destroy]`).

### What Rialo sends

When a block's clock event falls in the window, the node builds a transaction from the
subscription: the creator at account 0 as the only signer and fee payer, the one Draw instruction
at transaction level (stack height 1, instruction count 1, index 0), nothing injected. It is byte for
byte the Draw the creator could have sent, so Draw's checks pass as they would for a person. The
node charges the creator 5,000 kelvin per firing whether Draw succeeds or not. A OneShot fires once
and is then dropped by the matcher; `getTriggeredTransactions [subscription account, "limit"]`
lists the transaction, and still does after the account is closed. The account itself stays,
holding its rent, until the creator reclaims it; the raffle page offers that once the raffle is
settled.

**Reclaiming is Destroy then Unsubscribe, in one transaction.** Destroy moves the rent back to the
creator but does not take the subscription out of the node's matcher: on the local network a
OneShot whose account had been destroyed still fired at its time (and was turned away with 14, at
the creator's expense). Unsubscribe logs `rialo_unsubscribe::<account>`, and the matcher drops the
subscription when it sees that line for an account left with zero kelvin. Run on the local network
on 2026-10-08: Destroy + Unsubscribe before the time returned the deposit and nothing fired;
after a firing it returned the deposit just the same. Unsubscribe alone, rerun the same day, also
returned the deposit (2,792,920 net), took the subscription out of the matcher and nothing fired;
Destroy alone returned the deposit and the Draw still fired.

Code 18 cannot trip on it: a Reveal needs `now < reveal_deadline` and the trigger needs
`now >= reveal_deadline` to pass NotReady, so they cannot share a block.

### Timing margin

A triggered transaction reads a clock about one block behind the block time that matched it. Across
six local firings Draw saw a time 41 to 102 ms *before* the window opened, so a window opening
exactly at the reveal deadline was refused with 13 (NotReady) and, being a OneShot, never retried.
Five seconds after the deadline covers a stall of about forty testnet blocks. The end is
`u64::MAX`, and so is the commit window, so the subscription cannot lapse before a deadline up to
the program's ceilings.

### Failure modes

| Case | What happens |
| --- | --- |
| Every ticket revealed early and someone draws by hand | The trigger later gets 14 (AlreadySettled) and changes nothing; the creator pays 5,000. Reclaiming the deposit (Destroy + Unsubscribe) before the due time cancels it; Destroy alone does not. |
| A manual Draw and the trigger in the same block | One of them gets 14; the page says the raffle was settled a moment earlier. |
| Nobody bought, or nobody revealed | The trigger settles it as void, as a person's Draw would. |
| The trigger arrives too early (window at or before the deadline) | 13, spent, no retry. The 5 s margin prevents it; a manual Draw still works. |
| The creator Updates or Destroys the subscription | The page decodes the account on every read and calls it scheduled only when it is exactly the form above (subscriber = creator, OneShot, clock topic and sysvar, start ≥ reveal deadline, open end, open commit window, one action byte-equal to this raffle's Draw). Anything else shows as not counted, and Draw stays a button. Any extra instruction makes the trigger fail with 17, so Update cannot turn the schedule into a retry. A Destroy alone closes the account but leaves the Draw queued: the page reads "withdrawn" and still shows the Draw once Rialo sends it. |
| Rialo refuses Subscribe (a later build rejects the hand-built form) | The Create transaction fails at instruction 2; the browser creates the raffle again without it, from the same raffle key, and says the draw was not scheduled. |
| The creator cannot pay the 5,000 fee at firing time | Not observed; the node mentions a triggered-fee escrow. The manual Draw covers it. |
| A subscription waits weeks across node restarts or upgrades | Not observed. Before its time the page asks `getSubscription` as well as reading the account, and calls it scheduled only if the node does not answer "not found" (a OneShot that has not fired is always found); after its time the "late" state (no firing 30 s after the time) brings the button back. |
| Testnet reset | Raffle and subscription vanish together; nothing is stranded. |

Behaviour of the closed-source Subscriber is observed on the 0.21.0-alpha.0 build, not documented;
rerun `scripts/auto-draw-check.ts` whenever the node's `getVersion` changes.

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
}): Promise<Sent & {
  raffle: string;
  schedule: string | null;          // the subscription account, null when Rialo refused it
  drawAt: number | null;            // reveal_deadline + 5000, null when not scheduled
  scheduleError: string | null;     // why it was refused
  scheduleSignature: string | null; // the refused attempt, a receipt for its fee
}>;
export function buyTicket(wallet: Wallet, raffle: string): Promise<Sent & { ticketIndex: number }>;
export function revealTicket(wallet: Wallet, raffle: string, ticketIndex: number): Promise<Sent>;
export function drawRaffle(wallet: Wallet, raffle: string): Promise<Sent>;
export function claimAll(wallet: Wallet, raffle: string): Promise<Sent[]>;   // every unpaid entitlement
export function fetchRaffle(raffle: string): Promise<ChainRaffle | null>;
export function listRaffles(): Promise<ChainRaffle[]>;                      // getAccountsByOwner(PROGRAM_ID)
export function raffleActivity(raffle: string): Promise<{ signature: string; at: number | null }[]>;
export function createCost(supply: number, prize: bigint): Promise<bigint>; // rent + prize + schedule deposit + firing fee + fees
export function scheduleCost(): Promise<{ deposit: bigint; fee: bigint }>;
export function fetchSchedule(r: ChainRaffle): Promise<ScheduleRead>;      // account, history, held (getSubscription), newest firing
export function reclaimSchedule(wallet: Wallet, raffle: string): Promise<Sent & { kelvin: bigint }>; // Destroy + Unsubscribe, creator only, once settled
export class ChainError extends Error { code: number | null; logs: string[]; instruction: number | null }

// lib/chain/subscriber.ts  (pure)
export const SUBSCRIBER_PROGRAM_ID: string, CLOCK_SYSVAR_ID: string, DRAW_MARGIN_MS = 5000, SCHEDULE_LEN /* 274 */;
export function scheduleAddress(creator: string, raffle: string): string;
export function subscribeDrawIx(creator: Uint8Array, raffle: string, revealDeadline: number): Instruction;
export function destroyScheduleIx(creator: Uint8Array, raffle: string): Instruction;
export function decodeSubscription(data: Uint8Array): Subscription;
export function isDrawbookSchedule(s: Subscription, r: ChainRaffle): boolean;
export function scheduleState(r: ChainRaffle, read: ScheduleRead, now: number): ScheduleState;
// "none" | "withdrawn" | "unrecognised" | "scheduled" | "due" | "late" | "dropped" | "sent"

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
