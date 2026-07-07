import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  getPrisma: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccess: mocks.hasHostedRuntimeActiveAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  readHostedMemberIdentity: mocks.readHostedMemberIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import {
  readHostedGroupNewsletterEmailRecipients,
  readHostedGroupNewsletterParticipants,
} from "@/src/lib/hosted-groups/group-newsletter";

describe("hosted group newsletter participants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(createPrismaMock());
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      inserted: true,
      item: { id: "mailbox_item_email_needed" },
    });
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.readActiveHostedMemberAccess.mockImplementation(async (input: { memberId: string }) =>
      input.memberId !== "member_suspended"
    );
    mocks.readHostedMemberIdentity.mockResolvedValue(null);
    mocks.readHostedMemberRoutingState.mockImplementation(async (input: { memberId: string }) =>
      input.memberId === "member_active_missing_email" ? createTelegramRoutingState() : null
    );
    mocks.readHostedMemberEmailAuthorization.mockImplementation(async (input: { memberId: string }) => {
      if (input.memberId === "member_active_missing_email") {
        return null;
      }

      return {
        verifiedEmail: {
          address: `${input.memberId}@example.com`,
        },
      };
    });
  });

  it("excludes inactive granted members from stats participants and email recipients", async () => {
    const participants = await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });
    const recipients = await readHostedGroupNewsletterEmailRecipients({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });

    expect(participants).toEqual({
      groupId: "hgrp_123",
      missingEmailParticipants: [
        {
          displayName: null,
          hasEmail: false,
          memberId: "member_active_missing_email",
        },
      ],
      participants: [
        {
          displayName: null,
          hasEmail: true,
          memberId: "member_active_with_email",
        },
        {
          displayName: null,
          hasEmail: false,
          memberId: "member_active_missing_email",
        },
      ],
      status: "ok",
    });
    expect(recipients).toEqual({
      recipients: [
        {
          address: "member_active_with_email@example.com",
          memberId: "member_active_with_email",
        },
      ],
      status: "ok",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "group-newsletter.email-needed:member_active_missing_email:hgrp_123",
        groupDisplayName: "Sunday group",
        groupId: "hgrp_123",
        kind: "group-newsletter.email-needed",
        userId: "member_active_missing_email",
      }),
      tx: expect.any(Object),
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_active_missing_email",
      mailboxItemId: "mailbox_item_email_needed",
    });
    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledWith({
      memberId: "member_suspended",
      prisma: expect.any(Object),
    });
    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalledWith({
      memberId: "member_suspended",
      prisma: expect.any(Object),
    });
  });

  it("reuses the member plus group idempotency key on repeat stats reads without a second signal", async () => {
    mocks.appendHostedMailboxEnvelopeTx
      .mockResolvedValueOnce({
        inserted: true,
        item: { id: "mailbox_item_email_needed" },
      })
      .mockResolvedValueOnce({
        inserted: false,
        item: { id: "mailbox_item_email_needed" },
      });

    await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });
    await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
    expect(mocks.appendHostedMailboxEnvelopeTx.mock.calls.map((call) =>
      call[0]?.envelope?.eventId
    )).toEqual([
      "group-newsletter.email-needed:member_active_missing_email:hgrp_123",
      "group-newsletter.email-needed:member_active_missing_email:hgrp_123",
    ]);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("does not spend the private email nudge key for a phone-lookup-only member", async () => {
    mocks.readHostedMemberIdentity.mockImplementation(async (input: { memberId: string }) =>
      input.memberId === "member_active_missing_email"
        ? { phoneLookupKey: "phone_lookup_key_only" }
        : null
    );
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);

    await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("enqueues one private email nudge for an established Linq direct thread", async () => {
    mocks.readHostedMemberIdentity.mockImplementation(async (input: { memberId: string }) =>
      input.memberId === "member_active_missing_email"
        ? { phoneLookupKey: "phone_lookup_with_thread" }
        : null
    );
    mocks.readHostedMemberRoutingState.mockImplementation(async (input: { memberId: string }) =>
      input.memberId === "member_active_missing_email" ? createLinqHomeRoutingState() : null
    );

    await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "group-newsletter.email-needed:member_active_missing_email:hgrp_123",
        kind: "group-newsletter.email-needed",
        userId: "member_active_missing_email",
      }),
      tx: expect.any(Object),
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("enqueues one private email nudge for a Telegram-only member", async () => {
    mocks.readHostedMemberIdentity.mockResolvedValue(null);
    mocks.readHostedMemberRoutingState.mockImplementation(async (input: { memberId: string }) =>
      input.memberId === "member_active_missing_email" ? createTelegramRoutingState() : null
    );

    await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "group-newsletter.email-needed:member_active_missing_email:hgrp_123",
        kind: "group-newsletter.email-needed",
        userId: "member_active_missing_email",
      }),
      tx: expect.any(Object),
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("does not enqueue a private email nudge for a Telegram settings sync without a direct thread", async () => {
    mocks.readHostedMemberIdentity.mockResolvedValue(null);
    mocks.readHostedMemberRoutingState.mockImplementation(async (input: { memberId: string }) =>
      input.memberId === "member_active_missing_email"
        ? createTelegramSettingsOnlyRoutingState()
        : null
    );

    await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("does not consume the once-ever nudge until a missing-email participant has a direct route", async () => {
    let memberHasDirectRoute = false;
    mocks.readHostedMemberIdentity.mockImplementation(async (input: { memberId: string }) =>
      input.memberId === "member_active_missing_email"
        ? { phoneLookupKey: "phone_lookup_pending_only" }
        : null
    );
    mocks.readHostedMemberRoutingState.mockImplementation(async (input: { memberId: string }) => {
      if (input.memberId !== "member_active_missing_email") {
        return null;
      }

      return memberHasDirectRoute
        ? createLinqHomeRoutingState()
        : createPendingLinqRoutingState();
    });
    mocks.appendHostedMailboxEnvelopeTx
      .mockResolvedValueOnce({
        inserted: true,
        item: { id: "mailbox_item_email_needed" },
      })
      .mockResolvedValueOnce({
        inserted: false,
        item: { id: "mailbox_item_email_needed" },
      });

    await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();

    memberHasDirectRoute = true;
    await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });
    await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
    expect(mocks.appendHostedMailboxEnvelopeTx.mock.calls.map((call) =>
      call[0]?.envelope?.eventId
    )).toEqual([
      "group-newsletter.email-needed:member_active_missing_email:hgrp_123",
      "group-newsletter.email-needed:member_active_missing_email:hgrp_123",
    ]);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_active_missing_email",
      mailboxItemId: "mailbox_item_email_needed",
    });
  });

  it("does not enqueue private email nudges for participants with verified email", async () => {
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      verifiedEmail: { address: "member@example.test" },
    });

    const participants = await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });

    expect(participants).toEqual(expect.objectContaining({
      missingEmailParticipants: [],
      status: "ok",
    }));
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("keeps read stats available when private email nudge enqueue fails", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockRejectedValueOnce(new Error("append failed"));

    const participants = await readHostedGroupNewsletterParticipants({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });

    expect(participants).toEqual(expect.objectContaining({
      missingEmailParticipants: [
        {
          displayName: null,
          hasEmail: false,
          memberId: "member_active_missing_email",
        },
      ],
      status: "ok",
    }));
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });
});

