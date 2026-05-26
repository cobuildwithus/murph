import { describe, expect, it, vi } from "vitest";

import { PrismaHostedDirtyConnectionStore } from "@/src/lib/device-sync/prisma-store/dirty-connections";

describe("PrismaHostedDirtyConnectionStore dirty recovery sweep", () => {
  it("preserves bounded Junction webhook payload JSON while keeping ordinary payload strings short", async () => {
    let createData: Record<string, unknown> | null = null;
    let findCount = 0;
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        createMany: vi.fn(async (input: { data: Record<string, unknown> }) => {
          createData = input.data;
          return { count: 1 };
        }),
        findUnique: vi.fn(async () => {
          findCount += 1;
          if (findCount === 1 || !createData) {
            return null;
          }

          const dirtyAt = createData.latestDirtyAt as Date;
          return {
            connectionId: createData.connectionId,
            userId: createData.userId,
            provider: createData.provider,
            dirtyRevision: createData.dirtyRevision,
            processedRevision: createData.processedRevision,
            firstDirtyAt: createData.firstDirtyAt,
            latestDirtyAt: createData.latestDirtyAt,
            windowStart: createData.windowStart,
            windowEnd: createData.windowEnd,
            eventCount: createData.eventCount,
            latestTraceId: createData.latestTraceId,
            latestEventType: createData.latestEventType,
            latestResourceCategory: createData.latestResourceCategory,
            sourceProviderCountsJson: createData.sourceProviderCountsJson,
            resourceCategoryCountsJson: createData.resourceCategoryCountsJson,
            dirtyResourcesJson: createData.dirtyResourcesJson,
            createdAt: dirtyAt,
            updatedAt: dirtyAt,
          };
        }),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);
    const webhookDataJson = JSON.stringify({
      data: "x".repeat(1_000),
      sourceProviderSlug: "garmin",
    });

    const result = await store.upsertDirtyConnection({
      connectionId: "dsc_junction_123",
      dirtyAt: "2026-05-26T12:00:00.000Z",
      eventType: "daily.data.steps.created",
      provider: "junction",
      resourceCategory: "timeseries",
      resources: [
        {
          count: 1,
          jobKind: "resource",
          payload: {
            ordinary: "y".repeat(1_000),
            webhookDataJson,
          },
          resource: "steps",
          resourceCategory: "timeseries",
          sourceProviderSlug: "garmin",
          windowEnd: "2026-05-27T00:00:00.000Z",
          windowStart: "2026-05-26T00:00:00.000Z",
        },
      ],
      traceId: "trace_junction_123",
      userId: "member_123",
    });
    const dirtyResource = Object.values(result.dirty.dirtyResources)[0];

    expect(dirtyResource?.payload?.webhookDataJson).toBe(webhookDataJson);
    expect(dirtyResource?.payload?.ordinary).toHaveLength(512);
    expect(prisma.deviceSyncDirtyConnection.createMany).toHaveBeenCalledTimes(1);
  });

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
