import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";

import { createPrismaClient } from "@/src/lib/prisma";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  hasActiveHostedCryptoDomainRootsForUserTx: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  hasActiveHostedCryptoDomainRootsForUserTx:
    mocks.hasActiveHostedCryptoDomainRootsForUserTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  readHostedMemberIdentity: mocks.readHostedMemberIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

import {
  appendHostedGroupJoinConfirmationTx,
  materializePendingHostedGroupJoinConfirmationsTx,
} from "@/src/lib/hosted-groups/group-join-confirmation";

describe("appendHostedGroupJoinConfirmationTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: {
        id: "mailbox_item_join_confirmation_1",
        userId: "member_joiner",
      },
    });
    mocks.hasActiveHostedCryptoDomainRootsForUserTx.mockResolvedValue(true);
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      verifiedEmail: {
        lookupKey: "verified_email_lookup_1",
      },
    });
    mocks.readHostedMemberIdentity.mockResolvedValue({
      phoneLookupKey: null,
      phoneNumber: null,
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "private_chat_1",
      linqParticipantContact: {
        kind: "email",
        lookupKey: "verified_email_lookup_1",
      },
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://murph.example");
  });

  it("appends one exact private confirmation with a stable key and full edit link", async () => {
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });
    const occurredAt = new Date("2026-07-10T14:00:00.000Z");

    await expect(appendHostedGroupJoinConfirmationTx({
      joinCode: "JOIN / 1",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt,
      publicBaseUrl: "https://murph.example/",
      tx,
    })).resolves.toEqual({
      mailboxItemId: "mailbox_item_join_confirmation_1",
      memberId: "member_joiner",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "assistant.notification.requested:group-join:membership_1",
        kind: "assistant.notification.requested",
        notification: expect.objectContaining({
          deliveryDedupeToken: "group-join:membership_1",
          deliveryDispatchMode: "queue-only",
          deliveryIdempotencyKey: "group-join:membership_1",
          instructions: "Private group-join check-in; exact user-facing text is in responsePolicy.",
          responsePolicy: {
            kind: "require_send_exact_text",
            text: [
              "Hey — you just joined a Murph group. Did you mean to? Reply yes or no.",
              "You can review or change what you share here: https://murph.example/groups/join/JOIN%20%2F%201",
            ].join("\n\n"),
          },
          route: expect.objectContaining({
            channel: "linq",
            delivery: {
              kind: "thread",
              target: "private_chat_1",
            },
            threadIsDirect: true,
          }),
        }),
        occurredAt: occurredAt.toISOString(),
        userId: "member_joiner",
      }),
      tx,
    });
  });

  it("does not guess a legacy home thread identity from a later member phone", async () => {
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.readHostedMemberIdentity.mockResolvedValue({
      phoneLookupKey: "home_phone_lookup_1",
      phoneNumber: "+15550100001",
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "private_chat_home_1",
      linqRecipientPhone: "+15550100002",
      pendingLinqChatId: "private_chat_pending_1",
      pendingLinqParticipantContact: {
        kind: "phone",
        lookupKey: "stale_pending_lookup_1",
        value: "+15550100003",
      },
      telegramThreadId: "telegram_private_thread_1",
      telegramUserId: "telegram_user_1",
    });
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });
    await appendHostedGroupJoinConfirmationTx({
      joinCode: "JOIN1",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        notification: expect.objectContaining({
          route: expect.objectContaining({
            channel: "telegram",
            delivery: {
              kind: "thread",
              target: "telegram_private_thread_1",
            },
          }),
        }),
      }),
      tx,
    });
  });

  it("keeps a home Linq thread on its persisted email identity after a phone is added", async () => {
    mocks.readHostedMemberIdentity.mockResolvedValue({
      phoneLookupKey: "later_phone_lookup_1",
      phoneNumber: "+15550100001",
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "private_chat_email_home_1",
      linqParticipantContact: {
        kind: "email",
        lookupKey: "home_email_lookup_1",
      },
      linqRecipientPhone: "+15550100002",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "home_email_lookup_1",
      userId: "member_joiner",
    });

    await appendHostedGroupJoinConfirmationTx({
      joinCode: "JOIN1",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        notification: expect.objectContaining({
          route: expect.objectContaining({
            identityId: hashHostedAssistantConversationIdentifier(
              identifierBlind,
              "home_email_lookup_1",
            ),
            threadId: hashHostedAssistantConversationIdentifier(
              identifierBlind,
              "private_chat_email_home_1",
            ),
          }),
        }),
      }),
      tx,
    });
  });

  it("keeps a pending Linq thread on its pending participant identity", async () => {
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.readHostedMemberIdentity.mockResolvedValue(null);
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: "+15550100002",
      pendingLinqChatId: "private_chat_pending_1",
      pendingLinqParticipantContact: {
        kind: "email",
        lookupKey: "pending_email_lookup_1",
        value: "member@example.test",
      },
      telegramThreadId: null,
      telegramUserId: null,
    });
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "pending_email_lookup_1",
      userId: "member_joiner",
    });

    await appendHostedGroupJoinConfirmationTx({
      joinCode: "JOIN1",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        notification: expect.objectContaining({
          route: expect.objectContaining({
            channel: "linq",
            delivery: {
              kind: "thread",
              target: "private_chat_pending_1",
            },
            identityId: hashHostedAssistantConversationIdentifier(
              identifierBlind,
              "pending_email_lookup_1",
            ),
            threadId: hashHostedAssistantConversationIdentifier(
              identifierBlind,
              "private_chat_pending_1",
            ),
            threadIsDirect: true,
          }),
        }),
      }),
      tx,
    });
  });

  it("does not guess a legacy pending thread identity from the current member phone", async () => {
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.readHostedMemberIdentity.mockResolvedValue({
      phoneLookupKey: "member_phone_lookup_1",
      phoneNumber: "+15550100001",
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: "+15550100002",
      pendingLinqChatId: "private_chat_pending_phone_1",
      pendingLinqParticipantContact: null,
      telegramThreadId: "telegram_private_thread_1",
      telegramUserId: "telegram_user_1",
    });
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });

    await appendHostedGroupJoinConfirmationTx({
      joinCode: "JOIN1",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        notification: expect.objectContaining({
          route: expect.objectContaining({
            channel: "telegram",
            delivery: {
              kind: "thread",
              target: "telegram_private_thread_1",
            },
          }),
        }),
      }),
      tx,
    });
  });

  it("falls back from a home Linq thread when only stale pending identity remains", async () => {
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.readHostedMemberIdentity.mockResolvedValue(null);
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "private_chat_home_1",
      linqRecipientPhone: "+15550100002",
      pendingLinqChatId: "private_chat_pending_1",
      pendingLinqParticipantContact: {
        kind: "phone",
        lookupKey: "stale_pending_lookup_1",
        value: "+15550100003",
      },
      telegramThreadId: "telegram_private_thread_1",
      telegramUserId: "telegram_user_1",
    });
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });

    await appendHostedGroupJoinConfirmationTx({
      joinCode: "JOIN1",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        notification: expect.objectContaining({
          route: expect.objectContaining({
            channel: "telegram",
            delivery: {
              kind: "thread",
              target: "telegram_private_thread_1",
            },
            threadIsDirect: true,
          }),
        }),
      }),
      tx,
    });
  });

  it("does not turn a phone assignment into a participant-target first contact", async () => {
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.readHostedMemberIdentity.mockResolvedValue({
      phoneLookupKey: "phone_lookup_1",
      phoneNumber: "+15550100001",
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: "+15550100002",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });

    await expect(appendHostedGroupJoinConfirmationTx({
      joinCode: "JOIN1",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    })).resolves.toBeNull();

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("falls back to an existing private Telegram thread", async () => {
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.readHostedMemberIdentity.mockResolvedValue(null);
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      telegramThreadId: "telegram_private_thread_1",
      telegramUserId: "telegram_user_1",
    });
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });

    await expect(appendHostedGroupJoinConfirmationTx({
      joinCode: "JOIN1",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    })).resolves.toEqual({
      mailboxItemId: "mailbox_item_join_confirmation_1",
      memberId: "member_joiner",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        notification: expect.objectContaining({
          route: expect.objectContaining({
            channel: "telegram",
            delivery: {
              kind: "thread",
              target: "telegram_private_thread_1",
            },
            threadIsDirect: true,
          }),
        }),
      }),
      tx,
    });
  });

  it("skips confirmation construction when no canonical public URL is configured", async () => {
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });

    await expect(appendHostedGroupJoinConfirmationTx({
      joinCode: "JOIN1",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: null,
      tx,
    })).resolves.toBeNull();

    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberIdentity).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("defers confirmation until activation provisions all crypto roots", async () => {
    mocks.hasActiveHostedCryptoDomainRootsForUserTx.mockResolvedValue(false);
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });

    await expect(appendHostedGroupJoinConfirmationTx({
      joinCode: "JOIN1",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    })).resolves.toBeNull();

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("materializes a deferred confirmation from the durable membership after activation", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        createdAt: new Date("2026-07-10T14:00:00.000Z"),
        group: { joinCode: "JOIN1" },
        id: "membership_1",
        joinedAt: new Date("2026-07-10T14:01:00.000Z"),
      },
    ]);
    const tx = {
      hostedGroupMember: { findMany },
    } as never;

    await materializePendingHostedGroupJoinConfirmationsTx({
      memberId: "member_joiner",
      tx,
    });

    expect(findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "asc" },
      select: {
        createdAt: true,
        group: { select: { joinCode: true } },
        id: true,
        joinedAt: true,
      },
      where: {
        joinConfirmationEligibleAt: { not: null },
        memberId: "member_joiner",
        role: "member",
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "assistant.notification.requested:group-join:membership_1",
        occurredAt: "2026-07-10T14:01:00.000Z",
      }),
      tx,
    });
  });
});
