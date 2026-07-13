import { HostedBillingStatus } from "@prisma/client";
import {
  createHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
} from "@murphai/runtime-state";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decodeHostedMailboxStoredPayload: vi.fn(),
  markHostedAiUsageDeniedResponseDispatchStartedTx: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedMailboxPayload: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  readHostedWhatsAppMessagingConsentGrantedTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  decodeHostedMailboxStoredPayload: mocks.decodeHostedMailboxStoredPayload,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
  readHostedMailboxPayload: mocks.readHostedMailboxPayload,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  markHostedAiUsageDeniedResponseDispatchStartedTx:
    mocks.markHostedAiUsageDeniedResponseDispatchStartedTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/whatsapp-consent", () => ({
  readHostedWhatsAppMessagingConsentGrantedTx:
    mocks.readHostedWhatsAppMessagingConsentGrantedTx,
}));

import {
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  claimHostedUsageNoticeProviderEntry,
} from "@/src/lib/hosted-execution/usage-notice-provider-entry";

const ATTEMPTED_AT = new Date("2026-07-13T12:00:00.000Z");
const MEMBER_ID = "member-1";
const SOURCE_EVENT_ID = "source-event-1";

describe("hosted usage notice provider-entry authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(
      buildMailboxItem(),
    );
    mocks.readHostedMailboxPayload.mockResolvedValue(null);
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: MEMBER_ID,
      suspendedAt: null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.markHostedAiUsageDeniedResponseDispatchStartedTx.mockResolvedValue(true);
    mocks.readHostedWhatsAppMessagingConsentGrantedTx.mockResolvedValue(true);
  });

  it("claims a direct email send only after current member authority is locked", async () => {
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(
      buildDirectEmailWake(),
    );
    const { prisma, tx } = createPrisma();

    await expect(claimHostedUsageNoticeProviderEntry({
      attemptedAt: ATTEMPTED_AT,
      authority: {
        channel: "email",
        target: "thread_email_runtime_denied",
        targetKind: "thread",
      },
      idempotencyKey: "usage-response-key",
      memberId: MEMBER_ID,
      prisma,
      sourceEventId: SOURCE_EVENT_ID,
    })).resolves.toBe("claimed");

    expect(tx.$queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("hosted_member")]),
      MEMBER_ID,
    );
    expect(mocks.markHostedAiUsageDeniedResponseDispatchStartedTx)
      .toHaveBeenCalledWith({
        expectedAttemptedAt: ATTEMPTED_AT,
        idempotencyKey: "usage-response-key",
        prisma: tx,
      });
  });

  it("fails closed when suspension replaces the authority of the accepted wake", async () => {
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(
      buildDirectEmailWake(),
    );
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: MEMBER_ID,
      suspendedAt: new Date("2026-07-13T12:00:01.000Z"),
      updatedAt: new Date("2026-07-13T12:00:01.000Z"),
    });
    const { prisma } = createPrisma();

    await expect(claimHostedUsageNoticeProviderEntry({
      attemptedAt: ATTEMPTED_AT,
      authority: {
        channel: "email",
        target: "thread_email_runtime_denied",
        targetKind: "thread",
      },
      idempotencyKey: "usage-response-key",
      memberId: MEMBER_ID,
      prisma,
      sourceEventId: SOURCE_EVENT_ID,
    })).resolves.toBe("authority_superseded");

    expect(mocks.markHostedAiUsageDeniedResponseDispatchStartedTx)
      .not.toHaveBeenCalled();
  });

  it("fails closed when WhatsApp STOP wins before the provider fence", async () => {
    const target = "+15555550100";
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(
      buildWhatsAppWake(target),
    );
    mocks.readHostedWhatsAppMessagingConsentGrantedTx.mockResolvedValueOnce(false);
    const phoneLookupKey = createHostedPhoneLookupKeyReadCandidates(target)[0];
    const { prisma } = createPrisma((sql) =>
      sql.includes("FROM hosted_member_identity")
        ? [{
            phoneLookupKey,
            phoneNumberVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
          }]
        : []
    );

    await expect(claimHostedUsageNoticeProviderEntry({
      attemptedAt: ATTEMPTED_AT,
      authority: { channel: "whatsapp", target },
      idempotencyKey: "usage-response-key",
      memberId: MEMBER_ID,
      prisma,
      sourceEventId: SOURCE_EVENT_ID,
    })).resolves.toBe("authority_superseded");

    expect(mocks.readHostedWhatsAppMessagingConsentGrantedTx).toHaveBeenCalled();
    expect(mocks.markHostedAiUsageDeniedResponseDispatchStartedTx)
      .not.toHaveBeenCalled();
  });

  it("fails closed when Telegram routing moves before the provider fence", async () => {
    const target = "telegram-thread-old";
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(
      buildTelegramWake(target),
    );
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      telegramThreadId: "telegram-thread-current",
    });
    const { prisma } = createPrisma((sql) =>
      sql.includes("FROM hosted_member_routing")
        ? [{ memberId: MEMBER_ID }]
        : []
    );

    await expect(claimHostedUsageNoticeProviderEntry({
      attemptedAt: ATTEMPTED_AT,
      authority: { channel: "telegram", target },
      idempotencyKey: "usage-response-key",
      memberId: MEMBER_ID,
      prisma,
      sourceEventId: SOURCE_EVENT_ID,
    })).resolves.toBe("authority_superseded");

    expect(mocks.markHostedAiUsageDeniedResponseDispatchStartedTx)
      .not.toHaveBeenCalled();
  });

  it("fences a group email to the still-authorized current sender only", async () => {
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(
      buildGroupEmailWake(),
    );
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      verifiedEmail: { address: "sender@example.test" },
    });
    const { prisma, tx } = createPrisma((sql) => {
      if (sql.includes("FROM hosted_group\n")) {
        return [{ id: "group-1" }];
      }
      if (sql.includes("FROM hosted_group_member")) {
        return [{ id: "group-member-1" }];
      }
      if (sql.includes("FROM hosted_vault_share")) {
        return [{ id: "share-1" }];
      }
      return [];
    });

    await expect(claimHostedUsageNoticeProviderEntry({
      attemptedAt: ATTEMPTED_AT,
      authority: {
        channel: "email",
        target: "sender@example.test",
        targetKind: "explicit",
      },
      idempotencyKey: "usage-response-key",
      memberId: MEMBER_ID,
      prisma,
      sourceEventId: SOURCE_EVENT_ID,
    })).resolves.toBe("claimed");

    expect(mocks.readHostedMemberEmailAuthorization).toHaveBeenCalledWith({
      memberId: "member-sender",
      prisma: expect.any(Object),
    });
    expect(tx.$queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining("hosted_account_group_membership"),
      ]),
      "member-sender",
    );
    expect(mocks.markHostedAiUsageDeniedResponseDispatchStartedTx)
      .toHaveBeenCalledOnce();
  });
});

