import { describe, expect, it, vi } from "vitest";

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  createHostedLinqChatLookupKey,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedLinqMessageLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  applyHostedLinqDeliveryReceiptTx,
  buildHostedAiUsageGateNoticeIdempotencyKey,
  startHostedAiUsageLimitNoticeDispatchTx,
  claimHostedLinqDeliveryProviderDispatchTx,
  hasHostedLinqGroupLineRecoveryAuthorityTx,
  hasUnresolvedHostedLinqProviderDispatchForChatTx,
  markHostedAiUsageLimitNoticeDeliveryRetryableTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  markHostedLinqDeliverySkippedTx,
  readHostedLinqGroupLineRecoveryAuthoritiesTx,
  readHostedLinqGroupLineRecoveryAuthorityTx,
  readHostedLinqDeliveryProviderDispatchIntentsTx,
  recordHostedLinqDeliveryAttemptTx,
  recordHostedLinqRuntimeProviderDispatchFenceTx,
  recordHostedLinqRuntimeDeliveryOutcomeTx,
  resolveHostedLinqInviteSignupDispatchEffectIdTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  buildHostedLinqInviteSignupEffectId,
  buildHostedLinqInviteSignupEffectIdMemberPrefix,
  parseHostedLinqInviteSignupEffectId,
} from "@/src/lib/hosted-onboarding/linq-invite-signup-effect-id";
import {
  buildHostedLinqGroupLineRecoveryAttemptEffectId,
  buildHostedLinqGroupLineRecoveryEffectId,
  buildHostedLinqGroupLineRecoverySourceRef,
} from "@/src/lib/hosted-onboarding/linq-group-line-recovery";
import { HOSTED_LINQ_GROUP_SETUP_TEMPLATE } from "@/src/lib/hosted-onboarding/linq-group-setup";
import {
  ingestHostedLinqProviderEventTx,
  markHostedLinqGroupJoinOfferHandledTx,
} from "@/src/lib/hosted-onboarding/linq-provider-event-store";
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
const AI_USAGE_NOTICE_MEMBER_ID = "member_123";
const AI_USAGE_NOTICE_PERIOD_START = new Date("2026-03-01T00:00:00.000Z");

function buildCurrentAiUsageNoticeKey(
  usageCreditLedgerVersion = 0n,
): string {
  return buildHostedAiUsageGateNoticeIdempotencyKey({
    memberId: AI_USAGE_NOTICE_MEMBER_ID,
    periodStart: AI_USAGE_NOTICE_PERIOD_START,
    usageCreditLedgerVersion,
  });
}

