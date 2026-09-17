"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { BUTTON_PRIMARY } from "@/lib/controls";
import { NAV, SECONDARY } from "./nav-links";

/**
 * THE MENU, BELOW THE WIDTH WHERE THE DESTINATIONS FIT IN THE BAR.
 *
 * WHY THIS EXISTS NOW AND DID NOT BEFORE. The bar is 56px everywhere and holds one line
 * everywhere, and the four labels plus the identity plus the widest chip forms cost more than the
 * measure below about 995px. The old answer was to drop the destinations entirely and let the
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
 * IT RENDERS NOTHING ABOVE 1024. The button is hidden by a utility, and the panel only exists in
 * the tree while it is open, so a wide viewport carries no duplicate copy of the destinations into
 * the accessibility tree.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  // The pathname at the moment the panel was opened. A navigation is what closes it, and comparing
  // against this is how a link to the page you are already on does not leave the panel hanging.
  const openedAt = useRef(pathname);

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
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close menu" : "Menu"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        // 44px square: the tap target the whole bar is sized around, and the only control in the
        // chrome that a thumb is expected to find without looking.
        className="relative -mr-2.5 block h-11 w-11 shrink-0 lg:hidden"
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
          id={panelId}
          className="fixed inset-x-0 top-mast z-[79] grid gap-0.5 border-b border-rule bg-panel px-pad pt-2 pb-5 lg:hidden"
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
