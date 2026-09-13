/**
 * The ticket, as an object.
 *
 * This is the load-bearing component of the Counterfoil system and the only place in the app that
 * is allowed to draw one. The object vocabulary is deliberately tiny: a ticket, its two halves, and
 * the drum slit. Nothing else. A third object class is how this direction turns into kitsch, so the
 * rule is enforced here rather than left to taste.
 *
 * THE HALVES ARE NOT INTERCHANGEABLE, and getting them round the right way is the whole argument
 * for the metaphor:
 *
 *   drum half  ->  carries the COMMITMENT. Public, filed on chain, verifiable by anyone.
 *   hand half  ->  carries the NONCE. The one secret in the scheme, and yours until you reveal.
 *
 * In a real raffle book the counterfoil goes into the drum and the buyer keeps the other half, so
 * the physical referent and the cryptography agree. Printing the commitment on the keepsake would
 * teach commit-reveal backwards, which is worse than not using the metaphor at all.
 *
 * PLACEMENT RULE: a ticket may only ever sit directly on the room, never nested inside a plate. The
 * notches are opaque room-coloured discs rather than a CSS mask, because a mask would clip the card
 * shadow away (see `.notch` in globals.css). Discs are invisible against the room and wrong against
 * anything else.
 */

import type { CSSProperties, ReactNode } from "react";

/** Small caps print on card stock. Always full ink, never on the shaded half. */
export function Furniture({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={`furniture block ${className}`}>{children}</span>;
}

/** De-emphasised print: what a line of small type on a ticket says about itself. */
export function Print({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={`mt-1 text-xs text-ink-2 ${className}`}>{children}</p>;
}

/** The struck serial. Monospaced, because a numbering machine has one width of digit. */
export function Serial({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`tnum block text-[1.75rem] leading-none tracking-[-0.03em] ${className}`}>
      {children}
    </span>
  );
}

/**
 * A digest printed on stock.
 *
 * Wrapped rather than truncated, because the point of showing a commitment on a ticket is that it
 * is the whole verifiable string. A shortened digest is a decoration of a digest.
 */
export function Digest({ value, className = "" }: { value: string; className?: string }) {
  return (
    <p className={`tnum mt-2 text-[10px] leading-relaxed break-all text-ink ${className}`}>
      {value}
    </p>
  );
}

/**
 * One face of card stock.
 *
 * `shaded` renders the stub side, which is a fold away from the lamp. Nothing but full ink may be
 * printed on it: --ink-2 measures 4.13:1 there and fails AA, which is the one contrast in this
 * system with no headroom at all.
 */
export function Ticket({
  children,
  className = "",
  style,
  shaded = false,
  torn = false,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  shaded?: boolean;
  /** Torn from its counterfoil: ragged left edge, shadow moved to the wrapper. */
  torn?: boolean;
}) {
  const card = (
    <div
      className={`stock relative ${shaded ? "bg-stock-2" : ""} ${torn ? "torn pl-7" : ""} ${className}`}
      style={style}
    >
      {children}
    </div>
  );

  return torn ? <div className="torn-hold">{card}</div> : card;
}

/**
 * The specimen: both halves still joined at the perforation.
 *
 * Used wherever the scheme itself is the subject rather than one raffle, which is the landing hero
 * and the reveal explainer. Once a ticket has been bought the halves are apart by definition, so a
 * joined ticket is always teaching, never reporting state.
 */
export function Counterfoil({
  drum,
  hand,
  className = "",
  /** Width of the hand half. The drum half takes the rest. */
  handWidth = "40%",
}: {
  drum: ReactNode;
  hand: ReactNode;
  className?: string;
  handWidth?: string;
}) {
  return (
    <div
      className={`stock relative grid ${className}`}
      style={{ gridTemplateColumns: `1fr 1px ${handWidth}` }}
    >
      <div className="min-w-0 px-5 py-4">{drum}</div>

      {/* The perforation column is 1px wide and positioned, so the bites hang off it either side. */}
      <div className="perf relative">
        <span className="notch" style={{ top: "-6.5px", left: "-6px" }} aria-hidden="true" />
        <span className="notch" style={{ bottom: "-6.5px", left: "-6px" }} aria-hidden="true" />
      </div>

      <div className="min-w-0 rounded-r-ticket bg-stock-2 px-5 py-4">{hand}</div>
    </div>
  );
}

/**
 * The drum slit: a narrow lit window with sold serials behind it.
 *
 * The single looping animation in the app runs here and only while a raffle is selling, so movement
 * in the slit means tickets can still be bought. That is the exact claim the old ticket-bar sweep
 * made, now made by machinery instead of by a gradient.
 *
 * The reel is rendered twice, back to back, so the loop can translate by exactly one pass and land
 * where it started with no visible seam.
 */
export function DrumSlit({
  serials,
  live,
  height = 176,
  className = "",
}: {
  /** Sold ticket indices, in order. */
  serials: number[];
  /** True while the sale is open. The only state the reel moves in. */
  live: boolean;
  height?: number;
  className?: string;
}) {
  const ROW = 32;
  const span = serials.length * ROW;
  const reel = [...serials, ...serials];

  return (
    <div className={className}>
      <div
        className="relative overflow-hidden border border-line bg-[#0b090d]"
        style={{
          height,
          boxShadow:
            "inset 0 10px 18px -8px rgb(0 0 0 / .95), inset 0 -10px 18px -8px rgb(0 0 0 / .95)",
        }}
        role="img"
        aria-label={
          live
            ? `Drum holding ${serials.length} sold tickets, still turning`
            : `Drum holding ${serials.length} sold tickets, at rest`
        }
      >
        <div
          className={live ? "drum-live" : ""}
          style={
            {
              "--drum-span": `${span}px`,
              "--drum-duration": `${Math.max(14, serials.length * 1.1)}s`,
            } as CSSProperties
          }
        >
          {reel.map((index, i) => (
            <div
              key={`${index}-${i}`}
              className="tnum text-center text-[1.05rem] tracking-[-0.02em] text-text-2"
              style={{ height: ROW, lineHeight: `${ROW}px` }}
            >
              {String(index).padStart(4, "0")}
            </div>
          ))}
        </div>

        {/* The gate: where a serial comes to rest when the drum stops. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 border-y border-line-2"
          style={{ height: ROW }}
        />
      </div>
    </div>
  );
}
