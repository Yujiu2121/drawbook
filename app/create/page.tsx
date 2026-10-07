"use client";

import { useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { motion, useReducedMotion } from "motion/react";

import {
  Cap,
  NETWORK,
  Note,
  PRIMARY,
  RefusalBlock,
  SECONDARY,
  Signature,
  Waiting,
  ZERO,
  describeError,
  figureKelvin,
  formatKelvin,
  parseRLO,
  stampMs,
  storageKeeps,
  useNow,
  useWallet,
  utf8Length,
  type Refusal,
} from "@/components/chain-ui";
import { ChainError, createCost, createRaffle } from "@/lib/chain/actions";
import { createFits, MAX_SUPPLY, MIN_SUPPLY } from "@/lib/chain/program";
import { connect, refreshBalance } from "@/lib/wallet-store";

/**
 * DEPLOY A RAFFLE: THE TICKET PRINTER, NOW WIRED.
 *
 * Half the page is the form and the other half is a specimen ticket that strikes every value as it
 * is typed. That pairing is still the argument: parameters are abstract in a form and concrete on a
 * card, and the card is the thing a buyer ends up holding.
 *
 * WHAT CHANGED, AND WHY EACH CHANGE IS A CORRECTION RATHER THAN A RESTYLE
 *
 * 1. THE BUTTON DEPLOYS. The raffle program is on chain now, so the press signs a real transaction
 *    with the wallet in the masthead: a system CreateAccount for a fresh raffle account and the
 *    program's Create, in one transaction, which also moves the prize in. Success is shown only
 *    after the chain reports the transaction executed, and it shows the real signature and the
 *    real account address. The old "print what would be deployed" strip is gone, because printing a
 *    payload next to a working button would be describing a thing instead of doing it.
 *
 * 2. THE DEADLINES COME FROM THE REAL CLOCK. The old page added the durations to the pinned NOW in
 *    lib/mock-raffles.ts, which is a July instant, so on any later day it printed deadlines months
 *    in the past. The program refuses a commit deadline that is not in the future, so that bug would
 *    now be a refused transaction. Both deadlines are fixed from Date.now() at the moment of the
 *    press, and the specimen previews them from the same clock.
 *
 * 3. MINUTES. A live demonstration needs a two-minute sale, and the old clock only had days and
 *    hours. Both windows take minutes now, with a floor of one minute each: a zero-length window is
 *    a raffle nobody can enter or nobody can reveal in.
 *
 * 4. AMOUNTS ARE EXACT. Every figure is parsed from its text straight into bigint kelvin (see
 *    parseRLO in components/chain-ui.tsx). A float parse of "0.1" is not 0.1, and the program would
 *    record whatever the float said.
 *
 * 5. THE TOKENS ARE THE LIVE ONES. This page was the last route on the Counterfoil names, every one
 *    of which compiles to nothing since the Sweep / Cell reset cleared those namespaces. Everything
 *    below is a role utility from app/globals.css blocks 3 and 4, and the specimen no longer borrows
 *    components/ticket.tsx, which is on the dead names too.
 *
 * Errors appear under the field they belong to, in plain text, told apart from the hint by weight
 * and a rule rather than by colour: the system has no error colour on purpose, and the signal hue
 * means a winner.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

/** An unfilled line on the specimen. A blank field prints as a blank line, never as a zero. */
const BLANK = "·····";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The longest sale and reveal window this form offers; the program allows 31 and 7 days. */
const MAX_SALE = 30 * DAY;
const MAX_REVEAL = 7 * DAY;

/** Digits a clock box takes. Six is far past any window the program allows, and keeps the sum finite. */
const CLOCK_DIGITS = 6;

/* --------------------------------------------------------------------- the form */

interface Form {
  title: string;
  prize: string;
  price: string;
  bond: string;
  supply: string;
  winners: string;
  saleDays: string;
  saleHours: string;
  saleMinutes: string;
  revealHours: string;
  revealMinutes: string;
}

/*
  Defaults sized for testnet rather than for a brochure. The testnet faucet grants 1 RLO a call, so
  a default prize above that would send a first-time deployer to the faucet before they had read
  the form; 0.5 RLO plus rent fits in one grant with room for a ticket. Two minutes of sale is what
  a live demonstration can wait through, and a raffle that sells out closes early anyway.
*/
const DEFAULTS: Form = {
  title: "",
  prize: "0.5",
  price: "0.05",
  bond: "0.02",
  supply: "10",
  winners: "1",
  saleDays: "0",
  saleHours: "0",
  saleMinutes: "2",
  revealHours: "0",
  revealMinutes: "3",
};

type FieldKey = "title" | "prize" | "price" | "bond" | "supply" | "winners" | "sale" | "reveal";

interface Checked {
  title: string;
  prize: bigint;
  price: bigint;
  bond: bigint;
  supply: number;
  winners: number;
  saleMs: number;
  revealMs: number;
}

/** A whole number from a box, or null. Empty is null too: the clock boxes treat it as zero. */
function whole(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/** A duration box, where empty means zero rather than missing. */
function part(text: string): number | null {
  return text.trim() === "" ? 0 : whole(text);
}

function durationMs(days: string, hours: string, minutes: string): number | null {
  const d = part(days);
  const h = part(hours);
  const m = part(minutes);
  if (d === null || h === null || m === null) return null;
  return ((d * 24 + h) * 60 + m) * MINUTE;
}

/**
 * The whole form against the program's own checks, as one pure function of the text. Run on every
 * render, shown only after the first press: a form that shouts at a field nobody has reached yet
 * is shouting at a reader rather than at a value.
 */
function check(form: Form): { ok: Checked | null; errors: Partial<Record<FieldKey, string>> } {
  const errors: Partial<Record<FieldKey, string>> = {};

  const title = form.title.trim();
  if (title === "") errors.title = "Give the raffle a name.";
  else if (utf8Length(title) > 32) {
    errors.title = `That is ${utf8Length(title)} bytes. The title field on chain holds 32.`;
  }

  const prize = parseRLO(form.prize);
  if (prize.error !== null) errors.prize = prize.error;

  const price = parseRLO(form.price);
  if (price.error !== null) errors.price = price.error;
  else if (price.kelvin === ZERO) errors.price = "A ticket has to cost something.";

  const bond = parseRLO(form.bond);
  if (bond.error !== null) errors.bond = bond.error;

  const supply = whole(form.supply);
  if (supply === null || supply < MIN_SUPPLY || supply > MAX_SUPPLY) {
    errors.supply = `Between ${MIN_SUPPLY} and ${MAX_SUPPLY} whole tickets.`;
  }

  const winners = whole(form.winners);
  if (winners === null || winners < 1) errors.winners = "At least one whole winner.";
  else if (supply !== null && winners > supply) {
    errors.winners = "More winners than tickets is not possible.";
  }

  const saleMs = durationMs(form.saleDays, form.saleHours, form.saleMinutes);
  if (saleMs === null) errors.sale = "Whole numbers only.";
  else if (saleMs < MINUTE) errors.sale = "The sale has to run for at least a minute.";
  else if (saleMs > MAX_SALE) errors.sale = "The program allows a sale of up to 30 days.";

  const revealMs = durationMs("0", form.revealHours, form.revealMinutes);
  if (revealMs === null) errors.reveal = "Whole numbers only.";
  else if (revealMs < MINUTE) errors.reveal = "Holders need at least a minute to reveal.";
  else if (revealMs > MAX_REVEAL) errors.reveal = "The program allows up to 7 days (168 hours) to reveal.";

  // The program's own fits rule: everything the raffle could ever hold must fit in a u64. Past it
  // the program refuses with BadConfig; before this check, an amount past a u64 used to wrap and go
  // on chain as a different, tiny figure.
  if (
    prize.error === null &&
    price.error === null &&
    bond.error === null &&
    supply !== null &&
    !errors.supply &&
    !createFits({ prize: prize.kelvin, ticketPrice: price.kelvin, revealBond: bond.kelvin, supply })
  ) {
    errors.price =
      "Too large: the prize plus every ticket and bond, sold out, has to fit in what the chain can count (about 18.4 billion RLO).";
  }

  if (Object.keys(errors).length > 0) return { ok: null, errors };

  return {
    ok: {
      title,
      prize: prize.kelvin as bigint,
      price: price.kelvin as bigint,
      bond: bond.kelvin as bigint,
      supply: supply as number,
      winners: winners as number,
      saleMs: saleMs as number,
      revealMs: revealMs as number,
    },
    errors,
  };
}

/* --------------------------------------------------------------- the deploy run */

/**
 * Where the press is. Each state is a fact the page actually has, never an estimate: "sending"
 * covers signing in this browser and waiting for the chain together, because lib/chain does both
 * inside one promise and reports nothing until the transaction has executed, so a separate
 * "confirming" state would be a guess about when signing ended.
 */
type Stage =
  | { kind: "idle" }
  | { kind: "checking"; since: number }
  | { kind: "short"; cost: bigint; balance: bigint }
  | { kind: "sending"; since: number }
  | {
      kind: "done";
      raffle: string;
      signature: string;
      title: string;
      commitDeadline: number;
      revealDeadline: number;
      cost: bigint;
    }
  | { kind: "failed"; refusal: Refusal; maybeAt: string | null };

/* ------------------------------------------------------------------ small pieces */

/**
 * The input well. Cut into its group rather than raised off it: the group is --panel-2 and the
 * field is the page's own --panel, with a --bound edge (4.77 against --panel-2, 5.18 against
 * --panel) because an input boundary is a control boundary and has to clear 3:1.
 */
const FIELD =
  "figure mt-2 w-full min-w-0 border border-bound bg-panel px-3 py-2.5 text-lg text-fg transition-colors duration-[var(--t-open)] ease-settle hover:border-fg";

/** A refused value: full --fg and a rule, against the hint's --fg-3. Weight, not hue. */
function FieldError({ id, children }: { id?: string; children: string }) {
  return (
    <p id={id} className="mt-2 border-l-2 border-fg pl-2.5 text-sm text-fg">
      {children}
    </p>
  );
}

/**
 * A group of fields on one raised surface. The surface change is what separates the groups, the
 * same device the board uses for its key: a hairline between groups would be the same line that
 * already divides the fields inside them, and the page would read as one long list.
 */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border border-rule bg-panel-2">
      <div className="border-b border-rule px-5 py-3">
        <h2 className="label text-fg-3">{label}</h2>
      </div>
      <div className="divide-y divide-rule">{children}</div>
    </section>
  );
}

