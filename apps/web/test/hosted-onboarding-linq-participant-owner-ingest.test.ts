import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ParsedHostedLinqProviderEvent,
} from "@/src/lib/hosted-onboarding/linq-provider-events";

const mocks = vi.hoisted(() => ({
  applyHostedLinqDeliveryReceiptTx: vi.fn(),
  createHostedLinqProviderEventLookupKey: vi.fn(),
  ensureHostedLinqLineForProviderEventTx: vi.fn(),
  markHostedLinqOnboardingLinkNoticeSent: vi.fn(),
  projectHostedLinqLineForProviderEventTx: vi.fn(),
  provisionHostedLinqParticipantAddedOwnerTx: vi.fn(),
  readHostedLinqDeliveryForProviderMessageTx: vi.fn(),
  releaseHostedLinqOnboardingLinkNoticeClaim: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  applyHostedLinqDeliveryReceiptTx: mocks.applyHostedLinqDeliveryReceiptTx,
  readHostedLinqDeliveryForProviderMessageTx:
    mocks.readHostedLinqDeliveryForProviderMessageTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  ensureHostedLinqLineForProviderEventTx:
    mocks.ensureHostedLinqLineForProviderEventTx,
  projectHostedLinqLineForProviderEventTx:
    mocks.projectHostedLinqLineForProviderEventTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-observability-identifiers", () => ({
  createHostedLinqProviderEventLookupKey:
    mocks.createHostedLinqProviderEventLookupKey,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", () => ({
  markHostedLinqOnboardingLinkNoticeSent:
    mocks.markHostedLinqOnboardingLinkNoticeSent,
  releaseHostedLinqOnboardingLinkNoticeClaim:
    mocks.releaseHostedLinqOnboardingLinkNoticeClaim,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-participant-added-owner", () => ({
  provisionHostedLinqParticipantAddedOwnerTx:
    mocks.provisionHostedLinqParticipantAddedOwnerTx,
}));

import {
  ingestHostedLinqProviderEventTx,
} from "@/src/lib/hosted-onboarding/linq-provider-event-store";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.applyHostedLinqDeliveryReceiptTx.mockResolvedValue({
    advanced: false,
    deliveryId: null,
    phoneNumberLookupKey: null,
    reopenOnboardingLink: null,
    restoreOnboardingLink: null,
  });
  mocks.createHostedLinqProviderEventLookupKey.mockImplementation(
    (eventId: string) => `provider-event:${eventId}`,
  );
  mocks.ensureHostedLinqLineForProviderEventTx.mockResolvedValue(null);
  mocks.projectHostedLinqLineForProviderEventTx.mockResolvedValue(undefined);
  mocks.provisionHostedLinqParticipantAddedOwnerTx.mockResolvedValue(
    "owner_bound",
  );
});

describe("participant-added owner ingestion", () => {
  it("provisions once after the provider-event duplicate fence", async () => {
    const { createMany, prisma } = buildPrisma({ createdCount: 1 });
    const event = buildParticipantAddedEvent();

    await expect(ingestHostedLinqProviderEventTx({
      event,
      prisma,
    })).resolves.toMatchObject({
      duplicate: false,
    });

    expect(mocks.provisionHostedLinqParticipantAddedOwnerTx).toHaveBeenCalledWith({
      chatId: "chat_existing_friends",
      evidence: {
        addedByHandle: "+15551234567",
        linePhoneNumber: "+15550000000",
      },
      eventId: "evt_murph_added",
      occurredAt: event.providerCreatedAt,
      prisma,
    });
    expect(createMany.mock.calls[0]?.[0]?.data).not.toHaveProperty(
      "participantAddedOwnerEvidence",
    );
    expect(
      mocks.ensureHostedLinqLineForProviderEventTx.mock.calls[0]?.[0]?.event,
    ).not.toHaveProperty("participantAddedOwnerEvidence");
    expect(
      mocks.applyHostedLinqDeliveryReceiptTx.mock.calls[0]?.[0]?.event,
    ).not.toHaveProperty("participantAddedOwnerEvidence");
    expect(
      mocks.projectHostedLinqLineForProviderEventTx.mock.calls[0]?.[0]?.event,
    ).not.toHaveProperty("participantAddedOwnerEvidence");
  });

  it("does not provision again for a duplicate provider event", async () => {
    const { prisma } = buildPrisma({ createdCount: 0 });

    await expect(ingestHostedLinqProviderEventTx({
      event: buildParticipantAddedEvent(),
      prisma,
    })).resolves.toEqual({
      alertIds: [],
      duplicate: true,
    });

    expect(
      mocks.provisionHostedLinqParticipantAddedOwnerTx,
    ).not.toHaveBeenCalled();
    expect(mocks.applyHostedLinqDeliveryReceiptTx).not.toHaveBeenCalled();
  });

  it("keeps actor-less participant events on the existing telemetry path", async () => {
    const { prisma } = buildPrisma({ createdCount: 1 });

    await ingestHostedLinqProviderEventTx({
      event: {
        ...buildParticipantAddedEvent(),
        participantAddedOwnerEvidence: null,
      },
      prisma,
    });

    expect(
      mocks.provisionHostedLinqParticipantAddedOwnerTx,
    ).not.toHaveBeenCalled();
    expect(mocks.applyHostedLinqDeliveryReceiptTx).toHaveBeenCalled();
  });
});

function buildPrisma(input: { createdCount: number }) {
  const createMany = vi.fn().mockResolvedValue({ count: input.createdCount });
  const prisma = {
    hostedLinqProviderEvent: {
      createMany,
      findUnique: vi.fn().mockResolvedValue({
        groupJoinOfferHandledAt: null,
      }),
    },
  } as never;
  return { createMany, prisma };
}

function buildParticipantAddedEvent(): ParsedHostedLinqProviderEvent {
  return {
    apiVersion: "v3",
    deliveryStatus: null,
    direction: null,
    eventId: "evt_murph_added",
    eventType: "participant.added",
    extractionJson: {},
    failureCode: null,
    failureReason: null,
    linqChatId: "chat_existing_friends",
    linqChatLookupKey: "chat-lookup-key",
    linqMessageId: null,
    messageIdSuffix: null,
    messageLookupKey: null,
    messageLookupKeyReadCandidates: [],
    participantAddedOwnerEvidence: {
      addedByHandle: "+15551234567",
      linePhoneNumber: "+15550000000",
    },
    payloadHash: "payload-hash",
    payloadSanitizedJson: {},
    payloadShapeJson: {},
    phoneNumber: null,
    phoneNumberHint: null,
    phoneNumberLookupKey: null,
    phoneNumberRole: "unknown",
    providerCreatedAt: new Date("2026-07-29T05:00:00.000Z"),
    providerReason: null,
    providerStatus: null,
    reactionCustomEmoji: null,
    reactionFromHandle: null,
    reactionIsFromMe: null,
    reactionPartIndex: null,
    reactionType: null,
    service: "iMessage",
    traceIdSuffix: "-added",
    webhookVersion: "2026-02-03",
  };
}
