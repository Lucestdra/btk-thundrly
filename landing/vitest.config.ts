import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts"],
  },
});
