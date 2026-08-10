import { Prisma, type PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  hostedVaultShareProjectionKindToScope,
  type HostedVaultShareFixedProjectionKind,
} from "@murphai/hosted-execution/vault-share";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedEmailLookupKey,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
  createHostedTelegramUserLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({
  appendHostedGroupJoinConfirmationTx: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  grantHostedVaultShareTx: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  readActiveHostedVaultShareProjectionScopes: vi.fn(),
  revokeHostedVaultSharesTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  appendHostedGroupJoinConfirmationTx: mocks.appendHostedGroupJoinConfirmationTx,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  HOSTED_HEALTH_DATA_CONSENT_SCOPE: "launch.health-data",
  assertHostedHistoricalLaunchConsentGranted: mocks.assertHostedHistoricalLaunchConsentGranted,
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
  hostedHealthDataConsentNotRevokedWhere: () => ({
    consentGrants: {
      none: {
        scope: "launch.health-data",
        status: "revoked",
      },
    },
  }),
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccess: mocks.hasHostedRuntimeActiveAccess,
}));

vi.mock("@/src/lib/hosted-vault-share/share-grant-store", () => ({
  grantHostedVaultShareTx: mocks.grantHostedVaultShareTx,
  readActiveHostedVaultShareProjectionScopes: mocks.readActiveHostedVaultShareProjectionScopes,
  revokeHostedVaultSharesTx: mocks.revokeHostedVaultSharesTx,
}));

import {
  acceptHostedGroupJoinCodeTx,
  acceptHostedGroupJoinOfferTx,
  createHostedGroupJoinLinkForOwnedThreadContainerTx,
  HOSTED_GROUP_ACTIVE_JOIN_OFFER_SCAN_MAX,
  HOSTED_GROUP_VAULT_SHARE_DESTINATION_LIMIT_PER_PROJECTION,
  HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION,
  leaveHostedGroupMemberTx,
  prepareHostedGroupJoinOfferPostTx,
  readHostedGroupJoinView,
  readHostedGroupSharedDataByRuntimeMemberId,
  readHostedGroupMembershipsForMember,
  recordHostedGroupJoinOfferTx,
} from "@/src/lib/hosted-groups/group-store";
import {
  normalizeHostedVaultShareProjectionKinds,
} from "@/src/lib/hosted-groups/join-policy";