describe("hosted Linq observability stores", () => {
  it("preserves the legacy zero-credit notice key and keys later capacity epochs by ledger version", () => {
    const legacyKey = buildCurrentAiUsageNoticeKey();
    const replenishedKey = buildCurrentAiUsageNoticeKey(2n);

    expect(legacyKey).toBe(
      "ai-usage-gate:3a2c4e20210115cdb00461b93c8ed458",
    );
    expect(replenishedKey).not.toBe(legacyKey);
    expect(buildCurrentAiUsageNoticeKey(2n)).toBe(replenishedKey);
  });

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

  it.each([
    "participant.added",
    "participant.removed",
  ] as const)(
    "records %s without participant identifiers, alerts, or line projection",
    async (eventType) => {
      const fixture = createObservabilityPrismaFixture();
      const event = requireParsedProviderEvent(buildProviderEvent({
        data: {
          chat_id: "chat_group_123",
          participant: {
            handle: "+15551234567",
            id: "participant_private_123",
            service: "iMessage",
          },
          [eventType === "participant.added" ? "added_at" : "removed_at"]:
            "2026-03-26T12:01:00.000Z",
        },
        eventId: `evt_${eventType.replace(".", "_")}_123`,
        eventType,
      }));

      await expect(ingestHostedLinqProviderEventTx({
        event,
        prisma: fixture.prisma as never,
      })).resolves.toEqual({
        alertIds: [],
        duplicate: false,
      });

      expect(fixture.hostedLinqProviderEventCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType,
            phoneNumberHint: null,
            phoneNumberLookupKey: null,
            phoneNumberRole: "unknown",
          }),
          skipDuplicates: true,
        }),
      );
      expect(JSON.stringify(fixture.hostedLinqProviderEventCreateMany.mock.calls))
        .not.toContain("+15551234567");
      expect(JSON.stringify(fixture.hostedLinqProviderEventCreateMany.mock.calls))
        .not.toContain("participant_private_123");
      expect(fixture.hostedLinqAlertCreateMany).not.toHaveBeenCalled();
      expect(fixture.hostedLinqLineUpsert).not.toHaveBeenCalled();
      expect(fixture.hostedLinqLineUpdate).not.toHaveBeenCalled();
      expect(fixture.hostedLinqLineUpdateMany).not.toHaveBeenCalled();
    },
  );

  it("persists message.sent correlation without advancing delivery or line health", async () => {
    const fixture = createObservabilityPrismaFixture();
    const messageId = "provider_message_sent_sms";
    fixture.hostedLinqLineFindUnique.mockResolvedValueOnce({
      phoneNumberHint: "+0000",
      phoneNumberLookupKey: "hbidx:phone:runtime-line",
    });

    await expect(recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt: new Date("2026-03-26T12:00:01.000Z"),
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      idempotencyKey: "assistant-outbox:intent_sent_sms",
      linqChatId: "chat_sent_sms",
      messageId,
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      sourceRef: "intent_sent_sms",
      targetKind: "participant",
      userId: "member_123",
    })).resolves.toMatchObject({
      recorded: true,
    });

    const acceptedDelivery = fixture.hostedLinqDeliveryCreate.mock.calls[0]?.[0]?.data;
    expect(acceptedDelivery).toMatchObject({
      messageLookupKey: expect.stringMatching(/^hbidx:linq-message:/u),
      status: "accepted",
    });
    const deliveryUpdateCount = fixture.hostedLinqDeliveryUpdateMany.mock.calls.length;
    const lineUpdateCount = fixture.hostedLinqLineUpdate.mock.calls.length;
    const lineUpdateManyCount = fixture.hostedLinqLineUpdateMany.mock.calls.length;

    const event = requireParsedProviderEvent(buildProviderEvent({
      createdAt: "2026-03-26T12:00:03.000Z",
      data: {
        chat: {
          id: "chat_sent_sms",
          owner_handle: {
            handle: "+15550000000",
            is_me: true,
            service: "SMS",
          },
        },
        direction: "outbound",
        id: messageId,
        sent_at: "2026-03-26T12:00:02.000Z",
        service: "SMS",
      },
      eventId: "evt_sent_sms",
      eventType: "message.sent",
    }));

    await expect(ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
      receivedAt: new Date("2026-03-26T12:00:04.000Z"),
    })).resolves.toEqual({
      alertIds: [],
      duplicate: false,
    });

    expect(fixture.hostedLinqProviderEventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: null,
          direction: "outbound",
          eventType: "message.sent",
          messageLookupKey: acceptedDelivery?.messageLookupKey,
          providerCreatedAt: new Date("2026-03-26T12:00:02.000Z"),
          service: "SMS",
        }),
        skipDuplicates: true,
      }),
    );
    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledTimes(deliveryUpdateCount);
    expect(fixture.hostedLinqLineUpdate).toHaveBeenCalledTimes(lineUpdateCount);
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledTimes(lineUpdateManyCount);
    expect(fixture.hostedLinqAlertCreateMany).not.toHaveBeenCalled();
  });

  it("records failed provider events, updates projections, and claims one event-scoped alert", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValue({
      id: "hld_attempt_123",
      idempotencyKey: null,
      phoneNumberLookupKey: null,
      sourceRef: null,
      template: null,
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
          // The provider's wording is the operator's evidence for why the send
          // failed, so it survives; the phone number inside it does not.
          failureReason: "carrier filtered <redacted-phone> provider_msg_123 private text",
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
          lastFailureReason: "carrier filtered <redacted-phone> provider_msg_123 private text",
          lastReceiptEventId: createHostedLinqProviderEventLookupKey("evt_failed_123"),
          totalFailedCount: { increment: 1 },
        }),
      }),
    );
    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCode: "30007",
          failureReason: "carrier filtered <redacted-phone> provider_msg_123 private text",
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

  it("names the line on a message.failed alert whose payload carries no phone number", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValue({
      id: "hld_attempt_456",
      idempotencyKey: null,
      phoneNumberLookupKey: "hbidx:phone:runtime-line",
      sourceRef: null,
      template: null,
    });
    fixture.hostedLinqLineFindUnique.mockResolvedValue({
      phoneNumberHint: "*** 0351",
      phoneNumberLookupKey: "hbidx:phone:runtime-line",
    });
    // A real `message.failed` payload names the chat and the message but not
    // the line, so the parsed event's own hint is null and the alert has to
    // read it off the line the delivery receipt resolved.
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        chat_id: "chat_failed_456",
        error: { code: "4001" },
        message_id: "msg_failed_456",
      },
      eventId: "evt_failed_456",
      eventType: "message.failed",
    }));
    expect(event.phoneNumberHint).toBeNull();
    expect(event.phoneNumberRole).toBe("unknown");

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
      receivedAt: new Date("2026-03-26T12:00:02.000Z"),
    });

    expect(fixture.hostedLinqAlertCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "message_failed",
          phoneNumberHint: "*** 0351",
          subject: "[Murph] Linq message failed *** 0351",
          detailsJson: expect.objectContaining({
            failureCode: "4001",
            line: "*** 0351",
          }),
        }),
        skipDuplicates: true,
      }),
    );
  });

  it.each([
    "invite_signup",
    "invite_signup_fallback",
  ] as const)("reopens onboarding link notice after %s terminal delivery failure", async (template) => {
    const fixture = createObservabilityPrismaFixture();
    const effectId = "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z";
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValue({
      id: `hld_${template}`,
      idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(effectId),
      phoneNumberLookupKey: null,
      sourceRef: effectId,
      template,
    });
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        error: {
          code: "30007",
          message: "carrier filtered",
        },
        message_id: "msg_failed_signup",
        phone_number: "+15550000000",
        service: "sms",
      },
      eventId: `evt_failed_${template}`,
      eventType: "message.failed",
    }));

    await expect(ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    })).resolves.toMatchObject({
      duplicate: false,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
        }),
        where: expect.objectContaining({
          id: `hld_${template}`,
        }),
      }),
    );
    expect(fixture.hostedLinqDailyStateUpdateMany).toHaveBeenCalledWith({
      where: {
        dayUtc: new Date("2026-03-26T00:00:00.000Z"),
        memberId: "member_123",
        onboardingLinkSentAt: {
          not: null,
        },
      },
      data: {
        onboardingLinkSentAt: null,
      },
    });
  });

  it("keeps the daily signup marker when a delayed generic failure follows a distinct group success", async () => {
    const fixture = createObservabilityPrismaFixture();
    const genericEffectId =
      "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z";
    const groupEffectId = buildHostedLinqInviteSignupEffectId({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:05:00.000Z",
      sourceEventDigest: "a".repeat(32),
    });
    const groupSourceRef = groupEffectId;
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValueOnce({
      id: "hld_generic_failed",
      idempotencyKey:
        createHostedLinqDeliveryIdempotencyLookupKey(genericEffectId),
      phoneNumberLookupKey: null,
      sourceRef: genericEffectId,
      template: "invite_signup",
    });
    fixture.hostedLinqDeliveryFindMany.mockResolvedValueOnce([
      { sourceRef: groupSourceRef },
    ]);

    await expect(ingestHostedLinqProviderEventTx({
      event: requireParsedProviderEvent(buildProviderEvent({
        createdAt: "2026-03-26T12:10:00.000Z",
        data: {
          error: { code: "30007", message: "carrier filtered" },
          message_id: "provider_msg_generic_delayed",
          phone_number: "+15550000000",
          service: "sms",
        },
        eventId: "evt_generic_delayed_failure",
        eventType: "message.failed",
      })),
      prisma: fixture.prisma as never,
    })).resolves.toMatchObject({
      duplicate: false,
    });

    expect(fixture.hostedLinqDailyStateUpdateMany).not.toHaveBeenCalled();
    expect(fixture.hostedGroupJoinOutreachUpdateMany).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDeliveryFindMany).toHaveBeenCalledWith({
      select: { sourceRef: true },
      where: {
        sourceRef: { startsWith: genericEffectId },
        status: {
          in: [
            "attempted",
            "provider_dispatch_started",
            "accepted",
            "delivered",
          ],
        },
        template: {
          in: ["invite_signup", "invite_signup_fallback"],
        },
      },
    });
  });

  it("restores onboarding after a delivered invite receipt and ignores non-onboarding terminal receipts", async () => {
    const fixture = createObservabilityPrismaFixture();
    const effectId = "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z";
    fixture.hostedLinqDeliveryFindFirst
      .mockResolvedValueOnce({
        id: "hld_delivered_signup",
        idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(effectId),
        phoneNumberLookupKey: null,
        sourceRef: effectId,
        template: "invite_signup",
      })
      .mockResolvedValueOnce({
        id: "hld_failed_quota",
        idempotencyKey: null,
        phoneNumberLookupKey: null,
        sourceRef: "linq-message:evt_quota",
        template: "daily_quota",
      });
    const delivered = requireParsedProviderEvent(buildProviderEvent({
      data: {
        message_id: "msg_delivered_signup",
        phone_number: "+15550000000",
        service: "sms",
      },
      eventId: "evt_delivered_signup",
      eventType: "message.delivered",
    }));
    const failedQuota = requireParsedProviderEvent(buildProviderEvent({
      data: {
        error: {
          code: "30007",
          message: "carrier filtered",
        },
        message_id: "msg_failed_quota",
        phone_number: "+15550000000",
        service: "sms",
      },
      eventId: "evt_failed_quota",
      eventType: "message.failed",
    }));

    await ingestHostedLinqProviderEventTx({
      event: delivered,
      prisma: fixture.prisma as never,
    });

    // A delivered invite receipt re-marks the member/day as sent, so daily
    // state tracks the latest terminal delivery truth even after a reopen.
    expect(fixture.hostedLinqDailyStateUpdateMany).toHaveBeenCalledTimes(1);
    expect(fixture.hostedLinqDailyStateUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          onboardingLinkSentAt: expect.any(Date),
        },
        where: expect.objectContaining({
          memberId: "member_123",
          onboardingLinkSentAt: null,
        }),
      }),
    );

    await ingestHostedLinqProviderEventTx({
      event: failedQuota,
      prisma: fixture.prisma as never,
    });

    // Non-onboarding terminal receipts never touch onboarding daily state.
    expect(fixture.hostedLinqDailyStateUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("does not regress projections but still claims event-scoped alerts for stale delivery receipts", async () => {
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
      alertIds: [expect.stringMatching(/^hla_message_failed_[a-f0-9]{32}$/u)],
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
    expect(fixture.hostedLinqLineUpdate).not.toHaveBeenCalled();
    expect(fixture.hostedLinqAlertCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryId: "hld_attempt_123",
          eventId: createHostedLinqProviderEventLookupKey("evt_failed_older"),
          kind: "message_failed",
        }),
        skipDuplicates: true,
      }),
    );
  });

  it("claims a failed-message alert when only the line receipt projection is stale", async () => {
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
      alertIds: [expect.stringMatching(/^hla_message_failed_[a-f0-9]{32}$/u)],
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
    expect(fixture.hostedLinqLineUpdate).not.toHaveBeenCalled();
    expect(fixture.hostedLinqAlertCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: createHostedLinqProviderEventLookupKey("evt_failed_stale_line"),
          kind: "message_failed",
        }),
        skipDuplicates: true,
      }),
    );
  });

  it("claims a failed-message alert when the delivery advances but the line receipt projection is stale", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValueOnce({
      id: "hld_attempt_older_than_line",
    });
    fixture.hostedLinqLineUpdateMany.mockResolvedValueOnce({ count: 0 });
    const event = requireParsedProviderEvent(buildProviderEvent({
      createdAt: "2026-03-26T12:01:00.000Z",
      data: {
        error: {
          code: "30007",
          message: "carrier filtered +15551234567 provider_msg_123 private text",
        },
        message_id: "msg_failed_older_than_line",
        phone_number: "+15550000000",
        service: "sms",
      },
      eventId: "evt_failed_delivery_stale_line",
      eventType: "message.failed",
    }));

    await expect(ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    })).resolves.toEqual({
      alertIds: [expect.stringMatching(/^hla_message_failed_[a-f0-9]{32}$/u)],
      duplicate: false,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
        }),
        where: expect.objectContaining({
          id: "hld_attempt_older_than_line",
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phoneNumberLookupKey: event.phoneNumberLookupKey,
        }),
      }),
    );
    expect(fixture.hostedLinqAlertCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryId: "hld_attempt_older_than_line",
          eventId: createHostedLinqProviderEventLookupKey("evt_failed_delivery_stale_line"),
          kind: "message_failed",
        }),
        skipDuplicates: true,
      }),
    );
  });

  it("claims event-scoped alerts for distinct same-timestamp failed provider events", async () => {
    const fixture = createObservabilityPrismaFixture();
    const firstEvent = requireParsedProviderEvent(buildProviderEvent({
      createdAt: "2026-03-26T12:00:00.000Z",
      data: {
        error: {
          code: "30007",
          message: "carrier filtered",
        },
        message_id: "msg_failed_same_timestamp_1",
        phone_number: "+15550000000",
        service: "sms",
      },
      eventId: "evt_failed_same_timestamp_1",
      eventType: "message.failed",
    }));
    const secondEvent = requireParsedProviderEvent(buildProviderEvent({
      createdAt: "2026-03-26T12:00:00.000Z",
      data: {
        error: {
          code: "30007",
          message: "carrier filtered",
        },
        message_id: "msg_failed_same_timestamp_2",
        phone_number: "+15550000000",
        service: "sms",
      },
      eventId: "evt_failed_same_timestamp_2",
      eventType: "message.failed",
    }));

    const first = await ingestHostedLinqProviderEventTx({
      event: firstEvent,
      prisma: fixture.prisma as never,
    });
    const second = await ingestHostedLinqProviderEventTx({
      event: secondEvent,
      prisma: fixture.prisma as never,
    });

    expect(first).toEqual({
      alertIds: [expect.stringMatching(/^hla_message_failed_[a-f0-9]{32}$/u)],
      duplicate: false,
    });
    expect(second).toEqual({
      alertIds: [expect.stringMatching(/^hla_message_failed_[a-f0-9]{32}$/u)],
      duplicate: false,
    });
    expect(first.alertIds[0]).not.toBe(second.alertIds[0]);
    expect(fixture.hostedLinqProviderEventCreateMany).toHaveBeenCalledTimes(2);
    expect(fixture.hostedLinqAlertCreateMany).toHaveBeenCalledTimes(2);
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              OR: [
                { lastReceiptEventId: null },
                {
                  lastReceiptEventId: {
                    lt: createHostedLinqProviderEventLookupKey("evt_failed_same_timestamp_1"),
                  },
                },
              ],
              lastReceiptAt: new Date("2026-03-26T12:00:00.000Z"),
            },
          ]),
        }),
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

  it("does not double-count runtime-owned outbound message.received echoes", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValueOnce({
      id: "hld_runtime_accepted",
      phoneNumberLookupKey: "hbidx:phone:runtime-line",
      source: "hosted_runtime_linq_delivery",
    });
    const event = requireParsedProviderEvent(buildMessageReceivedEvent({
      direction: "outbound",
      eventId: "evt_runtime_outbound_echo",
      isFromMe: true,
      messageId: "msg_runtime_outbound",
    }));

    await expect(ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    })).resolves.toEqual({
      alertIds: [],
      duplicate: false,
    });

    expect(fixture.hostedLinqLineUpdate).not.toHaveBeenCalled();
    expect(fixture.hostedLinqLineUpdateMany).not.toHaveBeenCalled();
    expect(fixture.hostedLinqAlertCreateMany).not.toHaveBeenCalled();
  });

  it("keeps counting non-runtime outbound message.received echoes", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValueOnce({
      id: "hld_web_side_effect",
      phoneNumberLookupKey: "hbidx:phone:web-line",
      source: "hosted_webhook_side_effect",
    });
    const event = requireParsedProviderEvent(buildMessageReceivedEvent({
      direction: "outbound",
      eventId: "evt_web_outbound_echo",
      isFromMe: true,
      messageId: "msg_web_outbound",
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

  it("recognizes and atomically marks a terminal group-join reaction", async () => {
    const fixture = createObservabilityPrismaFixture();
    const handledAt = new Date("2026-03-26T12:01:00.000Z");

    await markHostedLinqGroupJoinOfferHandledTx({
      eventId: "evt_group_join_handled",
      handledAt,
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqProviderEventUpdateMany).toHaveBeenCalledWith({
      data: { groupJoinOfferHandledAt: handledAt },
      where: {
        eventId: createHostedLinqProviderEventLookupKey(
          "evt_group_join_handled",
        ),
        groupJoinOfferHandledAt: null,
      },
    });

    fixture.hostedLinqProviderEventCreateMany.mockResolvedValueOnce({ count: 0 });
    fixture.hostedLinqProviderEventFindUnique.mockResolvedValueOnce({
      groupJoinOfferHandledAt: handledAt,
    });
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        chat_id: "chat_group_123",
        from_handle: { handle: "+15551234567", service: "iMessage" },
        message_id: "msg_offer_123",
        reaction_type: "like",
      },
      eventId: "evt_group_join_handled",
      eventType: "reaction.added",
    }));

    await expect(ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    })).resolves.toEqual({
      alertIds: [],
      duplicate: true,
      groupJoinOfferHandled: true,
    });
  });

  it("advances delivery rows for same-timestamp delivered receipts only by provider event id", async () => {
    const fixture = createObservabilityPrismaFixture();
    const providerCreatedAt = new Date("2026-03-26T12:00:00.000Z");
    const eventLookupKey = createHostedLinqProviderEventLookupKey("evt_delivered_same_timestamp");
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValueOnce({
      id: "hld_delivered_same_timestamp",
      phoneNumberLookupKey: null,
    });
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        message_id: "msg_delivered_same_timestamp",
        phone_number: "+15550000000",
      },
      eventId: "evt_delivered_same_timestamp",
      eventType: "message.delivered",
    }));

    await applyHostedLinqDeliveryReceiptTx({
      event,
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "hld_delivered_same_timestamp",
          OR: [
            { lastReceiptAt: null },
            { lastReceiptAt: { lt: providerCreatedAt } },
            {
              lastReceiptAt: providerCreatedAt,
              OR: [
                { lastProviderEventId: null },
                { lastProviderEventId: { lt: eventLookupKey } },
              ],
            },
          ],
        }),
      }),
    );
  });

  it("advances line totals for same-timestamp delivered receipts only by provider event id", async () => {
    const fixture = createObservabilityPrismaFixture();
    const providerCreatedAt = new Date("2026-03-26T12:00:00.000Z");
    const eventLookupKey = createHostedLinqProviderEventLookupKey("evt_delivered_line_same_timestamp");
    const event = requireParsedProviderEvent(buildProviderEvent({
      data: {
        message_id: "msg_delivered_line_same_timestamp",
        phone_number: "+15550000000",
      },
      eventId: "evt_delivered_line_same_timestamp",
      eventType: "message.delivered",
    }));

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalDeliveredCount: { increment: 1 },
        }),
        where: expect.objectContaining({
          OR: [
            { lastReceiptAt: null },
            { lastReceiptAt: { lt: providerCreatedAt } },
            {
              OR: [
                { lastReceiptEventId: null },
                { lastReceiptEventId: { lt: eventLookupKey } },
              ],
              lastReceiptAt: providerCreatedAt,
            },
          ],
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          healthStatus: "healthy",
          lastDeliveredAt: providerCreatedAt,
          lastReceiptAt: providerCreatedAt,
        }),
        where: expect.objectContaining({
          lastReceiptAt: providerCreatedAt,
          lastReceiptEventId: eventLookupKey,
        }),
      }),
    );
  });

  it("preserves the stored line lookup key for provider status after key rotation", async () => {
    const restore = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: OBSERVABILITY_TEST_KEYRING_ENTRIES,
    });
    const legacyLineLookupKey = createHostedPhoneLookupKey("+15550000000");
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";

    if (!legacyLineLookupKey) {
      throw new Error("Expected legacy line lookup key.");
    }

    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqLineFindMany.mockResolvedValueOnce([{
      phoneNumberLookupKey: legacyLineLookupKey,
    }]);

    try {
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

      expect(fixture.hostedLinqLineUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { phoneNumberLookupKey: legacyLineLookupKey },
        }),
      );
      expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          providerReputationStatus: "CRITICAL",
        }),
        where: expect.objectContaining({
          phoneNumberLookupKey: legacyLineLookupKey,
        }),
      });
      expect(fixture.hostedLinqProviderEventCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phoneNumberLookupKey: legacyLineLookupKey,
            providerReputationStatus: "CRITICAL",
            providerServiceStatus: null,
          }),
        }),
      );
    } finally {
      restore();
    }
  });

  it("projects service and reputation independently without changing delivery health", async () => {
    const fixture = createObservabilityPrismaFixture();
    const event = requireParsedProviderEvent(buildProviderEvent({
      createdAt: "2026-03-26T11:59:59.000Z",
      data: {
        changed_at: "2026-03-26T12:00:00.000Z",
        new_reputation: "CRITICAL",
        new_status: "FLAGGED",
        phone_number: "+15550000000",
      },
      eventId: "evt_status_123",
      eventType: "phone_number.status_updated",
    }));

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
      receivedAt: new Date("2026-03-26T12:00:01.000Z"),
    });

    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerReputationStatus: "CRITICAL",
        providerReputationUpdatedAt: new Date("2026-03-26T12:00:00.000Z"),
      }),
      where: expect.objectContaining({
        phoneNumberLookupKey: expect.any(String),
      }),
    });
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerServiceStatus: "FLAGGED",
        providerServiceUpdatedAt: new Date("2026-03-26T12:00:00.000Z"),
      }),
      where: expect.objectContaining({
        phoneNumberLookupKey: expect.any(String),
      }),
    });
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerLastSeenAt: new Date("2026-03-26T12:00:01.000Z"),
        providerSeenAt: new Date("2026-03-26T12:00:01.000Z"),
      }),
      where: expect.objectContaining({
        phoneNumberLookupKey: expect.any(String),
      }),
    });
    expect(fixture.hostedLinqProviderEventCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerReputationStatus: "CRITICAL",
          providerServiceStatus: "FLAGGED",
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

  it("projects webhook chat health without persisting participant content", async () => {
    const fixture = createObservabilityPrismaFixture();
    const rawEvent = buildMessageReceivedEvent({
      direction: "inbound",
      eventId: "evt_chat_health",
      isFromMe: false,
      messageId: "message_chat_health",
    });
    const data = rawEvent.data as Record<string, unknown>;
    const chat = data.chat as Record<string, unknown>;
    chat.health_status = {
      status: "AT_RISK",
      updated_at: "2026-03-26T12:00:00.000Z",
    };
    const event = requireParsedProviderEvent(rawEvent);

    await ingestHostedLinqProviderEventTx({
      event,
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqChatHealthCreateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linqChatLookupKey: event.linqChatLookupKey,
        phoneNumberLookupKey: event.phoneNumberLookupKey,
        providerStatus: "AT_RISK",
        providerUpdatedAt: new Date("2026-03-26T12:00:00.000Z"),
      }),
      skipDuplicates: true,
    });
    expect(JSON.stringify(fixture.hostedLinqChatHealthCreateMany.mock.calls))
      .not.toContain("hello");
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

  it("records a runtime provider-dispatch fence before the provider call", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:00:00.000Z");

    const fence = await recordHostedLinqRuntimeProviderDispatchFenceTx({
      attemptedAt,
      idempotencyKey: "assistant-outbox:intent-123",
      linqChatId: "chat_123",
      prisma: fixture.prisma as never,
      sourceRef: "intent-123",
      targetKind: "thread",
    });
    expect(fence).toEqual({
      claimed: true,
      id: expect.stringMatching(/^hld_[a-f0-9]{32}$/u),
    });

    expect(fixture.hostedLinqDeliveryCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        attemptedAt,
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:/u),
        source: "hosted_runtime_linq_delivery",
        status: "provider_dispatch_started",
        targetKind: "thread",
      })],
      skipDuplicates: true,
    });

    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt,
      deliveredAt: null,
      failedAt: null,
      id: fence.id,
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: null,
      skippedAt: null,
      source: "hosted_runtime_linq_delivery",
      status: "provider_dispatch_started",
    });
    const outcome = await recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt: new Date("2026-03-26T12:00:01.000Z"),
      attemptedAt,
      idempotencyKey: "assistant-outbox:intent-123",
      linqChatId: "chat_123",
      messageId: "provider_message_123",
      prisma: fixture.prisma as never,
      sourceRef: "intent-123",
      targetKind: "thread",
      userId: "member_123",
    });

    expect(outcome).toMatchObject({
      deliveryId: fence.id,
      recorded: true,
    });
  });

  it("detects an unresolved dispatch for a transitioning chat without expiry", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValueOnce({
      id: "hld_in_flight",
    });
    await expect(hasUnresolvedHostedLinqProviderDispatchForChatTx({
      linqChatId: "chat_123",
      prisma: fixture.prisma as never,
    })).resolves.toBe(true);

    expect(fixture.hostedLinqDeliveryFindFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: expect.objectContaining({
        linqChatLookupKey: {
          in: createHostedLinqChatLookupKeyReadCandidates("chat_123"),
        },
        failedAt: null,
        status: "provider_dispatch_started",
      }),
    });
  });

  it("claims provider dispatch by creating the delivery idempotency row", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:00:00.000Z");
    const deliveryIdempotencyLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
      "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
    );

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      linqChatId: "chat_123",
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      targetKind: "thread",
      template: "invite_signup",
    })).resolves.toEqual({
      claimed: true,
      id: expect.stringMatching(/^hld_[a-f0-9]{32}$/u),
    });

    expect(fixture.hostedLinqDeliveryFindUnique).toHaveBeenCalledWith({
      select: expect.objectContaining({
        attemptedAt: true,
      }),
      where: {
        idempotencyKey: deliveryIdempotencyLookupKey,
      },
    });
    expect(fixture.hostedLinqDeliveryCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
          attemptedAt,
          idempotencyKey: deliveryIdempotencyLookupKey,
          status: "attempted",
      })],
      skipDuplicates: true,
    });
  });

  it("persists the exact group-reply occurrence and outreach relation on the delivery", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:00:01.000Z");
    const replyOccurredAt = new Date("2026-03-26T11:59:58.321Z");
    const effectId = buildHostedLinqInviteSignupEffectId({
      groupJoinOutreachId: "hgrpjoa_exact_reply",
      memberId: "member_123",
      occurredAt: replyOccurredAt,
      sourceEventId: "evt_exact_group_reply",
    });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      groupJoinOutreachId: "hgrpjoa_exact_reply",
      groupJoinReplyOccurredAt: replyOccurredAt,
      idempotencyKey: effectId,
      linqChatId: "chat_exact_reply",
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: effectId,
      targetKind: "thread",
      template: "invite_signup",
    })).resolves.toMatchObject({ claimed: true });

    expect(fixture.hostedLinqDeliveryCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        groupJoinOutreachId: "hgrpjoa_exact_reply",
        groupJoinReplyOccurredAt: replyOccurredAt,
        sourceRef: effectId,
      })],
      skipDuplicates: true,
    });
  });

  it("rejects incomplete group-aware signup delivery context before persistence", async () => {
    const fixture = createObservabilityPrismaFixture();
    const effectId = buildHostedLinqInviteSignupEffectId({
      groupJoinOutreachId: "hgrpjoa_incomplete_reply",
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      sourceEventId: "evt_incomplete_group_reply",
    });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      groupJoinOutreachId: "hgrpjoa_incomplete_reply",
      idempotencyKey: effectId,
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: effectId,
      targetKind: "thread",
      template: "invite_signup",
    })).rejects.toThrow(
      "Hosted Linq group-aware signup delivery requires the exact reply occurrence time.",
    );
    expect(fixture.hostedLinqDeliveryFindUnique).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDeliveryCreateMany).not.toHaveBeenCalled();
  });

  it("re-reads a concurrent provider-dispatch row after duplicate-safe creation", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:00:00.000Z");
    fixture.hostedLinqDeliveryFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        acceptedAt: null,
        attemptedAt,
        deliveredAt: null,
        failedAt: null,
        groupJoinOutreachId: null,
        id: "hld_concurrent_claim",
        lastReceiptAt: null,
        linqChatLookupKey: null,
        messageLookupKey: null,
        phoneNumberLookupKey: null,
        skippedAt: null,
        source: "hosted_webhook_side_effect",
        sourceRef: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
        status: "attempted",
        targetKind: "thread",
        template: "invite_signup",
      });
    fixture.hostedLinqDeliveryCreateMany.mockResolvedValueOnce({ count: 0 });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      targetKind: "thread",
      template: "invite_signup",
    })).resolves.toEqual({
      claimed: false,
      id: "hld_concurrent_claim",
      retryAt: new Date("2026-03-26T12:15:00.000Z"),
    });

    expect(fixture.hostedLinqDeliveryCreateMany).toHaveBeenCalledWith({
      data: [expect.any(Object)],
      skipDuplicates: true,
    });
    expect(fixture.hostedLinqDeliveryFindUnique).toHaveBeenCalledTimes(2);
  });

  it("does not claim provider dispatch while the same idempotency row is already in flight", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      groupJoinOutreachId: null,
      id: "hld_in_flight",
      lastReceiptAt: null,
      linqChatLookupKey:
        createHostedLinqChatLookupKeyReadCandidates("chat_123")[0],
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      skippedAt: null,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      status: "provider_dispatch_started",
      targetKind: "thread",
      template: "invite_signup",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt: new Date("2026-03-26T12:00:30.000Z"),
      idempotencyKey: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      linqChatId: "chat_123",
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      targetKind: "thread",
      template: "invite_signup",
    })).resolves.toEqual({
      claimed: false,
      id: "hld_in_flight",
      retryAt: new Date("2026-03-26T12:15:00.000Z"),
    });

    expect(fixture.hostedLinqDeliveryCreate).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
  });

  it("reclaims stale same-source Linq usage rows through provider idempotency", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:30:00.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      id: "hld_started_webhook_notice",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      skippedAt: null,
      source: "hosted_webhook_side_effect",
      status: "provider_dispatch_started",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "ai-usage-gate:member_123:2026-03",
      linqChatId: "chat_123",
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "ai-usage-gate:member_123:2026-03",
      targetKind: "thread",
      template: "ai_usage_quota",
    })).resolves.toEqual({
      claimed: true,
      id: "hld_started_webhook_notice",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptedAt,
          source: "hosted_webhook_side_effect",
          status: "attempted",
          template: "ai_usage_quota",
        }),
        where: expect.objectContaining({
          id: "hld_started_webhook_notice",
          OR: expect.arrayContaining([{
            attemptedAt: {
              lte: new Date("2026-03-26T12:15:00.000Z"),
            },
            source: "hosted_webhook_side_effect",
            status: "provider_dispatch_started",
            template: "ai_usage_quota",
          }]),
        }),
      }),
    );
  });

  it("does not let Telegram usage notices reclaim stale webhook dispatch-started rows", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:30:00.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      id: "hld_started_webhook_notice",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      skippedAt: null,
      source: "hosted_webhook_side_effect",
      status: "provider_dispatch_started",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "ai-usage-gate:member_123:2026-03",
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram_event_runtime_denied",
      targetKind: "telegram_thread",
      template: "ai_usage_quota",
    })).resolves.toEqual({
      claimed: false,
      id: "hld_started_webhook_notice",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "hld_started_webhook_notice",
        }),
      }),
    );
    const updateWhere = fixture.hostedLinqDeliveryUpdateMany.mock.calls[0]?.[0]?.where;
    expect(updateWhere?.OR).not.toContainEqual({
      attemptedAt: {
        lte: new Date("2026-03-26T12:15:00.000Z"),
      },
      source: "hosted_runtime_ai_usage_limit_notice",
      status: "provider_dispatch_started",
    });
  });

  it("lets Telegram usage notices reclaim stale webhook attempted rows", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:30:00.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      id: "hld_stale_webhook_attempt",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      skippedAt: null,
      source: "hosted_webhook_side_effect",
      status: "attempted",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "ai-usage-gate:member_123:2026-03",
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram_event_runtime_denied",
      targetKind: "telegram_thread",
      template: "ai_usage_quota",
    })).resolves.toEqual({
      claimed: true,
      id: "hld_stale_webhook_attempt",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptedAt,
          source: "hosted_runtime_ai_usage_limit_notice",
          status: "attempted",
        }),
        where: expect.objectContaining({
          id: "hld_stale_webhook_attempt",
          OR: expect.arrayContaining([
            {
              attemptedAt: {
                lte: new Date("2026-03-26T12:15:00.000Z"),
              },
              status: "attempted",
            },
          ]),
        }),
      }),
    );
  });

  it("keeps stale Telegram dispatch-started rows terminally ambiguous", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:30:00.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      id: "hld_started_telegram_notice",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      skippedAt: null,
      source: "hosted_runtime_ai_usage_limit_notice",
      status: "provider_dispatch_started",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "ai-usage-gate:member_123:2026-03",
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram_event_runtime_denied",
      targetKind: "telegram_thread",
      template: "ai_usage_quota",
    })).resolves.toEqual({
      claimed: false,
      id: "hld_started_telegram_notice",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "hld_started_telegram_notice",
        }),
      }),
    );
    const updateWhere = fixture.hostedLinqDeliveryUpdateMany.mock.calls[0]?.[0]?.where;
    expect(updateWhere?.OR).not.toContainEqual(expect.objectContaining({
      source: "hosted_runtime_ai_usage_limit_notice",
      status: "provider_dispatch_started",
    }));
  });

  it("does not reclaim stale pre-provider Telegram usage notice rows without opt-in", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:30:00.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      id: "hld_stale_telegram_attempt",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: null,
      skippedAt: null,
      source: "hosted_runtime_ai_usage_limit_notice",
      status: "attempted",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "ai-usage-gate:member_123:2026-03",
      prisma: fixture.prisma as never,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram_event_runtime_denied",
      targetKind: "telegram_thread",
      template: "ai_usage_quota",
    })).resolves.toEqual({
      claimed: false,
      id: "hld_stale_telegram_attempt",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
  });

  it("does not reclaim an ambiguous non-rate-limit Telegram response", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:30:00.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failureCode: "HOSTED_TELEGRAM_API_RESPONSE_REJECTED",
      failedAt: new Date("2026-03-26T12:00:01.000Z"),
      id: "hld_failed_telegram_notice",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: null,
      skippedAt: null,
      source: "hosted_runtime_ai_usage_limit_notice",
      status: "failed",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "telegram-access-notice:event-ambiguous",
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      returnExistingFailureCode: true,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram:update:ambiguous",
      targetKind: "telegram_thread",
      template: "access_notice",
    })).resolves.toEqual({
      claimed: false,
      failureCode: "HOSTED_TELEGRAM_API_RESPONSE_REJECTED",
      id: "hld_failed_telegram_notice",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "hld_failed_telegram_notice",
          OR: [{
            attemptedAt: {
              lte: new Date("2026-03-26T12:15:00.000Z"),
            },
            status: "attempted",
          }],
        }),
      }),
    );
  });

  it("returns a persisted Telegram failure code only when the caller requests it", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:30:00.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failureCode: "telegram_access_notice_definite_failure",
      failedAt: new Date("2026-03-26T12:00:01.000Z"),
      id: "hld_failed_telegram_notice",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: null,
      skippedAt: null,
      source: "hosted_runtime_ai_usage_limit_notice",
      status: "failed",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "telegram-access-notice:event-123",
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      returnExistingFailureCode: true,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram:update:123",
      targetKind: "telegram_thread",
      template: "access_notice",
    })).resolves.toEqual({
      claimed: false,
      failureCode: "telegram_access_notice_definite_failure",
      id: "hld_failed_telegram_notice",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "hld_failed_telegram_notice",
        }),
      }),
    );
  });

  it("does not reclaim retry-after failed Telegram usage notice rows before their not-before time", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:14:30.000Z");
    const failedAt = new Date("2026-03-26T12:00:01.000Z");
    const retryAt = new Date("2026-03-26T12:15:01.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failureCode: "HostedRuntimeTelegramUsageLimitNoticeRetryAfterError",
      failedAt,
      id: "hld_retry_after_telegram_notice",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: retryAt,
      skippedAt: null,
      source: "hosted_runtime_ai_usage_limit_notice",
      status: "failed",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "ai-usage-gate:member_123:2026-03",
      prisma: fixture.prisma as never,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram_event_runtime_denied",
      targetKind: "telegram_thread",
      template: "ai_usage_quota",
    })).resolves.toEqual({
      claimed: false,
      id: "hld_retry_after_telegram_notice",
      retryAt,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
  });

  it("does not reclaim unavailable failed Telegram usage notice rows before their not-before time", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:14:30.000Z");
    const failedAt = new Date("2026-03-26T12:00:01.000Z");
    const retryAt = new Date("2026-03-26T12:15:01.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failureCode: "HostedRuntimeTelegramUsageLimitNoticeUnavailableError",
      failedAt,
      id: "hld_unavailable_telegram_notice",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: retryAt,
      skippedAt: null,
      source: "hosted_runtime_ai_usage_limit_notice",
      status: "failed",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "ai-usage-gate:member_123:2026-03",
      prisma: fixture.prisma as never,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram_event_runtime_denied",
      targetKind: "telegram_thread",
      template: "ai_usage_quota",
    })).resolves.toEqual({
      claimed: false,
      id: "hld_unavailable_telegram_notice",
      retryAt,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
  });

  it("reclaims retry-after failed Telegram usage notice rows after their not-before time", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:15:01.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failureCode: "HostedRuntimeTelegramUsageLimitNoticeRetryAfterError",
      failedAt: new Date("2026-03-26T12:00:01.000Z"),
      id: "hld_retry_after_telegram_notice",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: attemptedAt,
      skippedAt: null,
      source: "hosted_runtime_ai_usage_limit_notice",
      status: "failed",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "ai-usage-gate:member_123:2026-03",
      prisma: fixture.prisma as never,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram_event_runtime_denied",
      targetKind: "telegram_thread",
      template: "ai_usage_quota",
    })).resolves.toEqual({
      claimed: true,
      id: "hld_retry_after_telegram_notice",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptedAt,
          failedAt: null,
          skippedAt: null,
          status: "attempted",
        }),
        where: expect.objectContaining({
          id: "hld_retry_after_telegram_notice",
          OR: expect.arrayContaining([
            {
              failedAt: {
                not: null,
              },
              retryAfterAt: {
                lte: attemptedAt,
              },
              source: "hosted_runtime_ai_usage_limit_notice",
            },
          ]),
        }),
      }),
    );
  });

  it("reclaims stale pre-provider Telegram usage notice rows when the caller opts in", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:30:00.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      id: "hld_stale_telegram_attempt",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      skippedAt: null,
      source: "hosted_runtime_ai_usage_limit_notice",
      status: "attempted",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "ai-usage-gate:member_123:2026-03",
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram_event_runtime_denied",
      targetKind: "telegram_thread",
      template: "ai_usage_quota",
    })).resolves.toEqual({
      claimed: true,
      id: "hld_stale_telegram_attempt",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptedAt,
          failedAt: null,
          skippedAt: null,
          status: "attempted",
        }),
        where: expect.objectContaining({
          id: "hld_stale_telegram_attempt",
          OR: expect.arrayContaining([
            {
              attemptedAt: {
                lte: new Date("2026-03-26T12:15:00.000Z"),
              },
              status: "attempted",
            },
          ]),
        }),
      }),
    );
  });

  it("claims the current AI usage notice key when no delivery row exists", async () => {
    const fixture = createObservabilityPrismaFixture();
    const currentIdempotencyKey = buildCurrentAiUsageNoticeKey();

    await expect(startHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
      memberId: "member_123",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-message:event-123",
      targetKind: "thread",
      usageCreditLedgerVersion: 0n,
    })).resolves.toEqual({
      idempotencyKey: currentIdempotencyKey,
      providerIdempotencyKey: expect.stringMatching(
        /^ai-usage-attempt:hld_[A-Za-z0-9_-]{16}$/u,
      ),
      status: "claimed",
    });

    expect(fixture.hostedLinqDeliveryCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(
          currentIdempotencyKey,
        ),
        source: "hosted_webhook_side_effect",
        status: "provider_dispatch_started",
        template: "ai_usage_quota",
      })],
      skipDuplicates: true,
    });
    expect(fixture.transaction).toHaveBeenCalledOnce();
  });

  it("locks and revalidates chat authority before claiming an AI usage dispatch", async () => {
    const fixture = createObservabilityPrismaFixture();
    const assertDispatchAuthority = vi.fn().mockResolvedValue(undefined);

    await expect(startHostedAiUsageLimitNoticeDispatchTx({
      assertDispatchAuthority,
      attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
      linqChatId: "chat_123",
      memberId: "member_123",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-message:event-123",
      targetKind: "thread",
      usageCreditLedgerVersion: 0n,
    })).resolves.toMatchObject({ status: "claimed" });

    expect(fixture.executeRaw).toHaveBeenCalledOnce();
    expect(assertDispatchAuthority).toHaveBeenCalledWith(fixture.prisma);
    const [lockOrder] = fixture.executeRaw.mock.invocationCallOrder;
    const [authorityOrder] = assertDispatchAuthority.mock.invocationCallOrder;
    const [claimOrder] = fixture.hostedLinqDeliveryCreateMany.mock.invocationCallOrder;
    expect(Number(lockOrder)).toBeLessThan(Number(authorityOrder));
    expect(Number(authorityOrder)).toBeLessThan(Number(claimOrder));
  });

  it.each([
    {
      label: "provider-correlated",
      row: {
        acceptedAt: new Date("2026-03-26T12:00:01.000Z"),
        attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
        deliveredAt: null,
        failedAt: null,
        failureCode: null,
        id: "hld_accepted_usage_notice",
        lastReceiptAt: null,
        messageLookupKey: null,
        phoneNumberLookupKey: null,
        retryAfterAt: null,
        skippedAt: null,
        source: "hosted_webhook_side_effect",
        status: "accepted",
      },
    },
    {
      label: "unidentifiable rich-link partial delivery",
      row: {
        acceptedAt: null,
        attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
        deliveredAt: null,
        failedAt: new Date("2026-03-26T12:00:01.000Z"),
        failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        id: "hld_partial_usage_notice",
        lastReceiptAt: null,
        messageLookupKey: null,
        phoneNumberLookupKey: null,
        retryAfterAt: null,
        skippedAt: null,
        source: "hosted_webhook_side_effect",
        status: "failed",
      },
    },
    {
      label: "terminal Telegram",
      row: {
        acceptedAt: null,
        attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
        deliveredAt: null,
        failedAt: new Date("2026-03-26T12:00:01.000Z"),
        failureCode: "HostedRuntimeTelegramUsageLimitNoticeRejectedError",
        id: "hld_terminal_telegram_usage_notice",
        lastReceiptAt: null,
        messageLookupKey: null,
        phoneNumberLookupKey: null,
        retryAfterAt: null,
        skippedAt: null,
        source: "hosted_runtime_ai_usage_limit_notice",
        status: "failed",
      },
    },
  ])("treats $label AI usage notice rows as already notified", async ({ row }) => {
    const fixture = createObservabilityPrismaFixture();
    const currentIdempotencyKey = buildCurrentAiUsageNoticeKey();
    const delivery = {
      ...row,
      idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(
        currentIdempotencyKey,
      ),
    };
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValue(delivery);
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(startHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
      memberId: "member_123",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-message:event-123",
      targetKind: "thread",
      usageCreditLedgerVersion: 0n,
    })).resolves.toEqual({ status: "already_notified" });

    expect(fixture.hostedLinqDeliveryCreate).not.toHaveBeenCalled();
    if (row.source === "hosted_webhook_side_effect") {
      expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
    }
  });

  it("keeps a fresh current AI usage notice claim in flight", async () => {
    const fixture = createObservabilityPrismaFixture();
    const currentIdempotencyKey = buildCurrentAiUsageNoticeKey();
    const delivery = {
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:20:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      failureCode: null,
      id: "hld_fresh_current_usage_notice",
      idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(
        currentIdempotencyKey,
      ),
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: null,
      skippedAt: null,
      source: "hosted_webhook_side_effect",
      status: "attempted",
    };
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValue(delivery);
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(startHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
      memberId: "member_123",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-message:event-123",
      targetKind: "thread",
      usageCreditLedgerVersion: 0n,
    })).resolves.toEqual({
      retryAt: new Date("2026-03-26T12:35:00.000Z"),
      status: "in_flight",
    });

    expect(fixture.hostedLinqDeliveryFindUnique).toHaveBeenCalledTimes(1);
  });

  it.each([
    "attempted",
    "provider_dispatch_started",
  ] as const)("safely reclaims a stale current AI usage notice $status claim", async (status) => {
    const fixture = createObservabilityPrismaFixture();
    const currentIdempotencyKey = buildCurrentAiUsageNoticeKey();
    const staleDelivery = {
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      failureCode: null,
      id: "hld_stale_current_usage_notice",
      idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(
        currentIdempotencyKey,
      ),
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: null,
      skippedAt: null,
      source: "hosted_webhook_side_effect",
      status,
    };
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce(staleDelivery);

    await expect(startHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
      memberId: "member_123",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-message:event-123",
      targetKind: "thread",
      usageCreditLedgerVersion: 0n,
    })).resolves.toEqual({
      idempotencyKey: currentIdempotencyKey,
      providerIdempotencyKey:
        "ai-usage-attempt:hld_stale_current_usage_notice",
      status: "claimed",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
          status: "provider_dispatch_started",
        }),
        where: expect.objectContaining({
          id: "hld_stale_current_usage_notice",
        }),
      }),
    );
  });

  it("does not let Telegram replace a stale Linq provider-dispatch fence", async () => {
    const fixture = createObservabilityPrismaFixture();
    const currentIdempotencyKey = buildCurrentAiUsageNoticeKey();
    const staleDelivery = {
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      failureCode: null,
      id: "hld_stale_linq_dispatch",
      idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(
        currentIdempotencyKey,
      ),
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: null,
      skippedAt: null,
      source: "hosted_webhook_side_effect",
      status: "provider_dispatch_started",
    };
    fixture.hostedLinqDeliveryFindUnique
      .mockResolvedValueOnce(staleDelivery)
      .mockResolvedValueOnce(staleDelivery);
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(startHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
      memberId: "member_123",
      periodStart: AI_USAGE_NOTICE_PERIOD_START,
      prisma: fixture.prisma as never,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram-update:123",
      targetKind: "telegram_thread",
      usageCreditLedgerVersion: 0n,
    })).resolves.toEqual({ status: "already_notified" });

    expect(fixture.hostedLinqDeliveryFindUnique).toHaveBeenCalledTimes(2);
  });

  it("does not let Telegram replace a failed Linq usage-limit attempt", async () => {
    const fixture = createObservabilityPrismaFixture();
    const currentIdempotencyKey = buildCurrentAiUsageNoticeKey();
    const failedDelivery = {
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:20:00.000Z"),
      deliveredAt: null,
      failedAt: new Date("2026-03-26T12:20:01.000Z"),
      failureCode: "linq_usage_limit_dispatch_retryable",
      id: "hld_failed_linq_dispatch",
      idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(
        currentIdempotencyKey,
      ),
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: null,
      skippedAt: null,
      source: "hosted_webhook_side_effect",
      status: "failed",
    };
    fixture.hostedLinqDeliveryFindUnique
      .mockResolvedValueOnce(failedDelivery)
      .mockResolvedValueOnce(failedDelivery);
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(startHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
      memberId: "member_123",
      periodStart: AI_USAGE_NOTICE_PERIOD_START,
      prisma: fixture.prisma as never,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: "telegram-update:failed-linq",
      targetKind: "telegram_thread",
      usageCreditLedgerVersion: 0n,
    })).resolves.toEqual({ status: "already_notified" });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{
            attemptedAt: {
              lte: new Date("2026-03-26T12:15:00.000Z"),
            },
            status: "attempted",
          }],
        }),
      }),
    );
    expect(fixture.hostedLinqDeliveryFindUnique).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      expected: {
        retryAt: new Date("2026-03-26T12:44:00.000Z"),
        status: "in_flight",
      },
      label: "in flight",
      reread: {
        acceptedAt: null,
        attemptedAt: new Date("2026-03-26T12:29:00.000Z"),
        deliveredAt: null,
        failedAt: null,
        failureCode: null,
        lastReceiptAt: null,
        messageLookupKey: null,
        retryAfterAt: null,
        skippedAt: null,
        source: "hosted_webhook_side_effect",
        status: "attempted",
      },
    },
    {
      expected: { status: "already_notified" },
      label: "already notified",
      reread: {
        acceptedAt: new Date("2026-03-26T12:29:01.000Z"),
        attemptedAt: new Date("2026-03-26T12:29:00.000Z"),
        deliveredAt: null,
        failedAt: null,
        failureCode: null,
        lastReceiptAt: null,
        messageLookupKey: null,
        retryAfterAt: null,
        skippedAt: null,
        source: "hosted_webhook_side_effect",
        status: "accepted",
      },
    },
  ])("re-reads a lost claim race as $label", async ({ expected, reread }) => {
    const fixture = createObservabilityPrismaFixture();
    const currentIdempotencyKey = buildCurrentAiUsageNoticeKey();
    const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(
      currentIdempotencyKey,
    );
    const staleDelivery = {
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      failureCode: null,
      id: "hld_raced_current_usage_notice",
      idempotencyKey,
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: null,
      skippedAt: null,
      source: "hosted_webhook_side_effect",
      status: "attempted",
    };
    fixture.hostedLinqDeliveryFindUnique
      .mockResolvedValueOnce(staleDelivery)
      .mockResolvedValueOnce({
        ...reread,
        id: "hld_raced_current_usage_notice",
        idempotencyKey,
        phoneNumberLookupKey: null,
      });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(startHostedAiUsageLimitNoticeDispatchTx({
      attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
      memberId: "member_123",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-message:event-123",
      targetKind: "thread",
      usageCreditLedgerVersion: 0n,
    })).resolves.toEqual(expected);

    expect(fixture.hostedLinqDeliveryFindUnique).toHaveBeenCalledTimes(2);
  });

  it("reclaims stale pre-provider delivery rows for a later provider dispatch retry", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:30:00.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      groupJoinOutreachId: null,
      id: "hld_stale_attempt",
      lastReceiptAt: null,
      linqChatLookupKey:
        createHostedLinqChatLookupKeyReadCandidates("chat_123")[0],
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      skippedAt: null,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      status: "attempted",
      targetKind: "thread",
      template: "invite_signup",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      linqChatId: "chat_123",
      prisma: fixture.prisma as never,
      source: "hosted_webhook_side_effect",
      sourceRef: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      targetKind: "thread",
      template: "invite_signup",
    })).resolves.toEqual({
      claimed: true,
      id: "hld_stale_attempt",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptedAt,
          failedAt: null,
          skippedAt: null,
          status: "attempted",
        }),
        where: expect.objectContaining({
          id: "hld_stale_attempt",
        }),
      }),
    );
  });

  it("treats provider-correlated group setup as completed across same-day sender changes", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce(
      buildGroupSetupDeliveryFixture({
        acceptedAt: new Date("2026-03-26T12:01:00.000Z"),
        messageLookupKey: "hbid:linq-message:provider-message-setup",
        status: "accepted",
      }),
    );

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
      idempotencyKey: "linq-group-setup:stable-day",
      linqChatId: "chat_group_setup",
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_webhook_side_effect",
      sourceRef: "event_group_setup_later_sender",
      targetKind: "thread",
      template: HOSTED_LINQ_GROUP_SETUP_TEMPLATE,
    })).resolves.toEqual({
      claimed: false,
      id: "hld_group_setup",
      outcome: "completed",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDeliveryCreateMany).not.toHaveBeenCalled();
  });

  it("keeps a recent uncorrelated group setup attempt in flight", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce(
      buildGroupSetupDeliveryFixture(),
    );

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt: new Date("2026-03-26T12:05:00.000Z"),
      idempotencyKey: "linq-group-setup:stable-day",
      linqChatId: "chat_group_setup",
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_webhook_side_effect",
      sourceRef: "event_group_setup_concurrent",
      targetKind: "thread",
      template: HOSTED_LINQ_GROUP_SETUP_TEMPLATE,
    })).resolves.toEqual({
      claimed: false,
      id: "hld_group_setup",
      retryAt: new Date("2026-03-26T12:15:00.000Z"),
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDeliveryCreateMany).not.toHaveBeenCalled();
  });

  it("does not mutate a stale signup row when the retry intent differs", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:30:00.000Z");
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      deliveredAt: null,
      failedAt: null,
      id: "hld_stale_attempt",
      lastReceiptAt: null,
      linqChatLookupKey:
        createHostedLinqChatLookupKeyReadCandidates("chat_123")[0],
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: null,
      skippedAt: null,
      source: "hosted_webhook_side_effect",
      sourceRef: "persisted-source-ref",
      status: "attempted",
      targetKind: "thread",
      template: "invite_signup",
    });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      idempotencyKey: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
      linqChatId: "chat_123",
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_webhook_side_effect",
      sourceRef: "different-source-ref",
      targetKind: "thread",
      template: "invite_signup",
    })).resolves.toEqual({
      claimed: false,
      id: "hld_stale_attempt",
      outcome: "incompatible",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
  });

  it("immediately reclaims exact group-line recovery without rewriting its authority time", async () => {
    const fixture = createObservabilityPrismaFixture();
    const originalAttemptedAt = new Date("2026-03-26T12:00:00.000Z");
    const originalUpdatedAt = new Date("2026-03-26T12:00:01.000Z");
    const replayedAt = new Date("2026-03-26T12:01:00.000Z");
    const phoneNumber = "+15550100042";
    const phoneNumberLookupKey = createHostedPhoneLookupKey(phoneNumber);
    if (!phoneNumberLookupKey) {
      throw new Error("Expected recovery line lookup key.");
    }
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce(
      buildGroupLineRecoveryDeliveryFixture({
        attemptedAt: originalAttemptedAt,
        phoneNumberLookupKey,
        updatedAt: originalUpdatedAt,
      }),
    );
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt: replayedAt,
      idempotencyKey: "linq-group-line-recovery:exact",
      phoneNumber,
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_webhook_side_effect",
      sourceRef: "event_group_recovery",
      targetKind: "participant",
      template: "group_line_recovery",
    })).resolves.toEqual({
      claimed: true,
      id: "hld_group_line_recovery",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptedAt: originalAttemptedAt,
          phoneNumberLookupKey,
          sourceRef: createHostedLinqDeliverySourceRefLookupKey(
            "event_group_recovery",
          ),
          status: "attempted",
          targetKind: "participant",
          template: "group_line_recovery",
          updatedAt: replayedAt,
        }),
        where: expect.objectContaining({
          attemptedAt: originalAttemptedAt,
          id: "hld_group_line_recovery",
          updatedAt: originalUpdatedAt,
        }),
      }),
    );
  });

  it.each([
    {
      label: "sender line",
      overrides: {
        phoneNumberLookupKey: createHostedPhoneLookupKey("+15550100043"),
      },
    },
    {
      label: "source event",
      overrides: {
        sourceRef: createHostedLinqDeliverySourceRefLookupKey(
          "other_event_group_recovery",
        ),
      },
    },
    {
      label: "delivery source",
      overrides: {
        source: "hosted_runtime_linq_delivery",
      },
    },
    {
      label: "target kind",
      overrides: {
        targetKind: "thread",
      },
    },
    {
      label: "template",
      overrides: {
        template: "invite_signup",
      },
    },
    {
      label: "chat target",
      overrides: {
        linqChatLookupKey:
          createHostedLinqChatLookupKeyReadCandidates("chat_other")[0],
      },
    },
  ] as const)(
    "rejects stale group-line recovery dispatch when the pinned $label differs",
    async ({ overrides }) => {
      const fixture = createObservabilityPrismaFixture();
      fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce(
        buildGroupLineRecoveryDeliveryFixture(overrides),
      );

      await expect(claimHostedLinqDeliveryProviderDispatchTx({
        attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
        idempotencyKey: "linq-group-line-recovery:exact",
        phoneNumber: "+15550100042",
        prisma: fixture.prisma as never,
        reclaimStalePreProviderAttempt: true,
        source: "hosted_webhook_side_effect",
        sourceRef: "event_group_recovery",
        targetKind: "participant",
        template: "group_line_recovery",
      })).resolves.toEqual({
        claimed: false,
        id: "hld_group_line_recovery",
        outcome: "incompatible",
      });

      expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
      expect(fixture.hostedLinqDeliveryCreateMany).not.toHaveBeenCalled();
    },
  );

  it("treats exact provider-correlated group-line recovery as completed", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce(
      buildGroupLineRecoveryDeliveryFixture({
        acceptedAt: new Date("2026-03-26T12:01:00.000Z"),
        messageLookupKey: "hbid:linq-message:provider-message-123",
        status: "accepted",
      }),
    );

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt: new Date("2026-03-26T12:30:00.000Z"),
      idempotencyKey: "linq-group-line-recovery:exact",
      phoneNumber: "+15550100042",
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_webhook_side_effect",
      sourceRef: "event_group_recovery",
      targetKind: "participant",
      template: "group_line_recovery",
    })).resolves.toEqual({
      claimed: false,
      id: "hld_group_line_recovery",
      outcome: "completed",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDeliveryCreateMany).not.toHaveBeenCalled();
  });

  it("preserves safe recovery source identity and reads terminal attempt receipts", async () => {
    const fixture = createObservabilityPrismaFixture();
    const effectId = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      threadId: "chat-group-1",
    });
    const secondAttemptEffectId =
      buildHostedLinqGroupLineRecoveryAttemptEffectId({
        attempt: 2,
        effectId,
      });
    const sourceRef = buildHostedLinqGroupLineRecoverySourceRef({
      effectId,
      sourceEventId: "event-group-line-recovery-1",
    });

    await expect(claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      idempotencyKey: effectId,
      phoneNumber: "+15550100042",
      prisma: fixture.prisma as never,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_webhook_side_effect",
      sourceRef,
      targetKind: "participant",
      template: "group_line_recovery",
    })).resolves.toMatchObject({ claimed: true });
    expect(fixture.hostedLinqDeliveryCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ sourceRef })],
      skipDuplicates: true,
    });

    const firstLookupKey =
      createHostedLinqDeliveryIdempotencyLookupKey(effectId);
    const secondLookupKey =
      createHostedLinqDeliveryIdempotencyLookupKey(secondAttemptEffectId);
    if (!firstLookupKey || !secondLookupKey) {
      throw new Error("Expected recovery attempt lookup keys.");
    }
    fixture.hostedLinqDeliveryFindMany.mockResolvedValueOnce([
      {
        acceptedAt: new Date("2026-03-26T12:00:01.000Z"),
        attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
        deliveredAt: null,
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        id: "hld_group_line_recovery",
        idempotencyKey: firstLookupKey,
        lastProviderEventId:
          "hbidx:linq-provider-event:recovery-failed-1",
        lastReceiptAt: new Date("2026-03-26T12:01:00.000Z"),
        messageLookupKey: "hbid:linq-message:provider-message-123",
        phoneNumberLookupKey: createHostedPhoneLookupKey("+15550100042"),
        sourceRef,
        status: "failed",
        targetKind: "participant",
        template: "group_line_recovery",
      },
    ]);

    await expect(readHostedLinqDeliveryProviderDispatchIntentsTx({
      idempotencyKeys: [effectId, secondAttemptEffectId],
      prisma: fixture.prisma as never,
    })).resolves.toEqual([
      expect.objectContaining({
        idempotencyLookupKey: firstLookupKey,
        lastProviderEventId:
          "hbidx:linq-provider-event:recovery-failed-1",
        providerCorrelated: true,
        sourceRef,
        status: "failed",
      }),
    ]);
    expect(fixture.hostedLinqDeliveryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          idempotencyKey: {
            in: [firstLookupKey, secondLookupKey],
          },
        },
      }),
    );
  });

  it("classifies K=32 recovery candidates from one five-attempt set read", async () => {
    const fixture = createObservabilityPrismaFixture();
    const occurredAt = new Date("2026-03-26T12:01:00.000Z");
    const setupArmedAt = new Date("2026-03-26T11:59:00.000Z");
    const recoveredRecipientPhoneLookupKey =
      createHostedPhoneLookupKey("+15550100042");
    if (!recoveredRecipientPhoneLookupKey) {
      throw new Error("Expected group-line recovery batch lookup key.");
    }
    const candidates = Array.from({ length: 32 }, (_, index) => ({
      memberId: `member-recovery-batch-${index + 1}`,
      originalRecipientPhone: `+1555020${String(index + 1).padStart(4, "0")}`,
      pendingGroupSetupId: `hpgs-recovery-batch-${index + 1}`,
      setupArmedAt,
    }));
    const acceptedCandidate = candidates[0]!;
    const inFlightCandidate = candidates[1]!;
    const acceptedEffectId = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: acceptedCandidate.originalRecipientPhone,
      memberId: acceptedCandidate.memberId,
      pendingGroupSetupId: acceptedCandidate.pendingGroupSetupId,
      threadId: "chat-group-recovery-batch",
    });
    const inFlightEffectId = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: inFlightCandidate.originalRecipientPhone,
      memberId: inFlightCandidate.memberId,
      pendingGroupSetupId: inFlightCandidate.pendingGroupSetupId,
      threadId: "chat-group-recovery-batch",
    });
    const acceptedIdempotencyKey =
      createHostedLinqDeliveryIdempotencyLookupKey(acceptedEffectId);
    const inFlightIdempotencyKey =
      createHostedLinqDeliveryIdempotencyLookupKey(inFlightEffectId);
    if (!acceptedIdempotencyKey || !inFlightIdempotencyKey) {
      throw new Error("Expected group-line recovery batch intent keys.");
    }
    fixture.hostedLinqDeliveryFindMany.mockResolvedValue([
      {
        acceptedAt: new Date("2026-03-26T12:00:01.000Z"),
        attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
        deliveredAt: null,
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        id: "hld_recovery_batch_accepted",
        idempotencyKey: acceptedIdempotencyKey,
        lastProviderEventId: null,
        lastReceiptAt: null,
        messageLookupKey: "hbid:linq-message:recovery-batch-accepted",
        phoneNumberLookupKey: recoveredRecipientPhoneLookupKey,
        sourceRef: buildHostedLinqGroupLineRecoverySourceRef({
          effectId: acceptedEffectId,
          sourceEventId: "event-recovery-batch-accepted",
        }),
        status: "accepted",
        targetKind: "participant",
        template: "group_line_recovery",
      },
      {
        acceptedAt: null,
        attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
        deliveredAt: null,
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        id: "hld_recovery_batch_in_flight",
        idempotencyKey: inFlightIdempotencyKey,
        lastProviderEventId: null,
        lastReceiptAt: null,
        messageLookupKey: null,
        phoneNumberLookupKey: recoveredRecipientPhoneLookupKey,
        sourceRef: buildHostedLinqGroupLineRecoverySourceRef({
          effectId: inFlightEffectId,
          sourceEventId: "event-recovery-batch-in-flight",
        }),
        status: "attempted",
        targetKind: "participant",
        template: "group_line_recovery",
      },
    ]);

    await expect(readHostedLinqGroupLineRecoveryAuthoritiesTx({
      candidates,
      occurredAt,
      prisma: fixture.prisma as never,
      recoveredRecipientPhoneLookupKey,
      threadId: "chat-group-recovery-batch",
    })).resolves.toEqual(new Map([
      [acceptedCandidate.pendingGroupSetupId, "accepted"],
      [inFlightCandidate.pendingGroupSetupId, "in_flight"],
      ...candidates.slice(2).map((candidate) => [
        candidate.pendingGroupSetupId,
        "none",
      ] as const),
    ]));
    expect(fixture.hostedLinqDeliveryFindMany).toHaveBeenCalledOnce();
    expect(
      fixture.hostedLinqDeliveryFindMany.mock.calls[0]?.[0]?.where
        ?.idempotencyKey?.in,
    ).toHaveLength(32 * 5);
  });

  it("accepts only the exact post-arm persisted group-line recovery authority", async () => {
    const fixture = createObservabilityPrismaFixture();
    const originalRecipientPhone = "+15550100000";
    const recoveredRecipientPhoneLookupKey =
      createHostedPhoneLookupKey("+15550100042");
    const setupArmedAt = new Date("2026-03-26T11:59:00.000Z");
    const pendingGroupSetupId = "hpgs-recovery-authority";
    const effectId = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: originalRecipientPhone,
      memberId: "member-1",
      pendingGroupSetupId,
      threadId: "chat-group-1",
    });
    const idempotencyKey =
      createHostedLinqDeliveryIdempotencyLookupKey(effectId);
    if (!recoveredRecipientPhoneLookupKey || !idempotencyKey) {
      throw new Error("Expected group-line recovery authority keys.");
    }
    fixture.hostedLinqDeliveryFindMany.mockResolvedValue([
      {
        acceptedAt: new Date("2026-03-26T12:00:01.000Z"),
        attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
        deliveredAt: null,
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        id: "hld_group_line_recovery_authority",
        idempotencyKey,
        lastProviderEventId: null,
        lastReceiptAt: null,
        messageLookupKey: "hbid:linq-message:recovery-authority",
        phoneNumberLookupKey: recoveredRecipientPhoneLookupKey,
        sourceRef: buildHostedLinqGroupLineRecoverySourceRef({
          effectId,
          sourceEventId: "event-group-line-recovery-authority",
        }),
        status: "accepted",
        targetKind: "participant",
        template: "group_line_recovery",
      },
    ]);

    await expect(hasHostedLinqGroupLineRecoveryAuthorityTx({
      memberId: "member-1",
      occurredAt: new Date("2026-03-26T12:01:00.000Z"),
      originalRecipientPhone,
      pendingGroupSetupId,
      prisma: fixture.prisma as never,
      recoveredRecipientPhoneLookupKey,
      setupArmedAt,
      threadId: "chat-group-1",
    })).resolves.toBe(true);
    await expect(hasHostedLinqGroupLineRecoveryAuthorityTx({
      memberId: "member-1",
      occurredAt: new Date("2026-03-26T11:59:59.999Z"),
      originalRecipientPhone,
      pendingGroupSetupId,
      prisma: fixture.prisma as never,
      recoveredRecipientPhoneLookupKey,
      setupArmedAt,
      threadId: "chat-group-1",
    })).resolves.toBe(false);
    await expect(hasHostedLinqGroupLineRecoveryAuthorityTx({
      memberId: "member-1",
      occurredAt: new Date("2026-03-26T12:01:00.000Z"),
      originalRecipientPhone,
      pendingGroupSetupId: "hpgs-replacement",
      prisma: fixture.prisma as never,
      recoveredRecipientPhoneLookupKey,
      setupArmedAt,
      threadId: "chat-group-1",
    })).resolves.toBe(false);

    fixture.hostedLinqDeliveryFindMany.mockResolvedValue([
      {
        acceptedAt: null,
        attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
        deliveredAt: null,
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        id: "hld_in_flight_group_line_recovery_authority",
        idempotencyKey,
        lastProviderEventId: null,
        lastReceiptAt: null,
        messageLookupKey: null,
        phoneNumberLookupKey: recoveredRecipientPhoneLookupKey,
        sourceRef: buildHostedLinqGroupLineRecoverySourceRef({
          effectId,
          sourceEventId: "event-in-flight-group-line-recovery-authority",
        }),
        status: "attempted",
        targetKind: "participant",
        template: "group_line_recovery",
      },
    ]);
    await expect(readHostedLinqGroupLineRecoveryAuthorityTx({
      memberId: "member-1",
      occurredAt: new Date("2026-03-26T12:01:00.000Z"),
      originalRecipientPhone,
      pendingGroupSetupId,
      prisma: fixture.prisma as never,
      recoveredRecipientPhoneLookupKey,
      setupArmedAt,
      threadId: "chat-group-1",
    })).resolves.toBe("in_flight");
    await expect(hasHostedLinqGroupLineRecoveryAuthorityTx({
      memberId: "member-1",
      occurredAt: new Date("2026-03-26T12:01:00.000Z"),
      originalRecipientPhone,
      pendingGroupSetupId,
      prisma: fixture.prisma as never,
      recoveredRecipientPhoneLookupKey,
      setupArmedAt,
      threadId: "chat-group-1",
    })).resolves.toBe(false);

    fixture.hostedLinqDeliveryFindMany.mockResolvedValue([
      {
        acceptedAt: new Date("2026-03-26T11:58:01.000Z"),
        attemptedAt: new Date("2026-03-26T11:58:00.000Z"),
        deliveredAt: null,
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        id: "hld_stale_group_line_recovery_authority",
        idempotencyKey,
        lastProviderEventId: null,
        lastReceiptAt: null,
        messageLookupKey: "hbid:linq-message:stale-recovery-authority",
        phoneNumberLookupKey: recoveredRecipientPhoneLookupKey,
        sourceRef: buildHostedLinqGroupLineRecoverySourceRef({
          effectId,
          sourceEventId: "event-stale-group-line-recovery-authority",
        }),
        status: "accepted",
        targetKind: "participant",
        template: "group_line_recovery",
      },
    ]);
    await expect(hasHostedLinqGroupLineRecoveryAuthorityTx({
      memberId: "member-1",
      occurredAt: new Date("2026-03-26T12:01:00.000Z"),
      originalRecipientPhone,
      pendingGroupSetupId,
      prisma: fixture.prisma as never,
      recoveredRecipientPhoneLookupKey,
      setupArmedAt,
      threadId: "chat-group-1",
    })).resolves.toBe(false);
  });

  it("consumes one maximum-size answered mailbox set in one idempotent transaction", async () => {
    const fixture = createObservabilityPrismaFixture();
    const attemptedAt = new Date("2026-03-26T12:00:00.000Z");
    const acceptedAt = new Date("2026-03-26T12:00:01.000Z");
    const answeredMailboxItemIds = Array.from(
      { length: 100 },
      (_, index) => `mailbox_item_answered_${index}`,
    );
    const deliveryIdempotencyLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
      "linq-voice-memo-transcript:assistant-outbox:intent_123",
    );
    fixture.hostedLinqLineFindUnique.mockResolvedValue({
      phoneNumberHint: "+0000",
      phoneNumberLookupKey: "hbidx:phone:runtime-line",
    });

    const accepted = await recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt,
      answeredMailboxItemIds,
      attemptedAt,
      idempotencyKey: "linq-voice-memo-transcript:assistant-outbox:intent_123",
      linqChatId: "linq_chat_123",
      messageId: "provider_message_123",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      sourceRef: "intent_123",
      targetKind: "thread",
      userId: "member_123",
    });
    expect(accepted).toEqual({
      deliveryId: expect.stringMatching(/^hld_[a-f0-9]{32}$/u),
      recorded: true,
    });

    expect(fixture.hostedLinqDeliveryFindUnique).toHaveBeenCalledWith({
      select: expect.objectContaining({
        phoneNumberLookupKey: true,
      }),
      where: {
        idempotencyKey: deliveryIdempotencyLookupKey,
      },
    });
    expect(fixture.hostedLinqDeliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedAt,
          attemptedAt,
          idempotencyKey: deliveryIdempotencyLookupKey,
          messageIdSuffix: "ge_123",
          phoneNumberLookupKey: "hbidx:phone:runtime-line",
          source: "hosted_runtime_linq_delivery",
          status: "accepted",
          targetKind: "thread",
        }),
      }),
    );
    expect(fixture.hostedMailboxItemUpdateMany).toHaveBeenCalledWith({
      data: {
        consumedAt: acceptedAt,
      },
      where: {
        consumedAt: null,
        id: {
          in: answeredMailboxItemIds,
        },
        kind: "conversation.message",
        lane: "conversation",
        userId: "member_123",
      },
    });
    expect(fixture.hostedLinqLineUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          totalOutboundCount: { increment: 1 },
        },
      }),
    );
    expect(fixture.hostedLinqProviderEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          messageLookupKey: expect.objectContaining({
            in: expect.arrayContaining([
              expect.stringMatching(/^hbidx:linq-message:/u),
            ]),
          }),
        }),
      }),
    );

    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt,
      deliveredAt: null,
      failedAt: null,
      id: accepted.deliveryId,
      lastReceiptAt: null,
      messageLookupKey: "hbidx:linq-message:provider",
      phoneNumberLookupKey: "hbidx:phone:runtime-line",
      skippedAt: null,
      status: "accepted",
    });
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt,
      answeredMailboxItemIds,
      attemptedAt,
      idempotencyKey: "linq-voice-memo-transcript:assistant-outbox:intent_123",
      linqChatId: "linq_chat_123",
      messageId: "provider_message_123",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      sourceRef: "intent_123",
      targetKind: "thread",
      userId: "member_123",
    })).resolves.toEqual(accepted);

    expect(fixture.transaction).toHaveBeenCalledTimes(2);
    expect(fixture.hostedLinqDeliveryCreate).toHaveBeenCalledTimes(1);
    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledTimes(1);
    expect(fixture.hostedMailboxItemUpdateMany).toHaveBeenCalledTimes(1);
    expect(fixture.hostedLinqProviderEventFindMany).toHaveBeenCalledTimes(1);
  });

  it("records group-thread runtime accepts as sent with no receipt expected", async () => {
    const fixture = createObservabilityPrismaFixture();
    const acceptedAt = new Date("2026-03-26T12:00:01.000Z");

    await expect(recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      idempotencyKey: "assistant-outbox:intent_group",
      linqChatId: "linq_chat_group",
      messageId: "provider_message_group",
      prisma: fixture.prisma as never,
      sourceRef: "intent_group",
      targetKind: "thread",
      threadIsDirect: false,
      userId: "member_123",
    })).resolves.toEqual({
      deliveryId: expect.stringMatching(/^hld_[a-f0-9]{32}$/u),
      recorded: true,
    });

    expect(fixture.hostedLinqDeliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedAt,
          status: "sent_no_receipt_expected",
          targetKind: "thread",
          threadIsDirect: false,
        }),
      }),
    );
  });

  it("keeps a new two-part group accept out of missing-receipt status", async () => {
    const fixture = createObservabilityPrismaFixture();
    const acceptedAt = new Date("2026-03-26T12:00:01.000Z");
    fixture.hostedLinqDeliveryFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        failedAt: null,
        failureCode: null,
        failureReason: null,
        status: "sent_no_receipt_expected",
      });
    fixture.hostedLinqDeliveryMessageFindMany.mockResolvedValueOnce([
      buildAcceptedOwnedDeliveryMessageState(),
      buildAcceptedOwnedDeliveryMessageState(),
    ]);

    await recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      idempotencyKey: "assistant-outbox:intent_group_two_part",
      linqChatId: "linq_chat_group",
      messageIds: ["provider_message_group_text", "provider_message_group_link"],
      prisma: fixture.prisma as never,
      sourceRef: "intent_group_two_part",
      targetKind: "thread",
      threadIsDirect: false,
      userId: "member_123",
    });

    expect(fixture.hostedLinqDeliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "sent_no_receipt_expected",
        }),
      }),
    );
    expect(fixture.hostedLinqDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "sent_no_receipt_expected",
        }),
      }),
    );
  });

  it("does not create or project a runtime raw sender line that is not already known", async () => {
    const fixture = createObservabilityPrismaFixture();

    await expect(recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt: new Date("2026-03-26T12:00:01.000Z"),
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      idempotencyKey: "assistant-outbox:intent_unknown_line",
      linqChatId: "linq_chat_123",
      messageId: "provider_message_123",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      sourceRef: "intent_unknown_line",
      targetKind: "thread",
      userId: "member_123",
    })).resolves.toEqual({
      deliveryId: expect.stringMatching(/^hld_[a-f0-9]{32}$/u),
      recorded: true,
    });

    expect(fixture.hostedLinqLineUpsert).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDeliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phoneNumberHint: null,
          phoneNumberLookupKey: null,
          status: "accepted",
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdate).not.toHaveBeenCalled();
    expect(fixture.hostedLinqLineUpdateMany).not.toHaveBeenCalled();
  });

  it("does not stamp answered mailbox rows for failed runtime outcomes", async () => {
    const fixture = createObservabilityPrismaFixture();
    const failedAt = new Date("2026-03-26T12:00:02.000Z");

    await expect(recordHostedLinqRuntimeDeliveryOutcomeTx({
      answeredMailboxItemIds: ["mailbox_item_should_not_consume"],
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      failedAt,
      failureCode: "synthetic_failure",
      idempotencyKey: "assistant-outbox:intent_failed",
      linqChatId: "linq_chat_123",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      sourceRef: "intent_failed",
      targetKind: "thread",
      userId: "member_123",
    })).resolves.toEqual({
      deliveryId: expect.stringMatching(/^hld_[a-f0-9]{32}$/u),
      recorded: true,
    });

    expect(fixture.hostedLinqDeliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedAt,
          status: "failed",
        }),
      }),
    );
    expect(fixture.hostedMailboxItemUpdateMany).not.toHaveBeenCalled();
  });

  it("records a failed runtime rich-link outcome with its accepted primary identity", async () => {
    const fixture = createObservabilityPrismaFixture();
    const failedAt = new Date("2026-03-26T12:00:02.000Z");
    const answeredMailboxItemIds = ["mailbox_item_primary_answered"];

    await expect(recordHostedLinqRuntimeDeliveryOutcomeTx({
      answeredMailboxItemIds,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      failedAt,
      failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
      idempotencyKey: "assistant-outbox:intent_partial_link",
      linqChatId: "linq_chat_123",
      messageId: "linq_text_accepted",
      messageIds: ["linq_text_accepted"],
      prisma: fixture.prisma as never,
      sourceRef: "intent_partial_link",
      targetKind: "thread",
      userId: "member_123",
    })).resolves.toEqual({
      deliveryId: expect.stringMatching(/^hld_[a-f0-9]{32}$/u),
      recorded: true,
    });

    expect(fixture.hostedLinqDeliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedAt,
          messageIdSuffix: "cepted",
          messageLookupKey:
            createHostedLinqMessageLookupKey("linq_text_accepted"),
          status: "failed",
        }),
      }),
    );
    expect(fixture.hostedLinqDeliveryMessageCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            messageLookupKey:
              createHostedLinqMessageLookupKey("linq_text_accepted"),
            ordinal: 0,
          }),
        ],
      }),
    );
    expect(fixture.hostedMailboxItemUpdateMany).not.toHaveBeenCalled();
  });

  it("supersedes only the matching rich-link checkpoint after both identities recover", async () => {
    const fixture = createObservabilityPrismaFixture();
    const acceptedAt = new Date("2026-03-26T12:05:02.000Z");
    const primaryMessageId = "linq_text_accepted";
    const linkMessageId = "linq_link_recovered";
    const primaryMessageLookupKey =
      createHostedLinqMessageLookupKey(primaryMessageId);
    fixture.hostedLinqDeliveryFindUnique
      .mockResolvedValueOnce({
        acceptedAt: null,
        deliveredAt: null,
        failedAt: new Date("2026-03-26T12:00:02.000Z"),
        failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        id: "hld_partial_link",
        lastReceiptAt: null,
        messageLookupKey: primaryMessageLookupKey,
        skippedAt: null,
        status: "failed",
      })
      .mockResolvedValueOnce({
        failedAt: null,
        failureCode: null,
        failureReason: null,
        status: "accepted",
      });

    await expect(recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt,
      answeredMailboxItemIds: ["mailbox_item_primary_answered"],
      attemptedAt: new Date("2026-03-26T12:05:01.000Z"),
      idempotencyKey: "assistant-outbox:intent_partial_link",
      linqChatId: "linq_chat_123",
      messageIds: [primaryMessageId, linkMessageId],
      prisma: fixture.prisma as never,
      sourceRef: "intent_partial_link",
      targetKind: "thread",
      userId: "member_123",
    })).resolves.toEqual({
      deliveryId: expect.stringMatching(/^hld_[a-f0-9]{32}$/u),
      recorded: true,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedAt,
          failedAt: null,
          failureCode: null,
          status: "accepted",
        }),
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
              messageLookupKey: primaryMessageLookupKey,
              status: "failed",
            }),
          ]),
        }),
      }),
    );
    expect(fixture.hostedLinqDeliveryMessageCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ ordinal: 0 }),
        expect.objectContaining({ ordinal: 1 }),
      ],
      skipDuplicates: true,
    });
    expect(fixture.hostedMailboxItemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { consumedAt: acceptedAt },
      }),
    );
  });

  it("keeps a recovered two-part group accept out of missing-receipt status", async () => {
    const fixture = createObservabilityPrismaFixture();
    const acceptedAt = new Date("2026-03-26T12:05:02.000Z");
    const primaryMessageId = "linq_group_text_accepted";
    const linkMessageId = "linq_group_link_recovered";
    const primaryMessageLookupKey =
      createHostedLinqMessageLookupKey(primaryMessageId);
    fixture.hostedLinqDeliveryFindUnique
      .mockResolvedValueOnce({
        acceptedAt: null,
        deliveredAt: null,
        failedAt: new Date("2026-03-26T12:00:02.000Z"),
        failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        id: "hld_group_partial_link",
        lastReceiptAt: null,
        messageLookupKey: primaryMessageLookupKey,
        skippedAt: null,
        status: "failed",
      })
      .mockResolvedValueOnce({
        failedAt: null,
        failureCode: null,
        failureReason: null,
        status: "sent_no_receipt_expected",
      });
    fixture.hostedLinqDeliveryMessageFindMany.mockResolvedValueOnce([
      buildAcceptedOwnedDeliveryMessageState(),
      buildAcceptedOwnedDeliveryMessageState(),
    ]);

    await recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt,
      attemptedAt: new Date("2026-03-26T12:05:01.000Z"),
      idempotencyKey: "assistant-outbox:intent_group_partial_link",
      linqChatId: "linq_chat_group",
      messageIds: [primaryMessageId, linkMessageId],
      prisma: fixture.prisma as never,
      sourceRef: "intent_group_partial_link",
      targetKind: "thread",
      threadIsDirect: false,
      userId: "member_123",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedAt,
          status: "sent_no_receipt_expected",
        }),
      }),
    );
    expect(fixture.hostedLinqDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "sent_no_receipt_expected",
        }),
      }),
    );
  });

  it("does not double-count outbound totals when the provider echo lands before runtime acceptance", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqLineFindUnique.mockResolvedValueOnce({
      phoneNumberHint: "+0000",
      phoneNumberLookupKey: "hbidx:phone:runtime-line",
    });
    fixture.hostedLinqProviderEventFindFirst.mockResolvedValueOnce({
      eventId: createHostedLinqProviderEventLookupKey("evt_outbound_echo_first"),
    });

    await recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt: new Date("2026-03-26T12:00:01.000Z"),
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      idempotencyKey: "assistant-outbox:intent_echo_first",
      linqChatId: "linq_chat_123",
      messageId: "provider_message_123",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      sourceRef: "intent_echo_first",
      targetKind: "thread",
      userId: "member_123",
    });

    expect(fixture.hostedLinqProviderEventFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          direction: "outbound",
          eventType: "message.received",
          messageLookupKey: expect.objectContaining({
            in: expect.arrayContaining([
              expect.stringMatching(/^hbidx:linq-message:/u),
            ]),
          }),
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdate).not.toHaveBeenCalled();
  });

  it("projects receipt-before-runtime delivery callbacks through the accepted delivery line", async () => {
    const fixture = createObservabilityPrismaFixture();
    const receiptAt = new Date("2026-03-26T12:00:03.000Z");
    fixture.hostedLinqLineFindUnique.mockResolvedValueOnce({
      phoneNumberHint: "+0000",
      phoneNumberLookupKey: "hbidx:phone:runtime-line",
    });
    fixture.hostedLinqProviderEventFindMany.mockResolvedValueOnce([
      {
        deliveryStatus: "delivered",
        eventId: createHostedLinqProviderEventLookupKey("evt_delivered_123"),
        failureCode: null,
        failureReason: null,
        phoneNumberLookupKey: null,
        providerCreatedAt: receiptAt,
        service: "imessage",
      },
    ]);

    await recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt: new Date("2026-03-26T12:00:01.000Z"),
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      idempotencyKey: "assistant-outbox:intent_123",
      linqChatId: "linq_chat_123",
      messageId: "provider_message_123",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      sourceRef: "intent_123",
      targetKind: "thread",
      userId: "member_123",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveredAt: receiptAt,
          lastReceiptAt: receiptAt,
          status: "delivered",
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastDeliveredAt: receiptAt,
          lastReceiptAt: receiptAt,
          totalDeliveredCount: { increment: 1 },
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          healthStatus: "healthy",
          lastDeliveredAt: receiptAt,
          lastReceiptAt: receiptAt,
        }),
        where: expect.objectContaining({
          phoneNumberLookupKey: "hbidx:phone:runtime-line",
        }),
      }),
    );
  });

  it("projects receipt-before-runtime callbacks through group-thread no-receipt-expected rows", async () => {
    const fixture = createObservabilityPrismaFixture();
    const acceptedAt = new Date("2026-03-26T12:00:01.000Z");
    const receiptAt = new Date("2026-03-26T12:00:03.000Z");
    fixture.hostedLinqLineFindUnique.mockResolvedValueOnce({
      phoneNumberHint: "+0000",
      phoneNumberLookupKey: "hbidx:phone:runtime-line",
    });
    fixture.hostedLinqProviderEventFindMany.mockResolvedValueOnce([
      {
        deliveryStatus: "delivered",
        eventId: createHostedLinqProviderEventLookupKey("evt_group_delivered_123"),
        failureCode: null,
        failureReason: null,
        phoneNumberLookupKey: null,
        providerCreatedAt: receiptAt,
        service: "imessage",
      },
    ]);

    await recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt,
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      idempotencyKey: "assistant-outbox:intent_group_receipt",
      linqChatId: "linq_chat_group",
      messageId: "provider_message_group_receipt",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      sourceRef: "intent_group_receipt",
      targetKind: "thread",
      threadIsDirect: false,
      userId: "member_123",
    });

    expect(fixture.hostedLinqDeliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedAt,
          phoneNumberLookupKey: "hbidx:phone:runtime-line",
          status: "sent_no_receipt_expected",
          targetKind: "thread",
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          totalOutboundCount: { increment: 1 },
        },
      }),
    );
    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveredAt: receiptAt,
          lastReceiptAt: receiptAt,
          status: "delivered",
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastDeliveredAt: receiptAt,
          lastReceiptAt: receiptAt,
          totalDeliveredCount: { increment: 1 },
        }),
      }),
    );
  });

  it("lets a hosted runtime acceptance replace a pre-provider skipped delivery", async () => {
    const fixture = createObservabilityPrismaFixture();
    const deliveryIdempotencyLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
      "assistant-outbox:intent_123",
    );
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      deliveredAt: null,
      failedAt: null,
      id: "hld_skipped_runtime_retry",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      skippedAt: new Date("2026-03-26T12:00:00.000Z"),
      status: "skipped",
    });
    fixture.hostedLinqLineFindUnique.mockResolvedValueOnce({
      phoneNumberHint: "+0000",
      phoneNumberLookupKey: "hbidx:phone:runtime-line",
    });

    await recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt: new Date("2026-03-26T12:05:01.000Z"),
      attemptedAt: new Date("2026-03-26T12:05:00.000Z"),
      idempotencyKey: "assistant-outbox:intent_123",
      linqChatId: "linq_chat_123",
      messageId: "provider_message_123",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      sourceRef: "intent_123",
      targetKind: "thread",
      userId: "member_123",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedAt: new Date("2026-03-26T12:05:01.000Z"),
          skippedAt: null,
          skipReason: null,
          status: "accepted",
        }),
        where: expect.objectContaining({
          acceptedAt: null,
          deliveredAt: null,
          idempotencyKey: deliveryIdempotencyLookupKey,
          OR: expect.arrayContaining([
            expect.objectContaining({
              failedAt: null,
              lastReceiptAt: null,
              messageLookupKey: null,
            }),
          ]),
        }),
      }),
    );
    expect(fixture.hostedLinqDeliveryUpdateMany.mock.calls[0]?.[0]?.where)
      .not.toHaveProperty("skippedAt");
  });

  it("keeps group-thread receipt expectations when accepting a pre-provider delivery row", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      deliveredAt: null,
      failedAt: null,
      id: "hld_skipped_group_runtime_retry",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      skippedAt: new Date("2026-03-26T12:00:00.000Z"),
      status: "skipped",
    });

    await recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt: new Date("2026-03-26T12:05:01.000Z"),
      attemptedAt: new Date("2026-03-26T12:05:00.000Z"),
      idempotencyKey: "assistant-outbox:intent_group_retry",
      linqChatId: "linq_chat_group",
      messageId: "provider_message_group_retry",
      prisma: fixture.prisma as never,
      sourceRef: "intent_group_retry",
      targetKind: "thread",
      threadIsDirect: false,
      userId: "member_123",
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedAt: new Date("2026-03-26T12:05:01.000Z"),
          skippedAt: null,
          skipReason: null,
          status: "sent_no_receipt_expected",
        }),
      }),
    );
  });

  it("treats concurrent runtime delivery creation as an idempotent accepted update", async () => {
    const fixture = createObservabilityPrismaFixture();
    const acceptedAt = new Date("2026-03-26T12:05:01.000Z");
    const attemptedAt = new Date("2026-03-26T12:05:00.000Z");
    fixture.hostedLinqDeliveryFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        acceptedAt: null,
        deliveredAt: null,
        failedAt: new Date("2026-03-26T12:04:59.000Z"),
        id: "hld_concurrent_failed",
        lastReceiptAt: null,
        messageLookupKey: null,
        phoneNumberLookupKey: null,
        skippedAt: null,
        status: "failed",
      });
    fixture.hostedLinqDeliveryCreate.mockRejectedValueOnce({
      code: "P2002",
    });
    fixture.hostedLinqLineFindUnique.mockResolvedValueOnce({
      phoneNumberHint: "+0000",
      phoneNumberLookupKey: "hbidx:phone:runtime-line",
    });

    await expect(recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt,
      attemptedAt,
      idempotencyKey: "assistant-outbox:intent_123",
      linqChatId: "linq_chat_123",
      messageId: "provider_message_123",
      phoneNumber: "+15550000000",
      prisma: fixture.prisma as never,
      sourceRef: "intent_123",
      targetKind: "thread",
      userId: "member_123",
    })).resolves.toEqual({
      deliveryId: expect.stringMatching(/^hld_[a-f0-9]{32}$/u),
      recorded: true,
    });

    expect(fixture.hostedLinqDeliveryFindUnique).toHaveBeenCalledTimes(2);
    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedAt,
          failedAt: null,
          messageLookupKey: expect.stringMatching(/^hbidx:linq-message:/u),
          skippedAt: null,
          status: "accepted",
        }),
      }),
    );
    expect(fixture.hostedLinqLineUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          totalOutboundCount: { increment: 1 },
        },
      }),
    );
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
      phoneNumberLookupKey: null,
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
      phoneNumberLookupKey: null,
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
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
    expect(fixture.hostedMailboxItemUpdateMany).not.toHaveBeenCalled();
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
              lastReceiptAt: new Date("2026-03-26T12:00:05.000Z"),
              OR: [
                { lastProviderEventId: null },
                {
                  lastProviderEventId: {
                    lt: createHostedLinqProviderEventLookupKey("evt_failed_123"),
                  },
                },
              ],
            },
          ]),
        }),
      }),
    );
  });

  it("backfills equal-timestamp same-status receipts by provider event id", async () => {
    const fixture = createObservabilityPrismaFixture();
    const receiptAt = new Date("2026-03-26T12:00:05.000Z");
    const receipts = [
      {
        deliveryStatus: "failed",
        eventId: "evt_failed_same_status_a",
        failureCode: "30007-a",
        failureReason: "[redacted-a]",
        providerCreatedAt: receiptAt,
        service: "sms",
      },
      {
        deliveryStatus: "failed",
        eventId: "evt_failed_same_status_b",
        failureCode: "30007-b",
        failureReason: "[redacted-b]",
        providerCreatedAt: receiptAt,
        service: "sms",
      },
    ] as const;
    const latest = [...receipts].sort((left, right) =>
      createHostedLinqProviderEventLookupKey(left.eventId)
        < createHostedLinqProviderEventLookupKey(right.eventId) ? -1 : 1,
    ).at(-1);
    if (!latest) {
      throw new Error("Expected same-status receipt fixture.");
    }
    fixture.hostedLinqProviderEventFindMany.mockResolvedValueOnce(receipts);

    await markHostedLinqDeliveryAcceptedTx({
      idempotencyKey: "linq-message:event-123",
      linqChatId: "chat_123",
      messageId: "provider_message_123",
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          failedAt: receiptAt,
          failureCode: latest.failureCode,
          failureReason: latest.failureReason,
          lastProviderEventId: createHostedLinqProviderEventLookupKey(latest.eventId),
          lastReceiptAt: receiptAt,
          status: "failed",
        }),
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              lastReceiptAt: receiptAt,
              OR: [
                { lastProviderEventId: null },
                {
                  lastProviderEventId: {
                    lt: createHostedLinqProviderEventLookupKey(latest.eventId),
                  },
                },
              ],
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

  it("records direct send-failure state without rewriting the delivery attempted timestamp", async () => {
    const fixture = createObservabilityPrismaFixture();
    const expectedAttemptedAt = new Date("2026-03-26T12:00:00.000Z");

    await markHostedLinqDeliverySendFailedTx({
      expectedAttemptedAt,
      failureCode: "HostedRuntimeTelegramUsageLimitNoticeRetryAfterError",
      failureReason: "Hosted Telegram usage-limit notice delivery was rate-limited by the Bot API.",
      idempotencyKey: "ai-usage-gate:member_123:2026-03",
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCode: "HostedRuntimeTelegramUsageLimitNoticeRetryAfterError",
          status: "failed",
        }),
        where: expect.objectContaining({
          attemptedAt: expectedAttemptedAt,
        }),
      }),
    );
    const updateData = fixture.hostedLinqDeliveryUpdateMany.mock.calls[0]?.[0]?.data;
    expect(updateData).not.toHaveProperty("attemptedAt");
  });

  it("correlates a partial rich-link failure to its accepted primary message and chat", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      id: "hld_partial_link",
    });

    await markHostedLinqDeliverySendFailedTx({
      failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
      idempotencyKey: "assistant-outbox:intent-partial-link",
      linqChatId: "linq_chat_partial",
      messageIds: ["linq_text_accepted"],
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          linqChatLookupKey: createHostedLinqChatLookupKey("linq_chat_partial"),
          messageLookupKey: createHostedLinqMessageLookupKey(
            "linq_text_accepted",
          ),
          status: "failed",
        }),
      }),
    );
    expect(fixture.hostedLinqDeliveryMessageCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            deliveryId: "hld_partial_link",
            messageLookupKey: createHostedLinqMessageLookupKey(
              "linq_text_accepted",
            ),
            ordinal: 0,
          }),
        ],
      }),
    );
  });

  it("records a proven retryable Telegram failure on the exact delivery", async () => {
    const fixture = createObservabilityPrismaFixture();
    const expectedAttemptedAt = new Date("2026-03-26T12:00:00.000Z");
    const retryAfterAt = new Date("2026-03-26T12:15:00.000Z");

    await expect(markHostedAiUsageLimitNoticeDeliveryRetryableTx({
      expectedAttemptedAt,
      failureCode: "HostedRuntimeTelegramUsageLimitNoticeRetryAfterError",
      idempotencyKey: buildCurrentAiUsageNoticeKey(),
      prisma: fixture.prisma as never,
      retryAfterAt,
    })).resolves.toBe(true);

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        retryAfterAt,
        status: "failed",
      }),
      where: expect.objectContaining({
        attemptedAt: expectedAttemptedAt,
        source: "hosted_runtime_ai_usage_limit_notice",
        status: "provider_dispatch_started",
        template: "ai_usage_quota",
      }),
    });
    expect(fixture.transaction).not.toHaveBeenCalled();
  });

  it("does not mutate a stale retryable delivery generation", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(markHostedAiUsageLimitNoticeDeliveryRetryableTx({
      expectedAttemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      idempotencyKey: buildCurrentAiUsageNoticeKey(),
      prisma: fixture.prisma as never,
      retryAfterAt: new Date("2026-03-26T12:15:00.000Z"),
    })).resolves.toBe(false);
  });
});


