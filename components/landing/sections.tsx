import type { ReactNode } from "react";

/**
 * THE LANDING'S SMALL FURNITURE: the section head, the stepper, the draw chain and the reactive
 * flow. Four compositions, all Server Components, all pure markup over app/story.css.
 *
 * WHY THEY SHARE A FILE. None of them holds state, none of them is reused off this route, and
 * each is under forty lines. Four files would be four imports and four headers restating the same
 * paragraph. The raffle card and the opening are separate because one is reused by two sections
 * and the other is the route's only island.
 *
 * NOT ONE STRING BELOW IS A QUANTITY. Every figure on this landing is computed in app/page.tsx by
 * reducing over lib/mock-raffles.ts and handed in. These components take copy and children.
 */

/* ------------------------------------------------------------------------ the section head */

export function SectionHead({
  title,
  lead,
  id,
  aside,
}: {
  title: string;
  lead?: string;
  id?: string;
  /** A figure line or a control, set against the title on a wide screen. */
  aside?: ReactNode;
}) {
  return (
    <div className="mb-[clamp(30px,4vw,56px)] flex flex-wrap items-end justify-between gap-[clamp(18px,3vw,44px)]">
      <div>
        <h2 id={id} className="m-0 max-w-[18ch] font-serif text-display">
          {title}
        </h2>
        {lead ? <p className="m-0 mt-4 max-w-[54ch] text-lg text-fg-2">{lead}</p> : null}
      </div>
      {aside}
    </div>
  );
}

/* ----------------------------------------------------------------------------- the stepper */

export interface Step {
  n: string;
  title: string;
  body: string;
}

/**
 * Commit, reveal, draw, in that order, because that is the order they happen in and each one is
 * only safe because of the one before it.
 *
 * Three columns joined by a rule on a wide screen and a vertical timeline on a narrow one. The
 * rule is a sibling of the steps rather than a border on them, so it passes behind all three and
 * under the dots that sit on it; app/story.css positions it off the numeral's own type step
 * rather than off a measured pixel.
 *
 * An ordered list, because the order is the argument. `role="list"` is not restored after the
 * marker is dropped, because `list-style: none` is not set here at all: the markers are absent
 * because `<ol>` inside this layout carries none from the preflight, and the semantics survive.
 */
export function Stepper({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="stepper m-0 list-none p-0">
      <span aria-hidden="true" className="stepper-rule" />
      {steps.map((step) => (
        <li key={step.n} className="step">
          <span className="monument block text-[clamp(2.75rem,5vw,4.25rem)] text-event">
            {step.n}
          </span>
          <span aria-hidden="true" className="step-dot" />
          <h3 className="m-0 mb-2.5 font-serif text-title">{step.title}</h3>
          <p className="m-0 max-w-[42ch] text-fg-2">{step.body}</p>
        </li>
      ))}
    </ol>
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
 * out, and who won.
 *
 * IT IS A SUMMARY OF THE CEREMONY BELOW IT AND IT CANNOT CONTRADICT IT, because every value in it
 * is derived in app/page.tsx from the same modules the ceremony derives from, at the same render.
 * There is no literal here and no hand-copied digest.
 *
 * `data-walk` is written by the ceremony's own replay when it runs, and only then. With no script
 * every link is at full strength, which is the state the server ships.
 */
export function DrawChain({ links }: { links: readonly ChainLink[] }) {
  return (
    <ol className="chain m-0 list-none p-0">
      {links.map((link, i) => (
        <li key={link.name} className="chain-link" data-step={i}>
          <span className="label text-fg-3">{link.name}</span>
          <span
            className={
              link.hex
                ? "digest text-[0.75rem] leading-[1.35] text-fg"
                : link.wide
                  ? "monument text-[clamp(1.125rem,1.6vw,1.5rem)] text-event"
                  : "monument text-[clamp(1.5rem,2.4vw,2.25rem)] text-event"
            }
          >
            {link.value}
          </span>
          <span className="text-sm text-fg-3">{link.note}</span>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------------------------- the flow */

export interface FlowStep {
  title: string;
  body: string;
}

/**
 * Reveal deadline, condition met, reactive transaction, draw executed.
 *
 * Four plates and three connectors, drawn in CSS rather than in an SVG: the rule against
 * hand-rolled SVG in this product has exactly one exception and it is the logo. A 1px rule with a
 * rotated square on its end is a connector made of the same material as every other boundary
 * here, and it inherits --bound with the block it sits in.
 *
 * The last plate is bounded in --event because it is the only one of the four that is an outcome
 * rather than a state, and that is the whole claim of the section.
 */
export function Flow({ steps }: { steps: readonly FlowStep[] }) {
  return (
    <ol className="m-0 grid list-none p-0">
      {steps.map((step, i) => (
        <li key={step.title} className="flow-step">
          <span className="serial text-sm">{step.title}</span>
          <span className="text-sm text-fg-3">{step.body}</span>
          {i < steps.length - 1 ? <span aria-hidden="true" className="flow-arrow" /> : null}
        </li>
      ))}
    </ol>
  );
}
