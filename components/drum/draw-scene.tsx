"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { BEAT, beatOf, cursorAt, flights, pinProgress, poolsOf, sat, seg, type SceneData } from "./geometry";

/**
 * SECTION FIVE, PINNED: SAMPLE 0004'S DRAW, PLAYED BY THE SCROLL.
 *
 * A tall wrapper with a sticky stage inside it. As the reader scrolls through the wrapper the
 * stage stays put and the scroll position walks the draw: the statement leaves, sample 0004's
 * twenty tickets form a grid, the silent ones go dark, light runs through the rest in the order
 * their nonces are hashed, the chain value and the seed arrive, and a cursor walks the pool twice
 * and stops on each winner. Every step is a pure function of that scroll position, so scrolling
 * back rewinds it and nothing runs while the reader is still.
 *
 * WHAT THE SERVER SENDS IS ALREADY THE WHOLE SECTION. The section head, the draw chain with its
 * five values and notes, and the ticket sheet are server-rendered children. With no script, or
 * under a reduced-motion preference, app/drum.css does not pin anything: the stage is ordinary
 * flow and shows the head, the chain and the sheet stacked, which is the section as it read before
 * the drum. The height that makes the scroll walk possible is set by app/drum.css alone, behind a
 * media query that only matches when script runs and motion is allowed, so it is in place on the
 * first paint and nothing below the scene moves when this island hydrates.
 *
 * TWO DRAWINGS OF THE SAME GRID. components/drum/drum-stage.tsx draws the twenty tickets in WebGL
 * over the sheet's own box and, once it has drawn, sets data-drum="on" here, which hides the sheet.
 * Without WebGL the sheet stays, and this island writes the same beats onto its cells as data
 * attributes (a band rising, a silent ticket dimmed, the light in sorted order, the cursor, the
 * winner), which app/drum.css draws. The beat table both read is components/drum/geometry.ts.
 *
 * NOTHING NEW IS SAID. The panel's words are the chain's own: its five names, its values, its
 * notes, and for a pick the three column words of the working ("Pool", "Index", "Ticket"). Its
 * tag is the honesty label built from the serial. The chain itself stays in the DOM as the
 * screen-reader text of all of this, and this island writes data-walk and data-on onto it as the
 * beats pass, exactly as the ceremony's replay used to.
 */

/** Unresolved characters: glyphs that can never be read as a plausible digest or index. */
const GLYPHS = "+*/<>=%#:~^-";