describe("hosted Linq signup-link delivery attempts", () => {
  const BASE_EFFECT_ID = "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z";
  const EXACT_SOURCE_EFFECT_ID = buildHostedLinqInviteSignupEffectId({
    groupJoinOutreachId: "hgrpjoa_opaque",
    memberId: "member_123",
    occurredAt: "2026-03-26T12:34:56.000Z",
    sourceEventId: "evt_group_reply",
  });
  const failedCorrelatedRow = (effectId: string) => ({
    acceptedAt: new Date("2026-03-26T12:00:00.000Z"),
    deliveredAt: null,
    failureCode: "provider_rejected",
    idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(effectId),
    lastReceiptAt: new Date("2026-03-26T12:01:00.000Z"),
    messageLookupKey: "hbidx:linq-message:failed",
    status: "failed",
  });
  const partialCorrelatedRow = (
    effectId: string,
    lastReceiptAt: Date | null = null,
  ) => ({
    acceptedAt: null,
    deliveredAt: null,
    failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
    idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(effectId),
    lastReceiptAt,
    messageLookupKey: "hbidx:linq-message:known-part",
    status: "failed",
  });

  it("round-trips attempt ordinals through the invite effect id", () => {
    expect(buildHostedLinqInviteSignupEffectIdMemberPrefix("member_123"))
      .toBe("linq-invite-signup:member_123:");
    expect(buildHostedLinqInviteSignupEffectId({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:34:56.000Z",
    })).toBe(BASE_EFFECT_ID);
    const second = buildHostedLinqInviteSignupEffectId({
      attempt: 2,
      memberId: "member_123",
      occurredAt: "2026-03-26T12:34:56.000Z",
    });
    expect(second).toBe(`${BASE_EFFECT_ID}:a2`);
    expect(parseHostedLinqInviteSignupEffectId(second)).toEqual({
      attempt: 2,
      dayUtc: "2026-03-26T00:00:00.000Z",
      memberId: "member_123",
      sourceEventDigest: null,
    });
    expect(parseHostedLinqInviteSignupEffectId(BASE_EFFECT_ID)).toEqual({
      attempt: 1,
      dayUtc: "2026-03-26T00:00:00.000Z",
      memberId: "member_123",
      sourceEventDigest: null,
    });
    expect(EXACT_SOURCE_EFFECT_ID).toMatch(
      /^linq-invite-signup:member_123:2026-03-26T00:00:00\.000Z:e[0-9a-f]{32}$/u,
    );
    const parsedGroupEffect =
      parseHostedLinqInviteSignupEffectId(EXACT_SOURCE_EFFECT_ID);
    expect(parsedGroupEffect).toMatchObject({
      attempt: 1,
      dayUtc: "2026-03-26T00:00:00.000Z",
      memberId: "member_123",
      sourceEventDigest: expect.stringMatching(/^[0-9a-f]{32}$/u),
    });
    expect(buildHostedLinqInviteSignupEffectId({
      attempt: 2,
      memberId: "member_123",
      occurredAt: parsedGroupEffect?.dayUtc ?? "",
      sourceEventDigest: parsedGroupEffect?.sourceEventDigest,
    })).toBe(`${EXACT_SOURCE_EFFECT_ID}:a2`);
  });

  it("keeps the base attempt while no delivery row blocks it", async () => {
    const fixture = createObservabilityPrismaFixture();
    await expect(resolveHostedLinqInviteSignupDispatchEffectIdTx({
      effectId: BASE_EFFECT_ID,
      prisma: fixture.prisma as never,
    })).resolves.toBe(BASE_EFFECT_ID);
  });

  it("advances to the next attempt after a terminal provider failure", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindMany.mockResolvedValueOnce([
      failedCorrelatedRow(BASE_EFFECT_ID),
    ]);
    await expect(resolveHostedLinqInviteSignupDispatchEffectIdTx({
      effectId: BASE_EFFECT_ID,
      prisma: fixture.prisma as never,
    })).resolves.toBe(`${BASE_EFFECT_ID}:a2`);
  });

  it("advances only the failed exact-source group attempt", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindMany.mockResolvedValueOnce([
      failedCorrelatedRow(EXACT_SOURCE_EFFECT_ID),
    ]);

    await expect(resolveHostedLinqInviteSignupDispatchEffectIdTx({
      effectId: EXACT_SOURCE_EFFECT_ID,
      prisma: fixture.prisma as never,
    })).resolves.toBe(`${EXACT_SOURCE_EFFECT_ID}:a2`);
  });

  it.each([
    {
      effectId: BASE_EFFECT_ID,
      label: "generic signup",
    },
    {
      effectId: EXACT_SOURCE_EFFECT_ID,
      label: "exact-source group signup",
    },
  ])(
    "keeps a one-identity rich-link partial on the same $label attempt",
    async ({ effectId }) => {
      const fixture = createObservabilityPrismaFixture();
      fixture.hostedLinqDeliveryFindMany.mockResolvedValueOnce([
        partialCorrelatedRow(effectId),
      ]);

      await expect(resolveHostedLinqInviteSignupDispatchEffectIdTx({
        effectId,
        prisma: fixture.prisma as never,
      })).resolves.toBe(effectId);
    },
  );

  it.each([
    {
      linqChatId: "chat_123",
      phoneNumber: null,
      targetKind: "thread",
      template: "invite_signup",
    },
    {
      linqChatId: null,
      phoneNumber: "+15550000000",
      targetKind: "participant",
      template: "invite_signup_fallback",
    },
  ] as const)(
    "does not claim repeated $template provider delivery after an incomplete rich-link partial",
    async ({ linqChatId, phoneNumber, targetKind, template }) => {
      const fixture = createObservabilityPrismaFixture();
      fixture.hostedLinqDeliveryFindMany.mockResolvedValueOnce([
        partialCorrelatedRow(BASE_EFFECT_ID),
      ]);
      const effectId = await resolveHostedLinqInviteSignupDispatchEffectIdTx({
        effectId: BASE_EFFECT_ID,
        prisma: fixture.prisma as never,
      });
      expect(effectId).toBe(BASE_EFFECT_ID);

      fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
        acceptedAt: null,
        attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
        deliveredAt: null,
        failedAt: new Date("2026-03-26T12:00:01.000Z"),
        failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        id: "hld_partial_signup",
        lastReceiptAt: null,
        linqChatLookupKey: linqChatId
          ? createHostedLinqChatLookupKey(linqChatId)
          : null,
        messageLookupKey: "hbidx:linq-message:known-part",
        phoneNumberLookupKey: phoneNumber
          ? createHostedPhoneLookupKey(phoneNumber)
          : null,
        retryAfterAt: null,
        skippedAt: null,
        source: "hosted_webhook_side_effect",
        sourceRef: BASE_EFFECT_ID,
        status: "failed",
        targetKind,
        template,
      });

      await expect(claimHostedLinqDeliveryProviderDispatchTx({
        attemptedAt: new Date("2026-03-26T12:05:00.000Z"),
        idempotencyKey: effectId ?? undefined,
        ...(linqChatId ? { linqChatId } : { phoneNumber }),
        prisma: fixture.prisma as never,
        reclaimStalePreProviderAttempt: true,
        source: "hosted_webhook_side_effect",
        sourceRef: BASE_EFFECT_ID,
        targetKind,
        template,
      })).resolves.toEqual({
        claimed: false,
        id: "hld_partial_signup",
        outcome: "completed",
      });

      expect(fixture.hostedLinqDeliveryCreateMany).not.toHaveBeenCalled();
      expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
    },
  );

  it("keeps the same attempt after a synchronous send failure", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindMany.mockResolvedValueOnce([{
      acceptedAt: null,
      deliveredAt: null,
      idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(BASE_EFFECT_ID),
      lastReceiptAt: null,
      messageLookupKey: null,
      status: "failed",
    }]);
    await expect(resolveHostedLinqInviteSignupDispatchEffectIdTx({
      effectId: BASE_EFFECT_ID,
      prisma: fixture.prisma as never,
    })).resolves.toBe(BASE_EFFECT_ID);
  });

  it("reuses an in-flight attempt instead of opening a new one", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindMany.mockResolvedValueOnce([
      failedCorrelatedRow(BASE_EFFECT_ID),
      {
        acceptedAt: null,
        deliveredAt: null,
        idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(`${BASE_EFFECT_ID}:a2`),
        lastReceiptAt: null,
        messageLookupKey: null,
        status: "attempted",
      },
    ]);
    await expect(resolveHostedLinqInviteSignupDispatchEffectIdTx({
      effectId: BASE_EFFECT_ID,
      prisma: fixture.prisma as never,
    })).resolves.toBe(`${BASE_EFFECT_ID}:a2`);
  });

  it("stops sending once the day's attempt budget is exhausted", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindMany.mockResolvedValueOnce([
      failedCorrelatedRow(BASE_EFFECT_ID),
      failedCorrelatedRow(`${BASE_EFFECT_ID}:a2`),
      failedCorrelatedRow(`${BASE_EFFECT_ID}:a3`),
      failedCorrelatedRow(`${BASE_EFFECT_ID}:a4`),
      failedCorrelatedRow(`${BASE_EFFECT_ID}:a5`),
    ]);
    await expect(resolveHostedLinqInviteSignupDispatchEffectIdTx({
      effectId: BASE_EFFECT_ID,
      prisma: fixture.prisma as never,
    })).resolves.toBeNull();
  });

  it("reopens the onboarding link when the accepted milestone replays a buffered failure receipt", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqProviderEventFindMany.mockResolvedValueOnce([{
      deliveryStatus: "failed",
      eventId: "evt_failed_buffered",
      failureCode: "30007",
      failureReason: "carrier filtered",
      phoneNumberLookupKey: null,
      providerCreatedAt: new Date("2026-03-26T12:02:00.000Z"),
      service: "sms",
    }]);
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      groupJoinOutreachId: "hgrpjoa_buffered",
      groupJoinReplyOccurredAt: new Date("2026-03-26T12:01:00.000Z"),
      sourceRef: BASE_EFFECT_ID,
      template: "invite_signup",
    });

    await expect(markHostedLinqDeliveryAcceptedTx({
      idempotencyKey: BASE_EFFECT_ID,
      linqChatId: "chat_123",
      messageId: "provider_msg_123",
      prisma: fixture.prisma as never,
    })).resolves.toEqual({
      deliveryStatus: "failed",
      reopenOnboardingLink: {
        groupJoinReplyContext: {
          outreachId: "hgrpjoa_buffered",
          repliedAt: "2026-03-26T12:01:00.000Z",
        },
        memberId: "member_123",
        occurredAt: "2026-03-26T00:00:00.000Z",
        releaseDailySuppression: true,
      },
      restoreOnboardingLink: null,
    });
  });

  it("does not reopen the daily marker when a buffered generic failure replays after a distinct group success", async () => {
    const fixture = createObservabilityPrismaFixture();
    const groupEffectId = buildHostedLinqInviteSignupEffectId({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:05:00.000Z",
      sourceEventDigest: "b".repeat(32),
    });
    fixture.hostedLinqProviderEventFindMany.mockResolvedValueOnce([{
      deliveryStatus: "failed",
      eventId: "evt_generic_failed_buffered",
      failureCode: "30007",
      failureReason: "carrier filtered",
      phoneNumberLookupKey: null,
      providerCreatedAt: new Date("2026-03-26T12:10:00.000Z"),
      service: "sms",
    }]);
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      sourceRef: BASE_EFFECT_ID,
      template: "invite_signup",
    });
    fixture.hostedLinqDeliveryFindMany.mockResolvedValueOnce([{
      sourceRef: groupEffectId,
    }]);

    await expect(markHostedLinqDeliveryAcceptedTx({
      idempotencyKey: BASE_EFFECT_ID,
      linqChatId: "chat_123",
      messageId: "provider_msg_generic",
      prisma: fixture.prisma as never,
    })).resolves.toEqual({
      deliveryStatus: "failed",
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    });
  });

  it("restores group signup state when the accepted milestone replays a buffered delivery receipt", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqProviderEventFindMany.mockResolvedValueOnce([{
      deliveryStatus: "delivered",
      eventId: "evt_delivered_buffered",
      failureCode: null,
      failureReason: null,
      phoneNumberLookupKey: null,
      providerCreatedAt: new Date("2026-03-26T12:02:00.000Z"),
      service: "sms",
    }]);
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      groupJoinOutreachId: "hgrpjoa_buffered",
      groupJoinReplyOccurredAt: new Date("2026-03-26T12:01:00.000Z"),
      sourceRef: BASE_EFFECT_ID,
      template: "invite_signup",
    });

    await expect(markHostedLinqDeliveryAcceptedTx({
      idempotencyKey: BASE_EFFECT_ID,
      linqChatId: "chat_123",
      messageId: "provider_msg_123",
      prisma: fixture.prisma as never,
    })).resolves.toEqual({
      deliveryStatus: "delivered",
      reopenOnboardingLink: null,
      restoreOnboardingLink: {
        groupJoinReplyContext: {
          outreachId: "hgrpjoa_buffered",
          repliedAt: "2026-03-26T12:01:00.000Z",
        },
        linqChatId: "chat_123",
        memberId: "member_123",
        occurredAt: "2026-03-26T00:00:00.000Z",
        service: "sms",
      },
    });
  });

  it("reopens failed group context, releases lone suppression, and restores both when delivery later wins", async () => {
    const fixture = createObservabilityPrismaFixture();
    const repliedAt = "2026-03-26T12:01:00.000Z";
    const sourceRef = BASE_EFFECT_ID;
    fixture.hostedLinqDeliveryFindFirst
      .mockResolvedValueOnce({
        id: "hld_group_failed",
        idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(BASE_EFFECT_ID),
        groupJoinOutreachId: "hgrpjoa_receipt",
        groupJoinReplyOccurredAt: new Date(repliedAt),
        phoneNumberLookupKey: null,
        sourceRef,
        template: "invite_signup",
      })
      .mockResolvedValueOnce({
        id: "hld_group_delivered",
        idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(BASE_EFFECT_ID),
        groupJoinOutreachId: "hgrpjoa_receipt",
        groupJoinReplyOccurredAt: new Date(repliedAt),
        phoneNumberLookupKey: null,
        sourceRef,
        template: "invite_signup",
      });

    await ingestHostedLinqProviderEventTx({
      event: requireParsedProviderEvent(buildProviderEvent({
        createdAt: "2026-03-26T12:02:00.000Z",
        data: {
          error: { code: "30007", message: "carrier filtered" },
          message_id: "provider_msg_group",
          phone_number: "+15550000000",
          service: "sms",
        },
        eventId: "evt_group_failed",
        eventType: "message.failed",
      })),
      prisma: fixture.prisma as never,
    });
    await ingestHostedLinqProviderEventTx({
      event: requireParsedProviderEvent(buildProviderEvent({
        createdAt: "2026-03-26T12:03:00.000Z",
        data: {
          message_id: "provider_msg_group",
          phone_number: "+15550000000",
          service: "sms",
        },
        eventId: "evt_group_delivered",
        eventType: "message.delivered",
      })),
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedGroupJoinOutreachUpdateMany).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDailyStateUpdateMany)
      .toHaveBeenNthCalledWith(1, {
        data: {
          onboardingLinkSentAt: null,
        },
        where: {
          dayUtc: new Date("2026-03-26T00:00:00.000Z"),
          memberId: "member_123",
          onboardingLinkSentAt: {
            not: null,
          },
        },
      });
    expect(fixture.hostedLinqDailyStateUpdateMany)
      .toHaveBeenNthCalledWith(2, {
      data: {
        onboardingLinkSentAt: expect.any(Date),
      },
      where: {
        dayUtc: new Date("2026-03-26T00:00:00.000Z"),
        memberId: "member_123",
        onboardingLinkSentAt: null,
      },
      });
  });

  it("does not reopen daily or group context for a stale failed attempt", async () => {
    const fixture = createObservabilityPrismaFixture();
    const repliedAt = "2026-03-26T12:01:00.000Z";
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValueOnce({
      id: "hld_group_stale_failed",
      idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(
        BASE_EFFECT_ID,
      ),
      groupJoinOutreachId: "hgrpjoa_stale",
      groupJoinReplyOccurredAt: new Date(repliedAt),
      phoneNumberLookupKey: null,
      sourceRef: BASE_EFFECT_ID,
      template: "invite_signup",
    });
    fixture.hostedLinqDeliveryFindMany.mockResolvedValueOnce([{
      sourceRef: `${BASE_EFFECT_ID}:a2`,
    }]);

    await ingestHostedLinqProviderEventTx({
      event: requireParsedProviderEvent(buildProviderEvent({
        createdAt: "2026-03-26T12:04:00.000Z",
        data: {
          error: { code: "30007", message: "carrier filtered" },
          message_id: "provider_msg_group_stale",
          phone_number: "+15550000000",
          service: "sms",
        },
        eventId: "evt_group_stale_failed",
        eventType: "message.failed",
      })),
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqDailyStateUpdateMany).not.toHaveBeenCalled();
    expect(fixture.hostedGroupJoinOutreachUpdateMany).not.toHaveBeenCalled();
    expect(fixture.hostedLinqDeliveryFindMany).toHaveBeenCalledWith({
      select: { sourceRef: true },
      where: {
        sourceRef: { startsWith: BASE_EFFECT_ID },
        status: {
          in: ["attempted", "provider_dispatch_started", "accepted", "delivered"],
        },
        template: {
          in: ["invite_signup", "invite_signup_fallback"],
        },
      },
    });
  });
  it.each(["invite_signup", "invite_signup_fallback"] as const)(
    "surfaces the delivered %s chat when the accepted milestone replays a buffered receipt",
    async (template: "invite_signup" | "invite_signup_fallback") => {
      const fixture = createObservabilityPrismaFixture();
      fixture.hostedLinqProviderEventFindMany.mockResolvedValueOnce([{
        deliveryStatus: "delivered",
        eventId: "evt_delivered_buffered",
        failureCode: null,
        failureReason: null,
        phoneNumberLookupKey: null,
        providerCreatedAt: new Date("2026-03-26T12:02:00.000Z"),
        service: "iMessage",
      }]);
      fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
        sourceRef: BASE_EFFECT_ID,
        template,
      });

      await expect(markHostedLinqDeliveryAcceptedTx({
        idempotencyKey: BASE_EFFECT_ID,
        linqChatId: "chat_123",
        messageId: "provider_msg_123",
        prisma: fixture.prisma as never,
      })).resolves.toEqual({
        deliveryStatus: "delivered",
        reopenOnboardingLink: null,
        restoreOnboardingLink: {
          linqChatId: "chat_123",
          memberId: "member_123",
          occurredAt: "2026-03-26T00:00:00.000Z",
          service: "iMessage",
        },
      });
    },
  );

  it("restores the onboarding link when a delivered receipt advances an invite delivery", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindFirst.mockResolvedValueOnce({
      id: "hld_delivered_signup",
      idempotencyKey: null,
      phoneNumberLookupKey: null,
      sourceRef: `${BASE_EFFECT_ID}:a2`,
      template: "invite_signup",
    });

    await expect(applyHostedLinqDeliveryReceiptTx({
      event: requireParsedProviderEvent(buildProviderEvent({
        data: {
          chat_id: "chat_123",
          message_id: "provider_msg_a2",
          phone_number: "+15550000000",
          service: "iMessage",
        },
        eventId: "evt_delivered_a2",
        eventType: "message.delivered",
      })),
      prisma: fixture.prisma as never,
    })).resolves.toEqual({
      advanced: true,
      deliveryId: "hld_delivered_signup",
      phoneNumberLookupKey: null,
      reopenOnboardingLink: null,
      restoreOnboardingLink: {
        linqChatId: "chat_123",
        memberId: "member_123",
        occurredAt: "2026-03-26T00:00:00.000Z",
        service: "iMessage",
      },
    });
  });
});

