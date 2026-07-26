import { afterEach, describe, expect, it, vi } from "vitest";

import * as hostedRuntimeSignals from "@/src/lib/hosted-orchestration/signal-runtime";
import {
  HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE,
  HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS,
  HOSTED_MAILBOX_RETENTION_MS,
  HOSTED_MAILBOX_STRUCTURAL_RETENTION_MS,
  HOSTED_RUN_LOG_AUTOMATION_DETAIL_RETENTION_MS,
  HOSTED_RUN_LOG_RETENTION_MS,
  HOSTED_WEB_SESSION_RETENTION_MS,
  runHostedRetentionCleanup,
} from "@/src/lib/hosted-retention/cleanup";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hosted retention cleanup", () => {
  it("uses the retention-only runtime signal for due inactive workspaces", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const signalRetentionRecheck = vi.spyOn(
      hostedRuntimeSignals,
      "signalHostedRetentionRuntimeRecheck",
    ).mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_inactive",
    });
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        policyNonReplies: 0n,
        retired: 0n,
        tombstonesDeleted: 0n,
      }])
      .mockResolvedValueOnce([{ userId: "member_inactive" }]);
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: queryRaw,
      hostedComputerRun: { findMany: vi.fn().mockResolvedValue([]) },
      hostedRuntimeLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      hostedWebSession: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };

    await expect(runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      inboxMediaRetentionRuntimeSignalFailures: 0,
      inboxMediaRetentionRuntimeSignalsSent: 1,
    });
    expect(signalRetentionRecheck).toHaveBeenCalledWith({
      userId: "member_inactive",
    });
  });

  it("deletes expired mailbox items, runtime logs, and stale web sessions", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const executeRaw = vi.fn().mockResolvedValue(7);
    const hostedRuntimeLogDeleteMany = vi.fn().mockResolvedValue({ count: 8 });
    const hostedWebSessionDeleteMany = vi.fn().mockResolvedValue({ count: 9 });
    const hostedComputerRunFindMany = vi.fn().mockResolvedValue([]);
    // The mailbox retirement runs first; the
    // due-workspace claim is the second raw query.
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        policyNonReplies: 0n,
        retired: 7n,
        tombstonesDeleted: 3n,
      }])
      .mockResolvedValueOnce([
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
      expiredConversationPolicyNonRepliesRecorded: 0,
      expiredMailboxContentRetired: 7,
      expiredMailboxTombstonesDeleted: 3,
      inboxMediaRetentionRuntimeSignalFailures: 1,
      inboxMediaRetentionRuntimeSignalsSent: 1,
      oldRuntimeLogsDeleted: 8,
      staleWebSessionsDeleted: 9,
    });

    const mailboxDeleteSql = String(queryRaw.mock.calls[0]?.[0].join("?"));
    expect(mailboxDeleteSql).toContain('UPDATE "hosted_mailbox_item"');
    expect(mailboxDeleteSql).toContain('DELETE FROM "hosted_mailbox_payload"');
    expect(mailboxDeleteSql).toContain('"content_retired_at"');
    expect(mailboxDeleteSql).toContain("'policy_non_reply.content_expired'");
    expect(mailboxDeleteSql).toContain('UPDATE "hosted_mailbox_lane_counter"');
    expect(mailboxDeleteSql).toContain('"consumed_seq" = GREATEST');
    expect(mailboxDeleteSql).toContain('MIN(blocker."lane_seq") - 1');
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([
      now,
      new Date(now.getTime() - HOSTED_MAILBOX_RETENTION_MS),
      now,
      now,
      now,
      now,
      new Date(now.getTime() - HOSTED_MAILBOX_STRUCTURAL_RETENTION_MS),
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
    // Call 0 is the mailbox delete; call 1 claims the due workspaces.
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const dueSql = String(queryRaw.mock.calls[1]?.[0].join("?"));
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
    expect(queryRaw.mock.calls[1]?.slice(1)).toEqual([
      now,
      HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE,
      now,
    ]);
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[1],
    );
    expect(hostedRuntimeLogDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[1],
    );
    expect(hostedWebSessionDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[1],
    );
    expect(hostedComputerRunFindMany.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[1],
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

  it("records an explicit policy non-reply instead of silently dropping accepted work", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        policyNonReplies: 1n,
        retired: 3n,
        tombstonesDeleted: 0n,
      }])
      .mockResolvedValueOnce([]);
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: queryRaw,
      hostedComputerRun: { findMany: vi.fn().mockResolvedValue([]) },
      hostedRuntimeLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      hostedWebSession: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    await expect(runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
      signalRuntimeRecheck: vi.fn(),
    })).resolves.toMatchObject({
      expiredConversationPolicyNonRepliesRecorded: 1,
      expiredMailboxContentRetired: 3,
    });
    const sql = String(queryRaw.mock.calls[0]?.[0].join("?"));
    expect(sql).toContain('"payload_inline_ciphertext" = NULL');
    expect(sql).toContain('"payload_ref" = NULL');
    expect(sql).toContain('"consumed_at" = CASE');
  });

  it("finishes database cleanup before timing out stuck media-retention signals", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-04-25T12:00:00.000Z");
      const executeRaw = vi.fn().mockResolvedValue(1);
      const hostedRuntimeLogDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
      const hostedWebSessionDeleteMany = vi.fn().mockResolvedValue({ count: 3 });
      const hostedComputerRunFindMany = vi.fn().mockResolvedValue([]);
      const queryRaw = vi.fn()
        .mockResolvedValueOnce([{
          policyNonReplies: 0n,
          retired: 1n,
          tombstonesDeleted: 0n,
        }])
        .mockResolvedValueOnce([{ userId: "member_due_stuck" }]);
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

      for (let index = 0; index < 40 && queryRaw.mock.calls.length < 2; index += 1) {
        await Promise.resolve();
      }
      expect(queryRaw).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS);
      await expect(cleanup).resolves.toEqual({
        expiredComputerRunsCleanedUp: 0,
        expiredConversationPolicyNonRepliesRecorded: 0,
        expiredMailboxContentRetired: 1,
        expiredMailboxTombstonesDeleted: 0,
        inboxMediaRetentionRuntimeSignalFailures: 1,
        inboxMediaRetentionRuntimeSignalsSent: 0,
        oldRuntimeLogsDeleted: 2,
        staleWebSessionsDeleted: 3,
      });
      expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        queryRaw.mock.invocationCallOrder[1],
      );
      expect(hostedRuntimeLogDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        queryRaw.mock.invocationCallOrder[1],
      );
      expect(hostedWebSessionDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        queryRaw.mock.invocationCallOrder[1],
      );
      expect(hostedComputerRunFindMany.mock.invocationCallOrder[0]).toBeLessThan(
        queryRaw.mock.invocationCallOrder[1],
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
      sql: TemplateStringsArray,
      dueAt: Date,
      limit: number,
      attemptedAt: Date,
    ) => {
      // The mailbox delete shares $queryRaw with the due-workspace claim, so
      // branch on the statement rather than on call order.
      if (sql.join("?").includes('UPDATE "hosted_mailbox_item"')) {
        return [{
          policyNonReplies: 0n,
          retired: 0n,
          tombstonesDeleted: 0n,
        }];
      }
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
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });
});
