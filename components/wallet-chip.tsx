"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import NumberFlow from "@number-flow/react";
import { ArrowClockwise, ArrowDown, CaretDown, Plugs, SignOut } from "@phosphor-icons/react/dist/ssr";

import { rafflesWithSecrets } from "@/lib/chain/nonces";
import { BUTTON, CHIP } from "@/lib/controls";
import { formatRLO } from "@/lib/raffle";
import { KELVIN } from "@/lib/rialo-rpc";
import { shortAddress } from "@/lib/wallet";
import {
  NETWORK,
  connect,
  disconnect,
  fund,
  getServerSnapshot,
  getSnapshot,
  isUnreachable,
  retry,
  subscribe,
} from "@/lib/wallet-store";
import { announceOpen, useCloseWhenOtherOpens } from "./mobile-nav";

/**
 * The chips at the right end of the masthead, the wallet panel under them, and the notice that
 * says when the chain is not answering. The only live chain path in the chrome.
 *
 * Everything below reads `lib/wallet-store.ts` through `useSyncExternalStore` and writes to it
 * through `connect`, `fund`, `retry` and `disconnect`.
 *
 * THE BAR HOLDS WHAT IS PRESSED OFTEN, AND THE PANEL HOLDS EVERYTHING ELSE. The bar used to carry
 * the address chip, a faucet button, a forget button and a running sentence side by side, all
 * pinned rigid inside a wrapper that was allowed to shrink. Below about 1536px the wrapper did
 * shrink, its rigid children spilled out of it, and they painted underneath "Deploy a raffle",
 * "Explore raffles" and the menu button, so a press on FAUCET went to /create and a tap on Forget
 * opened the menu (K1, DET-1). No breakpoint fixes that while four controls and a sentence share
 * one line with the destinations. So the bar now carries exactly two wallet controls, and both
 * are rigid and accounted for in the masthead's width budget:
 *
 *   FAUCET, because the owner presses it in front of people, on a phone and on a laptop, and a
 *     control that is pressed in a demo should be one press away at every width. It also opens the
 *     panel, because the panel is where its answer is printed.
 *   THE ACCOUNT, the address (and the balance from 768px), which is a button: it opens the panel.
 *
 * Forget, the full address, the faucet's answer, and what kind of key this is live in the panel,
 * which is a disclosure under the bar like the menu: no scrim, no focus trap, closed by Escape, by
 * a press outside, by a navigation, or by the menu opening. FORGET in particular moved there on
 * purpose: it deletes the only copy of a private key, and it used to sit 6px from FAUCET.
 *
 * FORGET ASKS FIRST, AND SAYS WHAT IS LOST (CHROME-N2). The key, whatever it holds, and the ability
 * to reveal tickets bought from it. The second step is two bounded buttons, never the filled
 * primary: the primary's hover is the signal hue, and the celebration colour must never be the
 * colour of a destructive confirm.
 *
 * TWO SUBSCRIBERS, ONE POLL. `NetChip`, `WalletChip` and `ChainNotice` each call
 * `useSyncExternalStore`. The store starts its interval on the first subscriber and clears it only
 * when the last one leaves, so extra subscribers cost listeners and zero network.
 *
 * THE NET CHIP PRINTS THE HEIGHT INSTEAD OF A COLOURED SQUARE. A square that means "connected" is
 * decoration drawn from a constant, and it keeps saying connected after the connection is gone. The
 * height is the same claim made with data. And when the node stops answering, the height is
 * replaced by the word "Offline" rather than left frozen, because a frozen figure in a chip whose
 * whole job is liveness is a stale reading presented as a live one (K14).
 *
 * WHERE @number-flow/react IS ALLOWED. Two elements in the whole product carry it, both in this
 * file: the block height, which ticks on every poll, and the wallet balance, which jumps when a
 * faucet grant lands. Both are pinned to `en-US` (DET-2, CHROME-N3): every other figure in the
 * product goes through `toLocaleString("en-US")`, and a chip left on the browser locale printed
 * "28.655.533" beside a pool of "16.25" on a phone set to a comma-decimal locale, a dot meaning two things on one
 * screen.
 *
 * WORK IN FLIGHT IS A HELD CONTROL, NOT A SPINNER. While a request is out the control takes a 14%
 * line tint, lighter than the chip at rest, its word changes to "Connecting", "Requesting" or "Retrying",
 * and `aria-busy` carries it to anyone not looking. It costs no frame and survives
 * `prefers-reduced-motion` unchanged.
 *
 * NOTHING HERE IS EVER THE SIGNAL HUE OR THE WINNER'S: neither `--event` nor coral is painted
 * anywhere in this file. Apricot is the signal and coral is a winner, and an error printed in
 * either would read as a win from the corner of the eye. FAUCET wears the palette's secondary, apricot-2, a step away
 * from the signal, because it is the one control a presenter has to find at a glance on a phone.
 * Failures are plain sentences, with the engine's own wording kept on the `title` for whoever
 * needs it.
 *
 * THE BAR IS GLASS NOW, AND THE PANELS ARE GLASS CARDS. The chips sit on the masthead pill, and
 * the wallet panel and ChainNotice hang 6px under it as floating glass cards with the pill's own
 * insets, from the viewport rather than from the pill (components/masthead.tsx says why that
 * matters). Inside the bar only --fg, --fg-2 and FAUCET's apricot-2 are written; --fg-3 appears in
 * the panel only.
 *
 * CONTRAST, COMPUTED against the surface each token actually sits on, every rgba composited first,
 * formula sanity-checked at white on black = 21.00. The second figure is the worst case: the glass
 * over the drum's apricot band on the landing.
 *   the chip (5% line over the glass)   --fg 13.99 | 12.14, --fg-2 8.28 | 7.19, apricot-2 9.43 | 8.19
 *   the account ramp, top stop          --fg 9.21 | 8.22, --fg-2 5.45 | 4.87 (the "RLO" unit and
 *                                       "Not read yet", label size); the address is --fg
 *   the panel and the notice (glass)    --fg 15.12 | 13.26, --fg-2 8.95 | 7.85, --fg-3 5.15 | 4.52
 *   hover, a 12% line tint              --fg 12.33 | 10.63, --fg-2 7.30 | 6.29, apricot-2 8.31 | 7.16
 *   held and open, a 14% line tint      --fg 11.85 | 10.21, --fg-2 7.02 | 6.04, apricot-2 7.99 | 6.88
 *   the account ramp, hover and open    --fg 8.31 | 7.46 and 8.07 | 7.26; --fg-2 would fall to
 *                                       4.42 and 4.30 under the label floor, so "RLO" and "Not read
 *                                       yet" turn --fg in those two states (group-hover, group-aria-
 *                                       expanded). Open also draws the boundary in --fg-2, so the
 *                                       state never rests on a fill alone.
 *   the panel's buttons, hover 10%      --fg 12.82 | 11.05; held 14%, 11.85 | 10.21
 *   --bound, the chip's boundary        3.39 on the glass, 2.94 over the apricot band; every chip
 *                                       is also named by its own text or icon, so the boundary is
 *                                       not the only thing identifying the control (SC 1.4.11)
 */

