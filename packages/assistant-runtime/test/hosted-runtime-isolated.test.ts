import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { afterEach, describe as baseDescribe, expect, it, vi } from "vitest";

const describe = baseDescribe.sequential;

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  mkdtemp: vi.fn(async () => "/tmp/hosted-runner-launch-test"),
  rm: vi.fn(async () => undefined),
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  mkdtemp: mocks.mkdtemp,
  rm: mocks.rm,
}));

describe("runHostedAssistantRuntimeJobIsolated", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("launches the isolated child from a temp cwd with a scrubbed env and per-run writable roots", async () => {
    const runtimeModule = await import("../src/hosted-runtime.ts");
    const environmentModule = await import("../src/hosted-runtime/environment.ts");
    let stdinPayload = "";
    const previousControlToken = process.env.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN;
    const previousHttpsProxy = process.env.HTTPS_PROXY;
    const previousNoProxy = process.env.NO_PROXY;
    const previousPath = process.env.PATH;
    const previousSecret = process.env.SECRET_PARENT_ONLY;

    process.env.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN = "runner-token";
    process.env.HTTPS_PROXY = "http://user:pass@proxy.internal:8080";
    process.env.NO_PROXY = "localhost,127.0.0.1";
    process.env.PATH = "/usr/local/bin:/usr/bin";
    process.env.SECRET_PARENT_ONLY = "should-not-leak";

    try {
      mocks.spawn.mockImplementation((_command, _args, _options) => {
        const child = createMockChildProcess({
          onStdinEnd: (payload) => {
            stdinPayload = payload;
            child.stdout.emit("data", runtimeModule.formatHostedRuntimeChildResult({
              ok: true,
              result: {
                bundle: null,
                result: {
                  eventsHandled: 1,
                  nextWakeAt: null,
                  summary: "ok",
                },
              },
            }));
            child.emit("close", 0);
          },
        });
        return child;
      });

      const input = createHostedRuntimeJobInput();
      const result = await runtimeModule.runHostedAssistantRuntimeJobIsolated(input);

      const [, childArgs, childOptions] = mocks.spawn.mock.calls[0] ?? [];
      expect(childArgs).toEqual([
        "--import",
        environmentModule.resolveHostedRuntimeTsxImportSpecifier(),
        environmentModule.resolveHostedRuntimeChildEntry(),
      ]);
      expect(childOptions.cwd).toBe("/tmp/hosted-runner-launch-test");
      expect(childOptions.cwd).not.toBe(process.cwd());
      expect(childOptions.detached).toBe(process.platform !== "win32");
      expect(childOptions.env.CUSTOM_ENV).toBe("value");
      expect(childOptions.env.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN).toBeUndefined();
      expect(childOptions.env.HTTPS_PROXY).toBeUndefined();
      expect(childOptions.env.NO_PROXY).toBeUndefined();
      expect(childOptions.env.SECRET_PARENT_ONLY).toBeUndefined();
      expect(childOptions.env.PATH).toBe("/usr/local/bin:/usr/bin");
      expect(childOptions.env.HOME).toBe("/tmp/hosted-runner-launch-test/home");
      expect(childOptions.env.XDG_CACHE_HOME).toBe("/tmp/hosted-runner-launch-test/cache");
      expect(childOptions.env.HF_HOME).toBe("/tmp/hosted-runner-launch-test/hf-home");
      expect(childOptions.env.TMPDIR).toBe("/tmp/hosted-runner-launch-test/tmp");
      expect(childOptions.env.TMP).toBe("/tmp/hosted-runner-launch-test/tmp");
      expect(childOptions.env.TEMP).toBe("/tmp/hosted-runner-launch-test/tmp");
      expect(childOptions.env.TSX_TSCONFIG_PATH).toBe(
        environmentModule.resolveHostedRuntimeTsconfigPath(),
      );
      expect(mocks.rm).toHaveBeenCalledWith("/tmp/hosted-runner-launch-test", {
        force: true,
        recursive: true,
      });

      const parsedPayload = JSON.parse(stdinPayload) as {
        request: ReturnType<typeof createHostedRuntimeJobInput>["request"];
        runtime: {
          internalWorkerProxyToken: string | null;
        };
      };
      expect(parsedPayload.request).toEqual(input.request);
      expect(parsedPayload.runtime.internalWorkerProxyToken).toBe("runner-proxy-token");
      expect(result.result.summary).toBe("ok");
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN", previousControlToken);
      restoreEnvVar("HTTPS_PROXY", previousHttpsProxy);
      restoreEnvVar("NO_PROXY", previousNoProxy);
      restoreEnvVar("PATH", previousPath);
      restoreEnvVar("SECRET_PARENT_ONLY", previousSecret);
    }
  });

  it("removes the temp launcher directory when the child output is invalid", async () => {
    const runtimeModule = await import("../src/hosted-runtime.ts");

    mocks.spawn.mockImplementation(() => {
      const child = createMockChildProcess({
        onStdinEnd: () => {
          child.stdout.emit("data", "not-a-valid-result");
          child.stderr.emit("data", "stderr-output");
          child.emit("close", 1);
        },
      });
      return child;
    });

    await assert.rejects(
      () => runtimeModule.runHostedAssistantRuntimeJobIsolated(createHostedRuntimeJobInput()),
      /did not emit a result payload/u,
    );
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/hosted-runner-launch-test", {
      force: true,
      recursive: true,
    });
  });

  it("removes the temp launcher directory when launcher-directory setup fails", async () => {
    const runtimeModule = await import("../src/hosted-runtime.ts");

    mocks.mkdir.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      runtimeModule.runHostedAssistantRuntimeJobIsolated(createHostedRuntimeJobInput()),
    ).rejects.toThrow("disk full");
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/hosted-runner-launch-test", {
      force: true,
      recursive: true,
    });
  });

  it("kills the isolated child process group when the job is aborted", async () => {
    const runtimeModule = await import("../src/hosted-runtime.ts");
    const abortController = new AbortController();
    const processKill = vi.spyOn(process, "kill").mockImplementation(() => true);

    mocks.spawn.mockImplementation(() => createMockChildProcess({
      onStdinEnd: () => {},
      pid: 43210,
    }));

    const promise = runtimeModule.runHostedAssistantRuntimeJobIsolated(
      createHostedRuntimeJobInput(),
      {
        signal: abortController.signal,
      },
    );
    await vi.waitFor(() => {
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
    });
    abortController.abort(new Error("timed out"));

    await expect(promise).rejects.toThrow("timed out");
    if (process.platform === "win32") {
      expect(processKill).not.toHaveBeenCalled();
    } else {
      expect(processKill).toHaveBeenCalledWith(-43210, "SIGKILL");
    }
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/hosted-runner-launch-test", {
      force: true,
      recursive: true,
    });
  });

  it("cleans up without spawning when the signal is already aborted", async () => {
    const runtimeModule = await import("../src/hosted-runtime.ts");
    const abortController = new AbortController();
    abortController.abort(new Error("already cancelled"));

    await expect(
      runtimeModule.runHostedAssistantRuntimeJobIsolated(
        createHostedRuntimeJobInput(),
        {
          signal: abortController.signal,
        },
      ),
    ).rejects.toThrow("already cancelled");
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/hosted-runner-launch-test", {
      force: true,
      recursive: true,
    });
  });
});

