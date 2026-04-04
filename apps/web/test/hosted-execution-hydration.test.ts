import { describe, expect, it, vi } from "vitest";

import { ExecutionOutboxStatus } from "@prisma/client";
import { HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION } from "@murphai/hosted-execution";
import { normalizeLinqWebhookEvent } from "@murphai/inboxd";
import type { SharePack } from "@murphai/contracts";
import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { createHostedWebhookDispatchSideEffect } from "@/src/lib/hosted-onboarding/webhook-receipts";

const mocks = vi.hoisted(() => ({
  buildHostedDeviceSyncRuntimeSnapshot: vi.fn(() => ({
    connections: [],
    generatedAt: "2026-03-26T12:30:00.000Z",
    userId: "member_123",
  })),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingSecretCodec: () => ({
    keyVersion: "v1",
    encrypt: (value: string) => value,
    decrypt: (value: string) => value,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
}));

vi.mock("@/src/lib/device-sync/crypto", () => ({
  buildHostedSecretAad: (input: Record<string, unknown>) => JSON.stringify(input),
  createHostedSecretCodec: () => ({
    decrypt: vi.fn(),
    encrypt: vi.fn(),
    keyVersion: "v1",
  }),
}));

vi.mock("@/src/lib/device-sync/env", () => ({
  readHostedDeviceSyncEnvironment: () => ({
    encryptionKey: "01234567890123456789012345678901",
    encryptionKeyVersion: "v1",
    encryptionKeysByVersion: {
      v1: "01234567890123456789012345678901",
    },
  }),
}));

vi.mock("@/src/lib/device-sync/internal-runtime", () => ({
  buildHostedDeviceSyncRuntimeSnapshot: mocks.buildHostedDeviceSyncRuntimeSnapshot,
}));

import {
  hydrateHostedExecutionDispatch,
  isPermanentHostedExecutionHydrationError,
} from "@/src/lib/hosted-execution/hydration";

function buildShareReference() {
  return {
    shareId: "share_123",
  };
}

function buildSharePack(): SharePack {
  return {
    createdAt: "2026-03-26T12:00:00.000Z",
    entities: [
      {
        kind: "food",
        payload: {
          kind: "smoothie",
          status: "active",
          title: "Morning Smoothie",
        },
        ref: "food:morning-smoothie",
      },
    ],
    schemaVersion: "murph.share-pack.v1",
    title: "Morning Smoothie",
  };
}

function buildShareOutboxRecord(payloadJson: unknown) {
  const occurredAt = "2026-03-26T12:30:00.000Z";

  return {
    acceptedAt: null,
    attemptCount: 0,
    claimExpiresAt: null,
    claimToken: null,
    completedAt: null,
    createdAt: new Date(occurredAt),
    eventId: "evt_share_123",
    eventKind: "vault.share.accepted",
    failedAt: null,
    id: "execout_123",
    lastAttemptAt: null,
    lastError: null,
    lastStatusJson: null,
    nextAttemptAt: new Date(occurredAt),
    payloadJson,
    sourceId: "share_123",
    sourceType: "hosted_share_link",
    status: ExecutionOutboxStatus.pending,
    updatedAt: new Date(occurredAt),
    userId: "member_123",
  };
}

function buildWebhookOutboxRecord(
  payloadJson: unknown,
  overrides: Partial<{
    eventId: string;
    eventKind: string;
    sourceId: string;
    userId: string;
  }> = {},
) {
  const occurredAt = "2026-03-26T12:30:00.000Z";

  return {
    acceptedAt: null,
    attemptCount: 0,
    claimExpiresAt: null,
    claimToken: null,
    completedAt: null,
    createdAt: new Date(occurredAt),
    eventId: overrides.eventId ?? "evt_linq_123",
    eventKind: overrides.eventKind ?? "linq.message.received",
    failedAt: null,
    id: "execout_linq_123",
    lastAttemptAt: null,
    lastError: null,
    lastStatusJson: null,
    nextAttemptAt: new Date(occurredAt),
    payloadJson,
    sourceId: overrides.sourceId ?? `linq:${overrides.eventId ?? "evt_linq_123"}`,
    sourceType: "hosted_webhook_receipt",
    status: ExecutionOutboxStatus.pending,
    updatedAt: new Date(occurredAt),
    userId: overrides.userId ?? "member_123",
  };
}

function buildDeviceSyncSignalOutboxRecord(overrides: Partial<{
  eventId: string;
  eventKind: string;
  sourceId: string;
  userId: string;
}> = {}) {
  const occurredAt = "2026-03-26T12:30:00.000Z";

  return {
    acceptedAt: null,
    attemptCount: 0,
    claimExpiresAt: null,
    claimToken: null,
    completedAt: null,
    createdAt: new Date(occurredAt),
    eventId: overrides.eventId ?? "evt_device_sync_123",
    eventKind: overrides.eventKind ?? "device-sync.wake",
    failedAt: null,
    id: "execout_device_sync_123",
    lastAttemptAt: null,
    lastError: null,
    lastStatusJson: null,
    nextAttemptAt: new Date(occurredAt),
    payloadJson: {
      dispatchRef: {
        eventId: overrides.eventId ?? "evt_device_sync_123",
        eventKind: overrides.eventKind ?? "device-sync.wake",
        occurredAt,
        userId: overrides.userId ?? "member_123",
      },
      schemaVersion: "murph.execution-outbox.v2",
      storage: "reference",
    },
    sourceId: overrides.sourceId ?? "8",
    sourceType: "device_sync_signal",
    status: ExecutionOutboxStatus.pending,
    updatedAt: new Date(occurredAt),
    userId: overrides.userId ?? "member_123",
  };
}

describe("hydrateHostedExecutionDispatch", () => {
  it("hydrates device-sync wake dispatches from stored signal payloads", async () => {
    const prisma = {
      deviceSyncSignal: {
        findUnique: vi.fn().mockResolvedValue({
          connectionId: "dsc_123",
          createdAt: new Date("2026-03-26T12:30:00.000Z"),
          kind: "webhook_hint",
          payloadJson: {
            eventType: "sleep.updated",
            jobs: [
              {
                dedupeKey: "job_123",
                kind: "reconcile",
                payload: {
                  dataType: "daily_sleep",
                },
                priority: 90,
              },
            ],
            occurredAt: "2026-03-26T12:29:00.000Z",
            traceId: "trace_123",
          },
          provider: "oura",
          userId: "member_123",
        }),
      },
    };

    const dispatch = await hydrateHostedExecutionDispatch(
      buildDeviceSyncSignalOutboxRecord() as never,
      prisma as never,
    );

    expect(dispatch).toEqual({
      event: {
        connectionId: "dsc_123",
        hint: {
          eventType: "sleep.updated",
          jobs: [
            {
              dedupeKey: "job_123",
              kind: "reconcile",
              payload: {
                dataType: "daily_sleep",
              },
              priority: 90,
            },
          ],
          occurredAt: "2026-03-26T12:29:00.000Z",
          traceId: "trace_123",
        },
        kind: "device-sync.wake",
        provider: "oura",
        reason: "webhook_hint",
        runtimeSnapshot: {
          connections: [],
          generatedAt: "2026-03-26T12:30:00.000Z",
          userId: "member_123",
        },
        userId: "member_123",
      },
      eventId: "evt_device_sync_123",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });
  });

  it("rehydrates share outbox refs with the encrypted share pack from the hosted share link", async () => {
    const share = buildShareReference();
    const pack = buildSharePack();
    const prisma = {
      hostedShareLink: {
        findUnique: vi.fn().mockResolvedValue({
          encryptedPayload: JSON.stringify(pack),
          id: "share_123",
        }),
      },
    };

    const dispatch = await hydrateHostedExecutionDispatch(
      buildShareOutboxRecord({
        dispatchRef: {
          eventId: "evt_share_123",
          eventKind: "vault.share.accepted",
          occurredAt: "2026-03-26T12:30:00.000Z",
          share,
          userId: "member_123",
        },
        schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
        storage: "reference",
      }) as never,
      prisma as never,
    );

    expect(dispatch).toEqual({
      event: {
        kind: "vault.share.accepted",
        share: {
          ...share,
          pack,
        },
        userId: "member_123",
      },
      eventId: "evt_share_123",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });
  });

  it("rejects share outbox payloads when the schemaVersion is missing", async () => {
    const share = buildShareReference();

    await expect(
      hydrateHostedExecutionDispatch(
        buildShareOutboxRecord({
          dispatchRef: {
            eventId: "evt_share_123",
            eventKind: "vault.share.accepted",
            occurredAt: "2026-03-26T12:30:00.000Z",
            share,
            userId: "member_123",
          },
        }) as never,
        {} as never,
      ),
    ).rejects.toThrow("missing a dispatch payload");
  });

  it("rejects stored reference payloads with incomplete dispatch refs", async () => {
    await expect(
      hydrateHostedExecutionDispatch(
        buildWebhookOutboxRecord({
          storage: "reference",
          schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
          dispatchRef: {
            eventId: "evt_linq_123",
            eventKind: "linq.message.received",
            occurredAt: "2026-03-26T12:30:00.000Z",
          },
        }) as never,
        {} as never,
      ),
    ).rejects.toThrow("missing a dispatch payload");
  });

  it("marks malformed device-sync source ids as permanent hydration failures", async () => {
    await expect(
      hydrateHostedExecutionDispatch(
        buildDeviceSyncSignalOutboxRecord({
          sourceId: "not-a-number",
        }) as never,
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: "HOSTED_EXECUTION_HYDRATION_SOURCE_ID_INVALID",
      permanent: true,
      retryable: false,
    });

    await expect(
      hydrateHostedExecutionDispatch(
        buildDeviceSyncSignalOutboxRecord({
          sourceId: "not-a-number",
        }) as never,
        {} as never,
      ).catch((error) => isPermanentHostedExecutionHydrationError(error)),
    ).resolves.toBe(true);
  });

  it("rehydrates hosted webhook dispatches from minimized sent receipt payloads", async () => {
    const linqEvent = {
      api_version: "v1",
      created_at: "2026-03-26T12:30:00.000Z",
      data: {
        chat_id: "chat_123",
        from: "+15551234567",
        is_from_me: false,
        message: {
          id: "msg_123",
          parts: [
            {
              type: "text",
              value: "hello",
            },
          ],
        },
        received_at: "2026-03-26T12:30:00.000Z",
      },
      event_id: "evt_linq_123",
      event_type: "message.received",
    };
    const prisma = {
      hostedWebhookReceipt: {
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              eventType: "message.received",
            },
            receiptState: {
              attemptCount: 1,
              attemptId: "attempt_1",
              completedAt: "2026-03-26T12:30:01.000Z",
              lastError: null,
              lastReceivedAt: "2026-03-26T12:30:00.000Z",
              sideEffects: [
                {
                  attemptCount: 1,
                  effectId: "dispatch:evt_linq_123",
                  kind: "hosted_execution_dispatch",
                  lastAttemptAt: "2026-03-26T12:30:00.500Z",
                  lastError: null,
                  payload: {
                    firstContact: {
                      channel: "linq",
                      identityId: "hbidx:phone:v1:test",
                      threadId: "chat_123",
                      threadIsDirect: true,
                    },
                    botUserId: "999",
                    storage: "reference",
                    schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
                    dispatchRef: {
                      eventId: "evt_linq_123",
                      eventKind: "linq.message.received",
                      occurredAt: "2026-03-26T12:30:00.000Z",
                      userId: "member_123",
                    },
                    linqEvent,
                  },
                  result: {
                    dispatched: true,
                  },
                  sentAt: "2026-03-26T12:30:00.750Z",
                  status: "sent",
                },
              ],
              status: "completed",
            },
          },
        }),
      },
    };

    const dispatch = await hydrateHostedExecutionDispatch(
      buildWebhookOutboxRecord({
        storage: "reference",
        schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
        dispatchRef: {
          eventId: "evt_linq_123",
          eventKind: "linq.message.received",
          occurredAt: "2026-03-26T12:30:00.000Z",
          userId: "member_123",
        },
      }) as never,
      prisma as never,
    );

    expect(dispatch).toEqual({
      event: {
        kind: "linq.message.received",
        linqEvent,
        phoneLookupKey: createHostedPhoneLookupKey("+15551234567"),
        userId: "member_123",
      },
      eventId: "evt_linq_123",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });
  });

  it("keeps enough sparse Linq snapshot shape for downstream runtime ingestion", async () => {
    const linqEvent = {
      api_version: "v1",
      created_at: "2026-03-26T12:30:00.000Z",
      data: {
        chat: {
          id: "chat_123",
          owner_handle: {
            handle: "hbid:linq.recipient:v1:test",
            id: "handle_owner_123",
            is_me: true,
            service: "SMS",
          },
        },
        chat_id: "chat_123",
        direction: "inbound",
        from: "+15551234567",
        from_handle: {
          handle: "hbid:linq.from:v1:test",
          id: "handle_sender_123",
          service: "SMS",
        },
        is_from_me: false,
        message: {
          id: "msg_123",
          parts: [
            {
              type: "text",
              value: "hello",
            },
          ],
        },
        received_at: "2026-03-26T12:30:00.000Z",
        sender_handle: {
          handle: "hbid:linq.from:v1:test",
          id: "handle_sender_123",
          service: "SMS",
        },
        service: "SMS",
      },
      event_id: "evt_linq_sparse_123",
      event_type: "message.received",
    };
    const dispatchEffect = createHostedWebhookDispatchSideEffect({
      dispatch: {
        event: {
          kind: "linq.message.received",
          linqEvent: linqEvent as never,
          phoneLookupKey: createHostedPhoneLookupKey("+15551234567")!,
          userId: "member_123",
        },
        eventId: "evt_linq_sparse_123",
        occurredAt: "2026-03-26T12:30:00.000Z",
      },
    });
    const prisma = {
      hostedWebhookReceipt: {
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              eventType: "message.received",
            },
            receiptState: {
              attemptCount: 1,
              attemptId: "attempt_1",
              completedAt: "2026-03-26T12:30:01.000Z",
              lastError: null,
              lastReceivedAt: "2026-03-26T12:30:00.000Z",
              sideEffects: [
                {
                  attemptCount: 1,
                  effectId: "dispatch:evt_linq_sparse_123",
                  kind: "hosted_execution_dispatch",
                  lastAttemptAt: "2026-03-26T12:30:00.500Z",
                  lastError: null,
                  payload: dispatchEffect.payload,
                  result: {
                    dispatched: true,
                  },
                  sentAt: "2026-03-26T12:30:00.750Z",
                  status: "sent",
                },
              ],
              status: "completed",
            },
          },
        }),
      },
    };

    const dispatch = await hydrateHostedExecutionDispatch(
      buildWebhookOutboxRecord({
        storage: "reference",
        schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
        dispatchRef: {
          eventId: "evt_linq_sparse_123",
          eventKind: "linq.message.received",
          occurredAt: "2026-03-26T12:30:00.000Z",
          userId: "member_123",
        },
      }, {
        eventId: "evt_linq_sparse_123",
        sourceId: "linq:evt_linq_sparse_123",
      }) as never,
      prisma as never,
    );

    if (dispatch.event.kind !== "linq.message.received") {
      throw new Error(`Expected linq.message.received, got ${dispatch.event.kind}.`);
    }

    const capture = await normalizeLinqWebhookEvent({
      defaultAccountId: dispatch.event.phoneLookupKey,
      event: dispatch.event.linqEvent as never,
    });

    expect(capture.accountId).toBe(createHostedPhoneLookupKey("+15551234567"));
    expect(capture.actor.id).toMatch(/^hbid:linq\.from:/u);
    expect(capture.externalId).toMatch(/^linq:hbid:linq\.message:/u);
    expect(capture.thread.id).toBe("chat_123");
    expect(capture.text).toBe("hello");
  });

  it("rehydrates minimized sent member activation receipt payloads", async () => {
    const prisma = {
      hostedWebhookReceipt: {
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              type: "invoice.paid",
            },
            receiptState: {
              attemptCount: 1,
              attemptId: "attempt_1",
              completedAt: "2026-03-26T12:30:01.000Z",
              lastError: null,
              lastReceivedAt: "2026-03-26T12:30:00.000Z",
              sideEffects: [
                {
                  attemptCount: 1,
                  effectId: "dispatch:member.activated:stripe.invoice.paid:member_123:evt_stripe_123",
                  kind: "hosted_execution_dispatch",
                  lastAttemptAt: "2026-03-26T12:30:00.500Z",
                  lastError: null,
                  payload: {
                    botUserId: "999",
                    firstContact: {
                      channel: "linq",
                      identityId: "hbidx:phone:v1:test",
                      threadId: "chat_123",
                      threadIsDirect: true,
                    },
                    storage: "reference",
                    schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
                    dispatchRef: {
                      eventId: "member.activated:stripe.invoice.paid:member_123:evt_stripe_123",
                      eventKind: "member.activated",
                      occurredAt: "2026-03-26T12:30:00.000Z",
                      userId: "member_123",
                    },
                  },
                  result: {
                    dispatched: true,
                  },
                  sentAt: "2026-03-26T12:30:00.750Z",
                  status: "sent",
                },
              ],
              status: "completed",
            },
          },
        }),
      },
    };

    const dispatch = await hydrateHostedExecutionDispatch(
      buildWebhookOutboxRecord(
        {
          storage: "reference",
          schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
          dispatchRef: {
            eventId: "member.activated:stripe.invoice.paid:member_123:evt_stripe_123",
            eventKind: "member.activated",
            occurredAt: "2026-03-26T12:30:00.000Z",
            userId: "member_123",
          },
        },
        {
          eventId: "member.activated:stripe.invoice.paid:member_123:evt_stripe_123",
          eventKind: "member.activated",
          sourceId: "stripe:evt_stripe_123",
          userId: "member_123",
        },
      ) as never,
      prisma as never,
    );

    expect(dispatch).toEqual({
      event: {
        firstContact: {
          channel: "linq",
          identityId: "hbidx:phone:v1:test",
          threadId: "chat_123",
          threadIsDirect: true,
        },
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "member.activated:stripe.invoice.paid:member_123:evt_stripe_123",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });
  });

  it("rehydrates hosted Telegram webhook dispatches from minimized sent receipt payloads", async () => {
    const telegramUpdate = {
      message: {
        chat: {
          id: 123,
          type: "private",
        },
        date: 1_774_522_600,
        from: {
          first_name: "Alice",
          id: 456,
        },
        message_id: 1,
        text: "hello from Telegram",
      },
      update_id: 321,
    };
    const prisma = {
      hostedWebhookReceipt: {
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 321,
            },
            receiptState: {
              attemptCount: 1,
              attemptId: "attempt_1",
              completedAt: "2026-03-26T12:30:01.000Z",
              lastError: null,
              lastReceivedAt: "2026-03-26T12:30:00.000Z",
              sideEffects: [
                {
                  attemptCount: 1,
                  effectId: "dispatch:telegram:update:321",
                  kind: "hosted_execution_dispatch",
                  lastAttemptAt: "2026-03-26T12:30:00.500Z",
                  lastError: null,
                  payload: {
                    botUserId: "999",
                    storage: "reference",
                    schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
                    dispatchRef: {
                      eventId: "telegram:update:321",
                      eventKind: "telegram.message.received",
                      occurredAt: "2026-03-26T12:30:00.000Z",
                      userId: "member_123",
                    },
                    telegramUpdate,
                  },
                  result: {
                    dispatched: true,
                  },
                  sentAt: "2026-03-26T12:30:00.750Z",
                  status: "sent",
                },
              ],
              status: "completed",
            },
          },
        }),
      },
    };

    const dispatch = await hydrateHostedExecutionDispatch(
      buildWebhookOutboxRecord(
        {
          storage: "reference",
          schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
          dispatchRef: {
            eventId: "telegram:update:321",
            eventKind: "telegram.message.received",
            occurredAt: "2026-03-26T12:30:00.000Z",
            userId: "member_123",
          },
        },
        {
          eventId: "telegram:update:321",
          eventKind: "telegram.message.received",
          sourceId: "telegram:telegram:update:321",
        },
      ) as never,
      prisma as never,
    );

    expect(dispatch).toEqual({
      event: {
        botUserId: "999",
        kind: "telegram.message.received",
        telegramUpdate,
        userId: "member_123",
      },
      eventId: "telegram:update:321",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });
  });

  it("rehydrates hosted Telegram webhook dispatches by inferring botUserId from sender_business_bot", async () => {
    const telegramUpdate = {
      business_message: {
        business_connection_id: "bc_123",
        chat: {
          id: 123,
          is_direct_messages: true,
          type: "private",
        },
        date: 1_774_522_601,
        from: {
          first_name: "Alice",
          id: 456,
        },
        message_id: 9,
        sender_business_bot: {
          id: 999,
          is_bot: true,
          username: "murph_bot",
        },
        text: "echo",
      },
      update_id: 654,
    };
    const prisma = {
      hostedWebhookReceipt: {
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 654,
            },
            receiptState: {
              attemptCount: 1,
              attemptId: "attempt_1",
              completedAt: "2026-03-26T12:30:01.000Z",
              lastError: null,
              lastReceivedAt: "2026-03-26T12:30:00.000Z",
              sideEffects: [
                {
                  attemptCount: 1,
                  effectId: "dispatch:telegram:update:654",
                  kind: "hosted_execution_dispatch",
                  lastAttemptAt: "2026-03-26T12:30:00.500Z",
                  lastError: null,
                  payload: {
                    storage: "reference",
                    schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
                    dispatchRef: {
                      eventId: "telegram:update:654",
                      eventKind: "telegram.message.received",
                      occurredAt: "2026-03-26T12:30:00.000Z",
                      userId: "member_123",
                    },
                    telegramUpdate,
                  },
                  result: {
                    dispatched: true,
                  },
                  sentAt: "2026-03-26T12:30:00.750Z",
                  status: "sent",
                },
              ],
              status: "completed",
            },
          },
        }),
      },
    };

    const dispatch = await hydrateHostedExecutionDispatch(
      buildWebhookOutboxRecord(
        {
          storage: "reference",
          schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
          dispatchRef: {
            eventId: "telegram:update:654",
            eventKind: "telegram.message.received",
            occurredAt: "2026-03-26T12:30:00.000Z",
            userId: "member_123",
          },
        },
        {
          eventId: "telegram:update:654",
          eventKind: "telegram.message.received",
          sourceId: "telegram:telegram:update:654",
        },
      ) as never,
      prisma as never,
    );

    expect(dispatch).toEqual({
      event: {
        botUserId: "999",
        kind: "telegram.message.received",
        telegramUpdate,
        userId: "member_123",
      },
      eventId: "telegram:update:654",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });
  });

  it("rehydrates hosted Telegram webhook dispatches by inferring botUserId from bot sender metadata", async () => {
    const telegramUpdate = {
      message: {
        chat: {
          id: 123,
          type: "private",
        },
        date: 1_774_522_602,
        from: {
          first_name: "murph_bot",
          id: 999,
          is_bot: true,
          username: "murph_bot",
        },
        message_id: 10,
        text: "self echo",
      },
      update_id: 655,
    };
    const prisma = {
      hostedWebhookReceipt: {
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 655,
            },
            receiptState: {
              attemptCount: 1,
              attemptId: "attempt_1",
              completedAt: "2026-03-26T12:30:01.000Z",
              lastError: null,
              lastReceivedAt: "2026-03-26T12:30:00.000Z",
              sideEffects: [
                {
                  attemptCount: 1,
                  effectId: "dispatch:telegram:update:655",
                  kind: "hosted_execution_dispatch",
                  lastAttemptAt: "2026-03-26T12:30:00.500Z",
                  lastError: null,
                  payload: {
                    storage: "reference",
                    schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
                    dispatchRef: {
                      eventId: "telegram:update:655",
                      eventKind: "telegram.message.received",
                      occurredAt: "2026-03-26T12:30:00.000Z",
                      userId: "member_123",
                    },
                    telegramUpdate,
                  },
                  result: {
                    dispatched: true,
                  },
                  sentAt: "2026-03-26T12:30:00.750Z",
                  status: "sent",
                },
              ],
              status: "completed",
            },
          },
        }),
      },
    };

    const dispatch = await hydrateHostedExecutionDispatch(
      buildWebhookOutboxRecord(
        {
          storage: "reference",
          schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
          dispatchRef: {
            eventId: "telegram:update:655",
            eventKind: "telegram.message.received",
            occurredAt: "2026-03-26T12:30:00.000Z",
            userId: "member_123",
          },
        },
        {
          eventId: "telegram:update:655",
          eventKind: "telegram.message.received",
          sourceId: "telegram:telegram:update:655",
        },
      ) as never,
      prisma as never,
    );

    expect(dispatch).toEqual({
      event: {
        botUserId: "999",
        kind: "telegram.message.received",
        telegramUpdate,
        userId: "member_123",
      },
      eventId: "telegram:update:655",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });
  });
});
