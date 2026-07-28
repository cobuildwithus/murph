import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";

import { createPrismaClient } from "@/src/lib/prisma";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  hasActiveHostedCryptoDomainRootsForUserTx: vi.fn(),
  readHostedMemberAssistantNotificationState: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
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
  readHostedMemberAssistantNotificationState:
    mocks.readHostedMemberAssistantNotificationState,
  readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import {
  appendHostedGroupJoinConfirmationTx,
  drainPendingHostedGroupJoinConfirmations,
  materializePendingHostedGroupJoinConfirmations,
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
    mocks.readHostedMemberAssistantNotificationState.mockImplementation(
      async () => ({
        identity: await mocks.readHostedMemberIdentity(),
        routing: await mocks.readHostedMemberRoutingState(),
      }),
    );
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://murph.example");
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
  });

  it("appends one exact private confirmation with a stable key and full edit link", async () => {
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });
    const occurredAt = new Date("2026-07-10T14:00:00.000Z");

    await expect(appendHostedGroupJoinConfirmationTx({
      groupDisplayName: "Weekend Runners",
      joinCode: "JOIN / 1",
      joinOrigin: "web",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt,
      publicBaseUrl: "https://murph.example/",
      tx,
    })).resolves.toEqual({
      kind: "appended",
      signal: {
        mailboxItemId: "mailbox_item_join_confirmation_1",
        memberId: "member_joiner",
      },
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "assistant.notification.requested:group-join:membership_1",
        kind: "assistant.notification.requested",
        notification: expect.objectContaining({
          deliveryDedupeToken: "group-join:membership_1",
          deliveryDispatchMode: "queue-only",
          deliveryIdempotencyKey: "group-join:membership_1",
          instructions: "Private group-join confirmation; exact user-facing text is in responsePolicy.",
          responsePolicy: {
            kind: "require_send_exact_text",
            text: [
              "You are now part of Weekend Runners.",
              "You can review or change what you are sharing anytime: https://murph.example/groups/join/JOIN%20%2F%201",
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

  it("renders a warm reaction variant with a sanitized group name", async () => {
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });

    await appendHostedGroupJoinConfirmationTx({
      groupDisplayName: "  Weekend\n\u202eRunners\u0000  ",
      joinCode: "JOIN1",
      joinOrigin: "group_chat_reaction",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    });

    const notification = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope
      .notification;
    expect(notification).toMatchObject({
      instructions: "Private group-join confirmation; exact user-facing text is in responsePolicy.",
      responsePolicy: {
        kind: "require_send_exact_text",
        text: [
          "Hey — you are in Weekend Runners after reacting to the group invitation.",
          "Here is what you are sharing with the group, in case you ever want to change it: https://murph.example/groups/join/JOIN1",
        ].join("\n\n"),
      },
    });
    expect(notification?.instructions).not.toContain("Weekend Runners");
  });

  it("uses neutral deterministic copy for a legacy unnamed join", async () => {
    const tx = createPrismaClient({
      databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
    });

    await appendHostedGroupJoinConfirmationTx({
      groupDisplayName: null,
      joinCode: "JOIN1",
      joinOrigin: null,
      memberId: "member_joiner",
      membershipId: "membership_legacy_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        notification: expect.objectContaining({
          responsePolicy: {
            kind: "require_send_exact_text",
            text: [
              "You are now part of your Murph group.",
              "You can review or change what you are sharing anytime: https://murph.example/groups/join/JOIN1",
            ].join("\n\n"),
          },
        }),
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
      groupDisplayName: "Weekend Runners",
      joinCode: "JOIN1",
      joinOrigin: "web",
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
      groupDisplayName: "Weekend Runners",
      joinCode: "JOIN1",
      joinOrigin: "web",
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
      groupDisplayName: "Weekend Runners",
      joinCode: "JOIN1",
      joinOrigin: "web",
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
      groupDisplayName: "Weekend Runners",
      joinCode: "JOIN1",
      joinOrigin: "web",
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
      groupDisplayName: "Weekend Runners",
      joinCode: "JOIN1",
      joinOrigin: "web",
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
      groupDisplayName: "Weekend Runners",
      joinCode: "JOIN1",
      joinOrigin: "web",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    })).resolves.toEqual({ kind: "deferred", reason: "private-route" });

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
      groupDisplayName: "Weekend Runners",
      joinCode: "JOIN1",
      joinOrigin: "web",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    })).resolves.toEqual({
      kind: "appended",
      signal: {
        mailboxItemId: "mailbox_item_join_confirmation_1",
        memberId: "member_joiner",
      },
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
      groupDisplayName: "Weekend Runners",
      joinCode: "JOIN1",
      joinOrigin: "web",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: null,
      tx,
    })).resolves.toEqual({ kind: "terminal-skip" });

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
      groupDisplayName: "Weekend Runners",
      joinCode: "JOIN1",
      joinOrigin: "web",
      memberId: "member_joiner",
      membershipId: "membership_1",
      occurredAt: new Date("2026-07-10T14:00:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    })).resolves.toEqual({ kind: "deferred", reason: "crypto-roots" });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("materializes a deferred confirmation from the durable membership after activation", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      createdAt: new Date("2026-07-10T14:00:00.000Z"),
      group: { displayName: "Weekend Runners", joinCode: "JOIN1" },
      id: "membership_1",
      joinConfirmationOrigin: "group_chat_reaction",
      joinedAt: new Date("2026-07-10T14:01:00.000Z"),
    });
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      hostedGroupMember: { findFirst, update },
    } as never;

    await expect(materializePendingHostedGroupJoinConfirmationsTx({
      memberId: "member_joiner",
      tx,
    })).resolves.toMatchObject({ kind: "appended" });

    expect(findFirst).toHaveBeenCalledWith({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        createdAt: true,
        group: { select: { displayName: true, joinCode: true } },
        id: true,
        joinConfirmationOrigin: true,
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
        notification: expect.objectContaining({
          responsePolicy: {
            kind: "require_send_exact_text",
            text: [
              "Hey — you are in Weekend Runners after reacting to the group invitation.",
              "Here is what you are sharing with the group, in case you ever want to change it: https://murph.example/groups/join/JOIN1",
            ].join("\n\n"),
          },
        }),
        occurredAt: "2026-07-10T14:01:00.000Z",
      }),
      tx,
    });
    expect(update).toHaveBeenCalledWith({
      data: {
        joinConfirmationEligibleAt: null,
        joinConfirmationOrigin: null,
      },
      where: { id: "membership_1" },
    });
  });

  it("consumes deferred eligibility when no canonical origin remains", async () => {
    mocks.resolveHostedPublicBaseUrl.mockReturnValue(null);
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      hostedGroupMember: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-07-10T14:00:00.000Z"),
          group: { joinCode: "JOIN1" },
          id: "membership_1",
          joinedAt: null,
        }),
        update,
      },
    } as never;

    await materializePendingHostedGroupJoinConfirmationsTx({
      memberId: "member_joiner",
      tx,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      data: {
        joinConfirmationEligibleAt: null,
        joinConfirmationOrigin: null,
      },
      where: { id: "membership_1" },
    });
  });

  it("consumes deferred eligibility when the group no longer has a join code", async () => {
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      hostedGroupMember: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-07-10T14:00:00.000Z"),
          group: { joinCode: null },
          id: "membership_1",
          joinedAt: null,
        }),
        update,
      },
    } as never;

    await materializePendingHostedGroupJoinConfirmationsTx({
      memberId: "member_joiner",
      tx,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      data: {
        joinConfirmationEligibleAt: null,
        joinConfirmationOrigin: null,
      },
      where: { id: "membership_1" },
    });
  });

  it("materializes one legacy confirmation after observed private authority arrives", async () => {
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.readHostedMemberIdentity.mockResolvedValue({
      phoneLookupKey: "later_phone_lookup_1",
      phoneNumber: "+15550100001",
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);
    const findFirst = vi.fn()
      .mockResolvedValueOnce({
        createdAt: new Date("2026-07-10T14:00:00.000Z"),
        group: { joinCode: "JOIN1" },
        id: "membership_legacy_1",
        joinedAt: new Date("2026-07-10T14:01:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      hostedGroupMember: { findFirst, update },
    } as never;

    await expect(appendHostedGroupJoinConfirmationTx({
      groupDisplayName: null,
      joinCode: "JOIN1",
      joinOrigin: null,
      memberId: "member_joiner",
      membershipId: "membership_legacy_1",
      occurredAt: new Date("2026-07-10T14:01:00.000Z"),
      publicBaseUrl: "https://murph.example",
      tx,
    })).resolves.toEqual({ kind: "deferred", reason: "private-route" });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();

    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "private_chat_observed_1",
      linqParticipantContact: {
        kind: "email",
        lookupKey: "observed_email_lookup_1",
      },
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "observed_email_lookup_1",
      userId: "member_joiner",
    });

    await materializePendingHostedGroupJoinConfirmationsTx({
      memberId: "member_joiner",
      tx,
    });
    await materializePendingHostedGroupJoinConfirmationsTx({
      memberId: "member_joiner",
      tx,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "assistant.notification.requested:group-join:membership_legacy_1",
        notification: expect.objectContaining({
          route: expect.objectContaining({
            delivery: {
              kind: "thread",
              target: "private_chat_observed_1",
            },
            identityId: hashHostedAssistantConversationIdentifier(
              identifierBlind,
              "observed_email_lookup_1",
            ),
          }),
        }),
      }),
      tx,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      data: {
        joinConfirmationEligibleAt: null,
        joinConfirmationOrigin: null,
      },
      where: { id: "membership_legacy_1" },
    });
  });

  it("retains the persisted origin while deferred and uses it on a private-route retry", async () => {
    mocks.readHostedMemberIdentity.mockResolvedValue(null);
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      hostedGroupMember: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-07-10T14:00:00.000Z"),
          group: { displayName: "Weekend Runners", joinCode: "JOIN1" },
          id: "membership_1",
          joinConfirmationOrigin: "group_chat_reaction",
          joinedAt: null,
        }),
        update,
      },
    } as never;

    await materializePendingHostedGroupJoinConfirmationsTx({
      memberId: "member_joiner",
      tx,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "private_chat_retry_1",
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

    await materializePendingHostedGroupJoinConfirmationsTx({
      memberId: "member_joiner",
      tx,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "assistant.notification.requested:group-join:membership_1",
        notification: expect.objectContaining({
          responsePolicy: {
            kind: "require_send_exact_text",
            text: [
              "Hey — you are in Weekend Runners after reacting to the group invitation.",
              "Here is what you are sharing with the group, in case you ever want to change it: https://murph.example/groups/join/JOIN1",
            ].join("\n\n"),
          },
        }),
      }),
      tx,
    });
    expect(update).toHaveBeenCalledWith({
      data: {
        joinConfirmationEligibleAt: null,
        joinConfirmationOrigin: null,
      },
      where: { id: "membership_1" },
    });
  });

  it("leaves deferred eligibility intact when mailbox append throws", async () => {
    const appendError = new Error("mailbox append failed");
    mocks.appendHostedMailboxEnvelopeTx.mockRejectedValueOnce(appendError);
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      hostedGroupMember: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-07-10T14:00:00.000Z"),
          group: { joinCode: "JOIN1" },
          id: "membership_1",
          joinedAt: null,
        }),
        update,
      },
    } as never;

    await expect(materializePendingHostedGroupJoinConfirmationsTx({
      memberId: "member_joiner",
      tx,
    })).rejects.toBe(appendError);

    expect(update).not.toHaveBeenCalled();
  });

  it("materializes one targeted membership after commit and signals its durable mailbox item", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      createdAt: new Date("2026-07-10T14:00:00.000Z"),
      group: { joinCode: "JOIN1" },
      id: "membership_target",
      joinedAt: null,
    });
    const tx = {
      hostedGroupMember: {
        findFirst,
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx)),
    } as never;

    await expect(materializePendingHostedGroupJoinConfirmations({
      memberId: "member_joiner",
      membershipId: "membership_target",
      prisma,
    })).resolves.toMatchObject({ kind: "appended" });

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "membership_target",
        memberId: "member_joiner",
      }),
    }));
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_joiner",
      mailboxItemId: "mailbox_item_join_confirmation_1",
      prisma,
    });
  });

  it("bounds a materializer signal that never settles", async () => {
    vi.useFakeTimers();
    try {
      const tx = {
        hostedGroupMember: {
          findFirst: vi.fn().mockResolvedValue({
            createdAt: new Date("2026-07-10T14:00:00.000Z"),
            group: { joinCode: "JOIN1" },
            id: "membership_target",
            joinedAt: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      const prisma = {
        $transaction: vi.fn(async (callback: (input: typeof tx) => Promise<unknown>) =>
          callback(tx)),
      } as never;
      mocks.signalHostedMailboxAppendRuntime.mockReturnValueOnce(new Promise(() => {}));

      const resultPromise = materializePendingHostedGroupJoinConfirmations({
        memberId: "member_joiner",
        membershipId: "membership_target",
        prisma,
        timeoutMs: 100,
      });
      await vi.advanceTimersByTimeAsync(100);

      await expect(resultPromise).resolves.toMatchObject({ kind: "appended" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting on abort after the durable confirmation append", async () => {
    const controller = new AbortController();
    const tx = {
      hostedGroupMember: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-07-10T14:00:00.000Z"),
          group: { joinCode: "JOIN1" },
          id: "membership_target",
          joinedAt: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx)),
    } as never;
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(() => {
      controller.abort();
      return new Promise(() => {});
    });

    await expect(materializePendingHostedGroupJoinConfirmations({
      memberId: "member_joiner",
      membershipId: "membership_target",
      prisma,
      signal: controller.signal,
    })).resolves.toMatchObject({ kind: "appended" });
  });

  it("drains a bounded page and returns a cursor without one large transaction", async () => {
    const candidates = [
      { id: "membership_1", memberId: "member_1" },
      { id: "membership_2", memberId: "member_2" },
      { id: "membership_3", memberId: "member_3" },
    ];
    const findMany = vi.fn().mockResolvedValue(candidates);
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      hostedGroupMember: {
        findFirst: vi.fn(async (args: { where: { id?: string } }) => ({
          createdAt: new Date("2026-07-10T14:00:00.000Z"),
          group: { joinCode: "JOIN1" },
          id: args.where.id,
          joinedAt: null,
        })),
        update,
      },
    };
    const transaction = vi.fn(async (
      callback: (input: typeof tx) => Promise<unknown>,
    ) => callback(tx));
    const prisma = {
      $transaction: transaction,
      hostedGroupMember: { findMany },
    } as never;

    await expect(drainPendingHostedGroupJoinConfirmations({
      limit: 2,
      prisma,
    })).resolves.toEqual({
      appended: 2,
      deferred: 0,
      nextCursor: "membership_2",
      scanned: 2,
      terminalSkipped: 0,
    });

    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, memberId: true },
      take: 3,
      where: {
        joinConfirmationEligibleAt: { not: null },
        role: "member",
      },
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("continues a drain cursor deterministically when candidates share createdAt", async () => {
    const createdAt = new Date("2026-07-10T14:00:00.000Z");
    const candidates = [
      { createdAt, id: "membership_1", memberId: "member_1" },
      { createdAt, id: "membership_2", memberId: "member_2" },
      { createdAt, id: "membership_3", memberId: "member_3" },
    ];
    const findMany = vi.fn(async (args: {
      cursor?: { id: string };
      take: number;
    }) => {
      const cursorIndex = args.cursor
        ? candidates.findIndex((candidate) => candidate.id === args.cursor?.id) + 1
        : 0;
      return candidates.slice(cursorIndex, cursorIndex + args.take).map((candidate) => ({
        id: candidate.id,
        memberId: candidate.memberId,
      }));
    });
    const materializedIds: string[] = [];
    const tx = {
      hostedGroupMember: {
        findFirst: vi.fn(async (args: { where: { id?: string } }) => {
          materializedIds.push(args.where.id ?? "");
          return {
            createdAt,
            group: { joinCode: "JOIN1" },
            id: args.where.id,
            joinedAt: null,
          };
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx)),
      hostedGroupMember: { findMany },
    } as never;

    const firstPage = await drainPendingHostedGroupJoinConfirmations({
      limit: 2,
      prisma,
    });
    const secondPage = await drainPendingHostedGroupJoinConfirmations({
      cursor: firstPage.nextCursor,
      limit: 2,
      prisma,
    });

    expect(firstPage.nextCursor).toBe("membership_2");
    expect(secondPage.nextCursor).toBeNull();
    expect(materializedIds).toEqual([
      "membership_1",
      "membership_2",
      "membership_3",
    ]);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: { id: "membership_2" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: 1,
    }));
  });
});