/*
 * The chip shell is CHIP in lib/controls.ts, shared with the back arrow, so a boundary drawn here is
 * the same boundary BackLink draws beside it. Its box is the one these chips have always had, one
 * label line plus py-1.5 and the border: 29px, so a chip holding only an 11px icon (the faucet below
 * 1024) is as tall as one holding a word. 29px is the drawn box, not the target: the controls below
 * add `tap` (app/globals.css, block 7), which on a touch screen or below 1024 hangs an invisible
 * 44px square, or a 44px-tall band on a wider chip, around each of them. It is added per control
 * rather than in CHIP because `NetChip` shares the shell and is not a control.
 *
 * THE TINT GOES UP, NEVER DOWN. On the glass, --panel-2 (--veil) is darker than the chip at rest, so
 * a hover or a held state painted with it read as the control sinking, at about 1.08:1. Hover,
 * held and open are the bar's own line tint at a higher alpha instead (12% and 14% over CHIP's
 * 5%), the direction the nav links and the menu button already move in.
 *
 * A held or open control takes its tint through an `aria-busy:` or `aria-expanded:` variant rather
 * than a plain class, because CHIP already paints a background colour and two background-colour
 * utilities on one element are settled by stylesheet order, not by the order they are written in.
 * A variant always sorts after the plain utility, so it wins every time.
 */