describe("owned multi-part Linq delivery receipts", () => {
  it.each([
    {
      expectedStatus: "failed",
      label: "primary delivered and link failed",
      messages: [
        buildOwnedDeliveryMessageState("delivered", "evt_primary_delivered"),
        buildOwnedDeliveryMessageState("failed", "evt_link_failed"),
      ],
      receiptMessageId: "msg_link",
      receiptType: "message.failed",
    },
    {
      expectedStatus: "failed",
      label: "primary failed and link delivered",
      messages: [
        buildOwnedDeliveryMessageState("failed", "evt_primary_failed"),
        buildOwnedDeliveryMessageState("delivered", "evt_link_delivered"),
      ],
      receiptMessageId: "msg_primary",
      receiptType: "message.failed",
    },
    {
      expectedStatus: "delivered",
      label: "both parts delivered",
      messages: [
        buildOwnedDeliveryMessageState("delivered", "evt_primary_delivered"),
        buildOwnedDeliveryMessageState("delivered", "evt_link_delivered"),
      ],
      receiptMessageId: "msg_link",
      receiptType: "message.delivered",
    },
  ])(
    "derives the aggregate outcome when $label",
    async ({
      expectedStatus,
      messages,
      receiptMessageId,
      receiptType,
    }) => {
      const fixture = createOwnedDeliveryReceiptPrismaFixture(messages);
      const result = await applyHostedLinqDeliveryReceiptTx({
        event: requireParsedProviderEvent(buildProviderEvent({
          data: {
            message_id: receiptMessageId,
            phone_number: "+15550000000",
            service: "iMessage",
          },
          eventId: `evt_${receiptMessageId}_${expectedStatus}`,
          eventType: receiptType,
        })),
        prisma: fixture.prisma as never,
      });

      expect(result).toMatchObject({
        advanced: true,
        deliveryId: "hld_owned_parts",
      });
      expect(fixture.hostedLinqDeliveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: expectedStatus,
          }),
          where: { id: "hld_owned_parts" },
        }),
      );
      if (expectedStatus === "failed") {
        expect(fixture.hostedLinqDeliveryUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              deliveredAt: null,
              failedAt: expect.any(Date),
            }),
          }),
        );
      } else {
        expect(fixture.hostedLinqDeliveryUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              deliveredAt: expect.any(Date),
              failedAt: null,
            }),
          }),
        );
      }
    },
  );

  it.each([
    {
      expectedStatus: "failed",
      messages: [
        buildOwnedDeliveryMessageState("delivered", "evt_group_primary_delivered"),
        buildOwnedDeliveryMessageState("failed", "evt_group_link_failed"),
      ],
      receiptMessageId: "msg_group_link",
      receiptType: "message.failed",
    },
    {
      expectedStatus: "delivered",
      messages: [
        buildOwnedDeliveryMessageState("delivered", "evt_group_primary_delivered"),
        buildOwnedDeliveryMessageState("delivered", "evt_group_link_delivered"),
      ],
      receiptMessageId: "msg_group_link",
      receiptType: "message.delivered",
    },
  ] as const)(
    "advances a no-receipt group parent to $expectedStatus when its children become terminal",
    async ({ expectedStatus, messages, receiptMessageId, receiptType }) => {
      const fixture = createOwnedDeliveryReceiptPrismaFixture([...messages], {
        failedAt: null,
        failureCode: null,
        failureReason: null,
        status: "sent_no_receipt_expected",
      });

      await applyHostedLinqDeliveryReceiptTx({
        event: requireParsedProviderEvent(buildProviderEvent({
          data: {
            message_id: receiptMessageId,
            phone_number: "+15550000000",
            service: "iMessage",
          },
          eventId: `evt_${receiptMessageId}_${expectedStatus}`,
          eventType: receiptType,
        })),
        prisma: fixture.prisma as never,
      });

      expect(fixture.hostedLinqDeliveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: expectedStatus }),
          where: { id: "hld_owned_parts" },
        }),
      );
    },
  );

  it.each(["delivered", "failed"] as const)(
    "keeps an incomplete rich-link partial absorbing after its known child is %s",
    async (messageStatus) => {
      const partialFailedAt = new Date("2026-03-26T11:59:59.000Z");
      const partialFailureReason =
        "Linq could not confirm both rich-link provider identities.";
      const fixture = createOwnedDeliveryReceiptPrismaFixture(
        [buildOwnedDeliveryMessageState(
          messageStatus,
          `evt_known_part_${messageStatus}`,
        )],
        {
          failedAt: partialFailedAt,
          failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
          failureReason: partialFailureReason,
          status: "failed",
        },
      );

      await applyHostedLinqDeliveryReceiptTx({
        event: requireParsedProviderEvent(buildProviderEvent({
          data: {
            message_id: "msg_primary",
            phone_number: "+15550000000",
            service: "iMessage",
          },
          eventId: `evt_known_part_${messageStatus}`,
          eventType: `message.${messageStatus}`,
        })),
        prisma: fixture.prisma as never,
      });

      expect(fixture.hostedLinqDeliveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deliveredAt: null,
            failedAt: partialFailedAt,
            failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
            failureReason: partialFailureReason,
            status: "failed",
          }),
          where: { id: "hld_owned_parts" },
        }),
      );
    },
  );

  it.each(["delivered", "failed"] as const)(
    "keeps a parent-only rich-link partial absorbing when its known provider message is %s",
    async (messageStatus) => {
      const fixture = createObservabilityPrismaFixture();
      fixture.hostedLinqDeliveryFindFirst.mockResolvedValueOnce({
        failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        id: "hld_parent_only_partial",
        idempotencyKey: "payment-message:evt_parent_only",
        phoneNumberLookupKey: null,
        sourceRef: null,
        status: "failed",
        template: null,
      });

      await expect(applyHostedLinqDeliveryReceiptTx({
        event: requireParsedProviderEvent(buildProviderEvent({
          data: {
            message_id: "msg_known_partial",
            phone_number: "+15550000000",
            service: "iMessage",
          },
          eventId: `evt_parent_only_${messageStatus}`,
          eventType: `message.${messageStatus}`,
        })),
        prisma: fixture.prisma as never,
      })).resolves.toEqual({
        advanced: false,
        deliveryId: "hld_parent_only_partial",
        phoneNumberLookupKey: null,
        reopenOnboardingLink: null,
        restoreOnboardingLink: null,
      });

      expect(fixture.hostedLinqDeliveryUpdateMany).not.toHaveBeenCalled();
    },
  );

  it.each(["delivered", "failed"] as const)(
    "attaches a buffered %s receipt after recording an incomplete rich-link child without promoting the parent",
    async (messageStatus) => {
      const fixture = createObservabilityPrismaFixture();
      const partialFailedAt = new Date("2026-03-26T11:59:59.000Z");
      const partialFailureReason =
        "Linq could not confirm both rich-link provider identities.";
      const receiptAt = new Date("2026-03-26T12:00:00.000Z");
      fixture.hostedLinqDeliveryFindUnique
        .mockResolvedValueOnce({ id: "hld_partial_catchup" })
        .mockResolvedValueOnce({
          failedAt: partialFailedAt,
          failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
          failureReason: partialFailureReason,
          status: "failed",
        });
      fixture.hostedLinqDeliveryMessageFindFirst.mockResolvedValueOnce({
        id: "hldm_partial_catchup",
      });
      fixture.hostedLinqDeliveryMessageUpdateMany.mockResolvedValueOnce({
        count: 1,
      });
      fixture.hostedLinqDeliveryMessageFindMany.mockResolvedValueOnce([
        buildOwnedDeliveryMessageState(
          messageStatus,
          `evt_buffered_${messageStatus}`,
        ),
      ]);
      fixture.hostedLinqProviderEventFindMany.mockResolvedValueOnce([{
        deliveryStatus: messageStatus,
        eventId: `evt_buffered_${messageStatus}`,
        failureCode: messageStatus === "failed" ? "provider_rejected" : null,
        failureReason:
          messageStatus === "failed" ? "Provider rejected message." : null,
        phoneNumberLookupKey: null,
        providerCreatedAt: receiptAt,
        service: "iMessage",
      }]);

      await markHostedLinqDeliverySendFailedTx({
        failedAt: partialFailedAt,
        failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        failureReason: partialFailureReason,
        idempotencyKey: "payment-message:evt_partial_catchup",
        linqChatId: "chat_partial_catchup",
        messageIds: ["msg_known_partial"],
        prisma: fixture.prisma as never,
      });

      expect(fixture.hostedLinqDeliveryMessageUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: messageStatus,
          }),
          where: expect.objectContaining({
            id: "hldm_partial_catchup",
          }),
        }),
      );
      expect(fixture.hostedLinqDeliveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deliveredAt: null,
            failedAt: partialFailedAt,
            failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
            failureReason: partialFailureReason,
            status: "failed",
          }),
          where: { id: "hld_partial_catchup" },
        }),
      );
    },
  );

  it("records ordered primary and link identities with the link as the scalar owner key", async () => {
    const fixture = createObservabilityPrismaFixture();
    fixture.hostedLinqDeliveryFindUnique.mockResolvedValueOnce({
      groupJoinOutreachId: null,
      groupJoinReplyOccurredAt: null,
      id: "hld_owned_parts",
      sourceRef: null,
      template: null,
    });
    fixture.hostedLinqDeliveryMessageCreateMany.mockResolvedValueOnce({
      count: 2,
    });

    await markHostedLinqDeliveryAcceptedTx({
      idempotencyKey: "payment-message:evt_123",
      linqChatId: "chat_123",
      messageId: "msg_link",
      messageIds: ["msg_primary", "msg_link"],
      prisma: fixture.prisma as never,
    });

    expect(fixture.hostedLinqDeliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageLookupKey: createHostedLinqMessageLookupKey("msg_link"),
        }),
      }),
    );
    expect(fixture.hostedLinqDeliveryMessageCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          deliveryId: "hld_owned_parts",
          messageLookupKey: createHostedLinqMessageLookupKey("msg_primary"),
          ordinal: 0,
        }),
        expect.objectContaining({
          deliveryId: "hld_owned_parts",
          messageLookupKey: createHostedLinqMessageLookupKey("msg_link"),
          ordinal: 1,
        }),
      ],
      skipDuplicates: true,
    });
  });
});

