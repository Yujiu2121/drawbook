"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  BEAT,
  buildDrum,
  labelAt,
  newState,
  pinProgress,
  poolsOf,
  px2w,
  project,
  sat,
  simulate,
  unitsPerPx,
  type DrumCell,
  type Layout,
  type Pointer,
  type SceneData,
  type View,
} from "./geometry";
import type { DrumRenderer } from "./scene";

/**
 * THE DRUM STAGE: one fixed canvas and the one renderer behind it, for the whole landing.
 *
 * The drum is drawn in two places on the page, and both are this canvas. Around the opening it
 * sits in the hero's slot, beside the sentence, turning slowly. Inside the pinned draw scene
 * (components/drum/draw-scene.tsx) it slows to rest, the other raffles' tickets recede, and sample
 * 0004's twenty tickets leave it to form the grid the draw is replayed on. Between the two, and
 * everywhere else, the canvas draws nothing and the loop is stopped.
 *
 * IT IS AN ENHANCEMENT OVER A PAGE THAT IS ALREADY COMPLETE. The server renders the hero's muster
 * of 112 cells inside the slot and the draw scene's ticket sheet inside its grid; with no script,
 * no WebGL or a reduced-motion preference this island renders a canvas that is never drawn and
 * three.js is never fetched. Otherwise, after the first paint, it imports components/drum/scene.ts
 * (and three.js with it), draws one frame, and only then sets data-drum="on" on the slot and the
 * scene, which is what app/drum.css fades the muster and the sheet out on. A failed import, a
 * context that never comes, or one that is lost later, leaves or puts the server's cells back.
 *
 * EVERY TICKET IS REAL. The 112 cells arrive from app/page.tsx as [raffle, ticket, state] tuples
 * read out of the sample record, and geometry.ts lays them on the sphere in raffle order.
 *
 * THE LOOP RUNS ONLY WHILE IT SHOWS SOMETHING: while the hero or the scene intersects the viewport
 * and the tab is visible. It is the drum's slow idle turn and its dust, which is one of the few
 * loops the landing is allowed, and it stops off screen.
 */

/* ------------------------------------------------------------------------------ WEBGL PROBE */

let probed: boolean | null = null;

/**
 * Whether this browser will give the drum a WebGL2 context (three.js needs 2). Asked once per page
 * load, with a throwaway canvas whose context is released straight away, so the probe never counts
 * against the browser's limit on live contexts. components/landing/hero.tsx reads it too: when the
 * drum is going to replace the muster, the muster's opening sweep is not worth running.
 */
export function drumAvailable(): boolean {
  if (probed !== null) return probed;
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    probed = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    probed = false;
  }
  return probed;
}

const REDUCE = "(prefers-reduced-motion: reduce)";

