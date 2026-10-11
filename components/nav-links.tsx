"use client";

import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";

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
 * THIS IS A CLIENT ISLAND FOR EXACTLY ONE REASON: knowing which page it is on (`useRenderedPath`
 * below). Nothing else here has state, nothing fetches, nothing measures. The masthead around it
 * stays a Server Component and hands this in as one child, which is the repo's own pattern.
 *
 * WHY THE CURRENT ITEM CARRIES A FOOT BAND AND NOT JUST A SURFACE. Each item is a pill on the
 * masthead glass, tinted with the line colour at 8% under the pointer and 10% when it is the page
 * you are on. That tint is the right material and nowhere near the 3:1 a non-text indicator needs,
 * so on its own it would leave the current section legible only to a screen reader. The cue that
 * carries the weight is a short apricot band, 12px by 2px, centred at the foot of the pill: --event
 * at 13.45 on the glass. It is the same foot band a revealed ticket wears, which is what "you are
 * here" means in a product made of tickets. Never coral: coral is a winner, and a page you are on
 * has not won anything.
 *
 * The text does a third of the work on its own: --fg-2 at 8.95 on the glass (7.87 at worst, over
 * the drum's apricot band on the landing) for the sections you are not in, --fg at 15.12 for the
 * one you are.
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

/**
 * THE PATH OF THE PAGE THAT WAS RENDERED, WHICH ON A 404 IS NOT THE ADDRESS IN THE BAR.
 *
 * Every miss, `/nope` and `/raffle/99` alike, is answered with one document: the not-found page,
 * prerendered once at build time for the path "/_not-found" (`dynamicParams = false` on
 * /raffle/[id] sends unknown ids there too). In the browser `usePathname()` reads the address bar,
 * so on `/raffle/99` it said "/raffle/99" over a shell the server had rendered for "/_not-found".
 * The Raffles item came out current on the client and plain in the HTML, the back arrow came out
 * present on the client and absent in the HTML, and React threw hydration error #418 on every miss
 * under /raffle/ and /r/. A miss such as `/nope` names no section, which is why it stayed clean.
 *
 * The selected segments are read from the route tree the server rendered with, so the server and
 * the first client render agree by construction. On the not-found page they are ["/_not-found"],
 * which names no section and no raffle, as the server decided. Everywhere else they spell the
 * pathname, because this app has no route groups and no parallel routes to make them differ.
 */
export function useRenderedPath(): string {
  return `/${useSelectedLayoutSegments().join("/")}`;
}

export function useCurrent(): (d: Destination) => boolean {
  const path = useRenderedPath();
  return (d) => path === d.href || (d.also?.test(path) ?? false);
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
                className={`label relative block rounded-pill px-2.5 py-2.5 transition-colors duration-[var(--t-open)] ease-settle ${
                  current
                    ? "bg-[rgba(var(--line-rgb),.10)] text-fg"
                    : "text-fg-2 hover:bg-[rgba(var(--line-rgb),.08)] hover:text-fg"
                }`}
              >
                {d.label}
                {current ? <FootTick /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The current-page cue: a 12px apricot band at the foot of the item. Positioned against the item,
 * which is `relative`: centred under a bar link by default, 7px under its label. The menu's rows in
 * components/mobile-nav.tsx are as wide as the menu, so they place it under the start of the label
 * instead, where the eye already is.
 */
export function FootTick({ place = "bottom-[3px] left-[calc(50%-6px)]" }: { place?: string }) {
  return <span aria-hidden="true" className={`absolute block h-[2px] w-3 rounded-pill bg-event ${place}`} />;
}

/**
 * The secondary destination, on its own, for the wide bar: a ghost pill, bounded by a hairline and
 * printed in --fg-2, so it reads as a place to go without competing with the filled call to action
 * beside it. Its box is the label line plus py-2 and the border, the same height as the primary.
 */
export function DeployLink() {
  const isCurrent = useCurrent();
  const current = isCurrent(SECONDARY);

  return (
    <Link
      href={SECONDARY.href}
      aria-current={current ? "page" : undefined}
      className={`label relative block shrink-0 rounded-pill border border-rule px-3 py-2 transition-colors duration-[var(--t-open)] ease-settle ${
        current
          ? "bg-[rgba(var(--line-rgb),.10)] text-fg"
          : "text-fg-2 hover:bg-[rgba(var(--line-rgb),.08)] hover:text-fg"
      }`}
    >
      {SECONDARY.label}
      {current ? <FootTick /> : null}
    </Link>
  );
}
