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
    const executeRaw = vi.fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(7);
    const hostedRuntimeLogDeleteMany = vi.fn().mockResolvedValue({ count: 8 });
    const hostedWebSessionDeleteMany = vi.fn().mockResolvedValue({ count: 9 });
    const prisma = {
      $executeRaw: executeRaw,
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
      expiredMailboxItemsDeleted: 7,
      oldRuntimeLogsDeleted: 8,
      staleWebSessionsDeleted: 9,
    });

    expect(executeRaw).toHaveBeenCalledTimes(2);
    const mailboxTombstoneSql = String(executeRaw.mock.calls[0]?.[0].join("?"));
    expect(mailboxTombstoneSql).toContain("WITH tombstoned AS");
    expect(mailboxTombstoneSql).toContain('UPDATE "hosted_mailbox_item" AS hmi');
    expect(mailboxTombstoneSql).toContain('"payload_inline_ciphertext" = NULL');
    expect(mailboxTombstoneSql).toContain('"payload_ref" = NULL');
    expect(mailboxTombstoneSql).toContain('hmi."lane" = \'conversation\'');
    expect(mailboxTombstoneSql).toContain('hmi."lane_seq" > COALESCE');
    expect(mailboxTombstoneSql).toContain('DELETE FROM "hosted_mailbox_payload" AS hmp');
    expect(executeRaw.mock.calls[0]?.slice(1)).toEqual([
      now,
      now,
      new Date(now.getTime() - HOSTED_MAILBOX_RETENTION_MS),
    ]);

    const mailboxDeleteSql = String(executeRaw.mock.calls[1]?.[0].join("?"));
    expect(mailboxDeleteSql).toContain('DELETE FROM "hosted_mailbox_item" AS hmi');
    expect(mailboxDeleteSql).toContain('hmi."lane" <> \'conversation\'');
    expect(mailboxDeleteSql).toContain('counter."consumed_seq"');
    expect(mailboxDeleteSql).toContain('hmi."lane_seq" <= COALESCE');
    expect(executeRaw.mock.calls[1]?.slice(1)).toEqual([
      now,
      new Date(now.getTime() - HOSTED_MAILBOX_RETENTION_MS),
    ]);
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
  });
});
