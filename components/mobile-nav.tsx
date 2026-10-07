"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { BUTTON_PRIMARY } from "@/lib/controls";
import { NAV, SECONDARY } from "./nav-links";

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
 * portal. It is a panel that pushes down from under a fixed bar, it is in the document where it
 * reads, and `Escape` and a navigation both close it. A modal would be a heavier promise than
 * four links deserve, and every mechanism a modal needs is a mechanism that can strand a reader.
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
        // chrome that a thumb is expected to find without looking.
        className="relative -mr-2.5 block h-11 w-11 shrink-0 xl:hidden"
      >
        <span
          aria-hidden="true"
          className={`absolute left-[13px] right-[13px] block h-0.5 bg-fg transition-transform duration-[var(--t-open)] ease-settle ${
            open ? "top-[21px] rotate-45" : "top-[17px]"
          }`}
        />
        <span
          aria-hidden="true"
          className={`absolute left-[13px] right-[13px] block h-0.5 bg-fg transition-transform duration-[var(--t-open)] ease-settle ${
            open ? "top-[21px] -rotate-45" : "top-[25px]"
          }`}
        />
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className="fixed inset-x-0 top-mast z-[79] grid gap-0.5 border-b border-rule bg-panel px-pad pt-2 pb-5 xl:hidden"
        >
          {[...NAV, SECONDARY].map((d) => {
            const current = pathname === d.href || (d.also?.test(pathname) ?? false);
            return (
              <Link
                key={d.href}
                href={d.href}
                aria-current={current ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`label border-b border-rule py-3.5 ${current ? "text-fg" : "text-fg-2"}`}
              >
                {d.label}
              </Link>
            );
          })}
          <Link
            href="/raffles"
            onClick={() => setOpen(false)}
            className={`${BUTTON_PRIMARY} mt-3.5 justify-center`}
          >
            Explore raffles <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      ) : null}
    </>
  );
}
