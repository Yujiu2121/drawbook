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

export const metadata: Metadata = {
  title: "Drawbook",
  description:
    "On-chain raffles on Rialo testnet, settled by a commit-reveal draw. Every ticket buyer feeds the seed, so anyone can recompute the winner.",
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
