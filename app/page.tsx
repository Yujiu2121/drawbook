import { Hero } from "@/components/landing/hero";
import { Mechanism } from "@/components/landing/mechanism";
import {
  LiveFigures,
  ProductShot,
  Statement,
  WhyRialo,
} from "@/components/landing/sections";
import { Masthead } from "@/components/masthead";
import { SiteFooter } from "@/components/site-footer";

export const metadata = {
  title: "Drawbook: nobody picks the winner",
  description:
    "On-chain raffles on Rialo testnet. Every ticket buyer commits a secret, the winner falls out of all of them at once, and anyone can recompute it.",
};

/**
 * The landing page.
 *
 * Six sections, six different layout families: an asymmetric hero split, a full-width statement, a
 * stepped row, a full-bleed product shot, an asymmetric grid, and a figure row. Two eyebrows in
 * total, on the mechanism and the Rialo section, and none in the hero.
 *
 * There is no closing call to action. The hero and the header both carry one already, and a third
 * repeat of the same link at the bottom of a six-section page was padding, not persuasion.
 *
 * Every visual is either the live chain or a real screenshot of the running app. There is no
 * illustration, no gradient mesh and no fake product mock, because the product exists and can simply
 * be photographed.
 */
export default function LandingPage() {
  return (
    <>
      <Masthead variant="landing" />
      <main>
        <Hero />
        <Statement />
        <Mechanism />
        <ProductShot />
        <WhyRialo />
        <LiveFigures />
      </main>

      <SiteFooter />
    </>
  );
}
