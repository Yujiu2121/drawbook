import Link from "next/link";

import { Wordmark } from "./logo";
import { WalletBar } from "./wallet-bar";

/**
 * One line, 56px.
 *
 * The landing page centres the navigation; the app keeps it beside the brand. The difference is
 * deliberate: a landing page is a front door and the links are its subject, while inside the app the
 * links are chrome and belong out of the way, tucked against the wordmark.
 *
 * Centring uses a three-column grid, not flex with auto margins. The brand is about 90px and the
 * wallet bar is nearer 300px, so centring the nav in the space *between* them would sit it visibly
 * off the page axis. `1fr auto 1fr` gives the two sides equal weight and puts the nav on the true
 * centre line regardless of what either side grows to.
 *
 * The nav is hidden below `sm` rather than collapsed into a hamburger. Four links behind a menu
 * button is worse than four links in the footer, which is one scroll away and lists every
 * destination anyway.
 */

const NAV = [
  { href: "/raffles", label: "Raffles" },
  { href: "/create", label: "Deploy" },
  { href: "/learn", label: "Learn" },
  { href: "/docs", label: "Docs" },
];

function Nav({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Sections" className={className}>
      <ul className="flex items-center gap-5 text-sm">
        {NAV.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="text-text-2 transition-colors hover:text-text">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Masthead({ variant = "app" }: { variant?: "app" | "landing" }) {
  const landing = variant === "landing";

  return (
    <header
      className={
        landing
          ? "absolute inset-x-0 top-0 z-40"
          : "sticky top-0 z-40 border-b border-line-2 bg-page/95 backdrop-blur-[2px]"
      }
    >
      {landing ? (
        <div className="mx-auto grid h-14 max-w-[1180px] grid-cols-[1fr_auto_1fr] items-center gap-5 px-5">
          <Wordmark className="justify-self-start" />

          <Nav className="hidden justify-self-center sm:block" />

          <div className="justify-self-end">
            <WalletBar />
          </div>
        </div>
      ) : (
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-5 px-5">
          <Wordmark className="shrink-0" />
          <span aria-hidden="true" className="hidden h-4 w-px bg-line sm:block" />
          <Nav className="hidden sm:block" />
          <div className="ml-auto">
            <WalletBar />
          </div>
        </div>
      )}
    </header>
  );
}
