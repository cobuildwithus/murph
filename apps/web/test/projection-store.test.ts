import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
  HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_PAGE_MAX,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  hostedVaultShareProjectionKindToScope,
  isHostedVaultShareRuntimeProjectedKind,
} from "@murphai/hosted-execution/vault-share";

const mocks = vi.hoisted(() => ({
  isHostedRuntimeInactiveAccessError: vi.fn((error: unknown) => {
    void error;
    return false;
  }),
  readActiveHostedMemberAccessIds: vi.fn(),
  requireHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccessIds: mocks.readActiveHostedMemberAccessIds,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  isHostedRuntimeInactiveAccessError: mocks.isHostedRuntimeInactiveAccessError,
  requireHostedRuntimeActiveAccessForUpdateTx:
    mocks.requireHostedRuntimeActiveAccessForUpdateTx,
}));

import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";
import {
  buildHostedVaultShareGenerationToken,
  findActiveHostedVaultShares,
  hasUnmaterializedHostedVaultShareProjectionGeneration,
  readDeliverableHostedVaultShareProjectionScopeGenerations,
  replaceHostedVaultShareProjectionSnapshot,
} from "@/src/lib/hosted-vault-share/projection-store";
import {
  decryptHostedVaultShareProjectionSnapshots,
} from "@/src/lib/hosted-vault-share/projection-snapshot";

const SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("sleep-times.v0");
const SLEEP_SCOPE_KEY = buildHostedVaultShareProjectionScopeKey(SLEEP_SCOPE);
const SHARE = {
  destinationMemberId: "member_destination",
  grantorMemberId: "member_grantor",
  id: "share_generation_1",
  projectionKind: "sleep-times.v0" as const,
  projectionScope: SLEEP_SCOPE,
  projectionScopeKey: SLEEP_SCOPE_KEY,
};
const RECORD = {
  data: {
    date: "2026-07-17",
    sleepEndAt: "2026-07-18T06:30:00.000Z",
    sleepStartAt: "2026-07-17T22:15:00.000Z",
  },
  occurredAt: "2026-07-17T00:00:00.000Z",
  recordKey: "2026-07-17",
};

afterEach(() => {
  setHostedSecureBoxStringTestCodecForTests(null);
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isHostedRuntimeInactiveAccessError.mockImplementation(() => false);
  mocks.readActiveHostedMemberAccessIds.mockImplementation(
    async ({ memberIds }: { memberIds: readonly string[] }) => new Set(memberIds),
  );
  mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
});

function createSnapshotTestCodec() {
  const encryptedValues = new Map<string, string>();
  const encryptInputs: Array<{
    aad: Record<string, unknown>;
    lane: string;
    scope: string;
    userId: string;
    value: string;
  }> = [];
  let sequence = 0;
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const plaintext = encryptedValues.get(input.value);
      if (plaintext === undefined) throw new Error("ciphertext unavailable");
      return plaintext;
    },
    encrypt(input) {
      encryptInputs.push(input);
      const ciphertext = `sealed:${++sequence}`;
      encryptedValues.set(ciphertext, input.value);
      return ciphertext;
    },
  });
  return { encryptInputs, encryptedValues };
}

function createPrismaClientTestDouble(value: object): PrismaClient {
  // The generated client is wider than this unit's store seam. Each test
  // supplies every Prisma method the operation can exercise.
  return value as PrismaClient;
}

function createPrisma() {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = { hostedVaultShare: { updateMany } };
  const prisma = createPrismaClientTestDouble({
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx)
    ),
  });
  return { prisma, updateMany };
}

