import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";

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
  buildHostedExecutionRuntimePlatform,
  createCloudflareHostedProviderFetch,
  createHostedBrowserVaultReplicaWriteHeaders,
  isHostedRuntimeInternalAuthorityRejectedError,
} from "../src/runtime-platform.ts";
import {
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../src/runner-outbound/headers.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

function requireFetchCallArgs(
  call: readonly unknown[] | undefined,
  label: string,
): { init?: RequestInit; input: RequestInfo | URL } {
  if (!call) {
    throw new Error(`${label} was not called.`);
  }

  const [input, init] = call;
  if (!(input instanceof Request) && !(input instanceof URL) && typeof input !== "string") {
    throw new Error(`${label} must receive a Request, URL, or string input.`);
  }
  if (init !== undefined && (typeof init !== "object" || init === null || Array.isArray(init))) {
    throw new Error(`${label} init must be an object when provided.`);
  }

  return {
    init: init as RequestInit | undefined,
    input,
  };
}

function requireFetchRequest(call: readonly unknown[] | undefined, label: string): Request {
  const { init, input } = requireFetchCallArgs(call, label);
  return input instanceof Request ? input : new Request(input, init);
}

function createAssistantUsageRecord(): AssistantUsageRecord {
  return {
    apiKeyEnv: null,
    attemptCount: 1,
    baseUrl: null,
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: null,
    gatewayTags: [],
    inputTokens: 1,
    memberId: "member_123",
    occurredAt: "2026-04-08T10:00:00.000Z",
    outputTokens: 2,
    provider: "codex-cli",
    providerName: null,
    providerRequestId: null,
    rawUsageJson: null,
    rawUsageJsonHash: null,
    reasoningTokens: null,
    reportingUserId: null,
    requestedModel: "gpt-5.5",
    routeId: "route_usage",
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: null,
    sessionId: "session_usage",
    stripeMeterSource: "murph",
    surface: null,
    totalTokens: 3,
    triggerKind: null,
    turnId: "turn_usage",
    usageExtractionSourcePath: null,
    usageExtractionVersion: "test",
    usageId: "turn_usage.attempt-1",
  };
}

function buildTestHostedExecutionRuntimePlatform(
  input: Parameters<typeof buildHostedExecutionRuntimePlatform>[0],
) {
  return buildHostedExecutionRuntimePlatform({
    workspaceCheckpointBridge: {
      readCurrentLease: () => ({
        attemptId: "runtime_write_123",
        leaseGeneration: "7",
        userId: "member_123",
        workspaceVersion: "6",
      }),
    },
    ...input,
  });
}

function createBrowserVaultReplicaRef(sourceBundleHash: string) {
  return {
    byteLength: 256,
    dataVersion: "runner-platform-test",
    generatedAt: "2026-04-26T00:00:00.000Z",
    keyId: "browser-key-runner-platform",
    objectKey: "browser-vault/member-test/replica.json",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:runner-platform",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  } as const;
}

describe("buildHostedExecutionRuntimePlatform", () => {
  beforeEach(() => {
    mocks.emitHostedExecutionStructuredLog.mockReset();
  });

  it("does not attach stale runtime liveness controls to the Cloudflare platform", () => {
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    expect(platform.runtimeLivenessIntervalMs).toBeUndefined();
    expect(platform.runtimeLivenessPort).toBeUndefined();
    expect(platform.runtimeLivenessRequired).toBeUndefined();
  });

  it("logs upstream request failures with safe request metadata", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow("Hosted raw email read request failed.");

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          description: "Hosted raw email read",
          method: "GET",
          path: "/messages/raw_123",
          responseOrigin: "http://results.worker",
        },
        level: "warn",
        message: "Hosted runtime upstream request failed.",
        phase: "outbox",
        userId: null,
      }),
    );
  });

  it("logs non-OK control-plane responses with response metadata", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 503,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    })).rejects.toThrow(/Hosted device-sync runtime snapshot failed with HTTP 503/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          description: "Hosted device-sync runtime snapshot",
          method: "POST",
          path: "/api/internal/device-sync/runtime/snapshot",
          responseOrigin: "https://web.example.test",
          responseStatus: 503,
          transport: "direct",
          userId: "member_123",
        },
        level: "warn",
        message: "Hosted runtime control-plane response returned non-OK.",
        phase: "outbox",
        userId: "member_123",
      }),
    );
  });

  it("accepts missing workspace browser-vault publish responses as stale work", async () => {
    const sourceBundleHash = "b".repeat(64);
    const replicaRef = createBrowserVaultReplicaRef(sourceBundleHash);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      published: false,
      workspace: null,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 404,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    const result = await platform.browserVaultReplicaPort!.publishRef!({
      replicaRef,
    });

    expect(result).toEqual({
      published: false,
      workspace: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runtime control-plane response returned non-OK.",
      }),
    );
  });

  it("accepts conflicted workspace browser-vault publish responses as stale work", async () => {
    const sourceBundleHash = "b".repeat(64);
    const replicaRef = createBrowserVaultReplicaRef(sourceBundleHash);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      published: false,
      workspace: null,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 409,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    const result = await platform.browserVaultReplicaPort!.publishRef!({
      replicaRef,
    });

    expect(result).toEqual({
      published: false,
      workspace: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runtime control-plane response returned non-OK.",
      }),
    );
  });

  it("logs non-OK internal upstream responses with response metadata", async () => {
    const fetchMock = vi.fn(async () => new Response("artifact missing", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 500,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow("Hosted raw email read failed with HTTP 500.");

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          description: "Hosted raw email read",
          responseStatus: 500,
        },
        level: "warn",
        message: "Hosted runtime upstream response returned non-OK.",
        phase: "outbox",
        userId: null,
      }),
    );
  });

  it("does not classify external provider 401 responses as stale invocation authority", async () => {
    const fetchMock = vi.fn(async () => new Response("bad provider key", {
      status: 401,
    }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );

    const response = await hostedFetch("https://api.openai.example.test/v1/responses");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves Request init overrides for external fetch passthrough", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );
    const abortController = new AbortController();
    const original = new Request("https://example.test/", {
      body: "a",
      method: "POST",
    });

    await hostedFetch(original, {
      body: "b",
      headers: { "x-test": "1" },
      method: "PUT",
      signal: abortController.signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const forwarded = requireFetchRequest(fetchMock.mock.calls[0], "external passthrough fetch");
    expect(forwarded.headers.get("x-test")).toBe("1");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(forwarded.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(forwarded.method).toBe("PUT");
    expect(await forwarded.text()).toBe("b");

    expect(forwarded.signal.aborted).toBe(false);
    abortController.abort();
    expect(forwarded.signal.aborted).toBe(true);
  });

  it("classifies internal authority 401 responses as stale invocation authority", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: "Unauthorized",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 401,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    let rejectedError: unknown;
    try {
      await platform.effectsPort.readRawEmailMessage("raw_123");
    } catch (error) {
      rejectedError = error;
    }

    expect(isHostedRuntimeInternalAuthorityRejectedError(rejectedError)).toBe(true);
    expect(rejectedError).toMatchObject({
      code: "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY",
      name: "HostedRuntimeInternalAuthorityRejectedError",
      reason: "internal_authority_rejected",
      status: 401,
      statusCode: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("routes raw email reads through the Cloudflare internal effects port and attaches the invocation proxy token", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    await platform.effectsPort.readRawEmailMessage("raw/message#1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "effects port fetch");
    expect(request.url).toBe("http://results.worker/messages/raw%2Fmessage%231");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(request.method).toBe("GET");
  });

  it("preserves Request init overrides for internal virtual-host fetches", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );
    const abortController = new AbortController();
    const original = new Request("https://results.worker/messages/raw", {
      body: "a",
      method: "POST",
    });

    await hostedFetch(original, {
      body: "b",
      headers: { "x-test": "1" },
      method: "PUT",
      signal: abortController.signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const forwarded = requireFetchRequest(fetchMock.mock.calls[0], "internal fetch");
    expect(forwarded.url).toBe("https://results.worker/messages/raw");
    expect(forwarded.headers.get("x-test")).toBe("1");
    expect(forwarded.method).toBe("PUT");
    expect(await forwarded.text()).toBe("b");

    expect(forwarded.signal.aborted).toBe(false);
    abortController.abort();
    expect(forwarded.signal.aborted).toBe(true);
  });

  it("routes internal runtime requests through virtual hosts with write-fence headers", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      proxyBoundUserIdHeader: true,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    });

    await platform.effectsPort.readRawEmailMessage("raw/message#1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "internal effects port fetch");
    expect(request.url).toBe(
      "http://results.worker/messages/raw%2Fmessage%231",
    );
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("runtime_write_123");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("7");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("6");
    expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(request.method).toBe("GET");
  });

  it("attaches web-control ports and routes them through internal virtual hosts", async () => {
    const fetchMock = vi.fn(async (requestInput: RequestInfo | URL) => {
      const request = requestInput instanceof Request ? requestInput : new Request(requestInput);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/api/internal/hosted-mailbox/fetch")) {
        return new Response(JSON.stringify({
          fetchedAt: "2026-04-26T00:00:02.000Z",
          items: [],
          maxSeqByLane: [],
          userId: "member_123",
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/hosted-workspace")) {
        return new Response(JSON.stringify({
          fetchedAt: "2026-04-26T00:00:02.000Z",
          workspace: {
            checkpointedAt: "2026-04-26T00:00:00.000Z",
            createdAt: "2026-04-26T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: null,
            snapshotRef: null,
            updatedAt: "2026-04-26T00:00:02.000Z",
            userId: "member_123",
            version: "6",
          },
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/hosted-runtime/log")) {
        return new Response(JSON.stringify({
          loggedCount: 1,
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/hosted-execution/issues/record")) {
        return new Response(JSON.stringify({
          issueIds: ["issue_123"],
          recorded: 1,
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/hosted-execution/usage/record")) {
        return new Response(JSON.stringify({
          recorded: true,
          usageId: "turn_usage.runtime_write_123",
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/device-sync/runtime/snapshot")) {
        return new Response(JSON.stringify({
          connections: [],
          generatedAt: "2026-04-26T00:00:02.000Z",
          userId: "member_123",
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      throw new Error(`Unexpected callback URL: ${request.url}`);
    });
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    });

    expect(platform.mailboxPort).toBeDefined();
    expect(platform.workspacePort).toBeDefined();
    expect(platform.logPort).toBeDefined();
    expect(platform.issueExportPort).toBeDefined();
    expect(platform.usageRecordPort).toBeDefined();
    expect(platform.deviceSyncPort).toBeDefined();
    await platform.mailboxPort!.fetch({
      lanes: [{ importedSeq: "0", lane: "conversation" }],
      limitPerLane: 10,
      requestId: "request_mailbox_1",
    });
    await platform.workspacePort!.read!();
    await platform.logPort!.write({
      entries: [
        {
          at: "2026-04-26T00:00:03.000Z",
          attemptId: "runtime_write_123",
          component: "mailbox",
          eventCode: "mailbox.imported",
          leaseGeneration: "7",
          level: "info",
          mailboxLane: "conversation",
          mailboxSeqEnd: "1",
          mailboxSeqStart: "1",
          phase: "import",
          redactedJson: { importedCount: 1 },
          workspaceVersion: "6",
        },
      ],
    });
    await platform.issueExportPort!.recordIssues([{ code: "runtime.issue" }]);
    await platform.usageRecordPort!.recordUsage(createAssistantUsageRecord());
    await platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const requests = fetchMock.mock.calls.map((call, index) =>
      requireFetchRequest(call, `callback web-control request ${index}`)
    );
    expect(requests.map((request) => request.url)).toEqual([
      "http://web-control.worker/api/internal/hosted-mailbox/fetch",
      "http://web-control.worker/api/internal/hosted-workspace",
      "http://web-control.worker/api/internal/hosted-runtime/log",
      "http://web-control.worker/api/internal/hosted-execution/issues/record",
      "http://web-control.worker/api/internal/hosted-execution/usage/record",
      "http://web-control.worker/api/internal/device-sync/runtime/snapshot",
    ]);
    for (const request of requests) {
      expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("runtime_write_123");
      expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("7");
      expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("6");
      expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    }
  });

  it("fails closed before issuing internal-host requests when the invocation proxy token is missing", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow(
      "missing a runtime write-fence authority",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds device-sync runtime requests to the hosted member id at the signed web callback seam", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body: unknown = await request.json();

      expect(body).toEqual({
        connectionId: "conn_123",
        userId: "member_123",
      });

      return new Response(JSON.stringify({
        connections: [],
        generatedAt: "2026-04-07T00:00:00.000Z",
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const snapshot = await platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    });

    expect(snapshot.userId).toBe("member_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "device-sync fetch");
    expect(request.url).toBe("https://web.example.test/api/internal/device-sync/runtime/snapshot");
    const headers = request.headers;
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signing-key-id")).toBe("v1");
    expect(headers.get("x-hosted-execution-nonce")).toMatch(/^[a-f0-9]{32}$/u);
    expect(headers.get("x-hosted-execution-timestamp")).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("records hosted usage through the signed web callback seam", async () => {
    const usageRecord = createAssistantUsageRecord();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      await expect(request.json()).resolves.toEqual({
        usage: usageRecord,
      });

      return new Response(JSON.stringify({
        recorded: true,
        usageId: "turn_usage.attempt-1",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(
      platform.usageRecordPort!.recordUsage(usageRecord),
    ).resolves.toEqual({
      recorded: true,
      usageId: "turn_usage.attempt-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "usage fetch");
    expect(request.url).toBe("https://web.example.test/api/internal/hosted-execution/usage/record");
    expect(request.method).toBe("POST");
    const headers = request.headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("wraps invalid hosted usage recording responses", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      recorded: 2,
      usageId: "turn_usage.attempt-1",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(
      platform.usageRecordPort!.recordUsage(createAssistantUsageRecord()),
    ).rejects.toThrow("Hosted usage recording returned invalid JSON.");
  });

  it("fetches pending hosted device-sync dirty state through the signed web callback seam", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      await expect(request.json()).resolves.toEqual({
        limit: 1,
        userId: "member_123",
      });

      return new Response(JSON.stringify({
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const pending = await platform.deviceSyncPort!.fetchDirtyStates({
      limit: 1,
    });

    expect(pending).toEqual({
      hasMore: false,
      items: [],
      nextWakeAt: null,
      userId: "member_123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "device-sync dirty pending fetch",
    );
    expect(request.url).toBe("https://web.example.test/api/internal/device-sync/runtime/dirty-pending");
    expect(request.method).toBe("POST");
    const headers = request.headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("forces hosted device-sync connect-link creation through the signed POST callback route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      authorizationUrl: "https://sync.example.test/oauth",
      expiresAt: "2026-04-07T00:00:00.000Z",
      provider: "oura",
      providerLabel: "Oura",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const connectLink = await platform.deviceSyncPort!.createConnectLink({
      connectTarget: "oura",
    });

    expect(connectLink.provider).toBe("oura");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "device-sync connect-link fetch",
    );
    expect(request.url).toBe("https://web.example.test/api/internal/device-sync/connect-targets/oura/connect-link");
    expect(request.method).toBe("POST");
    expect(request.body).toBeNull();
    const headers = request.headers;
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signing-key-id")).toBe("v1");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("passes messaging return targets through the signed hosted device-sync connect-link route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      authorizationUrl: "https://sync.example.test/oauth",
      expiresAt: "2026-04-07T00:00:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await platform.deviceSyncPort!.createConnectLink({
      messagingReturnTarget: "telegram",
      connectTarget: "whoop",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "device-sync connect-link fetch",
    );
    expect(request.url).toBe("https://web.example.test/api/internal/device-sync/connect-targets/whoop/connect-link");
    expect(request.method).toBe("POST");
    await expect(request.text()).resolves.toBe(JSON.stringify({
      messagingReturnTarget: "telegram",
    }));
    const headers = request.headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("does not retry mutating hosted device-sync connect-link transport failures", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    await expect(platform.deviceSyncPort!.createConnectLink({
      connectTarget: "whoop",
    })).rejects.toThrow("Hosted device-sync connect link whoop request failed. fetch failed");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects direct hosted web control base URLs with non-root paths", async () => {
    const fetchMock = vi.fn();
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      webControlBaseUrl: "https://web.example.test/app",
    });

    await expect(platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    })).rejects.toThrow(/must not include a path/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes hosted web control-plane calls through the worker proxy when callback signing stays outside the child", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      connections: [],
      generatedAt: "2026-04-07T00:00:00.000Z",
      userId: "member_123",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const snapshot = await platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    });

    expect(snapshot.userId).toBe("member_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "proxied web-control fetch");
    expect(request.url).toBe("http://web-control.worker/api/internal/device-sync/runtime/snapshot");
    expect(request.method).toBe("POST");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(request.headers.get("content-type")).toBe("application/json");
    await expect(request.json()).resolves.toEqual({
      connectionId: "conn_123",
      userId: "member_123",
    });
  });

  it("routes hosted mailbox fetches through the worker proxy without run adoption fields", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      items: [
        {
          createdAt: "2026-04-26T00:00:01.000Z",
          dedupeKey: "conversation:test:1",
          id: "mailbox_1",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "1",
          occurredAt: "2026-04-26T00:00:00.000Z",
          payloadBytes: 64,
          payloadRef: "payload_1",
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: "2026-04-26T00:00:01.000Z",
          userId: "member_123",
        },
      ],
      maxSeqByLane: [
        {
          lane: "conversation",
          maxSeq: "1",
        },
      ],
      userId: "member_123",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_1",
    });

    expect(result.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "mailbox fetch");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-mailbox/fetch");
    expect(request.method).toBe("POST");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    await expect(request.json()).resolves.toEqual({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_1",
    });
  });

  it("retries replay-safe hosted mailbox fetch transport failures once", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        throw new Error("fetch failed");
      }

      return new Response(JSON.stringify({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        items: [],
        maxSeqByLane: [],
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_retry",
    });

    expect(result.items).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retriedRequest = requireFetchRequest(fetchMock.mock.calls[1], "retried mailbox fetch");
    expect(retriedRequest.url).toBe("http://web-control.worker/api/internal/hosted-mailbox/fetch");
    expect(retriedRequest.method).toBe("POST");
    expect(retriedRequest.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
  });

  it("does not retry replay-safe mailbox reads after internal authority rejection", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: "Unauthorized",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 401,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_stale_authority",
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY",
      reason: "internal_authority_rejected",
      status: 401,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries replay-safe hosted mailbox fetch failures once on the signed direct web-control route", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        throw new Error("fetch failed");
      }

      return new Response(JSON.stringify({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        items: [],
        maxSeqByLane: [],
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const result = await platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_direct_retry",
    });

    expect(result.items).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retriedRequest = requireFetchRequest(
      fetchMock.mock.calls[1],
      "retried direct mailbox fetch",
    );
    expect(String(retriedRequest.url)).toBe(
      "https://web.example.test/api/internal/hosted-mailbox/fetch",
    );
    expect(retriedRequest.method).toBe("POST");
    expect(retriedRequest.headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(retriedRequest.headers.get("x-hosted-execution-signing-key-id")).toBe("v1");
    expect(retriedRequest.headers.get("x-hosted-execution-signature")).toMatch(
      /^[A-Za-z0-9\-_]+$/u,
    );
  });

  it("retries replay-safe hosted mailbox fetch TimeoutError failures once", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        const error = new Error("The operation timed out.");
        error.name = "TimeoutError";
        throw error;
      }

      return new Response(JSON.stringify({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        items: [],
        maxSeqByLane: [],
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_timeout_retry",
    });

    expect(result.items).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry replay-safe hosted mailbox fetch AbortError failures", async () => {
    const fetchMock = vi.fn(async () => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      throw error;
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_abort",
    })).rejects.toThrow("Hosted mailbox fetch request failed. The operation was aborted.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries replay-safe hosted mailbox fetch HTTP 503 responses once", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("try again", {
          headers: {
            "content-type": "text/plain; charset=utf-8",
          },
          status: 503,
        });
      }

      return new Response(JSON.stringify({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        items: [],
        maxSeqByLane: [],
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_http_retry",
    });

    expect(result.items).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries replay-safe hosted mailbox payload fetch transport failures once", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        throw new Error("socket closed");
      }

      return new Response(JSON.stringify({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        payload: {
          createdAt: "2026-04-26T00:00:01.000Z",
          mailboxItemId: "mailbox_payload_1",
          payloadCiphertext: "ciphertext",
          payloadSchema: "murph.hosted-mailbox-payload.v1",
          userId: "member_123",
        },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.mailboxPort!.fetchPayload({
      dedupeKey: "dedupe_payload_1",
      mailboxItemId: "mailbox_payload_1",
      payloadRef: "hosted-mailbox-payload:mailbox_payload_1",
      requestId: "request_payload_retry",
    });

    expect(result.payload?.payloadCiphertext).toBe("ciphertext");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retriedRequest = requireFetchRequest(
      fetchMock.mock.calls[1],
      "retried mailbox payload fetch",
    );
    expect(retriedRequest.url).toBe(
      "http://web-control.worker/api/internal/hosted-mailbox/payload/fetch",
    );
    expect(retriedRequest.method).toBe("POST");
    expect(retriedRequest.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
  });

  it("threads checkpoint fencing fields through the workspace callback body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      checkpointed: true,
      workspace: {
        checkpointedAt: "2026-04-26T00:00:04.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {
          importedConversationSeq: "1",
        },
        snapshotRef: null,
        updatedAt: "2026-04-26T00:00:04.000Z",
        userId: "member_123",
        version: "5",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    const result = await platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {
        importedConversationSeq: "1",
      },
      snapshotRef: null,
    });

    expect(result.workspace.version).toBe("5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "workspace checkpoint");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-workspace/checkpoint");
    expect(request.method).toBe("POST");
    await expect(request.json()).resolves.toEqual({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {
        importedConversationSeq: "1",
      },
      snapshotRef: null,
    });
  });

  it("sends active lease headers on proxied workspace checkpoints", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      checkpointed: true,
      workspace: {
        checkpointedAt: "2026-04-26T00:00:04.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {},
        snapshotRef: null,
        updatedAt: "2026-04-26T00:00:04.000Z",
        userId: "member_123",
        version: "5",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    await platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {},
      snapshotRef: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "workspace checkpoint");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-workspace/checkpoint");
    expect(request.method).toBe("POST");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("4");
    await expect(request.json()).resolves.toMatchObject({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
    });
  });

  it("advances artifact upload lease headers after a successful workspace checkpoint", async () => {
    let currentLease = {
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
      workspaceVersion: "4",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === "http://web-control.worker/api/internal/hosted-workspace/checkpoint") {
        return new Response(JSON.stringify({
          checkpointed: true,
          workspace: {
            checkpointedAt: "2026-04-26T00:00:04.000Z",
            createdAt: "2026-04-26T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: {},
            snapshotRef: null,
            updatedAt: "2026-04-26T00:00:04.000Z",
            userId: "member_123",
            version: "5",
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      return new Response(null, { status: 200 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => currentLease,
        recordCheckpoint: ({ workspaceVersion }) => {
          currentLease = {
            ...currentLease,
            workspaceVersion,
          };
        },
      },
    });

    await platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {},
      snapshotRef: null,
    });
    await platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const artifactRequest = requireFetchRequest(fetchMock.mock.calls[1], "artifact upload");
    expect(artifactRequest.url).toBe(`http://artifacts.worker/objects/${"a".repeat(64)}`);
    expect(artifactRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(artifactRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(artifactRequest.headers.get("x-hosted-runtime-workspace-version")).toBe("5");
  });

  it("writes browser-vault replicas through the Cloudflare internal store with active lease headers", async () => {
    const sourceBundleHash = "b".repeat(64);
    const replica = {
      generatedAt: "2026-04-26T00:00:00.000Z",
      schema: "murph.browser-vault-replica",
      source: {
        dataVersion: "runner-platform-test",
        sourceBundleHash,
      },
    };
    const replicaRef = createBrowserVaultReplicaRef(sourceBundleHash);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ replicaRef }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    const result = await platform.browserVaultReplicaPort!.write({ replica });

    expect(result).toEqual(replicaRef);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "browser-vault replica write");
    expect(request.url).toBe("http://browser-vault.worker/replicas");
    expect(request.method).toBe("POST");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("5");
    await expect(request.json()).resolves.toEqual({ replica });
  });

  it("exposes callback-only browser-vault writes without legacy provider delivery effects", async () => {
    const sourceBundleHash = "c".repeat(64);
    const replica = {
      generatedAt: "2026-04-26T00:00:00.000Z",
      schema: "murph.browser-vault-replica",
      source: {
        dataVersion: "runner-platform-callback-test",
        sourceBundleHash,
      },
    };
    const replicaRef = createBrowserVaultReplicaRef(sourceBundleHash);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.endsWith("/telegram/files/get")) {
        return new Response(JSON.stringify({
          file: {
            file_id: "telegram_file_123",
          },
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }

      return new Response(JSON.stringify({ replicaRef }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    expect(platform.browserVaultReplicaPort).toBeDefined();
    expect(platform.effectsPort.getTelegramFile).toBeDefined();
    expect("sendTelegram" in platform.effectsPort).toBe(false);
    expect("sendTelegramChatAction" in platform.effectsPort).toBe(false);
    expect("sendLinq" in platform.effectsPort).toBe(false);
    expect("sendLinqChatAction" in platform.effectsPort).toBe(false);
    expect("markLinqRead" in platform.effectsPort).toBe(false);
    expect("deleteLinqMessages" in platform.effectsPort).toBe(false);
    expect("sendWhatsApp" in platform.effectsPort).toBe(false);
    await platform.browserVaultReplicaPort!.write({ replica });
    await platform.effectsPort.getTelegramFile!({
      fileId: "telegram_file_123",
    });

    const replicaRequest = requireFetchRequest(fetchMock.mock.calls[0], "callback browser-vault write");
    const telegramRequest = requireFetchRequest(fetchMock.mock.calls[1], "callback telegram file lookup");
    expect(replicaRequest.url).toBe(
      "http://browser-vault.worker/replicas",
    );
    expect(telegramRequest.url).toBe(
      "http://results.worker/telegram/files/get",
    );
    expect(replicaRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(telegramRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(replicaRequest.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(telegramRequest.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
  });

  it("rejects browser-vault replica write headers without an active runtime write fence", async () => {
    await expect(
      createHostedBrowserVaultReplicaWriteHeaders({
        workspaceCheckpointBridge: null,
      }),
    ).rejects.toThrow(
      "Hosted browser-vault replica write requires a runtime write fence.",
    );
  });

  it("rejects browser-vault replica writes when the workspace bridge has no active lease", async () => {
    const sourceBundleHash = "e".repeat(64);
    const replica = {
      generatedAt: "2026-04-26T00:00:00.000Z",
      schema: "murph.browser-vault-replica",
      source: {
        dataVersion: "runner-platform-no-lease-test",
        sourceBundleHash,
      },
    };
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => null,
      },
    });

    await expect(
      platform.browserVaultReplicaPort!.write({ replica }),
    ).rejects.toThrow(
      "Browser-vault replica write requires an active hosted runtime write fence.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates successful artifact uploads by SHA within one platform instance", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    await platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    await platform.artifactStore.put({
      bytes: new Uint8Array([4, 5, 6]),
      sha256: "b".repeat(64),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requireFetchRequest(fetchMock.mock.calls[0], "first artifact upload").url).toBe(
      `http://artifacts.worker/objects/${"a".repeat(64)}`,
    );
    expect(requireFetchRequest(fetchMock.mock.calls[1], "second artifact upload").url).toBe(
      `http://artifacts.worker/objects/${"b".repeat(64)}`,
    );
  });

  it("shares concurrent same-SHA artifact uploads with the in-flight request", async () => {
    let resolveUpload = (_response: Response): void => {
      throw new Error("Expected the artifact upload resolver to be initialized.");
    };
    const uploadResponse = new Promise<Response>((resolve) => {
      resolveUpload = resolve;
    });
    const fetchMock = vi.fn(async () => uploadResponse);
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const firstUpload = platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    const secondUpload = platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    resolveUpload(new Response(null, { status: 200 }));
    await Promise.all([firstUpload, secondUpload]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a shared in-flight artifact upload until the response is OK", async () => {
    let resolveUpload = (_response: Response): void => {
      throw new Error("Expected the artifact upload resolver to be initialized.");
    };
    const uploadResponse = new Promise<Response>((resolve) => {
      resolveUpload = resolve;
    });
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return uploadResponse;
      }

      return new Response(null, { status: 200 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const firstUpload = platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    const secondUpload = platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    resolveUpload(new Response("temporary failure", { status: 503 }));
    await expect(firstUpload).rejects.toThrow(/Hosted artifact upload/u);
    await expect(secondUpload).rejects.toThrow(/Hosted artifact upload/u);

    await platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not mark failed artifact uploads as deduplicated", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("temporary failure", { status: 503 });
      }

      return new Response(null, { status: 200 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    })).rejects.toThrow(/Hosted artifact upload/u);
    await platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("validates the workspace lease immediately before web checkpoint callbacks", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      checkpointed: true,
      workspace: {
        checkpointedAt: "2026-04-26T00:00:04.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {},
        snapshotRef: null,
        updatedAt: "2026-04-26T00:00:04.000Z",
        userId: "member_123",
        version: "5",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "3",
        }),
      },
    });

    const result = await platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "canonical_runtime_commit",
      redactedStatus: {},
      snapshotRef: null,
    });

    expect(result.checkpointed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads workspace state through the web callback route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:05.000Z",
      workspace: {
        checkpointedAt: "2026-04-26T00:00:04.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {
          importedConversationSeq: "1",
        },
        snapshotRef: null,
        updatedAt: "2026-04-26T00:00:04.000Z",
        userId: "member_123",
        version: "5",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const readWorkspace = platform.workspacePort!.read;
    if (typeof readWorkspace !== "function") {
      throw new Error("Expected hosted workspace read port.");
    }

    const result = await readWorkspace();

    expect(result.workspace?.version).toBe("5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "workspace read");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-workspace");
    expect(request.method).toBe("GET");
  });

  it("writes only structured runtime logs through the web callback route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      loggedCount: 1,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.logPort!.write({
      entries: [
        {
          at: "2026-04-26T00:00:03.000Z",
          attemptId: "attempt_1",
          component: "mailbox",
          eventCode: "mailbox.imported",
          leaseGeneration: "9",
          level: "info",
          mailboxLane: "conversation",
          mailboxSeqEnd: "1",
          mailboxSeqStart: "1",
          phase: "import",
          redactedJson: {
            importedCount: 1,
          },
          workspaceVersion: "4",
        },
      ],
    });

    expect(result.loggedCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "runtime log");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-runtime/log");
    expect(request.method).toBe("POST");
    await expect(request.json()).resolves.toEqual({
      entries: [
        {
          at: "2026-04-26T00:00:03.000Z",
          attemptId: "attempt_1",
          component: "mailbox",
          eventCode: "mailbox.imported",
          leaseGeneration: "9",
          level: "info",
          mailboxLane: "conversation",
          mailboxSeqEnd: "1",
          mailboxSeqStart: "1",
          phase: "import",
          redactedJson: {
            importedCount: 1,
          },
          workspaceVersion: "4",
        },
      ],
    });
  });

  it("does not expose the deleted hosted share web-control port", () => {
    const fetchMock = vi.fn(async () => new Response("unexpected", { status: 200 }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    expect("sharePort" in platform).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes only the shared hosted effects port methods needed after the cutover", async () => {
    const rawMessage = new Uint8Array([0x61, 0x62, 0x63]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);

      if (request.method === "GET") {
        return new Response(rawMessage, {
          headers: {
            "content-type": "message/rfc822",
          },
          status: 200,
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        target: "assistant@example.com",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });
    const { effectsPort } = platform;

    expect("deletePreparedAssistantDelivery" in effectsPort).toBe(false);
    expect("readAssistantDeliveryRecord" in effectsPort).toBe(false);
    expect("writeAssistantDeliveryRecord" in effectsPort).toBe(false);

    const readResult = await effectsPort.readRawEmailMessage("raw_123");
    const sendResult = await effectsPort.sendEmail({
      identityId: "identity_123",
      message: "hello",
      subject: "subject",
      target: "assistant@example.com",
      targetKind: "explicit",
    });

    expect(readResult).toEqual(rawMessage);
    expect(sendResult).toEqual({ target: "assistant@example.com" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const readRequest = fetchMock.mock.calls[0]?.[0] as Request;
    const sendRequest = fetchMock.mock.calls[1]?.[0] as Request;

    expect(readRequest).toBeInstanceOf(Request);
    expect(sendRequest).toBeInstanceOf(Request);
    expect(readRequest.url).toBe("http://results.worker/messages/raw_123");
    expect(sendRequest.url).toBe("http://results.worker/send");
  });

  it("keeps only Telegram file lookup on the provider effects port after delivery cutover", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.endsWith("/telegram/files/get")) {
        return new Response(JSON.stringify({
          file: {
            file_id: "telegram_file_123",
            file_path: "photos/file.jpg",
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    await expect(platform.effectsPort.getTelegramFile!({
      fileId: "telegram_file_123",
    })).resolves.toEqual({
      file_id: "telegram_file_123",
      file_path: "photos/file.jpg",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const telegramRequest = requireFetchRequest(fetchMock.mock.calls[0], "telegram file lookup");
    expect(telegramRequest.url).toBe("http://results.worker/telegram/files/get");
    expect(telegramRequest.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(telegramRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(telegramRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(telegramRequest.headers.get("x-hosted-runtime-workspace-version")).toBe("5");
    await expect(telegramRequest.json()).resolves.toEqual({
      fileId: "telegram_file_123",
    });
    expect("sendTelegram" in platform.effectsPort).toBe(false);
    expect("sendTelegramChatAction" in platform.effectsPort).toBe(false);
    expect("sendLinq" in platform.effectsPort).toBe(false);
    expect("sendLinqChatAction" in platform.effectsPort).toBe(false);
    expect("markLinqRead" in platform.effectsPort).toBe(false);
    expect("deleteLinqMessages" in platform.effectsPort).toBe(false);
    expect("sendWhatsApp" in platform.effectsPort).toBe(false);
  });

  it("preserves structured details from remaining provider effect failures", async () => {
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        cleanupMessages: [{ messageId: "1001", target: "telegram_chat_123" }],
        code: "ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS",
        error: "Telegram delivery outcome is ambiguous.",
        providerMessageIds: ["1001"],
        target: "telegram_chat_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 502,
      })) as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    await expect(platform.effectsPort.getTelegramFile!({
      fileId: "telegram_file_123",
    })).rejects.toMatchObject({
      cleanupMessages: [{ messageId: "1001", target: "telegram_chat_123" }],
      code: "ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS",
      providerMessageId: "1001",
      providerMessageIds: ["1001"],
      status: 502,
      target: "telegram_chat_123",
    });
  });

  it("classifies internal provider-effect 403 responses as stale invocation authority", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: "Forbidden",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 403,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    await expect(platform.effectsPort.getTelegramFile!({
      fileId: "telegram_file_123",
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY",
      reason: "internal_authority_rejected",
      status: 403,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves HTTP status on hosted raw email read failures", async () => {
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: vi.fn(async () => new Response("unavailable", { status: 503 })) as typeof fetch,
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow(/Hosted raw email read failed with HTTP 503/u);

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toMatchObject({
      status: 503,
      statusCode: 503,
    });
  });
});
