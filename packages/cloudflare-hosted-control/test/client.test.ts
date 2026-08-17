import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_DIRECT_REQUEST_STARTED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRE_STARTED_AT_MS_HEADER,
  type HostedBrowserVaultReplicaMetricBucketId,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";

import {
  CloudflareHostedControlBrowserVaultReplicaNotFoundError,
  type CloudflareHostedControlClientOptions,
  createCloudflareHostedControlClient,
  readCloudflareHostedControlHttpError,
} from "../src/client.ts";
import {
  CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
} from "../src/routes.ts";

type ObservedRequest = { init?: RequestInit; url: string };

describe("createCloudflareHostedControlClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes only the narrowed execution-plane helpers", () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      getBearerToken: async () => "token-123",
    });

    expect(Object.keys(client).sort()).toEqual([
      "createBrowserVaultExportSession",
      "createBrowserVaultSession",
      "deleteEnvironmentVoice",
      "deleteMealPhoto",
      "deleteUserData",
      "enqueueDeviceWebhook",
      "ensureRuntimeProcessing",
      "getRunnerStatus",
      "prewarmRuntimeShell",
      "reconcileRuntimeHealthDataConsent",
      "sendTelegramUsageLimitNotice",
      "stageEnvironmentVoice",
      "stageMealPhoto",
      "verifyInferenceConnection",
    ]);
  });

  it("enqueues an opaque device-webhook envelope without binding member authority", async () => {
    const keys = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const { sealDeviceWebhookQueueEnvelope } = await import(
      "../src/device-webhook-queue.ts"
    );
    const envelope = await sealDeviceWebhookQueueEnvelope({
      env: "test",
      preparedWebhook: {
        acceptanceMode: "level_dirty_hint",
        eventType: "demo.updated",
        externalAccountId: "opaque-account",
        jobs: [],
        provider: "oura",
        receivedAt: "2026-02-02T00:00:00.000Z",
        schema: "murph.device-sync-prepared-webhook.v1",
        traceId: "1".repeat(64),
      },
      recipientKeyId: "automation:test",
      recipientPublicJwk: await crypto.subtle.exportKey("jwk", keys.publicKey),
    });
    const fetchImpl = vi.fn(async () => createJsonResponse({
      accepted: true,
      transportId: envelope.transportId,
    })) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(client.enqueueDeviceWebhook(envelope)).resolves.toEqual({
      accepted: true,
      transportId: envelope.transportId,
    });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://runner.example.test/internal/device-webhooks/enqueue");
    expect(new Headers(init.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBeNull();
  });

  it("verifies a bounded inference candidate through the user-bound route", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({
      verificationProfile: "murph-codex-0.147.0-portable-responses-v1",
      verified: true,
    })) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(client.verifyInferenceConnection({
      request: {
        auth: { kind: "bearer", secret: "synthetic-secret" },
        contextWindowTokens: 131_072,
        endpointUrl: "https://inference.example.test/v1/responses",
        model: "example-model",
        protocol: "responses",
        supportsImages: false,
      },
      userId: "user_123",
    })).resolves.toEqual({
      verificationProfile: "murph-codex-0.147.0-portable-responses-v1",
      verified: true,
    });

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://runner.example.test/internal/users/user_123/inference/verify",
    );
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer token-123",
    );
    expect(new Headers(init.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(
      "user_123",
    );
  });

  it("stages and deletes environment voice bytes through the bound user routes", async () => {
    const bytes = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
    const sha256 = await sha256Hex(bytes);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({
        audioKey: "a".repeat(40),
        byteLength: bytes.byteLength,
        sha256,
      }))
      .mockResolvedValueOnce(createJsonResponse({ deleted: true })) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(client.stageEnvironmentVoice({
      bytes,
      captureId: sha256,
      contentType: "audio/webm",
      sha256,
      userId: "user_123",
    })).resolves.toEqual({
      audioKey: "a".repeat(40),
      byteLength: bytes.byteLength,
      sha256,
    });
    await expect(client.deleteEnvironmentVoice({
      audioKey: "a".repeat(40),
      userId: "user_123",
    })).resolves.toBeUndefined();

    const [stageUrl, stageInit] = vi.mocked(fetchImpl).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(stageUrl).toBe(
      "https://runner.example.test/internal/users/user_123/environment-voice/stage",
    );
    expect(stageInit.method).toBe("POST");
    expect(new Uint8Array(stageInit.body as ArrayBuffer)).toEqual(bytes);
    const stageHeaders = new Headers(stageInit.headers);
    expect(stageHeaders.get("content-type")).toBe("audio/webm");
    expect(stageHeaders.get("x-murph-environment-voice-capture-id")).toBe(
      sha256,
    );
    expect(stageHeaders.get("x-murph-environment-voice-sha256")).toBe(sha256);

    const [deleteUrl, deleteInit] = vi.mocked(fetchImpl).mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(deleteUrl).toBe(
      "https://runner.example.test/internal/users/user_123/environment-voice/delete",
    );
    expect(deleteInit.method).toBe("DELETE");
    expect(
      new Headers(deleteInit.headers).get("x-murph-environment-voice-key"),
    ).toBe("a".repeat(40));
  });

  it("deletes one staged meal photo through the bound user route", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({ deleted: true })) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(client.deleteMealPhoto({
      mealPhotoKey: "a".repeat(40),
      userId: "user_123",
    })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://runner.example.test/internal/users/user_123/meal-photos/delete");
    expect(init.method).toBe("DELETE");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer token-123");
    expect(headers.get("x-hosted-execution-user-id")).toBe("user_123");
    expect(headers.get("x-murph-meal-photo-key")).toBe("a".repeat(40));
  });

  it("rejects invalid staged meal-photo keys before issuing a delete", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(client.deleteMealPhoto({
      mealPhotoKey: "not-a-key",
      userId: "user_123",
    })).rejects.toThrow("Cloudflare meal-photo key must be a 40-character lowercase hexadecimal string.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stages meal-photo JPEG bytes with bound metadata and validates the result", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9]);
    const sha256 = await sha256Hex(bytes);
    const fetchImpl = vi.fn(async () => createJsonResponse({
      byteLength: bytes.byteLength,
      mealPhotoKey: "a".repeat(40),
      sha256,
    })) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(client.stageMealPhoto({
      bytes,
      captureId: "c".repeat(64),
      sha256,
      userId: "user_123",
    })).resolves.toEqual({
      byteLength: bytes.byteLength,
      mealPhotoKey: "a".repeat(40),
      sha256,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://runner.example.test/internal/users/user_123/meal-photos/stage");
    expect(init.method).toBe("POST");
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(bytes);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer token-123");
    expect(headers.get("content-type")).toBe("image/jpeg");
    expect(headers.get("x-hosted-execution-user-id")).toBe("user_123");
    expect(headers.get("x-murph-meal-photo-capture-id")).toBe("c".repeat(64));
    expect(headers.get("x-murph-meal-photo-sha256")).toBe(sha256);
  });

  it("rejects meal-photo hash mismatches before issuing a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(client.stageMealPhoto({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      captureId: "c".repeat(64),
      sha256: "0".repeat(64),
      userId: "user_123",
    })).rejects.toThrow("Cloudflare meal-photo sha256 must match bytes.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts runtime ensure-processing requests to the user route and parses the response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    const fetchImpl = vi.fn(async () => createJsonResponse({
      action: "woken",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-07-02T00:03:00.000Z",
      runtimeAttemptId: "runtime-attempt-test",
    })) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => {
        vi.setSystemTime(new Date("2026-07-06T12:00:00.010Z"));
        return "token-123";
      },
    });
    const onTiming = vi.fn();
    const abortController = new AbortController();

    try {
      await expect(client.ensureRuntimeProcessing({
        commandTimeoutMs: 25_000,
        onTiming,
        orchestrationAttemptId: "web-ingress-attempt-test",
        signal: abortController.signal,
        userId: "user_123",
      })).resolves.toEqual({
        action: "woken",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-07-02T00:03:00.000Z",
        runtimeAttemptId: "runtime-attempt-test",
      });
    } finally {
      vi.useRealTimers();
    }

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://runner.example.test/internal/users/user_123/runtime/ensure-processing");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({
      orchestrationAttemptId: "web-ingress-attempt-test",
    }));
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer token-123");
    expect(headers.get("x-hosted-execution-user-id")).toBe("user_123");
    expect(headers.get(
      HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRE_STARTED_AT_MS_HEADER,
    )).toBe(String(Date.parse("2026-07-06T12:00:00.000Z")));
    expect(headers.get(
      HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRED_AT_MS_HEADER,
    )).toBe(String(Date.parse("2026-07-06T12:00:00.010Z")));
    expect(headers.get(
      HOSTED_RUNTIME_ENSURE_PROCESSING_DIRECT_REQUEST_STARTED_AT_MS_HEADER,
    )).toBe(String(Date.parse("2026-07-06T12:00:00.010Z")));
    expect(headers.get(HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER)).toBe(
      "25000",
    );
    expect(init.signal).toBe(abortController.signal);
    expect(onTiming).toHaveBeenCalledWith({
      directEnsureAction: "woken",
      directEnsureRequestStartedAtEpochMs: Date.parse("2026-07-06T12:00:00.010Z"),
      directEnsureResponseReceivedAtEpochMs: Date.parse("2026-07-06T12:00:00.010Z"),
      directEnsureResultKind: "runtime_processing_accepted",
      directEnsureRuntimeAttemptId: "runtime-attempt-test",
      orchestrationAttemptId: "web-ingress-attempt-test",
      tokenAcquiredAtEpochMs: Date.parse("2026-07-06T12:00:00.010Z"),
      tokenAcquireStartedAtEpochMs: Date.parse("2026-07-06T12:00:00.000Z"),
    });
  });

  it("posts runtime health-data consent reconciliation and validates the bound result", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({
      activeInvocationPreempted: true,
      consentState: "revoked",
      processingAllowed: false,
      runnerContainerDestroyAttempted: true,
      runnerContainerDestroyOk: true,
      userId: "user_123",
    })) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(
      client.reconcileRuntimeHealthDataConsent("user_123"),
    ).resolves.toEqual({
      activeInvocationPreempted: true,
      consentState: "revoked",
      processingAllowed: false,
      runnerContainerDestroyAttempted: true,
      runnerContainerDestroyOk: true,
      userId: "user_123",
    });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://runner.example.test/internal/users/user_123/runtime/health-data-consent",
    );
    expect(init).toMatchObject({
      body: "{}",
      method: "POST",
    });
    expect(new Headers(init.headers).get("x-hosted-execution-user-id")).toBe("user_123");
  });

  it("rejects inconsistent runtime health-data consent reconciliation results", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({
      activeInvocationPreempted: false,
      consentState: "revoked",
      processingAllowed: true,
      runnerContainerDestroyAttempted: false,
      runnerContainerDestroyOk: true,
      userId: "user_123",
    })) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(
      client.reconcileRuntimeHealthDataConsent("user_123"),
    ).rejects.toThrow("processingAllowed did not match consentState");
  });

  it("posts a source-bound runtime shell-prewarm hint to the bound user route", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({ accepted: true }, { status: 202 })
    ) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(client.prewarmRuntimeShell({
      source: "linq-typing-started",
      userId: "user_123",
    })).resolves.toEqual({
      accepted: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://runner.example.test/internal/users/user_123/runtime/shell-prewarm",
    );
    expect(init).toMatchObject({
      body: '{"source":"linq-typing-started"}',
      method: "POST",
    });
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer token-123");
    expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(headers.get("x-hosted-execution-user-id")).toBe("user_123");
  });

  it("rejects a malformed runtime shell-prewarm acknowledgement", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({ accepted: false })) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(client.prewarmRuntimeShell({
      source: "linq-typing-started",
      userId: "user_123",
    })).rejects.toThrow(
      "Cloudflare runtime shell prewarm response accepted must be true.",
    );
  });

  it("accepts an early runtime ensure-processing ack and still reports timing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    const fetchImpl = vi.fn(async () => {
      vi.setSystemTime(new Date("2026-07-06T12:00:00.025Z"));
      return createJsonResponse({ accepted: true }, { status: 202 });
    }) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => {
        vi.setSystemTime(new Date("2026-07-06T12:00:00.010Z"));
        return "token-123";
      },
    });
    const onTiming = vi.fn();

    try {
      await expect(client.ensureRuntimeProcessing({
        onTiming,
        orchestrationAttemptId: "web-ingress-attempt-test",
        userId: "user_123",
      })).resolves.toEqual({
        accepted: true,
      });
    } finally {
      vi.useRealTimers();
    }

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onTiming).toHaveBeenCalledWith({
      directEnsureRequestStartedAtEpochMs: Date.parse("2026-07-06T12:00:00.010Z"),
      directEnsureResponseReceivedAtEpochMs: Date.parse("2026-07-06T12:00:00.025Z"),
      directEnsureResultKind: "legacy_accepted",
      orchestrationAttemptId: "web-ingress-attempt-test",
      tokenAcquiredAtEpochMs: Date.parse("2026-07-06T12:00:00.010Z"),
      tokenAcquireStartedAtEpochMs: Date.parse("2026-07-06T12:00:00.000Z"),
    });
  });

  it("reports retry_later timing only after the response parses", async () => {
    const onTiming = vi.fn();
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl: vi.fn(async () => createJsonResponse({
        kind: "retry_later",
        retryAt: "2026-07-06T12:00:03.000Z",
      })) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.ensureRuntimeProcessing({
      onTiming,
      orchestrationAttemptId: "web-ingress-attempt-test",
      userId: "user_123",
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-07-06T12:00:03.000Z",
    });

    expect(onTiming).toHaveBeenCalledWith(expect.objectContaining({
      directEnsureResultKind: "retry_later",
      orchestrationAttemptId: "web-ingress-attempt-test",
    }));
    expect(onTiming.mock.invocationCallOrder[0]).toBeGreaterThan(0);
  });

  it("does not report timing for an unparseable ensure-processing response", async () => {
    const onTiming = vi.fn();
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl: vi.fn(async () => createJsonResponse({
        error: "payload-shaped diagnostic must not be recorded",
      })) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.ensureRuntimeProcessing({
      onTiming,
      orchestrationAttemptId: "web-ingress-attempt-test",
      userId: "user_123",
    })).rejects.toThrow();
    expect(onTiming).not.toHaveBeenCalled();
  });

  it("rejects blank user identifiers for runtime ensure-processing before issuing requests", () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    expect(() => client.ensureRuntimeProcessing({
      orchestrationAttemptId: "web-ingress-attempt-test",
      userId: "  ",
    })).toThrow("Cloudflare hosted control userId must not be blank.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an invalid runtime ensure-processing command timeout before issuing requests", () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    expect(() => client.ensureRuntimeProcessing({
      commandTimeoutMs: 1_000,
      orchestrationAttemptId: "web-ingress-attempt-test",
      userId: "user_123",
    })).toThrow("commandTimeoutMs must be greater than 1000");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an unconfigured base URL before issuing a request", () => {
    expect(() =>
      createCloudflareHostedControlClient({
        baseUrl: "   ",
        getBearerToken: async () => "token-123",
      }),
    ).toThrow("Hosted execution baseUrl must be configured.");
  });

  it("rejects a missing bearer token provider before issuing a request", () => {
    const options = {
      baseUrl: "https://runner.example.test",
      getBearerToken: async () => "token-123",
    } satisfies CloudflareHostedControlClientOptions;

    Object.defineProperty(options, "getBearerToken", { value: undefined });

    expect(() => createCloudflareHostedControlClient(options)).toThrow(
      "Hosted execution getBearerToken must be configured.",
    );
  });

  it("accepts a loopback HTTP base URL only when explicitly allowed", async () => {
    expect(() =>
      createCloudflareHostedControlClient({
        baseUrl: "http://127.0.0.1:8787",
        getBearerToken: async () => "token-123",
      }),
    ).toThrow(/HTTPS unless the host is explicitly allowlisted/u);

    const client = createCloudflareHostedControlClient({
      allowHttpLocalhost: true,
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: vi.fn(async () => createJsonResponse(createRunnerStatus())) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.getRunnerStatus("user_123")).resolves.toEqual(createRunnerStatus());
  });

  it("rejects blank user identifiers before issuing requests", () => {
    const fetchImpl = vi.fn(async () => createJsonResponse(createRunnerStatus())) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    expect(() => client.getRunnerStatus("  \t")).toThrow(
      "Cloudflare hosted control userId must not be blank.",
    );
    expect(() => client.deleteUserData("")).toThrow(
      "Cloudflare hosted control userId must not be blank.",
    );
    expect(() =>
      client.sendTelegramUsageLimitNotice({
        request: createTelegramUsageLimitNoticeRequest(),
        userId: "",
      })
    ).toThrow("Cloudflare hosted control userId must not be blank.");
    expect(() =>
      client.createBrowserVaultSession({
        browserPublicKeyJwk: {
          crv: "P-256",
          kty: "EC",
          x: "x-value",
          y: "y-value",
        },
        replicaRef: createReplicaRef(),
        userId: "\n",
      })
    ).toThrow("Cloudflare hosted control userId must not be blank.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts Telegram usage-limit notices to the user route and parses sent responses", async () => {
    let observedRequest: ObservedRequest | null = null;
    const events: string[] = [];
    const result = { status: "sent" as const };
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        events.push("fetch");
        observedRequest = { init, url: String(url) };
        return createJsonResponse(result);
      }) as typeof fetch,
      getBearerToken: async () => {
        events.push("token");
        return "Bearer token-123";
      },
      timeoutMs: 2_500,
    });
    const telegramRequest = createTelegramUsageLimitNoticeRequest();

    await expect(client.sendTelegramUsageLimitNotice({
      onRequestAttempted: () => {
        events.push("attempt");
      },
      request: telegramRequest,
      userId: "user_123",
    })).resolves.toEqual(result);

    expect(events).toEqual(["token", "attempt", "fetch"]);
    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe(
      "https://runner.example.test/root/internal/users/user_123/telegram/usage-limit-notice",
    );
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.body).toBe(JSON.stringify(telegramRequest));
  });

  it("does not issue Telegram usage-limit notice requests when authorization fails before fetch", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({ status: "sent" })) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl,
      getBearerToken: async () => {
        throw new Error("token unavailable");
      },
      timeoutMs: 2_500,
    });
    const onRequestAttempted = vi.fn();

    await expect(client.sendTelegramUsageLimitNotice({
      onRequestAttempted,
      request: createTelegramUsageLimitNoticeRequest(),
      userId: "user_123",
    })).rejects.toThrow("token unavailable");

    expect(onRequestAttempted).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("awaits Telegram usage-limit request-boundary callbacks before fetch", async () => {
    const events: string[] = [];
    const fetchImpl = vi.fn(async () => {
      events.push("fetch");
      return createJsonResponse({ status: "sent" });
    }) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.sendTelegramUsageLimitNotice({
      onRequestAttempted: async () => {
        events.push("attempt-start");
        await Promise.resolve();
        events.push("attempt-done");
      },
      request: createTelegramUsageLimitNoticeRequest(),
      userId: "user_123",
    })).resolves.toEqual({ status: "sent" });

    expect(events).toEqual(["attempt-start", "attempt-done", "fetch"]);
  });

  it("does not issue Telegram usage-limit notice requests when request-boundary callbacks fail", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({ status: "sent" })) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.sendTelegramUsageLimitNotice({
      onRequestAttempted: () => {
        throw new Error("claim unavailable");
      },
      request: createTelegramUsageLimitNoticeRequest(),
      userId: "user_123",
    })).rejects.toThrow("claim unavailable");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses retryable Telegram send failures as typed responses", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse({
          failureCode: "ASSISTANT_TELEGRAM_DELIVERY_FAILED",
          retryAfterSeconds: 42,
          retryable: true,
          status: "failed",
        })) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.sendTelegramUsageLimitNotice({
      request: createTelegramUsageLimitNoticeRequest(),
      userId: "user_123",
    })).resolves.toEqual({
      failureCode: "ASSISTANT_TELEGRAM_DELIVERY_FAILED",
      retryAfterSeconds: 42,
      retryable: true,
      status: "failed",
    });
  });

  it("does not echo HTTP response bodies in thrown errors", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl: vi.fn(async () =>
        new Response("provider_token=secret-value", { status: 500 })) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
    });
    const promise = client.getRunnerStatus("user_123");

    await expect(promise).rejects.toThrow("Hosted execution runner status failed with HTTP 500.");
    await expect(promise).rejects.not.toThrow(/provider_token/u);
    await promise.catch((error: unknown) => {
      expect(readCloudflareHostedControlHttpError(error)).toEqual({
        code: undefined,
        status: 500,
      });
    });
  });

  it("exposes structured HTTP error codes without response bodies", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl: vi.fn(async () =>
        createJsonResponse({
          code: "route_unavailable",
          error: "secret detail",
        }, { status: 503 })) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
    });

    const promise = client.getRunnerStatus("user_123");
    await expect(promise).rejects.toThrow(
      "Hosted execution runner status failed with HTTP 503.",
    );
    await promise.catch((error: unknown) => {
      expect(readCloudflareHostedControlHttpError(error)).toEqual({
        code: "route_unavailable",
        status: 503,
      });
      expect(String(error)).not.toContain("secret detail");
    });
  });

  it("fetches browser vault sessions with the expected request and parses ready replica responses", async () => {
    let observedRequest: ObservedRequest | null = null;
    const responseBody = createBrowserVaultSession({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: createReplicaRef(),
      state: "ready",
    });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(responseBody);
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    })).resolves.toEqual(responseBody);

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe("https://runner.example.test/root/internal/users/user_123/browser-vault/session");
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.body).toBe(JSON.stringify({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
    }));
  });

  it("requests and validates only the selected browser vault shards", async () => {
    let observedRequest: ObservedRequest | null = null;
    const replicaRef = createShardedReplicaRef();
    const responseBody = {
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      shards: {
        core: createEncryptedReplicaShard("core"),
        labs: createEncryptedReplicaShard("labs"),
      },
      state: "ready",
    };
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(responseBody);
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef,
      requestedShards: ["core", "labs"],
      userId: "user_123",
    })).resolves.toEqual(responseBody);

    expect(JSON.parse(String(requireObservedRequest(observedRequest).init?.body))).toEqual({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef,
      requestedShards: ["core", "labs"],
    });
  });

  it("requests and validates the exact selected browser vault metric buckets", async () => {
    let observedRequest: ObservedRequest | null = null;
    const replicaRef = createShardedReplicaRef();
    const responseBody = {
      metricBuckets: {
        "00": createEncryptedReplicaMetricBucket("00"),
        "1f": createEncryptedReplicaMetricBucket("1f"),
      },
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      shards: {
        metricsIndex: createEncryptedReplicaShard("metricsIndex"),
      },
      state: "ready",
    };
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(responseBody);
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef,
      requestedMetricBuckets: ["00", "1f"],
      requestedShards: ["metricsIndex"],
      userId: "user_123",
    })).resolves.toEqual(responseBody);

    expect(JSON.parse(String(requireObservedRequest(observedRequest).init?.body))).toEqual({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef,
      requestedMetricBuckets: ["00", "1f"],
      requestedShards: ["metricsIndex"],
    });
  });

  it("rejects browser vault metric bucket responses outside the exact requested set", async () => {
    const replicaRef = createShardedReplicaRef();
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse({
        metricBuckets: {
          "00": createEncryptedReplicaMetricBucket("00"),
          "01": createEncryptedReplicaMetricBucket("01"),
        },
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef,
        state: "ready",
      })) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef,
      requestedMetricBuckets: ["00"],
      userId: "user_123",
    })).rejects.toThrow(
      "metricBuckets must match requestedMetricBuckets exactly",
    );
  });

  it("rejects selected browser vault responses with a different logical generation", async () => {
    const replicaRef = createShardedReplicaRef();
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse({
        metricBuckets: {
          "00": createEncryptedReplicaMetricBucket("00"),
        },
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef: { ...replicaRef, generation: 2 },
        state: "ready",
      })) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef,
      requestedMetricBuckets: ["00"],
      userId: "user_123",
    })).rejects.toThrow(
      "replicaRef.generation must match the requested replicaRef.generation",
    );
  });

  it("uses a distinct export session purpose for the fixed full replica selection", async () => {
    let observedRequest: ObservedRequest | null = null;
    const replicaRef = createShardedReplicaRef();
    const responseBody = {
      metricBuckets: Object.fromEntries(
        HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.map((bucketId) => [
          bucketId,
          createEncryptedReplicaMetricBucket(bucketId),
        ]),
      ),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      shards: {
        core: createEncryptedReplicaShard("core"),
        labs: createEncryptedReplicaShard("labs"),
        metricsIndex: createEncryptedReplicaShard("metricsIndex"),
      },
      state: "ready",
    };
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(responseBody);
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.createBrowserVaultExportSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef,
      userId: "user_123",
    })).resolves.toEqual(responseBody);

    const body = JSON.parse(String(requireObservedRequest(observedRequest).init?.body));
    expect(body).toMatchObject({ replicaRef, sessionPurpose: "export" });
    expect(body).not.toHaveProperty("requestedMetricBuckets");
    expect(body).not.toHaveProperty("requestedShards");
  });

  it("accepts an old Worker legacy response for an export session", async () => {
    const replicaRef = createShardedReplicaRef();
    const responseBody = createBrowserVaultSession({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: createReplicaRef(),
      state: "ready",
    });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse(responseBody)) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.createBrowserVaultExportSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef,
      userId: "user_123",
    })).resolves.toEqual({
      ...responseBody,
      replicaRef,
    });
  });

  it("accepts a legacy browser-vault response for a shard-capable request against an old ref", async () => {
    const replicaRef = createReplicaRef();
    const responseBody = createBrowserVaultSession({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef,
      state: "ready",
    });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse(responseBody)) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef,
      requestedMetricBuckets: ["00"],
      requestedShards: ["core"],
      userId: "user_123",
    })).resolves.toEqual(responseBody);
  });

  it("accepts an old Worker legacy response that stripped additive shard refs", async () => {
    const replicaRef = createShardedReplicaRef();
    const responseBody = createBrowserVaultSession({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: createReplicaRef(),
      state: "ready",
    });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse(responseBody)) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef,
      requestedMetricBuckets: ["00"],
      requestedShards: ["core"],
      userId: "user_123",
    })).resolves.toEqual({
      ...responseBody,
      replicaRef,
    });
  });

  it("rejects empty, duplicate, and unsupported browser vault shard requests", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => {
        throw new Error("fetch must not run");
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
    });
    const base = {
      browserPublicKeyJwk: {
        crv: "P-256" as const,
        kty: "EC" as const,
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    };

    expect(() => client.createBrowserVaultSession({
      ...base,
      requestedShards: [],
    })).toThrow("requestedShards must be a non-empty array");
    expect(() => client.createBrowserVaultSession({
      ...base,
      requestedShards: ["core", "core"],
    })).toThrow("requestedShards must not contain duplicates");
    expect(() => Reflect.apply(client.createBrowserVaultSession, client, [{
      ...base,
      requestedShards: ["private"],
    }])).toThrow(
      "requestedShards[0] must be core, labs, or metricsIndex",
    );
  });

  it("rejects empty, duplicate, unsupported, and all-bucket interactive requests", () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => {
        throw new Error("fetch must not run");
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
    });
    const base = {
      browserPublicKeyJwk: {
        crv: "P-256" as const,
        kty: "EC" as const,
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    };

    expect(() => client.createBrowserVaultSession({
      ...base,
      requestedMetricBuckets: [],
    })).toThrow("requestedMetricBuckets must be a non-empty array");
    expect(() => client.createBrowserVaultSession({
      ...base,
      requestedMetricBuckets: ["00", "00"],
    })).toThrow("requestedMetricBuckets must not contain duplicates");
    expect(() => Reflect.apply(client.createBrowserVaultSession, client, [{
      ...base,
      requestedMetricBuckets: ["20"],
    }])).toThrow(
      "requestedMetricBuckets[0] must be a browser vault metric bucket id from 00 through 1f",
    );
    expect(() => client.createBrowserVaultSession({
      ...base,
      requestedMetricBuckets: HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
    })).toThrow("must not request all 32 buckets from the interactive session route");
  });

  it("rejects browser vault sessions that are not ready", async () => {
    const responseBody = createBrowserVaultSession({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      state: "empty",
    });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse(responseBody)) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    })).rejects.toThrow("Cloudflare browser vault session state must be ready.");
  });

  it("maps missing browser vault replica objects to a dedicated not-found error", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse({
          code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
          error: "Browser vault replica was not found.",
        }, { status: 404 })) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    const promise = client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    });

    await expect(promise).rejects.toBeInstanceOf(
      CloudflareHostedControlBrowserVaultReplicaNotFoundError,
    );
    await expect(promise).rejects.toThrow(
      "Hosted execution browser vault replica was not found.",
    );
  });

  it("leaves generic browser vault 404s as HTTP failures", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse({
          error: "Not found",
        }, { status: 404 })) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });
    const promise = client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    });

    await expect(promise).rejects.toThrow(
      "Hosted execution browser vault session failed with HTTP 404.",
    );
    await expect(promise).rejects.not.toThrow(
      "Hosted execution browser vault replica was not found.",
    );
  });

  for (const scenario of [
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: createReplicaAad(),
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: {
            ...createReplicaRef(),
            objectKey: "users/browser-vault-replicas/other/replica.json",
          },
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session replicaRef.objectKey must match the requested replicaRef.objectKey.",
      name: "returned replicaRef objectKey differs from the request",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: {
            ...createReplicaAad(),
            userId: "user_other",
          },
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message: "Cloudflare browser vault session replicaAad.userId must match the requested userId.",
      name: "replica AAD user differs from the request",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: {
            ...createReplicaAad(),
            sourceBundleHash: "b".repeat(64),
          },
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session replicaAad.sourceBundleHash must match the requested replicaRef.sourceBundleHash.",
      name: "replica AAD source bundle differs from the request",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: {
            ...createReplicaAad(),
            runtimeRootKeyId: "udrk:runtime:other-root",
          },
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message: "Cloudflare browser vault session replicaAad.runtimeRootKeyId must match the requested replicaRef.runtimeRootKeyId.",
      name: "replica AAD runtime root differs from the request",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: {
            ...createReplicaAad(),
            dataKeyId: "hdk:browser-vault-replica:other",
          },
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session replicaAad.dataKeyId must match the requested replicaRef.dataKeyEnvelope.dataKeyId.",
      name: "replica AAD data key differs from the request",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: {
            ...createReplicaEnvelope(),
            keyId: "browser-vault-replica:other",
          },
          replicaAad: createReplicaAad(),
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session encryptedReplica.keyId must match the requested replica storage key id.",
      name: "encrypted replica key differs from the request",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: {
            ...createReplicaEnvelope(),
            scope: "bundle",
          },
          replicaAad: createReplicaAad(),
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session encryptedReplica.scope must match the browser-vault-replica storage scope.",
      name: "encrypted replica scope is not browser-vault-replica",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: createReplicaAad(),
          replicaKeyEnvelope: {
            ...createReplicaKeyEnvelope(),
            userId: "user_other",
          },
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session replicaKeyEnvelope.userId must match the requested userId.",
      name: "key envelope user differs from the request",
    },
    {
      buildResponse: () => {
        const keyEnvelope = createReplicaKeyEnvelope();
        return createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: createReplicaAad(),
          replicaKeyEnvelope: {
            ...keyEnvelope,
            recipients: keyEnvelope.recipients.map((recipient) => ({
              ...recipient,
              keyId: "browser-vault-replica:other",
            })),
          },
          replicaRef: createReplicaRef(),
          state: "ready",
        });
      },
      message:
        "Cloudflare browser vault session replicaKeyEnvelope.recipients[0].keyId must match the requested replica storage key id.",
      name: "recipient key differs from the request",
    },
  ]) {
    it(`rejects ready browser vault sessions when ${scenario.name}`, async () => {
      const client = createCloudflareHostedControlClient({
        baseUrl: "https://runner.example.test/root/",
        fetchImpl: vi.fn(async () => createJsonResponse(scenario.buildResponse())) as typeof fetch,
        getBearerToken: async () => "token-123",
        timeoutMs: 2_500,
      });

      await expect(client.createBrowserVaultSession({
        browserPublicKeyJwk: {
          crv: "P-256",
          kty: "EC",
          x: "x-value",
          y: "y-value",
        },
        replicaRef: createReplicaRef(),
        userId: "user_123",
      })).rejects.toThrow(scenario.message);
    });
  }

  it("rejects ready browser vault sessions without a replica ref", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse({
        encryptedReplica: createReplicaEnvelope(),
        replicaAad: createReplicaAad(),
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef: null,
        state: "ready",
      })) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    })).rejects.toThrow("Cloudflare browser vault session replicaRef must not be null.");
  });

  it("rejects ready browser vault sessions that omit replica payload fields", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse({
        encryptedReplica: null,
        replicaAad: createReplicaAad(),
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef: createReplicaRef(),
        state: "ready",
      })) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    })).rejects.toThrow("Cloudflare browser vault session encryptedReplica must be an object.");
  });

  it("fetches runner status without a run record contract", async () => {
    let observedRequest: ObservedRequest | null = null;
    const status = createRunnerStatus({ userId: "user_123" });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(status);
      }) as typeof fetch,
      getBearerToken: async () => "  Bearer token-123  ",
      timeoutMs: 2_500,
    });

    await expect(client.getRunnerStatus("user_123")).resolves.toEqual(status);

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe("https://runner.example.test/root/internal/users/user_123/status");
    expect(request.init?.method).toBe("GET");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.redirect).toBe("error");
    expect(request.init?.signal).toBeInstanceOf(AbortSignal);
    expectNoRunContractFields(status);
  });

  it("rejects runner status responses for another user", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse(createRunnerStatus({ userId: "user_other" }))) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.getRunnerStatus("user_123")).rejects.toThrow(
      "Hosted runner status userId must match the requested userId.",
    );
  });

  it("rejects runner status responses with a workspace for another user", async () => {
    const status = createRunnerStatus({ userId: "user_123" });
    status.workspace.userId = "user_other";
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse(status)) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.getRunnerStatus("user_123")).rejects.toThrow(
      "Hosted runner status workspace.userId must match the requested userId.",
    );
  });

  it("posts user data deletion requests and validates the bound user in the response", async () => {
    let observedRequest: ObservedRequest | null = null;
    const result = createUserDataDeletionResult({ userId: "user_123" });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(result);
      }) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.deleteUserData("user_123")).resolves.toEqual(result);

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe("https://runner.example.test/root/internal/users/user_123/account-data/delete");
    expect(request.init?.method).toBe("POST");
    expect(request.init?.body).toBe("{}");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expectNoRunContractFields(result);
  });

  it("includes bearer-token acquisition in the user-data deletion deadline", async () => {
    const abort = new AbortController();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl,
      getBearerToken: () => new Promise(() => undefined),
      timeoutMs: 2_500,
    });
    const deletion = client.deleteUserData("user_123", {
      signal: abort.signal,
    });

    abort.abort(new Error("cleanup deadline reached"));

    await expect(deletion).rejects.toThrow("cleanup deadline reached");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the default timeout scoped to fetch when no caller signal is supplied", async () => {
    vi.useFakeTimers();
    let resolveBearerToken!: (token: string) => void;
    const bearerToken = new Promise<string>((resolve) => {
      resolveBearerToken = resolve;
    });
    const fetchImpl = vi.fn(async () =>
      createJsonResponse(createUserDataDeletionResult({ userId: "user_123" }))) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl,
      getBearerToken: () => bearerToken,
      timeoutMs: 50,
    });

    const outcome = client.deleteUserData("user_123").then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(100);

    expect(fetchImpl).not.toHaveBeenCalled();
    resolveBearerToken("token-123");
    await expect(outcome).resolves.toMatchObject({
      result: {
        ok: true,
        userId: "user_123",
      },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects user data deletion responses for another user", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse(createUserDataDeletionResult({ userId: "user_other" }))) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.deleteUserData("user_123")).rejects.toThrow(
      "Cloudflare user-data deletion result userId must match the requested userId.",
    );
  });

  it("rejects malformed user data deletion counts", async () => {
    const result = createUserDataDeletionResult({ userId: "user_123" });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse({
          ...result,
          r2: {
            ...result.r2,
            deletedObjectCount: -1,
          },
        })) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.deleteUserData("user_123")).rejects.toThrow(
      "Cloudflare user-data deletion result r2.deletedObjectCount must be a non-negative integer.",
    );
  });

  it("rejects legacy deletion responses without full Durable Object erasure evidence", async () => {
    const result = createUserDataDeletionResult({ userId: "user_123" });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse({
          ...result,
          durableObject: {
            alarmCleared: true,
            stateDeleted: true,
          },
        })) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.deleteUserData("user_123")).rejects.toThrow(
      "Cloudflare user-data deletion result durableObject.deleteAllCompleted must be a boolean.",
    );
  });

});

function createJsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(value), {
    ...init,
    headers,
    status: init.status ?? 200,
  });
}

function createTelegramUsageLimitNoticeRequest() {
  return {
    message: "quota reached",
    replyToMessageId: "7000",
    target: "telegram_thread:123",
  };
}

function requireObservedRequest(request: ObservedRequest | null): ObservedRequest {
  if (!request) {
    throw new Error("Expected the fetch mock to capture a request.");
  }

  return request;
}

function createBrowserVaultSession(input: {
  encryptedReplica: unknown;
  replicaAad: unknown;
  replicaKeyEnvelope: unknown;
  replicaRef: unknown;
  state: unknown;
}) {
  return {
    encryptedReplica: input.encryptedReplica,
    replicaAad: input.replicaAad,
    replicaKeyEnvelope: input.replicaKeyEnvelope,
    replicaRef: input.replicaRef,
    state: input.state,
  };
}

function createReplicaRef() {
  return {
    byteLength: 128,
    dataKeyEnvelope: {
      alg: "AES-256-GCM-HKDF-SHA256" as const,
      dataKeyId: "hdk:browser-vault-replica:d",
      domain: "runtime" as const,
      lane: "browser-vault-replica" as const,
      resource: {
        objectKey: "users/browser-vault-replicas/opaque/replica.json",
        purpose: "browser-vault-replica",
        userId: "user_123",
      },
      rootKeyId: "udrk:runtime:test-root",
      schema: "murph.hosted-data-key-envelope.v1" as const,
      wraps: [{
        ciphertext: "wrapped-data-key",
        iv: "wrap-iv",
        kind: "domain-root" as const,
        rootKeyId: "udrk:runtime:test-root",
      }],
    },
    dataVersion: "d".repeat(64),
    generatedAt: "2026-04-20T08:00:00.000Z",
    generation: 1,
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica" as const,
    schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    sourceBundleHash: "a".repeat(64),
  };
}

