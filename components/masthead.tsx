import Link from "next/link";

import { WalletBar } from "./wallet-bar";

/**
 * One line, 56px, brand and navigation on the left and the chain on the right.
 *
 * On the landing page the bar is transparent and unpinned so the hero owns the top of the screen;
 * inside the app it sticks and carries a rule, because a tool needs its chrome anchored. Same
 * component, one prop, rather than two mastheads that drift apart.
 *
 * The nav is hidden below `sm` rather than collapsed into a hamburger. Four links behind a menu
 * button is worse than four links you can reach from the footer, which is one scroll away and lists
 * every destination anyway.
 */

const NAV = [
  { href: "/raffles", label: "Raffles" },
  { href: "/create", label: "Deploy" },
  { href: "/learn", label: "Learn" },
  { href: "/docs", label: "Docs" },
];

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
      <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-5 px-5">
        <Link href="/" className="shrink-0 text-base font-medium tracking-tight">
          Drawbook
        </Link>

        {!landing && (
          <>
            <span aria-hidden="true" className="hidden h-4 w-px bg-line sm:block" />
            <nav aria-label="Sections" className="hidden sm:block">
              <ul className="flex items-center gap-5 text-sm">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-text-2 transition-colors hover:text-text"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </>
        )}

        <div className="ml-auto flex items-center gap-5">
          {landing && (
            <nav aria-label="Sections" className="hidden md:block">
              <ul className="flex items-center gap-5 text-sm">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-text-2 transition-colors hover:text-text"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <WalletBar />
        </div>
      </div>
    </header>
  );
}
