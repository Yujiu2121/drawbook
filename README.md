# Drawbook

On-chain raffles on Rialo testnet, settled by a commit-reveal draw. Nobody picks the winner: every
ticket buyer contributes a secret, the winner falls out of all of them together, and anyone can
recompute the result from public data.

Live at **https://rialo-five.vercel.app**

## Why commit-reveal rather than the chain's randomness

Rialo exposes native randomness through `rialo_s_random_seed::get_random_seed()`. It is real, it is
one line, and it is not sufficient for a raffle: it returns a bare `u64` with no proof or commitment
attached, and there is no VRF or beacon anywhere on the platform. If that seed derives from state a
block producer influences, a producer can grind the outcome.

So the entropy comes from the participants instead:

```
commitment = SHA256("rialo-raffle-v1|commit" ‖ raffleId ‖ ticketIndex ‖ holder ‖ nonce)
seed       = SHA256("rialo-raffle-v1|seed"   ‖ raffleId ‖ sort(revealed nonces) ‖ chainSeed)
```

Nonces are sorted before hashing so reveal order cannot influence the result. `chainSeed` is mixed
in on top, never relied on alone.

**What this does not promise.** Withholding a reveal changes the seed, which is the classic
last-revealer bias. Two things constrain it: a non-revealer forfeits their bond, and `chainSeed` is
unknown until the draw fires, so a griefer cannot tell whether aborting would help. Biasing the draw
requires a party who both controls block production and reveals last. Call the result verifiable.
Do not call a bare `get_random_seed()` draw provably fair.

## What is real and what is not

| | |
|---|---|
| Wallet, balance, faucet, chain figures | **live on Rialo testnet** |
| Commitments and the settled draw's audit | **real SHA-256, genuinely recomputable** |
| Raffle state (tickets, phases, winners) | sample data held in the browser |
| Buying and revealing on chain | **not wired yet**, no raffle program is deployed |

## Verification

```bash
pnpm verify                     # SHA-256 against FIPS 180-4 vectors, then ~57 raffle properties
node scripts/verify-wallet.ts   # base58, then a real testnet round trip incl. a faucet grant
```

`verify-raffle.ts` asserts determinism, distinct winners, independence from reveal order, payout
conservation, independent audit of a settled draw, and uniformity by chi-square (11.51 for one
winner of twenty over 60,000 seeds, against a 43.82 critical value). It also covers the edge case
reference implementations get wrong: a raffle configured for five winners that sold one ticket
produces one winner, not five.

`verify-wallet.ts` talks to the live network. It confirms the Subscriber program and Token-2022 are
deployed and executable, that the DKG committee answers, and that a freshly generated Ed25519
address really is credited by the faucet.

## Running it

```bash
pnpm install
pnpm dev        # http://localhost:3333
```

The port is 3333, not 3000, set in `package.json` as `${PORT:-3333}`.

## Layout

```
app/            landing (/), raffles board, raffle detail, deploy form, docs, learn
components/     panels, board, wallet bar, landing sections
lib/
  sha256.ts     synchronous SHA-256, so commitments verify in the browser
  raffle.ts     the state machine; the executable spec for the on-chain program
  base58.ts     addresses
  rialo-rpc.ts  testnet client, param shapes established by probing the node
  wallet.ts     Ed25519 keypair via Web Crypto
scripts/        the verification suites above
```

`lib/raffle.ts` is deliberately pure and React-free. Every function in it is a state transition the
Rialo program has to reproduce exactly, so swapping the mock for the chain is a change of call site,
not a rewrite.

## Notes on Rialo

Established by reading published crates and probing the node, not from documentation, which
disagrees with itself in places.

- The RPC surface is 38 methods. Parameters are a single-element array holding a struct:
  `getBalance{address}`, `requestAirdrop{pubkey, kelvins}`.
- The faucet caps a single grant at 1 RLO; asking for more is refused with code `-32004`.
- Application-level refusals arrive with a non-2xx status **and** a useful JSON-RPC body. Read the
  body before judging `response.ok`.
- Not Solana-RPC compatible. No `getLatestBlockhash`; replay protection is `configHashPrefix`.
  Balances are kelvin, and 1 RLO = 1e9 kelvin.
- The Wallet Standard namespace is `rialo:*`, so Solana wallets are not discovered.
- Predicates hold a topic, an optional event account and an optional timestamp range. No value
  comparison, and no interval or calendar scheduling.

## Still to do

Write and deploy the raffle program, then wire buying and revealing to it. It needs exactly two
predicates, and both are already live on testnet: an absolute timestamp for the sale deadline, and
an event topic for the last ticket selling.
