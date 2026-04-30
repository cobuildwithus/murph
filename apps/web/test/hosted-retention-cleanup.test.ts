import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_MAILBOX_RETENTION_MS,
  HOSTED_RUN_LOG_RETENTION_MS,
  runHostedRetentionCleanup,
} from "@/src/lib/hosted-retention/cleanup";

describe("hosted retention cleanup", () => {
  it("deletes expired mailbox items and runtime logs", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const hostedMailboxItemDeleteMany = vi.fn().mockResolvedValue({ count: 7 });
    const hostedRuntimeLogDeleteMany = vi.fn().mockResolvedValue({ count: 8 });
    const prisma = {
      hostedMailboxItem: {
        deleteMany: hostedMailboxItemDeleteMany,
      },
      hostedRuntimeLog: {
        deleteMany: hostedRuntimeLogDeleteMany,
      },
    };

    await expect(runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
    })).resolves.toEqual({
      expiredMailboxItemsDeleted: 7,
      oldRuntimeLogsDeleted: 8,
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
