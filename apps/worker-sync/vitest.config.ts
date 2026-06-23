import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "worker-sync",
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
    },
  },
})
