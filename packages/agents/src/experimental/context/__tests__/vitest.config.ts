import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    clearMocks: true,
    include: ["src/experimental/context/__tests__/*.test.ts"]
  }
});
