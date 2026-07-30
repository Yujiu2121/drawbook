import Link from "next/link";
import { Plus } from "@phosphor-icons/react/dist/ssr";

import { ActivityFeed } from "@/components/activity-feed";
import { HowItWorks } from "@/components/how-it-works";
import { Masthead } from "@/components/masthead";
import { SiteFooter } from "@/components/site-footer";
import { RaffleBoard } from "@/components/raffle-board";
import { MOCK_RAFFLES, NOW, VIEWER } from "@/lib/mock-raffles";
import { activityOf } from "@/lib/raffle";

export default function Page() {
  // One feed across every raffle, newest first.
  const events = MOCK_RAFFLES.flatMap(activityOf).sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  );

  return (
    <>
      <Masthead />
      <main className="mx-auto w-full max-w-[1180px] px-5 pb-16">
        <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 pt-10">
          <div>
            <h1 className="text-display font-medium">Raffles</h1>
            <p className="mt-4 max-w-[52ch] text-base text-text-2">
              Every buyer commits a secret when they take a ticket. The winner falls out of all the
              secrets together, so nobody picks it and anyone can recompute it.
            </p>
          </div>

          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-control border border-line-2 px-4 py-2.5 text-sm text-text transition-colors hover:border-accent hover:text-accent"
          >
            <Plus size={14} weight="bold" aria-hidden="true" />
            New raffle
          </Link>
        </section>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_20rem]">
          <RaffleBoard raffles={MOCK_RAFFLES} viewer={VIEWER} now={NOW} />

          <div className="flex flex-col gap-5">
            <ActivityFeed events={events} now={NOW} limit={10} />
            <HowItWorks />
          </div>
        </div>

      </main>
      <SiteFooter />
    </>
  );
}
