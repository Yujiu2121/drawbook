"use client";

import { useSyncExternalStore } from "react";
import NumberFlow from "@number-flow/react";
import { ArrowDown, CircleNotch, Plugs } from "@phosphor-icons/react/dist/ssr";

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
 * The wallet, against the live Rialo testnet.
 *
 * The block height is shown rather than a pulsing "live" dot. It is the same claim made with data
 * instead of decoration, and unlike a dot it cannot lie: if the number stops climbing, the chain
 * connection is gone.
 *
 * These two figures animate with NumberFlow, and they are the only two that do. A digit transition
 * only means something where the value genuinely changes under the viewer: the height ticks on every
 * poll, and the balance jumps when a faucet grant lands. Every other figure in the app is rendered
 * on the server and left alone, because animating a number that never moves is decoration
 * impersonating feedback.
 */
export function WalletBar() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { wallet, balance, height, funding, usedLocalKey, status, error } = state;

  return (
    <div className="flex items-center gap-3">
      <span className="hidden items-baseline gap-2 sm:flex">
        <span className="label">Testnet</span>
        {height === null ? (
          <span className="tnum text-xs text-text-3">connecting</span>
        ) : (
          <NumberFlow
            value={height}
            format={{ useGrouping: true }}
            className="tnum text-xs text-text-2"
            transformTiming={{ duration: 500, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            spinTiming={{ duration: 500, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
          />
        )}
      </span>

      {wallet ? (
        <>
          <span className="flex items-baseline gap-2 border-l border-line pl-3">
            <span className="tnum text-xs text-text-3" title={wallet.address}>
              {shortAddress(wallet.address, 4, 4)}
            </span>
            <NumberFlow
              value={(balance ?? 0) / KELVIN}
              format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              className="tnum text-sm text-text"
              transformTiming={{ duration: 700, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
              spinTiming={{ duration: 700, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            />
            <span className="text-xs text-text-3">RLO</span>
          </span>

          <button
            type="button"
            onClick={() => void fund()}
            disabled={funding}
            aria-busy={funding}
            className="inline-flex items-center gap-1.5 rounded-control border border-line-2 px-2.5 py-1 text-xs text-text-2 transition-colors hover:border-accent hover:text-accent active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          >
            {funding ? (
              <CircleNotch size={12} weight="bold" className="animate-spin" aria-hidden="true" />
            ) : (
              <ArrowDown size={12} weight="bold" aria-hidden="true" />
            )}
            {funding ? "Funding" : "Faucet"}
          </button>

          <button
            type="button"
            onClick={disconnect}
            className="rounded-control px-1 text-xs text-text-3 transition-colors hover:text-text"
          >
            Forget
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void connect()}
          disabled={status === "loading"}
          className="inline-flex items-center gap-1.5 rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-page transition-transform active:translate-y-px disabled:opacity-60"
        >
          {status === "loading" ? (
            <CircleNotch size={12} weight="bold" className="animate-spin" aria-hidden="true" />
          ) : (
            <Plugs size={12} weight="bold" aria-hidden="true" />
          )}
          Connect wallet
        </button>
      )}

      {/* Said once, quietly, rather than in a modal: this is a burner, not an extension. */}
      {wallet && usedLocalKey && (
        <span className="hidden text-xs text-text-3 lg:block">burner key</span>
      )}

      {error && (
        <span className="hidden max-w-[22ch] truncate text-xs text-accent xl:block" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
