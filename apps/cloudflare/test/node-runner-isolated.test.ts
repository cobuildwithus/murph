import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedExecutionRunnerChildRuntimeWakeReadyMessage,
  createHostedExecutionRunnerChildResultMessage,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "../src/runner-job-transport.ts";

const spawnMock = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

describe("runHostedWorkspaceInvocationIsolatedDetailed", () => {
  afterEach(async () => {
    const module = await import("../src/node-runner-isolated.ts");
    await module.clearHostedRunnerWarmLauncherRootsForTests();
    spawnMock.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function createWorkspaceJob(eventId: string): HostedExecutionWorkspaceInvocationJobInput {
    return {
      kind: "workspace-invocation",
      request: {
        attemptId: `attempt_${eventId}`,
        leaseGeneration: "1",
        reason: "nudge",
        userId: "member_123",
        workspaceVersion: "0",
      },
      runtime: {
        forwardedEnv: {},
        userEnv: {},
      },
    };
  }

  it("kills the child process group after a successful run so descendants cannot survive warm reuse", async () => {
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
        pid: number;
        stderr: PassThrough;
        stdin: PassThrough;
        stdout: PassThrough;
      };
      child.kill = vi.fn();
      child.pid = 4242;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      queueMicrotask(() => {
        emitChildResult(child, module, {
          ok: true,
          result: createRunnerResult(),
        });
        child.stdout.end();
        child.emit("close", 0);
      });

      return child;
    });

    const result = await module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_child_cleanup"),
    });

    expect(result.status).toBe("idle");
    expect(processKillSpy).toHaveBeenCalledWith(-4242, "SIGKILL");
  });

  it("treats the IPC result as completion when a successful child leaves handles open", async () => {
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const module = await import("../src/node-runner-isolated.ts");
    let spawnedChild: MockChildProcess | null = null;

    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess(4243);
      spawnedChild = child;

      queueMicrotask(() => {
        emitChildResult(child, module, {
          ok: true,
          result: createRunnerResult(),
        });
        child.stdout.end();
      });

      return child;
    });

    const result = await module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_child_result_before_close"),
    });

    expect(result.status).toBe("idle");
    expect(spawnedChild).not.toBeNull();
    expect(processKillSpy).toHaveBeenCalledWith(-4243, "SIGKILL");
  });

  it("reuses the same redacted warm launcher root for successful invocations by the same user", async () => {
    const module = await import("../src/node-runner-isolated.ts");
    const cwdValues: string[] = [];

    spawnMock.mockImplementation((_command, _args, options) => {
      cwdValues.push(String(options?.cwd ?? ""));
      return createSuccessfulChildProcess(module);
    });

    await module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_warm_first"),
    });
    await module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_warm_second"),
    });
    await module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: {
        ...createWorkspaceJob("evt_warm_other_user"),
        request: {
          ...createWorkspaceJob("evt_warm_other_user").request,
          userId: "member_456",
        },
      },
    });

    expect(cwdValues).toHaveLength(3);
    expect(cwdValues[0]).toContain("hosted-runner-workspaces");
    expect(cwdValues[1]).toBe(cwdValues[0]);
    expect(cwdValues[2]).not.toBe(cwdValues[0]);
    expect(cwdValues[0]).not.toContain("member_123");
    expect(cwdValues[2]).not.toContain("member_456");
  });

  it("keeps the same warm launcher root after a failed child", async () => {
    const module = await import("../src/node-runner-isolated.ts");
    const cwdValues: string[] = [];

    spawnMock
      .mockImplementationOnce((_command, _args, options) => {
        cwdValues.push(String(options?.cwd ?? ""));
        return createFailedChildProcess(module);
      })
      .mockImplementationOnce((_command, _args, options) => {
        cwdValues.push(String(options?.cwd ?? ""));
        return createSuccessfulChildProcess(module);
      });

    await expect(module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_warm_failure"),
    })).rejects.toThrow("simulated child failure");

    await module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_warm_after_failure"),
    });

    expect(cwdValues).toHaveLength(2);
    expect(cwdValues[1]).toBe(cwdValues[0]);
  });

  it("clears stale warm browser-vault source markers before starting a new child", async () => {
    const module = await import("../src/node-runner-isolated.ts");
    const assistantRuntime = await import("@murphai/assistant-runtime");
    const userId = "member_123";
    const vaultRoot = module.resolveHostedRunnerWarmWorkspaceVaultRoot(userId);
    await assistantRuntime.writeHostedBrowserVaultWarmSourceStateHashBestEffort({
      sourceStateHash: "a".repeat(64),
      vaultRoot,
    });

    spawnMock.mockImplementation(() => createSuccessfulChildProcess(module));

    await module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_clear_stale_browser_vault_marker"),
    });

    await expect(assistantRuntime.readHostedBrowserVaultWarmSourceStateHash({
      vaultRoot,
    })).resolves.toBeNull();
  });

  it("fails closed before child launch when stale warm marker cleanup fails", async () => {
    const module = await import("../src/node-runner-isolated.ts");
    const userId = "member_123";
    const vaultRoot = module.resolveHostedRunnerWarmWorkspaceVaultRoot(userId);
    const markerPath = resolveWarmBrowserVaultMarkerPath(vaultRoot);
    await rm(markerPath, {
      force: true,
      recursive: true,
    });
    await mkdir(markerPath, {
      mode: 0o700,
      recursive: true,
    });

    await expect(module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_browser_vault_marker_clear_failed"),
    })).rejects.toThrow();

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("passes only the normalized runtime env into the isolated child env", async () => {
    vi.stubEnv("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK", '{"kty":"EC"}');
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT", "development");
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL", "http://127.0.0.1:4010/.well-known/jwks");
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME", "murph-web");
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG", "murph-team");
    vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK", '{"kty":"EC","d":"secret"}');
    vi.stubEnv("HOSTED_WEB_BASE_URL", "https://ambient.example.test");
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation((_command, _args, options) => {
      expect(options?.env).toMatchObject({
        OPENAI_API_KEY: "vercel-key",
      });
      expect(options?.env?.CODEX_HOME).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_RUNNER_HOST_ALIAS).toBeUndefined();
      expect(options?.env?.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG).toBeUndefined();
      expect(options?.env?.HOSTED_WEB_BASE_URL).toBeUndefined();
      expect(options?.env?.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBeUndefined();

      const child = new EventEmitter() as EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
        pid: number;
        stderr: PassThrough;
        stdin: PassThrough;
        stdout: PassThrough;
      };
      child.kill = vi.fn();
      child.pid = 4245;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      queueMicrotask(() => {
        emitChildResult(child, module, {
          ok: true,
          result: createRunnerResult(),
        });
        child.stdout.end();
        child.emit("close", 0);
      });

      return child;
    });

    await module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: {
        ...createWorkspaceJob("evt_child_env"),
        runtime: {
          forwardedEnv: {
            CODEX_HOME: "/tmp/forwarded-codex-home",
            HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
            HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "127.0.0.1",
            HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
            HOSTED_WEB_BASE_URL: "https://forwarded.example.test",
            HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: '{"kty":"EC","d":"secret"}',
            OPENAI_API_KEY: "vercel-key",
          },
          userEnv: {},
        },
      },
    });
  });

  it("rejects legacy child results at the isolated runner boundary", async () => {
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const stdoutWriteSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
        pid: number;
        stderr: PassThrough;
        stdin: PassThrough;
        stdout: PassThrough;
      };
      child.kill = vi.fn();
      child.pid = 4246;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      queueMicrotask(() => {
        child.stdout.end(formatLegacyChildResult({
          result: {
            bundle: null,
            result: {
              eventsHandled: 1,
              nextWakeAt: null,
              summary: "ok",
            },
          },
          finalGatewayProjectionSnapshot: null,
        }));
        child.emit("close", 0);
      });

      return child;
    });

    await expect(module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_child_legacy_result"),
    })).rejects.toThrow("without emitting a result payload");

    expect(processKillSpy).toHaveBeenCalledWith(-4246, "SIGKILL");
    expect(stdoutWriteSpy).toHaveBeenCalled();
  });

  it("includes redacted child close diagnostics when no IPC result is emitted", async () => {
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const module = await import("../src/node-runner-isolated.ts");
    const controller = new AbortController();

    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess(4247);

      queueMicrotask(() => {
        child.stdout.write("Bearer stdout-token\n");
        child.stdout.write("Hosted node runner child prepared workspace invocation.\n");
        child.stdout.write(`${JSON.stringify(createRuntimePhaseLog({
          elapsedMs: 3,
          ordinal: 1,
          phase: "workspace.read",
          status: "start",
        }))}\n`);
        child.stdout.write(`${JSON.stringify(createRuntimePhaseLog({
          elapsedMs: 999_999,
          ordinal: 999_999,
          phase: "workspace.restore",
          status: "start",
        }))}\n`);
        child.stderr.write("OPENAI_API_KEY=secret-value /tmp/hosted-runner/private-file\n");
        child.stderr.write("Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@murphai/missing'\n");
        child.stderr.write(`${JSON.stringify(createWorkspaceSnapshotProcessFailureLog())}\n`);
        child.stderr.write(`${JSON.stringify(createRuntimePhaseLog({
          durationMs: 7,
          elapsedMs: 10,
          ordinal: 2,
          phase: "runtime",
          status: "fail",
        }))}\n`);
        controller.abort(new Error("Hosted runner response closed before completion at /tmp/hosted-runner/private-file."));
        child.stdout.end();
        child.stderr.end();
        child.emit("close", null, "SIGKILL");
      });

      return child;
    });

    let thrown: Error | null = null;
    try {
      await module.runHostedWorkspaceInvocationIsolatedDetailed({
        job: createWorkspaceJob("evt_child_missing_result_diagnostics"),
      }, {
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error) {
        thrown = error;
      }
    }

    if (!thrown) {
      throw new Error("Expected isolated child missing-result failure to throw.");
    }

    expect(thrown.message).toContain("code unknown");
    expect(thrown.message).toContain("signal SIGKILL");
    expect(thrown.message).toContain("after parent abort");

    const childProcess = readChildProcessDiagnostics(thrown);
    expect(childProcess).toMatchObject({
      abortedByParent: true,
      abortReasonName: "Error",
      exitCode: null,
      firstCompletionKind: "close",
      runtimeLastPhase: "runtime",
      runtimeLastPhaseOrdinal: 3,
      runtimeLastPhaseStatus: "fail",
      runtimePhaseTrace: [
        "workspace.read:start",
        "workspace.restore:start",
        "runtime:fail",
      ],
      childRuntimeWorkspaceSnapshotProcessExitCode: 1,
      childRuntimeWorkspaceSnapshotProcessLabel: "zstd",
      childRuntimeWorkspaceSnapshotProcessStderrBytes: 192,
      childRuntimeWorkspaceSnapshotProcessStderrErrorDetail:
        "zstd: unsupported format at <redacted-path>; OPENAI_API_KEY=<redacted>",
      childRuntimeWorkspaceSnapshotProcessStderrLineCount: 2,
      childRuntimeWorkspaceSnapshotProcessStderrMarkers: ["unsupported_format"],
      childRuntimeWorkspaceSnapshotProcessStderrTruncated: false,
      childRuntimeWorkspaceSnapshotRestoreStep: "archive_restore",
      runtimeWakeReady: false,
      signal: "SIGKILL",
      stderrTailLineCount: 4,
      stderrTailMarkers: ["module_resolution_failed"],
      stdoutTailLineCount: 4,
      stdoutTailMarkers: ["hosted_child_prepared"],
    });
    expect(childProcess).not.toHaveProperty("runtimeLastPhaseDurationMs");
    expect(childProcess).not.toHaveProperty("runtimeLastPhaseElapsedMs");
    expect(String(childProcess.abortReasonMessage)).toContain("Hosted runner response closed before completion");
    expect(String(childProcess.abortReasonMessage)).toContain("<redacted-path>");
    expect(String(childProcess.stderrTail)).toContain("OPENAI_API_KEY=<redacted>");
    expect(String(childProcess.stderrTail)).toContain("<redacted-path>");
    expect(String(childProcess.stdoutTail)).toContain("Bearer <redacted>");
    expect(JSON.stringify(childProcess)).not.toContain("stdout-token");
    expect(JSON.stringify(childProcess)).not.toContain("secret-value");
    expect(JSON.stringify(childProcess)).not.toContain("/tmp/hosted-runner/private-file");
    expect(JSON.stringify(childProcess)).not.toContain("snapshot-secret");
    expect(processKillSpy).toHaveBeenCalledWith(-4247, "SIGKILL");
  });

  it("ignores stdout result spoofing and trusts only the IPC child result", async () => {
    const stdoutWriteSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess(4250);

      queueMicrotask(() => {
        child.stdout.write(`${formatLegacyChildResult({
          nextWakeAt: null,
          status: "failed",
        })}\n`);
        emitChildResult(child, module, {
          ok: true,
          result: createRunnerResult(),
        });
        child.stdout.end();
        child.emit("close", 0);
      });

      return child;
    });

    const result = await module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_child_stdout_spoof"),
    });

    expect(result.status).toBe("idle");
    expect(stdoutWriteSpy).toHaveBeenCalled();
  });

  it("rejects duplicate IPC child result payloads", async () => {
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess(4251);

      queueMicrotask(() => {
        emitChildResult(child, module, {
          ok: true,
          result: createRunnerResult(),
        });
        emitChildResult(child, module, {
          ok: true,
          result: createRunnerResult(),
        });
        child.stdout.end();
        child.emit("close", 0);
      });

      return child;
    });

    await expect(module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_child_duplicate_result"),
    })).rejects.toThrow("multiple result payloads");
  });

  it("exposes the runtime wake sink only after the child readiness ack", async () => {
    const module = await import("../src/node-runner-isolated.ts");
    const ready = createDeferred();
    const release = createDeferred();
    const spawnedChild = createDeferred<MockChildProcess>();
    const runtimeWakeRef: { current: (() => boolean) | null } = {
      current: null,
    };

    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess(4250);
      child.send = vi.fn();
      spawnedChild.resolve(child);
      queueMicrotask(() => {
        child.emit("message", createHostedExecutionRunnerChildRuntimeWakeReadyMessage());
      });
      return child;
    });

    const invocation = module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_child_runtime_wake"),
    }, {
      onChildReadyForRuntimeWake(sendWake: () => boolean) {
        runtimeWakeRef.current = sendWake;
        ready.resolve();
        expect(sendWake()).toBe(true);
        release.resolve();
      },
    });

    await ready.promise;
    const activeChild = await spawnedChild.promise;
    emitChildResult(activeChild, module, {
      ok: true,
      result: createRunnerResult(),
    });
    activeChild.stdout.end();
    activeChild.emit("close", 0);

    await expect(invocation).resolves.toMatchObject({ status: "idle" });
    expect(activeChild.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "murph.hosted-execution.runner-child-runtime-wake.v1",
      }),
    );
    activeChild.connected = false;
    const runtimeWake = runtimeWakeRef.current;
    if (runtimeWake === null) {
      throw new Error("Expected runtime wake sink.");
    }
    expect(runtimeWake()).toBe(false);
    expect((activeChild.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    await release.promise;
  });

  it("rejects a successful IPC result when the child exits nonzero", async () => {
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess(4252);

      queueMicrotask(() => {
        emitChildResult(child, module, {
          ok: true,
          result: createRunnerResult(),
        });
        child.stdout.end();
        child.emit("close", 1);
      });

      return child;
    });

    await expect(module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_child_success_nonzero"),
    })).rejects.toThrow("after reporting success");
  });

  it("rejects malformed IPC child result payloads", async () => {
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess(4253);

      queueMicrotask(() => {
        child.emit("message", {
          result: {
            ok: true,
            result: {
              status: "not-a-runtime-status",
            },
          },
          type: "murph.hosted-execution.runner-child-result.v1",
        });
        child.stdout.end();
        child.emit("close", 0);
      });

      return child;
    });

    await expect(module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_child_malformed_result"),
    })).rejects.toThrow("Hosted workspace invocation result");
  });

  it("redacts isolated child stderr before forwarding it to runner logs", async () => {
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const stderrWriteSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
        pid: number;
        stderr: PassThrough;
        stdin: PassThrough;
        stdout: PassThrough;
      };
      child.kill = vi.fn();
      child.pid = 4248;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      queueMicrotask(() => {
        child.stderr.write("Bearer secret-token\n");
        child.stderr.write(
          "OPENAI_API_KEY=secret-value person@example.test +15555550123 /tmp/hosted-runner/path",
        );
        child.stderr.end();
        emitChildResult(child, module, {
          ok: true,
          result: createRunnerResult(),
        });
        child.stdout.end();
        child.emit("close", 0);
      });

      return child;
    });

    await module.runHostedWorkspaceInvocationIsolatedDetailed({
      job: createWorkspaceJob("evt_child_stderr_redaction"),
    });

    const forwarded = stderrWriteSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(forwarded).toContain("Bearer <redacted>");
    expect(forwarded).toContain("OPENAI_API_KEY=<redacted>");
    expect(forwarded).toContain("<redacted-email>");
    expect(forwarded).toContain("<redacted-phone>");
    expect(forwarded).toContain("<redacted-path>");
    expect(forwarded).not.toContain("secret-token");
    expect(forwarded).not.toContain("secret-value");
    expect(forwarded).not.toContain("person@example.test");
    expect(forwarded).not.toContain("+15555550123");
    expect(forwarded).not.toContain("/tmp/hosted-runner/path");
    expect(processKillSpy).toHaveBeenCalledWith(-4248, "SIGKILL");
  });

  it("redacts child failure payload diagnostics before rethrowing them", async () => {
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
        pid: number;
        stderr: PassThrough;
        stdin: PassThrough;
        stdout: PassThrough;
      };
      child.kill = vi.fn();
      child.pid = 4249;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      queueMicrotask(() => {
        emitChildResult(child, module, {
          ok: false,
          error: {
            details: {
              errorDetail:
                "Bearer detail-token /tmp/hosted-runner/detail-path",
            },
            message:
              "OPENAI_API_KEY=secret-value model_provider = openai /tmp/hosted-runner/private-file",
            name: "Error",
            stack:
              "Error: failed\n    at run (/tmp/hosted-runner/private-file.ts:7:3)",
          },
        });
        child.stdout.end();
        child.emit("close", 1);
      });

      return child;
    });

    let thrown: (Error & { details?: Record<string, unknown> | null }) | null = null;
    try {
      await module.runHostedWorkspaceInvocationIsolatedDetailed({
        job: createWorkspaceJob("evt_child_failure_redaction"),
      });
      throw new Error("Expected isolated child failure to throw.");
    } catch (error) {
      thrown = error as Error & { details?: Record<string, unknown> | null };
    }

    if (!thrown) {
      throw new Error("Expected isolated child failure to throw.");
    }

    expect(thrown.message).toContain("OPENAI_API_KEY=<redacted>");
    expect(thrown.message).toContain("model_provider=<redacted>");
    expect(thrown.message).toContain("<redacted-path>");
    expect(thrown.stack).toContain("<redacted-path>");
    expect(thrown.details?.errorDetail).toBe(
      "Bearer <redacted> <redacted-path>",
    );
    expect(thrown.message).not.toContain("secret-value");
    expect(thrown.message).not.toContain("openai");
    expect(thrown.message).not.toContain("/tmp/hosted-runner/private-file");
    expect(thrown.stack ?? "").not.toContain("/tmp/hosted-runner/private-file");
    expect(JSON.stringify(thrown.details)).not.toContain("detail-token");
    expect(JSON.stringify(thrown.details)).not.toContain("/tmp/hosted-runner/detail-path");
    expect(processKillSpy).toHaveBeenCalledWith(-4249, "SIGKILL");
  });

});

