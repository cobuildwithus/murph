import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  grantHostedVaultShareTx: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  readActiveHostedVaultShareProjectionKinds: vi.fn(),
  revokeHostedVaultSharesTx: vi.fn(),
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
  revokeHostedVaultSharesTx: mocks.revokeHostedVaultSharesTx,
}));

import {
  acceptHostedGroupJoinCodeTx,
  createHostedGroupJoinLinkForOwnedThreadContainerTx,
  HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION,
} from "@/src/lib/hosted-groups/group-store";

const JOIN_POLICY = {
  requestedVaultShareProjectionKinds: ["sleep-times.v0"],
  schema: "murph.hosted-group.join-policy.v1",
};

function buildTx(input?: {
  activeShareAlreadyExists?: boolean;
  activeGroupGrantCount?: number;
  existingMembershipId?: string | null;
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
            runtimeMemberId: "member_group_runtime",
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
      count: vi.fn(async () => {
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
    mocks.revokeHostedVaultSharesTx.mockResolvedValue(0);
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
        source: "hosted-group.join",
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
      source: "hosted-group.join",
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
