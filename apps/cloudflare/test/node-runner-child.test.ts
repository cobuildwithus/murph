import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";
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
import type {
  HostedExecutionRunnerChildResult,
} from "../src/runner-job-transport.ts";
import {
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH,
} from "../src/runtime-mailbox-payload-decode-contract.ts";

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
        internalWorkerProxyToken: "proxy-token",
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
        internalWorkerProxyToken: "bridge-token",
        localInternalProxyBaseUrl: "http://127.0.0.1:8787/__murph/local-internal-proxy/users/u_workspace",
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
        workspacePort: expect.any(Object),
      }),
      vaultRoot: path.join(launcherRoot, "vault"),
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
      expect(requestObject.headers.get(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER)).toBe(
        "bridge-token",
      );
      expect(requestObject.headers.get("x-hosted-runtime-attempt-id")).toBe(
        "attempt_workspace_child_decode",
      );
      expect(requestObject.headers.get("x-hosted-runtime-lease-generation")).toBe("7");
      expect(requestObject.headers.get("x-hosted-runtime-workspace-version")).toBe("4");

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
        internalWorkerProxyToken: "bridge-token",
        localInternalProxyBaseUrl: null,
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
        internalWorkerProxyToken: "bridge-token",
        localInternalProxyBaseUrl: null,
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
  });

  it("redacts runtime failure diagnostics before writing the child result payload", async () => {
    const sendResult = vi.fn();
    const setExitCode = vi.fn();
    const runtimeError = new Error(
      'failed for person@example.test +15555550123 with OPENAI_API_KEY=fixture "MURPH_HOSTED_CLI_BRIDGE_TOKEN":"bridge-secret" OPENAI_API_KEY: "colon-secret" base_url = "https://gateway.example.test/v1" /tmp/hosted-runner/private-file',
    ) as Error & { details?: Record<string, unknown> };
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
        internalWorkerProxyToken: "bridge-token",
        localInternalProxyBaseUrl: null,
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
    expect(JSON.stringify(payload.error?.details)).not.toContain("provider-token");
    expect(JSON.stringify(payload.error?.details)).not.toContain("nested-bridge-secret");
    expect(JSON.stringify(payload.error?.details)).not.toContain("nested-gateway-secret");
    expect(JSON.stringify(payload.error?.details)).not.toContain(
      "/tmp/hosted-runner/provider-detail",
    );
  });
});

function readChildResult(chunk: unknown): HostedExecutionRunnerChildResult {
  if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) {
    throw new Error("Expected the child to send a result payload.");
  }

  return chunk as HostedExecutionRunnerChildResult;
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
