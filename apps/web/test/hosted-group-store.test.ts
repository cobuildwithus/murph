import { Prisma, type PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  hostedVaultShareProjectionKindToScope,
  type HostedVaultShareFixedProjectionKind,
} from "@murphai/hosted-execution/vault-share";

import { createPrismaClient } from "@/src/lib/prisma";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  grantHostedVaultShareTx: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  readActiveHostedVaultShareProjectionScopes: vi.fn(),
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
  readActiveHostedVaultShareProjectionScopes: mocks.readActiveHostedVaultShareProjectionScopes,
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

const PROFILE_SCOPE = hostedVaultShareProjectionKindToScope("profile-name.v0");
const GROUP_EMAIL_SCOPE = hostedVaultShareProjectionKindToScope("group-email.v0");
const SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("sleep-times.v0");
const ACTIVITY_SCOPE = hostedVaultShareProjectionKindToScope("activity-days.v0");

const JOIN_POLICY = {
  requestedVaultShareProjectionKinds: ["sleep-times.v0"],
  schema: "murph.hosted-group.join-policy.v1",
};

const TEST_KEYRING_ENTRIES = {
  v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
  v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
} as const;

let restoreKeyring: (() => void) | null = null;

afterEach(() => {
  restoreKeyring?.();
  restoreKeyring = null;
});

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
  offerMessageLookupKey?: string;
  revokedOfferAt?: Date | null;
  runtimeMemberId?: string | null;
  threadIdentityLookupKey?: string;
}): PrismaClient & {
  hostedGroup: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  hostedGroupJoinOffer: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
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
        where: { id?: string; joinCode?: string };
      }) => {
        if (args.where.joinCode) {
          return { id: "group_1" };
        }
        if (args.where.id) {
          return {
            id: "group_1",
            joinCode: "join_1",
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
    hostedGroupJoinOffer: {
      create: vi.fn(async () => ({})),
      findFirst: vi.fn(async (args: {
        where: { messageLookupKey?: string | { in?: string[] }; revokedAt?: null };
      }) => {
        const messageLookupKey = input?.offerMessageLookupKey ?? "hbidx:linq-message:v1:offer";
        const lookup = args.where.messageLookupKey;
        const matches = typeof lookup === "string"
          ? lookup === messageLookupKey
          : lookup?.in?.includes(messageLookupKey);
        if (matches && (!("revokedAt" in args.where) || input?.revokedOfferAt == null)) {
          return {
            groupId: "group_1",
            messageLookupKey,
            projectionKindsJson: ["sleep-times.v0"],
            revokedAt: input?.revokedOfferAt ?? null,
            group: {
              id: "group_1",
              joinCode: "join_1",
              runtimeMemberId: input?.runtimeMemberId === undefined
                ? "member_group_runtime"
                : input.runtimeMemberId,
            },
          };
        }
        return null;
      }),
      findUnique: vi.fn(async (args: {
        where: { messageLookupKey?: string };
      }) => {
        const messageLookupKey = input?.offerMessageLookupKey ?? "hbidx:linq-message:v1:offer";
        if (args.where.messageLookupKey === messageLookupKey) {
          return {
            groupId: "group_1",
            messageLookupKey,
            projectionKindsJson: ["sleep-times.v0"],
            revokedAt: input?.revokedOfferAt ?? null,
            group: {
              id: "group_1",
              joinCode: "join_1",
              runtimeMemberId: input?.runtimeMemberId === undefined
                ? "member_group_runtime"
                : input.runtimeMemberId,
            },
          };
        }
        return null;
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
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
      findFirst: vi.fn(async (args?: {
        where?: { threadIdentityLookupKey?: string | { in?: string[] } };
      }) => {
        const threadIdentityLookupKey = input?.threadIdentityLookupKey
          ?? "hbidx:external-thread-identity:v1:thread";
        const lookup = args?.where?.threadIdentityLookupKey;
        const matches = typeof lookup === "string"
          ? lookup === threadIdentityLookupKey
          : lookup?.in?.includes(threadIdentityLookupKey) ?? true;
        return matches ? { containerMemberId: "member_group_runtime" } : null;
      }),
    },
    hostedVaultShare: {
      count: vi.fn(async (args: {
        where: { destinationMemberId?: string; projectionScopeKey?: string };
      }) => {
        if (args.where.projectionScopeKey === "profile-name.v0") {
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
      projectionScope: PROFILE_SCOPE,
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
        projectionScopeKey: "sleep-times.v0",
        status: "granted",
      },
    });
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectionScope: SLEEP_SCOPE }),
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
        projectionScopeKey: "sleep-times.v0",
        status: "granted",
      },
    });
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectionScope: SLEEP_SCOPE }),
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
      projectionScope: SLEEP_SCOPE,
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
      projectionScopes: [SLEEP_SCOPE],
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
      projectionScopes: [SLEEP_SCOPE],
    });

    expect(tx.hostedGroupJoinOffer.create).toHaveBeenCalledWith({
      data: {
        groupId: "group_1",
        id: expect.stringMatching(/^hgrpjo_/u),
        messageIdSuffix: expect.stringContaining("123"),
        messageLookupKey: expect.stringMatching(/^hbidx:linq-message:/u),
        postedAt,
        projectionKindsJson: [SLEEP_SCOPE],
      },
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
      messageLookupKeyReadCandidates: ["hbidx:linq-message:v1:offer"],
      now,
      threadIdentityLookupKeyReadCandidates: ["hbidx:external-thread-identity:v1:thread"],
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
        threadIdentityLookupKey: {
          in: ["hbidx:external-thread-identity:v1:thread"],
        },
      },
    });
    expect(mocks.revokeHostedVaultSharesWithCleanupTx).not.toHaveBeenCalled();
  });

  it("accepts a join-offer reaction matched by prior-version message and thread identity lookup candidates", async () => {
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: { ...TEST_KEYRING_ENTRIES },
    });
    const storedMessageLookupKey = createHostedLinqMessageLookupKey("msg_offer_123");
    const storedThreadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_1",
    });
    if (!storedMessageLookupKey || !storedThreadIdentityLookupKey) {
      throw new Error("Expected prior-version lookup keys.");
    }

    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";
    clearHostedOnboardingEnvCache();
    const tx = buildTx({
      activeGroupGrantCount: 0,
      offerMessageLookupKey: storedMessageLookupKey,
      threadIdentityLookupKey: storedThreadIdentityLookupKey,
    });
    const now = new Date("2026-07-01T00:00:00.000Z");
    const messageLookupKeyReadCandidates =
      createHostedLinqMessageLookupKeyReadCandidates("msg_offer_123");
    const threadIdentityLookupKeyReadCandidates =
      createHostedExternalThreadIdentityLookupKeyReadCandidates({
        channel: "linq",
        threadId: "chat_group_1",
      });

    await expect(acceptHostedGroupJoinOfferTx({
      memberId: "member_grantor",
      messageLookupKeyReadCandidates,
      now,
      threadIdentityLookupKeyReadCandidates,
      tx,
    })).resolves.toMatchObject({
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-times.v0"],
      joinCode: "join_1",
      membershipId: "membership_created",
      messageLookupKey: storedMessageLookupKey,
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
    });

    expect(tx.hostedGroupJoinOffer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          messageLookupKey: {
            in: expect.arrayContaining([
              storedMessageLookupKey,
              expect.stringMatching(/^hbidx:linq-message:v2:/u),
            ]),
          },
        }),
      }),
    );
    expect(tx.hostedThreadRoute.findFirst).toHaveBeenCalledWith({
      select: { containerMemberId: true },
      where: {
        channel: "linq",
        containerMemberId: "member_group_runtime",
        threadIdentityLookupKey: {
          in: expect.arrayContaining([
            storedThreadIdentityLookupKey,
            expect.stringMatching(/^hbidx:external-thread-identity:v2:/u),
          ]),
        },
      },
    });
  });

  it("rejects a revoked join offer distinctly from a missing offer", async () => {
    const tx = buildTx({
      revokedOfferAt: new Date("2026-07-01T00:05:00.000Z"),
    });

    await expect(acceptHostedGroupJoinOfferTx({
      memberId: "member_grantor",
      messageLookupKeyReadCandidates: ["hbidx:linq-message:v1:offer"],
      now: new Date("2026-07-01T00:06:00.000Z"),
      threadIdentityLookupKeyReadCandidates: ["hbidx:external-thread-identity:v1:thread"],
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_JOIN_OFFER_REVOKED",
      httpStatus: 410,
    });

    expect(tx.hostedGroupMember.create).not.toHaveBeenCalled();
  });

  it("accepts an older visible offer after a newer offer is posted", async () => {
    const tx = buildStatefulJoinOfferTx();
    const firstPostedAt = new Date("2026-07-01T00:00:00.000Z");
    const secondPostedAt = new Date("2026-07-01T00:05:00.000Z");
    const now = new Date("2026-07-01T00:06:00.000Z");

    const firstOffer = await recordHostedGroupJoinOfferTx({
      groupId: "group_1",
      messageId: "msg_offer_a",
      postedAt: firstPostedAt,
      projectionKinds: ["sleep-times.v0"],
      tx,
    });
    await recordHostedGroupJoinOfferTx({
      groupId: "group_1",
      messageId: "msg_offer_b",
      postedAt: secondPostedAt,
      projectionKinds: ["activity-days.v0"],
      tx,
    });

    await expect(acceptHostedGroupJoinOfferTx({
      memberId: "member_grantor",
      messageLookupKeyReadCandidates: [firstOffer.messageLookupKey],
      now,
      threadIdentityLookupKeyReadCandidates: ["hbidx:external-thread-identity:v1:thread"],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-times.v0"],
      joinCode: "join_1",
      membershipId: "membership_created",
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
    });

    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScope: SLEEP_SCOPE,
      tx,
    });
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectionScope: ACTIVITY_SCOPE }),
    );
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

  it("seeds email authorization as the default requested and owner-granted group projection", async () => {
    const tx = buildGroupLinkTx({
      existingGroup: false,
      grantedProjectionKinds: ["group-email.v0", "profile-name.v0"],
      joinCode: null,
      ownerMemberId: "member_owner",
      requestedProjectionKinds: ["group-email.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: "member_owner",
      containerMemberId: "member_group_runtime",
      now,
      tx,
    })).resolves.toMatchObject({
      group: {
        members: [
          {
            grantedVaultShareProjectionKinds: ["group-email.v0", "profile-name.v0"],
            memberId: "member_owner",
          },
        ],
        requestedVaultShareProjectionKinds: ["group-email.v0"],
      },
      joinCode: "join_created",
    });

    expect(tx.hostedGroup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        joinPolicyJson: {
          requestedVaultShareProjectionKinds: ["group-email.v0"],
          requestedVaultShareProjectionScopes: [GROUP_EMAIL_SCOPE],
          schema: "murph.hosted-group.join-policy.v1",
        },
      }),
    }));
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith(expect.objectContaining({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_owner",
      now,
      projectionScope: PROFILE_SCOPE,
    }));
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith(expect.objectContaining({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_owner",
      now,
      projectionScope: GROUP_EMAIL_SCOPE,
    }));
  });

  it("merges the default email request into existing groups without granting email", async () => {
    const tx = buildGroupLinkTx({
      existingGroup: true,
      grantedProjectionKinds: ["profile-name.v0"],
      joinCode: "join_existing",
      ownerMemberId: "member_owner",
      requestedProjectionKinds: ["sleep-times.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    const first = await createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: "member_owner",
      containerMemberId: "member_group_runtime",
      now,
      tx,
    });
    const second = await createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: "member_owner",
      containerMemberId: "member_group_runtime",
      now,
      tx,
    });

    expect(first.group.requestedVaultShareProjectionKinds).toEqual([
      "group-email.v0",
      "sleep-times.v0",
    ]);
    expect(second.group.requestedVaultShareProjectionKinds).toEqual([
      "group-email.v0",
      "sleep-times.v0",
    ]);
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith(expect.objectContaining({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_owner",
      now,
      projectionScope: PROFILE_SCOPE,
    }));
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalledWith(expect.objectContaining({
      projectionScope: GROUP_EMAIL_SCOPE,
    }));
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
            grantedVaultShareProjectionScopes: [PROFILE_SCOPE],
            handle: "+15551110000",
            memberId: "member_owner",
            role: "owner",
          },
        ],
        requestedVaultShareProjectionKinds: ["group-email.v0", "sleep-times.v0"],
        requestedVaultShareProjectionScopes: [GROUP_EMAIL_SCOPE, SLEEP_SCOPE],
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
    expect(tx.hostedGroupJoinOffer.updateMany).toHaveBeenCalledWith({
      data: { revokedAt: now },
      where: {
        groupId: "group_1",
        revokedAt: null,
      },
    });
  });
});

