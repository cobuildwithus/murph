import { describe, expect, it, vi } from "vitest";

import { PrismaHostedDirtyConnectionStore } from "@/src/lib/device-sync/prisma-store/dirty-connections";
import { sealHostedDeviceSyncDirtyPayloadJson } from "@/src/lib/device-sync/prisma-store/dirty-payloads";

describe("PrismaHostedDirtyConnectionStore dirty recovery sweep", () => {
  it("moves Junction webhook payload JSON out of the compact dirty row while preserving the runtime resource", async () => {
    let createData: Record<string, unknown> | null = null;
    let payloadCreateData: Array<Record<string, unknown>> | null = null;
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
      deviceSyncDirtyPayload: {
        createMany: vi.fn(async (input: { data: Array<Record<string, unknown>> }) => {
          payloadCreateData = input.data;
          return { count: input.data.length };
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
    const createdDirtyData = createData as Record<string, unknown> | null;
    const createdPayloadData = payloadCreateData as Array<Record<string, unknown>> | null;
    const compactDirtyJson = JSON.stringify(createdDirtyData?.dirtyResourcesJson ?? {});
    const payloadRowJson = String(createdPayloadData?.[0]?.resourceEncrypted ?? "");
    const resourceEncrypted = createdPayloadData?.[0]?.resourceEncrypted;

    expect(dirtyResource?.payload?.webhookDataJson).toBe(webhookDataJson);
    expect(dirtyResource?.dirtyPayloadId).toBe(createdPayloadData?.[0]?.id);
    expect(dirtyResource?.payload?.ordinary).toHaveLength(512);
    expect(compactDirtyJson).not.toContain("webhookDataJson");
    expect(compactDirtyJson.length).toBeLessThan(128);
    expect(payloadRowJson).not.toContain(webhookDataJson);
    expect(typeof resourceEncrypted).toBe("string");
    expect(resourceEncrypted).toMatch(/^hsb-test:/u);
    expect(prisma.deviceSyncDirtyConnection.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.deviceSyncDirtyPayload.createMany).toHaveBeenCalledTimes(1);
  });

  it("hydrates pending runtime dirty resources from durable payload rows", async () => {
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const webhookDataJson = JSON.stringify({ sampleCount: 2, source: "garmin" });
    const payloadResource = {
      count: 1,
      jobKind: "resource",
      payload: {
        webhookDataJson,
      },
      resource: "heartrate",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowEnd: "2026-05-26T12:10:00.000Z",
      windowStart: "2026-05-26T12:00:00.000Z",
    };
    const payloadId = "dsp_payload_1";
    const resourceEncrypted = await sealHostedDeviceSyncDirtyPayloadJson({
      connectionId: "dsc_junction_123",
      dirtyRevision: 2n,
      payloadId,
      provider: "junction",
      userId: "member_123",
      value: payloadResource,
    });
    const prisma = {
      $queryRaw: vi.fn(async () => [{ connection_id: "dsc_junction_123" }]),
      deviceSyncDirtyConnection: {
        findMany: vi.fn(async () => [
          {
            connectionId: "dsc_junction_123",
            createdAt: dirtyAt,
            dirtyResourcesJson: {},
            dirtyRevision: 3n,
            eventCount: 3n,
            firstDirtyAt: dirtyAt,
            latestDirtyAt: dirtyAt,
            latestEventType: "daily.data.heartrate.created",
            latestResourceCategory: "timeseries",
            latestTraceId: "trace_junction_123",
            processedRevision: 1n,
            provider: "junction",
            resourceCategoryCountsJson: { timeseries: 3 },
            sourceProviderCountsJson: { garmin: 3 },
            updatedAt: dirtyAt,
            userId: "member_123",
            windowEnd: new Date("2026-05-26T12:10:00.000Z"),
            windowStart: dirtyAt,
          },
        ]),
      },
      deviceSyncDirtyPayload: {
        findMany: vi.fn(async () => [
          {
            connectionId: "dsc_junction_123",
            dirtyRevision: 2n,
            id: payloadId,
            provider: "junction",
            resourceEncrypted,
          },
        ]),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    const result = await store.listPendingDirtyConnectionsForUser({
      limit: 10,
      userId: "member_123",
    });
    const dirtyResource = Object.values(result.items[0]?.dirtyResources ?? {})[0];

    expect(result.hasMore).toBe(false);
    expect(dirtyResource?.payload?.webhookDataJson).toBe(webhookDataJson);
    expect(prisma.deviceSyncDirtyPayload.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "member_123",
      }),
    }));
  });

  it("deletes only explicitly acknowledged durable payload ids", async () => {
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const remainingPayloadResource = {
      count: 1,
      dirtyPayloadId: "dsp_payload_remaining",
      jobKind: "resource",
      payload: {
        webhookDataJson: JSON.stringify({ source: "garmin", window: "remaining" }),
      },
      resource: "steps",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowEnd: "2026-05-26T12:10:00.000Z",
      windowStart: "2026-05-26T12:00:00.000Z",
    };
    const remainingResourceEncrypted = await sealHostedDeviceSyncDirtyPayloadJson({
      connectionId: "dsc_junction_123",
      dirtyRevision: 3n,
      payloadId: "dsp_payload_remaining",
      provider: "junction",
      userId: "member_123",
      value: remainingPayloadResource,
    });
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            connectionId: "dsc_junction_123",
            dirtyRevision: 3n,
            latestDirtyAt: dirtyAt,
            processedRevision: 1n,
            userId: "member_123",
          })
          .mockResolvedValueOnce({
            connectionId: "dsc_junction_123",
            createdAt: dirtyAt,
            dirtyResourcesJson: {},
            dirtyRevision: 3n,
            eventCount: 5n,
            firstDirtyAt: dirtyAt,
            latestDirtyAt: dirtyAt,
            latestEventType: "daily.data.steps.created",
            latestResourceCategory: "timeseries",
            latestTraceId: "trace_junction_123",
            processedRevision: 3n,
            provider: "junction",
            resourceCategoryCountsJson: {},
            sourceProviderCountsJson: {},
            updatedAt: dirtyAt,
            userId: "member_123",
            windowEnd: null,
            windowStart: null,
          }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      deviceSyncDirtyPayload: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [
          {
            connectionId: "dsc_junction_123",
            dirtyRevision: 3n,
            id: "dsp_payload_remaining",
            provider: "junction",
            resourceEncrypted: remainingResourceEncrypted,
          },
        ]),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    const result = await store.markDirtyConnectionProcessed({
      connectionId: "dsc_junction_123",
      processedDirtyPayloadIds: ["dsp_payload_done"],
      processedRevision: 3n,
      userId: "member_123",
    });

    expect(prisma.deviceSyncDirtyPayload.deleteMany).toHaveBeenCalledWith({
      where: {
        connectionId: "dsc_junction_123",
        id: {
          in: ["dsp_payload_done"],
        },
        userId: "member_123",
      },
    });
    const dirtyResource = Object.values(result?.dirtyResources ?? {})[0];
    expect(dirtyResource?.dirtyPayloadId).toBe("dsp_payload_remaining");
    expect(dirtyResource?.payload?.webhookDataJson)
      .toBe(remainingPayloadResource.payload.webhookDataJson);
  });

  it("removes durable payload rows after their dirty revision is acknowledged", async () => {
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const remainingPayloadResource = {
      count: 1,
      jobKind: "resource",
      payload: {
        webhookDataJson: JSON.stringify({ source: "garmin", window: "remaining" }),
      },
      resource: "steps",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowEnd: "2026-05-26T12:10:00.000Z",
      windowStart: "2026-05-26T12:00:00.000Z",
    };
    const remainingPayloadId = "dsp_payload_remaining";
    const remainingResourceEncrypted = await sealHostedDeviceSyncDirtyPayloadJson({
      connectionId: "dsc_junction_123",
      dirtyRevision: 4n,
      payloadId: remainingPayloadId,
      provider: "junction",
      userId: "member_123",
      value: remainingPayloadResource,
    });
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            connectionId: "dsc_junction_123",
            dirtyRevision: 5n,
            latestDirtyAt: dirtyAt,
            processedRevision: 1n,
            userId: "member_123",
          })
          .mockResolvedValueOnce({
            connectionId: "dsc_junction_123",
            createdAt: dirtyAt,
            dirtyResourcesJson: {},
            dirtyRevision: 5n,
            eventCount: 5n,
            firstDirtyAt: dirtyAt,
            latestDirtyAt: dirtyAt,
            latestEventType: "daily.data.steps.created",
            latestResourceCategory: "timeseries",
            latestTraceId: "trace_junction_123",
            processedRevision: 3n,
            provider: "junction",
            resourceCategoryCountsJson: { timeseries: 5 },
            sourceProviderCountsJson: { garmin: 5 },
            updatedAt: dirtyAt,
            userId: "member_123",
            windowEnd: new Date("2026-05-26T12:10:00.000Z"),
            windowStart: dirtyAt,
          }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      deviceSyncDirtyPayload: {
        deleteMany: vi.fn(async () => ({ count: 2 })),
        findMany: vi.fn(async () => [
          {
            connectionId: "dsc_junction_123",
            dirtyRevision: 4n,
            id: remainingPayloadId,
            provider: "junction",
            resourceEncrypted: remainingResourceEncrypted,
          },
        ]),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    const result = await store.markDirtyConnectionProcessed({
      connectionId: "dsc_junction_123",
      processedRevision: 3n,
      userId: "member_123",
    });

    expect(prisma.deviceSyncDirtyPayload.deleteMany).toHaveBeenCalledWith({
      where: {
        connectionId: "dsc_junction_123",
        dirtyRevision: {
          lte: 3n,
        },
        userId: "member_123",
      },
    });
    expect(Object.values(result?.dirtyResources ?? {})[0]?.payload?.webhookDataJson)
      .toBe(remainingPayloadResource.payload.webhookDataJson);
  });

  it("does not retry or sleep on dirty-state contention inside caller-owned transactions", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const prisma = {
      $transaction: vi.fn(),
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);
    const createTx = {
      deviceSyncDirtyConnection: {
        createMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => null),
      },
      deviceSyncDirtyPayload: {
        createMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const ackTx = {
      deviceSyncDirtyConnection: {
        findFirst: vi.fn(async () => ({
          connectionId: "dsc_dirty_1",
          dirtyRevision: 2n,
          latestDirtyAt: new Date("2026-05-26T12:00:00.000Z"),
          processedRevision: 1n,
          userId: "member_dirty_1",
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      deviceSyncDirtyPayload: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        findMany: vi.fn(async () => []),
      },
    };

    try {
      await expect(store.upsertDirtyConnection({
        connectionId: "dsc_dirty_1",
        dirtyAt: "2026-05-26T12:00:00.000Z",
        eventType: "sleep.updated",
        provider: "oura",
        resourceCategory: "sleep",
        traceId: "trace_dirty_1",
        tx: createTx as never,
        userId: "member_dirty_1",
      })).rejects.toMatchObject({
        code: "HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION",
        retryable: true,
      });

      await expect(store.markDirtyConnectionProcessed({
        connectionId: "dsc_dirty_1",
        processedRevision: 2n,
        tx: ackTx as never,
        userId: "member_dirty_1",
      })).rejects.toMatchObject({
        code: "HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION",
        retryable: true,
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(createTx.deviceSyncDirtyConnection.createMany).toHaveBeenCalledTimes(1);
      expect(ackTx.deviceSyncDirtyConnection.updateMany).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
    }
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