/**
 * FAUCET's own paint: apricot-2 ink (9.43 on the chip, 8.19 over an apricot cell) inside a 35%
 * apricot-2 hairline. The raw `var(--apricot-2)` read is deliberate: the role layer has no
 * secondary-signal role yet, and FAUCET is the only control that wears this hue.
 */
const FAUCET_PAINT = "text-[var(--apricot-2)] border-[rgba(var(--apricot-2-rgb),.35)]!";

/**
 * The account chip's paint: a rose-into-wine ramp, the one gradient chip in the bar, because it is
 * the one that is you. Connect wears it too, since it is the same chip before it has an address.
 * The figures are in CONTRAST above.
 */
const ACCOUNT_PAINT =
  "bg-[image:linear-gradient(180deg,rgba(var(--rose-rgb),.34),rgba(var(--glow-rgb),.26))] text-fg";

/**
 * BUTTON for the wallet panel. BUTTON's own hover is --panel-2, which on the glass card is one
 * level from the card itself and reads as nothing; here it is the bar's line tint at 10%, lighter
 * than the card. Swapped by string rather than added, because two `hover:bg-` utilities on one
 * element are settled by stylesheet order. If BUTTON stops carrying `hover:bg-panel-2` this falls
 * back to BUTTON unchanged.
 */
const PANEL_BUTTON = BUTTON.replace("hover:bg-panel-2", "hover:bg-[rgba(var(--line-rgb),.10)]");

/**
 * 11px, from the label step, without the label step's 0.14em tracking. `text-label` carries both
 * and would overwrite a figure's own spacing. The same inline escape `components/row.tsx` uses.
 */
const SMALL = { fontSize: "var(--text-label)" } as const;

/**
 * The two digit timings, as literals that mirror `--t-settle` and `--t-grow` on `--ease-settle`.
 * They cannot be read from CSS here: this renders on the server first, where there is no computed
 * style. If a duration below ever disagrees with globals.css, globals.css is right.
 */
const SETTLE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const TICK = { duration: 320, easing: SETTLE };
const LAND = { duration: 460, easing: SETTLE };

/** Every figure in the product is en-US; see the header. */
const LOCALE = "en-US";

/** "Rialo testnet", "Rialo devnet", or "The local Rialo network", for sentences. */
const CHAIN_PHRASE =
  NETWORK.name === "Local" ? "The local Rialo network" : `Rialo ${NETWORK.faucet}`;

/** Whose faucet, for every label that names it. */
const FAUCET_LABEL = `Request 1 RLO from the ${NETWORK.faucet} faucet`;

/**
 * Whether the node counts as down for display. The first failure counts when no block has ever
 * been read (there is nothing better to show), and otherwise only a second failure in a row does,
 * so one dropped poll on mobile data does not flash a notice that the next poll takes away.
 */
function isOffline(s: { rpcError: string | null; rpcFailures: number; height: number | null }) {
  return s.rpcError !== null && (s.height === null || s.rpcFailures >= 2);
}

/* ------------------------------------------------------------------------ the chain */

/**
 * Which chain, and one live figure proving it is answering.
 *
 * The name comes from the endpoint (`NETWORK`), so a build pointed at a local network says "Local"
 * instead of claiming testnet. "Rialo" joins it at 1536, the height at 640, in that order, because
 * the network word alone is unambiguous on a product that ships against one chain, while a height
 * with no word is a number with no unit.
 */
export function NetChip() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { height, rpcError } = state;
  const offline = isOffline(state);

  return (
    <span className={`${CHIP} text-fg-2`} title={offline && rpcError ? rpcError : undefined}>
      <span className="hidden 2xl:inline">Rialo</span>
      <span className="text-fg">{NETWORK.name}</span>

      {/* Hidden as a group below 640, so the name the number needs goes with it. Below 640 the
          notice under the bar says "not answering" in a full sentence instead. */}
      <span className="hidden items-baseline gap-1.5 sm:inline-flex">
        <span className="sr-only">Block height</span>
        {offline ? (
          <span>Offline</span>
        ) : height === null ? (
          <span>No block yet</span>
        ) : (
          <NumberFlow
            value={height}
            locales={LOCALE}
            format={{ useGrouping: true }}
            className="figure tracking-normal text-fg"
            style={SMALL}
            transformTiming={TICK}
            spinTiming={TICK}
          />
        )}
      </span>
    </span>
  );
}

