import { Fragment, type CSSProperties } from "react";

import { PHASE_WORD, Strip } from "./cell";
import { Countdown, CountdownRules } from "./countdown";
import { LiveRows, type LiveRow } from "./live-rows";
import { RaffleRowCells, rowLabel, rowContainerProps } from "./row";
import { NamedStrip, RowLink } from "./row-link";
import { activeDeadline, isLive, serialOf } from "@/lib/cell";
import { summarize, type Phase, type Raffle } from "@/lib/raffle";

/**
 * THE BOARD.
 *
 * Every raffle in the product, on one page, as the same object at the same scale. Four parts: the
 * next deadline printed at monument size, a key to the two things the rows never name, the raffles
 * still on the floor, and the record of what has already settled.
 *
 * THE FLOOR NOW COMES BEFORE THE RECORD, AND THAT IS A CHANGE. The old order put the settled
 * raffles directly under the countdown and the enterable ones below them, which is the order an
 * auditor wants and the reverse of the order a visitor does: the first list on the page was the
 * one list nothing can be done with. It also put the dark slab in the middle of a light page and
 * sent the reader from it back into light. The record is evidence, it is still printed on the dark
 * surface, and it now sits at the foot where the footer continues it.
 *
 * THIS FILE HAS NO CLIENT DIRECTIVE AND THAT IS THE WHOLE POINT OF THE REWRITE.
 * The board it replaces was 455 lines of Client Component, and its own header comment named the
 * single reason for the boundary: the row's rise was a spring, and a spring needs a hovered state
 * in React to animate between. app/cell.css now does that rise as a `:hover` / `:focus-visible`
 * transform, so the rows came back to the server and what is left in the browser is one island,
 * components/live-rows.tsx, for the sort control. Everything below is markup the server emits
 * once, including all five ticket strips, which is 112 cells that used to be hydrated.
 *
 * THE OLD BOARD'S `LIFTED_SHADOW` IS DELETED RATHER THAN PORTED.
 * `0 2px 3px rgb(0 0 0 / 0.55), 0 26px 40px -16px rgb(0 0 0 / 0.9)` was a light source this room
 * does not have. The ground is the light and ink is where light is blocked, so a card lifted off
 * the page has nothing to cast a shadow onto and nothing to cast one with. The row says it has
 * been picked up by moving and by growing its strip, which are the two things a real object does.
 *
 * EVERY ROW IS A LINK, INCLUDING THE TWO STILL SELLING.
 * The design this ports expands raffles 0001 and 0002 in place, and it has to, because it is one
 * document with no page to send you to. This app has real static routes for all five ids under
 * `generateStaticParams`, so an expander here would mean two ways to buy a ticket, two payload
 * printers, and two places for the honest "nothing is posted" sentence to drift apart. The row
 * links, and the raffle page is where you act.
 *
 * THE ROW IS AN `<a>` AND NEVER A `<button>`. The design's `buildRow` returns a button with a
 * JavaScript handler, which in a real app costs the deep link, the middle click, the router
 * prefetch, the `onNavigate` hook that remembers the scroll, and the view transition that makes
 * the strip grow into the raffle page. All five of those are the navigation.
 *
 * EVERYTHING ON THIS BOARD IS THE SAMPLE RECORD, AND THE TWO LEADS SAY SO. The raffles that are
 * really on chain are listed above it by components/chain-list.tsx and live at /r/[address]. The
 * floor's lead used to invite the reader to "buy a ticket" here, which stopped being honest the
 * day a real raffle could be bought one section up.
 *
 * EVERY FIGURE IN THE TWO SECTION HEADERS IS A REDUCTION OVER THE REAL DATA.
 * The board this replaces printed "3 live, 55 of 80 tickets gone" and "2 settled, 1 void" as
 * string literals. Both are computed here, and the second was wrong: there are two settled
 * raffles in total, 0004 drawn and 0005 void, and a line that says "2 settled" beside "1 void"
 * reads as three. Naming the two phases separately says the same thing and cannot drift, because
 * adding a sixth raffle to lib/mock-raffles.ts changes both lines without anyone editing them.
 *
 * CONTRAST, COMPUTED (WCAG 2.x relative luminance, 0.03928 knee,
 * L = 0.2126R + 0.7152G + 0.0722B, sanity-checked at #ffffff on #000000 = 21.00), each pair
 * against the surface it actually sits on rather than against the page:
 *
 *   monument, title      --fg / --panel      15.01 light
 *   eyebrow, meta        --fg-3 / --panel     5.73 light
 *   section head, meta   --fg-3 / --panel     5.73 light, 5.65 inside the record slab
 *   hour meter fill      --fg / --panel      15.01 light   (a datum, needs 3:1)
 *   minute meter fill    --event / --panel    7.05 light   (a datum, needs 3:1)
 *   meter track          --bound / --panel    5.18 light   (the extent is part of the datum)
 *
 * The record slab is `.inv`, which remaps every role rather than restating a colour, so the rows
 * inside it need no branch and carry no second definition: --panel-2 becomes --ink, --fg becomes
 * --paper, --bound becomes --paper-3, and the phase tag's boundary goes from 4.77 to 5.65.
 */

