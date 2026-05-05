import { EventEmitter } from "node:events";
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
      "name=workerd-murph-hosted-RunnerContainer-",
      "--filter",
      expect.stringMatching(
        /^label=murph\.hosted\.local-build-id=sha256-[a-f0-9]{24}$/u,
      ),
    ]);
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
