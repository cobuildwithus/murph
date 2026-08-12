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
  requireHostedRuntimeActiveAccess: vi.fn(),
  requireHostedRuntimeMembersActiveAccessForUpdateTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  isHostedRuntimeInactiveAccessError: mocks.isHostedRuntimeInactiveAccessError,
  requireHostedRuntimeActiveAccess: mocks.requireHostedRuntimeActiveAccess,
  requireHostedRuntimeMembersActiveAccessForUpdateTx:
    mocks.requireHostedRuntimeMembersActiveAccessForUpdateTx,
}));

import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";
import {
  HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE,
} from "@/src/lib/hosted-vault-share/delivery-limits";
import {
  findActiveHostedVaultSharePage,
  readDeliverableHostedVaultShareProjectionScopes,
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
  mocks.requireHostedRuntimeActiveAccess.mockResolvedValue(undefined);
  mocks.requireHostedRuntimeMembersActiveAccessForUpdateTx.mockResolvedValue(undefined);
});

function createSnapshotTestCodec(events?: string[]) {
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
      events?.push("encrypt");
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

function createPrisma(events?: string[]) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = { hostedVaultShare: { updateMany } };
  const prisma = createPrismaClientTestDouble({
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => {
      events?.push("transaction");
      return callback(tx);
    }),
  });
  return { prisma, updateMany };
}

function buildShareRow(index: number) {
  const suffix = String(index).padStart(3, "0");
  return {
    destinationMemberId: `member_destination_${suffix}`,
    grantorMemberId: SHARE.grantorMemberId,
    id: `share_${suffix}`,
    projectionKind: SLEEP_SCOPE.projectionKind,
    projectionScopeJson: SLEEP_SCOPE,
    projectionScopeKey: SLEEP_SCOPE_KEY,
  };
}

describe("findActiveHostedVaultSharePage", () => {
  it("returns no continuation at the exact page boundary", async () => {
    const rows = Array.from(
      { length: HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE },
      (_, index) => buildShareRow(index + 1),
    );
    const findMany = vi.fn().mockResolvedValue(rows);

    await expect(findActiveHostedVaultSharePage({
      grantorMemberId: SHARE.grantorMemberId,
      prisma: createPrismaClientTestDouble({ hostedVaultShare: { findMany } }),
      projectionScope: SLEEP_SCOPE,
    })).resolves.toMatchObject({
      continuation: null,
      shares: rows.map((row) => expect.objectContaining({ id: row.id })),
    });
    expect(findMany).toHaveBeenCalledWith({
      orderBy: { id: "asc" },
      select: {
        destinationMemberId: true,
        grantorMemberId: true,
        id: true,
        projectionKind: true,
        projectionScopeJson: true,
        projectionScopeKey: true,
      },
      take: HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE + 1,
      where: {
        grantorMemberId: SHARE.grantorMemberId,
        projectionScopeKey: SLEEP_SCOPE_KEY,
        status: "granted",
      },
    });
  });

  it("rejects a malformed continuation before querying shares", async () => {
    const findMany = vi.fn();

    await expect(findActiveHostedVaultSharePage({
      continuation: "share/032",
      grantorMemberId: SHARE.grantorMemberId,
      prisma: createPrismaClientTestDouble({ hostedVaultShare: { findMany } }),
      projectionScope: SLEEP_SCOPE,
    })).rejects.toThrow("Hosted vault-share delivery continuation is invalid.");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns one-over continuation and resumes strictly after completed work", async () => {
    const rows = Array.from(
      { length: HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE + 1 },
      (_, index) => buildShareRow(index + 1),
    );
    const firstPageRows = rows.slice(
      0,
      HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE,
    );
    const lastRow = rows[rows.length - 1];
    const continuation = firstPageRows[firstPageRows.length - 1]?.id;
    if (!lastRow || !continuation) {
      throw new Error("Pagination test fixture did not reach the one-over boundary.");
    }
    const findMany = vi.fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([lastRow]);
    const prisma = createPrismaClientTestDouble({ hostedVaultShare: { findMany } });

    const firstPage = await findActiveHostedVaultSharePage({
      grantorMemberId: SHARE.grantorMemberId,
      prisma,
      projectionScope: SLEEP_SCOPE,
    });
    expect(firstPage).toMatchObject({
      continuation,
      shares: firstPageRows.map((row) => expect.objectContaining({ id: row.id })),
    });

    await expect(findActiveHostedVaultSharePage({
      continuation: firstPage.continuation,
      grantorMemberId: SHARE.grantorMemberId,
      prisma,
      projectionScope: SLEEP_SCOPE,
    })).resolves.toMatchObject({
      continuation: null,
      shares: [expect.objectContaining({ id: lastRow.id })],
    });
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          grantorMemberId: SHARE.grantorMemberId,
          id: { gt: continuation },
          projectionScopeKey: SLEEP_SCOPE_KEY,
          status: "granted",
        },
      }),
    );
  });
});

