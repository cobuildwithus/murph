import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyHostedLinqDeliveryReceiptTx: vi.fn(),
  ensureHostedLinqLineForProviderEventTx: vi.fn(),
  projectHostedLinqChatHealthTx: vi.fn(),
  projectHostedLinqLineForProviderEventTx: vi.fn(),
  projectHostedLinqLineProviderStateTx: vi.fn(),
  readHostedLinqDeliveryForProviderMessageTx: vi.fn(),
  upsertHostedLinqLineForPhoneTx: vi.fn(),
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
  upsertHostedLinqLineForPhoneTx: mocks.upsertHostedLinqLineForPhoneTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-provider-health-store", () => ({
  projectHostedLinqChatHealthTx: mocks.projectHostedLinqChatHealthTx,
  projectHostedLinqLineProviderStateTx:
    mocks.projectHostedLinqLineProviderStateTx,
}));

import type { ParsedHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import {
  ingestHostedLinqProviderEventTx,
} from "@/src/lib/hosted-onboarding/linq-provider-event-store";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureHostedLinqLineForProviderEventTx.mockResolvedValue(null);
});

describe("duplicate Linq provider reaction projection", () => {
  it.each(["reaction.added", "reaction.removed"] as const)(
    "replays %s through the idempotent mailbox owner",
    async (eventType) => {
      const prisma = createDuplicatePrismaStub(null);

      await expect(ingestHostedLinqProviderEventTx({
        event: buildProviderEvent(eventType),
        prisma,
      })).resolves.toEqual({
        alertIds: [],
        duplicate: false,
      });
    },
  );

  it("keeps terminal join-offer reactions and unrelated provider events duplicate", async () => {
    const handledPrisma = createDuplicatePrismaStub(
      new Date("2026-07-30T12:00:00.000Z"),
    );
    await expect(ingestHostedLinqProviderEventTx({
      event: buildProviderEvent("reaction.added"),
      prisma: handledPrisma,
    })).resolves.toEqual({
      alertIds: [],
      duplicate: true,
      groupJoinOfferHandled: true,
    });

    const messagePrisma = createDuplicatePrismaStub(null);
    await expect(ingestHostedLinqProviderEventTx({
      event: buildProviderEvent("message.received"),
      prisma: messagePrisma,
    })).resolves.toEqual({
      alertIds: [],
      duplicate: true,
    });
  });
});

function createDuplicatePrismaStub(
  groupJoinOfferHandledAt: Date | null,
): PrismaClient {
  return {
    hostedLinqProviderEvent: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue({ groupJoinOfferHandledAt }),
    },
  } as unknown as PrismaClient;
}

function buildProviderEvent(
  eventType: ParsedHostedLinqProviderEvent["eventType"],
): ParsedHostedLinqProviderEvent {
  return {
    apiVersion: "v3",
    deliveryStatus: null,
    direction: eventType === "message.received" ? "inbound" : null,
    eventId: `event-${eventType}`,
    eventType,
    extractionJson: {},
    failureCode: null,
    failureReason: null,
    linqChatId: "chat-group",
    linqChatLookupKey: null,
    linqMessageId: "message-42",
    messageIdSuffix: null,
    messageLookupKey: null,
    messageLookupKeyReadCandidates: [],
    payloadHash: null,
    payloadSanitizedJson: {},
    payloadShapeJson: {},
    phoneNumber: null,
    phoneNumberHint: null,
    phoneNumberLookupKey: null,
    phoneNumberRole: "unknown",
    providerCreatedAt: new Date("2026-07-30T12:00:00.000Z"),
    providerReason: null,
    providerStatus: null,
    reactionCustomEmoji: eventType.startsWith("reaction.") ? "😂" : null,
    reactionFromHandle: eventType.startsWith("reaction.")
      ? "+15551234567"
      : null,
    reactionIsFromMe: false,
    reactionPartIndex: null,
    reactionType: eventType.startsWith("reaction.") ? "laugh" : null,
    service: "iMessage",
    traceIdSuffix: null,
    webhookVersion: "2026-02-03",
  };
}