function buildOwnedDeliveryMessageState(
  status: "delivered" | "failed",
  eventId: string,
) {
  const occurredAt = new Date("2026-03-26T12:00:00.000Z");
  return {
    deliveredAt: status === "delivered" ? occurredAt : null,
    failedAt: status === "failed" ? occurredAt : null,
    failureCode: status === "failed" ? "provider_rejected" : null,
    failureReason: status === "failed" ? "Provider rejected message." : null,
    lastProviderEventId: createHostedLinqProviderEventLookupKey(eventId),
    lastReceiptAt: occurredAt,
    service: "iMessage",
    status,
  };
}

function buildAcceptedOwnedDeliveryMessageState() {
  return {
    deliveredAt: null,
    failedAt: null,
    failureCode: null,
    failureReason: null,
    lastProviderEventId: null,
    lastReceiptAt: null,
    service: null,
    status: "accepted",
  };
}

function createOwnedDeliveryReceiptPrismaFixture(
  messages: ReturnType<typeof buildOwnedDeliveryMessageState>[],
  delivery: {
    failedAt: Date | null;
    failureCode: string | null;
    failureReason: string | null;
    status: "accepted" | "failed" | "sent_no_receipt_expected";
  } = {
    failedAt: null,
    failureCode: null,
    failureReason: null,
    status: "accepted",
  },
) {
  const hostedLinqDeliveryUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hostedLinqDelivery: {
      findUnique: vi.fn().mockResolvedValue(delivery),
      update: hostedLinqDeliveryUpdate,
    },
    hostedLinqDeliveryMessage: {
      findFirst: vi.fn().mockResolvedValue({
        delivery: {
          groupJoinOutreachId: null,
          groupJoinReplyOccurredAt: null,
          id: "hld_owned_parts",
          idempotencyKey: "payment-message:evt_123",
          phoneNumberLookupKey: null,
          sourceRef: null,
          template: null,
        },
        id: "hldm_receipt_target",
      }),
      findMany: vi.fn().mockResolvedValue(messages),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    hostedLinqDeliveryUpdate,
    prisma,
  };
}