function createShardedReplicaRef(): HostedBrowserVaultReplicaRef {
  return {
    ...createReplicaRef(),
    metricBuckets: {
      bucketCount: 32 as const,
      buckets: Object.fromEntries(
        HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.map((bucketId) => [
          bucketId,
          createReplicaMetricBucketRef(bucketId),
        ]),
      ) as NonNullable<HostedBrowserVaultReplicaRef["metricBuckets"]>["buckets"],
      schema: HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
    },
    shards: {
      core: createReplicaShardRef("core"),
      labs: createReplicaShardRef("labs"),
      metricsIndex: createReplicaShardRef("metricsIndex"),
      schema: HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
    },
  };
}

function createReplicaShardRef(shard: "core" | "labs" | "metricsIndex") {
  return {
    byteLength: 512,
    contentEncoding: "gzip" as const,
    encodedByteLength: 128,
    objectKey: `users/browser-vault-replicas/opaque/replica.${shard}.json.gz`,
  };
}

function createEncryptedReplicaShard(shard: "core" | "labs" | "metricsIndex") {
  const shardSchema = shard === "metricsIndex"
    ? "murph.browser-vault-replica.metrics-index.v1"
    : `murph.browser-vault-replica.${shard}.v1`;
  return {
    encryptedShard: createReplicaEnvelope(),
    shardAad: {
      ...createReplicaAad(),
      byteLength: 512,
      contentEncoding: "gzip" as const,
      encodedByteLength: 128,
      generatedAt: "2026-04-20T08:00:00.000Z",
      generation: 1,
      objectKey: createReplicaShardRef(shard).objectKey,
      shard,
      shardSchema,
      shardSetRefSchema: HOSTED_BROWSER_VAULT_REPLICA_SHARD_SET_REF_SCHEMA,
    },
  };
}

