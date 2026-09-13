"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { motion, useReducedMotion } from "motion/react";

import { Plate, PlateFigure } from "@/components/panel";
import { Counterfoil, Furniture, Print, Serial, Ticket } from "@/components/ticket";
import { NOW } from "@/lib/mock-raffles";
import { KELVIN_PER_RLO, formatRLO } from "@/lib/raffle";

/**
 * Deploy a raffle: the ticket printer.
 *
 * Half the page is the form and the other half is a specimen ticket being printed as you type. That
 * pairing is the argument. Parameters are abstract in a form and concrete on a card, and the card is
 * the thing a buyer ends up holding, so the prize, the price, the print run, the winner count and
 * both derived deadlines strike onto stock the moment they change.
 *
 * Labels sit above their inputs, every field keeps its helper text whether or not it is in error,
 * and errors appear under the field they belong to in plain text. The signal hue in this system
 * means a winner, a paid stamp or a final hour; a number outside its range is not a ceremony, so it
 * does not get the colour.
 *
 * The submit button does not pretend. No raffle program is deployed on Rialo yet, so rather than
 * faking a signature it tears off a strip of stock carrying the exact payload that would be posted,
 * with the sentence saying so as the strip's first line instead of a footnote below the code. The
 * two Subscriber subscriptions in that payload are the whole reason a raffle belongs on Rialo, so
 * printing them is worth more than a spinner and a toast.
 */

const SUBSCRIBER_PROGRAM = "Subscriber111111111111111111111111111111111";

const EASE = [0.16, 1, 0.3, 1] as const;

interface Field {
  value: string;
  error: string | null;
}

const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

/**
 * An unfilled line on the specimen. A blank field has to print as a blank line, because a card that
 * shows 0.000 for a prize nobody has typed is inventing a figure.
 */
const BLANK = "·····";

function printRLO(value: string): string {
  const n = num(value);
  if (!Number.isFinite(n) || n < 0) return BLANK;
  return formatRLO(Math.round(n * KELVIN_PER_RLO));
}

function printCount(value: string): string {
  const n = num(value);
  if (!Number.isFinite(n) || n < 1 || n % 1 !== 0) return BLANK;
  return String(n);
}

/** The last number in the print run, struck the way a numbering machine strikes it. */
function printSerial(value: string): string {
  const n = num(value);
  if (!Number.isFinite(n) || n < 1 || n % 1 !== 0) return "····";
  return String(Math.min(n, 9999)).padStart(4, "0");
}

