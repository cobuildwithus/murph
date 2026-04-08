import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    name: "contracts",
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "custom",
      customProviderModule: path.resolve(packageDir, "../../config/vitest-coverage-provider.ts"),
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "coverage/**",
        "dist/**",
        "generated/**",
        "**/*.d.ts",
      ],
      thresholds: {
        lines: 55,
        functions: 50,
        branches: 45,
        statements: 55,
      },
      reportOnFailure: true,
    },
  },
});
