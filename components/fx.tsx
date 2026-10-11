"use client";

/**
 * THE SHARED MOTION PRIMITIVES, and nothing else.
 *
 * Three exports, the client half of app/fx.css:
 *
 *   <Reveal as? className? delay?>   content that rises into view as it is scrolled to
 *   <Tilt max? glare? className?>    a card that leans toward a fine pointer
 *   useInView(ref, rootMargin?)      whether an element is on screen, for islands that pause a
 *                                    loop off-screen
 *
 * NOTHING HERE HIDES WHAT IS ALREADY PAINTED. The server renders <Reveal> with no attribute, so its
 * content is in the first paint, with no script and in every crawler. Only after mount, and only
 * for an element whose top is still below the viewport, does it arm; an element the reader can
 * already see is never hidden to be shown again. Under reduced motion it never arms at all, and
 * <Tilt> never writes a value.
 *
 * NEVER ON A NAMED ELEMENT. Neither component may wrap a board row, a strip, a blade, a sheet or
 * anything that carries a view-transition name or contains one: a transform on an ancestor moves
 * the rectangle the route morph flies from. See app/motion.css.
 *
 * Server Components may render these two components and pass them plain props and children. They
 * must not import anything else from this file as a value: a constant exported from a client
 * module reaches a Server Component as a client reference, not as its value. Shared class strings
 * live in lib/controls.ts for that reason.
 *
 * No three.js here. The drum loads it by dynamic import inside its own island.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type RefObject,
} from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";
const FINE = "(pointer: fine)";

function prefersReduced(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCE).matches;
}

/* ------------------------------------------------------------------------------ REVEAL */

export function Reveal({
  as,
  className,
  delay,
  children,
}: {
  /** The element to render. A div by default; pass "section", "li" and so on to keep the outline. */
  as?: ElementType;
  className?: string;
  /** Milliseconds after it starts entering view. Use multiples of --t-stagger (50ms) for siblings. */
  delay?: number;
  children?: ReactNode;
}) {
  const Tag = as ?? "div";
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced() || typeof IntersectionObserver === "undefined") return;
    // Visible now, or above the fold: leave it exactly as painted.
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    el.setAttribute("data-reveal", "armed");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-seen", "");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The delay is a custom property app/fx.css reads only once the element is armed and seen, so it
  // is inert in the server render and costs nothing when the reveal never runs.
  const style = delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined;

  return (
    <Tag ref={ref} className={className} style={style}>
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------------------ TILT */

export function Tilt({
  max = 6,
  glare = false,
  className,
  style,
  children,
}: {
  /** The largest lean, in degrees, on either axis. 6 for cards, 8 for the How cards; never more. */
  max?: number;
  /** Carry an apricot light under the pointer. Only on a --ramp-card surface; see app/fx.css. */
  glare?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia(FINE);
    const reduce = window.matchMedia(REDUCE);
    const lean = Math.min(Math.abs(max), 8);

    const reset = () => {
      el.removeAttribute("data-tilt");
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
      el.style.setProperty("--glare", "0");
    };

    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      if (!fine.matches || reduce.matches) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.setAttribute("data-tilt", "live");
      el.style.setProperty("--ry", `${((x - 0.5) * 2 * lean).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${((0.5 - y) * 2 * lean).toFixed(2)}deg`);
      el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
      el.style.setProperty("--glare", "1");
    };

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", reset);
    reduce.addEventListener("change", reset);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", reset);
      reduce.removeEventListener("change", reset);
    };
  }, [max]);

  const cls = ["tilt", glare ? "tilt-glare" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <div ref={ref} className={cls} style={style}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------------ IN VIEW */

/**
 * True while the element intersects the viewport (grown by `rootMargin`), false before the first
 * observation and after it leaves. For an island that runs a loop: start it on true, stop it on
 * false, and also stop it while `document.hidden`, which this hook does not watch.
 */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  rootMargin = "0px",
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setInView(last.isIntersecting);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);

  return inView;
}
