import type { Metadata } from "next";
import localFont from "next/font/local";

import { Masthead } from "@/components/masthead";
import { SiteFooter } from "@/components/site-footer";

import "./globals.css";

/**
 * The faces are self-hosted from `app/fonts`, not fetched through `next/font/google`.
 *
 * Two durable reasons: a first paint that is being judged should make no third-party request, and
 * a self-hosted build cannot be broken by a font host flapping. That second one is not
 * hypothetical. During the port fonts.gstatic.com was unreachable from the build machine and
 * `next/font/google` failed the build outright with `module-not-found`. That outage ended (both
 * Google hosts answered on 2026-09-14), and reachability is not a reason to go back.
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
 * `/opengraph-image.png` and every unfurl silently fails. The host is read from Vercel's own system
 * variables rather than hardcoded, and falls back to the dev port so the tags are testable locally.
 *
 * A PREVIEW NAMES ITSELF, AND THAT TAKES ITS OWN VARIABLE (OFF-6). This comment used to say that
 * `VERCEL_PROJECT_PRODUCTION_URL` keeps previews pointing at themselves. It does the opposite:
 * Vercel's documentation says it "is always set, even in preview deployments", and it is always the
 * production domain. So a preview, which is where the on-chain build is shown first, unfurled as
 * production pages that do not have its routes. On a preview the branch alias (stable across pushes
 * to the branch) or the deployment's own URL is used instead; production keeps its domain.
 */
const previewHost =
  process.env.VERCEL_ENV === "preview"
    ? (process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL)
    : undefined;
const siteUrl = previewHost
  ? `https://${previewHost}`
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : `http://localhost:${process.env.PORT ?? 3333}`;

/**
 * Every word here is checked against what is true of the deployed program, because it is the
 * sentence a search result and every link unfurl carry for every route that does not set its own.
 * It used to open "On-chain raffles", written before any program existed (K5, OFF-13, CHROME-K5).
 * What it may say now: the raffle program runs on Rialo testnet and the actions are real testnet
 * transactions. What it may not: "provably fair", "trustless", "nobody can rig", or an automatic
 * draw. "Randomized and checkable" is the claim the draw supports, and it is the one made.
 */
const description =
  "A commit-reveal raffle program on Rialo testnet. Deploy a raffle, buy, reveal, draw and claim with real testnet transactions, then recompute the draw yourself. Randomized and checkable.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  /*
    A template, so a route that sets `title: "Raffles"` gets "Raffles · Drawbook" in its tab and
    five raffle tabs can be told apart (OFF-3, CHROME-N5). A route that wants a title with no
    suffix, such as the landing, sets `title: { absolute: "..." }`.
  */
  title: { default: "Drawbook", template: "%s · Drawbook" },
  description,
  /*
    og:title and og:description are not inferred from `title` and `description` above; without this
    block a share would carry the image and nothing else. The image itself comes from the
    app/opengraph-image.png file convention, with its alt text alongside it.

    `url: "./"` IS RESOLVED AGAINST EACH ROUTE'S OWN PATH, NOT THIS LAYOUT'S. Next's
    resolveAbsoluteUrlWithPathname (next/dist/lib/metadata/resolvers/resolve-url.js) resolves a
    `./` og:url against the pathname being rendered, then against metadataBase. With `url: siteUrl`
    here every route inherited the home page's address, and Facebook and LinkedIn treat og:url as
    canonical, so a shared /raffle/4 unfurled as the landing. A route that sets its own openGraph
    replaces this whole block, url included, which leaves it with no og:url rather than a wrong one.
  */
  openGraph: {
    type: "website",
    siteName: "Drawbook",
    title: "Drawbook",
    description,
    url: "./",
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
 * `aria-current` moves with the router's state rather than with a remount, and the view transition
 * has a stable frame around the part of the page that is actually morphing.
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
      /*
        translate="no" (K6, CHROME-K6). The product is English by decision, and the browsers it is
        demonstrated on may be set to another language, where Chrome offers to translate the page. A
        machine-translated "Reveal", "Draw" or "Claim" is a different instruction, and translation
        rewrites the text nodes React owns, which can break hydration outright.
      */
      translate="no"
      className={`${display.variable} ${mono.variable} ${serif.variable}`}
    >
      <body>
        {/*
          THE SKIP LINK (CHROME-N7). The first Tab on every route used to walk the identity, the
          destinations and the chips, seven to nine stops, before reaching the page. This is the
          first stop instead, invisible until it has focus and then drawn over the masthead's left
          end as a chip on its own surface.

          It targets an empty element placed after the masthead rather than each route's <main>,
          because the mains belong to their routes and none carries an id. A fragment link moves
          focus to a `tabIndex={-1}` target, so the next Tab lands on the first control of the page
          whichever route it is. Hidden by moving it above the viewport, not by `sr-only`: the
          visible state would then be `not-sr-only`, which puts it back in the flow and shoves the
          column down by its own height while it is focused.
        */}
        <a
          href="#content"
          className="label fixed top-2.5 left-gutter z-[90] -translate-y-[calc(100%+20px)] border border-bound bg-panel px-3 py-2.5 text-fg focus:translate-y-0"
        >
          Skip to content
        </a>
        <div className="flex min-h-dvh flex-col">
          <Masthead />
          <div id="content" tabIndex={-1} className="outline-none" />
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