function createReplicaMetricBucketRef(bucketId: HostedBrowserVaultReplicaMetricBucketId) {
  return {
    byteLength: 512,
    contentEncoding: "gzip" as const,
    encodedByteLength: 128,
    objectKey: `users/browser-vault-replicas/opaque/replica.metrics.${bucketId}.json.gz`,
  };
}

function createEncryptedReplicaMetricBucket(
  bucketId: HostedBrowserVaultReplicaMetricBucketId,
) {
  return {
    encryptedMetricBucket: createReplicaEnvelope(),
    metricBucketAad: {
      ...createReplicaAad(),
      byteLength: 512,
      contentEncoding: "gzip" as const,
      encodedByteLength: 128,
      generatedAt: "2026-04-20T08:00:00.000Z",
      generation: 1,
      metricBucketCount: 32,
      metricBucketId: bucketId,
      metricBucketSchema: "murph.browser-vault-replica.metric-bucket.v1",
      metricBucketSetRefSchema: HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_SET_REF_SCHEMA,
      objectKey: createReplicaMetricBucketRef(bucketId).objectKey,
    },
  };
}

function createReplicaAad() {
  return {
    dataKeyId: "hdk:browser-vault-replica:d",
    dataKeyRootKeyId: "udrk:runtime:test-root",
    dataVersion: "d".repeat(64),
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    purpose: "browser-vault-replica" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.browser-vault-replica" as const,
    sourceBundleHash: "a".repeat(64),
    userId: "user_123",
  };
}