const PROFILE_SCOPE = hostedVaultShareProjectionKindToScope("profile-name.v0");
const GROUP_EMAIL_SCOPE = hostedVaultShareProjectionKindToScope("group-email.v0");
const SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("sleep-times.v0");
const SLEEP_DURATION_SCOPE = hostedVaultShareProjectionKindToScope("sleep-duration-days.v0");
const LEGACY_DEEP_SLEEP_SCOPE = hostedVaultShareProjectionKindToScope(
  "deep-sleep-days.v0",
);
const DEEP_SLEEP_SOURCES_SCOPE = hostedVaultShareProjectionKindToScope(
  "deep-sleep-sources-days.v1",
);
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
  membershipState?: {
    membershipId: string | null;
    nextMembershipId?: string;
  };
  offerMessageLookupKey?: string;
  offerProjectionKinds?: string[];
  requestedProjectionKinds?: string[];
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
            displayName: "Weekend Runners",
            id: "group_1",
            joinCode: "join_1",
            joinPolicyJson: input?.requestedProjectionKinds
              ? {
                  ...JOIN_POLICY,
                  requestedVaultShareProjectionKinds: input.requestedProjectionKinds,
                }
              : JOIN_POLICY,
            ownerMemberId: "member_owner",
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
            projectionKindsJson: input?.offerProjectionKinds ?? ["sleep-times.v0"],
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
            projectionKindsJson: input?.offerProjectionKinds ?? ["sleep-times.v0"],
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
      create: vi.fn(async () => {
        const membershipId = input?.membershipState?.nextMembershipId ?? "membership_created";
        if (input?.membershipState) {
          input.membershipState.membershipId = membershipId;
        }
        return { id: membershipId };
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        if (input?.membershipState?.membershipId === args.where.id) {
          input.membershipState.membershipId = null;
        }
        return {};
      }),
      findUnique: vi.fn(async (args: {
        where: {
          groupId_memberId?: { groupId: string; memberId: string };
          id?: string;
        };
      }) => {
        const membershipId = input?.membershipState
          ? input.membershipState.membershipId
          : input?.existingMembershipId ?? null;
        if (!membershipId) {
          return null;
        }
        if (args.where.id) {
          return args.where.id === membershipId
            ? { groupId: "group_1", memberId: "member_joiner" }
            : null;
        }
        return { id: membershipId };
      }),
      update: vi.fn(async () => ({})),
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
    mocks.appendHostedGroupJoinConfirmationTx.mockResolvedValue({
      kind: "terminal-skip",
    });
    mocks.assertHostedHistoricalLaunchConsentGranted.mockResolvedValue(undefined);
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.grantHostedVaultShareTx.mockResolvedValue(undefined);
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.readActiveHostedVaultShareProjectionScopes.mockResolvedValue([]);
    mocks.revokeHostedVaultSharesTx.mockResolvedValue(0);
  });

  it("rejects membership when the group runtime is inactive even with no selected permissions", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);
    const tx = buildTx();

    await expect(acceptHostedGroupJoinCodeTx({
      expectedMembershipId: null,
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
      expectedMembershipId: null,
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
      expectedMembershipId: null,
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
    // Joining always shares the memory-backed preferred display name, so consent gates
    // every join, and the only automatic grant is profile-name.v0.
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledTimes(1);
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).not.toHaveBeenCalled();
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledTimes(1);
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_joiner",
      now,
      projectionScope: PROFILE_SCOPE,
      tx,
    });
  });

  it("appends a private confirmation in the first membership transaction", async () => {
    const tx = buildTx();
    const now = new Date("2026-07-01T00:00:00.000Z");
    mocks.appendHostedGroupJoinConfirmationTx.mockResolvedValue({
      kind: "appended",
      signal: {
        mailboxItemId: "mailbox_item_join_confirmation_1",
        memberId: "member_joiner",
      },
    });

    await expect(acceptHostedGroupJoinCodeTx({
      confirmationPublicBaseUrl: "https://murph.example",
      expectedMembershipId: null,
      joinCode: "join_1",
      memberId: "member_joiner",
      now,
      selectedVaultShareProjectionKinds: [],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: false,
      joinConfirmationSignal: {
        mailboxItemId: "mailbox_item_join_confirmation_1",
        memberId: "member_joiner",
      },
      membershipId: "membership_created",
    });

    expect(mocks.appendHostedGroupJoinConfirmationTx).toHaveBeenCalledWith({
      groupDisplayName: "Weekend Runners",
      joinCode: "join_1",
      joinOrigin: "web",
      memberId: "member_joiner",
      membershipId: "membership_created",
      occurredAt: now,
      publicBaseUrl: "https://murph.example",
      tx,
    });
    expect(tx.hostedGroupMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        joinConfirmationEligibleAt: now,
        joinConfirmationOrigin: "web",
        role: "member",
      }),
      select: { id: true },
    });
    expect(tx.hostedGroupMember.update).toHaveBeenCalledWith({
      data: {
        joinConfirmationEligibleAt: null,
        joinConfirmationOrigin: null,
      },
      where: { id: "membership_created" },
    });
  });

  it("propagates a confirmation append failure so the enclosing transaction can roll back", async () => {
    const tx = buildTx();
    const appendError = new Error("mailbox append failed");
    mocks.appendHostedGroupJoinConfirmationTx.mockRejectedValueOnce(appendError);

    await expect(acceptHostedGroupJoinCodeTx({
      confirmationPublicBaseUrl: "https://murph.example",
      expectedMembershipId: null,
      joinCode: "join_1",
      memberId: "member_joiner",
      now: new Date("2026-07-01T00:00:00.000Z"),
      selectedVaultShareProjectionKinds: [],
      tx,
    })).rejects.toBe(appendError);

    expect(tx.hostedGroupMember.create).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedGroupJoinConfirmationTx).toHaveBeenCalledWith(
      expect.objectContaining({ tx }),
    );
    expect(tx.hostedGroupMember.update).not.toHaveBeenCalled();
  });

  it("records eligibility when a safe private route is still missing", async () => {
    const tx = buildTx();
    const now = new Date("2026-07-01T00:00:00.000Z");
    mocks.appendHostedGroupJoinConfirmationTx.mockResolvedValueOnce({
      kind: "deferred",
      reason: "private-route",
    });

    const result = await acceptHostedGroupJoinCodeTx({
      confirmationPublicBaseUrl: "https://murph.example",
      expectedMembershipId: null,
      joinCode: "join_1",
      memberId: "member_joiner",
      now,
      selectedVaultShareProjectionKinds: [],
      tx,
    });
    expect(result).toMatchObject({
      membershipId: "membership_created",
    });
    expect(result).not.toHaveProperty("joinConfirmationSignal");

    expect(tx.hostedGroupMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        joinConfirmationEligibleAt: now,
        joinConfirmationOrigin: "web",
      }),
      select: { id: true },
    });
    expect(tx.hostedGroupMember.update).not.toHaveBeenCalled();
  });

  it("does not retain eligibility after a terminal confirmation skip", async () => {
    const tx = buildTx();
    const now = new Date("2026-07-01T00:00:00.000Z");

    await acceptHostedGroupJoinCodeTx({
      confirmationPublicBaseUrl: "https://murph.example",
      expectedMembershipId: null,
      joinCode: "join_1",
      memberId: "member_joiner",
      now,
      selectedVaultShareProjectionKinds: [],
      tx,
    });

    expect(tx.hostedGroupMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        joinConfirmationEligibleAt: now,
        joinConfirmationOrigin: "web",
      }),
      select: { id: true },
    });
    expect(tx.hostedGroupMember.update).toHaveBeenCalledWith({
      data: {
        joinConfirmationEligibleAt: null,
        joinConfirmationOrigin: null,
      },
      where: { id: "membership_created" },
    });
  });

  it("does not append another join confirmation for an existing membership", async () => {
    const tx = buildTx({ existingMembershipId: "membership_existing" });

    await expect(acceptHostedGroupJoinCodeTx({
      confirmationPublicBaseUrl: "https://murph.example",
      expectedMembershipId: "membership_existing",
      joinCode: "join_1",
      memberId: "member_joiner",
      now: new Date("2026-07-01T00:00:00.000Z"),
      selectedVaultShareProjectionKinds: [],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: true,
      membershipId: "membership_existing",
    });

    expect(mocks.appendHostedGroupJoinConfirmationTx).not.toHaveBeenCalled();
    expect(tx.hostedGroupMember.create).not.toHaveBeenCalled();
    expect(tx.hostedGroupMember.update).not.toHaveBeenCalled();
  });

  it.each([
    ["membership_old", null],
    ["membership_old", "membership_rejoined"],
    [null, "membership_existing"],
  ] as const)(
    "rejects rendered membership %s when the locked membership is %s",
    async (expectedMembershipId, existingMembershipId) => {
      const tx = buildTx({ existingMembershipId });

      await expect(acceptHostedGroupJoinCodeTx({
        expectedMembershipId,
        joinCode: "join_1",
        memberId: "member_joiner",
        now: new Date("2026-07-15T12:00:00.000Z"),
        selectedVaultShareProjectionKinds: [],
        tx,
      })).rejects.toMatchObject({
        code: "HOSTED_GROUP_MEMBERSHIP_CHANGED",
        httpStatus: 409,
        retryable: false,
      });

      expect(tx.hostedGroupMember.create).not.toHaveBeenCalled();
      expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
      expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalled();
      expect(mocks.revokeHostedVaultSharesTx).not.toHaveBeenCalled();
    },
  );

  it("serializes stale save, leave, and explicit rejoin by membership row identity", async () => {
    const membershipState = {
      membershipId: "membership_existing" as string | null,
      nextMembershipId: "membership_rejoined",
    };
    let markStaleSaveBlocked!: () => void;
    const staleSaveBlocked = new Promise<void>((resolve) => {
      markStaleSaveBlocked = resolve;
    });
    let releaseStaleSave!: () => void;
    const staleSaveBarrier = new Promise<void>((resolve) => {
      releaseStaleSave = resolve;
    });
    const staleSaveTx = buildTx({ membershipState });
    staleSaveTx.hostedGroup.findUnique.mockImplementationOnce(async () => {
      markStaleSaveBlocked();
      await staleSaveBarrier;
      return { id: "group_1" };
    });
    const staleSave = acceptHostedGroupJoinCodeTx({
      expectedMembershipId: "membership_existing",
      joinCode: "join_1",
      memberId: "member_joiner",
      now: new Date("2026-07-15T12:00:00.000Z"),
      selectedVaultShareProjectionKinds: [],
      tx: staleSaveTx,
    });
    await staleSaveBlocked;

    const leaveFirstTx = buildTx({ membershipState });
    await expect(leaveHostedGroupMemberTx({
      memberId: "member_joiner",
      membershipId: "membership_existing",
      now: new Date("2026-07-15T12:00:01.000Z"),
      tx: leaveFirstTx,
    })).resolves.toMatchObject({ kind: "left" });
    expect(membershipState.membershipId).toBeNull();

    vi.clearAllMocks();
    releaseStaleSave();
    await expect(staleSave).rejects.toMatchObject({
      code: "HOSTED_GROUP_MEMBERSHIP_CHANGED",
      httpStatus: 409,
    });
    expect(membershipState.membershipId).toBeNull();
    expect(staleSaveTx.hostedGroupMember.create).not.toHaveBeenCalled();
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalled();

    const rejoinTx = buildTx({ membershipState });
    await expect(acceptHostedGroupJoinCodeTx({
      expectedMembershipId: null,
      joinCode: "join_1",
      memberId: "member_joiner",
      now: new Date("2026-07-15T12:00:02.000Z"),
      selectedVaultShareProjectionKinds: [],
      tx: rejoinTx,
    })).resolves.toMatchObject({
      alreadyMember: false,
      membershipId: "membership_rejoined",
    });
    expect(membershipState.membershipId).toBe("membership_rejoined");

    const saveFirstTx = buildTx({ membershipState });
    await expect(acceptHostedGroupJoinCodeTx({
      expectedMembershipId: "membership_rejoined",
      joinCode: "join_1",
      memberId: "member_joiner",
      now: new Date("2026-07-15T12:00:03.000Z"),
      selectedVaultShareProjectionKinds: [],
      tx: saveFirstTx,
    })).resolves.toMatchObject({
      alreadyMember: true,
      membershipId: "membership_rejoined",
    });

    const leaveAfterSaveTx = buildTx({ membershipState });
    await expect(leaveHostedGroupMemberTx({
      memberId: "member_joiner",
      membershipId: "membership_rejoined",
      now: new Date("2026-07-15T12:00:04.000Z"),
      tx: leaveAfterSaveTx,
    })).resolves.toMatchObject({ kind: "left" });
    expect(membershipState.membershipId).toBeNull();
  });

  it("reports email sharing when a join grants it", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      requestedProjectionKinds: ["group-email.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(acceptHostedGroupJoinCodeTx({
      expectedMembershipId: null,
      joinCode: "join_1",
      memberId: "member_grantor",
      now,
      selectedVaultShareProjectionKinds: ["group-email.v0"],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "group-email.v0"],
      membershipId: "membership_created",
    });

    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScope: GROUP_EMAIL_SCOPE,
      tx,
    });
  });

  it("refuses to add a group vault-share grant beyond the bounded fan-out cap", async () => {
    const tx = buildTx({
      activeGroupGrantCount: HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION,
    });

    await expect(acceptHostedGroupJoinCodeTx({
      expectedMembershipId: null,
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
      expectedMembershipId: null,
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
      expectedMembershipId: "membership_existing",
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

  it("records revoked scopes when a member unselects a previously granted group share", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
    });
    const now = new Date("2026-07-01T00:00:00.000Z");
    mocks.revokeHostedVaultSharesTx.mockResolvedValue(1);

    await expect(acceptHostedGroupJoinCodeTx({
      expectedMembershipId: "membership_existing",
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
    });

    expect(mocks.revokeHostedVaultSharesTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScopes: [SLEEP_SCOPE],
      tx,
    });
  });

  it("lets an existing member revoke an active grant outside the current request", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
      requestedProjectionKinds: ["sleep-times.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");
    mocks.readActiveHostedVaultShareProjectionScopes.mockResolvedValueOnce([
      GROUP_EMAIL_SCOPE,
      SLEEP_SCOPE,
    ]);
    mocks.revokeHostedVaultSharesTx.mockResolvedValue(1);

    await expect(acceptHostedGroupJoinCodeTx({
      expectedMembershipId: "membership_existing",
      joinCode: "join_1",
      memberId: "member_grantor",
      now,
      selectedVaultShareProjectionScopes: [SLEEP_SCOPE],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: true,
      revokedVaultShareProjectionScopes: [GROUP_EMAIL_SCOPE],
    });

    expect(mocks.readActiveHostedVaultShareProjectionScopes).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      prisma: tx,
    });
    expect(mocks.revokeHostedVaultSharesTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScopes: [GROUP_EMAIL_SCOPE],
      tx,
    });
  });

  it("preserves a selected legacy Deep sleep grant without silently granting v1", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
      requestedProjectionKinds: ["deep-sleep-days.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(acceptHostedGroupJoinCodeTx({
      expectedMembershipId: "membership_existing",
      joinCode: "join_1",
      memberId: "member_grantor",
      now,
      selectedVaultShareProjectionScopes: [LEGACY_DEEP_SLEEP_SCOPE],
      tx,
    })).resolves.toMatchObject({
      revokedVaultShareProjectionScopes: [],
    });

    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectionScope: DEEP_SLEEP_SOURCES_SCOPE }),
    );
    expect(mocks.revokeHostedVaultSharesTx).toHaveBeenCalledTimes(1);
    expect(mocks.revokeHostedVaultSharesTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScopes: [DEEP_SLEEP_SOURCES_SCOPE],
      tx,
    });
    expect(mocks.revokeHostedVaultSharesTx).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectionScopes: [LEGACY_DEEP_SLEEP_SCOPE] }),
    );
    expect(tx.hostedGroup.update).not.toHaveBeenCalled();
  });

  it("atomically replaces a legacy Deep sleep grant on explicit v1 approval", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
      requestedProjectionKinds: ["deep-sleep-days.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");
    mocks.revokeHostedVaultSharesTx.mockResolvedValueOnce(1);

    await expect(acceptHostedGroupJoinCodeTx({
      expectedMembershipId: "membership_existing",
      joinCode: "join_1",
      memberId: "member_grantor",
      now,
      selectedVaultShareProjectionScopes: [DEEP_SLEEP_SOURCES_SCOPE],
      tx,
    })).resolves.toMatchObject({
      grantedVaultShareProjectionScopes: [PROFILE_SCOPE, DEEP_SLEEP_SOURCES_SCOPE],
      revokedVaultShareProjectionScopes: [LEGACY_DEEP_SLEEP_SCOPE],
    });

    expect(mocks.revokeHostedVaultSharesTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScopes: [LEGACY_DEEP_SLEEP_SCOPE],
      tx,
    });
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
      tx,
    });
    expect(tx.hostedGroup.update).toHaveBeenCalledWith({
      data: {
        joinPolicyJson: {
          requestedVaultShareProjectionKinds: [
            "deep-sleep-days.v0",
            "deep-sleep-sources-days.v1",
          ],
          requestedVaultShareProjectionScopes: [
            LEGACY_DEEP_SLEEP_SCOPE,
            DEEP_SLEEP_SOURCES_SCOPE,
          ],
          schema: "murph.hosted-group.join-policy.v1",
        },
      },
      where: { id: "group_1" },
    });
  });

  it("materializes a selected v1 request for a new member under a legacy policy", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      requestedProjectionKinds: ["deep-sleep-days.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(acceptHostedGroupJoinCodeTx({
      expectedMembershipId: null,
      joinCode: "join_1",
      memberId: "member_grantor",
      now,
      selectedVaultShareProjectionScopes: [DEEP_SLEEP_SOURCES_SCOPE],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: false,
      grantedVaultShareProjectionScopes: [PROFILE_SCOPE, DEEP_SLEEP_SOURCES_SCOPE],
    });

    expect(tx.hostedGroup.update).toHaveBeenCalledWith({
      data: {
        joinPolicyJson: {
          requestedVaultShareProjectionKinds: [
            "deep-sleep-days.v0",
            "deep-sleep-sources-days.v1",
          ],
          requestedVaultShareProjectionScopes: [
            LEGACY_DEEP_SLEEP_SCOPE,
            DEEP_SLEEP_SOURCES_SCOPE,
          ],
          schema: "murph.hosted-group.join-policy.v1",
        },
      },
      where: { id: "group_1" },
    });
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
      tx,
    });
  });

  it("revokes both Deep sleep grant versions when the single permission is off", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
      requestedProjectionKinds: ["deep-sleep-days.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");
    mocks.revokeHostedVaultSharesTx
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    await expect(acceptHostedGroupJoinCodeTx({
      expectedMembershipId: "membership_existing",
      joinCode: "join_1",
      memberId: "member_grantor",
      now,
      selectedVaultShareProjectionScopes: [],
      tx,
    })).resolves.toMatchObject({
      revokedVaultShareProjectionScopes: [LEGACY_DEEP_SLEEP_SCOPE],
    });

    expect(mocks.revokeHostedVaultSharesTx).toHaveBeenNthCalledWith(1, {
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScopes: [DEEP_SLEEP_SOURCES_SCOPE],
      tx,
    });
    expect(mocks.revokeHostedVaultSharesTx).toHaveBeenNthCalledWith(2, {
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScopes: [LEGACY_DEEP_SLEEP_SCOPE],
      tx,
    });
    expect(tx.hostedGroup.update).not.toHaveBeenCalled();
  });

  it("keys a Telegram offer on chat and message so ids cannot collide across chats", async () => {
    const tx = buildTx();
    const postedAt = new Date("2026-07-01T00:00:00.000Z");

    const inChat = await recordHostedGroupJoinOfferTx({
      groupId: "group_1",
      message: { channel: "telegram" as const, chatId: "-100777", messageId: "55" },
      postedAt,
      projectionScopes: [SLEEP_SCOPE],
      tx,
    });
    const otherChat = await recordHostedGroupJoinOfferTx({
      groupId: "group_1",
      message: { channel: "telegram" as const, chatId: "-100888", messageId: "55" },
      postedAt,
      projectionScopes: [SLEEP_SCOPE],
      tx,
    });

    expect(inChat.messageLookupKey).toMatch(/^hbidx:telegram-message:/u);
    // Same Telegram message id, different chat: never the same offer.
    expect(inChat.messageLookupKey).not.toBe(otherChat.messageLookupKey);
    // And never collides with a Linq binding.
    expect(inChat.messageLookupKey).not.toMatch(/^hbidx:linq-message:/u);
  });

  it("matches a Telegram acceptance only against a Telegram route", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
      offerMessageLookupKey: "hbidx:telegram-message:v1:offer",
      offerProjectionKinds: ["sleep-duration-days.v0"],
    });
    tx.hostedThreadRoute.findFirst.mockResolvedValue({
      containerMemberId: "member_group_runtime",
    });

    await acceptHostedGroupJoinOfferTx({
      channel: "telegram",
      memberId: "member_grantor",
      messageLookupKeyReadCandidates: ["hbidx:telegram-message:v1:offer"],
      now: new Date("2026-07-01T00:00:00.000Z"),
      threadIdentityLookupKeyReadCandidates: ["hbidx:external-thread-identity:v1:tg"],
      tx,
    });

    expect(tx.hostedThreadRoute.findFirst).toHaveBeenCalledWith({
      select: { containerMemberId: true },
      where: {
        channel: "telegram",
        containerMemberId: "member_group_runtime",
        threadIdentityLookupKey: { in: ["hbidx:external-thread-identity:v1:tg"] },
      },
    });
  });

  it("refuses a Telegram acceptance when no route matches the offer thread", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
      offerMessageLookupKey: "hbidx:telegram-message:v1:offer",
      offerProjectionKinds: ["sleep-duration-days.v0"],
    });
    tx.hostedThreadRoute.findFirst.mockResolvedValue(null);

    await expect(acceptHostedGroupJoinOfferTx({
      channel: "telegram",
      memberId: "member_grantor",
      messageLookupKeyReadCandidates: ["hbidx:telegram-message:v1:offer"],
      now: new Date("2026-07-01T00:00:00.000Z"),
      threadIdentityLookupKeyReadCandidates: ["hbidx:external-thread-identity:v1:wrong"],
      tx,
    })).rejects.toMatchObject({ code: "HOSTED_GROUP_JOIN_OFFER_NOT_FOUND" });

    expect(tx.hostedGroupMember.create).not.toHaveBeenCalled();
  });

  it("refuses an acceptance whose message binding matches no offer", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
      offerProjectionKinds: ["sleep-duration-days.v0"],
    });
    tx.hostedGroupJoinOffer.findFirst.mockResolvedValue(null);

    await expect(acceptHostedGroupJoinOfferTx({
      channel: "telegram",
      memberId: "member_grantor",
      messageLookupKeyReadCandidates: ["hbidx:telegram-message:v1:other-message"],
      now: new Date("2026-07-01T00:00:00.000Z"),
      threadIdentityLookupKeyReadCandidates: ["hbidx:external-thread-identity:v1:tg"],
      tx,
    })).rejects.toMatchObject({ code: "HOSTED_GROUP_JOIN_OFFER_NOT_FOUND" });

    expect(tx.hostedGroupMember.create).not.toHaveBeenCalled();
  });

  it("records join-offer bindings as message lookup keys and projection snapshots", async () => {
    const tx = buildTx();
    const postedAt = new Date("2026-07-01T00:00:00.000Z");

    await expect(recordHostedGroupJoinOfferTx({
      groupId: "group_1",
      message: { channel: "linq" as const, messageId: "msg_offer_123" },
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

  it("reuses an active offer whose canonical scope snapshot exactly matches the request", async () => {
    const findMany = vi.fn(async () => [{
      projectionKindsJson: [SLEEP_SCOPE],
    }]);
    const tx = createPrismaStub({
      $queryRaw: vi.fn(async () => []),
      hostedGroup: {
        findUnique: vi.fn(async () => ({
          joinCode: "join_generation_1",
        })),
      },
      hostedGroupJoinOffer: { findMany },
    });

    await expect(prepareHostedGroupJoinOfferPostTx({
      groupId: "group_1",
      now: new Date("2026-07-01T00:00:00.000Z"),
      projectionScopes: [SLEEP_SCOPE],
      tx,
    })).resolves.toEqual({ kind: "active_offer" });
    expect(findMany).toHaveBeenCalledWith({
      where: { groupId: "group_1", revokedAt: null },
      select: { projectionKindsJson: true },
      take: HOSTED_GROUP_ACTIVE_JOIN_OFFER_SCAN_MAX + 1,
    });
  });

  it("revokes a broader active offer before posting a narrower replacement", async () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = createPrismaStub({
      $queryRaw: vi.fn(async () => []),
      hostedGroup: {
        findUnique: vi.fn(async () => ({
          joinCode: "join_generation_1",
        })),
      },
      hostedGroupJoinOffer: {
        findMany: vi.fn(async () => [{
          projectionKindsJson: [SLEEP_SCOPE, ACTIVITY_SCOPE],
        }]),
        updateMany,
      },
    });

    await expect(prepareHostedGroupJoinOfferPostTx({
      groupId: "group_1",
      now,
      projectionScopes: [SLEEP_SCOPE],
      tx,
    })).resolves.toEqual({
      joinCode: "join_generation_1",
      kind: "post",
    });
    expect(updateMany).toHaveBeenCalledWith({
      data: { revokedAt: now },
      where: { groupId: "group_1", revokedAt: null },
    });
  });

  it("fails closed when a stored active offer scope is not canonicalizable", async () => {
    const tx = createPrismaStub({
      $queryRaw: vi.fn(async () => []),
      hostedGroup: {
        findUnique: vi.fn(async () => ({
          joinCode: "join_generation_1",
        })),
      },
      hostedGroupJoinOffer: {
        findMany: vi.fn(async () => [{
          projectionKindsJson: [{ projectionKind: "raw-health-records.v0" }],
        }]),
      },
    });

    await expect(prepareHostedGroupJoinOfferPostTx({
      groupId: "group_1",
      now: new Date("2026-07-01T00:00:00.000Z"),
      projectionScopes: [SLEEP_SCOPE],
      tx,
    })).resolves.toEqual({ kind: "unavailable" });
  });

  it("fails closed before inspecting a truncated active-offer set", async () => {
    const findMany = vi.fn(async () => Array.from(
      { length: HOSTED_GROUP_ACTIVE_JOIN_OFFER_SCAN_MAX + 1 },
      () => ({ projectionKindsJson: [SLEEP_SCOPE] }),
    ));
    const tx = createPrismaStub({
      $queryRaw: vi.fn(async () => []),
      hostedGroup: {
        findUnique: vi.fn(async () => ({ joinCode: "join_generation_1" })),
      },
      hostedGroupJoinOffer: { findMany },
    });

    await expect(prepareHostedGroupJoinOfferPostTx({
      groupId: "group_1",
      now: new Date("2026-07-01T00:00:00.000Z"),
      projectionScopes: [SLEEP_SCOPE],
      tx,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { groupId: "group_1", revokedAt: null },
      take: HOSTED_GROUP_ACTIVE_JOIN_OFFER_SCAN_MAX + 1,
    }));
  });

  it("rejects duplicate requested scopes before reading active offers", async () => {
    const findMany = vi.fn();
    const tx = createPrismaStub({
      $queryRaw: vi.fn(async () => []),
      hostedGroup: { findUnique: vi.fn() },
      hostedGroupJoinOffer: { findMany },
    });

    await expect(prepareHostedGroupJoinOfferPostTx({
      groupId: "group_1",
      now: new Date("2026-07-01T00:00:00.000Z"),
      projectionScopes: [SLEEP_SCOPE, SLEEP_SCOPE],
      tx,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("idempotently reuses the same active provider-message binding", async () => {
    const tx = buildStatefulJoinOfferTx();
    const postedAt = new Date("2026-07-01T00:00:00.000Z");
    const input = {
      groupId: "group_1",
      message: { channel: "linq" as const, messageId: "msg_offer_same" },
      postedAt,
      projectionScopes: [SLEEP_SCOPE],
      tx,
    };

    const first = await recordHostedGroupJoinOfferTx(input);
    const retry = await recordHostedGroupJoinOfferTx(input);

    expect(retry).toEqual(first);
    expect(tx.hostedGroupJoinOffer.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "different group",
      existingGroupId: "group_1",
      inputGroupId: "group_2",
      existingProjectionKinds: ["sleep-times.v0"],
      revokedAt: null,
    },
    {
      label: "different scopes",
      existingGroupId: "group_1",
      inputGroupId: "group_1",
      existingProjectionKinds: ["activity-days.v0"],
      revokedAt: null,
    },
    {
      label: "revoked binding",
      existingGroupId: "group_1",
      inputGroupId: "group_1",
      existingProjectionKinds: ["sleep-times.v0"],
      revokedAt: new Date("2026-07-02T00:00:00.000Z"),
    },
  ])("fails closed when a retry resolves to a $label", async ({
    existingGroupId,
    existingProjectionKinds,
    inputGroupId,
    revokedAt,
  }) => {
    const messageId = "msg_offer_conflict";
    const messageLookupKey = createHostedLinqMessageLookupKey(messageId);
    if (!messageLookupKey) {
      throw new Error("Expected a message lookup key.");
    }
    const tx = buildTx({
      offerMessageLookupKey: messageLookupKey,
      offerProjectionKinds: existingProjectionKinds,
      revokedOfferAt: revokedAt,
    });
    tx.hostedGroupJoinOffer.findUnique.mockResolvedValueOnce({
      groupId: existingGroupId,
      projectionKindsJson: existingProjectionKinds,
      revokedAt,
    });

    await expect(recordHostedGroupJoinOfferTx({
      groupId: inputGroupId,
      message: { channel: "linq" as const, messageId },
      postedAt: new Date("2026-07-03T00:00:00.000Z"),
      projectionScopes: [SLEEP_SCOPE],
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_JOIN_OFFER_BINDING_CONFLICT",
      httpStatus: 409,
    });
    expect(tx.hostedGroupJoinOffer.create).not.toHaveBeenCalled();
  });

  it("accepts a live join offer additively without revoking unselected group shares", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
      offerProjectionKinds: ["sleep-duration-days.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(acceptHostedGroupJoinOfferTx({
      channel: "linq",
      memberId: "member_grantor",
      messageLookupKeyReadCandidates: ["hbidx:linq-message:v1:offer"],
      now,
      threadIdentityLookupKeyReadCandidates: ["hbidx:external-thread-identity:v1:thread"],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: true,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-duration-days.v0"],
      joinCode: "join_1",
      membershipId: "membership_existing",
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: ["sleep-duration-days.v0"],
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
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith(expect.objectContaining({
      projectionScope: SLEEP_DURATION_SCOPE,
    }));
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalledWith(expect.objectContaining({
      projectionScope: SLEEP_SCOPE,
    }));
    expect(mocks.revokeHostedVaultSharesTx).not.toHaveBeenCalled();
    // Reaction joins have no consent UI, so a historical launch grant is enough;
    // the current-version gate stays on web joins only.
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledTimes(1);
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
  });

  it("grants only the exact by-source sleep scope bound to a reaction offer", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
      offerProjectionKinds: ["deep-sleep-sources-days.v1"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");
    mocks.revokeHostedVaultSharesTx.mockResolvedValueOnce(1);

    await expect(acceptHostedGroupJoinOfferTx({
      channel: "linq",
      memberId: "member_grantor",
      messageLookupKeyReadCandidates: ["hbidx:linq-message:v1:offer"],
      now,
      threadIdentityLookupKeyReadCandidates: ["hbidx:external-thread-identity:v1:thread"],
      tx,
    })).resolves.toMatchObject({
      grantedVaultShareProjectionScopes: [PROFILE_SCOPE, DEEP_SLEEP_SOURCES_SCOPE],
      revokedVaultShareProjectionScopes: [LEGACY_DEEP_SLEEP_SCOPE],
      selectedVaultShareProjectionScopes: [DEEP_SLEEP_SOURCES_SCOPE],
    });

    expect(mocks.revokeHostedVaultSharesTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScopes: [LEGACY_DEEP_SLEEP_SCOPE],
      tx,
    });
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
      tx,
    });
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectionScope: SLEEP_SCOPE }),
    );
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectionScope: SLEEP_DURATION_SCOPE }),
    );
    expect(tx.hostedGroup.update).not.toHaveBeenCalled();
  });

  it("fails a join offer closed when launch consent was never granted", async () => {
    const tx = buildTx({ activeGroupGrantCount: 0 });
    mocks.assertHostedHistoricalLaunchConsentGranted.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Accept the Murph legal consent before continuing.",
    }));

    await expect(acceptHostedGroupJoinOfferTx({
      channel: "linq",
      memberId: "member_grantor",
      messageLookupKeyReadCandidates: ["hbidx:linq-message:v1:offer"],
      now: new Date("2026-07-01T00:00:00.000Z"),
      threadIdentityLookupKeyReadCandidates: ["hbidx:external-thread-identity:v1:thread"],
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
    });
    expect(tx.hostedGroupMember.create).not.toHaveBeenCalled();
    expect(mocks.grantHostedVaultShareTx).not.toHaveBeenCalled();
  });

  it("appends a reaction-specific private confirmation for a first offer join", async () => {
    const tx = buildTx({ activeGroupGrantCount: 0 });
    const now = new Date("2026-07-01T00:00:00.000Z");
    mocks.appendHostedGroupJoinConfirmationTx.mockResolvedValueOnce({
      kind: "appended",
      signal: {
        mailboxItemId: "mailbox_item_join_confirmation_1",
        memberId: "member_grantor",
      },
    });

    await expect(acceptHostedGroupJoinOfferTx({
      channel: "linq",
      confirmationPublicBaseUrl: "https://murph.example",
      memberId: "member_grantor",
      messageLookupKeyReadCandidates: ["hbidx:linq-message:v1:offer"],
      now,
      threadIdentityLookupKeyReadCandidates: ["hbidx:external-thread-identity:v1:thread"],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: false,
      joinConfirmationSignal: {
        mailboxItemId: "mailbox_item_join_confirmation_1",
        memberId: "member_grantor",
      },
      membershipId: "membership_created",
    });

    expect(mocks.appendHostedGroupJoinConfirmationTx).toHaveBeenCalledWith({
      groupDisplayName: "Weekend Runners",
      joinCode: "join_1",
      joinOrigin: "group_chat_reaction",
      memberId: "member_grantor",
      membershipId: "membership_created",
      occurredAt: now,
      publicBaseUrl: "https://murph.example",
      tx,
    });
    expect(tx.hostedGroupMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        joinConfirmationEligibleAt: now,
        joinConfirmationOrigin: "group_chat_reaction",
      }),
      select: { id: true },
    });
  });

  it("reports email sharing when a join offer grants it", async () => {
    const tx = buildTx({
      activeGroupGrantCount: 0,
      existingMembershipId: "membership_existing",
      offerProjectionKinds: ["group-email.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(acceptHostedGroupJoinOfferTx({
      channel: "linq",
      memberId: "member_grantor",
      messageLookupKeyReadCandidates: ["hbidx:linq-message:v1:offer"],
      now,
      threadIdentityLookupKeyReadCandidates: ["hbidx:external-thread-identity:v1:thread"],
      tx,
    })).resolves.toMatchObject({
      alreadyMember: true,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "group-email.v0"],
      joinCode: "join_1",
      membershipId: "membership_existing",
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: ["group-email.v0"],
    });

    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_grantor",
      now,
      projectionScope: GROUP_EMAIL_SCOPE,
      tx,
    });
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
      channel: "linq",
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
      channel: "linq",
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
      message: { channel: "linq" as const, messageId: "msg_offer_a" },
      postedAt: firstPostedAt,
      projectionKinds: ["sleep-times.v0"],
      tx,
    });
    await recordHostedGroupJoinOfferTx({
      groupId: "group_1",
      message: { channel: "linq" as const, messageId: "msg_offer_b" },
      postedAt: secondPostedAt,
      projectionKinds: ["activity-days.v0"],
      tx,
    });

    await expect(acceptHostedGroupJoinOfferTx({
      channel: "linq",
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

describe("readHostedGroupSharedDataByRuntimeMemberId current-turn attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
  });

  it("keeps each exact verified handle on its one current membership", async () => {
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: { ...TEST_KEYRING_ENTRIES },
    });
    const dualPhoneHandle = "+15551110001";
    const dualEmailHandle = "dual@example.test";
    const emailHandle = "email-only@example.test";
    const unverifiedEmailHandle = "unverified@example.test";
    const ambiguousMemberEmailHandle = "ambiguous-a@example.test";
    const priorKeyPhoneHandle = "+15551110003";
    const rotatedAmbiguousPhoneHandle = "+15551110004";
    const dualPhoneLookupKey = createHostedPhoneLookupKey(dualPhoneHandle);
    const dualEmailLookupKey = createHostedEmailLookupKey(dualEmailHandle);
    const emailLookupKey = createHostedEmailLookupKey(emailHandle);
    const unverifiedEmailLookupKey = createHostedEmailLookupKey(
      unverifiedEmailHandle,
    );
    const ambiguousMemberEmailLookupKey = createHostedEmailLookupKey(
      ambiguousMemberEmailHandle,
    );
    const priorKeyPhoneLookupKey = createHostedPhoneLookupKeyReadCandidates(
      priorKeyPhoneHandle,
    ).find((lookupKey) => lookupKey.startsWith("hbidx:phone:v1:"));
    const rotatedAmbiguousPhoneLookupKeys =
      createHostedPhoneLookupKeyReadCandidates(rotatedAmbiguousPhoneHandle);
    const rotatedAmbiguousPhoneLookupKeyV1 =
      rotatedAmbiguousPhoneLookupKeys.find((lookupKey) =>
        lookupKey.startsWith("hbidx:phone:v1:")
      );
    const rotatedAmbiguousPhoneLookupKeyV2 =
      rotatedAmbiguousPhoneLookupKeys.find((lookupKey) =>
        lookupKey.startsWith("hbidx:phone:v2:")
      );
    if (
      !dualPhoneLookupKey
      || !dualEmailLookupKey
      || !emailLookupKey
      || !unverifiedEmailLookupKey
      || !ambiguousMemberEmailLookupKey
      || !priorKeyPhoneLookupKey
      || !rotatedAmbiguousPhoneLookupKeyV1
      || !rotatedAmbiguousPhoneLookupKeyV2
    ) {
      throw new Error("Expected contact lookup keys.");
    }
    const verifiedAt = new Date("2026-07-01T00:00:00.000Z");
    const members = [
      {
        id: "group_member_dual",
        member: {
          emailAuthorization: {
            verifiedEmailLookupKey: dualEmailLookupKey,
            verifiedEmailVerifiedAt: verifiedAt,
          },
          identity: {
            phoneLookupKey: dualPhoneLookupKey,
            phoneNumberVerifiedAt: verifiedAt,
          },
        },
        memberId: "member_dual",
      },
      {
        id: "group_member_email",
        member: {
          emailAuthorization: {
            verifiedEmailLookupKey: emailLookupKey,
            verifiedEmailVerifiedAt: verifiedAt,
          },
          identity: null,
        },
        memberId: "member_email",
      },
      {
        id: "group_member_unverified",
        member: {
          emailAuthorization: {
            verifiedEmailLookupKey: unverifiedEmailLookupKey,
            verifiedEmailVerifiedAt: null,
          },
          identity: null,
        },
        memberId: "member_unverified",
      },
      {
        id: "group_member_prior_key",
        member: {
          emailAuthorization: null,
          identity: {
            phoneLookupKey: priorKeyPhoneLookupKey,
            phoneNumberVerifiedAt: verifiedAt,
          },
        },
        memberId: "member_prior_key",
      },
      ...[
        ["v1", rotatedAmbiguousPhoneLookupKeyV1],
        ["v2", rotatedAmbiguousPhoneLookupKeyV2],
      ].map(([version, phoneLookupKey]) => ({
        id: `group_member_rotated_ambiguous_${version}`,
        member: {
          emailAuthorization: version === "v1"
            ? {
                verifiedEmailLookupKey: ambiguousMemberEmailLookupKey,
                verifiedEmailVerifiedAt: verifiedAt,
              }
            : null,
          identity: {
            phoneLookupKey,
            phoneNumberVerifiedAt: verifiedAt,
          },
        },
        memberId: `member_rotated_ambiguous_${version}`,
      })),
    ];
    const hostedGroupFindUnique = vi.fn(async () => ({ members }));
    const hostedVaultShareFindMany = vi.fn(async () => []);
    const deviceConnectionFindMany = vi.fn(async () => []);
    const tx = {
      deviceConnection: { findMany: deviceConnectionFindMany },
      hostedGroup: { findUnique: hostedGroupFindUnique },
      hostedVaultShare: { findMany: hostedVaultShareFindMany },
    };
    const transaction = vi.fn(async (
      callback: (client: typeof tx) => Promise<unknown>,
    ) => callback(tx));
    const prisma = createPrismaStub({ $transaction: transaction });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      linqSenderHandles: [
        dualPhoneHandle,
        dualPhoneHandle,
        dualEmailHandle,
        emailHandle,
        unverifiedEmailHandle,
        ambiguousMemberEmailHandle,
        priorKeyPhoneHandle,
        rotatedAmbiguousPhoneHandle,
        "unknown@example.test",
      ],
      prisma,
      projectionScopes: [SLEEP_SCOPE],
      runtimeMemberId: "member_group_runtime",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected hosted group shared data.");
    }
    expect(result.members).toEqual([
      expect.objectContaining({
        currentTurnHandles: [dualPhoneHandle, dualEmailHandle],
        memberId: "member_dual",
        participantId: "group_member_dual",
      }),
      expect.objectContaining({
        currentTurnHandles: [emailHandle],
        memberId: "member_email",
        participantId: "group_member_email",
      }),
      expect.objectContaining({
        currentTurnHandles: [],
        memberId: "member_unverified",
        participantId: "group_member_unverified",
      }),
      expect.objectContaining({
        currentTurnHandles: [priorKeyPhoneHandle],
        memberId: "member_prior_key",
        participantId: "group_member_prior_key",
      }),
      expect.objectContaining({
        currentTurnHandles: [ambiguousMemberEmailHandle],
        memberId: "member_rotated_ambiguous_v1",
        participantId: "group_member_rotated_ambiguous_v1",
      }),
      expect.objectContaining({
        currentTurnHandles: [],
        memberId: "member_rotated_ambiguous_v2",
        participantId: "group_member_rotated_ambiguous_v2",
      }),
    ]);
    expect(hostedGroupFindUnique).toHaveBeenCalledWith({
      select: {
        members: expect.objectContaining({
          select: {
            id: true,
            member: {
              select: {
                emailAuthorization: {
                  select: {
                    verifiedEmailLookupKey: true,
                    verifiedEmailVerifiedAt: true,
                  },
                },
                identity: {
                  select: {
                    phoneLookupKey: true,
                    phoneNumberVerifiedAt: true,
                  },
                },
                routing: {
                  select: {
                    telegramUserLookupKey: true,
                  },
                },
              },
            },
            memberId: true,
          },
        }),
      },
      where: { runtimeMemberId: "member_group_runtime" },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(hostedVaultShareFindMany).toHaveBeenCalledTimes(1);
    expect(hostedVaultShareFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          grantor: {
            AND: expect.arrayContaining([
              {
                consentGrants: {
                  none: {
                    scope: "launch.health-data",
                    status: "revoked",
                  },
                },
              },
            ]),
          },
        }),
      }),
    );
    expect(deviceConnectionFindMany).not.toHaveBeenCalled();
  });

  it("matches Telegram senders only against Telegram identity, never a phone number", async () => {
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: { ...TEST_KEYRING_ENTRIES },
    });
    // A Telegram user id is a bare digit string that normalizes into a valid
    // phone lookup key. Another member verified that exact number as their
    // phone, so cross-channel matching would attribute the wrong human.
    const telegramSenderUserId = "15551110009";
    const collidingPhoneHandle = "+15551110009";
    const telegramUserLookupKey = createHostedTelegramUserLookupKey(
      telegramSenderUserId,
    );
    const collidingPhoneLookupKey = createHostedPhoneLookupKey(
      collidingPhoneHandle,
    );
    if (!telegramUserLookupKey || !collidingPhoneLookupKey) {
      throw new Error("Expected contact lookup keys.");
    }
    const members = [
      {
        id: "group_member_telegram",
        member: {
          emailAuthorization: null,
          identity: null,
          routing: { telegramUserLookupKey },
        },
        memberId: "member_telegram",
      },
      {
        id: "group_member_phone_lookalike",
        member: {
          emailAuthorization: null,
          identity: {
            phoneLookupKey: collidingPhoneLookupKey,
            phoneNumberVerifiedAt: new Date("2026-07-01T00:00:00.000Z"),
          },
          routing: null,
        },
        memberId: "member_phone_lookalike",
      },
    ];
    const hostedGroupFindUnique = vi.fn(async () => ({ members }));
    const tx = {
      deviceConnection: { findMany: vi.fn(async () => []) },
      hostedGroup: { findUnique: hostedGroupFindUnique },
      hostedVaultShare: { findMany: vi.fn(async () => []) },
    };
    const prisma = createPrismaStub({
      $transaction: vi.fn(async (
        callback: (client: typeof tx) => Promise<unknown>,
      ) => callback(tx)),
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      telegramSenderHandles: [telegramSenderUserId],
      prisma,
      projectionScopes: [SLEEP_SCOPE],
      runtimeMemberId: "member_group_runtime",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected hosted group shared data.");
    }
    expect(result.members).toEqual([
      expect.objectContaining({
        currentTurnHandles: [telegramSenderUserId],
        memberId: "member_telegram",
        participantId: "group_member_telegram",
      }),
      expect.objectContaining({
        currentTurnHandles: [],
        memberId: "member_phone_lookalike",
        participantId: "group_member_phone_lookalike",
      }),
    ]);
  });

  it("drops a Telegram handle that resolves to no current member", async () => {
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: { ...TEST_KEYRING_ENTRIES },
    });
    const boundLookupKey = createHostedTelegramUserLookupKey("15551110010");
    if (!boundLookupKey) {
      throw new Error("Expected contact lookup keys.");
    }
    const members = [
      {
        id: "group_member_telegram",
        member: {
          emailAuthorization: null,
          identity: null,
          routing: { telegramUserLookupKey: boundLookupKey },
        },
        memberId: "member_telegram",
      },
    ];
    const tx = {
      deviceConnection: { findMany: vi.fn(async () => []) },
      hostedGroup: { findUnique: vi.fn(async () => ({ members })) },
      hostedVaultShare: { findMany: vi.fn(async () => []) },
    };
    const prisma = createPrismaStub({
      $transaction: vi.fn(async (
        callback: (client: typeof tx) => Promise<unknown>,
      ) => callback(tx)),
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      telegramSenderHandles: ["15559999999"],
      prisma,
      projectionScopes: [SLEEP_SCOPE],
      runtimeMemberId: "member_group_runtime",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected hosted group shared data.");
    }
    expect(result.members).toEqual([
      expect.objectContaining({
        currentTurnHandles: [],
        memberId: "member_telegram",
        participantId: "group_member_telegram",
      }),
    ]);
  });
});

