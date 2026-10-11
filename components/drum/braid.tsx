"use client";

import { useEffect, useRef } from "react";

import { eio, lerp, pinProgress, sat, seg, type TraceStep } from "./geometry";

/**
 * THE BRAID: SAMPLE 0004'S DRAW AS ONE PICTURE, BETWEEN THE WORKING AND THE RIALO SECTION.
 *
 * Twenty tickets down the left. The eighteen that revealed send a line each, in the sorted order
 * the seed hashes their nonces in, into one node; the chain value read at the draw joins last; the
 * node lights as the seed; and two lines leave it for the two winners, each card naming the pool,
 * the index and the ticket from the draw's own trace. The two silent tickets start a line and stop.
 *
 * A CANVAS, NOT AN SVG. The product draws no SVG by hand except its logo, and that rule was not
 * lifted for the drum. It is aria-hidden: every fact it pictures is in words in the draw chain and
 * the working above it. Its only labels are the chain's own five names, the working's column words
 * and the values themselves; there is no headline here and no sentence.
 *
 * Pinned and played by the scroll when motion is allowed (app/drum.css sets the height); drawn
 * finished, once, under a reduced-motion preference; and not shown at all with no script, since
 * without script there is nothing to draw it.
 */

const GLYPHS = "+*/<>=%#:~^-";
const pad2 = (n: number) => String(n).padStart(2, "0");
const smt = (x: number, a: number, b: number) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface BraidData {
  /** Every ticket of the raffle in ticket order, and whether it stayed silent. */
  tickets: { index: number; silent: boolean }[];
  /** Ticket indices in the sorted nonce order. */
  sorted: number[];
  chainValue: string;
  seed: string;
  trace: TraceStep[];
  /** The draw chain's names: revealed tickets, public data, chain value, seed, winners. */
  names: string[];
}

type Pt = [number, number];

interface Line {
  kind: "rev" | "sil" | "chain" | "win";
  t: number;
  pts: Pt[];
  cum: number[];
  len: number;
  a: number;
  b: number;
  color: string;
  width: number;
  glow: number;
}

function withLengths(kind: Line["kind"], t: number, pts: Pt[], a: number, b: number, color: string, width: number, glow: number): Line {
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { kind, t, pts, cum, len: cum[cum.length - 1], a, b, color, width, glow };
}

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 48): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const s = i / n;
    const u = 1 - s;
    out.push([
      u * u * u * p0[0] + 3 * u * u * s * p1[0] + 3 * u * s * s * p2[0] + s * s * s * p3[0],
      u * u * u * p0[1] + 3 * u * u * s * p1[1] + 3 * u * s * s * p2[1] + s * s * s * p3[1],
    ]);
  }
  return out;
}

/** Stroke a polyline up to `f` of its length. */
function strokePart(x: CanvasRenderingContext2D, L: Line, f: number) {
  if (f <= 0) return;
  const stop = L.len * f;
  x.beginPath();
  x.moveTo(L.pts[0][0], L.pts[0][1]);
  for (let i = 1; i < L.pts.length; i += 1) {
    if (L.cum[i] <= stop) {
      x.lineTo(L.pts[i][0], L.pts[i][1]);
    } else {
      const seg0 = L.cum[i] - L.cum[i - 1] || 1;
      const k = (stop - L.cum[i - 1]) / seg0;
      x.lineTo(lerp(L.pts[i - 1][0], L.pts[i][0], k), lerp(L.pts[i - 1][1], L.pts[i][1], k));
      break;
    }
  }
  x.stroke();
}

function roundRect(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  x.beginPath();
  x.roundRect(l, t, w, h, r);
}

interface Palette {
  apricot: string;
  apricot2: string;
  dust: string;
  coral: string;
  coralEdge: string;
  chalk: string;
  mute: string;
  dim: string;
  sold: string;
  line: string;
  bound: string;
  dusk: string;
  wine: string;
  glass: string;
  mono: string;
  sans: string;
}

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  return {
    apricot: v("--apricot", "#ffcfa8"),
    apricot2: v("--apricot-2", "#f2b98e"),
    dust: v("--dust", "#ffd8c4"),
    coral: v("--coral", "#ff6b3d"),
    coralEdge: v("--coral-edge", "#ffe2cc"),
    chalk: v("--chalk", "#f7ebe4"),
    mute: v("--mute", "#cdb3ab"),
    dim: v("--dim", "#a08482"),
    sold: v("--rose-sold", "#9a4a52"),
    line: v("--hair-2", "#503334"),
    bound: v("--edge", "#8a6a6b"),
    dusk: v("--dusk", "#170c10"),
    wine: v("--wine", "#2a1219"),
    glass: v("--glass-flat", "#27121a"),
    mono: v("--font-geist-mono", "ui-monospace") + ", ui-monospace, monospace",
    sans: v("--font-display", "Arial") + ", Arial, sans-serif",
  };
}

