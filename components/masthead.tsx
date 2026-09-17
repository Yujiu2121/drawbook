import Link from "next/link";

import { BackLink } from "./back-link";
import { LogoMark, Wordmark } from "./logo";
import { MobileNav } from "./mobile-nav";
import { DeployLink, NavLinks } from "./nav-links";
import { NetChip, WalletChip } from "./wallet-chip";
import { BUTTON_PRIMARY_SM } from "@/lib/controls";

/**
 * The masthead. One fixed line, `--mast` tall, identical on every route.
 *
 * A SERVER SHELL WITH FOUR ISLANDS IN IT. Nothing here holds state. The four children that need a
 * browser hold their own and stay small: `NavLinks` reads the pathname for `aria-current`,
 * `BackLink` reads it to know whether it has anywhere to go back to, and the two chips read the
 * wallet store. Everything else, the line itself, its height, its rule, its order, is markup the
 * server emits once. That split is the repo's pattern rather than a preference: a route can be a
 * Server Component the whole way down only if its chrome is too.
 *
 * MOUNTED ONCE, FROM THE ROOT LAYOUT, AND THAT IS LOAD-BEARING. Until this port the masthead was
 * rendered by each route, so every navigation tore it down and built a new one. Three things go
 * wrong that way and all three are fixed by moving it up one level. `lib/wallet-store.ts` starts its
 * poll on the first subscriber and stops it when the last one leaves, guarded by a module-level
 * `started` flag, so a per-route mount meant clearing the interval and re-running `bootstrap()` on
 * every single navigation, and the block height restarted from "connecting" each time. `aria-current`
 * moved by remount rather than by `usePathname`. And the view transition had no stable frame around
 * the part of the page that is actually morphing: the masthead is identical on both sides of a
 * navigation, so as part of the `root` snapshot it cross-fades against itself and is invisible,
 * which is exactly what `app/motion.css` assumes when it swaps the page under the flying cell.
 *
 * Two chips subscribe, not one, and the store is written for that: `started` is checked, not
 * counted, and teardown waits for `listeners.size === 0`. Neither of them runs a second poll.
 *
 * THE LINE IS A SURFACE, NOT A TINT. Counterfoil painted this bar as a translucent wash over the
 * page with a soft edge behind it. In this system the ground is the light source and ink is where
 * light is blocked, so there is nothing for a soft edge to be made of and no second light to tint
 * anything with. The masthead is simply the panel, drawn opaque, with one hairline rule along the
 * bottom. Content passing underneath is hidden by it rather than showing through, which is the
 * honest behaviour of an opaque object and also the only way a 15px figure stays readable while a
 * ticket bed scrolls behind it.
 *
 * The one consequence worth stating: `--panel` painted across the full width covers the fixed
 * diffusion film that `globals.css` hangs off `body::after`. It costs the film in the top 56px, at
 * 5.5% opacity, and it buys an opaque bar. The preview makes the same trade.
 *
 * THE NET CHIP CARRIES THE LIVE BLOCK HEIGHT RATHER THAN A COLOURED SQUARE. The approved preview
 * puts a small filled square beside the word "testnet" to say the chain is there. This product does
 * not, and has not since the wallet bar was written: it prints the height instead. It is the same
 * claim made with data instead of decoration, and unlike a square it cannot lie, because if the
 * number stops climbing the chain connection is gone and you can see that it is. Cell's own material
 * model agrees with the older decision, since a square that means "connected" is decoration and this
 * system has none.
 *
 * WHAT SITS WHERE, AND WHY THE ORDER IS THIS ORDER. Identity, then destinations, then a spacer, then
 * the three things that describe the current state of the session: where you came from, which chain
 * you are on, and who you are on it. Reading left to right that is the product's name, what it can
 * do, and what is true right now, which is also the order someone landing cold needs them in.
 *
 * THE SPACER IS AN ELEMENT RATHER THAN `justify-between` OR `ml-auto`. With a `flex-1` span in the
 * middle, both sides keep the same gap rule and the bar has one honest hinge. `ml-auto` on the first
 * right-hand child does the same thing while hiding which child is load-bearing, and that child is
 * `BackLink`, which renders nothing on five of the six routes.
 *
 * NOTHING IN THIS BAR IS ALLOWED TO WRAP, at any width. `whitespace-nowrap` is set once on the
 * header rather than on each chip, because there is no string in a masthead that reads better broken
 * across two lines, and because a fixed bar with a hard height turns a wrapped label into clipped
 * text rather than a taller bar.
 *
 * THE SECOND LINE IS REFUSED, AND THAT IS WHAT FORCES THE TWO RULES BELOW. `--mast` is a single
 * number the whole product reads: every route sets its own top offset with `pt-mast` and the
 * ceremony reads the same token as a scroll offset, so a bar that is 56px on one side of a
 * breakpoint and 80px on the other is a bar whose height no longer matches the space reserved for
 * it. The preview does wrap at phone width, but what it puts on its second line is its own route
 * switcher, which is a demo control and does not ship. So this bar is 56px everywhere, holds one
 * line everywhere, and pays for that by dropping the two things that are said somewhere else.
 *
 * THE DESTINATIONS LEAVE THE BAR BELOW 1024, AND A MENU CATCHES THEM. Measured in Chromium against
 * the real subset faces, the labels set at the label width cost 274px with their tap padding, the
 * identity lockup costs 95px, and the widest chip forms I could measure cost 436px between them.
 * Add the gaps and the whole set clears the measure that `--pad` leaves from about 995px upward.
 * `lg` is the nearest stop above that.
 *
 * THIS IS THE ONE DECISION IN THIS FILE THAT REVERSED. The previous answer was to drop the
 * destinations below that width and let the footer carry them: four links behind a menu button is
 * worse than four links in a footer, and that was the previous system's call for the same reason.
 * It stopped being right when the bar gained a call to action. A phone then got a mark, two chips
 * and a button, with no way to reach any section of the product except by scrolling to the foot of
 * whatever page it had landed on, and "the footer has them" is a poor answer on a landing page
 * that is eight sections tall. `components/mobile-nav.tsx` is the menu, and it is a disclosure
 * rather than a modal; the reasoning is in its own header.
 *
 * The chips do not move: which chain you are on and whether you are connected to it are the two
 * facts a testnet product must not drop, and the adversary pass on the port caught an earlier
 * build deleting the network chip to make room.
 *
 * The wide nav is hidden with `display: none` rather than clipped, so it leaves the accessibility
 * tree with it, and the menu panel is not rendered at all until it is opened, so a screen reader
 * meets exactly one copy of the destinations at any width.
 *
 * THE NAME LEAVES THE LOCKUP BELOW 640 AND THE MARK STAYS. A 390px viewport has 350px of measure
 * after the gutter, and the back affordance plus the two chips have already spent most of it. The
 * word "Drawbook" is 82px of that, and it is the only thing in the bar that the page under it
 * already says: every route carries its own title, and the browser tab carries the name. The mark
 * is the identity that survives, it is still one link home, and it is the same two-band square the
 * lockup opens with, so nothing changes shape across the breakpoint. Two links to `/` are rendered
 * and exactly one of them is ever in the accessibility tree, because the other is `display: none`.
 */
