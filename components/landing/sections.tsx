import type { ReactNode } from "react";

import { Reveal, Tilt } from "@/components/fx";

/**
 * THE LANDING'S SMALL FURNITURE: the section head, the How cards, the draw chain and the Rialo
 * timeline. Four compositions, all Server Components, all pure markup over app/story.css. The
 * only client code they render is <Reveal> and <Tilt> from components/fx.tsx, which a Server
 * Component may render with plain props.
 *
 * WHY THEY SHARE A FILE. None of them holds state, none of them is reused off this route, and
 * each is short. Four files would be four imports and four headers restating the same paragraph.
 * The raffle card and the opening are separate because one is reused by two sections and the
 * other is the route's only island.
 *
 * NOT ONE STRING BELOW IS A QUANTITY. Every figure on this landing is computed in app/page.tsx by
 * reducing over lib/mock-raffles.ts and handed in. These components take copy and children, and
 * the two digests the How cards may show are handed in the same way or not shown at all.
 *
 * WHAT MOVES, AND WHAT NEVER DOES. A head and a card rise once as they are scrolled to; a How
 * card leans toward a fine pointer; three wordless pictures in the How cards loop while they are
 * near the viewport, and so does a pulse down the timeline. None of that touches a strip, a blade,
 * a sheet or anything carrying a view-transition name, and under reduced motion none of it runs:
 * the pictures rest on their last frame and the timeline is drawn complete.
 */

/* ------------------------------------------------------------------------ the section head */

export function SectionHead({
  title,
  lead,
  id,
  aside,
  eyebrow,
}: {
  title: string;
  lead?: string;
  id?: string;
  /** A figure line or a control, set against the title on a wide screen. */
  aside?: ReactNode;
  /**
   * A label over the title, in the signal colour. Only for a section that already has a label of
   * its own to put here: this component invents none.
   */
  eyebrow?: string;
}) {
  return (
    <Reveal className="mb-[clamp(30px,4vw,56px)] flex flex-wrap items-end justify-between gap-[clamp(18px,3vw,44px)]">
      <div>
        {eyebrow ? (
          <p className="label m-0 mb-[18px] flex items-center gap-3 text-event">
            <span aria-hidden="true" className="h-px w-7 bg-event" />
            {eyebrow}
          </p>
        ) : null}
        <h2 id={id} className="m-0 max-w-[18ch] headline headline-ramp text-display">
          {title}
        </h2>
        {lead ? <p className="m-0 mt-5 max-w-[38em] text-lg text-fg-2">{lead}</p> : null}
      </div>
      {aside}
    </Reveal>
  );
}

/* --------------------------------------------------------------------------- the How cards */

export interface Step {
  n: string;
  title: string;
  body: string;
}

/**
 * Commit, reveal, draw, in that order, because that is the order they happen in and each one is
 * only safe because of the one before it.
 *
 * Three cards side by side from 980px and stacked under it. Each is an ordered list item, because
 * the order is the argument, and each leans toward a fine pointer through <Tilt>, inside a
 * <Reveal> that raises it once as it is scrolled to (the lean is the inner element's transform and
 * the rise is the outer one's, so neither overwrites the other).
 *
 * THE PICTURE AT THE FOOT OF EACH CARD HAS NO WORDS IN IT. A cell that fills (a ticket bought), a
 * cell whose apricot foot rises (a secret published), a strip whose coral cell lifts out (a winner
 * drawn). The copy above it is the approved STEPS and nothing else: this section deliberately says
 * neither "hash" nor "nonce", so the picture must not say them either. A digest may sit beside the
 * first two, but only raffle 0004's real commitment and nonce, handed in by the page; with neither
 * prop the picture is the cell alone. The pictures are aria-hidden: they illustrate the sentence,
 * they do not add to it.
 *
 * The numeral reads "01 / Commit" on the card, and only "01" to a screen reader, which hears the
 * title once from the heading under it.
 */
export function Stepper({
  steps,
  commitment,
  nonce,
}: {
  steps: readonly Step[];
  /** Raffle 0004's commitment for one ticket, 64 hex characters, shown beside the first picture. */
  commitment?: string;
  /** The nonce that ticket revealed, 32 hex characters, shown beside the second picture. */
  nonce?: string;
}) {
  return (
    <ol className="how m-0 list-none p-0">
      {steps.map((step, i) => (
        <Reveal as="li" key={step.n} className="min-w-0" delay={i * 50}>
          <Tilt
            max={8}
            glare
            className="how-card card flex h-full flex-col rounded-panel p-[26px] min-[980px]:min-h-[440px]"
          >
            <span className="label text-fg-3">
              {step.n}
              <span aria-hidden="true"> / {step.title}</span>
            </span>
            <h3 className="m-0 mt-2 mb-3 headline-sub text-title">{step.title}</h3>
            <p className="m-0 text-base text-fg-2">{step.body}</p>
            <HowPicture kind={i} hex={i === 0 ? commitment : i === 1 ? nonce : undefined} />
          </Tilt>
        </Reveal>
      ))}
    </ol>
  );
}