function createMockChildProcess(input: {
  onStdinEnd: (payload: string) => void;
  pid?: number;
}) {
  const child = new EventEmitter() as EventEmitter & {
    kill: (signal?: NodeJS.Signals | number) => boolean;
    pid?: number;
    stderr: EventEmitter & { setEncoding: (encoding: string) => void };
    stdin: EventEmitter & { end: (payload: string) => void };
    stdout: EventEmitter & { setEncoding: (encoding: string) => void };
  };
  child.pid = input.pid;
  child.kill = () => true;
  child.stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  child.stderr.setEncoding = () => {};
  child.stdin = new EventEmitter() as EventEmitter & { end: (payload: string) => void };
  child.stdin.end = (payload: string) => {
    input.onStdinEnd(payload);
  };
  return child;
}

function createHostedRuntimeJobInput() {
  return {
    request: {
      bundle: null,
      dispatch: {
        event: {
          kind: "member.activated" as const,
          userId: "member_123",
        },
        eventId: "evt_123",
        occurredAt: "2026-03-28T09:00:00.000Z",
      },
    },
    runtime: {
      forwardedEnv: {
        CUSTOM_ENV: "value",
      },
      internalWorkerProxyToken: "runner-proxy-token",
    },
  };
}

function restoreEnvVar(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
