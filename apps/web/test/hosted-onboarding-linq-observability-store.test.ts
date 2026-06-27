import { describe, expect, it, vi } from "vitest";

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  applyHostedLinqDeliveryReceiptTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  markHostedLinqDeliverySkippedTx,
  recordHostedLinqDeliveryAttemptTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import { ingestHostedLinqProviderEventTx } from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
  createHostedLinqDeliverySourceRefLookupKey,
  createHostedLinqProviderEventLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";

const OBSERVABILITY_TEST_KEYRING_ENTRIES = {
  v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
  v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
};

describe("hosted Linq observability stores", () => {
  it("keeps non-contact observability ids stable when the contact-privacy keyring rotates", () => {
    const restoreV1 = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: OBSERVABILITY_TEST_KEYRING_ENTRIES,
    });
    let providerEventId = "";
    let deliveryIdempotencyKey: string | null = null;
    let deliverySourceRef: string | null = null;
    try {
      providerEventId = createHostedLinqProviderEventLookupKey("evt_failed_123");
      deliveryIdempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(
        "linq-message:event-123",
      );
      deliverySourceRef = createHostedLinqDeliverySourceRefLookupKey("source:event-123");
    } finally {
      restoreV1();
    }

    const restoreV2 = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: OBSERVABILITY_TEST_KEYRING_ENTRIES,
    });
    try {
      expect(createHostedLinqProviderEventLookupKey("evt_failed_123")).toBe(providerEventId);
      expect(createHostedLinqDeliveryIdempotencyLookupKey("linq-message:event-123"))
        .toBe(deliveryIdempotencyKey);
      expect(createHostedLinqDeliverySourceRefLookupKey("source:event-123"))
        .toBe(deliverySourceRef);
      expect(createHostedLinqProviderEventLookupKey(providerEventId)).toBe(providerEventId);
    } finally {
      restoreV2();
    }

    expect(providerEventId).toMatch(/^hbid:linq\.provider-event:s1:[a-f0-9]{64}$/u);
    expect(deliveryIdempotencyKey)
      .toMatch(/^hbid:linq\.delivery-idempotency:s1:[a-f0-9]{64}$/u);
    expect(deliverySourceRef)
      .toMatch(/^hbid:linq\.delivery-source-ref:s1:[a-f0-9]{64}$/u);
  });

  it("records failed provider events, updates projections, and claims one event-scoped alert", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValue({
      id: "hld_attempt_123",
    });
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        error: {
          code: "30007",
          message: "carrier filtered +15551234567 provider_msg_123 private text",
        },
        message_id: "msg_failed_123",
        phone_number: "+15550000000",
        service: "sms",
      },
      eventId: "evt_failed_123",
      eventType: "message.failed",
    }));

    const result = await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
      receivedAt: new Date("2026-03-26T12:00:02.000Z"),
    });

    expect(result).toEqual({
      alertIds: [expect.stringMatching(/^hla_message_failed_[a-f0-9]{32}$/u)],
      duplicate: false,
    });
    expect(fixture.hostedLinqProviderEventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: createHostedLinqProviderEventLookupKey("evt_failed_123"),
          eventType: "message.failed",
          failureCode: "30007",
          failureReason: "[redacted]",
        }),
        skipDuplicates: true,
      }),
    );
    expect(fixture.hostedLinqLineUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.hostedLinqProviderEventCreateMany.mock.invocationCallOrder[0],
    );
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          healthStatus: "warning",
          lastFailureCode: "30007",
          lastFailureReason: "[redacted]",
          lastReceiptEventId: createHostedLinqProviderEventLookupKey("evt_failed_123"),
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          totalFailedCount: { increment: 1 },
        },
      }),
    );
    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCode: "30007",
          failureReason: "[redacted]",
          status: "failed",
        }),
        where: expect.objectContaining({
          id: "hld_attempt_123",
        }),
      }),
    );
    expect(fixture.hostedLinqAlertCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryId: "hld_attempt_123",
          eventId: createHostedLinqProviderEventLookupKey("evt_failed_123"),
          kind: "message_failed",
          status: "pending",
        }),
        skipDuplicates: true,
      }),
    );
  });

  it("does not regress projections or alerts for stale delivery receipts", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValue({
      id: "hld_attempt_123",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });
    const event = requireParsedProviderEvent(buildProviderEvent({
      createdAt: "2026-03-26T12:00:00.000Z",
      data: {
        error: {
          code: "30007",
          message: "carrier filtered +15551234567 provider_msg_123 private text",
        },
        message_id: "msg_failed_123",
        phone_number: "+15550000000",
        service: "sms",
      },
      eventId: "evt_failed_older",
      eventType: "message.failed",
    }));

    await expect(ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    })).resolves.toEqual({
      alertIds: [],
      duplicate: false,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "hld_attempt_123",
          OR: expect.arrayContaining([
            {
              lastReceiptAt: {
                lt: new Date("2026-03-26T12:00:00.000Z"),
              },
            },
          ]),
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdateMany).not.toHaveBeenCalled();
    expect(fixture.hostedLinqAlertCreateMany).not.toHaveBeenCalled();
  });

  it("does not claim a failed-message alert when only the line receipt projection is stale", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqLineUpdateMany.mockResolvedValueOnce({ count: 0 });
    const event = requireParsedProviderEvent(buildProviderEvent({
      createdAt: "2026-03-26T12:00:00.000Z",
      data: {
        error: {
          code: "30007",
          message: "carrier filtered +15551234567 provider_msg_123 private text",
        },
        message_id: "msg_failed_123",
        phone_number: "+15550000000",
        service: "sms",
      },
      eventId: "evt_failed_stale_line",
      eventType: "message.failed",
    }));

    await expect(ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    })).resolves.toEqual({
      alertIds: [],
      duplicate: false,
    });

    expect(fixture.hostedLinqDeliveryFindFirst).toHaveBeenCalled();
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phoneNumberLookupKey: event.phoneNumberLookupKey,
        }),
      }),
    );
    expect(fixture.hostedLinqAlertCreateMany).not.toHaveBeenCalled();
  });

  it("counts outbound message.received echoes against line pacing", async () => {
    const fixture = createObservabilityPrismaFixture();
    const event = requireParsedProviderEvent(buildMessageReceivedEvent({
      direction: "outbound",
      eventId: "evt_outbound_123",
      isFromMe: true,
      messageId: "msg_outbound_123",
    }));

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqLineUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          totalOutboundCount: { increment: 1 },
        },
      }),
    );
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          lastOutboundAt: new Date("2026-03-26T12:00:00.000Z"),
        },
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              lastOutboundAt: {
                lt: new Date("2026-03-26T12:00:00.000Z"),
              },
            },
          ]),
          phoneNumberLookupKey: event.phoneNumberLookupKey,
        }),
      }),
    );
  });

  it("counts inbound message.received events against line reply health", async () => {
    const fixture = createObservabilityPrismaFixture();
    const event = requireParsedProviderEvent(buildMessageReceivedEvent({
      direction: "inbound",
      eventId: "evt_inbound_123",
      isFromMe: false,
      messageId: "msg_inbound_123",
    }));

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqLineUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          totalInboundCount: { increment: 1 },
        },
      }),
    );
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          lastInboundAt: new Date("2026-03-26T12:00:00.000Z"),
        },
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              lastInboundAt: {
                lt: new Date("2026-03-26T12:00:00.000Z"),
              },
            },
          ]),
          phoneNumberLookupKey: event.phoneNumberLookupKey,
        }),
      }),
    );
  });

  it("does not project duplicate provider events", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqProviderEventCreateMany.mockResolvedValueOnce({ count: 0 });
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        message_id: "msg_delivered_123",
        phone_number: "+15550000000",
      },
      eventId: "evt_delivered_123",
      eventType: "message.delivered",
    }));

    await expect(ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    })).resolves.toEqual({
      alertIds: [],
      duplicate: true,
    });

    expect(fixture.hostedLinqLineUpdate).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDeliveryUpdate).not.toHaveBeenCalled();
    expect(fixture.hostedLinqAlertCreateMany).not.toHaveBeenCalled();
  });

  it("preserves the stored line lookup key when the phone blind-index key rotated", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqLineUpsert.mockResolvedValueOnce({
      phoneNumberLookupKey: "hbidx:phone:v1-line-key",
    });
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        changed_at: "2026-03-26T12:00:00.000Z",
        new_reputation: "CRITICAL",
        phone_number: "+15550000000",
      },
      eventId: "evt_status_rotated_key",
      eventType: "phone_number.status_updated",
    }));

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqLineUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phoneNumber: "+15550000000",
        },
      }),
    );
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phoneNumberLookupKey: "hbidx:phone:v1-line-key",
        }),
      }),
    );
    expect(fixture.hostedLinqProviderEventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: createHostedLinqProviderEventLookupKey("evt_status_rotated_key"),
          phoneNumberLookupKey: "hbidx:phone:v1-line-key",
        }),
      }),
    );
    expect(fixture.hostedLinqAlertCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phoneNumberLookupKey: "hbidx:phone:v1-line-key",
        }),
      }),
    );
  });

  it("projects production-shape critical reputation status updates", async () => {
    const fixture = createObservabilityPrismaFixture();
    const event = requireParsedProviderEvent(buildProviderEvent({
      createdAt: "2026-03-26T11:59:59.000Z",
      data: {
        changed_at: "2026-03-26T12:00:00.000Z",
        new_reputation: "CRITICAL",
        new_status: "FLAGGED",
        phone_number: "+15550000000",
        previous_reputation: "AT_RISK",
        previous_status: "ACTIVE",
      },
      eventId: "evt_status_123",
      eventType: "phone_number.status_updated",
    }));

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqProviderEventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: createHostedLinqProviderEventLookupKey("evt_status_123"),
          providerCreatedAt: new Date("2026-03-26T12:00:00.000Z"),
          providerStatus: "CRITICAL",
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          egressPolicy: "disabled",
          healthStatus: "unhealthy",
          lastStatusEventId: createHostedLinqProviderEventLookupKey("evt_status_123"),
          providerStatus: "CRITICAL",
          providerUpdatedAt: new Date("2026-03-26T12:00:00.000Z"),
        }),
      }),
    );
    expect(fixture.hostedLinqAlertCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "phone_number_status_updated",
          status: "pending",
        }),
      }),
    );
  });

  it("does not re-enable egress policy for healthy status updates", async () => {
    const fixture = createObservabilityPrismaFixture();
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        new_status: "ACTIVE",
        phone_number: "+15550000000",
      },
      eventId: "evt_status_123",
      eventType: "phone_number.status_updated",
    }));

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    });

    const updateInput = fixture.hostedLinqLineUpdateMany.mock.calls[0]?.[0] as
      | { data?: Record<string, unknown> }
      | undefined;
    expect(updateInput?.data).toMatchObject({
      healthStatus: "healthy",
      lastStatusEventId: createHostedLinqProviderEventLookupKey("evt_status_123"),
      providerStatus: "ACTIVE",
    });
    expect(updateInput?.data).not.toHaveProperty("egressPolicy");
  });

  it("lets flagged status dominate healthy reputation in line projection", async () => {
    const fixture = createObservabilityPrismaFixture();
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        changed_at: "2026-03-26T12:00:00.000Z",
        new_reputation: "HEALTHY",
        new_status: "FLAGGED",
        phone_number: "+15550000000",
      },
      eventId: "evt_status_flagged",
      eventType: "phone_number.status_updated",
    }));

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqProviderEventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: createHostedLinqProviderEventLookupKey("evt_status_flagged"),
          providerStatus: "FLAGGED",
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          egressPolicy: "disabled",
          healthStatus: "unhealthy",
          providerStatus: "FLAGGED",
        }),
      }),
    );
  });

  it("guards line status projection with provider event-id ordering", async () => {
    const fixture = createObservabilityPrismaFixture();
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        changed_at: "2026-03-26T12:00:00.000Z",
        new_reputation: "AT_RISK",
        phone_number: "+15550000000",
      },
      eventId: "evt_status_older",
      eventType: "phone_number.status_updated",
    }));

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phoneNumberLookupKey: event.phoneNumberLookupKey,
          OR: [
            {
              providerUpdatedAt: null,
            },
            {
              providerUpdatedAt: {
                lt: new Date("2026-03-26T12:00:00.000Z"),
              },
            },
            {
              lastStatusEventId: null,
              providerUpdatedAt: new Date("2026-03-26T12:00:00.000Z"),
            },
            {
              lastStatusEventId: {
                lt: createHostedLinqProviderEventLookupKey("evt_status_older"),
              },
              providerUpdatedAt: new Date("2026-03-26T12:00:00.000Z"),
            },
          ],
        },
      }),
    );
  });

  it("uses provider event id as the same-timestamp status tie breaker", async () => {
    const fixture = createObservabilityPrismaFixture();
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        changed_at: "2026-03-26T12:00:00.000Z",
        new_reputation: "CRITICAL",
        phone_number: "+15550000000",
      },
      eventId: "evt_status_critical",
      eventType: "phone_number.status_updated",
    }));

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          egressPolicy: "disabled",
          healthStatus: "unhealthy",
        }),
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              lastStatusEventId: {
                lt: createHostedLinqProviderEventLookupKey("evt_status_critical"),
              },
              providerUpdatedAt: new Date("2026-03-26T12:00:00.000Z"),
            },
          ]),
        }),
      }),
    );
  });

  it("records attempts and later preserves provider ids as lookup keys on acceptance", async () => {
    const fixture = createObservabilityPrismaFixture();
    const deliveryIdempotencyLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
      "linq-message:event-123",
    );

    await expect(recordHostedLinqDeliveryAttemptTx({
      idempotencyKey: "linq-message:event-123",
      linqChatId: "chat_123",
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-message:event-123",
      targetKind: "thread",
      template: "invite_signup",
    })).resolves.toEqual({
      id: "hld_random",
    });
    expect(fixture.hostedLinqDeliveryFindUnique).toHaveBeenCalledWith({
      select: expect.objectContaining({
        acceptedAt: true,
        deliveredAt: true,
        failedAt: true,
        id: true,
        lastReceiptAt: true,
        messageLookupKey: true,
        skippedAt: true,
        status: true,
      }),
      where: {
        idempotencyKey: deliveryIdempotencyLookupKey,
      },
    });
    expect(fixture.hostedLinqDeliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: expect.stringMatching(/^hld_[a-f0-9]{32}$/u),
          idempotencyKey: deliveryIdempotencyLookupKey,
          sourceRef: expect.stringMatching(/^hbid:linq\.delivery-source-ref:/u),
          status: "attempted",
        }),
        select: { id: true },
      }),
    );
    expect(fixture.hostedLinqDeliveryUpsert).not.toHaveBeenCalled();

    await markHostedLinqDeliveryAcceptedTx({
      idempotencyKey: "linq-message:event-123",
      linqChatId: "chat_123",
      messageId: "provider_message_123",
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedAt: null,
          failureCode: null,
          failureReason: null,
          messageIdSuffix: "ge_123",
          status: "accepted",
        }),
        where: expect.objectContaining({
          idempotencyKey: deliveryIdempotencyLookupKey,
          deliveredAt: null,
          lastReceiptAt: null,
          skippedAt: null,
        }),
      }),
    );
    const updateData = fixture.hostedLinqDeliveryUpdateMany.mock.calls[0]?.[0]?.data as
      | Record<string, unknown>
      | undefined;
    expect(updateData?.messageLookupKey).not.toBe("provider_message_123");
  });

  it("lets a retry acceptance replace a pre-provider send failure", async () => {
    const fixture = createObservabilityPrismaFixture();
    const deliveryIdempotencyLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
      "linq-message:event-123",
    );

    await markHostedLinqDeliveryAcceptedTx({
      idempotencyKey: "linq-message:event-123",
      linqChatId: "chat_123",
      messageId: "provider_message_retry_123",
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedAt: expect.any(Date),
          failedAt: null,
          failureCode: null,
          failureReason: null,
          status: "accepted",
        }),
        where: expect.objectContaining({
          deliveredAt: null,
          idempotencyKey: deliveryIdempotencyLookupKey,
          lastReceiptAt: null,
          skippedAt: null,
          OR: expect.arrayContaining([
            {
              acceptedAt: null,
              failedAt: {
                not: null,
              },
              messageLookupKey: null,
            },
          ]),
        }),
      }),
    );
  });

  it("does not downgrade an accepted delivery when an idempotent skip is recorded later", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: new Date("2026-03-26T12:00:01.000Z"),
      deliveredAt: null,
      failedAt: null,
      id: "hld_accepted",
      lastReceiptAt: null,
      messageLookupKey: "hbidx:linq-message:provider",
      skippedAt: null,
      status: "accepted",
    });

    await expect(markHostedLinqDeliverySkippedTx({
      idempotencyKey: "linq-message:event-123",
      linqChatId: "chat_123",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      reason: "recent_reply_required",
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-message:event-123",
      targetKind: "thread",
      template: "invite_signup",
    })).resolves.toEqual({
      id: "hld_accepted",
    });

    expect(fixture.hostedLinqDeliveryUpdate).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDeliveryUpsert).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDeliveryCreate).not.toHaveBeenCalled();
  });

  it("reopens a pre-provider skipped delivery so a later eligible retry can attach receipts", async () => {
    const fixture = createObservabilityPrismaFixture();
    const deliveryIdempotencyLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
      "linq-message:event-123",
    );
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      deliveredAt: null,
      failedAt: new Date("2026-03-26T12:00:00.000Z"),
      id: "hld_skipped_retry",
      lastReceiptAt: null,
      messageLookupKey: null,
      skippedAt: new Date("2026-03-26T12:00:00.000Z"),
      status: "skipped",
    });
    fixture.hostedLinqDeliveryUpdate.mockResolvedValueOnce({
      id: "hld_skipped_retry",
    });

    await expect(recordHostedLinqDeliveryAttemptTx({
      idempotencyKey: "linq-message:event-123",
      linqChatId: "chat_123",
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-message:event-123",
      targetKind: "thread",
      template: "invite_signup",
    })).resolves.toEqual({
      id: "hld_skipped_retry",
    });

    expect(fixture.hostedLinqDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedAt: null,
          failureCode: null,
          failureReason: null,
          skippedAt: null,
          skipReason: null,
          status: "attempted",
        }),
        where: {
          id: "hld_skipped_retry",
        },
      }),
    );

    await markHostedLinqDeliveryAcceptedTx({
      idempotencyKey: "linq-message:event-123",
      linqChatId: "chat_123",
      messageId: "provider_message_123",
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageLookupKey: expect.stringMatching(/^hbidx:linq-message:/u),
          status: "accepted",
        }),
        where: expect.objectContaining({
          idempotencyKey: deliveryIdempotencyLookupKey,
          skippedAt: null,
        }),
      }),
    );

    fixture.hostedLinqDeliveryFindFirst.mockResolvedValueOnce({
      id: "hld_skipped_retry",
    });
    await expect(applyHostedLinqDeliveryReceiptTx({
      event: requireParsedProviderEvent(buildProviderEvent({
        data: {
          message_id: "provider_message_123",
          phone_number: "+15550000000",
          service: "sms",
        },
        eventId: "evt_delivered_retry",
        eventType: "message.delivered",
      })),
      prisma: fixture.prisma as never,
    })).resolves.toEqual({
      advanced: true,
      deliveryId: "hld_skipped_retry",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveredAt: new Date("2026-03-26T12:00:00.000Z"),
          status: "delivered",
        }),
        where: expect.objectContaining({
          id: "hld_skipped_retry",
        }),
      }),
    );
  });

  it("updates only pre-provider attempted deliveries when a send is skipped", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      deliveredAt: null,
      failedAt: null,
      id: "hld_attempted",
      lastReceiptAt: null,
      messageLookupKey: null,
      skippedAt: null,
      status: "attempted",
    });
    fixture.hostedLinqDeliveryUpdate.mockResolvedValueOnce({
      id: "hld_attempted",
    });

    await expect(markHostedLinqDeliverySkippedTx({
      idempotencyKey: "linq-message:event-123",
      linqChatId: "chat_123",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      reason: "recent_reply_required",
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-message:event-123",
      targetKind: "thread",
      template: "invite_signup",
    })).resolves.toEqual({
      id: "hld_attempted",
    });

    expect(fixture.hostedLinqDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          skipReason: "recent_reply_required",
          status: "skipped",
        }),
        where: {
          id: "hld_attempted",
        },
      }),
    );
  });

  it("treats concurrent skipped delivery creation as an idempotent success", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        acceptedAt: null,
        deliveredAt: null,
        failedAt: null,
        id: "hld_concurrent_skipped",
        lastReceiptAt: null,
        messageLookupKey: null,
        skippedAt: new Date("2026-06-25T12:00:00.000Z"),
        status: "skipped",
      });
    fixture.hostedLinqDeliveryCreate.mockRejectedValueOnce({
      code: "P2002",
    });

    await expect(markHostedLinqDeliverySkippedTx({
      idempotencyKey: "linq-message:event-123",
      linqChatId: "chat_123",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      reason: "recent_reply_required",
      source: "hosted_runtime_linq_egress_guard",
      sourceRef: "intent-123",
      targetKind: "thread",
      template: "daily_quota",
    })).resolves.toEqual({
      id: "hld_concurrent_skipped",
    });

    expect(fixture.hostedLinqDeliveryFindUnique).toHaveBeenCalledTimes(2);
    expect(fixture.hostedLinqDeliveryUpdate).not.toHaveBeenCalled();
  });

  it("backfills an already-ingested terminal receipt when acceptance records the provider id", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqProviderEventFindMany.mockResolvedValueOnce([
      {
        deliveryStatus: "delivered",
        eventId: "evt_delivered_same_timestamp",
        failureCode: null,
        failureReason: null,
        providerCreatedAt: new Date("2026-03-26T12:00:05.000Z"),
        service: "sms",
      },
      {
        deliveryStatus: "failed",
        eventId: "evt_failed_123",
        failureCode: "30007",
        failureReason: "[redacted]",
        providerCreatedAt: new Date("2026-03-26T12:00:05.000Z"),
        service: "sms",
      },
    ]);

    await markHostedLinqDeliveryAcceptedTx({
      idempotencyKey: "linq-message:event-123",
      linqChatId: "chat_123",
      messageId: "provider_message_123",
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqProviderEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { providerCreatedAt: "desc" },
          { eventId: "desc" },
        ],
        take: 20,
        where: expect.objectContaining({
          deliveryStatus: {
            in: ["delivered", "failed"],
          },
          messageLookupKey: {
            in: expect.arrayContaining([
              expect.stringMatching(/^hbidx:linq-message:/u),
            ]),
          },
        }),
      }),
    );
    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          failedAt: new Date("2026-03-26T12:00:05.000Z"),
          failureCode: "30007",
          failureReason: "[redacted]",
          lastProviderEventId: createHostedLinqProviderEventLookupKey("evt_failed_123"),
          lastReceiptAt: new Date("2026-03-26T12:00:05.000Z"),
          status: "failed",
        }),
        where: expect.objectContaining({
          idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey("linq-message:event-123"),
          OR: expect.arrayContaining([
            {
              lastReceiptAt: {
                lt: new Date("2026-03-26T12:00:05.000Z"),
              },
            },
            {
              lastProviderEventId: null,
              lastReceiptAt: new Date("2026-03-26T12:00:05.000Z"),
            },
            {
              lastProviderEventId: {
                lt: createHostedLinqProviderEventLookupKey("evt_failed_123"),
              },
              lastReceiptAt: new Date("2026-03-26T12:00:05.000Z"),
            },
          ]),
        }),
      }),
    );
  });

  it("redacts direct send-failure details before recording delivery state", async () => {
    const fixture = createObservabilityPrismaFixture();

    await markHostedLinqDeliverySendFailedTx({
      failureCode: "LINQ_SEND_FAILED",
      failureReason: "Failed provider_msg_123 to +15551234567: private member text",
      idempotencyKey: "linq-message:event-123",
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCode: "LINQ_SEND_FAILED",
          failureReason: "[redacted]",
          status: "failed",
        }),
      }),
    );
    const update = fixture.hostedLinqDeliveryUpdateMany.mock.calls[0]?.[0];
    expect(JSON.stringify(update)).not.toContain("linq-message:event-123");
    expect(JSON.stringify(update)).not.toContain("provider_msg_123");
    expect(JSON.stringify(update)).not.toContain("+15551234567");
    expect(JSON.stringify(update)).not.toContain("private member text");
  });
});

