import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests only — pure functions in `api/_lib` and `src/lib`.
 *
 * Components and handlers are covered by the Playwright suites instead: they
 * test real behaviour in a real browser, which is what caught the
 * pointer-events bug that no jsdom approximation would have.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
