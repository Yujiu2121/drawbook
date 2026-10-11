"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { BUTTON_PRIMARY } from "@/lib/controls";
import { FootTick, NAV, SECONDARY, useCurrent } from "./nav-links";

/**
 * ONE DISCLOSURE UNDER THE BAR AT A TIME.
 *
 * The menu and the wallet panel both hang from the bottom of the masthead, at the same place and on
 * the same layer, so if both were open one would simply cover the other. Each announces itself as
 * it opens and closes when it hears the other. A window event rather than a shared store or a
 * context: there are two listeners, they live in sibling client islands of a Server Component, and
 * a provider at the root is exactly what the layout refuses to add.
 */
const DISCLOSE = "drawbook:disclose";

export function announceOpen(who: string) {
  window.dispatchEvent(new CustomEvent<string>(DISCLOSE, { detail: who }));
}

export function useCloseWhenOtherOpens(who: string, open: boolean, onClose: () => void) {
  // The latest callback, so a caller can pass an inline function without resubscribing each render.
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== who) latest.current();
    };
    window.addEventListener(DISCLOSE, on);
    return () => window.removeEventListener(DISCLOSE, on);
  }, [who, open]);
}

/**
 * One row's entrance delay, 30ms a step, as a transition-delay list whose first `entering` entries
 * are the stagger and whose rest are zero (the hover transitions after them).
 *
 * It is carried in a custom property, `--d`, and applied only by `motion-safe:[transition-delay:
 * var(--d)]`. An inline transition-delay would also apply under reduced motion, where the paper
 * control's own transition list (transform, box-shadow) is all that is left, and its hover shadow
 * would trail the pointer by the stagger.
 */
function stagger(step: number, entering: number): CSSProperties {
  const d = `${step * 30}ms`;
  return { "--d": [...Array<string>(entering).fill(d), "0ms", "0ms"].join(", ") } as CSSProperties;
}

