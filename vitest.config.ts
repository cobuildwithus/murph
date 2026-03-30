import { defineConfig } from "vitest/config";

const ROOT_PACKAGE_PROJECTS = [
  "assistant-runtime",
  "assistantd",
  "cli",
  "core",
  "device-syncd",
  "hosted-execution",
  "importers",
  "inboxd",
  "parsers",
  "query",
  "runtime-state",
] as const;

export default defineConfig({
  test: {
    coverage: {
      include: ROOT_PACKAGE_PROJECTS.map((packageName) => `packages/${packageName}/src/**/*.ts`),
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
    projects: ROOT_PACKAGE_PROJECTS.map((packageName) => `packages/${packageName}/vitest.config.ts`),
  },
});
