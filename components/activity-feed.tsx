import { Reveal } from "@/components/fx";
import { serialOf } from "@/lib/cell";
import { NOW } from "@/lib/mock-raffles";
import {
  formatAge,
  formatRLO,
  shortAddress,
  type Activity,
  type ActivityKind,
} from "@/lib/raffle";

/**
 * WHAT HAS HAPPENED, NEWEST FIRST.
 *
 * Three columns and nothing else: how long ago, what it was, and how much moved. The feed is the
 * quietest surface in the product on purpose. Its job is to prove the room is in use, not to be
 * read closely, so it carries no fill, no tag, no hue and no rule of its own beyond the hairline
 * between events. Everything that distinguishes one kind of event from another is a word.
 *
 * NO CLIENT DIRECTIVE, AND THAT IS THE POINT. Every age here is computed once per render from the
 * pinned NOW of lib/mock-raffles.ts, and none of them subscribe to anything: a feed of events that
 * are hours and days old does not change under the viewer, so it must not be wired to
 * lib/clock.ts. Ticking it would cost a client boundary and a re-render per second to move a
 * figure that reads "11h ago" either way.
 *
 * NOTHING HERE IS A NAMED VIEW TRANSITION. A feed sliver naming `cell-4` would be the second
 * element claiming that name on a page that already has the row or the blade, and React resolves
 * a duplicate silently by applying it to exactly one instance. The morph would then anchor to
 * whichever came first in tree order. Transition names live in two files in this product,
 * components/row-link.tsx and app/raffle/[id]/page.tsx, and this is not one of them.
 *
 * TWO SHAPES, ONE COMPONENT
 *
 *   scope="raffle"  the detail page. Every event belongs to the raffle in front of you, so the
 *                   serial would be the same string on every line and the actor is what varies.
 *
 *   scope="all"     the board. Events come from five raffles, so each line leads with the serial
 *                   that owns it and the actor is dropped: at 13px the address is the first thing
 *                   that would push a sentence onto a second line, and it is the least useful
 *                   column of the three.
 *
 * THE ENTRIES RISE ONCE. Each line is a `Reveal` (components/fx.tsx): one still below the fold
 * when the page mounts fades and rises into place the first time it is scrolled to, 50ms after
 * the line above it; one already on screen is never hidden to be shown again, and with no script
 * or under a reduced-motion preference every line is simply there. Nothing here is a row, a strip
 * or a named element, which is why the feed may move at all.
 *
 * THE LIST CARRIES `text-fg`, AND THAT ONE CLASS IS THE WHOLE TRICK.
 *
 * `body { color: var(--fg) }` substitutes the var at the body element, so every descendant
 * inherits the resolved rgb and NOT the custom property. A section that redefines --fg would
 * leave a feed that let its sentences inherit in the body's colour. The record tone no longer
 * redefines --fg, so today nothing on the page does that, but the `text-fg` on the <ul>
 * re-resolves the role at the list either way, so the sentence and the amount always follow the
 * block they sit in. app/cell.css makes the same choice for `.row`.
 *
 * CONTRAST, COMPUTED (WCAG 2.x relative luminance, 0.03928 knee,
 * L = 0.2126R + 0.7152G + 0.0722B, formula sanity-checked at #ffffff on #000000 = 21.00), each
 * pair against the surface it actually sits on:
 *
 *   sentence, amount   --fg / --panel      16.38 on the ground, 14.98 in the record tone
 *   age, serial, actor --fg-3 / --panel     5.58 on the ground,  5.10 in the record tone
 *   empty-state note   --fg-3 / --panel     5.58 on the ground,  5.10 in the record tone
 *   hairline           --rule / --panel     1.70 on the ground,  1.55 in the record tone,
 *                                                decorative only
 *
 * The feed carries no surface of its own, so a page owner may set it on a panel or on a raffle in
 * its reveal window without recomputing: the tightest pair it can make is --fg-3 on --phase at
 * 4.76, and on --panel-2 it is 5.13. Both clear AA for the 13px it is set at.
 */

/** Two digits on a ticket serial, matching the cells in components/cell.tsx. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * What happened, in words.
 *
 * "voided, everyone refunded" is the whole truth of a void raffle in one clause: the tickets and
 * the reveal bonds both went back, because nobody's bond can be forfeited when nobody drew.
 */
function sentence(event: Activity): string {
  const ticket = event.ticketIndex === undefined ? "" : ` ticket ${pad2(event.ticketIndex)}`;

  const phrase: Record<ActivityKind, string> = {
    deployed: "deployed",
    bought: `bought${ticket}`,
    revealed: `revealed${ticket}`,
    drawn: `won${ticket}`,
    void: "voided, everyone refunded",
  };

  return phrase[event.kind];
}

export function ActivityFeed({
  events,
  now = NOW,
  limit,
  title = "Activity",
  scope = "raffle",
  headClass = "label text-fg-3 mb-2.5",
}: {
  events: readonly Activity[];
  /** Pinned, and never a live clock. Defaults to the same NOW every raffle is built against. */
  now?: Date;
  limit?: number;
  /**
   * The visible heading, and the accessible name of the list under it. It is carried onto the
   * <ul> as an aria-label rather than an aria-labelledby, because an id would have to be either
   * a hook this Server Component cannot call or a string a caller could collide with itself: two
   * feeds on one page is the ordinary case on the board.
   */
  title?: string;
  scope?: "raffle" | "all";
  /**
   * The heading's classes. A raffle's page keeps the plain label; the board passes its section
   * eyebrow, so this head and the notes beside it read as one rank.
   */
  headClass?: string;
}) {
  const shown = limit === undefined ? events : events.slice(0, limit);

  return (
    <section>
      <h2 className={headClass}>{title}</h2>

      {shown.length === 0 ? (
        <p className="text-sm text-fg-3 border-t pt-2.5">Nothing has happened here yet.</p>
      ) : (
        <ul aria-label={title} className="text-fg border-t text-sm">
          {shown.map((event, i) => (
            <Reveal
              as="li"
              key={`${event.raffleId}-${event.kind}-${event.ticketIndex ?? "x"}-${i}`}
              delay={Math.min(i, 6) * 50}
              /*
                76px of age, then the sentence, then the amount hard right. The age column is
                4.5rem rather than the preview's 64px below 760: seven glyphs of Martian Mono at
                width 100 cost 0.700em each, so "16h ago" is 63.7px at 13px and the preview only
                cleared 64px by dropping the age to 12px. Widening the column keeps one type size
                in the feed instead of two.
              */
              className="grid grid-cols-[4.75rem_minmax(0,1fr)_auto] max-[759px]:grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2.5 border-b py-2.5"
            >
              <time className="figure text-fg-3" dateTime={event.at}>
                {formatAge(event.at, now)} ago
              </time>

              <span className="min-w-0">
                {scope === "all" ? (
                  <>
                    <span className="serial text-fg-3">{serialOf(event.raffleId)}</span>{" "}
                  </>
                ) : null}
                {sentence(event)}
                {scope === "raffle" && event.actor ? (
                  <>
                    {" "}
                    <span className="mono text-fg-3">{shortAddress(event.actor)}</span>
                  </>
                ) : null}
              </span>

              {event.amount === undefined ? null : (
                <span className="figure text-right max-[759px]:col-start-2">
                  {formatRLO(event.amount)} RLO
                </span>
              )}
            </Reveal>
          ))}
        </ul>
      )}
    </section>
  );
}
