/**
 * THE CONTROL SURFACES, IN A PLAIN MODULE.
 *
 * These were declared inside components/ceremony.tsx, which carries the client directive. A Server
 * Component cannot import a value out of a module like that: every export of a client module
 * arrives as a client module REFERENCE rather than as its value, with no type error and no warning
 * anywhere in the build. `app/raffle/[id]/page.tsx` documents the same trap at length, having lost
 * an entire section to it, and leaves the note that the fix is to move the constant into a module
 * carrying no directive. This is that module, and it must never gain the directive.
 *
 * So there is one definition of what a button looks like in Drawbook, and both the ceremony's
 * controls and the landing's calls to action read it. The chip the masthead's wallet controls and
 * the back arrow share lives here for the same reason.
 *
 * WHY THEY ARE CLASS STRINGS RATHER THAN A COMPONENT. A `<Button>` would have to take an `as` prop
 * to be a link on the landing and a button in the ceremony, and would then own the distinction
 * between a navigation and an action, which is the caller's to make. Strings own the paint and
 * nothing else.
 *
 * CONTRAST (WCAG 2.x, each pair against its own fill, then after a bar in the record tone):
 *   wine on the paper ramp    the primary's label, 15.80 at the top stop and 12.29 at the bottom.
 *                             The paper does not move with `.inv`, so neither does the figure.
 *   --fg on --panel           the bounded button's label at rest, 16.38 | 14.98
 *   --fg on --panel-2         the same label on hover, 15.06 | 14.98
 *   --bound on --panel        its boundary, 3.97 | 3.63, clear of the 3:1 SC 1.4.11 asks
 *   --fg on the chip fill     the chip's line-tinted fill at 5% over dusk, 15.36; over the
 *                             masthead glass, 13.97. --fg-3 on it is 5.23 and 4.76.
 *   --bound on the chip fill  3.72 over dusk, 3.39 over the glass
 *   focus ring                apricot at a 2px offset, so it lands on the surface around the
 *                             control (13.45 on dusk), never on the paper
 *
 * Neither control is ever coral and neither hover is an apricot fill: coral is a winner and
 * apricot is the signal, and a control is neither.
 */

/**
 * A filled control: the one thing on a surface you are meant to press. The paper ramp, the wine
 * glow and the 2px lift all come from the `cta` utility in app/globals.css.
 */
export const BUTTON_PRIMARY =
  "label cta inline-flex items-center gap-[0.6em] rounded-pill px-[22px] py-3.5";

/** A bounded control: available, clearly outlined, and not competing with the filled one beside it. */
export const BUTTON =
  "label inline-flex items-center gap-[0.6em] rounded-pill border border-bound px-[22px] py-3.5 text-fg transition-[background-color,transform] duration-[var(--t-open)] ease-settle hover:bg-panel-2 hover:-translate-y-px";

/**
 * The primary at the chrome's own scale, for a masthead that is 56px tall and holds one line. Its
 * box is the height it has always been (a label line, py-2 and a 1px border), because every width
 * and height in that bar is budgeted.
 */
export const BUTTON_PRIMARY_SM = "label cta inline-flex items-center gap-[0.5em] rounded-pill px-3 py-2";

/**
 * The masthead chip: the wallet controls, the net chip and the back arrow share it. The box is the
 * one the wallet chips have always had: one label line (1.4em of 11px) plus py-1.5 and the border,
 * so a chip holding only an 11px icon is the same 29px tall as one holding a word. 29px is the drawn
 * box, not the target; the controls among them add `tap`.
 *
 * It carries no text colour, on purpose. The net chip prints in --fg-3 and the others in --fg, and
 * two colour utilities on one element are settled by stylesheet order rather than by the order
 * they are written in, so the caller adds exactly one: `${CHIP} text-fg` or `${CHIP} text-fg-3`.
 */
export const CHIP =
  "label inline-flex min-h-[calc(1.4em+0.75rem+2px)] shrink-0 items-center gap-1.5 rounded-pill border border-bound bg-[rgba(226,150,146,.05)] px-2 py-1.5 transition-colors duration-[var(--t-open)] ease-settle";