function buildGroupLineRecoveryDeliveryFixture(overrides: Partial<{
  acceptedAt: Date | null;
  attemptedAt: Date;
  deliveredAt: Date | null;
  failureCode: string | null;
  failedAt: Date | null;
  groupJoinOutreachId: string | null;
  groupJoinReplyOccurredAt: Date | null;
  id: string;
  lastReceiptAt: Date | null;
  linqChatLookupKey: string | null;
  messageLookupKey: string | null;
  phoneNumberLookupKey: string | null;
  retryAfterAt: Date | null;
  skippedAt: Date | null;
  source: string | null;
  sourceRef: string | null;
  status: string;
  targetKind: string | null;
  template: string | null;
  updatedAt: Date;
}> = {}) {
  return {
    acceptedAt: null,
    attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
    deliveredAt: null,
    failureCode: null,
    failedAt: null,
    groupJoinOutreachId: null,
    groupJoinReplyOccurredAt: null,
    id: "hld_group_line_recovery",
    lastReceiptAt: null,
    linqChatLookupKey: null,
    messageLookupKey: null,
    phoneNumberLookupKey: createHostedPhoneLookupKey("+15550100042"),
    retryAfterAt: null,
    skippedAt: null,
    source: "hosted_webhook_side_effect",
    sourceRef: createHostedLinqDeliverySourceRefLookupKey(
      "event_group_recovery",
    ),
    status: "attempted",
    targetKind: "participant",
    template: "group_line_recovery",
    updatedAt: new Date("2026-03-26T12:00:01.000Z"),
    ...overrides,
  };
}

