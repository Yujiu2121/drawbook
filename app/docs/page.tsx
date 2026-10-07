import {
  C,
  Code,
  Facts,
  H2,
  H3,
  LI,
  Note,
  P,
  PageHead,
  Reading,
  Table,
  TextLink,
  UL,
} from "@/components/prose";

/** The section index in the margin. Kept beside the page so it cannot drift from the H2 ids. */
const CONTENTS: [string, string][] = [
  ["live", "What runs on chain"],
  ["account", "The raffle account"],
  ["instructions", "Instructions"],
  ["commitment", "Commitment"],
  ["seed", "Seed and winners"],
  ["payouts", "Payouts and refunds"],
  ["errors", "Error codes"],
  ["verify", "Checking a draw"],
  ["limits", "What does not hold"],
  ["trigger", "The draw trigger"],
  ["samples", "The sample raffles"],
  ["tests", "What is tested"],
  ["network", "Network reference"],
];

export const metadata = {
  title: "Docs: the Drawbook raffle program",
  description:
    "The Drawbook raffle program on Rialo testnet: the account layout, the five instructions, the commitment and seed preimages as bytes, winner selection, payouts, error codes and the limits of the draw.",
};

/**
 * The technical reference.
 *
 * THIS PAGE RESTATES program/SPEC.md AND MUST AGREE WITH IT BYTE FOR BYTE. The spec is the contract
 * between the Rust program, lib/chain/ and the pages; a reader who rebuilds a commitment or a seed
 * from this page and gets a different digest has been lied to, however good the prose is. So every
 * preimage below names each part's width and encoding, and nothing is written with a bare "‖"
 * between things whose encoding the reader would have to guess, which is the defect the v1 formulas
 * on this page used to have (text in one hash, raw bytes in the other, under the same symbol).
 *
 * THE LIMITS ARE STATED AS WIDE AS THEY ARE. The chain value is read after every nonce is public,
 * so whoever produces the draw block may be able to grind it alone, without a ticket and without
 * revealing last. Earlier copy said biasing needed a party who "both produces blocks and reveals
 * last", which is narrower than the truth, and called the result "verifiable". The words this page
 * may use are "randomized and checkable".
 *
 * WIRED VERSUS DESIGNED IS KEPT APART. The program, the account and the five instructions are real
 * on testnet. The Subscriber trigger that would send Draw by itself is the design, not wired, and
 * the page says which is which rather than describing the design in the present tense.
 *
 * THE SAMPLES KEEP THEIR OWN SECTION. The five fixed raffles under /raffle/1..5 were made with the
 * v1 text formulas and are not on chain. Their exact encoding is given there and only there, so the
 * v2 bytes above are not muddied by a second scheme, and so the reader is told that recomputing a
 * sample re-runs the code that made it and cannot fail, while recomputing a live raffle can.
 *
 * APOSTROPHES ARE THE CHARACTER ITSELF, NEVER `&rsquo;`. Measured on this Next 16.2.12 build with
 * Turbopack: a JSX text run that directly follows an element's closing tag and contains an HTML
 * entity loses its leading space in the rendered HTML, so "<strong>Wired today:</strong> nothing"
 * rendered as "Wired today:nothing" and "<C>CreateAccount</C> in" as "CreateAccountin". The same
 * text with a literal U+2019 keeps its space, and text after a {expression} is not affected.
 *
 * TESTNET FACTS, PER THE CLAIMS SHEET. The program is upgradeable by its deployer during the
 * testnet period, and every raffle account keeps its rent reserve after the last claim (0.00350784
 * RLO for 2 tickets, the rent-exempt minimum the node quotes for 376 bytes). Both are stated in
 * "What runs on chain", the second again under payouts, rather than left for a reader to discover.
 *
 * Layout: quiet by design, like /learn. A reading room, lit flat. The only recess on the page is
 * where it quotes the machine (layouts, preimages, the keystream, inline identifiers); every
 * formula block scrolls inside its own well on a phone rather than widening the page.
 */
