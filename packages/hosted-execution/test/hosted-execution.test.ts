import { afterEach, describe as baseDescribe, expect, it, vi } from "vitest";
import { HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA } from "@murphai/runtime-state";

import {
  DEFAULT_HOSTED_EXECUTION_ARTIFACTS_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_COMMIT_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_EMAIL_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_SIDE_EFFECTS_BASE_URL,
  DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
  HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  buildHostedExecutionDispatchRef,
  buildHostedExecutionOutboxPayload,
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionGatewayMessageSendDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  buildHostedExecutionUserEnvPath,
  buildHostedExecutionUserKeyEnvelopePath,
  buildHostedExecutionUserKeyRecipientPath,
  buildHostedExecutionUserRunPath,
  buildHostedExecutionUserStatusPath,
  createHostedExecutionControlClient,
  createHostedExecutionDispatchClient,
  createHostedExecutionServerAiUsageClient,
  createHostedExecutionSignature,
  createHostedExecutionSignatureHeaders,
  buildHostedExecutionStructuredLogRecord,
  emitHostedExecutionStructuredLog,
  deriveHostedExecutionErrorCode,
  fetchHostedExecutionWebControlPlaneResponse,
  summarizeHostedExecutionError,
  HOSTED_EXECUTION_DISPATCH_PATH,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  parseHostedExecutionDispatchRequest,
  readHostedExecutionDispatchRef,
  readHostedEmailCapabilities,
  readHostedExecutionControlEnvironment,
  readHostedExecutionDispatchEnvironment,
  readHostedExecutionSignatureHeaders,
  readHostedExecutionOutboxPayload,
  parseHostedExecutionSideEffectRecord,
  readHostedExecutionWebControlPlaneEnvironment,
  readHostedExecutionWorkerEnvironment,
  normalizeHostedExecutionBaseUrl,
  normalizeHostedDeviceSyncJobHints,
  parseHostedExecutionUserStatus,
  resolveHostedDeviceSyncWakeContext,
  resolveHostedExecutionAiUsageClient,
  resolveHostedExecutionDeviceSyncRuntimeClient,
  resolveHostedExecutionDispatchLifecycle,
  resolveHostedExecutionDispatchOutcomeState,
  verifyHostedExecutionSignature,
} from "@murphai/hosted-execution";

const describe = baseDescribe.sequential;

