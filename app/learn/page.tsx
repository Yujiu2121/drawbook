import { Action, H2, LI, Note, P, PageHead, Reading, TextLink, UL } from "@/components/prose";

/** The section index in the margin. Kept beside the page so it cannot drift from the H2 ids. */
const CONTENTS: [string, string][] = [
  ["the-problem", "The problem with picking a winner"],
  ["the-idea", "The idea: everybody brings a piece"],
  ["commit", "Move one: lock it in without showing it"],
  ["reveal", "Move two: open the envelopes"],
  ["draw", "The draw"],
  ["honest", "What this does not promise"],
  ["samples", "Live raffles and samples"],
  ["start", "Getting started"],
];

export const metadata = {
  title: "How it works: the Drawbook draw",
  description:
    "The commit-reveal draw in plain language: how every ticket's secret goes into the result, what the reveal bond is for, how to check a draw yourself, and the limits that remain.",
};

/**
 * The explainer, written for someone who has never seen a commit-reveal scheme.
 *
 * No formulas here; those live in /docs. The job of this page is to make the mechanism feel
 * obvious, including the part where it is honest about what it does not guarantee.
 *
 * WHAT THE COPY MAY CLAIM, now that the program is real on testnet. Buying, revealing, drawing and
 * claiming are signed transactions from a burner wallet in this browser. The draw is "randomized
 * and checkable", never more: whoever produces the draw block may be able to grind the chain's
 * value alone, after every secret is public, and a holder can withhold a reveal at the cost of a
 * bond. Earlier copy said steering needed "control of everyone's piece", that biasing needed
 * someone who "both produces blocks and reveals last", and that the bond made going quiet "cost
 * more than it could ever gain". All three were wider than the truth: the bond is a small fixed
 * amount (under 1% of the pool in every sample), and a void raffle forfeits nothing at all.
 *
 * THE DRAW IS PRESSED, NOT AUTOMATIC. Anyone can send Draw once it is ready; the Subscriber trigger
 * that would send it by itself is designed and not wired, and this page must not describe it in the
 * present tense.
 *
 * Apostrophes are the character itself, not `&rsquo;`, for the reason given at the head of
 * app/docs/page.tsx: an entity in a text run right after an element's closing tag drops a space.
 *
 * ONE NAME FOR THIS ROUTE. The masthead calls it "How it works", so the eyebrow, the footer and
 * the title do too; it used to be "Learn" in three places and "How it works" in the fourth.
 *
 * THE BOUNDS AND THE TESTNET FACTS ARE program/SPEC.md's, in words: a sale of at most 31 days, a
 * reveal window of one minute to seven days, a Draw that runs alone and a block after the last
 * reveal, a program its deployer can still upgrade, and a rent reserve each raffle account keeps.
 *
 * QUIET BY DESIGN, like /docs. A reading room, lit flat: no ticket, no drum, no signal hue and no
 * motion. The single bright thing is the reversed-print control at the end, because in this room
 * the bright thing is the thing you take.
 */
