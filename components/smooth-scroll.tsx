"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/**
 * Eased scrolling for the whole document.
 *
 * Lenis drives the browser's own scroll position rather than transforming a wrapper, which is why
 * this is safe here: `position: sticky` still pins, and Motion's `useScroll` still reads a real
 * scroll offset, so the parallax on the product shot and the pinned masthead keep working. A
 * smooth-scroll library that translates a container instead would break both.
 *
 * Under `prefers-reduced-motion` nothing is constructed at all. This is not decoration that can be
 * dialled down: hijacking the wheel is exactly what someone with that preference set is asking not
 * to happen, so the browser keeps its native scrolling entirely.
 *
 * `anchors: true` hands in-page links to Lenis, so `#limits` in the docs eases across instead of
 * jumping. Without it the anchor would teleport while the rest of the page glides, which reads as
 * a bug.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({
      // Roughly a second to settle. Long enough to feel carried, short enough that a deliberate
      // scroll to a section does not feel like waiting for a lift.
      duration: 1.05,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      // Touch devices already have momentum scrolling from the OS, and doubling it feels sluggish.
      smoothWheel: true,
      syncTouch: false,
      anchors: true,
    });

    let frame = 0;
    function raf(time: number) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    }
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
}