function TextField({
  id,
  label,
  meta,
  hint,
  value,
  onChange,
  error,
  inputMode,
  placeholder,
}: {
  id: string;
  label: string;
  /** The unit or the permitted range, printed beside the label and announced with the field. */
  meta?: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  inputMode: "decimal" | "numeric" | "text";
  placeholder?: string;
}) {
  const describedBy = [meta && `${id}-meta`, `${id}-hint`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label text-fg-2">
          {label}
        </label>
        {meta && (
          <span id={`${id}-meta`} className="figure text-sm text-fg-3">
            {meta}
          </span>
        )}
      </div>

      {/*
        type="text" with an input mode, not type="number". A number input refuses a comma as the
        decimal separator in most browsers and silently reports an empty value for it, which would
        throw away half of the input this form promises to accept.
      */}
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={FIELD}
      />

      <p id={`${id}-hint`} className="mt-2 text-sm text-fg-3">
        {hint}
      </p>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

/** A box inside the clock: one unit of one duration. */
function ClockBox({
  id,
  label,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
  describedBy: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label text-fg-2">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={CLOCK_DIGITS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className={FIELD}
      />
    </div>
  );
}

/**
 * A value struck onto the specimen. Re-keyed on its own text, so a changed figure remounts and
 * lands again with the weight of a stamp coming down. Not NumberFlow: a rolling figure in this
 * product means a number that just came off a node, and these move because somebody is typing.
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

/* ------------------------------------------------------------------ the specimen */

function printKelvin(text: string): string {
  const parsed = parseRLO(text);
  return parsed.error === null ? formatKelvin(parsed.kelvin) : BLANK;
}

/**
 * THE SPECIMEN: both halves still joined at the perforation.
 *
 * A joined ticket is teaching rather than reporting: a raffle that has not been deployed has sold
 * nothing, so nothing here has been torn. The halves carry what each will carry for real. The drum
 * half keeps the terms and, once bought, the commitment; the hand half is the buyer's, with the
 * number and the nonce that never leaves their browser until they reveal it.
 *
 * Rebuilt on the cell system rather than borrowed from components/ticket.tsx, whose classes are on
 * the dead Counterfoil names. The card is --panel-2 on the page; the stub is --recess, the same
 * well the payloads sit in, because the hand half is the secret half. The perforation is a dashed
 * --bound rule and nothing more: the old punched notches were discs, and this system has no radius.
 */
function Specimen({
  title,
  prize,
  price,
  bond,
  winners,
  lastSerial,
  closesAt,
  revealsCloseAt,
}: {
  title: string;
  prize: string;
  price: string;
  bond: string;
  winners: string;
  lastSerial: string;
  closesAt: string;
  revealsCloseAt: string;
}) {
  return (
    <div
      className="grid border border-bound bg-panel-2"
      style={{ gridTemplateColumns: "minmax(0,1fr) 1px minmax(0,40%)" }}
    >
      <div className="min-w-0 px-4 py-4 sm:px-5">
        <div className="flex items-baseline justify-between gap-3">
          <Cap>Drawbook</Cap>
          <Cap>Specimen</Cap>
        </div>

        <p className="mt-3 truncate text-base text-fg [font-weight:600]" title={title}>
          <Stamp>{title || BLANK}</Stamp>
        </p>

        <div className="mt-4">
          <Cap>Prize</Cap>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
            <span className="figure text-title break-all text-fg">
              <Stamp>{prize}</Stamp>
            </span>
            <span className="label text-fg-3">RLO</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <Cap>Ticket</Cap>
            <p className="figure mt-1 text-sm break-all text-fg">
              <Stamp>{price}</Stamp>
            </p>
          </div>
          <div className="min-w-0">
            <Cap>Winners</Cap>
            <p className="figure mt-1 text-sm text-fg">
              <Stamp>{winners}</Stamp>
            </p>
          </div>
        </div>

        <div className="mt-4 border-t border-rule pt-3.5">
          <Cap>Sale closes</Cap>
          <p className="figure mt-1 text-sm text-fg">
            <Stamp>{closesAt}</Stamp>
          </p>
          <Cap className="mt-3">Reveals close</Cap>
          <p className="figure mt-1 text-sm text-fg">
            <Stamp>{revealsCloseAt}</Stamp>
          </p>
        </div>

        <p className="mt-4 text-sm text-fg-3">
          This half stays with the raffle account. It carries each buyer&rsquo;s commitment, so
          anyone can check the draw against it later.
        </p>
      </div>

      {/* The perforation: a one-pixel column whose dashed edge is the tear line. */}
      <div aria-hidden="true" className="border-l border-dashed border-bound" />

      <div className="recess min-w-0 bg-recess px-4 py-4 sm:px-5">
        <Cap>Stub</Cap>

        {/* The first serial is not stamped: it is the one number on the card no field can change. */}
        <div className="mt-3">
          <span className="serial block text-title text-fg">01</span>
          <span className="label my-1 block text-fg-3">to</span>
          <span className="serial block text-title text-fg">
            <Stamp>{lastSerial}</Stamp>
          </span>
        </div>

        <div className="mt-4">
          <Cap>Bond</Cap>
          <p className="figure mt-1 text-sm break-all text-fg">
            <Stamp>{bond}</Stamp>
          </p>
        </div>

        <p className="mt-4 text-sm text-fg-2">
          The buyer keeps this half. Their number and nonce are struck here at purchase, and the
          nonce is the one secret in the draw.
        </p>
      </div>
    </div>
  );
}

/**
 * The sheet this raffle will deploy as: every ticket, every cell unsold. The same `.strip` and
 * `.c[data-s="0"]` the board draws, so the preview is the object the board will show, not a picture
 * of it. Decorative, because the specimen above already says the count in words.
 */
function SheetPreview({ supply }: { supply: number }) {
  return (
    <span
      aria-hidden="true"
      className="strip"
      style={{ "--n": String(supply), "--strip-h": "14px" } as CSSProperties}
    >
      {Array.from({ length: supply }, (_, i) => (
        <i key={i} className="c" data-s={0} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------------ route */

export default function CreatePage() {
  const reduce = useReducedMotion();
  const now = useNow();
  const { wallet, balance, status } = useWallet();

  const [form, setForm] = useState<Form>(DEFAULTS);
  const [tried, setTried] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  /*
    Set synchronously at the press and cleared when it settles, so a second press that lands before
    React re-renders the button as disabled cannot send a second Create and a second prize.
  */
  const pressing = useRef(false);

  const { ok, errors } = check(form);
  const shown = tried ? errors : {};

  /*
    A shortfall or a refusal describes the form as it stood when the button was pressed, so an edit
    retires it. A completed deploy is NOT retired by an edit: that raffle exists on chain whatever
    the form says now, and hiding its address because someone touched a field would lose the one
    thing on the page that cannot be produced again.
  */
  const edit = (key: keyof Form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    // A Create that may have landed is not retired either: its address is the way to find out.
    setStage((s) =>
      s.kind === "short" || (s.kind === "failed" && s.maybeAt === null) ? { kind: "idle" } : s,
    );
  };

  const canSign = wallet !== null && wallet.canSign && wallet.privateKey !== undefined;
  const busy = stage.kind === "checking" || stage.kind === "sending";

  /* Read once per wallet: whether its key would survive a reload (see storageKeeps). */
  const walletAddress = wallet?.address ?? null;
  const keeps = useMemo(() => (walletAddress === null ? true : storageKeeps(walletAddress)), [walletAddress]);

  async function deploy(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (!ok || !wallet || !canSign || busy || pressing.current) return;
    pressing.current = true;

    setStage({ kind: "checking", since: Date.now() });
    try {
      const [cost, read] = await Promise.all([createCost(ok.supply, ok.prize), refreshBalance()]);
      if (read !== null && BigInt(read) < cost) {
        setStage({ kind: "short", cost, balance: BigInt(read) });
        return;
      }

      /*
        Fixed here, at the press, from the real clock. The program checks
        now < commit_deadline < reveal_deadline against the chain's clock, and a one minute floor
        leaves room for the few seconds a browser clock and a node clock can disagree by.
      */
      const commitDeadline = Date.now() + ok.saleMs;
      const revealDeadline = commitDeadline + ok.revealMs;

      setStage({ kind: "sending", since: Date.now() });
      const sent = await createRaffle(wallet, {
        title: ok.title,
        prize: ok.prize,
        ticketPrice: ok.price,
        revealBond: ok.bond,
        supply: ok.supply,
        winners: ok.winners,
        commitDeadline,
        revealDeadline,
      });

      setStage({
        kind: "done",
        raffle: sent.raffle,
        signature: sent.signature,
        title: ok.title,
        commitDeadline,
        revealDeadline,
        cost,
      });
      void refreshBalance();
    } catch (error) {
      const refusal = describeError(error);
      if (refusal.code === 5) {
        refusal.text = `${refusal.text} The chain checks the deadlines against its own clock, so if this device's clock is off by more than a minute, set it to automatic and try again.`;
      }
      // A Create whose outcome is unknown may have made the raffle and moved the prize. Its address
      // is shown so it can be opened before anyone presses Deploy again.
      const maybeAt =
        error instanceof ChainError && error.outcome === "unknown" ? error.raffle : null;
      setStage({ kind: "failed", refusal, maybeAt });
    } finally {
      pressing.current = false;
    }
  }

  /* The specimen reads the form as text, so it can print a blank line for a value nobody typed. */
  const saleMs = durationMs(form.saleDays, form.saleHours, form.saleMinutes);
  const revealMs = durationMs("0", form.revealHours, form.revealMinutes);
  /* Only a window the program allows is previewed; anything else is a field error, not a date. */
  const closesAt =
    now > 0 && saleMs !== null && saleMs >= MINUTE && saleMs <= MAX_SALE ? now + saleMs : null;
  const revealsAt =
    closesAt !== null && revealMs !== null && revealMs >= MINUTE && revealMs <= MAX_REVEAL
      ? closesAt + revealMs
      : null;
  const supplyN = whole(form.supply);
  const supplyOk = supplyN !== null && supplyN >= MIN_SUPPLY && supplyN <= MAX_SUPPLY;
  const winnersN = whole(form.winners);

  /* If it sells out: the prize plus every ticket. Bonds are not in it; revealed bonds go back. */
  const prizeK = parseRLO(form.prize);
  const priceK = parseRLO(form.price);
  const maxPool =
    prizeK.error === null && priceK.error === null && supplyOk
      ? (prizeK.kelvin as bigint) + (priceK.kelvin as bigint) * BigInt(supplyN as number)
      : null;
  const perWinner =
    maxPool !== null && winnersN !== null && winnersN > 1 && winnersN <= (supplyN as number)
      ? maxPool / BigInt(winnersN)
      : null;
  const poolFigure = maxPool === null ? null : figureKelvin(maxPool, 8);

  const notice =
    stage.kind === "done"
      ? `Deployed. Raffle account ${stage.raffle}.`
      : stage.kind === "failed"
        ? stage.maybeAt !== null
          ? `Not confirmed. It may have been deployed at ${stage.maybeAt}. ${stage.refusal.text}`
          : `Not deployed. ${stage.refusal.text}`
        : stage.kind === "short"
          ? "Not sent. This wallet does not hold enough to deploy."
          : tried && !ok
            ? "Nothing sent. One or more fields need a different value, and each one says so."
            : "";

  return (
    <main className="pt-mast pb-[clamp(48px,8vw,104px)]">
      <div className="px-gutter pt-[clamp(20px,3vw,36px)]">
        <Link
          href="/raffles"
          className="label inline-flex items-center gap-1.5 text-fg-3 transition-colors hover:text-fg"
        >
          <ArrowLeft size={12} weight="bold" aria-hidden="true" />
          All raffles
        </Link>

        <h1 className="font-serif mt-[clamp(16px,2.4vw,28px)] text-display">Deploy a raffle</h1>
        <p className="mt-4 max-w-[58ch] text-lg text-fg-2">
          Put up a prize and set the rules. Once deployed, the raffle program on Rialo holds the
          money and enforces the terms: it sells tickets until the sale closes, accepts reveals
          until the reveal deadline, and then anyone can press Draw; nothing draws on its own yet.
          You cannot change the terms afterwards. The program itself can still be upgraded by its
          deployer during the testnet period.
        </p>

        <form onSubmit={deploy} noValidate className="mt-[clamp(26px,3.4vw,44px)]">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
            <div className="flex min-w-0 flex-col gap-6">
              <Group label="The raffle">
                <TextField
                  id="title"
                  label="Title"
                  meta={`${utf8Length(form.title.trim())} / 32 bytes`}
                  hint="Stored on chain in the raffle account, as up to 32 bytes of UTF-8. Plain letters are one byte each."
                  value={form.title}
                  onChange={edit("title")}
                  error={shown.title}
                  inputMode="text"
                />
              </Group>

              <Group label="The prize">
                <TextField
                  id="prize"
                  label="Prize amount"
                  meta="RLO"
                  hint="Moved from your wallet into the raffle account by the same transaction that creates it, and paid to the winners. Zero is allowed: the pool is then the ticket money alone."
                  value={form.prize}
                  onChange={edit("prize")}
                  error={shown.prize}
                  inputMode="decimal"
                />
                <TextField
                  id="winners"
                  label="Number of winners"
                  meta="1 to supply"
                  hint="The pool is split equally and any remainder goes to the first ticket drawn. If fewer tickets are revealed than this, only the revealed ones can win."
                  value={form.winners}
                  onChange={edit("winners")}
                  error={shown.winners}
                  inputMode="numeric"
                />
              </Group>

              <Group label="The tickets">
                <TextField
                  id="price"
                  label="Ticket price"
                  meta="RLO"
                  hint="Added to the pool. Buying a ticket also publishes a commitment to a secret that stays in the buyer's browser."
                  value={form.price}
                  onChange={edit("price")}
                  error={shown.price}
                  inputMode="decimal"
                />
                <TextField
                  id="supply"
                  label="Max tickets"
                  meta={`${MIN_SUPPLY} to ${MAX_SUPPLY}`}
                  hint="Selling the last one closes the sale at once, without waiting for the deadline."
                  value={form.supply}
                  onChange={edit("supply")}
                  error={shown.supply}
                  inputMode="numeric"
                />
                <TextField
                  id="bond"
                  label="Reveal bond"
                  meta="RLO"
                  hint="Paid per ticket on top of the price and handed back when the holder reveals. A holder who never reveals forfeits it to the pool, which is what discourages walking away after seeing the other secrets."
                  value={form.bond}
                  onChange={edit("bond")}
                  error={shown.bond}
                  inputMode="decimal"
                />
              </Group>

              <Group label="The clock">
                <div className="px-5 py-4">
                  {/*
                    Fieldsets, because "Minutes" means nothing on its own. The legend is announced
                    in front of each box's own label, so the three arrive as "Sale runs for, Days".
                  */}
                  <fieldset className="min-w-0">
                    <legend className="label p-0 text-fg-3">Sale runs for</legend>
                    <div className="mt-2 grid grid-cols-3 gap-3">
                      <ClockBox
                        id="sale-days"
                        label="Days"
                        value={form.saleDays}
                        onChange={edit("saleDays")}
                        invalid={!!shown.sale}
                        describedBy={shown.sale ? "sale-error clock-note" : "clock-note"}
                      />
                      <ClockBox
                        id="sale-hours"
                        label="Hours"
                        value={form.saleHours}
                        onChange={edit("saleHours")}
                        invalid={!!shown.sale}
                        describedBy={shown.sale ? "sale-error clock-note" : "clock-note"}
                      />
                      <ClockBox
                        id="sale-minutes"
                        label="Minutes"
                        value={form.saleMinutes}
                        onChange={edit("saleMinutes")}
                        invalid={!!shown.sale}
                        describedBy={shown.sale ? "sale-error clock-note" : "clock-note"}
                      />
                    </div>
                    {shown.sale && <FieldError id="sale-error">{shown.sale}</FieldError>}
                  </fieldset>

                  <fieldset className="mt-6 min-w-0">
                    <legend className="label p-0 text-fg-3">Then reveals stay open for</legend>
                    <div className="mt-2 grid grid-cols-3 gap-3">
                      <ClockBox
                        id="reveal-hours"
                        label="Hours"
                        value={form.revealHours}
                        onChange={edit("revealHours")}
                        invalid={!!shown.reveal}
                        describedBy={shown.reveal ? "reveal-error clock-note" : "clock-note"}
                      />
                      <ClockBox
                        id="reveal-minutes"
                        label="Minutes"
                        value={form.revealMinutes}
                        onChange={edit("revealMinutes")}
                        invalid={!!shown.reveal}
                        describedBy={shown.reveal ? "reveal-error clock-note" : "clock-note"}
                      />
                    </div>
                    {shown.reveal && <FieldError id="reveal-error">{shown.reveal}</FieldError>}
                  </fieldset>

                  <p id="clock-note" className="mt-5 text-sm text-fg-3">
                    Both deadlines are fixed when you press Deploy, from this device&rsquo;s clock,
                    and the chain checks every purchase and reveal against its own. When every
                    ticket is revealed the draw can run at once instead of waiting for the reveal
                    deadline.
                  </p>
                </div>
              </Group>

              {/* ---------------------------------------------------- the press */}
              <div className="flex flex-col gap-3">
                {wallet === null ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void connect()}
                      disabled={status === "loading"}
                      className={`${PRIMARY} w-full py-4`}
                    >
                      {status === "loading" ? "Connecting" : "Connect a wallet to deploy"}
                    </button>
                    <Note>
                      Deploying signs a transaction, so it needs a wallet. Connecting makes a
                      testnet key in this browser; the bar at the top shows its balance and can ask
                      the faucet for funds.
                    </Note>
                  </>
                ) : (
                  <>
                    <button
                      type="submit"
                      disabled={!canSign || busy}
                      aria-busy={busy}
                      className={`${PRIMARY} w-full py-4`}
                    >
                      {stage.kind === "checking"
                        ? "Checking the cost"
                        : stage.kind === "sending"
                          ? "Deploying"
                          : `Deploy raffle on ${NETWORK}`}
                    </button>

                    <p className="text-sm text-fg-3">
                      Signing as{" "}
                      <span className="mono break-all text-fg-2">{wallet.address}</span>
                      {balance === null ? (
                        ", balance not read yet."
                      ) : (
                        <>
                          , holding{" "}
                          <span className="figure text-fg-2">
                            {formatKelvin(BigInt(balance))}
                          </span>{" "}
                          RLO.
                        </>
                      )}
                    </p>

                    {canSign && !keeps && (
                      <Note>
                        This browser is not keeping what it stores for this site: site data is
                        blocked, or this is a private window. The wallet&rsquo;s key will be gone at
                        the next reload, and with it this balance and any prize refunded to it if the
                        raffle goes void. Allow this site to store data and reload before deploying.
                      </Note>
                    )}

                    {!canSign && (
                      <Note>
                        This wallet cannot sign in this browser, so it can receive but not deploy.
                        A key made here needs Ed25519 in Web Crypto, which this browser does not
                        offer.
                      </Note>
                    )}
                  </>
                )}

                {stage.kind === "checking" && (
                  <Waiting since={stage.since}>
                    Reading the account rent and your balance before anything is signed.
                  </Waiting>
                )}
                {stage.kind === "sending" && (
                  <Waiting since={stage.since}>
                    Signing in this browser and waiting for the chain to execute the transaction.
                    Nothing is shown as done until it has.
                  </Waiting>
                )}

                {stage.kind === "short" && (
                  <RefusalBlock
                    title="Not sent: not enough in this wallet"
                    refusal={{
                      text: `Deploying this raffle needs ${formatKelvin(stage.cost)} RLO: the rent that keeps the raffle account alive, the prize, and the network fee. This wallet holds ${formatKelvin(stage.balance)} RLO, which is ${formatKelvin(stage.cost - stage.balance)} RLO short. ${
                        NETWORK === "testnet"
                          ? "The faucet button in the bar at the top, the down arrow beside your balance, asks the testnet faucet for 1 RLO at a time."
                          : `Fund this wallet from the ${NETWORK} faucet and press Deploy again.`
                      }`,
                      code: null,
                      logs: [],
                    }}
                  />
                )}

                {stage.kind === "failed" && (
                  <>
                    <RefusalBlock
                      title={stage.maybeAt !== null ? "Not confirmed: it may have been deployed" : "Not deployed"}
                      refusal={stage.refusal}
                    />
                    {stage.maybeAt !== null && (
                      <div className="border border-bound px-4 py-3.5">
                        <p className="text-sm text-fg">
                          If it landed, the raffle is at this address with the prize in it. Open it
                          before pressing Deploy again, or a second raffle takes a second prize.
                        </p>
                        <dl className="mt-2.5">
                          <Signature label="Raffle account, if it landed" value={stage.maybeAt} />
                        </dl>
                        <Link href={`/r/${stage.maybeAt}`} className={`${SECONDARY} mt-3 w-full sm:w-auto`}>
                          Open that address
                          <ArrowRight size={12} weight="bold" aria-hidden="true" />
                        </Link>
                      </div>
                    )}
                  </>
                )}

              {/*
                The result sits directly under the button that produced it. Placed after the
                specimen, it landed a full screen below the press on a phone, where a deploy that
                worked looked like a deploy that did nothing.
              */}
              {stage.kind === "done" && (
                <motion.section
                  aria-labelledby="deployed-heading"
                  className="border border-bound"
                  initial={reduce ? false : { opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE }}
                >
                  <div className="border-b border-rule px-5 py-3">
                    <h2 id="deployed-heading" className="label text-fg">
                      Deployed on {NETWORK}
                    </h2>
                  </div>
                  <div className="grid gap-6 px-5 py-5">
                    <div className="min-w-0">
                      <p className="font-serif text-title [overflow-wrap:anywhere]">{stage.title}</p>
                      <p className="mt-3 max-w-[62ch] text-base text-fg-2">
                        The chain executed the transaction below. It created the raffle account, wrote
                        the terms into it and moved the prize in. The sale closes{" "}
                        <span className="figure whitespace-nowrap text-fg">
                          {stampMs(stage.commitDeadline)}
                        </span>{" "}
                        and reveals close{" "}
                        <span className="figure whitespace-nowrap text-fg">
                          {stampMs(stage.revealDeadline)}
                        </span>
                        .
                      </p>
                      <dl className="mt-5 grid gap-4">
                        <Signature label="Raffle account" value={stage.raffle} />
                        <Signature value={stage.signature} />
                      </dl>
                    </div>
                    <div className="flex min-w-0 flex-col gap-3">
                      <Link href={`/r/${stage.raffle}`} className={`${PRIMARY} w-full py-4`}>
                        Open the raffle
                        <ArrowRight size={12} weight="bold" aria-hidden="true" />
                      </Link>
                      <Link href="/raffles" className={`${SECONDARY} w-full`}>
                        See it on the board
                      </Link>
                      <p className="text-sm text-fg-3">
                        Estimated cost before sending: {formatKelvin(stage.cost)} RLO, rent and prize
                        and fee together. The raffle page is its own permanent address; share it and
                        anyone can buy a ticket there.
                      </p>
                    </div>
                  </div>
                </motion.section>
              )}

                {/* Spoken once, in a sentence; the address and signature are read on their own terms. */}
                <p className="sr-only" role="status">
                  {notice}
                </p>
              </div>
            </div>

            {/* ------------------------------------------------------ the specimen */}
            <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-[calc(var(--mast)+16px)]">
              <div>
                <Cap>Specimen</Cap>
                <p className="mt-2 text-sm text-fg-3">
                  Every field strikes onto the card as you type. Nothing is on chain until you
                  press Deploy and the chain executes it.
                </p>
              </div>

              <Specimen
                title={form.title.trim()}
                prize={printKelvin(form.prize)}
                price={printKelvin(form.price)}
                bond={printKelvin(form.bond)}
                winners={winnersN !== null && winnersN >= 1 ? String(winnersN) : BLANK}
                lastSerial={supplyOk ? String(supplyN).padStart(2, "0") : "··"}
                closesAt={closesAt !== null ? stampMs(closesAt) : BLANK}
                revealsCloseAt={revealsAt !== null ? stampMs(revealsAt) : BLANK}
              />

              {supplyOk && (
                <div>
                  <Cap>The sheet, as it will deploy</Cap>
                  <div className="mt-2.5">
                    <SheetPreview supply={supplyN as number} />
                  </div>
                  <p className="mt-2 text-sm text-fg-3">
                    {supplyN} cells, none sold. The board draws this same bar for every raffle.
                  </p>
                </div>
              )}

              <section className="border border-rule bg-panel-2 px-5 py-5">
                <Cap>If it sells out</Cap>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
                  <span className="monument text-fg" style={{ fontSize: "var(--text-title)" }}>
                    {maxPool === null ? BLANK : (poolFigure ?? formatKelvin(maxPool))}
                  </span>
                  <span className="label text-fg-3">RLO pool</span>
                </div>
                <p className="mt-2 text-sm text-fg-2">
                  {perWinner !== null
                    ? `${formatKelvin(perWinner)} RLO to each of ${winnersN} winners, plus any bonds forfeited by holders who never reveal.`
                    : "The prize plus every ticket, plus any bonds forfeited by holders who never reveal."}
                </p>
              </section>
            </div>
          </div>

        </form>
      </div>
    </main>
  );
}
