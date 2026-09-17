import type { Metadata } from "next";

import { ActivityFeed } from "@/components/activity-feed";
import { Board } from "@/components/board";
import { utcStamp } from "@/lib/cell";
import { MOCK_RAFFLES, NOW } from "@/lib/mock-raffles";
import { activityOf } from "@/lib/raffle";

/**
 * /raffles: THE BOARD.
 *
 * A SERVER COMPONENT THE WHOLE WAY DOWN, with two islands inside it and nothing else: the clock in
 * the band and the sort control on the floor. Everything on this route is static at build time,
 * which it can be because every figure on it is a reduction over lib/mock-raffles.ts and nothing
 * here reads a wallet, a chain or a request.
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
    "Every Drawbook raffle: what is still on the floor, what has settled, and how long is left on the next deadline.",
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
      <section className="px-pad py-[clamp(44px,7vw,96px)]">
        <div className="grid items-start gap-[clamp(26px,3.4vw,52px)] lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div>
            <h2 className="label text-fg-3">Notes on what you are reading</h2>

            <p className="mt-2.5 max-w-[46ch] text-lg text-fg-2">
              A raffle inside its reveal window sits on a different surface, not a different badge.
              The black is not decoration either: it is where the record begins.
            </p>

            {/*
              The clock, stated plainly, because it is the one thing on this page that is not a
              fact about a chain. lib/clock.ts publishes seconds elapsed since the tab woke up and
              every countdown adds that to the pinned instant, so two tabs opened an hour apart
              disagree by an hour and neither of them is lying about a block.
            */}
            <p className="mt-[clamp(20px,2.6vw,30px)] max-w-[58ch] text-sm text-fg-3">
              The countdowns above advance from a pinned instant, {utcStamp(NOW.toISOString())},
              plus the time this tab has been open. Time passing is not a chain event, so nothing
              here pretends one happened.
            </p>

            <p className="mt-[18px] max-w-[58ch] text-sm text-fg-3">
              No figure on this board rolls on an odometer. A rolling figure means the number came
              off a node in the last few seconds, and the only one in this product is the block
              height in the masthead. Everything here steps.
            </p>

            <p className="mt-[18px] max-w-[58ch] text-sm text-fg-3">
              The draw is randomized, not unbiasable. Withholding a reveal does move the seed.
              Biasing it needs a party who both produces blocks and reveals last, and the bond they
              forfeit is the price of trying.
            </p>
          </div>

          <ActivityFeed events={events} limit={11} title="Activity, every raffle" scope="all" />
        </div>
      </section>
    </main>
  );
}
