import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@healthybob/contracts": path.resolve("packages/contracts/src/index.ts"),
      "@healthybob/core": path.resolve("packages/core/src/index.ts"),
      "@healthybob/inboxd": path.resolve("packages/inboxd/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["packages/inboxd/test/**/*.test.ts"],
  },
});