describe("createHostedGroupJoinLinkForOwnedThreadContainerTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.grantHostedVaultShareTx.mockResolvedValue(undefined);
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

  it("does not request or grant health projections without an explicit checkpoint scope", async () => {
    const tx = buildGroupLinkTx({
      existingGroup: false,
      grantedProjectionKinds: ["profile-name.v0"],
      joinCode: null,
      ownerMemberId: "member_owner",
      requestedProjectionKinds: [],
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
            grantedVaultShareProjectionKinds: ["profile-name.v0"],
            memberId: "member_owner",
          },
        ],
        requestedVaultShareProjectionKinds: [],
      },
      joinCode: "join_created",
    });

    expect(tx.hostedGroup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        joinPolicyJson: undefined,
      }),
    }));
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledWith(expect.objectContaining({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_owner",
      now,
      projectionScope: PROFILE_SCOPE,
    }));
    expect(mocks.grantHostedVaultShareTx).toHaveBeenCalledTimes(1);
  });

  it("stores a legacy deep-sleep request as the single source-aware permission", async () => {
    const tx = buildGroupLinkTx({
      existingGroup: false,
      joinCode: null,
      ownerMemberId: "member_owner",
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: "member_owner",
      containerMemberId: "member_group_runtime",
      now,
      requestedVaultShareProjectionScopes: [LEGACY_DEEP_SLEEP_SCOPE],
      tx,
    })).resolves.toMatchObject({
      group: {
        requestedVaultShareProjectionKinds: [
          "deep-sleep-sources-days.v1",
        ],
        requestedVaultShareProjectionScopes: [
          DEEP_SLEEP_SOURCES_SCOPE,
        ],
      },
    });

    expect(tx.hostedGroup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        joinPolicyJson: {
          requestedVaultShareProjectionKinds: [
            "deep-sleep-sources-days.v1",
          ],
          requestedVaultShareProjectionScopes: [
            DEEP_SLEEP_SOURCES_SCOPE,
          ],
          schema: "murph.hosted-group.join-policy.v1",
        },
      }),
    }));
  });

  it("replaces an existing requested policy with the explicitly requested scopes", async () => {
    const tx = buildGroupLinkTx({
      existingGroup: true,
      grantedProjectionKinds: ["profile-name.v0"],
      joinCode: "join_existing",
      ownerMemberId: "member_owner",
      requestedProjectionKinds: ["sleep-times.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    const result = await createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: "member_owner",
      containerMemberId: "member_group_runtime",
      now,
      requestedVaultShareProjectionScopes: [ACTIVITY_SCOPE],
      tx,
    });

    expect(result.group.requestedVaultShareProjectionKinds).toEqual([
      "activity-days.v0",
    ]);
    expect(tx.hostedGroup.update).toHaveBeenCalledWith({
      data: {
        joinPolicyJson: {
          requestedVaultShareProjectionKinds: ["activity-days.v0"],
          requestedVaultShareProjectionScopes: [ACTIVITY_SCOPE],
          schema: "murph.hosted-group.join-policy.v1",
        },
      },
      where: { id: "group_1" },
    });
    expect(tx.hostedGroupJoinOffer.updateMany).toHaveBeenCalledWith({
      data: { revokedAt: now },
      where: { groupId: "group_1", revokedAt: null },
    });
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

  it("replaces an existing legacy sleep policy with an explicitly narrower request", async () => {
    const tx = buildGroupLinkTx({
      existingGroup: true,
      joinCode: "join_existing",
      ownerMemberId: "member_owner",
      requestedProjectionKinds: ["deep-sleep-days.v0"],
    });

    const result = await createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: "member_owner",
      containerMemberId: "member_group_runtime",
      now: new Date("2026-07-01T00:00:00.000Z"),
      requestedVaultShareProjectionScopes: [SLEEP_SCOPE],
      tx,
    });

    expect(result.group.requestedVaultShareProjectionScopes).toEqual([
      SLEEP_SCOPE,
    ]);
    expect(tx.hostedGroup.update).toHaveBeenCalledWith({
      data: {
        joinPolicyJson: {
          requestedVaultShareProjectionKinds: [
            "sleep-times.v0",
          ],
          requestedVaultShareProjectionScopes: [
            SLEEP_SCOPE,
          ],
          schema: "murph.hosted-group.join-policy.v1",
        },
      },
      where: { id: "group_1" },
    });
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
            handle: null,
            memberId: "member_owner",
            role: "owner",
          },
        ],
        requestedVaultShareProjectionKinds: ["sleep-times.v0"],
        requestedVaultShareProjectionScopes: [SLEEP_SCOPE],
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

  it("creates a named group through the shared join-link path and exposes it to the join view", async () => {
    const tx = buildGroupLinkTx({
      existingGroup: false,
      joinCode: null,
      ownerMemberId: "member_owner",
      requestedProjectionKinds: ["group-email.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    const created = await createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: "member_owner",
      containerMemberId: "member_group_runtime",
      displayName: "Sunday Sleep Crew",
      kind: "friends",
      now,
      requestedVaultShareProjectionKinds: ["group-email.v0"],
      tx,
    });

    expect(created.group.displayName).toBe("Sunday Sleep Crew");
    expect(tx.hostedGroup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        displayName: "Sunday Sleep Crew",
      }),
    }));

    await expect(readHostedGroupJoinView({
      joinCode: created.joinCode,
      prisma: tx,
    })).resolves.toMatchObject({
      displayName: "Sunday Sleep Crew",
      kind: "friends",
      requestedVaultShareProjections: [
        expect.objectContaining({ projectionKind: "group-email.v0" }),
      ],
    });
  });

  it("fills an existing null group display name from a later named request", async () => {
    const tx = buildGroupLinkTx({
      existingDisplayName: null,
      existingGroup: true,
      joinCode: "join_existing",
      ownerMemberId: "member_owner",
      requestedProjectionKinds: ["group-email.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    const result = await createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: "member_owner",
      containerMemberId: "member_group_runtime",
      displayName: "Sunday Sleep Crew",
      now,
      requestedVaultShareProjectionKinds: ["group-email.v0"],
      tx,
    });

    expect(result.group.displayName).toBe("Sunday Sleep Crew");
    expect(tx.hostedGroup.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { displayName: "Sunday Sleep Crew" },
      select: { id: true },
      where: { id: "group_1" },
    }));
  });

  it("does not overwrite an existing non-null group display name", async () => {
    const tx = buildGroupLinkTx({
      existingDisplayName: "Original Crew",
      existingGroup: true,
      joinCode: "join_existing",
      ownerMemberId: "member_owner",
      requestedProjectionKinds: ["group-email.v0"],
    });
    const now = new Date("2026-07-01T00:00:00.000Z");

    const result = await createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: "member_owner",
      containerMemberId: "member_group_runtime",
      displayName: "Sunday Sleep Crew",
      now,
      requestedVaultShareProjectionKinds: ["group-email.v0"],
      tx,
    });

    expect(result.group.displayName).toBe("Original Crew");
    expect(tx.hostedGroup.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ displayName: expect.any(String) }),
    }));
  });
});

