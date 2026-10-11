"use client";

import { useEffect, useRef } from "react";

import { rng } from "./geometry";

/**
 * THE COMMITMENT FIELD, beside the working in section six.
 *
 * Sample 0004's twenty real commitments, one row per ticket, repeated to fill the panel and set
 * unreadable: every character outside a circle around the pointer is a scramble glyph, and the
 * characters inside it read clear. The two winners' rows are coral. It pictures what a commitment
 * is, a digest that says nothing until its secret is revealed, and it is aria-hidden because the
 * working beside it prints every nonce, the chain value and the seed in plain text.
 *
 * IT MOVES ONLY WHEN THE READER DOES. There is no idle loop: the lens eases toward the pointer
 * while the pointer moves over it and then the frame loop stops. Off screen nothing runs. Under a
 * reduced-motion preference it draws one still frame and follows nothing. The scramble is seeded,
 * so the still frame is the same on every load.
 *
 * With no script the server's own text stays: the commitments themselves, faint, under the
 * caption.
 */

const GLYPHS = "+*/<>=%#:~^-";

export function CommitField({
  commitments,
  winners,
  caption,
}: {
  /** The raffle's commitments in ticket order, one per ticket. */
  commitments: string[];
  /** Ticket indices that won. */
  winners: number[];
  /** "Sample raffle 0004 · not on chain", built from the serial by the server. */
  caption: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const x = canvas?.getContext("2d");
    if (!box || !canvas || !x) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
    const mono = `${v("--font-geist-mono", "ui-monospace")}, ui-monospace, monospace`;
    const C = {
      dim: "rgba(160, 132, 130, 0.32)",
      won: "rgba(255, 107, 61, 0.5)",
      chalk: v("--chalk", "#f7ebe4"),
      apricot: v("--apricot", "#ffcfa8"),
      coral: v("--coral", "#ff6b3d"),
    };
    const winSet = new Set(winners);

    let W = 0;
    let H = 0;
    let dpr = 1;
    let cw = 7;
    const lh = 21;
    let rows: { t: string; s: string; tk: number }[] = [];
    const spot = { x: 0, y: 0, tx: 0, ty: 0 };
    let raf = 0;
    let visible = false;

    const resize = () => {
      const r = box.getBoundingClientRect();
      W = r.width;
      H = r.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.font = `500 11px ${mono}`;
      cw = x.measureText("0").width || 7;
      const rnd = rng(13);
      const nr = Math.max(0, Math.floor((H - 70) / lh));
      const ncol = Math.max(0, Math.ceil((W - 20) / cw));
      const n = commitments.length;
      rows = [];
      for (let r2 = 0; r2 < nr && n > 0; r2 += 1) {
        const tk = (r2 % n) + 1;
        let txt = `#${String(tk).padStart(2, "0")}  ${commitments[tk - 1]}`;
        let k = tk + 6;
        while (txt.length < ncol) {
          txt += `   ${commitments[k % n]}`;
          k += 7;
        }
        txt = txt.slice(0, ncol);
        let scr = "";
        for (let c = 0; c < txt.length; c += 1) {
          scr += c < 5 || txt[c] === " " ? txt[c] : GLYPHS[Math.floor(rnd() * GLYPHS.length)];
        }
        rows.push({ t: txt, s: scr, tk });
      }
      if (!spot.x && !spot.y) {
        // At rest the lens sits over the first winner's row, a third of the way in.
        const first = rows.findIndex((row) => winSet.has(row.tk));
        spot.x = spot.tx = W * 0.34;
        spot.y = spot.ty = 26 + Math.max(0, first) * lh - 4;
      }
      box.dataset.drawn = "1";
      draw();
    };

    function draw() {
      if (!x) return;
      x.clearRect(0, 0, W, H);
      x.font = `500 11px ${mono}`;
      const R = Math.min(150, W * 0.26);
      const ox = 14;
      const oy = 26;
      for (let r = 0; r < rows.length; r += 1) {
        const row = rows[r];
        const y = oy + r * lh;
        const won = winSet.has(row.tk);
        let dim = "";
        const lit: [number, number, number][] = [];
        for (let c = 0; c < row.t.length; c += 1) {
          const cx = ox + c * cw;
          const d = Math.hypot(cx - spot.x, y - 4 - spot.y);
          if (d < R) {
            dim += " ";
            lit.push([c, cx, 1 - d / R]);
          } else {
            dim += row.t[c] === " " ? " " : row.s[c];
          }
        }
        x.fillStyle = won ? C.won : C.dim;
        x.fillText(dim, ox, y);
        for (const [c, cx, k] of lit) {
          const ch = k > 0.25 ? row.t[c] : row.s[c];
          x.globalAlpha = k > 0.55 ? 0.55 + k * 0.45 : Math.min(1, 0.35 + k);
          x.fillStyle = won ? C.coral : k > 0.55 ? C.chalk : C.apricot;
          x.fillText(ch, cx, y);
        }
        x.globalAlpha = 1;
      }
    }

    const step = () => {
      raf = 0;
      if (!visible || document.hidden) return;
      spot.x += (spot.tx - spot.x) * 0.16;
      spot.y += (spot.ty - spot.y) * 0.16;
      draw();
      // Settled: stop until the pointer moves again.
      if (Math.abs(spot.tx - spot.x) > 0.4 || Math.abs(spot.ty - spot.y) > 0.4) {
        raf = requestAnimationFrame(step);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (reduce) return;
      const r = box.getBoundingClientRect();
      spot.tx = e.clientX - r.left;
      spot.ty = e.clientY - r.top;
      if (!raf) raf = requestAnimationFrame(step);
    };
    box.addEventListener("pointermove", onMove);

    const io = new IntersectionObserver((es) => {
      visible = es[es.length - 1]?.isIntersecting ?? false;
    });
    io.observe(box);

    let rt = 0;
    const onResize = () => {
      window.clearTimeout(rt);
      rt = window.setTimeout(resize, 120);
    };
    window.addEventListener("resize", onResize);
    resize();
    document.fonts?.ready.then(resize);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(rt);
      io.disconnect();
      box.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
    };
  }, [commitments, winners]);

  return (
    <figure className="cfield m-0">
      <div ref={boxRef} className="cfield-box">
        <p className="cfield-static digest" aria-hidden="true">
          {commitments.join(" ")}
        </p>
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      <figcaption className="cfield-cap label">{caption}</figcaption>
    </figure>
  );
}
