import { afterEach, describe, expect, it, vi } from "vitest";

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
  parseHostedRuntimeChildResult,
  type HostedAssistantWorkspaceRuntimeJobInput,
  type HostedWorkspaceRuntimeJobOptions,
} from "@murphai/assistant-runtime";

import {
  runHostedExecutionChild,
} from "../src/node-runner-child.ts";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runHostedExecutionChild", () => {
  it("logs and writes a stable bootstrap failure result for invalid JSON input", async () => {
    const stdout = { write: vi.fn() };
    const setExitCode = vi.fn();

    await runHostedExecutionChild({
      readStandardInput: async () => "{not-json",
      setExitCode,
      stdout,
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

    const payload = readChildResult(stdout.write.mock.calls[0]?.[0]);
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

  it("logs and writes a stable bootstrap failure result for validation failures", async () => {
    const stdout = { write: vi.fn() };
    const setExitCode = vi.fn();

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        internalWorkerProxyToken: "proxy-token",
        job: {
          request: null,
        },
      }),
      setExitCode,
      stdout,
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

    const payload = readChildResult(stdout.write.mock.calls[0]?.[0]);
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
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const stdout = { write: vi.fn() };
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
              HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
              LINQ_API_TOKEN: "linq-token",
              NODE_ENV: "development",
              VERCEL_AI_API_KEY: "fixture-gateway-code",
            },
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      stdout,
    });

    expect(setExitCode).not.toHaveBeenCalled();
    expect(runWorkspaceInProcess).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "child",
        details: expect.objectContaining({
          forwardedEnvKeyCount: 5,
          hostedAssistantVercelAiGatewayConfigured: true,
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
    });

    const payload = readChildResult(stdout.write.mock.calls[0]?.[0]);
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
    expect(debugOutput).toContain('"hostedAssistantVercelAiGatewayConfigured":true');
    expect(debugOutput).toContain('"linqApiConfigured":true');
    expect(debugOutput).toContain('"modelCredentialConfigured":true');
    expect(debugOutput).toContain('"nodeEnvConfigured":true');
    expect(debugOutput).not.toContain("gpt-test");
    expect(debugOutput).not.toContain("vercel-ai-gateway");
    expect(debugOutput).not.toContain("linq-token");
    expect(debugOutput).not.toContain("fixture-gateway-code");
  });

  it("rejects deprecated Codex app-server bridge env in the child runtime config", async () => {
    const stdout = { write: vi.fn() };
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
              HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
              MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN: "fixture-local-code",
              MURPH_DEV_CODEX_APP_SERVER_PROXY_URL: "tcp://host.docker.internal:3456",
              VERCEL_AI_API_KEY: "fixture-gateway-code",
            },
          },
        },
      }),
      runWorkspaceInProcess,
      setExitCode,
      stdout,
    });

    expect(runWorkspaceInProcess).not.toHaveBeenCalled();
    expect(setExitCode).toHaveBeenCalledWith(1);

    const payload = readChildResult(stdout.write.mock.calls[0]?.[0]);
    expect(payload.ok).toBe(false);
    expect(payload.error?.message).toContain(
      "MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN",
    );
    expect(payload.error?.message).toContain(
      "MURPH_DEV_CODEX_APP_SERVER_PROXY_URL",
    );
    expect(payload.error?.message).not.toContain("fixture-local-code");
    expect(payload.error?.message).not.toContain("fixture-gateway-code");
  });

  it("redacts runtime failure diagnostics before writing the child result payload", async () => {
    const stdout = { write: vi.fn() };
    const setExitCode = vi.fn();
    const runtimeError = new Error(
      'failed for person@example.test +15555550123 with VERCEL_AI_API_KEY=fixture "MURPH_HOSTED_CLI_BRIDGE_TOKEN":"bridge-secret" VERCEL_AI_API_KEY: "colon-secret" base_url = "https://gateway.example.test/v1" /tmp/hosted-runner/private-file',
    ) as Error & { details?: Record<string, unknown> };
    runtimeError.details = {
      assistantProviderErrorMessage:
        "Bearer provider-token at /tmp/hosted-runner/provider-detail",
      nested: {
        MURPH_HOSTED_CLI_BRIDGE_TOKEN: "nested-bridge-secret",
        VERCEL_AI_API_KEY: "nested-gateway-secret",
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
      stdout,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const payload = readChildResult(stdout.write.mock.calls[0]?.[0]);

    expect(payload.ok).toBe(false);
    expect(payload.error?.message).toContain("VERCEL_AI_API_KEY=<redacted>");
    expect(payload.error?.message).toContain('"MURPH_HOSTED_CLI_BRIDGE_TOKEN":<redacted>');
    expect(payload.error?.message).toContain("VERCEL_AI_API_KEY: <redacted>");
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
      "Bearer [redacted] at <redacted-path>",
    );
    expect(JSON.stringify(payload.error?.details)).not.toContain("provider-token");
    expect(JSON.stringify(payload.error?.details)).not.toContain("nested-bridge-secret");
    expect(JSON.stringify(payload.error?.details)).not.toContain("nested-gateway-secret");
    expect(JSON.stringify(payload.error?.details)).not.toContain(
      "/tmp/hosted-runner/provider-detail",
    );
  });
});

function readChildResult(chunk: unknown) {
  if (typeof chunk !== "string") {
    throw new Error("Expected the child to write a result payload.");
  }

  return parseHostedRuntimeChildResult(chunk);
}