/** Digests are broken into 16-character lines, the width the picture's well holds. */
function hexLines(hex: string): string[] {
  return hex.match(/.{1,16}/g) ?? [];
}

function HowPicture({ kind, hex }: { kind: number; hex?: string }) {
  return (
    <div aria-hidden="true" className="how-vis">
      {kind === 2 ? (
        <span className="how-strip">
          {Array.from({ length: 7 }, (_, k) => (
            <i key={k} data-k={k === 4 ? "" : undefined} />
          ))}
        </span>
      ) : (
        <>
          <span className="how-cell" data-kind={kind === 0 ? "fill" : "band"} />
          {hex ? (
            <span className="digest min-w-0 text-[10px] leading-[1.55] text-fg-3">
              {hexLines(hex).map((line, k) => (
                <span key={k} className={`block ${k === 0 ? "text-fg" : ""}`}>
                  {line}
                </span>
              ))}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------- the draw chain */

export interface ChainLink {
  /** What this stage of the draw is. Recedes. */
  name: string;
  /** The value that came out of it. Dominates. */
  value: string;
  /** True when the value is a digest, which is set narrow and allowed to break. */
  hex?: boolean;
  /**
   * True when the value is a phrase rather than a figure. The monument step is drawn for four or
   * five glyphs; "18 nonces" is nine and breaks over two lines in a fifth of the measure, which
   * reads as a mistake beside four links that do not. One step down and it holds one line.
   */
  wide?: boolean;
  /** Why it matters, in one sentence. */
  note: string;
}

/**
 * The draw as five links: what was revealed, what was published, what the chain added, what came
 * out, and who won. One card, five cells: a row of five from 900px, a column under it.
 *
 * IT IS A SUMMARY OF THE CEREMONY BELOW IT AND IT CANNOT CONTRADICT IT, because every value in it
 * is derived in app/page.tsx from the same modules the ceremony derives from, at the same render.
 * There is no literal here and no hand-copied digest.
 *
 * THE WALK. The landing's draw scene writes `data-walk` on the list and `data-on` on the link of
 * the beat it is showing. The active link then takes an apricot rule down its left edge and full
 * ink, and every other link drops to --fg-3 (app/story.css). Dimmed by colour, never by opacity,
 * so a dimmed link still reads at 4.5:1 or better. With no script, under reduced motion, or before
 * the scene runs, there are no attributes and every link is at full strength, which is the state
 * the server ships.
 */
export function DrawChain({ links }: { links: readonly ChainLink[] }) {
  return (
    <ol className="chain card m-0 list-none rounded-panel p-0">
      {links.map((link, i) => (
        <li key={link.name} className="chain-link" data-step={i}>
          <span className="chain-n label text-fg-3">{link.name}</span>
          <span
            className={
              link.hex
                ? "chain-v digest text-[0.75rem] leading-[1.35] text-fg"
                : link.wide
                  ? "chain-v monument text-[clamp(1.125rem,1.6vw,1.5rem)] text-event"
                  : "chain-v monument text-[clamp(1.5rem,2.4vw,2.25rem)] text-event"
            }
          >
            {link.value}
          </span>
          <span className="chain-note text-sm text-fg-3">{link.note}</span>
        </li>
      ))}
    </ol>
  );
}

/* --------------------------------------------------------------------- the Rialo timeline */

export interface FlowStep {
  title: string;
  body: string;
}

/**
 * Reveal deadline, condition met, reactive transaction, draw executed: the four plates, as a
 * timeline.
 *
 * A 2px track down the left with a fill drawn over it in the meter ramp, and a node on the track
 * for each plate. All of it is CSS on four list items, not an SVG: the rule against hand-rolled
 * SVG in this product has exactly one exception and it is the logo.
 *
 * THE FILL FOLLOWS THE SCROLL, AND ONLY WHERE THAT IS FREE. Where the browser has view timelines
 * and motion is welcome, the fill's tip sits on a line 60% down the viewport and each node lights
 * as the tip reaches it (app/story.css, no script). Anywhere else the timeline is drawn complete:
 * every node lit and the fill full, which is the true state of the diagram, since every plate on
 * it has happened on testnet.
 *
 * The fourth plate is the key node, in the second apricot, because it is the only one of the four
 * that is an outcome rather than a state, and that is the whole claim of the section. It is never
 * coral: coral is a winner, and nobody has won anything at the moment the draw is sent.
 *
 * The pulse that travels down the track is the one loop here, one of the few the product allows,
 * and it only runs while the timeline is near the viewport.
 */
export function Flow({ steps }: { steps: readonly FlowStep[] }) {
  return (
    <div className="tl-wrap">
      {/* The rail is only a box for the pulse to be skipped in while the timeline is off screen;
          app/story.css says why. */}
      <span aria-hidden="true" className="tl-rail">
        <span className="tl-pulse" />
      </span>
      <ol className="tl m-0 list-none p-0">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="tl-step"
            data-key={i === steps.length - 1 ? "" : undefined}
          >
            <span aria-hidden="true" className="tl-node">
              <i />
            </span>
            <span className="block headline-sub text-title">{step.title}</span>
            <span className="mt-1.5 block max-w-[32em] text-base text-fg-2">{step.body}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
