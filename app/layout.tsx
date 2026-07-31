import type { Metadata } from "next";
import { SmoothScroll } from "@/components/smooth-scroll";
import { Instrument_Sans, Geist_Mono } from "next/font/google";
import "lenis/dist/lenis.css";
import "./globals.css";

/**
 * Instrument Sans rather than Geist or Inter.
 *
 * Geist is a good UI grotesque and that is the problem: at display size it is neutral to the point
 * of anonymous, which is exactly what made the previous version read as a developer tool. Instrument
 * Sans has slightly narrower proportions and more character in its terminals, so a 56px heading has
 * presence without needing decoration. Its full weight range is loaded because the type does the
 * work colour is not doing.
 */
const display = Instrument_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

/** Figures stay monospaced. Tabular numerals are this product's identity, not a stylistic choice. */
const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  : `http://localhost:${process.env.PORT ?? 5522}`;

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-[100dvh]">
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
