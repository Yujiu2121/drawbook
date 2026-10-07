"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * THE DESTINATIONS, in the masthead and in the drawer, in the label voice.
 *
 * THREE PRIMARY ITEMS AND ONE SECONDARY, WHICH IS A CUT FROM FOUR EQUALS. The bar used to carry
 * Raffles, Deploy, Learn and Docs at the same weight, which asks a first-time reader to choose
 * between four things before they know what any of them are. It now carries what someone landing
 * cold needs, in the order they need it: the product, the explanation, the reference. Deploying a
 * raffle is a thing you do after all three, so it keeps its route, keeps its place in the bar, and
 * stops competing for attention with them.
 *
 * NO ROUTE WAS DROPPED AND NO LINK CHANGED TARGET. `/learn` is the explanation, so it is what "How
 * it works" points at rather than at the landing's own anchor: a nav item that scrolls on one page
 * and navigates on every other is two different controls wearing one label.
 *
 * THIS IS A CLIENT ISLAND FOR EXACTLY ONE REASON: `usePathname()`. Nothing else here has state,
 * nothing fetches, nothing measures. The masthead around it stays a Server Component and hands
 * this in as one child, which is the repo's own pattern.
 *
 * WHY THE CURRENT ITEM CARRIES A RULE AND NOT JUST A SURFACE. Card on ground computes to 1.09:1.
 * That is a real surface in the material model and the right material, but it is nowhere near the
 * 3:1 a non-text indicator needs to be found, so on its own it would leave the current section
 * legible only to a screen reader. The 1px --event rule along the base of the plate is the cue
 * that carries the weight: 7.05:1 on the page, and it is a rule rather than a glow, so it costs
 * the material model nothing. The surface stays underneath it because two quiet cues read better
 * than one loud one.
 *
 * The text does a third of the work on its own: --fg-2 at 7.60:1 for the sections you are not in,
 * --fg at 15.01:1 for the one you are.
 */

export interface Destination {
  href: string;
  label: string;
  /** A route that belongs to this section without sharing its prefix. */
  also?: RegExp;
}

export const NAV: Destination[] = [
  // A raffle's detail page is still the Raffles section, and `/raffle/5` does not begin with
  // `/raffles/`, so the one relationship in the product that a prefix test would miss is named.
  // `/r/<address>` is a raffle that lives on chain, listed on the same board, so it is named too.
  { href: "/raffles", label: "Raffles", also: /^\/(raffle|r)\// },
  { href: "/learn", label: "How it works" },
  { href: "/docs", label: "Docs" },
];

/** Reachable everywhere, and never at the same weight as the three above. */
export const SECONDARY: Destination = { href: "/create", label: "Deploy a raffle" };

export function useCurrent(): (d: Destination) => boolean {
  const pathname = usePathname();
  return (d) => pathname === d.href || (d.also?.test(pathname) ?? false);
}

export function NavLinks({ className = "" }: { className?: string }) {
  const isCurrent = useCurrent();

  return (
    <nav aria-label="Sections" className={className}>
      <ul className="flex items-center gap-0.5">
        {NAV.map((d) => {
          const current = isCurrent(d);

          return (
            <li key={d.href}>
              <Link
                href={d.href}
                aria-current={current ? "page" : undefined}
                className={`label relative block px-2.5 py-2.5 transition-colors duration-[var(--t-open)] ease-settle ${
                  current ? "bg-panel-2 text-fg" : "text-fg-2 hover:text-fg"
                }`}
              >
                {d.label}
                {current ? (
                  <span aria-hidden="true" className="absolute inset-x-0 bottom-0 block h-px bg-event" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The secondary destination, on its own, for the wide bar. */
export function DeployLink() {
  const isCurrent = useCurrent();
  const current = isCurrent(SECONDARY);

  return (
    <Link
      href={SECONDARY.href}
      aria-current={current ? "page" : undefined}
      className={`label shrink-0 transition-colors duration-[var(--t-open)] ease-settle ${
        current ? "text-fg" : "text-fg-3 hover:text-fg"
      }`}
    >
      {SECONDARY.label}
    </Link>
  );
}
