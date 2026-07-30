/**
 * A panel does one job.
 *
 * Padding here is close to double what it was. Space is the cheapest premium signal there is and the
 * only one that cannot be overdone by accident: a page reads expensive because things are far apart
 * and few, not because they are shiny.
 *
 * The depth is one hairline of light along the top edge plus a wide ambient shadow, applied by the
 * `.surface` class. That reads as an object lit from above. A glow would read as a light source that
 * is not there, which is the tell in most attempts at this.
 */
export function Panel({
  label,
  children,
  right,
  accent = false,
  index = 0,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  /** Optional figure or status pinned to the right of the label row. */
  right?: React.ReactNode;
  /** Accent frame, for the one panel on a page that is about the viewer or the result. */
  accent?: boolean;
  /** Position in the stack, so surfaces arrive in reading order rather than all at once. */
  index?: number;
  className?: string;
}) {
  return (
    <section
      className={`surface surface-in border ${accent ? "border-accent/60" : "border-line"} ${className}`}
      style={{ "--index": index } as React.CSSProperties}
    >
      <div
        className={`flex items-baseline justify-between gap-4 border-b px-6 py-3.5 ${
          accent ? "border-accent/40 bg-accent-wash" : "border-line"
        }`}
      >
        <span className={`label ${accent ? "!text-accent" : ""}`}>{label}</span>
        {right && <span className="tnum text-xs text-text-3">{right}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * The one number a screen is about.
 *
 * Centred, alone, and given a great deal of room. The unit sits under it in small caps rather than
 * beside it, so nothing at all shares its line.
 */
export function HeroFigure({
  value,
  unit,
  caption,
}: {
  value: string;
  unit?: string;
  caption?: string;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <div className="board-figure text-[3.75rem] font-medium leading-none sm:text-[4.75rem]">
        {value}
      </div>
      {unit && <div className="label mt-5">{unit}</div>}
      {caption && <div className="mt-3 text-sm text-text-2">{caption}</div>}
    </div>
  );
}

/**
 * Progress as a hairline that fills, with the fraction stated in figures beside it.
 *
 * A bar alone is imprecise and a fraction alone is hard to feel, so both. The track stays a hairline
 * rather than becoming a filled channel, which would read as dashboard furniture.
 */
export function FillBar({
  filled,
  total,
  label,
  note,
  live = false,
}: {
  filled: number;
  total: number;
  label: string;
  note?: string;
  /** True while tickets can still be bought, which is the only state the bar animates in. */
  live?: boolean;
}) {
  const percent = total > 0 ? Math.round((filled / total) * 100) : 0;

  return (
    <div className="px-6 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-text-2">{label}</span>
        <span className="tnum text-xl">
          <span className="text-text">{filled}</span>
          <span className="text-text-3"> / {total}</span>
        </span>
      </div>

      <div
        className="mt-5 h-px w-full bg-line"
        role="img"
        aria-label={`${filled} of ${total}, ${percent} percent`}
      >
        <div
          className={`h-px bg-accent ${live && percent > 0 && percent < 100 ? "bar-live" : ""}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-4 text-xs text-text-3">
        <span className="tnum">{note}</span>
        <span className="tnum">{percent === 100 ? "sold out" : `${percent}% filled`}</span>
      </div>
    </div>
  );
}