function scramble(n: number): string {
  let o = "";
  for (let c = 0; c < n; c += 1) o += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  return o;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

const REDUCE = "(prefers-reduced-motion: reduce)";

export interface DrawSceneProps {
  data: SceneData;
  /** The section head, rendered by the server. */
  head: ReactNode;
  /** The draw chain, rendered by the server. */
  chain: ReactNode;
  /** The scene raffle's read-only ticket sheet, rendered by the server. */
  sheet: ReactNode;
  /** A link past the scene for keyboard readers, labelled with the next heading's own words. */
  skip: { href: string; label: string };
}

export function DrawScene({ data, head, chain, sheet, skip }: DrawSceneProps) {
  const root = useRef<HTMLDivElement>(null);
  const tag = `Sample raffle ${data.serial} · not on chain`;
  const names = data.links.map((l) => l.name);
  const winners = data.trace.map((s) => s.winner);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = window.matchMedia(REDUCE);
    const pinned = window.matchMedia("(prefers-reduced-motion: no-preference) and (scripting: enabled)");
    if (reduce.matches || !pinned.matches) return;

    const stage = el.querySelector<HTMLElement>(".ds-stage");
    const statement = el.querySelector<HTMLElement>(".ds-statement");
    const chainOl = el.querySelector<HTMLElement>(".ds-chain ol");
    const rail = Array.from(el.querySelectorAll<HTMLElement>(".ds-rail > li"));
    const beats = Array.from(el.querySelectorAll<HTMLElement>(".ds-beat"));
    const seedEl = el.querySelector<HTMLElement>("[data-seed]");
    const pickEls = [0, 1].map((k) => ({
      index: el.querySelector<HTMLElement>(`[data-pick="${k}"] [data-v="index"]`),
      ticket: el.querySelector<HTMLElement>(`[data-pick="${k}"] [data-v="ticket"]`),
      box: el.querySelector<HTMLElement>(`[data-pick="${k}"]`),
    }));
    const poolCells = Array.from(el.querySelectorAll<HTMLElement>(".ds-pool i"));
    const poolCount = el.querySelector<HTMLElement>("[data-pool-count]");
    const flash = el.querySelector<HTMLElement>(".ds-flash");
    const flashN = el.querySelector<HTMLElement>("[data-flash-n]");
    const sheetCells = new Map<number, HTMLElement>();
    for (const c of Array.from(el.querySelectorAll<HTMLElement>(".ds-grid .sheet .c"))) {
      sheetCells.set(Number(c.dataset.i), c);
    }
    if (!stage) return;

    const pools = poolsOf(data);
    const winners = data.trace.map((s) => s.winner);
    const silentSet = new Set(data.tickets.filter((t) => t.silent).map((t) => t.index));
    const sortPos = new Map(data.tickets.map((t) => [t.index, t.sortPos]));

    el.dataset.run = "on";

    let lastBeat = -2;
    let lastPool = "";
    let raf = 0;

    const set = (node: HTMLElement | null | undefined, key: string, on: boolean, value = "1") => {
      if (!node) return;
      if (on) {
        if (node.dataset[key] !== value) node.dataset[key] = value;
      } else if (key in node.dataset) {
        delete node.dataset[key];
      }
    };
    const text = (node: HTMLElement | null | undefined, v: string) => {
      if (node && node.textContent !== v) node.textContent = v;
    };

    const update = () => {
      raf = 0;
      const wr = el.getBoundingClientRect();
      if (wr.bottom < -200 || wr.top > window.innerHeight + 200) return;
      const q = pinProgress(wr.top, wr.height, stage.offsetHeight);

      /* The statement: there as the stage arrives, gone before the grid forms. */
      if (statement) {
        const out = seg(q, BEAT.statementFrom, BEAT.statementTo);
        statement.style.opacity = (1 - out).toFixed(3);
        statement.style.transform = out > 0 ? `translateY(${(-out * 48).toFixed(1)}px)` : "";
        /* Faded, not hidden: the heading and its "not on chain" lead stay in the accessibility
           tree for anyone who has scrolled past. The flag only takes the card out of the pointer's
           way (app/drum.css). */
        set(statement, "out", out >= 1);
      }
      set(el, "hud", q > BEAT.hud, "on");

      /* The chain link this stretch of scroll is on, on the rail, the panel and the chain. */
      const b = beatOf(q);
      if (b !== lastBeat) {
        lastBeat = b;
        rail.forEach((li, j) => {
          set(li, "state", j === b, "on");
          if (j < b) li.dataset.state = "done";
        });
        beats.forEach((node, j) => set(node, "on", j === Math.max(0, b)));
        if (chainOl) {
          if (b >= 0) chainOl.dataset.walk = String(b);
          else delete chainOl.dataset.walk;
          for (const li of Array.from(chainOl.children) as HTMLElement[]) {
            set(li, "on", b >= 0 && li.dataset.step === String(b));
          }
        }
      }

      /* The seed resolves left to right through its beat, from glyphs that are never hex. */
      if (seedEl) {
        const bs = seg(q, BEAT.seed, BEAT.seed + 0.06);
        if (b === 3 && bs < 1) {
          const n = Math.floor(bs * data.seed.length);
          text(seedEl, data.seed.slice(0, n) + scramble(data.seed.length - n));
        } else {
          text(seedEl, data.seed);
        }
      }

      /* The picks. */
      const F = flights(q);
      const bR = seg(q, BEAT.revealed, BEAT.publicData - 0.02);
      const silDim = bR > 0.3;
      const silOut = bR > 0.6;
      const out = F.map((f) => f.back >= 1);
      for (let k = 0; k < 2 && k < data.trace.length; k += 1) {
        const step = data.trace[k];
        const f = F[k];
        const els = pickEls[k];
        if (f.sweep >= 1) {
          text(els.index, String(step.pick));
          text(els.ticket, pad2(step.winner));
          set(els.box, "landed", true);
        } else if (f.sweep > 0) {
          text(els.index, scramble(2));
          text(els.ticket, scramble(2));
          set(els.box, "landed", false);
        } else {
          text(els.index, "··");
          text(els.ticket, "··");
          set(els.box, "landed", false);
        }
      }
      set(beats[4], "rest", q >= BEAT.rest);

      /* The pool strip: twenty sold tickets, the silent two leave, each winner is spliced out. */
      const cur = data.trace.slice(0, 2).map((step, k) => {
        const at = cursorAt(F[k], step.pick);
        return at >= 0 ? (pools[k]?.[at] ?? -1) : -1;
      });
      for (const cell of poolCells) {
        const t = Number(cell.dataset.t);
        const p = winners.indexOf(t);
        const landedHere = p >= 0 && p < 2 && F[p].sweep >= 1 && !out[p];
        set(cell, "cur", cur.includes(t) || landedHere);
        set(cell, "sil", silentSet.has(t) && silDim);
        set(cell, "out", (silentSet.has(t) && silOut) || (p >= 0 && p < 2 && out[p]));
      }
      const pv = !silOut ? "" : String(data.eligible.length - out.filter(Boolean).length);
      if (pv !== lastPool) {
        const first = lastPool === "";
        lastPool = pv;
        text(poolCount, pv);
        if (!first && poolCount) {
          poolCount.dataset.tick = "1";
          window.setTimeout(() => {
            if (poolCount) delete poolCount.dataset.tick;
          }, 650);
        }
      }

      /* The winner, named in coral while it is held toward the reader. */
      let wf = 0;
      let wn = -1;
      for (let k = 0; k < 2 && k < data.trace.length; k += 1) {
        const f = F[k];
        if (f.go > 0.6 && f.back < 0.5) {
          wf = sat((f.go - 0.6) / 0.3) * (1 - sat(f.back * 2.5));
          wn = data.trace[k].winner;
        }
      }
      if (flash) {
        flash.style.opacity = wf.toFixed(3);
        flash.style.transform = `translateX(-50%) scale(${(0.94 + wf * 0.06).toFixed(3)})`;
      }
      if (wn > 0) text(flashN, pad2(wn));

      /* The sheet's cells carry the same beats for the no-WebGL drawing. */
      for (const [t, c] of sheetCells) {
        const sil = silentSet.has(t);
        const rt = seg(bR * 1.5 - (t - 1) / 30, 0, 0.4);
        set(c, "band", !sil && rt > 0.5);
        set(c, "dim", sil && rt > 0.5);
        const bP = seg(q, BEAT.publicData, BEAT.chainValue);
        const sp = sortPos.get(t) ?? -1;
        const glow = !sil && bP > 0 && bP < 1 && Math.abs(bP * 1.2 - 0.1 - sp / 17) < 0.06;
        set(c, "glow", glow);
        const p = winners.indexOf(t);
        set(c, "cursor", cur.includes(t));
        set(c, "fly", p >= 0 && p < 2 && F[p].sweep >= 1 && F[p].go > 0 && F[p].back < 1);
        set(c, "won", p >= 0 && p < 2 && F[p].won);
        set(c, "recede", p < 0 && q >= BEAT.rest);
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    /* Stop, and leave the server's markup as it was sent: no inline style, no beat attribute, so
       the static stack app/drum.css shows when motion is reduced reads exactly as the no-script
       section does. */
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      delete el.dataset.run;
      delete el.dataset.hud;
      if (statement) {
        statement.style.cssText = "";
        delete statement.dataset.out;
      }
      if (chainOl) {
        delete chainOl.dataset.walk;
        for (const li of Array.from(chainOl.children) as HTMLElement[]) delete li.dataset.on;
      }
      for (const li of rail) delete li.dataset.state;
      for (const node of beats) {
        delete node.dataset.on;
        delete node.dataset.rest;
      }
      for (const c of sheetCells.values()) {
        for (const k of ["band", "dim", "glow", "cursor", "fly", "won", "recede"]) delete c.dataset[k];
      }
    };
    const onReduce = () => {
      if (reduce.matches) stop();
    };
    reduce.addEventListener("change", onReduce);

    return () => {
      reduce.removeEventListener("change", onReduce);
      stop();
    };
  }, [data]);

  const linkAt = (i: number) => data.links[i];

  return (
    <div ref={root} className="ds" data-drum-scene="">
      <a href={skip.href} className="ds-skip label">
        {skip.label}
      </a>
      <div className="ds-stage">
        <div className="ds-statement">{head}</div>
        <div className="ds-labels" aria-hidden="true">
          {data.tickets.map((t) => (
            <span key={t.index} data-tk={t.index}>
              {pad2(t.index)}
            </span>
          ))}
        </div>
        <div className="ds-scene">
          <div className="ds-grid">
            {sheet}
            <div className="ds-flash" aria-hidden="true">
              Ticket <span data-flash-n="">{pad2(winners[0] ?? 0)}</span>
            </div>
          </div>
          <div className="ds-hud">
            <p className="ds-tag label m-0">{tag}</p>
            <ol className="ds-rail" aria-hidden="true">
              {names.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ol>
            <div className="ds-beats" aria-hidden="true">
              {data.links.slice(0, 4).map((link, i) => (
                <div key={link.name} className="ds-beat">
                  <span className="label text-event">{link.name}</span>
                  <span
                    className={link.hex ? "ds-hex digest" : "ds-val monument"}
                    {...(i === 3 ? { "data-seed": "" } : {})}
                  >
                    {link.value}
                  </span>
                  <span className="ds-note">{link.note}</span>
                </div>
              ))}
              {linkAt(4) ? (
                <div className="ds-beat">
                  <span className="label text-event">{linkAt(4).name}</span>
                  <div className="ds-picks">
                    {data.trace.slice(0, 2).map((step, k) => (
                      <dl key={k} className="ds-pick" data-pick={k}>
                        <div>
                          <dt>Pool</dt>
                          <dd>{step.poolBefore}</dd>
                        </div>
                        <div>
                          <dt>Index</dt>
                          <dd data-v="index">··</dd>
                        </div>
                        <div>
                          <dt>Ticket</dt>
                          <dd data-v="ticket">··</dd>
                        </div>
                      </dl>
                    ))}
                  </div>
                  <div className="ds-restline">
                    <span className="ds-val monument">{linkAt(4).value}</span>
                    <span className="ds-note">{linkAt(4).note}</span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="ds-chain">{chain}</div>
            <div className="ds-pool" aria-hidden="true">
              <p className="ds-pool-head label m-0">
                <span>Pool</span>
                <b data-pool-count="" />
              </p>
              <div className="ds-pool-row">
                {data.tickets.map((t) => (
                  <i key={t.index} data-t={t.index} data-silent={t.silent ? "" : undefined}>
                    <b>{pad2(t.index)}</b>
                  </i>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
