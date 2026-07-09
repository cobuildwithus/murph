import { describe, expect, it } from "vitest";

import { createMurphPackageVitestConfig } from "../config/vitest-package.js";
import { resolveMurphVitestMaxWorkers } from "../config/vitest-parallelism.js";

describe("Vitest worker budgeting", () => {
  const packageConfigUrl = new URL(
    "../packages/core/vitest.config.ts",
    import.meta.url,
  ).href;

  it("uses the explicit worker override", () => {
    expect(resolveMurphVitestMaxWorkers({ MURPH_VITEST_MAX_WORKERS: "2" })).toBe("2");
  });

  it("wires the shared worker budget into package configs while preserving package overrides", () => {
    const previousValue = process.env.MURPH_VITEST_MAX_WORKERS;
    process.env.MURPH_VITEST_MAX_WORKERS = "3";

    try {
      expect(
        createMurphPackageVitestConfig({
          configUrl: packageConfigUrl,
          name: "worker-budget-default",
        }),
      ).toMatchObject({
        test: { maxWorkers: "3" },
      });
      expect(
        createMurphPackageVitestConfig({
          configUrl: packageConfigUrl,
          name: "worker-budget-override",
          test: { maxWorkers: 1 },
        }),
      ).toMatchObject({
        test: { maxWorkers: 1 },
      });
    } finally {
      if (previousValue === undefined) {
        delete process.env.MURPH_VITEST_MAX_WORKERS;
      } else {
        process.env.MURPH_VITEST_MAX_WORKERS = previousValue;
      }
    }
  });
});
