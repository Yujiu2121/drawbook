/**
 * The raffle's actions against the chain: every function signs with the browser wallet, sends,
 * and resolves only once the chain reports the transaction executed. A refusal from the program
 * arrives as a ChainError whose `code` is the program's error code and whose message is the plain
 * English from `errorMessage`, so a page can show it as is.
 *
 * Reads go to the endpoint in `NEXT_PUBLIC_RIALO_RPC`, testnet by default, through the same client
 * the wallet chip uses.
 */

import { encodeBase58 } from "../base58.ts";
import { newNonce } from "../raffle.ts";
import { rialo } from "../rialo-rpc.ts";
import type { Wallet } from "../wallet.ts";
import { findNonce, loadNonces, saveNonce } from "./nonces.ts";
import {
  accountLength,
  buyIx,
  claimableIndices,
  claimIx,
  commitmentV2,
  createIx,
  decodeRaffle,
  drawIx,
  errorMessage,
  MAX_SUPPLY,
  MIN_SUPPLY,
  payoutOf,
  PROGRAM_ID,
  revealIx,
  systemCreateAccountIx,
  type ChainRaffle,
  type CreateParams,
} from "./program.ts";
import {
  addressBytes,
  ChainError,
  INSUFFICIENT_FUNDS,
  sendAndConfirm,
  type Instruction,
  type TxSigner,
} from "./tx.ts";

export { ChainError, type Outcome } from "./tx.ts";

export interface Sent {
  signature: string;
}

/**
 * Headroom for transaction fees on top of rent and prize. The node charged 5000 kelvin per
 * signature on 2026-10-07 and Create carries two, so this covers it several times over while
 * staying far below anything a person would notice.
 */
const FEE_ALLOWANCE = BigInt(50_000);

/** Claims per transaction. Each costs about seven bytes, so this stays well inside the size limit. */
const CLAIMS_PER_TX = 16;

/**
 * How many times Buy tries again for the next ticket after another buyer took the one it asked for
 * (WrongTicket). Each try uses a fresh ticket number and a fresh secret.
 */
const BUY_RETRIES = 3;

/** Kelvin to RLO for a sentence, exactly, without pulling in the page's formatter. */
function rlo(kelvin: bigint): string {
  const whole = kelvin / BigInt(1_000_000_000);
  const frac = (kelvin % BigInt(1_000_000_000)).toString().padStart(9, "0").replace(/0+$/, "");
  return frac === "" ? whole.toString() : `${whole}.${frac}`;
}

function signerOf(wallet: Wallet): TxSigner {
  if (!wallet.canSign || !wallet.privateKey) {
    throw new ChainError("This wallet cannot sign in this browser, so it can receive but not send.");
  }
  return { publicKey: addressBytes(wallet.address), privateKey: wallet.privateKey };
}

function send(payer: TxSigner, instructions: Instruction[], extraSigners: TxSigner[] = []): Promise<string> {
  return sendAndConfirm(
    rialo,
    { payer: payer.publicKey, instructions, signers: [payer, ...extraSigners] },
    { errorProgram: addressBytes(PROGRAM_ID), explain: errorMessage },
  );
}

/* ------------------------------------------------------------------ reads */

/** The raffle at `raffle`, or null when there is no account there or it is not a raffle. */
export async function fetchRaffle(raffle: string): Promise<ChainRaffle | null> {
  const account = await rialo.getAccountInfo(raffle);
  if (!account || account.owner !== PROGRAM_ID) return null;
  try {
    return decodeRaffle(raffle, account.data, account.kelvins);
  } catch {
    return null;
  }
}