function createObservabilityPrismaFixture() {
  const hostedLinqAlertCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqDeliveryCreate = vi.fn().mockResolvedValue({ id: "hld_random" });
  const hostedLinqDeliveryFindFirst = vi.fn().mockResolvedValue(null);
  const hostedLinqDeliveryFindUnique = vi.fn().mockResolvedValue(null);
  const hostedLinqDeliveryUpdate = vi.fn().mockResolvedValue(undefined);
  const hostedLinqDeliveryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqDeliveryUpsert = vi.fn().mockResolvedValue({ id: "hld_123" });
  const hostedLinqLineFindUnique = vi.fn().mockResolvedValue(null);
  const hostedLinqLineUpdate = vi.fn().mockImplementation((input: { where?: { phoneNumberLookupKey?: string } }) =>
    Promise.resolve({
      phoneNumberLookupKey: input.where?.phoneNumberLookupKey ?? "hbidx:phone:updated",
    }));
  const hostedLinqLineUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqLineUpsert = vi.fn().mockImplementation((input: { create: { phoneNumberLookupKey: string } }) =>
    Promise.resolve({
      phoneNumberLookupKey: input.create.phoneNumberLookupKey,
    }));
  const hostedLinqProviderEventCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqProviderEventFindFirst = vi.fn().mockResolvedValue(null);
  const hostedLinqProviderEventFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    hostedLinqAlert: {
      createMany: hostedLinqAlertCreateMany,
    },
    hostedLinqDelivery: {
      create: hostedLinqDeliveryCreate,
      findFirst: hostedLinqDeliveryFindFirst,
      findUnique: hostedLinqDeliveryFindUnique,
      update: hostedLinqDeliveryUpdate,
      updateMany: hostedLinqDeliveryUpdateMany,
      upsert: hostedLinqDeliveryUpsert,
    },
    hostedLinqLine: {
      findUnique: hostedLinqLineFindUnique,
      update: hostedLinqLineUpdate,
      updateMany: hostedLinqLineUpdateMany,
      upsert: hostedLinqLineUpsert,
    },
    hostedLinqProviderEvent: {
      createMany: hostedLinqProviderEventCreateMany,
      findFirst: hostedLinqProviderEventFindFirst,
      findMany: hostedLinqProviderEventFindMany,
    },
  };

  return {
    hostedLinqAlertCreateMany,
    hostedLinqDeliveryCreate,
    hostedLinqDeliveryFindFirst,
    hostedLinqDeliveryFindUnique,
    hostedLinqDeliveryUpdate,
    hostedLinqDeliveryUpdateMany,
    hostedLinqDeliveryUpsert,
    hostedLinqLineFindUnique,
    hostedLinqLineUpdate,
    hostedLinqLineUpdateMany,
    hostedLinqLineUpsert,
    hostedLinqProviderEventCreateMany,
    hostedLinqProviderEventFindFirst,
    hostedLinqProviderEventFindMany,
    prisma,
  };
}

