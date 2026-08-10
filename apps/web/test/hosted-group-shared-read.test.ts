import { Prisma, type PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH,
  HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH,
  HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY,
  hostedVaultShareProjectionKindToScope,
  type HostedVaultShareDeliveryRecord,
} from "@murphai/hosted-execution/vault-share";

const mocks = vi.hoisted(() => ({
  hasHostedRuntimeActiveAccess: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccess: mocks.hasHostedRuntimeActiveAccess,
}));

import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";
import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId,
  readHostedGroupSharedDataByRuntimeMemberId,
} from "@/src/lib/hosted-groups/group-store";
import {
  HOSTED_VAULT_SHARE_PROJECTION_SNAPSHOT_MAX_BYTES,
  parseHostedVaultShareProjectionSnapshot,
  serializeHostedVaultShareProjectionSnapshot,
} from "@/src/lib/hosted-vault-share/projection-snapshot";

const RUNTIME_MEMBER_ID = "member_group_runtime";
const PROFILE_SCOPE = hostedVaultShareProjectionKindToScope("profile-name.v0");
const PROTEIN_SCOPE = hostedVaultShareProjectionKindToScope("protein-days.v0");
const STEPS_SCOPE = hostedVaultShareProjectionKindToScope("steps-days.v0");
const DEEP_SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("deep-sleep-days.v0");
const DEEP_SLEEP_SOURCES_SCOPE = hostedVaultShareProjectionKindToScope(
  "deep-sleep-sources-days.v1",
);
const REM_SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("rem-sleep-days.v0");
const WORKOUTS_SCOPE = hostedVaultShareProjectionKindToScope(
  "workouts.v0",
);
const DEVICE_SCOPE = hostedVaultShareProjectionKindToScope("device-sync-status.v0");
const PROTEIN_KEY = buildHostedVaultShareProjectionScopeKey(PROTEIN_SCOPE);
const STEPS_KEY = buildHostedVaultShareProjectionScopeKey(STEPS_SCOPE);
const DEEP_SLEEP_KEY = buildHostedVaultShareProjectionScopeKey(DEEP_SLEEP_SCOPE);
const DEEP_SLEEP_SOURCES_KEY = buildHostedVaultShareProjectionScopeKey(
  DEEP_SLEEP_SOURCES_SCOPE,
);
const REM_SLEEP_KEY = buildHostedVaultShareProjectionScopeKey(REM_SLEEP_SCOPE);
const WORKOUTS_KEY = buildHostedVaultShareProjectionScopeKey(
  WORKOUTS_SCOPE,
);
const DEVICE_KEY = buildHostedVaultShareProjectionScopeKey(DEVICE_SCOPE);
const GRANTED_AT = new Date("2026-07-30T12:00:00.000Z");

type TestProjectionScope =
  | typeof PROFILE_SCOPE
  | typeof PROTEIN_SCOPE
  | typeof STEPS_SCOPE
  | typeof DEEP_SLEEP_SCOPE
  | typeof DEEP_SLEEP_SOURCES_SCOPE
  | typeof REM_SLEEP_SCOPE
  | typeof WORKOUTS_SCOPE
  | typeof DEVICE_SCOPE;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
});

afterEach(() => {
  setHostedSecureBoxStringTestCodecForTests(null);
});

function shareRow(input: {
  ciphertext?: string | null;
  grantedAt?: Date;
  id: string;
  memberId: string;
  projectionScope: TestProjectionScope;
}) {
  return {
    destinationMemberId: RUNTIME_MEMBER_ID,
    grantedAt: input.grantedAt ?? GRANTED_AT,
    grantorMemberId: input.memberId,
    id: input.id,
    projectionKind: input.projectionScope.projectionKind,
    projectionScopeJson: input.projectionScope,
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey(
      input.projectionScope,
    ),
    projectionSnapshotCiphertext: input.ciphertext ?? null,
  };
}

function snapshot(input: {
  id: string;
  memberId: string;
  projectionScope: TestProjectionScope;
  records: readonly HostedVaultShareDeliveryRecord[];
}): string {
  const share = shareRow(input);
  return serializeHostedVaultShareProjectionSnapshot({
    records: input.records,
    share: {
      destinationMemberId: share.destinationMemberId,
      grantorMemberId: share.grantorMemberId,
      id: share.id,
      projectionKind: share.projectionKind,
      projectionScope: input.projectionScope,
      projectionScopeKey: share.projectionScopeKey,
    },
  });
}

function installCiphertexts(values: Record<string, string>): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const plaintext = values[input.value];
      if (plaintext === undefined) throw new Error("invalid ciphertext");
      return plaintext;
    },
    encrypt() {
      throw new Error("unexpected encryption");
    },
  });
}

function createPrismaClientTestDouble(value: object): PrismaClient {
  // The generated client is wider than this unit's transaction seam. The
  // tests provide every method exercised by the shared-read operation.
  return value as PrismaClient;
}

