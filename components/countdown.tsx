"use client";

/**
 * THE COUNTDOWN.
 *
 * The only figure in Drawbook that moves on its own, and the only reason any of this is a Client
 * Component. Everything around it, the row, the band, the blade, is rendered on the server and
 * this island is dropped into the slot the server left.
 *
 * THREE RULES, ALL OF THEM LOAD BEARING
 *
 * 1. THE FIGURE IS REPLACED, NEVER TRANSITIONED. No easing, no roll, no `@number-flow/react`.
 *    A countdown that eases lies about when it hit zero, and in this product a rolling figure is
 *    a signal with a meaning: it came off the chain. The three odometers are the block height,
 *    the wallet balance and the faucet result, and a deadline is not one of them.
 *
 * 2. A RAFFLE THAT HAS STOPPED MOVING SUBSCRIBES TO NOTHING. Drawn and void render an absolute
 *    UTC stamp and hold still, which is both the truth about them and the reason a settled route
 *    costs zero animation frames. That branch is a different component rather than a condition
 *    inside one, so the hook is never conditional and the still case never touches the clock.
 *
 * 3. SERVER AND FIRST HYDRATION RENDER ARE BYTE IDENTICAL. `lib/clock.ts` publishes 0 from both
 *    `getServerSnapshot` and `getSnapshot` until `subscribe` first runs, and React runs subscribe
 *    after the hydration commit. So the string in the static HTML is the string React builds when
 *    it hydrates, no matter how long the document sat in the network before it woke up.
 *
 * WHAT THE CALLER PASSES
 * Two values, both already exported by `lib/cell.ts` and both cheap: `activeDeadline(raffle)` and
 * `isLive(raffle)`. Deliberately not the raffle itself. Props to a client island are serialized
 * into the flight payload, and a Raffle carries its whole ticket table, so handing five of them
 * to five rows would ship every commitment and every nonce in the product to the browser to print
 * ten characters.
 *
 * WHAT THE CALLER READS BACK
 * `data-tier` on the element, one of coarse, clock, final, closed, dead. It is how a surface
 * styles its own alarm state without a second copy of the clock: the monument takes its alarm
 * size from `[data-tier="final"]`, and a sibling eyebrow swaps on `:has([data-tier="final"])`.
 * A function prop would be the React way to do this and is not available here, because a
 * function cannot cross the server boundary.
 *
 * The width reservation rides along, so no caller can forget it. See COUNTDOWN_RESERVE in
 * lib/cell.ts: raffle 0001 reads `3d 03h` and crosses to `HH:MM:SS` after about 27 hours of an
 * open tab, two glyphs wider, and an unreserved figure would shunt its whole row sideways at the
 * moment a reader is watching it.
 */

import type { CSSProperties } from "react";
import { useSyncExternalStore } from "react";

import type { CountdownTier } from "@/lib/cell";
import {
  COUNTDOWN_RESERVE,
  countdownLadder,
  countdownTier,
  utcShort,
  utcStamp,
} from "@/lib/cell";
import { getServerSnapshot, getSnapshot, secondsUntil, subscribe } from "@/lib/clock";

/**
 * `min-width` only bites on a box and `<time>` is inline, so the reservation would be silently
 * inert without this. `display` is the one property added to the shared reserve, and it is added
 * here rather than in lib/cell.ts because it is a fact about this element, not about the figure.
 */
const RESERVE: CSSProperties = { ...COUNTDOWN_RESERVE, display: "inline-block" };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Whole seconds left, recomputed on every published second and on nothing else. */
function useSecondsLeft(deadline: string): number {
  const elapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return secondsUntil(deadline, elapsed);
}

/* ------------------------------------------------------------------- the figure */

export interface CountdownProps {
  /** ISO instant to count toward. Pass `activeDeadline(raffle)` from lib/cell.ts. */
  deadline: string;
  /** Pass `isLive(raffle)`. False for drawn and void: the figure becomes a stamp and holds still. */
  live?: boolean;
  /** The still form. "short" is `30 Jul 09:00` for a dense column, "full" adds the year and UTC. */
  stamp?: "short" | "full";
  className?: string;
}

/**
 * The ladder, or the stamp. One element either way, so a grid cell holding it never has to care
 * which raffle it got.
 */
export function Countdown({ deadline, live = true, stamp = "short", className }: CountdownProps) {
  if (!live) {
    return (
      <time className={className} style={RESERVE} dateTime={deadline} data-tier="dead">
        {stamp === "full" ? utcStamp(deadline) : utcShort(deadline)}
      </time>
    );
  }
  return <Ticking deadline={deadline} className={className} />;
}

function Ticking({ deadline, className }: { deadline: string; className?: string }) {
  const left = useSecondsLeft(deadline);
  return (
    <time
      className={className}
      style={RESERVE}
      dateTime={deadline}
      data-tier={countdownTier(left)}
    >
      {countdownLadder(left)}
    </time>
  );
}

/* -------------------------------------------------------------------- the meters */

/**
 * THE TWO COUNTDOWN METERS, the sub-hands of the same clock.
 *
 * The geometry, the tracks and the subgrid all live in app/cell.css under THE TWO COUNTDOWN
 * METERS. All this does is publish `--p`, the 0 to 1 fill each track reads through
 * `transform: scaleX(var(--p, 1))`. A composited transform per tick, never a width, and never a
 * transition: the same argument as the figure above, since a meter that eases arrives at empty
 * after the deadline it is measuring.
 *
 * The hour meter is quantised to the minute, as its own note in cell.css requires. Continuous,
 * it drains about a third of a pixel a second, which is motion nobody can see attached to a
 * number nobody can read; quantised, it steps one sixtieth of its width once a minute and agrees
 * exactly with the figure printed beside it.
 *
 * Each figure names the meter's own remaining, not the raffle's: the hour track is an hour long
 * and the minute track a minute, so above 48 hours the pair reads as the second hand of a clock
 * whose hour hand is the monument. A surface that does not want that reading can hide the block
 * on `[data-tier="coarse"]`, which is why the tier is published here too.
 */
export function CountdownRules({ deadline, live = true }: { deadline: string; live?: boolean }) {
  // A raffle off the floor has no hour and no minute to spend, so both meters read empty and the
  // tier says "dead" rather than "closed": closed is a deadline that ran out under a reader, dead
  // is a raffle that was settled days ago. The figure above it makes the same distinction.
  if (!live) return <Tracks left={0} tier="dead" />;
  return <TickingRules deadline={deadline} />;
}

function TickingRules({ deadline }: { deadline: string }) {
  const left = useSecondsLeft(deadline);
  return <Tracks left={left} tier={countdownTier(left)} />;
}

function Tracks({ left, tier }: { left: number; tier: CountdownTier | "dead" }) {
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;
  return (
    <div className="rules" data-tier={tier}>
      <div className="ruleline">
        <div className="hourrule">
          <i style={{ "--p": (minutes / 60).toFixed(4) } as CSSProperties} />
        </div>
        <div className="rulefig label">
          <b className="label-b">{pad2(minutes)}</b> min left
        </div>
      </div>
      <div className="ruleline">
        <div className="minrule">
          <i style={{ "--p": (seconds / 60).toFixed(4) } as CSSProperties} />
        </div>
        <div className="rulefig label">
          <b className="label-b">{pad2(seconds)}</b> sec left
        </div>
      </div>
    </div>
  );
}
