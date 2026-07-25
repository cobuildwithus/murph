import { Prisma, type PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedVaultShareProjectionScopeKey,
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
import {
  readHostedGroupSharedDataByRuntimeMemberId,
} from "@/src/lib/hosted-groups/group-store";
import {
  serializeHostedVaultShareProjectionSnapshot,
} from "@/src/lib/hosted-vault-share/projection-snapshot";

const RUNTIME_MEMBER_ID = "member_group_runtime";
const PROFILE_SCOPE = hostedVaultShareProjectionKindToScope("profile-name.v0");
const PROTEIN_SCOPE = hostedVaultShareProjectionKindToScope("protein-days.v0");
const STEPS_SCOPE = hostedVaultShareProjectionKindToScope("steps-days.v0");
const DEVICE_SCOPE = hostedVaultShareProjectionKindToScope("device-sync-status.v0");
const PROTEIN_KEY = buildHostedVaultShareProjectionScopeKey(PROTEIN_SCOPE);
const STEPS_KEY = buildHostedVaultShareProjectionScopeKey(STEPS_SCOPE);
const DEVICE_KEY = buildHostedVaultShareProjectionScopeKey(DEVICE_SCOPE);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
});

afterEach(() => {
  setHostedSecureBoxStringTestCodecForTests(null);
});

function shareRow(input: {
  ciphertext?: string | null;
  id: string;
  memberId: string;
  projectionScope:
    | typeof DEVICE_SCOPE
    | typeof PROFILE_SCOPE
    | typeof PROTEIN_SCOPE
    | typeof STEPS_SCOPE;
}) {
  return {
    destinationMemberId: RUNTIME_MEMBER_ID,
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
  projectionScope: typeof PROFILE_SCOPE | typeof PROTEIN_SCOPE | typeof STEPS_SCOPE;
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
  group?: { members: Array<{ id: string; memberId: string }> } | null;
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
  const hostedVaultShareFindMany = vi.fn().mockResolvedValue(input.shares ?? []);
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
    hostedVaultShareFindMany,
    prisma: createPrismaClientTestDouble({ $transaction: transaction }),
    transaction,
  };
}

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
        { dataStatus: "available", grantStatus: "granted" },
        { dataStatus: "available", grantStatus: "granted" },
      ],
    });
    expect(result.members[1]).toMatchObject({
      displayName: "Alex",
      memberId: "member_b",
      participantId: "participant_b",
      projections: [
        { dataStatus: "missing", grantStatus: "granted", records: [] },
        { dataStatus: "missing", grantStatus: "not_granted", records: [] },
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
        { dataStatus: "missing", grantStatus: "not_granted", records: [] },
        {
          dataStatus: "available",
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
      grantStatus: "granted",
      projectionScope: PROTEIN_SCOPE,
      projectionScopeKey: PROTEIN_KEY,
      records: [],
    }]);
    expect(result.members[2]?.projections).toEqual([{
      dataStatus: "missing",
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
        members: [{ id: "participant_protein_zero", memberId: "member_protein_zero" }],
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

  it("filters inactive grantors while retaining every group member as missing", async () => {
    installCiphertexts({});
    const { hostedVaultShareFindMany, prisma } = createPrisma({ shares: [] });

    const result = await readHostedGroupSharedDataByRuntimeMemberId({
      prisma,
      projectionScopes: [STEPS_SCOPE],
      runtimeMemberId: RUNTIME_MEMBER_ID,
    });

    expect(hostedVaultShareFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        grantor: expect.objectContaining({ suspendedAt: null }),
      }),
    }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(result.members).toHaveLength(3);
    expect(result.members.map((member) => member.projections[0])).toEqual([
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
        grantStatus: "not_granted",
        records: [],
      }),
    ]);
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