/**
 * THE CHAIN IS NOT ANSWERING, SAID IN A SENTENCE, WITH A WAY TO ASK AGAIN (K14).
 *
 * This used to be the raw engine string, "Failed to fetch", printed only where 22 characters of a
 * truncating note had room, which in practice meant 1600px and up: at 1280 the note collapsed to
 * zero width and on a phone it was not rendered, so the presenter's two screens showed nothing at
 * all while the chain was down. Now it is a glass card hung under the pill at every width, as wide
 * as the pill, in plain words, with a Retry that asks the node immediately instead of waiting out
 * the six-second poll.
 *
 * It is the chrome's glass, not a colour: this system has no error colour on purpose, and coral in
 * particular is a winner. It is fixed under the bar, so it covers the top of the page while it is
 * up; that is the honest trade for an outage notice, and it goes away by itself on the first poll
 * that answers.
 *
 * A failed connect is the second thing it can say, because the Connect control's own word changing
 * to "Try again" says that something failed without saying what.
 */
export function ChainNotice() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { rpcError, retrying, status, error, wallet } = state;

  let sentence: string | null = null;
  let detail: string | null = null;
  if (isOffline(state)) {
    sentence = `${CHAIN_PHRASE} is ${
      isUnreachable(rpcError) ? "not answering" : "answering with errors"
    }. The block height and balance shown may be out of date.`;
    detail = rpcError;
  } else if (status === "error" && wallet === null && error) {
    sentence = "A wallet could not be set up in this browser. Press Try again to have another go.";
    detail = error;
  }

  return (
    <>
      {/* Announced at every width, once, by the one live region that owns this sentence. */}
      <span role="status" aria-live="polite" className="sr-only">
        {sentence}
      </span>
      {sentence === null ? null : (
        <div className="fixed inset-x-[calc(var(--gutter)-12px)] top-[calc(var(--mast)+6px)] z-[78] flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[22px] glass px-5 py-3 whitespace-normal shadow-panel">
          <p aria-hidden="true" title={detail ?? undefined} className="min-w-0 flex-1 text-sm text-fg">
            {sentence}
          </p>
          {isOffline(state) ? (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={retrying}
              aria-busy={retrying}
              className={`${CHIP} text-fg hover:bg-[rgba(var(--line-rgb),.12)] disabled:cursor-not-allowed aria-busy:bg-[rgba(var(--line-rgb),.14)]`}
            >
              <ArrowClockwise size={11} weight="bold" aria-hidden="true" />
              {retrying ? "Retrying" : "Retry"}
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}

/* ----------------------------------------------------------------------- the wallet */

/** A faucet refusal in plain words. The node's own wording stays on the title. */
function faucetSentence(raw: string): string {
  if (/rate limit/i.test(raw)) {
    return `The ${NETWORK.faucet} faucet turned this down: it has granted RLO to this network recently (an IP rate limit). It will grant again later.`;
  }
  if (isUnreachable(raw)) {
    return `The ${NETWORK.faucet} faucet did not answer. Check the connection and press it again.`;
  }
  return `The ${NETWORK.faucet} faucet refused the request.`;
}

/**
 * What Forget costs in raffles, read from the ticket secrets this browser stored for the wallet.
 * A ticket not yet revealed can never be revealed without the key, and winnings or refunds still
 * owed can be pushed to the address by anyone but spent by nobody.
 */
function forgetTickets(raffles: string[]): string {
  if (raffles.length === 0) {
    return "Any ticket bought from it elsewhere could no longer be revealed, and anything still owed to it could never be spent.";
  }
  const where = raffles.length === 1 ? "1 raffle" : `${raffles.length} raffles`;
  return `It bought, or tried to buy, tickets in ${where} from this browser: any of those not yet revealed can never be revealed, and any winnings or refunds not yet claimed would be paid to an address nobody can spend from. Claim and reveal first.`;
}

export function WalletChip() {
  const { wallet, balance, funding, usedLocalKey, status, error } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const pathname = usePathname();
  const panelId = useId();

  /** What the faucet did last, in words. A fact about this session's last press, not the chain. */
  const [faucetNote, setFaucetNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /** The second step of Forget. Reset whenever the panel closes, so it never reopens half-armed. */
  const [confirming, setConfirming] = useState(false);

  const groupRef = useRef<HTMLSpanElement>(null);
  const accountRef = useRef<HTMLButtonElement>(null);
  const connectRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(pathname);
  const focusConnect = useRef(false);
  /** Set when the confirm step was opened or dismissed by a press, so focus follows the press. */
  const moveFocus = useRef(false);

  const connecting = status === "loading";
  const failed = status === "error";
  const panelOpen = open && wallet !== null;

  function close() {
    setOpen(false);
    setConfirming(false);
  }

  function show() {
    announceOpen("wallet");
    setOpen(true);
  }

  useCloseWhenOtherOpens("wallet", panelOpen, close);

  // A navigation closes the panel, the same way it closes the menu: compare against the path the
  // panel was opened on, so a link to the page already open does not leave it hanging.
  useEffect(() => {
    if (!panelOpen) {
      openedAt.current = pathname;
      return;
    }
    if (pathname !== openedAt.current) {
      setOpen(false);
      setConfirming(false);
    }
  }, [pathname, panelOpen]);

  // Escape closes, and hands focus back to the control that opened the panel if focus was inside
  // it; a press anywhere outside the bar's wallet group closes without moving focus.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = groupRef.current?.contains(document.activeElement) ?? false;
      setOpen(false);
      setConfirming(false);
      if (inside) accountRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (groupRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setConfirming(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [panelOpen]);

  // After Forget the panel and every control in it are gone, so focus would fall to <body>. Put it
  // on Connect instead, which is where the same person goes next.
  useEffect(() => {
    if (wallet === null && focusConnect.current) {
      focusConnect.current = false;
      connectRef.current?.focus();
    }
  }, [wallet]);

  // The confirm step swaps one button for two and back, and the button that had focus is the one
  // that disappears each time. Asking puts focus on "Keep it", the safe answer; keeping puts it
  // back on the question it came from.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (confirming ? keepRef : askRef).current?.focus();
  }, [confirming]);

  /**
   * Ask, wait for the store to settle, then say what happened.
   *
   * `fund()` resolves in its own `finally`, after `funding` has gone back to false and after the
   * balance it found has been published, so both readings are available on the line after the
   * await. The store is read directly rather than through the render's closure, which could be up
   * to six seconds stale.
   */
  async function requestFaucet() {
    const before = getSnapshot().balance;
    setFaucetNote(null);

    await fund();

    const after = getSnapshot();
    if (after.error !== null) {
      // The error line in the panel says it, from the store, where the next poll no longer wipes it.
      setFaucetNote(null);
      return;
    }

    /*
     * Four outcomes, because three of them are not "nothing landed". `before` is null when the
     * balance has never been read, which is reachable: `connect()` polls once and that poll can
     * fail. Each case says only what is known.
     */
    if (after.balance === null) {
      setFaucetNote("Asked for 1 RLO. The balance has not come back from the node yet.");
    } else if (before === null) {
      setFaucetNote(`Asked for 1 RLO. The balance now reads ${formatRLO(after.balance)} RLO.`);
    } else if (after.balance > before) {
      setFaucetNote(`The faucet granted ${formatRLO(after.balance - before)} RLO.`);
    } else {
      setFaucetNote(
        "Asked for 1 RLO. Nothing had landed after twelve seconds. The faucet is shared, so it may still arrive.",
      );
    }
  }

  function forget() {
    setFaucetNote(null);
    close();
    focusConnect.current = true;
    disconnect();
  }

  /** One line, in priority order: what is happening, what broke, then what the faucet did. */
  const note = funding
    ? `Requesting 1 RLO from the ${NETWORK.faucet} faucet.`
    : error && wallet
      ? faucetSentence(error)
      : faucetNote;

  if (!wallet) {
    return (
      <>
        <button
          ref={connectRef}
          type="button"
          onClick={() => void connect()}
          disabled={connecting}
          aria-busy={connecting}
          title={failed && error ? error : undefined}
          className={`${CHIP} tap ${ACCOUNT_PAINT} hover:bg-[rgba(var(--line-rgb),.12)] disabled:cursor-not-allowed aria-busy:bg-[rgba(var(--line-rgb),.14)]`}
        >
          <Plugs size={11} weight="bold" aria-hidden="true" />
          {connecting ? (
            "Connecting"
          ) : failed ? (
            "Try again"
          ) : (
            <>
              {/* Exactly one of these two is in the accessibility tree at any width, because the
                  other is display none rather than clipped. */}
              <span className="sm:hidden">Connect</span>
              <span className="hidden sm:inline">Connect wallet</span>
            </>
          )}
        </button>
        <LiveNote text={null} />
      </>
    );
  }

  return (
    /*
      ONE RIGID GROUP. Both controls are `shrink-0` through CHIP and so is this wrapper: nothing in
      the wallet is allowed to give way, because the last time something did, its children spilled
      out from under it. The masthead's width budget is what keeps the bar inside the viewport, and
      it is measured at every width the product is shown at. The panel is rendered inside this
      group so that a press inside the panel counts as a press inside the group, and so that Tab
      from the account button walks straight into it.
    */
    <span ref={groupRef} className="flex shrink-0 items-center gap-1.5 max-lg:gap-2">
      <button
        type="button"
        onClick={() => {
          show();
          void requestFaucet();
        }}
        disabled={funding}
        aria-busy={funding}
        aria-label={funding ? `Requesting 1 RLO from the ${NETWORK.faucet} faucet` : FAUCET_LABEL}
        title={FAUCET_LABEL}
        className={`${CHIP} tap ${FAUCET_PAINT} hover:bg-[rgba(var(--line-rgb),.12)] disabled:cursor-not-allowed aria-busy:bg-[rgba(var(--line-rgb),.14)]`}
      >
        <ArrowDown size={11} weight="bold" aria-hidden="true" />
        {/* The word joins at 1024, which is the narrowest laptop this is demonstrated on; below it
            the arrow carries the accessible name alone, in a 29px chip that `tap` makes a 44px
            target. That is also why the group's gap is 8px rather than 6 below 1024: the target
            reaches 7.5px past the chip, and the account button beside it must not cover that. */}
        <span className="hidden lg:inline">{funding ? "Requesting" : "Faucet"}</span>
      </button>

      <button
        ref={accountRef}
        type="button"
        onClick={() => (panelOpen ? close() : show())}
        aria-expanded={panelOpen}
        aria-controls={panelId}
        title={wallet.address}
        className={`group ${CHIP} tap ${ACCOUNT_PAINT} hover:bg-[rgba(var(--line-rgb),.12)] aria-expanded:bg-[rgba(var(--line-rgb),.14)] aria-expanded:border-fg-2`}
      >
        <span className="sr-only">Wallet</span>
        {/* An address is base58 and case carries meaning, so the label voice is undone here:
            `normal-case` against the uppercase, `tracking-normal` against the 0.14em. Below 640 it
            keeps only its first four characters; the whole address is the first thing in the panel. */}
        <span className="mono normal-case tracking-normal text-fg" style={SMALL}>
          <span className="sm:hidden">{`${wallet.address.slice(0, 4)}…`}</span>
          <span className="hidden sm:inline">{shortAddress(wallet.address, 4, 4)}</span>
        </span>

        {/*
          A BALANCE OF NULL IS NOT A BALANCE OF ZERO. `balance` is null until the first getBalance
          answers, and stays null if that call fails. Coercing it with `?? 0` once printed a
          confident 0.000 RLO over a wallet the node had not been asked about, which sends someone
          to the faucet for nothing. So the figure is withheld until there is one.
        */}
        <span className="hidden items-baseline gap-1 md:inline-flex">
          <span className="sr-only">Balance</span>
          {balance === null ? (
            <span className="text-fg-2 group-hover:text-fg group-aria-expanded:text-fg">Not read yet</span>
          ) : (
            <>
              <NumberFlow
                value={balance / KELVIN}
                locales={LOCALE}
                /* The same rule `formatRLO` applies to every other figure in the product, so a
                   balance and a pool are quoted to the same precision. */
                format={{
                  minimumFractionDigits: balance < KELVIN ? 3 : 2,
                  maximumFractionDigits: 4,
                }}
                className="figure tracking-normal text-fg"
                style={SMALL}
                transformTiming={LAND}
                spinTiming={LAND}
              />
              <span className="text-fg-2 group-hover:text-fg group-aria-expanded:text-fg">RLO</span>
            </>
          )}
        </span>
        <CaretDown size={10} weight="bold" aria-hidden="true" className="hidden text-fg-2 sm:block" />
      </button>

      <LiveNote text={note} />

      {panelOpen ? (
        <div
          id={panelId}
          role="region"
          aria-label="Wallet"
          /*
            Full width on a phone, a 380px sheet against the right edge from 640, which is where the
            controls that open it are. Fixed under the bar like the menu panel and on the same layer,
            so the two never show at once (each closes when the other opens). `whitespace-normal`
            undoes the bar's nowrap, which a fixed child still inherits.
          */
          className="fixed inset-x-[calc(var(--gutter)-12px)] top-[calc(var(--mast)+6px)] z-[79] max-h-[calc(100dvh-var(--mast)-12px)] overflow-y-auto rounded-[22px] glass px-pad pt-5 pb-6 whitespace-normal shadow-panel sm:left-auto sm:right-[calc(var(--gutter)-12px)] sm:w-[380px] sm:px-6"
        >
          <p className="label text-fg-3">{usedLocalKey ? "Burner wallet" : "Wallet"}</p>
          <p className="mt-2 text-sm text-fg-2">
            {usedLocalKey
              ? `A key made in this browser and kept in its storage, for ${
                  NETWORK.name === "Local" ? "this local network" : `Rialo ${NETWORK.faucet}`
                } only.${NETWORK.name === "Testnet" ? " Testnet can be reset." : ""}`
              : "A wallet extension that speaks Rialo's own wallet standard."}
            {wallet.canSign
              ? ""
              : " This browser has no Ed25519, so this address can receive RLO but cannot sign."}
          </p>

          <dl className="mt-4 grid gap-3">
            <div>
              <dt className="label text-fg-3">Address</dt>
              <dd className="digest mt-1 text-sm text-fg select-all">{wallet.address}</dd>
            </div>
            <div>
              <dt className="label text-fg-3">Balance</dt>
              <dd className="figure mt-1 text-sm text-fg">
                {balance === null ? "Not read yet" : `${formatRLO(balance)} RLO`}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={() => void requestFaucet()}
            disabled={funding}
            aria-busy={funding}
            className={`${PANEL_BUTTON} mt-5 w-full justify-center disabled:cursor-not-allowed aria-busy:bg-[rgba(var(--line-rgb),.14)]`}
          >
            <ArrowDown size={12} weight="bold" aria-hidden="true" />
            {/* The network is already named in the sentence above, so the button can say what it
                does in one line at 360. */}
            {funding ? "Requesting 1 RLO" : "Request 1 RLO from the faucet"}
          </button>

          {/* Visible copy of the live note; aria-hidden because LiveNote already announces it. */}
          {note ? (
            <p aria-hidden="true" title={error ?? undefined} className="mt-3 text-sm text-fg-2">
              {note}
            </p>
          ) : null}

          <div className="mt-5 border-t border-rule pt-4">
            {confirming ? (
              <div role="group" aria-labelledby={`${panelId}-forget`}>
                <p id={`${panelId}-forget`} className="text-sm text-fg">
                  {usedLocalKey
                    ? `Forget this wallet? Its private key is deleted from this browser, and there is no other copy. ${
                        balance === null || balance === 0
                          ? "Anything it holds"
                          : `The ${formatRLO(balance)} RLO it holds`
                      } is lost with it. ${forgetTickets(wallet === null ? [] : rafflesWithSecrets(wallet.address))}`
                    : "Disconnect this wallet from Drawbook in this browser?"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={forget} className={PANEL_BUTTON}>
                    <SignOut size={12} weight="bold" aria-hidden="true" />
                    {usedLocalKey ? "Delete the key" : "Disconnect"}
                  </button>
                  <button
                    ref={keepRef}
                    type="button"
                    onClick={() => {
                      moveFocus.current = true;
                      setConfirming(false);
                    }}
                    className={PANEL_BUTTON}
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button
                ref={askRef}
                type="button"
                onClick={() => {
                  moveFocus.current = true;
                  setConfirming(true);
                }}
                className={PANEL_BUTTON}
              >
                <SignOut size={11} weight="bold" aria-hidden="true" />
                {usedLocalKey ? "Forget this wallet" : "Disconnect"}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </span>
  );
}

/**
 * The faucet's and a connect's outcome, announced at every width whether or not the panel is open.
 * Screen-reader only: the visible copy is in the panel, marked aria-hidden there so it is not
 * announced twice.
 */
function LiveNote({ text }: { text: string | null }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {text}
    </span>
  );
}
