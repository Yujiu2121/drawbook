"use client";

import { useEffect, useRef } from "react";

/**
 * A FIXED STRING THAT RESOLVES FROM GLYPHS THE FIRST TIME IT IS SCROLLED TO. Used once, for the
 * program id in section two.
 *
 * The server renders the true string, so it is what a reader with no script, a crawler, a copy and
 * paste and the first paint all get. After mount, and only when motion is allowed and the string
 * is still below the fold, it is swapped for scramble glyphs of the same length and resolves left
 * to right over a second as it comes into view. The glyphs are never letters or digits, so no
 * frame shows a wrong but plausible id; while it resolves, the element carries the true string as
 * its accessible name, and once it is done it is plain text again.
 */

const GLYPHS = "+*/<>=%#:~^-";

export function ResolveText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Already on screen: never take away what the reader can see.
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    const glyphs = (n: number) => {
      let o = "";
      for (let c = 0; c < n; c += 1) o += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      return o;
    };
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", text);
    el.textContent = glyphs(text.length);

    let raf = 0;
    const done = () => {
      el.textContent = text;
      el.removeAttribute("role");
      el.removeAttribute("aria-label");
    };
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const t0 = performance.now();
        const step = (now: number) => {
          const k = Math.min(1, (now - t0) / 1000);
          const n = Math.floor((1 - Math.pow(1 - k, 3)) * text.length);
          el.textContent = text.slice(0, n) + glyphs(text.length - n);
          if (k < 1) raf = requestAnimationFrame(step);
          else done();
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.5 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
      done();
    };
  }, [text]);

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
