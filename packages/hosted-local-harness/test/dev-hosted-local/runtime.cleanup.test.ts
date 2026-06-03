import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";
import { hostedLocalHarnessRepoRoot as repoRoot } from "../../src/repo.ts";

interface SpawnResult {
  exitCode: number | null;
  stderr?: string;
  stdout?: string;
}

interface SpawnSyncResult {
  status: number | null;
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

async function importRuntimeWithSpawnSequence(
  sequence: SpawnResult[],
  options: {
    spawnSyncResult?: SpawnSyncResult;
  } = {},
) {
  const spawn = vi.fn<SpawnForTest>(() => {
    const next = sequence.shift();
    if (!next) {
      throw new Error("Missing mocked spawn result.");
    }

    return createSpawnResultChild(next);
  });
  const spawnSync = vi.fn(() => ({
    status: options.spawnSyncResult?.status ?? 0,
    stderr: options.spawnSyncResult?.stderr ?? "",
    stdout: options.spawnSyncResult?.stdout ?? "",
  }));

  vi.doMock("node:child_process", async () => {
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");

    return {
      ...actual,
      spawn,
      spawnSync,
    };
  });

  const runtime = await import("../../src/dev-hosted-local/runtime.ts");

  return {
    cleanupHostedLocalOrphanedWorkerdProcesses:
      runtime.cleanupHostedLocalOrphanedWorkerdProcesses,
    cleanupHostedRunnerContainerLocalState: runtime.cleanupHostedRunnerContainerLocalState,
    cleanupHostedRunnerContainers: runtime.cleanupHostedRunnerContainers,
    cleanupHostedRunnerImages: runtime.cleanupHostedRunnerImages,
    spawn,
    spawnSync,
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
      { exitCode: 0, stdout: "abc123 workerd-murph-hosted-RunnerContainer-old\n" },
      { exitCode: 0, stdout: "" },
      {
        exitCode: 1,
        stderr:
          "Error response from daemon: removal of container abc123 is already in progress",
      },
      { exitCode: 0, stdout: "" },
    ]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      scope: "all-builds",
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn).toHaveBeenCalledTimes(4);
  });

  it("does not sweep current-build runner containers without a build id", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn).not.toHaveBeenCalled();
  });

  it("scopes current-build cleanup to the build-id label", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      {
        exitCode: 0,
        stdout: "runner456 workerd-murph-hosted-RunnerContainer-deadbeef\n",
      },
      { exitCode: 0, stdout: "proxy456\n" },
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
      "-a",
      "--format",
      "{{.ID}} {{.Names}}",
      "--filter",
      expect.stringMatching(
        /^label=murph\.hosted\.local-build-id=sha256-[a-f0-9]{24}$/u,
      ),
    ]);
    expect(spawn.mock.calls[1]?.[1]).toEqual([
      "ps",
      "-aq",
      "--filter",
      "name=workerd-murph-hosted-RunnerContainer-deadbeef-proxy",
    ]);
    expect(spawn.mock.calls[2]?.[1]).toEqual([
      "rm",
      "-f",
      "runner456",
      "proxy456",
    ]);
  });

  it("can sweep stale local runner containers from previous build ids", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      { exitCode: 0, stdout: "abc123 workerd-murph-hosted-RunnerContainer-old\n" },
      { exitCode: 0, stdout: "proxy123\n" },
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

    expect(spawn).toHaveBeenCalledTimes(3);
    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "ps",
      "-a",
      "--format",
      "{{.ID}} {{.Names}}",
      "--filter",
      "name=workerd-murph-hosted-",
      "--filter",
      "label=murph.hosted.local-build-id",
    ]);
    expect(spawn.mock.calls[1]?.[1]).toEqual([
      "ps",
      "-aq",
      "--filter",
      "name=workerd-murph-hosted-RunnerContainer-old-proxy",
    ]);
    expect(spawn.mock.calls[2]?.[1]).toEqual(["rm", "-f", "abc123", "proxy123"]);
  });

  it("keeps all-builds scope while checking whether failed removals disappeared", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      { exitCode: 0, stdout: "abc123 workerd-murph-hosted-RunnerContainer-old\n" },
      { exitCode: 0, stdout: "" },
      {
        exitCode: 1,
        stderr: "Error response from daemon: removal failed",
      },
      { exitCode: 0, stdout: "abc123 workerd-murph-hosted-RunnerContainer-old\n" },
      { exitCode: 0, stdout: "" },
    ]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      env: {
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "fresh-build",
      },
      scope: "all-builds",
      timeoutMs: 1,
    })).rejects.toThrow("Failed to remove stale local Cloudflare runner containers.");

    expect(spawn.mock.calls[3]?.[1]).toEqual([
      "ps",
      "-a",
      "--format",
      "{{.ID}} {{.Names}}",
      "--filter",
      "name=workerd-murph-hosted-",
      "--filter",
      "label=murph.hosted.local-build-id",
    ]);
  });

  it("uses the isolated E2E worker container namespace", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      { exitCode: 0, stdout: "" },
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
      "-a",
      "--format",
      "{{.ID}} {{.Names}}",
      "--filter",
      expect.stringMatching(
        /^label=murph\.hosted\.local-build-id=sha256-[a-f0-9]{24}$/u,
      ),
    ]);
    expect(spawn.mock.calls[1]?.[1]).toEqual([
      "ps",
      "-a",
      "--format",
      "{{.ID}} {{.Names}}",
      "--filter",
      expect.stringMatching(/^name=workerd-murph-hosted-e2e-[a-f0-9]{24}-$/u),
    ]);
  });

  it("sweeps current-build E2E proxy containers after the labeled runner container is gone", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      { exitCode: 0, stdout: "" },
      {
        exitCode: 0,
        stdout: [
          "proxy123 workerd-murph-hosted-e2e-9d19e47df7b08810c933dd26-RunnerContainer-alpha-proxy",
          "noise456 workerd-murph-hosted-e2e-deadbeefdeadbeefdeadbeef-RunnerContainer-alpha-proxy",
        ].join("\n"),
      },
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

    expect(spawn.mock.calls[1]?.[1]).toEqual([
      "ps",
      "-a",
      "--format",
      "{{.ID}} {{.Names}}",
      "--filter",
      "name=workerd-murph-hosted-e2e-9d19e47df7b08810c933dd26-",
    ]);
    expect(spawn.mock.calls[2]?.[1]).toEqual([
      "rm",
      "-f",
      "proxy123",
    ]);
  });

  it("can sweep stale E2E runner containers without matching the default dev namespace", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      {
        exitCode: 0,
        stdout: [
          "runner123 workerd-murph-hosted-e2e-deadbeefdeadbeefdeadbeef-RunnerContainer-alpha",
          "smoke456 workerd-murph-hosted-e2e-deadbeefdeadbeefdeadbeef-DeploySmokeRunnerContainer-beta",
        ].join("\n"),
      },
      {
        exitCode: 0,
        stdout:
          "proxy789 workerd-murph-hosted-e2e-deadbeefdeadbeefdeadbeef-RunnerContainer-alpha-proxy\n",
      },
      { exitCode: 0, stdout: "proxy789\n" },
      { exitCode: 0, stdout: "" },
      { exitCode: 0, stdout: "" },
    ]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      scope: "e2e-builds",
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "ps",
      "-a",
      "--format",
      "{{.ID}} {{.Names}}",
      "--filter",
      "name=workerd-murph-hosted-e2e-",
      "--filter",
      "label=murph.hosted.local-build-id",
    ]);
    expect(spawn.mock.calls[1]?.[1]).toEqual([
      "ps",
      "-a",
      "--format",
      "{{.ID}} {{.Names}}",
      "--filter",
      "name=workerd-murph-hosted-e2e-",
    ]);
    expect(spawn.mock.calls[2]?.[1]).toEqual([
      "ps",
      "-aq",
      "--filter",
      "name=workerd-murph-hosted-e2e-deadbeefdeadbeefdeadbeef-RunnerContainer-alpha-proxy",
    ]);
    expect(spawn.mock.calls[3]?.[1]).toEqual([
      "ps",
      "-aq",
      "--filter",
      "name=workerd-murph-hosted-e2e-deadbeefdeadbeefdeadbeef-DeploySmokeRunnerContainer-beta-proxy",
    ]);
    expect(spawn.mock.calls[4]?.[1]).toEqual([
      "rm",
      "-f",
      "runner123",
      "smoke456",
      "proxy789",
    ]);
  });

  it("sweeps orphan E2E proxy containers after the labeled runner container is gone", async () => {
    const { cleanupHostedRunnerContainers, spawn } = await importRuntimeWithSpawnSequence([
      { exitCode: 0, stdout: "" },
      {
        exitCode: 0,
        stdout: [
          "proxy123 workerd-murph-hosted-e2e-deadbeefdeadbeefdeadbeef-RunnerContainer-alpha-proxy",
          "noise456 workerd-murph-hosted-e2e-deadbeefdeadbeefdeadbeef-OtherContainer-alpha-proxy",
        ].join("\n"),
      },
      { exitCode: 0, stdout: "" },
    ]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      scope: "e2e-builds",
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "ps",
      "-a",
      "--format",
      "{{.ID}} {{.Names}}",
      "--filter",
      "name=workerd-murph-hosted-e2e-",
      "--filter",
      "label=murph.hosted.local-build-id",
    ]);
    expect(spawn.mock.calls[1]?.[1]).toEqual([
      "ps",
      "-a",
      "--format",
      "{{.ID}} {{.Names}}",
      "--filter",
      "name=workerd-murph-hosted-e2e-",
    ]);
    expect(spawn.mock.calls[2]?.[1]).toEqual([
      "rm",
      "-f",
      "proxy123",
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
      const { buildHostedRunnerLocalBuildId } = await import("../../src/dev-hosted-local/environment.ts");
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
      { exitCode: 0, stdout: "abc123 workerd-murph-hosted-RunnerContainer-deadbeef\n" },
      { exitCode: 0, stdout: "def456\n" },
      { exitCode: 1, stderr: "Error response from daemon: permission denied" },
      { exitCode: 0, stdout: "abc123 workerd-murph-hosted-RunnerContainer-deadbeef\n" },
      { exitCode: 0, stdout: "def456\n" },
    ]);

    await expect(cleanupHostedRunnerContainers({
      cwd: "/tmp",
      env: {
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "e2e-suite-build",
      },
      timeoutMs: 50,
    })).rejects.toThrow("Failed to remove stale local Cloudflare runner containers.");
  });
});