function createPrisma(input: {
  connections?: unknown[];
  group?: {
    members: Array<{
      id: string;
      member?: {
        emailAuthorization: {
          verifiedEmailLookupKey: string | null;
          verifiedEmailVerifiedAt: Date | null;
        } | null;
        identity: {
          phoneLookupKey: string | null;
          phoneNumberVerifiedAt: Date | null;
        } | null;
        routing: { telegramUserLookupKey: string | null } | null;
        suspendedAt?: Date | null;
      };
      memberId: string;
    }>;
  } | null;
  readableShares?: unknown[];
  shares?: unknown[];
}) {
  const hostedGroupFindUnique = vi.fn().mockResolvedValue(
    input.group === undefined
      ? {
          members: [
            { id: "participant_a", memberId: "member_a" },
            { id: "participant_b", memberId: "member_b" },
            { id: "participant_c", memberId: "member_c" },
          ],
        }
      : input.group,
  );
  const hostedVaultShareFindMany = vi.fn().mockImplementation(
    (args: { where?: { id?: unknown } }) => Promise.resolve(
      args.where?.id
        ? input.readableShares ?? input.shares ?? []
        : input.shares ?? [],
    ),
  );
  const deviceConnectionFindMany = vi.fn().mockResolvedValue(input.connections ?? []);
  const tx = {
    deviceConnection: { findMany: deviceConnectionFindMany },
    hostedGroup: { findUnique: hostedGroupFindUnique },
    hostedVaultShare: { findMany: hostedVaultShareFindMany },
  };
  const transaction = vi.fn(async (
    callback: (client: typeof tx) => Promise<unknown>,
  ) => callback(tx));
  return {
    deviceConnectionFindMany,
    hostedGroupFindUnique,
    hostedVaultShareFindMany,
    prisma: createPrismaClientTestDouble({ $transaction: transaction }),
    transaction,
  };
}

describe("readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId", () => {
  it("keeps canonical senders contact-eligible before a hosted group exists", async () => {
    const canonicalPhone = "+15556660006";
    const noncanonicalHandle = "member@example.test";
    const {
      hostedGroupFindUnique,
      hostedVaultShareFindMany,
      prisma,
    } = createPrisma({ group: null });

    await expect(
      readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId({
        linqSenderHandles: [canonicalPhone, noncanonicalHandle],
        prisma,
        runtimeMemberId: RUNTIME_MEMBER_ID,
      }),
    ).resolves.toEqual({
      candidates: [
        {
          profileDisplayName: null,
          senderHandle: canonicalPhone,
        },
        {
          profileDisplayName: null,
          senderHandle: noncanonicalHandle,
        },
      ],
      status: "ok",
    });

    expect(hostedGroupFindUnique).toHaveBeenCalledTimes(1);
    expect(hostedVaultShareFindMany).not.toHaveBeenCalled();
    expect(mocks.hasHostedRuntimeActiveAccess).toHaveBeenCalledTimes(1);
  });

  it("keeps a pre-group room unnamed when the synthetic runtime is inactive", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);
    const {
      hostedVaultShareFindMany,
      prisma,
    } = createPrisma({ group: null });

    await expect(
      readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId({
        linqSenderHandles: ["+15556660006"],
        prisma,
        runtimeMemberId: RUNTIME_MEMBER_ID,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "runtime_inactive",
    });
    expect(hostedVaultShareFindMany).not.toHaveBeenCalled();
  });

  it("treats a granted profile share with a pending snapshot as unavailable", async () => {
    const senderHandle = "+15557770007";
    const verifiedAt = new Date("2026-07-29T12:00:00.000Z");
    const {
      hostedVaultShareFindMany,
      prisma,
    } = createPrisma({
      group: {
        members: [{
          id: "participant_pending_profile",
          member: {
            emailAuthorization: null,
            identity: {
              phoneLookupKey: createHostedPhoneLookupKey(senderHandle),
              phoneNumberVerifiedAt: verifiedAt,
            },
            routing: null,
            suspendedAt: null,
          },
          memberId: "member_pending_profile",
        }],
      },
      shares: [shareRow({
        id: "share_pending_profile",
        memberId: "member_pending_profile",
        projectionScope: PROFILE_SCOPE,
      })],
    });

    await expect(
      readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId({
        linqSenderHandles: [senderHandle],
        prisma,
        runtimeMemberId: RUNTIME_MEMBER_ID,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "participant_names_unavailable",
    });
    expect(hostedVaultShareFindMany).toHaveBeenCalledTimes(1);
  });

  it("decrypts exact active-member profiles and omits ambiguous or suspended handles", async () => {
    const uniqueHandle = "+15551110001";
    const noProfileHandle = "+15553330003";
    const noMemberHandle = "+15554440004";
    const suspendedHandle = "+15555550005";
    const ambiguousHandle = "+15552220002";
    const verifiedAt = new Date("2026-07-27T12:00:00.000Z");
    const profileA = snapshot({
      id: "share_profile_a",
      memberId: "member_a",
      projectionScope: PROFILE_SCOPE,
      records: [{
        data: { displayName: "Alice Example" },
        occurredAt: verifiedAt.toISOString(),
        recordKey: "profile-name",
      }],
    });
    installCiphertexts({ profileA });
    const member = (
      id: string,
      memberId: string,
      phoneNumber: string,
      suspendedAt: Date | null = null,
    ) => ({
      id,
      member: {
        emailAuthorization: null,
        identity: {
          phoneLookupKey: createHostedPhoneLookupKey(phoneNumber),
          phoneNumberVerifiedAt: verifiedAt,
        },
        routing: null,
        suspendedAt,
      },
      memberId,
    });
    const {
      deviceConnectionFindMany,
      hostedGroupFindUnique,
      hostedVaultShareFindMany,
      prisma,
    } = createPrisma({
      group: {
        members: [
          member("participant_a", "member_a", uniqueHandle),
          member("participant_b", "member_b", ambiguousHandle),
          member("participant_c", "member_c", ambiguousHandle),
          member("participant_d", "member_d", noProfileHandle),
          member(
            "participant_e",
            "member_e",
            suspendedHandle,
            new Date("2026-07-27T13:00:00.000Z"),
          ),
        ],
      },
      shares: [
        shareRow({
          ciphertext: "profileA",
          id: "share_profile_a",
          memberId: "member_a",
          projectionScope: PROFILE_SCOPE,
        }),
      ],
    });

    await expect(
      readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId({
        linqSenderHandles: [
          uniqueHandle,
          ambiguousHandle,
          noProfileHandle,
          noMemberHandle,
          suspendedHandle,
        ],
        prisma,
        runtimeMemberId: RUNTIME_MEMBER_ID,
      }),
    ).resolves.toEqual({
      candidates: [
        {
          profileDisplayName: "Alice Example",
          senderHandle: uniqueHandle,
        },
        {
          profileDisplayName: null,
          senderHandle: noProfileHandle,
        },
        {
          profileDisplayName: null,
          senderHandle: noMemberHandle,
        },
      ],
      status: "ok",
    });

    expect(hostedGroupFindUnique).toHaveBeenCalledTimes(1);
    expect(hostedVaultShareFindMany).toHaveBeenCalledTimes(1);
    expect(hostedGroupFindUnique).toHaveBeenCalledWith(expect.objectContaining({
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
                suspendedAt: true,
              },
            },
            memberId: true,
          },
          where: {
            joinedAt: { not: null },
          },
        }),
      },
      where: { runtimeMemberId: RUNTIME_MEMBER_ID },
    }));
    expect(hostedVaultShareFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          destinationMemberId: RUNTIME_MEMBER_ID,
          grantorMemberId: { in: ["member_a", "member_d"] },
          projectionScopeKey:
            buildHostedVaultShareProjectionScopeKey(PROFILE_SCOPE),
          status: "granted",
        },
      }),
    );
    expect(deviceConnectionFindMany).not.toHaveBeenCalled();
  });
});

