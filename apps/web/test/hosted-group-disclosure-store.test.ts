import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createPrismaClient } from "@/src/lib/prisma";

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedLinqMessageLookupKey: (messageId: string | null) =>
    messageId ? `message:${messageId}` : null,
  createHostedLinqMessageLookupKeyReadCandidates: (messageId: string | null) =>
    messageId ? [`message:${messageId}`, `message-old:${messageId}`] : [],
}));

import {
  acceptHostedGroupDisclosurePermissionReactionTx,
  canonicalizeHostedGroupDisclosurePermissionText,
  digestHostedGroupDisclosurePermissionText,
  readActiveHostedGroupDisclosureGrantsForGroup,
  readActiveHostedGroupDisclosureGrantsForMember,
  readHostedGroupDisclosureGrantAuthorityTx,
  recordHostedGroupDisclosurePermissionTx,
  revokeHostedGroupDisclosureGrantForMemberTx,
} from "@/src/lib/hosted-groups/group-disclosure-store";

const NOW = new Date("2026-07-16T12:00:00.000Z");

interface DisclosurePermissionState {
  groupId: string;
  id: string;
  messageLookupKey: string;
  permissionDigest: string;
  permissionText: string;
}

interface DisclosureGrantState {
  grantedAt: Date;
  id: string;
  membershipId: string;
  permissionId: string;
  revokedAt: Date | null;
}

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

function buildDisclosureStoreHarness(input: {
  activeGroupGrantCount?: number;
  activeMemberGrantCount?: number;
  hasMembership?: boolean;
  hasThreadRoute?: boolean;
} = {}) {
  let permission: DisclosurePermissionState | null = null;
  const grants: DisclosureGrantState[] = [];
  const membership = {
    createdAt: NOW,
    groupId: "group_1",
    id: "membership_1",
    joinedAt: NOW,
    memberId: "member_1",
  };
  const group = {
    displayName: "Weekend Runners",
    id: "group_1",
    runtimeMemberId: "group_runtime_1",
  };

  const tx = createPrismaStub({
    $queryRaw: vi.fn(async (query: TemplateStringsArray) => {
      void query;
      return [];
    }),
    hostedGroup: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === group.id ? group : null
      ),
    },
    hostedGroupDisclosureGrant: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        "permission" in where
          ? (input.activeGroupGrantCount ?? grants.filter((grant) => !grant.revokedAt).length)
          : (input.activeMemberGrantCount ?? grants.filter((grant) => !grant.revokedAt).length)
      ),
      create: vi.fn(async ({ data }: {
        data: Omit<DisclosureGrantState, "revokedAt">;
      }) => {
        const grant = { ...data, revokedAt: null };
        grants.push(grant);
        return grant;
      }),
      findFirst: vi.fn(async ({ where }: {
        where: { membershipId: string; permissionId: string; revokedAt: null };
      }) => grants.find((grant) =>
        grant.membershipId === where.membershipId
        && grant.permissionId === where.permissionId
        && grant.revokedAt === null
      ) ?? null),
      findMany: vi.fn(async () => {
        const currentPermission = permission;
        return currentPermission
          ? grants
            .filter((grant) => grant.revokedAt === null)
            .map((grant) => ({
              id: grant.id,
              membership,
              permission: {
                group,
                permissionDigest: currentPermission.permissionDigest,
                permissionText: currentPermission.permissionText,
              },
            }))
          : [];
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const grant = grants.find((candidate) => candidate.id === where.id);
        if (!grant || !permission) return null;
        return {
          id: grant.id,
          membershipId: grant.membershipId,
          membership,
          permission: {
            group,
            groupId: permission.groupId,
            id: permission.id,
            permissionDigest: permission.permissionDigest,
            permissionText: permission.permissionText,
          },
          permissionId: grant.permissionId,
          revokedAt: grant.revokedAt,
        };
      }),
      updateMany: vi.fn(async ({ data, where }: {
        data: { revokedAt: Date };
        where: { id: string; revokedAt: null };
      }) => {
        const grant = grants.find((candidate) =>
          candidate.id === where.id && candidate.revokedAt === null
        );
        if (!grant) return { count: 0 };
        grant.revokedAt = data.revokedAt;
        return { count: 1 };
      }),
    },
    hostedGroupDisclosurePermission: {
      create: vi.fn(async ({ data }: { data: DisclosurePermissionState }) => {
        permission = data;
        return data;
      }),
      findMany: vi.fn(async ({ where }: {
        where: { messageLookupKey: { in: string[] } };
      }) => permission && where.messageLookupKey.in.includes(permission.messageLookupKey)
        ? [{ groupId: permission.groupId, id: permission.id }]
        : []),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        permission && permission.id === where.id
          ? {
              group: {
                ...group,
                members: input.hasMembership === false ? [] : [membership],
              },
              groupId: permission.groupId,
              id: permission.id,
              messageLookupKey: permission.messageLookupKey,
              permissionDigest: permission.permissionDigest,
              permissionText: permission.permissionText,
            }
          : null
      ),
    },
    hostedThreadRoute: {
      findFirst: vi.fn(async () => input.hasThreadRoute === false
        ? null
        : { containerMemberId: group.runtimeMemberId }
      ),
    },
  });

  return {
    grants,
    membership,
    get permission() {
      return permission;
    },
    tx,
  };
}

