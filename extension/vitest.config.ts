import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["test/**/*.test.ts"],
    // jsdom URL — controls `location.href` inside tests. Override per-file
    // via `// @vitest-environment-options { "url": "..." }` when a test
    // needs to look like Trendyol/Hepsiburada/N11.
    environmentOptions: {
      jsdom: { url: "http://localhost/" },
    },
  },
});
