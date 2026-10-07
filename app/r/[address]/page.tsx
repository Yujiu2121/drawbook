import type { Metadata } from "next";

import { ChainRaffleView } from "@/components/chain-raffle";

/**
 * /r/[address]: ONE RAFFLE THAT LIVES ON CHAIN.
 *
 * The sample raffles at /raffle/[id] are a fixed record rendered at build time, so everything about
 * them can be a Server Component. A raffle here is an account on the chain that changes while the
 * page is open: tickets sell, holders reveal, someone draws. So this file only unwraps the address
 * and hands it to one client view, which reads the account through lib/chain, polls it, and offers
 * the actions the connected wallet can take.
 *
 * The address is not validated here. The view does it, so a malformed link and a well-formed link
 * to an account that is not a raffle get their plain sentences from the same place.
 *
 * Deliberately not prerendered and not a second home for the board's morph: the board's strips name
 * themselves for the transition into /raffle/[id], and nothing on this route names one, because a
 * live raffle's row on /raffles is not the same object as its strip there.
 */

export const metadata: Metadata = {
  title: "Raffle on chain",
  description:
    "A Drawbook raffle deployed on Rialo: buy a ticket, reveal it, run the draw and check the result in your own browser.",
};

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <ChainRaffleView address={decodeURIComponent(address)} />;
}
