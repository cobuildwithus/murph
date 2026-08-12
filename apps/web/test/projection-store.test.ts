import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedVaultShareProjectionScopeKey,
  hostedVaultShareProjectionKindToScope,
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
        projectionScopeJson: SLEEP_SCOPE,
        projectionScopeKey: SLEEP_SCOPE_KEY,
      },
      {
        destinationMemberId: "member_owner_backed",
        id: "share_invalid",
        projectionKind: "unknown.v0",
        projectionScopeJson: { projectionKind: "unknown.v0" },
        projectionScopeKey: "unknown.v0",
      },
      {
        destinationMemberId: "member_owner_backed",
        id: "share_device",
        projectionKind: deviceScope.projectionKind,
        projectionScopeJson: deviceScope,
        projectionScopeKey: buildHostedVaultShareProjectionScopeKey(deviceScope),
      },
      {
        destinationMemberId: "member_inactive",
        id: "share_inactive",
        projectionKind: SLEEP_SCOPE.projectionKind,
        projectionScopeJson: SLEEP_SCOPE,
        projectionScopeKey: SLEEP_SCOPE_KEY,
      },
      {
        destinationMemberId: "member_owner_backed",
        id: "share_profile",
        projectionKind: profileScope.projectionKind,
        projectionScopeJson: profileScope,
        projectionScopeKey: buildHostedVaultShareProjectionScopeKey(profileScope),
      },
      {
        destinationMemberId: "member_owner_backed",
        id: "share_sleep_1",
        projectionKind: SLEEP_SCOPE.projectionKind,
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
    })).resolves.toEqual([
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
    ]);
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
});
