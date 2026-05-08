import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

interface SpawnOptionsForTest {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: "inherit";
}

type SpawnForTest = (
  command: string,
  args: string[],
  options: SpawnOptionsForTest,
) => EventEmitter;

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

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock("../../../scripts/dev-hosted-local/runtime.ts", () => ({
  cleanupHostedRunnerContainers: cleanupHostedRunnerContainersMock,
}));

describe("run-hosted-local-e2e", () => {
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

    spawnMock.mockReset();
    spawnSyncMock.mockClear();
    cleanupHostedRunnerContainersMock.mockReset();
    vi.resetModules();
    vi.restoreAllMocks();

    await Promise.all(
      [...artifactDirs].map((artifactDir) =>
        rm(artifactDir, { force: true, recursive: true }),
      ),
    );
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
      .mockImplementationOnce(() => createExitingChild(1));

    await expect(import("../scripts/run-hosted-local-e2e.ts"))
      .rejects
      .toThrow("Hosted local full-stack e2e suite exited with code 1.");

    expectVitestSpawnCall();
    expectSingleCleanupCall();
  });
});

function createExitingChild(exitCode: number): EventEmitter {
  const child = new EventEmitter();
  queueMicrotask(() => {
    child.emit("exit", exitCode, null);
  });

  return child;
}

function expectVitestSpawnCall(): void {
  expect(spawnMock).toHaveBeenCalledTimes(2);
  const [baseCommand, baseArgs, baseOptions] = spawnMock.mock.calls[0] ?? [];
  expect(baseCommand).toBe("pnpm");
  expect(baseArgs).toEqual(["--dir", "apps/cloudflare", "runner:docker:base"]);
  expect(baseOptions?.stdio).toBe("inherit");

  const [command, args, options] = spawnMock.mock.calls[1] ?? [];
  expect(command).toBe("pnpm");
  expect(args).toEqual([
    "exec",
    "vitest",
    "run",
    "--config",
    "apps/cloudflare/vitest.e2e.config.ts",
    "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-device-connect-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-mailbox-platform-env-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
    "apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts",
    "--no-coverage",
  ]);
  expect(typeof options?.cwd).toBe("string");
  expect(options?.env === process.env).toBe(false);
  expect(options?.env.MURPH_HOSTED_LOCAL_PROFILE).toBe("e2e:stub");
  expect(options?.env.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS).toBe("120000");
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
  expect(options?.stdio).toBe("inherit");
}

function expectSingleCleanupCall(): void {
  expect(cleanupHostedRunnerContainersMock).toHaveBeenCalledTimes(1);
  const [cleanupInput] = cleanupHostedRunnerContainersMock.mock.calls[0] ?? [];
  const [, , spawnOptions] = spawnMock.mock.calls[1] ?? [];
  expect(typeof cleanupInput?.cwd).toBe("string");
  expect(cleanupInput?.env).toBe(spawnOptions?.env);
  expect(cleanupInput?.ignoreErrors).toBe(true);
}
