import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  getPrisma: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedMemberVerifiedEmailSnapshots: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/member-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/member-access")>(),
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberVerifiedEmailSnapshots:
    mocks.readHostedMemberVerifiedEmailSnapshots,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import {
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort,
  readHostedGroupNewsletterEmailRecipients,
  prepareHostedGroupNewsletterParticipants,
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
    mocks.readHostedMemberRoutingState.mockImplementation(async (input: { memberId: string }) =>
      input.memberId === "member_active_missing_email" ? createTelegramRoutingState() : null
    );
    mocks.readHostedMemberVerifiedEmailSnapshots.mockImplementation(
      async (input: { memberIds: readonly string[] }) =>
        input.memberIds.map((memberId) => ({
          memberId,
          verifiedEmail: memberId === "member_active_missing_email"
            ? null
            : verifiedEmailFact(`${memberId}@example.com`),
        })),
    );
  });

  it("excludes inactive granted members from newsletter preparation and email recipients", async () => {
    const prisma = createPrismaMock();
    mocks.getPrisma.mockReturnValue(prisma);

    const participants = await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });
    const recipients = await readHostedGroupNewsletterEmailRecipients({
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    });

    expect(participants).toEqual({
      authorizationProof: expect.stringMatching(/^[0-9a-f]{64}$/u),
      groupId: "hgrp_123",
      missingEmailParticipants: [
        {
          authorizedShares: [],
          hasEmail: false,
          memberId: "member_active_missing_email",
        },
      ],
      participants: [
        {
          authorizedShares: [],
          hasEmail: true,
          memberId: "member_active_with_email",
        },
        {
          authorizedShares: [],
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
        directRoute: { channel: "telegram", threadId: "telegram_thread_123" },
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
    expect(mocks.readHostedMemberVerifiedEmailSnapshots).toHaveBeenCalledTimes(3);
    for (const [input] of mocks.readHostedMemberVerifiedEmailSnapshots.mock.calls) {
      expect(input.memberIds).toEqual([
        "member_active_with_email",
        "member_active_missing_email",
      ]);
    }
    expect(prisma.hostedMember.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.$transaction).toHaveBeenCalledTimes(4);
    expect(prisma.$transaction.mock.calls.filter((call: [
      unknown,
      { isolationLevel?: string }?,
    ]) =>
      call[1]?.isolationLevel === "RepeatableRead"
    )).toHaveLength(3);
  });

  it("excludes explicitly withdrawn grantors while keeping legacy missing grants eligible", async () => {
    const prisma = createPrismaMock({
      newsletterWithdrawnMemberIds: ["member_active_with_email"],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const participants = await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    expect(participants).toEqual(expect.objectContaining({
      participants: [
        {
          authorizedShares: [],
          hasEmail: false,
          memberId: "member_active_missing_email",
        },
      ],
      status: "ok",
    }));
  });

  it("keeps participant-backed thread-container members eligible in the batched access read", async () => {
    const prisma = createPrismaMock({
      newsletterParticipantBackedMemberIds: ["member_active_with_email"],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const participants = await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    if (participants.status !== "ok") {
      throw new Error("Expected newsletter preparation.");
    }
    expect(participants.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        hasEmail: true,
        memberId: "member_active_with_email",
      }),
    ]));
    expect(mocks.readHostedMemberVerifiedEmailSnapshots).toHaveBeenCalledWith({
      memberIds: [
        "member_active_with_email",
        "member_active_missing_email",
      ],
      prisma,
    });
    expect(prisma.hostedMember.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        threadContainer: {
          select: {
            owner: {
              select: expect.any(Object),
            },
            participants: {
              select: { participantMemberId: true },
              take: 1,
              where: expect.objectContaining({
                lastSeenAt: { gte: expect.any(Date) },
                removedAt: null,
              }),
            },
          },
        },
      }),
    }));
  });

  it("does not derive newsletter access from an explicitly withdrawn container owner", async () => {
    const prisma = createPrismaMock({
      newsletterActiveOwnerMemberIds: ["member_active_with_email"],
      newsletterParticipantBackedMemberIds: ["member_active_with_email"],
      newsletterParticipantUnavailableMemberIds: ["member_active_with_email"],
      newsletterWithdrawnOwnerMemberIds: ["member_active_with_email"],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const participants = await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    if (participants.status !== "ok") {
      throw new Error("Expected newsletter preparation.");
    }
    expect(participants.participants).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        memberId: "member_active_with_email",
      }),
    ]));
  });

  it("returns current address-free data grant ids only for email-authorized active members", async () => {
    const prisma = createPrismaMock();
    prisma.hostedVaultShare.findMany.mockResolvedValue([
      {
        grantorMemberId: "member_active_with_email",
        id: "share_email_ready",
        projectionKind: "group-email.v0",
        projectionScopeKey: "group-email.v0",
      },
      {
        grantorMemberId: "member_active_with_email",
        id: "share_steps_current",
        projectionKind: "steps-days.v0",
        projectionScopeKey: "steps-days.v0",
      },
      {
        grantorMemberId: "member_suspended",
        id: "share_email_suspended",
        projectionKind: "group-email.v0",
        projectionScopeKey: "group-email.v0",
      },
    ]);
    mocks.getPrisma.mockReturnValue(prisma);

    const participants = await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    expect(participants).toEqual({
      authorizationProof: expect.stringMatching(/^[0-9a-f]{64}$/u),
      groupId: "hgrp_123",
      missingEmailParticipants: [],
      participants: [
        {
          authorizedShares: [
            {
              projectionScopeKey: "steps-days.v0",
              shareId: "share_steps_current",
            },
          ],
          hasEmail: true,
          memberId: "member_active_with_email",
        },
      ],
      status: "ok",
    });
  });

  it.each([
    {
      expectedParticipants: [
        {
          authorizedShares: [],
          hasEmail: true,
          memberId: "member_active_with_email",
        },
      ],
      finalGrants: [
        {
          grantorMemberId: "member_active_with_email",
          id: "share_email_ready",
          projectionKind: "group-email.v0",
          projectionScopeKey: "group-email.v0",
        },
      ],
      revokeKind: "health share",
    },
    {
      expectedParticipants: [],
      finalGrants: [
        {
          grantorMemberId: "member_active_with_email",
          id: "share_steps_current",
          projectionKind: "steps-days.v0",
          projectionScopeKey: "steps-days.v0",
        },
      ],
      revokeKind: "email grant",
    },
  ])("uses the final canonical snapshot after a $revokeKind revoke during preparation", async ({
    expectedParticipants,
    finalGrants,
  }) => {
    const prisma = createPrismaMock();
    const initialGrants = [
      {
        grantorMemberId: "member_active_with_email",
        id: "share_email_ready",
        projectionKind: "group-email.v0",
        projectionScopeKey: "group-email.v0",
      },
      {
        grantorMemberId: "member_active_with_email",
        id: "share_steps_current",
        projectionKind: "steps-days.v0",
        projectionScopeKey: "steps-days.v0",
      },
    ];
    prisma.hostedVaultShare.findMany
      .mockResolvedValueOnce(initialGrants)
      .mockResolvedValueOnce(finalGrants);
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMemberVerifiedEmailSnapshots.mockImplementation(
      async (input: { memberIds: readonly string[] }) =>
        input.memberIds.map((memberId) => ({
          memberId,
          verifiedEmail: verifiedEmailFact("member@example.test"),
        })),
    );

    const result = await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    expect(result).toEqual({
      authorizationProof: expect.stringMatching(/^[0-9a-f]{64}$/u),
      groupId: "hgrp_123",
      missingEmailParticipants: [],
      participants: expectedParticipants,
      status: "ok",
    });
    expect(prisma.hostedVaultShare.findMany).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      finalGrants: [
        {
          grantorMemberId: "member_active_with_email",
          id: "share_email_ready",
          projectionKind: "group-email.v0",
          projectionScopeKey: "group-email.v0",
        },
      ],
      revokeKind: "health share",
    },
    {
      finalGrants: [
        {
          grantorMemberId: "member_active_with_email",
          id: "share_steps_current",
          projectionKind: "steps-days.v0",
          projectionScopeKey: "steps-days.v0",
        },
      ],
      revokeKind: "email grant",
    },
  ])("rejects final recipients after a $revokeKind revoke changes the prepared proof", async ({
    finalGrants,
  }) => {
    const prisma = createPrismaMock();
    const preparedGrants = [
      {
        grantorMemberId: "member_active_with_email",
        id: "share_email_ready",
        projectionKind: "group-email.v0",
        projectionScopeKey: "group-email.v0",
      },
      {
        grantorMemberId: "member_active_with_email",
        id: "share_steps_current",
        projectionKind: "steps-days.v0",
        projectionScopeKey: "steps-days.v0",
      },
    ];
    prisma.hostedVaultShare.findMany.mockResolvedValue(preparedGrants);
    mocks.getPrisma.mockReturnValue(prisma);
    const prepared = await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });
    if (prepared.status !== "ok") {
      throw new Error("Expected newsletter preparation.");
    }
    prisma.hostedVaultShare.findMany.mockResolvedValue(finalGrants);

    await expect(readHostedGroupNewsletterEmailRecipients({
      expectedNewsletterAuthorizationProof: prepared.authorizationProof,
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "newsletter_authorization_changed",
    });
  });

  it.each([
    {
      changedSnapshot: {
        newsletterSuspendedMemberIds: [
          "member_active_with_email",
          "member_suspended",
        ],
      },
      changeKind: "member suspension",
    },
    {
      changedSnapshot: {
        newsletterEmailLookupKeyByMember: {
          member_active_with_email: "changed-verified-email-lookup",
        },
      },
      changeKind: "verified-email mutation",
    },
  ])("rejects final recipients after a $changeKind during snapshot assembly", async ({
    changedSnapshot,
  }) => {
    const preparedPrisma = createPrismaMock();
    mocks.getPrisma.mockReturnValue(preparedPrisma);
    const prepared = await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });
    if (prepared.status !== "ok") {
      throw new Error("Expected newsletter preparation.");
    }

    const changedPrisma = createPrismaMock(changedSnapshot);
    mocks.getPrisma.mockReturnValue(changedPrisma);

    await expect(readHostedGroupNewsletterEmailRecipients({
      expectedNewsletterAuthorizationProof: prepared.authorizationProof,
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "newsletter_authorization_changed",
    });
    expect(changedPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        isolationLevel: "RepeatableRead",
        maxWait: 5_000,
      },
    );
  });

  it("rejects final recipients after verified-email identity rotates with email still present", async () => {
    const prepared = await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });
    if (prepared.status !== "ok") {
      throw new Error("Expected newsletter preparation.");
    }

    mocks.readHostedMemberVerifiedEmailSnapshots.mockImplementation(
      async (input: { memberIds: readonly string[] }) =>
        input.memberIds.map((memberId) => ({
          memberId,
          verifiedEmail: memberId === "member_active_missing_email"
            ? null
            : verifiedEmailFact(`${memberId}@example.com`, {
              lookupKey: "rotated-verified-email-lookup",
            }),
        })),
    );
    mocks.getPrisma.mockReturnValue(createPrismaMock({
      newsletterEmailLookupKeyByMember: {
        member_active_with_email: "rotated-verified-email-lookup",
      },
    }));

    await expect(readHostedGroupNewsletterEmailRecipients({
      expectedNewsletterAuthorizationProof: prepared.authorizationProof,
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "newsletter_authorization_changed",
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

    await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });
    await prepareHostedGroupNewsletterParticipants({
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
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);

    await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("enqueues one private email nudge for an established Linq direct thread", async () => {
    mocks.readHostedMemberRoutingState.mockImplementation(async (input: { memberId: string }) =>
      input.memberId === "member_active_missing_email" ? createLinqHomeRoutingState() : null
    );

    await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        directRoute: { channel: "linq", threadId: "linq_home_thread_123" },
        eventId: "group-newsletter.email-needed:member_active_missing_email:hgrp_123",
        kind: "group-newsletter.email-needed",
        userId: "member_active_missing_email",
      }),
      tx: expect.any(Object),
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("enqueues one private email nudge for a Telegram-only member", async () => {
    mocks.readHostedMemberRoutingState.mockImplementation(async (input: { memberId: string }) =>
      input.memberId === "member_active_missing_email" ? createTelegramRoutingState() : null
    );

    await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        directRoute: { channel: "telegram", threadId: "telegram_thread_123" },
        eventId: "group-newsletter.email-needed:member_active_missing_email:hgrp_123",
        kind: "group-newsletter.email-needed",
        userId: "member_active_missing_email",
      }),
      tx: expect.any(Object),
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("does not enqueue a private email nudge for a Telegram settings sync without a direct thread", async () => {
    mocks.readHostedMemberRoutingState.mockImplementation(async (input: { memberId: string }) =>
      input.memberId === "member_active_missing_email"
        ? createTelegramSettingsOnlyRoutingState()
        : null
    );

    await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("does not consume the once-ever nudge until a missing-email participant has a direct route", async () => {
    let memberHasDirectRoute = false;
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

    await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();

    memberHasDirectRoute = true;
    await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });
    await prepareHostedGroupNewsletterParticipants({
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
    mocks.getPrisma.mockReturnValue(createPrismaMock({
      newsletterMissingEmailMemberIds: [],
    }));
    mocks.readHostedMemberVerifiedEmailSnapshots.mockImplementation(
      async (input: { memberIds: readonly string[] }) =>
        input.memberIds.map((memberId) => ({
          memberId,
          verifiedEmail: verifiedEmailFact("member@example.test"),
        })),
    );

    const participants = await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    expect(participants).toEqual(expect.objectContaining({
      missingEmailParticipants: [],
      status: "ok",
    }));
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("keeps newsletter preparation available when private email nudge enqueue fails", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockRejectedValueOnce(new Error("append failed"));

    const participants = await prepareHostedGroupNewsletterParticipants({
      runtimeMemberId: "group_runtime_member",
    });

    expect(participants).toEqual(expect.objectContaining({
      missingEmailParticipants: [
        {
          authorizedShares: [],
          hasEmail: false,
          memberId: "member_active_missing_email",
        },
      ],
      status: "ok",
    }));
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("enqueues a private email nudge for a joining member who granted email but has no verified email", async () => {
    const prisma = createPrismaMock();
    mocks.getPrisma.mockReturnValue(prisma);

    await enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort({
      groupId: "hgrp_123",
      memberId: "member_active_missing_email",
    });

    expect(prisma.hostedGroup.findFirst).toHaveBeenCalledWith({
      where: {
        id: "hgrp_123",
        members: {
          some: { memberId: "member_active_missing_email" },
        },
      },
      select: {
        displayName: true,
        id: true,
        runtimeMemberId: true,
      },
    });
    expect(prisma.hostedVaultShare.findFirst).toHaveBeenCalledWith({
      where: {
        destinationMemberId: "group_runtime_member",
        grantorMemberId: "member_active_missing_email",
        projectionKind: "group-email.v0",
        status: "granted",
      },
      select: { grantorMemberId: true },
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        directRoute: { channel: "telegram", threadId: "telegram_thread_123" },
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
  });

  it("still enqueues the joining-member nudge when Stripe supplied only an unverified email hint", async () => {
    const prisma = createPrismaMock();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMemberVerifiedEmailSnapshots.mockResolvedValue([{
      memberId: "member_active_missing_email",
      verifiedEmail: null,
    }]);

    await enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort({
      groupId: "hgrp_123",
      memberId: "member_active_missing_email",
    });

    expect(mocks.readHostedMemberVerifiedEmailSnapshots).toHaveBeenCalledWith({
      memberIds: ["member_active_missing_email"],
      prisma,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "group-newsletter.email-needed:member_active_missing_email:hgrp_123",
        kind: "group-newsletter.email-needed",
        userId: "member_active_missing_email",
      }),
      tx: prisma,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_active_missing_email",
      mailboxItemId: "mailbox_item_email_needed",
    });
  });

  it("does not enqueue a joining-member nudge without the email grant", async () => {
    const prisma = createPrismaMock({ emailGrant: false });
    mocks.getPrisma.mockReturnValue(prisma);

    await enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort({
      groupId: "hgrp_123",
      memberId: "member_active_missing_email",
    });

    expect(mocks.readHostedMemberVerifiedEmailSnapshots).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("does not enqueue a joining-member nudge when the member already has a verified email", async () => {
    const prisma = createPrismaMock();
    mocks.getPrisma.mockReturnValue(prisma);

    await enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort({
      groupId: "hgrp_123",
      memberId: "member_active_with_email",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("does not consume the joining-member nudge key before a direct route exists", async () => {
    const prisma = createPrismaMock();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);

    await enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort({
      groupId: "hgrp_123",
      memberId: "member_active_missing_email",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });
});

function verifiedEmailFact(address: string, input?: {
  lookupKey?: string;
  verifiedAt?: Date;
}) {
  return {
    address,
    lookupKey: input?.lookupKey ?? "verified-email-lookup",
    verifiedAt: input?.verifiedAt ?? new Date("2026-07-01T12:00:00.000Z"),
  };
}

function newsletterMemberAccessState(input: {
  activeOwner?: boolean;
  memberId: string;
  participantBacked?: boolean;
  participantEligible?: boolean;
  suspended: boolean;
  withdrawn?: boolean;
  withdrawnOwner?: boolean;
}) {
  return {
    accountGroupMemberships: [],
    billingStatus: input.participantBacked ? "not_started" as const : "active" as const,
    consentGrants: input.withdrawn
      ? [{ scope: "launch.health-data", status: "revoked" }]
      : [],
    id: input.memberId,
    suspendedAt: input.suspended
      ? new Date("2026-07-13T12:00:00.000Z")
      : null,
    threadContainer: input.participantBacked
      ? {
          owner: {
            accountGroupMemberships: [],
            billingStatus: input.activeOwner ? "active" as const : "not_started" as const,
            consentGrants: input.withdrawnOwner
              ? [{ scope: "launch.health-data", status: "revoked" }]
              : [],
            suspendedAt: null,
          },
          participants: input.participantEligible === false
            ? []
            : [{ participantMemberId: "member_active_participant" }],
        }
      : null,
  };
}

function createPrismaMock(input?: {
  emailGrant?: boolean;
  groupRuntimeMemberId?: string | null;
  newsletterEmailLookupKeyByMember?: Readonly<Record<string, string | null>>;
  newsletterActiveOwnerMemberIds?: readonly string[];
  newsletterMissingEmailMemberIds?: readonly string[];
  newsletterParticipantBackedMemberIds?: readonly string[];
  newsletterParticipantUnavailableMemberIds?: readonly string[];
  newsletterSuspendedMemberIds?: readonly string[];
  newsletterWithdrawnMemberIds?: readonly string[];
  newsletterWithdrawnOwnerMemberIds?: readonly string[];
}) {
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(prisma)
    ),
    hostedGroup: {
      findFirst: vi.fn(async (args?: {
        select?: { runtimeMember?: unknown; runtimeMemberId?: boolean };
      }) => {
        if (args?.select?.runtimeMemberId) {
          return {
            displayName: "Sunday group",
            id: "hgrp_123",
            runtimeMemberId: input?.groupRuntimeMemberId === undefined
              ? "group_runtime_member"
              : input.groupRuntimeMemberId,
          };
        }
        if (args?.select?.runtimeMember) {
          const grants = await prisma.hostedVaultShare.findMany();
          const suspendedMemberIds = new Set(
            input?.newsletterSuspendedMemberIds ?? ["member_suspended"],
          );
          const missingEmailMemberIds = new Set(
            input?.newsletterMissingEmailMemberIds ?? ["member_active_missing_email"],
          );
          const participantBackedMemberIds = new Set(
            input?.newsletterParticipantBackedMemberIds ?? [],
          );
          const participantUnavailableMemberIds = new Set(
            input?.newsletterParticipantUnavailableMemberIds ?? [],
          );
          const activeOwnerMemberIds = new Set(
            input?.newsletterActiveOwnerMemberIds ?? [],
          );
          const withdrawnMemberIds = new Set(
            input?.newsletterWithdrawnMemberIds ?? [],
          );
          const withdrawnOwnerMemberIds = new Set(
            input?.newsletterWithdrawnOwnerMemberIds ?? [],
          );
          const memberIds = [
            "member_active_with_email",
            "member_suspended",
            "member_active_missing_email",
          ];
          return {
            displayName: "Sunday group",
            id: "hgrp_123",
            members: memberIds.map((memberId) => ({
              member: {
                ...newsletterMemberAccessState({
                  activeOwner: activeOwnerMemberIds.has(memberId),
                  memberId,
                  participantBacked: participantBackedMemberIds.has(memberId),
                  participantEligible: !participantUnavailableMemberIds.has(memberId),
                  suspended: suspendedMemberIds.has(memberId),
                  withdrawn: withdrawnMemberIds.has(memberId),
                  withdrawnOwner: withdrawnOwnerMemberIds.has(memberId),
                }),
                emailAuthorization: missingEmailMemberIds.has(memberId)
                  ? null
                  : {
                      verifiedEmailLookupKey:
                        input?.newsletterEmailLookupKeyByMember?.[memberId]
                        ?? verifiedEmailFact(`${memberId}@example.com`).lookupKey,
                      verifiedEmailVerifiedAt:
                        verifiedEmailFact(`${memberId}@example.com`).verifiedAt,
                    },
                vaultSharesGranted: grants.filter((grant) =>
                  grant.grantorMemberId === memberId
                ),
              },
            })),
            runtimeMember: newsletterMemberAccessState({
              memberId: "group_runtime_member",
              suspended: false,
            }),
          };
        }

        return {
          displayName: "Sunday group",
          id: "hgrp_123",
          members: [
            { memberId: "member_active_with_email" },
            { memberId: "member_suspended" },
            { memberId: "member_active_missing_email" },
          ],
        };
      }),
    },
    hostedMember: {
      findMany: vi.fn(async () => {
        const suspendedMemberIds = new Set(
          input?.newsletterSuspendedMemberIds ?? ["member_suspended"],
        );
        const participantBackedMemberIds = new Set(
          input?.newsletterParticipantBackedMemberIds ?? [],
        );
        const participantUnavailableMemberIds = new Set(
          input?.newsletterParticipantUnavailableMemberIds ?? [],
        );
        const activeOwnerMemberIds = new Set(
          input?.newsletterActiveOwnerMemberIds ?? [],
        );
        const withdrawnMemberIds = new Set(
          input?.newsletterWithdrawnMemberIds ?? [],
        );
        const withdrawnOwnerMemberIds = new Set(
          input?.newsletterWithdrawnOwnerMemberIds ?? [],
        );
        return [
          "member_active_with_email",
          "member_suspended",
          "member_active_missing_email",
        ].map((memberId) => newsletterMemberAccessState({
          activeOwner: activeOwnerMemberIds.has(memberId),
          memberId,
          participantBacked: participantBackedMemberIds.has(memberId),
          participantEligible: !participantUnavailableMemberIds.has(memberId),
          suspended: suspendedMemberIds.has(memberId),
          withdrawn: withdrawnMemberIds.has(memberId),
          withdrawnOwner: withdrawnOwnerMemberIds.has(memberId),
        }));
      }),
    },
    hostedVaultShare: {
      findMany: vi.fn(async () => [
        {
          grantorMemberId: "member_active_with_email",
          id: "share_email_ready",
          projectionKind: "group-email.v0",
          projectionScopeKey: "group-email.v0",
        },
        {
          grantorMemberId: "member_suspended",
          id: "share_email_suspended",
          projectionKind: "group-email.v0",
          projectionScopeKey: "group-email.v0",
        },
        {
          grantorMemberId: "member_active_missing_email",
          id: "share_email_missing",
          projectionKind: "group-email.v0",
          projectionScopeKey: "group-email.v0",
        },
      ]),
      findFirst: vi.fn(async () =>
        input?.emailGrant === false
          ? null
          : { grantorMemberId: "member_active_missing_email" }),
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
