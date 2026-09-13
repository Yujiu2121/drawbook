import type { Metadata } from "next";
import localFont from "next/font/local";

import { Masthead } from "@/components/masthead";
import { SiteFooter } from "@/components/site-footer";

import "./globals.css";

/**
 * The faces are self-hosted from `app/fonts`, not fetched through `next/font/google`.
 *
 * This is not a preference. `next/font/google` reads the stylesheet from fonts.googleapis.com and
 * then downloads each face from **fonts.gstatic.com**, and that second host is unreachable from this
 * machine: it resolves (74.125.200.94 and an IPv6 address) and then times out on `curl -4`, `curl -6`
 * and node with no proxy configured. The build failed outright with `module-not-found` inside the
 * generated `geist_mono_*.module.css` once the `.next` cache was cleared, so the app could not be
 * built at all until the fetch was removed from the build.
 *
 * Self-hosting also costs nothing at runtime and removes a third-party request from a page that is
 * going to be judged on how fast its first screen lands.
 *
 * The files came from the google/fonts repository through jsdelivr, which IS reachable, then were
 * subset to latin and converted with fontTools. Fontsource was checked first and rejected: its
 * variable packages ship `-wght-` files only, which silently drops the width axis.
 *
 * **The width axis is load-bearing.** Every `font-variation-settings: "wdth" ...` in `globals.css`
 * and `cell.css` depends on it, and a weight-only file makes all of them do nothing without
 * erroring. `.label` is drawn at wdth 75 and `.monument` at wdth 112; pinned at the default width
 * the labels render 0.700em per glyph against the 0.600em they are drawn at, 17% wider, and the
 * masthead overflows. Both advances were measured in Chromium off these files. Verified present
 * after subsetting: Archivo carries wght 100..900 and wdth 62..125, Martian Mono carries wght
 * 100..800 and wdth 75..112.5.
 *
 * **Each variable face declares its weight RANGE.** `next/font/local` writes whatever `weight` says
 * straight into the `@font-face` descriptor and writes no descriptor at all when it is omitted, and
 * an omitted `font-weight` descriptor means `normal`, a single value. The type system in
 * `globals.css` deliberately takes width from `font-variation-settings` and weight from real
 * `font-weight` (so `<strong>` cannot fight the axis), which makes weight the one axis routed
 * through font matching: an engine that clamps the used weight to the descriptor range renders the
 * 700 of `.monument` and the 600 of `.label` as synthetic bold over a single instance. Chromium was
 * measured not to clamp, rendering 400/600/700 identically with and without the range, so this is
 * belt and braces rather than a repair, and it costs one descriptor. The ranges are read from each
 * file's own fvar table, not from the family's documentation: Archivo wght 100..900, Martian Mono
 * wght 100..800. Width needs no descriptor because `font-variation-settings` is applied below font
 * matching and cannot be clamped by one.
 */
const display = localFont({
  variable: "--font-display",
  display: "swap",
  src: [{ path: "./fonts/archivo-latin-var.woff2", weight: "100 900", style: "normal" }],
});

/** Figures stay monospaced. Tabular numerals are this product's identity, not a stylistic choice. */
const mono = localFont({
  variable: "--font-geist-mono",
  display: "swap",
  src: [{ path: "./fonts/martian-mono-latin-var.woff2", weight: "100 800", style: "normal" }],
});

/** The display serif. One weight, no italic, and that is the point: structural rather than luxurious. */
const serif = localFont({
  variable: "--font-serif",
  display: "swap",
  src: [{ path: "./fonts/young-serif-latin-400.woff2", weight: "400", style: "normal" }],
});

/**
 * Absolute URLs for the social card.
 *
 * Scrapers do not resolve relative image paths, so without a metadataBase Next emits a bare
 * `/opengraph-image.png` and every unfurl silently fails. The production host is read from Vercel's
 * own system variable rather than hardcoded, which keeps preview deployments pointing at themselves
 * instead of at production, and falls back to the dev port so the tags are testable locally.
 */
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : `http://localhost:${process.env.PORT ?? 3333}`;

const description =
  "On-chain raffles on Rialo testnet, settled by a commit-reveal draw. Every ticket buyer feeds the seed, so anyone can recompute the winner.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Drawbook",
  description,
  /*
    og:title and og:description are not inferred from `title` and `description` above; without this
    block a share would carry the image and nothing else. The image itself comes from the
    app/opengraph-image.png file convention, with its alt text alongside it.
  */
  openGraph: {
    type: "website",
    siteName: "Drawbook",
    title: "Drawbook",
    description,
    url: siteUrl,
  },
  // X reuses og:image when no twitter:image is set, so the card only needs its type declaring.
  twitter: {
    card: "summary_large_image",
    title: "Drawbook",
    description,
  },
};

/**
 * The shell.
 *
 * The masthead and the footer mount here rather than inside each route, so they are laid out once
 * and survive every navigation instead of being torn down and rebuilt. That matters for three
 * things at once: the wallet chip keeps its store and its live block height across a route change,
 * `aria-current` moves with `usePathname` rather than with a remount, and the view transition has a
 * stable frame around the part of the page that is actually morphing.
 *
 * Two things this wrapper deliberately does not do.
 *
 * It paints NO background. The diffusion film is a fixed `body::after` and anything above it that
 * fills an opaque `--panel` across the full width would hide it for the whole product in one line.
 * It carries no z-index either: globals.css sits the film at z-index -1 precisely so no layout file
 * has to lift the content over it, which is the preview's `#app { z-index: 1 }` rule solved one
 * level down instead.
 *
 * It adds no provider and no context. Every route below is a Server Component until it needs state,
 * and a provider at the root would quietly make the whole tree a client tree.
 *
 * The masthead is `position: fixed`, so each route's own `<main>` carries the `pt-mast` offset. It
 * is not applied here, because applying it in both places would double it.
 *
 * The height contract is one line and it is `min-h-dvh` on the wrapper, which is what holds the
 * footer down on a short route. `<html>` carries no `h-full`: with no height on `body` it resolves
 * to nothing, and an inert rule is an invitation to add the matching one to `body` and start a
 * 100%-height chain that then fights the `min-h-dvh` it was supposed to help.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable} ${serif.variable}`}
    >
      <body>
        <div className="flex min-h-dvh flex-col">
          <Masthead />
          {children}
          {/* mt-auto, not a footer rule: it pins the footer to the bottom of a short route
              without the footer itself having to know it is in a flex column. */}
          <div className="mt-auto">
            <SiteFooter />
          </div>
        </div>
      </body>
    </html>
  );
}
