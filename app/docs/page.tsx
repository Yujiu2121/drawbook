import Link from "next/link";

import { Masthead } from "@/components/masthead";
import { SiteFooter } from "@/components/site-footer";
import { Article, C, Code, Facts, H2, H3, LI, Note, P, PageHead, UL } from "@/components/prose";

export const metadata = {
  title: "Docs: the Drawbook draw scheme",
  description:
    "The commitment and seed formulas, the security properties and their limits, how to verify a settled draw, and the on-chain design on Rialo.",
};

/**
 * The technical reference.
 *
 * Every figure and claim on this page came out of the project's own verification scripts or a direct
 * probe of the Rialo node, not from documentation. Where something is unverified it says so, because
 * a reference that overstates is worse than one that is thin.
 */
export default function DocsPage() {
  return (
    <>
      <Masthead />
      <main className="mx-auto w-full max-w-[1180px] px-5 pb-20">
        <PageHead
          eyebrow="Docs"
          title="The scheme, in full."
          lede="Commitment and seed derivation, what the construction guarantees and what it does not, and how to recompute a settled draw yourself."
        />

        <Article className="mt-16">
          <H2 id="commitment">Commitment</H2>
          <P>
            Buying ticket <C>i</C> publishes a digest, never the nonce. The preimage binds the nonce
            to the holder, the raffle and the exact ticket, so a commitment cannot be lifted from one
            ticket and replayed on another.
          </P>
          <Code>{`commitment = SHA256(
  "rialo-raffle-v1|commit"
  ‖ raffleId  ‖ ticketIndex
  ‖ holder    ‖ nonce
)`}</Code>
          <P>
            The nonce is 16 bytes from the platform CSPRNG and never leaves the buyer&rsquo;s browser
            until reveal. A reveal is accepted only if it hashes to the commitment already recorded.
          </P>

          <H2 id="seed">Seed derivation</H2>
          <P>
            Revealed nonces are sorted before hashing, so the order in which people reveal cannot
            change the result. Without that, revealing last would be an advantage in itself.
          </P>
          <Code>{`seed = SHA256(
  "rialo-raffle-v1|seed"
  ‖ raffleId
  ‖ sort(revealed nonces)
  ‖ chainSeed
)`}</Code>
          <P>
            <C>chainSeed</C> is Rialo&rsquo;s native randomness, from{" "}
            <C>rialo_s_random_seed::get_random_seed()</C>. It is mixed in, never relied on alone. See{" "}
            <Link
              href="#limits"
              className="underline decoration-line-2 underline-offset-4 hover:text-text"
            >
              the limits
            </Link>{" "}
            for why.
          </P>

          <H3>Winner selection</H3>
          <P>
            Winners are drawn without replacement by a partial Fisher-Yates shuffle over the eligible
            tickets, keyed by a SHA-256 keystream over the seed. Each draw consumes 48 fresh bits and
            reduces modulo a shrinking range, so modulo bias is negligible at any realistic supply.
          </P>
          <Code>{`stream(n) = SHA256(seed ‖ "|draw|" ‖ n)
pick      = 48 bits from stream, mod pool size`}</Code>

          <H2 id="properties">What holds</H2>
          <P>
            These are asserted by <C>scripts/verify-raffle.ts</C>, which runs as part of{" "}
            <C>pnpm verify</C>. The distribution figures below are measured, not assumed.
          </P>
          <Facts
            rows={[
              ["Deterministic for a given seed", "yes"],
              ["Winners distinct, drawn without replacement", "yes"],
              ["Independent of reveal order", "yes"],
              ["Uniformity, 1 winner of 20, 60,000 seeds", "chi-square 11.51 (crit. 43.82)"],
              ["Uniformity, 5 winners of 20, 20,000 seeds", "chi-square 16.64 (crit. 43.82)"],
              ["Payouts sum exactly to the pool", "yes, all winner counts"],
              ["Winners capped at the revealed count", "yes"],
              ["SHA-256 against FIPS 180-4 vectors", "all pass, plus 400 random cross-checks"],
            ]}
          />
          <P>
            That last cap matters more than it looks. A raffle configured for five winners which sold
            one ticket produces one winner, not five. Reference implementations get this wrong.
          </P>

          <H2 id="limits">What does not hold</H2>
          <Note>
            Withholding a reveal changes the seed. This is the classic last-revealer bias and the
            construction does not eliminate it.
          </Note>
          <P>Two things constrain it rather than remove it:</P>
          <UL>
            <LI>
              A non-revealer forfeits their reveal bond to the pool, so going quiet has a fixed cost.
            </LI>
            <LI>
              <C>chainSeed</C> is unknown until the draw fires, so a griefer cannot work out whether
              aborting would help them.
            </LI>
          </UL>
          <P>
            Biasing the draw therefore requires a party who both controls block production and
            reveals last. Call the result verifiable, because anyone can recompute it. Do not call a
            bare <C>get_random_seed()</C> draw provably fair, because it is not.
          </P>

          <H2 id="verify">Verifying a settled draw</H2>
          <P>
            Everything needed is public once a raffle settles: the revealed nonces, the chain seed and
            the recorded winners. The raffle page recomputes the seed in your browser and compares,
            reporting <C>verified</C> or <C>mismatch</C>. To do it yourself, rebuild the seed from the
            sorted nonces, re-run the selection, and compare the ticket indices.
          </P>

          <H2 id="onchain">On-chain design</H2>
          <P>
            A raffle needs exactly two conditions, and Rialo has both natively, so no keeper process
            exists anywhere in the design.
          </P>
          <UL>
            <LI>
              <strong className="text-text">Sale closes.</strong> An absolute timestamp predicate on
              the Subscriber program. This is the only time primitive Rialo offers, and it is the one
              a raffle needs.
            </LI>
            <LI>
              <strong className="text-text">Last ticket sells.</strong> An event topic emitted by the
              purchase itself, closing the sale early without anything polling for it.
            </LI>
          </UL>
          <P>
            Predicates carry no value comparison. They hold a topic, an optional event account and an
            optional timestamp range, and nothing else. There is also no interval or calendar
            scheduling, so a recurring schedule has to re-arm itself with a fresh nonce each time.
          </P>

          <H2 id="network">Network reference</H2>
          <P>
            Established by probing the node directly. The published documentation lists three
            different devnet endpoints and one of them does not resolve, so treat these as the
            observed values rather than the documented ones.
          </P>
          <Facts
            rows={[
              ["Testnet RPC", "https://testnet.rialo.io:4101"],
              ["Subscriber program", "Subscriber1111…  deployed, executable"],
              ["Token-2022", "TokenzQdBNbLqP5…  deployed, RiscVLoader"],
              ["Faucet", "requestAirdrop{pubkey, kelvins}, max 1 RLO per call"],
              ["Balance", "getBalance{address}, in kelvin"],
              ["Base unit", "1 RLO = 1,000,000,000 kelvin"],
              ["Replay protection", "configHashPrefix, not a blockhash"],
              ["Pubsub", "none in the 38-method surface, so state is polled"],
              ["CORS", "access-control-allow-origin: *"],
            ]}
          />
          <P>
            Rialo is not Solana-RPC compatible. Parameters are a single-element array holding a
            struct, there is no <C>getLatestBlockhash</C>, and the Wallet Standard namespace is{" "}
            <C>rialo:*</C>, so Solana wallets are not discovered.
          </P>

          <H2 id="status">Status</H2>
          <P>
            The wallet, balance and chain figures are live. The raffles themselves are sample data
            held in your browser, with genuine SHA-256 commitments and a settled draw that really
            does audit. Buying and revealing are not yet wired to the chain, because the raffle
            program is not deployed.
          </P>
          <div className="mt-10">
            <Link
              href="/learn"
              className="text-sm text-text-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-text"
            >
              The same thing without the formulas, in Learn
            </Link>
          </div>
        </Article>
      </main>
      <SiteFooter />
    </>
  );
}
