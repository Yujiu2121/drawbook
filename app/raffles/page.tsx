import type { Metadata } from "next";

import { ActivityFeed } from "@/components/activity-feed";
import { Board } from "@/components/board";
import { ChainRaffleList } from "@/components/chain-list";
import { CLOCK_NOTE } from "@/lib/clock";
import { MOCK_RAFFLES } from "@/lib/mock-raffles";
import { activityOf } from "@/lib/raffle";

/**
 * /raffles: THE BOARD.
 *
 * A SERVER COMPONENT THE WHOLE WAY DOWN, with three islands inside it and nothing else: the list
 * of raffles on chain at the top, the clock in the band and the sort control on the floor.
 *
 * TWO SOURCES, LABELLED AS TWO. The first section is read from the chain in the browser by
 * components/chain-list.tsx, because it is whatever the raffle program owns right now. Everything
 * under it is the sample record, static at build time, which it can be because every figure there
 * is a reduction over lib/mock-raffles.ts. The samples are headed as samples and say they are not
 * on chain: they stay because every draw in them is fully checkable, and they must never be read
 * as raffles someone can enter.
 *
 * NOTHING IS HARDCODED THAT THE DATA ALREADY KNOWS. The board this replaces printed its two header
 * lines as string literals, and one of them was wrong. The counts, the pool figures, the ticket
 * totals, the feed and the pinned instant quoted in the note below are all read out of the modules
 * at render time, so a sixth raffle changes this page without anyone editing it.
 *
 * THE MASTHEAD AND THE FOOTER ARE NOT HERE. app/layout.tsx mounts both once, so they survive a
 * navigation rather than being torn down and rebuilt; this route only owes `pt-mast`, because the
 * masthead is fixed and something has to reserve its 56px.
 *
 * THERE IS NO "DEPLOY A RAFFLE" BUTTON ON THIS PAGE ANY MORE, AND THAT IS DELIBERATE. The masthead
 * carries `/create` as "Deploy" on every route and the footer carries it again, so a third copy on
 * the one page whose whole job is to list what already exists was the only call to action
 * competing with the rows for the top of the page.
 *
 * CONTRAST, COMPUTED (WCAG 2.x relative luminance, 0.03928 knee,
 * L = 0.2126R + 0.7152G + 0.0722B, sanity-checked at #ffffff on #000000 = 21.00):
 *
 *   lead        --fg-2 / --panel   7.60   19px
 *   note        --fg-3 / --panel   5.73   13px
 *
 * Both clear AA at their size. Every other pair on the route is quoted in the file that owns it.
 */

export const metadata: Metadata = {
  title: "Raffles",
  description:
    "Every Drawbook raffle on chain, and the sample record beside it: what is still on the floor, what has settled, and how long is left on the next deadline.",
};

export default function Page() {
  /*
    One feed over every raffle, newest first. The ages are computed once from the pinned NOW and
    subscribe to nothing, which is why the feed stays on the server: an event that happened eleven
    hours ago reads the same on the next tick.
  */
  const events = MOCK_RAFFLES.flatMap(activityOf).sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  );

  return (
    <main className="pt-mast">
      {/*
        The visible top of this page is a countdown, and a countdown is not a page title. The name
        of the route is carried for assistive technology instead of being printed above the
        monument, where it would be a second, smaller, quieter heading directly above the largest
        figure in the product.
      */}
      <h1 className="sr-only">Raffles</h1>

      <ChainRaffleList />

      {/*
        The line between the two sources. A heading at the same serif title size as "On chain",
        so the page reads as two sections of equal rank, and a sentence that says what the second
        one is before its countdown can be mistaken for a live one.
      */}
      <section aria-labelledby="samples-heading" className="px-gutter pt-[clamp(32px,4.4vw,60px)]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
          <h2 id="samples-heading" className="m-0 font-serif text-title">
            Sample raffles
          </h2>
          <p className="label text-fg-3">not on chain</p>
        </div>
        {/* One string rather than text around an expression: the prerender dropped the space
            after the count when it was written as JSX text, and printed "The 5raffles". */}
        <p className="mt-3 max-w-[58ch] text-sm text-fg-2">
          {`The ${MOCK_RAFFLES.length} raffles below are a fixed demonstration record kept in this site’s code, not accounts on any chain. They stay to show the method: every draw in them can be recomputed from its published secrets, though on a sample that re-runs the code that made the record, so it cannot fail. Nothing done on them is signed or sent.`}
        </p>
      </section>

      <Board raffles={MOCK_RAFFLES} />

      {/*
        THE NOTES, AND WHY THEY STAY AT THE FOOT WHILE THE KEY MOVED TO THE TOP.

        These four paragraphs are qualifications: what the clock is measuring, what a figure that
        does not roll means, and the limit on the draw. Every one of them is a correction to an
        assumption a reader can only have formed by looking at the board first, so they belong
        after it. What did NOT belong after it is the key to the blocks and the stage words, which
        is the vocabulary needed to read the board at all; that is now the first thing under the
        countdown. The old page had both down here, which is why the page opened on a dense grid
        with nothing explaining it and closed with an explanation nobody had reached yet.
      */}
      <section className="px-gutter py-[clamp(44px,7vw,96px)]">
        <div className="grid items-start gap-[clamp(26px,3.4vw,52px)] lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div>
            <h2 className="label text-fg-3">Notes on what you are reading</h2>

            <p className="mt-2.5 max-w-[46ch] text-lg text-fg-2">
              A raffle inside its reveal window sits on a different surface, not a different badge.
              The black is not decoration either: it is where the record begins.
            </p>

            {/*
              The sample clock, stated plainly, because it is the one thing in the sample record
              that moves and it is not a fact about a chain. lib/clock.ts publishes seconds elapsed
              since the tab woke up and every sample countdown adds that to the pinned instant. The
              raffles on chain at the top of the page count against real time, which is why the
              note names the samples rather than "the countdowns": the shared constant is the one
              the detail pages print, so the two cannot drift.
            */}
            <p className="mt-[clamp(20px,2.6vw,30px)] max-w-[58ch] text-sm text-fg-3">
              {CLOCK_NOTE}
            </p>

            <p className="mt-[18px] max-w-[58ch] text-sm text-fg-3">
              No figure on the sample board rolls on an odometer. A rolling figure means the number
              came off a node in the last few seconds, and the only ones in this product are the
              block height and the wallet balance in the masthead. Everything here steps.
            </p>

            {/*
              The limit, at its real width. This used to say biasing needs "a party who both
              produces blocks and reveals last", which is too narrow: the chain value is read at
              the draw, after every nonce is public, so the producer of the draw block alone may be
              able to steer it. Withholding a reveal is the smaller, separate lever, and it is
              blind and costs the bond.
            */}
            <p className="mt-[18px] max-w-[58ch] text-sm text-fg-3">
              The draw is randomized and checkable, not beyond influence. The chain value is read
              at the draw, after every secret is public, so whoever produces the draw block may be
              able to influence it. A holder can also withhold a reveal, blind, at the cost of
              their bond.
            </p>
          </div>

          {/* "Every sample", not "every raffle": the raffles on chain at the top of this page are
              not in this feed, and its ages are measured from the sample record's pinned instant. */}
          <ActivityFeed events={events} limit={11} title="Activity, every sample" scope="all" />
        </div>
      </section>
    </main>
  );
}
