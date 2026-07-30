/**
 * Reading typography for the two written pages.
 *
 * Kept as explicit components rather than a `.prose` blanket, so the measure, the rhythm and the
 * code styling are all decided here once instead of being inherited from a plugin's opinions. Body
 * text is capped near 68 characters, which is where a line stops being comfortable to track back
 * from at this size.
 */

export function Article({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`max-w-[68ch] ${className}`}>{children}</div>;
}

export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-16 scroll-mt-24 text-[1.75rem] font-medium leading-tight tracking-[-0.02em] first:mt-0"
    >
      {children}
    </h2>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-10 text-lg font-medium">{children}</h3>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-5 text-base leading-relaxed text-text-2">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-5 space-y-3 border-l border-line pl-5">{children}</ul>;
}

export function LI({ children }: { children: React.ReactNode }) {
  return <li className="text-base leading-relaxed text-text-2">{children}</li>;
}

/** Inline code, for identifiers and short expressions. */
export function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="tnum rounded-control bg-sunken px-1.5 py-0.5 text-[0.9em] text-text">
      {children}
    </code>
  );
}

/** A block of code or a formula. Scrolls inside itself so the page never scrolls sideways. */
export function Code({ children }: { children: string }) {
  return (
    <pre className="tnum mt-5 overflow-x-auto border border-line bg-sunken px-5 py-4 text-sm leading-relaxed text-text-2">
      {children}
    </pre>
  );
}

/** A stated fact with its value, for the reference tables. */
export function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-5 divide-y divide-line border-y border-line">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-wrap items-baseline justify-between gap-4 py-3">
          <dt className="text-sm text-text-2">{k}</dt>
          <dd className="tnum text-sm text-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Something the reader should not skip. Uses the single accent, sparingly. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 border-l-2 border-accent bg-sunken px-5 py-4">
      <p className="text-base leading-relaxed text-text-2">{children}</p>
    </div>
  );
}

/** The page title block, shared by both written pages. */
export function PageHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="pt-12">
      <span className="label">{eyebrow}</span>
      <h1 className="mt-4 max-w-[20ch] text-[2.75rem] font-medium leading-[1.02] tracking-[-0.03em] sm:text-[3.5rem]">
        {title}
      </h1>
      <p className="mt-6 max-w-[62ch] text-lg text-text-2">{lede}</p>
    </header>
  );
}
