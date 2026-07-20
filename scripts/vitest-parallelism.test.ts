import { describe, expect, it } from "vitest";

import { createMurphPackageVitestConfig } from "../config/vitest-package.js";
import {
  resolveMurphAppVitestMaxWorkers,
  resolveMurphVitestMaxWorkers,
} from "../config/vitest-parallelism.js";

describe("Vitest worker budgeting", () => {
  const packageConfigUrl = new URL(
    "../packages/core/vitest.config.ts",
    import.meta.url,
  ).href;

  it("uses the explicit worker override", () => {
    expect(resolveMurphVitestMaxWorkers({ MURPH_VITEST_MAX_WORKERS: "2" })).toBe("2");
  });

  it("uses one worker for Codex while preserving human and CI defaults", () => {
    expect(resolveMurphVitestMaxWorkers({})).toBe("75%");
    expect(resolveMurphAppVitestMaxWorkers({})).toBe("50%");
    expect(resolveMurphVitestMaxWorkers({ CODEX_THREAD_ID: "thread" })).toBe("1");
    expect(resolveMurphAppVitestMaxWorkers({ CODEX_THREAD_ID: "thread" })).toBe("1");
    expect(resolveMurphVitestMaxWorkers({
      CODEX_THREAD_ID: "thread",
      MURPH_VERIFY_SHARED_HOST: "0",
    })).toBe("75%");
    expect(resolveMurphVitestMaxWorkers({ CI: "1", CODEX_THREAD_ID: "thread" })).toBe("50%");
    expect(resolveMurphAppVitestMaxWorkers({ CI: "1", CODEX_THREAD_ID: "thread" })).toBe("25%");
    expect(() => resolveMurphVitestMaxWorkers({
      MURPH_VERIFY_SHARED_HOST: "true",
    })).toThrow("must be 0 or 1");
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
