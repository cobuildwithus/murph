import { describe, expect, it, vi } from "vitest";

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  recordHostedLinqDeliveryAttemptTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import { ingestHostedLinqProviderEventTx } from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";

describe("hosted Linq observability stores", () => {
  it("records failed provider events, updates projections, and claims one event-scoped alert", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValue({
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
          eventId: "evt_failed_123",
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
    expect(fixture.hostedLinqLineUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          healthStatus: "warning",
          lastFailureCode: "30007",
          lastFailureReason: "[redacted]",
          totalFailedCount: { increment: 1 },
        }),
      }),
    );
    expect(fixture.hostedLinqDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCode: "30007",
          failureReason: "[redacted]",
          status: "failed",
        }),
        where: {
          id: "hld_attempt_123",
        },
      }),
    );
    expect(fixture.hostedLinqAlertCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryId: "hld_attempt_123",
          eventId: "evt_failed_123",
          kind: "message_failed",
          status: "pending",
        }),
        skipDuplicates: true,
      }),
    );
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
          lastOutboundAt: new Date("2026-03-26T12:00:00.000Z"),
          totalOutboundCount: { increment: 1 },
        },
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
          eventId: "evt_status_123",
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
          lastStatusEventId: "evt_status_123",
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
      lastStatusEventId: "evt_status_123",
      providerStatus: "ACTIVE",
    });
    expect(updateInput?.data).not.toHaveProperty("egressPolicy");
  });

  it("guards line status projection against stale status webhooks", async () => {
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
                lt: "evt_status_older",
              },
              providerUpdatedAt: new Date("2026-03-26T12:00:00.000Z"),
            },
          ],
        },
      }),
    );
  });

  it("records attempts and later preserves provider ids as lookup keys on acceptance", async () => {
    const fixture = createObservabilityPrismaFixture();

    await expect(recordHostedLinqDeliveryAttemptTx({
      idempotencyKey: "linq-message:event-123",
      linqChatId: "chat_123",
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-message:event-123",
      targetKind: "thread",
      template: "invite_signup",
    })).resolves.toEqual({
      id: "hld_123",
    });
    expect(fixture.hostedLinqDeliveryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          id: expect.stringMatching(/^hld_[a-f0-9]{32}$/u),
          idempotencyKey: "linq-message:event-123",
          status: "attempted",
        }),
        where: {
          idempotencyKey: "linq-message:event-123",
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
          messageIdSuffix: "ge_123",
          status: "accepted",
        }),
        where: {
          idempotencyKey: "linq-message:event-123",
        },
      }),
    );
    const updateData = fixture.hostedLinqDeliveryUpdateMany.mock.calls[0]?.[0]?.data as
      | Record<string, unknown>
      | undefined;
    expect(updateData?.messageLookupKey).not.toBe("provider_message_123");
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
    expect(JSON.stringify(update)).not.toContain("provider_msg_123");
    expect(JSON.stringify(update)).not.toContain("+15551234567");
    expect(JSON.stringify(update)).not.toContain("private member text");
  });
});

function createObservabilityPrismaFixture() {
  const hostedLinqAlertCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqDeliveryCreate = vi.fn().mockResolvedValue({ id: "hld_random" });
  const hostedLinqDeliveryFindUnique = vi.fn().mockResolvedValue(null);
  const hostedLinqDeliveryUpdate = vi.fn().mockResolvedValue(undefined);
  const hostedLinqDeliveryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqDeliveryUpsert = vi.fn().mockResolvedValue({ id: "hld_123" });
  const hostedLinqLineFindUnique = vi.fn().mockResolvedValue(null);
  const hostedLinqLineUpdate = vi.fn().mockResolvedValue(undefined);
  const hostedLinqLineUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqLineUpsert = vi.fn().mockResolvedValue(undefined);
  const hostedLinqProviderEventCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    hostedLinqAlert: {
      createMany: hostedLinqAlertCreateMany,
    },
    hostedLinqDelivery: {
      create: hostedLinqDeliveryCreate,
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
    },
  };

  return {
    hostedLinqAlertCreateMany,
    hostedLinqDeliveryFindUnique,
    hostedLinqDeliveryUpdate,
    hostedLinqDeliveryUpdateMany,
    hostedLinqDeliveryUpsert,
    hostedLinqLineUpdate,
    hostedLinqLineUpdateMany,
    hostedLinqLineUpsert,
    hostedLinqProviderEventCreateMany,
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