/**
 * THE MENU, BELOW THE WIDTH WHERE THE DESTINATIONS FIT IN THE BAR.
 *
 * WHY THIS EXISTS NOW AND DID NOT BEFORE. The bar is 56px everywhere and holds one line
 * everywhere, and the destinations plus the identity plus the widest chip forms cost more than the
 * measure below 1280 (the arithmetic is in components/masthead.tsx). The old answer was to drop the destinations entirely and let the
 * footer carry them, which is defensible and was the previous system's decision for the same
 * reason. It stops being defensible once the bar also carries a call to action: a phone then gets
 * a mark, two chips and a button, and no way to reach any section of the product without scrolling
 * to the foot of whatever page it landed on.
 *
 * TWO BARS, NOT THREE, AND THEY BECOME AN X. Three equal bars in a square is the glyph this
 * product's own mark was redrawn to avoid, and at 16px it is unreadable as anything else. Two
 * bars are unambiguous at every size, and crossing them on open is motion that reports state
 * rather than motion that decorates: the control says what pressing it will do next.
 *
 * THE PANEL IS A DISCLOSURE, NOT AN OVERLAY. No scrim, no scroll lock, no focus trap and no
 * portal. It is a glass card that hangs 6px under the floating pill, as wide as the pill, it is in
 * the document where it reads, and `Escape` and a navigation both close it. A modal would be a
 * heavier promise than four links deserve, and every mechanism a modal needs is a mechanism that
 * can strand a reader.
 *
 * IT ARRIVES AND DOES NOT LEAVE. Opening it runs one entrance from `@starting-style`: the card
 * fades up 6px from 98% scale over --t-open and its rows follow 30ms apart. Closing removes it at
 * once, because the panel is not rendered while closed and an exit would need it kept in the tree
 * (and a second copy of the destinations in the accessibility tree while it faded). Under reduced
 * motion there is no transition, so the starting style never shows and the card is simply there.
 *
 * WHICH ROW IS CURRENT IS READ FROM THE RENDERED ROUTE, through `useCurrent()`, the same reading
 * the bar's own links use, so a 404 under /raffle/ marks no row here either. `usePathname` stays
 * only as the close-on-navigate signal, where nothing is drawn from it.
 *
 * IT RENDERS NOTHING FROM 1280 UP. The button is hidden by a utility, and the panel only exists in
 * the tree while it is open, so a wide viewport carries no duplicate copy of the destinations into
 * the accessibility tree. The breakpoint moved from 1024 to 1280 when the wallet grew a faucet that
 * is pressed on stage: the masthead's header has the arithmetic.
 *
 * ESCAPE HANDS FOCUS BACK TO THE BUTTON (B-11). The links unmount with the panel, so a reader who
 * had tabbed into it and pressed Escape was left on <body>, at the top of the tab order.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isCurrent = useCurrent();
  const panelId = useId();
  // The pathname at the moment the panel was opened. A navigation is what closes it, and comparing
  // against this is how a link to the page you are already on does not leave the panel hanging.
  const openedAt = useRef(pathname);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useCloseWhenOtherOpens("menu", open, () => setOpen(false));

  useEffect(() => {
    if (!open) {
      openedAt.current = pathname;
      return;
    }
    if (pathname !== openedAt.current) setOpen(false);
  }, [pathname, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Read before the close commits, while the links are still in the tree. Focus left on
      // <body> counts as lost too (a tap on the panel's padding puts it there), and so does the
      // button itself, which simply keeps it. Focus on some other control the reader moved to
      // is left where it is: Escape closes the menu, it does not drag them back to it.
      const active = document.activeElement;
      const lost =
        active === null ||
        active === document.body ||
        active === buttonRef.current ||
        (panelRef.current?.contains(active) ?? false);
      setOpen(false);
      if (lost) buttonRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={open ? "Close menu" : "Menu"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) announceOpen("menu");
          setOpen((o) => !o);
        }}
        // 44px square: the tap target the whole bar is sized around, and the only control in the
        // chrome that a thumb is expected to find without looking. A ghost pill on a hairline, so
        // it reads as a control on the glass; -mr-2.5 puts its circle 2px inside the pill's
        // rounded end, concentric with it, with the content edge where it has always been. Below
        // 360 the ring goes transparent: with the back arrow and a connected wallet the bar is over
        // its budget there, the button runs past the pill's end, and a ring would draw a broken
        // double outline against it. The two bars still sit inside the pill.
        className="relative -mr-2.5 block h-11 w-11 shrink-0 rounded-pill border border-rule max-[22.5rem]:border-transparent transition-colors duration-[var(--t-open)] ease-settle hover:bg-[rgba(var(--line-rgb),.08)] xl:hidden"
      >
        <span
          aria-hidden="true"
          className={`absolute left-[13px] right-[13px] block h-0.5 rounded-pill bg-fg transition-[top,rotate] duration-[var(--t-open)] ease-settle ${
            open ? "top-[20px] rotate-45" : "top-[16px]"
          }`}
        />
        <span
          aria-hidden="true"
          className={`absolute left-[13px] right-[13px] block h-0.5 rounded-pill bg-fg transition-[top,rotate] duration-[var(--t-open)] ease-settle ${
            open ? "top-[20px] -rotate-45" : "top-[24px]"
          }`}
        />
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          /*
            Hung from the viewport, not from the pill: the pill is a sibling span, so nothing in the
            header is a containing block and `fixed` here means the viewport (top 62 = 56 + 6). The
            insets are the pill's own, so the card is exactly as wide as the bar it drops from.
            `whitespace-normal` undoes the bar's nowrap, which a fixed child still inherits.
          */
          className="fixed inset-x-[calc(var(--gutter)-12px)] top-[calc(var(--mast)+6px)] z-[79] grid max-h-[calc(100dvh-var(--mast)-12px)] gap-1 overflow-y-auto rounded-[22px] glass p-3 whitespace-normal shadow-panel motion-safe:transition-[opacity,translate,scale] motion-safe:duration-[var(--t-open)] motion-safe:ease-rise starting:-translate-y-1.5 starting:scale-[.98] starting:opacity-0 xl:hidden"
        >
          {[...NAV, SECONDARY].map((d, i) => {
            const current = isCurrent(d);
            return (
              <Link
                key={d.href}
                href={d.href}
                aria-current={current ? "page" : undefined}
                onClick={() => setOpen(false)}
                // The stagger delays the entrance only (opacity and translate, the first two in the
                // transition list), never the hover, so a row answers the pointer at once.
                style={stagger(i + 1, 2)}
                className={`label relative flex min-h-11 items-center rounded-row px-3.5 py-3.5 transition-[opacity,translate,background-color,color] motion-safe:[transition-delay:var(--d)] duration-[var(--t-open)] ease-rise motion-reduce:transition-none starting:-translate-y-1 starting:opacity-0 ${
                  current
                    ? "bg-[rgba(var(--line-rgb),.10)] text-fg"
                    : "text-fg-2 hover:bg-[rgba(var(--line-rgb),.08)] hover:text-fg"
                }`}
              >
                {d.label}
                {current ? <FootTick place="bottom-[7px] left-3.5" /> : null}
              </Link>
            );
          })}
          <Link
            href="/raffles"
            onClick={() => setOpen(false)}
            // The entrance joins the paper control's own transform and shadow transitions, and only
            // the entrance is staggered, so its lift under the pointer is not held back.
            style={stagger(NAV.length + 2, 2)}
            className={`${BUTTON_PRIMARY} mt-2 justify-center motion-safe:[transition-property:opacity,translate,transform,box-shadow] motion-safe:[transition-delay:var(--d)] starting:-translate-y-1 starting:opacity-0`}
          >
            Explore raffles <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      ) : null}
    </>
  );
}
