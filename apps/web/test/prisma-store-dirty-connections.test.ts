import { describe, expect, it, vi } from "vitest";

import { PrismaHostedDirtyConnectionStore } from "@/src/lib/device-sync/prisma-store/dirty-connections";

describe("PrismaHostedDirtyConnectionStore dirty recovery sweep", () => {
  it("scans stale dirty connections only for active connections and active hosted members", async () => {
    const staleBefore = new Date("2026-05-05T00:00:30.000Z");
    const queryCalls: unknown[] = [];
    const prisma = {
      $queryRaw: vi.fn(async (query: unknown) => {
        queryCalls.push(query);
        return [
          {
            connection_id: "dsc_dirty_1",
            dirty_revision: 2n,
            latest_dirty_at: new Date("2026-05-05T00:00:00.000Z"),
            latest_event_type: "sleep.updated",
            latest_resource_category: "sleep",
            latest_trace_id: "trace_dirty_1",
            provider: "oura",
            user_id: "member_dirty_1",
          },
        ];
      }),
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    const result = await store.listDirtyConnectionsForSweep({
      limit: 999,
      staleBefore,
    });

    expect(result).toEqual([
      {
        connectionId: "dsc_dirty_1",
        dirtyRevision: 2n,
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
        latestEventType: "sleep.updated",
        latestResourceCategory: "sleep",
        latestTraceId: "trace_dirty_1",
        provider: "oura",
        userId: "member_dirty_1",
      },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const query = queryCalls[0] as {
      text: string;
      values: unknown[];
    };
    expect(query.text).toContain('from "device_sync_dirty_connection" as "dirty"');
    expect(query.text).toContain('join "device_connection" as "connection"');
    expect(query.text).toContain('"connection"."id" = "dirty"."connection_id"');
    expect(query.text).toContain('"connection"."user_id" = "dirty"."user_id"');
    expect(query.text).toContain('join "hosted_member" as "member"');
    expect(query.text).toContain('"member"."id" = "dirty"."user_id"');
    expect(query.text).toContain('"dirty"."dirty_revision" > "dirty"."processed_revision"');
    expect(query.text).toContain('"dirty"."latest_dirty_at" <= $1');
    expect(query.text).toContain('"connection"."status" = \'active\'');
    expect(query.text).toContain('"member"."billing_status" = \'active\'');
    expect(query.text).toContain('"member"."suspended_at" is null');
    expect(query.text).toContain(
      'order by "dirty"."latest_dirty_at" asc, "dirty"."connection_id" asc',
    );
    expect(query.values).toEqual([staleBefore, 251]);
  });

  it("scans stale dirty users only for active connections and active hosted members", async () => {
    const staleBefore = new Date("2026-05-05T00:00:30.000Z");
    const queryCalls: unknown[] = [];
    const prisma = {
      $queryRaw: vi.fn(async (query: unknown) => {
        queryCalls.push(query);
        return [
          {
            dirty_connection_count: 2n,
            latest_dirty_at: new Date("2026-05-05T00:00:00.000Z"),
            user_id: "member_dirty_1",
          },
        ];
      }),
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    const result = await store.listDirtyUsersForSweep({
      limit: 999,
      staleBefore,
    });

    expect(result).toEqual([
      {
        dirtyConnectionCount: 2n,
        latestDirtyAt: "2026-05-05T00:00:00.000Z",
        userId: "member_dirty_1",
      },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const query = queryCalls[0] as {
      text: string;
      values: unknown[];
    };
    expect(query.text).toContain('from "device_sync_dirty_connection" as "dirty"');
    expect(query.text).toContain('join "device_connection" as "connection"');
    expect(query.text).toContain('join "hosted_member" as "member"');
    expect(query.text).toContain('"connection"."status" = \'active\'');
    expect(query.text).toContain('"member"."billing_status" = \'active\'');
    expect(query.text).toContain('"member"."suspended_at" is null');
    expect(query.text).toContain('group by "dirty"."user_id"');
    expect(query.values).toEqual([staleBefore, 251]);
  });
});