describe("cleanupHostedLocalOrphanedWorkerdProcesses", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("node:child_process");
  });

  it("kills only orphaned repo-local loopback workerd serve processes", async () => {
    const workerdPath = path.join(
      repoRoot,
      "node_modules",
      ".pnpm",
      "@cloudflare+workerd-test",
      "node_modules",
      "workerd",
      "bin",
      "workerd",
    );
    const stdout = [
      [
        "111",
        "1",
        workerdPath,
        "serve",
        "--socket-addr=entry=127.0.0.1:0",
        "--external-addr=loopback=127.0.0.1:55555",
      ].join(" "),
      [
        "222",
        "99",
        workerdPath,
        "serve",
        "--socket-addr=entry=127.0.0.1:0",
        "--external-addr=loopback=127.0.0.1:55556",
      ].join(" "),
      [
        "333",
        "1",
        "/tmp/other/node_modules/.pnpm/@cloudflare+workerd-test/bin/workerd",
        "serve",
        "--socket-addr=entry=127.0.0.1:0",
        "--external-addr=loopback=127.0.0.1:55557",
      ].join(" "),
      [
        "444",
        "1",
        workerdPath,
        "serve",
        "--socket-addr=entry=127.0.0.1:0",
      ].join(" "),
    ].join("\n");
    const { cleanupHostedLocalOrphanedWorkerdProcesses, spawnSync } =
      await importRuntimeWithSpawnSequence([], {
        spawnSyncResult: { status: 0, stdout },
      });
    const kill = vi.spyOn(process, "kill").mockImplementation(
      (() => true) as typeof process.kill,
    );

    cleanupHostedLocalOrphanedWorkerdProcesses({ signal: "SIGKILL" });

    expect(spawnSync).toHaveBeenCalledWith("ps", ["-axo", "pid=,ppid=,command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(111, "SIGKILL");
  });
});

