import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "packages/core/test/core.test.ts",
      "packages/core/test/profile.test.ts",
      "packages/core/test/health-history-family.test.ts",
      "packages/importers/test/importers.test.ts",
      "packages/query/test/health-tail.test.ts",
      "packages/query/test/query.test.ts",
      "packages/cli/test/health-tail.test.ts",
      "packages/cli/test/incur-smoke.test.ts",
      "packages/cli/test/runtime.test.ts",
    ],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: [
        "packages/core/src/constants.ts",
        "packages/core/src/ids.ts",
        "packages/core/src/jsonl.ts",
        "packages/core/src/mutations.ts",
        "packages/core/src/raw.ts",
        "packages/core/src/vault.ts",
        "packages/importers/src/csv-sample-importer.ts",
        "packages/importers/src/document-importer.ts",
        "packages/importers/src/meal-importer.ts",
        "packages/query/src/export-pack.ts",
        "packages/query/src/model.ts",
        "packages/query/src/summaries.ts",
      ],
      exclude: [
        "coverage/**",
        "dist/**",
        "**/*.d.ts",
      ],
      thresholds: {
        perFile: true,
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
