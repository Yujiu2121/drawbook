import Link from "next/link";

import { BackLink } from "./back-link";
import { LogoMark, Wordmark } from "./logo";
import { MobileNav } from "./mobile-nav";
import { DeployLink, NavLinks } from "./nav-links";
import { ChainNotice, NetChip, WalletChip } from "./wallet-chip";
import { BUTTON_PRIMARY_SM } from "@/lib/controls";

/**
 * The masthead. One fixed line, `--mast` tall, identical on every route.
 *
 * A SERVER SHELL WITH CLIENT ISLANDS IN IT. Nothing here holds state. The children that need a
 * browser hold their own and stay small: `NavLinks` reads the pathname for `aria-current`,
 * `BackLink` reads it to know whether it has anywhere to go back to, `MobileNav` holds the menu,
 * and the two chips and the chain notice read the wallet store. Everything else, the line itself, its height, its rule, its order, is markup the
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
 * Three islands subscribe to the store, and it is written for that: `started` is checked, not
 * counted, and teardown waits for `listeners.size === 0`. None of them runs a second poll.
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
 * WHAT SITS WHERE, AND WHY THE ORDER IS THIS ORDER. Identity, then destinations, then, pushed to
 * the far edge as one group, the things that describe the current state of the session: where you
 * came from, which chain you are on, and who you are on it, then the call to action and the menu.
 * Reading left to right that is the product's name, what it can do, and what is true right now.
 *
 * THE RIGHT-HAND GROUP IS ONE ELEMENT WITH `ml-auto`, NOT A SPACER. It used to be a `flex-1` span
 * in the middle of the bar, which cost one extra gap on every side of it, and at 360 that gap was
 * the difference between fitting and not. A group also lets the chips sit on a tighter gap than
 * the identity and the nav do, which is where the rest of the room at 1280 came from. `BackLink`
 * renders null off a detail route, and null inside a flex container takes no gap with it.
 *
 * NOTHING IN THIS BAR IS ALLOWED TO WRAP, at any width. `whitespace-nowrap` is set once on the
 * header, because there is no string in a masthead that reads better broken across two lines, and
 * a fixed bar with a hard height turns a wrapped label into clipped text rather than a taller bar.
 *
 * THE SECOND LINE IS REFUSED. `--mast` is a single number the whole product reads: every route
 * sets its own top offset with `pt-mast` and the ceremony reads the same token as a scroll offset,
 * so a bar that is 56px on one side of a breakpoint and 80px on the other is a bar whose height no
 * longer matches the space reserved for it. So this bar is 56px everywhere and holds one line
 * everywhere, and it pays for that by deciding, per width, what it can afford to say.
 *
 * AND NOTHING IN IT MAY SHRINK, WHICH IS THE LESSON OF K1. The wallet chip used to be the one child
 * allowed to give way, a shrinkable wrapper around rigid controls. Below 1536 it gave way, its
 * rigid children spilled out of it and painted underneath "Deploy a raffle", "Explore raffles" and
 * the menu button, and a press on FAUCET went to /create while a tap on Forget opened the menu. A
 * shrinkable box around unshrinkable content is an overlap waiting for a long enough address. So
 * every child is rigid, and the bar fits because each width shows only what fits it, measured in
 * Chromium against the real subset faces with a connected wallet on a raffle page (the widest case:
 * the back affordance is there too) and an eight-digit testnet height:
 *
 *   width    identity   destinations   chips (left to right)                                 menu
 *   < 640    mark       menu           back arrow, network, faucet arrow, address prefix     yes
 *   640      wordmark   menu           back, network + height, faucet arrow, address         yes
 *   768      wordmark   menu           ... and the balance joins the address                 yes
 *   1024     wordmark   menu           ... and the faucet gains its word                     yes
 *   1280     wordmark   3 + Deploy     back, network + height, faucet, address + balance     no
 *   1536     wordmark   3 + Deploy     ... and "Rialo", and the Explore raffles button       no
 *
 * The wallet itself is two controls in this bar, a faucet and the account, and the account opens a
 * panel with everything else: components/wallet-chip.tsx has why.
 *
 * THE DESTINATIONS LEAVE THE BAR BELOW 1280, AND A MENU CATCHES THEM. The three labels and Deploy
 * cost about 400px with their tap padding, which a 1024 laptop with a connected wallet does not
 * have once the faucet carries its word. The faucet won that trade because it is pressed on stage
 * and the destinations are one tap away in the menu. `components/mobile-nav.tsx` is the menu, a
 * disclosure rather than a modal; the reasoning is in its own header.
 *
 * "EXPLORE RAFFLES" WAITS FOR 1536. It goes where the first destination, "Raffles", already goes,
 * one item to its left, so below 1536 it was the one thing in the bar that said nothing new, and it
 * was the first thing the wallet chip painted under. It is in the menu at every width below that.
 *
 * The chips never leave: which chain you are on and whether you are connected to it are the two
 * facts a testnet product must not drop, and the adversary pass on the port caught an earlier build
 * deleting the network chip to make room.
 *
 * The wide nav is hidden with `display: none` rather than clipped, so it leaves the accessibility
 * tree with it, and the menu panel is not rendered at all until it is opened, so a screen reader
 * meets exactly one copy of the destinations at any width.
 *
 * THE NAME LEAVES THE LOCKUP BELOW 640 AND THE MARK STAYS, AT A THUMB'S SIZE. The word "Drawbook"
 * is 82px that a phone cannot spare and the only thing in the bar the page under it already says.
 * The mark is still one link home, and its link is a 44px square even though the mark is 13px
 * (CHROME-N8): the same size as the menu button at the other edge, pulled into the gutter by a
 * negative margin so the mark itself stays on the gutter line and the bar loses no measure. Two
 * links to `/` are rendered and exactly one of them is ever in the accessibility tree, because the
 * other is `display: none`.
 */
