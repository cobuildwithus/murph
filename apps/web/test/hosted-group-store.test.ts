import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  grantHostedVaultShareTx: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  readActiveHostedVaultShareProjectionKinds: vi.fn(),
  revokeHostedVaultSharesWithCleanupTx: vi.fn(),
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccess: mocks.hasHostedRuntimeActiveAccess,
}));

vi.mock("@/src/lib/hosted-vault-share/share-grant-store", () => ({
  grantHostedVaultShareTx: mocks.grantHostedVaultShareTx,
  readActiveHostedVaultShareProjectionKinds: mocks.readActiveHostedVaultShareProjectionKinds,
  revokeHostedVaultSharesWithCleanupTx: mocks.revokeHostedVaultSharesWithCleanupTx,
}));

import {
  acceptHostedGroupJoinCodeTx,
  createHostedGroupJoinLinkForOwnedThreadContainerTx,
  HOSTED_GROUP_VAULT_SHARE_DESTINATION_LIMIT_PER_PROJECTION,
  HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION,
} from "@/src/lib/hosted-groups/group-store";

const JOIN_POLICY = {
  requestedVaultShareProjectionKinds: ["sleep-times.v0"],
  schema: "murph.hosted-group.join-policy.v1",
};

function buildTx(input?: {
  activeShareAlreadyExists?: boolean;
  activeDestinationGrantCount?: number;
  activeGroupGrantCount?: number;
  existingMembershipId?: string | null;
  runtimeMemberId?: string | null;
}): Prisma.TransactionClient & {
  hostedVaultShare: {
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
} {
  return {
    $queryRaw: vi.fn(async () => []),
    hostedGroup: {
      findUnique: vi.fn(async (args: { where: { id?: string; joinCode?: string } }) => {
        if (args.where.joinCode) {
          return { id: "group_1" };
        }
        if (args.where.id) {
          return {
            id: "group_1",
            joinPolicyJson: JOIN_POLICY,
            runtimeMemberId: input?.runtimeMemberId === undefined
              ? "member_group_runtime"
              : input.runtimeMemberId,
          };
        }
        return null;
      }),
    },
    hostedGroupMember: {
      create: vi.fn(async () => ({ id: "membership_created" })),
      findUnique: vi.fn(async () => {
        return input?.existingMembershipId ? { id: input.existingMembershipId } : null;
      }),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({ suspendedAt: null })),
    },
    hostedThreadContainer: {
      findUnique: vi.fn(async () => ({ memberId: "member_group_runtime" })),
    },
    hostedVaultShare: {
      count: vi.fn(async (args: { where: { destinationMemberId?: string } }) => {
        if (args.where.destinationMemberId) {
          return input?.activeDestinationGrantCount ?? 0;
        }
        return input?.activeGroupGrantCount
          ?? HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION;
      }),
      findUnique: vi.fn(async () => {
        return input?.activeShareAlreadyExists ? { status: "granted" } : null;
      }),
    },
  } as unknown as Prisma.TransactionClient & {
    hostedVaultShare: {
      count: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
}

describe("acceptHostedGroupJoinCodeTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.grantHostedVaultShareTx.mockResolvedValue(undefined);
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.revokeHostedVaultSharesWithCleanupTx.mockResolvedValue({
      cleanupSignals: [],
      revokedCount: 0,
    });
  });

  it("rejects membership when the group runtime is inactive even with no selected permissions", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);
    const tx = buildTx();

    await expect(acceptHostedGroupJoinCodeTx({
      joinCode: "join_1",
      memberId: "member_joiner",
      now: new Date("2026-07-01T00:00:00.000Z"),
      selectedVaultShareProjectionKinds: [],
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_RUNTIME_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(tx.hostedGroupMember.create).not.toHaveBeenCalled();
  });

  it("rejects membership when the group has lost its runtime member", async () => {
    const tx = buildTx({ runtimeMemberId: null });

    await expect(acceptHostedGroupJoinCodeTx({
      joinCode: "join_1",
      memberId: "member_joiner",
      now: new Date("2026-07-01T00:00:00.000Z"),
      selectedVaultShareProjectionKinds: [],
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_NOT_ACTIVE",
      httpStatus: 410,
    });

    expect(tx.hostedGroupMember.create).not.toHaveBeenCalled();
  });

  it("creates membership without launch consent when no permissions are selected", async () => {
    const tx = buildTx();

    await expect(acceptHostedGroupJoinCodeTx({
      joinCode: "join_1",
      memberId: "member_joiner",
      now: new Date("2026-07-01T00:00:00.000Z"),
      selectedVaultShareProjectionKinds: [],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: false,
      membershipId: "membership_created",
    });

    expect(mocks.hasHostedRuntimeActiveAccess).toHaveBeenCalledWith(
      "member_group_runtime",
      expect.anything(),
    );
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalled();
  });

  it("refuses to add a group vault-share grant beyond the bounded fan-out cap", async () => {
    const tx = buildTx({
      activeGroupGrantCount: HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION,
    });

    await expect(acceptHostedGroupJoinCodeTx({
      joinCode: "join_1",
      memberId: "member_grantor",
      now: new Date("2026-07-01T00:00:00.000Z"),
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_REACHED",
      httpStatus: 409,
    });

    expect(tx.hostedVaultShare.count).toHaveBeenCalledWith({
      where: {
        grantorMemberId: "member_grantor",
        projectionKind: "sleep-times.v0",
        status: "granted",
      },
    });
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalled();
  });

  it("refuses to add a group vault-share grant beyond the destination projection cap", async () => {
    const tx = buildTx({
      activeDestinationGrantCount: HOSTED_GROUP_VAULT_SHARE_DESTINATION_LIMIT_PER_PROJECTION,
      activeGroupGrantCount: 0,
    });

    await expect(acceptHostedGroupJoinCodeTx({
      joinCode: "join_1",
      memberId: "member_grantor",
      now: new Date("2026-07-01T00:00:00.000Z"),
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_VAULT_SHARE_DESTINATION_LIMIT_REACHED",
      httpStatus: 409,
    });

    expect(tx.hostedVaultShare.count).toHaveBeenCalledWith({
      where: {
        destinationMemberId: "member_group_runtime",
        projectionKind: "sleep-times.v0",
        status: "granted",
      },
    });
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalled();
  });

  it("keeps an existing active group vault-share grant idempotent at the cap", async () => {
    const tx = buildTx({
      activeGroupGrantCount: HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION,
      activeShareAlreadyExists: true,
      existingMembershipId: "membership_existing",
    });

    await expect(acceptHostedGroupJoinCodeTx({
      joinCode: "join_1",
      memberId: "member_grantor",
      now: new Date("2026-07-01T00:00:00.000Z"),
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: true,
      grantedVaultShareProjectionKinds: ["sleep-times.v0"],
      membershipId: "membership_existing",
    });

    expect(tx.hostedVaultShare.count).not.toHaveBeenCalled();
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now: new Date("2026-07-01T00:00:00.000Z"),
      projectionKind: "sleep-times.v0",
      tx,
    });
  });

  it("returns cleanup signals when a member unselects a previously granted group share", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
    });
    const now = new Date("2026-07-01T00:00:00.000Z");
    mocks.revokeHostedVaultSharesWithCleanupTx.mockResolvedValue({
      cleanupSignals: [{
        mailboxItemId: "mailbox_item_revoke_1",
        memberId: "member_group_runtime",
      }],
      revokedCount: 1,
    });

    await expect(acceptHostedGroupJoinCodeTx({
      joinCode: "join_1",
      memberId: "member_grantor",
      now,
      selectedVaultShareProjectionKinds: [],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: true,
      grantedVaultShareProjectionKinds: [],
      membershipId: "membership_existing",
      revokedVaultShareProjectionKinds: ["sleep-times.v0"],
      vaultShareCleanupSignals: [{
        mailboxItemId: "mailbox_item_revoke_1",
        memberId: "member_group_runtime",
      }],
    });

    expect(mocks.revokeHostedVaultSharesWithCleanupTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionKinds: ["sleep-times.v0"],
      tx,
    });
  });
});

