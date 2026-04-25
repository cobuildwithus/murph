import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXPIRED_VAULT_SYNC_SESSION_RETENTION_MS,
  HOSTED_RUN_LOG_RETENTION_MS,
  HOSTED_TERMINAL_INGRESS_RETENTION_MS,
  runHostedRetentionCleanup,
} from "@/src/lib/hosted-retention/cleanup";
import {
  HOSTED_VAULT_SYNC_PAYLOAD_TERMINAL_STATUSES,
} from "@/src/lib/vault-sync/shared";

describe("hosted retention cleanup", () => {
  it("deletes expired payloads and stale operational rows with conservative cutoffs", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const hostedSharePayloadDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const hostedVaultSyncSessionUpdateMany = vi.fn().mockResolvedValue({ count: 3 });
    const hostedVaultSyncPayloadDeleteMany = vi.fn()
      .mockResolvedValueOnce({ count: 4 })
      .mockResolvedValueOnce({ count: 5 });
    const hostedVaultSyncSessionDeleteMany = vi.fn().mockResolvedValue({ count: 6 });
    const hostedIngressEventGroupBy = vi.fn().mockResolvedValue([]);
    const hostedIngressEventDeleteMany = vi.fn().mockResolvedValue({ count: 7 });
    const hostedRunLogDeleteMany = vi.fn().mockResolvedValue({ count: 8 });
    const prisma = {
      hostedIngressEvent: {
        deleteMany: hostedIngressEventDeleteMany,
        groupBy: hostedIngressEventGroupBy,
      },
      hostedRunLog: {
        deleteMany: hostedRunLogDeleteMany,
      },
      hostedSharePayload: {
        deleteMany: hostedSharePayloadDeleteMany,
      },
      hostedVaultSyncPayload: {
        deleteMany: hostedVaultSyncPayloadDeleteMany,
      },
      hostedVaultSyncSession: {
        deleteMany: hostedVaultSyncSessionDeleteMany,
        updateMany: hostedVaultSyncSessionUpdateMany,
      },
    };

    await expect(runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
    })).resolves.toEqual({
      completedVaultSyncPayloadsDeleted: 5,
      expiredSharePayloadsDeleted: 2,
      expiredVaultSyncPayloadsDeleted: 4,
      expiredVaultSyncSessionsDeleted: 6,
      expiredVaultSyncSessionsMarked: 3,
      oldRunLogsDeleted: 8,
      staleIngressEventsDeleted: 7,
      staleIngressEventsQuarantined: 0,
    });

    expect(hostedSharePayloadDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            share: {
              is: {
                expiresAt: {
                  lte: now,
                },
              },
            },
          },
          {
            share: {
              is: {
                consumedAt: {
                  not: null,
                },
              },
            },
          },
        ],
      },
    });
    expect(hostedVaultSyncSessionUpdateMany).toHaveBeenCalledWith({
      data: {
        agentTokenHash: null,
        pairingCodeHash: null,
        status: "expired",
      },
      where: {
        expiresAt: {
          lte: now,
        },
        status: {
          in: ["pending", "exchanged", "uploaded", "queued"],
        },
      },
    });
    expect(hostedVaultSyncPayloadDeleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        session: {
          is: {
            expiresAt: {
              lte: now,
            },
          },
        },
      },
    });
    expect(hostedVaultSyncPayloadDeleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        session: {
          is: {
            status: {
              in: [...HOSTED_VAULT_SYNC_PAYLOAD_TERMINAL_STATUSES],
            },
          },
        },
      },
    });
    expect(hostedVaultSyncSessionDeleteMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: ["expired", "revoked"],
        },
        updatedAt: {
          lt: new Date(now.getTime() - HOSTED_EXPIRED_VAULT_SYNC_SESSION_RETENTION_MS),
        },
      },
    });
    expect(hostedIngressEventGroupBy).toHaveBeenCalledWith({
      by: ["userId"],
      where: {
        completedAt: null,
        createdAt: {
          lt: new Date(now.getTime() - HOSTED_TERMINAL_INGRESS_RETENTION_MS),
        },
        quarantinedAt: null,
        runId: null,
        state: "pending",
        OR: [
          {
            payloadBytes: {
              not: null,
            },
          },
          {
            payloadInlineCiphertext: {
              not: null,
            },
          },
          {
            payloadRef: {
              not: null,
            },
          },
        ],
      },
    });
    expect(hostedIngressEventDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            completedAt: {
              lt: new Date(now.getTime() - HOSTED_TERMINAL_INGRESS_RETENTION_MS),
            },
          },
          {
            quarantinedAt: {
              lt: new Date(now.getTime() - HOSTED_TERMINAL_INGRESS_RETENTION_MS),
            },
          },
        ],
      },
    });
    expect(hostedRunLogDeleteMany).toHaveBeenCalledWith({
      where: {
        at: {
          lt: new Date(now.getTime() - HOSTED_RUN_LOG_RETENTION_MS),
        },
      },
    });
  });

  it("quarantines only the oldest contiguous stale pending ingress prefix", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const cutoff = new Date(now.getTime() - HOSTED_TERMINAL_INGRESS_RETENTION_MS);
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ user_id: "member_123" }]),
      hostedExecutionCursor: {
        findUnique: vi.fn().mockResolvedValue({
          committedSeq: 10n,
          version: 4n,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedIngressEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            createdAt: new Date("2026-03-01T00:00:00.000Z"),
            id: "ing_11",
            payloadRef: "ing_11",
            seq: 11n,
          },
          {
            createdAt: new Date("2026-03-02T00:00:00.000Z"),
            id: "ing_12",
            payloadRef: null,
            seq: 12n,
          },
          {
            createdAt: new Date("2026-04-24T00:00:00.000Z"),
            id: "ing_13",
            payloadRef: "ing_13",
            seq: 13n,
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      hostedIngressPayload: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      hostedIngressEvent: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        groupBy: vi.fn().mockResolvedValue([{ userId: "member_123" }]),
      },
      hostedRunLog: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedSharePayload: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedVaultSyncPayload: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedVaultSyncSession: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    await expect(runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      staleIngressEventsDeleted: 0,
      staleIngressEventsQuarantined: 2,
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.hostedIngressEvent.findMany).toHaveBeenCalledWith({
      orderBy: {
        seq: "asc",
      },
      select: {
        createdAt: true,
        id: true,
        payloadRef: true,
        seq: true,
      },
      take: 500,
      where: {
        completedAt: null,
        quarantinedAt: null,
        runId: null,
        seq: {
          gt: 10n,
        },
        state: "pending",
        userId: "member_123",
      },
    });
    expect(tx.hostedIngressPayload.deleteMany).toHaveBeenCalledWith({
      where: {
        ingressEventId: {
          in: ["ing_11"],
        },
        userId: "member_123",
      },
    });
    expect(tx.hostedIngressEvent.updateMany).toHaveBeenCalledWith({
      data: {
        completedAt: now,
        payloadBytes: null,
        payloadInlineCiphertext: null,
        payloadRef: null,
        quarantineCode: "retention_expired",
        quarantinedAt: now,
        state: "quarantined",
      },
      where: {
        completedAt: null,
        createdAt: {
          lt: cutoff,
        },
        id: {
          in: ["ing_11", "ing_12"],
        },
        quarantinedAt: null,
        runId: null,
        state: "pending",
        userId: "member_123",
      },
    });
    expect(tx.hostedExecutionCursor.updateMany).toHaveBeenCalledWith({
      data: {
        committedSeq: 12n,
        version: {
          increment: 1,
        },
      },
      where: {
        committedSeq: 10n,
        userId: "member_123",
        version: 4n,
      },
    });
  });
});