function buildGroupSetupDeliveryFixture(overrides: Partial<{
  acceptedAt: Date | null;
  attemptedAt: Date;
  deliveredAt: Date | null;
  failureCode: string | null;
  failedAt: Date | null;
  groupJoinOutreachId: string | null;
  groupJoinReplyOccurredAt: Date | null;
  id: string;
  lastReceiptAt: Date | null;
  linqChatLookupKey: string | null;
  messageLookupKey: string | null;
  phoneNumberLookupKey: string | null;
  retryAfterAt: Date | null;
  skippedAt: Date | null;
  source: string | null;
  sourceRef: string | null;
  status: string;
  targetKind: string | null;
  template: string | null;
  updatedAt: Date;
}> = {}) {
  return {
    acceptedAt: null,
    attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
    deliveredAt: null,
    failureCode: null,
    failedAt: null,
    groupJoinOutreachId: null,
    groupJoinReplyOccurredAt: null,
    id: "hld_group_setup",
    lastReceiptAt: null,
    linqChatLookupKey:
      createHostedLinqChatLookupKeyReadCandidates("chat_group_setup")[0],
    messageLookupKey: null,
    phoneNumberLookupKey: null,
    retryAfterAt: null,
    skippedAt: null,
    source: "hosted_webhook_side_effect",
    sourceRef: createHostedLinqDeliverySourceRefLookupKey(
      "event_group_setup_first_sender",
    ),
    status: "attempted",
    targetKind: "thread",
    template: HOSTED_LINQ_GROUP_SETUP_TEMPLATE,
    updatedAt: new Date("2026-03-26T12:00:01.000Z"),
    ...overrides,
  };
}

