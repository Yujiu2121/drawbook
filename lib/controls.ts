/**
 * THE TWO CONTROL SURFACES, IN A PLAIN MODULE.
 *
 * These were declared inside components/ceremony.tsx, which carries the client directive. A Server
 * Component cannot import a value out of a module like that: every export of a client module
 * arrives as a client module REFERENCE rather than as its value, with no type error and no warning
 * anywhere in the build. `app/raffle/[id]/page.tsx` documents the same trap at length, having lost
 * an entire section to it, and leaves the note that the fix is to move the constant into a module
 * carrying no directive. This is that module.
 *
 * So there is one definition of what a button looks like in Drawbook, and both the ceremony's
 * controls and the landing's calls to action read it.
 *
 * WHY THEY ARE CLASS STRINGS RATHER THAN A COMPONENT. A `<Button>` would have to take an `as` prop
 * to be a link on the landing and a button in the ceremony, and would then own the distinction
 * between a navigation and an action, which is the caller's to make. Two strings own the paint and
 * nothing else.
 *
 * CONTRAST (WCAG 2.x, each pair against its own fill):
 *   --fg on --panel        primary at rest, 15.01 light, 15.01 inverted
 *   --panel on --fg        the reverse, the same figure
 *   --on-won on --event    the primary's hover, 7.05 light, 8.01 inverted. `--on-won` rather than
 *                          the raw `--paper`, which is not exposed as a utility on purpose: inside
 *                          `.inv` the accent becomes --iris-lift and light text on it is 1.42,
 *                          while --on-won follows the block to --ink and stays legible.
 *   --fg on --panel-2      the quiet button's label, 13.82 light, 15.01 inverted
 *   --bound on --panel     its boundary, 5.18 light, 5.65 inverted, clear of the 3:1 SC 1.4.11 asks
 */

/** A filled control: the one thing on a surface you are meant to press. */
export const BUTTON_PRIMARY =
  "label inline-flex items-center gap-[0.6em] border border-transparent bg-fg px-[18px] py-3 text-panel transition-colors duration-[var(--t-open)] ease-settle hover:bg-event hover:text-on-won";

/** A bounded control: available, and not competing with the filled one beside it. */
export const BUTTON =
  "label inline-flex items-center gap-[0.6em] border border-bound px-[18px] py-3 text-fg transition-colors duration-[var(--t-open)] ease-settle hover:bg-panel-2";

/** The same pair at the chrome's own scale, for a masthead that is 56px tall and holds one line. */
export const BUTTON_PRIMARY_SM =
  "label inline-flex items-center gap-[0.5em] border border-transparent bg-fg px-3 py-2 text-panel transition-colors duration-[var(--t-open)] ease-settle hover:bg-event hover:text-on-won";
