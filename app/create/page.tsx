"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";

import { Masthead } from "@/components/masthead";
import { SiteFooter } from "@/components/site-footer";
import { Panel } from "@/components/panel";
import { NOW } from "@/lib/mock-raffles";
import { KELVIN_PER_RLO, formatRLO } from "@/lib/raffle";

/**
 * Deploy a raffle.
 *
 * Labels sit above their inputs, every field carries its helper text whether or not it is in
 * error, and errors appear below the field they belong to. No placeholder is used as a label.
 *
 * The submit button does not pretend. No raffle program is deployed on Rialo yet, so instead of
 * faking a success it prints exactly what would be submitted: the two derived deadlines and the two
 * Subscriber subscriptions that would carry them. Those two predicates are the whole reason this
 * belongs on Rialo, so showing them is more useful than a spinner and a toast.
 */

const SUBSCRIBER_PROGRAM = "Subscriber111111111111111111111111111111111";

interface Field {
  value: string;
  error: string | null;
}

const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

function NumberField({
  label,
  unit,
  hint,
  range,
  value,
  onChange,
  error,
  step = "any",
}: {
  label: string;
  unit?: string;
  hint: string;
  range?: string;
  value: string;
  onChange: (next: string) => void;
  error: string | null;
  step?: string;
}) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <div className="px-6 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <span className="tnum text-xs text-text-3">{unit ?? range}</span>
      </div>

      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        className={`tnum mt-2 w-full rounded-control border bg-sunken px-3 py-2.5 text-lg text-text outline-none transition-colors focus:border-accent ${
          error ? "border-accent" : "border-line-2"
        }`}
      />

      {error ? (
        <p className="mt-2 text-xs text-accent">{error}</p>
      ) : (
        <p id={`${id}-hint`} className="mt-2 text-xs text-text-3">
          {hint}
        </p>
      )}
    </div>
  );
}