type DisclosureStoreHarness = ReturnType<typeof buildDisclosureStoreHarness>;

async function bindPermission(
  harness: DisclosureStoreHarness,
  permissionText = "My recent running distance",
): Promise<DisclosurePermissionState> {
  await recordHostedGroupDisclosurePermissionTx({
    groupId: "group_1",
    messageId: "provider_message_1",
    originAssistantInputId: "assistant_input_1",
    permissionText,
    postedAt: NOW,
    tx: harness.tx,
  });
  const permission = harness.permission;
  if (!permission) throw new Error("Expected stored permission.");
  return permission;
}

function acceptPermission(
  harness: DisclosureStoreHarness,
  reactionEventId = "reaction_event_1",
) {
  return acceptHostedGroupDisclosurePermissionReactionTx({
    memberId: "member_1",
    messageLookupKeyReadCandidates: [
      "message:provider_message_1",
      "message-old:provider_message_1",
    ],
    now: new Date(NOW.getTime() + 60_000),
    reactionEventId,
    threadIdentityLookupKeyReadCandidates: ["thread_1"],
    tx: harness.tx,
  });
}

describe("hosted group disclosure permission text", () => {
  it("stores one canonical text representation and domain-separated digest", () => {
    const variant = "  Cafe\u0301\r\nworkouts  ";
    const canonical = "Caf\u00e9\nworkouts";

    expect(canonicalizeHostedGroupDisclosurePermissionText(variant)).toBe(canonical);
    expect(digestHostedGroupDisclosurePermissionText(variant)).toBe(
      digestHostedGroupDisclosurePermissionText(canonical),
    );
    expect(digestHostedGroupDisclosurePermissionText(canonical)).toMatch(/^[a-f0-9]{64}$/u);
    expect(digestHostedGroupDisclosurePermissionText(`${canonical}.`)).not.toBe(
      digestHostedGroupDisclosurePermissionText(canonical),
    );
  });

  it.each([
    ["a tab", "share\tworkouts"],
    ["a bidi override", "share\u202eworkouts"],
    ["a bare carriage return", "share\rworkouts"],
    ["a zero-width joiner", "share\u200dworkouts"],
    ["a private-use code point", "share\ue000workouts"],
    ["more than 1000 code points", "x".repeat(1_001)],
  ])("rejects permission text containing %s", (_label, value) => {
    expect(() => canonicalizeHostedGroupDisclosurePermissionText(value)).toThrow(
      "Disclosure permission text must be 1-1000 characters of plain text.",
    );
  });
});