export default function DocsPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-[1180px] px-5 pb-20">
        <PageHead
          eyebrow="Docs"
          title="The program, in full."
          lede="The raffle program on Rialo testnet as bytes: the account, the five instructions, the hashes, the payouts and the refusals, and what the design does not guarantee."
        />

        <Reading contents={CONTENTS}>
          {/* ------------------------------------------------------------ live */}
          <H2 id="live">What runs on chain</H2>
          <P>
            Drawbook’s raffle program runs on Rialo testnet at{" "}
            <C>74LNM1Hn6BCQpHyzHYkqrQP4H6N1At3CsiZ6CH4UsMG6</C>.{" "}
            <TextLink href="/create">Deploying a raffle</TextLink> creates a real raffle account.
            Buying, revealing, drawing and claiming are real transactions, signed by a burner wallet
            that this browser generates and keeps.
          </P>
          <P>
            It is testnet only. The coins are testnet RLO with no value, and Rialo can reset testnet,
            which would erase every raffle on it. The burner key and the secrets behind your tickets
            live in this browser’s storage, so clearing it loses both.
          </P>
          <P>
            During the testnet period the program is upgradeable by the key that deployed it,{" "}
            <C>GGZaSfv9RY7uNLVTdMhdb1yJgoAsARaBsmpRp1T7Sjor</C>. Redeploying under the same program
            id replaces the code in place, so what this page describes is the code as deployed today,
            not code that can never change. Each raffle account also keeps its rent reserve after
            every claim is paid: about 0.0035 RLO for a raffle of 2 tickets, more for a longer
            account.
          </P>
          <P>
            The five raffles numbered 1 to 5 are something else: fixed sample data, not on chain, kept
            to show the method. They are described at the end, under{" "}
            <TextLink href="#samples">the sample raffles</TextLink>.
          </P>
          <Facts
            rows={[
              ["Program id", "74LNM1Hn6BCQpHyzHYkqrQP4H6N1At3CsiZ6CH4UsMG6"],
              ["Network", "Rialo testnet"],
              ["Units", "u64 kelvin, 1 RLO = 1,000,000,000 kelvin"],
              ["Times", "u64 milliseconds, from the chain clock"],
              ["Tickets per raffle", "2 to 200"],
              ["Sale length", "at most 31 days from Create"],
              ["Reveal window", "1 minute to 7 days after the sale deadline"],
              ["Upgradeable", "yes, by its deployer, during the testnet period"],
              ["Integers in the account", "little-endian unless marked"],
            ]}
          />

          {/* --------------------------------------------------------- account */}
          <H2 id="account">The raffle account</H2>
          <P>
            One account per raffle. The browser makes a fresh keypair for it, and in one transaction
            the System program creates the account, owned by the raffle program, and Create fills it
            in. The raffle key is thrown away afterwards: only the program can change the account or
            pay out of it. It holds the prize, the ticket money and the bonds, on top of its rent
            reserve.
          </P>
          <P>
            Its length is <C>208 + 84 × supply</C> bytes: a 208-byte header, then one 84-byte record
            per ticket.
          </P>
          <Code>{`  at  size  field              notes
   0     8  magic              "DRWBOOK1"; 0 = unset
   8     1  version            1
   9     1  status             0 open, 1 drawn, 2 void
  10     2  supply             u16
  12     2  winners            u16, as configured
  14     2  sold               u16
  16     2  revealed           u16
  18     2  effective_winners  u16, set at the draw
  20     4  last_reveal_slot   u32, slot of last Reveal
  24    32  creator            address
  56     8  prize              u64 kelvin, at Create
  64     8  ticket_price       u64 kelvin
  72     8  reveal_bond        u64 kelvin
  80     8  commit_deadline    u64 ms, sale closes
  88     8  reveal_deadline    u64 ms, reveals close
  96     8  created_at         u64 ms, chain clock
 104     8  drawn_at           u64 ms, 0 until draw
 112     8  chain_seed         u64, get_random_seed()
 120    32  seed               0 until the draw
 152     8  pool               u64 kelvin, at draw
 160     8  per_winner         u64 kelvin, at draw
 168     1  creator_refunded   u8, void raffles only
 169     7  reserved           zero
 176    32  title              UTF-8, zero padded
 208   84n  tickets            84 bytes per ticket`}</Code>
          <P>
            Ticket <C>i</C> starts at byte <C>208 + 84 × (i - 1)</C>. The sale closes at{" "}
            <C>commit_deadline</C> or when the last ticket sells, whichever comes first, and{" "}
            <C>effective_winners</C> is <C>min(winners, revealed)</C>. <C>last_reveal_slot</C> is the
            low 32 bits of the slot the most recent Reveal landed in; Draw uses it to wait a block,
            as described there. Each ticket record:
          </P>
          <Code>{`  at  size  field       notes
   0    32  holder      zero while unsold
  32    32  commitment  see Commitment
  64    16  nonce       zero until revealed
  80     1  flags       1 revealed, 2 won, 4 paid
  81     1  reserved    zero
  82     2  win_rank    u16, 1-based; 0 if not won`}</Code>
          <P>
            Tickets are sold in order: the next ticket is always <C>sold + 1</C>.
          </P>

          {/* ---------------------------------------------------- instructions */}
          <H2 id="instructions">Instructions</H2>
          <P>
            Instruction data starts with a one-byte tag. Every refusal is a custom program error whose
            code is in <TextLink href="#errors">the table below</TextLink>, and the program logs the
            error’s name, so the page can say in words why the chain said no.
          </P>
          <Table
            head={["Tag", "Instruction", "Who signs"]}
            widths={["3.5rem", "34%", "auto"]}
            rows={[
              ["0", "Create", "the creator, and the new raffle key"],
              ["1", "Buy", "the buyer"],
              ["2", "Reveal", "the ticket's holder"],
              ["3", "Draw", "anyone"],
              ["4", "Claim", "nobody needs to: it pays only the recorded owner"],
            ]}
          />

          <H3>0 Create</H3>
          <Code>{`data      tag 0
          ‖ prize u64 ‖ ticket_price u64
          ‖ reveal_bond u64 ‖ supply u16
          ‖ winners u16 ‖ commit_deadline u64
          ‖ reveal_deadline u64 ‖ title [32]
          = 77 bytes
accounts  0 creator         signer, writable
          1 raffle          writable
          2 system program`}</Code>
          <P>
            The system program is <C>11111111111111111111111111111111</C>. Create is sent after a
            System <C>CreateAccount</C> in the same transaction (new account = the raffle
            key, rent-exempt kelvin for the length, owner = the program), signed by the creator and by
            the raffle key. Refused unless the account is the program’s, exactly the right length
            and unused; supply is 2 to 200; winners is 1 to supply; the ticket price is at least 1
            kelvin; a full sale could not overflow a u64; and the deadlines sit inside these bounds:
          </P>
          <Code>{`now < commit_deadline
    <= now + 31 days
commit_deadline + 1 minute
    <= reveal_deadline
    <= commit_deadline + 7 days`}</Code>
          <P>
            The ceilings stop one unrevealed ticket from locking every kelvin in the account for
            years. The one-minute floor stops a creator who holds a ticket from closing reveals before
            anyone else can reveal and then collecting their bonds. Anything outside is refused with{" "}
            <C>BadConfig</C>. The prize then moves from the creator into the raffle account.
          </P>

          <H3>1 Buy</H3>
          <Code>{`data      tag 1 ‖ ticket_index u16
          ‖ commitment [32]
          = 35 bytes
accounts  0 buyer           signer, writable
          1 raffle          writable
          2 system program`}</Code>
          <P>
            Refused unless the raffle is open, the commit deadline has not passed and a ticket is left.{" "}
            <C>ticket_index</C> must be exactly <C>sold + 1</C>, because the index is inside the
            commitment: a commitment made for the wrong ticket could never be revealed, so it is refused
            rather than left to strand a bond. The buyer pays <C>ticket_price + reveal_bond</C> into the
            raffle account, the holder and commitment are written, and <C>sold</C> goes up by one.
          </P>

          <H3>2 Reveal</H3>
          <Code>{`data      tag 2 ‖ ticket_index u16
          ‖ nonce [16]
          = 19 bytes
accounts  0 holder          signer, writable
          1 raffle          writable`}</Code>
          <P>
            Accepted only after the sale has closed (the commit deadline passed, or every ticket sold)
            and before the reveal deadline, from the ticket’s holder, once per ticket, and only if
            the nonce hashes to the stored commitment. The nonce is stored, the revealed flag set,{" "}
            <C>last_reveal_slot</C> updated, and the bond goes straight back to the holder from the
            raffle account.
          </P>

          <H3>3 Draw</H3>
          <Code>{`data      tag 3
          = 1 byte
accounts  0 caller          signer
          1 raffle          writable
          2 instructions    the instructions sysvar`}</Code>
          <P>
            Anyone may send it. It is ready when the reveal deadline has passed, or when the sale has
            closed and every sold ticket is revealed; a raffle that sold nothing is ready as soon as its
            sale closes. With nothing revealed, the raffle becomes void and no money moves. Otherwise
            the program reads <C>chain_seed</C> from <C>get_random_seed()</C> at that moment, derives
            the seed and the winners as below, and writes the won flags, <C>win_rank</C>,{" "}
            <C>chain_seed</C>, <C>seed</C>, <C>effective_winners</C>, <C>pool</C>, <C>per_winner</C>{" "}
            and <C>drawn_at</C>. No kelvin moves at the draw; winners collect with Claim.
          </P>
          <P>
            Two more rules stop a caller from shopping for a result. Draw must be sent directly by
            the transaction, not through another program, and must be the only instruction in it,
            or it is refused with <C>DrawMustRunAlone</C>; the third account is the instructions
            sysvar, <C>Sysvar1nstructions1111111111111111111111111</C>, which is how the program
            counts the instructions. Otherwise something in the same transaction could read the
            winners and make the whole transaction fail, and the caller could retry block after block
            until the draw suited them. And Draw is refused with <C>TooSoon</C> in the same block as
            the latest Reveal: every transaction in a block reads the same chain value, so a reveal
            sent alongside the draw could be decided after working out the result. One block later
            it cannot.
          </P>

          <H3>4 Claim</H3>
          <Code>{`data      tag 4 ‖ ticket_index u16
          = 3 bytes
accounts  0 raffle          writable
          1 recipient       writable`}</Code>
          <P>
            No signature is required. The money can only go to the address recorded on the ticket, or
            to the creator, so anyone may push a payout. Several Claims can share one transaction,
            which is how the page collects everything a wallet is owed with one signature. What each
            case pays is under <TextLink href="#payouts">payouts and refunds</TextLink>.
          </P>

          {/* ------------------------------------------------------ commitment */}
          <H2 id="commitment">Commitment</H2>
          <P>
            Buying ticket <C>i</C> publishes a digest, never the nonce. The preimage binds the nonce to
            this raffle account, this ticket and this holder, so a commitment cannot be lifted from one
            ticket and replayed on another. Every part is fixed-width bytes, joined with nothing between
            them:
          </P>
          <Code>{`commitment = sha256(
    "drawbook-v2|commit|"   19 bytes, ASCII
  ‖ raffle address          32 bytes
  ‖ ticket_index            u16 little-endian
  ‖ holder address          32 bytes
  ‖ nonce                   16 bytes
)`}</Code>
          <P>
            The nonce is 16 bytes from the browser’s CSPRNG. It is saved in this browser’s
            storage before Buy is sent, so a reload cannot lose it, and it leaves the browser only in
            Reveal. A ticket can therefore be revealed only from the browser that bought it. If another
            buyer takes the same ticket first, the program refuses with <C>WrongTicket</C> and the
            browser tries once more for the next one, with a fresh nonce.
          </P>

          {/* ------------------------------------------------------------ seed */}
          <H2 id="seed">Seed and winners</H2>
          <P>
            At the draw the revealed nonces are sorted and hashed together with the chain’s value.
            Sorting is what stops the order in which people revealed from changing the result.
          </P>
          <Code>{`seed = sha256(
    "drawbook-v2|seed|"     17 bytes, ASCII
  ‖ raffle address          32 bytes
  ‖ revealed nonces         16 bytes each, sorted
                            ascending bytewise
  ‖ chain_seed              u64 BIG-endian
)`}</Code>
          <P>
            <C>chain_seed</C> is the u64 that <C>rialo_s_random_seed::get_random_seed()</C> returns
            when Draw executes. The account stores it at offset 112 little-endian, like every other
            integer there; only inside this hash is it big-endian. It is mixed in, never relied on
            alone, and its limit is under <TextLink href="#limits">what does not hold</TextLink>.
          </P>

          <H3>Winner selection</H3>
          <P>
            The eligible tickets are the revealed ticket indices in ascending order. Winners are drawn
            from them without replacement, by a keystream over the seed’s 32 raw bytes:
          </P>
          <Code>{`block(k) = sha256(seed ‖ "|draw|" ‖ k)
           k = 0, 1, 2, ... as ASCII decimal
sample   = next 6 bytes of the block, big-endian
           (5 per block; with fewer than 6 left,
            the next block is made)
pick     = sample mod (tickets left in the pool)
winner   = the ticket at position pick, counting
           from 0; it is removed and the rest keep
           their order
win_rank = 1, 2, 3, ... in the order drawn`}</Code>
          <P>
            The number drawn is <C>effective_winners = min(winners, revealed)</C>, so a raffle set for
            five winners in which one ticket was revealed has one winner, not five. Removing the pick
            and keeping the rest in order is Fisher and Yates’ original strike-out method. The
            later swap-based variant gives different winners from the same seed, so a recomputation has
            to remove, not swap. The program does exactly what <C>deriveWinnerTrace</C> in{" "}
            <C>lib/raffle.ts</C> does, which is how the page can check an on-chain draw with the same
            code.
          </P>

          {/* --------------------------------------------------------- payouts */}
          <H2 id="payouts">Payouts and refunds</H2>
          <Code>{`pool       = prize
           + sold × ticket_price
           + (sold - revealed) × reveal_bond
per_winner = pool / effective_winners   (floor)
remainder  = pool - per_winner × effective_winners`}</Code>
          <P>
            A revealed ticket’s bond came back at Reveal. An unrevealed ticket’s bond stays
            in the account and joins the pool. Once drawn, the account holds its rent reserve plus
            exactly the pool, and once every winner has claimed it is back to its rent reserve.
          </P>
          <P>
            That reserve stays behind. The program has no instruction that closes a raffle account,
            so the rent-exempt minimum the creator paid at Create, about 0.0035 RLO for 2 tickets, is
            still in the account after every claim, drawn or void. It is not part of any prize or
            refund.
          </P>
          <UL>
            <LI>
              <strong>Drawn.</strong> A winning ticket not yet paid pays <C>per_winner</C> to its holder,
              and the ticket with <C>win_rank</C> 1 also gets the remainder. The ticket is then marked
              paid.
            </LI>
            <LI>
              <strong>Void, ticket 0.</strong> The prize goes back to the creator, once.
            </LI>
            <LI>
              <strong>Void, ticket 1 or more.</strong> <C>ticket_price + reveal_bond</C> goes back to
              that ticket’s holder, once.
            </LI>
          </UL>
          <P>
            A raffle is void only when nobody revealed, so on a void raffle nobody forfeits anything:
            every bond comes back along with the ticket money.
          </P>

          {/* ---------------------------------------------------------- errors */}
          <H2 id="errors">Error codes</H2>
          <P>
            Each refusal is <C>ProgramError::Custom(code)</C>, and the transaction log carries the line{" "}
            <C>Drawbook refused: Name</C>.
          </P>
          <Table
            head={["Code", "Refusal"]}
            widths={["4rem", "auto"]}
            rows={ERRORS.map(([code, name, meaning]) => [
              code,
              <>
                <span className="figure block">{name}</span>
                <span className="text-fg-2">{meaning}</span>
              </>,
            ])}
          />

          {/* ---------------------------------------------------------- verify */}
          <H2 id="verify">Checking a draw</H2>
          <P>
            On a live raffle, everything needed is in the account once it is drawn: every revealed
            nonce, <C>chain_seed</C>, the stored seed and each winner’s <C>win_rank</C>. The
            raffle page’s recompute button rebuilds the seed from those bytes, re-runs the
            selection, and compares both with what the program wrote. That is a real check that can
            fail: if the account disagreed with its own public data, the page would say so.
          </P>
          <P>
            To do it yourself, read the account with <C>getAccountInfo</C>, take the nonces of the
            tickets whose revealed flag is set, hash them as in{" "}
            <TextLink href="#seed">seed and winners</TextLink>, run the keystream, and compare the
            result with the tickets whose won flag is set, in <C>win_rank</C> order.
          </P>
          <P>
            What a recomputation proves is the arithmetic: that the winners follow from the published
            nonces and <C>chain_seed</C>. It cannot show that <C>chain_seed</C> itself was not chosen.
            On the sample raffles, recomputing re-runs the same code that made the record, so there it
            shows the method and cannot fail.
          </P>

          {/* ---------------------------------------------------------- limits */}
          <H2 id="limits">What does not hold</H2>
          <Note>
            The draw is randomized and checkable. It is not a proof that nobody influenced it, and the
            two ways to influence it are stated here rather than left out.
          </Note>
          <UL>
            <LI>
              <strong>The draw block.</strong> <C>chain_seed</C> is read when Draw executes, after every
              nonce is public. Whoever produces that block may be able to influence what{" "}
              <C>get_random_seed()</C> returns, and if they can, they can try candidate values and keep
              one that suits them, with no ticket and without revealing last. Rialo publishes no proof
              of where the value comes from, so the program cannot close this. An ordinary caller has
              no such lever: Draw runs alone in its transaction and at least one block after the
              latest reveal, so nothing alongside it can read the result and back out.
            </LI>
            <LI>
              <strong>Withholding a reveal.</strong> A holder who has seen the other revealed nonces can
              choose not to reveal, which changes the seed. It costs their bond, which joins the pool,
              and it is blind, because <C>chain_seed</C> is not known until the draw. The bond is a
              fixed amount the creator sets, not a penalty sized to the prize; in the sample raffles it
              is under 1% of the pool.
            </LI>
          </UL>

          {/* --------------------------------------------------------- trigger */}
          <H2 id="trigger">The draw trigger</H2>
          <P>
            <strong>Wired today:</strong> nothing fires by itself. The sale closes through the
            program’s own checks, at the commit deadline or the moment the last ticket sells,
            because Buy refuses after either; that needs no trigger. The draw happens when somebody
            sends Draw, and anyone may once it is ready. The raffle page offers the button to whoever is
            looking.
          </P>
          <P>
            <strong>Designed, not wired:</strong> Rialo’s Subscriber program can send a
            transaction when a predicate fires. The design is one one-shot subscription at the reveal
            deadline whose action is Draw, so a raffle settles without anyone pressing. Settling early,
            the moment the last holder reveals, would also need an event topic, which the program does
            not emit today.
          </P>
          <P>
            Predicates carry no value comparison. They hold a topic, an optional event account and an
            optional timestamp range, and nothing else. There is no interval or calendar scheduling
            either, so a recurring schedule has to re-arm itself with a fresh nonce each time.
          </P>

          {/* --------------------------------------------------------- samples */}
          <H2 id="samples">The sample raffles</H2>
          <P>
            Raffles 1 to 5 are fixed demonstration data, built into the site and not on chain. Their
            clock starts at 30 Jul 2026 and ticks from there, and nothing pressed on them is signed or
            sent. The commitments are genuine SHA-256 digests of the listed nonces, and the settled
            sample was settled by running the real draw code.
          </P>
          <P>
            They use the earlier v1 formulas, which hash text where the program hashes fixed-width
            bytes. The same nonce is text in the commitment and raw bytes in the seed:
          </P>
          <Code>{`commitment_v1 = sha256( UTF-8 text of
  "rialo-raffle-v1|commit|" raffleId "|"
  ticketIndex "|" holder "|" nonce )

  raffleId, ticketIndex   decimal
  holder                  base58
  nonce                   32 lowercase hex chars

seed_v1 = sha256(
    UTF-8 "rialo-raffle-v1|seed|" raffleId "|"
  ‖ each revealed nonce, sorted:
      16 raw bytes ‖ UTF-8 "|"
  ‖ chainSeed: 8 raw bytes, in the order
      its hex reads
)`}</Code>
          <P>
            Winner selection is the same keystream as above. Recomputing a sample re-runs the code that
            produced its record, so it demonstrates the method and cannot fail; only a live raffle gives
            the check something independent to disagree with.
          </P>

          {/* ----------------------------------------------------------- tests */}
          <H2 id="tests">What is tested</H2>
          <P>
            <C>pnpm verify</C> runs three suites offline, with nothing sent to any network:
          </P>
          <Table
            head={["Checks", "Suite and what it asserts"]}
            widths={["4.5rem", "auto"]}
            rows={[
              [
                "20",
                <>
                  <span className="figure block">scripts/verify-sha256.ts</span>
                  <span className="text-fg-2">
                    SHA-256 against the FIPS 180-4 vectors, including a million “a”, plus 400
                    random cross-checks against node:crypto.
                  </span>
                </>,
              ],
              [
                "75",
                <>
                  <span className="figure block">scripts/verify-raffle.ts</span>
                  <span className="text-fg-2">
                    The draw in lib/raffle.ts: determinism, distinct winners, independence from reveal
                    order, the winner cap, payouts summing to the pool for 1, 2, 3 and 7 winners, an
                    audit that rejects a tampered winner list, uniformity, and the sample data.
                  </span>
                </>,
              ],
              [
                "138",
                <>
                  <span className="figure block">scripts/verify-chain.ts</span>
                  <span className="text-fg-2">
                    The browser library: transactions byte for byte against @rialo/ts-cdk fixtures, the
                    v2 hashes against node:crypto, account decoding, a draw check that fails on altered
                    data, and payouts and refusals as the spec states them.
                  </span>
                </>,
              ],
            ]}
          />
          <P>
            Uniformity is a chi-square test over fresh random seeds: one winner of 20 across 60,000
            seeds, and five winners of 20 across 20,000. The statistic changes on every run, so no single
            value is quoted here; the test passes when it stays under the critical value of 43.82 (19
            degrees of freedom, p = 0.001).
          </P>
          <P>
            Against a running network, <C>program/tests/e2e.mjs</C> drives the deployed program through
            a full raffle, a partial reveal, a void raffle, deliberate refusals checked for their codes
            (the Draw guards among them) and a 200-ticket worst case, checking balances to the kelvin
            and recomputing every draw in JavaScript.{" "}
            <C>scripts/smoke-chain.ts</C> does the same through the browser library. Both run against a
            local network; neither will ask a public faucet for funds.
          </P>

          {/* --------------------------------------------------------- network */}
          <H2 id="network">Network reference</H2>
          <P>
            Established by probing the node directly. The published documentation lists three different
            devnet endpoints and one of them does not resolve, so treat these as observed values rather
            than documented ones.
          </P>
          <Facts
            rows={[
              ["Testnet RPC", "https://testnet.rialo.io:4101"],
              ["Subscriber program", "Subscriber1111…  deployed, executable"],
              ["Faucet", "requestAirdrop{pubkey, kelvins}, max 1 RLO per call, rate limited per IP"],
              ["Balance", "getBalance{address}, in kelvin"],
              ["Raffle accounts", "getAccountsByOwner, by program id"],
              ["Clock", "unix_timestamp in milliseconds"],
              ["Replay protection", "configHashPrefix and validFrom, not a blockhash"],
              ["Pubsub", "none among the 39 methods, so state is polled"],
              ["CORS", "access-control-allow-origin: *"],
            ]}
          />
          <P>
            Rialo is not Solana-RPC compatible. Parameters are a single-element array holding a struct,
            there is no <C>getLatestBlockhash</C>, and the Wallet Standard namespace is <C>rialo:*</C>,
            so Solana wallets are not discovered. A <C>configHashPrefix</C> is a u64 and has to be read
            from the raw response text: <C>JSON.parse</C> rounds it, and the node then rejects the
            transaction.
          </P>

          <div className="mt-10">
            <TextLink href="/learn">The same thing without the formulas, in How it works</TextLink>
          </div>
        </Reading>
      </main>
    </>
  );
}

