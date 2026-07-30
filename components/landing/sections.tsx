"use client";

import Image from "next/image";
import { useRef, useSyncExternalStore } from "react";
import NumberFlow from "@number-flow/react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

import { Reveal, RevealItem, RevealList } from "./reveal";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/wallet-store";

/**
 * The remaining landing sections. Each uses a different layout family on purpose: a full-width
 * statement, a full-bleed media shot, an asymmetric grid and a figure row. Sections that all shared
 * one family would read as a template regardless of how good each was.
 */

/* ------------------------------------------------ full-width statement */

/**
 * The honest version of the differentiator.
 *
 * Every claim here was verified against the platform rather than assumed, which is why it is stated
 * this plainly. Rialo's `get_random_seed()` really does return a bare u64 with no proof, and there
 * really is no VRF anywhere in the platform.
 */
export function Statement() {
  return (
    <section className="border-y border-line bg-sunken">
      <div className="mx-auto max-w-[1180px] px-5 py-24">
        <Reveal>
          <p className="max-w-[34ch] text-[2rem] font-medium leading-[1.1] tracking-[-0.025em] sm:text-[2.75rem]">
            Most on-chain raffles ask you to trust the chain&rsquo;s randomness.
          </p>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mt-8 max-w-[62ch] text-lg text-text-2">
            Rialo&rsquo;s randomness is a bare 64-bit number with no proof attached, and there is no
            verifiable beacon anywhere on the platform. If that seed comes from state a block producer
            controls, a producer can grind the outcome. So this raffle does not lean on it. The
            participants supply the entropy, and the chain seed is only mixed in on top.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* --------------------------------------------------- full-bleed media */

/**
 * The product, photographed rather than illustrated.
 *
 * This is a real screenshot of the running app, captured through the browser, not a mock built from
 * styled divs. A fake product preview is the most common tell on a software landing page, and there
 * is no reason to fake one when the app exists.
 */
export function ProductShot() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  // A shallow drift, so the shot settles as it crosses the fold rather than sliding past.
  const y = useTransform(scrollYProgress, [0, 1], ["4%", "-4%"]);

  return (
    <section className="mx-auto max-w-[1180px] px-5 py-24" aria-labelledby="app-heading">
      <Reveal>
        <h2
          id="app-heading"
          className="max-w-[26ch] text-[2.5rem] font-medium leading-[1.02] tracking-[-0.03em] sm:text-[3.5rem]"
        >
          Everything a draw did, on one page.
        </h2>
        <p className="mt-6 max-w-[56ch] text-lg text-text-2">
          The pool, the tickets taken, who revealed and who did not, and the seed rebuilt in your own
          browser so the winner can be checked rather than believed.
        </p>
      </Reveal>

      <div ref={ref} className="mt-14 overflow-hidden border border-line-2">
        <motion.div style={reduce ? undefined : { y }}>
          <Image
            src="/shots/board.webp"
            alt="The Drawbook raffle board, showing a live prize pool, a countdown to the reveal deadline, and a feed of ticket purchases and reveals."
            width={1600}
            height={1025}
            className="w-full"
            sizes="(min-width: 1180px) 1140px, 100vw"
          />
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------- asymmetric grid */

const PREDICATES = [
  {
    k: "When the sale closes",
    v: "An absolute timestamp predicate. It is the only time primitive Rialo has, and it happens to be exactly the one a raffle needs.",
  },
  {
    k: "When the last ticket sells",
    v: "An event topic, emitted by the purchase itself. The sale can close early without anything watching for it.",
  },
];

export function WhyRialo() {
  return (
    <section className="border-t border-line" aria-labelledby="rialo-heading">
      <div className="mx-auto max-w-[1180px] px-5 py-24">
        <div className="grid gap-14 lg:grid-cols-[1fr_0.8fr] lg:gap-20">
          <div>
            <span className="label">Why it runs on Rialo</span>
            <h2
              id="rialo-heading"
              className="mt-4 max-w-[22ch] text-[2.5rem] font-medium leading-[1.02] tracking-[-0.03em] sm:text-[3.25rem]"
            >
              No bot fires the draw.
            </h2>
            <p className="mt-6 max-w-[52ch] text-lg text-text-2">
              On other chains a raffle needs a keeper: a server, awake, holding a funded key, polling
              for a deadline it might miss. Here both conditions are registered on chain and the
              validators evaluate them.
            </p>

            <RevealList className="mt-10 divide-y divide-line border-t border-line">
              {PREDICATES.map((p) => (
                <RevealItem key={p.k} className="py-6">
                  <h3 className="text-lg">{p.k}</h3>
                  <p className="mt-2 max-w-[48ch] text-base text-text-2">{p.v}</p>
                </RevealItem>
              ))}
            </RevealList>
          </div>

          <Reveal delay={0.1} className="lg:pt-16">
            <div className="overflow-hidden border border-line-2">
              <Image
                src="/shots/deploy.webp"
                alt="The deploy form, showing the prize, ticket price, supply, winner count and the two deadlines that become on-chain predicates."
                width={1600}
                height={1025}
                className="w-full"
                sizes="(min-width: 1180px) 480px, 100vw"
              />
            </div>
            <p className="mt-4 text-sm text-text-3">
              Setting the two deadlines is the whole of the automation.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------- figure row */

/** Real testnet figures, read from the node and climbing while you look at them. */
export function LiveFigures() {
  const { height, txCount, epoch, version } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const figures: { label: string; value: number | null; suffix?: string }[] = [
    { label: "Blocks", value: height },
    { label: "Transactions", value: txCount },
    { label: "Epoch", value: epoch },
  ];

  return (
    <section className="border-y border-line bg-sunken" aria-labelledby="live-heading">
      <div className="mx-auto max-w-[1180px] px-5 py-20">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
          <h2 id="live-heading" className="text-lg">
            Rialo testnet, right now
          </h2>
          <p className="tnum text-sm text-text-3">{version ?? "reading the node"}</p>
        </div>

        <dl className="mt-10 grid grid-cols-1 gap-y-10 sm:grid-cols-3 sm:gap-y-0 sm:divide-x sm:divide-line">
          {figures.map((f, i) => (
            <div key={f.label} className={i === 0 ? "sm:pr-8" : "sm:px-8"}>
              <dt className="label">{f.label}</dt>
              <dd className="mt-4">
                {f.value === null ? (
                  <span className="board-figure text-[2.5rem] leading-none text-text-3">-----</span>
                ) : (
                  <NumberFlow
                    value={f.value}
                    format={{ useGrouping: true }}
                    className="board-figure text-[2.5rem] leading-none"
                    transformTiming={{ duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
                    spinTiming={{ duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
                  />
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
