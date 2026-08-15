import type { Prisma, PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedVaultShareProjectionScopeKey,
  hostedVaultShareProjectionKindToScope,
} from "@murphai/hosted-execution/vault-share";

import {
  grantHostedVaultShareTx,
  revokeHostedVaultSharesTx,
} from "@/src/lib/hosted-vault-share/share-grant-store";
import { createPrismaClient } from "@/src/lib/prisma";

const SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("sleep-times.v0");
const SLEEP_SCOPE_KEY = buildHostedVaultShareProjectionScopeKey(SLEEP_SCOPE);

function createPrismaStub<T extends Record<string, unknown>>(
  delegates: T,
): PrismaClient & T {
  const prisma = createPrismaClient({
    databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
  });
  for (const [key, value] of Object.entries(delegates)) {
    Object.defineProperty(prisma, key, {
      configurable: true,
      value,
    });
  }
  if (!("$executeRaw" in delegates)) {
    Object.defineProperty(prisma, "$executeRaw", {
      configurable: true,
      value: vi.fn(async () => 1),
    });
  }
  return prisma as PrismaClient & T;
}

function buildTx() {
  return createPrismaStub({
    hostedVaultShare: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  });
}

describe("revokeHostedVaultSharesTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes active grants and clears ciphertext in the same transaction", async () => {
    const tx = buildTx();
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(revokeHostedVaultSharesTx({
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      now,
      projectionScopes: [SLEEP_SCOPE],
      tx,
    })).resolves.toBe(1);

    expect(tx.hostedVaultShare.updateMany).toHaveBeenCalledWith({
      data: {
        projectionSnapshotCiphertext: null,
        revokedAt: now,
        status: "revoked",
        updatedAt: now,
      },
      where: {
        destinationMemberId: "member_referee",
        grantorMemberId: "member_grantor",
        projectionScopeKey: { in: [SLEEP_SCOPE_KEY] },
        status: "granted",
      },
    });
  });

  it("returns zero when a concurrent transaction already revoked the row", async () => {
    const tx = buildTx();
    tx.hostedVaultShare.updateMany.mockResolvedValue({ count: 0 });

    await expect(revokeHostedVaultSharesTx({
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      now: new Date("2026-07-01T00:00:01.000Z"),
      projectionScopes: [SLEEP_SCOPE],
      tx,
    })).resolves.toBe(0);

    expect(tx.hostedVaultShare.updateMany).toHaveBeenCalledTimes(1);
  });

  it("revokes every active grant for the destination when no grantor is specified", async () => {
    const tx = buildTx();
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(revokeHostedVaultSharesTx({
      destinationMemberId: "member_referee",
      now,
      projectionScopes: [SLEEP_SCOPE],
      tx,
    })).resolves.toBe(1);

    expect(tx.hostedVaultShare.updateMany).toHaveBeenCalledWith({
      data: {
        projectionSnapshotCiphertext: null,
        revokedAt: now,
        status: "revoked",
        updatedAt: now,
      },
      where: {
        destinationMemberId: "member_referee",
        projectionScopeKey: { in: [SLEEP_SCOPE_KEY] },
        status: "granted",
      },
    });
  });

  it("does not issue an update for an explicitly empty scope set", async () => {
    const tx = buildTx();

    await expect(revokeHostedVaultSharesTx({
      destinationMemberId: "member_referee",
      now: new Date("2026-07-01T00:00:00.000Z"),
      projectionScopes: [],
      tx,
    })).resolves.toBe(0);

    expect(tx.hostedVaultShare.updateMany).not.toHaveBeenCalled();
  });
});

