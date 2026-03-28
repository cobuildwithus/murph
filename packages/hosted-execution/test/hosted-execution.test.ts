import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
  HOSTED_EXECUTION_LEGACY_OUTBOX_PAYLOAD_SCHEMA_VERSION,
  buildHostedExecutionDispatchRef,
  buildHostedExecutionOutboxPayload,
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  buildHostedExecutionSharePayloadPath,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  buildHostedExecutionUserEnvPath,
  buildHostedExecutionUserRunPath,
  buildHostedExecutionUserStatusPath,
  createHostedExecutionControlClient,
  createHostedExecutionDispatchClient,
  createHostedExecutionSignature,
  createHostedExecutionSignatureHeaders,
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
  readHostedExecutionWebControlPlaneEnvironment,
  readHostedExecutionWorkerEnvironment,
  normalizeHostedDeviceSyncJobHints,
  resolveHostedDeviceSyncWakeContext,
  resolveHostedExecutionDispatchLifecycle,
  resolveHostedExecutionDispatchOutcomeState,
  verifyHostedExecutionSignature,
} from "@murph/hosted-execution";

describe("@murph/hosted-execution", () => {
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

  it("reads hosted control env from the shared dispatch base and control token", () => {
    expect(
      readHostedExecutionControlEnvironment({
        HOSTED_EXECUTION_DISPATCH_URL: "https://dispatch.example.test/",
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    ).toEqual({
      baseUrl: "https://dispatch.example.test",
      controlToken: "control-token",
    });

    expect(
      readHostedExecutionControlEnvironment({
        HOSTED_EXECUTION_DISPATCH_URL: "   ",
        HOSTED_EXECUTION_CONTROL_TOKEN: "   ",
      }),
    ).toEqual({
      baseUrl: null,
      controlToken: null,
    });
  });

  it("reads hosted web control plane env from split internal, scheduler, and share settings", () => {
    expect(
      readHostedExecutionWebControlPlaneEnvironment({
        CRON_SECRET: "cron-token",
        HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://device-sync.example.test/",
        HOSTED_EXECUTION_INTERNAL_TOKEN: "internal-token",
        HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test/",
        HOSTED_SHARE_INTERNAL_TOKEN: "share-token",
      }),
    ).toEqual({
      deviceSyncRuntimeBaseUrl: "https://device-sync.example.test",
      internalToken: "internal-token",
      schedulerToken: "cron-token",
      shareBaseUrl: "https://join.example.test",
      shareToken: "share-token",
    });

    expect(
      readHostedExecutionWebControlPlaneEnvironment({
        HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test/",
        HOSTED_SHARE_API_BASE_URL: "https://share.example.test/internal/",
      }),
    ).toEqual({
      deviceSyncRuntimeBaseUrl: "https://join.example.test",
      internalToken: null,
      schedulerToken: null,
      shareBaseUrl: "https://share.example.test/internal",
      shareToken: null,
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
      allowedUserEnvPrefixes: null,
      bundleEncryptionKeyBase64: "Zm9v",
      bundleEncryptionKeyId: "v1",
      controlToken: null,
      defaultAlarmDelayMs: 15 * 60 * 1000,
      dispatchSigningSecret: "dispatch-secret",
      maxEventAttempts: 3,
      retryDelayMs: 30_000,
      runnerControlToken: null,
      runnerTimeoutMs: 60_000,
    });
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
        envelopeFrom: "alice@example.test",
        envelopeTo: "assistant+u-member@mail.example.test",
        eventId: "email:raw_email_123",
        identityId: "assistant@mail.example.test",
        occurredAt: "2026-03-28T09:00:00.000Z",
        rawMessageKey: "raw_email_123",
        threadTarget: null,
        userId: "member_123",
      }),
    )).toEqual({
      event: {
        envelopeFrom: "alice@example.test",
        envelopeTo: "assistant+u-member@mail.example.test",
        identityId: "assistant@mail.example.test",
        kind: "email.message.received",
        rawMessageKey: "raw_email_123",
        threadTarget: null,
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

  it("builds minimized dispatch refs and only reads current-schema refs when storage is explicit", () => {
    const dispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      envelopeFrom: "alice@example.test",
      envelopeTo: "assistant+u-member@mail.example.test",
      eventId: "email:raw_email_123",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-03-28T09:00:00.000Z",
      rawMessageKey: "raw_email_123",
      threadTarget: null,
      userId: "member_123",
    });
    const dispatchRef = buildHostedExecutionDispatchRef(dispatch);

    expect(readHostedExecutionDispatchRef(
      {
        dispatchRef,
        schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
      },
      {
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        occurredAt: dispatch.occurredAt,
        userId: dispatch.event.userId,
      },
    )).toBeNull();
    expect(readHostedExecutionDispatchRef(
      {
        dispatchRef,
        schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
        storage: "reference",
      },
      {
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        occurredAt: dispatch.occurredAt,
        userId: dispatch.event.userId,
      },
    )).toEqual(dispatchRef);
    expect(dispatchRef).toEqual({
      eventId: "email:raw_email_123",
      eventKind: "email.message.received",
      occurredAt: "2026-03-28T09:00:00.000Z",
      userId: "member_123",
    });
  });

  it("builds and reads inline, reference, and legacy outbox payloads", () => {
    const inlineDispatch = buildHostedExecutionAssistantCronTickDispatch({
      eventId: "evt_cron",
      occurredAt: "2026-03-28T09:10:00.000Z",
      reason: "manual",
      userId: "member_123",
    });
    const referenceDispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      envelopeFrom: "alice@example.test",
      envelopeTo: "assistant+u-member@mail.example.test",
      eventId: "email:raw_email_456",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-03-28T09:15:00.000Z",
      rawMessageKey: "raw_email_456",
      threadTarget: null,
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
      readHostedExecutionOutboxPayload(inlinePayload, {
        eventId: inlineDispatch.eventId,
        eventKind: inlineDispatch.event.kind,
        occurredAt: inlineDispatch.occurredAt,
        userId: inlineDispatch.event.userId,
      }),
    ).toEqual(inlinePayload);
    expect(
      readHostedExecutionOutboxPayload(referencePayload, {
        eventId: referenceDispatch.eventId,
        eventKind: referenceDispatch.event.kind,
        occurredAt: referenceDispatch.occurredAt,
        userId: referenceDispatch.event.userId,
      }),
    ).toEqual(referencePayload);
    expect(
      readHostedExecutionOutboxPayload(
        {
          dispatchRef: buildHostedExecutionDispatchRef(referenceDispatch),
          schemaVersion: HOSTED_EXECUTION_LEGACY_OUTBOX_PAYLOAD_SCHEMA_VERSION,
        },
        {
          eventId: referenceDispatch.eventId,
          eventKind: referenceDispatch.event.kind,
          occurredAt: referenceDispatch.occurredAt,
          userId: referenceDispatch.event.userId,
        },
      ),
    ).toEqual({
      dispatchRef: buildHostedExecutionDispatchRef(referenceDispatch),
      schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
      storage: "reference",
    });
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
      buildHostedExecutionSharePayloadPath("share/id", "code+with spaces"),
    ).toBe(
      "/api/hosted-share/internal/share%2Fid/payload?shareCode=code%2Bwith+spaces",
    );
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
      controlToken: "control-token",
      fetchImpl,
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
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer control-token");
    expect(init?.body).toBe(JSON.stringify({
      env: {
        OPENAI_API_KEY: "secret",
      },
      mode: "merge",
    }));
  });

  it("control client requires a configured bearer token", () => {
    expect(() =>
      createHostedExecutionControlClient({
        baseUrl: "https://worker.example.test/",
        controlToken: "",
      }),
    ).toThrow("Hosted execution controlToken must be configured.");
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
      controlToken: "control-token",
      fetchImpl,
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
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer control-token",
    );
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
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
  });

  it("includes HTTP error text for non-ok shared control responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("runner unavailable", { status: 503 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      controlToken: "control-token",
      fetchImpl,
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
      controlToken: "control-token",
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
      controlToken: "control-token",
      fetchImpl,
    });

    await expect(client.getStatus("user-123")).rejects.toThrow(
      "Hosted execution user status must be an object.",
    );
  });

  it("rejects malformed success JSON bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{", { status: 200 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      controlToken: "control-token",
      fetchImpl,
    });

    await expect(client.getStatus("user-123")).rejects.toThrow(
      "Hosted execution user status must be an object.",
    );
  });

  it("rejects array JSON payloads for typed shared control responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      controlToken: "control-token",
      fetchImpl,
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
