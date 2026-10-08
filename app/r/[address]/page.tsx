import type { Metadata } from "next";

import { ChainRaffleView } from "@/components/chain-raffle";
import { isAddress } from "@/lib/base58";
import { PROGRAM_ID, cleanTitle, decodeRaffle } from "@/lib/chain/program";
import { rialo } from "@/lib/rialo-rpc";

/**
 * /r/[address]: ONE RAFFLE THAT LIVES ON CHAIN.
 *
 * The sample raffles at /raffle/[id] are a fixed record rendered at build time, so everything about
 * them can be a Server Component. A raffle here is an account on the chain that changes while the
 * page is open: tickets sell, holders reveal, someone draws. So this file only unwraps the address
 * and hands it to one client view, which reads the account through lib/chain, polls it, and offers
 * the actions the connected wallet can take.
 *
 * The page does not validate the address. The view does, so a malformed link and a well-formed link
 * to an account that is not a raffle get their plain sentences from the same place. The metadata
 * below checks it again for its own purposes only, so a malformed link never reaches the node.
 *
 * Deliberately not prerendered and not a second home for the board's morph: the board's strips name
 * themselves for the transition into /raffle/[id], and nothing on this route names one, because a
 * live raffle's row on /raffles is not the same object as its strip there.
 */

/** The tab's own words, and the whole title whenever the raffle's name cannot be read. */
const TITLE = "Raffle on chain";
const DESCRIPTION =
  "A Drawbook raffle deployed on Rialo: buy a ticket, reveal it, run the draw and check the result in your own browser.";

/**
 * How long the tab title waits for the node. Measured from this machine on 2026-10-08, one
 * getAccountInfo on testnet took about one second including a fresh TLS handshake, so two seconds
 * covers an ordinary answer and stops a hung one. Past it the title is the generic one, which is
 * what every raffle tab said before this read existed.
 */
const TITLE_WAIT_MS = 2000;

/**
 * The longest base58 spelling of 32 bytes. A longer segment is not an address and is refused before
 * it is decoded, because base58 decoding costs the square of the length and this runs on the server.
 */
const MAX_ADDRESS_CHARS = 44;

/**
 * A TAB PER RAFFLE (the same reason /raffle/[id] has one). Every live raffle's tab used to read
 * "Raffle on chain · Drawbook", so two raffles opened side by side could not be told apart. The
 * title is read from the raffle account on the server and goes through `cleanTitle`, the same
 * function the page's heading uses, so control characters and bidirectional overrides a creator
 * wrote into the 32 bytes cannot reach the tab either.
 *
 * IT MAY FAIL, AND FAILING IS QUIET. Any error, an account that is not a raffle, or a node slower
 * than `TITLE_WAIT_MS` gives the generic title and nothing else: the view below says what is wrong
 * with the address in its own words, and a tab title is not the place for an RPC error. It cannot
 * hold the page up either. Next streams metadata after the page for browsers, so the raffle paints
 * without waiting for this read, and only the crawlers Next serves metadata in the head (link
 * previews among them) wait for it, for two seconds at most.
 *
 * Like /raffle/[id], NO openGraph OR twitter BLOCK: a child's block replaces the layout's whole one
 * and loses the card image. The title is the only per-raffle word.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  const name = await titleOnChain(address);
  return { title: name === null ? TITLE : `${name} · ${TITLE}`, description: DESCRIPTION };
}

/** The raffle's cleaned title, "Untitled raffle" for an empty one, or null when it cannot be read. */
async function titleOnChain(segment: string): Promise<string | null> {
  try {
    const address = decodeURIComponent(segment);
    if (address.length > MAX_ADDRESS_CHARS || !isAddress(address)) return null;
    const account = await rialo.getAccountInfo(address, AbortSignal.timeout(TITLE_WAIT_MS));
    if (!account || account.owner !== PROGRAM_ID) return null;
    return cleanTitle(decodeRaffle(address, account.data, account.kelvins).title) || "Untitled raffle";
  } catch {
    return null;
  }
}

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <ChainRaffleView address={decodeURIComponent(address)} />;
}