export function Masthead() {
  return (
    <header className="fixed inset-x-0 top-0 z-[80] flex h-mast flex-nowrap items-center gap-[clamp(10px,2vw,26px)] border-b border-rule bg-panel px-pad whitespace-nowrap">
      {/*
        The identity and the nav are wrapped rather than handed a class. Every child of this bar is
        owned by another file, and a wrapper asks those files for nothing but their name. The three
        children below are not wrapped at all: `BackLink` returns null off a detail route, and an
        empty wrapper would still be a flex item and would still take its gap with it. A hidden one
        does not, which is why the identity below is safe to write as two elements that trade places
        at the breakpoint rather than as one element that changes.
      */}
      <Link
        href="/"
        aria-label="Drawbook, home"
        className="flex shrink-0 items-center sm:hidden"
      >
        <LogoMark className="h-[13px] w-[13px]" />
      </Link>

      <span className="hidden shrink-0 items-center sm:flex">
        <Wordmark />
      </span>

      <div className="hidden shrink-0 lg:flex lg:items-center">
        <NavLinks />
      </div>

      <span aria-hidden="true" className="min-w-0 flex-1" />

      <BackLink />
      <NetChip />
      <WalletChip />

      {/* The secondary destination and the call to action, in that order, so the thing you are
          most likely to want is the thing nearest the edge your thumb is on. Both leave the bar at
          the same width the destinations do, and both are in the drawer below it. */}
      <span className="hidden shrink-0 items-center gap-[clamp(10px,2vw,26px)] lg:flex">
        <DeployLink />
        <Link href="/raffles" className={BUTTON_PRIMARY_SM}>
          Explore raffles
        </Link>
      </span>

      <MobileNav />
    </header>
  );
}
