# Drawbook

A commit-reveal raffle on Rialo testnet. Every ticket buyer commits to a secret, reveals it after
the sale closes, and the winners come out of all the revealed secrets together with a value the
chain supplies at the draw. The draw is randomized and checkable: anyone can recompute it from
the raffle account's public data.

Live at **https://drawbook-rialo.vercel.app**

## What is real

| | |
|---|---|
| The raffle program | **deployed on Rialo testnet**, program id `EQGb5xL2bgRuEFxY2FN25eFrgKDhTpZjRUbEQtYmoLLR` |
| Deploy, buy, reveal, draw, claim | **real signed transactions** from a burner wallet held in the browser |
| The draw check on a live raffle | **recomputed from chain data**; it can fail |
| The draw trigger | **sent by Rialo**: Create schedules Draw with Rialo's Subscriber program, and Rialo sends it by itself 5 s after the reveal deadline (seen on testnet, below); anyone can also send Draw once every ticket is revealed. A raffle whose schedule Rialo refused has none and is drawn by pressing Draw |
| Raffles 1 to 5 (`/raffle/1`..`/raffle/5`) | fixed sample data, not on chain, clock starting 30 Jul 2026 |
| Upgrades | **the deployer can still upgrade it during the testnet period**; its upgrade authority is `8oM9XHmeYniw7T4vNFm8br9BfVvL6EfV2ryM81Dgs4M9` |
| The first program | `74LNM1Hn6BCQpHyzHYkqrQP4H6N1At3CsiZ6CH4UsMG6` ran the same code until it was **retired** on 2026-10-08 so the raffle list could start empty (its upgrade key had been lost); its raffles stay on chain, unlisted, and their `/r` links say so |
| Rent | each raffle account **keeps its rent reserve** after every claim, about 0.0035 RLO for 2 tickets; no instruction closes it |

Testnet only. The coins have no value and testnet can be reset. Live raffles open at
`/r/<raffle address>`.

## How the draw works

The program is specified byte for byte in [`program/SPEC.md`](program/SPEC.md), and `/docs` restates
it. The two preimages are fixed-width bytes joined with nothing between them:

```
commitment = sha256( "drawbook-v2|commit|"   19 ASCII bytes
                     ‖ raffle address         32 bytes
                     ‖ ticket_index           u16 little-endian
                     ‖ holder address         32 bytes
                     ‖ nonce )                16 bytes

seed       = sha256( "drawbook-v2|seed|"     17 ASCII bytes
                     ‖ raffle address         32 bytes
                     ‖ revealed nonces        16 bytes each, sorted ascending bytewise
                     ‖ chain_seed )           u64 big-endian, from get_random_seed() at the draw
```

Winners: keystream block `k` is `sha256(seed ‖ "|draw|" ‖ decimal k)`, each sample is the next 6
bytes big-endian (5 per block), and each draw removes `pool[sample % pool.length]` keeping the
rest in order. `effective_winners = min(winners, revealed)`. The pool is
`prize + sold × ticket_price + (sold - revealed) × reveal_bond`: a bond comes back at reveal, and
an unrevealed bond joins the pool. Winners collect with Claim. A raffle where nobody revealed is
void, and everyone gets everything back. The program reproduces `deriveWinnerTrace` in
`lib/raffle.ts` exactly, so the browser checks an on-chain draw with the same code.

Create bounds the clock: `now < commit_deadline <= now + 31 days`, and the reveal window runs from
`commit_deadline + 1 minute` to `commit_deadline + 7 days` (error 5 otherwise). The ceilings stop one
unrevealed ticket from locking the pool for years; the floor stops a creator from closing reveals
before anyone else can reveal. The latest reveal's slot is kept in the header as `last_reveal_slot`
(offset 20).

Draw must be the only instruction in its transaction and sent directly, not through another
program (checked through the instructions sysvar, error 17), so nothing can read the winners and
fail the transaction to retry. It also refuses to run in the same block as the latest reveal
(error 18), because every transaction in a block reads the same chain value.

The sample raffles predate the program and use the v1 text formulas (`rialo-raffle-v1|...`);
their exact encoding is in the "sample raffles" section of `/docs`.

## The scheduled draw

Nobody has to press Draw. `Create` goes out as three instructions in one transaction: System
`CreateAccount`, the raffle's `Create`, and a `Subscribe` to Rialo's Subscriber program
(`Subscriber111111111111111111111111111111111`), signed by the creator. It registers a OneShot
subscription on the `clock` topic whose window opens at `reveal_deadline + 5000` ms and whose one
action is this raffle's Draw, exactly as a person would send it. When the window opens, Rialo sends
that Draw in the creator's name. The program did not change: the triggered transaction is a
solitary Draw, so errors 17 and 18 apply to it as they do to anyone.

