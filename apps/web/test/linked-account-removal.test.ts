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
      }),
    });
  });

  it("revokes verified email authority, its Linq route, and its reply alias", async () => {
    const prisma = makePrisma({
      authorization: makeEmailAuthorization(),
      routing: {
        ...makeLinqRouting({
          participantContactKind: "email",
          participantContactLookupKey: "email-key",
        }),
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
      data: expect.objectContaining({
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqHomeLineAssignedAt: null,
        linqParticipantContactKind: null,
        linqParticipantContactLookupKey: null,
        linqRecipientPhoneEncrypted: null,
        linqRecipientPhoneLookupKey: null,
        replyAliasGeneration: 5,
        replyAliasLookupKey: null,
      }),
    });
  });

  it("clears an email-owned pending Linq route without touching the phone-owned home route", async () => {
    const prisma = makePrisma({
      authorization: makeEmailAuthorization(),
      routing: makeLinqRouting({
        participantContactKind: "phone",
        participantContactLookupKey: "phone-key",
        pendingParticipantContactKind: "email",
        pendingParticipantContactLookupKey: "email-key",
      }),
    });

    await expect(removeHostedMemberLinkedAccountProjectionTx({
      expectedIdentity: "member@example.com",
      memberId: "member_123",
      method: "email",
      prisma,
    })).resolves.toBe(true);

    expect(prisma.hostedMemberRouting.update).toHaveBeenCalledWith({
      where: { memberId: "member_123" },
      data: {
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
      },
    });
  });

  it("preserves an email-owned Linq route when removing phone sign-in", async () => {
    const prisma = makePrisma({
      identity: {
        phoneLookupKey: "phone-key",
        phoneNumberEncrypted: "encrypted-phone",
      },
      routing: makeLinqRouting({
        participantContactKind: "email",
        participantContactLookupKey: "email-key",
      }),
    });

    await expect(removeHostedMemberLinkedAccountProjectionTx({
      expectedIdentity: "+14045550123",
      memberId: "member_123",
      method: "phone",
      prisma,
    })).resolves.toBe(true);

    expect(prisma.hostedMemberIdentity.update).toHaveBeenCalledOnce();
    expect(prisma.hostedMemberRouting.update).not.toHaveBeenCalled();
  });

  it.each(["other-phone-key", null])(
    "preserves an explicit phone route without exact ownership (%s)",
    async (participantContactLookupKey) => {
      const prisma = makePrisma({
        identity: {
          phoneLookupKey: "phone-key",
          phoneNumberEncrypted: "encrypted-phone",
        },
        routing: makeLinqRouting({
          participantContactKind: "phone",
          participantContactLookupKey,
        }),
      });

      await expect(removeHostedMemberLinkedAccountProjectionTx({
        expectedIdentity: "+14045550123",
        memberId: "member_123",
        method: "phone",
        prisma,
      })).resolves.toBe(true);

      expect(prisma.hostedMemberRouting.update).not.toHaveBeenCalled();
    },
  );

  it("clears a legacy phone route without a participant kind", async () => {
    const prisma = makePrisma({
      identity: {
        phoneLookupKey: "phone-key",
        phoneNumberEncrypted: "encrypted-phone",
      },
      routing: makeLinqRouting({
        participantContactKind: null,
        participantContactLookupKey: null,
      }),
    });

    await expect(removeHostedMemberLinkedAccountProjectionTx({
      expectedIdentity: "+14045550123",
      memberId: "member_123",
      method: "phone",
      prisma,
    })).resolves.toBe(true);

    expect(prisma.hostedMemberRouting.update).toHaveBeenCalledWith({
      where: { memberId: "member_123" },
      data: expect.objectContaining({
        linqChatIdEncrypted: null,
        linqHomeLineAssignedAt: null,
        linqRecipientPhoneEncrypted: null,
      }),
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

function makeEmailAuthorization(): Record<string, unknown> {
  return {
    directPublicSenderAddressEncrypted: "encrypted-sender",
    directPublicSenderAuthorizedAt: new Date("2026-05-02T00:00:00.000Z"),
    directPublicSenderLookupKey: "email-key",
    verifiedEmailAddressEncrypted: "encrypted-email",
    verifiedEmailLookupKey: "email-key",
    verifiedEmailVerifiedAt: new Date("2026-05-02T00:00:00.000Z"),
  };
}

function makeLinqRouting(input: {
  participantContactKind?: "email" | "phone" | null;
  participantContactLookupKey?: string | null;
  pendingParticipantContactKind?: "email" | "phone" | null;
  pendingParticipantContactLookupKey?: string | null;
} = {}): Record<string, unknown> {
  const hasPendingRoute = input.pendingParticipantContactKind !== undefined
    || input.pendingParticipantContactLookupKey !== undefined;

  return {
    linqChatIdEncrypted: "encrypted-chat",
    linqChatLookupKey: "chat-key",
    linqHomeLineAssignedAt: new Date("2026-05-02T00:00:00.000Z"),
    linqParticipantContactKind:
      input.participantContactKind === undefined
        ? "phone"
        : input.participantContactKind,
    linqParticipantContactLookupKey:
      input.participantContactLookupKey === undefined
        ? "phone-key"
        : input.participantContactLookupKey,
    linqRecipientPhoneEncrypted: "encrypted-recipient",
    linqRecipientPhoneLookupKey: "recipient-key",
    pendingLinqChatIdEncrypted: hasPendingRoute ? "encrypted-pending-chat" : null,
    pendingLinqChatLookupKey: hasPendingRoute ? "pending-chat-key" : null,
    pendingLinqParticipantContactEncrypted:
      hasPendingRoute ? "encrypted-pending-participant" : null,
    pendingLinqParticipantContactKind:
      input.pendingParticipantContactKind ?? null,
    pendingLinqParticipantContactLookupKey:
      input.pendingParticipantContactLookupKey ?? null,
    pendingLinqParticipantContactObservedAt:
      hasPendingRoute ? new Date("2026-05-03T00:00:00.000Z") : null,
    pendingLinqRecipientPhoneEncrypted:
      hasPendingRoute ? "encrypted-pending-recipient" : null,
    pendingLinqRecipientPhoneLookupKey:
      hasPendingRoute ? "pending-recipient-key" : null,
    replyAliasGeneration: 0,
    replyAliasLookupKey: null,
  };
}
