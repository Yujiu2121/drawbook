import Link from "next/link";
import { DiscordLogo, XLogo } from "@phosphor-icons/react/dist/ssr";

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
    /*
      Rialo's channels, under Rialo's heading.

      Drawbook has no accounts of its own, and an unlabelled row of social icons in a footer is read
      by everyone as "follow us". Sitting these under the column already headed Rialo makes the
      ownership obvious without a disclaimer, which is why they are here rather than in a bottom bar.

      GitHub is deliberately absent. Rialo's own homepage links github.com/rialo, which belongs to an
      unrelated account registered in 2015 whose only repository is a tutorial last touched in 2016.
      The real one, SubzeroLabs/rialo, is private. Verified 2026-08-12; worth re-checking rather than
      assuming it stays wrong.
    */
    social: [
      { label: "Rialo on X", href: "https://x.com/RialoHQ", Icon: XLogo },
      { label: "Rialo on Discord", href: "https://discord.gg/RialoProtocol", Icon: DiscordLogo },
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

              {/*
                An 18px glyph is an 18px tap target, which is less than half what a thumb needs. The
                padding grows each target to 34px without moving the glyph: the negative left margin
                pulls the row back into line with the text links above it, and the top margin is
                reduced by the same 8px the padding adds.
              */}
              {column.social && (
                <ul className="-ml-2 mt-3 flex items-center gap-5">
                  {column.social.map(({ label, href, Icon }) => (
                    <li key={href}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="block p-2 text-text-3 transition-colors hover:text-text"
                      >
                        {/*
                          Filled rather than the outline weight used elsewhere. XLogo is a solid
                          letterform at every weight, so at `regular` it sits beside an outlined
                          Discord and reads a full step heavier than it. Filling both evens them out
                          and matches how the brands actually draw their marks, which is also simply
                          more legible at 18px than a hairline glyph.
                        */}
                        <Icon size={18} weight="fill" aria-hidden="true" />
                        <span className="sr-only">{label} (opens in a new tab)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </nav>
          ))}
        </div>
      </div>
    </footer>
  );
}