- **No Destroy in the action.** The crate's `subscribe_to` appends a Subscriber `Destroy` to every
  OneShot; the triggered transaction would then hold two instructions and Draw would refuse it with
  17. So the 310-byte `Subscribe` is encoded by hand in `lib/chain/subscriber.ts`, and
  `scripts/verify-chain.ts` checks it against bytes from the official crate and from a transaction
  the Rialo CLI sent. The layout is in [`program/SPEC.md`](program/SPEC.md#scheduled-draw-rialos-subscriber-program).
- **Why 5 seconds.** A triggered transaction reads a clock slightly behind the block that matched
  it, and a OneShot that arrives too early is refused as `NotReady` and never sent again.
- **Cost to the creator.** A deposit of 2,797,920 kelvin (about 0.0028 RLO), the rent of the
  274-byte subscription account, returned when the creator reclaims it on the raffle page after the
  draw (Destroy and Unsubscribe, one transaction, 5,000 kelvin fee); plus 5,000 kelvin when Rialo
  sends Draw, whether it succeeds or not.
- **When it does not fire.** A OneShot is not retried. If the raffle was drawn by hand first, Rialo's
  Draw is refused with 14 and changes nothing. If it has not arrived 30 s after its time, the raffle
  page brings the Draw button back. If Rialo refuses the `Subscribe`, the browser creates the raffle
  without it and says so.
- **Not yet observed:** a subscription that waits weeks across node restarts or upgrades, and a
  creator who cannot pay the firing fee. The Draw button covers both.

**Seen on testnet on 2026-10-08,** on the first program (same code). Raffle
`AtVDa7C3qhFpjivN7vaqgsXP8p2UzKbSd6Z1zfqZmE9w` (2 tickets, one-minute reveal window) was drawn by
Rialo 5,123 ms after its reveal deadline, with nobody pressing Draw: transaction
`3uHik9GzcRC844SV78DrQg1GJ8GP4sEbQkLFEshQWzoJS7cZwJNymgcN1ThRLNVZN4RZ55NxwFovSptDQsY3v3qH`, one
instruction, the creator its only signer and fee payer, 4,411 compute units. `auditDraw` recomputed
the same winner, and `getTriggeredTransactions` on the subscription account lists exactly that one
transaction. The Subscriber program is closed source, so this is behaviour observed on node build
`ed0c9639e542`, not documented; rerun the check below when `getVersion` changes.

Settling the moment the last holder reveals cannot be scheduled: a predicate matches a clock or an
event topic, and the program emits no event.

**What this does not promise.** `chain_seed` is read after every nonce is public, so whoever
produces the draw block may be able to influence it and keep a value that suits them, without
holding a ticket. A holder can also withhold a reveal, which changes the seed, at the cost of their
bond and without knowing the chain value in advance. Say "randomized and checkable", nothing
stronger.

## Running it

```bash
pnpm install
pnpm dev        # http://localhost:3333
```

The port is 3333, not 3000, set in `package.json` as `${PORT:-3333}`. The RPC endpoint comes from
`NEXT_PUBLIC_RIALO_RPC` and defaults to testnet (`https://testnet.rialo.io:4101`).

## Verification

```bash
pnpm verify    # offline: three suites, 325 checks
```

| Suite | Checks | What it asserts |
|---|---:|---|
| `scripts/verify-sha256.ts` | 20 | SHA-256 against FIPS 180-4 vectors, plus 400 random cross-checks against `node:crypto` |
| `scripts/verify-raffle.ts` | 75 | the draw in `lib/raffle.ts`: determinism, distinct winners, independence from reveal order, the winner cap, payout conservation, a tamper-rejecting audit, chi-square uniformity, the sample data |
| `scripts/verify-chain.ts` | 230 | the browser library in `lib/chain/`: transactions against `@rialo/ts-cdk` fixtures, the v2 hashes against `node:crypto`, account decoding, the draw check, payouts and refusals, and the schedule (the `Subscribe` bytes against the official crate and a CLI transaction, the exact-form check, the states the raffle page shows, the fallback when Rialo refuses it), and that an account of the retired first program is named rather than decoded |

Count the `PASS` lines rather than trusting this table. The chi-square statistic is computed from
fresh random seeds on every run, so it changes each time; the test passes while it stays under the
critical value of 43.82 (df 19, p 0.001).

Against a running network (a local one, below):

```bash
node --no-warnings program/tests/e2e.mjs http://127.0.0.1:4101   # the program itself, end to end
node scripts/smoke-chain.ts http://127.0.0.1:4101                # the same through lib/chain/
(cd program && cargo test --release --lib)                       # winner selection, host side
```

Both network scripts fund their wallets from the network's own faucet and refuse any endpoint that
is not on this machine. Never point a test at the testnet faucet: it gives at most 1 RLO per call
and rate limits per IP.

The scheduled draw has its own end-to-end check, which waits for Rialo instead of pressing Draw:

```bash
node scripts/auto-draw-check.ts <rpc url> <payer keypair.json> [--fund-from-local-faucet] [--edge-cases]
```

It pays from the keypair file (64-byte array) and asks a faucet only with
`--fund-from-local-faucet`, which it refuses for any endpoint not on this machine. `--edge-cases`
adds a raffle drawn by hand before its schedule, one reclaimed before it is due, and one whose
schedule Rialo refuses. The testnet run on 2026-10-08 used an adapted copy that reads the browser's
key form and waits longer; it passed all 39 checks.

`node scripts/verify-wallet.ts` is deliberately outside `pnpm verify`: it talks to live testnet.

## The program

`program/` is a plain `rialo-s-*` Rust program (no framework, so the deploy rent fits a single
faucet grant), built for Rialo's RISC-V loader.

```bash
# needs the Rialo toolchain (rialoman installs rialo, rialo-build and rialo-local-network)
rialo-build -p program -o program/artifacts
# -> program/artifacts/drawbook-raffle-riscv/drawbook_raffle.polkavm

# -a names the paying deployer key in the rialo CLI config; --keypair is the program's own key
rialo -u <rpc url> -a <deployer> client program deploy \
  program/artifacts/drawbook-raffle-riscv/drawbook_raffle.polkavm --keypair <program keypair>
```

- Pass the RPC URL with `-u https://testnet.rialo.io:4101`. The `-n testnet` preset points at a host
  that does not resolve.
- The program id is the program keypair's address, so the same keypair gives the same id on a local
  network and on testnet, and the browser hardcodes it once. Deploying again with the same
  `--keypair`, paid by the upgrade authority's key, upgrades the program in place; the deployer can
  still upgrade it during the testnet period.
- Keep the program keypair, and every other keypair, out of the repo. `program/.gitignore` ignores
  `*.keypair`, `target/` and `artifacts/` as a backstop, not as permission.

### A local network

`rialo-local-network start network` runs a validator, a full node and a faucet on this machine.
Give it `--enable-cors --cors-origins <your dev origin>` so the browser can reach the full node's
RPC on port 4101, deploy the program to it as above with `-u http://127.0.0.1:4101`, and start the
site against it:

```bash
NEXT_PUBLIC_RIALO_RPC=http://127.0.0.1:4101 PORT=<a port in the CORS list> pnpm dev
```

Funds come from the local faucet: `requestAirdrop` on the local RPC, or
`rialo -u http://127.0.0.1:4101 client airdrop --address <address> --amount <RLO>`.

## Layout

```
app/              landing, raffles board, live raffle (/r/[address]), sample raffle
                  (/raffle/[id]), deploy form, docs, how it works (/learn)
components/       Sweep / Cell primitives, board, wallet chip, live raffle views
lib/
  raffle.ts       the draw, pure; the executable spec the program reproduces
  chain/          the program as the browser sees it: layout, v2 hashes, instructions,
                  transactions, nonce storage, and the Subscriber schedule
  sha256.ts       synchronous SHA-256
  base58.ts       addresses
  rialo-rpc.ts    testnet client, param shapes established by probing the node
  wallet.ts       Ed25519 keypair via Web Crypto
  mock-raffles.ts the five sample raffles
program/          the Rust raffle program, SPEC.md, and its end-to-end test
scripts/          the verification suites above
```

## Notes on Rialo

Established by reading published crates and probing the node, not from documentation, which
disagrees with itself in places.

- The RPC surface is 39 methods. Parameters are a single-element array holding a struct:
  `getBalance{address}`, `requestAirdrop{pubkey, kelvins}`.
- The faucet caps a single grant at 1 RLO and rate limits per IP; asking for more is refused with
  code `-32004`.
- Application-level refusals arrive with a non-2xx status **and** a useful JSON-RPC body. Read the
  body before judging `response.ok`.
- Not Solana-RPC compatible. No `getLatestBlockhash`; replay protection is `configHashPrefix` plus
  `validFrom`. Read `configHashPrefix` from the raw response text, because `JSON.parse` rounds the
  u64. Balances are kelvin, and 1 RLO = 1e9 kelvin.
- The chain clock (`Clock::unix_timestamp`) is in milliseconds.
- The Wallet Standard namespace is `rialo:*`, so Solana wallets are not discovered.
- Predicates hold a topic, an optional event account and an optional timestamp range. No value
  comparison, and no interval or calendar scheduling.
- A clock subscription's timestamp range is in milliseconds, start inclusive, end exclusive. The
  Subscriber's `subscribe_to` helper quietly appends a `Destroy` to every OneShot, and
  `getSubscription` takes the nonce as a raw UTF-8 string, not hex.

## Still to do

- Settle the moment the last holder reveals without anyone pressing Draw. Rialo can match a clock or
  an event topic, and the program emits no event; emitting one would take an upgrade of the
  program.
