import { describe, expect, it, vi, afterEach } from "vitest";

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
  buildHostedOpenAiCacheDiagnostic,
  handleHostedRunnerInternalOutbound,
  handleHostedRunnerLinqOutbound,
  handleHostedRunnerMapboxOutbound,
  handleHostedRunnerOpenAiOutbound,
  handleHostedRunnerOpenInternetOutbound,
  handleHostedRunnerTelegramOutbound,
  handleHostedRunnerWhatsAppOutbound,
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
  HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE,
  HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS,
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
  hostedRunnerIntercept,
} from "../src/runner-egress-intercept.ts";
import {
  HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
} from "../src/runner-effects-contract.ts";
import {
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import {
  parseHostedRuntimeLogRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../src/runner-outbound/headers.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound.ts";
import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

const WRITE_FENCE_HEADERS = {
  [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_1",
  [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "7",
  [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "4",
} as const;
const BOUND_USER_WRITE_FENCE_HEADERS = {
  ...WRITE_FENCE_HEADERS,
  [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
} as const;
const BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS = {
  ...BOUND_USER_WRITE_FENCE_HEADERS,
  authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
} as const;
const OPENAI_WEBSOCKET_HANDSHAKE_HEADERS = {
  connection: "keep-alive, Upgrade",
  "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
  "sec-websocket-version": "13",
  upgrade: "websocket",
} as const;
const TEST_TEXT_ENCODER = new TextEncoder();

function testByteLength(value: string): number {
  return TEST_TEXT_ENCODER.encode(value).byteLength;
}

function testJsonByteLength(value: unknown): number {
  return testByteLength(JSON.stringify(value));
}

function parseDiagnosticRuntimeLog(redactedJson: Record<string, unknown>): void {
  parseHostedRuntimeLogRequest({
    entries: [{
      at: "2026-05-19T00:00:00.000Z",
      component: "runner",
      eventCode: HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE,
      level: "debug",
      phase: "fetch",
      redactedJson,
    }],
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("hostedRunnerIntercept", () => {
  it("maps default provider and internal hosts to Cloudflare per-host outbound handlers", () => {
    expect(hostedRunnerIntercept).toBe(handleHostedRunnerOpenInternetOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.openAi])
      .toBe(handleHostedRunnerOpenAiOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.mapbox])
      .toBe(handleHostedRunnerMapboxOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.linq])
      .toBe(handleHostedRunnerLinqOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.telegram])
      .toBe(handleHostedRunnerTelegramOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.whatsApp])
      .toBe(handleHostedRunnerWhatsAppOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST[HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.webControlPlane])
      .toBe(handleHostedRunnerInternalOutbound);
    expect(HOSTED_RUNNER_OUTBOUND_BY_HOST["unexpected.example.test"]).toBeUndefined();
  });

  it("preserves runtime write-fence headers for internal intercepted requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ok: true,
      result: {
        file_id: "telegram_file_123",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request(`http://results.worker${HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH}`, {
        body: JSON.stringify({
          fileId: "telegram_file_123",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "7",
          "x-hosted-runtime-workspace-version": "42",
        },
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects internal virtual-host requests without a runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("http://web-control.worker/internal/hosted-runtime/mailbox-payload/decode", {
        headers: {
          [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
        },
        method: "POST",
      }),
      createInterceptEnv({}),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes internal web-control workspace reads without a top-level write-fence check", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      fetchedAt: "2026-05-12T00:00:00.000Z",
      workspace: null,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => {
      throw new Error("workspace reads should be owned by the web-control handler");
    });

    const response = await hostedRunnerIntercept(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        headers: {
          [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
        },
        method: "GET",
      }),
      createInterceptEnv({ validateRuntimeWriteFence }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          boundUserIdHeaderPresent: true,
          containerIdPresent: true,
          hostKind: "web_control_plane",
          method: "GET",
          operation: "workspace_read",
          runtimeAuthorityHeadersPresent: false,
        }),
        message: "Hosted runner internal outbound request received.",
        phase: "wake.running",
      }),
    );
  });

  it("logs unexpected internal outbound methods with a fixed method vocabulary", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        headers: {
          [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
        },
        method: "SECRET123",
      }),
      createInterceptEnv({}),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          method: "other",
          operation: "web_control_blocked",
        }),
        message: "Hosted runner internal outbound request received.",
        phase: "wake.running",
      }),
    );
    expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls)).not.toContain(
      "SECRET123",
    );
  });

  it("logs internal outbound non-OK response metadata without consuming the response body", async () => {
    const rawPath = "/workspace-snapshots/snapshot_sensitive/presign-get";
    const response = await hostedRunnerIntercept(
      new Request(`http://workspace-snapshots.worker${rawPath}`, {
        headers: {
          [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
        },
        method: "GET",
      }),
      createInterceptEnv({}),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "Method not allowed.",
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          boundUserIdHeaderPresent: true,
          containerIdPresent: true,
          hostKind: "workspace_snapshot_store",
          method: "GET",
          operation: "workspace_snapshot_presign_get",
          responseBodyKind: "json",
          responseErrorShape: "string_error",
          responseOk: false,
          responseStatus: 405,
          runtimeAuthorityHeadersPresent: false,
        }),
        level: "warn",
        message: "Hosted runner internal outbound response completed.",
        phase: "wake.running",
      }),
    );
    const serializedLogs = JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls);
    expect(serializedLogs).not.toContain(rawPath);
    expect(serializedLogs).not.toContain("snapshot_sensitive");
    expect(serializedLogs).not.toContain("member_123");
    expect(serializedLogs).not.toContain("Method not allowed.");
  });

  it("injects OpenAI authorization with a valid runtime write fence and strips authority headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          cookie: "session=user-supplied-cookie",
          "openai-organization": "org_user_supplied",
          "openai-project": "proj_user_supplied",
          "proxy-authorization": "Bearer user-supplied-proxy-token",
          "x-api-key": "user-supplied-api-key",
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = findFetchCall(fetchMock, "api.openai.com")?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    const forwardedRequest = forwarded as Request;
    expect(forwardedRequest.url).toBe("https://api.openai.com/v1/responses");
    expect(forwardedRequest.headers.get("authorization")).toBe("Bearer openai-worker-secret");
    expect(forwardedRequest.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwardedRequest.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwardedRequest.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(forwardedRequest.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    expect(forwardedRequest.headers.has("cookie")).toBe(false);
    expect(forwardedRequest.headers.has("openai-organization")).toBe(false);
    expect(forwardedRequest.headers.has("openai-project")).toBe(false);
    expect(forwardedRequest.headers.has("proxy-authorization")).toBe(false);
    expect(forwardedRequest.headers.has("x-api-key")).toBe(false);
  });

  it("injects OpenAI authorization for Responses WebSocket upgrades without body diagnostics", async () => {
    const waitUntil = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          ...OPENAI_WEBSOCKET_HANDSHAKE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        HOSTED_LOG_FINGERPRINT_SECRET: "diagnostic-fingerprint-secret",
        OPENAI_API_KEY: "openai-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "member_123--v-version_1", waitUntil },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    expect(waitUntil).not.toHaveBeenCalled();
    const forwardedRequest = readForwardedRequest(fetchMock);
    expect(forwardedRequest.method).toBe("GET");
    expect(forwardedRequest.url).toBe("https://api.openai.com/v1/responses");
    expect(forwardedRequest.headers.get("authorization")).toBe("Bearer openai-worker-secret");
    expect(forwardedRequest.headers.get("connection")).toBe("keep-alive, Upgrade");
    expect(forwardedRequest.headers.get("sec-websocket-key")).toBe("dGhlIHNhbXBsZSBub25jZQ==");
    expect(forwardedRequest.headers.get("sec-websocket-version")).toBe("13");
    expect(forwardedRequest.headers.get("upgrade")).toBe("websocket");
    expect(forwardedRequest.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwardedRequest.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwardedRequest.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(forwardedRequest.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("rejects OpenAI credential injection without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: {
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects OpenAI credential injection outside the canonical HTTPS origin", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    for (const url of [
      "http://api.openai.com/v1/responses",
      "https://api.openai.com:444/v1/responses",
    ]) {
      const response = await hostedRunnerIntercept(
        new Request(url, {
          headers: {
            ...BOUND_USER_WRITE_FENCE_HEADERS,
            authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
          },
          method: "POST",
        }),
        createInterceptEnv({
          OPENAI_API_KEY: "openai-worker-secret",
          validateRuntimeWriteFence,
        }),
        { containerId: "opaque-container-id" },
      );

      expect(response.status).toBe(403);
    }
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects OpenAI provider egress without the sentinel bearer token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows the observed OpenAI models read path", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/models", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        HOSTED_LOG_FINGERPRINT_SECRET: "diagnostic-fingerprint-secret",
        OPENAI_API_KEY: "openai-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.openai.com/v1/models");
    const authorization = forwarded.headers.get("authorization");
    expect(authorization?.startsWith("Bearer ")).toBe(true);
    expect(authorization?.slice("Bearer ".length)).toBe("openai-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
  });

  it("injects OpenAI authorization for Codex auto-compaction requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses/compact", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = findFetchCall(fetchMock, "api.openai.com")?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    const forwardedRequest = forwarded as Request;
    expect(forwardedRequest.url).toBe("https://api.openai.com/v1/responses/compact");
    expect(forwardedRequest.headers.get("authorization")).toBe("Bearer openai-worker-secret");
    expect(forwardedRequest.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwardedRequest.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwardedRequest.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(forwardedRequest.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("records OpenAI cache diagnostics as redacted metadata when background work is available", async () => {
    const waitUntilPromises: Promise<unknown>[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (target) => {
      const url = new URL(readFetchTargetUrl(target));
      if (url.hostname === "web.example.test") {
        return new Response(JSON.stringify({ loggedCount: 1 }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      return new Response("ok");
    });
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const syntheticCacheNamespace = "cache-namespace-synthetic-1234567890";
    const syntheticPreviousResponse = "response-synthetic-1234567890";
    const syntheticHiddenText = "synthetic-hidden-user-content-marker";
    const syntheticStablePrefix = "synthetic-stable-cache-prefix-segment ".repeat(240);
    const requestBody = {
      include: ["reasoning.encrypted_content"],
      input: [{
        content: [{
          text: `${syntheticStablePrefix}${syntheticHiddenText}`,
          type: "input_text",
        }],
        role: "user",
      }],
      instructions: `synthetic instructions ${syntheticStablePrefix}`,
      model: "gpt-5.5",
      previous_response_id: syntheticPreviousResponse,
      prompt_cache_key: syntheticCacheNamespace,
      prompt_cache_retention: "24h",
      store: true,
      stream: true,
      tools: [{ type: "web_search_preview" }],
    };

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        body: JSON.stringify(requestBody),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        HOSTED_LOG_FINGERPRINT_SECRET: "diagnostic-fingerprint-secret",
        OPENAI_API_KEY: "openai-worker-secret",
        validateRuntimeWriteFence,
      }),
      {
        containerId: "opaque-container-id",
        waitUntil: (promise) => {
          waitUntilPromises.push(Promise.resolve(promise));
        },
      },
    );

    expect(response.status).toBe(200);
    await Promise.all(waitUntilPromises);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });

    const upstreamCall = findFetchCall(fetchMock, "api.openai.com");
    expect(upstreamCall).toBeDefined();
    const upstreamRequest = upstreamCall?.[0];
    expect(upstreamRequest).toBeInstanceOf(Request);
    expect((upstreamRequest as Request).method).toBe("POST");
    expect((upstreamRequest as Request).url).toBe("https://api.openai.com/v1/responses");
    expect((upstreamRequest as Request).headers.get("content-type"))
      .toBe("application/json; charset=utf-8");
    expect((upstreamRequest as Request).headers.get("authorization"))
      .toBe("Bearer openai-worker-secret");
    await expect((upstreamRequest as Request).clone().json()).resolves.toEqual(requestBody);

    const runtimeLogCall = findFetchCall(fetchMock, "web.example.test");
    expect(runtimeLogCall).toBeDefined();
    const runtimeLogBody = JSON.parse(String(runtimeLogCall?.[1]?.body ?? "{}")) as {
      entries?: Array<{
        attemptId?: string;
        component?: string;
        eventCode?: string;
        leaseGeneration?: string;
        level?: string;
        phase?: string;
        redactedJson?: Record<string, unknown>;
        workspaceVersion?: string;
      }>;
    };
    const entry = runtimeLogBody.entries?.[0];
    expect(parseHostedRuntimeLogRequest(runtimeLogBody).entries).toHaveLength(1);
    if (entry?.redactedJson) {
      parseDiagnosticRuntimeLog(entry.redactedJson);
    }
    expect(entry).toEqual(expect.objectContaining({
      attemptId: "attempt_1",
      component: "runner",
      eventCode: HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE,
      leaseGeneration: "7",
      level: "debug",
      phase: "fetch",
      workspaceVersion: "4",
    }));
    expect(entry?.redactedJson).toEqual(expect.objectContaining({
      cacheNamespacePresent: true,
      cacheRetentionKind: "24h",
      endpointKind: "responses",
      fingerprintKind: "hmac-sha256",
      inputCount: 1,
      inputFingerprintPresent: true,
      inputItemRoleCounts: [1],
      inputItemRoleKinds: ["user"],
      inputItemTypeCounts: [1],
      inputItemTypeBytes: [testJsonByteLength(requestBody.input[0])],
      inputItemTypeKinds: ["missing"],
      inputLargestItemIndex: 0,
      inputLargestItemKinds: ["type:missing", "role:user"],
      inputLargestItemReverseIndex: 0,
      inputNestedMetricCounts: [1, 0, 3],
      inputNestedMetricKinds: ["content", "output", "string"],
      inputTailItemCount: 1,
      inputTailItemFingerprintPresent: true,
      inputTailItemIndexes: [0],
      inputTailItemReverseIndexes: [0],
      inputTailItemRoleKinds: ["user"],
      inputTailItemTypeKinds: ["missing"],
      inputType: "array",
      jsonType: "object",
      jsonValid: true,
      methodKind: "POST",
      modelKind: "gpt-5.5",
      previousResponsePresent: true,
      providerKind: "openai",
      requestFingerprintPresent: true,
      streamPresent: true,
      toolCount: 1,
    }));
    expect(entry?.redactedJson?.inputLargestItemBytes)
      .toBe(testJsonByteLength(requestBody.input[0]));
    expect(entry?.redactedJson?.inputNestedMetricBytes).toEqual([
      testJsonByteLength(requestBody.input[0].content),
      0,
      testByteLength(`${syntheticStablePrefix}${syntheticHiddenText}`)
        + testByteLength("input_text")
        + testByteLength("user"),
    ]);
    expect(entry?.redactedJson?.inputTailItemBytes).toEqual([
      testJsonByteLength(requestBody.input[0]),
    ]);
    expect(entry?.redactedJson?.inputTailItemContentBytes).toEqual([
      testJsonByteLength(requestBody.input[0].content),
    ]);
    expect(entry?.redactedJson?.inputTailItemOutputBytes).toEqual([0]);
    expect(entry?.redactedJson?.inputTailItemStringBytes).toEqual([
      testByteLength(`${syntheticStablePrefix}${syntheticHiddenText}`)
        + testByteLength("input_text")
        + testByteLength("user"),
    ]);
    expect(Object.keys(entry?.redactedJson ?? {}).length).toBeLessThanOrEqual(64);
    expect(entry?.redactedJson?.cacheNamespaceFingerprint).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
    expect(entry?.redactedJson?.previousResponseFingerprint).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
    expect(entry?.redactedJson?.requestPrefixFingerprints).toEqual(
      expect.arrayContaining([expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/u)]),
    );
    expect(entry?.redactedJson?.inputPrefixFingerprints).toEqual(
      expect.arrayContaining([expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/u)]),
    );
    expect(entry?.redactedJson?.inputTailItemFingerprints).toEqual([
      expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/u),
    ]);

    const runtimeLogJson = JSON.stringify(runtimeLogBody);
    expect(runtimeLogJson).not.toContain(syntheticCacheNamespace);
    expect(runtimeLogJson).not.toContain(syntheticPreviousResponse);
    expect(runtimeLogJson).not.toContain(syntheticHiddenText);
    expect(runtimeLogJson).not.toContain("synthetic-stable-cache-prefix-segment");
    expect(runtimeLogJson).not.toContain("diagnostic-fingerprint-secret");
    expect(runtimeLogJson).not.toContain("openai-worker-secret");
    expect(runtimeLogJson).not.toContain(HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL);
    expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls))
      .not.toContain(syntheticHiddenText);
  });

  it("records OpenAI cache diagnostics when background work is unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (target) => {
      const url = new URL(readFetchTargetUrl(target));
      if (url.hostname === "web.example.test") {
        return new Response(JSON.stringify({ loggedCount: 1 }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      return new Response("ok");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        body: JSON.stringify({
          input: "hello",
          model: "gpt-5.5",
          prompt_cache_retention: "24h",
          stream: true,
        }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        HOSTED_LOG_FINGERPRINT_SECRET: "diagnostic-fingerprint-secret",
        OPENAI_API_KEY: "openai-worker-secret",
        validateRuntimeWriteFence: async () => true,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(findFetchCall(fetchMock, "api.openai.com")).toBeDefined();
    const runtimeLogCall = findFetchCall(fetchMock, "web.example.test");
    expect(runtimeLogCall).toBeDefined();
    const runtimeLogBody = JSON.parse(String(runtimeLogCall?.[1]?.body ?? "{}")) as {
      entries?: Array<{
        eventCode?: string;
        redactedJson?: Record<string, unknown>;
      }>;
    };
    expect(runtimeLogBody.entries?.[0]).toEqual(expect.objectContaining({
      eventCode: HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE,
      redactedJson: expect.objectContaining({
        endpointKind: "responses",
        fingerprintKind: "hmac-sha256",
        inputFingerprintPresent: false,
        requestFingerprintPresent: false,
      }),
    }));
    const captureCall = mocks.emitHostedExecutionStructuredLog.mock.calls.find(([entry]) =>
      entry.message === "Hosted runner OpenAI cache diagnostic captured."
    );
    expect(captureCall?.[0].details).toEqual(expect.objectContaining({
      runtimeLogScheduled: false,
    }));
  });

  it("summarizes OpenAI input shape with bounded metadata", async () => {
    const largestText = "hello 💚 ".repeat(10);
    const input = [
      {
        content: [{ text: largestText, type: "input_text" }],
        role: "user",
        type: "message",
      },
      {
        output: "tool result",
        role: "assistant",
        type: "function_call",
      },
      {
        content: "hidden",
        role: "banana",
        type: "unexpected_call",
      },
      {
        role: "",
        type: "  ",
      },
      "plain input",
    ] as const;
    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input,
        model: "gpt-5.5",
      })),
    });

    expect(diagnostic).toEqual(expect.objectContaining({
      inputCount: 5,
      inputItemRoleCounts: [1, 2, 1, 1],
      inputItemRoleKinds: ["assistant", "missing", "other", "user"],
      inputItemTypeCounts: [1, 1, 2, 1],
      inputItemTypeBytes: [
        testJsonByteLength(input[1]),
        testJsonByteLength(input[0]),
        testJsonByteLength(input[3]) + testJsonByteLength(input[4]),
        testJsonByteLength(input[2]),
      ],
      inputItemTypeKinds: ["function_call", "message", "missing", "other"],
      inputFunctionCallBytes: [testJsonByteLength(input[1])],
      inputFunctionCallNameCounts: [1],
      inputFunctionCallNameKinds: ["unknown"],
      inputLargestItemBytes: testJsonByteLength(input[0]),
      inputLargestItemIndex: 0,
      inputLargestItemKinds: ["type:message", "role:user"],
      inputLargestItemReverseIndex: 4,
      inputNestedMetricCounts: [2, 1, 13],
      inputNestedMetricKinds: ["content", "output", "string"],
      inputNestedMetricBytes: [
        testJsonByteLength(input[0].content) + testJsonByteLength(input[2].content),
        testJsonByteLength(input[1].output),
        [
          "message",
          "user",
          "input_text",
          largestText,
          "function_call",
          "assistant",
          "tool result",
          "unexpected_call",
          "banana",
          "hidden",
          "  ",
          "",
          "plain input",
        ].reduce((total, value) => total + testByteLength(value), 0),
      ],
      inputTailItemBytes: input.map((item) => testJsonByteLength(item)),
      inputTailItemContentBytes: [
        testJsonByteLength(input[0].content),
        0,
        testJsonByteLength(input[2].content),
        0,
        0,
      ],
      inputTailItemCount: 5,
      inputTailItemFingerprintPresent: false,
      inputTailItemFunctionNameKinds: ["none", "unknown", "none", "none", "none"],
      inputTailItemIndexes: [0, 1, 2, 3, 4],
      inputTailItemOutputBytes: [
        0,
        testJsonByteLength(input[1].output),
        0,
        0,
        0,
      ],
      inputTailItemReverseIndexes: [4, 3, 2, 1, 0],
      inputTailItemRoleKinds: ["user", "assistant", "other", "missing", "missing"],
      inputTailItemStringBytes: [
        [
          "message",
          "user",
          "input_text",
          largestText,
        ].reduce((total, value) => total + testByteLength(value), 0),
        [
          "function_call",
          "assistant",
          "tool result",
        ].reduce((total, value) => total + testByteLength(value), 0),
        [
          "unexpected_call",
          "banana",
          "hidden",
        ].reduce((total, value) => total + testByteLength(value), 0),
        [
          "  ",
          "",
        ].reduce((total, value) => total + testByteLength(value), 0),
        testByteLength("plain input"),
      ],
      inputTailItemTypeKinds: ["message", "function_call", "other", "missing", "missing"],
    }));
  });

  it("attributes OpenAI function-call-output bytes without raw output or call IDs", async () => {
    const matchedOutput = {
      call_id: "call_private_1",
      output: "synthetic-sensitive-tool-output ".repeat(20),
      type: "function_call_output",
    };
    const unsafeNameOutput = {
      call_id: "call_private_2",
      output: {
        rows: ["small synthetic row"],
      },
      type: "function_call_output",
    };
    const exactNameOutput = {
      call_id: "call_private_3",
      output: "exact-name synthetic output",
      type: "function_call_output",
    };
    const unmatchedOutput = {
      call_id: "call_private_4",
      output: "orphan synthetic output",
      type: "function_call_output",
    };
    const input = [
      {
        arguments: "synthetic-sensitive-function-arguments",
        call_id: "call_private_1",
        name: "local_shell",
        type: "function_call",
      },
      matchedOutput,
      {
        arguments: "synthetic-unsafe-function-arguments",
        call_id: "call_private_2",
        name: "private/tool-name",
        type: "function_call",
      },
      unsafeNameOutput,
      {
        arguments: "synthetic-exact-function-arguments",
        call_id: "call_private_3",
        name: "mcp__dbhub_query",
        type: "function_call",
      },
      exactNameOutput,
      unmatchedOutput,
      {
        content: "synthetic-private-message",
        role: "user",
        type: "message",
      },
    ] as const;

    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input,
        model: "gpt-5.5",
      })),
    });

    expect(diagnostic).toEqual(expect.objectContaining({
      inputFunctionCallBytes: [
        testJsonByteLength(input[0]),
        testJsonByteLength(input[4]),
        testJsonByteLength(input[2]),
      ],
      inputFunctionCallNameCounts: [1, 1, 1],
      inputFunctionCallNameKinds: ["local_shell", "mcp__dbhub_query", "other"],
      inputFunctionOutputBytes: [
        testJsonByteLength(matchedOutput.output),
        testJsonByteLength(exactNameOutput.output),
        testJsonByteLength(unsafeNameOutput.output),
        testJsonByteLength(unmatchedOutput.output),
      ],
      inputFunctionOutputNameCounts: [1, 1, 1, 1],
      inputFunctionOutputNameKinds: ["local_shell", "mcp__dbhub_query", "other", "unknown"],
      inputLargestFunctionOutputBytes: testJsonByteLength(matchedOutput.output),
      inputLargestFunctionOutputIndex: 1,
      inputLargestFunctionOutputNameKind: "local_shell",
      inputLargestFunctionOutputReverseIndex: 6,
      inputTailItemFunctionNameKinds: [
        "local_shell",
        "local_shell",
        "other",
        "other",
        "mcp__dbhub_query",
        "mcp__dbhub_query",
        "unknown",
        "none",
      ],
    }));
    parseDiagnosticRuntimeLog(diagnostic);

    const diagnosticJson = JSON.stringify(diagnostic);
    expect(diagnosticJson).not.toContain("call_private");
    expect(diagnosticJson).not.toContain("synthetic-sensitive-tool-output");
    expect(diagnosticJson).not.toContain("synthetic-sensitive-function-arguments");
    expect(diagnosticJson).not.toContain("synthetic-unsafe-function-arguments");
    expect(diagnosticJson).not.toContain("synthetic-exact-function-arguments");
    expect(diagnosticJson).not.toContain("synthetic-private-message");
    expect(diagnosticJson).not.toContain("private/tool-name");
  });

  it("uses safe deterministic function-call categories for unusual call IDs", async () => {
    const sensitiveLookingName = ["sk", "live", "SYNTHETIC123"].join("_");
    const earlyOutput = {
      call_id: "call_late",
      output: "early synthetic output",
      type: "function_call_output",
    };
    const sensitiveNameOutput = {
      call_id: "call_sensitive",
      output: "sensitive-name synthetic output",
      type: "function_call_output",
    };
    const duplicateOutput = {
      call_id: "call_duplicate",
      output: "duplicate synthetic output",
      type: "function_call_output",
    };
    const input = [
      earlyOutput,
      {
        arguments: "late synthetic arguments",
        call_id: "call_late",
        name: "exec_command",
        type: "function_call",
      },
      {
        arguments: "sensitive-name synthetic arguments",
        call_id: "call_sensitive",
        name: sensitiveLookingName,
        type: "function_call",
      },
      sensitiveNameOutput,
      {
        arguments: "first duplicate synthetic arguments",
        call_id: "call_duplicate",
        name: "exec_command",
        type: "function_call",
      },
      {
        arguments: "second duplicate synthetic arguments",
        call_id: "call_duplicate",
        name: "local_shell",
        type: "function_call",
      },
      duplicateOutput,
    ] as const;

    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input,
        model: "gpt-5.5",
      })),
    });

    expect(diagnostic).toEqual(expect.objectContaining({
      inputFunctionCallBytes: [
        testJsonByteLength(input[4]) + testJsonByteLength(input[5]),
        testJsonByteLength(input[1]),
        testJsonByteLength(input[2]),
      ],
      inputFunctionCallNameCounts: [2, 1, 1],
      inputFunctionCallNameKinds: ["duplicate", "exec_command", "other"],
      inputFunctionOutputBytes: [
        testJsonByteLength(duplicateOutput.output),
        testJsonByteLength(earlyOutput.output),
        testJsonByteLength(sensitiveNameOutput.output),
      ],
      inputFunctionOutputNameCounts: [1, 1, 1],
      inputFunctionOutputNameKinds: ["duplicate", "exec_command", "other"],
      inputTailItemFunctionNameKinds: [
        "exec_command",
        "exec_command",
        "other",
        "other",
        "duplicate",
        "duplicate",
        "duplicate",
      ],
    }));
    parseDiagnosticRuntimeLog(diagnostic);

    const diagnosticJson = JSON.stringify(diagnostic);
    expect(diagnosticJson).not.toContain("call_late");
    expect(diagnosticJson).not.toContain("call_sensitive");
    expect(diagnosticJson).not.toContain("call_duplicate");
    expect(diagnosticJson).not.toContain(sensitiveLookingName);
    expect(diagnosticJson).not.toContain("synthetic output");
    expect(diagnosticJson).not.toContain("synthetic arguments");
  });

  it("bounds OpenAI input tail diagnostics to the last eight items", async () => {
    const input = Array.from({ length: 10 }, (_, index) => ({
      content: `private-tail-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      type: "message",
    }));

    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input,
        model: "gpt-5.5",
      })),
    });
    const expectedTail = input.slice(2);

    expect(diagnostic).toEqual(expect.objectContaining({
      inputCount: 10,
      inputTailItemCount: 8,
      inputTailItemFingerprintPresent: false,
      inputTailItemIndexes: [2, 3, 4, 5, 6, 7, 8, 9],
      inputTailItemOutputBytes: [0, 0, 0, 0, 0, 0, 0, 0],
      inputTailItemReverseIndexes: [7, 6, 5, 4, 3, 2, 1, 0],
      inputTailItemRoleKinds: [
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
      ],
      inputTailItemTypeKinds: [
        "message",
        "message",
        "message",
        "message",
        "message",
        "message",
        "message",
        "message",
      ],
    }));
    expect(diagnostic.inputTailItemBytes).toEqual(
      expectedTail.map((item) => testJsonByteLength(item)),
    );
    expect(diagnostic.inputTailItemContentBytes).toEqual(
      expectedTail.map((item) => testJsonByteLength(item.content)),
    );
    expect(diagnostic.inputTailItemStringBytes).toEqual(
      expectedTail.map((item) =>
        testByteLength(item.content) + testByteLength(item.role) + testByteLength(item.type)
      ),
    );
    expect(JSON.stringify(diagnostic)).not.toContain("private-tail-0");
    expect(JSON.stringify(diagnostic)).not.toContain("private-tail-9");
  });

  it("keeps maximal OpenAI input classification diagnostics runtime-log safe", async () => {
    const input = [
      "computer_call",
      "computer_call_output",
      "file_search_call",
      "function_call",
      "function_call_output",
      "image_generation_call",
      "local_shell_call",
      "local_shell_call_output",
      "message",
      "reasoning",
      "web_search_call",
    ].map((type) => ({ role: "user", type }));
    input.push(
      { role: "assistant", type: "message" },
      { role: "developer", type: "message" },
      { role: "system", type: "message" },
      { role: "tool", type: "message" },
      { role: "unknown_role", type: "unknown_type" },
      { role: "", type: "" },
    );

    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input,
        model: "gpt-5.5",
      })),
    });

    expect(diagnostic.inputItemTypeKinds).toHaveLength(13);
    expect(diagnostic.inputItemRoleKinds).toHaveLength(7);
    parseDiagnosticRuntimeLog(diagnostic);
  });

  it("bounds OpenAI input shape traversal for deeply nested requests", async () => {
    const nestedJson = `${"[".repeat(10_000)}"leaf"${"]".repeat(10_000)}`;

    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(
        `{"input":[${nestedJson}],"model":"gpt-5.5"}`,
      ),
    });

    expect(diagnostic).toEqual(expect.objectContaining({
      inputCount: 1,
      inputLargestItemBytes: 0,
      inputShapeTraversalTruncated: true,
      jsonValid: true,
    }));
    expect(diagnostic.inputBytes).toBeUndefined();
  });

  it("builds bounded OpenAI cache diagnostics for degraded request bodies", async () => {
    const smallBody = JSON.stringify({
      input: "hello",
      model: "tenant-private-model-123",
      prompt_cache_key: "cache-namespace-synthetic-1234567890",
      prompt_cache_retention: "24h",
    });
    const smallDiagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: new TextEncoder().encode(smallBody),
    });

    expect(smallDiagnostic).toEqual(expect.objectContaining({
      cacheNamespaceFingerprintPresent: false,
      cacheNamespacePresent: true,
      fingerprintKind: "none",
      inputFingerprintPresent: false,
      jsonType: "object",
      jsonValid: true,
      modelKind: "other",
      requestFingerprintPresent: false,
    }));
    expect(smallDiagnostic.inputItemTypeKinds).toBeUndefined();
    expect(smallDiagnostic.inputItemRoleKinds).toBeUndefined();
    expect(smallDiagnostic.inputNestedMetricBytes).toBeUndefined();
    expect(smallDiagnostic.inputLargestItemBytes).toBeUndefined();
    expect(JSON.stringify(smallDiagnostic)).not.toContain("tenant-private-model-123");
    expect(JSON.stringify(smallDiagnostic)).not.toContain("cache-namespace-synthetic");

    const invalidDiagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      fingerprintSecret: "diagnostic-fingerprint-secret",
      method: "POST",
      requestBytes: new TextEncoder().encode("{"),
    });

    expect(invalidDiagnostic).toEqual(expect.objectContaining({
      fingerprintKind: "hmac-sha256",
      jsonType: "invalid",
      jsonValid: false,
      requestFingerprintPresent: false,
    }));

    const tooLargeBody = JSON.stringify({
      input: "x".repeat(6 * 1024 * 1024),
      model: "gpt-5.5",
    });
    const tooLargeDiagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      fingerprintSecret: "diagnostic-fingerprint-secret",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(tooLargeBody),
    });

    expect(tooLargeDiagnostic).toEqual(expect.objectContaining({
      fingerprintKind: "hmac-sha256",
      jsonSkippedReasonKind: "too_large",
      jsonType: "unknown",
      jsonValid: false,
      requestFingerprintPresent: false,
      requestFullFingerprintSkipped: true,
      requestPrefixLengths: [8 * 1024, 32 * 1024, 128 * 1024],
    }));
    expect(tooLargeDiagnostic.requestPrefixFingerprints).toEqual(
      expect.arrayContaining([expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/u)]),
    );
    expect(tooLargeDiagnostic.inputType).toBeUndefined();
    expect(tooLargeDiagnostic.inputNestedMetricBytes).toBeUndefined();
  });

  it("rejects OpenAI paths outside the explicit hosted runner policy", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/chat/completions", {
        body: JSON.stringify({ messages: [] }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...WRITE_FENCE_HEADERS,
        },
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects wrong OpenAI methods on otherwise allowed paths", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
        method: "GET",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects incomplete OpenAI Responses WebSocket upgrade requests", async () => {
    const cases: Array<{
      headers: Record<string, string>;
      name: string;
    }> = [
      {
        name: "missing connection upgrade",
        headers: {
          ...OPENAI_WEBSOCKET_HANDSHAKE_HEADERS,
          connection: "keep-alive",
        },
      },
      {
        name: "missing websocket version",
        headers: {
          connection: "Upgrade",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          upgrade: "websocket",
        },
      },
      {
        name: "invalid websocket key",
        headers: {
          ...OPENAI_WEBSOCKET_HANDSHAKE_HEADERS,
          "sec-websocket-key": "not-a-valid-websocket-key",
        },
      },
    ];

    for (const testCase of cases) {
      const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
      vi.stubGlobal("fetch", fetchMock);
      const validateRuntimeWriteFence = vi.fn(async () => true);

      const response = await hostedRunnerIntercept(
        new Request("https://api.openai.com/v1/responses", {
          headers: {
            ...BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
            ...testCase.headers,
          },
          method: "GET",
        }),
        createInterceptEnv({
          OPENAI_API_KEY: "openai-worker-secret",
          validateRuntimeWriteFence,
        }),
        { containerId: "opaque-container-id" },
      );

      expect(response.status, testCase.name).toBe(403);
      expect(validateRuntimeWriteFence, testCase.name).not.toHaveBeenCalled();
      expect(fetchMock, testCase.name).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it("injects Mapbox access tokens only for allowed read-only GET path families with an active write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => {
      throw new Error("Mapbox without authority headers should use the active write fence.");
    });
    const validateActiveRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request(
        `https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4?access_token=${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        {
          headers: {
            authorization: "Bearer user-supplied-mapbox-token",
            cookie: "session=user-supplied-cookie",
            "proxy-authorization": "Bearer user-supplied-proxy-token",
            "x-api-key": "user-supplied-api-key",
          },
          method: "GET",
        },
      ),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
        validateActiveRuntimeWriteFence,
        validateRuntimeWriteFence,
      }),
      { containerId: "member_123" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(validateActiveRuntimeWriteFence).toHaveBeenCalledWith({
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    const forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.origin).toBe("https://api.mapbox.com");
    expect(forwardedUrl.pathname).toBe("/directions/v5/mapbox/walking/1,2;3,4");
    expect(forwardedUrl.searchParams.get("access_token")).toBe("mapbox-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    expect(forwarded.headers.has("authorization")).toBe(false);
    expect(forwarded.headers.has("cookie")).toBe(false);
    expect(forwarded.headers.has("proxy-authorization")).toBe(false);
    expect(forwarded.headers.has("x-api-key")).toBe(false);
  });

  it("rejects Mapbox token injection without an active write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateActiveRuntimeWriteFence = vi.fn(async () => false);

    const response = await hostedRunnerIntercept(
      new Request(
        `https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4?access_token=${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        { method: "GET" },
      ),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
        validateActiveRuntimeWriteFence,
      }),
      { containerId: "member_123" },
    );

    expect(response.status).toBe(401);
    expect(validateActiveRuntimeWriteFence).toHaveBeenCalledWith({
      userId: "member_123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "directions",
      path: "/directions/v5/mapbox/walking/1,2;3,4",
    },
    {
      name: "geocoding",
      path: "/search/geocode/v6/forward",
    },
    {
      name: "searchbox",
      path: "/search/searchbox/v1/forward",
    },
    {
      name: "terrain tilequery",
      path: "/v4/mapbox.mapbox-terrain-v2/tilequery/1,2.json",
    },
  ] as const)("allows required Mapbox runtime route family: $name", async ({ path }) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const requestUrl = new URL(`https://api.mapbox.com${path}`);
    requestUrl.searchParams.set("access_token", HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL);

    const response = await hostedRunnerIntercept(
      new Request(requestUrl, {
        headers: {
          authorization: "Bearer user-supplied-mapbox-token",
          ...BOUND_USER_WRITE_FENCE_HEADERS,
        },
        method: "GET",
      }),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    const forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.origin).toBe("https://api.mapbox.com");
    expect(forwardedUrl.pathname).toBe(path);
    expect(forwardedUrl.searchParams.get("access_token")).toBe("mapbox-worker-secret");
    expect(forwarded.headers.has("authorization")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("still requires the Mapbox sentinel before injecting the Worker token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request(
        "https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4?access_token=user-token",
        {
          method: "GET",
        },
      ),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Mapbox token injection outside the canonical HTTPS origin", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    for (const url of [
      `http://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4?access_token=${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
      `https://api.mapbox.com:444/directions/v5/mapbox/walking/1,2;3,4?access_token=${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
    ]) {
      const response = await hostedRunnerIntercept(
        new Request(url, {
          headers: BOUND_USER_WRITE_FENCE_HEADERS,
          method: "GET",
        }),
        createInterceptEnv({
          MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
          validateRuntimeWriteFence,
        }),
        { containerId: "opaque-container-id" },
      );

      expect(response.status).toBe(403);
    }
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Mapbox provider egress without the sentinel query parameter", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4", {
        headers: WRITE_FENCE_HEADERS,
        method: "GET",
      }),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Mapbox provider egress outside the explicit allowed path prefixes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request(
        `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        {
          method: "GET",
        },
      ),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-GET Mapbox requests on otherwise allowed path families", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4", {
        body: JSON.stringify({ coordinates: [] }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...WRITE_FENCE_HEADERS,
        },
        method: "POST",
      }),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("strips runtime authority headers and sensitive path metadata from open-internet passthrough egress", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://unexpected.example.test/path/member_123/private-token", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({}),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://unexpected.example.test/path/member_123/private-token");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          host: "unexpected.example.test",
          method: "POST",
          policy: "open_internet_passthrough",
          userIdPresent: true,
        },
        message: "Hosted runner open-internet passthrough forwarded outbound request.",
      }),
    );
    expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls)).not.toContain(
      "member_123",
    );
  });

  it.each([
    {
      host: "api.us.junction.com",
      path: "/v1/sync",
    },
    {
      host: "api.eu.junction.com",
      path: "/v1/sync",
    },
    {
      host: "api.ouraring.com",
      path: "/v2/usercollection/personal_info",
    },
    {
      host: "cloud.ouraring.com",
      path: "/oauth/token",
    },
    {
      host: "api.prod.whoop.com",
      path: "/developer/v1/user/profile/basic",
    },
    {
      host: "www.strava.com",
      path: "/api/v3/athlete",
    },
  ] as const)("does not reject hosted device-sync provider egress for $host", async ({ host, path }) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request(`https://${host}${path}`, {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: "Bearer device-provider-token",
          "x-api-key": "device-provider-api-key",
        },
        method: "GET",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
        OPENAI_API_KEY: "openai-worker-secret",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe(`https://${host}${path}`);
    expect(forwarded.headers.get("authorization")).toBe("Bearer device-provider-token");
    expect(forwarded.headers.get("x-api-key")).toBe("device-provider-api-key");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    const forwardedHeaderParts: string[] = [];
    forwarded.headers.forEach((value, name) => {
      forwardedHeaderParts.push(name, value);
    });
    const forwardedSerialized = [forwarded.url, ...forwardedHeaderParts].join("\n");
    expect(forwardedSerialized).not.toContain("linq-worker-secret");
    expect(forwardedSerialized).not.toContain("mapbox-worker-secret");
    expect(forwardedSerialized).not.toContain("openai-worker-secret");
    expect(forwardedSerialized).not.toContain("telegram-worker-secret");
    expect(forwardedSerialized).not.toContain("whatsapp-worker-secret");
    expect(forwardedSerialized).not.toContain("phone_123");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          host,
          method: "GET",
          policy: "open_internet_passthrough",
          userIdPresent: true,
        },
        message: "Hosted runner open-internet passthrough forwarded outbound request.",
      }),
    );
  });

  it("requires the active write fence before injecting Linq credentials for sends", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("requires the active write fence before injecting Linq credentials for reads", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      phone_numbers: [],
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/phone_numbers", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.linqapp.com/api/partner/v3/phone_numbers");
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("requires the active write fence before injecting Linq credentials for attachment metadata reads", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/attachments/attachment_metadata_1", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe(
      "https://api.linqapp.com/api/partner/v3/attachments/attachment_metadata_1",
    );
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it.each([
    {
      name: "phone number probe",
      method: "GET",
      path: "/phone_numbers",
      responseBody: JSON.stringify({ phone_numbers: [] }),
    },
    {
      name: "attachment metadata",
      method: "GET",
      path: "/attachments/attachment_metadata_1",
      responseBody: "{}",
    },
    {
      body: {
        from: "+15550000000",
        message: { parts: [{ type: "text", value: "hello" }] },
        to: ["+15550000001"],
      },
      method: "POST",
      name: "chat creation",
      path: "/chats",
    },
    {
      body: {
        message: { parts: [{ type: "text", value: "hello" }] },
      },
      method: "POST",
      name: "chat message send",
      path: "/chats/chat_1/messages",
    },
    {
      method: "POST",
      name: "typing start",
      path: "/chats/chat_1/typing",
    },
    {
      method: "POST",
      name: "read receipt",
      path: "/chats/chat_1/read",
    },
    {
      method: "DELETE",
      name: "typing stop",
      path: "/chats/chat_1/typing",
    },
    {
      method: "DELETE",
      name: "message cleanup",
      path: "/messages/message_1",
    },
  ] as const)("allows required Linq runtime route: $name", async (route) => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(route.responseBody ?? "ok", {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const body = "body" in route ? JSON.stringify(route.body) : undefined;

    const response = await hostedRunnerIntercept(
      new Request(`https://api.linqapp.com/api/partner/v3${route.path}`, {
        ...(body ? { body } : {}),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        method: route.method,
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.method).toBe(route.method);
    expect(forwarded.url).toBe(`https://api.linqapp.com/api/partner/v3${route.path}`);
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("honors configured Linq base URL pathname prefixes before validating allowed suffixes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://linq.example.test/custom/tenant/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://linq.example.test/custom/tenant/v3/",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://linq.example.test/custom/tenant/v3/chats/chat_1/messages");
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
  });

  it("preserves the hosted-local container host alias for configured Linq origins", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://host.docker.internal:4011/chats", {
        body: JSON.stringify({
          from: "+15550000000",
          message: { parts: [{ type: "text", value: "hello" }] },
          to: ["+15550000001"],
        }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
          "content-type": "application/json",
        },
        method: "POST",
      }),
      createInterceptEnv({
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "host.docker.internal",
        LINQ_API_BASE_URL: "http://127.0.0.1:4011",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("http://host.docker.internal:4011/chats");
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("rejects default Linq provider host egress while a custom Linq base is configured", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://linq.example.test/custom/tenant/v3",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq provider egress without the sentinel bearer token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq credential injection on a nonconfigured port for the same provider host", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://linq.example.test:444/custom/tenant/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://linq.example.test/custom/tenant/v3",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid configured Linq HTTP base hosts instead of passing them through", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://linq.example.com/custom/tenant/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "http://linq.example.com/custom/tenant/v3",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid configured Linq HTTP base hosts across trailing-dot variants", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://linq.example.com/custom/tenant/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "http://linq.example.com./custom/tenant/v3",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq provider egress for paths outside the configured base URL prefix", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://linq.example.test/api/partner/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://linq.example.test/custom/tenant/v3",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq writes without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages", {
        headers: {
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq reads without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/phone_numbers", {
        headers: {
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq attachment metadata reads without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/attachments/attachment_metadata_1", {
        headers: {
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Telegram token rewriting outside the configured provider origin", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    for (const url of [
      "http://api.telegram.org/bot__cloudflare_injected__/sendMessage",
      "https://api.telegram.org:444/bot__cloudflare_injected__/sendMessage",
    ]) {
      const response = await hostedRunnerIntercept(
        new Request(url, {
          headers: BOUND_USER_WRITE_FENCE_HEADERS,
          method: "POST",
        }),
        createInterceptEnv({
          TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
          validateRuntimeWriteFence,
        }),
        { containerId: "opaque-container-id" },
      );

      expect(response.status).toBe(403);
    }
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows explicitly configured local HTTP Telegram origins", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://127.0.0.1:4011/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_API_BASE_URL: "http://127.0.0.1:4011",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("http://127.0.0.1:4011/bottelegram-worker-secret/sendMessage");
  });

  it("preserves the hosted-local container host alias for configured Telegram origins", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://host.docker.internal:4011/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "host.docker.internal",
        TELEGRAM_API_BASE_URL: "http://127.0.0.1:4011",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe(
      "http://host.docker.internal:4011/bottelegram-worker-secret/sendMessage",
    );
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("rejects invalid configured Telegram HTTP base hosts instead of passing them through", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://telegram.example.com/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_API_BASE_URL: "http://telegram.example.com",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honors configured Telegram base URL pathname prefixes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://telegram.example.test/proxy/tenant/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_API_BASE_URL: "https://telegram.example.test/proxy/tenant/",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe(
      "https://telegram.example.test/proxy/tenant/bottelegram-worker-secret/sendMessage",
    );
  });

  it("rejects Telegram provider egress outside the configured base URL prefix", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://telegram.example.test/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_API_BASE_URL: "https://telegram.example.test/proxy/tenant",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites Telegram sentinel tokens before upstream fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/sendMessage", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: "Bearer user-supplied-telegram-token",
          cookie: "session=user-supplied-cookie",
          "proxy-authorization": "Bearer user-supplied-proxy-token",
          "x-api-key": "user-supplied-api-key",
        },
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.telegram.org/bottelegram-worker-secret/sendMessage");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    expect(forwarded.headers.has("authorization")).toBe(false);
    expect(forwarded.headers.has("cookie")).toBe(false);
    expect(forwarded.headers.has("proxy-authorization")).toBe(false);
    expect(forwarded.headers.has("x-api-key")).toBe(false);
  });

  it.each([
    {
      method: "POST",
      operation: "sendMessage",
      query: "",
    },
    {
      method: "POST",
      operation: "sendChatAction",
      query: "",
    },
    {
      method: "POST",
      operation: "deleteMessages",
      query: "",
    },
    {
      method: "POST",
      operation: "deleteBusinessMessages",
      query: "",
    },
    {
      method: "GET",
      operation: "getFile",
      query: "?file_id=file_1",
    },
  ] as const)(
    "allows required Telegram Bot API operation: $operation",
    async ({ method, operation, query }) => {
      const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
      vi.stubGlobal("fetch", fetchMock);
      const validateRuntimeWriteFence = vi.fn(async () => true);

      const response = await hostedRunnerIntercept(
        new Request(`https://api.telegram.org/bot__cloudflare_injected__/${operation}${query}`, {
          headers: BOUND_USER_WRITE_FENCE_HEADERS,
          method,
        }),
        createInterceptEnv({
          TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
          validateRuntimeWriteFence,
        }),
        { containerId: "opaque-container-id" },
      );

      expect(response.status).toBe(200);
      expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
        attemptId: "attempt_1",
        generation: "7",
        userId: "member_123",
      });
      const forwarded = readForwardedRequest(fetchMock);
      expect(forwarded.method).toBe(method);
      expect(forwarded.url).toBe(
        `https://api.telegram.org/bottelegram-worker-secret/${operation}${query}`,
      );
      expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
      expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    },
  );

  it("maps default Telegram provider host egress to the configured upstream base", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_API_BASE_URL: "https://telegram.example.test",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://telegram.example.test/bottelegram-worker-secret/sendMessage");
  });

  it("requires the active write fence before rewriting Telegram getFile", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/getFile?file_id=file_1", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "GET",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe(
      "https://api.telegram.org/bottelegram-worker-secret/getFile?file_id=file_1",
    );
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("requires the active write fence before rewriting Telegram file downloads", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/file/bot__cloudflare_injected__/photos/file_1.jpg", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: "Bearer user-supplied-telegram-token",
          cookie: "session=user-supplied-cookie",
          "x-api-key": "user-supplied-api-key",
        },
        method: "GET",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.method).toBe("GET");
    expect(forwarded.url).toBe(
      "https://api.telegram.org/file/bottelegram-worker-secret/photos/file_1.jpg",
    );
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    expect(forwarded.headers.has("authorization")).toBe(false);
    expect(forwarded.headers.has("cookie")).toBe(false);
    expect(forwarded.headers.has("x-api-key")).toBe(false);
  });

  it("maps default Telegram file downloads to the configured file upstream base", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/file/bot__cloudflare_injected__/photos/file_1.jpg", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "GET",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        TELEGRAM_FILE_BASE_URL: "https://telegram-files.example.test/files",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe(
      "https://telegram-files.example.test/files/bottelegram-worker-secret/photos/file_1.jpg",
    );
  });

  it("recognizes Telegram file downloads under the configured file base", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request(
        "https://telegram-files.example.test/files/bot__cloudflare_injected__/photos/file_1.jpg",
        {
          headers: BOUND_USER_WRITE_FENCE_HEADERS,
          method: "GET",
        },
      ),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        TELEGRAM_FILE_BASE_URL: "https://telegram-files.example.test/files",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe(
      "https://telegram-files.example.test/files/bottelegram-worker-secret/photos/file_1.jpg",
    );
  });

  it("rejects Telegram provider egress without the sentinel bot token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/botuser_supplied_token/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Telegram file downloads without the sentinel bot token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/file/botuser_supplied_token/photos/file_1.jpg", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "GET",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores malformed Linq base URL config while classifying Telegram egress", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://[",
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.telegram.org/bottelegram-worker-secret/sendMessage");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("rejects Telegram getFile without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/getFile?file_id=file_1", {
        method: "GET",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Telegram file downloads without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/file/bot__cloudflare_injected__/photos/file_1.jpg", {
        method: "GET",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites WhatsApp sentinel phone ids only for numeric graph versions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence: async () => true,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://graph.facebook.com/v25.0/phone_123/messages");
    expect(forwarded.headers.get("authorization")).toBe("Bearer whatsapp-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it.each([
    {
      name: "missing",
      headers: BOUND_USER_WRITE_FENCE_HEADERS,
    },
    {
      name: "wrong",
      headers: {
        ...BOUND_USER_WRITE_FENCE_HEADERS,
        authorization: "Bearer user-supplied-whatsapp-token",
      },
    },
  ] as const)("rejects WhatsApp provider egress with a $name access-token sentinel", async ({ headers }) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/v25.0/__cloudflare_injected__/messages", {
        headers,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects WhatsApp provider egress without the sentinel phone id", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/v25.0/phone_123/messages", {
        headers: BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects WhatsApp credential injection without an active runtime fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({}),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects WhatsApp credential injection outside the configured provider origin", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    for (const url of [
      "http://graph.facebook.com/v25.0/__cloudflare_injected__/messages",
      "https://graph.facebook.com:444/v25.0/__cloudflare_injected__/messages",
    ]) {
      const response = await hostedRunnerIntercept(
        new Request(url, {
          headers: BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
          method: "POST",
        }),
        createInterceptEnv({
          WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
          WHATSAPP_PHONE_NUMBER_ID: "phone_123",
          validateRuntimeWriteFence,
        }),
        { containerId: "opaque-container-id" },
      );

      expect(response.status).toBe(403);
    }
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows explicitly configured local HTTP WhatsApp origins", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("http://127.0.0.1:4012/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_API_BASE_URL: "http://127.0.0.1:4012",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence: async () => true,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("http://127.0.0.1:4012/v25.0/phone_123/messages");
  });

  it("rejects invalid configured WhatsApp HTTP base hosts instead of passing them through", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("http://whatsapp.example.com/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_API_BASE_URL: "http://whatsapp.example.com",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps default WhatsApp provider host egress to the configured upstream base", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_API_BASE_URL: "https://whatsapp.example.test",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://whatsapp.example.test/v25.0/phone_123/messages");
  });

  it("honors configured WhatsApp base URL pathname prefixes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://whatsapp.example.test/meta/proxy/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_API_BASE_URL: "https://whatsapp.example.test/meta/proxy/",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://whatsapp.example.test/meta/proxy/v25.0/phone_123/messages");
  });

  it("rejects WhatsApp provider egress outside the configured base URL prefix", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://whatsapp.example.test/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_API_BASE_URL: "https://whatsapp.example.test/meta/proxy",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects WhatsApp provider egress for malformed graph versions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/vbeta/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_WITH_BEARER_SENTINEL_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence: async () => true,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function createInterceptEnv(input: {
  HOSTED_EXECUTION_RUNNER_HOST_ALIAS?: string;
  HOSTED_LOG_FINGERPRINT_SECRET?: string;
  LINQ_API_BASE_URL?: string;
  LINQ_API_TOKEN?: string;
  MAPBOX_ACCESS_TOKEN?: string;
  OPENAI_API_KEY?: string;
  TELEGRAM_API_BASE_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_FILE_BASE_URL?: string;
  WHATSAPP_API_BASE_URL?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  validateRuntimeWriteFence?: (input: {
    attemptId: string;
    generation: string;
    userId: string;
  }) => Promise<boolean>;
  validateActiveRuntimeWriteFence?: (input: {
    userId: string;
  }) => Promise<boolean>;
}): RunnerOutboundEnvironmentSource {
  return {
    ...createHostedExecutionTestEnv(),
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    HOSTED_EXECUTION_RUNNER_HOST_ALIAS: input.HOSTED_EXECUTION_RUNNER_HOST_ALIAS,
    HOSTED_LOG_FINGERPRINT_SECRET: input.HOSTED_LOG_FINGERPRINT_SECRET,
    LINQ_API_BASE_URL: input.LINQ_API_BASE_URL,
    LINQ_API_TOKEN: input.LINQ_API_TOKEN,
    MAPBOX_ACCESS_TOKEN: input.MAPBOX_ACCESS_TOKEN,
    OPENAI_API_KEY: input.OPENAI_API_KEY,
    TELEGRAM_API_BASE_URL: input.TELEGRAM_API_BASE_URL,
    TELEGRAM_BOT_TOKEN: input.TELEGRAM_BOT_TOKEN,
    TELEGRAM_FILE_BASE_URL: input.TELEGRAM_FILE_BASE_URL,
    WHATSAPP_API_BASE_URL: input.WHATSAPP_API_BASE_URL,
    WHATSAPP_ACCESS_TOKEN: input.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: input.WHATSAPP_PHONE_NUMBER_ID,
    USER_RUNNER: {
      getByName: () => ({
        validateActiveRuntimeWriteFence:
          input.validateActiveRuntimeWriteFence ?? (async () => false),
        validateRuntimeWriteFence: input.validateRuntimeWriteFence ?? (async () => false),
      }),
    },
  };
}

function readForwardedRequest(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): Request {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const request = fetchMock.mock.calls[0]?.[0];
  expect(request).toBeInstanceOf(Request);
  return request as Request;
}

function findFetchCall(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  hostname: string,
): Parameters<typeof fetch> | undefined {
  return fetchMock.mock.calls.find((call) =>
    new URL(readFetchTargetUrl(call[0])).hostname === hostname
  );
}

function readFetchTargetUrl(target: Parameters<typeof fetch>[0]): string {
  if (target instanceof Request) {
    return target.url;
  }
  if (target instanceof URL) {
    return target.toString();
  }
  return String(target);
}
