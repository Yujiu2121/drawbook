import type { Metadata } from "next";
import Link from "next/link";

import { BUTTON, BUTTON_PRIMARY } from "@/lib/controls";

/**
 * THE NOT-FOUND PAGE (K15, OFF-11, CHROME-K15).
 *
 * Without this file Next served its own default: "404 | This page could not be found." in the
 * system face, inside the masthead and footer, with a second and third <title> of its own, so the
 * tab read "Drawbook" on one missing address and "404: This page could not be found." on another.
 * This page uses the product's own type and surfaces, sets one title through the layout's template,
 * and says in plain words what happened and where to go instead.
 *
 * It is a Server Component with no state and no data: a missing page is a fact, and nothing about
 * it changes while it is open. Next marks the response 404 and adds `noindex` by itself.
 *
 * The two ways out are the two things a visitor most plausibly came for: the board, which lists
 * every raffle on chain and the samples, and the deploy form. The board is the filled button
 * because it is the likelier one; the form is bounded, so the two do not compete.
 *
 * ITS ONE MOTION IS AN ENTRANCE, IN CSS. The label, the title, the lead and the two ways out rise
 * into place once, 80ms apart, on `animate-rise` (fill both, so each waits unseen for its turn and
 * then rests with no transform). The delays are inline styles because the `animation` shorthand
 * in that utility would reset a delay written as another class. Under reduced motion
 * app/globals.css removes the animation, and everything is simply there.
 *
 * THE FIELD BESIDE IT IS A PICTURE OF THE SENTENCE, NOT DATA. A quiet block of unsold cells with
 * one slot drawn dashed and empty: nothing lives at this address. It names no raffle, carries no
 * figure and is hidden from assistive technology, and it is static markup, so the server and the
 * client draw it identically. It shows from 1024, where the column has room beside the text.
 *
 * CONTRAST (WCAG 2.x, on the dusk ground under the haze, worst at the haze peak #351c20): the label
 * --event 11.02, the lead --fg-2 7.94; the title is the headline ramp, chalk into apricot, whose
 * darker stop is apricot at 11.02 there. The cells are --cell inside a --bound edge, 3.25 at the
 * peak, the same pair as an unsold ticket anywhere on the site.
 */

export const metadata: Metadata = {
  title: "Page not found",
};

/** The field: 6 by 4 unsold cells, and the one empty slot. */
const COLUMNS = 6;
const CELLS = 24;
const EMPTY = 15;

export default function NotFound() {
  return (
    <main className="pt-mast">
      <section className="flex items-center justify-between gap-16 px-gutter pt-[clamp(48px,8vw,112px)] pb-[clamp(56px,9vw,120px)]">
        <div className="min-w-0">
          <p className="label animate-rise text-event">Page not found</p>
          <h1
            className="mt-5 max-w-[16ch] animate-rise headline text-display headline-ramp"
            style={{ animationDelay: "80ms" }}
          >
            Nothing lives at this address.
          </h1>
          <p
            className="mt-7 max-w-[52ch] animate-rise text-lg text-fg-2"
            style={{ animationDelay: "160ms" }}
          >
            The link may be mistyped, or it may point at something that was never here. The five
            sample raffles are at /raffle/1 to /raffle/5. A raffle deployed on chain has its own
            address, and its page is /r/ followed by that address.
          </p>
          <div
            className="mt-10 flex animate-rise flex-wrap gap-3"
            style={{ animationDelay: "240ms" }}
          >
            <Link href="/raffles" className={BUTTON_PRIMARY}>
              See all raffles <span aria-hidden="true">&rarr;</span>
            </Link>
            <Link href="/create" className={BUTTON}>
              Deploy a raffle
            </Link>
          </div>
        </div>

        <div
          aria-hidden="true"
          className="hidden shrink-0 animate-rise gap-2 lg:grid"
          style={{ animationDelay: "240ms", gridTemplateColumns: `repeat(${COLUMNS}, 2.25rem)` }}
        >
          {Array.from({ length: CELLS }, (_, i) =>
            i === EMPTY ? (
              <span key={i} className="block size-9 rounded-cell border border-dashed border-bound" />
            ) : (
              <span key={i} className="block size-9 rounded-cell border border-bound bg-cell" />
            ),
          )}
        </div>
      </section>
    </main>
  );
}