function requireParsedProviderEvent(event: HostedLinqWebhookEvent) {
  const parsed = parseHostedLinqProviderEvent({
    event,
    rawBody: JSON.stringify(event),
  });
  if (!parsed) {
    throw new TypeError("Expected test provider event to parse.");
  }

  return parsed;
}

function buildProviderEvent(input: {
  createdAt?: string;
  data: Record<string, unknown>;
  eventId: string;
  eventType: string;
}): HostedLinqWebhookEvent {
  return {
    api_version: "v3",
    created_at: input.createdAt ?? "2026-03-26T12:00:00.000Z",
    data: input.data,
    event_id: input.eventId,
    event_type: input.eventType,
    trace_id: "trace_1234567890",
    webhook_version: "2026-02-03",
  } as HostedLinqWebhookEvent;
}

function buildMessageReceivedEvent(input: {
  direction: "inbound" | "outbound";
  eventId: string;
  isFromMe: boolean;
  messageId: string;
}): HostedLinqWebhookEvent {
  return {
    api_version: "v3",
    created_at: "2026-03-26T12:00:00.000Z",
    data: {
      chat: {
        id: "chat_123",
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner_123",
          is_me: true,
          service: "iMessage",
        },
      },
      chat_id: "chat_123",
      direction: input.direction,
      id: input.messageId,
      is_from_me: input.isFromMe,
      parts: [
        {
          type: "text",
          value: "hello",
        },
      ],
      sender_handle: {
        handle: "+15550000000",
        id: "handle_owner_123",
        service: "iMessage",
      },
      sent_at: "2026-03-26T12:00:00.000Z",
      service: "iMessage",
    },
    event_id: input.eventId,
    event_type: "message.received",
    trace_id: "trace_1234567890",
    webhook_version: "2026-02-03",
  } as HostedLinqWebhookEvent;
}

function configureHostedContactPrivacyKeyringForTest(input: {
  currentVersion: string;
  entries: Record<string, string>;
}): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousCurrent = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;

  return () => {
    if (previousKeys === undefined) {
      delete process.env.HOSTED_CONTACT_PRIVACY_KEYS;
    } else {
      process.env.HOSTED_CONTACT_PRIVACY_KEYS = previousKeys;
    }
    if (previousCurrent === undefined) {
      delete process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
    } else {
      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = previousCurrent;
    }
  };
}
