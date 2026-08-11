import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedMemberVerifiedEmailSnapshots: vi.fn(),
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

import {
  readHostedGroupEmailRecipients,
  prepareHostedGroupEmail,
} from "@/src/lib/hosted-groups/group-email";

describe("hosted group email authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(createPrismaMock());
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.readActiveHostedMemberAccess.mockImplementation(async (input: { memberId: string }) =>
      input.memberId !== "member_suspended"
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

  it("excludes inactive granted members from group email preparation and email recipients", async () => {
    const prisma = createPrismaMock();
    mocks.getPrisma.mockReturnValue(prisma);

    const participants = await prepareHostedGroupEmail({
      runtimeMemberId: "group_runtime_member",
    });
    const recipients = await readHostedGroupEmailRecipients({
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
    expect(mocks.readHostedMemberVerifiedEmailSnapshots).toHaveBeenCalledTimes(2);
    for (const [input] of mocks.readHostedMemberVerifiedEmailSnapshots.mock.calls) {
      expect(input.memberIds).toEqual([
        "member_active_with_email",
        "member_active_missing_email",
      ]);
    }
    expect(prisma.hostedMember.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction.mock.calls.filter((call: [
      unknown,
      { isolationLevel?: string }?,
    ]) =>
      call[1]?.isolationLevel === "RepeatableRead"
    )).toHaveLength(2);
  });

  it("excludes explicitly withdrawn grantors while keeping legacy missing grants eligible", async () => {
    const prisma = createPrismaMock({
      groupEmailWithdrawnMemberIds: ["member_active_with_email"],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const participants = await prepareHostedGroupEmail({
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
      groupEmailParticipantBackedMemberIds: ["member_active_with_email"],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const participants = await prepareHostedGroupEmail({
      runtimeMemberId: "group_runtime_member",
    });

    if (participants.status !== "ok") {
      throw new Error("Expected group email preparation.");
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
    expect(prisma.hostedMember.findMany).toHaveBeenCalledTimes(1);
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

  it("does not derive group email access from an explicitly withdrawn container owner", async () => {
    const prisma = createPrismaMock({
      groupEmailActiveOwnerMemberIds: ["member_active_with_email"],
      groupEmailParticipantBackedMemberIds: ["member_active_with_email"],
      groupEmailParticipantUnavailableMemberIds: ["member_active_with_email"],
      groupEmailWithdrawnOwnerMemberIds: ["member_active_with_email"],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const participants = await prepareHostedGroupEmail({
      runtimeMemberId: "group_runtime_member",
    });

    if (participants.status !== "ok") {
      throw new Error("Expected group email preparation.");
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

    const participants = await prepareHostedGroupEmail({
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
    prisma.hostedVaultShare.findMany.mockResolvedValue(finalGrants);
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMemberVerifiedEmailSnapshots.mockImplementation(
      async (input: { memberIds: readonly string[] }) =>
        input.memberIds.map((memberId) => ({
          memberId,
          verifiedEmail: verifiedEmailFact("member@example.test"),
        })),
    );

    const result = await prepareHostedGroupEmail({
      runtimeMemberId: "group_runtime_member",
    });

    expect(result).toEqual({
      authorizationProof: expect.stringMatching(/^[0-9a-f]{64}$/u),
      groupId: "hgrp_123",
      missingEmailParticipants: [],
      participants: expectedParticipants,
      status: "ok",
    });
    expect(prisma.hostedVaultShare.findMany).toHaveBeenCalledTimes(1);
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
    const prepared = await prepareHostedGroupEmail({
      runtimeMemberId: "group_runtime_member",
    });
    if (prepared.status !== "ok") {
      throw new Error("Expected group email preparation.");
    }
    prisma.hostedVaultShare.findMany.mockResolvedValue(finalGrants);

    await expect(readHostedGroupEmailRecipients({
      expectedGroupEmailAuthorizationProof: prepared.authorizationProof,
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "group_email_authorization_changed",
    });
  });

  it.each([
    {
      changedSnapshot: {
        groupEmailSuspendedMemberIds: [
          "member_active_with_email",
          "member_suspended",
        ],
      },
      changeKind: "member suspension",
    },
    {
      changedSnapshot: {
        groupEmailLookupKeyByMember: {
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
    const prepared = await prepareHostedGroupEmail({
      runtimeMemberId: "group_runtime_member",
    });
    if (prepared.status !== "ok") {
      throw new Error("Expected group email preparation.");
    }

    const changedPrisma = createPrismaMock(changedSnapshot);
    mocks.getPrisma.mockReturnValue(changedPrisma);

    await expect(readHostedGroupEmailRecipients({
      expectedGroupEmailAuthorizationProof: prepared.authorizationProof,
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "group_email_authorization_changed",
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
    const prepared = await prepareHostedGroupEmail({
      runtimeMemberId: "group_runtime_member",
    });
    if (prepared.status !== "ok") {
      throw new Error("Expected group email preparation.");
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
      groupEmailLookupKeyByMember: {
        member_active_with_email: "rotated-verified-email-lookup",
      },
    }));

    await expect(readHostedGroupEmailRecipients({
      expectedGroupEmailAuthorizationProof: prepared.authorizationProof,
      groupId: "hgrp_123",
      runtimeMemberId: "group_runtime_member",
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "group_email_authorization_changed",
    });
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

function groupEmailMemberAccessState(input: {
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
  groupEmailLookupKeyByMember?: Readonly<Record<string, string | null>>;
  groupEmailActiveOwnerMemberIds?: readonly string[];
  groupEmailMissingEmailMemberIds?: readonly string[];
  groupEmailParticipantBackedMemberIds?: readonly string[];
  groupEmailParticipantUnavailableMemberIds?: readonly string[];
  groupEmailSuspendedMemberIds?: readonly string[];
  groupEmailWithdrawnMemberIds?: readonly string[];
  groupEmailWithdrawnOwnerMemberIds?: readonly string[];
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
            input?.groupEmailSuspendedMemberIds ?? ["member_suspended"],
          );
          const missingEmailMemberIds = new Set(
            input?.groupEmailMissingEmailMemberIds ?? ["member_active_missing_email"],
          );
          const participantBackedMemberIds = new Set(
            input?.groupEmailParticipantBackedMemberIds ?? [],
          );
          const participantUnavailableMemberIds = new Set(
            input?.groupEmailParticipantUnavailableMemberIds ?? [],
          );
          const activeOwnerMemberIds = new Set(
            input?.groupEmailActiveOwnerMemberIds ?? [],
          );
          const withdrawnMemberIds = new Set(
            input?.groupEmailWithdrawnMemberIds ?? [],
          );
          const withdrawnOwnerMemberIds = new Set(
            input?.groupEmailWithdrawnOwnerMemberIds ?? [],
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
                ...groupEmailMemberAccessState({
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
                        input?.groupEmailLookupKeyByMember?.[memberId]
                        ?? verifiedEmailFact(`${memberId}@example.com`).lookupKey,
                      verifiedEmailVerifiedAt:
                        verifiedEmailFact(`${memberId}@example.com`).verifiedAt,
                    },
                vaultSharesGranted: grants.filter((grant) =>
                  grant.grantorMemberId === memberId
                ),
              },
            })),
            runtimeMember: groupEmailMemberAccessState({
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
          input?.groupEmailSuspendedMemberIds ?? ["member_suspended"],
        );
        const participantBackedMemberIds = new Set(
          input?.groupEmailParticipantBackedMemberIds ?? [],
        );
        const participantUnavailableMemberIds = new Set(
          input?.groupEmailParticipantUnavailableMemberIds ?? [],
        );
        const activeOwnerMemberIds = new Set(
          input?.groupEmailActiveOwnerMemberIds ?? [],
        );
        const withdrawnMemberIds = new Set(
          input?.groupEmailWithdrawnMemberIds ?? [],
        );
        const withdrawnOwnerMemberIds = new Set(
          input?.groupEmailWithdrawnOwnerMemberIds ?? [],
        );
        return [
          "member_active_with_email",
          "member_suspended",
          "member_active_missing_email",
        ].map((memberId) => groupEmailMemberAccessState({
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
