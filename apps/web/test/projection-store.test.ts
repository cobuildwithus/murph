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
  requireHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
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
const SOURCE_WORKSPACE_VERSION = "7";
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
  mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createPrisma(events?: string[]) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const queryRaw = vi.fn().mockResolvedValue([{
    version: BigInt(SOURCE_WORKSPACE_VERSION),
  }]);
  const tx = { $queryRaw: queryRaw, hostedVaultShare: { updateMany } };
  const transaction = vi.fn(
    async (callback: (value: typeof tx) => Promise<unknown>) => {
      events?.push("transaction");
      return callback(tx);
    },
  );
  const prisma = createPrismaClientTestDouble({
    $transaction: transaction,
  });
  return { prisma, queryRaw, transaction, updateMany };
}

describe("replaceHostedVaultShareProjectionSnapshot", () => {
  it("persists only ciphertext with destination-root AAD bound to the share generation", async () => {
    const events: string[] = [];
    const codec = createSnapshotTestCodec(events);
    const { prisma, updateMany } = createPrisma(events);

    await expect(replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [RECORD],
      share: SHARE,
      sourceWorkspaceVersion: SOURCE_WORKSPACE_VERSION,
    })).resolves.toBe("replaced");

    expect(events.slice(0, 2)).toEqual(["encrypt", "transaction"]);
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
      sourceWorkspaceVersion: SOURCE_WORKSPACE_VERSION,
    });

    const ciphertext = updateMany.mock.calls[0]?.[0]?.data
      ?.projectionSnapshotCiphertext;
    const [records] = await decryptHostedVaultShareProjectionSnapshots({
      entries: [{ ...SHARE, ciphertext }],
      prisma,
    });
    expect(records).toEqual([]);
  });

  it("bounds replacement transaction admission to the remaining delivery deadline", async () => {
    createSnapshotTestCodec();
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const { prisma, transaction } = createPrisma();

    try {
      await expect(replaceHostedVaultShareProjectionSnapshot({
        deadlineAtEpochMs: 15_000,
        prisma,
        records: [RECORD],
        share: SHARE,
        sourceWorkspaceVersion: SOURCE_WORKSPACE_VERSION,
      })).resolves.toBe("replaced");

      expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 1_000,
        timeout: 4_000,
      });
    } finally {
      now.mockRestore();
    }
  });

  it("starts no replacement transaction after the delivery deadline", async () => {
    createSnapshotTestCodec();
    const { prisma, transaction, updateMany } = createPrisma();

    await expect(replaceHostedVaultShareProjectionSnapshot({
      deadlineAtEpochMs: Date.now() - 1,
      prisma,
      records: [RECORD],
      share: SHARE,
      sourceWorkspaceVersion: SOURCE_WORKSPACE_VERSION,
    })).rejects.toMatchObject({ name: "TimeoutError" });

    expect(transaction).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("uses the exact active row as the stale-writer compare-and-set boundary", async () => {
    createSnapshotTestCodec();
    const { prisma, updateMany } = createPrisma();
    updateMany.mockResolvedValue({ count: 0 });

    await expect(replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [RECORD],
      share: SHARE,
      sourceWorkspaceVersion: SOURCE_WORKSPACE_VERSION,
    })).resolves.toBe("no-active-share");

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "share_generation_1",
        status: "granted",
      }),
    }));
  });

  it("returns no-active-share without persisting when a member is inactive", async () => {
    createSnapshotTestCodec();
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
      sourceWorkspaceVersion: SOURCE_WORKSPACE_VERSION,
    })).resolves.toBe("no-active-share");

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("checks destination access in the same transaction before persistence", async () => {
    createSnapshotTestCodec();
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
      sourceWorkspaceVersion: SOURCE_WORKSPACE_VERSION,
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
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects a delivery captured before the current workspace checkpoint", async () => {
    createSnapshotTestCodec();
    const { prisma, queryRaw, updateMany } = createPrisma();
    queryRaw.mockResolvedValue([{ version: 8n }]);

    await expect(replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [RECORD],
      share: SHARE,
      sourceWorkspaceVersion: SOURCE_WORKSPACE_VERSION,
    })).resolves.toBe("no-active-share");

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("keeps the newer snapshot when an older encrypted delivery finishes last", async () => {
    createSnapshotTestCodec();
    const oldWriterAtFence = createDeferred<void>();
    const releaseOldWriter = createDeferred<void>();
    const newRecord = {
      ...RECORD,
      data: {
        ...RECORD.data,
        sleepEndAt: "2026-07-18T07:00:00.000Z",
        sleepStartAt: "2026-07-17T23:00:00.000Z",
      },
    };
    let storedCiphertext: string | null = null;
    let transactionOrdinal = 0;
    const prisma = createPrismaClientTestDouble({
      $transaction: vi.fn(async (
        callback: (value: {
          $queryRaw: () => Promise<Array<{ version: bigint }>>;
          hostedVaultShare: {
            updateMany: (input: {
              data: { projectionSnapshotCiphertext: string };
            }) => Promise<{ count: number }>;
          };
        }) => Promise<unknown>,
      ) => {
        transactionOrdinal += 1;
        const currentTransaction = transactionOrdinal;
        return await callback({
          async $queryRaw() {
            if (currentTransaction === 1) {
              oldWriterAtFence.resolve();
              await releaseOldWriter.promise;
            }
            return [{ version: 8n }];
          },
          hostedVaultShare: {
            async updateMany(input) {
              storedCiphertext = input.data.projectionSnapshotCiphertext;
              return { count: 1 };
            },
          },
        });
      }),
    });

    const oldDelivery = replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [RECORD],
      share: SHARE,
      sourceWorkspaceVersion: "7",
    });
    await oldWriterAtFence.promise;

    await expect(replaceHostedVaultShareProjectionSnapshot({
      prisma,
      records: [newRecord],
      share: SHARE,
      sourceWorkspaceVersion: "8",
    })).resolves.toBe("replaced");
    releaseOldWriter.resolve();
    await expect(oldDelivery).resolves.toBe("no-active-share");

    assertStoredCiphertext(storedCiphertext);
    const [records] = await decryptHostedVaultShareProjectionSnapshots({
      entries: [{ ...SHARE, ciphertext: storedCiphertext }],
      prisma,
    });
    expect(records).toEqual([newRecord]);
  });
});

function assertStoredCiphertext(value: string | null): asserts value is string {
  if (value === null) {
    throw new Error("Expected the newer vault-share snapshot to be stored.");
  }
}

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
