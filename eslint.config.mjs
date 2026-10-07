import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git worktrees live inside the project (<project>/.worktrees/<name>), and Claude Code's own
    // worktrees under .claude/. Each is a whole second copy of the repo, often with its own .next
    // build tree, and bare `eslint` walks into it: one served worktree took `pnpm lint` from 0 to
    // 411 problems. Those copies are linted from inside themselves, never from here.
    ".worktrees/**",
    ".claude/**",
    // The Rust program's build outputs: cargo's target tree and rialo-build's artifacts. Neither
    // is source, and target/ can hold generated JavaScript from build scripts.
    "program/target/**",
    "program/artifacts/**",
  ]),
]);

export default eslintConfig;
