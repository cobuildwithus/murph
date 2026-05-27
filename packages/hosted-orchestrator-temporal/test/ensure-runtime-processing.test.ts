import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";

import {
  ensureRuntimeProcessing,
} from "../src/activities/ensure-runtime-processing.js";
import {
  requestHostedOrchestratorJson,
} from "../src/activities/http-client.js";

describe("ensureRuntimeProcessing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts a parsed Cloudflare ensure-processing request without usage fields when not required", async () => {
    await stubCloudflareEnvironment();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    const response: HostedRuntimeEnsureProcessingResponse = {
      action: "woken",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-05-20T12:00:30.000Z",
      runtimeAttemptId: "runtime_attempt_test",
    };
    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      return jsonResponse(response);
    }));

    await expect(ensureRuntimeProcessing({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      source: "device_sync_recovery",
      userId: "member_test",
    })).resolves.toEqual(response);

    expect(observedRequests).toHaveLength(1);
    const request = observedRequests[0];
    const url = new URL(request.url);
    const headers = new Headers(request.init?.headers);

    expect(url.toString()).toBe(
      "https://runner.example.test/root/internal/users/member_test/runtime/ensure-processing",
    );
    expect(request.init?.method).toBe("POST");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBe(true);
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_test");
    expect(headers.get(HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER)).toBe("10000");
    expect(JSON.parse(String(request.init?.body))).toEqual({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      source: "device_sync_recovery",
    });
    expect(String(request.init?.body)).not.toContain("requiresAiUsageDecision");
    expect(String(request.init?.body)).not.toContain("aiUsageAllowDecision");
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
  });

  it("keeps source demands pending when Cloudflare has not deployed source parsing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
    await stubCloudflareEnvironment();

    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      return jsonResponse({ error: "Invalid request." }, 400);
    }));

    await expect(ensureRuntimeProcessing({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      source: "device_sync_recovery",
      userId: "member_test",
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-05-20T12:00:30.000Z",
    });

    expect(observedRequests).toHaveLength(1);
    expect(JSON.parse(String(observedRequests[0].init?.body))).toEqual({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      source: "device_sync_recovery",
    });
  });

  it("does not turn coded current Cloudflare validation failures into retry-later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
    await stubCloudflareEnvironment();

    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ code: "invalid_request", error: "Invalid request." }, 400)
    ));

    await expect(ensureRuntimeProcessing({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      source: "device_sync_recovery",
      userId: "member_test",
    })).rejects.toMatchObject({
      message: "Hosted orchestrator runtime ensure processing failed with HTTP 400.",
      nonRetryable: true,
      type: "hosted_orchestrator_http_non_retryable",
    });
  });

  it("does not turn source-less Cloudflare validation failures into retry-later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
    await stubCloudflareEnvironment();

    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ error: "Invalid request." }, 400)
    ));

    await expect(ensureRuntimeProcessing({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      userId: "member_test",
    })).rejects.toMatchObject({
      message: "Hosted orchestrator runtime ensure processing failed with HTTP 400.",
      nonRetryable: true,
      type: "hosted_orchestrator_http_non_retryable",
    });
  });

  it("does not turn non-recovery source parse failures into retry-later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
    await stubCloudflareEnvironment();

    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ error: "Invalid request." }, 400)
    ));

    await expect(ensureRuntimeProcessing({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "manual",
      source: "manual",
      userId: "member_test",
    })).rejects.toMatchObject({
      message: "Hosted orchestrator runtime ensure processing failed with HTTP 400.",
      nonRetryable: true,
      type: "hosted_orchestrator_http_non_retryable",
    });
  });

  it("posts only the minimal Cloudflare ensure-processing request", async () => {
    await stubCloudflareEnvironment();

    const response: HostedRuntimeEnsureProcessingResponse = {
      action: "started",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-05-20T12:02:30.000Z",
      runtimeAttemptId: "runtime_attempt_test",
    };
    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      return jsonResponse(response);
    }));

    await expect(ensureRuntimeProcessing({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "manual",
      userId: "member_test",
    })).resolves.toEqual(response);

    expect(observedRequests).toHaveLength(1);
    const cloudflareRequest = observedRequests[0];
    const cloudflareBody = JSON.parse(String(cloudflareRequest.init?.body));
    expect(cloudflareBody).toEqual({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "manual",
    });
    expect(cloudflareBody).not.toHaveProperty("requiresAiUsageDecision");
    expect(cloudflareBody).not.toHaveProperty("aiUsageAllowDecision");
  });

  it("does not call the web usage-decision endpoint", async () => {
    await stubCloudflareEnvironment();

    const response: HostedRuntimeEnsureProcessingResponse = {
      action: "woken",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-05-20T12:02:30.000Z",
      runtimeAttemptId: "runtime_attempt_test",
    };
    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      return jsonResponse(response);
    }));

    await expect(ensureRuntimeProcessing({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      userId: "member_test",
    })).resolves.toEqual(response);

    expect(observedRequests.map((request) => new URL(request.url).pathname)).toEqual([
      "/root/internal/users/member_test/runtime/ensure-processing",
    ]);
  });

  it("rejects invalid Cloudflare ensure-processing responses", async () => {
    await stubCloudflareEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      kind: "caught_up",
      runtimeAttemptId: "runtime_attempt_test",
    })));

    await expect(ensureRuntimeProcessing({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      userId: "member_test",
    })).rejects.toMatchObject({
      message: expect.stringContaining("Hosted runtime ensure-processing response kind"),
      nonRetryable: true,
      type: "hosted_orchestrator_invalid_protocol_response",
    });
  });

  it("throws transport errors for retryable Cloudflare network failures", async () => {
    await stubCloudflareEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network unavailable");
    }));

    await expect(ensureRuntimeProcessing({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      userId: "member_test",
    })).rejects.toMatchObject({
      name: "HostedOrchestratorTransportError",
    });
  });

  it("marks Cloudflare auth failures as non-retryable Activity failures", async () => {
    await stubCloudflareEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      code: "invalid_signature",
    }, 401)));

    await expect(ensureRuntimeProcessing({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      userId: "member_test",
    })).rejects.toMatchObject({
      message: "Hosted orchestrator runtime ensure processing failed with HTTP 401.",
      nonRetryable: true,
      type: "hosted_orchestrator_http_non_retryable",
    });
  });

  it("rejects reserved unsigned request headers before transport", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));

    await expect(requestHostedOrchestratorJson("https://runner.example.test", {
      fetchImpl,
      label: "test",
      method: "GET",
      parse: (value) => value,
      path: "/internal/test",
      timeoutMs: 10_000,
      unsignedHeaders: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: "member_other",
      },
    })).rejects.toMatchObject({
      nonRetryable: true,
      type: "hosted_orchestrator_reserved_unsigned_header",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps Cloudflare server failures retryable", async () => {
    await stubCloudflareEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      code: "internal_error",
    }, 500)));

    await expect(ensureRuntimeProcessing({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      userId: "member_test",
    })).rejects.toMatchObject({
      name: "HostedOrchestratorHttpResponseError",
      status: 500,
    });
  });
});

interface ObservedRequest {
  init: RequestInit | undefined;
  url: string;
}

async function stubCloudflareEnvironment(): Promise<void> {
  vi.stubEnv("CLOUDFLARE_HOSTED_CONTROL_BASE_URL", "https://runner.example.test/root");
  vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_KEY_ID", "test-key");
  vi.stubEnv(
    "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
    await createEphemeralPrivateJwkJson(),
  );
}

async function createEphemeralPrivateJwkJson(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign", "verify"],
  );
  return JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.privateKey));
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status,
  });
}
