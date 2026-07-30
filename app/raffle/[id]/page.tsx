import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";

import { ActivityFeed } from "@/components/activity-feed";
import { Masthead } from "@/components/masthead";
import { SiteFooter } from "@/components/site-footer";
import { FillBar, HeroFigure, Panel } from "@/components/panel";
import { MOCK_RAFFLES, NOW, VIEWER, raffleById } from "@/lib/mock-raffles";
import {
  activityOf,
  auditWinners,
  formatCountdown,
  formatRLO,
  payouts,
  secondsBetween,
  shortAddress,
  shortDigest,
  summarize,
  type Phase,
} from "@/lib/raffle";

export function generateStaticParams() {
  return MOCK_RAFFLES.map((r) => ({ id: String(r.config.id) }));
}

const PHASE_LABEL: Record<Phase, string> = {
  selling: "Selling",
  revealing: "Revealing",
  drawn: "Drawn",
  void: "Void",
};

/** Day-first with a three-letter month, read in UTC so a calendar date never shifts a day. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const month = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" })
    .format(d)
    .slice(0, 3);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${month} ${hh}:${mm}`;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-6 py-3">
      <dt className="shrink-0 label">{label}</dt>
      <dd className="tnum min-w-0 truncate text-right text-sm text-text-2">{children}</dd>
    </div>
  );
}

export default async function RafflePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raffle = raffleById(Number(id));
  if (!raffle) notFound();

  const { config, phase } = raffle;
  const s = summarize(raffle);
  const open = phase === "selling" || phase === "revealing";
  const deadline = phase === "selling" ? config.commitDeadline : config.revealDeadline;
  const audit = auditWinners(raffle);
  const paid = payouts(raffle);
  const mine = raffle.tickets.filter((t) => t.holder === VIEWER);
  const holders = [...new Set(raffle.tickets.map((t) => t.holder).filter(Boolean))] as string[];

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

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 pt-6">
          <h1 className="text-display font-medium">
            <span className="text-text-3">Raffle </span>
            <span className="tnum">{String(config.id).padStart(4, "0")}</span>
          </h1>
          <span className={`text-sm uppercase tracking-wider ${open ? "text-accent" : "text-text-3"}`}>
            {PHASE_LABEL[phase]}
          </span>
        </div>
        <p className="mt-3 text-base text-text-2">{config.title}</p>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_20rem]">
          {/* The subject of the page, and nothing shares its line. */}
          <div className="flex flex-col gap-5">
            <Panel label="Total prize pool">
              <HeroFigure
                value={formatRLO(s.pool)}
                unit="RLO"
                caption={
                  s.effectiveWinners > 1
                    ? `${formatRLO(s.perWinner)} RLO each, across ${s.effectiveWinners} winners`
                    : undefined
                }
              />
            </Panel>

            {phase === "drawn" && raffle.winningTickets.length > 0 && (
              <Panel
                label={`${raffle.winningTickets.length} ${raffle.winningTickets.length === 1 ? "winner" : "winners"} declared`}
                accent
              >
                <ul className="divide-y divide-line">
                  {raffle.winningTickets.map((index) => {
                    const ticket = raffle.tickets[index - 1];
                    const isMine = ticket?.holder === VIEWER;
                    return (
                      <li key={index} className="px-6 py-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <span className="tnum text-lg text-accent">
                            #{String(index).padStart(2, "0")}
                          </span>
                          <span className="tnum text-lg">
                            {formatRLO(paid.get(index) ?? 0)}{" "}
                            <span className="text-sm text-text-3">RLO</span>
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                          <span
                            className="tnum min-w-0 truncate text-xs text-text-3"
                            title={ticket?.holder ?? ""}
                          >
                            {ticket?.holder}
                          </span>
                          {isMine && (
                            <span className="text-xs uppercase tracking-wide text-accent">
                              yours
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="border-t border-line px-6 py-4 text-xs text-text-3">
                  Paid out by the draw transaction itself. Nobody clicked anything.
                </p>
              </Panel>
            )}

            {phase === "void" && (
              <Panel label="Voided" accent>
                <p className="px-6 py-6 text-sm text-text-2">
                  Nobody revealed their nonce, so there was no seed material and nothing honest to
                  draw from. Every ticket is refunded and the prize returns to whoever put it up.
                </p>
              </Panel>
            )}

            <Panel label="Tickets sold">
              <FillBar
                filled={s.sold}
                total={config.supply}
                live={phase === "selling"}
                label={`${formatRLO(config.ticketPrice)} RLO each`}
                note={
                  phase === "selling"
                    ? `${s.available} left`
                    : `${s.revealed} of ${s.sold} revealed`
                }
              />
            </Panel>

            {mine.length > 0 && (
              <Panel label={`Your tickets (${mine.length})`} accent>
                <ul className="divide-y divide-line">
                  {mine.map((ticket) => (
                    <li
                      key={ticket.index}
                      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-6 py-4 text-sm"
                    >
                      <span className="tnum text-lg text-accent">
                        #{String(ticket.index).padStart(2, "0")}
                      </span>
                      <span className="tnum text-xs text-text-3">
                        commit {shortDigest(ticket.commitment ?? "")}
                      </span>
                      <span className="ml-auto text-text-2">
                        {ticket.nonce ? "revealed" : "not revealed"}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {holders.length > 0 && (
              <Panel label={`Ticket holders (${holders.length})`}>
                <ul className="flex flex-wrap gap-1.5 px-6 py-5">
                  {holders.map((holder) => (
                    <li key={holder}>
                      <span
                        className={`tnum inline-block border px-2 py-1 text-xs ${
                          holder === VIEWER
                            ? "border-accent text-accent"
                            : "border-line text-text-3"
                        }`}
                        title={holder}
                      >
                        {shortAddress(holder, 4, 4)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          {/* Reference material: true, needed occasionally, never the thing you look at first. */}
          <div className="flex flex-col gap-5">
            <Panel label="Raffle info">
              <dl className="divide-y divide-line">
                <InfoRow label="Creator">
                  <span title={config.creator}>{shortAddress(config.creator, 6, 6)}</span>
                </InfoRow>
                <InfoRow label="Prize">{formatRLO(config.prize)} RLO</InfoRow>
                <InfoRow label="Ticket">{formatRLO(config.ticketPrice)} RLO</InfoRow>
                <InfoRow label="Reveal bond">{formatRLO(config.revealBond)} RLO</InfoRow>
                <InfoRow label="Winners">
                  {s.effectiveWinners > 0 ? s.effectiveWinners : config.winners}
                </InfoRow>
                <InfoRow label="Sale closes">{formatWhen(config.commitDeadline)}</InfoRow>
                <InfoRow label="Draw fires">{formatWhen(config.revealDeadline)}</InfoRow>
                {open && (
                  <InfoRow label="Remaining">
                    <span className="text-accent">
                      {formatCountdown(secondsBetween(NOW, deadline))}
                    </span>
                  </InfoRow>
                )}
              </dl>
            </Panel>

            <ActivityFeed events={activityOf(raffle)} now={NOW} limit={9} />

            {(phase === "drawn" || phase === "void") && (
              <Panel label="Fairness">
                <div className="px-6 py-5">
                  <p className="text-sm text-text-2">
                    Winner recomputed from the published nonces:{" "}
                    <span className={audit?.matches ? "text-accent" : "text-text"}>
                      {audit ? (audit.matches ? "verified" : "mismatch") : "nothing to check"}
                    </span>
                  </p>

                  {audit && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-text-3 transition-colors hover:text-text">
                        Show the working
                      </summary>
                      <dl className="mt-3 space-y-3 text-xs">
                        <div>
                          <dt className="text-text-3">Nonces revealed</dt>
                          <dd className="tnum mt-0.5 text-text-2">
                            {s.revealed} of {s.sold}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-text-3">Chain seed at the draw</dt>
                          <dd className="tnum mt-0.5 break-all text-text-2">
                            {raffle.chainSeed}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-text-3">Draw seed, rebuilt here</dt>
                          <dd className="tnum mt-0.5 break-all text-text-2">{audit.seed}</dd>
                        </div>
                      </dl>
                    </details>
                  )}
                </div>
              </Panel>
            )}
          </div>
        </div>

      </main>
      <SiteFooter />
    </>
  );
}