/**
 * The program's error codes (program/src/lib.rs, numbered as program/SPEC.md numbers them), with
 * its additions folded into the wording: the overflow check in Create, the codes the spec left open
 * for a settled raffle, and the two Draw guards, 17 and 18. Kept as data so the table cannot drift
 * from one row to the next in how it is written.
 */
const ERRORS: [string, string, string][] = [
  ["1", "BadInstruction", "unknown tag or wrong data length"],
  ["2", "BadAccount", "wrong owner, wrong size, a missing signer or writable flag, or an account in the wrong place"],
  ["3", "AlreadyInitialised", "Create on an account that is already a raffle"],
  ["4", "NotInitialised", "the account is not a raffle"],
  ["5", "BadConfig", "supply, winners, price or deadlines out of range, or a sale total that would overflow"],
  ["6", "SaleClosed", "Buy after the commit deadline, when sold out, or on a settled raffle"],
  ["7", "WrongTicket", "the Buy index is not sold + 1, or a ticket index is out of range"],
  ["8", "RevealsNotOpen", "Reveal before the sale closed"],
  ["9", "RevealsClosed", "Reveal at or after the reveal deadline, or on a settled raffle"],
  ["10", "NotHolder", "the signer or recipient is not the ticket's holder, or not the creator"],
  ["11", "AlreadyRevealed", "that ticket is already revealed"],
  ["12", "CommitmentMismatch", "the nonce does not hash to the commitment"],
  ["13", "NotReady", "Draw before it is ready"],
  ["14", "AlreadySettled", "Draw on a raffle that is already drawn or void"],
  ["15", "NothingToClaim", "not a winner, already paid, or the raffle is not settled"],
  ["16", "Arithmetic", "an overflow, or an account would go below zero"],
  ["17", "DrawMustRunAlone", "Draw sent through another program, alongside other instructions, or without the instructions sysvar"],
  ["18", "TooSoon", "Draw in the same block as the latest Reveal; it works one block later"],
];
