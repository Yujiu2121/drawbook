// Type shim for React's <ViewTransition>, which this app uses but never installs.
//
// Where the runtime symbol actually comes from: Next 16.2.12 vendors its own React at
// next/dist/compiled/react (version 19.3.0-canary-3f0b9e61-20260317) and aliases the bare
// specifier `react$` onto it for every module in the App Router graph. That vendored build
// exports ViewTransition. The app's own react 19.2.4 does NOT, and neither does
// @types/react 19.2.17, so nothing in the dependency tree describes the symbol and TypeScript
// needs this declaration to see it at all.
//
// The trap that follows: ViewTransition exists only inside the Next build. A file that imports
// it and is run some other way, such as `node scripts/foo.ts` on Node's own type stripping,
// resolves the real react 19.2.4 and gets `undefined`, then fails at render with a cryptic
// invalid-element-type error rather than a missing-export one. Never import ViewTransition
// outside app/ or components/ that Next compiles, and never from lib/ or scripts/.
//
// The leading bare `import "react";` is load-bearing and must stay the first statement.
// It is what makes this file a MODULE, which in turn makes the block below a module
// AUGMENTATION that merges into @types/react. Remove it and the file becomes a script, the
// block becomes an AMBIENT module declaration, and it REPLACES @types/react wholesale: the
// build then dies with `Module '"react"' has no exported member 'Suspense'` and the Next build
// worker exits 1. This was verified both ways.
import "react";

declare module "react" {
  export const ViewTransition: React.FC<{
    name?: string;
    children?: React.ReactNode;
    default?: string;
    enter?: string;
    exit?: string;
    update?: string;
    share?: string;
  }>;
}