describe("grantHostedVaultShareTx", () => {
  it("rotates the share id when a revoked tuple is granted again", async () => {
    const tx = createPrismaStub({
      $executeRaw: vi.fn(async () => 1),
      hostedVaultShare: {
        count: vi.fn(async () => 0),
        create: vi.fn(),
        findUnique: vi.fn(async () => ({ id: "share_old", status: "revoked" })),
        update: vi.fn(async () => undefined),
      },
    });
    const now = new Date("2026-07-02T00:00:00.000Z");

    await expect(grantHostedVaultShareTx({
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      now,
      projectionScope: SLEEP_SCOPE,
      tx,
    })).resolves.toEqual({
      id: expect.stringMatching(/^hbvs_/u),
      requiresProjection: true,
    });

    expect(tx.hostedVaultShare.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        grantedAt: now,
        id: expect.stringMatching(/^hbvs_/u),
        projectionSnapshotCiphertext: null,
        revokedAt: null,
        status: "granted",
      }),
      where: {
        grantorMemberId_projectionScopeKey_destinationMemberId: {
          destinationMemberId: "member_referee",
          grantorMemberId: "member_grantor",
          projectionScopeKey: SLEEP_SCOPE_KEY,
        },
      },
    });
  });

  it("keeps an existing active grant idempotent", async () => {
    const tx = createPrismaStub({
      $executeRaw: vi.fn(async () => 1),
      hostedVaultShare: {
        count: vi.fn(),
        create: vi.fn(),
        findUnique: vi.fn(async () => ({
          id: "share_group",
          projectionSnapshotCiphertext: "ciphertext_ready",
          status: "granted",
        })),
        update: vi.fn(async () => undefined),
      },
    });

    await expect(grantHostedVaultShareTx({
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      now: new Date("2026-07-02T00:00:00.000Z"),
      projectionScope: SLEEP_SCOPE,
      tx,
    })).resolves.toEqual({
      id: "share_group",
      requiresProjection: false,
    });

    expect(tx.hostedVaultShare.create).not.toHaveBeenCalled();
    expect(tx.hostedVaultShare.count).not.toHaveBeenCalled();
    expect(tx.hostedVaultShare.update).not.toHaveBeenCalled();
  });

  it("rejects a new grant after atomically observing 25 active grants", async () => {
    const events: string[] = [];
    const tx = createPrismaStub({
      $executeRaw: vi.fn(async () => {
        events.push("lock");
        return 1;
      }),
      hostedVaultShare: {
        count: vi.fn(async () => {
          events.push("count");
          return 25;
        }),
        create: vi.fn(),
        findUnique: vi.fn(async () => null),
        update: vi.fn(),
      },
    });

    await expect(grantHostedVaultShareTx({
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      now: new Date("2026-07-02T00:00:00.000Z"),
      projectionScope: SLEEP_SCOPE,
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_REACHED",
      httpStatus: 409,
    });

    expect(events).toEqual(["lock", "count"]);
    expect(tx.hostedVaultShare.count).toHaveBeenCalledWith({
      where: {
        grantorMemberId: "member_grantor",
        projectionScopeKey: SLEEP_SCOPE_KEY,
        status: "granted",
      },
    });
    expect(tx.hostedVaultShare.create).not.toHaveBeenCalled();
    expect(tx.hostedVaultShare.update).not.toHaveBeenCalled();
  });

  it("starts a fresh pending generation when recent-date consent is reaffirmed", async () => {
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      hostedVaultShare: {
        count: vi.fn(async () => 1),
        create: vi.fn(),
        findUnique: vi.fn(async () => ({
          id: "share_previous_generation",
          projectionSnapshotCiphertext: "ciphertext_from_previous_window",
          status: "granted",
        })),
        update: vi.fn(async () => undefined),
      },
    } as unknown as Prisma.TransactionClient & {
      hostedVaultShare: {
        create: ReturnType<typeof vi.fn>;
        findUnique: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
    };
    const now = new Date("2026-07-02T00:00:00.000Z");

    const result = await grantHostedVaultShareTx({
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      now,
      projectionScope: SLEEP_SCOPE,
      refreshMaterializedProjection: true,
      tx,
    });

    expect(result.id).not.toBe("share_previous_generation");
    expect(result.requiresProjection).toBe(true);
    expect(tx.hostedVaultShare.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        grantedAt: now,
        id: result.id,
        projectionSnapshotCiphertext: null,
        revokedAt: null,
        status: "granted",
      }),
      where: {
        grantorMemberId_projectionScopeKey_destinationMemberId: {
          destinationMemberId: "member_referee",
          grantorMemberId: "member_grantor",
          projectionScopeKey: SLEEP_SCOPE_KEY,
        },
      },
    });
  });

  it("marks an active null snapshot as still requiring projection", async () => {
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      hostedVaultShare: {
        create: vi.fn(),
        findUnique: vi.fn(async () => ({
          id: "share_pending",
          projectionSnapshotCiphertext: null,
          status: "granted",
        })),
        update: vi.fn(),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(grantHostedVaultShareTx({
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      now: new Date("2026-07-02T00:00:00.000Z"),
      projectionScope: SLEEP_SCOPE,
      tx,
    })).resolves.toEqual({
      id: "share_pending",
      requiresProjection: true,
    });
  });
});