/* ------------------------------------------------------------------------ the rows */

/**
 * One raffle, as a row that links to it.
 *
 * `NamedStrip` is applied to every row on this page and that is safe precisely here: /raffles is
 * the one route where each raffle appears exactly once, so no two elements can claim `cell-4`. A
 * duplicate name does not error and does not warn; React applies it to whichever instance its
 * traversal reaches first and the morph then anchors by tree order. See components/row-link.tsx.
 *
 * A settled raffle is handed no countdown at all, and so gets no client island: components/row.tsx
 * prints its absolute UTC instant on the server instead, dead still, which is the truth about a
 * raffle that stopped moving days ago.
 */
function BoardRow({ raffle }: { raffle: Raffle }) {
  const id = raffle.config.id;
  const live = isLive(raffle);

  return (
    <RowLink id={id} aria-label={rowLabel(raffle)} {...rowContainerProps(raffle)}>
      <RaffleRowCells
        raffle={raffle}
        strip={
          <NamedStrip id={id}>
            <Strip raffle={raffle} />
          </NamedStrip>
        }
        countdown={live ? <Countdown deadline={activeDeadline(raffle)} /> : undefined}
      />
    </RowLink>
  );
}

/* --------------------------------------------------------------------- the monument */

/**
 * THE NEXT DEADLINE, AT MONUMENT SIZE.
 *
 * One figure, and it is the only reason to open this page rather than bookmark a raffle: something
 * closes next, and this is how long you have. The raffle it names is the soonest to close of the
 * ones still moving, which on a board where nothing is moving is nothing at all, so the band is
 * simply absent rather than printing a zero.
 *
 * THE SIZE IS THE ALARM AND THERE IS NO SECOND SIGNAL FOR IT. components/countdown.tsx publishes
 * `data-tier` on the figure, and the final hour swaps --text-monument for --text-alarm on the
 * element that owns the attribute. No hue changes, no border appears and nothing flashes: the
 * number simply becomes the largest thing on the screen, which is what the last hour of a sale is.
 *
 * THE FIGURE GIVES UP ITS RESERVED WIDTH HERE, AND ONLY HERE.
 * `COUNTDOWN_RESERVE` holds 8ch so a row's last column cannot shunt sideways when the ladder
 * crosses a rung. On a monument that reservation is measured against a font size that the same
 * rung change also swaps, so in the final hour 8ch of --text-alarm is 1685px at 1280 and the band
 * would push a horizontal scrollbar across the document. The reservation is dropped with
 * `min-w-0!` and the figure sizes to its own glyphs. Nothing shunts inside a rung, because Martian
 * Mono is tabular and every rung is a fixed glyph count; across a rung the figure changes size
 * anyway, which is the event, not an accident.
 *
 * `overflow-x-clip` on the section is the backstop underneath that. Below about 390px the eight
 * glyph rung is wider than --pad leaves, and clipping a fraction of a glyph on a 320px phone is a
 * better failure than giving the whole document a horizontal scrollbar. `clip` rather than
 * `hidden`, so no scroll container is created.
 */