function buildGroupLinkTx(input: {
  existingDisplayName?: string | null;
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
  let groupCreated = input.existingGroup !== false;
  let groupDisplayName = input.existingDisplayName === undefined
    ? "Sunday sleep crew"
    : input.existingDisplayName;
  let groupJoinCode = input.joinCode ?? null;
  let groupKind = "friends";
  return createPrismaStub({
    $queryRaw: vi.fn(async () => []),
    hostedGroup: {
      create: vi.fn(async (args: {
        data?: {
          displayName?: string | null;
          kind?: string;
          joinPolicyJson?: {
            requestedVaultShareProjectionKinds?: HostedVaultShareFixedProjectionKind[];
          };
        };
      }) => {
        groupCreated = true;
        groupDisplayName = args.data?.displayName ?? null;
        groupKind = args.data?.kind ?? groupKind;
        requestedProjectionKinds =
          args.data?.joinPolicyJson?.requestedVaultShareProjectionKinds
          ?? [];
        return { id: "group_1" };
      }),
      findUnique: vi.fn(async (args: {
        select?: { joinCode?: boolean; ownerMemberId?: boolean };
        where: { id?: string; joinCode?: string; runtimeMemberId?: string };
      }) => {
        if (args.where.runtimeMemberId) {
          return groupCreated ? { displayName: groupDisplayName, id: "group_1" } : null;
        }
        if (args.where.joinCode) {
          if (!groupCreated || args.where.joinCode !== groupJoinCode) {
            return null;
          }
          return {
            _count: { members: 1 },
            displayName: groupDisplayName,
            id: "group_1",
            joinPolicyJson: {
              requestedVaultShareProjectionKinds: requestedProjectionKinds,
              schema: "murph.hosted-group.join-policy.v1",
            },
            kind: groupKind,
            members: [],
            runtimeMemberId: "member_group_runtime",
          };
        }
        if (args.where.id && args.select?.joinCode) {
          return {
            id: "group_1",
            joinCode: groupJoinCode,
            ownerMemberId: input.ownerMemberId,
          };
        }
        if (args.where.id) {
          return {
            displayName: groupDisplayName,
            id: "group_1",
            joinPolicyJson: {
              requestedVaultShareProjectionKinds: requestedProjectionKinds,
              schema: "murph.hosted-group.join-policy.v1",
            },
            kind: groupKind,
            members: [{ memberId: input.ownerMemberId, role: "owner" }],
            runtimeMemberId: "member_group_runtime",
          };
        }
        return null;
      }),
      update: vi.fn(async (args: {
        data?: {
          displayName?: string | null;
          joinCode?: string;
          joinPolicyJson?: {
            requestedVaultShareProjectionKinds?: HostedVaultShareFixedProjectionKind[];
          };
        };
      }) => {
        if (
          args.data
          && Object.prototype.hasOwnProperty.call(args.data, "displayName")
        ) {
          groupDisplayName = args.data.displayName ?? null;
        }
        if (
          args.data
          && Object.prototype.hasOwnProperty.call(args.data, "joinCode")
        ) {
          groupJoinCode = "join_created";
        }
        if (
          args.data
          && Object.prototype.hasOwnProperty.call(args.data, "joinPolicyJson")
        ) {
          requestedProjectionKinds =
            args.data.joinPolicyJson?.requestedVaultShareProjectionKinds
            ?? [];
        }
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
      update: vi.fn(async () => ({})),
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

describe("readHostedGroupJoinView leave affordance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readActiveHostedVaultShareProjectionScopes.mockResolvedValue([]);
  });

  it("derives one current sleep permission without rewriting its legacy policy", async () => {
    mocks.readActiveHostedVaultShareProjectionScopes.mockResolvedValueOnce([
      LEGACY_DEEP_SLEEP_SCOPE,
    ]);
    const prisma = createPrismaStub({
      hostedGroup: {
        findUnique: vi.fn(async () => ({
          _count: { members: 2 },
          displayName: "Sunday Sleep Crew",
          id: "group_1",
          joinPolicyJson: {
            requestedVaultShareProjectionKinds: ["deep-sleep-days.v0"],
            schema: "murph.hosted-group.join-policy.v1",
          },
          kind: "friends",
          members: [{ id: "membership_1" }],
          ownerMemberId: "member_owner",
          runtimeMemberId: "member_group_runtime",
        })),
      },
    });

    await expect(readHostedGroupJoinView({
      joinCode: "join_1",
      memberId: "member_self",
      prisma,
    })).resolves.toMatchObject({
      activeVaultShareProjectionScopes: [LEGACY_DEEP_SLEEP_SCOPE],
      requestedVaultShareProjections: [{
        label: "Deep sleep",
        legacyProjectionScope: LEGACY_DEEP_SLEEP_SCOPE,
        projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
      }],
    });
    expect(mocks.readActiveHostedVaultShareProjectionScopes).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_self",
      prisma,
    });
  });

  it("keeps active grants visible when the group's current request narrows", async () => {
    mocks.readActiveHostedVaultShareProjectionScopes.mockResolvedValueOnce([
      GROUP_EMAIL_SCOPE,
      SLEEP_SCOPE,
    ]);
    const prisma = createPrismaStub({
      hostedGroup: {
        findUnique: vi.fn(async () => ({
          _count: { members: 2 },
          displayName: "Sunday Sleep Crew",
          id: "group_1",
          joinPolicyJson: JOIN_POLICY,
          kind: "friends",
          members: [{ id: "membership_1" }],
          ownerMemberId: "member_owner",
          runtimeMemberId: "member_group_runtime",
        })),
      },
    });

    await expect(readHostedGroupJoinView({
      joinCode: "join_1",
      memberId: "member_self",
      prisma,
    })).resolves.toMatchObject({
      activeVaultShareProjectionScopes: [GROUP_EMAIL_SCOPE, SLEEP_SCOPE],
      requestedVaultShareProjections: [
        expect.objectContaining({ projectionScope: GROUP_EMAIL_SCOPE }),
        expect.objectContaining({ projectionScope: SLEEP_SCOPE }),
      ],
    });
    expect(mocks.readActiveHostedVaultShareProjectionScopes).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_self",
      prisma,
    });
  });

  it.each([
    ["member_self", "member_owner", [{ id: "membership_1" }], true, "active"],
    ["member_owner", "member_owner", [{ id: "membership_1" }], false, "active"],
    ["member_nonmember", "member_owner", [], false, null],
  ] as const)(
    "derives viewerCanLeave from canonical ownership for %s",
    async (memberId, ownerMemberId, members, viewerCanLeave, viewerMembershipStatus) => {
      const prisma = createPrismaStub({
        hostedGroup: {
          findUnique: vi.fn(async () => ({
            _count: { members: 2 },
            displayName: "Sunday Sleep Crew",
            id: "group_1",
            joinPolicyJson: JOIN_POLICY,
            kind: "friends",
            members,
            ownerMemberId,
            runtimeMemberId: "member_group_runtime",
          })),
        },
      });

      await expect(readHostedGroupJoinView({
        joinCode: "join_1",
        memberId,
        prisma,
      })).resolves.toMatchObject({
        viewerCanLeave,
        viewerMembershipId: members[0]?.id ?? null,
        viewerMembershipStatus,
      });
    },
  );
});

