"use client";

import { useState, useSyncExternalStore } from "react";
import NumberFlow from "@number-flow/react";
import { ArrowDown, Plugs, SignOut } from "@phosphor-icons/react/dist/ssr";

import { formatRLO } from "@/lib/raffle";
import { KELVIN } from "@/lib/rialo-rpc";
import { shortAddress } from "@/lib/wallet";
import {
  connect,
  disconnect,
  fund,
  getServerSnapshot,
  getSnapshot,
  subscribe,
} from "@/lib/wallet-store";

/**
 * The two chips at the right end of the masthead, and the only live chain path in the product.
 *
 * Everything below reads `lib/wallet-store.ts` through `useSyncExternalStore` and writes to it
 * through `connect`, `fund` and `disconnect`. The store and the RPC client under it are untouched
 * by this port: what changed is the chrome. Counterfoil pressed its connect button with a cast
 * shadow that lifted on hover and vanished on press, and in this system there is no second
 * light for a shadow to be cast by, so the whole press affordance is rebuilt out of surface.
 *
 * TWO SUBSCRIBERS, ONE POLL. `NetChip` and `WalletChip` each call `useSyncExternalStore`. The store
 * starts its interval on the first subscriber and clears it only when the last one leaves
 * (`started` is a flag, not a count), so the second chip costs one more listener and zero extra
 * network. The masthead is mounted once from the root layout, so neither chip remounts on a
 * navigation and the height never restarts from nothing.
 *
 * THE NET CHIP PRINTS THE HEIGHT INSTEAD OF A COLOURED SQUARE, and that decision predates this
 * design system. The preview draws a small filled square beside the word "testnet" to say the chain
 * is there. A square that means "connected" is decoration, it is drawn from a constant, and it
 * keeps saying connected after the connection is gone. The height is the same claim made with data:
 * if the number stops climbing, you can see that it has. Cell's material model agrees, since this
 * product has no decoration to spend on a dot.
 *
 * WHERE @number-flow/react IS ALLOWED. Two elements in the whole product carry it, both in this
 * file: the block height, which ticks on every poll, and the wallet balance, which jumps when a
 * faucet grant lands. Those are the only two figures anywhere in Drawbook that genuinely change
 * under a still viewer. The faucet result is not a third element, it IS the balance: `fund()`
 * breaks its poll the moment the balance differs, so the grant arrives as a digit transition on the
 * figure it changed, with the outcome also said in words below. Every other quantity in the product
 * is rendered once on the server and left alone, because animating a number that never moves is
 * decoration impersonating feedback.
 *
 * WORK IN FLIGHT IS A HELD CONTROL, NOT A SPINNER. While a request is out the control sits on
 * `--panel-2`, the raised surface, its word changes to "Connecting" or "Requesting", and
 * `aria-busy` carries it to anyone not looking. That is a fact rather than an animation: it costs
 * no frame, it cannot be out of step with the request, and it survives `prefers-reduced-motion`
 * unchanged, which a frozen spinner does not. The one loop in this product is the ceremony's, and a
 * second one beside a wallet button would compete with it for the claim that movement means
 * something is happening.
 *
 * THE FAUCET ANSWERS IN WORDS, INCLUDING WHEN IT ANSWERS WITH NOTHING. `fund()` asks for 1 RLO and
 * then reads the balance twelve times, a second apart, breaking as soon as it moves. If all twelve
 * pass unchanged the store simply clears `funding` and says nothing at all, which from the outside
 * is indistinguishable from a grant that landed silently. So the outcome is composed here, in the
 * click handler, by comparing the balance before the request with the balance after `fund()`
 * settles. No effect, no timer and no state written during render: the handler is already the
 * moment both figures are known.
 *
 * NOTHING HERE IS EVER THE SIGNAL HUE, and after this pass that is literal: `--event` appears
 * nowhere in the file. It is ceremonial in this system, meaning a winner, a paid stamp, a countdown
 * in its final hour. An error printed in it would read as a win from the corner of the eye, and a
 * connected-dot drawn in it would spend the ceremony's colour on a constant. RPC failures are plain
 * text at `--fg-3`, 5.73 on the page, with the full message on the title where 22 characters is not
 * enough, and with the control's own word changing so a failure is legible at 390 too.
 *
 * WIDTH IS THE CONSTRAINT THE MASTHEAD HANDED DOWN. That bar is one line, 56px, at every width, and
 * it drops its four destinations below 1024 to make room for these chips rather than dropping the
 * chips. So the two facts a testnet product must not lose, which chain you are on and whether you
 * are connected to it, are present at every width, and the parts that can be said with an icon plus
 * an accessible name are said that way until 1280 has room for their words: the faucet and forget
 * controls print an icon alone below `xl`, the height joins the net chip at `sm`, and the balance
 * joins the wallet chip at `sm`. Every one of them keeps its full label in the accessibility tree
 * at every width.
 *
 * CONTRAST, COMPUTED against the surface each token actually sits on, formula sanity-checked at
 * white on black = 21.00. On `--panel` #e9eaf6, the masthead: --fg 15.01, --fg-2 7.60, --fg-3 5.73,
 * --bound 5.18. On `--panel-2` #dfe1f1, which is the hover and held surface and the only other
 * ground any of this text ever sits on: --fg 13.82, --fg-2 7.00, --fg-3 5.27, --bound 4.77. Every
 * text pair clears AA at 4.5 on both, and `--bound`, the only non-text thing drawn here, clears the
 * 3:1 that SC 1.4.11 asks of a control boundary on both.
 */