function createReplicaEnvelope() {
  return {
    algorithm: "AES-GCM" as const,
    ciphertext: "ciphertext",
    iv: "iv",
    keyId: "hdk:browser-vault-replica:d",
    schema: "murph.hosted-cipher.v1",
    scope: "browser-vault-replica" as const,
  };
}

function createReplicaKeyEnvelope() {
  return {
    createdAt: "2026-04-20T08:00:00.000Z",
    keyId: "hdk:browser-vault-replica:d",
    purpose: "browser-vault-replica" as const,
    recipients: [
      {
        ciphertext: "ciphertext",
        ephemeralPublicKeyJwk: {
          crv: "P-256",
          kty: "EC",
          x: "ephemeral-x",
          y: "ephemeral-y",
        },
        iv: "iv",
        keyId: "hdk:browser-vault-replica:d",
        kind: "browser-session" as const,
      },
    ],
    schema: "murph.hosted-browser-session-key-envelope.v1" as const,
    userId: "user_123",
  };
}

function createUserDataDeletionResult(input: { userId: string }) {
  return {
    deletedAt: "2026-04-29T00:00:00.000Z",
    durableObject: {
      alarmCleared: true,
      deleteAllCompleted: true,
      stateDeleted: true,
    },
    ok: true,
    r2: {
      deletedObjectCount: 4,
      skippedUserScopedPrefixes: false,
      supported: true,
      userScopedSkipReason: null,
    },
    userId: input.userId,
  };
}

