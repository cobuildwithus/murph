import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_MAILBOX_RETENTION_MS,
  HOSTED_RUN_LOG_RETENTION_MS,
  HOSTED_WEB_SESSION_RETENTION_MS,
  runHostedRetentionCleanup,
} from "@/src/lib/hosted-retention/cleanup";

describe("hosted retention cleanup", () => {
  it("deletes expired mailbox items, runtime logs, and stale web sessions", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const hostedMailboxItemDeleteMany = vi.fn().mockResolvedValue({ count: 7 });
    const hostedRuntimeLogDeleteMany = vi.fn().mockResolvedValue({ count: 8 });
    const hostedWebSessionDeleteMany = vi.fn().mockResolvedValue({ count: 9 });
    const hostedComputerRunFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      hostedComputerRun: {
        findMany: hostedComputerRunFindMany,
      },
      hostedMailboxItem: {
        deleteMany: hostedMailboxItemDeleteMany,
      },
      hostedRuntimeLog: {
        deleteMany: hostedRuntimeLogDeleteMany,
      },
      hostedWebSession: {
        deleteMany: hostedWebSessionDeleteMany,
      },
    };

    await expect(runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
    })).resolves.toEqual({
      expiredComputerRunsCleanedUp: 0,
      expiredMailboxItemsDeleted: 7,
      oldRuntimeLogsDeleted: 8,
      staleWebSessionsDeleted: 9,
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
    expect(hostedWebSessionDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            expiresAt: {
              lt: new Date(now.getTime() - HOSTED_WEB_SESSION_RETENTION_MS),
            },
          },
          {
            revokedAt: {
              lt: new Date(now.getTime() - HOSTED_WEB_SESSION_RETENTION_MS),
            },
          },
        ],
      },
    });
    expect(hostedComputerRunFindMany).toHaveBeenCalledWith({
      orderBy: {
        updatedAt: "asc",
      },
      where: {
        OR: [
          {
            expiresAt: { lte: now },
            status: { in: ["running", "awaiting_user"] },
          },
          {
            expiresAt: { lte: now },
            kernelSessionId: { not: null },
            status: "expired",
          },
        ],
      },
    });
  });
});
