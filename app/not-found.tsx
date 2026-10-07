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
 * CONTRAST (WCAG 2.x, on --panel #e9eaf6): title --fg 15.01, lead --fg-2 7.60, label --fg-3 5.73.
 */

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="pt-mast">
      <section className="px-gutter pt-[clamp(48px,8vw,112px)] pb-[clamp(56px,9vw,120px)]">
        <p className="label text-fg-3">Page not found</p>
        <h1 className="mt-5 max-w-[16ch] font-serif text-display text-fg">
          Nothing lives at this address.
        </h1>
        <p className="mt-7 max-w-[52ch] text-lg text-fg-2">
          The link may be mistyped, or it may point at something that was never here. The five
          sample raffles are at /raffle/1 to /raffle/5. A raffle deployed on chain has its own
          address, and its page is /r/ followed by that address.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/raffles" className={BUTTON_PRIMARY}>
            See all raffles <span aria-hidden="true">&rarr;</span>
          </Link>
          <Link href="/create" className={BUTTON}>
            Deploy a raffle
          </Link>
        </div>
      </section>
    </main>
  );
}
