import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ForegroundCommandSignalError,
  type ForegroundCommandInput,
} from "../src/process.ts";

const runForegroundCommand = vi.hoisted(() =>
  vi.fn(async (_input: ForegroundCommandInput) => {})
);
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
  cleanupHostedRunnerContainers,
  cleanupHostedRunnerImages,
}));

vi.mock("../src/dev-hosted-local/minio.ts", () => ({
  cleanupHostedLocalMinioBuildContainersBestEffort,
  cleanupHostedLocalMinioE2eContainersBestEffort,
}));

import { runHostedLocalE2eSuite } from "../src/e2e.ts";

const interruptionCases: Array<{
  expectedExitCode: number;
  signal: "SIGHUP" | "SIGINT" | "SIGTERM";
}> = [
  { expectedExitCode: 130, signal: "SIGINT" },
  { expectedExitCode: 143, signal: "SIGTERM" },
  ...(process.platform === "win32"
    ? []
    : [{ expectedExitCode: 129, signal: "SIGHUP" as const }]),
];

function captureSuiteSignalHandlers(): {
  handlers: Map<NodeJS.Signals, Array<() => void>>;
  restore: () => void;
} {
  const handlers = new Map<NodeJS.Signals, Array<() => void>>();
  const originalOnMethod = process.on.bind(process);
  const originalOffMethod = process.off.bind(process);
  const onSpy = vi.spyOn(process, "on").mockImplementation((event, listener) => {
    if (event === "SIGINT" || event === "SIGTERM" || event === "SIGHUP") {
      handlers.set(event, [
        ...(handlers.get(event) ?? []),
        listener as () => void,
      ]);
      return process;
    }
    return originalOnMethod(event, listener);
  });
  const offSpy = vi.spyOn(process, "off").mockImplementation((event, listener) => {
    if (event === "SIGINT" || event === "SIGTERM" || event === "SIGHUP") {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((handler) => handler !== listener),
      );
      return process;
    }
    return originalOffMethod(event, listener);
  });
  return {
    handlers,
    restore: () => {
      onSpy.mockRestore();
      offSpy.mockRestore();
    },
  };
}

function emitCapturedSignal(
  handlers: Map<NodeJS.Signals, Array<() => void>>,
  signal: NodeJS.Signals,
): void {
  for (const handler of handlers.get(signal) ?? []) {
    handler();
  }
}