export function Masthead() {
  return (
    <header className="fixed inset-x-0 top-0 z-[80] flex h-mast flex-nowrap items-center gap-[clamp(10px,2vw,26px)] border-b border-rule bg-panel px-gutter whitespace-nowrap">
      {/*
        The identity and the nav are wrapped rather than handed a class. Every child of this bar is
        owned by another file, and a wrapper asks those files for nothing but their name.
        -ml-[15.5px] is (44 - 13) / 2: it puts the 13px mark exactly on the gutter line while its
        44px tap square reaches into the gutter.
      */}
      <Link
        href="/"
        aria-label="Drawbook, home"
        className="-ml-[15.5px] flex h-11 w-11 shrink-0 items-center justify-center sm:hidden"
      >
        <LogoMark className="h-[13px] w-[13px]" />
      </Link>

      <span className="hidden shrink-0 items-center sm:flex">
        <Wordmark />
      </span>

      <div className="hidden shrink-0 xl:flex xl:items-center">
        <NavLinks />
      </div>

      {/*
        The right-hand group. A tighter gap than the bar's own, because these are bordered chips
        that read as one cluster, and at 1280 that difference is what makes room for the faucet's
        word. 8px at a phone is still clear of the 24px target spacing SC 2.5.8 asks for, since
        every chip is at least 29px square, and on a touch screen or below 1024 each control chip
        is touched through a 44px target (`tap`, app/globals.css block 7) that this gap keeps clear
        of its neighbours'.
      */}
      <div className="ml-auto flex shrink-0 items-center gap-[clamp(8px,1.2vw,16px)]">
        <BackLink />
        <NetChip />
        <WalletChip />

        {/* The secondary destination and the call to action, in that order, so the thing you are
            most likely to want is the thing nearest the edge. Deploy joins at 1280 with the
            destinations; Explore at 1536, for the reason in the header. Both are in the menu. */}
        <span className="hidden shrink-0 items-center xl:flex">
          <DeployLink />
        </span>
        <span className="hidden shrink-0 items-center 2xl:flex">
          <Link href="/raffles" className={BUTTON_PRIMARY_SM}>
            Explore raffles
          </Link>
        </span>

        <MobileNav />
      </div>

      {/* Fixed under the bar, so it takes no room in it. Renders nothing while the chain answers. */}
      <ChainNotice />
    </header>
  );
}
