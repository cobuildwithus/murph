import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SpawnOptionsForTest {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: "inherit";
}

type SpawnForTest = (
  command: string,
  args: string[],
  options: SpawnOptionsForTest,
) => SpawnedChildForTest;

type SpawnedChildForTest = EventEmitter & {
  kill?: (signal?: NodeJS.Signals) => boolean;
};

interface CleanupInputForTest {
  cwd: string;
  env: NodeJS.ProcessEnv;
  ignoreErrors: boolean;
}

const spawnMock = vi.hoisted(() => vi.fn<SpawnForTest>());
const spawnSyncMock = vi.hoisted(() =>
  vi.fn(() => ({
    status: 0,
    stderr: "",
    stdout: "",
  })),
);
const cleanupHostedRunnerContainersMock = vi.hoisted(() =>
  vi.fn<(input: CleanupInputForTest) => Promise<void>>(async () => {}),
);
const cleanupHostedRunnerImagesMock = vi.hoisted(() =>
  vi.fn<(input: CleanupInputForTest) => Promise<void>>(async () => {}),
);
const cleanupHostedLocalOrphanedWorkerdProcessesMock = vi.hoisted(() =>
  vi.fn<() => void>(),
);
const cleanupHostedLocalMinioBuildContainersBestEffortMock = vi.hoisted(() =>
  vi.fn<(env: NodeJS.ProcessEnv, buildId: string) => Promise<void>>(async () => {}),
);
const cleanupHostedLocalMinioE2eContainersBestEffortMock = vi.hoisted(() =>
  vi.fn<(env: NodeJS.ProcessEnv) => Promise<void>>(async () => {}),
);
const expectedScenarioFiles = [
  "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-codex-image-media-delivery-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-device-connect-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-direct-r2-presigned-put-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-mailbox-platform-env-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-temporal-orchestration-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts",
] as const;
const expectedScheduledReminderScenarioFile =
  "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts";
const expectedScenarioFilesBeforeScheduled = expectedScenarioFiles.slice(
  0,
  expectedScenarioFiles.indexOf(expectedScheduledReminderScenarioFile),
);
const expectedScenarioFilesAfterScheduled = expectedScenarioFiles.slice(
  expectedScenarioFiles.indexOf(expectedScheduledReminderScenarioFile) + 1,
);
const controlledEnvKeys = [
  "MURPH_HEALTH_COMMONS_GENERATED_PREPARED",
  "MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID",
  "MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE",
  "MURPH_DEV_LINQ_WEBHOOK_TUNNEL",
  "MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER",
  "MURPH_DEV_TEMPORAL",
  "MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED",
  "MURPH_HOSTED_LOCAL_RUN_ID",
  "MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID",
] as const;
const originalEnv = new Map<string, string | undefined>();
let originalExitCode: typeof process.exitCode;

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock("@murphai/hosted-local-harness/dev-hosted-local/runtime", () => ({
  cleanupHostedLocalOrphanedWorkerdProcesses:
    cleanupHostedLocalOrphanedWorkerdProcessesMock,
  cleanupHostedRunnerContainers: cleanupHostedRunnerContainersMock,
  cleanupHostedRunnerImages: cleanupHostedRunnerImagesMock,
}));

vi.mock("@murphai/hosted-local-harness/dev-hosted-local/minio", () => ({
  cleanupHostedLocalMinioBuildContainersBestEffort:
    cleanupHostedLocalMinioBuildContainersBestEffortMock,
  cleanupHostedLocalMinioE2eContainersBestEffort:
    cleanupHostedLocalMinioE2eContainersBestEffortMock,
}));