export default function CreatePage() {
  const [prize, setPrize] = useState<Field>({ value: "12", error: null });
  const [ticket, setTicket] = useState<Field>({ value: "0.25", error: null });
  const [bond, setBond] = useState<Field>({ value: "0.1", error: null });
  const [supply, setSupply] = useState<Field>({ value: "40", error: null });
  const [winners, setWinners] = useState<Field>({ value: "1", error: null });
  const [saleDays, setSaleDays] = useState("3");
  const [saleHours, setSaleHours] = useState("0");
  const [revealHours, setRevealHours] = useState("24");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const derived = useMemo(() => {
    const p = num(prize.value);
    const t = num(ticket.value);
    const n = num(supply.value);
    const w = num(winners.value);
    const saleMs =
      (Number(saleDays || "0") * 24 + Number(saleHours || "0")) * 3_600_000;
    const revealMs = Number(revealHours || "0") * 3_600_000;

    const commitAt = new Date(NOW.getTime() + saleMs);
    const revealAt = new Date(commitAt.getTime() + revealMs);
    const maxPool = (Number.isFinite(p) ? p : 0) + (Number.isFinite(t) && Number.isFinite(n) ? t * n : 0);
    const perWinner = Number.isFinite(w) && w > 0 ? maxPool / w : 0;

    return { commitAt, revealAt, maxPool, perWinner, saleMs, revealMs };
  }, [prize.value, ticket.value, supply.value, winners.value, saleDays, saleHours, revealHours]);

  function validate(): boolean {
    let good = true;
    const check = (
      field: Field,
      setter: (f: Field) => void,
      test: (v: number) => string | null,
    ) => {
      const message = test(num(field.value));
      setter({ ...field, error: message });
      if (message) good = false;
    };

    check(prize, setPrize, (v) =>
      !Number.isFinite(v) || v <= 0 ? "Put up a prize greater than zero." : null,
    );
    check(ticket, setTicket, (v) =>
      !Number.isFinite(v) || v <= 0 ? "A ticket has to cost something." : null,
    );
    check(bond, setBond, (v) =>
      !Number.isFinite(v) || v < 0 ? "A bond cannot be negative." : null,
    );
    check(supply, setSupply, (v) =>
      !Number.isFinite(v) || v < 2 || v > 200 || v % 1 !== 0
        ? "Between 2 and 200 whole tickets."
        : null,
    );
    check(winners, setWinners, (v) => {
      const n = num(supply.value);
      if (!Number.isFinite(v) || v < 1 || v % 1 !== 0) return "At least one whole winner.";
      if (Number.isFinite(n) && v > n) return "More winners than tickets is not possible.";
      return null;
    });

    if (derived.saleMs <= 0) good = false;
    if (derived.revealMs <= 0) good = false;

    return good;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) {
      setSubmitted(null);
      return;
    }

    // Exactly what would go on chain, in the shapes the real interfaces use.
    setSubmitted(
      JSON.stringify(
        {
          raffle: {
            prize_kelvin: Math.round(num(prize.value) * KELVIN_PER_RLO),
            ticket_price_kelvin: Math.round(num(ticket.value) * KELVIN_PER_RLO),
            reveal_bond_kelvin: Math.round(num(bond.value) * KELVIN_PER_RLO),
            supply: num(supply.value),
            winners: num(winners.value),
            commit_deadline_ms: derived.commitAt.getTime(),
            reveal_deadline_ms: derived.revealAt.getTime(),
          },
          subscriptions: [
            {
              program: SUBSCRIBER_PROGRAM,
              kind: "OneShot",
              predicate: {
                topic: "clock",
                timestamp_range: [derived.commitAt.getTime(), derived.commitAt.getTime() + 60_000],
              },
              action: "close_sale",
            },
            {
              program: SUBSCRIBER_PROGRAM,
              kind: "OneShot",
              predicate: {
                topic: "clock",
                timestamp_range: [derived.revealAt.getTime(), derived.revealAt.getTime() + 60_000],
              },
              action: "draw",
            },
          ],
        },
        null,
        2,
      ),
    );
  }

  return (
    <>
      <Masthead />
      <main className="mx-auto w-full max-w-[1180px] px-5 pb-16">
        <div className="pt-6">
          <Link
            href="/raffles"
            className="inline-flex items-center gap-1.5 text-sm text-text-3 transition-colors hover:text-text"
          >
            <ArrowLeft size={13} weight="bold" aria-hidden="true" />
            All raffles
          </Link>
        </div>

        <div className="pt-6">
          <h1 className="text-display font-medium">Deploy a raffle</h1>
          <p className="mt-3 max-w-[56ch] text-base text-text-2">
            Put up a prize and set the rules. The sale closes and the draw fires on their own, from
            two conditions registered on chain.
          </p>
        </div>

        <form onSubmit={submit} className="mt-8 grid gap-5 lg:grid-cols-[1fr_20rem]">
          <div className="flex flex-col gap-5">
            <Panel label="The prize">
              <div className="divide-y divide-line">
                <NumberField
                  label="Prize amount"
                  unit="RLO"
                  hint="Locked until the draw, then sent to the winners by the draw transaction itself."
                  value={prize.value}
                  onChange={(v) => setPrize({ value: v, error: null })}
                  error={prize.error}
                />
                <NumberField
                  label="Number of winners"
                  range="1 to supply"
                  hint="The pool is split equally, with any rounding remainder going to the first drawn."
                  step="1"
                  value={winners.value}
                  onChange={(v) => setWinners({ value: v, error: null })}
                  error={winners.error}
                />
              </div>
            </Panel>

            <Panel label="The tickets">
              <div className="divide-y divide-line">
                <NumberField
                  label="Ticket price"
                  unit="RLO"
                  hint="Added to the prize pool. Buying a ticket also publishes a commitment to a secret."
                  value={ticket.value}
                  onChange={(v) => setTicket({ value: v, error: null })}
                  error={ticket.error}
                />
                <NumberField
                  label="Max tickets"
                  range="2 to 200"
                  hint="Selling the last one closes the sale early, without waiting for the deadline."
                  step="1"
                  value={supply.value}
                  onChange={(v) => setSupply({ value: v, error: null })}
                  error={supply.error}
                />
                <NumberField
                  label="Reveal bond"
                  unit="RLO"
                  hint="Held per ticket and forfeited to the pool if that holder never reveals. This is what discourages walking away after seeing the other secrets."
                  value={bond.value}
                  onChange={(v) => setBond({ value: v, error: null })}
                  error={bond.error}
                />
              </div>
            </Panel>

            <Panel label="The clock">
              <div className="px-6 py-5">
                <div className="label">Sale runs for</div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {[
                    { label: "Days", value: saleDays, set: setSaleDays },
                    { label: "Hours", value: saleHours, set: setSaleHours },
                  ].map((f) => (
                    <div key={f.label}>
                      <input
                        type="number"
                        min={0}
                        step="1"
                        aria-label={`Sale ${f.label.toLowerCase()}`}
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        className="tnum w-full rounded-control border border-line-2 bg-sunken px-3 py-2.5 text-lg text-text outline-none transition-colors focus:border-accent"
                      />
                      <div className="mt-1 label">
                        {f.label}
                      </div>
                    </div>
                  ))}
                </div>
                {derived.saleMs <= 0 && (
                  <p className="mt-2 text-xs text-accent">The sale needs to last longer than zero.</p>
                )}

                <div className="mt-5 label">
                  Then reveals get
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <input
                      type="number"
                      min={1}
                      step="1"
                      aria-label="Reveal window in hours"
                      value={revealHours}
                      onChange={(e) => setRevealHours(e.target.value)}
                      className="tnum w-full rounded-control border border-line-2 bg-sunken px-3 py-2.5 text-lg text-text outline-none transition-colors focus:border-accent"
                    />
                    <div className="mt-1 label">Hours</div>
                  </div>
                </div>
                {derived.revealMs <= 0 && (
                  <p className="mt-2 text-xs text-accent">
                    Holders need some time to reveal, or nobody can.
                  </p>
                )}
                <p className="mt-3 text-xs text-text-3">
                  Both deadlines become absolute timestamps in a reactive predicate. That is the only
                  time primitive Rialo has, and it is exactly the one a raffle needs.
                </p>
              </div>
            </Panel>

            <button
              type="submit"
              className="rounded-control bg-accent px-6 py-4 text-sm font-medium text-page transition-transform active:translate-y-px"
            >
              Review what would be deployed
            </button>

            {submitted && (
              <Panel label="What would go on chain" accent>
                <pre className="tnum overflow-x-auto px-6 py-5 text-xs leading-relaxed text-text-2">
                  {submitted}
                </pre>
                <p className="border-t border-accent px-6 py-4 text-xs text-text-3">
                  Not submitted. No raffle program is deployed on Rialo testnet yet, so this shows
                  the payload rather than inventing a signature.
                </p>
              </Panel>
            )}
          </div>

          <div className="flex flex-col gap-5">
            <Panel label="If it sells out">
              <div className="px-6 py-6 text-center">
                <div className="board-figure text-[2.5rem] font-medium leading-none">
                  {formatRLO(Math.round(derived.maxPool * KELVIN_PER_RLO))}
                </div>
                <div className="mt-2 text-sm uppercase tracking-widest text-text-3">RLO pool</div>
                {/* With a single winner the split repeats the pool, so it is only worth saying
                    once there is actually something to divide. */}
                {num(winners.value) > 1 && (
                  <p className="mt-3 text-sm text-text-2">
                    {formatRLO(Math.round(derived.perWinner * KELVIN_PER_RLO))} RLO to each of{" "}
                    {num(winners.value)} winners
                  </p>
                )}
              </div>
            </Panel>

            <Panel label="Schedule">
              <dl className="divide-y divide-line">
                <div className="px-6 py-3">
                  <dt className="label">Sale closes</dt>
                  <dd className="tnum mt-1 text-sm text-text-2">
                    {derived.commitAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                  </dd>
                </div>
                <div className="px-6 py-3">
                  <dt className="label">Draw fires</dt>
                  <dd className="tnum mt-1 text-sm text-text-2">
                    {derived.revealAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                  </dd>
                </div>
              </dl>
            </Panel>
          </div>
        </form>
      </main>
      <SiteFooter />
    </>
  );
}