export default function LearnPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-[1180px] px-5 pb-20">
        <PageHead
          eyebrow="How it works"
          title="How the draw works."
          lede="A raffle is only worth entering if its draw is hard to steer. Here is how this one is built, and where its limits are, without the cryptography."
        />

        <Reading contents={CONTENTS}>
          <H2 id="the-problem">The problem with picking a winner</H2>
          <P>
            Somebody has to produce a random number. If the person running the raffle produces it,
            they can pick their own ticket. If the software produces it, whoever runs the software
            can. Many on-chain raffles ask the blockchain for a random number and trust that it was
            not tampered with.
          </P>
          <P>
            That trust is doing a lot of work. On Rialo the chain will hand a program a random number
            quite happily, but it comes with no proof of where it came from. If whoever produces the
            block can influence that number, they can quietly try again until the outcome suits them.
          </P>

          <H2 id="the-idea">The idea: everybody brings a piece</H2>
          <P>
            Instead of asking one party for the randomness, the raffle collects a secret piece from
            every person who buys a ticket and combines them all at the end, together with a number
            from the chain. Each piece is chosen before anyone can see the others, so choosing your
            own piece cannot aim the result.
          </P>
          <P>
            The trick is that the pieces have to stay secret while the sale is open, or the last
            person to buy could choose theirs to win. So it happens in two moves.
          </P>

          <H2 id="commit">Move one: lock it in without showing it</H2>
          <P>
            When you buy a ticket, your browser makes up a secret number and sends only its
            fingerprint, in a transaction your wallet signs. A fingerprint cannot be run backwards, so
            your secret stays yours, but it also cannot be changed later without the mismatch being
            obvious.
          </P>
          <P>
            Think of it as sealing a guess in an envelope and handing the envelope over. Everyone can
            see you committed to something. Nobody can see what. Your browser keeps the secret in its
            own storage, so the reveal has to come from the same browser. Along with the ticket price
            you pay a small reveal bond, which comes back when you reveal.
          </P>

          <H2 id="reveal">Move two: open the envelopes</H2>
          <P>
            When the sale closes, at its deadline or the moment the last ticket sells, each holder
            publishes the secret they were holding. The program checks it against the fingerprint
            already recorded and rejects it if they do not match. Revealing pays your bond back on the
            spot.
          </P>
          <P>
            The clock is bounded at both ends. A sale can run for at most 31 days, and the reveal
            window after it lasts between one minute and seven days, fixed when the raffle is made.
            The ceiling means one silent ticket cannot hold everyone’s money for months; the floor
            means a creator cannot close reveals before anyone else has had a chance to reveal.
          </P>
          <Note>
            This is the one step that needs you. If you never reveal, your secret does not go into the
            draw and your bond stays behind and joins the prize pool. The bond is small, a fixed amount
            the raffle’s creator sets, so it discourages going quiet rather than ruling it out. If
            nobody reveals at all there is nothing to draw from: the raffle is void and everyone gets
            everything back, bonds included.
          </Note>

          <H2 id="draw">The draw</H2>
          <P>
            Once every sold ticket is revealed, or the reveal window has closed, the raffle is ready.
            Anyone can then press Draw: the person who made the raffle, a ticket holder or a passer-by.
            It does not happen by itself yet. The program combines every revealed secret with a number
            the chain gives it at that moment, and that decides the winning tickets.
          </P>
          <P>
            Draw has to travel alone, in a transaction with nothing else in it, and it is refused in
            the same block as the latest reveal; one block later it goes through. Both rules stop the
            person pressing it from seeing the result first and backing out until they like it.
          </P>
          <P>
            Winners collect with Claim, which can only pay the address on the winning ticket. Because
            every ingredient is public afterwards, you can redo the arithmetic yourself. On a live
            raffle the page does it in your browser from the chain’s own data and says whether
            the recorded winners match, a check that would fail if they did not.
          </P>

          <H2 id="honest">What this does not promise</H2>
          <P>
            The draw is randomized and checkable. It is not a guarantee that nobody influenced it, and
            there are two ways someone could.
          </P>
          <P>
            The first is whoever produces the block the draw lands in. The chain’s number is read
            after every secret is public, so if that party can influence the number, they can try
            values until one suits them. They need no ticket to do it. Rialo gives no proof of where
            the number comes from, so this limit is real and the program cannot remove it.
          </P>
          <P>
            The second is a holder who withholds. Someone who has seen the other secrets can decide not
            to reveal theirs, which changes the result. It costs them their bond, and they are
            guessing, because the chain’s number is not known until the draw.
          </P>
          <P>
            Checking a draw shows that the winners follow from the published secrets and the
            chain’s number. It cannot show that the chain’s number itself was fair. The
            details are in <TextLink href="/docs#limits">Docs</TextLink>.
          </P>
          <P>
            Two more things are true while this runs on testnet. The program can still be upgraded by
            the key that deployed it, so it is not fixed code yet. And each raffle account keeps its
            rent reserve after every claim is paid, about 0.0035 RLO for a raffle of 2 tickets and
            more for a bigger one; that reserve is not part of any prize or refund.
          </P>

          <H2 id="samples">Live raffles and samples</H2>
          <P>
            Live raffles are the ones the Raffles page reads from the chain; each opens at its own
            address. The five sample raffles, numbered 1 to 5, are fixed demonstration data and are not
            on chain. Their clock starts at 30 July 2026 and runs from there, and nothing pressed on
            them is signed or sent. On a sample, recomputing the draw re-runs the same code that made
            the record, so it shows the method and cannot fail.
          </P>

          <H2 id="start">Getting started</H2>
          {/*
            The caveat comes before the steps, not after them. Everything below is a real signed
            transaction, but on a testnet with no value that can be reset, from a key that lives only
            in this browser, and a reader who follows the steps is owed that sentence first.
          */}
          <P>
            Everything here runs on Rialo testnet. The coins have no value, the wallet is a burner key
            kept in this browser, and testnet can be reset, which would erase every raffle on it.
          </P>
          <UL>
            <LI>Connect a wallet from the header. It creates a testnet key in this browser.</LI>
            <LI>
              Take testnet RLO from the faucet. It gives at most 1 RLO at a time, and only so often
              from one network.
            </LI>
            <LI>
              Deploy a raffle, or buy a ticket on a live one. Your secret is saved in this browser
              before the purchase is sent.
            </LI>
            <LI>After the sale closes, reveal from the same browser. Your bond comes back at once.</LI>
            <LI>When the raffle is ready, anyone can press Draw. If you won, Claim pays you.</LI>
          </UL>

          {/*
            Reversed print for the primary control, a bounded control for the secondary, both from
            prose.tsx so every class compiles. The signal hue is not spent: it is ceremonial and means
            a winner, and a link to a list of raffles is not a ceremony.
          */}
          <div className="mt-12 flex flex-wrap items-center gap-3">
            <Action href="/raffles" primary>
              See the raffles
            </Action>
            <Action href="/docs">The formulas, in Docs</Action>
          </div>
        </Reading>
      </main>
    </>
  );
}
