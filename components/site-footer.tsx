import Link from "next/link";

import { Wordmark } from "./logo";

/**
 * One footer for every route.
 *
 * Three columns of real destinations rather than a wall of links: the product, the writing about it,
 * and the chain it runs on. External links say where they go, because a link that leaves the site
 * without warning is a small betrayal of the reader.
 *
 * The disclosure about which parts are live and which are sample data is not here. It lives in the
 * Status section of /docs, where someone looking for it will actually be, rather than as a
 * paragraph of small print under every page.
 */

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "Raffles", href: "/raffles" },
      { label: "Deploy a raffle", href: "/create" },
    ],
  },
  {
    heading: "Read",
    links: [
      { label: "Learn", href: "/learn" },
      { label: "Docs", href: "/docs" },
    ],
  },
  {
    heading: "Rialo",
    links: [
      { label: "rialo.io", href: "https://rialo.io", external: true },
      { label: "Rialo docs", href: "https://rialo.io/docs", external: true },
      { label: "Rialo learn", href: "https://learn.rialo.io", external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-[1180px] px-5 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,0.6fr)]">
          <div>
            <Wordmark />
            <p className="mt-3 max-w-[38ch] text-sm text-text-2">
              On-chain raffles settled by a commit-reveal draw, so nobody picks the winner.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="label">{column.heading}</h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-sm text-text-2 transition-colors hover:text-text"
                      >
                        {link.label}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-text-2 transition-colors hover:text-text"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
    </footer>
  );
}