function buildGroupLinkTx(input: {
  existingGroup?: boolean;
  grantedProjectionKinds?: HostedVaultShareFixedProjectionKind[];
  joinCode?: string | null;
  ownerMemberId: string;
  requestedProjectionKinds?: HostedVaultShareFixedProjectionKind[];
}): PrismaClient & {
  hostedGroup: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  hostedGroupJoinOffer: {
    updateMany: ReturnType<typeof vi.fn>;
  };
  hostedGroupMember: {
    upsert: ReturnType<typeof vi.fn>;
  };
} {
  let requestedProjectionKinds: HostedVaultShareFixedProjectionKind[] =
    input.requestedProjectionKinds ?? ["sleep-times.v0"];
  return createPrismaStub({
    $queryRaw: vi.fn(async () => []),
    hostedGroup: {
      create: vi.fn(async (args: {
        data?: {
          joinPolicyJson?: {
            requestedVaultShareProjectionKinds?: HostedVaultShareFixedProjectionKind[];
          };
        };
      }) => {
        requestedProjectionKinds =
          args.data?.joinPolicyJson?.requestedVaultShareProjectionKinds
          ?? requestedProjectionKinds;
        return { id: "group_1" };
      }),
      findUnique: vi.fn(async (args: {
        select?: { joinCode?: boolean; ownerMemberId?: boolean };
        where: { id?: string; runtimeMemberId?: string };
      }) => {
        if (args.where.runtimeMemberId) {
          return input.existingGroup === false ? null : { id: "group_1" };
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
              requestedVaultShareProjectionKinds: requestedProjectionKinds,
              schema: "murph.hosted-group.join-policy.v1",
            },
            kind: "friends",
            members: [{ memberId: input.ownerMemberId, role: "owner" }],
            runtimeMemberId: "member_group_runtime",
          };
        }
        return null;
      }),
      update: vi.fn(async (args: {
        data?: {
          joinPolicyJson?: {
            requestedVaultShareProjectionKinds?: HostedVaultShareFixedProjectionKind[];
          };
        };
      }) => {
        requestedProjectionKinds =
          args.data?.joinPolicyJson?.requestedVaultShareProjectionKinds
          ?? requestedProjectionKinds;
        return { joinCode: "join_created" };
      }),
    },
    hostedGroupJoinOffer: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    hostedGroupMember: {
      upsert: vi.fn(async () => undefined),
    },
    hostedVaultShare: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () =>
        (input.grantedProjectionKinds ?? ["profile-name.v0"]).map((projectionKind) =>
          buildHostedVaultShareRow(input.ownerMemberId, projectionKind)
        ),
      ),
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