function NextDeadline({ raffle }: { raffle: Raffle }) {
  const s = summarize(raffle);
  const selling = raffle.phase === "selling";
  const deadline = activeDeadline(raffle);

  const meta = [
    // "Sample", not "Raffle": this band now sits under the live raffles read from the chain,
    // and its countdown runs on the sample clock, so it must not be read as one of them.
    `Sample ${serialOf(raffle)}`,
    `${s.sold} of ${raffle.config.supply} sold`,
    `${s.revealed} of ${s.sold} revealed`,
  ];

  return (
    <section
      aria-label="Next sample deadline"
      className="group overflow-x-clip px-gutter pt-[clamp(16px,2.4vw,34px)] pb-[clamp(14px,2vw,24px)]"
    >
      <p className="label text-fg-3">
        {selling ? "Sale closes" : "Reveals close"}
        {/*
          The second half of the alarm, and the half that says what the size means. It is revealed
          by the figure's own `data-tier`, so the wording and the type size can never disagree:
          there is one source for both and it is the clock.
        */}
        <span className="hidden group-has-[[data-tier='final']]:inline"> within the hour</span>
      </p>

      <div className="mt-[clamp(4px,0.8vw,10px)] flex flex-wrap items-end gap-x-[clamp(14px,3vw,40px)] gap-y-3">
        {/* The alarm is a size change on the element that owns `data-tier`, so the figure and the
            rule that resizes it read the same clock. --text-alarm is five glyphs wide by
            definition, which is exactly the rung the final hour prints. */}
        <Countdown
          deadline={deadline}
          className="monument min-w-0! text-monument text-fg data-[tier=final]:text-alarm"
        />

        <div className="min-w-0 flex-[1_1_220px] pb-[clamp(6px,1vw,14px)]">
          <p className="font-serif text-title">{raffle.config.title}</p>
          <p className="label text-fg-3 mt-2">
            <MetaLine parts={meta} />
          </p>
        </div>
      </div>

      {/* The two sub-hands of the same clock: an hour meter quantised to the minute, and a minute
          meter running underneath it. Both are one composited scaleX per tick and neither eases. */}
      <CountdownRules deadline={deadline} />
    </section>
  );
}

/* ------------------------------------------------------------------------- the key

   WHAT A FIRST-TIME READER IS ACTUALLY STUCK ON.

   The board's densest element is also its least explained: a bar of small blocks, one per ticket,
   carrying four states that the page never names. Someone who has used the product reads it at a
   glance and someone who has not reads texture. The same is true of the stage word in the third
   column: "Revealing" is precise and it is not English anybody arrives already knowing.

   So the key is two lists and no prose about cryptography. It sits directly under the countdown,
   before the first row, because a legend printed after the thing it explains has been read by
   nobody.

   THE SAMPLES ARE REAL CELLS. Each swatch below is `.c` with the same `data-s` the rows write, so
   it takes its fill, its reveal bar and its strike from app/cell.css and cannot drift from the
   strips it is explaining. A hand-drawn swatch would be a second definition of the one thing on
   this page that has to be trusted.

   EVERY STATE THE ROWS DRAW, ON BOTH SURFACES THEY DRAW IT ON. The key used to stop at four
   states, so raffle 0005's refunded tickets (state 4, a sold block struck through) read as
   "Bought". And it only showed the light floor: inside the dark record `.inv` remaps the cell
   roles, so 0004's winners are the pale --iris-lift, the same colour as a published secret's foot
   bar in a light-only key, and nothing on the page explained that. Each entry now shows the cell
   twice, as a one-cell strip on the floor and again inside a chip of the record's own surface, so
   the reader can match either half of the board against it.
*/
const TICKET_KEY: { state: 0 | 1 | 2 | 3 | 4; word: string }[] = [
  { state: 0, word: "Not sold yet" },
  { state: 1, word: "Bought" },
  { state: 2, word: "Secret published" },
  { state: 3, word: "Won" },
  { state: 4, word: "Refunded" },
];

/**
 * One cell as the rows draw it: a one-cell `.strip`, so the bed, the 1px gap and the winner's
 * hairline (`.strip .c[data-s="3"]`) all come from the same rules as the board's own strips.
 */
function KeyCell({ state }: { state: 0 | 1 | 2 | 3 | 4 }) {
  return (
    <span className="strip w-3.5" style={{ "--strip-h": "20px" } as CSSProperties}>
      <i className="c" data-s={state} />
    </span>
  );
}

/**
 * The four stages, in the order a raffle passes through them. The words are `PHASE_WORD`'s own, so
 * the key and the tag in the row's third column cannot say different things.
 */