function buildLeaveTx(input?: {
  currentMembershipId?: string | null;
  groupExists?: boolean;
  ownerMemberId?: string;
  runtimeMemberId?: string | null;
  selectedMembershipId?: string | null;
  selectedMembershipMemberId?: string;
}) {
  const groupExists = input?.groupExists !== false;
  const hostedGroupFindUnique = vi.fn(async (args: {
    where: { id?: string; joinCode?: string };
  }) => {
    if (args.where.joinCode) {
      return groupExists ? { id: "group_1" } : null;
    }
    if (args.where.id) {
      return groupExists
        ? {
            id: "group_1",
            ownerMemberId: input?.ownerMemberId ?? "member_owner",
            runtimeMemberId: input?.runtimeMemberId === undefined
              ? "member_group_runtime"
              : input.runtimeMemberId,
          }
        : null;
    }
    return null;
  });
  const hostedGroupMemberFindUnique = vi.fn(async (args: {
    where: {
      groupId_memberId?: { groupId: string; memberId: string };
      id?: string;
    };
  }) => {
    if (args.where.id) {
      const selectedMembershipId = input?.selectedMembershipId === undefined
        ? args.where.id
        : input.selectedMembershipId;
      return selectedMembershipId
        ? {
            groupId: "group_1",
            memberId: input?.selectedMembershipMemberId ?? "member_self",
          }
        : null;
    }
    const currentMembershipId = input?.currentMembershipId === undefined
      ? "membership_1"
      : input.currentMembershipId;
    return currentMembershipId ? { id: currentMembershipId } : null;
  });
  const hostedGroupMemberDelete = vi.fn(async () => ({}));
  const queryRaw = vi.fn(async () => []);
  const tx = createPrismaStub({
    $queryRaw: queryRaw,
    hostedGroup: { findUnique: hostedGroupFindUnique },
    hostedGroupMember: {
      delete: hostedGroupMemberDelete,
      findUnique: hostedGroupMemberFindUnique,
    },
  });
  return {
    hostedGroupFindUnique,
    hostedGroupMemberDelete,
    hostedGroupMemberFindUnique,
    queryRaw,
    tx,
  };
}

describe("leaveHostedGroupMemberTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revokeHostedVaultSharesTx.mockResolvedValue(0);
  });

  it("hard-deletes the selected self-membership and revokes every share atomically", async () => {
    const leave = buildLeaveTx({ currentMembershipId: "membership_1" });
    mocks.revokeHostedVaultSharesTx.mockResolvedValueOnce(3);
    const now = new Date("2026-07-15T12:00:00.000Z");

    await expect(leaveHostedGroupMemberTx({
      memberId: "member_self",
      membershipId: "membership_1",
      now,
      tx: leave.tx,
    })).resolves.toEqual({ kind: "left" });

    expect(mocks.revokeHostedVaultSharesTx).toHaveBeenCalledWith({
      destinationMemberId: "member_group_runtime",
      grantorMemberId: "member_self",
      now,
      tx: leave.tx,
    });
    expect(leave.hostedGroupMemberDelete).toHaveBeenCalledWith({
      where: { id: "membership_1" },
    });
  });

  it("rejects the canonical owner without revoking shares or deleting membership", async () => {
    const leave = buildLeaveTx({ ownerMemberId: "member_self" });

    await expect(leaveHostedGroupMemberTx({
      joinCode: "join_1",
      memberId: "member_self",
      now: new Date("2026-07-15T12:00:00.000Z"),
      tx: leave.tx,
    })).resolves.toEqual({ kind: "owner_cannot_leave" });

    expect(mocks.revokeHostedVaultSharesTx).not.toHaveBeenCalled();
    expect(leave.hostedGroupMemberDelete).not.toHaveBeenCalled();
  });

  it("does not let a stale membership selector remove a later rejoin", async () => {
    const leave = buildLeaveTx({ currentMembershipId: "membership_rejoined" });

    await expect(leaveHostedGroupMemberTx({
      memberId: "member_self",
      membershipId: "membership_old",
      now: new Date("2026-07-15T12:00:00.000Z"),
      tx: leave.tx,
    })).resolves.toEqual({ kind: "already_left" });

    expect(mocks.revokeHostedVaultSharesTx).not.toHaveBeenCalled();
    expect(leave.hostedGroupMemberDelete).not.toHaveBeenCalled();
  });

  it("does not let a callback member select another member's membership", async () => {
    const leave = buildLeaveTx({ selectedMembershipMemberId: "member_other" });

    await expect(leaveHostedGroupMemberTx({
      memberId: "member_self",
      membershipId: "membership_other",
      now: new Date("2026-07-15T12:00:00.000Z"),
      tx: leave.tx,
    })).resolves.toEqual({ kind: "already_left" });

    expect(leave.hostedGroupFindUnique).not.toHaveBeenCalled();
    expect(mocks.revokeHostedVaultSharesTx).not.toHaveBeenCalled();
    expect(leave.hostedGroupMemberDelete).not.toHaveBeenCalled();
  });

  it("repairs orphaned shares for an authenticated join-page member", async () => {
    const leave = buildLeaveTx({ currentMembershipId: null });
    mocks.revokeHostedVaultSharesTx.mockResolvedValueOnce(1);

    await expect(leaveHostedGroupMemberTx({
      joinCode: "join_1",
      memberId: "member_self",
      now: new Date("2026-07-15T12:00:00.000Z"),
      tx: leave.tx,
    })).resolves.toEqual({ kind: "left" });

    expect(leave.hostedGroupMemberDelete).not.toHaveBeenCalled();
  });

  it("is idempotent when both membership and shares are already absent", async () => {
    const leave = buildLeaveTx({ currentMembershipId: null });

    await expect(leaveHostedGroupMemberTx({
      joinCode: "join_1",
      memberId: "member_self",
      now: new Date("2026-07-15T12:00:00.000Z"),
      tx: leave.tx,
    })).resolves.toEqual({ kind: "already_left" });

    expect(leave.hostedGroupMemberDelete).not.toHaveBeenCalled();
  });
});

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

describe("readHostedGroupMembershipsForMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only the member's groups and active self-grants without reading the roster", async () => {
    const hostedGroupMemberFindMany = vi.fn(async () => [
      {
        id: "membership_running",
        role: "member",
        group: {
          displayName: "Fun-loving runners",
          joinCode: "join_runners",
          joinPolicyJson: {
            requestedVaultShareProjectionScopes: [
              { projectionKind: "hrv-days.v0" },
              { projectionKind: "sleep-times.v0" },
            ],
            schema: "murph.hosted-group.join-policy.v1",
          },
          kind: "friends",
          runtimeMemberId: "member_group_runners",
          _count: { members: 7 },
        },
      },
      {
        id: "membership_family",
        role: "owner",
        group: {
          displayName: "Family check-in",
          joinCode: "join_family",
          joinPolicyJson: {
            requestedVaultShareProjectionScopes: [
              { projectionKind: "group-email.v0" },
            ],
            schema: "murph.hosted-group.join-policy.v1",
          },
          kind: "family",
          runtimeMemberId: "member_group_family",
          _count: { members: 4 },
        },
      },
    ]);
    const hostedVaultShareFindMany = vi.fn(async () => [
      {
        destinationMemberId: "member_group_runners",
        projectionKind: "hrv-days.v0",
        projectionScopeJson: { projectionKind: "hrv-days.v0" },
        projectionScopeKey: "hrv-days.v0",
      },
      {
        destinationMemberId: "member_group_runners",
        projectionKind: "profile-name.v0",
        projectionScopeJson: { projectionKind: "profile-name.v0" },
        projectionScopeKey: "profile-name.v0",
      },
      {
        destinationMemberId: "member_group_family",
        projectionKind: "group-email.v0",
        projectionScopeJson: { projectionKind: "group-email.v0" },
        projectionScopeKey: "group-email.v0",
      },
    ]);
    const prisma = createPrismaStub({
      hostedGroupMember: { findMany: hostedGroupMemberFindMany },
      hostedVaultShare: { findMany: hostedVaultShareFindMany },
    });

    await expect(readHostedGroupMembershipsForMember({
      memberId: "member_self",
      prisma,
    })).resolves.toEqual({
      memberships: [
        {
          displayName: "Fun-loving runners",
          grantedVaultShareProjectionScopes: [
            { projectionKind: "hrv-days.v0" },
            { projectionKind: "profile-name.v0" },
          ],
          kind: "friends",
          memberCount: 7,
          membershipId: "membership_running",
          ownerJoinCode: null,
          requestedVaultShareProjectionScopes: [
            { projectionKind: "sleep-times.v0" },
            { projectionKind: "hrv-days.v0" },
          ],
          role: "member",
          runtimeMemberId: "member_group_runners",
        },
        {
          displayName: "Family check-in",
          grantedVaultShareProjectionScopes: [{ projectionKind: "group-email.v0" }],
          kind: "family",
          memberCount: 4,
          membershipId: "membership_family",
          ownerJoinCode: "join_family",
          requestedVaultShareProjectionScopes: [{ projectionKind: "group-email.v0" }],
          role: "owner",
          runtimeMemberId: "member_group_family",
        },
      ],
      truncated: false,
    });
    expect(hostedGroupMemberFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 26,
      where: { memberId: "member_self" },
    }));
    expect(hostedVaultShareFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        destinationMemberId: {
          in: ["member_group_runners", "member_group_family"],
        },
        grantorMemberId: "member_self",
        status: "granted",
      },
    }));
  });

  it("returns at most 25 memberships and reports when more exist", async () => {
    const membershipRows = Array.from({ length: 26 }, (_, index) => ({
      id: `membership_${index + 1}`,
      role: "member",
      group: {
        displayName: `Group ${index + 1}`,
        joinCode: `join_${index + 1}`,
        joinPolicyJson: JOIN_POLICY,
        kind: "friends",
        runtimeMemberId: `member_group_${index + 1}`,
        _count: { members: index + 1 },
      },
    }));
    const hostedVaultShareFindMany = vi.fn(async () => []);
    const prisma = createPrismaStub({
      hostedGroupMember: { findMany: vi.fn(async () => membershipRows) },
      hostedVaultShare: { findMany: hostedVaultShareFindMany },
    });

    const result = await readHostedGroupMembershipsForMember({
      memberId: "member_self",
      prisma,
    });

    expect(result.memberships).toHaveLength(25);
    expect(result.memberships.at(0)?.displayName).toBe("Group 1");
    expect(result.memberships.at(-1)?.displayName).toBe("Group 25");
    expect(result.truncated).toBe(true);
    expect(hostedVaultShareFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        destinationMemberId: {
          in: Array.from({ length: 25 }, (_, index) => `member_group_${index + 1}`),
        },
      }),
    }));
  });
});


describe("normalizeHostedVaultShareProjectionKinds", () => {
  it("keeps selectable health kinds and silently drops the membership-implied profile name", () => {
    expect(normalizeHostedVaultShareProjectionKinds([
      "profile-name.v0",
      ...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
      "not-a-kind",
    ])).toEqual([...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS]);
  });
});
