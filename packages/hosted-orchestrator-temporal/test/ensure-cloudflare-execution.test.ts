import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeEnsureExecutionResponse,
} from "@murphai/hosted-execution/orchestration-control";
import type {
  HostedAiUsageAllowDecision,
} from "@murphai/hosted-execution/runtime-control";

import {
  ensureCloudflareExecution,
} from "../src/activities/ensure-cloudflare-execution.js";

describe("ensureCloudflareExecution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts a parsed Cloudflare ensure-execution request without usage fields when not required", async () => {
    await stubCloudflareEnvironment();

    const response: HostedRuntimeEnsureExecutionResponse = {
      kind: "runtime_wake_sent",
      recommendedRecheckAt: "2026-05-20T12:00:30.000Z",
      runtimeAttemptId: "runtime_attempt_test",
    };
    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      return jsonResponse(response);
    }));

    await expect(ensureCloudflareExecution({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      requiresAiUsageDecision: false,
      userId: "member_test",
    })).resolves.toEqual(response);

    expect(observedRequests).toHaveLength(1);
    const request = observedRequests[0];
    const url = new URL(request.url);
    const headers = new Headers(request.init?.headers);

    expect(url.toString()).toBe(
      "https://runner.example.test/root/internal/users/member_test/runtime/ensure-execution",
    );
    expect(request.init?.method).toBe("POST");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBe(true);
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_test");
    expect(JSON.parse(String(request.init?.body))).toEqual({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
    });
    expect(String(request.init?.body)).not.toContain("requiresAiUsageDecision");
    expect(String(request.init?.body)).not.toContain("aiUsageAllowDecision");
  });

  it("fetches a fresh signed usage decision only when required and sends it only to Cloudflare", async () => {
    await stubCloudflareEnvironment();
    await stubHostedWebEnvironment();

    const aiUsageAllowDecision = createAiUsageAllowDecision("member_test");
    const response: HostedRuntimeEnsureExecutionResponse = {
      action: "started",
      kind: "runtime_completed",
      runtimeAttemptId: "runtime_attempt_test",
      runtimeResultNextWakeAt: null,
      runtimeStatus: "idle",
    };
    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      const parsedUrl = new URL(String(url));
      if (parsedUrl.pathname.endsWith("/usage-allow-decision")) {
        return jsonResponse(aiUsageAllowDecision);
      }
      return jsonResponse(response);
    }));

    await expect(ensureCloudflareExecution({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "manual",
      requiresAiUsageDecision: true,
      userId: "member_test",
    })).resolves.toEqual(response);

    expect(observedRequests).toHaveLength(2);

    const usageRequest = observedRequests[0];
    const usageUrl = new URL(usageRequest.url);
    const usageHeaders = new Headers(usageRequest.init?.headers);
    expect(usageUrl.toString()).toBe(
      "https://web.example.test/api/internal/hosted-orchestration/users/member_test/usage-allow-decision",
    );
    expect(usageRequest.init?.method).toBe("GET");
    expect(usageHeaders.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_test");
    expect(usageHeaders.has(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBe(true);

    const cloudflareRequest = observedRequests[1];
    const cloudflareBody = JSON.parse(String(cloudflareRequest.init?.body));
    expect(cloudflareBody).toEqual({
      aiUsageAllowDecision,
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "manual",
    });
    expect(cloudflareBody).not.toHaveProperty("requiresAiUsageDecision");
  });

  it("does not call the web usage-decision endpoint when usage decision is not required", async () => {
    await stubCloudflareEnvironment();
    await stubHostedWebEnvironment();

    const response: HostedRuntimeEnsureExecutionResponse = {
      kind: "runtime_wake_sent",
      recommendedRecheckAt: null,
      runtimeAttemptId: "runtime_attempt_test",
    };
    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      return jsonResponse(response);
    }));

    await expect(ensureCloudflareExecution({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      requiresAiUsageDecision: false,
      userId: "member_test",
    })).resolves.toEqual(response);

    expect(observedRequests.map((request) => new URL(request.url).pathname)).toEqual([
      "/root/internal/users/member_test/runtime/ensure-execution",
    ]);
  });

  it("classifies blocked fresh usage decisions without calling Cloudflare", async () => {
    await stubCloudflareEnvironment();
    await stubHostedWebEnvironment();

    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      const parsedUrl = new URL(String(url));
      if (parsedUrl.pathname.endsWith("/usage-allow-decision")) {
        return jsonResponse({
          kind: "blocked",
          reason: "ai_usage_gate_unavailable",
          retryAt: "2026-05-20T12:00:30.000Z",
        });
      }
      throw new Error("Cloudflare should not be called for blocked usage.");
    }));

    await expect(ensureCloudflareExecution({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "manual",
      requiresAiUsageDecision: true,
      userId: "member_test",
    })).rejects.toMatchObject({
      code: "ai_usage_gate_unavailable",
      name: "HostedOrchestratorUsageDecisionBlockedError",
      retryAt: "2026-05-20T12:00:30.000Z",
    });

    expect(observedRequests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/internal/hosted-orchestration/users/member_test/usage-allow-decision",
    ]);
  });

  it("rejects invalid Cloudflare ensure-execution responses", async () => {
    await stubCloudflareEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      kind: "caught_up",
      runtimeAttemptId: "runtime_attempt_test",
    })));

    await expect(ensureCloudflareExecution({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      requiresAiUsageDecision: false,
      userId: "member_test",
    })).rejects.toThrow("Hosted runtime ensure-execution response kind");
  });

  it("throws transport errors for retryable Cloudflare network failures", async () => {
    await stubCloudflareEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network unavailable");
    }));

    await expect(ensureCloudflareExecution({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      requiresAiUsageDecision: false,
      userId: "member_test",
    })).rejects.toMatchObject({
      name: "HostedOrchestratorTransportError",
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
  vi.stubEnv("HOSTED_EXECUTION_RUNNER_TIMEOUT_MS", "120000");
  vi.stubEnv("HOSTED_TEMPORAL_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS", "5000");
}

async function stubHostedWebEnvironment(): Promise<void> {
  vi.stubEnv("HOSTED_WEB_BASE_URL", "https://web.example.test");
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

function createAiUsageAllowDecision(userId: string): HostedAiUsageAllowDecision {
  return {
    allowed: true,
    expiresAt: "2026-05-20T12:00:30.000Z",
    issuedAt: "2026-05-20T12:00:00.000Z",
    nonce: "0123456789abcdef0123456789abcdef",
    schema: "murph.hosted-ai-usage-allow-decision.v1",
    signature: {
      alg: "HMAC-SHA256",
      keyId: "test-key",
      signature: "<REDACTED_SIGNATURE>",
    },
    userId,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status,
  });
}