describe("workouts.v0 snapshot bounds", () => {
  it("keeps the maximum parser-valid eight-date workout snapshot within its byte limit", () => {
    // This finite in-range value exercises the longest JSON number spelling used
    // by the bounded duration field rather than relying only on integer minutes.
    const maximumWidthMinutes = 0.0000030024105450300988;
    expect(JSON.stringify(maximumWidthMinutes)).toHaveLength(24);

    const records = Array.from(
      { length: HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS },
      (_, dayIndex): HostedVaultShareDeliveryRecord => {
        const date = `2026-07-${String(24 - dayIndex).padStart(2, "0")}`;
        return {
          data: {
            calendarClosedThroughDate: "2026-07-23",
            date,
            timeSemantics: "canonical-event-zone-or-vault-zone.v0",
            workouts: Array.from(
              { length: HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY },
              (_, workoutIndex) => ({
                kind: "x".repeat(HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH),
                minutes: maximumWidthMinutes,
                startLocalMs: 86_399_999 - workoutIndex,
              }),
            ),
          },
          occurredAt: `${date}T00:00:00.000Z`,
          recordKey: date,
          sourceRevision: "A".repeat(
            HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH,
          ),
        };
      },
    );

    const serialized = snapshot({
      id: "share_workouts_maximum",
      memberId: "member_workouts_maximum",
      projectionScope: WORKOUTS_SCOPE,
      records,
    });
    const encoder = new TextEncoder();

    const snapshotBytes = encoder.encode(serialized).byteLength;
    expect(snapshotBytes).toBe(18_352);
    expect(snapshotBytes).toBeLessThanOrEqual(
      HOSTED_VAULT_SHARE_PROJECTION_SNAPSHOT_MAX_BYTES,
    );
  });

  it("rejects an oversized snapshot before parsing or publishing any records", () => {
    const share = shareRow({
      id: "share_workouts_oversized",
      memberId: "member_workouts_oversized",
      projectionScope: WORKOUTS_SCOPE,
    });

    expect(() =>
      parseHostedVaultShareProjectionSnapshot({
        plaintext: "x".repeat(
          HOSTED_VAULT_SHARE_PROJECTION_SNAPSHOT_MAX_BYTES + 1,
        ),
        share: {
          destinationMemberId: share.destinationMemberId,
          grantorMemberId: share.grantorMemberId,
          id: share.id,
          projectionKind: share.projectionKind,
          projectionScope: WORKOUTS_SCOPE,
          projectionScopeKey: share.projectionScopeKey,
        },
      })
    ).toThrow(/snapshot is too large/u);
  });
});

