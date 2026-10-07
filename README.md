# Drawbook

A commit-reveal raffle on Rialo testnet. Every ticket buyer commits to a secret, reveals it after
the sale closes, and the winners come out of all the revealed secrets together with a value the
chain supplies at the draw. The draw is randomized and checkable: anyone can recompute it from
the raffle account's public data.

Live at **https://drawbook-rialo.vercel.app**

## What is real

| | |
|---|---|
| The raffle program | **deployed on Rialo testnet**, program id `74LNM1Hn6BCQpHyzHYkqrQP4H6N1At3CsiZ6CH4UsMG6` |
| Deploy, buy, reveal, draw, claim | **real signed transactions** from a burner wallet held in the browser |
| The draw check on a live raffle | **recomputed from chain data**; it can fail |
| The draw trigger | **pressed, not automatic**: anyone can send Draw once it is ready; a Subscriber trigger is designed, not wired |
| Raffles 1 to 5 (`/raffle/1`..`/raffle/5`) | fixed sample data, not on chain, clock starting 30 Jul 2026 |
| Upgrades | the program is **upgradeable by its deployer** (`GGZaSfv9RY7uNLVTdMhdb1yJgoAsARaBsmpRp1T7Sjor`) during the testnet period |
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
pnpm verify    # offline: three suites, 200 checks
```

| Suite | Checks | What it asserts |
|---|---:|---|
| `scripts/verify-sha256.ts` | 20 | SHA-256 against FIPS 180-4 vectors, plus 400 random cross-checks against `node:crypto` |
| `scripts/verify-raffle.ts` | 75 | the draw in `lib/raffle.ts`: determinism, distinct winners, independence from reveal order, the winner cap, payout conservation, a tamper-rejecting audit, chi-square uniformity, the sample data |
| `scripts/verify-chain.ts` | 105 | the browser library in `lib/chain/`: transactions against `@rialo/ts-cdk` fixtures, the v2 hashes against `node:crypto`, account decoding, the draw check, payouts and refusals |

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
  network and on testnet, and the browser hardcodes it once. Redeploying with it upgrades in place.
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
                  transactions, nonce storage
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

## Still to do

- Send Draw automatically: one Subscriber one-shot subscription at the reveal deadline whose action
  is Draw. Settling early when the last holder reveals would also need the program to emit an event
  topic, which it does not today.
