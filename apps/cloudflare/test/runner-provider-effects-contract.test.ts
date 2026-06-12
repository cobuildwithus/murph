// Regression coverage for the hosted Telegram provider-effect route. The
// container-side effects-port client and the worker-side handler were only
// ever tested against mocks of each other, which let a contract break ship
// silently (every prod /telegram/files/get returned 400). These tests wire
// the real client through the real egress intercept to the real handler, and
// pin the failure-stage diagnostics for the malformed-request paths.
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { buildHostedExecutionRuntimePlatform } from "../src/runtime-platform.ts";
import { handleHostedRunnerInternalOutbound } from "../src/runner-egress-intercept.ts";
import { handleRunnerProviderEffectsRequest } from "../src/runner-outbound/provider-effects.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

function createProviderEffectsEnv() {
  return {
    ...createHostedExecutionTestEnv(),
    TELEGRAM_BOT_TOKEN: "telegram-token",
    USER_RUNNER: {
      getByName() {
        return {
          async bindUser(userId: string) {
            return { userId };
          },
          async validateRuntimeWriteFence() {
            return true;
          },
        };
      },
    },
  };
}

const PROVIDER_EFFECT_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-hosted-runtime-attempt-id": "attempt_1",
  "x-hosted-runtime-lease-generation": "9",
  "x-hosted-runtime-workspace-version": "4",
} as const;

function readProviderEffectFailureLogs(): Array<Record<string, unknown>> {
  return mocks.emitHostedExecutionStructuredLog.mock.calls
    .map(([input]) => input as { details?: Record<string, unknown>; message?: string })
    .filter((input) => input.message === "Hosted runner provider effect request failed.")
    .map((input) => input.details ?? {});
}

describe("telegram provider effect contract", () => {
  beforeEach(() => {
    mocks.emitHostedExecutionStructuredLog.mockClear();
    vi.unstubAllGlobals();
  });

  it("serves a get-file request from the real effects-port client end to end", async () => {
    const telegramFile = {
      file_id: "telegram_file_123",
      file_path: "documents/file_1.pdf",
      file_size: 1234,
      file_unique_id: "telegram_unique_123",
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: telegramFile,
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    })));

    const env = createProviderEffectsEnv();
    const bridgeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return handleHostedRunnerInternalOutbound(
        request,
        env as never,
        { containerId: "container_test_1" },
      );
    }) as typeof fetch;

    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: bridgeFetch,
      proxyBoundUserIdHeader: true,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    await expect(platform.effectsPort.getTelegramFile!({
      fileId: "telegram_file_123",
    })).resolves.toEqual(telegramFile);
  });

  it("rejects a body missing fileId with 400 and contract_parse diagnostics", async () => {
    const response = await handleRunnerProviderEffectsRequest({
      env: createProviderEffectsEnv() as never,
      pathname: "/telegram/files/get",
      request: new Request("http://results.worker/telegram/files/get", {
        body: JSON.stringify({ file_id: "wrong-key" }),
        headers: PROVIDER_EFFECT_HEADERS,
        method: "POST",
      }),
      userId: "member_123",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Malformed provider effect request.",
    });
    expect(readProviderEffectFailureLogs()).toEqual([
      expect.objectContaining({
        bodyKeys: "file_id",
        errorName: "TypeError",
        path: "/telegram/files/get",
        stage: "contract_parse",
      }),
    ]);
  });

  it("rejects an unreadable body with 400 and body_read diagnostics", async () => {
    const response = await handleRunnerProviderEffectsRequest({
      env: createProviderEffectsEnv() as never,
      pathname: "/telegram/files/get",
      request: new Request("http://results.worker/telegram/files/get", {
        body: "not json",
        headers: PROVIDER_EFFECT_HEADERS,
        method: "POST",
      }),
      userId: "member_123",
    });

    expect(response.status).toBe(400);
    expect(readProviderEffectFailureLogs()).toEqual([
      expect.objectContaining({
        errorName: "SyntaxError",
        stage: "body_read",
      }),
    ]);
  });

  it("maps effect execution failures to 502, not the malformed-request 400", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      description: "Bad Request: file is too big",
      error_code: 400,
      ok: false,
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    })));

    const response = await handleRunnerProviderEffectsRequest({
      env: createProviderEffectsEnv() as never,
      pathname: "/telegram/files/get",
      request: new Request("http://results.worker/telegram/files/get", {
        body: JSON.stringify({ fileId: "telegram_file_123" }),
        headers: PROVIDER_EFFECT_HEADERS,
        method: "POST",
      }),
      userId: "member_123",
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Provider effect failed.",
    });
    expect(readProviderEffectFailureLogs()).toEqual([
      expect.objectContaining({
        stage: "effect",
      }),
    ]);
  });
});