const STAGE_KEY: { phase: Phase; body: string }[] = [
  { phase: "selling", body: "Tickets are still on sale. Buying one commits a secret nobody can read." },
  { phase: "revealing", body: "The sale has closed. Holders are publishing the secrets they committed." },
  { phase: "drawn", body: "The winners have been drawn from those secrets and a chain value." },
  {
    phase: "void",
    body: "Nobody published in time, so every ticket and bond went back to its holder and the deposit to the creator.",
  },
];

/**
 * THE KEY IS A PLATE, AND THAT IS WHAT BREAKS THE PAGE INTO SECTIONS.
 *
 * Measured before this existed: five sections on this route, every gap between them exactly
 * 0px, four of the five transparent on the same ground, and not one border on any of them. The
 * top 631px was the countdown, the key and the floor list running together as one surface with
 * three different jobs in it. The only break the page had was the record's inversion.
 *
 * A hairline would have been the cheap fix and it is the wrong one. Every row already carries
 * `border-bottom: 1px solid var(--rule)`, so a section separated by that same line makes the
 * page's strongest structural signal and its weakest identical, and the result reads as more
 * grid rather than as fewer sections. A section break has to be a different KIND of thing from
 * a row break.
 *
 * So it is a surface change, which is the device the landing uses to get eight legible
 * sections, and the surface is --panel-2, which is the row's own. No new material enters the
 * system: the key stops being more text on the ground and becomes an object sitting between
 * the hero and the list, which is what a legend is. One change buys both missing breaks, the
 * end of the countdown and the start of the floor.
 *
 * Full bleed, with a --rule edge top and bottom, because a plate inset from the gutter would
 * be a card, and a card is a thing you can open.
 */