function createRunnerResult() {
  return {
    nextWakeAt: null,
    redactedStatus: {
      importedCount: 0,
    },
    status: "idle" as const,
  };
}

function createSuccessfulChildProcess(
  module: typeof import("../src/node-runner-isolated.ts"),
) {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    pid: number;
    stderr: PassThrough;
    stdin: PassThrough;
    stdout: PassThrough;
  };
  child.kill = vi.fn();
  child.pid = 42_424;
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  queueMicrotask(() => {
    emitChildResult(child, module, {
      ok: true,
      result: createRunnerResult(),
    });
    child.stdout.end();
    child.emit("close", 0);
  });

  return child;
}

function createFailedChildProcess(
  module: typeof import("../src/node-runner-isolated.ts"),
) {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    pid: number;
    stderr: PassThrough;
    stdin: PassThrough;
    stdout: PassThrough;
  };
  child.kill = vi.fn();
  child.pid = 42_425;
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  queueMicrotask(() => {
    emitChildResult(child, module, {
      ok: false,
      error: {
        message: "simulated child failure",
        name: "Error",
      },
    });
    child.stdout.end();
    child.emit("close", 1);
  });

  return child;
}

function resolveWarmBrowserVaultMarkerPath(vaultRoot: string): string {
  return path.join(
    vaultRoot,
    ".runtime",
    "cache",
    "hosted-browser-vault-source-state.json",
  );
}

