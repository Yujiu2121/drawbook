"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Commit, reveal, draw: the substance of the product, as one compact row.
 *
 * This was a sticky-stack, which read well but cost three viewports of scrolling to deliver three
 * short ideas. Now it is a single row that fits one screen.
 *
 * Three equal cards side by side is normally a banned pattern, because it is the default shape for
 * "here are three features" and says nothing about their relationship. It survives here for one
 * reason: these are not three parallel features, they are a sequence, and the order is the entire
 * point of a commit-reveal scheme. So the order is made explicit rather than left implied. A rail
 * runs across the top carrying the step numbers, and it draws itself left to right as the section
 * arrives, which is the one thing a static row of cards cannot say.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

const STEPS = [
  {
    n: "01",
    title: "Commit",
    body: "Your ticket publishes a hash, not a number. Nobody can work out the seed while the sale is open.",
    detail: "SHA256(nonce ‖ holder ‖ ticket)",
  },
  {
    n: "02",
    title: "Reveal",
    body: "Holders publish their secrets once the sale closes. Stay quiet and your bond goes to the pool.",
    detail: "checked against the committed hash",
  },
  {
    n: "03",
    title: "Draw",
    body: "Every secret is hashed together. No one can steer it, and anyone can recompute the winner.",
    detail: "SHA256(all nonces ‖ chain seed)",
  },
];

export function Mechanism() {
  const reduce = useReducedMotion();

  return (
    <section aria-labelledby="mechanism-heading" className="mx-auto max-w-[1180px] px-5 py-24">
      <span className="label">How the draw works</span>
      <h2
        id="mechanism-heading"
        className="mt-4 max-w-[24ch] text-[2.5rem] font-medium leading-[1.02] tracking-[-0.03em] sm:text-[3.5rem]"
      >
        Three steps, and the chain does two of them.
      </h2>

      {/*
        Each piece drives its own whileInView instead of inheriting variants from this wrapper. The
        wrapper had no `variants` of its own, so nothing propagated and the rail silently stayed at
        zero width. Self-contained animations cannot fail that way.
      */}
      <div className="mt-14">
        {/* The rail. Hidden on mobile, where the cards stack and the order is already vertical. */}
        <div className="relative hidden h-px w-full bg-line md:block">
          {/* scaleX, not width: width is a layout property and would reflow on every frame. */}
          <motion.div
            className="absolute inset-y-0 left-0 w-full origin-left bg-accent"
            initial={reduce ? false : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 1.1, ease: EASE }}
          />
          <div className="absolute inset-x-0 -top-[0.5px] grid grid-cols-3">
            {STEPS.map((step, i) => (
              <motion.span
                key={step.n}
                className="tnum w-fit -translate-y-1/2 bg-page pr-3 text-xs text-accent"
                initial={reduce ? false : { opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ delay: 0.25 + i * 0.28, duration: 0.4 }}
              >
                {step.n}
              </motion.span>
            ))}
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-3 md:gap-6">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.n}
              className="surface flex flex-col border border-line px-6 py-7"
              initial={reduce ? false : { opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ delay: 0.2 + i * 0.12, duration: 0.6, ease: EASE }}
            >
              <div className="flex items-baseline gap-3">
                <span className="tnum text-sm text-accent md:hidden">{step.n}</span>
                <h3 className="text-xl font-medium tracking-[-0.01em]">{step.title}</h3>
              </div>
              <p className="mt-3 text-base text-text-2">{step.body}</p>
              <p className="tnum mt-5 border-t border-line pt-3 text-xs text-text-3">
                {step.detail}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
