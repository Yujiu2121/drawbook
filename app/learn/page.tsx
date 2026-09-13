import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { H2, LI, Note, P, PageHead, Reading, UL } from "@/components/prose";

/** The section index in the margin. Kept beside the page so it cannot drift from the H2 ids. */
const CONTENTS: [string, string][] = [
  ["the-problem", "The problem with picking a winner"],
  ["the-idea", "The idea: everybody brings a piece"],
  ["commit", "Move one: lock it in without showing it"],
  ["reveal", "Move two: open the envelopes"],
  ["draw", "The draw"],
  ["honest", "What this does not promise"],
  ["start", "Getting started"],
];

export const metadata = {
  title: "Learn: how a Drawbook raffle works",
  description:
    "Plain-language explanation of the commit-reveal draw: why nobody can pick the winner, what the reveal bond is for, and how to check a result yourself.",
};

/**
 * The explainer, written for someone who has never seen a commit-reveal scheme.
 *
 * No formulas here; those live in /docs. The job of this page is to make the mechanism feel obvious,
 * including the part where it is honest about what it does not guarantee.
 *
 * QUIET BY DESIGN, like /docs. This is a reading room, lit flat: no ticket, no drum, no signal hue
 * and no motion. Everything the page needs it gets from the prose components, and the single bright
 * thing on it is the button at the end, because in this room the bright thing is the thing you take.
 *
 * There is no card stock anywhere in the body, and that is the difference from /docs rather than an
 * oversight: this page quotes nothing from the machine, so there is nothing on it to print.
 */
export default function LearnPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-[1180px] px-5 pb-20">
        <PageHead
          eyebrow="Learn"
          title="How a draw stays honest."
          lede="A raffle only works if nobody can choose who wins. Here is the whole idea, without the cryptography."
        />

        <Reading contents={CONTENTS}>
          <H2 id="the-problem">The problem with picking a winner</H2>
          <P>
            Somebody has to produce a random number. If the person running the raffle produces it,
            they can pick their own ticket. If the software produces it, whoever wrote the software
            can. Most on-chain raffles solve this by asking the blockchain for a random number and
            trusting that it was not tampered with.
          </P>
          <P>
            That trust is doing a lot of work. On Rialo the chain will hand you a random number
            quite happily, but it comes with no proof of where it came from. If it is derived from
            something a block producer influences, a block producer can quietly try again until the
            outcome suits them.
          </P>

          <H2 id="the-idea">The idea: everybody brings a piece</H2>
          <P>
            Instead of asking one party for the randomness, the raffle collects a piece from every
            person who buys a ticket, and combines them all at the end. To steer the result you
            would have to control everyone&rsquo;s piece, not just your own.
          </P>
          <P>
            The trick is that the pieces have to be secret while the sale is open, or the last
            person to buy could choose theirs to win. So it happens in two moves.
          </P>

          <H2 id="commit">Move one: lock it in without showing it</H2>
          <P>
            When you buy a ticket, your browser makes up a secret number and sends its fingerprint,
            not the number itself. A fingerprint cannot be run backwards, so nobody learns your
            secret, but it also cannot be changed later without the mismatch being obvious.
          </P>
          <P>
            Think of it as sealing a guess in an envelope and handing the envelope over. Everyone can
            see you committed to something. Nobody can see what.
          </P>

          <H2 id="reveal">Move two: open the envelopes</H2>
          <P>
            When the sale closes, everyone publishes the secret they were holding. Each one is
            checked against the fingerprint already recorded. If they do not match, it is rejected.
          </P>
          <Note>
            This is the one step that needs you. If you never reveal, your secret cannot go into the
            draw and your reveal bond is forfeited to the prize pool. That bond exists for exactly
            one reason: to make going quiet cost more than it could ever gain.
          </Note>

          <H2 id="draw">The draw</H2>
          <P>
            All the revealed secrets are combined into one number, along with a seed from the chain
            itself, and that decides the winning ticket. Nobody supplied the answer. It fell out of
            everyone&rsquo;s contributions together.
          </P>
          <P>
            Because every ingredient is public afterwards, you can redo the arithmetic yourself. The
            raffle page does it for you in your own browser and shows whether the recorded winner
            matches what it recomputes.
          </P>

          <H2 id="honest">What this does not promise</H2>
          <P>
            Someone who reveals last can see everyone else&rsquo;s secrets before deciding whether to
            publish their own, and withholding it changes the outcome. Two things blunt that. They
            lose their bond, and they still cannot predict the result, because the chain&rsquo;s own
            seed is not known until the draw fires.
          </P>
          <P>
            So the honest statement is this: the draw cannot be steered by an ordinary participant,
            and biasing it would require someone who both controls block production and reveals last.
            That is a real limit, and it is a great deal better than trusting a single number with no
            proof behind it.
          </P>

          <H2 id="start">Getting started</H2>
          {/*
            The caveat comes before the steps, not after them. Steps three and four describe actions
            that do not reach the chain today, and a reader who follows them and then finds out is
            owed the sentence first. /create prints the same statement at the head of its own
            terminal state for the same reason.
          */}
          <P>
            Buying and revealing are not wired to the chain yet, because no raffle program is
            deployed on Rialo testnet. Both stop at the exact payload that would be posted, so you
            can read what your ticket would commit to before anything is signed. The wallet, the
            balance and the chain figures are real.
          </P>
          <UL>
            <LI>Connect a wallet from the header. It creates a testnet key in this browser.</LI>
            <LI>Take testnet RLO from the faucet. It is free and it is not real money.</LI>
            <LI>Buy a ticket on any open raffle. Your secret is generated and kept locally.</LI>
            <LI>Come back after the sale closes and reveal, or lose the bond.</LI>
          </UL>

          {/*
            The primary action is card stock, not the signal hue. The signal is ceremonial and means
            a winner; a link to a list of raffles is not a ceremony. Ivory is the correct answer
            anyway, because it is the only bright material in the room, so the eye lands on it
            without any colour being spent. Plain `bg-stock` rather than the `.stock` class: a
            control is a control, and the card object's shadow pair would float it off the page.
          */}
          <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href="/raffles"
              className="group inline-flex items-center gap-2 rounded-control bg-stock px-5 py-3 text-sm font-medium text-ink transition hover:bg-stock-2 active:translate-y-px"
            >
              See the open raffles
              <ArrowRight
                size={14}
                weight="bold"
                aria-hidden="true"
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
            <Link
              href="/docs"
              className="text-sm text-text-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-text"
            >
              The formulas, in Docs
            </Link>
          </div>
        </Reading>
      </main>
    </>
  );
}