/** Every raffle the program holds, newest first. Accounts that are not raffles are skipped. */
export async function listRaffles(): Promise<ChainRaffle[]> {
  const accounts = await rialo.getAccountsByOwner(PROGRAM_ID);
  const out: ChainRaffle[] = [];
  for (const { address, account } of accounts) {
    if (account.owner !== PROGRAM_ID) continue;
    try {
      out.push(decodeRaffle(address, account.data, account.kelvins));
    } catch {
      // An account the program owns but has not initialised, for example a Create that failed
      // halfway; it is not a raffle yet, so it is not listed.
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * The raffle's successful transactions, newest first, with their block time in milliseconds. Failed
 * attempts, such as a Buy that lost a race, are left out: they changed nothing.
 */
export async function raffleActivity(raffle: string): Promise<{ signature: string; at: number | null }[]> {
  const signatures = await rialo.getSignaturesForAddress(raffle, { limit: 100 });
  return signatures
    .filter((s) => !s.err)
    .map((s) => ({ signature: s.signature, at: typeof s.blockTime === "number" ? s.blockTime : null }));
}

/** What creating a raffle takes from the creator's wallet: rent, the prize, and fee headroom. */
export async function createCost(supply: number, prize: bigint): Promise<bigint> {
  const rent = await rialo.getMinimumBalanceForRentExemption(accountLength(supply));
  return rent + prize + FEE_ALLOWANCE;
}

/* ---------------------------------------------------------------- actions */

/**
 * Create a raffle: a fresh keypair becomes the raffle account, created by the System program and
 * initialised by the raffle program in one transaction that both keys sign. The raffle key is
 * thrown away afterwards; the account is owned by the program, so nothing ever needs it again.
 */
export async function createRaffle(wallet: Wallet, p: CreateParams): Promise<Sent & { raffle: string }> {
  const creator = signerOf(wallet);

  // The program checks all of this too; checking here first turns an obvious mistake into a
  // sentence before any fee is spent. The deadline-against-now check is left to the chain's clock.
  if (
    !Number.isInteger(p.supply) || p.supply < MIN_SUPPLY || p.supply > MAX_SUPPLY ||
    !Number.isInteger(p.winners) || p.winners < 1 || p.winners > p.supply ||
    p.ticketPrice < BigInt(1) || p.prize < BigInt(0) || p.revealBond < BigInt(0) ||
    !(p.commitDeadline < p.revealDeadline)
  ) {
    // Checked here, so not the program's refusal: no code, and nothing was sent.
    throw new ChainError(errorMessage(5));
  }

  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const raffleKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const len = accountLength(p.supply);
  const rent = await rialo.getMinimumBalanceForRentExemption(len);

  const raffle = encodeBase58(raffleKey);
  let instructions: Instruction[];
  try {
    instructions = [
      systemCreateAccountIx(creator.publicKey, raffleKey, rent, len, addressBytes(PROGRAM_ID)),
      createIx(creator.publicKey, raffleKey, p),
    ];
  } catch (error) {
    // An amount past u64 is refused while encoding, before anything is signed.
    throw new ChainError(`${errorMessage(5)} (${error instanceof Error ? error.message : String(error)})`);
  }

  try {
    const signature = await send(creator, instructions, [{ publicKey: raffleKey, privateKey: pair.privateKey }]);
    return { signature, raffle };
  } catch (error) {
    // The address goes with the error, so a Create whose outcome is unknown can say where the
    // raffle would be rather than inviting a second deploy and a second prize deposit.
    if (error instanceof ChainError) error.raffle = raffle;
    throw error;
  }
}

/**
 * Buy the next ticket. The nonce is saved before anything is sent, because a purchase that lands
 * while the page is closing must still be revealable, and it is saved beside any earlier attempt
 * for the same ticket number rather than over it (see lib/chain/nonces.ts). If storage does not
 * keep it, nothing is sent: a ticket whose secret dies at the next reload is a forfeited bond.
 *
 * If another buyer takes the same ticket first the program answers WrongTicket, and this tries
 * again for the next one, up to three times, each with a fresh ticket number and secret.
 */
export async function buyTicket(wallet: Wallet, raffle: string): Promise<Sent & { ticketIndex: number }> {
  const buyer = signerOf(wallet);
  const raffleKey = addressBytes(raffle);

  for (let attempt = 0; ; attempt += 1) {
    const r = await fetchRaffle(raffle);
    // Checks made here rather than refusals from the program, so they carry no code.
    if (!r) throw new ChainError(errorMessage(4));
    if (r.status !== "open" || r.sold >= r.supply) throw new ChainError(errorMessage(6));

    if (attempt === 0) {
      // A ticket costs price and bond, the fee comes on top, and the wallet must keep the small
      // minimum every account holds or the chain refuses the transfer. Checked first so a short
      // wallet reads as short, not as a refusal it then pays a fee to receive.
      const [balance, minimum] = await Promise.all([
        rialo.balance(wallet.address),
        rialo.getMinimumBalanceForRentExemption(0),
      ]);
      const cost = r.ticketPrice + r.revealBond;
      if (BigInt(balance) < cost + FEE_ALLOWANCE + minimum) {
        throw new ChainError(
          `${INSUFFICIENT_FUNDS} A ticket here takes ${rlo(cost)} RLO with its bond, plus the network fee and the small minimum an account keeps on chain; this wallet holds ${rlo(BigInt(balance))} RLO.`,
        );
      }
    }

    const ticketIndex = r.sold + 1;
    const nonce = newNonce();
    if (!saveNonce(raffle, ticketIndex, wallet.address, nonce)) {
      throw new ChainError(
        "This browser would not store the ticket's secret, so nothing was sent. Without it the ticket could not be revealed after a reload and its bond would be lost. Allow this site to store data (it is blocked, or this is a private window), reload, and try again.",
      );
    }
    const commitment = commitmentV2(raffle, ticketIndex, wallet.address, nonce);

    try {
      const signature = await send(buyer, [buyIx(buyer.publicKey, raffleKey, ticketIndex, commitment)]);
      return { signature, ticketIndex };
    } catch (error) {
      if (attempt < BUY_RETRIES && error instanceof ChainError && error.code === 7) continue;
      throw error;
    }
  }
}

/**
 * Reveal a ticket's nonce, which also refunds its bond. Sends the one candidate this browser holds
 * whose commitment equals the ticket's on chain; when none does, it says so without spending a fee.
 */
export async function revealTicket(wallet: Wallet, raffle: string, ticketIndex: number): Promise<Sent> {
  const holder = signerOf(wallet);
  const label = String(ticketIndex).padStart(2, "0");

  const r = await fetchRaffle(raffle);
  if (!r) throw new ChainError(errorMessage(4));
  const ticket = r.tickets[ticketIndex - 1];
  if (!ticket || ticket.holder !== wallet.address || !ticket.commitment) {
    throw new ChainError(`Ticket ${label} is not held by this wallet.`);
  }
  if (ticket.revealed) throw new ChainError(`Ticket ${label} is already revealed.`);

  const nonce = findNonce(raffle, ticketIndex, wallet.address, ticket.commitment);
  if (!nonce) {
    throw new ChainError(
      loadNonces(raffle, ticketIndex, wallet.address).length === 0
        ? `This browser holds no secret for ticket ${label}. It was bought in another browser, or this one's storage was cleared.`
        : `None of the secrets this browser holds for ticket ${label} matches the commitment made at purchase, so it cannot be revealed from here.`,
    );
  }

  const signature = await send(holder, [revealIx(holder.publicKey, addressBytes(raffle), ticketIndex, nonce)]);
  return { signature };
}

/**
 * Whether this browser holds the secret that opens `ticketIndex` as recorded on chain. A page uses
 * it to offer a reveal only for tickets that can actually be revealed from here.
 */
export function canReveal(raffle: string, ticketIndex: number, holder: string, commitmentHex: string | null): boolean {
  return commitmentHex !== null && findNonce(raffle, ticketIndex, holder, commitmentHex) !== null;
}

/**
 * Run the draw. Anyone may, once the raffle is ready; the caller pays only the fee. The draw goes
 * alone in its transaction, which the program insists on. If the last reveal landed in the same
 * block the program answers TooSoon (18), and one more try a block later settles it.
 */
export async function drawRaffle(wallet: Wallet, raffle: string): Promise<Sent> {
  const caller = signerOf(wallet);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const signature = await send(caller, [drawIx(caller.publicKey, addressBytes(raffle))]);
      return { signature };
    } catch (error) {
      if (attempt < 2 && error instanceof ChainError && error.code === 18) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      throw error;
    }
  }
}

/** One Claim transaction that landed, and what it paid. */
export interface Claimed extends Sent {
  kelvin: bigint;
}

/**
 * Collect everything this wallet is owed by the raffle: winnings on a drawn raffle, refunds on a
 * void one, and the prize back for a void raffle's creator. Several Claims share a transaction, so
 * this is usually one signature; it resolves to an empty list when nothing is owed.
 *
 * Each entry carries the kelvin it paid, worked out from the account as read just before sending,
 * so a page reports what was claimed rather than what was owed when it last rendered (a third party
 * may push a payout in between; Claim needs no signer). `onLanded` hears each batch as it lands, so
 * if a later batch fails the earlier ones, which did move money, still have their receipts.
 */
export async function claimAll(
  wallet: Wallet,
  raffle: string,
  onLanded?: (claimed: Claimed) => void,
): Promise<Claimed[]> {
  const payer = signerOf(wallet);
  const r = await fetchRaffle(raffle);
  if (!r) throw new ChainError(errorMessage(4));

  const raffleKey = addressBytes(raffle);
  const indices = claimableIndices(r, wallet.address);
  const sent: Claimed[] = [];
  for (let i = 0; i < indices.length; i += CLAIMS_PER_TX) {
    const batch = indices.slice(i, i + CLAIMS_PER_TX);
    const signature = await send(
      payer,
      batch.map((index) => claimIx(raffleKey, payer.publicKey, index)),
    );
    const claimed = { signature, kelvin: batch.reduce((sum, index) => sum + payoutOf(r, index), BigInt(0)) };
    sent.push(claimed);
    onLanded?.(claimed);
  }
  return sent;
}
