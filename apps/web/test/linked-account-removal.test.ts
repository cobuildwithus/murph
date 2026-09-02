import { type Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { removeHostedMemberLinkedAccountProjectionTx } from "../src/lib/hosted-onboarding/linked-account-removal";

const mocks = vi.hoisted(() => ({
  lockHostedMemberRow: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedEmailLookupKeyReadCandidates: () => ["email-key"],
  createHostedPhoneLookupKeyReadCandidates: () => ["phone-key"],
  createHostedTelegramUserLookupKeyReadCandidates: () => ["telegram-key"],
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  lockHostedMemberRow: mocks.lockHostedMemberRow,
}));

describe("linked account projection removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
  });

  it("clears phone identity and Linq routing while preserving other identity fields", async () => {
    const prisma = makePrisma({
      identity: {
        maskedPhoneNumberHint: "*** 0123",
        phoneLookupKey: "phone-key",
        phoneNumberEncrypted: "encrypted-phone",
        phoneNumberVerifiedAt: new Date("2026-05-02T00:00:00.000Z"),
        signupPhoneCodeSendAttemptId: "attempt_123",
        signupPhoneCodeSendAttemptStartedAt: new Date("2026-05-02T00:00:00.000Z"),
        signupPhoneCodeSentAt: new Date("2026-05-02T00:00:00.000Z"),
        signupPhoneNumberEncrypted: "encrypted-signup-phone",
      },
      routing: makeLinqRouting(),
    });

    await expect(removeHostedMemberLinkedAccountProjectionTx({
      expectedIdentity: "+14045550123",
      memberId: "member_123",
      method: "phone",
      prisma,
    })).resolves.toBe(true);

    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(prisma, "member_123");
    expect(prisma.hostedMemberIdentity.update).toHaveBeenCalledWith({
      where: { memberId: "member_123" },
      data: {
        maskedPhoneNumberHint: null,
        phoneLookupKey: null,
        phoneNumberEncrypted: null,
        phoneNumberVerifiedAt: null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: null,
      },
    });
    expect(prisma.hostedMemberRouting.update).toHaveBeenCalledWith({
      where: { memberId: "member_123" },
      data: expect.objectContaining({
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqHomeLineAssignedAt: null,
        linqParticipantContactLookupKey: null,
        linqRecipientPhoneEncrypted: null,
        pendingLinqChatIdEncrypted: null,
        pendingLinqParticipantContactLookupKey: null,
      }),
    });
  });

  it("revokes verified email authority and rotates the reply alias without touching billing email", async () => {
    const prisma = makePrisma({
      authorization: {
        directPublicSenderAddressEncrypted: "encrypted-sender",
        directPublicSenderAuthorizedAt: new Date("2026-05-02T00:00:00.000Z"),
        directPublicSenderLookupKey: "email-key",
        verifiedEmailAddressEncrypted: "encrypted-email",
        verifiedEmailLookupKey: "email-key",
        verifiedEmailVerifiedAt: new Date("2026-05-02T00:00:00.000Z"),
      },
      routing: {
        replyAliasGeneration: 4,
        replyAliasLookupKey: "reply-key",
      },
    });

    await expect(removeHostedMemberLinkedAccountProjectionTx({
      expectedIdentity: "member@example.com",
      memberId: "member_123",
      method: "email",
      prisma,
    })).resolves.toBe(true);

    expect(prisma.hostedMemberEmailAuthorization.update).toHaveBeenCalledWith({
      where: { memberId: "member_123" },
      data: {
        directPublicSenderAddressEncrypted: null,
        directPublicSenderAuthorizedAt: null,
        directPublicSenderLookupKey: null,
        verifiedEmailAddressEncrypted: null,
        verifiedEmailLookupKey: null,
        verifiedEmailVerifiedAt: null,
      },
    });
    expect(prisma.hostedMemberRouting.update).toHaveBeenCalledWith({
      where: { memberId: "member_123" },
      data: {
        replyAliasGeneration: 5,
        replyAliasLookupKey: null,
      },
    });
  });

  it("clears only the Telegram routing slice", async () => {
    const prisma = makePrisma({
      routing: {
        telegramUserIdEncrypted: "encrypted-telegram",
        telegramUserLookupKey: "telegram-key",
      },
    });

    await expect(removeHostedMemberLinkedAccountProjectionTx({
      expectedIdentity: "456",
      memberId: "member_123",
      method: "telegram",
      prisma,
    })).resolves.toBe(true);

    expect(prisma.hostedMemberRouting.update).toHaveBeenCalledWith({
      where: { memberId: "member_123" },
      data: {
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      },
    });
    expect(prisma.hostedMemberIdentity.update).not.toHaveBeenCalled();
    expect(prisma.hostedMemberEmailAuthorization.update).not.toHaveBeenCalled();
  });

  it("refuses to erase a canonical identity changed by a raced replacement", async () => {
    const prisma = makePrisma({
      routing: {
        telegramUserIdEncrypted: "encrypted-telegram",
        telegramUserLookupKey: "different-telegram-key",
      },
    });

    await expect(removeHostedMemberLinkedAccountProjectionTx({
      expectedIdentity: "456",
      memberId: "member_123",
      method: "telegram",
      prisma,
    })).rejects.toMatchObject({
      code: "LINKED_ACCOUNT_CHANGED",
    });
    expect(prisma.hostedMemberRouting.update).not.toHaveBeenCalled();
  });

  it("treats already-cleared projections as an idempotent no-op", async () => {
    const prisma = makePrisma({});

    await expect(removeHostedMemberLinkedAccountProjectionTx({
      expectedIdentity: "456",
      memberId: "member_123",
      method: "telegram",
      prisma,
    })).resolves.toBe(false);
    expect(prisma.hostedMemberRouting.update).not.toHaveBeenCalled();
  });
});

function makePrisma(input: {
  authorization?: Record<string, unknown> | null;
  identity?: Record<string, unknown> | null;
  routing?: Record<string, unknown> | null;
}): Prisma.TransactionClient {
  const prisma = {} as Prisma.TransactionClient;

  return Object.assign(prisma, {
    hostedMemberEmailAuthorization: {
      findUnique: vi.fn().mockResolvedValue(input.authorization ?? null),
      update: vi.fn(),
    },
    hostedMemberIdentity: {
      findUnique: vi.fn().mockResolvedValue(input.identity ?? null),
      update: vi.fn(),
    },
    hostedMemberRouting: {
      findUnique: vi.fn().mockResolvedValue(input.routing ?? null),
      update: vi.fn(),
    },
  });
}

function makeLinqRouting(): Record<string, unknown> {
  return {
    linqChatIdEncrypted: "encrypted-chat",
    linqChatLookupKey: "chat-key",
    linqHomeLineAssignedAt: new Date("2026-05-02T00:00:00.000Z"),
    linqParticipantContactKind: "phone",
    linqParticipantContactLookupKey: "participant-key",
    linqRecipientPhoneEncrypted: "encrypted-recipient",
    linqRecipientPhoneLookupKey: "recipient-key",
    pendingLinqChatIdEncrypted: null,
    pendingLinqChatLookupKey: null,
    pendingLinqParticipantContactEncrypted: null,
    pendingLinqParticipantContactKind: null,
    pendingLinqParticipantContactLookupKey: null,
    pendingLinqParticipantContactObservedAt: null,
    pendingLinqRecipientPhoneEncrypted: null,
    pendingLinqRecipientPhoneLookupKey: null,
  };
}