function createPrisma(
  resolveQuery: (sql: string) => unknown = () => [],
): {
  prisma: Parameters<typeof claimHostedUsageNoticeProviderEntry>[0]["prisma"];
  tx: {
    $queryRaw: ReturnType<typeof vi.fn>;
  };
} {
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      resolveQuery(strings.join("?"))
    ),
  };
  const prisma = createPrismaClient({
    databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
  });
  Object.defineProperty(prisma, "$transaction", {
    configurable: true,
    value: vi.fn(async (
      operation: (candidate: typeof tx) => Promise<unknown>,
    ) => operation(tx)),
  });
  return {
    prisma,
    tx,
  };
}

function buildMailboxItem() {
  return {
    consumedAt: null,
    createdAt: "2026-07-13T12:00:00.000Z",
    dedupeKey: SOURCE_EVENT_ID,
    expiresAt: null,
    id: "mailbox-item-1",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: "2026-07-13T12:00:00.000Z",
    payloadBytes: 100,
    payloadInlineCiphertext: "encrypted",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item-payload.v1",
    updatedAt: "2026-07-13T12:00:00.000Z",
    userId: MEMBER_ID,
  };
}

function buildDirectEmailWake() {
  return {
    eventId: SOURCE_EVENT_ID,
    kind: "conversation.message",
    message: {
      channel: "email",
      identityId: "identity-1",
      rawMessageKey: "raw-1",
      threadTarget: "thread_email_runtime_denied",
    },
    occurredAt: "2026-07-13T12:00:00.000Z",
    userId: MEMBER_ID,
  };
}

function buildWhatsAppWake(target: string) {
  return {
    eventId: SOURCE_EVENT_ID,
    kind: "conversation.message",
    message: {
      channel: "whatsapp",
      whatsappMessage: {
        fromWaId: target,
        messageId: "whatsapp-message-1",
        schema: "murph.hosted-whatsapp-message.v1",
        text: "hello",
        threadId: target,
      },
    },
    occurredAt: "2026-07-13T12:00:00.000Z",
    userId: MEMBER_ID,
  };
}

function buildTelegramWake(target: string) {
  return {
    eventId: SOURCE_EVENT_ID,
    kind: "conversation.message",
    message: {
      channel: "telegram",
      telegramMessage: {
        messageId: "telegram-message-1",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: target,
      },
    },
    occurredAt: "2026-07-13T12:00:00.000Z",
    userId: MEMBER_ID,
  };
}

function buildGroupEmailWake() {
  return {
    eventId: SOURCE_EVENT_ID,
    kind: "conversation.message",
    message: {
      actorMemberId: "member-sender",
      channel: "email",
      identityId: null,
      rawMessageKey: "raw-group-1",
      threadTarget: serializeHostedEmailThreadTarget(
        createHostedEmailThreadTarget({
          groupId: "group-1",
          lastMessageId: "email-message-1",
          subject: "Group check-in",
          targetKind: "group",
        }),
      ),
    },
    occurredAt: "2026-07-13T12:00:00.000Z",
    userId: MEMBER_ID,
  };
}