describe("run-hosted-local-e2e", () => {
  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    originalEnv.clear();
    for (const key of controlledEnvKeys) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(async () => {
    const artifactDirs = new Set<string>();
    for (const [, , options] of spawnMock.mock.calls) {
      const artifactDir = options.env.MURPH_HOSTED_LOCAL_ARTIFACT_DIR;
      if (artifactDir) {
        artifactDirs.add(artifactDir);
      }
    }
    for (const [cleanupInput] of cleanupHostedRunnerContainersMock.mock.calls) {
      const artifactDir = cleanupInput.env.MURPH_HOSTED_LOCAL_ARTIFACT_DIR;
      if (artifactDir) {
        artifactDirs.add(artifactDir);
      }
    }
    for (const [cleanupInput] of cleanupHostedRunnerImagesMock.mock.calls) {
      const artifactDir = cleanupInput.env.MURPH_HOSTED_LOCAL_ARTIFACT_DIR;
      if (artifactDir) {
        artifactDirs.add(artifactDir);
      }
    }

    spawnMock.mockReset();
    spawnSyncMock.mockClear();
    cleanupHostedLocalOrphanedWorkerdProcessesMock.mockClear();
    cleanupHostedLocalMinioBuildContainersBestEffortMock.mockReset();
    cleanupHostedLocalMinioE2eContainersBestEffortMock.mockReset();
    cleanupHostedRunnerContainersMock.mockReset();
    cleanupHostedRunnerImagesMock.mockReset();
    vi.resetModules();
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;

    await Promise.all(
      [...artifactDirs].map((artifactDir) =>
        rm(artifactDir, { force: true, recursive: true }),
      ),
    );
    restoreControlledEnv();
  });

  it("runs the full-stack hosted-local scenarios and cleans up runner state", async () => {
    spawnMock.mockImplementation(() => createExitingChild(0));

    await import("../scripts/run-hosted-local-e2e.ts");

    expectAggregateVitestSpawnCalls(3);
    expectCleanupCalls(5);
  });

  it("cleans up when the hosted-local vitest process fails", async () => {
    spawnMock
      .mockImplementationOnce(() => createExitingChild(0))
      .mockImplementationOnce(() => createExitingChild(0))
      .mockImplementationOnce(() => createExitingChild(0))
      .mockImplementationOnce(() => createExitingChild(1));

    await expect(import("../scripts/run-hosted-local-e2e.ts"))
      .rejects
      .toThrow("Hosted local full-stack e2e suite 1/3 exited with code 1.");

    expectAggregateVitestSpawnCalls(1);
    expectCleanupCalls(3);
  });

  it("cleans up and preserves interrupt exit code when SIGINT stops hosted-local vitest", async () => {
    const signalHandlers = new Map<NodeJS.Signals, Array<() => void>>();
    const originalOnceMethod = process.once.bind(process);
    const originalOffMethod = process.off.bind(process);
    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      if (event === "SIGINT" || event === "SIGTERM") {
        signalHandlers.set(event, [
          ...(signalHandlers.get(event) ?? []),
          listener as () => void,
        ]);
        return process;
      }
      return originalOnceMethod(event, listener);
    });
    vi.spyOn(process, "off").mockImplementation((event, listener) => {
      if (event === "SIGINT" || event === "SIGTERM") {
        signalHandlers.set(
          event,
          (signalHandlers.get(event) ?? []).filter((handler) => handler !== listener),
        );
        return process;
      }
      return originalOffMethod(event, listener);
    });

    const interruptedChild = createSignalControlledChild();
    spawnMock
      .mockImplementationOnce(() => createExitingChild(0))
      .mockImplementationOnce(() => createExitingChild(0))
      .mockImplementationOnce(() => createExitingChild(0))
      .mockImplementationOnce(() => interruptedChild);

    const runPromise = import("../scripts/run-hosted-local-e2e.ts");
    await waitForSpawnCalls(4);
    for (const handler of signalHandlers.get("SIGINT") ?? []) {
      handler();
    }

    await expect(runPromise).resolves.toBeDefined();
    expect(interruptedChild.kill).toHaveBeenCalledWith("SIGINT");
    expect(process.exitCode).toBe(130);
    expectAggregateVitestSpawnCalls(1);
    expectCleanupCalls(3);
  });
});

function createExitingChild(exitCode: number): SpawnedChildForTest {
  const child = new EventEmitter();
  queueMicrotask(() => {
    child.emit("exit", exitCode, null);
  });

  return child;
}