export function Braid({ data }: { data: BraidData }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;
    const stage = wrap.querySelector<HTMLElement>(".braid-stage");
    if (!stage) return;
    const x = ctx;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const P = readPalette();
    const [nRevealed, nPublic, nChain, nSeed, nWinners] = data.names;
    const sortPos = new Map(data.sorted.map((t, i) => [t, i]));
    const revealed = data.tickets.filter((t) => !t.silent).map((t) => t.index);

    let W = 0;
    let H = 0;
    let dpr = 1;
    let hor = true;
    let lines: Line[] = [];
    let chips: { t: number; x: number; y: number; w: number; h: number; lx: number; ly: number; silent: boolean }[] = [];
    let node = { x: 0, y: 0, w: 0, h: 0 };
    let cards: { t: number; x: number; y: number; w: number; h: number; step: TraceStep }[] = [];
    let chainDot: Pt = [0, 0];
    let chainLabel: { x: number; y: number; align: CanvasTextAlign } = { x: 0, y: 0, align: "left" };
    let headAt: { x: number; y: number; align: CanvasTextAlign } = { x: 0, y: 0, align: "left" };
    let publicAt: Pt = [0, 0];
    let winnersAt: Pt = [0, 0];

    const build = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.round(r.width);
      H = Math.round(r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, W * dpr);
      canvas.height = Math.max(1, H * dpr);
      lines = [];
      chips = [];
      cards = [];
      if (W < 200 || H < 200) return;

      hor = W >= 720 && W >= H * 1.15;
      const U = hor ? W : H;
      const V = hor ? H : W;
      const at = (u: number, v: number): Pt => (hor ? [u, v] : [v, u]);
      const n = data.tickets.length;

      let pitch: number;
      let chip: number;
      let u0: number;
      let vTop: number;
      const labelW = hor ? 30 : 0;
      if (hor) {
        pitch = Math.min(30, (V - 48) / n);
        chip = Math.min(15, pitch - 8);
        vTop = (V - pitch * n) / 2 + 10;
        u0 = labelW + chip + 10;
      } else {
        pitch = V / n;
        chip = pitch - 3;
        vTop = 0;
        u0 = 68;
      }
      const nar = hor && W < 1000;
      const cardLenU = hor ? (nar ? 182 : 214) : 76;
      const cardLenV = hor ? 80 : Math.min(170, V * 0.46);
      const nodeLenU = hor ? (nar ? 206 : 236) : 72;
      const nodeLenV = hor ? 84 : Math.min(236, V * 0.68);
      const cardU0 = U - cardLenU - 2;
      const nodeU = hor
        ? u0 + (U - cardLenU - u0) * 0.63
        : Math.min(Math.max(U * 0.52, u0 + 130), cardU0 - 48 - nodeLenU / 2);
      const nodeV = V / 2;
      const nodeIn = nodeU - nodeLenU / 2 + 6;
      const nodeOut = nodeU + nodeLenU / 2 - 4;
      const COLS = [P.apricot2, P.apricot, P.dust];
      const bundle = Math.min(nodeLenV * 0.42, 70);
      const amp = hor ? 11 : 8;
      const cv0 = hor && nodeIn - u0 < 420 ? 0.42 : 0.3;
      const cv1 = cv0 === 0.3 ? 0.74 : 0.78;

      headAt = hor ? { x: 0, y: vTop - 14, align: "left" } : { x: 0, y: 11, align: "left" };

      data.tickets.forEach((tk, k) => {
        const vi = vTop + pitch * (k + 0.5);
        const cl = hor ? chip : 30;
        const c0 = at(hor ? labelW : 20, vi - chip / 2);
        chips.push({
          t: tk.index,
          x: c0[0],
          y: c0[1],
          w: hor ? chip : chip,
          h: hor ? chip : cl,
          lx: hor ? labelW - 6 : vi,
          ly: hor ? vi + 3.8 : cl + 16,
          silent: tk.silent,
        });
        if (tk.silent) {
          const uEnd = u0 + 24;
          lines.push(withLengths("sil", tk.index, [at(u0, vi), at(uEnd, vi)], 0.03, 0.12, P.dim, hor ? 1.4 : 1.2, 0));
          return;
        }
        const ri = revealed.indexOf(tk.index);
        const rank = sortPos.get(tk.index) ?? ri;
        const off = (ri - (revealed.length - 1) / 2) * (bundle / Math.max(1, revealed.length - 1));
        const ph = (ri % 3) * 2.094 + (ri % 2) * 0.6;
        const pts: Pt[] = [];
        for (let j = 0; j <= 90; j += 1) {
          const s = j / 90;
          const u = lerp(u0, nodeIn, s);
          const conv = smt(s, cv0, cv1);
          const bz = sat((s - 0.58) / 0.42);
          const env = Math.sin(Math.PI * bz);
          const v = lerp(vi, nodeV + off * (1 - 0.7 * smt(s, cv1, 1)), conv) + amp * env * Math.sin(bz * Math.PI * 3 + ph);
          pts.push(at(u, v));
        }
        const a0 = 0.035 + rank * 0.017;
        lines.push(withLengths("rev", tk.index, pts, a0, a0 + 0.3, COLS[ri % 3], hor ? 1.5 : 1.15, hor ? 6 : 4.5));
      });

      publicAt = hor ? at(lerp(u0, nodeIn, 0.55), vTop - 14) : at(lerp(u0, nodeIn, 0.5), V * 0.18);

      // The chain value, read at the draw, joins last, from clear of the ticket column.
      const uc = hor
        ? Math.max(nodeIn - Math.max(190, (nodeIn - u0) * 0.46), u0 + (nodeIn - u0) * 0.55)
        : Math.max(nodeU - nodeLenU / 2 - 58, u0 + 98);
      const vc = hor ? V - 34 : V - 10;
      const ce: Pt = [nodeU - (hor ? 40 : 12), nodeV + nodeLenV / 2 - 6];
      const cpts = hor
        ? bezier(at(uc, vc), at(uc + (ce[0] - uc) * 0.75, vc), at(ce[0], vc + (ce[1] - vc) * 0.2), at(ce[0], ce[1]))
        : bezier(at(uc, vc), at(uc + 44, vc), at(ce[0], ce[1] + 36), at(ce[0], ce[1]));
      lines.push(withLengths("chain", 0, cpts, 0.58, 0.69, P.apricot2, hor ? 1.8 : 1.5, hor ? 7 : 5));
      chainDot = at(uc, vc);
      chainLabel = hor
        ? { x: chainDot[0] - 5, y: chainDot[1] + 22, align: "left" }
        : { x: chainDot[0] + 4, y: chainDot[1] - 30, align: "right" };

      // Two lines leave the seed for the two winners.
      const cardV = [hor ? V * 0.27 : V * 0.25, hor ? V * 0.73 : V * 0.75];
      data.trace.slice(0, 2).forEach((step, i) => {
        const a: Pt = [nodeOut, nodeV + (i ? 1 : -1) * Math.min(26, nodeLenV * 0.14)];
        const b: Pt = [cardU0 + 2, cardV[i]];
        const dU = (b[0] - a[0]) * 0.6;
        const pts = bezier(at(a[0], a[1]), at(a[0] + dU, a[1]), at(b[0] - dU, b[1]), at(b[0], b[1]));
        const a1 = i ? 0.875 : 0.77;
        lines.push(withLengths("win", step.winner, pts, a1, a1 + 0.085, P.coralEdge, hor ? 2 : 1.7, hor ? 9 : 7));
        const p0 = hor ? [cardU0, cardV[i] - cardLenV / 2] : [cardV[i] - cardLenV / 2, cardU0];
        cards.push({ t: step.winner, x: p0[0], y: p0[1], w: hor ? cardLenU : cardLenV, h: hor ? cardLenV : cardLenU, step });
      });
      winnersAt = hor ? [cardU0, cardV[0] - cardLenV / 2 - 14] : [cardV[0] - cardLenV / 2, cardU0 - 12];

      const n0 = at(nodeU - nodeLenU / 2, nodeV - nodeLenV / 2);
      node = { x: n0[0], y: n0[1], w: hor ? nodeLenU : nodeLenV, h: hor ? nodeLenV : nodeLenU };
    };

    let lastP = -1;

    const draw = (p: number) => {
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, W, H);
      if (!lines.length) return;
      x.lineCap = "round";
      x.lineJoin = "round";
      x.textBaseline = "alphabetic";

      let landed = 0;
      const win = new Map<number, number>();
      const bandOf = new Map<number, number>();

      // Lines first, under the node and the cards.
      for (const L of lines) {
        const f = eio(seg(p, L.a, L.b));
        if (L.kind === "sil") {
          const fd = seg(p, 0.15, 0.25);
          x.save();
          x.setLineDash([3, 4]);
          x.lineCap = "butt";
          x.globalAlpha = f > 0 ? 1 - 0.55 * fd : 0;
          x.strokeStyle = L.color;
          x.lineWidth = L.width;
          strokePart(x, L, f);
          x.restore();
          bandOf.set(L.t, -fd);
          continue;
        }
        if (f <= 0) continue;
        x.save();
        x.strokeStyle = L.color;
        x.globalAlpha = L.kind === "win" ? 0.32 : 0.13;
        x.lineWidth = L.glow;
        strokePart(x, L, f);
        x.globalAlpha = 1;
        x.lineWidth = L.width;
        strokePart(x, L, f);
        x.restore();
        if (L.kind === "rev") {
          if (f >= 1) landed += 1;
          bandOf.set(L.t, sat(f * 6));
        }
        if (L.kind === "win") win.set(L.t, f);
      }

      // The column of tickets.
      x.font = `600 9.5px ${P.mono}`;
      x.fillStyle = P.dim;
      x.textAlign = headAt.align;
      if (nRevealed) x.fillText(nRevealed.toUpperCase(), headAt.x, headAt.y);
      for (const c of chips) {
        const b = bandOf.get(c.t) ?? 0;
        const fade = c.silent ? -Math.min(0, b) : 0;
        const won = (win.get(c.t) ?? 0) >= 1;
        x.save();
        x.globalAlpha = 1 - fade * 0.6;
        roundRect(x, c.x, c.y, c.w, c.h, 3);
        x.fillStyle = won ? P.coral : P.sold;
        x.fill();
        x.lineWidth = won ? 2 : 1;
        x.strokeStyle = won ? P.coralEdge : P.bound;
        x.stroke();
        if (!c.silent && b > 0) {
          x.globalAlpha = b;
          const bh = c.h * 0.36;
          x.fillStyle = won ? P.coralEdge : P.apricot;
          x.fillRect(c.x + 1, c.y + c.h - bh, c.w - 2, bh - 1);
        }
        x.restore();
        if (won) {
          x.strokeStyle = P.coral;
          x.lineWidth = 1;
          roundRect(x, c.x - 3, c.y - 3, c.w + 6, c.h + 6, 5);
          x.stroke();
        }
        x.font = `500 ${hor ? 11 : 9.5}px ${P.mono}`;
        x.textAlign = hor ? "right" : "center";
        x.fillStyle = won ? P.chalk : c.silent && fade > 0.5 ? P.dim : P.mute;
        x.fillText(pad2(c.t), c.lx, hor ? c.ly : c.y + c.h + 13);
      }

      // The bundle, named once it is drawn.
      const anyRev = landed > 0 || [...bandOf.values()].some((b) => b > 0);
      if (nPublic && anyRev) {
        x.font = `600 9.5px ${P.mono}`;
        x.textAlign = "center";
        x.fillStyle = P.dim;
        x.globalAlpha = sat(landed / 6 + 0.3);
        const label = nPublic.toUpperCase();
        const lw = x.measureText(label).width;
        x.fillStyle = P.dusk;
        x.fillRect(publicAt[0] - lw / 2 - 4, publicAt[1] - 10, lw + 8, 14);
        x.fillStyle = P.dim;
        x.fillText(label, publicAt[0], publicAt[1]);
        x.globalAlpha = 1;
      }

      // The chain value.
      x.save();
      x.globalAlpha = sat(seg(p, 0.5, 0.58) * 1.2);
      roundRect(x, chainDot[0] - 4.5, chainDot[1] - 4.5, 9, 9, 2);
      x.fillStyle = P.dusk;
      x.fill();
      x.strokeStyle = P.apricot2;
      x.lineWidth = 1.2;
      x.stroke();
      x.font = `500 10.5px ${P.mono}`;
      x.textAlign = chainLabel.align;
      x.fillStyle = P.apricot2;
      if (hor) {
        x.fillText(`${(nChain ?? "").toUpperCase()}  ${data.chainValue}`, chainLabel.x, chainLabel.y);
      } else {
        x.fillText((nChain ?? "").toUpperCase(), chainLabel.x, chainLabel.y);
        x.fillText(data.chainValue, chainLabel.x, chainLabel.y + 13);
      }
      x.restore();

      // The seed node, on top of the lines it takes in.
      const rs = seg(p, 0.7, 0.76);
      const lit = rs >= 1;
      x.save();
      if (lit) {
        x.shadowColor = "rgba(255, 207, 168, 0.5)";
        x.shadowBlur = 18;
      }
      roundRect(x, node.x, node.y, node.w, node.h, 16);
      x.fillStyle = P.glass;
      x.fill();
      x.shadowBlur = 0;
      x.lineWidth = 1.2;
      x.strokeStyle = lit ? P.apricot : P.line;
      x.stroke();
      x.restore();
      const ncx = node.x + node.w / 2;
      const ncy = node.y + node.h / 2;
      x.textAlign = "center";
      x.font = `600 ${hor ? 9.5 : 8.5}px ${P.mono}`;
      x.fillStyle = P.apricot;
      if (nSeed) x.fillText(nSeed.toUpperCase(), ncx, ncy - node.h * 0.18);
      const short = data.seed.slice(0, 8) + data.seed.slice(-4);
      const nchar = Math.floor(rs * short.length);
      let o = "";
      for (let c = 0; c < short.length; c += 1) {
        o += c < nchar ? short[c] : rs > 0 ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : "·";
      }
      x.font = `500 ${hor ? 16 : 14}px ${P.mono}`;
      x.fillStyle = P.chalk;
      x.fillText(`${o.slice(0, 8)}${rs > 0 ? "…" : "·"}${o.slice(8)}`, ncx, ncy + node.h * 0.2);

      // The winners.
      if (nWinners) {
        x.font = `600 9.5px ${P.mono}`;
        x.textAlign = "left";
        x.fillStyle = P.dim;
        x.fillText(nWinners.toUpperCase(), winnersAt[0], winnersAt[1]);
      }
      for (const c of cards) {
        const on = (win.get(c.t) ?? 0) >= 1;
        x.save();
        if (on) {
          x.shadowColor = "rgba(255, 107, 61, 0.55)";
          x.shadowBlur = 16;
        }
        roundRect(x, c.x, c.y, c.w, c.h, 14);
        x.fillStyle = P.glass;
        x.fill();
        x.shadowBlur = 0;
        if (on) {
          x.fillStyle = "rgba(255, 107, 61, 0.14)";
          x.fill();
        }
        x.lineWidth = 1.2;
        x.strokeStyle = on ? P.coralEdge : P.line;
        x.stroke();
        x.restore();
        const kx = c.x + (hor ? 16 : 10);
        x.textAlign = "left";
        x.font = `500 ${hor ? 10 : 8.5}px ${P.mono}`;
        x.fillStyle = P.mute;
        x.fillText(`Pool ${c.step.poolBefore} · Index ${on ? c.step.pick : "··"}`, kx, c.y + (hor ? 26 : 22));
        x.font = `800 ${hor ? (W < 1000 ? 22 : 24) : 17}px ${P.sans}`;
        x.fillStyle = P.chalk;
        x.globalAlpha = on ? 1 : 0.3;
        x.fillText(`Ticket ${on ? pad2(c.t) : "··"}`, kx, c.y + (hor ? 60 : 52));
        x.globalAlpha = 1;
      }
    };

    const progress = () => {
      if (reduce.matches) return 1;
      const r = wrap.getBoundingClientRect();
      return pinProgress(r.top, r.height, stage.offsetHeight);
    };

    let raf = 0;
    const update = (force = false) => {
      raf = 0;
      const r = wrap.getBoundingClientRect();
      if (!force && (r.bottom < -50 || r.top > window.innerHeight + 50)) return;
      const p = progress();
      if (!force && Math.abs(p - lastP) < 0.0005) return;
      lastP = p;
      draw(p);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => update());
    };

    let size = "";
    const rebuild = () => {
      const r = canvas.getBoundingClientRect();
      const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
      // A phone's address bar showing or hiding resizes the window, not this stage.
      if (key === size) return update(true);
      size = key;
      build();
      update(true);
    };

    let rt = 0;
    const onResize = () => {
      window.clearTimeout(rt);
      rt = window.setTimeout(rebuild, 120);
    };

    rebuild();
    document.fonts?.ready.then(() => {
      size = "";
      rebuild();
    });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    const onReduce = () => update(true);
    reduce.addEventListener("change", onReduce);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(rt);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      reduce.removeEventListener("change", onReduce);
    };
  }, [data]);

  return (
    <div ref={wrapRef} className="braid" aria-hidden="true">
      <div className="braid-stage">
        <canvas ref={canvasRef} className="braid-art" />
      </div>
    </div>
  );
}