function buildHostedVaultShareRow(
  grantorMemberId: string,
  projectionKind: HostedVaultShareFixedProjectionKind,
): {
  grantorMemberId: string;
  projectionKind: HostedVaultShareFixedProjectionKind;
  projectionScopeJson: { projectionKind: HostedVaultShareFixedProjectionKind };
  projectionScopeKey: string;
} {
  const projectionScope = hostedVaultShareProjectionKindToScope(projectionKind);
  return {
    grantorMemberId,
    projectionKind,
    projectionScopeJson: projectionScope,
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey(projectionScope),
  };
}

function buildStatefulJoinOfferTx(): PrismaClient & {
  hostedGroup: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  hostedGroupJoinOffer: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  hostedThreadRoute: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  hostedVaultShare: {
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
} {
  const group = {
    id: "group_1",
    joinCode: "join_1",
    joinPolicyJson: {
      requestedVaultShareProjectionKinds: ["sleep-times.v0", "activity-days.v0"],
      schema: "murph.hosted-group.join-policy.v1",
    },
    runtimeMemberId: "member_group_runtime",
  };
  const offers: Array<{
    groupId: string;
    messageLookupKey: string;
    projectionKindsJson: Prisma.InputJsonValue;
    revokedAt: Date | null;
  }> = [];

  return createPrismaStub({
    $queryRaw: vi.fn(async () => []),
    hostedGroup: {
      findUnique: vi.fn(async (args: {
        where: { id?: string };
      }) => {
        if (args.where.id) {
          return { ...group };
        }
        return null;
      }),
    },
    hostedGroupJoinOffer: {
      create: vi.fn(async (args: {
        data: {
          groupId: string;
          messageLookupKey: string;
          projectionKindsJson: Prisma.InputJsonValue;
        };
      }) => {
        offers.push({
          groupId: args.data.groupId,
          messageLookupKey: args.data.messageLookupKey,
          projectionKindsJson: args.data.projectionKindsJson,
          revokedAt: null,
        });
        return {};
      }),
      findUnique: vi.fn(async (args: {
        where: { messageLookupKey?: string };
      }) => {
        const offer = offers.find((entry) =>
          entry.messageLookupKey === args.where.messageLookupKey);
        return offer
          ? {
              groupId: offer.groupId,
              messageLookupKey: offer.messageLookupKey,
              projectionKindsJson: offer.projectionKindsJson,
              revokedAt: offer.revokedAt,
              group,
            }
          : null;
      }),
      findFirst: vi.fn(async (args: {
        where: { messageLookupKey?: string | { in?: string[] }; revokedAt?: null };
      }) => {
        const lookup = args.where.messageLookupKey;
        const offer = offers.find((entry) =>
          typeof lookup === "string"
            ? entry.messageLookupKey === lookup
            : lookup?.in?.includes(entry.messageLookupKey));
        if (!offer || ("revokedAt" in args.where && offer.revokedAt !== null)) {
          return null;
        }
        return {
          groupId: offer.groupId,
          messageLookupKey: offer.messageLookupKey,
          projectionKindsJson: offer.projectionKindsJson,
          revokedAt: offer.revokedAt,
          group,
        };
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    hostedGroupMember: {
      create: vi.fn(async () => ({ id: "membership_created" })),
      findUnique: vi.fn(async () => null),
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
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => null),
    },
  });
}

function configureHostedContactPrivacyKeyringForTest(input: {
  currentVersion: string;
  entries: Record<string, string>;
}): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousCurrentVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousCurrentVersion);
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
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
