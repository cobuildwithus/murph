import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

interface SpawnResult {
  exitCode: number | null;
  stderr?: string;
  stdout?: string;
}

type SpawnForTest = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: unknown;
  },
) => ReturnType<typeof createSpawnResultChild>;

function createSpawnResultChild(result: SpawnResult) {
  const child = new EventEmitter() as EventEmitter & {
    kill: (signal?: NodeJS.Signals | number) => boolean;
    pid: number;
    stderr: PassThrough;
    stdout: PassThrough;
  };
  child.kill = () => true;
  child.pid = 4321;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  queueMicrotask(() => {
    if (result.stdout) {
      child.stdout.write(result.stdout);
    }
    if (result.stderr) {
      child.stderr.write(result.stderr);
    }
    child.stdout.end();
    child.stderr.end();
    child.emit("exit", result.exitCode);
  });

  return child;
}

async function importRuntimeWithSpawnSequence(sequence: SpawnResult[]) {
  const spawn = vi.fn<SpawnForTest>(() => {
    const next = sequence.shift();
    if (!next) {
      throw new Error("Missing mocked spawn result.");
    }

    return createSpawnResultChild(next);
  });

  vi.doMock("node:child_process", async () => {
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");

    return {
      ...actual,
      spawn,
    };
  });

  const runtime = await import("./runtime.ts");

  return {
    cleanupHostedRunnerContainerLocalState: runtime.cleanupHostedRunnerContainerLocalState,
    cleanupHostedRunnerContainers: runtime.cleanupHostedRunnerContainers,
    spawn,
  };
}

