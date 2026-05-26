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
  ignoreErrors: true;
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
const controlledEnvKeys = [
  "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS",
  "MURPH_DEV_LINQ_WEBHOOK_TUNNEL",
  "MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER",
  "MURPH_DEV_TEMPORAL",
  "MURPH_HOSTED_LOCAL_RUN_ID",
  "MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID",
] as const;
const originalEnv = new Map<string, string | undefined>();
let originalExitCode: typeof process.exitCode;

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock("../../../scripts/dev-hosted-local/runtime.ts", () => ({
  cleanupHostedRunnerContainers: cleanupHostedRunnerContainersMock,
  cleanupHostedRunnerImages: cleanupHostedRunnerImagesMock,
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

  it("runs the full-stack hosted-local files in one vitest process and cleans up once", async () => {
    spawnMock.mockImplementation(() => createExitingChild(0));

    await import("../scripts/run-hosted-local-e2e.ts");

    expectVitestSpawnCall();
    expectSingleCleanupCall();
  });

  it("cleans up when the hosted-local vitest process fails", async () => {
    spawnMock
      .mockImplementationOnce(() => createExitingChild(0))
      .mockImplementationOnce(() => createExitingChild(0))
      .mockImplementationOnce(() => createExitingChild(0))
      .mockImplementationOnce(() => createExitingChild(1));

    await expect(import("../scripts/run-hosted-local-e2e.ts"))
      .rejects
      .toThrow("Hosted local full-stack e2e suite exited with code 1.");

    expectVitestSpawnCall();
    expectSingleCleanupCall();
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
    expectVitestSpawnCall();
    expectSingleCleanupCall();
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

function expectVitestSpawnCall(): void {
  expect(spawnMock).toHaveBeenCalledTimes(4);
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

  const [command, args, options] = spawnMock.mock.calls[3] ?? [];
  expect(command).toBe("pnpm");
  expect(args).toEqual([
    "exec",
    "vitest",
    "run",
    "--config",
    "apps/cloudflare/vitest.e2e.config.ts",
    "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-device-connect-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-direct-r2-presigned-put-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-mailbox-platform-env-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-temporal-orchestration-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts",
    "--no-coverage",
  ]);
  expect(typeof options?.cwd).toBe("string");
  expect(options?.env === process.env).toBe(false);
  expect(options?.env.MURPH_HOSTED_LOCAL_PROFILE).toBe("e2e:stub");
  expect(options?.env.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS).toBe(expectedRunnerTimeoutMs());
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
  expect(options?.env.MURPH_DEV_TEMPORAL).toBe("managed");
  expect(options?.stdio).toBe("inherit");
}

function expectedRunnerTimeoutMs(): string {
  return process.env.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS?.trim() || "600000";
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

function expectSingleCleanupCall(): void {
  expect(cleanupHostedRunnerContainersMock).toHaveBeenCalledTimes(1);
  expect(cleanupHostedRunnerImagesMock).toHaveBeenCalledTimes(1);
  const [cleanupInput] = cleanupHostedRunnerContainersMock.mock.calls[0] ?? [];
  const [imageCleanupInput] = cleanupHostedRunnerImagesMock.mock.calls[0] ?? [];
  const [, , spawnOptions] = spawnMock.mock.calls[3] ?? [];
  expect(typeof cleanupInput?.cwd).toBe("string");
  expect(cleanupInput?.env).toBe(spawnOptions?.env);
  expect(cleanupInput?.ignoreErrors).toBe(true);
  expect(imageCleanupInput?.cwd).toBe(cleanupInput?.cwd);
  expect(imageCleanupInput?.env).toBe(spawnOptions?.env);
  expect(imageCleanupInput?.ignoreErrors).toBe(true);
}