function readChildProcessDiagnostics(error: Error): Record<string, unknown> {
  const details = (error as Error & { details?: unknown }).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw new Error("Expected error details object.");
  }
  const detailRecord = details as Record<string, unknown>;
  const childProcess = detailRecord.childProcess;
  if (!childProcess || typeof childProcess !== "object" || Array.isArray(childProcess)) {
    throw new Error("Expected child process diagnostics object.");
  }
  return childProcess as Record<string, unknown>;
}

interface MockChildProcess extends EventEmitter {
  connected: boolean;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
  pid: number;
  send?: ReturnType<typeof vi.fn>;
  stderr: PassThrough;
  stdin: PassThrough;
  stdout: PassThrough;
}

function createMockChildProcess(pid: number): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.connected = true;
  child.kill = vi.fn();
  child.killed = false;
  child.pid = pid;
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

function createRuntimePhaseLog(input: {
  durationMs?: number;
  elapsedMs: number;
  ordinal: number;
  phase: string;
  status: string;
}) {
  return {
    component: "runtime",
    details: {
      runtimeElapsedMs: input.elapsedMs,
      runtimePhase: input.phase,
      ...(input.durationMs === undefined ? {} : { runtimePhaseDurationMs: input.durationMs }),
      runtimePhaseOrdinal: input.ordinal,
      runtimePhaseStatus: input.status,
    },
    level: input.status === "fail" ? "error" : "info",
    message: "Hosted workspace runtime phase boundary.",
    phase: input.status === "fail" ? "failed" : "wake.running",
    schema: "murph.hosted-execution.log.v1",
    time: "2026-05-16T00:00:00.000Z",
    userId: null,
  };
}