function printInstant(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * The input well. A field is cut INTO its plate rather than raised off it, so it takes the room
 * colour with the plate's own hairline around it. Focus is left to the ring in globals.css: a
 * coloured focus border would spend the ceremonial hue on the act of typing into a box.
 */
const FIELD =
  "tnum mt-2 w-full rounded-control border border-line-2 bg-room px-3 py-2.5 text-lg text-text transition-colors hover:border-text-3";

/**
 * A refused value.
 *
 * Told apart from the hint above it by contrast and by the rule beside it, never by colour. Full
 * --text against the plate is 15.2:1 where a hint is 4.98:1, which is a larger perceptual step than
 * a hue change would be, and it costs nothing from the signal budget.
 */
function FieldError({ id, children }: { id?: string; children: string }) {
  return (
    <p id={id} className="mt-2 border-l border-line-2 pl-2.5 text-xs text-text">
      {children}
    </p>
  );
}

/**
 * A value struck onto the specimen.
 *
 * Re-keyed on its own text, so a changed figure remounts and lands again: a short scale settle with
 * the weight of a stamp coming down. NumberFlow is deliberately not used. That component is for
 * figures which move on their own under a still viewer, and these move only because somebody is
 * typing, which a rolling digit animation would misrepresent as live data.
 */
function Stamp({ children, className = "" }: { children: string; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <span className={className}>{children}</span>;

  return (
    <motion.span
      key={children}
      className={`inline-block ${className}`}
      style={{ transformOrigin: "left center" }}
      initial={{ opacity: 0.3, scale: 1.06 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: EASE }}
    >
      {children}
    </motion.span>
  );
}

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

  // The unit or the permitted range is printed beside the label, where sighted readers get it for
  // free. It is named in aria-describedby as well, because "RLO" and "2 to 200" are part of what
  // the field is asking for, and a caller who never sees that row would be typing blind.
  const meta = unit ?? range;
  const describedBy = [meta && `${id}-unit`, `${id}-hint`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label">
          {label}
        </label>
        {meta && (
          <span id={`${id}-unit`} className="tnum text-xs text-text-3">
            {meta}
          </span>
        )}
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
        aria-describedby={describedBy}
        className={FIELD}
      />

      <p id={`${id}-hint`} className="mt-2 text-xs text-text-3">
        {hint}
      </p>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

/**
 * The specimen: both halves still joined at the perforation.
 *
 * A joined ticket is always teaching rather than reporting, and a raffle that has not been deployed
 * has sold nothing, so nothing here has been torn yet. The halves carry what each half will carry
 * for real: the drum keeps the terms and the commitment, the buyer keeps the number and the nonce.
 *
 * Nothing but full ink is printed on the shaded half. --ink-2 measures 4.13:1 on --stock-2 and
 * fails AA, which is why the small line there is full ink at the smallest step rather than Print.
 */
function Specimen({
  prize,
  price,
  bond,
  winners,
  lastSerial,
  closesAt,
  drawsAt,
}: {
  prize: string;
  price: string;
  bond: string;
  winners: string;
  lastSerial: string;
  closesAt: string;
  drawsAt: string;
}) {
  return (
    <Counterfoil
      /* Wide enough that a four-figure serial and a bond both clear the fold on a phone, where the
         card stops being a sidebar and takes the full column. */
      handWidth="42%"
      drum={
        <>
          <div className="flex items-baseline justify-between gap-3">
            <Furniture>Drawbook</Furniture>
            <Furniture>Specimen</Furniture>
          </div>

          <div className="mt-5">
            <Furniture>Prize</Furniture>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="board-figure text-[2rem] leading-none text-ink">
                <Stamp>{prize}</Stamp>
              </span>
              <span className="furniture">RLO</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <Furniture>Ticket</Furniture>
              <p className="tnum mt-1 text-base text-ink">
                <Stamp>{price}</Stamp> RLO
              </p>
            </div>
            <div>
              <Furniture>Winners</Furniture>
              <p className="tnum mt-1 text-base text-ink">
                <Stamp>{winners}</Stamp>
              </p>
            </div>
          </div>

          <div className="mt-5 border-t border-ink-2/40 pt-4">
            <Furniture>Sale closes</Furniture>
            <p className="tnum mt-1 text-sm text-ink">
              <Stamp>{closesAt}</Stamp>
            </p>
            <div className="mt-3">
              <Furniture>Draw fires</Furniture>
              <p className="tnum mt-1 text-sm text-ink">
                <Stamp>{drawsAt}</Stamp>
              </p>
            </div>
          </div>

          <div className="mt-4">
            <Print>
              This half is filed in the drum. It carries the commitment, so anyone can check the
              draw against it later.
            </Print>
          </div>
        </>
      }
      hand={
        <>
          <Furniture>Stub</Furniture>

          {/* The first serial is not stamped, because it is the one number on this card that no
              field can change. Settling it on every keystroke would say otherwise. */}
          <div className="mt-4">
            <Serial>0001</Serial>
            <span className="furniture my-1 block">to</span>
            <Serial>
              <Stamp>{lastSerial}</Stamp>
            </Serial>
          </div>

          <div className="mt-5">
            <Furniture>Bond</Furniture>
            <p className="tnum mt-1 text-base text-ink">
              <Stamp>{bond}</Stamp> RLO
            </p>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-ink">
            The buyer keeps this half. Their number and their nonce are struck here at purchase, and
            the nonce is the one secret in the draw.
          </p>
        </>
      }
    />
  );
}

export default function CreatePage() {
  const reduce = useReducedMotion();

  const [prize, setPrize] = useState<Field>({ value: "12", error: null });
  const [ticket, setTicket] = useState<Field>({ value: "0.25", error: null });
  const [bond, setBond] = useState<Field>({ value: "0.1", error: null });
  const [supply, setSupply] = useState<Field>({ value: "40", error: null });
  const [winners, setWinners] = useState<Field>({ value: "1", error: null });
  const [saleDays, setSaleDays] = useState("3");
  const [saleHours, setSaleHours] = useState("0");
  const [revealHours, setRevealHours] = useState("24");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  /*
    A printed strip describes the form as it stood when the button was pressed. Editing anything
    afterwards would leave a card on the page claiming to be the exact payload while no longer
    being it, so every change retires the strip and the press has to be run again.
  */
  const editField =
    (setter: (next: Field) => void) =>
    (value: string) => {
      setter({ value, error: null });
      setSubmitted(null);
      setNotice("");
    };

  const editClock = (setter: (next: string) => void) => (value: string) => {
    setter(value);
    setSubmitted(null);
    setNotice("");
  };

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

  const saleTooShort = derived.saleMs <= 0;
  const revealTooShort = derived.revealMs <= 0;

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
      setNotice(
        "Nothing printed. One or more fields need a different value, and each one says so.",
      );
      return;
    }

    setNotice(
      "Not submitted. The payload that would be posted is printed at the foot of the form.",
    );

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
      <main className="mx-auto w-full max-w-[1180px] px-5 pb-20">
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
          <h1 className="headline text-display">Deploy a raffle</h1>
          <p className="mt-4 max-w-[56ch] text-base text-text-2">
            Put up a prize and set the rules. The sale closes and the draw fires on their own, from
            two conditions registered on chain.
          </p>
        </div>

        <form onSubmit={submit} className="mt-10">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="flex flex-col gap-6">
              <Plate label="The prize" index={0}>
                <div className="divide-y divide-line">
                  <NumberField
                    label="Prize amount"
                    unit="RLO"
                    hint="Locked until the draw, then sent to the winners by the draw transaction itself."
                    value={prize.value}
                    onChange={editField(setPrize)}
                    error={prize.error}
                  />
                  <NumberField
                    label="Number of winners"
                    range="1 to supply"
                    hint="The pool is split equally, with any rounding remainder going to the first drawn."
                    step="1"
                    value={winners.value}
                    onChange={editField(setWinners)}
                    error={winners.error}
                  />
                </div>
              </Plate>

              <Plate label="The tickets" index={1}>
                <div className="divide-y divide-line">
                  <NumberField
                    label="Ticket price"
                    unit="RLO"
                    hint="Added to the prize pool. Buying a ticket also publishes a commitment to a secret."
                    value={ticket.value}
                    onChange={editField(setTicket)}
                    error={ticket.error}
                  />
                  <NumberField
                    label="Max tickets"
                    range="2 to 200"
                    hint="Selling the last one closes the sale early, without waiting for the deadline."
                    step="1"
                    value={supply.value}
                    onChange={editField(setSupply)}
                    error={supply.error}
                  />
                  <NumberField
                    label="Reveal bond"
                    unit="RLO"
                    hint="Held per ticket and forfeited to the pool if that holder never reveals. This is what discourages walking away after seeing the other secrets."
                    value={bond.value}
                    onChange={editField(setBond)}
                    error={bond.error}
                  />
                </div>
              </Plate>

              <Plate label="The clock" index={2}>
                <div className="px-5 py-4">
                  {/*
                    A fieldset rather than a bare heading, because "Days" and "Hours" mean nothing
                    read on their own. The legend is announced in front of each label, so the two
                    boxes arrive as "Sale runs for, Days" without a redundant aria-label fighting
                    the visible one.
                  */}
                  <fieldset className="min-w-0">
                    <legend className="label p-0">Sale runs for</legend>
                    <div className="mt-1 grid grid-cols-2 gap-3">
                      {[
                        { id: "sale-days", label: "Days", value: saleDays, set: editClock(setSaleDays) },
                        { id: "sale-hours", label: "Hours", value: saleHours, set: editClock(setSaleHours) },
                      ].map((f) => (
                        <div key={f.id}>
                          <label htmlFor={f.id} className="label">
                            {f.label}
                          </label>
                          <input
                            id={f.id}
                            type="number"
                            min={0}
                            step="1"
                            value={f.value}
                            onChange={(e) => f.set(e.target.value)}
                            aria-invalid={saleTooShort ? true : undefined}
                            aria-describedby={
                              saleTooShort ? "sale-error clock-note" : "clock-note"
                            }
                            className={FIELD}
                          />
                        </div>
                      ))}
                    </div>
                    {saleTooShort && (
                      <FieldError id="sale-error">
                        The sale needs to last longer than zero.
                      </FieldError>
                    )}
                  </fieldset>

                  <fieldset className="mt-6 min-w-0">
                    <legend className="label p-0">Then reveals get</legend>
                    <div className="mt-1 grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="reveal-hours" className="label">
                          Hours
                        </label>
                        <input
                          id="reveal-hours"
                          type="number"
                          min={1}
                          step="1"
                          value={revealHours}
                          onChange={(e) => editClock(setRevealHours)(e.target.value)}
                          aria-invalid={revealTooShort ? true : undefined}
                          aria-describedby={
                            revealTooShort ? "reveal-error clock-note" : "clock-note"
                          }
                          className={FIELD}
                        />
                      </div>
                    </div>
                    {revealTooShort && (
                      <FieldError id="reveal-error">
                        Holders need some time to reveal, or nobody can.
                      </FieldError>
                    )}
                  </fieldset>

                  <p id="clock-note" className="mt-5 text-xs text-text-3">
                    Both deadlines become absolute timestamps in a reactive predicate. That is the
                    only time primitive Rialo has, and it is exactly the one a raffle needs.
                  </p>
                </div>
              </Plate>

              {/*
                The primary action is a dark control, not an ivory one. Stock is a material in this
                system rather than an accent, and a button wearing it would read as a third card on
                a page whose whole point is that the card beside it is the only printed object.
              */}
              <button
                type="submit"
                className="rounded-control border border-line-2 bg-plate px-6 py-4 text-sm text-text transition-colors hover:border-text-3 hover:bg-line"
              >
                Print what would be deployed
              </button>

              {/*
                What the button did lands at the foot of a long page, past the specimen and out of
                a screen reader's reading position, so the outcome is also spoken here. Only the
                sentence is announced; the payload itself is read on its own terms further down,
                where a listener can take it line by line rather than in one burst.
              */}
              <p className="sr-only" role="status">
                {notice}
              </p>
            </div>

            <div className="flex flex-col gap-6 lg:sticky lg:top-[4.5rem]">
              <div>
                <span className="label">Specimen</span>
                <p className="mt-2 text-xs text-text-3">
                  Every field strikes onto the card as you type. Nothing is printed for real until
                  the raffle is deployed.
                </p>
              </div>

              <Specimen
                prize={printRLO(prize.value)}
                price={printRLO(ticket.value)}
                bond={printRLO(bond.value)}
                winners={printCount(winners.value)}
                lastSerial={printSerial(supply.value)}
                closesAt={printInstant(derived.commitAt)}
                drawsAt={printInstant(derived.revealAt)}
              />

              <Plate label="If it sells out" index={3}>
                <PlateFigure
                  value={formatRLO(Math.round(derived.maxPool * KELVIN_PER_RLO))}
                  unit="RLO pool"
                  /* With a single winner the split repeats the pool, so it is only worth saying
                     once there is actually something to divide. */
                  caption={
                    num(winners.value) > 1
                      ? `${formatRLO(Math.round(derived.perWinner * KELVIN_PER_RLO))} RLO to each of ${num(winners.value)} winners`
                      : undefined
                  }
                />
              </Plate>
            </div>
          </div>

          {/*
            The payload comes off the press as a strip: torn stock, machine output, and the sentence
            about it not being wired as the first thing printed on it. Put that sentence under the
            code instead and it becomes a disclaimer somebody scrolls past.
          */}
          {submitted && (
            <motion.div
              className="mt-8"
              initial={reduce ? false : { opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              <Ticket torn className="py-6 pr-6">
                {/*
                  The tear is cut as a percentage of the card's width, so it reaches about 57px in
                  from the left on a strip this wide, while the component's own pl-7 is 28px. The
                  content takes a second inset of its own rather than being eaten by the ragged
                  edge, which is a problem a narrow stub never has.
                */}
                <div className="pl-10">
                  <p className="max-w-[70ch] text-base text-ink">
                    Not submitted. No raffle program is deployed on Rialo testnet yet, so this is
                    the exact payload that would be posted, printed rather than signed.
                  </p>

                  <div className="mt-5 border-t border-ink-2/40 pt-4">
                    <Furniture>Payload</Furniture>
                    <pre className="tnum mt-2 overflow-x-auto text-xs leading-relaxed text-ink">
                      {submitted}
                    </pre>
                  </div>

                  <div className="mt-5">
                    <Print className="max-w-[70ch]">
                      The two subscriptions are the argument for building this on Rialo. The sale
                      closes and the draw fires from absolute timestamp predicates the chain
                      already holds, so no bot has to be trusted to press either one.
                    </Print>
                  </div>
                </div>
              </Ticket>
            </motion.div>
          )}
        </form>
      </main>
    </>
  );
}
