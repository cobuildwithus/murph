import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  type HostedAssistantWorkspaceRuntimeJobInput,
  type HostedWorkspaceRuntimeJobOptions,
} from "@murphai/assistant-runtime";

import {
  runHostedExecutionChild,
} from "../src/node-runner-child.ts";
import {
  HostedRuntimeInternalAuthorityRejectedError,
} from "../src/runtime-platform.ts";
import type {
  HostedExecutionRunnerChildResult,
} from "../src/runner-job-transport.ts";
import {
  createHostedExecutionRunnerChildRuntimeWakeMessage,
} from "../src/runner-job-transport.ts";
import {
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH,
} from "../src/runtime-mailbox-payload-decode-contract.ts";
import {
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../src/runner-outbound/headers.ts";

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })
  ));
});

describe("runHostedExecutionChild", () => {
  it("logs and writes a stable bootstrap failure result for invalid JSON input", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();

    await runHostedExecutionChild({
      readStandardInput: async () => "{not-json",
      setExitCode,
      sendResult,
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "child",
        details: expect.objectContaining({
          bootstrapStage: "parse",
        }),
        level: "error",
        message: "Hosted node runner child failed to parse its bootstrap payload.",
        phase: "failed",
      }),
    );
    expect(setExitCode).toHaveBeenCalledWith(1);

    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "syntax_error",
          message: "Hosted node runner child bootstrap payload is invalid.",
        }),
      }),
    );
  });

  it("fails closed when launched without an IPC result channel", async () => {
    const setExitCode = vi.fn();
    const originalSend = process.send;

    try {
      Object.defineProperty(process, "send", {
        configurable: true,
        value: undefined,
      });

      await expect(runHostedExecutionChild({
        readStandardInput: async () => "{not-json",
        setExitCode,
      })).rejects.toThrow("requires an IPC result channel");
    } finally {
      Object.defineProperty(process, "send", {
        configurable: true,
        value: originalSend,
      });
    }

    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it("logs and writes a stable bootstrap failure result for validation failures", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          request: null,
        },
      }),
      setExitCode,
      sendResult,
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "child",
        details: expect.objectContaining({
          bootstrapStage: "parse",
        }),
        level: "error",
        message: "Hosted node runner child failed to parse its bootstrap payload.",
        phase: "failed",
      }),
    );
    expect(setExitCode).toHaveBeenCalledWith(1);

    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "type_error",
          message: "Hosted node runner child bootstrap payload is invalid.",
        }),
      }),
    );
  });

  it("routes workspace-invocation child payloads through the workspace runtime without bridge proxy env", async () => {
    vi.stubEnv("MURPH_E2E_DEBUG_HOSTED_RUNNER", "1");
    const launcherRoot = "/tmp/hosted-runner-launch-test";
    vi.spyOn(process, "cwd").mockReturnValue(launcherRoot);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runWorkspaceInProcess = vi.fn(async (
      _input: HostedAssistantWorkspaceRuntimeJobInput,
      _options: HostedWorkspaceRuntimeJobOptions,
    ) => ({
      nextWakeAt: null,
      redactedStatus: {
        importedCount: 0,
      },
      status: "idle" as const,
    }));

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_child",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {
              HOSTED_ASSISTANT_MODEL: "gpt-test",
              HOSTED_ASSISTANT_PROVIDER: "openai",
              LINQ_API_TOKEN: "linq-token",
              NODE_ENV: "development",
              OPENAI_API_KEY: "fixture-openai-code",
            },
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).not.toHaveBeenCalled();
    expect(runWorkspaceInProcess).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "child",
        details: expect.objectContaining({
          forwardedEnvKeyCount: 5,
          hostedAssistantOpenAiConfigured: true,
          modelCredentialConfigured: true,
          nodeEnvConfigured: true,
        }),
        message: "Hosted node runner child prepared workspace invocation.",
        phase: "runtime.starting",
      }),
    );
    expect(runWorkspaceInProcess.mock.calls[0]?.[0]).toMatchObject({
      kind: "workspace-invocation",
      request: {
        attemptId: "attempt_workspace_child",
        userId: "u_workspace",
        workspaceVersion: "4",
      },
    });
    expect(runWorkspaceInProcess.mock.calls[0]?.[1]).toMatchObject({
      createCheckpointSnapshot: expect.any(Function),
      importItem: expect.any(Function),
      platform: expect.objectContaining({
        artifactStore: expect.any(Object),
        effectsPort: expect.any(Object),
      }),
      vaultRoot: path.join(launcherRoot, "durable", "vault"),
    });

    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);
    expect(payload).toEqual({
      ok: true,
      result: {
        nextWakeAt: null,
        redactedStatus: {
          importedCount: 0,
        },
        status: "idle",
      },
    });

    const debugOutput = consoleErrorSpy.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(debugOutput).toContain('"hostedAssistantModelConfigured":true');
    expect(debugOutput).toContain('"hostedAssistantProviderConfigured":true');
    expect(debugOutput).toContain('"hostedAssistantOpenAiConfigured":true');
    expect(debugOutput).toContain('"linqApiConfigured":true');
    expect(debugOutput).toContain('"modelCredentialConfigured":true');
    expect(debugOutput).toContain('"nodeEnvConfigured":true');
    expect(debugOutput).not.toContain("gpt-test");
    expect(debugOutput).not.toContain("openai");
    expect(debugOutput).not.toContain("linq-token");
    expect(debugOutput).not.toContain("fixture-openai-code");
  });

  it("sends runtime wake readiness and forwards IPC wakes into the workspace runtime", async () => {
    const launcherRoot = "/tmp/hosted-runner-wake-test";
    vi.spyOn(process, "cwd").mockReturnValue(launcherRoot);
    const sendResult = vi.fn();
    const sendRuntimeWakeReady = vi.fn();
    const setExitCode = vi.fn();
    const wakeObserved = createDeferred();
    const runWorkspaceInProcess = vi.fn(async (
      _input: HostedAssistantWorkspaceRuntimeJobInput,
      options: HostedWorkspaceRuntimeJobOptions,
    ) => {
      if (!options.runtimeWakeSignal) {
        throw new Error("Expected runtime wake signal.");
      }
      const wakeWait = options.runtimeWakeSignal.wait();
      process.emit("message", createHostedExecutionRunnerChildRuntimeWakeMessage());
      await wakeWait;
      wakeObserved.resolve();
      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_child_wake",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace_wake",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {
              HOSTED_ASSISTANT_MODEL: "gpt-test",
              HOSTED_ASSISTANT_PROVIDER: "openai",
              OPENAI_API_KEY: "fixture-openai-code",
            },
          },
        },
      }),
      runWorkspaceInProcess,
      sendResult,
      sendRuntimeWakeReady,
      setExitCode,
    });

    await wakeObserved.promise;
    expect(sendRuntimeWakeReady).toHaveBeenCalledTimes(1);
    expect(runWorkspaceInProcess.mock.calls[0]?.[1].runtimeWakeSignal).toBeDefined();
    expect(setExitCode).not.toHaveBeenCalled();
    expect(readChildResult(sendResult.mock.calls[0]?.[0])).toEqual({
      ok: true,
      result: {
        nextWakeAt: null,
        status: "idle",
      },
    });
  });

  it("uses proxy mailbox decoding in the child when no local proxy base URL is present", async () => {
    const launcherRoot = await mkdtemp(path.join(tmpdir(), "murph-node-runner-child-decode-"));
    cleanupPaths.push(launcherRoot);
    vi.spyOn(process, "cwd").mockReturnValue(launcherRoot);
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const importItem = createSystemMailboxImportItem("u_workspace_decode");
    const fetchMock = vi.fn(async (
      requestInfo: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const requestObject = requestInfo instanceof Request
        ? requestInfo
        : new Request(requestInfo, init);
      expect(requestObject.url).toBe(
        `http://web-control.worker${HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH}`,
      );
      expect(requestObject.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
      expect(requestObject.headers.get("x-hosted-runtime-attempt-id")).toBe(
        "attempt_workspace_child_decode",
      );
      expect(requestObject.headers.get("x-hosted-runtime-lease-generation")).toBe("7");
      expect(requestObject.headers.get("x-hosted-runtime-workspace-version")).toBe("4");
      expect(requestObject.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(
        "u_workspace_decode",
      );

      return new Response(JSON.stringify({
        status: "decoded",
        wake: createSystemMailboxWake(importItem.item),
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const runWorkspaceInProcess = vi.fn(async (
      _input: HostedAssistantWorkspaceRuntimeJobInput,
      options: HostedWorkspaceRuntimeJobOptions,
    ) => {
      await expect(options.importItem(importItem)).resolves.toEqual({
        reasonCode: "system_mailbox.queued",
        status: "imported",
      });

      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_child_decode",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace_decode",
            workspaceVersion: "4",
          },
          runtime: {
            platformEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readChildResult(sendResult.mock.calls[0]?.[0])).toEqual({
      ok: true,
      result: {
        nextWakeAt: null,
        status: "idle",
      },
    });
  });

  it("rejects deprecated Codex app-server bridge env in the child runtime config", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runWorkspaceInProcess = vi.fn(async () => ({
      nextWakeAt: null,
      status: "idle" as const,
    }));

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_child_deprecated_proxy",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {
              HOSTED_ASSISTANT_PROVIDER: "openai",
              MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN: "fixture-local-code",
              MURPH_DEV_CODEX_APP_SERVER_PROXY_URL: "tcp://host.docker.internal:3456",
              OPENAI_API_KEY: "fixture-openai-code",
            },
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(runWorkspaceInProcess).not.toHaveBeenCalled();
    expect(setExitCode).toHaveBeenCalledWith(1);

    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);
    expect(payload.ok).toBe(false);
    expect(payload.error?.message).toContain(
      "MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN",
    );
    expect(payload.error?.message).toContain(
      "MURPH_DEV_CODEX_APP_SERVER_PROXY_URL",
    );
    expect(payload.error?.message).not.toContain("fixture-local-code");
    expect(payload.error?.message).not.toContain("fixture-openai-code");
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorCode: "type_error",
      childRuntimeErrorName: "TypeError",
      childRuntimeFailureKind: "unclassified_runtime_error",
      childRuntimeStage: "runtime.not-started",
    });
  });

  it("redacts runtime failure diagnostics before writing the child result payload", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runtimeError = new Error(
      'failed for person@example.test +15555550123 with OPENAI_API_KEY=fixture "MURPH_HOSTED_CLI_BRIDGE_TOKEN":"bridge-secret" OPENAI_API_KEY: "colon-secret" base_url = "https://gateway.example.test/v1" /tmp/hosted-runner/private-file',
    ) as Error & { details?: Record<string, unknown>; status?: number };
    runtimeError.status = 429;
    runtimeError.details = {
      assistantProviderErrorMessage:
        ["Bearer", "provider-token at /tmp/hosted-runner/provider-detail"].join(" "),
      nested: {
        MURPH_HOSTED_CLI_BRIDGE_TOKEN: "nested-bridge-secret",
        OPENAI_API_KEY: "nested-gateway-secret",
      },
    };
    runtimeError.stack =
      "Error: failed\n    at run (/tmp/hosted-runner/private-file.ts:7:3)";
    const runWorkspaceInProcess = vi.fn(async () => {
      throw runtimeError;
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_child_error",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.message).toContain("OPENAI_API_KEY=<redacted>");
    expect(payload.error?.message).toContain('"MURPH_HOSTED_CLI_BRIDGE_TOKEN":<redacted>');
    expect(payload.error?.message).toContain("OPENAI_API_KEY: <redacted>");
    expect(payload.error?.message).toContain("base_url=<redacted>");
    expect(payload.error?.message).toContain("<redacted-path>");
    expect(payload.error?.message).toContain("<redacted-email>");
    expect(payload.error?.message).toContain("<redacted-phone>");
    expect(payload.error?.stack).toContain("<redacted-path>");
    expect(payload.error?.message).not.toContain("person@example.test");
    expect(payload.error?.message).not.toContain("+15555550123");
    expect(payload.error?.message).not.toContain("fixture");
    expect(payload.error?.message).not.toContain("bridge-secret");
    expect(payload.error?.message).not.toContain("colon-secret");
    expect(payload.error?.message).not.toContain("gateway.example.test");
    expect(payload.error?.message).not.toContain("/tmp/hosted-runner/private-file");
    expect(payload.error?.stack).not.toContain("/tmp/hosted-runner/private-file");
    expect(payload.error?.details?.assistantProviderErrorMessage).toBe(
      ["Bearer", "[redacted] at <redacted-path>"].join(" "),
    );
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorCode: "runtime_error",
      childRuntimeErrorName: "Error",
      childRuntimeErrorStatus: 429,
      childRuntimeFailureKind: "unclassified_runtime_error",
      childRuntimeStage: "runtime.in-process",
    });
    expect(JSON.stringify(payload.error?.details)).not.toContain("provider-token");
    expect(JSON.stringify(payload.error?.details)).not.toContain("nested-bridge-secret");
    expect(JSON.stringify(payload.error?.details)).not.toContain("nested-gateway-secret");
    expect(JSON.stringify(payload.error?.details)).not.toContain(
      "/tmp/hosted-runner/provider-detail",
    );
  });

  it("classifies runtime control-plane HTTP failures by fixed operation", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runtimeError = new Error(
      "Hosted workspace read failed with HTTP 404.",
    ) as Error & { status?: number; statusCode?: number };
    runtimeError.status = 404;
    runtimeError.statusCode = 404;
    const runWorkspaceInProcess = vi.fn(async () => {
      throw runtimeError;
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_read_404",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorCode: "invalid_request",
      childRuntimeErrorName: "Error",
      childRuntimeErrorStatus: 404,
      childRuntimeFailureKind: "control_plane_http",
      childRuntimeHttpOperation: "workspace_read",
      childRuntimeStage: "runtime.in-process",
    });
  });

  it("classifies bundle archive failures with runner operation metadata", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runtimeError = Object.assign(
      new Error("Hosted bundle archive is invalid."),
      {
        code: "bundle_archive_validation_error",
        details: {
          bundleArchiveOperation: "runner-output",
          bundleArchiveValidationCause: "archive_invalid",
          bundleRefKeyPresent: false,
          bundleRefPresent: false,
          bundleRefSize: 1234,
        },
        name: "HostedBundleArchiveValidationError",
      },
    );
    const runWorkspaceInProcess = vi.fn(async () => {
      throw runtimeError;
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_bundle_validation",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.details).toMatchObject({
      childRuntimeBundleArchiveOperation: "runner-output",
      childRuntimeBundleArchiveValidationCause: "archive_invalid",
      childRuntimeBundleRefKeyPresent: false,
      childRuntimeBundleRefPresent: true,
      childRuntimeBundleRefSize: 1234,
      childRuntimeErrorCode: "bundle_archive_validation_error",
      childRuntimeErrorName: "HostedBundleArchiveValidationError",
      childRuntimeFailureKind: "bundle_archive_validation",
      childRuntimeStage: "runtime.in-process",
    });
  });

  it("classifies missing runtime artifacts without requiring raw artifact hashes", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runtimeError = new Error(
      "Hosted artifact fetch failed with HTTP 404.",
    ) as Error & { status?: number; statusCode?: number };
    runtimeError.status = 404;
    runtimeError.statusCode = 404;
    const runWorkspaceInProcess = vi.fn(async () => {
      throw runtimeError;
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_artifact_fetch_404",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorCode: "invalid_request",
      childRuntimeErrorName: "Error",
      childRuntimeErrorStatus: 404,
      childRuntimeFailureKind: "control_plane_http",
      childRuntimeHttpOperation: "artifact_fetch",
      childRuntimeStage: "runtime.in-process",
    });
  });

  it("classifies stale artifact upload authority failures by fixed operation", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runWorkspaceInProcess = vi.fn(async () => {
      throw new HostedRuntimeInternalAuthorityRejectedError({
        description: "Hosted artifact upload",
        status: 401,
      });
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_artifact_upload_stale",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorCode: "authorization_error",
      childRuntimeErrorName: "HostedRuntimeInternalAuthorityRejectedError",
      childRuntimeErrorStatus: 401,
      childRuntimeFailureKind: "stale_invocation_authority",
      childRuntimeHttpOperation: "artifact_upload",
      childRuntimeStage: "runtime.in-process",
    });
  });

  it("propagates artifact fetch transport cause metadata without free-form cause detail", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runtimeError = Object.assign(
      new Error("Hosted artifact fetch request failed."),
      {
        hostedRuntimeControlPlaneFetchFailure: true,
        hostedRuntimeFetchCallerSignalAborted: false,
        hostedRuntimeFetchCauseCode: "runtime_error",
        hostedRuntimeFetchCauseKind: "cloudflare_rpc_destroy",
        hostedRuntimeFetchCauseName: "Error",
        hostedRuntimeFetchRequestSignalAborted: true,
        hostedRuntimeFetchTimeoutMs: 30_000,
        hostedRuntimeFetchTimeoutSignalAborted: false,
      },
    );
    const runWorkspaceInProcess = vi.fn(async () => {
      throw runtimeError;
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_artifact_fetch_rpc_destroyed",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorCode: "runtime_error",
      childRuntimeErrorName: "Error",
      childRuntimeFailureKind: "control_plane_fetch",
      childRuntimeFetchCallerSignalAborted: false,
      childRuntimeFetchCauseKind: "cloudflare_rpc_destroy",
      childRuntimeFetchCauseName: "Error",
      childRuntimeFetchRequestSignalAborted: true,
      childRuntimeFetchTimeoutMs: 30_000,
      childRuntimeFetchTimeoutSignalAborted: false,
      childRuntimeHttpOperation: "artifact_fetch",
      childRuntimeStage: "runtime.in-process",
    });
    expect(JSON.stringify(payload.error?.details)).not.toContain("destroy() was called");
  });

  it("propagates workspace snapshot restore step metadata for fetch failures", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runtimeError = Object.assign(
      new Error("Hosted workspace snapshot fetch request failed."),
      {
        hostedRuntimeControlPlaneFetchFailure: true,
        hostedRuntimeFetchCallerSignalAborted: false,
        hostedRuntimeFetchCauseCode: "type_error",
        hostedRuntimeFetchCauseKind: "fetch_failed",
        hostedRuntimeFetchCauseName: "TypeError",
        hostedRuntimeFetchRequestSignalAborted: false,
        hostedRuntimeFetchTimeoutMs: 30_000,
        hostedRuntimeFetchTimeoutSignalAborted: false,
        hostedWorkspaceSnapshotRestoreStep: "object_fetch",
      },
    );
    const runWorkspaceInProcess = vi.fn(async () => {
      throw runtimeError;
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_snapshot_fetch_failed",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorCode: "runtime_error",
      childRuntimeErrorMessageKind: "workspace_snapshot_fetch_request_failure",
      childRuntimeErrorName: "Error",
      childRuntimeFailureKind: "control_plane_fetch",
      childRuntimeFetchCallerSignalAborted: false,
      childRuntimeFetchCauseKind: "fetch_failed",
      childRuntimeFetchCauseName: "TypeError",
      childRuntimeFetchRequestSignalAborted: false,
      childRuntimeFetchTimeoutMs: 30_000,
      childRuntimeFetchTimeoutSignalAborted: false,
      childRuntimeHttpOperation: "workspace_snapshot_fetch",
      childRuntimeStage: "runtime.in-process",
      childRuntimeWorkspaceSnapshotRestoreStep: "object_fetch",
    });
  });

  it("classifies direct R2 snapshot upload request failures without free-form details", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runtimeError = new Error(
      "Hosted workspace snapshot direct R2 upload request failed: fetch failed for <redacted-url>",
    );
    const runWorkspaceInProcess = vi.fn(async () => {
      throw runtimeError;
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_snapshot_upload_failed",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorMessageKind:
        "workspace_snapshot_direct_r2_upload_request_failure",
      childRuntimeHttpOperation: "workspace_snapshot_direct_r2_upload",
      childRuntimeStage: "runtime.in-process",
    });
    expect(payload.error?.details?.childRuntimeErrorMessageKind)
      .not.toContain("redacted-url");
  });

  it("classifies fixed workspace snapshot restore error messages without free-form details", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runtimeError = Object.assign(
      new Error("Hosted workspace snapshot plaintext archive digest does not match its ref."),
      {
        hostedWorkspaceSnapshotRestoreStep: "archive_restore",
      },
    );
    const runWorkspaceInProcess = vi.fn(async () => {
      throw runtimeError;
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_snapshot_plaintext_digest",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorCode: "runtime_error",
      childRuntimeErrorMessageKind: "workspace_snapshot_plaintext_digest_mismatch",
      childRuntimeErrorName: "Error",
      childRuntimeFailureKind: "unclassified_runtime_error",
      childRuntimeStage: "runtime.in-process",
      childRuntimeWorkspaceSnapshotRestoreStep: "archive_restore",
    });
    expect(payload.error?.details?.childRuntimeErrorMessageKind).not.toContain("archive digest");
  });

  it("classifies runtime control-plane transport failures by fixed operation", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runWorkspaceInProcess = vi.fn(async () => {
      throw new Error("Hosted workspace read returned invalid JSON.");
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_read_invalid_json",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorCode: "invalid_request",
      childRuntimeErrorName: "Error",
      childRuntimeFailureKind: "control_plane_invalid_json",
      childRuntimeHttpOperation: "workspace_read",
      childRuntimeStage: "runtime.in-process",
    });
  });

  it("classifies runtime control-plane fetch failures by fixed operation", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runWorkspaceInProcess = vi.fn(async () => {
      throw new Error("Hosted workspace read request failed. fetch failed");
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_read_fetch_failed",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorCode: "runtime_error",
      childRuntimeErrorName: "Error",
      childRuntimeFailureKind: "control_plane_fetch",
      childRuntimeHttpOperation: "workspace_read",
      childRuntimeStage: "runtime.in-process",
    });
  });

  it("classifies Cloudflare RPC destroy failures without free-form details", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runWorkspaceInProcess = vi.fn(async () => {
      throw new Error("The RPC call destroy() was called");
    });

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_workspace_rpc_destroyed",
            leaseGeneration: "7",
            reason: "nudge",
            userId: "u_workspace",
            workspaceVersion: "4",
          },
          runtime: {
            forwardedEnv: {},
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      sendResult,
    });

    const payload = readChildResult(sendResult.mock.calls[0]?.[0]);
    expect(payload.error?.details).toMatchObject({
      childRuntimeErrorCode: "runtime_error",
      childRuntimeErrorName: "Error",
      childRuntimeFailureKind: "runtime_rpc_destroyed",
      childRuntimeStage: "runtime.in-process",
    });
  });
});