describe("hosted-local E2E suite preparation", () => {
  afterEach(() => {
    vi.clearAllMocks();
    runForegroundCommand.mockResolvedValue(undefined);
    vi.unstubAllEnvs();
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
    expect(vitestCalls).toHaveLength(19);
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
      label: "Hosted local full-stack e2e suite 1/19",
    }));
    expect(vitestCalls[0]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts",
    );
    expect(vitestCalls[0]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    );
    expect(vitestCalls[1]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-canonical-receipt-lost-ack-recovery-e2e.test.ts",
      ]),
      command: "pnpm",
      label:
        "Hosted local full-stack e2e scenario 2/19 canonical-receipt-lost-ack-recovery",
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
        "apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 3/19 idle-checkpoint-deferred-progress",
    }));
    expect(vitestCalls[2]?.args).not.toContain("--bail");
    expect(vitestCalls[2]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[2]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[2]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[3]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-mailbox-platform-env-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-linq-group-route-drift-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-linq-home-line-reroute-retry-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-family-sponsored-group-roundtrip-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-linq-unknown-first-contact-fallback-e2e.test.ts",
      ]),
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
      }),
      label: "Hosted local full-stack e2e suite 4/19",
    }));
    expect(vitestCalls[3]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    );
    expect(vitestCalls[4]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 5/19 linq-first-contact-test-controls",
    }));
    expect(vitestCalls[4]?.args).not.toContain("--bail");
    expect(vitestCalls[4]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
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
        "apps/cloudflare/test/hosted-local-onboarding-followup-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 6/19 linq-onboarding-followup",
    }));
    expect(vitestCalls[5]?.args).not.toContain("--bail");
    expect(vitestCalls[5]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    );
    expect(vitestCalls[5]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[5]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[5]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[6]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-openai-egress-authority-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 7/19 openai-egress-authority",
    }));
    expect(vitestCalls[6]?.args).not.toContain("--bail");
    expect(vitestCalls[6]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[6]?.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS)
      .toBeUndefined();
    expect(vitestCalls[6]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[6]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[7]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-provider-egress-token-bridge-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 8/19 provider-egress-token-bridge",
    }));
    expect(vitestCalls[7]?.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS)
      .toBeUndefined();
    expect(vitestCalls[8]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-warm-reuse-egress-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 9/19 warm-reuse-egress",
    }));
    expect(vitestCalls[8]?.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS)
      .toBeUndefined();
    expect(vitestCalls[9]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 10/19 linq-scheduled-reminder",
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
        "apps/cloudflare/test/hosted-local-telegram-scheduled-reminder-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 11/19 telegram-scheduled-reminder",
    }));
    expect(vitestCalls[10]?.args).not.toContain("--bail");
    expect(vitestCalls[10]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
    );
    expect(vitestCalls[10]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
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
        "apps/cloudflare/test/hosted-local-linq-webhook-audio-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 12/19 linq-webhook-audio",
    }));
    expect(vitestCalls[11]?.args).not.toContain("--bail");
    expect(vitestCalls[11]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[11]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[11]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[12]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-linq-same-wake-batching-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts",
      ]),
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
      }),
      label: "Hosted local full-stack e2e suite 13/19",
    }));
    expect(vitestCalls[13]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-snapshot-publication-fallback-e2e.test.ts",
      ]),
      command: "pnpm",
      label:
        "Hosted local full-stack e2e scenario 14/19 snapshot-publication-fallback",
    }));
    expect(vitestCalls[13]?.args).not.toContain("--bail");
    expect(vitestCalls[13]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[13]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[13]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[14]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-computer-handoff-linq-roundtrip-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-retell-call-result-roundtrip-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-usage-limit-ambiguous-send-e2e.test.ts",
      ]),
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
      }),
      label: "Hosted local full-stack e2e suite 15/19",
    }));
    for (const [index, name, file] of [
      [15, "codex-image-media-delivery", "hosted-local-codex-image-media-delivery"],
      [16, "retryable-outbox-foreground-restart", "hosted-local-retryable-outbox-foreground-restart"],
      [17, "shutdown-checkpoint-conversation-ahead", "hosted-local-shutdown-checkpoint-conversation-ahead"],
      [18, "vault-file-approval-resume", "hosted-local-vault-file-approval-resume"],
    ] as const) {
      expect(vitestCalls[index]).toEqual(expect.objectContaining({
        args: expect.arrayContaining([
          `apps/cloudflare/test/${file}-e2e.test.ts`,
        ]),
        command: "pnpm",
        label: `Hosted local full-stack e2e scenario ${index + 1}/19 ${name}`,
      }));
      expect(vitestCalls[index]?.args).not.toContain("--bail");
      expect(vitestCalls[index]?.env).toEqual(expect.objectContaining({
        MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
        MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
        MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
          expect.stringMatching(/^hosted-local-e2e-/u),
      }));
      expect(vitestCalls[index]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
        .toBeUndefined();
      expect(vitestCalls[index]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
        .toBeUndefined();
    }
    expect(cleanupHostedRunnerContainers).toHaveBeenCalledTimes(21);
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
  });

  test("scrubs inherited web session authority before E2E preparation", async () => {
    const authority = "web-session-authority";
    vi.stubEnv("HOSTED_APP_SESSION_HMAC_KEY", authority);

    await runHostedLocalE2eSuite({
      env: { HOSTED_APP_SESSION_HMAC_KEY: authority },
      prepareRunnerBundle: false,
      scenario: "checkpoint-baseline",
    });

    expect(process.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    for (const [input] of runForegroundCommand.mock.calls) {
      expect(input.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    }
  });

  test("cleans up runner artifacts when a focused scenario fails", async () => {
    runForegroundCommand.mockImplementation(async (input) => {
      if (input.args.includes("vitest")) {
        throw new Error("synthetic hosted-local scenario failure");
      }
    });

    await expect(runHostedLocalE2eSuite({
      env: {},
      prepareRunnerBundle: false,
      scenario: "checkpoint-baseline",
    })).rejects.toThrow("synthetic hosted-local scenario failure");

    expect(cleanupHostedRunnerContainers).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ignoreErrors: true,
        scope: "current-build",
        timeoutMs: 60_000,
      }),
    );
    expect(cleanupHostedRunnerImages).toHaveBeenCalledTimes(1);
    expect(cleanupHostedLocalMinioE2eContainersBestEffort).toHaveBeenCalled();
  });

  test("runs an explicit scenario group in one prepared suite", async () => {
    await runHostedLocalE2eSuite({
      env: {},
      prepareRunnerBundle: false,
      scenario: ["linq-delivery", "temporal-orchestration"],
    });

    const vitestCalls = runForegroundCommand.mock.calls
      .map(([call]) => call)
      .filter((call) => call.args.includes("vitest"));
    expect(vitestCalls).toHaveLength(1);
    expect(vitestCalls[0]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-temporal-orchestration-e2e.test.ts",
        "--bail",
        "1",
      ]),
      env: expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
      }),
      label: "Hosted local full-stack e2e suite 1/1",
    }));
    expect(cleanupHostedRunnerImages).toHaveBeenCalledTimes(1);
  });

  test.each(interruptionCases)(
    "preserves $signal exit semantics while cleaning up runner artifacts",
    async ({ expectedExitCode, signal }) => {
      const signalCapture = captureSuiteSignalHandlers();
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;

      try {
        runForegroundCommand.mockImplementation(async (input) => {
          if (!input.args.includes("vitest")) {
            return;
          }
          expect(input.forwardProcessSignals).toBeUndefined();
          emitCapturedSignal(signalCapture.handlers, signal);
          emitCapturedSignal(signalCapture.handlers, signal);
          throw new ForegroundCommandSignalError(input.label, signal);
        });

        await expect(runHostedLocalE2eSuite({
          env: {},
          prepareRunnerBundle: false,
          scenario: "checkpoint-baseline",
        })).resolves.toEqual({ terminationSignal: signal });

        expect(process.exitCode).toBe(expectedExitCode);
        expect(cleanupHostedRunnerContainers).toHaveBeenLastCalledWith(
          expect.objectContaining({
            ignoreErrors: true,
            scope: "current-build",
            timeoutMs: 60_000,
          }),
        );
        expect(cleanupHostedRunnerImages).toHaveBeenCalledTimes(1);
        expect(signalCapture.handlers.get(signal)).toEqual([]);
      } finally {
        process.exitCode = originalExitCode;
        signalCapture.restore();
      }
    },
  );

  test.each(interruptionCases)(
    "closes work admission when $signal arrives during pre-scenario cleanup",
    async ({ expectedExitCode, signal }) => {
      const signalCapture = captureSuiteSignalHandlers();
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;
      cleanupHostedRunnerContainers.mockImplementationOnce(async () => {
        emitCapturedSignal(signalCapture.handlers, signal);
        emitCapturedSignal(signalCapture.handlers, signal);
      });

      try {
        await expect(runHostedLocalE2eSuite({
          env: {},
          prepareRunnerBundle: false,
          scenario: "checkpoint-baseline",
        })).resolves.toEqual({ terminationSignal: signal });

        const vitestCalls = runForegroundCommand.mock.calls
          .map(([call]) => call)
          .filter((call) => call.args.includes("vitest"));
        expect(vitestCalls).toHaveLength(0);
        expect(process.exitCode).toBe(expectedExitCode);
        expect(signalCapture.handlers.get(signal)).toEqual([]);
      } finally {
        process.exitCode = originalExitCode;
        signalCapture.restore();
      }
    },
  );

  test.runIf(process.platform !== "win32")(
    "closes batch admission when SIGHUP arrives during between-batch cleanup",
    async () => {
      const signalCapture = captureSuiteSignalHandlers();
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;
      cleanupHostedRunnerContainers
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(async () => {
          emitCapturedSignal(signalCapture.handlers, "SIGHUP");
          emitCapturedSignal(signalCapture.handlers, "SIGHUP");
        });

      try {
        await expect(runHostedLocalE2eSuite({
          env: {},
          prepareRunnerBundle: false,
          scenario: "all",
        })).resolves.toEqual({ terminationSignal: "SIGHUP" });

        const vitestCalls = runForegroundCommand.mock.calls
          .map(([call]) => call)
          .filter((call) => call.args.includes("vitest"));
        expect(vitestCalls).toHaveLength(1);
        expect(process.exitCode).toBe(129);
        expect(signalCapture.handlers.get("SIGHUP")).toEqual([]);
      } finally {
        process.exitCode = originalExitCode;
        signalCapture.restore();
      }
    },
  );

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
      env: expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
      }),
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
