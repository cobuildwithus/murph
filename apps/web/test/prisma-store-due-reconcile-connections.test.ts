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
    expect(query.text.toLowerCase()).toContain('"connection"."status" = \'active\'');
    expect(query.text.toLowerCase()).toContain('"connection"."connected_at"');
    expect(query.text.toLowerCase()).toContain('"connection"."next_reconcile_at" <= $1');
    expect(query.text.toLowerCase()).toContain('join "hosted_member" as "member"');
    expect(query.text.toLowerCase()).toContain('"member"."suspended_at" is null');
    // Product eligibility (including returning people) and consent precede LIMIT.
    expect(query.text).toContain("'canceled', 'paused', 'unpaid', 'past_due'");
    expect(query.text).toContain('"hosted_mailbox_item" AS "activation"');
    expect(query.text.indexOf('"member"."billing_status" IN')).toBeLessThan(query.text.toLowerCase().lastIndexOf("limit"));
    expect(query.text.toLowerCase()).toContain('"member"."billing_status" = \'active\'');
    expect(query.text.toLowerCase()).toContain('from "hosted_account_group_membership" as "membership"');
    expect(query.text.toLowerCase()).toContain('"membership"."status" = \'active\'');
    expect(query.text.toLowerCase()).toContain('"account_group"."billing_status" = \'active\'');
    expect(query.text.toLowerCase()).toContain('"account_group"."suspended_at" is null');
    expect(query.text.toLowerCase()).toContain('from "hosted_consent_grant" as "consent_grant"');
    expect(query.text.toLowerCase()).toContain('"consent_grant"."member_id" = "member"."id"');
    expect(query.text.toLowerCase()).toContain('"consent_grant"."scope" = $2');
    expect(query.text.toLowerCase()).toContain('"consent_grant"."status" = \'revoked\'');
    expect(query.text.toLowerCase()).toContain("not exists");
    expect(query.text.toLowerCase()).not.toContain('from "device_sync_dirty_connection" as "dirty"');
    expect(query.text.toLowerCase()).not.toContain('from "device_sync_dirty_payload" as "payload"');
    expect(query.text.toLowerCase()).toContain('from "device_sync_signal" as "signal"');
    expect(query.text.toLowerCase()).toContain('"signal"."connection_id" = "connection"."id"');
    expect(query.text.toLowerCase()).toContain('"signal"."kind" = \'reconcile_due\'');
    expect(query.text.toLowerCase()).toContain('"signal"."next_reconcile_at" = "connection"."next_reconcile_at"');
    expect(query.text.toLowerCase()).toContain('"signal"."created_at" >= $3');
    expect(query.text.toLowerCase()).toContain(
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