function createSignalControlledChild(): SpawnedChildForTest & {
  kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals) => boolean>>;
} {
  const child = new EventEmitter() as SpawnedChildForTest & {
    kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals) => boolean>>;
  };
  child.kill = vi.fn((signal?: NodeJS.Signals) => {
    queueMicrotask(() => {
      child.emit("exit", null, signal ?? "SIGTERM");
    });
    return true;
  });
  return child;
}

async function waitForSpawnCalls(count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (spawnMock.mock.calls.length >= count) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  expect(spawnMock).toHaveBeenCalledTimes(count);
}

function expectAggregateVitestSpawnCalls(expectedVitestCalls: 1 | 3): void {
  expect(spawnMock).toHaveBeenCalledTimes(3 + expectedVitestCalls);
  const [baseCommand, baseArgs, baseOptions] = spawnMock.mock.calls[0] ?? [];
  expect(baseCommand).toBe("pnpm");
  expect(baseArgs).toEqual(["--dir", "apps/cloudflare", "runner:docker:base"]);
  expect(baseOptions?.stdio).toBe("inherit");

  const [prismaCommand, prismaArgs, prismaOptions] = spawnMock.mock.calls[1] ?? [];
  expect(prismaCommand).toBe("pnpm");
  expect(prismaArgs).toEqual(["--dir", "apps/web", "prisma:generate"]);
  expect(prismaOptions?.stdio).toBe("inherit");

  const [healthCommonsCommand, healthCommonsArgs, healthCommonsOptions] =
    spawnMock.mock.calls[2] ?? [];
  expect(healthCommonsCommand).toBe("pnpm");
  expect(healthCommonsArgs).toEqual(["health-commons:generate"]);
  expect(healthCommonsOptions?.stdio).toBe("inherit");

  const [firstCommand, firstArgs] = spawnMock.mock.calls[3] ?? [];
  expect(firstCommand).toBe("pnpm");
  expect(firstArgs).toEqual([
    "exec",
    "vitest",
    "run",
    "--config",
    "apps/cloudflare/vitest.e2e.config.ts",
    ...expectedScenarioFilesBeforeScheduled,
    "--bail",
    "1",
    "--no-coverage",
  ]);

  const [, , options] = spawnMock.mock.calls[3] ?? [];
  expect(typeof options?.cwd).toBe("string");
  expect(options?.env === process.env).toBe(false);
  expect(options?.env.MURPH_HOSTED_LOCAL_PROFILE).toBe("e2e:stub");
  expect(options?.env.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED).toBe("1");
  expect(options?.env.MURPH_HOSTED_LOCAL_RUN_ID).toEqual(expect.any(String));
  expect(options?.env.MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID).toBe(
    options?.env.MURPH_HOSTED_LOCAL_RUN_ID,
  );
  expect(options?.env.MURPH_HOSTED_LOCAL_STATE_PATH).toEqual(expect.any(String));
  expect(options?.env.MURPH_DEV_LINQ_WEBHOOK_TUNNEL).toBe("0");
  expect(options?.env.MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER).toBe("1");
  expect(options?.env.MURPH_DEV_SKIP_RUNNER_BUNDLE).toBe("1");
  expect(options?.env.MURPH_DEV_SKIP_RUNNER_DOCKER_BASE).toBe("1");
  expect(options?.env.MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED).toBe("1");
  expect(options?.env.MURPH_HEALTH_COMMONS_GENERATED_PREPARED).toBe("1");
  expect(options?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE).toBe("1");
  expect(options?.env.MURPH_DEV_TEMPORAL).toBe("managed");
  expect(options?.stdio).toBe("inherit");

  if (expectedVitestCalls === 1) {
    return;
  }

  const [scheduledCommand, scheduledArgs, scheduledOptions] = spawnMock.mock.calls[4] ?? [];
  expect(scheduledCommand).toBe("pnpm");
  expect(scheduledArgs).toEqual([
    "exec",
    "vitest",
    "run",
    "--config",
    "apps/cloudflare/vitest.e2e.config.ts",
    expectedScheduledReminderScenarioFile,
    "--no-coverage",
  ]);
  expect(scheduledOptions?.env).not.toBe(options?.env);
  expect(scheduledOptions?.env).toEqual(expect.objectContaining({
    MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "0",
    MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
    MURPH_DEV_SKIP_RUNNER_BUNDLE: "1",
    MURPH_DEV_SKIP_RUNNER_DOCKER_BASE: "1",
    MURPH_DEV_TEMPORAL: "managed",
    MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
    MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
    MURPH_HOSTED_LOCAL_RUN_ID: options?.env.MURPH_HOSTED_LOCAL_RUN_ID,
    MURPH_HOSTED_LOCAL_STATE_PATH: options?.env.MURPH_HOSTED_LOCAL_STATE_PATH,
    MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
      options?.env.MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID,
    MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
  }));
  expect(scheduledOptions?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
    .toBeUndefined();
  expect(scheduledOptions?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
    .toBeUndefined();
  expect(scheduledOptions?.stdio).toBe("inherit");

  const [finalCommand, finalArgs, finalOptions] = spawnMock.mock.calls[5] ?? [];
  expect(finalCommand).toBe("pnpm");
  expect(finalArgs).toEqual([
    "exec",
    "vitest",
    "run",
    "--config",
    "apps/cloudflare/vitest.e2e.config.ts",
    ...expectedScenarioFilesAfterScheduled,
    "--bail",
    "1",
    "--no-coverage",
  ]);
  expect(finalOptions?.env).toMatchObject(options?.env ?? {});
  expect(finalOptions?.stdio).toBe("inherit");
}

function restoreControlledEnv(): void {
  for (const key of controlledEnvKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  originalEnv.clear();
}

function expectCleanupCalls(expectedRunnerCleanupCalls: number): void {
  expect(cleanupHostedLocalOrphanedWorkerdProcessesMock)
    .toHaveBeenCalledTimes(expectedRunnerCleanupCalls);
  expect(cleanupHostedRunnerContainersMock).toHaveBeenCalledTimes(
    expectedRunnerCleanupCalls,
  );
  expect(cleanupHostedRunnerImagesMock).toHaveBeenCalledTimes(1);
  expect(cleanupHostedLocalMinioBuildContainersBestEffortMock).toHaveBeenCalledTimes(
    expectedRunnerCleanupCalls,
  );
  expect(cleanupHostedLocalMinioE2eContainersBestEffortMock).toHaveBeenCalledTimes(
    expectedRunnerCleanupCalls,
  );
  const [cleanupInput] = cleanupHostedRunnerContainersMock.mock.calls.at(-1) ?? [];
  const [imageCleanupInput] = cleanupHostedRunnerImagesMock.mock.calls[0] ?? [];
  const [minioBuildCleanupEnv, minioBuildCleanupId] =
    cleanupHostedLocalMinioBuildContainersBestEffortMock.mock.calls.at(-1) ?? [];
  const [minioE2eCleanupEnv] =
    cleanupHostedLocalMinioE2eContainersBestEffortMock.mock.calls.at(-1) ?? [];
  const [, , spawnOptions] = spawnMock.mock.calls[3] ?? [];
  expect(typeof cleanupInput?.cwd).toBe("string");
  expect(cleanupInput?.env).toBe(spawnOptions?.env);
  expect(cleanupInput?.ignoreErrors).toBe(true);
  expect(imageCleanupInput?.cwd).toBe(cleanupInput?.cwd);
  expect(imageCleanupInput?.env).toBe(spawnOptions?.env);
  expect(imageCleanupInput?.ignoreErrors).toBe(true);
  expect(minioBuildCleanupEnv).toBe(spawnOptions?.env);
  expect(minioBuildCleanupId).toBe(spawnOptions?.env.MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID);
  expect(minioE2eCleanupEnv).toBe(spawnOptions?.env);
}
