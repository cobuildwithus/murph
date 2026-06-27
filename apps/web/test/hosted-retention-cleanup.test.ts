import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE,
  HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS,
  HOSTED_MAILBOX_RETENTION_MS,
  HOSTED_RUN_LOG_AUTOMATION_DETAIL_RETENTION_MS,
  HOSTED_RUN_LOG_RETENTION_MS,
  HOSTED_WEB_SESSION_RETENTION_MS,
  runHostedRetentionCleanup,
} from "@/src/lib/hosted-retention/cleanup";

describe("hosted retention cleanup", () => {
  it("deletes expired mailbox items, runtime logs, and stale web sessions", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const executeRaw = vi.fn().mockResolvedValue(7);
    const hostedRuntimeLogDeleteMany = vi.fn().mockResolvedValue({ count: 8 });
    const hostedWebSessionDeleteMany = vi.fn().mockResolvedValue({ count: 9 });
    const hostedComputerRunFindMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValue([
      { userId: "member_due_1" },
      { userId: "member_due_2" },
    ]);
    const signalRuntimeRecheck = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Temporal unavailable"));
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedComputerRun: {
        findMany: hostedComputerRunFindMany,
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
      signalRuntimeRecheck,
    })).resolves.toEqual({
      expiredComputerRunsCleanedUp: 0,
      expiredMailboxItemsDeleted: 7,
      inboxMediaRetentionRuntimeSignalFailures: 1,
      inboxMediaRetentionRuntimeSignalsSent: 1,
      oldRuntimeLogsDeleted: 8,
      staleWebSessionsDeleted: 9,
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const mailboxDeleteSql = String(executeRaw.mock.calls[0]?.[0].join("?"));
    expect(mailboxDeleteSql).toContain('DELETE FROM "hosted_mailbox_item"');
    expect(mailboxDeleteSql).toContain('"expires_at" <=');
    expect(mailboxDeleteSql).toContain('"created_at" <');
    expect(mailboxDeleteSql).not.toContain("consumed_seq");
    expect(mailboxDeleteSql).not.toContain("tombstoned");
    expect(executeRaw.mock.calls[0]?.slice(1)).toEqual([
      now,
      new Date(now.getTime() - HOSTED_MAILBOX_RETENTION_MS),
    ]);
    expect(hostedRuntimeLogDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            at: {
              lt: new Date(now.getTime() - HOSTED_RUN_LOG_RETENTION_MS),
            },
          },
          {
            eventCode: "assistant.automation_detail",
            at: {
              lt: new Date(
                now.getTime() - HOSTED_RUN_LOG_AUTOMATION_DETAIL_RETENTION_MS,
              ),
            },
          },
        ],
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
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const dueSql = String(queryRaw.mock.calls[0]?.[0].join("?"));
    expect(dueSql).toContain("WITH due AS");
    expect(dueSql).toContain('FROM "hosted_workspace"');
    expect(dueSql).toContain('"inbox_media_retention_wake_at" <=');
    expect(dueSql).toContain('"inbox_media_retention_signal_attempted_at" ASC NULLS FIRST');
    expect(dueSql).toContain('UPDATE "hosted_workspace"');
    expect(dueSql).toContain(
      'SET "inbox_media_retention_signal_attempted_at" = ?',
    );
    expect(dueSql).toContain('RETURNING "hosted_workspace"."user_id" AS "userId"');
    expect(dueSql).toContain(`LIMIT ?`);
    expect(dueSql).not.toContain("FOR UPDATE");
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([
      now,
      HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE,
      now,
    ]);
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[0],
    );
    expect(hostedRuntimeLogDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[0],
    );
    expect(hostedWebSessionDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[0],
    );
    expect(hostedComputerRunFindMany.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[0],
    );
    expect(signalRuntimeRecheck).toHaveBeenCalledTimes(2);
    expect(signalRuntimeRecheck).toHaveBeenNthCalledWith(1, {
      userId: "member_due_1",
    });
    expect(signalRuntimeRecheck).toHaveBeenNthCalledWith(2, {
      userId: "member_due_2",
    });
    expect(hostedComputerRunFindMany).toHaveBeenCalledWith({
      orderBy: {
        updatedAt: "asc",
      },
      take: 25,
      where: {
        OR: [
          {
            expiresAt: { lte: now },
            status: { in: ["running", "awaiting_user", "cleanup_pending"] },
          },
          {
            kernelSessionId: { not: null },
            status: { in: ["completed", "failed", "expired", "canceled"] },
          },
        ],
      },
    });
  });

  it("finishes database cleanup before timing out stuck media-retention signals", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-04-25T12:00:00.000Z");
      const executeRaw = vi.fn().mockResolvedValue(1);
      const hostedRuntimeLogDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
      const hostedWebSessionDeleteMany = vi.fn().mockResolvedValue({ count: 3 });
      const hostedComputerRunFindMany = vi.fn().mockResolvedValue([]);
      const queryRaw = vi.fn().mockResolvedValue([{ userId: "member_due_stuck" }]);
      const signalRuntimeRecheck = vi.fn(() => new Promise(() => undefined));
      const prisma = {
        $executeRaw: executeRaw,
        $queryRaw: queryRaw,
        hostedComputerRun: {
          findMany: hostedComputerRunFindMany,
        },
        hostedRuntimeLog: {
          deleteMany: hostedRuntimeLogDeleteMany,
        },
        hostedWebSession: {
          deleteMany: hostedWebSessionDeleteMany,
        },
      };

      const cleanup = runHostedRetentionCleanup({
        now,
        prisma: prisma as never,
        signalRuntimeRecheck,
      });

      for (let index = 0; index < 20 && queryRaw.mock.calls.length === 0; index += 1) {
        await Promise.resolve();
      }
      expect(queryRaw).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS);
      await expect(cleanup).resolves.toEqual({
        expiredComputerRunsCleanedUp: 0,
        expiredMailboxItemsDeleted: 1,
        inboxMediaRetentionRuntimeSignalFailures: 1,
        inboxMediaRetentionRuntimeSignalsSent: 0,
        oldRuntimeLogsDeleted: 2,
        staleWebSessionsDeleted: 3,
      });
      expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        queryRaw.mock.invocationCallOrder[0],
      );
      expect(hostedRuntimeLogDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        queryRaw.mock.invocationCallOrder[0],
      );
      expect(hostedWebSessionDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        queryRaw.mock.invocationCallOrder[0],
      );
      expect(hostedComputerRunFindMany.mock.invocationCallOrder[0]).toBeLessThan(
        queryRaw.mock.invocationCallOrder[0],
      );
      expect(signalRuntimeRecheck).toHaveBeenCalledWith({
        userId: "member_due_stuck",
      });
    } finally {
      vi.useRealTimers();
    }
  }, HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS + 1_000);

  it("rotates failed media-retention signal attempts past the oldest batch", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const nextHour = new Date("2026-04-25T13:00:00.000Z");
    const workspaces = Array.from(
      { length: HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE + 1 },
      (_, index) => ({
        attemptedAt: null as Date | null,
        userId: `member_due_${String(index + 1).padStart(2, "0")}`,
        wakeAt: now,
      }),
    );
    const executeRaw = vi.fn().mockResolvedValue(0);
    const hostedRuntimeLogDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const hostedWebSessionDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const hostedComputerRunFindMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn(async (
      _sql: TemplateStringsArray,
      dueAt: Date,
      limit: number,
      attemptedAt: Date,
    ) => {
      const selected = workspaces
        .filter((workspace) => workspace.wakeAt <= dueAt)
        .sort((left, right) => {
          const leftAttemptedAt = left.attemptedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
          const rightAttemptedAt = right.attemptedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
          if (leftAttemptedAt !== rightAttemptedAt) {
            return leftAttemptedAt - rightAttemptedAt;
          }
          if (left.wakeAt.getTime() !== right.wakeAt.getTime()) {
            return left.wakeAt.getTime() - right.wakeAt.getTime();
          }
          return left.userId.localeCompare(right.userId);
        })
        .slice(0, limit);
      for (const workspace of selected) {
        workspace.attemptedAt = attemptedAt;
      }
      return selected.map((workspace) => ({ userId: workspace.userId }));
    });
    const signalRuntimeRecheck = vi.fn(async (_input: { userId: string }) => {
      throw new Error("runtime unavailable");
    });
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedComputerRun: {
        findMany: hostedComputerRunFindMany,
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
      signalRuntimeRecheck,
    })).resolves.toMatchObject({
      inboxMediaRetentionRuntimeSignalFailures: HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE,
      inboxMediaRetentionRuntimeSignalsSent: 0,
    });
    await expect(runHostedRetentionCleanup({
      now: nextHour,
      prisma: prisma as never,
      signalRuntimeRecheck,
    })).resolves.toMatchObject({
      inboxMediaRetentionRuntimeSignalFailures: HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE,
      inboxMediaRetentionRuntimeSignalsSent: 0,
    });

    const firstRunUserIds = signalRuntimeRecheck.mock.calls
      .slice(0, HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE)
      .map(([input]) => input.userId);
    const secondRunUserIds = signalRuntimeRecheck.mock.calls
      .slice(HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE)
      .map(([input]) => input.userId);
    expect(firstRunUserIds).not.toContain("member_due_26");
    expect(secondRunUserIds).toContain("member_due_26");
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
