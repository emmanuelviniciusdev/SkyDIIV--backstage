import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "upstash-workflow-generate-weekly-outfits",
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