describe("@murphai/hosted-execution", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates and verifies matching HMAC signatures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));

    const signature = await createHostedExecutionSignature({
      payload: "{\"ok\":true}",
      secret: "top-secret",
      timestamp: "2026-03-26T12:00:00.000Z",
    });

    await expect(
      verifyHostedExecutionSignature({
        payload: "{\"ok\":true}",
        secret: "top-secret",
        signature,
        timestamp: "2026-03-26T12:00:00.000Z",
      }),
    ).resolves.toBe(true);
  });

  it("reads and normalizes hosted execution signature headers", async () => {
    const headerValues = await createHostedExecutionSignatureHeaders({
      payload: "{\"ok\":true}",
      secret: "top-secret",
      timestamp: "2026-03-26T12:00:00.000Z",
    });
    const headers = new Headers(headerValues);
    const { signature, timestamp } = readHostedExecutionSignatureHeaders(headers);

    expect(timestamp).toBe("2026-03-26T12:00:00.000Z");
    await expect(
      verifyHostedExecutionSignature({
        payload: "{\"ok\":true}",
        secret: "top-secret",
        signature: `sha256=${String(signature).toUpperCase()}`,
        timestamp,
        nowMs: Date.parse("2026-03-26T12:00:00.000Z"),
      }),
    ).resolves.toBe(true);
  });

  it("rejects malformed signature hex", async () => {
    await expect(
      verifyHostedExecutionSignature({
        payload: "{\"ok\":true}",
        secret: "top-secret",
        signature: "sha256=not-hex",
        timestamp: "2026-03-26T12:00:00.000Z",
        nowMs: Date.parse("2026-03-26T12:00:00.000Z"),
      }),
    ).resolves.toBe(false);
  });

  it("rejects stale timestamps even when the signature matches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:05:01.000Z"));
    const timestamp = "2026-03-26T12:00:00.000Z";

    const signature = await createHostedExecutionSignature({
      payload: "{\"ok\":true}",
      secret: "top-secret",
      timestamp,
    });

    await expect(
      verifyHostedExecutionSignature({
        payload: "{\"ok\":true}",
        secret: "top-secret",
        signature,
        timestamp,
      }),
    ).resolves.toBe(false);
  });

  it("reads hosted dispatch env from the canonical names", () => {
    expect(
      readHostedExecutionDispatchEnvironment({
        HOSTED_EXECUTION_DISPATCH_URL: "https://dispatch.example.test/",
        HOSTED_EXECUTION_SIGNING_SECRET: "secret",
        HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS: "15000",
      }),
    ).toEqual({
      dispatchTimeoutMs: 15_000,
      dispatchUrl: "https://dispatch.example.test",
      signingSecret: "secret",
    });
  });

  it("reads hosted control env from the shared dispatch base and signing secret", () => {
    expect(
      readHostedExecutionControlEnvironment({
        HOSTED_EXECUTION_DISPATCH_URL: "https://dispatch.example.test/",
        HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
      }),
    ).toEqual({
      baseUrl: "https://dispatch.example.test",
      signingSecret: "dispatch-secret",
    });

    expect(
      readHostedExecutionControlEnvironment({
        HOSTED_EXECUTION_DISPATCH_URL: "   ",
        HOSTED_EXECUTION_SIGNING_SECRET: "   ",
      }),
    ).toEqual({
      baseUrl: null,
      signingSecret: null,
    });
  });

  it("reads hosted web control plane env from split internal, scheduler, and share settings", () => {
    expect(
      readHostedExecutionWebControlPlaneEnvironment({
        CRON_SECRET: "cron-token",
        HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://device-sync.example.test/",
        HOSTED_EXECUTION_INTERNAL_TOKENS: "internal-token",
        HOSTED_WEB_BASE_URL: "https://web.example.test/",
        HOSTED_SHARE_INTERNAL_TOKENS: "share-token",
      }),
    ).toEqual({
      deviceSyncRuntimeBaseUrl: DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
      usageBaseUrl: DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
    });

    expect(
      readHostedExecutionWebControlPlaneEnvironment({
        HOSTED_WEB_BASE_URL: "https://web.example.test/",
        HOSTED_SHARE_API_BASE_URL: "https://share.example.test/internal/",
      }),
    ).toEqual({
      deviceSyncRuntimeBaseUrl: DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
      usageBaseUrl: DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
    });
  });

  it("keeps hosted web control-plane callbacks bound to the worker proxy defaults", () => {
    expect(
      readHostedExecutionWebControlPlaneEnvironment({
        HOSTED_EXECUTION_INTERNAL_TOKENS: "internal-token",
        VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai",
      }),
    ).toEqual({
      deviceSyncRuntimeBaseUrl: DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
      usageBaseUrl: DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
    });
  });

  it("ignores invalid hosted web fallback env when proxy defaults are in use", () => {
    expect(
      readHostedExecutionWebControlPlaneEnvironment({
        VERCEL_PROJECT_PRODUCTION_URL: "http://www.withmurph.ai",
      }),
    ).toEqual({
      deviceSyncRuntimeBaseUrl: DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL,
      usageBaseUrl: DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL,
    });
  });

  it("reads hosted worker env defaults from the canonical signing-secret name", () => {
    expect(
      readHostedExecutionWorkerEnvironment({
        HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "OPENAI_API_KEY",
        HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: "Zm9v",
        HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
      }),
    ).toEqual({
      allowedUserEnvKeys: "OPENAI_API_KEY",
      bundleEncryptionKeyBase64: "Zm9v",
      bundleEncryptionKeyId: "v1",
      bundleEncryptionKeyringJson: null,
      defaultAlarmDelayMs: 15 * 60 * 1000,
      dispatchSigningSecret: "dispatch-secret",
      maxEventAttempts: 3,
      retryDelayMs: 30_000,
      runnerTimeoutMs: 60_000,
    });
  });

  it("parses hosted execution user status run traces when present", () => {
    expect(parseHostedExecutionUserStatus({
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastErrorAt: "2026-03-26T12:00:01.000Z",
      lastErrorCode: "runner_http_error",
      lastEventId: "evt_trace",
      lastRunAt: "2026-03-26T12:00:00.000Z",
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      run: {
        attempt: 2,
        eventId: "evt_trace",
        phase: "retry.scheduled",
        runId: "run_trace",
        startedAt: "2026-03-26T12:00:00.000Z",
        updatedAt: "2026-03-26T12:00:01.000Z",
      },
      timeline: [
        {
          at: "2026-03-26T12:00:00.000Z",
          attempt: 2,
          component: "runner",
          eventId: "evt_trace",
          level: "info",
          message: "Hosted dispatch claimed for execution.",
          phase: "claimed",
          runId: "run_trace",
        },
        {
          at: "2026-03-26T12:00:01.000Z",
          attempt: 2,
          component: "runner",
          errorCode: "runner_http_error",
          eventId: "evt_trace",
          level: "warn",
          message: "Hosted dispatch scheduled a retry.",
          phase: "retry.scheduled",
          runId: "run_trace",
        },
      ],
      userId: "user-123",
    })).toMatchObject({
      lastErrorAt: "2026-03-26T12:00:01.000Z",
      lastErrorCode: "runner_http_error",
      run: {
        attempt: 2,
        eventId: "evt_trace",
        phase: "retry.scheduled",
        runId: "run_trace",
      },
      timeline: [
        {
          phase: "claimed",
          runId: "run_trace",
        },
        {
          errorCode: "runner_http_error",
          phase: "retry.scheduled",
        },
      ],
      userId: "user-123",
    });
  });


  it("derives stable hosted execution error codes and structured logs", () => {
    const error = new Error("Hosted runner container returned HTTP 503.");

    expect(deriveHostedExecutionErrorCode(error)).toBe("runner_http_error");
    expect(buildHostedExecutionStructuredLogRecord({
      component: "container",
      dispatch: {
        event: {
          userId: "user-123",
        },
        eventId: "evt_trace",
      },
      error,
      level: "warn",
      message: "Hosted execution container failed.",
      phase: "failed",
      run: {
        attempt: 3,
        runId: "run_trace",
        startedAt: "2026-03-26T12:00:00.000Z",
      },
      time: "2026-03-26T12:00:01.000Z",
    })).toEqual({
      attempt: 3,
      component: "container",
      errorCode: "runner_http_error",
      errorMessage: "Hosted runner container returned HTTP 503.",
      errorName: "Error",
      eventId: "evt_trace",
      level: "warn",
      message: "Hosted execution container failed.",
      phase: "failed",
      runId: "run_trace",
      schema: "murph.hosted-execution.log.v1",
      time: "2026-03-26T12:00:01.000Z",
      userId: null,
    });
  });

  it("redacts sensitive structured log fields and falls back to safe summaries", () => {
    const error = new Error(
      "Authorization: Bearer secret-token email ops@example.com OPENAI_API_KEY=sk-live-secret",
    );
    error.name = "sk_live_secret_name";

    expect(summarizeHostedExecutionError(error)).toBe("Hosted execution authorization failed.");
    expect(buildHostedExecutionStructuredLogRecord({
      component: "worker",
      dispatch: {
        event: {
          userId: "user-123",
        },
        eventId: "evt_secret",
      },
      error,
      level: "error",
      message: "Authorization: Bearer secret-token for ops@example.com",
      phase: "failed",
      run: {
        attempt: 1,
        runId: "run_secret",
        startedAt: "2026-03-26T12:00:00.000Z",
      },
      time: "2026-03-26T12:00:01.000Z",
    })).toEqual({
      attempt: 1,
      component: "worker",
      errorCode: "authorization_error",
      errorMessage: "Hosted execution authorization failed.",
      eventId: "evt_secret",
      level: "error",
      message: "Authorization=Bearer [redacted] for [redacted-email]",
      phase: "failed",
      runId: "run_secret",
      schema: "murph.hosted-execution.log.v1",
      time: "2026-03-26T12:00:01.000Z",
      userId: null,
    });
  });

  it("keeps runtime exception summaries generic unless the message matches request validation", () => {
    const runtimeTypeError = new TypeError("missing hosted runtime config");
    const invalidRequestError = new SyntaxError("Request body must be a JSON object.");

    expect(deriveHostedExecutionErrorCode(runtimeTypeError)).toBe("type_error");
    expect(summarizeHostedExecutionError(runtimeTypeError)).toBe("Hosted execution runtime failed.");
    expect(deriveHostedExecutionErrorCode(invalidRequestError)).toBe("invalid_request");
    expect(summarizeHostedExecutionError(invalidRequestError)).toBe(
      "Hosted execution rejected an invalid request.",
    );
  });

  it("collapses secret-bearing configuration errors to a generic safe summary", () => {
    const error = new Error("Hosted API key sk-live-secret must be configured.");
    error.name = "HostedExecutionConfigurationError";

    expect(summarizeHostedExecutionError(error)).toBe("Hosted execution configuration is invalid.");
    const record = buildHostedExecutionStructuredLogRecord({
      component: "worker",
      error,
      message: "Hosted worker route failed.",
      phase: "failed",
    });
    expect(record.errorCode).toBe("configuration_error");
    expect(record.errorMessage).toBe("Hosted execution configuration is invalid.");
    expect(JSON.stringify(record)).not.toContain("sk-live-secret");
  });

  it("suppresses hosted structured stdio logs during Vitest unless explicitly overridden", () => {
    const originalVitest = process.env.VITEST;
    const originalStdIoLogs = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      process.env.VITEST = "true";
      delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;

      const quietRecord = emitHostedExecutionStructuredLog({
        component: "worker",
        message: "Hosted worker route started.",
        phase: "started",
        time: "2026-03-26T12:00:01.000Z",
      });

      expect(infoSpy).not.toHaveBeenCalled();
      expect(quietRecord.message).toBe("Hosted worker route started.");

      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "true";

      emitHostedExecutionStructuredLog({
        component: "worker",
        message: "Hosted worker route started.",
        phase: "started",
        time: "2026-03-26T12:00:02.000Z",
      });

      expect(infoSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (originalVitest === undefined) {
        delete process.env.VITEST;
      } else {
        process.env.VITEST = originalVitest;
      }

      if (originalStdIoLogs === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = originalStdIoLogs;
      }
    }
  });

  it("sends the bound hosted execution user header when recording hosted AI usage", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        recorded: 1,
        usageIds: ["usage_123"],
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      }));
    global.fetch = fetchMock;
    const client = createHostedExecutionServerAiUsageClient({
      baseUrl: "https://join.example.test",
      boundUserId: "member_123",
      internalToken: "  internal-token  ",
      timeoutMs: 10_000,
    });

    await expect(
      client.recordUsage([
        {
          usageId: "usage_123",
        },
      ]),
    ).resolves.toEqual({
      recorded: 1,
      usageIds: ["usage_123"],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://join.example.test/api/internal/hosted-execution/usage/record",
      expect.objectContaining({
        headers: expect.any(Headers),
        method: "POST",
      }),
    );
    const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers;
    expect(requestHeaders).toBeInstanceOf(Headers);
    expect((requestHeaders as Headers).get("authorization")).toBe("Bearer internal-token");
    expect((requestHeaders as Headers).get("content-type")).toBe("application/json");
    expect((requestHeaders as Headers).get("x-hosted-execution-user-id")).toBe("member_123");
  });

  it("shares one strict hosted web-control fetch policy helper", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await fetchHostedExecutionWebControlPlaneResponse({
      authorizationToken: "  internal-token  ",
      baseUrl: "https://join.example.test/",
      body: "{\"ok\":true}",
      boundUserId: "member_123",
      fetchImpl,
      method: "POST",
      path: "/api/internal/device-sync/runtime/snapshot",
      search: "?provider=oura",
      timeoutMs: 45_000,
    });

    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://join.example.test/api/internal/device-sync/runtime/snapshot?provider=oura",
      expect.objectContaining({
        body: "{\"ok\":true}",
        headers: expect.any(Headers),
        method: "POST",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );

    const requestHeaders = fetchImpl.mock.calls[0]?.[1]?.headers;
    expect(requestHeaders).toBeInstanceOf(Headers);
    expect((requestHeaders as Headers).get("authorization")).toBe("Bearer internal-token");
    expect((requestHeaders as Headers).get("content-type")).toBe("application/json");
    expect((requestHeaders as Headers).get("x-hosted-execution-user-id")).toBe("member_123");
  });

  it("resolves proxy device-sync clients from worker proxy urls without requiring server auth", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        connections: [],
        generatedAt: "2026-03-29T10:00:00.000Z",
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      }));
    global.fetch = fetchMock;
    const client = resolveHostedExecutionDeviceSyncRuntimeClient({
      baseUrl: "http://device-sync.worker",
      boundUserId: "member_123",
      timeoutMs: 10_000,
    });

    expect(client).not.toBeNull();
    if (!client) {
      throw new Error("Expected a device-sync runtime client.");
    }

    await expect(client.fetchSnapshot()).resolves.toEqual({
      connections: [],
      generatedAt: "2026-03-29T10:00:00.000Z",
      userId: "member_123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://device-sync.worker/api/internal/device-sync/runtime/snapshot",
      expect.objectContaining({
        headers: expect.any(Headers),
        method: "POST",
      }),
    );
    const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers;
    expect(requestHeaders).toBeInstanceOf(Headers);
    expect((requestHeaders as Headers).get("authorization")).toBeNull();
    expect((requestHeaders as Headers).get("content-type")).toBe("application/json");
    expect((requestHeaders as Headers).get("x-hosted-execution-user-id")).toBe("member_123");
  });

  it("keeps direct hosted web-control client resolution strict about authorization tokens", () => {
    expect(() =>
      resolveHostedExecutionAiUsageClient({
        baseUrl: "https://join.example.test",
        boundUserId: "member_123",
        internalToken: "   ",
      }),
    ).toThrow(/authorization token must be configured/u);
  });

  it("exports the shared hosted callback hosts and default callback base urls", () => {
    expect(HOSTED_EXECUTION_CALLBACK_HOSTS).toEqual({
      artifacts: "artifacts.worker",
      commit: "commit.worker",
      email: "email.worker",
      sideEffects: "side-effects.worker",
    });
    expect(DEFAULT_HOSTED_EXECUTION_ARTIFACTS_BASE_URL).toBe("http://artifacts.worker");
    expect(DEFAULT_HOSTED_EXECUTION_COMMIT_BASE_URL).toBe("http://commit.worker");
    expect(DEFAULT_HOSTED_EXECUTION_EMAIL_BASE_URL).toBe("http://email.worker");
    expect(DEFAULT_HOSTED_EXECUTION_SIDE_EFFECTS_BASE_URL).toBe("http://side-effects.worker");
  });

  it("reads hosted email capabilities with separate ingress and send readiness", () => {
    expect(
      readHostedEmailCapabilities({
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_LOCAL_PART: "assistant",
        HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
      }),
    ).toEqual({
      ingressReady: true,
      sendReady: false,
      senderIdentity: "assistant@mail.example.test",
    });

    expect(
      readHostedEmailCapabilities({
        HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
        HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_FROM_ADDRESS: "Hosted Sender <assistant@mail.example.test>",
        HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
      }),
    ).toEqual({
      ingressReady: true,
      sendReady: true,
      senderIdentity: "assistant@mail.example.test",
    });

    expect(
      readHostedEmailCapabilities({
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_LOCAL_PART: "assistant",
        HOSTED_EMAIL_SEND_READY: "true",
        HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
      }),
    ).toEqual({
      ingressReady: true,
      sendReady: true,
      senderIdentity: "assistant@mail.example.test",
    });

    expect(
      readHostedEmailCapabilities({
        HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
        HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
        HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
        HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
      }),
    ).toEqual({
      ingressReady: false,
      sendReady: false,
      senderIdentity: "assistant@mail.example.test",
    });
  });

  it("round-trips hosted email dispatches through the shared builder and parser", () => {
    expect(parseHostedExecutionDispatchRequest(
      buildHostedExecutionEmailMessageReceivedDispatch({
        eventId: "email:raw_email_123",
        identityId: "assistant@mail.example.test",
        occurredAt: "2026-03-28T09:00:00.000Z",
        rawMessageKey: "raw_email_123",
        userId: "member_123",
      }),
    )).toEqual({
      event: {
        identityId: "assistant@mail.example.test",
        kind: "email.message.received",
        rawMessageKey: "raw_email_123",
        userId: "member_123",
      },
      eventId: "email:raw_email_123",
      occurredAt: "2026-03-28T09:00:00.000Z",
    });
  });

  it("round-trips hosted Telegram dispatches through the shared builder and parser", () => {
    expect(parseHostedExecutionDispatchRequest(
      buildHostedExecutionTelegramMessageReceivedDispatch({
        botUserId: "999",
        eventId: "telegram:update:123",
        occurredAt: "2026-03-28T09:05:00.000Z",
        telegramUpdate: {
          message: {
            chat: {
              id: 123,
              type: "private",
            },
            date: 1_774_528_300,
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 1,
            text: "hello from Telegram",
          },
          update_id: 123,
        },
        userId: "member_123",
      }),
    )).toEqual({
      event: {
        botUserId: "999",
        kind: "telegram.message.received",
        telegramUpdate: {
          message: {
            chat: {
              id: 123,
              type: "private",
            },
            date: 1_774_528_300,
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 1,
            text: "hello from Telegram",
          },
          update_id: 123,
        },
        userId: "member_123",
      },
      eventId: "telegram:update:123",
      occurredAt: "2026-03-28T09:05:00.000Z",
    });
  });

  it("round-trips hosted gateway sends through the shared builder and parser", () => {
    expect(parseHostedExecutionDispatchRequest(
      buildHostedExecutionGatewayMessageSendDispatch({
        clientRequestId: "req-123",
        eventId: "gateway-send:abc123",
        occurredAt: "2026-03-31T09:15:00.000Z",
        replyToMessageId: "5001",
        sessionKey: "gwcs_example",
        text: "Please follow up.",
        userId: "member_123",
      }),
    )).toEqual({
      event: {
        clientRequestId: "req-123",
        kind: "gateway.message.send",
        replyToMessageId: "5001",
        sessionKey: "gwcs_example",
        text: "Please follow up.",
        userId: "member_123",
      },
      eventId: "gateway-send:abc123",
      occurredAt: "2026-03-31T09:15:00.000Z",
    });
  });

  it("builds minimized dispatch refs and only reads current-schema refs when storage is explicit", () => {
    const dispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email:raw_email_123",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-03-28T09:00:00.000Z",
      rawMessageKey: "raw_email_123",
      userId: "member_123",
    });
    const dispatchRef = buildHostedExecutionDispatchRef(dispatch);

    expect(readHostedExecutionDispatchRef(
      {
        dispatchRef,
        schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
      },
    )).toBeNull();
    expect(readHostedExecutionDispatchRef(
      {
        dispatchRef,
        schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
        storage: "reference",
      },
    )).toEqual(dispatchRef);
    expect(dispatchRef).toEqual({
      eventId: "email:raw_email_123",
      eventKind: "email.message.received",
      occurredAt: "2026-03-28T09:00:00.000Z",
      userId: "member_123",
    });
  });

  it("rejects incomplete stored dispatch refs instead of backfilling them", () => {
    expect(readHostedExecutionDispatchRef(
      {
        dispatchRef: {
          eventId: "email:raw_email_123",
          eventKind: "email.message.received",
          occurredAt: "2026-03-28T09:00:00.000Z",
        },
        schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
        storage: "reference",
      },
    )).toBeNull();
  });

  it("builds and reads inline and reference outbox payloads", () => {
    const inlineDispatch = buildHostedExecutionAssistantCronTickDispatch({
      eventId: "evt_cron",
      occurredAt: "2026-03-28T09:10:00.000Z",
      reason: "manual",
      userId: "member_123",
    });
    const referenceDispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email:raw_email_456",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-03-28T09:15:00.000Z",
      rawMessageKey: "raw_email_456",
      userId: "member_123",
    });

    const inlinePayload = buildHostedExecutionOutboxPayload(inlineDispatch);
    const referencePayload = buildHostedExecutionOutboxPayload(referenceDispatch);

    expect(inlinePayload).toEqual({
      dispatch: inlineDispatch,
      schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
      storage: "inline",
    });
    expect(referencePayload).toEqual({
      dispatchRef: buildHostedExecutionDispatchRef(referenceDispatch),
      schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
      storage: "reference",
    });
    expect(
      readHostedExecutionOutboxPayload(inlinePayload),
    ).toEqual(inlinePayload);
    expect(
      readHostedExecutionOutboxPayload(referencePayload),
    ).toEqual(referencePayload);
  });

  it("rejects hosted assistant delivery side effects without idempotency keys", () => {
    expect(() => parseHostedExecutionSideEffectRecord({
      delivery: {
        channel: "telegram",
        messageLength: 12,
        sentAt: "2026-03-28T10:00:00.000Z",
        target: "chat_123",
        targetKind: "explicit",
      },
      effectId: "outbox_intent_123",
      fingerprint: "dedupe_123",
      intentId: "outbox_intent_123",
      kind: "assistant.delivery",
      recordedAt: "2026-03-28T10:00:00.000Z",
      state: "sent",
    })).toThrow("Hosted assistant side effect record delivery.idempotencyKey must be a non-empty string.");
  });

  it("parses hosted assistant delivery side effects with explicit idempotency keys", () => {
    const record = parseHostedExecutionSideEffectRecord({
      delivery: {
        channel: "telegram",
        idempotencyKey: "assistant-outbox:intent_123",
        messageLength: 12,
        sentAt: "2026-03-28T10:00:00.000Z",
        target: "chat_123",
        targetKind: "explicit",
      },
      effectId: "outbox_intent_123",
      fingerprint: "dedupe_123",
      intentId: "outbox_intent_123",
      kind: "assistant.delivery",
      recordedAt: "2026-03-28T10:00:00.000Z",
      state: "sent",
    });

    expect(record.delivery.idempotencyKey).toBe("assistant-outbox:intent_123");
  });

  it("rejects empty hosted assistant delivery idempotency keys", () => {
    expect(() => parseHostedExecutionSideEffectRecord({
      delivery: {
        channel: "telegram",
        idempotencyKey: "",
        messageLength: 12,
        sentAt: "2026-03-28T10:00:00.000Z",
        target: "chat_123",
        targetKind: "explicit",
      },
      effectId: "outbox_intent_123",
      fingerprint: "dedupe_123",
      intentId: "outbox_intent_123",
      kind: "assistant.delivery",
      recordedAt: "2026-03-28T10:00:00.000Z",
      state: "sent",
    })).toThrow("Hosted assistant side effect record delivery.idempotencyKey must be a non-empty string.");
  });

  it("centralizes dispatch outcome and lifecycle mapping", () => {
    expect(
      resolveHostedExecutionDispatchOutcomeState({
        initialState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
        nextState: {
          backpressured: false,
          consumed: true,
          lastError: null,
          pending: false,
          poisoned: false,
        },
      }),
    ).toBe("completed");

    expect(
      resolveHostedExecutionDispatchLifecycle({
        event: {
          eventId: "evt_queued",
          lastError: null,
          state: "queued",
          userId: "member_123",
        },
        status: {
          backpressuredEventIds: [],
          bundleRefs: {
            agentState: null,
            vault: null,
          },
          inFlight: false,
          lastError: null,
          lastEventId: "evt_queued",
          lastRunAt: null,
          nextWakeAt: null,
          pendingEventCount: 1,
          poisonedEventIds: [],
          retryingEventId: null,
          userId: "member_123",
        },
      }),
    ).toEqual({
      lastError: null,
      status: "accepted",
    });

    expect(
      resolveHostedExecutionDispatchLifecycle({
        event: {
          eventId: "evt_poisoned",
          lastError: null,
          state: "poisoned",
          userId: "member_123",
        },
        status: {
          backpressuredEventIds: [],
          bundleRefs: {
            agentState: null,
            vault: null,
          },
          inFlight: false,
          lastError: "runner failed repeatedly",
          lastEventId: "evt_poisoned",
          lastRunAt: null,
          nextWakeAt: null,
          pendingEventCount: 0,
          poisonedEventIds: ["evt_poisoned"],
          retryingEventId: null,
          userId: "member_123",
        },
      }),
    ).toEqual({
      lastError: "runner failed repeatedly",
      status: "failed",
    });

    expect(
      resolveHostedExecutionDispatchOutcomeState({
        initialState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
        nextState: {
          backpressured: true,
          consumed: false,
          lastError: "slow lane",
          pending: false,
          poisoned: false,
        },
      }),
    ).toBe("backpressured");

    expect(
      resolveHostedExecutionDispatchOutcomeState({
        initialState: {
          backpressured: false,
          consumed: true,
          lastError: null,
          pending: false,
          poisoned: false,
        },
        nextState: {
          backpressured: false,
          consumed: true,
          lastError: null,
          pending: false,
          poisoned: false,
        },
      }),
    ).toBe("duplicate_consumed");

    expect(
      resolveHostedExecutionDispatchOutcomeState({
        initialState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: true,
          poisoned: false,
        },
        nextState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: true,
          poisoned: false,
        },
      }),
    ).toBe("duplicate_pending");

    expect(
      resolveHostedExecutionDispatchOutcomeState({
        initialState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
        nextState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
      }),
    ).toBe("queued");

    expect(
      resolveHostedExecutionDispatchLifecycle({
        event: {
          eventId: "evt_duplicate",
          lastError: "ignored",
          state: "duplicate_consumed",
          userId: "member_123",
        },
        status: {
          backpressuredEventIds: [],
          bundleRefs: {
            agentState: null,
            vault: null,
          },
          inFlight: false,
          lastError: null,
          lastEventId: "evt_duplicate",
          lastRunAt: null,
          nextWakeAt: null,
          pendingEventCount: 0,
          poisonedEventIds: [],
          retryingEventId: null,
          userId: "member_123",
        },
      }),
    ).toEqual({
      lastError: null,
      status: "completed",
    });

    expect(
      resolveHostedExecutionDispatchLifecycle({
        event: {
          eventId: "evt_backpressured",
          lastError: "runner busy",
          state: "backpressured",
          userId: "member_123",
        },
        status: {
          backpressuredEventIds: ["evt_backpressured"],
          bundleRefs: {
            agentState: null,
            vault: null,
          },
          inFlight: true,
          lastError: "runner busy",
          lastEventId: "evt_backpressured",
          lastRunAt: null,
          nextWakeAt: "2026-03-28T10:00:00.000Z",
          pendingEventCount: 1,
          poisonedEventIds: [],
          retryingEventId: "evt_backpressured",
          userId: "member_123",
        },
      }),
    ).toEqual({
      lastError: "runner busy",
      status: "pending",
    });

    expect(
      resolveHostedExecutionDispatchLifecycle({
        event: {
          eventId: "evt_config",
          lastError: null,
          state: "duplicate_pending",
          userId: "member_123",
        },
        status: {
          backpressuredEventIds: [],
          bundleRefs: {
            agentState: null,
            vault: null,
          },
          inFlight: false,
          lastError: "Hosted execution dispatch is not configured.",
          lastEventId: "evt_config",
          lastRunAt: null,
          nextWakeAt: null,
          pendingEventCount: 1,
          poisonedEventIds: [],
          retryingEventId: null,
          userId: "member_123",
        },
      }),
    ).toEqual({
      lastError: "Hosted execution dispatch is not configured.",
      status: "pending",
    });
  });

  it("does not accept the removed Cloudflare signing-secret alias", () => {
    expect(() =>
      readHostedExecutionWorkerEnvironment({
        HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: "Zm9v",
        HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "dispatch-secret",
      } as Record<string, string>),
    ).toThrow(/HOSTED_EXECUTION_SIGNING_SECRET/u);
  });

  it("builds stable encoded user control paths", () => {
    expect(HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH).toBe(
      "/api/internal/device-sync/runtime/snapshot",
    );
    expect(HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH).toBe(
      "/api/internal/device-sync/runtime/apply",
    );
    expect(buildHostedExecutionUserStatusPath("member/123")).toBe("/internal/users/member%2F123/status");
    expect(buildHostedExecutionUserRunPath("member/123")).toBe("/internal/users/member%2F123/run");
    expect(buildHostedExecutionUserEnvPath("member/123")).toBe("/internal/users/member%2F123/env");
    expect(
      buildHostedExecutionUserKeyEnvelopePath("member/123"),
    ).toBe(
      "/internal/users/member%2F123/keys/envelope",
    );
    expect(
      buildHostedExecutionUserKeyRecipientPath("member/123", "user/unlock"),
    ).toBe(
      "/internal/users/member%2F123/keys/recipients/user%2Funlock",
    );
  });

  it("rejects unsafe hosted base urls and only allows explicit internal HTTP exceptions", () => {
    expect(() => normalizeHostedExecutionBaseUrl("http://join.example.test")).toThrow(
      /must use HTTPS/i,
    );
    expect(() => normalizeHostedExecutionBaseUrl("https://user:pass@join.example.test")).toThrow(
      /must not include embedded credentials/i,
    );
    expect(
      normalizeHostedExecutionBaseUrl("http://device-sync.worker/path", {
        allowHttpHosts: ["device-sync.worker"],
      }),
    ).toBe("http://device-sync.worker/path");
    expect(
      normalizeHostedExecutionBaseUrl("http://127.0.0.1:8787/path", {
        allowHttpLocalhost: true,
      }),
    ).toBe("http://127.0.0.1:8787/path");
  });

  it("normalizes device-sync wake helpers for hosted execution", () => {
    expect(
      resolveHostedDeviceSyncWakeContext({
        kind: "device-sync.wake",
        reason: "webhook_hint",
        userId: "member_123",
      }),
    ).toEqual({
      connectionId: null,
      hint: null,
      provider: null,
    });

    expect(
      resolveHostedDeviceSyncWakeContext({
        connectionId: "conn_123",
        hint: {
          eventType: "sleep.updated",
          jobs: [
            {
              availableAt: "2026-03-28T11:00:00.000Z",
              dedupeKey: "job:1",
              kind: "oura.reconcile",
              maxAttempts: 5,
              payload: {
                source: "webhook",
              },
              priority: 3,
            },
            {
              dedupeKey: null,
              kind: "oura.refresh",
            },
          ],
          reason: "webhook",
        },
        kind: "device-sync.wake",
        provider: "oura",
        reason: "webhook_hint",
        userId: "member_123",
      }),
    ).toEqual({
      connectionId: "conn_123",
      hint: {
        eventType: "sleep.updated",
        jobs: [
          {
            availableAt: "2026-03-28T11:00:00.000Z",
            dedupeKey: "job:1",
            kind: "oura.reconcile",
            maxAttempts: 5,
            payload: {
              source: "webhook",
            },
            priority: 3,
          },
          {
            dedupeKey: null,
            kind: "oura.refresh",
          },
        ],
        reason: "webhook",
      },
      provider: "oura",
    });

    expect(
      normalizeHostedDeviceSyncJobHints({
        jobs: [
          {
            availableAt: "2026-03-28T11:00:00.000Z",
            dedupeKey: "job:1",
            kind: "oura.reconcile",
            maxAttempts: 5,
            payload: {
              source: "webhook",
            },
            priority: 3,
          },
          {
            dedupeKey: null,
            kind: "oura.refresh",
          },
        ],
      }),
    ).toEqual([
      {
        availableAt: "2026-03-28T11:00:00.000Z",
        dedupeKey: "job:1",
        kind: "oura.reconcile",
        maxAttempts: 5,
        payload: {
          source: "webhook",
        },
        priority: 3,
      },
      {
        dedupeKey: null,
        kind: "oura.refresh",
      },
    ]);
    expect(normalizeHostedDeviceSyncJobHints(null)).toEqual([]);
  });

  it("dispatch client signs payloads and posts to the shared dispatch route", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T09:15:00.000Z"));
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(buildDispatchResultFixture("evt_123")),
        { status: 200 },
      ),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const client = createHostedExecutionDispatchClient({
      baseUrl: "https://runner.example.test/",
      fetchImpl,
      signingSecret: "secret",
      timeoutMs: 45_000,
    });

    await client.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "user-123",
      },
      eventId: "evt_123",
      occurredAt: "2026-03-20T12:00:00.000Z",
    });

    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    const payload = typeof init?.body === "string" ? init.body : "";

    expect(url).toBe(`https://runner.example.test${HOSTED_EXECUTION_DISPATCH_PATH}`);
    expect(headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER)).toBe("2026-03-27T09:15:00.000Z");
    await expect(
      verifyHostedExecutionSignature({
        method: "POST",
        path: HOSTED_EXECUTION_DISPATCH_PATH,
        payload,
        secret: "secret",
        signature: headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER),
        timestamp: headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
        nowMs: Date.parse("2026-03-27T09:15:00.000Z"),
      }),
    ).resolves.toBe(true);
  });

  it("requires a configured baseUrl for shared clients", () => {
    expect(() =>
      createHostedExecutionDispatchClient({
        baseUrl: "   ",
        signingSecret: "secret",
      }),
    ).toThrow("Hosted execution baseUrl must be configured.");
    expect(() =>
      createHostedExecutionControlClient({
        baseUrl: "   ",
      }),
    ).toThrow("Hosted execution baseUrl must be configured.");
  });

  it("dispatch client omits the timeout signal when no override is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(buildDispatchResultFixture("evt_123")),
        { status: 200 },
      ),
    );
    const client = createHostedExecutionDispatchClient({
      baseUrl: "https://runner.example.test/",
      fetchImpl,
      signingSecret: "secret",
    });

    await client.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "user-123",
      },
      eventId: "evt_123",
      occurredAt: "2026-03-20T12:00:00.000Z",
    });

    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeUndefined();
  });

  it("dispatch client uses the global fetch fallback and an explicit timestamp override", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(buildDispatchResultFixture("evt_456")),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const client = createHostedExecutionDispatchClient({
      baseUrl: "https://runner.example.test/",
      now: () => "2026-03-27T10:30:00.000Z",
      signingSecret: "secret",
    });

    await client.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "user-123",
      },
      eventId: "evt_456",
      occurredAt: "2026-03-20T12:00:00.000Z",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
    ).toBe("2026-03-27T10:30:00.000Z");
  });

  it("control client uses bearer auth and shared control routes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          configuredUserEnvKeys: ["OPENAI_API_KEY"],
          userId: "member/123",
        }),
        { status: 200 },
      ),
    );
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      now: () => "2026-03-27T10:30:00.000Z",
      fetchImpl,
      signingSecret: "  signing-secret  ",
    });

    await expect(
      client.updateUserEnv("member/123", {
        env: {
          OPENAI_API_KEY: "secret",
        },
        mode: "merge",
      }),
    ).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY"],
      userId: "member/123",
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://worker.example.test/internal/users/member%2F123/env");
    expect(init?.method).toBe("PUT");
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER)).toBe("2026-03-27T10:30:00.000Z");
    await expect(
      verifyHostedExecutionSignature({
        method: "PUT",
        path: buildHostedExecutionUserEnvPath("member/123"),
        payload: typeof init?.body === "string" ? init.body : "",
        secret: "signing-secret",
        signature: headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER),
        timestamp: headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
        nowMs: Date.parse("2026-03-27T10:30:00.000Z"),
      }),
    ).resolves.toBe(true);
    expect(init?.body).toBe(JSON.stringify({
      env: {
        OPENAI_API_KEY: "secret",
      },
      mode: "merge",
    }));
  });

  it("control client requires a configured signing secret", () => {
    expect(() =>
      createHostedExecutionControlClient({
        baseUrl: "https://worker.example.test/",
        signingSecret: "",
      }),
    ).toThrow("Hosted execution signingSecret must be configured.");
  });

  it("control client uses the remaining shared control routes", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bundleRefs: {
              agentState: null,
              vault: null,
            },
            inFlight: false,
            lastError: null,
            lastEventId: "evt_123",
            lastRunAt: null,
            nextWakeAt: null,
            pendingEventCount: 0,
            poisonedEventIds: [],
            retryingEventId: null,
            userId: "member/123",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            configuredUserEnvKeys: ["OPENAI_API_KEY"],
            userId: "member/123",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            configuredUserEnvKeys: [],
            userId: "member/123",
          }),
          { status: 200 },
        ),
      );
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      now: () => "2026-03-27T10:45:00.000Z",
      fetchImpl,
      signingSecret: "signing-secret",
    });

    await expect(client.run("member/123")).resolves.toMatchObject({
      lastEventId: "evt_123",
      userId: "member/123",
    });
    await expect(client.getUserEnvStatus("member/123")).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY"],
      userId: "member/123",
    });
    await expect(client.clearUserEnv("member/123")).resolves.toEqual({
      configuredUserEnvKeys: [],
      userId: "member/123",
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://worker.example.test/internal/users/member%2F123/run",
      expect.objectContaining({
        body: "{}",
        method: "POST",
      }),
    );
    const runHeaders = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(runHeaders.get("content-type")).toBe("application/json; charset=utf-8");
    await expect(
      verifyHostedExecutionSignature({
        method: "POST",
        path: buildHostedExecutionUserRunPath("member/123"),
        payload: String(fetchImpl.mock.calls[0]?.[1]?.body ?? ""),
        secret: "signing-secret",
        signature: runHeaders.get(HOSTED_EXECUTION_SIGNATURE_HEADER),
        timestamp: runHeaders.get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
        nowMs: Date.parse("2026-03-27T10:45:00.000Z"),
      }),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://worker.example.test/internal/users/member%2F123/env",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://worker.example.test/internal/users/member%2F123/env",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
    await expect(
      verifyHostedExecutionSignature({
        method: "GET",
        path: buildHostedExecutionUserEnvPath("member/123"),
        payload: "",
        secret: "signing-secret",
        signature: new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get(HOSTED_EXECUTION_SIGNATURE_HEADER),
        timestamp: new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
        nowMs: Date.parse("2026-03-27T10:45:00.000Z"),
      }),
    ).resolves.toBe(true);
    await expect(
      verifyHostedExecutionSignature({
        method: "DELETE",
        path: buildHostedExecutionUserEnvPath("member/123"),
        payload: "",
        secret: "signing-secret",
        signature: new Headers(fetchImpl.mock.calls[2]?.[1]?.headers).get(HOSTED_EXECUTION_SIGNATURE_HEADER),
        timestamp: new Headers(fetchImpl.mock.calls[2]?.[1]?.headers).get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
        nowMs: Date.parse("2026-03-27T10:45:00.000Z"),
      }),
    ).resolves.toBe(true);
  });

  it("control client reads and upserts hosted user key envelope routes", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildHostedUserRootKeyEnvelopeFixture("member/123")), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            buildHostedUserRootKeyEnvelopeFixture("member/123", {
              recipients: [
                {
                  ciphertext: "ciphertext-automation",
                  iv: "iv-automation",
                  keyId: "recipient-automation-v1",
                  kind: "automation",
                },
                {
                  ciphertext: "ciphertext-user-unlock",
                  iv: "iv-user-unlock",
                  keyId: "recipient-user-unlock-v1",
                  kind: "user-unlock",
                  metadata: {
                    activated: true,
                    device: "browser",
                  },
                },
              ],
            }),
          ),
          { status: 200 },
        ),
      );
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      now: () => "2026-03-27T11:00:00.000Z",
      fetchImpl,
      signingSecret: "signing-secret",
    });

    await expect(client.getUserKeyEnvelope("member/123")).resolves.toEqual(
      buildHostedUserRootKeyEnvelopeFixture("member/123"),
    );
    await expect(
      client.upsertUserKeyRecipient("member/123", "user-unlock", {
        metadata: {
          activated: true,
          device: "browser",
        },
        recipientKeyBase64: "dXNlci11bmxvY2sta2V5",
        recipientKeyId: "recipient-user-unlock-v1",
      }),
    ).resolves.toEqual(
      buildHostedUserRootKeyEnvelopeFixture("member/123", {
        recipients: [
          {
            ciphertext: "ciphertext-automation",
            iv: "iv-automation",
            keyId: "recipient-automation-v1",
            kind: "automation",
          },
          {
            ciphertext: "ciphertext-user-unlock",
            iv: "iv-user-unlock",
            keyId: "recipient-user-unlock-v1",
            kind: "user-unlock",
            metadata: {
              activated: true,
              device: "browser",
            },
          },
        ],
      }),
    );

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://worker.example.test/internal/users/member%2F123/keys/envelope",
      expect.objectContaining({
        method: "GET",
      }),
    );
    await expect(
      verifyHostedExecutionSignature({
        method: "GET",
        path: buildHostedExecutionUserKeyEnvelopePath("member/123"),
        payload: "",
        secret: "signing-secret",
        signature: new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get(HOSTED_EXECUTION_SIGNATURE_HEADER),
        timestamp: new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
        nowMs: Date.parse("2026-03-27T11:00:00.000Z"),
      }),
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://worker.example.test/internal/users/member%2F123/keys/recipients/user-unlock",
      expect.objectContaining({
        body: JSON.stringify({
          metadata: {
            activated: true,
            device: "browser",
          },
          recipientKeyBase64: "dXNlci11bmxvY2sta2V5",
          recipientKeyId: "recipient-user-unlock-v1",
        }),
        method: "PUT",
      }),
    );
    const upsertHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers);
    expect(upsertHeaders.get("content-type")).toBe("application/json; charset=utf-8");
    await expect(
      verifyHostedExecutionSignature({
        method: "PUT",
        path: buildHostedExecutionUserKeyRecipientPath("member/123", "user-unlock"),
        payload: String(fetchImpl.mock.calls[1]?.[1]?.body ?? ""),
        secret: "signing-secret",
        signature: upsertHeaders.get(HOSTED_EXECUTION_SIGNATURE_HEADER),
        timestamp: upsertHeaders.get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
        nowMs: Date.parse("2026-03-27T11:00:00.000Z"),
      }),
    ).resolves.toBe(true);
  });

  it("includes HTTP error text for non-ok shared control responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("runner unavailable", { status: 503 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      fetchImpl,
      signingSecret: "signing-secret",
    });

    await expect(client.getStatus("user-123")).rejects.toThrow(
      "Hosted execution status failed with HTTP 503: runner unavailable.",
    );
  });

  it("uses the global fetch fallback and omits the error suffix for blank non-ok responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchImpl);
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      signingSecret: "signing-secret",
    });

    await expect(client.getStatus("user-123")).rejects.toThrow(
      "Hosted execution status failed with HTTP 503.",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["", "   \n"])("rejects blank success JSON bodies", async (body) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      fetchImpl,
      signingSecret: "signing-secret",
    });

    await expect(client.getStatus("user-123")).rejects.toThrow(
      "Hosted execution user status must be an object.",
    );
  });

  it("rejects malformed success JSON bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{", { status: 200 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      fetchImpl,
      signingSecret: "signing-secret",
    });

    await expect(client.getStatus("user-123")).rejects.toThrow(
      "Hosted execution user status must be an object.",
    );
  });

  it("rejects array JSON payloads for typed shared control responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      fetchImpl,
      signingSecret: "signing-secret",
    });

    await expect(client.getStatus("user-123")).rejects.toThrow(
      "Hosted execution user status must be an object.",
    );
  });
});

function buildDispatchResultFixture(eventId: string) {
  return {
    event: {
      eventId,
      lastError: null,
      state: "completed",
      userId: "user-123",
    },
    status: {
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastEventId: eventId,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: "user-123",
    },
  };
}

function buildHostedUserRootKeyEnvelopeFixture(
  userId: string,
  overrides?: {
    recipients?: Array<{
      ciphertext: string;
      iv: string;
      keyId: string;
      kind: "automation" | "user-unlock" | "recovery" | "tee-automation";
      metadata?: Record<string, string | number | boolean | null>;
    }>;
  },
) {
  return {
    createdAt: "2026-03-27T09:00:00.000Z",
    recipients: overrides?.recipients ?? [
      {
        ciphertext: "ciphertext-automation",
        iv: "iv-automation",
        keyId: "recipient-automation-v1",
        kind: "automation",
      },
    ],
    rootKeyId: "root-key-v1",
    schema: HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: "2026-03-27T09:05:00.000Z",
    userId,
  };
}
