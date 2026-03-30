import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: [
        "packages/assistant-runtime/src/**/*.ts",
        "packages/assistantd/src/**/*.ts",
        "packages/cli/src/**/*.ts",
        "packages/core/src/**/*.ts",
        "packages/device-syncd/src/**/*.ts",
        "packages/hosted-execution/src/**/*.ts",
        "packages/importers/src/**/*.ts",
        "packages/inboxd/src/**/*.ts",
        "packages/parsers/src/**/*.ts",
        "packages/query/src/**/*.ts",
        "packages/runtime-state/src/**/*.ts",
      ],
      exclude: [
        "**/*.d.ts",
        "**/dist/**",
        "**/test/**",
        "**/test-helpers/**",
        "**/fixtures/**",
      ],
      reportOnFailure: true,
    },
    // packages/web, apps/web, and apps/cloudflare stay in their dedicated
    // verify lanes so the root multi-project run does not execute them twice.
    projects: [
      "packages/assistant-runtime/vitest.config.ts",
      "packages/assistantd/vitest.config.ts",
      "packages/cli/vitest.config.ts",
      "packages/core/vitest.config.ts",
      "packages/device-syncd/vitest.config.ts",
      "packages/hosted-execution/vitest.config.ts",
      "packages/importers/vitest.config.ts",
      "packages/inboxd/vitest.config.ts",
      "packages/parsers/vitest.config.ts",
      "packages/query/vitest.config.ts",
      "packages/runtime-state/vitest.config.ts",
    ],
  },
});