function createRunnerStatus(
  input: Partial<{
    heartbeatAt: string | null;
    inFlight: boolean;
    lastErrorAt: string | null;
    lastErrorCode: string | null;
    lastInvocationAt: string | null;
    nextAlarmAt: string | null;
    userId: string;
  }> = {},
) {
  return {
    heartbeatAt: input.heartbeatAt ?? "2026-04-26T00:00:01.000Z",
    inFlight: input.inFlight ?? false,
    lastErrorAt: input.lastErrorAt ?? null,
    lastErrorCode: input.lastErrorCode ?? null,
    lastInvocationAt: input.lastInvocationAt ?? null,
    mailboxLag: [
      {
        importedSeq: "2",
        lag: "1",
        lane: "conversation",
        maxSeq: "3",
      },
      {
        importedSeq: "1",
        lag: "0",
        lane: "system",
        maxSeq: "1",
      },
    ],
    nextAlarmAt: input.nextAlarmAt ?? null,
    recentLogs: [],
    userId: input.userId ?? "user_123",
    workspace: {
      checkpointedAt: "2026-04-26T00:00:00.000Z",
      createdAt: "2026-04-26T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: {
        importedConversationSeq: "2",
      },
      snapshotRef: null,
      updatedAt: "2026-04-26T00:00:00.000Z",
      userId: input.userId ?? "user_123",
      version: "4",
    },
  };
}

function expectNoRunContractFields(value: unknown): void {
  const disallowedKeys = new Set([
    "committedSeq",
    "requestedTargetSeq",
    "runId",
    "targetCommittedSeqHint",
    "targetSeq",
  ]);
  const keys = collectPropertyKeys(value);

  expect(keys.filter((key) => disallowedKeys.has(key))).toEqual([]);
}

function collectPropertyKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPropertyKeys(item));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => [
    key,
    ...collectPropertyKeys(nestedValue),
  ]);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
