import { afterEach, describe, expect, test, vi } from "vitest";

const runForegroundCommand = vi.hoisted(() => vi.fn(async () => {}));
const cleanupHostedRunnerContainers = vi.hoisted(() => vi.fn(async () => {}));
const cleanupHostedRunnerImages = vi.hoisted(() => vi.fn(async () => {}));

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
  cleanupHostedRunnerContainers,
  cleanupHostedRunnerImages,
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
    expect(runForegroundCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
      ]),
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
        MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      }),
      label: "Hosted local full-stack e2e suite",
    }));
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
