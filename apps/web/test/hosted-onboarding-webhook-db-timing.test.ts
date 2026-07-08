import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildHostedWebhookDbTimingLogDetails,
} from "@/src/lib/hosted-onboarding/webhook-db-timing";
import {
  isPrismaOperationTimingActive,
  recordPrismaOperationTiming,
  runWithPrismaOperationTimings,
  type PrismaOperationTiming,
} from "@/src/lib/prisma-operation-timing";

describe("prisma operation timing collector", () => {
  it("records operations only while a collector is active", async () => {
    expect(isPrismaOperationTimingActive()).toBe(false);
    recordPrismaOperationTiming("hostedMailboxItem.findFirst", 12);

    const operations: PrismaOperationTiming[] = [];
    await runWithPrismaOperationTimings(operations, async () => {
      expect(isPrismaOperationTimingActive()).toBe(true);
      recordPrismaOperationTiming("hostedMailboxItem.findFirst", 12);
      recordPrismaOperationTiming("hostedWorkspace.upsert", 7);
    });

    expect(isPrismaOperationTimingActive()).toBe(false);
    expect(operations).toEqual([
      { key: "hostedMailboxItem.findFirst", ms: 12 },
      { key: "hostedWorkspace.upsert", ms: 7 },
    ]);
  });

  it("keeps operations recorded before the callback throws", async () => {
    const operations: PrismaOperationTiming[] = [];

    await expect(
      runWithPrismaOperationTimings(operations, async () => {
        recordPrismaOperationTiming("hostedMemberIdentity.findFirst", 40);
        throw new Error("plan failed");
      }),
    ).rejects.toThrow("plan failed");

    expect(operations).toEqual([{ key: "hostedMemberIdentity.findFirst", ms: 40 }]);
  });

  it("isolates concurrent collectors from each other", async () => {
    const first: PrismaOperationTiming[] = [];
    const second: PrismaOperationTiming[] = [];

    await Promise.all([
      runWithPrismaOperationTimings(first, async () => {
        await Promise.resolve();
        recordPrismaOperationTiming("hostedMailboxItem.create", 3);
      }),
      runWithPrismaOperationTimings(second, async () => {
        recordPrismaOperationTiming("hostedMemberRouting.findFirst", 5);
        await Promise.resolve();
      }),
    ]);

    expect(first).toEqual([{ key: "hostedMailboxItem.create", ms: 3 }]);
    expect(second).toEqual([{ key: "hostedMemberRouting.findFirst", ms: 5 }]);
  });
});

describe("hosted webhook db timing log details", () => {
  it("builds flat details with count, total, and ordered per-operation keys", () => {
    const details = buildHostedWebhookDbTimingLogDetails([
      { key: "hostedMemberIdentity.findFirst", ms: 41.6 },
      { key: "hostedMailboxItem.create", ms: 18.2 },
    ]);

    expect(details).toEqual({
      "db00.hostedMemberIdentity.findFirst": 42,
      "db01.hostedMailboxItem.create": 18,
      dbOperationCount: 2,
      dbTotalMs: 60,
    });
  });

  it("marks truncation past the per-log operation cap", () => {
    const operations = Array.from({ length: 30 }, (_, index) => ({
      key: `hostedMailboxItem.op${index}`,
      ms: 1,
    }));

    const details = buildHostedWebhookDbTimingLogDetails(operations);

    expect(details.dbOperationCount).toBe(30);
    expect(details.dbOperationsTruncated).toBe(true);
    expect(details).toHaveProperty("db23.hostedMailboxItem.op23");
    expect(details).not.toHaveProperty("db24.hostedMailboxItem.op24");
  });
});