describe("readHostedGroupSharedDataByRuntimeMemberId", () => {
  it("returns scoped participant keys and the complete matrix when names collide", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const profileA = snapshot({
      id: "share_profile_a",
      memberId: "member_a",
      projectionScope: PROFILE_SCOPE,
      records: [{
        data: { displayName: "Alex" },
        occurredAt: yesterday.toISOString(),
        recordKey: "profile-name",
      }],
    });
    const profileB = snapshot({
      id: "share_profile_b",
      memberId: "member_b",
      projectionScope: PROFILE_SCOPE,
      records: [{
        data: { displayName: "Alex" },
        occurredAt: yesterday.toISOString(),
        recordKey: "profile-name",
      }],
    });
    const stepsA = snapshot({
      id: "share_steps_a",
      memberId: "member_a",
      projectionScope: STEPS_SCOPE,
      records: [{
        data: {
          date: yesterday.toISOString().slice(0, 10),
          metricKey: "steps",
          unit: "count",
          value: 8123,
        },
        occurredAt: `${yesterday.toISOString().slice(0, 10)}T00:00:00.000Z`,
        recordKey: yesterday.toISOString().slice(0, 10),
      }],
    });
    const stepsB = snapshot({
      id: "share_steps_b",
      memberId: "member_b",
      projectionScope: STEPS_SCOPE,
      records: [],
    });
    installCiphertexts({ profileA, profileB, stepsA, stepsB });

    const shares = [
      shareRow({ ciphertext: "profileA", id: "share_profile_a", memberId: "member_a", projectionScope: PROFILE_SCOPE }),
      shareRow({ ciphertext: "stepsA", id: "share_steps_a", memberId: "member_a", projectionScope: STEPS_SCOPE }),
      shareRow({ id: "share_device_a", memberId: "member_a", projectionScope: DEVICE_SCOPE }),
      shareRow({ ciphertext: "profileB", id: "share_profile_b", memberId: "member_b", projectionScope: PROFILE_SCOPE }),
      shareRow({ ciphertext: "stepsB", id: "share_steps_b", memberId: "member_b", projectionScope: STEPS_SCOPE }),
      shareRow({ id: "share_device_c", memberId: "member_c", projectionScope: DEVICE_SCOPE }),
    ];
    const { deviceConnectionFindMany, prisma, transaction } = createPrisma({
      connections: [{
        lastSyncCompletedAt: yesterday,
        lastSyncErrorAt: null,
        provider: "apple-health",
        setupPhase: null,
        sources: [],
        status: "active",
        updatedAt: yesterday,
        userId: "member_c",
      }],
      shares,
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [STEPS_SCOPE, DEVICE_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.requestedProjectionScopeKeys).toEqual([STEPS_KEY, DEVICE_KEY]);
    expect(result.members).toHaveLength(3);
    expect(result.members[0]).toMatchObject({
      displayName: "Alex",
      memberId: "member_a",
      participantId: "participant_a",
      projections: [
        {
          dataStatus: "available",
          grantedAt: GRANTED_AT.toISOString(),
          grantStatus: "granted",
        },
        {
          dataStatus: "available",
          grantedAt: GRANTED_AT.toISOString(),
          grantStatus: "granted",
        },
      ],
    });
    expect(result.members[0]?.projections[1]?.records[0]?.data).toMatchObject({
      sources: [],
    });
    expect(result.members[1]).toMatchObject({
      displayName: "Alex",
      memberId: "member_b",
      participantId: "participant_b",
      projections: [
        {
          dataStatus: "missing",
          grantedAt: GRANTED_AT.toISOString(),
          grantStatus: "granted",
          records: [],
        },
        {
          dataStatus: "missing",
          grantedAt: null,
          grantStatus: "not_granted",
          records: [],
        },
      ],
    });
    expect(result.members.map(({ participantId }) => participantId)).toEqual([
      "participant_a",
      "participant_b",
      "participant_c",
    ]);
    expect(result.members[2]).toMatchObject({
      displayName: null,
      memberId: "member_c",
      participantId: "participant_c",
      projections: [
        {
          dataStatus: "missing",
          grantedAt: null,
          grantStatus: "not_granted",
          records: [],
        },
        {
          dataStatus: "available",
          grantedAt: GRANTED_AT.toISOString(),
          grantStatus: "granted",
          records: [{
            data: {
              sources: [{
                connectionSyncJobCompletedAt: yesterday.toISOString(),
                label: "Apple Health",
                status: "connected",
              }],
            },
          }],
        },
      ],
    });
    expect(transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      }),
    );
    expect(deviceConnectionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: {
        lastSyncCompletedAt: true,
        lastSyncErrorAt: true,
        provider: true,
        setupPhase: true,
        sources: expect.objectContaining({
          select: {
            sourceProviderSlug: true,
            status: true,
            updatedAt: true,
          },
        }),
        status: true,
        updatedAt: true,
        userId: true,
      },
      where: { userId: { in: ["member_a", "member_c"] } },
    }));
  });

  it("returns the encrypted protein grant matrix without source or meal metadata", async () => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const proteinA = snapshot({
      id: "share_protein_a",
      memberId: "member_a",
      projectionScope: PROTEIN_SCOPE,
      records: [{
        data: {
          date,
          metricKey: "protein-grams",
          unit: "g",
          value: 94,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
        sourceRevision: "p".repeat(32),
      }],
    });
    const proteinB = snapshot({
      id: "share_protein_b",
      memberId: "member_b",
      projectionScope: PROTEIN_SCOPE,
      records: [],
    });
    installCiphertexts({ proteinA, proteinB });
    const { prisma } = createPrisma({
      shares: [
        shareRow({
          ciphertext: "proteinA",
          id: "share_protein_a",
          memberId: "member_a",
          projectionScope: PROTEIN_SCOPE,
        }),
        shareRow({
          ciphertext: "proteinB",
          id: "share_protein_b",
          memberId: "member_b",
          projectionScope: PROTEIN_SCOPE,
        }),
      ],
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [PROTEIN_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.requestedProjectionScopeKeys).toEqual([PROTEIN_KEY]);
    expect(result.members[0]?.projections).toEqual([{
      dataStatus: "available",
      grantedAt: GRANTED_AT.toISOString(),
      grantStatus: "granted",
      projectionScope: PROTEIN_SCOPE,
      projectionScopeKey: PROTEIN_KEY,
      records: [{
        data: {
          date,
          metricKey: "protein-grams",
          unit: "g",
          value: 94,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
      }],
    }]);
    expect(result.members[1]?.projections).toEqual([{
      dataStatus: "missing",
      grantedAt: GRANTED_AT.toISOString(),
      grantStatus: "granted",
      projectionScope: PROTEIN_SCOPE,
      projectionScopeKey: PROTEIN_KEY,
      records: [],
    }]);
    expect(result.members[2]?.projections).toEqual([{
      dataStatus: "missing",
      grantedAt: null,
      grantStatus: "not_granted",
      projectionScope: PROTEIN_SCOPE,
      projectionScopeKey: PROTEIN_KEY,
      records: [],
    }]);
    expect(JSON.stringify(result)).not.toContain("sourceRevision");
    expect(JSON.stringify(result)).not.toContain("mealId");
    expect(JSON.stringify(result)).not.toContain("externalRef");
  });

  it("preserves an encrypted daily-metric zero as available shared data", async () => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const stepsZero = snapshot({
      id: "share_steps_zero",
      memberId: "member_zero",
      projectionScope: STEPS_SCOPE,
      records: [{
        data: {
          date,
          metricKey: "steps",
          unit: "count",
          value: 0,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
      }],
    });
    installCiphertexts({ stepsZero });
    const { prisma } = createPrisma({
      group: {
        members: [{ id: "participant_zero", memberId: "member_zero" }],
      },
      shares: [shareRow({
        ciphertext: "stepsZero",
        id: "share_steps_zero",
        memberId: "member_zero",
        projectionScope: STEPS_SCOPE,
      })],
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [STEPS_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.members).toEqual([expect.objectContaining({
      memberId: "member_zero",
      participantId: "participant_zero",
      projections: [expect.objectContaining({
        dataStatus: "available",
        grantStatus: "granted",
        records: [expect.objectContaining({
          data: expect.objectContaining({ value: 0 }),
        })],
      })],
    })]);
  });

  it("preserves every consented sleep source and snapshot timestamp", async () => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const records = [{
      data: {
        date,
        metricKey: "deep-sleep-minutes",
        projectedAt: `${date}T12:00:00.000Z`,
        sources: [
          {
            label: "fitbit",
            recordedAt: `${date}T06:58:00.000Z`,
            source: "fitbit",
            unit: "minutes",
            value: 64,
          },
          {
            label: "Garmin",
            recordedAt: `${date}T07:01:00.000Z`,
            selected: true as const,
            source: "garmin",
            unit: "minutes",
            value: 88,
          },
          {
            label: "Oura",
            recordedAt: null,
            source: "oura",
            unit: "minutes",
            value: 112,
          },
        ],
        sourcesDisagree: true,
        unit: "minutes",
        value: 88,
      },
      occurredAt: `${date}T00:00:00.000Z`,
      recordKey: date,
      sourceRevision: "D".repeat(32),
    }];
    const sourceAwareSleep = snapshot({
      id: "share_deep_sources",
      memberId: "member_sources",
      projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
      records,
    });
    installCiphertexts({ sourceAwareSleep });
    const { prisma } = createPrisma({
      group: {
        members: [{ id: "participant_sources", memberId: "member_sources" }],
      },
      shares: [shareRow({
        ciphertext: "sourceAwareSleep",
        id: "share_deep_sources",
        memberId: "member_sources",
        projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
      })],
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [DEEP_SLEEP_SOURCES_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.requestedProjectionScopeKeys).toEqual([DEEP_SLEEP_SOURCES_KEY]);
    expect(result.members[0]?.projections[0]).toMatchObject({
      dataStatus: "available",
      grantStatus: "granted",
      records: [{ data: records[0]?.data }],
    });
    expect(JSON.stringify(result)).not.toContain("sourceRevision");
  });

  it("lets a frozen v0 sleep read consume only the canonical value from a v1 grant", async () => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const sourceAwareSleep = snapshot({
      id: "share_deep_sources_for_legacy_read",
      memberId: "member_legacy_reader",
      projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
      records: [{
        data: {
          date,
          metricKey: "deep-sleep-minutes",
          projectedAt: `${date}T12:00:00.000Z`,
          sources: [
            {
              label: "fitbit",
              recordedAt: `${date}T06:58:00.000Z`,
              source: "fitbit",
              unit: "minutes",
              value: 64,
            },
            {
              label: "Garmin",
              recordedAt: `${date}T07:01:00.000Z`,
              selected: true as const,
              source: "garmin",
              unit: "minutes",
              value: 88,
            },
          ],
          sourcesDisagree: true,
          unit: "minutes",
          value: 88,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
        sourceRevision: "E".repeat(32),
      }],
    });
    installCiphertexts({ sourceAwareSleep });
    const { prisma } = createPrisma({
      group: {
        members: [{
          id: "participant_legacy_reader",
          memberId: "member_legacy_reader",
        }],
      },
      shares: [shareRow({
        ciphertext: "sourceAwareSleep",
        id: "share_deep_sources_for_legacy_read",
        memberId: "member_legacy_reader",
        projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
      })],
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [DEEP_SLEEP_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.requestedProjectionScopeKeys).toEqual([DEEP_SLEEP_KEY]);
    expect(result.members[0]?.projections[0]).toEqual({
      dataStatus: "available",
      grantedAt: GRANTED_AT.toISOString(),
      grantStatus: "granted",
      projectionScope: DEEP_SLEEP_SCOPE,
      projectionScopeKey: DEEP_SLEEP_KEY,
      records: [{
        data: {
          date,
          metricKey: "deep-sleep-minutes",
          unit: "minutes",
          value: 88,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
      }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /fitbit|Garmin|garmin|projectedAt|recordedAt|selected|sourcesDisagree|sourceRevision/u,
    );
  });

  it("prefers an exact v0 sleep grant over a v1 compatibility fallback", async () => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const legacySleep = snapshot({
      id: "share_deep_exact_legacy",
      memberId: "member_exact_legacy",
      projectionScope: DEEP_SLEEP_SCOPE,
      records: [{
        data: {
          date,
          metricKey: "deep-sleep-minutes",
          unit: "minutes",
          value: 70,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
      }],
    });
    const sourceAwareSleep = snapshot({
      id: "share_deep_sources_alternative",
      memberId: "member_exact_legacy",
      projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
      records: [{
        data: {
          date,
          metricKey: "deep-sleep-minutes",
          projectedAt: `${date}T12:00:00.000Z`,
          sources: [{
            label: "Garmin",
            recordedAt: `${date}T07:01:00.000Z`,
            selected: true as const,
            source: "garmin",
            unit: "minutes",
            value: 88,
          }],
          sourcesDisagree: false,
          unit: "minutes",
          value: 88,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
      }],
    });
    installCiphertexts({ legacySleep, sourceAwareSleep });
    const { prisma } = createPrisma({
      group: {
        members: [{
          id: "participant_exact_legacy",
          memberId: "member_exact_legacy",
        }],
      },
      shares: [
        shareRow({
          ciphertext: "legacySleep",
          id: "share_deep_exact_legacy",
          memberId: "member_exact_legacy",
          projectionScope: DEEP_SLEEP_SCOPE,
        }),
        shareRow({
          ciphertext: "sourceAwareSleep",
          id: "share_deep_sources_alternative",
          memberId: "member_exact_legacy",
          projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
        }),
      ],
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [DEEP_SLEEP_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.members[0]?.projections[0]).toMatchObject({
      dataStatus: "available",
      grantStatus: "granted",
      projectionScope: DEEP_SLEEP_SCOPE,
      projectionScopeKey: DEEP_SLEEP_KEY,
      records: [{ data: { value: 70 } }],
    });
  });

  it("returns the complete sleep-stage and workout-timing member-by-scope matrix", async () => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const deepZero = snapshot({
      id: "share_deep_a",
      memberId: "member_a",
      projectionScope: DEEP_SLEEP_SCOPE,
      records: [{
        data: {
          date,
          metricKey: "deep-sleep-minutes",
          unit: "minutes",
          value: 0,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
        sourceRevision: "A".repeat(32),
      }],
    });
    const remAvailable = snapshot({
      id: "share_rem_a",
      memberId: "member_a",
      projectionScope: REM_SLEEP_SCOPE,
      records: [{
        data: {
          date,
          metricKey: "rem-sleep-minutes",
          unit: "minutes",
          value: 84,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
        sourceRevision: "B".repeat(32),
      }],
    });
    const workoutsAtMidnight = snapshot({
      id: "share_workouts_a",
      memberId: "member_a",
      projectionScope: WORKOUTS_SCOPE,
      records: [{
        data: {
          calendarClosedThroughDate: date,
          date,
          timeSemantics: "canonical-event-zone-or-vault-zone.v0",
          workouts: [{ kind: "running", minutes: 30, startLocalMs: 0 }],
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
        sourceRevision: "C".repeat(32),
      }],
    });
    const deepEmpty = snapshot({
      id: "share_deep_b",
      memberId: "member_b",
      projectionScope: DEEP_SLEEP_SCOPE,
      records: [],
    });
    installCiphertexts({ deepEmpty, deepZero, remAvailable, workoutsAtMidnight });
    const { prisma } = createPrisma({
      shares: [
        shareRow({
          ciphertext: "deepZero",
          id: "share_deep_a",
          memberId: "member_a",
          projectionScope: DEEP_SLEEP_SCOPE,
        }),
        shareRow({
          ciphertext: "remAvailable",
          id: "share_rem_a",
          memberId: "member_a",
          projectionScope: REM_SLEEP_SCOPE,
        }),
        shareRow({
          ciphertext: "workoutsAtMidnight",
          id: "share_workouts_a",
          memberId: "member_a",
          projectionScope: WORKOUTS_SCOPE,
        }),
        shareRow({
          ciphertext: "deepEmpty",
          id: "share_deep_b",
          memberId: "member_b",
          projectionScope: DEEP_SLEEP_SCOPE,
        }),
        shareRow({
          id: "share_rem_b",
          memberId: "member_b",
          projectionScope: REM_SLEEP_SCOPE,
        }),
        shareRow({
          id: "share_workouts_c",
          memberId: "member_c",
          projectionScope: WORKOUTS_SCOPE,
        }),
      ],
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [
        DEEP_SLEEP_SCOPE,
        REM_SLEEP_SCOPE,
        WORKOUTS_SCOPE,
      ],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.requestedProjectionScopeKeys).toEqual([
      DEEP_SLEEP_KEY,
      REM_SLEEP_KEY,
      WORKOUTS_KEY,
    ]);
    expect(result.members).toHaveLength(3);
    for (const member of result.members) {
      expect(member.projections).toHaveLength(3);
    }
    expect(result.members[0]).toMatchObject({
      memberId: "member_a",
      participantId: "participant_a",
      projections: [
        {
          dataStatus: "available",
          grantStatus: "granted",
          records: [{ data: { value: 0 } }],
        },
        {
          dataStatus: "available",
          grantStatus: "granted",
          records: [{ data: { value: 84 } }],
        },
        {
          dataStatus: "available",
          grantStatus: "granted",
          records: [{
            data: {
              workouts: [{ kind: "running", minutes: 30, startLocalMs: 0 }],
            },
          }],
        },
      ],
    });
    expect(result.members[1]?.projections).toEqual([
      expect.objectContaining({
        dataStatus: "missing",
        grantStatus: "granted",
        records: [],
      }),
      expect.objectContaining({
        dataStatus: "missing",
        grantStatus: "granted",
        records: [],
      }),
      expect.objectContaining({
        dataStatus: "missing",
        grantStatus: "not_granted",
        records: [],
      }),
    ]);
    expect(result.members[2]?.projections).toEqual([
      expect.objectContaining({
        dataStatus: "missing",
        grantStatus: "not_granted",
        records: [],
      }),
      expect.objectContaining({
        dataStatus: "missing",
        grantStatus: "not_granted",
        records: [],
      }),
      expect.objectContaining({
        dataStatus: "missing",
        grantStatus: "granted",
        records: [],
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("sourceRevision");
  });

  it("preserves an encrypted protein zero as available shared data", async () => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const proteinZero = snapshot({
      id: "share_protein_zero",
      memberId: "member_protein_zero",
      projectionScope: PROTEIN_SCOPE,
      records: [{
        data: {
          date,
          metricKey: "protein-grams",
          unit: "g",
          value: 0,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
      }],
    });
    installCiphertexts({ proteinZero });
    const { prisma } = createPrisma({
      group: {
        members: [{
          id: "participant_protein_zero",
          memberId: "member_protein_zero",
        }],
      },
      shares: [shareRow({
        ciphertext: "proteinZero",
        id: "share_protein_zero",
        memberId: "member_protein_zero",
        projectionScope: PROTEIN_SCOPE,
      })],
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [PROTEIN_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.members).toEqual([expect.objectContaining({
      memberId: "member_protein_zero",
      participantId: "participant_protein_zero",
      projections: [{
        dataStatus: "available",
        grantedAt: GRANTED_AT.toISOString(),
        grantStatus: "granted",
        projectionScope: PROTEIN_SCOPE,
        projectionScopeKey: PROTEIN_KEY,
        records: [{
          data: {
            date,
            metricKey: "protein-grams",
            unit: "g",
            value: 0,
          },
          occurredAt: `${date}T00:00:00.000Z`,
          recordKey: date,
        }],
      }],
    })]);
  });

  it("does not read device state without an active device-status grant", async () => {
    installCiphertexts({});
    const { deviceConnectionFindMany, prisma } = createPrisma({ shares: [] });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [DEVICE_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    expect(deviceConnectionFindMany).not.toHaveBeenCalled();
  });

  it("keeps a consented grant visible when inactive access withholds its snapshot", async () => {
    installCiphertexts({});
    const inactiveGrant = shareRow({
      ciphertext: "must-not-decrypt",
      id: "share_steps_a",
      memberId: "member_a",
      projectionScope: STEPS_SCOPE,
    });
    const { hostedVaultShareFindMany, prisma } = createPrisma({
      readableShares: [],
      shares: [inactiveGrant],
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [STEPS_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(hostedVaultShareFindMany).toHaveBeenCalledTimes(2);
    expect(hostedVaultShareFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        select: expect.not.objectContaining({
          projectionSnapshotCiphertext: true,
        }),
        where: expect.objectContaining({
          grantor: {
            AND: expect.arrayContaining([
              { suspendedAt: null },
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
    expect(hostedVaultShareFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        select: { id: true, projectionSnapshotCiphertext: true },
        where: expect.objectContaining({
          id: { in: [inactiveGrant.id] },
          grantor: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ suspendedAt: null }),
              {
                consentGrants: {
                  none: {
                    scope: "launch.health-data",
                    status: "revoked",
                  },
                },
              },
            ]),
          }),
        }),
      }),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.members).toHaveLength(3);
    expect(result.members.map((member) => member.projections[0])).toEqual([
      expect.objectContaining({
        dataStatus: "missing",
        grantedAt: GRANTED_AT.toISOString(),
        grantStatus: "granted",
        records: [],
      }),
      expect.objectContaining({
        dataStatus: "missing",
        grantStatus: "not_granted",
        records: [],
      }),
      expect.objectContaining({
        dataStatus: "missing",
        grantStatus: "not_granted",
        records: [],
      }),
    ]);
  });

  it("does not synthesize device data when inactive access withholds the device grant", async () => {
    installCiphertexts({});
    const inactiveDeviceGrant = shareRow({
      id: "share_device_a",
      memberId: "member_a",
      projectionScope: DEVICE_SCOPE,
    });
    const { deviceConnectionFindMany, prisma } = createPrisma({
      readableShares: [],
      shares: [inactiveDeviceGrant],
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [DEVICE_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(deviceConnectionFindMany).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.members[0]?.projections[0]).toEqual(expect.objectContaining({
      dataStatus: "missing",
      grantedAt: GRANTED_AT.toISOString(),
      grantStatus: "granted",
      records: [],
    }));
  });

  it("keeps duplicate public device-source fields on the latest connection generation", async () => {
    installCiphertexts({});
    const staleObservedAt = new Date(Date.now() - 10 * 60_000);
    const currentObservedAt = new Date(Date.now() - 60_000);
    const currentSyncCompletedAt = new Date(Date.now() - 2 * 60_000);
    const staleConnectedAt = new Date(Date.now() - 14 * 24 * 60 * 60_000);
    const currentConnectedAt = new Date(Date.now() - 24 * 60 * 60_000);
    const { deviceConnectionFindMany, prisma } = createPrisma({
      shares: [
        shareRow({ id: "share_device_a", memberId: "member_a", projectionScope: DEVICE_SCOPE }),
      ],
    });
    deviceConnectionFindMany.mockImplementation(async (args) => {
      expect(args).toMatchObject({
        orderBy: [
          { userId: "asc" },
          { connectedAt: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
      });
      return [
        {
          connectedAt: staleConnectedAt,
          createdAt: currentConnectedAt,
          id: "connection_created_later_but_connected_earlier",
          lastSyncCompletedAt: new Date(Date.now() - 60 * 60_000),
          lastSyncErrorAt: null,
          provider: "junction",
          setupPhase: null,
          sources: [{
            sourceProviderSlug: "apple_health_kit",
            status: "disconnected",
            updatedAt: staleObservedAt,
          }],
          status: "disconnected",
          updatedAt: staleObservedAt,
          userId: "member_a",
        },
        {
          connectedAt: currentConnectedAt,
          createdAt: staleConnectedAt,
          id: "connection_created_earlier_but_reconnected_later",
          lastSyncCompletedAt: currentSyncCompletedAt,
          lastSyncErrorAt: null,
          provider: "junction",
          setupPhase: null,
          sources: [{
            sourceProviderSlug: "apple_health_kit",
            status: "connected",
            updatedAt: currentObservedAt,
          }],
          status: "active",
          updatedAt: currentObservedAt,
          userId: "member_a",
        },
      ];
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [DEVICE_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.members[0]?.projections[0]?.records[0]?.data).toMatchObject({
      sources: [{
        connectionSyncJobCompletedAt: currentSyncCompletedAt.toISOString(),
        label: "Apple Health",
        status: "connected",
        statusObservedAt: currentObservedAt.toISOString(),
      }],
    });
  });

  it("keeps the newest same-label source alias as one complete observation", async () => {
    installCiphertexts({});
    const olderObservedAt = new Date(Date.now() - 10 * 60_000);
    const newerObservedAt = new Date(Date.now() - 60_000);
    const olderLastSeenAt = new Date(Date.now() - 24 * 60 * 60_000);
    const newerLastSeenAt = new Date(Date.now() - 30 * 60_000);
    const syncCompletedAt = new Date(Date.now() - 2 * 60_000);
    const { deviceConnectionFindMany, prisma } = createPrisma({
      shares: [
        shareRow({ id: "share_device_a", memberId: "member_a", projectionScope: DEVICE_SCOPE }),
      ],
    });
    deviceConnectionFindMany.mockImplementation(async (args) => {
      expect(args).toMatchObject({
        select: {
          sources: {
            orderBy: [
              { lastSeenAt: "asc" },
              { createdAt: "asc" },
              { id: "asc" },
              { sourceProviderSlug: "asc" },
            ],
          },
        },
      });
      return [{
        lastSyncCompletedAt: syncCompletedAt,
        lastSyncErrorAt: null,
        provider: "junction",
        setupPhase: null,
        sources: [
          {
            lastSeenAt: olderLastSeenAt,
            sourceProviderSlug: "apple_health_kit",
            status: "connected",
            updatedAt: olderObservedAt,
          },
          {
            lastSeenAt: newerLastSeenAt,
            sourceProviderSlug: "apple_health",
            status: "reauthorization_required",
            updatedAt: newerObservedAt,
          },
        ],
        status: "active",
        updatedAt: olderObservedAt,
        userId: "member_a",
      }];
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [DEVICE_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.members[0]?.projections[0]?.records[0]?.data).toMatchObject({
      sources: [{
        connectionSyncJobCompletedAt: syncCompletedAt.toISOString(),
        label: "Apple Health",
        status: "needs-reconnect",
        statusObservedAt: newerObservedAt.toISOString(),
      }],
    });
  });

  it.each(["", "   "])(
    "fails closed without returning a roster when ciphertext is blank: %j",
    async (ciphertext) => {
      const { prisma } = createPrisma({
        shares: [shareRow({
          ciphertext,
          id: "share_steps_a",
          memberId: "member_a",
          projectionScope: STEPS_SCOPE,
        })],
      });

      await expect(readHostedGroupSharedDataByRuntimeMemberId({
        prisma,
        projectionScopes: [STEPS_SCOPE],
        runtimeMemberId: RUNTIME_MEMBER_ID,
      })).resolves.toEqual({
        status: "unavailable",
        unavailableReason: "shared_data_unavailable",
      });
    },
  );

  it("uses neutral public labels for unknown device provider and source keys", async () => {
    installCiphertexts({});
    const observedAt = new Date(Date.now() - 60_000);
    const { prisma } = createPrisma({
      connections: [
        {
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          provider: "internal_beta_provider",
          setupPhase: null,
          sources: [],
          status: "active",
          updatedAt: observedAt,
          userId: "member_a",
        },
        {
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          provider: "internal_source_owner",
          setupPhase: null,
          sources: [{
            sourceProviderSlug: "internal_source_key",
            status: "connected",
            updatedAt: observedAt,
          }],
          status: "active",
          updatedAt: observedAt,
          userId: "member_b",
        },
      ],
      shares: [
        shareRow({ id: "share_device_a", memberId: "member_a", projectionScope: DEVICE_SCOPE }),
        shareRow({ id: "share_device_b", memberId: "member_b", projectionScope: DEVICE_SCOPE }),
      ],
    });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [DEVICE_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    for (const memberId of ["member_a", "member_b"]) {
      const member = result.members.find((candidate) => candidate.memberId === memberId);
      expect(member?.projections[0]?.records[0]?.data).toMatchObject({
        sources: [expect.objectContaining({ label: "Connected source" })],
      });
    }
    expect(JSON.stringify(result)).not.toContain("internal_");
  });

  it("fails closed without returning a roster when ciphertext is corrupt", async () => {
    installCiphertexts({});
    const { prisma } = createPrisma({
      shares: [shareRow({
        ciphertext: "corrupt",
        id: "share_steps_a",
        memberId: "member_a",
        projectionScope: STEPS_SCOPE,
      })],
    });

    await expect(readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [STEPS_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "shared_data_unavailable",
    });
  });

  it("returns unavailable before grants when the runtime is inactive", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);
    const { hostedVaultShareFindMany, prisma } = createPrisma({});

    await expect(readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [STEPS_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "runtime_inactive",
    });
    expect(hostedVaultShareFindMany).not.toHaveBeenCalled();
  });
});