describe("createHostedGroupJoinLinkForOwnedThreadContainerTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
  });

  it("requires the signed-in actor to own the thread container", async () => {
    const tx = buildGroupLinkTx({ ownerMemberId: "member_owner" });

    await expect(createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: "member_other",
      containerMemberId: "member_group_runtime",
      now: new Date("2026-07-01T00:00:00.000Z"),
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_OWNER_REQUIRED",
      httpStatus: 403,
    });

    expect(tx.hostedGroup.create).not.toHaveBeenCalled();
    expect(tx.hostedGroup.update).not.toHaveBeenCalled();
  });

  it("creates or reads a join link through the owner-authorized path", async () => {
    const tx = buildGroupLinkTx({
      joinCode: null,
      ownerMemberId: "member_owner",
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: "member_owner",
      containerMemberId: "member_group_runtime",
      displayName: "Sunday sleep crew",
      kind: "friends",
      now,
      requestedVaultShareProjectionKinds: ["sleep-times.v0"],
      tx,
    })).resolves.toEqual({
      group: {
        displayName: "Sunday sleep crew",
        id: "group_1",
        kind: "friends",
        memberCount: 1,
        requestedVaultShareProjectionKinds: ["sleep-times.v0"],
        status: "active",
      },
      joinCode: "join_created",
    });

    expect(tx.hostedGroup.update).toHaveBeenCalledWith({
      data: {
        joinCode: expect.any(String),
        joinCodeCreatedAt: now,
      },
      select: { joinCode: true },
      where: { id: "group_1" },
    });
  });
});

function buildGroupLinkTx(input: {
  joinCode?: string | null;
  ownerMemberId: string;
}): Prisma.TransactionClient & {
  hostedGroup: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  hostedGroupMember: {
    upsert: ReturnType<typeof vi.fn>;
  };
} {
  return {
    $queryRaw: vi.fn(async () => []),
    hostedGroup: {
      create: vi.fn(),
      findUnique: vi.fn(async (args: {
        select?: { joinCode?: boolean; ownerMemberId?: boolean };
        where: { id?: string; runtimeMemberId?: string };
      }) => {
        if (args.where.runtimeMemberId) {
          return { id: "group_1" };
        }
        if (args.where.id && args.select?.joinCode) {
          return {
            id: "group_1",
            joinCode: input.joinCode ?? null,
            ownerMemberId: input.ownerMemberId,
          };
        }
        if (args.where.id) {
          return {
            _count: { members: 1 },
            displayName: "Sunday sleep crew",
            id: "group_1",
            joinPolicyJson: {
              requestedVaultShareProjectionKinds: ["sleep-times.v0"],
              schema: "murph.hosted-group.join-policy.v1",
            },
            kind: "friends",
            runtimeMemberId: "member_group_runtime",
          };
        }
        return null;
      }),
      update: vi.fn(async () => ({ joinCode: "join_created" })),
    },
    hostedGroupMember: {
      upsert: vi.fn(async () => undefined),
    },
    hostedThreadContainer: {
      findUnique: vi.fn(async () => ({
        memberId: "member_group_runtime",
        ownerMemberId: input.ownerMemberId,
      })),
    },
  } as unknown as Prisma.TransactionClient & {
    hostedGroup: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    hostedGroupMember: {
      upsert: ReturnType<typeof vi.fn>;
    };
  };
}