describe("replaceHostedVaultShareProjectionSnapshot", () => {
  it("does not prepare ciphertext when the unlocked active-access preflight is inactive", async () => {
    const codec = createSnapshotTestCodec();
    const { prisma, updateMany } = createPrisma();
    const inactiveError = new Error("inactive");
    mocks.requireHostedRuntimeActiveAccess.mockRejectedValueOnce(inactiveError);
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
    expect(mocks.requireHostedRuntimeMembersActiveAccessForUpdateTx)
      .not.toHaveBeenCalled();
  });

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

  it("finishes snapshot encryption before opening the compare-and-set transaction", async () => {
    const events: string[] = [];
    createSnapshotTestCodec(events);
    const { prisma } = createPrisma(events);

    await replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [RECORD],
      share: SHARE,
    });

    expect(events).toEqual(["encrypt", "transaction"]);
  });

  it("returns no-active-share when the sorted member revalidation is inactive", async () => {
    const codec = createSnapshotTestCodec();
    const { prisma, updateMany } = createPrisma();
    const inactiveError = new Error("inactive");
    mocks.requireHostedRuntimeMembersActiveAccessForUpdateTx
      .mockRejectedValueOnce(inactiveError);
    mocks.isHostedRuntimeInactiveAccessError.mockImplementation(
      (error: unknown) => error === inactiveError,
    );

    await expect(replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [RECORD],
      share: SHARE,
    })).resolves.toBe("no-active-share");

    expect(codec.encryptInputs).toHaveLength(1);
    expect(mocks.requireHostedRuntimeMembersActiveAccessForUpdateTx)
      .toHaveBeenCalledWith(
        [SHARE.grantorMemberId, SHARE.destinationMemberId],
        { prisma: expect.any(Object) },
      );
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("readDeliverableHostedVaultShareProjectionScopes", () => {
  it("returns only strictly valid active projection rows", async () => {
    const profileScope = hostedVaultShareProjectionKindToScope("profile-name.v0");
    const deviceScope = hostedVaultShareProjectionKindToScope("device-sync-status.v0");
    const findMany = vi.fn().mockResolvedValue([
      {
        projectionKind: SLEEP_SCOPE.projectionKind,
        projectionScopeJson: SLEEP_SCOPE,
        projectionScopeKey: SLEEP_SCOPE_KEY,
      },
      {
        projectionKind: "unknown.v0",
        projectionScopeJson: { projectionKind: "unknown.v0" },
        projectionScopeKey: "unknown.v0",
      },
      {
        projectionKind: deviceScope.projectionKind,
        projectionScopeJson: deviceScope,
        projectionScopeKey: buildHostedVaultShareProjectionScopeKey(deviceScope),
      },
      {
        projectionKind: profileScope.projectionKind,
        projectionScopeJson: profileScope,
        projectionScopeKey: buildHostedVaultShareProjectionScopeKey(profileScope),
      },
    ]);

    await expect(readDeliverableHostedVaultShareProjectionScopes({
      grantorMemberId: SHARE.grantorMemberId,
      prisma: createPrismaClientTestDouble({ hostedVaultShare: { findMany } }),
    })).resolves.toEqual([SLEEP_SCOPE, profileScope]);
  });
});