describe("hosted group disclosure grant lifecycle", () => {
  it("fails closed when a deterministic permission request replays with changed data", async () => {
    const changedMessage = buildDisclosureStoreHarness();
    await bindPermission(changedMessage);
    await expect(recordHostedGroupDisclosurePermissionTx({
      groupId: "group_1",
      messageId: "provider_message_2",
      originAssistantInputId: "assistant_input_1",
      permissionText: "My recent running distance",
      postedAt: NOW,
      tx: changedMessage.tx,
    })).rejects.toThrow("already bound to another disclosure request");

    const changedText = buildDisclosureStoreHarness();
    const stored = await bindPermission(changedText);
    stored.permissionText = "Different persisted text";
    await expect(bindPermission(changedText)).rejects.toThrow(
      "already bound to another disclosure request",
    );
  });

  it("binds exact message consent and rotates the grant generation after revocation", async () => {
    const harness = buildDisclosureStoreHarness();
    const permission = await bindPermission(harness, "  My recent running distance  ");
    expect(permission).toMatchObject({
      groupId: "group_1",
      messageLookupKey: "message:provider_message_1",
      permissionText: "My recent running distance",
    });
    expect(permission.id).toMatch(/^hgrpdp_/u);
    await bindPermission(harness, "My recent running distance");
    expect(harness.tx.hostedGroupDisclosurePermission.create).toHaveBeenCalledTimes(1);

    permission.messageLookupKey = "message-old:provider_message_1";
    await bindPermission(harness, "My recent running distance");
    expect(harness.tx.hostedGroupDisclosurePermission.create).toHaveBeenCalledTimes(1);

    const accepted = await acceptPermission(harness);
    expect(accepted).toEqual({ kind: "accepted" });
    const acceptedGrantId = harness.grants[0]?.id;
    if (!acceptedGrantId) throw new Error("Expected accepted grant.");

    const expectedSummary = expect.objectContaining({
      grantId: acceptedGrantId,
      groupLabel: "Weekend Runners",
      memberId: "member_1",
      permissionText: permission.permissionText,
    });
    await expect(readActiveHostedGroupDisclosureGrantsForGroup({
      groupId: "group_1",
      prisma: harness.tx,
    })).resolves.toEqual([expectedSummary]);
    await expect(readActiveHostedGroupDisclosureGrantsForMember({
      memberId: "member_1",
      prisma: harness.tx,
    })).resolves.toEqual([expectedSummary]);
    expect(harness.tx.hostedGroupDisclosureGrant.findMany).toHaveBeenCalledTimes(2);
    expect(harness.tx.hostedGroupDisclosureGrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 }),
    );

    const replayed = await acceptPermission(harness);
    expect(replayed).toMatchObject({
      kind: "accepted",
    });
    expect(harness.grants).toHaveLength(1);

    await expect(readHostedGroupDisclosureGrantAuthorityTx({
      expectedGroupRuntimeMemberId: "group_runtime_1",
      grantId: acceptedGrantId,
      membershipId: "membership_1",
      permissionDigest: permission.permissionDigest,
      tx: harness.tx,
    })).resolves.toMatchObject({
      grantId: acceptedGrantId,
      groupRuntimeMemberId: "group_runtime_1",
      permissionText: "My recent running distance",
      targetMemberId: "member_1",
    });

    await expect(revokeHostedGroupDisclosureGrantForMemberTx({
      grantId: acceptedGrantId,
      memberId: "member_2",
      now: new Date("2026-07-16T12:02:00.000Z"),
      tx: harness.tx,
    })).resolves.toEqual({ kind: "not_found" });
    expect(harness.grants[0]?.revokedAt).toBeNull();

    const revokedAt = new Date("2026-07-16T12:03:00.000Z");
    await expect(revokeHostedGroupDisclosureGrantForMemberTx({
      grantId: acceptedGrantId,
      memberId: "member_1",
      now: revokedAt,
      tx: harness.tx,
    })).resolves.toEqual({ kind: "revoked" });
    await expect(readHostedGroupDisclosureGrantAuthorityTx({
      grantId: acceptedGrantId,
      membershipId: "membership_1",
      permissionDigest: permission.permissionDigest,
      tx: harness.tx,
    })).resolves.toBeNull();

    const replayedAfterRevoke = await acceptPermission(harness);
    expect(replayedAfterRevoke).toEqual({ kind: "accepted" });
    expect(harness.grants).toHaveLength(1);

    const regranted = await acceptPermission(harness, "reaction_event_2");
    expect(regranted).toEqual({ kind: "accepted" });
    expect(harness.grants).toHaveLength(2);
    expect(harness.grants[1]?.id).not.toBe(acceptedGrantId);
  });

  it("requires both the exact group thread and an existing same-group membership", async () => {
    const missingMembership = buildDisclosureStoreHarness({ hasMembership: false });
    const wrongThread = buildDisclosureStoreHarness({ hasThreadRoute: false });
    const joinedAfterReaction = buildDisclosureStoreHarness();
    joinedAfterReaction.membership.joinedAt = new Date(
      NOW.getTime() + 2 * 60_000,
    );

    for (const harness of [missingMembership, wrongThread, joinedAfterReaction]) {
      await bindPermission(harness);
    }

    await expect(acceptPermission(missingMembership)).resolves.toEqual({
      kind: "not_group_member",
    });
    await expect(acceptPermission(wrongThread)).resolves.toEqual({ kind: "wrong_thread" });
    await expect(acceptPermission(joinedAfterReaction)).resolves.toEqual({
      kind: "not_group_member",
    });
    expect(missingMembership.grants).toEqual([]);
    expect(wrongThread.grants).toEqual([]);
    expect(joinedAfterReaction.grants).toEqual([]);
  });

  it.each([
    ["group", { activeGroupGrantCount: 25 }],
    ["member", { activeMemberGrantCount: 25 }],
  ])("caps active grants per %s under group-then-member locks", async (_label, counts) => {
    const harness = buildDisclosureStoreHarness(counts);
    await bindPermission(harness);
    harness.tx.$queryRaw.mockClear();

    await expect(acceptPermission(harness)).resolves.toEqual({ kind: "limit_reached" });

    const locks = harness.tx.$queryRaw.mock.calls.map(([query]) =>
      Array.from(query).join("?")
    );
    expect(locks).toEqual([
      expect.stringContaining('from "hosted_group"'),
      expect.stringContaining('from "hosted_member"'),
    ]);
    expect(harness.grants).toEqual([]);
  });

  it("fails authority closed on stale pins, cross-group state, or changed text", async () => {
    const harness = buildDisclosureStoreHarness();
    const permission = await bindPermission(harness);
    const accepted = await acceptPermission(harness);
    if (accepted.kind !== "accepted") throw new Error("Expected accepted grant.");
    const grantId = harness.grants[0]?.id;
    if (!grantId) throw new Error("Expected accepted grant.");

    await expect(readHostedGroupDisclosureGrantAuthorityTx({
      grantId,
      membershipId: "stale_membership",
      permissionDigest: permission.permissionDigest,
      tx: harness.tx,
    })).resolves.toBeNull();
    await expect(readHostedGroupDisclosureGrantAuthorityTx({
      grantId,
      membershipId: "membership_1",
      permissionDigest: "0".repeat(64),
      tx: harness.tx,
    })).resolves.toBeNull();
    await expect(readHostedGroupDisclosureGrantAuthorityTx({
      expectedGroupRuntimeMemberId: "group_runtime_2",
      grantId,
      membershipId: "membership_1",
      permissionDigest: permission.permissionDigest,
      tx: harness.tx,
    })).resolves.toBeNull();
    await expect(readHostedGroupDisclosureGrantAuthorityTx({
      expectedTargetMemberId: "member_2",
      grantId,
      membershipId: "membership_1",
      permissionDigest: permission.permissionDigest,
      tx: harness.tx,
    })).resolves.toBeNull();

    harness.membership.groupId = "group_2";
    await expect(readHostedGroupDisclosureGrantAuthorityTx({
      grantId,
      membershipId: "membership_1",
      permissionDigest: permission.permissionDigest,
      tx: harness.tx,
    })).resolves.toBeNull();
    await expect(readActiveHostedGroupDisclosureGrantsForMember({
      memberId: "member_1",
      prisma: harness.tx,
    })).resolves.toEqual([]);
    harness.membership.groupId = "group_1";

    permission.permissionText = `${permission.permissionText}.`;
    await expect(readHostedGroupDisclosureGrantAuthorityTx({
      grantId,
      membershipId: "membership_1",
      permissionDigest: permission.permissionDigest,
      tx: harness.tx,
    })).resolves.toBeNull();
  });
});
