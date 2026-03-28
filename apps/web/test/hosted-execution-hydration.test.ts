import { describe, expect, it, vi } from "vitest";

import { ExecutionOutboxStatus } from "@prisma/client";
import { HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION } from "@murph/hosted-execution";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingSecretCodec: () => ({
    keyVersion: "v1",
    encrypt: (value: string) => value,
    decrypt: (value: string) => value,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
}));

import { hydrateHostedExecutionDispatch } from "@/src/lib/hosted-execution/hydration";
import { serializeHostedExecutionOutboxPayload } from "@/src/lib/hosted-execution/outbox-payload";

function buildShareReference() {
  return {
    shareCode: "share_code_123",
    shareId: "share_123",
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

describe("hydrateHostedExecutionDispatch", () => {
  it("hydrates minimized share outbox refs from the hosted share link payload", async () => {
    const share = buildShareReference();

    const dispatch = await hydrateHostedExecutionDispatch(
      buildShareOutboxRecord(
        serializeHostedExecutionOutboxPayload({
          event: {
            kind: "vault.share.accepted",
            share,
            userId: "member_123",
          },
          eventId: "evt_share_123",
          occurredAt: "2026-03-26T12:30:00.000Z",
        }),
      ) as never,
      {} as never,
    );

    expect(dispatch).toEqual({
      event: {
        kind: "vault.share.accepted",
        share,
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
    ).rejects.toThrow("missing a dispatch ref");
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
        normalizedPhoneNumber: "+15551234567",
        userId: "member_123",
      },
      eventId: "evt_linq_123",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });
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
        kind: "telegram.message.received",
        telegramUpdate,
        userId: "member_123",
      },
      eventId: "telegram:update:321",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });
  });
});