describe("replaceHostedVaultShareProjectionSnapshot", () => {
  it("persists only ciphertext with destination-root AAD bound to the share generation", async () => {
    const codec = createSnapshotTestCodec();
    const { prisma, updateMany } = createPrisma();

    await expect(replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [RECORD],
      share: SHARE,
    })).resolves.toBe("replaced");

    expect(codec.encryptInputs).toEqual([expect.objectContaining({
      aad: {
        field: "projection_snapshot_ciphertext",
        objectKey: JSON.stringify([
          SHARE.destinationMemberId,
          SHARE.projectionScopeKey,
          SHARE.grantorMemberId,
        ]),
        purpose: "hosted-vault-share-projection-snapshot",
        rowId: SHARE.id,
        table: "hosted_vault_share",
      },
      lane: "mailbox-payload",
      scope: "hosted-vault-share-projection-snapshot:v1",
      userId: SHARE.destinationMemberId,
    })]);
    expect(updateMany).toHaveBeenCalledWith({
      data: { projectionSnapshotCiphertext: "sealed:1" },
      where: {
        destinationMemberId: SHARE.destinationMemberId,
        grantorMemberId: SHARE.grantorMemberId,
        id: SHARE.id,
        projectionKind: SHARE.projectionKind,
        projectionScopeKey: SHARE.projectionScopeKey,
        status: "granted",
      },
    });
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain("sleepStartAt");
  });

  it("persists a valid encrypted empty snapshot instead of treating empty as absent", async () => {
    createSnapshotTestCodec();
    const { prisma, updateMany } = createPrisma();

    await replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [],
      share: SHARE,
    });

    const ciphertext = updateMany.mock.calls[0]?.[0]?.data
      ?.projectionSnapshotCiphertext;
    const [records] = await decryptHostedVaultShareProjectionSnapshots({
      entries: [{ ...SHARE, ciphertext }],
      prisma,
    });
    expect(records).toEqual([]);
  });

  it("replaces only an exact null snapshot during first materialization", async () => {
    createSnapshotTestCodec();
    const { prisma, updateMany } = createPrisma();

    await replaceHostedVaultShareProjectionSnapshot({
      prisma,
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
      records: [RECORD],
      share: SHARE,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: SHARE.id,
        projectionSnapshotCiphertext: null,
        status: "granted",
      }),
    }));
  });

  it("uses the exact active row as the stale-writer compare-and-set boundary", async () => {
    createSnapshotTestCodec();
    const { prisma, updateMany } = createPrisma();
    updateMany.mockResolvedValue({ count: 0 });

    await expect(replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [RECORD],
      share: SHARE,
    })).resolves.toBe("no-active-share");

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "share_generation_1",
        status: "granted",
      }),
    }));
  });

  it("returns no-active-share without encrypting when a member is inactive", async () => {
    const codec = createSnapshotTestCodec();
    const { prisma, updateMany } = createPrisma();
    const inactiveError = new Error("inactive");
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockRejectedValueOnce(inactiveError);
    mocks.isHostedRuntimeInactiveAccessError.mockImplementation(
      (error: unknown) => error === inactiveError,
    );

    await expect(replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [RECORD],
      share: SHARE,
    })).resolves.toBe("no-active-share");

    expect(codec.encryptInputs).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("checks destination access in the same transaction before encrypting", async () => {
    const codec = createSnapshotTestCodec();
    const { prisma, updateMany } = createPrisma();
    const inactiveError = new Error("inactive");
    mocks.requireHostedRuntimeActiveAccessForUpdateTx
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(inactiveError);
    mocks.isHostedRuntimeInactiveAccessError.mockImplementation(
      (error: unknown) => error === inactiveError,
    );

    await expect(replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [RECORD],
      share: SHARE,
    })).resolves.toBe("no-active-share");

    expect(mocks.requireHostedRuntimeActiveAccessForUpdateTx).toHaveBeenNthCalledWith(
      1,
      SHARE.grantorMemberId,
      { prisma: expect.any(Object) },
    );
    expect(mocks.requireHostedRuntimeActiveAccessForUpdateTx).toHaveBeenNthCalledWith(
      2,
      SHARE.destinationMemberId,
      { prisma: expect.any(Object) },
    );
    expect(codec.encryptInputs).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("readDeliverableHostedVaultShareProjectionScopeGenerations", () => {
  it("hashes owner- and participant-backed destinations together while excluding inactive rows", async () => {
    const profileScope = hostedVaultShareProjectionKindToScope("profile-name.v0");
    const deviceScope = hostedVaultShareProjectionKindToScope("device-sync-status.v0");
    const findMany = vi.fn().mockResolvedValue([
      {
        destinationMemberId: "member_participant_backed",
        id: "share_sleep_2",
        projectionKind: SLEEP_SCOPE.projectionKind,
        projectionSnapshotCiphertext: null,
        projectionScopeJson: SLEEP_SCOPE,
        projectionScopeKey: SLEEP_SCOPE_KEY,
      },
      {
        destinationMemberId: "member_owner_backed",
        id: "share_invalid",
        projectionKind: "unknown.v0",
        projectionSnapshotCiphertext: null,
        projectionScopeJson: { projectionKind: "unknown.v0" },
        projectionScopeKey: "unknown.v0",
      },
      {
        destinationMemberId: "member_owner_backed",
        id: "share_device",
        projectionKind: deviceScope.projectionKind,
        projectionSnapshotCiphertext: null,
        projectionScopeJson: deviceScope,
        projectionScopeKey: buildHostedVaultShareProjectionScopeKey(deviceScope),
      },
      {
        destinationMemberId: "member_inactive",
        id: "share_inactive",
        projectionKind: SLEEP_SCOPE.projectionKind,
        projectionSnapshotCiphertext: null,
        projectionScopeJson: SLEEP_SCOPE,
        projectionScopeKey: SLEEP_SCOPE_KEY,
      },
      {
        destinationMemberId: "member_owner_backed",
        id: "share_profile",
        projectionKind: profileScope.projectionKind,
        projectionSnapshotCiphertext: "sealed:profile",
        projectionScopeJson: profileScope,
        projectionScopeKey: buildHostedVaultShareProjectionScopeKey(profileScope),
      },
      {
        destinationMemberId: "member_owner_backed",
        id: "share_sleep_1",
        projectionKind: SLEEP_SCOPE.projectionKind,
        projectionSnapshotCiphertext: "sealed:sleep",
        projectionScopeJson: SLEEP_SCOPE,
        projectionScopeKey: SLEEP_SCOPE_KEY,
      },
    ]);
    mocks.readActiveHostedMemberAccessIds.mockResolvedValue(new Set([
      "member_owner_backed",
      "member_participant_backed",
    ]));
    const prisma = createPrismaClientTestDouble({ hostedVaultShare: { findMany } });

    await expect(readDeliverableHostedVaultShareProjectionScopeGenerations({
      grantorMemberId: SHARE.grantorMemberId,
      prisma,
    })).resolves.toEqual({
      generations: [
        {
          generationToken: buildHostedVaultShareGenerationToken([
            "share_sleep_2",
            "share_sleep_1",
          ]),
          projectionScope: SLEEP_SCOPE,
        },
        {
          generationToken: buildHostedVaultShareGenerationToken(["share_profile"]),
          projectionScope: profileScope,
        },
      ],
      hasDeferredProjectionWork: true,
    });
    expect(buildHostedVaultShareGenerationToken(["share_b", "share_a"]))
      .toBe(buildHostedVaultShareGenerationToken(["share_a", "share_b"]));
    expect(mocks.readActiveHostedMemberAccessIds).toHaveBeenCalledWith({
      memberIds: [
        "member_participant_backed",
        "member_owner_backed",
        "member_owner_backed",
        "member_inactive",
        "member_owner_backed",
        "member_owner_backed",
      ],
      prisma,
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: expect.any(Number),
      where: {
        grantorMemberId: SHARE.grantorMemberId,
        status: "granted",
      },
    }));
  });

  it("ignores the maximum materialized fanout and selects only a reactivated null row", async () => {
    const runtimeScopes = HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES.filter((scope) =>
      isHostedVaultShareRuntimeProjectedKind(scope.projectionKind)
    );
    const firstRuntimeScope = runtimeScopes[0];
    if (!firstRuntimeScope) {
      throw new Error("Expected at least one runtime-projected share scope.");
    }
    const inactiveId = "member_destination_0_0";
    const rows = runtimeScopes.flatMap((projectionScope, scopeIndex) =>
      Array.from(
        { length: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_PAGE_MAX },
        (_, destinationIndex) => ({
          destinationMemberId: `member_destination_${scopeIndex}_${destinationIndex}`,
          id: `share_${scopeIndex}_${destinationIndex}`,
          projectionKind: projectionScope.projectionKind,
          projectionSnapshotCiphertext:
            scopeIndex === 0 && destinationIndex === 0 ? null : "sealed:materialized",
          projectionScopeJson: projectionScope,
          projectionScopeKey: buildHostedVaultShareProjectionScopeKey(projectionScope),
        }),
      )
    );
    expect(rows).toHaveLength(2_450);
    expect(rows.filter((row) => row.projectionSnapshotCiphertext !== null))
      .toHaveLength(2_449);
    const pendingRows = rows.filter((row) => row.projectionSnapshotCiphertext === null);
    const findMany = vi.fn().mockResolvedValue(pendingRows);
    const prisma = createPrismaClientTestDouble({ hostedVaultShare: { findMany } });
    const supportedProjectionScopeKeys = new Set(
      runtimeScopes.map(buildHostedVaultShareProjectionScopeKey),
    );
    mocks.readActiveHostedMemberAccessIds.mockResolvedValueOnce(new Set(
      rows.map((row) => row.destinationMemberId).filter((id) => id !== inactiveId),
    ));

    await expect(readDeliverableHostedVaultShareProjectionScopeGenerations({
      grantorMemberId: SHARE.grantorMemberId,
      prisma,
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
      supportedProjectionScopeKeys,
    })).resolves.toEqual({
      generations: [],
      hasDeferredProjectionWork: true,
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        grantorMemberId: SHARE.grantorMemberId,
        projectionSnapshotCiphertext: null,
        status: "granted",
      }),
    }));
    expect(mocks.readActiveHostedMemberAccessIds).toHaveBeenNthCalledWith(1, {
      memberIds: [inactiveId],
      prisma,
    });

    mocks.readActiveHostedMemberAccessIds.mockResolvedValueOnce(new Set(
      rows.map((row) => row.destinationMemberId),
    ));
    await expect(readDeliverableHostedVaultShareProjectionScopeGenerations({
      grantorMemberId: SHARE.grantorMemberId,
      prisma,
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
      supportedProjectionScopeKeys,
    })).resolves.toEqual({
      generations: [{
        generationToken: buildHostedVaultShareGenerationToken(["share_0_0"]),
        projectionScope: firstRuntimeScope,
      }],
      hasDeferredProjectionWork: false,
    });
    expect(mocks.readActiveHostedMemberAccessIds).toHaveBeenNthCalledWith(2, {
      memberIds: [inactiveId],
      prisma,
    });
  });

  it("selects complete exact-scope generations within one 25-row page", async () => {
    const trailingScope = hostedVaultShareProjectionKindToScope("time-zone.v0");
    const rows = [
      ...Array.from(
        { length: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_PAGE_MAX },
        (_, index) => ({
          destinationMemberId: `member_sleep_${index}`,
          id: `share_sleep_${index}`,
          projectionKind: SLEEP_SCOPE.projectionKind,
          projectionSnapshotCiphertext: null,
          projectionScopeJson: SLEEP_SCOPE,
          projectionScopeKey: SLEEP_SCOPE_KEY,
        }),
      ),
      {
        destinationMemberId: "member_trailing",
        id: "share_trailing_pending",
        projectionKind: trailingScope.projectionKind,
        projectionSnapshotCiphertext: null,
        projectionScopeJson: trailingScope,
        projectionScopeKey: buildHostedVaultShareProjectionScopeKey(trailingScope),
      },
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = createPrismaClientTestDouble({ hostedVaultShare: { findMany } });

    const result = await readDeliverableHostedVaultShareProjectionScopeGenerations({
      grantorMemberId: SHARE.grantorMemberId,
      prisma,
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
    });

    expect(result.generations).toHaveLength(1);
    expect(result.generations[0]).toEqual({
      generationToken: buildHostedVaultShareGenerationToken(
        Array.from(
          { length: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_PAGE_MAX },
          (_, index) => `share_sleep_${index}`,
        ),
      ),
      projectionScope: SLEEP_SCOPE,
    });
    expect(result.hasDeferredProjectionWork).toBe(true);
  });
});

