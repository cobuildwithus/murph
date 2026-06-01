import { afterEach, describe, expect, test, vi } from "vitest";

const runForegroundCommand = vi.hoisted(() =>
  vi.fn(async (_input: { args: string[]; command: string }) => {})
);
const cleanupHostedLocalOrphanedWorkerdProcesses = vi.hoisted(() => vi.fn());
const cleanupHostedRunnerContainers = vi.hoisted(() => vi.fn(async () => {}));
const cleanupHostedRunnerImages = vi.hoisted(() => vi.fn(async () => {}));
const cleanupHostedLocalMinioBuildContainersBestEffort = vi.hoisted(() => vi.fn(async () => {}));
const cleanupHostedLocalMinioE2eContainersBestEffort = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../packages/hosted-local-harness/src/process.ts", () => {
  class MockForegroundCommandSignalError extends Error {
    readonly commandSignal: NodeJS.Signals;

    constructor(label: string, signal: NodeJS.Signals) {
      super(`${label} exited with signal ${signal}.`);
      this.name = "ForegroundCommandSignalError";
      this.commandSignal = signal;
    }
  }

  return {
    ForegroundCommandSignalError: MockForegroundCommandSignalError,
    runForegroundCommand,
  };
});

vi.mock("./dev-hosted-local/runtime.ts", () => ({
  cleanupHostedLocalOrphanedWorkerdProcesses,
  cleanupHostedRunnerContainers,
  cleanupHostedRunnerImages,
}));

vi.mock("./dev-hosted-local/minio.ts", () => ({
  cleanupHostedLocalMinioBuildContainersBestEffort,
  cleanupHostedLocalMinioE2eContainersBestEffort,
}));

import { runHostedLocalE2eSuite } from "../packages/hosted-local-harness/src/e2e.ts";

describe("hosted-local E2E suite preparation", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("prepares generated web artifacts once for aggregate scenario runs", async () => {
    const env: NodeJS.ProcessEnv = {};

    await runHostedLocalE2eSuite({
      env,
      prepareRunnerBundle: false,
      scenario: "all",
    });

    expect(runForegroundCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ["--dir", "apps/cloudflare", "runner:docker:base"],
      command: "pnpm",
      label: "Hosted local runner base image preparation",
    }));
    expect(runForegroundCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ["--dir", "apps/web", "prisma:generate"],
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_DEV_SKIP_RUNNER_BUNDLE: "1",
        MURPH_DEV_SKIP_RUNNER_DOCKER_BASE: "1",
      }),
      label: "Hosted local web Prisma client preparation",
    }));
    expect(runForegroundCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ["health-commons:generate"],
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      }),
      label: "Hosted local Health Commons generation",
    }));
    const vitestCalls = runForegroundCommand.mock.calls
      .map(([call]) => call)
      .filter((call) => call.args.includes("vitest"));
    expect(vitestCalls.length).toBeGreaterThan(1);
    expect(vitestCalls[0]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
      ]),
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
        MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
          expect.stringMatching(/^hosted-local-e2e-/u),
      }),
      label: expect.stringMatching(
        /^Hosted local full-stack e2e scenario 1\/\d+ checkpoint-baseline$/u,
      ),
    }));
    expect(vitestCalls[0]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-device-connect-e2e.test.ts",
    );
    expect(cleanupHostedRunnerContainers).toHaveBeenCalled();
    expect(cleanupHostedRunnerContainers).toHaveBeenCalledWith(expect.objectContaining({
      ignoreErrors: false,
      scope: "e2e-builds",
      timeoutMs: 60_000,
    }));
    expect(cleanupHostedRunnerImages).toHaveBeenCalledTimes(1);
    expect(cleanupHostedRunnerImages).toHaveBeenCalledWith(expect.objectContaining({
      ignoreErrors: true,
      timeoutMs: 60_000,
    }));
    expect(cleanupHostedLocalMinioBuildContainersBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
          expect.stringMatching(/^hosted-local-e2e-/u),
      }),
      expect.stringMatching(/^hosted-local-e2e-/u),
    );
    expect(cleanupHostedLocalMinioE2eContainersBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      }),
    );
    expect(cleanupHostedLocalOrphanedWorkerdProcesses).toHaveBeenCalled();
  });

  test("does not add aggregate-only web preparation for one focused scenario", async () => {
    await runHostedLocalE2eSuite({
      env: {},
      prepareRunnerBundle: false,
      scenario: "checkpoint-baseline",
    });

    expect(runForegroundCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["--dir", "apps/web", "prisma:generate"],
    }));
    expect(runForegroundCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["health-commons:generate"],
    }));
    expect(runForegroundCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
      ]),
      label: "Hosted local full-stack e2e suite",
    }));
  });
});
