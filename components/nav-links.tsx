"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The four destinations, in the masthead, in the label voice.
 *
 * This is a client island for exactly one reason: `usePathname()`. Nothing else here has state,
 * nothing fetches, nothing measures. The masthead around it stays a Server Component and hands this
 * in as one child, which is the repo's own pattern.
 *
 * WHY THE CURRENT ITEM CARRIES A RULE AND NOT JUST A SURFACE
 * The preview marks its current route with `background: var(--card)` alone. Computed against the
 * page, card on ground is 1.09:1. That is a real surface in the material model and it is the right
 * material, but it is nowhere near the 3:1 a non-text indicator needs to be found, so on its own it
 * would leave the current section legible only to a screen reader. The 1px `--event` rule along the
 * base of the plate is the cue that carries the weight: 7.05:1 on the page, and it is a rule rather
 * than a glow, so it costs the material model nothing. The surface stays underneath it because it
 * is what the preview does and because two quiet cues read better than one loud one.
 *
 * The text does a third of the work on its own: --fg-2 at 7.60:1 for the sections you are not in,
 * --fg at 15.01:1 for the one you are.
 */

const NAV: { href: string; label: string; also?: RegExp }[] = [
  // A raffle's detail page is still the Raffles section, and `/raffle/5` does not begin with
  // `/raffles/`, so the one relationship in the product that a prefix test would miss is named.
  { href: "/raffles", label: "Raffles", also: /^\/raffle\// },
  { href: "/create", label: "Deploy" },
  { href: "/learn", label: "Learn" },
  { href: "/docs", label: "Docs" },
];

export function NavLinks({ className = "" }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className={className}>
      <ul className="flex items-center gap-0.5">
        {NAV.map(({ href, label, also }) => {
          const current = pathname === href || (also?.test(pathname) ?? false);

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={`label relative block px-2.5 py-2.5 transition-colors duration-[var(--t-open)] ease-settle ${
                  current ? "bg-panel-2 text-fg" : "text-fg-2 hover:text-fg"
                }`}
              >
                {label}
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