/**
 * The chip shell, shared by both chips and by the two controls, so a boundary drawn here is the
 * same boundary `BackLink` draws two elements to the left. Padding matches it exactly rather than
 * the preview's 9px by 5px, because three bordered objects on one line have to share a height.
 */
const CHIP =
  "label inline-flex items-center gap-1.5 border border-bound px-2 py-1.5 transition-colors duration-[var(--t-open)] ease-settle";

/**
 * 11px, from the label step, without the label step's 0.14em tracking. `text-label` carries both
 * and would overwrite a figure's own spacing, since both are utilities and the size one is emitted
 * second. This is the same inline escape `components/row.tsx` uses on the serial.
 */
const SMALL = { fontSize: "var(--text-label)" } as const;

/**
 * The two digit timings, as literals that mirror `--t-settle` and `--t-grow` on
 * `--ease-settle`. They cannot be read from CSS here: this component renders on the server first,
 * where there is no computed style to read, and a value read after mount would animate the first
 * paint differently from every one after it. If a duration below ever disagrees with globals.css,
 * globals.css is right.
 */
const SETTLE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const TICK = { duration: 320, easing: SETTLE };
const LAND = { duration: 460, easing: SETTLE };

/* ------------------------------------------------------------------------ the chain */

/**
 * Which chain, and one live figure proving it is answering.
 *
 * `Rialo` is dropped below 1280 and the height below 640, in that order, because the word "Testnet"
 * alone is still unambiguous on a product that ships against one chain, while a height with no word
 * is a number with no unit.
 */
