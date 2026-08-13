import { describe, expect, it, vi } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

describe("PrismaDeviceSyncControlPlaneStore due reconcile connection sweep", () => {
  it("scans active due connections without excluding pending dirty state", async () => {
    const dueAt = new Date("2026-05-05T00:01:00.000Z");
    const recoveryBucketStartedAt = new Date("2026-05-05T00:00:00.000Z");
    const queryCalls: unknown[] = [];
    const prisma = {
      $queryRaw: vi.fn(async (query: unknown) => {
        queryCalls.push(query);
        return [
          {
            connected_at: new Date("2026-05-04T12:00:00.000Z"),
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
      recoveryBucketStartedAt,
    });

    expect(result).toEqual([
      {
        connectionId: "dsc_due_1",
        connectedAt: "2026-05-04T12:00:00.000Z",
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
    expect(query.text).toContain('"connection"."connected_at"');
    expect(query.text).toContain('"connection"."next_reconcile_at" <= $1');
    expect(query.text).toContain('join "hosted_member" as "member"');
    expect(query.text).toContain('"member"."suspended_at" is null');
    // Access is the resolver projection: own active billing OR active
    // membership in an active, unsuspended account group.
    expect(query.text).toContain('"member"."billing_status" = \'active\'');
    expect(query.text).toContain('from "hosted_account_group_membership" as "membership"');
    expect(query.text).toContain('"membership"."status" = \'active\'');
    expect(query.text).toContain('"account_group"."billing_status" = \'active\'');
    expect(query.text).toContain('"account_group"."suspended_at" is null');
    expect(query.text).toContain('from "hosted_consent_grant" as "consent_grant"');
    expect(query.text).toContain('"consent_grant"."member_id" = "member"."id"');
    expect(query.text).toContain('"consent_grant"."scope" = $2');
    expect(query.text).toContain('"consent_grant"."status" = \'revoked\'');
    expect(query.text).toContain("not exists");
    expect(query.text).not.toContain('from "device_sync_dirty_connection" as "dirty"');
    expect(query.text).not.toContain('from "device_sync_dirty_payload" as "payload"');
    expect(query.text).toContain('from "device_sync_signal" as "signal"');
    expect(query.text).toContain('"signal"."connection_id" = "connection"."id"');
    expect(query.text).toContain('"signal"."kind" = \'reconcile_due\'');
    expect(query.text).toContain('"signal"."next_reconcile_at" = "connection"."next_reconcile_at"');
    expect(query.text).toContain('"signal"."created_at" >= $3');
    expect(query.text).toContain(
      'order by\n        "connection"."next_reconcile_at" asc,\n        "connection"."updated_at" asc,\n        "connection"."id" asc',
    );
    expect(query.values).toEqual([
      dueAt,
      "launch.health-data",
      recoveryBucketStartedAt,
      251,
    ]);
  });
});
