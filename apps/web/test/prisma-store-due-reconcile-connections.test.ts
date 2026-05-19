import { describe, expect, it, vi } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

describe("PrismaDeviceSyncControlPlaneStore due reconcile connection sweep", () => {
  it("scans active due connections while excluding pending dirty state", async () => {
    const dueAt = new Date("2026-05-05T00:01:00.000Z");
    const queryCalls: unknown[] = [];
    const prisma = {
      $queryRaw: vi.fn(async (query: unknown) => {
        queryCalls.push(query);
        return [
          {
            id: "dsc_due_1",
            next_reconcile_at: new Date("2026-05-05T00:00:00.000Z"),
            provider: "whoop",
            user_id: "member_due_1",
          },
        ];
      }),
    };
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: prisma as never,
    });

    const result = await store.listDueReconcileConnectionsForSweep({
      dueAt,
      limit: 999,
    });

    expect(result).toEqual([
      {
        connectionId: "dsc_due_1",
        nextReconcileAt: "2026-05-05T00:00:00.000Z",
        provider: "whoop",
        userId: "member_due_1",
      },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const query = queryCalls[0] as {
      text: string;
      values: unknown[];
    };
    expect(query.text).toContain('"connection"."status" = \'active\'');
    expect(query.text).toContain('"connection"."next_reconcile_at" <= $1');
    expect(query.text).toContain("not exists");
    expect(query.text).toContain('"dirty"."connection_id" = "connection"."id"');
    expect(query.text).toContain('"dirty"."dirty_revision" > "dirty"."processed_revision"');
    expect(query.text).toContain(
      'order by\n        "connection"."next_reconcile_at" asc,\n        "connection"."updated_at" asc,\n        "connection"."id" asc',
    );
    expect(query.values).toEqual([dueAt, 251]);
  });
});