function createWorkspaceSnapshotProcessFailureLog() {
  return {
    component: "hosted.runtime.workspace-snapshot",
    details: {
      operation: "workspace_snapshot_restore",
      workspaceSnapshotProcessExitCode: 1,
      workspaceSnapshotProcessLabel: "zstd",
      workspaceSnapshotProcessStderrBytes: 192,
      workspaceSnapshotProcessStderrErrorDetail:
        "zstd: unsupported format at <redacted-path>; OPENAI_API_KEY=<redacted>",
      workspaceSnapshotProcessStderrLineCount: 2,
      workspaceSnapshotProcessStderrMarkers: [
        "unsupported_format",
      ],
      workspaceSnapshotProcessStderrTruncated: false,
      workspaceSnapshotRestoreStep: "archive_restore",
    },
    level: "warn",
    message: "Hosted workspace snapshot restore step failed.",
    phase: "runtime.starting",
    schema: "murph.hosted-execution.log.v1",
    time: "2026-05-16T00:00:00.000Z",
    userId: null,
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function emitChildResult(
  child: EventEmitter,
  _module: typeof import("../src/node-runner-isolated.ts"),
  payload: Parameters<typeof createHostedExecutionRunnerChildResultMessage>[0],
) {
  child.emit("message", createHostedExecutionRunnerChildResultMessage(payload));
}

function formatLegacyChildResult(result: unknown): string {
  return `__HB_ASSISTANT_RUNTIME_RESULT__${Buffer.from(
    JSON.stringify({
      ok: true,
      result,
    }),
    "utf8",
  ).toString("base64")}`;
}
