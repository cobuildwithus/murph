import { Prisma, type PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS } from "@murphai/hosted-execution/vault-share";

import { createPrismaClient } from "@/src/lib/prisma";

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  readHostedMemberIdentity: mocks.readHostedMemberIdentity,
}));

import {
  acceptHostedGroupJoinCodeTx,
  acceptHostedGroupJoinOfferTx,
  createHostedGroupJoinLinkForOwnedThreadContainerTx,
  HOSTED_GROUP_VAULT_SHARE_DESTINATION_LIMIT_PER_PROJECTION,
  HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION,
  recordHostedGroupJoinOfferTx,
} from "@/src/lib/hosted-groups/group-store";
import {
  normalizeHostedVaultShareProjectionKinds,
} from "@/src/lib/hosted-groups/join-policy";

const JOIN_POLICY = {
  requestedVaultShareProjectionKinds: ["sleep-times.v0"],
  schema: "murph.hosted-group.join-policy.v1",
};

function createPrismaStub<T extends Record<string, unknown>>(delegates: T): PrismaClient & T {
  const prisma = createPrismaClient({
    databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
  });
  for (const [key, value] of Object.entries(delegates)) {
    Object.defineProperty(prisma, key, {
      configurable: true,
      value,
    });
  }
  return prisma as PrismaClient & T;
}

function buildTx(input?: {
  activeShareAlreadyExists?: boolean;
  activeDestinationGrantCount?: number;
  activeGroupGrantCount?: number;
  existingMembershipId?: string | null;
  runtimeMemberId?: string | null;
}): PrismaClient & {
  hostedGroup: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  hostedThreadRoute: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  hostedVaultShare: {
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
} {
  return createPrismaStub({
    $queryRaw: vi.fn(async () => []),
    hostedGroup: {
      findUnique: vi.fn(async (args: {
        where: { id?: string; joinCode?: string; joinOfferMessageLookupKey?: string };
      }) => {
        if (args.where.joinCode) {
          return { id: "group_1" };
        }
        if (args.where.joinOfferMessageLookupKey) {
          return { id: "group_1" };
        }
        if (args.where.id) {
          return {
            id: "group_1",
            joinCode: "join_1",
            joinOfferMessageLookupKey: "hbidx:linq-message:v1:offer",
            joinOfferProjectionKindsJson: ["sleep-times.v0"],
            joinPolicyJson: JOIN_POLICY,
            runtimeMemberId: input?.runtimeMemberId === undefined
              ? "member_group_runtime"
              : input.runtimeMemberId,
          };
        }
        return null;
      }),
      update: vi.fn(async () => ({})),
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
    hostedThreadRoute: {
      findFirst: vi.fn(async () => ({ containerMemberId: "member_group_runtime" })),
    },
    hostedVaultShare: {
      count: vi.fn(async (args: {
        where: { destinationMemberId?: string; projectionKind?: string };
      }) => {
        if (args.where.projectionKind === "profile-name.v0") {
          return 0;
        }
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
  });
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

  it("requires launch consent and grants the profile name on every join", async () => {
    const tx = buildTx();
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(acceptHostedGroupJoinCodeTx({
      joinCode: "join_1",
      memberId: "member_joiner",
      now,
      selectedVaultShareProjectionKinds: [],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0"],
      membershipId: "membership_created",
    });

    expect(mocks.hasHostedRuntimeActiveAccess).toHaveBeenCalledWith(
      "member_group_runtime",
      expect.anything(),
    );
    // Joining always shares the typed profile display name, so consent gates
    // every join, and the only automatic grant is profile-name.v0.
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledTimes(1);
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledTimes(1);
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_joiner",
      now,
      projectionKind: "profile-name.v0",
      tx,
    });
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
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectionKind: "sleep-times.v0" }),
    );
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
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectionKind: "sleep-times.v0" }),
    );
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
      grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-times.v0"],
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
      grantedVaultShareProjectionKinds: ["profile-name.v0"],
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

  it("records join-offer bindings as message lookup keys and projection snapshots", async () => {
    const tx = buildTx();
    const postedAt = new Date("2026-07-01T00:00:00.000Z");

    await expect(recordHostedGroupJoinOfferTx({
      groupId: "group_1",
      messageId: "msg_offer_123",
      postedAt,
      projectionKinds: ["sleep-times.v0", "profile-name.v0"],
      tx,
    })).resolves.toMatchObject({
      groupId: "group_1",
      messageIdSuffix: expect.stringContaining("123"),
      messageLookupKey: expect.stringMatching(/^hbidx:linq-message:/u),
      projectionKinds: ["sleep-times.v0"],
    });

    expect(tx.hostedGroup.update).toHaveBeenCalledWith({
      data: {
        joinOfferMessageIdSuffix: expect.stringContaining("123"),
        joinOfferMessageLookupKey: expect.stringMatching(/^hbidx:linq-message:/u),
        joinOfferPostedAt: postedAt,
        joinOfferProjectionKindsJson: ["sleep-times.v0"],
      },
      where: { id: "group_1" },
    });
  });

  it("accepts a live join offer additively without revoking unselected group shares", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(acceptHostedGroupJoinOfferTx({
      memberId: "member_grantor",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      now,
      threadIdentityLookupKey: "hbidx:external-thread-identity:v1:thread",
      tx,
    })).resolves.toMatchObject({
      alreadyMember: true,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-times.v0"],
      joinCode: "join_1",
      membershipId: "membership_existing",
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
    });

    expect(tx.hostedThreadRoute.findFirst).toHaveBeenCalledWith({
      select: { containerMemberId: true },
      where: {
        channel: "linq",
        containerMemberId: "member_group_runtime",
        threadIdentityLookupKey: "hbidx:external-thread-identity:v1:thread",
      },
    });
    expect(mocks.revokeHostedVaultSharesWithCleanupTx).not.toHaveBeenCalled();
  });
});

