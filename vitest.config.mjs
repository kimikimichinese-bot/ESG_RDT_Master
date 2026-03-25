import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/**/tests/**/*.test.{js,ts}"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/test-results/**"],
    globals: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