describe("hasUnmaterializedHostedVaultShareProjectionGeneration", () => {
  it("checks only the exact granted null-snapshot generation", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "share_pending" });
    const prisma = createPrismaClientTestDouble({
      hostedVaultShare: { findFirst },
    });

    await expect(hasUnmaterializedHostedVaultShareProjectionGeneration({
      grantorMemberId: SHARE.grantorMemberId,
      prisma,
      projectionScope: SLEEP_SCOPE,
    })).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        grantorMemberId: SHARE.grantorMemberId,
        projectionScopeKey: SLEEP_SCOPE_KEY,
        projectionSnapshotCiphertext: null,
        status: "granted",
      },
    });
  });
});

describe("findActiveHostedVaultShares", () => {
  it("discovers a participant-backed destination and excludes an inactive one", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        destinationMemberId: "member_participant_backed",
        grantorMemberId: SHARE.grantorMemberId,
        id: "share_participant",
        projectionKind: SLEEP_SCOPE.projectionKind,
        projectionScopeJson: SLEEP_SCOPE,
        projectionScopeKey: SLEEP_SCOPE_KEY,
      },
      {
        destinationMemberId: "member_inactive",
        grantorMemberId: SHARE.grantorMemberId,
        id: "share_inactive",
        projectionKind: SLEEP_SCOPE.projectionKind,
        projectionScopeJson: SLEEP_SCOPE,
        projectionScopeKey: SLEEP_SCOPE_KEY,
      },
    ]);
    mocks.readActiveHostedMemberAccessIds.mockResolvedValue(
      new Set(["member_participant_backed"]),
    );
    const prisma = createPrismaClientTestDouble({ hostedVaultShare: { findMany } });

    await expect(findActiveHostedVaultShares({
      grantorMemberId: SHARE.grantorMemberId,
      prisma,
      projectionScope: SLEEP_SCOPE,
    })).resolves.toEqual([{
      destinationMemberId: "member_participant_backed",
      grantorMemberId: SHARE.grantorMemberId,
      id: "share_participant",
      projectionKind: SLEEP_SCOPE.projectionKind,
      projectionScope: SLEEP_SCOPE,
      projectionScopeKey: SLEEP_SCOPE_KEY,
    }]);
    expect(mocks.readActiveHostedMemberAccessIds).toHaveBeenCalledWith({
      memberIds: ["member_participant_backed", "member_inactive"],
      prisma,
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 26,
    }));
  });

  it("discovers only null snapshots during first-materialization delivery", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = createPrismaClientTestDouble({ hostedVaultShare: { findMany } });

    await findActiveHostedVaultShares({
      grantorMemberId: SHARE.grantorMemberId,
      prisma,
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
      projectionScope: SLEEP_SCOPE,
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        grantorMemberId: SHARE.grantorMemberId,
        projectionScopeKey: SLEEP_SCOPE_KEY,
        projectionSnapshotCiphertext: null,
        status: "granted",
      }),
    }));
  });
});
