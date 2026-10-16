import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The window's tests, and the environment they need: React over a DOM, and
// `@testing-library/jest-dom`'s matchers.
//
// The `include` is not decoration. Vitest walks the whole project by default,
// and this repository's root can hold a git worktree or a package store that
// belongs to something else entirely — neither of which is this window. A run
// that picked those up would report on code this checkout does not have.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setup-tests.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