describe("cleanupHostedRunnerContainers", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("node:child_process");
  });

  it("treats a transient docker rm race as success once the containers disappear", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      { exitCode: 0, stdout: "abc123\ndef456\n" },
      {
        exitCode: 1,
        stderr:
          "Error response from daemon: removal of container abc123 is already in progress",
      },
      { exitCode: 0, stdout: "" },
    ]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it("scopes cleanup to the local runner build id label when one is configured", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      { exitCode: 0, stdout: "" },
    ]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      env: {
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "e2e-suite-build",
      },
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    const args = spawn.mock.calls[0]?.[1] as string[] | undefined;
    expect(args).toEqual([
      "ps",
      "-aq",
      "--filter",
      "name=workerd-murph-hosted-",
      "--filter",
      expect.stringMatching(
        /^label=murph\.hosted\.local-build-id=sha256-[a-f0-9]{24}$/u,
      ),
    ]);
  });

  it("can sweep stale local runner containers from previous build ids", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      { exitCode: 0, stdout: "abc123\n" },
      { exitCode: 0, stdout: "" },
    ]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      env: {
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "fresh-build",
      },
      scope: "all-builds",
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "ps",
      "-aq",
      "--filter",
      "name=workerd-murph-hosted-",
    ]);
    expect(spawn.mock.calls[1]?.[1]).toEqual(["rm", "-f", "abc123"]);
  });

  it("keeps all-builds scope while checking whether failed removals disappeared", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      { exitCode: 0, stdout: "abc123\n" },
      {
        exitCode: 1,
        stderr: "Error response from daemon: removal failed",
      },
      { exitCode: 0, stdout: "abc123\n" },
    ]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      env: {
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "fresh-build",
      },
      scope: "all-builds",
      timeoutMs: 1,
    })).rejects.toThrow("Failed to remove stale local Cloudflare runner containers.");

    expect(spawn.mock.calls[2]?.[1]).toEqual([
      "ps",
      "-aq",
      "--filter",
      "name=workerd-murph-hosted-",
    ]);
  });

  it("uses the isolated E2E worker container namespace", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      { exitCode: 0, stdout: "" },
    ]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      env: {
        MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "e2e-suite-build",
      },
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "ps",
      "-aq",
      "--filter",
      expect.stringMatching(/^name=workerd-murph-hosted-e2e-[a-f0-9]{24}-$/u),
      "--filter",
      expect.stringMatching(
        /^label=murph\.hosted\.local-build-id=sha256-[a-f0-9]{24}$/u,
      ),
    ]);
  });

  it("removes persisted local hosted runner durable object state for the worker namespace", async () => {
    const { cleanupHostedRunnerContainerLocalState } = await importRuntimeWithSpawnSequence([]);
    const root = await mkdtemp(path.join(os.tmpdir(), "murph-runner-state-test-"));
    const persistDir = path.join(root, "state");
    const runnerStateDir = path.join(persistDir, "v3", "do", "murph-hosted-RunnerContainer");
    const smokeStateDir = path.join(persistDir, "v3", "do", "murph-hosted-DeploySmokeRunnerContainer");
    const userRunnerStateDir = path.join(persistDir, "v3", "do", "murph-hosted-UserRunnerDurableObject");
    const unrelatedStateDir = path.join(persistDir, "v3", "do", "murph-hosted-OtherDurableObject");

    try {
      await mkdir(runnerStateDir, { recursive: true });
      await mkdir(smokeStateDir, { recursive: true });
      await mkdir(userRunnerStateDir, { recursive: true });
      await mkdir(unrelatedStateDir, { recursive: true });

      await cleanupHostedRunnerContainerLocalState({
        persistDir,
      });

      await expect(access(runnerStateDir)).rejects.toThrow();
      await expect(access(smokeStateDir)).rejects.toThrow();
      await expect(access(userRunnerStateDir)).rejects.toThrow();
      await expect(access(unrelatedStateDir)).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uses the isolated E2E worker name when clearing local hosted runner durable object state", async () => {
    const { cleanupHostedRunnerContainerLocalState } = await importRuntimeWithSpawnSequence([]);
    const root = await mkdtemp(path.join(os.tmpdir(), "murph-runner-state-test-"));
    const persistDir = path.join(root, "state");
    const localBuildId = "e2e-suite-build";

    try {
      const { buildHostedRunnerLocalBuildId } = await import("./environment.ts");
      const suffix = buildHostedRunnerLocalBuildId(localBuildId).replace(/^sha256-/u, "");
      const e2eRunnerStateDir = path.join(
        persistDir,
        "v3",
        "do",
        `murph-hosted-e2e-${suffix}-RunnerContainer`,
      );
      const e2eUserRunnerStateDir = path.join(
        persistDir,
        "v3",
        "do",
        `murph-hosted-e2e-${suffix}-UserRunnerDurableObject`,
      );
      const defaultRunnerStateDir = path.join(
        persistDir,
        "v3",
        "do",
        "murph-hosted-RunnerContainer",
      );
      const defaultUserRunnerStateDir = path.join(
        persistDir,
        "v3",
        "do",
        "murph-hosted-UserRunnerDurableObject",
      );
      await mkdir(e2eRunnerStateDir, { recursive: true });
      await mkdir(e2eUserRunnerStateDir, { recursive: true });
      await mkdir(defaultRunnerStateDir, { recursive: true });
      await mkdir(defaultUserRunnerStateDir, { recursive: true });

      await cleanupHostedRunnerContainerLocalState({
        env: {
          MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
          MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: localBuildId,
        },
        persistDir,
      });

      await expect(access(e2eRunnerStateDir)).rejects.toThrow();
      await expect(access(e2eUserRunnerStateDir)).rejects.toThrow();
      await expect(access(defaultRunnerStateDir)).resolves.toBeUndefined();
      await expect(access(defaultUserRunnerStateDir)).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("still fails when docker rm leaves matching runner containers behind", async () => {
    const { cleanupHostedRunnerContainers } = await importRuntimeWithSpawnSequence([
      { exitCode: 0, stdout: "abc123\ndef456\n" },
      { exitCode: 1, stderr: "Error response from daemon: permission denied" },
      { exitCode: 0, stdout: "abc123\ndef456\n" },
    ]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      timeoutMs: 50,
    })).rejects.toThrow("Failed to remove stale local Cloudflare runner containers.");
  });
});