function BoardKey() {
  return (
    <section
      aria-labelledby="board-key"
      className="grid gap-[clamp(26px,3.4vw,56px)] border-y border-rule bg-panel-2 px-gutter py-[clamp(26px,3.4vw,44px)] min-[860px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
    >
      <div>
        <h2 id="board-key" className="label text-fg-3">
          Reading this page
        </h2>
        <p className="mt-2.5 max-w-[46ch] text-lg text-fg-2">
          Every row below is one raffle, and the bar of blocks in it is that raffle&rsquo;s
          tickets, one block each.
        </p>

        <ul className="mt-[clamp(18px,2.2vw,26px)] flex flex-wrap gap-x-[clamp(16px,2vw,28px)] gap-y-3">
          {TICKET_KEY.map(({ state, word }) => (
            <li key={state} className="flex items-center gap-2.5">
              <span aria-hidden="true" className="flex items-center gap-1.5">
                <KeyCell state={state} />
                {/* The record's surface, painted: `.inv` remaps the roles, `bg-panel` paints them. */}
                <span className="inv flex bg-panel p-[3px]">
                  <KeyCell state={state} />
                </span>
              </span>
              <span className="text-sm text-fg-2">{word}</span>
            </li>
          ))}
        </ul>

        <p className="mt-3 max-w-[46ch] text-sm text-fg-3">
          Each block is shown twice: as the light rows draw it, and as the dark record does.
        </p>
      </div>

      <div>
        <h3 className="label text-fg-3">The four stages</h3>
        <dl className="mt-2.5 grid gap-x-[clamp(16px,2vw,28px)] gap-y-3.5 min-[560px]:grid-cols-2">
          {STAGE_KEY.map(({ phase, body }) => (
            <div key={phase}>
              <dt>
                <span className="phase-tag label" data-phase={phase}>
                  {PHASE_WORD[phase]}
                </span>
              </dt>
              <dd className="mt-2 max-w-[40ch] text-sm text-fg-3">{body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- the board */

/**
 * The record: everything that has already settled.
 *
 * It is `.inv`, and the inversion is the point rather than a style. A raffle that has left the
 * floor is evidence, and evidence in this product is printed on the dark surface the ceremony
 * ends on. The class remaps the roles; `bg-panel text-fg` is what paints them, because
 * app/globals.css defines `.inv` as a token block and deliberately never paints anything itself.
 */
function Record({ raffles }: { raffles: readonly Raffle[] }) {
  if (raffles.length === 0) return null;

  const drawn = raffles.filter((r) => r.phase === "drawn").length;
  const voided = raffles.filter((r) => r.phase === "void").length;

  const meta = [
    drawn > 0 ? `${drawn} drawn` : null,
    voided > 0 ? `${voided} void` : null,
    "audits from public data",
  ].filter(Boolean) as string[];

  return (
    <section aria-labelledby="board-record" className="inv bg-panel text-fg">
      <SectionHead
        id="board-record"
        title="The record"
        meta={meta}
        lead="Sample raffles that have already closed. Open one to see the secrets that were published, the seed they made, and who won."
        className="pt-[clamp(26px,3.4vw,44px)] pb-[clamp(16px,2vw,24px)]"
      />

      <ColumnHead />

      <div className="rows">
        {raffles.map((raffle) => (
          <BoardRow key={raffle.config.id} raffle={raffle} />
        ))}
      </div>
    </section>
  );
}

/**
 * The floor: everything still moving, in whatever order the reader asked for.
 *
 * The rows are rendered here, on the server, and handed to the island as nodes. What crosses into
 * the browser is three numbers per raffle and the markup; no `Raffle` is serialized, so no
 * commitment and no nonce is shipped to the client to make a button work.
 */
function Floor({ raffles }: { raffles: readonly Raffle[] }) {
  if (raffles.length === 0) return null;

  const sold = raffles.reduce((n, r) => n + summarize(r).sold, 0);
  const supply = raffles.reduce((n, r) => n + r.config.supply, 0);

  const rows: LiveRow[] = raffles.map((raffle) => {
    const s = summarize(raffle);
    return {
      id: raffle.config.id,
      deadline: Date.parse(activeDeadline(raffle)),
      pool: s.pool,
      supply: raffle.config.supply,
      node: <BoardRow raffle={raffle} />,
    };
  });

  return (
    <section aria-labelledby="board-floor">
      <SectionHead
        id="board-floor"
        title="On the floor"
        meta={[`${raffles.length} live`, `${sold} of ${supply} tickets gone`]}
        lead="Sample raffles still on the floor. Open one to see how buying a ticket and publishing its secret work; nothing there is signed or sent."
        className="pt-[clamp(26px,3.4vw,44px)] pb-[clamp(16px,2vw,24px)]"
      />

      <LiveRows rows={rows} head={<ColumnHead />} />
    </section>
  );
}

/**
 * A section head: what this block is on the left, what is in it on the right.
 *
 * One component for both blocks so the two lines cannot drift apart in weight, in case or in
 * rhythm. The meta segments are joined with a middle dot and each is `nowrap`, because the break
 * a reader least wants is the one inside "55 of 80".
 */
function SectionHead({
  id,
  title,
  meta,
  lead,
  className = "",
}: {
  id: string;
  title: string;
  meta: readonly string[];
  /**
   * One plain sentence saying what is in this block. "On the floor" and "The record" are this
   * product's own names for the two halves of the board and they are worth keeping, but neither
   * tells someone arriving for the first time whether they can still enter anything. The sentence
   * does, in words that need nothing explained first.
   */
  lead?: string;
  className?: string;
}) {
  return (
    <div className={`px-gutter ${className}`}>
      {/*
          THE HEAD IS A HEADING NOW, NOT A CAPTION.

          "On the floor" and "The record" were set in the same 11px uppercase label as the column
          names, the sort control and the meta line beside them, which made the two entry points of
          the page indistinguishable from its smallest furniture. A reader scrolling had nothing to
          land on between the countdown and the first row.

          --text-title in the serif is 34px at the cap, against a countdown that is about 200px, so
          it cannot compete with the monument and does not try to. The meta line stays at label
          size and drops to its own line under the heading, because a 34px serif and an 11px mono
          sharing a baseline is a pairing neither of them wins.
      */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
        <h2 id={id} className="m-0 font-serif text-title">
          {title}
        </h2>

        <p className="label text-fg-3">
          <MetaLine parts={meta} />
        </p>
      </div>

      {lead ? <p className="mt-3 max-w-[54ch] text-sm text-fg-2">{lead}</p> : null}
    </div>
  );
}

/**
 * THE COLUMN HEADER.
 *
 * Six words over the six columns of the rows below, drawn on the same grid by app/cell.css so the
 * widths cannot drift apart from the widths they label.
 *
 * `aria-hidden`, and that is deliberate rather than lazy. Every row below is one link carrying an
 * `aria-label` that already names the raffle, its phase, its ticket count and its pool as a
 * sentence, so a screen reader that also met six column names would hear them once and then hear
 * the same facts again, differently worded, on every row. The header is a visual aid for the one
 * reader who cannot hear the row's own sentence: someone looking at six unlabelled facts.
 *
 * It is not rendered inside `.rows`, because `.rows` is `overflow-x: clip` for the row's 4px open
 * gesture and the header neither moves nor needs clipping.
 */
function ColumnHead() {
  return (
    <div className="rowhead label" aria-hidden="true">
      <span className="a-serial">No.</span>
      <span className="a-title">Raffle</span>
      <span className="a-phase">Stage</span>
      <span className="a-strip">Tickets</span>
      <span className="a-pool">Pool</span>
      <span className="a-count">Closes</span>
    </div>
  );
}

/**
 * A run of short facts separated by a middle dot.
 *
 * THE SEPARATOR IS OUTSIDE THE `nowrap` SPAN, AND THAT IS THE WHOLE COMPONENT.
 * Written the obvious way, with the dot and the leading space inside the span that holds the
 * fact, `white-space: nowrap` also forbids the break at that leading space, so the line has no
 * legal break anywhere and becomes one unbreakable run. Measured at 390: the band's
 * "Raffle 0003 / 16 of 16 sold / 11 of 16 revealed" ran off the measure and lost its last four
 * glyphs to the section's overflow clip. Kept outside, the line breaks between facts and never
 * inside one, which is the rule that was wanted: nobody wants "55 of" on one line and "80" on
 * the next.
 */
function MetaLine({ parts }: { parts: readonly string[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={part}>
          {i > 0 ? <span aria-hidden="true"> {"·"} </span> : null}
          <span className="whitespace-nowrap">{part}</span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Nothing at all: no raffle has ever been deployed.
 *
 * A blank strip rather than an illustration. It is the same object the rest of the page is made
 * of, drawn with every cell unsold, which is a true picture of an empty board instead of a new
 * piece of vocabulary that appears in one state and nowhere else.
 */
function EmptyBoard() {
  return (
    <section className="px-gutter pt-[clamp(24px,4vw,56px)] pb-[clamp(24px,4vw,56px)]">
      <span
        aria-hidden="true"
        className="strip max-w-[26rem]"
        style={{ "--n": "24", "--strip-h": "22px" } as CSSProperties}
      >
        {Array.from({ length: 24 }, (_, i) => (
          <i key={i} className="c" data-s={0} />
        ))}
      </span>

      <p className="mt-6 max-w-[52ch] text-lg text-fg-2">
        No raffle has been deployed yet. The first one printed on this board will be the first row.
      </p>
    </section>
  );
}

export function Board({ raffles }: { raffles: readonly Raffle[] }) {
  /*
    Two lists and one ordering rule each, both settled on the server. The floor's order is the
    default the island starts from, so the first paint and the first hydration agree: soonest to
    close, first. The record runs newest first, which for a settled raffle is the id, because a
    raffle that settled later was deployed later.
  */
  const live = raffles
    .filter(isLive)
    .sort((a, b) => Date.parse(activeDeadline(a)) - Date.parse(activeDeadline(b)));

  /*
    The record runs by when each raffle actually settled, not by id. 0004 drew on 26 Jul and 0005
    voided on 22 Jul, so id order and settlement order disagree here, and the order a record wants
    is the one an auditor reads: most recent first. The id breaks a tie between two raffles whose
    reveal windows closed on the same instant.
  */
  const record = raffles
    .filter((r) => !isLive(r))
    .sort(
      (a, b) =>
        Date.parse(b.config.revealDeadline) - Date.parse(a.config.revealDeadline) ||
        b.config.id - a.config.id,
    );

  if (raffles.length === 0) return <EmptyBoard />;

  return (
    <>
      {/* The band names the soonest deadline of the raffles still moving. With nothing moving
          there is no next deadline, and an empty band is more honest than a zeroed one. */}
      {live[0] ? <NextDeadline raffle={live[0]} /> : null}
      <BoardKey />
      <Floor raffles={live} />
      <Record raffles={record} />
    </>
  );
}