export function DrumStage({ cells, scene }: { cells: DrumCell[]; scene: SceneData | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const router = useRouter();
  const routerRef = useRef(router);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const slot = canvas?.parentElement;
    if (!canvas || !slot) return;
    if (window.matchMedia(REDUCE).matches || !drumAvailable()) return;

    const hero = (slot.closest("section") as HTMLElement | null) ?? slot;
    const sceneEl = scene ? document.querySelector<HTMLElement>("[data-drum-scene]") : null;
    const stageEl = sceneEl?.querySelector<HTMLElement>(".ds-stage") ?? null;
    const sheetEl = sceneEl?.querySelector<HTMLElement>(".ds-grid .sheet") ?? null;
    const labelBox = sceneEl?.querySelector<HTMLElement>(".ds-labels") ?? null;
    const labelEls = new Map<number, HTMLElement>();
    for (const el of Array.from(labelBox?.querySelectorAll<HTMLElement>("[data-tk]") ?? [])) {
      labelEls.set(Number(el.dataset.tk), el);
    }
    // The scene is only pinned (and only has a stage to draw on) under the media query
    // app/drum.css pins it with.
    const pinned = window.matchMedia("(prefers-reduced-motion: no-preference) and (scripting: enabled)").matches;
    const useScene = !!(pinned && scene && sceneEl && stageEl && sheetEl);

    const model = buildDrum(cells, useScene ? scene : null);
    const state = newState();
    const pools = scene ? poolsOf(scene) : [];
    const winT = scene ? scene.trace.map((s) => s.winner) : [];
    const fine = window.matchMedia("(pointer: fine)");
    const ptr: Pointer = { has: false, x: -9999, y: -9999, nx: 0, ny: 0 };

    let renderer: DrumRenderer | null = null;
    let disposed = false;
    let raf = 0;
    let t0 = -1;
    let last = 0;
    let heroOn = false;
    let sceneOn = false;
    let shown = false;
    let zone: "hero" | "scene" | null = null;
    let view: View = { W: canvas.clientWidth || window.innerWidth, H: canvas.clientHeight || window.innerHeight };
    let layout: Layout = { cx: 0, cy: 0, R: 1, gx: 0, gy: 0, cs: 0.5, gap: 0.1 };

    const setOn = (on: boolean) => {
      for (const el of [slot, sceneEl]) {
        if (!el) continue;
        if (on) el.dataset.drum = "on";
        else delete el.dataset.drum;
      }
    };

    /* ---- where the drum is this frame, from the live rectangles, so it scrolls with its slot. */
    const measure = (): "hero" | "scene" | null => {
      view = { W: canvas.clientWidth || window.innerWidth, H: canvas.clientHeight || window.innerHeight };
      const k = unitsPerPx(view);
      if (heroOn) {
        const r = slot.getBoundingClientRect();
        if (r.bottom > 0 && r.top < view.H) {
          const [cx, cy] = px2w(view, r.left + r.width / 2, r.top + r.height / 2);
          const R = (Math.min(r.width, r.height) / 2) * k * (view.W < 980 ? 0.9 : 0.86);
          layout = { cx, cy, R, gx: cx, gy: cy, cs: R * 0.2, gap: R * 0.04 };
          const Rpx = R / k;
          const cxp = r.left + r.width / 2;
          const cyp = r.top + r.height / 2;
          const s = canvas.style;
          s.setProperty("--mx", `${cxp.toFixed(1)}px`);
          s.setProperty("--my", `${cyp.toFixed(1)}px`);
          s.setProperty("--mr0", `${(Rpx * 1.15).toFixed(1)}px`);
          s.setProperty("--mr1", `${(Rpx * 1.7).toFixed(1)}px`);
          s.setProperty("--mb", `${r.bottom.toFixed(1)}px`);
          s.setProperty("--ml", `${(r.left - 24).toFixed(1)}px`);
          return "hero";
        }
      }
      if (sceneOn && useScene && sheetEl && stageEl) {
        const st = stageEl.getBoundingClientRect();
        if (st.bottom > 0 && st.top < view.H) {
          const g = sheetEl.getBoundingClientRect();
          const pitch = g.width / 5;
          const cs = (pitch / 1.2) * k;
          const [gx, gy] = px2w(view, g.left + g.width / 2, g.top + g.height / 2);
          layout = { cx: gx, cy: gy, R: cs * 4.2, gx, gy, cs, gap: cs * 0.2 };
          const s = canvas.style;
          s.setProperty("--mt", `${Math.max(0, st.top).toFixed(1)}px`);
          s.setProperty("--mb", `${Math.min(view.H, st.bottom).toFixed(1)}px`);
          return "scene";
        }
      }
      return null;
    };

    const placeLabels = (q: number) => {
      if (!labelBox || !stageEl || !scene) return;
      const m = state.m;
      const la = sat((m - 0.85) / 0.15);
      labelBox.style.opacity = la.toFixed(3);
      if (la <= 0) return;
      const st = stageEl.getBoundingClientRect();
      const F = state.f;
      const fly = [0, 1].map((p) => (F[p].sweep >= 1 ? F[p].go * (1 - F[p].back) : 0));
      const flyRaw = Math.max(fly[0], fly[1]);
      const flyIdx = fly[0] > 0 ? model.ofTicket[winT[0]] : fly[1] > 0 ? model.ofTicket[winT[1]] : -1;
      let box: [number, number, number, number] | null = null;
      if (flyIdx >= 0) {
        const wp = project(view, model.P[flyIdx * 3], model.P[flyIdx * 3 + 1], model.P[flyIdx * 3 + 2]);
        const hs = model.S[flyIdx] * wp[2] * 0.62 + 8;
        box = [wp[0] - hs, wp[1] - hs, wp[0] + hs, wp[1] + hs];
      }
      const silentOff = sat((q - BEAT.revealed) / (BEAT.publicData - BEAT.revealed)) > 0.5;
      for (const [tk, el] of labelEls) {
        const i = model.ofTicket[tk];
        if (i === undefined || i < 0) continue;
        const [x, y, sc] = labelAt(model, layout, view, i);
        el.style.transform = `translate3d(${(x - st.left).toFixed(1)}px,${(y - st.top).toFixed(1)}px,0) scale(${sc.toFixed(3)})`;
        const p = winT.indexOf(tk);
        const isW = p >= 0 && p < 2 && F[p].sweep >= 1;
        const won = p >= 0 && p < 2 && F[p].won;
        let op = isW ? 1 : 1 - sat(flyRaw * 6);
        if (!isW && box && x > box[0] && x < box[2] && y > box[1] && y < box[3]) op = 0;
        el.style.opacity = op.toFixed(3);
        if (won) el.dataset.won = "1";
        else delete el.dataset.won;
        if (model.silent[i] && silentOff) el.dataset.off = "1";
        else delete el.dataset.off;
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (disposed || !renderer || document.hidden) return;
      const z = measure();
      if (!z) {
        // Nothing to draw: stop, and leave the canvas empty rather than frozen mid-turn.
        zone = null;
        canvas.dataset.zone = "";
        return;
      }
      if (t0 < 0) t0 = now;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
      last = now;
      const t = (now - t0) / 1000;
      let q = 0;
      if (z === "scene" && sceneEl && stageEl) {
        const wr = sceneEl.getBoundingClientRect();
        q = pinProgress(wr.top, wr.height, stageEl.offsetHeight);
      }
      if (z !== zone) {
        zone = z;
        canvas.dataset.zone = z;
      }
      simulate(model, state, { t, dt, zone: z, q, layout, ptr, view, narrow: view.W < 640 }, useScene ? { pools, trace: scene!.trace } : null);
      renderer.draw({ t, layout, state, zone: z, q });
      if (z === "scene") placeLabels(q);
      else if (labelBox) labelBox.style.opacity = "0";
      if (!shown) {
        shown = true;
        setOn(true);
      }
      raf = requestAnimationFrame(frame);
    };

    const kick = () => {
      if (disposed || !renderer || raf || document.hidden) return;
      if (!heroOn && !sceneOn) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    /* ---- visibility of the two places the drum lives. */
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.target === hero) heroOn = e.isIntersecting;
          if (e.target === sceneEl) sceneOn = e.isIntersecting;
        }
        kick();
      },
      { rootMargin: "64px 0px" },
    );
    io.observe(hero);
    if (sceneEl) io.observe(sceneEl);

    const onVisibility = () => kick();
    document.addEventListener("visibilitychange", onVisibility);
    // The observer's margin keeps a place "on" a little past its edge, where the frame loop has
    // already stopped for lack of anything to draw; scrolling back has to restart it.
    window.addEventListener("scroll", onVisibility, { passive: true });

    /* ---- the pointer: a lean and a bulge toward it, on a fine pointer, in the opening only. */
    const onMove = (e: PointerEvent) => {
      if ((e.pointerType !== "mouse" && e.pointerType !== "pen") || !fine.matches) return;
      ptr.has = true;
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      ptr.nx = e.clientX / Math.max(1, view.W) - 0.5;
      ptr.ny = e.clientY / Math.max(1, view.H) - 0.5;
      if (zone === "hero") slot.style.cursor = nearest(e.clientX, e.clientY) >= 0 ? "pointer" : "";
    };
    const onLeave = () => {
      ptr.has = false;
      slot.style.cursor = "";
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    /** The front-facing drum cell under a point, or -1. */
    function nearest(x: number, y: number): number {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < model.N; i += 1) {
        if (model.P[i * 3 + 2] < layout.R * 0.1) continue;
        const p = project(view, model.P[i * 3], model.P[i * 3 + 1], model.P[i * 3 + 2]);
        // The nearest front cell within about half the spacing between cells, so a press anywhere
        // on the drum's face lands on a ticket, gaps included, while the drum keeps turning.
        const r = Math.max(model.S[i] * p[2] * 1.3, 24);
        const dx = p[0] - x;
        const dy = p[1] - y;
        const dd = dx * dx + dy * dy;
        if (dd < r * r && dd < bd) {
          bd = dd;
          best = i;
        }
      }
      return best;
    }

    /* A click on a ticket opens its raffle, so "Open a band and those blocks become the page"
       stays true of the drum. Keyboard users reach the same five links in the muster. */
    const onClick = (e: MouseEvent) => {
      if (!shown || zone !== "hero" || e.defaultPrevented || e.button !== 0) return;
      if ((e.target as HTMLElement | null)?.closest("a")) return;
      const i = nearest(e.clientX, e.clientY);
      if (i >= 0) routerRef.current.push(`/raffle/${model.raffle[i]}`);
    };
    slot.addEventListener("click", onClick);

    /* ---- size, debounced, and once more when the fonts have moved the layout. */
    let rt = 0;
    const onResize = () => {
      window.clearTimeout(rt);
      rt = window.setTimeout(() => {
        view = { W: canvas.clientWidth || window.innerWidth, H: canvas.clientHeight || window.innerHeight };
        renderer?.resize(view.W, view.H);
        kick();
      }, 120);
    };
    window.addEventListener("resize", onResize);

    const reduce = window.matchMedia(REDUCE);
    const onReduce = () => {
      if (!reduce.matches) return;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      setOn(false);
      canvas.dataset.zone = "";
      disposed = true;
    };
    reduce.addEventListener("change", onReduce);

    const onLost = (e: Event) => {
      e.preventDefault();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      renderer = null;
      setOn(false);
      canvas.dataset.zone = "";
    };
    canvas.addEventListener("webglcontextlost", onLost);

    /* ---- after the first paint, and never before it: fetch three.js and draw. */
    let start = requestAnimationFrame(() => {
      start = requestAnimationFrame(() => {
        start = 0;
        import("./scene")
          .then(({ createDrumRenderer }) => {
            if (disposed) return;
            renderer = createDrumRenderer(canvas, model);
            if (!renderer) return;
            renderer.resize(view.W, view.H);
            kick();
          })
          .catch(() => {
            /* No drum: the server's muster and sheet stay exactly as painted. */
          });
      });
    });

    return () => {
      disposed = true;
      if (start) cancelAnimationFrame(start);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(rt);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("scroll", onVisibility);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      slot.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
      reduce.removeEventListener("change", onReduce);
      canvas.removeEventListener("webglcontextlost", onLost);
      slot.style.cursor = "";
      setOn(false);
      renderer?.dispose();
      renderer = null;
    };
  }, [cells, scene]);

  return <canvas ref={canvasRef} className="drum-canvas" aria-hidden="true" />;
}