function createObservabilityPrismaFixture() {
  const transaction = vi.fn();
  const executeRaw = vi.fn().mockResolvedValue([]);
  const queryRaw = vi.fn().mockResolvedValue([]);
  const hostedGroupJoinOutreachUpdateMany =
    vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqAlertCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqDailyStateUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqDeliveryCreate = vi.fn().mockResolvedValue({ id: "hld_random" });
  const hostedLinqDeliveryCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqDeliveryFindFirst = vi.fn().mockResolvedValue(null);
  const hostedLinqDeliveryFindMany = vi.fn().mockResolvedValue([]);
  const hostedLinqDeliveryFindUnique = vi.fn().mockResolvedValue(null);
  const hostedLinqDeliveryUpdate = vi.fn().mockResolvedValue(undefined);
  const hostedLinqDeliveryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqDeliveryUpsert = vi.fn().mockResolvedValue({ id: "hld_123" });
  const hostedLinqDeliveryMessageCreateMany =
    vi.fn().mockResolvedValue({ count: 0 });
  const hostedLinqDeliveryMessageFindFirst =
    vi.fn().mockResolvedValue(null);
  const hostedLinqDeliveryMessageFindMany =
    vi.fn().mockResolvedValue([]);
  const hostedLinqDeliveryMessageUpdateMany =
    vi.fn().mockResolvedValue({ count: 0 });
  const hostedLinqLineFindMany = vi.fn().mockResolvedValue([]);
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
  const hostedLinqChatHealthFindMany = vi.fn().mockResolvedValue([]);
  const hostedLinqChatHealthCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqChatHealthUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqProviderEventCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const hostedLinqProviderEventFindFirst = vi.fn().mockResolvedValue(null);
  const hostedLinqProviderEventFindMany = vi.fn().mockResolvedValue([]);
  const hostedLinqProviderEventFindUnique = vi.fn().mockResolvedValue(null);
  const hostedLinqProviderEventUpdateMany =
    vi.fn().mockResolvedValue({ count: 1 });
  const hostedMailboxItemUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    $transaction: transaction,
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    hostedLinqAlert: {
      createMany: hostedLinqAlertCreateMany,
    },
    hostedGroupJoinOutreach: {
      updateMany: hostedGroupJoinOutreachUpdateMany,
    },
    hostedLinqDailyState: {
      updateMany: hostedLinqDailyStateUpdateMany,
    },
    hostedLinqChatHealth: {
      createMany: hostedLinqChatHealthCreateMany,
      findMany: hostedLinqChatHealthFindMany,
      updateMany: hostedLinqChatHealthUpdateMany,
    },
    hostedLinqDelivery: {
      create: hostedLinqDeliveryCreate,
      createMany: hostedLinqDeliveryCreateMany,
      findFirst: hostedLinqDeliveryFindFirst,
      findMany: hostedLinqDeliveryFindMany,
      findUnique: hostedLinqDeliveryFindUnique,
      update: hostedLinqDeliveryUpdate,
      updateMany: hostedLinqDeliveryUpdateMany,
      upsert: hostedLinqDeliveryUpsert,
    },
    hostedLinqDeliveryMessage: {
      createMany: hostedLinqDeliveryMessageCreateMany,
      findFirst: hostedLinqDeliveryMessageFindFirst,
      findMany: hostedLinqDeliveryMessageFindMany,
      updateMany: hostedLinqDeliveryMessageUpdateMany,
    },
    hostedLinqLine: {
      findMany: hostedLinqLineFindMany,
      findUnique: hostedLinqLineFindUnique,
      update: hostedLinqLineUpdate,
      updateMany: hostedLinqLineUpdateMany,
      upsert: hostedLinqLineUpsert,
    },
    hostedLinqProviderEvent: {
      createMany: hostedLinqProviderEventCreateMany,
      findFirst: hostedLinqProviderEventFindFirst,
      findMany: hostedLinqProviderEventFindMany,
      findUnique: hostedLinqProviderEventFindUnique,
      updateMany: hostedLinqProviderEventUpdateMany,
    },
    hostedMailboxItem: {
      updateMany: hostedMailboxItemUpdateMany,
    },
  };
  transaction.mockImplementation(
    (operation: (client: typeof prisma) => unknown) => operation(prisma),
  );

  return {
    executeRaw,
    hostedGroupJoinOutreachUpdateMany,
    hostedLinqAlertCreateMany,
    hostedLinqDailyStateUpdateMany,
    hostedLinqDeliveryCreate,
    hostedLinqDeliveryCreateMany,
    hostedLinqDeliveryFindFirst,
    hostedLinqDeliveryFindMany,
    hostedLinqDeliveryFindUnique,
    hostedLinqDeliveryMessageCreateMany,
    hostedLinqDeliveryMessageFindFirst,
    hostedLinqDeliveryMessageFindMany,
    hostedLinqDeliveryMessageUpdateMany,
    hostedLinqDeliveryUpdate,
    hostedLinqDeliveryUpdateMany,
    hostedLinqDeliveryUpsert,
    hostedLinqLineFindMany,
    hostedLinqLineFindUnique,
    hostedLinqLineUpdate,
    hostedLinqLineUpdateMany,
    hostedLinqLineUpsert,
    hostedLinqChatHealthCreateMany,
    hostedLinqChatHealthFindMany,
    hostedLinqChatHealthUpdateMany,
    hostedLinqProviderEventCreateMany,
    hostedLinqProviderEventFindFirst,
    hostedLinqProviderEventFindMany,
    hostedLinqProviderEventFindUnique,
    hostedLinqProviderEventUpdateMany,
    hostedMailboxItemUpdateMany,
    prisma,
    transaction,
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