export function NetChip() {
  const { height } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <span className={`${CHIP} shrink-0 text-fg-3`}>
      <span className="hidden xl:inline">Rialo</span>
      <span className="text-fg">Testnet</span>

      {/* Hidden as a group below 640, so the name the number needs goes with it. */}
      <span className="hidden items-baseline gap-1.5 sm:inline-flex">
        <span className="sr-only">Block height</span>
        {height === null ? (
          <span>No block yet</span>
        ) : (
          <NumberFlow
            value={height}
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

/* ----------------------------------------------------------------------- the wallet */

export function WalletChip() {
  const { wallet, balance, funding, usedLocalKey, status, error } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  /**
   * What the faucet did last, in words. Null until it has done anything.
   *
   * Held here rather than in the store because it is a fact about this session's last click, not
   * about the chain, and `lib/wallet-store.ts` is not ours to change in this port.
   */
  const [faucetNote, setFaucetNote] = useState<string | null>(null);

  const connecting = status === "loading";

  /**
   * A connect that failed has to say so in the one place that is on screen at 390, which is the
   * control itself. The sentence lives in `Note` and `Note` is `xl` and up, so below that the only
   * account of a failure was the live region, and a sighted phone user got a button that looked
   * untouched. The word changing to "Try again" is the same claim at every width, and it costs no
   * width because it is shorter than the label it replaces.
   */
  const failed = status === "error";

  /**
   * Ask, wait for the store to settle, then say what happened.
   *
   * `fund()` resolves in its own `finally`, after `funding` has gone back to false and after the
   * balance it found has been published, so both readings are available on the line after the
   * await. Reading the store directly rather than the render's closure is deliberate: `balance`
   * captured at click time would be up to six seconds stale.
   */
  async function requestFaucet() {
    const before = getSnapshot().balance;
    setFaucetNote(null);

    await fund();

    const after = getSnapshot();
    if (after.error !== null) {
      // The error line says it better than a second sentence would.
      setFaucetNote(null);
      return;
    }

    /*
     * Four outcomes, because three of them are not "nothing landed".
     *
     * `before` is null when the balance has never been read, which is reachable: `connect()` polls
     * once and that poll can fail, leaving a connected wallet with no figure. Folding that into
     * the "nothing landed" branch made the product claim the faucet had failed when what actually
     * happened was that it had never been able to compare. Each case below says only what is known.
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
    disconnect();
  }

  /**
   * One line, in priority order: what broke, then what the faucet did, then what kind of key this
   * is. Only one of the three can be true enough to be worth the room, and the room is at most 22
   * characters and often fewer, since this is the one element in the bar allowed to shrink.
   */
  const note = error
    ? error
    : funding
      ? "Requesting 1 RLO from the testnet faucet."
      : (faucetNote ??
        (wallet && usedLocalKey ? "Burner key, generated and held in this browser." : null));

  if (!wallet) {
    return (
      /*
        min-w-0 AND NOT shrink-0, WHICH IS THE OPPOSITE OF EVERY OTHER CHILD OF THE MASTHEAD, and it
        is what keeps the bar inside 1280. Measured in Chromium at exactly xl: the lockup, the four
        destinations, the back affordance and both chips in their widest form leave about 145px of
        measure, and 22ch of 11px label type is about 145px, so the note landed 17px over and pushed
        the bar into a horizontal scroll. Making this wrapper rigid made the SENTENCE rigid, which is
        the one thing in here that should give way: it is the only child with a `title` carrying the
        whole string and the only one whose meaning survives being cut. So the wrapper shrinks, every
        chip and control inside it is pinned `shrink-0` so none of them can clip an address or a
        figure, and `Note` alone takes the shortfall through its own `min-w-0` and truncates.
      */
      <span className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => void connect()}
          disabled={connecting}
          aria-busy={connecting}
          title={failed && error ? error : undefined}
          className={`${CHIP} shrink-0 text-fg disabled:cursor-not-allowed ${
            connecting ? "bg-panel-2" : "hover:bg-panel-2"
          }`}
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
        <Note text={note} />
      </span>
    );
  }

  return (
    /* Shrinks, and only `Note` inside it does. See the note on the disconnected branch above. */
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`${CHIP} shrink-0 text-fg`} title={wallet.address}>
        {/*
          THE PREVIEW'S 6px IRIS SQUARE IS NOT PORTED, AND THE OMISSION IS THE SAME ONE THE
          MASTHEAD ALREADY MADE. `.chip .dot` in cell.html is drawn on both chips and flips to
          --ink-3 through `.chip.off` when the demo toggles the wallet away. Here there is no off
          state to draw: this whole chip is behind `if (!wallet)`, so the square would be iris on
          every frame it ever rendered, which is a constant claiming to be a reading. The address
          beside it is the same claim made with data, and it is the data you would need anyway.
          It would also have been the one --event in this file, against the rule stated above.
        */}
        <span className="sr-only">Wallet</span>
        {/* An address is base58 and case carries meaning, so the chip's label voice is undone
            here: `normal-case` against the uppercase, `tracking-normal` against the 0.14em. */}
        <span className="mono normal-case tracking-normal text-fg-2" style={SMALL}>
          {shortAddress(wallet.address, 4, 4)}
        </span>

        {/*
          A BALANCE OF NULL IS NOT A BALANCE OF ZERO, and the two are a second apart on this chip.
          `balance` is null from the moment a wallet loads until the first `getBalance` answers, and
          it stays null if that call fails. Coercing it with `?? 0` printed a confident 0.000 RLO
          over an unfunded-looking wallet that the node had simply not been asked about yet, which
          is the one reading that would send someone to the faucet for no reason. So the figure is
          withheld until there is one, the same way NetChip withholds the height.
        */}
        <span className="hidden items-baseline gap-1 sm:inline-flex">
          <span className="sr-only">Balance</span>
          {/*
            "Not read yet" and not "No balance yet", by measurement: the wallet chip is `shrink-0`
            so whatever sits here is rigid, and the two extra characters pushed the bar 8px past
            640, which is the exact width where the wordmark returns and the destinations have not
            yet left. Twelve characters is what fits, and it is also what NetChip spends on "No
            block yet". The word this drops is carried by the `sr-only` "Balance" one element up,
            so the announcement is still "Balance, not read yet".
          */}
          {balance === null ? (
            <span className="text-fg-3">Not read yet</span>
          ) : (
            <>
              <NumberFlow
                value={balance / KELVIN}
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
              <span className="text-fg-3">RLO</span>
            </>
          )}
        </span>
      </span>

      <button
        type="button"
        onClick={() => void requestFaucet()}
        disabled={funding}
        aria-busy={funding}
        aria-label={
          funding
            ? "Requesting 1 RLO from the testnet faucet"
            : "Request 1 RLO from the testnet faucet"
        }
        title="Request 1 RLO from the testnet faucet"
        className={`${CHIP} shrink-0 text-fg disabled:cursor-not-allowed ${
          funding ? "bg-panel-2" : "hover:bg-panel-2"
        }`}
      >
        <ArrowDown size={11} weight="bold" aria-hidden="true" />
        <span className="hidden xl:inline">{funding ? "Requesting" : "Faucet"}</span>
      </button>

      <button
        type="button"
        onClick={forget}
        aria-label="Forget this wallet"
        title="Forget this wallet"
        className={`${CHIP} shrink-0 text-fg-3 hover:bg-panel-2 hover:text-fg`}
      >
        <SignOut size={11} weight="bold" aria-hidden="true" />
        <span className="hidden xl:inline">Forget</span>
      </button>

      <Note text={note} />
    </span>
  );
}

/**
 * The one sentence of running text in the masthead, said twice.
 *
 * The live region is unconditional and screen-reader only, so an error or a faucet outcome is
 * announced at every width. The visible copy is the same string, printed only where 22 characters
 * fit, and it is `aria-hidden` so the announcement is not doubled. Two elements rather than one
 * because a `sr-only` toggled off by a breakpoint would have to fight `truncate` for
 * `white-space`, and both are utilities in the same layer.
 */
function Note({ text }: { text: string | null }) {
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {text}
      </span>
      {text === null ? null : (
        <span
          aria-hidden="true"
          title={text}
          className="hidden min-w-0 max-w-[22ch] truncate text-fg-3 xl:block"
          style={SMALL}
        >
          {text}
        </span>
      )}
    </>
  );
}
