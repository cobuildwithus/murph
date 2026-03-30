import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "cli",
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
