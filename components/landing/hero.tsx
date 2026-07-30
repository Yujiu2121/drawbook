"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import NumberFlow from "@number-flow/react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { RevealWords } from "./reveal";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/wallet-store";

/**
 * The hero.
 *
 * Asymmetric split rather than a centred stack, and four text elements at most: headline, subtext,
 * and two links. No eyebrow, no version pill, no trust strip, no tagline under the buttons. It has
 * to fit one viewport, so it uses `min-h-[100dvh]` (not `h-screen`, which jumps when a mobile
 * address bar hides) and caps its top padding.
 *
 * The right-hand side is not a decorative graphic. It is the live testnet: a block height climbing
 * in real time and the two on-chain programs this product depends on, read from the node. A hero
 * asset that is also a working proof beats an illustration of one.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

export function Hero() {
  const reduce = useReducedMotion();
  const { height, epoch, version } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // 92dvh rather than 100: at full height this composition filled under 40% of the screen and read
  // as floating. Tightening the frame and enlarging the type fills it without adding filler
  // elements, which is what the hero-stack limit exists to prevent.
  return (
    <section className="relative flex min-h-[92dvh] items-center">
      <div className="mx-auto grid w-full max-w-[1180px] gap-14 px-5 pb-16 pt-24 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-16">
        <div>
          <h1 className="text-[3.5rem] font-medium leading-[0.9] tracking-[-0.045em] sm:text-[5rem] lg:text-[6.25rem]">
            <RevealWords text="Nobody picks" />
            <br />
            <RevealWords text="the winner." delay={0.16} className="text-accent" />
          </h1>

          <motion.p
            className="mt-8 max-w-[46ch] text-lg text-text-2"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5, ease: EASE }}
          >
            Every buyer commits a secret. The winner falls out of all of them at once, and anyone can
            check it.
          </motion.p>

          <motion.div
            className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.66, ease: EASE }}
          >
            <Link
              href="/raffles"
              className="group inline-flex items-center gap-2 rounded-control bg-accent px-6 py-3.5 text-sm font-medium text-page transition-transform active:translate-y-px"
            >
              Open the app
              <ArrowRight
                size={15}
                weight="bold"
                aria-hidden="true"
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
            <Link
              href="/create"
              className="text-sm text-text-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-text"
            >
              Deploy a raffle
            </Link>
          </motion.div>
        </div>

        <motion.div
          className="surface border border-line"
          initial={reduce ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.34, ease: EASE }}
        >
          <div className="flex items-baseline justify-between border-b border-line px-6 py-3.5">
            <span className="label">Rialo testnet</span>
            <span className="label">live</span>
          </div>

          <div className="px-6 py-8 text-center">
            {height === null ? (
              <div className="board-figure text-[2.75rem] leading-none text-text-3">------</div>
            ) : (
              <NumberFlow
                value={height}
                format={{ useGrouping: true }}
                className="board-figure text-[2.75rem] leading-none"
                transformTiming={{ duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
                spinTiming={{ duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
              />
            )}
            <div className="label mt-4">Blocks produced</div>
          </div>

          <dl className="divide-y divide-line border-t border-line">
            {[
              ["Node", version ?? "reading"],
              ["Epoch", epoch === null ? "reading" : String(epoch)],
              ["Subscriber program", "deployed"],
              ["Token-2022", "deployed"],
              ["Faucet", "open"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 px-6 py-3">
                <dt className="text-sm text-text-2">{k}</dt>
                <dd className="tnum text-sm text-accent">{v}</dd>
              </div>
            ))}
          </dl>
        </motion.div>
      </div>
    </section>
  );
}