function readChildResult(chunk: unknown): HostedExecutionRunnerChildResult {
  if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) {
    throw new Error("Expected the child to send a result payload.");
  }

  return chunk as HostedExecutionRunnerChildResult;
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

function createSystemMailboxImportItem(userId: string) {
  const item = {
    createdAt: "2026-05-01T00:00:00.000Z",
    dedupeKey: "event:node-runner-child-decode",
    expiresAt: null,
    id: "mailbox_item_node_runner_child_decode",
    kind: "member.channels.updated" as const,
    lane: "system" as const,
    laneSeq: "1",
    occurredAt: "2026-05-01T00:00:00.000Z",
    payloadBytes: 64,
    payloadInlineCiphertext: null,
    payloadRef: "hosted-mailbox-payload:mailbox_item_node_runner_child_decode",
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: "2026-05-01T00:00:00.000Z",
    userId,
  };

  return {
    item,
    payload: {
      payloadCiphertext: "opaque-child-mailbox-ciphertext",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      requestId: "request_node_runner_child_decode",
      source: "sidecar" as const,
      status: "resolved" as const,
    },
    route: {
      action: "apply-member-channels-update" as const,
      advanceProgress: true as const,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route" as const,
    },
  };
}

function createSystemMailboxWake(item: ReturnType<typeof createSystemMailboxImportItem>["item"]) {
  return {
    eventId: item.dedupeKey,
    kind: item.kind,
    memberChannels: {
      email: true,
      linq: false,
      telegram: false,
    },
    occurredAt: item.occurredAt,
    userId: item.userId,
  };
}