function createPrismaMock() {
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(prisma)
    ),
    hostedGroup: {
      findFirst: vi.fn(async () => ({
        displayName: "Sunday group",
        id: "hgrp_123",
        members: [
          { memberId: "member_active_with_email" },
          { memberId: "member_suspended" },
          { memberId: "member_active_missing_email" },
        ],
      })),
    },
    hostedVaultShare: {
      findMany: vi.fn(async () => [
        { grantorMemberId: "member_active_with_email" },
        { grantorMemberId: "member_suspended" },
        { grantorMemberId: "member_active_missing_email" },
      ]),
    },
  };
  return prisma;
}

function createTelegramRoutingState() {
  return {
    hasPendingLinqRouteState: false,
    linqChatId: null,
    linqHomeLineAssignedAt: null,
    linqRecipientPhone: null,
    memberId: "member_active_missing_email",
    pendingLinqChatId: null,
    pendingLinqParticipantContact: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: "telegram_thread_123",
    telegramUserId: null,
    telegramUserLookupKey: null,
  };
}

function createTelegramSettingsOnlyRoutingState() {
  return {
    hasPendingLinqRouteState: false,
    linqChatId: null,
    linqHomeLineAssignedAt: null,
    linqRecipientPhone: null,
    memberId: "member_active_missing_email",
    pendingLinqChatId: null,
    pendingLinqParticipantContact: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: "telegram_user_settings_only",
    telegramUserLookupKey: null,
  };
}

function createLinqHomeRoutingState() {
  return {
    hasPendingLinqRouteState: false,
    linqChatId: "linq_home_thread_123",
    linqHomeLineAssignedAt: new Date("2026-07-01T12:00:00.000Z"),
    linqRecipientPhone: null,
    memberId: "member_active_missing_email",
    pendingLinqChatId: null,
    pendingLinqParticipantContact: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  };
}

function createPendingLinqRoutingState() {
  return {
    hasPendingLinqRouteState: true,
    linqChatId: null,
    linqHomeLineAssignedAt: null,
    linqRecipientPhone: null,
    memberId: "member_active_missing_email",
    pendingLinqChatId: "linq_pending_thread_123",
    pendingLinqParticipantContact: {
      kind: "phone",
      lookupKey: "pending_contact_lookup_key",
      observedAt: new Date("2026-07-01T12:00:00.000Z"),
      value: "+15550101010",
    },
    pendingLinqRecipientPhone: "+15550101010",
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  };
}