describe("cleanupHostedRunnerImages", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("node:child_process");
  });

  it("removes repo-owned runner images for the current hosted-local build id", async () => {
    const { cleanupHostedRunnerImages, spawn } = await importRuntimeWithSpawnSequence([
      {
        exitCode: 0,
        stdout: [
          "cloudflare-dev/runnercontainer:abc123",
          "cloudflare-dev/deploysmokerunnercontainer:abc123",
          "murph-cloudflare-runner:latest",
          "postgres:15",
          "cloudflare-dev/runnercontainer:<none>",
        ].join("\n"),
      },
      { exitCode: 0, stdout: "" },
    ]);

    await expect(cleanupHostedRunnerImages({
      cwd: "/tmp",
      env: {
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "dev-build",
      },
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "images",
      "--format",
      "{{.Repository}}:{{.Tag}}",
      "--filter",
      expect.stringMatching(
        /^label=murph\.hosted\.local-build-id=sha256-[a-f0-9]{24}$/u,
      ),
    ]);
    expect(spawn.mock.calls[1]?.[1]).toEqual([
      "image",
      "rm",
      "-f",
      "murph-cloudflare-runner:latest",
    ]);
  });

  it("does not remove Cloudflare-managed runner images", async () => {
    const { cleanupHostedRunnerImages, spawn } = await importRuntimeWithSpawnSequence([
      {
        exitCode: 0,
        stdout: [
          "cloudflare-dev/runnercontainer:abc123",
          "cloudflare-dev/deploysmokerunnercontainer:def456",
        ].join("\n"),
      },
    ]);

    await expect(cleanupHostedRunnerImages({
      cwd: "/tmp",
      env: {
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "dev-build",
      },
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("does not remove all runner images when current-build cleanup has no build id", async () => {
    const { cleanupHostedRunnerImages, spawn } = await importRuntimeWithSpawnSequence([]);

    await expect(cleanupHostedRunnerImages({
      cwd: "/tmp",
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not sweep runner images for E2E namespace cleanup", async () => {
    const { cleanupHostedRunnerImages, spawn } = await importRuntimeWithSpawnSequence([]);

    await expect(cleanupHostedRunnerImages({
      cwd: "/tmp",
      scope: "e2e-builds",
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn).not.toHaveBeenCalled();
  });

  it("can sweep generated runner images across all local builds", async () => {
    const { cleanupHostedRunnerImages, spawn } = await importRuntimeWithSpawnSequence([
      {
        exitCode: 0,
        stdout: "cloudflare-dev/runnercontainer:old\nmurph-cloudflare-runner:latest\n",
      },
      { exitCode: 0, stdout: "" },
    ]);

    await expect(cleanupHostedRunnerImages({
      cwd: "/tmp",
      scope: "all-builds",
      timeoutMs: 200,
    })).resolves.toBeUndefined();

    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "images",
      "--format",
      "{{.Repository}}:{{.Tag}}",
      "--filter",
      "label=murph.hosted.local-build-id",
    ]);
    expect(spawn.mock.calls[1]?.[1]).toEqual([
      "image",
      "rm",
      "-f",
      "murph-cloudflare-runner:latest",
    ]);
  });
});
