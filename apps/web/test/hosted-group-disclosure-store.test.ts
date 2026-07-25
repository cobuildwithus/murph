import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createPrismaClient } from "@/src/lib/prisma";

const memberAccessMocks = vi.hoisted(() => ({
  readActiveHostedMemberAccess: vi.fn(async () => true),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: memberAccessMocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/contact-privacy")
  >(),
  createHostedLinqMessageLookupKey: (messageId: string | null) =>
    messageId ? `message:${messageId}` : null,
  createHostedLinqMessageLookupKeyReadCandidates: (messageId: string | null) =>
    messageId ? [`message:${messageId}`, `message-old:${messageId}`] : [],
}));

import {
  admitHostedGroupDisclosurePermissionAppendTx,
  acceptHostedGroupDisclosurePermissionReactionTx,
  canonicalizeHostedGroupDisclosurePermissionText,
  createHostedGroupDisclosurePermissionProviderIdempotencyKey,
  createHostedGroupDisclosurePermissionRequestId,
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
  permissionTextEncrypted: string;
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
  groupGrantHistoryCount?: number;
  hasMembership?: boolean;
  hasThreadRoute?: boolean;
  memberGrantHistoryCount?: number;
  permissionHistoryCount?: number;
} = {}) {
  let permission: DisclosurePermissionState | null = null;
  let permissionHistoryCount = input.permissionHistoryCount ?? 0;
  let groupGrantHistoryCount = input.groupGrantHistoryCount ?? 0;
  let memberGrantHistoryCount = input.memberGrantHistoryCount ?? 0;
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
          ? Math.max(groupGrantHistoryCount, grants.length)
          : Math.max(memberGrantHistoryCount, grants.length)
      ),
      create: vi.fn(async ({ data }: {
        data: Omit<DisclosureGrantState, "revokedAt">;
      }) => {
        const grant = { ...data, revokedAt: null };
        grants.push(grant);
        groupGrantHistoryCount += 1;
        memberGrantHistoryCount += 1;
        return grant;
      }),
      findFirst: vi.fn(async ({ where }: {
        where: {
          membershipId: string;
          OR: Array<{ revokedAt: null } | { revokedAt: { gte: Date } }>;
          permissionId: string;
        };
      }) => grants.find((grant) =>
        grant.membershipId === where.membershipId
        && grant.permissionId === where.permissionId
        && where.OR.some((condition) =>
          condition.revokedAt === null
            ? grant.revokedAt === null
            : grant.revokedAt !== null
              && grant.revokedAt >= condition.revokedAt.gte
        )
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
                id: currentPermission.id,
                permissionDigest: currentPermission.permissionDigest,
                permissionTextEncrypted: currentPermission.permissionTextEncrypted,
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
            permissionTextEncrypted: permission.permissionTextEncrypted,
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
      count: vi.fn(async () => Math.max(
        permissionHistoryCount,
        permission ? 1 : 0,
      )),
      create: vi.fn(async ({ data }: { data: DisclosurePermissionState }) => {
        permission = data;
        permissionHistoryCount += 1;
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
              permissionTextEncrypted: permission.permissionTextEncrypted,
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
    setGroupGrantHistoryCount(value: number) {
      groupGrantHistoryCount = value;
    },
    setMemberGrantHistoryCount(value: number) {
      memberGrantHistoryCount = value;
    },
    setPermissionHistoryCount(value: number) {
      permissionHistoryCount = value;
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
  now = new Date(NOW.getTime() + 60_000),
) {
  return acceptHostedGroupDisclosurePermissionReactionTx({
    memberId: "member_1",
    messageLookupKeyReadCandidates: [
      "message:provider_message_1",
      "message-old:provider_message_1",
    ],
    now,
    reactionEventId,
    threadIdentityLookupKeyReadCandidates: ["thread_1"],
    tx: harness.tx,
  });
}

describe("hosted group disclosure permission text", () => {
  it("stores one canonical text representation and keyed versioned digest", () => {
    const variant = "  Cafe\u0301\r\nworkouts  ";
    const canonical = "Caf\u00e9\nworkouts";

    expect(canonicalizeHostedGroupDisclosurePermissionText(variant)).toBe(canonical);
    expect(digestHostedGroupDisclosurePermissionText({
      groupId: "group_1",
      permissionText: variant,
    })).toBe(
      digestHostedGroupDisclosurePermissionText({
        groupId: "group_1",
        permissionText: canonical,
      }),
    );
    const digest = digestHostedGroupDisclosurePermissionText({
      groupId: "group_1",
      permissionText: canonical,
    });
    expect(digest).toMatch(
      /^hbidx:group-disclosure-permission:v[0-9]+:[a-f0-9]{64}$/u,
    );
    expect(digest).not.toBe(
      createHash("sha256").update(canonical, "utf8").digest("hex"),
    );
    expect(digestHostedGroupDisclosurePermissionText({
      groupId: "group_1",
      permissionText: `${canonical}.`,
    })).not.toBe(digest);
    expect(digestHostedGroupDisclosurePermissionText({
      groupId: "group_2",
      permissionText: canonical,
    })).not.toBe(digest);
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

  it("keeps exact provider retries stable and changed ambiguous retries isolated", () => {
    const permissionRequestId = createHostedGroupDisclosurePermissionRequestId({
      groupId: "group_1",
      originAssistantInputId: "assistant_input_1",
    });
    const consentMessage = [
      "Like this message to let this group ask your Murph for:",
      "",
      "Recent sleep timing and duration",
    ].join("\n");
    const exactKey = createHostedGroupDisclosurePermissionProviderIdempotencyKey({
      consentMessage,
      groupId: "group_1",
      originAssistantInputId: "assistant_input_1",
    });

    expect(createHostedGroupDisclosurePermissionProviderIdempotencyKey({
      consentMessage,
      groupId: "group_1",
      originAssistantInputId: "assistant_input_1",
    })).toBe(exactKey);
    expect(createHostedGroupDisclosurePermissionProviderIdempotencyKey({
      consentMessage: consentMessage.replace("sleep", "workout"),
      groupId: "group_1",
      originAssistantInputId: "assistant_input_1",
    })).not.toBe(exactKey);
    expect(createHostedGroupDisclosurePermissionProviderIdempotencyKey({
      consentMessage: `${consentMessage}\n`,
      groupId: "group_1",
      originAssistantInputId: "assistant_input_1",
    })).not.toBe(exactKey);
    expect(createHostedGroupDisclosurePermissionProviderIdempotencyKey({
      consentMessage,
      groupId: "group_2",
      originAssistantInputId: "assistant_input_1",
    })).not.toBe(exactKey);
    expect(permissionRequestId).not.toContain("sleep");
    expect(exactKey).not.toContain("sleep");
    expect(exactKey).toMatch(/^group-disclosure:[a-f0-9]{64}$/u);
  });
});

describe("hosted group disclosure grant lifecycle", () => {
  it("caps permission history while preserving exact request replay at the cap", async () => {
    const maxMinusOne = buildDisclosureStoreHarness({
      permissionHistoryCount: 24,
    });
    await expect(recordHostedGroupDisclosurePermissionTx({
      groupId: "group_1",
      messageId: "provider_message_1",
      originAssistantInputId: "assistant_input_1",
      permissionText: "My recent running distance",
      postedAt: NOW,
      tx: maxMinusOne.tx,
    })).resolves.toEqual({ kind: "recorded" });
    maxMinusOne.setPermissionHistoryCount(25);
    await expect(admitHostedGroupDisclosurePermissionAppendTx({
      groupId: "group_1",
      originAssistantInputId: "assistant_input_1",
      permissionText: "My recent running distance",
      tx: maxMinusOne.tx,
    })).resolves.toEqual({ kind: "accepted" });
    await expect(bindPermission(maxMinusOne)).resolves.toBeTruthy();
    expect(
      maxMinusOne.tx.hostedGroupDisclosurePermission.create,
    ).toHaveBeenCalledTimes(1);

    const atMax = buildDisclosureStoreHarness({ permissionHistoryCount: 25 });
    await expect(admitHostedGroupDisclosurePermissionAppendTx({
      groupId: "group_1",
      originAssistantInputId: "assistant_input_fresh",
      permissionText: "My recent running distance",
      tx: atMax.tx,
    })).resolves.toEqual({ kind: "limit_reached" });
    const permissionLockCallOrder = atMax.tx.$queryRaw.mock.invocationCallOrder[0];
    const permissionCountCallOrder =
      atMax.tx.hostedGroupDisclosurePermission.count.mock.invocationCallOrder[0];
    if (
      permissionLockCallOrder === undefined
      || permissionCountCallOrder === undefined
    ) {
      throw new Error("Expected permission admission lock and history count calls.");
    }
    expect(permissionLockCallOrder).toBeLessThan(permissionCountCallOrder);
    await expect(recordHostedGroupDisclosurePermissionTx({
      groupId: "group_1",
      messageId: "provider_message_fresh",
      originAssistantInputId: "assistant_input_fresh",
      permissionText: "My recent running distance",
      postedAt: NOW,
      tx: atMax.tx,
    })).resolves.toEqual({ kind: "limit_reached" });
    expect(atMax.tx.hostedGroupDisclosurePermission.create).not.toHaveBeenCalled();
  });

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
    stored.permissionTextEncrypted = encodeDefaultHostedSecureBoxTestValue(
      "Different persisted text",
    );
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
    });
    expect(permission.permissionTextEncrypted).not.toContain(
      "My recent running distance",
    );
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
      permissionText: "My recent running distance",
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

    const secondReactionAt = new Date("2026-07-16T12:02:00.000Z");
    const redundantWhileActive = await acceptPermission(
      harness,
      "reaction_event_2",
      secondReactionAt,
    );
    expect(redundantWhileActive).toEqual({ kind: "accepted" });
    expect(harness.grants).toHaveLength(1);
    expect(harness.tx.hostedGroupDisclosureGrant.count).toHaveBeenCalledTimes(2);

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

    const redundantReplayAfterRevoke = await acceptPermission(
      harness,
      "reaction_event_2",
      secondReactionAt,
    );
    expect(redundantReplayAfterRevoke).toEqual({ kind: "accepted" });
    expect(harness.grants).toHaveLength(1);
    expect(harness.tx.hostedGroupDisclosureGrant.count).toHaveBeenCalledTimes(2);

    const regranted = await acceptPermission(
      harness,
      "reaction_event_3",
      new Date("2026-07-16T12:04:00.000Z"),
    );
    expect(regranted).toEqual({ kind: "accepted" });
    expect(harness.grants).toHaveLength(2);
    expect(harness.grants[1]?.id).not.toBe(acceptedGrantId);
    expect(harness.tx.hostedGroupDisclosureGrant.count).toHaveBeenCalledTimes(4);
  });

  it("keeps keyed permission authority valid across contact-privacy key rotation", async () => {
    const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
    const previousCurrentVersion =
      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
    if (!previousKeys) {
      throw new Error("Expected the hosted contact-privacy test keyring.");
    }
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";

    try {
      const harness = buildDisclosureStoreHarness();
      const permission = await bindPermission(harness);
      await expect(acceptPermission(harness)).resolves.toEqual({ kind: "accepted" });
      const grantId = harness.grants[0]?.id;
      if (!grantId) throw new Error("Expected accepted grant.");
      expect(permission.permissionDigest).toMatch(
        /^hbidx:group-disclosure-permission:v1:/u,
      );

      process.env.HOSTED_CONTACT_PRIVACY_KEYS = [
        `v2:${Buffer.alloc(32, 12).toString("base64")}`,
        previousKeys,
      ].join(",");
      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";
      expect(digestHostedGroupDisclosurePermissionText({
        groupId: "group_1",
        permissionText: "My recent running distance",
      })).toMatch(/^hbidx:group-disclosure-permission:v2:/u);

      await expect(readHostedGroupDisclosureGrantAuthorityTx({
        grantId,
        membershipId: "membership_1",
        permissionDigest: permission.permissionDigest,
        tx: harness.tx,
      })).resolves.toMatchObject({
        grantId,
        permissionText: "My recent running distance",
      });
      await bindPermission(harness);
      expect(harness.tx.hostedGroupDisclosurePermission.create).toHaveBeenCalledTimes(1);
      await expect(bindPermission(
        harness,
        "Different permission on the same accepted input",
      )).rejects.toThrow("already bound to another disclosure request");
    } finally {
      process.env.HOSTED_CONTACT_PRIVACY_KEYS = previousKeys;
      if (previousCurrentVersion === undefined) {
        delete process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
      } else {
        process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION =
          previousCurrentVersion;
      }
    }
  });

  it("binds encrypted permission text to the synthetic group runtime and permission row", async () => {
    const calls: Array<{
      input: DisclosureSecureBoxTestPayload;
      operation: "decrypt" | "encrypt";
    }> = [];
    setHostedSecureBoxStringTestCodecForTests({
      decrypt(input) {
        const decoded = decodeBoundHostedSecureBoxTestValue(input.value);
        calls.push({ input: decoded, operation: "decrypt" });
        if (!matchesDisclosureSecureBoxInput(decoded, input)) {
          throw new Error("Hosted secure-box AAD mismatch.");
        }
        return decoded.value;
      },
      encrypt(input) {
        const payload = {
          aad: requireDisclosureSecureBoxTestAad(input.aad),
          lane: input.lane,
          scope: input.scope,
          userId: input.userId,
          value: input.value,
        };
        calls.push({ input: payload, operation: "encrypt" });
        return encodeBoundHostedSecureBoxTestValue(payload);
      },
    });

    try {
      const privateMarker = "disclosure-private-marker";
      const wrongThread = buildDisclosureStoreHarness({ hasThreadRoute: false });
      await bindPermission(wrongThread, privateMarker);
      calls.length = 0;
      await expect(acceptPermission(wrongThread)).resolves.toEqual({
        kind: "wrong_thread",
      });
      expect(calls.filter((call) => call.operation === "decrypt")).toEqual([]);

      const harness = buildDisclosureStoreHarness();
      const permission = await bindPermission(harness, privateMarker);
      expect(JSON.stringify(permission)).not.toContain(privateMarker);
      expect(calls.at(-1)).toEqual({
        input: {
          aad: {
            field: "permission_text_encrypted",
            purpose: "hosted-group-disclosure-permission-private-content",
            rowId: permission.id,
            table: "hosted_group_disclosure_permission",
          },
          lane: "hosted-member-private-field",
          scope: "hosted-group-disclosure-permission:permission-text:v1",
          userId: "group_runtime_1",
          value: privateMarker,
        },
        operation: "encrypt",
      });

      await expect(acceptPermission(harness)).resolves.toEqual({ kind: "accepted" });
      const grantId = harness.grants[0]?.id;
      if (!grantId) throw new Error("Expected encrypted permission grant.");

      calls.length = 0;
      harness.membership.groupId = "group_2";
      await expect(readActiveHostedGroupDisclosureGrantsForMember({
        memberId: "member_1",
        prisma: harness.tx,
      })).resolves.toEqual([]);
      expect(calls.filter((call) => call.operation === "decrypt")).toEqual([]);
      harness.membership.groupId = "group_1";
      await expect(readHostedGroupDisclosureGrantAuthorityTx({
        expectedGroupRuntimeMemberId: "group_runtime_2",
        grantId,
        tx: harness.tx,
      })).resolves.toBeNull();
      expect(calls.filter((call) => call.operation === "decrypt")).toEqual([]);

      await expect(readActiveHostedGroupDisclosureGrantsForGroup({
        groupId: "group_1",
        prisma: harness.tx,
      })).resolves.toEqual([
        expect.objectContaining({ permissionText: privateMarker }),
      ]);
      await expect(readHostedGroupDisclosureGrantAuthorityTx({
        grantId,
        tx: harness.tx,
      })).resolves.toMatchObject({ permissionText: privateMarker });

      const permissionDecrypts = calls.filter((call) => call.operation === "decrypt");
      expect(permissionDecrypts.length).toBeGreaterThanOrEqual(2);
      for (const call of permissionDecrypts) {
        expect(call.input).toMatchObject({
          aad: { rowId: permission.id },
          userId: "group_runtime_1",
        });
      }

      const decoded = decodeBoundHostedSecureBoxTestValue(
        permission.permissionTextEncrypted,
      );
      permission.permissionTextEncrypted = encodeBoundHostedSecureBoxTestValue({
        ...decoded,
        aad: { ...decoded.aad, rowId: "hgrpdp_wrong_permission" },
      });
      await expect(readHostedGroupDisclosureGrantAuthorityTx({
        grantId,
        tx: harness.tx,
      })).rejects.toThrow("Hosted secure-box AAD mismatch.");
    } finally {
      restoreDefaultHostedSecureBoxTestCodec();
    }
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

  // A grant outlives a lapse in access and governs private data, so current
  // access is validated here, under the member-row lock, once the reacted-to
  // message has proven this is the member's disclosure request.
  it("refuses to create a grant for a member whose access has lapsed", async () => {
    memberAccessMocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);
    const harness = buildDisclosureStoreHarness();
    await bindPermission(harness);

    await expect(acceptPermission(harness)).resolves.toEqual({
      kind: "member_inactive",
    });
    expect(harness.grants).toEqual([]);
    expect(memberAccessMocks.readActiveHostedMemberAccess).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member_1" }),
    );
  });

  it.each([
    ["group", { groupGrantHistoryCount: 25 }],
    ["member", { memberGrantHistoryCount: 25 }],
  ])("caps grant history per %s under group-then-member locks", async (_label, counts) => {
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
    const [groupLockCallOrder, memberLockCallOrder] =
      harness.tx.$queryRaw.mock.invocationCallOrder;
    const [groupCountCallOrder, memberCountCallOrder] =
      harness.tx.hostedGroupDisclosureGrant.count.mock.invocationCallOrder;
    if (
      groupLockCallOrder === undefined
      || memberLockCallOrder === undefined
      || groupCountCallOrder === undefined
      || memberCountCallOrder === undefined
    ) {
      throw new Error("Expected canonical grant locks and history count calls.");
    }
    expect(groupLockCallOrder).toBeLessThan(memberLockCallOrder);
    expect(memberLockCallOrder).toBeLessThan(groupCountCallOrder);
    expect(memberLockCallOrder).toBeLessThan(memberCountCallOrder);
    expect(harness.grants).toEqual([]);
  });

  it("accepts exact grant replays at the history cap but rejects a fresh regrant", async () => {
    const harness = buildDisclosureStoreHarness({
      groupGrantHistoryCount: 24,
      memberGrantHistoryCount: 24,
    });
    await bindPermission(harness);
    await expect(acceptPermission(harness)).resolves.toEqual({ kind: "accepted" });
    harness.setGroupGrantHistoryCount(25);
    harness.setMemberGrantHistoryCount(25);

    await expect(acceptPermission(harness)).resolves.toEqual({ kind: "accepted" });
    const grantId = harness.grants[0]?.id;
    if (!grantId) throw new Error("Expected accepted grant.");
    await expect(revokeHostedGroupDisclosureGrantForMemberTx({
      grantId,
      memberId: "member_1",
      now: new Date(NOW.getTime() + 90_000),
      tx: harness.tx,
    })).resolves.toEqual({ kind: "revoked" });
    await expect(acceptPermission(
      harness,
      "reaction_event_fresh",
      new Date(NOW.getTime() + 120_000),
    )).resolves.toEqual({ kind: "limit_reached" });
    expect(harness.grants).toHaveLength(1);
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

    permission.permissionTextEncrypted = encodeDefaultHostedSecureBoxTestValue(
      "My recent running distance.",
    );
    await expect(readHostedGroupDisclosureGrantAuthorityTx({
      grantId,
      membershipId: "membership_1",
      permissionDigest: permission.permissionDigest,
      tx: harness.tx,
    })).resolves.toBeNull();
    await expect(readActiveHostedGroupDisclosureGrantsForGroup({
      groupId: "group_1",
      prisma: harness.tx,
    })).resolves.toEqual([]);
    await expect(readActiveHostedGroupDisclosureGrantsForMember({
      memberId: "member_1",
      prisma: harness.tx,
    })).resolves.toEqual([]);
  });
});

interface DisclosureSecureBoxTestPayload {
  aad: {
    field: string;
    purpose: string;
    rowId: string;
    table: string;
  };
  lane: string;
  scope: string;
  userId: string;
  value: string;
}

function encodeDefaultHostedSecureBoxTestValue(value: string): string {
  return `hsb-test:${Buffer.from(JSON.stringify({
    lane: "hosted-member-private-field",
    scope: "hosted-group-disclosure-permission:permission-text:v1",
    userId: "group_runtime_1",
    value,
  }), "utf8").toString("base64url")}`;
}

function encodeBoundHostedSecureBoxTestValue(
  value: DisclosureSecureBoxTestPayload,
): string {
  return `hsb-disclosure-test:${Buffer.from(
    JSON.stringify(value),
    "utf8",
  ).toString("base64url")}`;
}

function decodeBoundHostedSecureBoxTestValue(
  value: string,
): DisclosureSecureBoxTestPayload {
  const prefix = "hsb-disclosure-test:";
  if (!value.startsWith(prefix)) {
    throw new Error("Hosted secure-box disclosure test payload has an unexpected prefix.");
  }
  return JSON.parse(
    Buffer.from(value.slice(prefix.length), "base64url").toString("utf8"),
  ) as DisclosureSecureBoxTestPayload;
}

function matchesDisclosureSecureBoxInput(
  decoded: DisclosureSecureBoxTestPayload,
  input: {
    aad: Record<string, unknown>;
    lane: string;
    scope: string;
    userId: string;
  },
): boolean {
  return decoded.lane === input.lane
    && decoded.scope === input.scope
    && decoded.userId === input.userId
    && decoded.aad.field === input.aad.field
    && decoded.aad.purpose === input.aad.purpose
    && decoded.aad.rowId === input.aad.rowId
    && decoded.aad.table === input.aad.table;
}

function requireDisclosureSecureBoxTestAad(input: {
  field?: string | null;
  purpose?: string | null;
  rowId?: string | null;
  table?: string | null;
}): DisclosureSecureBoxTestPayload["aad"] {
  if (
    typeof input.field !== "string"
    || typeof input.purpose !== "string"
    || typeof input.rowId !== "string"
    || typeof input.table !== "string"
  ) {
    throw new Error("Hosted secure-box disclosure test AAD is incomplete.");
  }
  return {
    field: input.field,
    purpose: input.purpose,
    rowId: input.rowId,
    table: input.table,
  };
}

function restoreDefaultHostedSecureBoxTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const decoded = JSON.parse(
        Buffer.from(input.value.replace(/^hsb-test:/u, ""), "base64url").toString("utf8"),
      ) as {
        lane?: string;
        scope?: string;
        userId?: string;
        value?: string;
      };
      if (
        decoded.lane !== input.lane
        || decoded.scope !== input.scope
        || decoded.userId !== input.userId
        || typeof decoded.value !== "string"
      ) {
        throw new Error("Hosted secure-box test codec metadata mismatch.");
      }
      return decoded.value;
    },
    encrypt(input) {
      return `hsb-test:${Buffer.from(JSON.stringify({
        lane: input.lane,
        scope: input.scope,
        userId: input.userId,
        value: input.value,
      }), "utf8").toString("base64url")}`;
    },
  });
}
