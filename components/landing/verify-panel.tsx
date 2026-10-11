import { RecomputePanel } from "@/components/ceremony";
import type { DrawStep } from "@/lib/raffle";

/**
 * VERIFIABLE BY DESIGN: the working of one settled draw, collapsed.
 *
 * THE DRAW SHOWN IS A SAMPLE, AND THE SUMMARY LINE SAYS SO. Raffle 0004 is fixed demonstration
 * data, not an account on chain, so its recompute re-runs the code that made it and cannot fail.
 * `<RecomputePanel>` states that beside its button; a live raffle's own page carries the check
 * that can fail.
 *
 * WHY IT IS COLLAPSED AND WHY THAT IS NOT A DEMOTION. Everything in here was previously on the
 * first screen, above any sentence explaining what Drawbook is. It is the most interesting thing
 * in the product and it is the last thing a first-time reader needs, and those two facts are not
 * in tension: this section is the floor the rest of the page stands on, so it goes at the bottom
 * and it opens on a click.
 *
 * A `<details>` AND NOT A STATE HOOK. The browser owns disclosure, so this whole section is a
 * Server Component, it works with no script at all, the open state survives a find-in-page, and
 * there is no hydration seam over the one part of the product whose job is to be checkable.
 *
 * THE ONE CLIENT ISLAND IS `<RecomputePanel>`, which is the button that was the ceremony's footer
 * until this section existed. It is the same computation in the same file; see the note there for
 * why there is exactly one of it on a page.
 *
 * NOTHING IN HERE IS FORMATTED FOR EFFECT. The nonces are the nonces, in the sorted order
 * `deriveSeed` hashes them in, and the trace is `deriveWinnerTrace`'s own steps with the pool size
 * each one sampled from, which is the number that proves the second winner could not be the first.
 *
 * TWO COLUMNS ONLY WHEN THE PANEL ITSELF IS WIDE. It is a container query on the panel, not a
 * media query on the viewport, because the page sets it beside the commitment field on a wide
 * screen, where the panel is about half the measure (measured: 541px at 1280, 694px at 1920). The
 * old viewport rule split that into two columns of about 210 and 240px, and every nonce broke
 * over two lines. From 760px of panel the two columns hold a nonce whole.
 *
 * THE MATERIAL. One card on the card ramp, its corners on the panel step, with every digest in a
 * --recess well cut into it. The summary line is the signal colour because it is the one control
 * here; the seed carries a faint apricot light because it is the one value everything else in the
 * panel exists to produce.
 *
 * CONTRAST, against the surface each pair sits on (WCAG 2.x, as in app/globals.css):
 *   --event / the card ramp      the summary line, 12.25 over the ground, 11.40 at the haze peak
 *   --fg-3  / the card ramp      the headings and the count, 5.10 and 4.73
 *   --fg-3  / --recess (pit)     the nonce indices, 5.80
 *   --fg    / --recess           every digest, 17.03. The seed's glow sits behind the glyphs and
 *                                only lightens the well around them, never the ink.
 *   --cell-won / the card ramp   the winning tickets, 6.17 and 5.55
 */

export interface VerifyPanelProps {
  /** The settled sample raffle's four-digit serial. */
  serial: string;
  /** Every revealed nonce, already sorted, paired with the ticket it came off. */
  nonces: readonly { index: string; nonce: string }[];
  /** `get_random_seed()`'s stand-in for this raffle: eight bytes, hex. */
  chainValue: string;
  /** The seed, recomputed from public data by lib/raffle.ts rather than read off the record. */
  seed: string;
  /** How many tickets were sold and revealed, and so eligible to be drawn. */
  eligible: number;
  /** `deriveWinnerTrace(...)`: one step per winner, carrying the pool it sampled from. */
  trace: readonly DrawStep[];
}

export function VerifyPanel({
  serial,
  nonces,
  chainValue,
  seed,
  eligible,
  trace,
}: VerifyPanelProps) {
  return (
    <details className="vpanel card @container rounded-panel">
      {/* The count sits under the title rather than beside it: the panel shares its row with the
          commitment field on a wide screen, and beside the title the two broke over four lines. */}
      <summary className="flex items-center gap-4 px-[clamp(18px,2vw,26px)] py-5">
        <span className="grid min-w-0 gap-1.5">
          <span className="label text-event">The working, sample raffle {serial}</span>
          <span className="label hidden text-fg-3 sm:block">
            {nonces.length} nonces &middot; 1 chain value &middot; 1 seed &middot; {trace.length}{" "}
            winners
          </span>
        </span>
        <span aria-hidden="true" className="chev ml-auto" />
      </summary>

      <div className="grid gap-[clamp(24px,3vw,44px)] border-t border-rule p-[clamp(20px,2.4vw,30px)] @min-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0">
          <h3 className="label m-0 mb-2.5 text-fg-3">Revealed nonces, sorted</h3>
          {/* Capped and scrollable: eighteen digests is a column taller than the panel beside it,
              and a disclosure that opens into three screens of hex has not disclosed anything. */}
          <div className="max-h-[300px] overflow-y-auto rounded-well bg-recess p-3">
            <table className="w-full border-collapse">
              <tbody>
                {nonces.map((n) => (
                  <tr key={n.index}>
                    <td className="label-b w-[3.5em] py-[3px] align-top text-label text-fg-3">
                      {n.index}
                    </td>
                    <td className="digest py-[3px] text-label text-fg">{n.nonce}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="label m-0 mb-2.5 text-fg-3">Chain value</h3>
          <p className="digest m-0 rounded-well bg-recess p-3 text-label text-fg">{chainValue}</p>

          <h3 className="label m-0 mt-[26px] mb-2.5 text-fg-3">Seed</h3>
          <p className="vseed digest m-0 rounded-well border bg-recess p-3 text-label text-fg">
            {seed}
          </p>

          <h3 className="label m-0 mt-[26px] mb-2.5 text-fg-3">Eligible pool</h3>
          <p className="m-0 text-fg-2">{eligible} tickets, sold and revealed.</p>

          <h3 className="label m-0 mt-[26px] mb-2.5 text-fg-3">Winners</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr className="label text-fg-3">
                <th className="border-b border-rule py-1.5 pr-2.5 text-left">Step</th>
                <th className="border-b border-rule py-1.5 pr-2.5 text-left">Pool</th>
                <th className="border-b border-rule py-1.5 pr-2.5 text-left">Index</th>
                <th className="border-b border-rule py-1.5 text-left">Ticket</th>
              </tr>
            </thead>
            <tbody className="figure text-sm">
              {trace.map((step, i) => (
                <tr key={step.winner}>
                  <td className="border-b border-rule py-2 pr-2.5">{i + 1}</td>
                  <td className="border-b border-rule py-2 pr-2.5">{step.poolBefore}</td>
                  <td className="border-b border-rule py-2 pr-2.5">{step.pick}</td>
                  <td className="border-b border-rule py-2 text-cell-won">{step.winner}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-[26px]">
            <RecomputePanel />
          </div>
        </div>
      </div>
    </details>
  );
}
