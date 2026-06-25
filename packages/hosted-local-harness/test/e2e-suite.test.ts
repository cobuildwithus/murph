import { afterEach, describe, expect, test, vi } from "vitest";
import type { ForegroundCommandInput } from "../src/process.ts";

const runForegroundCommand = vi.hoisted(() =>
  vi.fn(async (_input: ForegroundCommandInput) => {})
);
const cleanupHostedLocalOrphanedWorkerdProcesses = vi.hoisted(() => vi.fn());
const cleanupHostedRunnerContainers = vi.hoisted(() => vi.fn(async () => {}));
const cleanupHostedRunnerImages = vi.hoisted(() => vi.fn(async () => {}));
const cleanupHostedLocalMinioBuildContainersBestEffort = vi.hoisted(() => vi.fn(async () => {}));
const cleanupHostedLocalMinioE2eContainersBestEffort = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../src/process.ts", () => {
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

vi.mock("../src/dev-hosted-local/runtime.ts", () => ({
  cleanupHostedLocalOrphanedWorkerdProcesses,
  cleanupHostedRunnerContainers,
  cleanupHostedRunnerImages,
}));

vi.mock("../src/dev-hosted-local/minio.ts", () => ({
  cleanupHostedLocalMinioBuildContainersBestEffort,
  cleanupHostedLocalMinioE2eContainersBestEffort,
}));

import { runHostedLocalE2eSuite } from "../src/e2e.ts";

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
    expect(vitestCalls).toHaveLength(12);
    expect(vitestCalls[0]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-device-connect-e2e.test.ts",
      ]),
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
        MURPH_DEV_CF_PERSIST_DIR: expect.stringContaining(".tmp/hosted-local-e2e/"),
        MURPH_DEV_WEB_PORT: expect.stringMatching(/^[3-9][0-9]{4}$/u),
        MURPH_DEV_WORKER_PORT: expect.stringMatching(/^[4-9][0-9]{4}$/u),
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
        MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
          expect.stringMatching(/^hosted-local-e2e-/u),
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: expect.stringMatching(/^e2e-hosted-local-e2e-/u),
        TEMPORAL_DEV_HEADLESS: "1",
      }),
      label: "Hosted local full-stack e2e suite 1/12",
    }));
    expect(vitestCalls[0]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts",
    );
    expect(vitestCalls[0]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    );
    expect(vitestCalls[1]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 2/12 idle-checkpoint-deferred-progress",
    }));
    expect(vitestCalls[1]?.args).not.toContain("--bail");
    expect(vitestCalls[1]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[1]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[1]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[2]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-mailbox-platform-env-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
      ]),
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
      }),
      label: "Hosted local full-stack e2e suite 3/12",
    }));
    expect(vitestCalls[2]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    );
    expect(vitestCalls[3]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 4/12 linq-first-contact-test-controls",
    }));
    expect(vitestCalls[3]?.args).not.toContain("--bail");
    expect(vitestCalls[3]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[3]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[3]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[4]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-onboarding-followup-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 5/12 linq-onboarding-followup",
    }));
    expect(vitestCalls[4]?.args).not.toContain("--bail");
    expect(vitestCalls[4]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    );
    expect(vitestCalls[4]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[4]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[4]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[5]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-openai-egress-authority-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 6/12 openai-egress-authority",
    }));
    expect(vitestCalls[5]?.args).not.toContain("--bail");
    expect(vitestCalls[5]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[5]?.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS)
      .toBeUndefined();
    expect(vitestCalls[5]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[5]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[6]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-provider-egress-token-bridge-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 7/12 provider-egress-token-bridge",
    }));
    expect(vitestCalls[6]?.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS)
      .toBeUndefined();
    expect(vitestCalls[7]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-warm-reuse-egress-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 8/12 warm-reuse-egress",
    }));
    expect(vitestCalls[7]?.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS)
      .toBeUndefined();
    expect(vitestCalls[8]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 9/12 linq-scheduled-reminder",
    }));
    expect(vitestCalls[8]?.args).not.toContain("--bail");
    expect(vitestCalls[8]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
    );
    expect(vitestCalls[8]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[8]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[8]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[9]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-telegram-scheduled-reminder-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 10/12 telegram-scheduled-reminder",
    }));
    expect(vitestCalls[9]?.args).not.toContain("--bail");
    expect(vitestCalls[9]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
    );
    expect(vitestCalls[9]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[9]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[9]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[10]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-webhook-audio-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 11/12 linq-webhook-audio",
    }));
    expect(vitestCalls[10]?.args).not.toContain("--bail");
    expect(vitestCalls[10]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[10]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[10]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[11]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts",
      ]),
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
      }),
      label: "Hosted local full-stack e2e suite 12/12",
    }));
    expect(cleanupHostedRunnerContainers).toHaveBeenCalledTimes(14);
    expect(cleanupHostedRunnerContainers).toHaveBeenCalledWith(expect.objectContaining({
      ignoreErrors: false,
      scope: "current-build",
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
      label: "Hosted local full-stack e2e scenario 1/1 checkpoint-baseline",
    }));
  });

  test("preserves caller-provided E2E isolation overrides", async () => {
    await runHostedLocalE2eSuite({
      env: {
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/custom-wrangler",
        MURPH_DEV_WEB_PORT: "35123",
        MURPH_DEV_WORKER_PORT: "45123",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "fixed-build",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "custom-dist",
        TEMPORAL_DEV_HEADLESS: "0",
      },
      prepareRunnerBundle: false,
      scenario: "checkpoint-baseline",
    });

    const vitestCall = runForegroundCommand.mock.calls
      .map(([call]) => call)
      .find((call) => call.args.includes("vitest"));
    expect(vitestCall?.env).toEqual(expect.objectContaining({
      MURPH_DEV_CF_PERSIST_DIR: ".tmp/custom-wrangler",
      MURPH_DEV_WEB_PORT: "35123",
      MURPH_DEV_WORKER_PORT: "45123",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "fixed-build",
      NEXT_DIST_DIR_MODE: "smoke",
      NEXT_DIST_DIR_SUFFIX: "custom-dist",
      TEMPORAL_DEV_HEADLESS: "0",
    }));
  });
});