describe("createHostedGroupJoinLinkForOwnedThreadContainerTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.grantHostedVaultShareTx.mockResolvedValue(undefined);
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.readHostedMemberIdentity.mockResolvedValue({ phoneNumber: "+15551110000" });
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
        members: [
          {
            grantedVaultShareProjectionKinds: ["profile-name.v0"],
            handle: "+15551110000",
            memberId: "member_owner",
            role: "owner",
          },
        ],
        requestedVaultShareProjectionKinds: ["sleep-times.v0"],
        status: "active",
      },
      joinCode: "join_created",
    });

    expect(tx.hostedGroup.update).toHaveBeenCalledWith({
      data: {
        joinCode: expect.any(String),
        joinCodeCreatedAt: now,
        joinOfferMessageIdSuffix: null,
        joinOfferMessageLookupKey: null,
        joinOfferPostedAt: null,
        joinOfferProjectionKindsJson: Prisma.DbNull,
      },
      select: { joinCode: true },
      where: { id: "group_1" },
    });
  });
});

function buildGroupLinkTx(input: {
  joinCode?: string | null;
  ownerMemberId: string;
}): PrismaClient & {
  hostedGroup: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  hostedGroupMember: {
    upsert: ReturnType<typeof vi.fn>;
  };
} {
  return createPrismaStub({
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
            displayName: "Sunday sleep crew",
            id: "group_1",
            joinPolicyJson: {
              requestedVaultShareProjectionKinds: ["sleep-times.v0"],
              schema: "murph.hosted-group.join-policy.v1",
            },
            kind: "friends",
            members: [{ memberId: input.ownerMemberId, role: "owner" }],
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
    hostedVaultShare: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => [
        {
          grantorMemberId: input.ownerMemberId,
          projectionKind: "profile-name.v0",
        },
      ]),
      findUnique: vi.fn(async () => null),
    },
    hostedThreadContainer: {
      findUnique: vi.fn(async () => ({
        memberId: "member_group_runtime",
        ownerMemberId: input.ownerMemberId,
      })),
    },
  });
}


describe("normalizeHostedVaultShareProjectionKinds", () => {
  it("keeps selectable health kinds and silently drops the membership-implied profile name", () => {
    expect(normalizeHostedVaultShareProjectionKinds([
      "profile-name.v0",
      ...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
      "not-a-kind",
    ])).toEqual([...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS]);
  });
});
