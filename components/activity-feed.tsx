import {
  formatAge,
  formatRLO,
  shortAddress,
  type Activity,
  type ActivityKind,
} from "@/lib/raffle";

/**
 * What has happened, newest first.
 *
 * Kept to one line per event and one column of ages, because a feed's job is to prove the thing is
 * alive at a glance, not to be read closely. Event kinds are named in words rather than given
 * coloured dots: five colours would compete with the single accent this design allows.
 */

const KIND_LABEL: Record<ActivityKind, string> = {
  deployed: "new",
  bought: "buy",
  revealed: "reveal",
  drawn: "win",
  void: "void",
};

function line(event: Activity): string {
  const ticket = event.ticketIndex ? `#${String(event.ticketIndex).padStart(2, "0")}` : "";
  const who = event.actor ? shortAddress(event.actor, 4, 4) : "";

  switch (event.kind) {
    case "deployed":
      return `raffle ${String(event.raffleId).padStart(4, "0")} deployed`;
    case "bought":
      return `${who} took ${ticket}`;
    case "revealed":
      return `${who} revealed ${ticket}`;
    case "drawn":
      return `${ticket} won ${event.amount ? `${formatRLO(event.amount)} RLO` : ""}`.trim();
    case "void":
      return "no reveals, raffle voided";
  }
}

export function ActivityFeed({
  events,
  now,
  limit = 10,
  title = "Activity",
}: {
  events: Activity[];
  now: Date;
  limit?: number;
  title?: string;
}) {
  const shown = events.slice(0, limit);

  return (
    <section aria-labelledby="activity-heading" className="border border-line-2">
      <h2
        id="activity-heading"
        className="border-b border-line px-6 py-3 label"
      >
        {title}
      </h2>

      {shown.length === 0 ? (
        <p className="px-6 py-7 text-sm text-text-3">Nothing has happened yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((event, i) => (
            <li
              key={`${event.kind}-${event.raffleId}-${event.ticketIndex ?? "x"}-${i}`}
              className="flex items-baseline gap-3 px-6 py-2.5"
            >
              <span className="tnum w-8 shrink-0 text-xs text-text-3">
                {formatAge(event.at, now)}
              </span>
              <span
                className={`w-14 shrink-0 text-xs uppercase tracking-wide ${
                  event.kind === "drawn" ? "text-accent" : "text-text-3"
                }`}
              >
                {KIND_LABEL[event.kind]}
              </span>
              <span className="tnum min-w-0 truncate text-xs text-text-2">{line(event)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
