import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXPIRED_VAULT_SYNC_SESSION_RETENTION_MS,
  HOSTED_MAILBOX_RETENTION_MS,
  HOSTED_RUN_LOG_RETENTION_MS,
  runHostedRetentionCleanup,
} from "@/src/lib/hosted-retention/cleanup";
import {
  HOSTED_VAULT_SYNC_PAYLOAD_TERMINAL_STATUSES,
} from "@/src/lib/vault-sync/shared";

describe("hosted retention cleanup", () => {
  it("deletes expired payloads, mailbox items, runtime logs, and vault-sync rows", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const hostedMailboxItemDeleteMany = vi.fn().mockResolvedValue({ count: 7 });
    const hostedRuntimeLogDeleteMany = vi.fn().mockResolvedValue({ count: 8 });
    const hostedSharePayloadDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const hostedVaultSyncSessionUpdateMany = vi.fn().mockResolvedValue({ count: 3 });
    const hostedVaultSyncPayloadDeleteMany = vi.fn()
      .mockResolvedValueOnce({ count: 4 })
      .mockResolvedValueOnce({ count: 5 });
    const hostedVaultSyncSessionDeleteMany = vi.fn().mockResolvedValue({ count: 6 });
    const prisma = {
      hostedMailboxItem: {
        deleteMany: hostedMailboxItemDeleteMany,
      },
      hostedRuntimeLog: {
        deleteMany: hostedRuntimeLogDeleteMany,
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
      expiredMailboxItemsDeleted: 7,
      expiredSharePayloadsDeleted: 2,
      expiredVaultSyncPayloadsDeleted: 4,
      expiredVaultSyncSessionsDeleted: 6,
      expiredVaultSyncSessionsMarked: 3,
      oldRuntimeLogsDeleted: 8,
    });

    expect(hostedSharePayloadDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { share: { is: { expiresAt: { lte: now } } } },
          { share: { is: { consumedAt: { not: null } } } },
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
        expiresAt: { lte: now },
        status: { in: ["pending", "exchanged", "uploaded"] },
      },
    });
    expect(hostedVaultSyncPayloadDeleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        session: {
          is: {
            expiresAt: { lte: now },
            status: { in: ["pending", "exchanged", "uploaded"] },
          },
        },
      },
    });
    expect(hostedVaultSyncPayloadDeleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        session: {
          is: {
            status: { in: [...HOSTED_VAULT_SYNC_PAYLOAD_TERMINAL_STATUSES] },
          },
        },
      },
    });
    expect(hostedVaultSyncSessionDeleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["expired", "revoked"] },
        updatedAt: {
          lt: new Date(now.getTime() - HOSTED_EXPIRED_VAULT_SYNC_SESSION_RETENTION_MS),
        },
      },
    });
    expect(hostedMailboxItemDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { createdAt: { lt: new Date(now.getTime() - HOSTED_MAILBOX_RETENTION_MS) } },
        ],
      },
    });
    expect(hostedRuntimeLogDeleteMany).toHaveBeenCalledWith({
      where: {
        at: {
          lt: new Date(now.getTime() - HOSTED_RUN_LOG_RETENTION_MS),
        },
      },
    });
  });
});
