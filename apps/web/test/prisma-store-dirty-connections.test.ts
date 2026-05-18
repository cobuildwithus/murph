import { describe, expect, it, vi } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type DirtyConnectionRecord = {
  connectionId: string;
  createdAt: Date;
  dirtyResourcesJson: Record<string, unknown> | null;
  dirtyRevision: bigint;
  eventCount: bigint;
  firstDirtyAt: Date;
  latestDirtyAt: Date;
  latestEventType: string | null;
  latestResourceCategory: string | null;
  latestTraceId: string | null;
  processedRevision: bigint;
  provider: string;
  resourceCategoryCountsJson: Record<string, number> | null;
  sourceProviderCountsJson: Record<string, number> | null;
  updatedAt: Date;
  userId: string;
  windowEnd: Date | null;
  windowStart: Date | null;
};

type DirtyConnectionUpdate = {
  data: {
    dirtyResourcesJson?: Record<string, unknown> | null;
    dirtyRevision?: bigint;
    eventCount?: bigint;
    firstDirtyAt?: Date;
    latestDirtyAt?: Date;
    latestEventType?: string | null;
    latestResourceCategory?: string | null;
    latestTraceId?: string | null;
    processedRevision?: bigint;
    provider?: string;
    resourceCategoryCountsJson?: Record<string, number> | null;
    sourceProviderCountsJson?: Record<string, number> | null;
    userId?: string;
    windowEnd?: Date | null;
    windowStart?: Date | null;
  };
  where: {
    connectionId: string;
  };
};

type DirtyConnectionCreate = {
  data: Omit<DirtyConnectionRecord, "createdAt" | "updatedAt">;
};

describe("PrismaDeviceSyncControlPlaneStore dirty connection state", () => {
  it("clamps processed dirty revisions to the current dirty revision", async () => {
    const existing = buildDirtyConnectionRecord({
      dirtyRevision: 3n,
      processedRevision: 1n,
    });
    const updateCalls: DirtyConnectionUpdate[] = [];
    let current = cloneDirtyConnectionRecord(existing);
    const prisma = {
      $queryRaw: vi.fn(async () => []),
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        findFirst: vi.fn(async () => cloneDirtyConnectionRecord(current)),
        update: vi.fn(async (input: DirtyConnectionUpdate) => {
          updateCalls.push(input);
          current = cloneDirtyConnectionRecord({
            ...current,
            ...input.data,
          });
          return cloneDirtyConnectionRecord(current);
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: prisma as never,
    });

    const result = await store.markDirtyConnectionProcessed({
      connectionId: existing.connectionId,
      processedRevision: 99n,
      userId: existing.userId,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.data.processedRevision).toBe(3n);
    expect(updateCalls[0]?.data.firstDirtyAt).toEqual(existing.latestDirtyAt);
    expect(updateCalls[0]?.data.dirtyResourcesJson).toEqual({});
    expect(updateCalls[0]?.data.resourceCategoryCountsJson).toEqual({});
    expect(updateCalls[0]?.data.sourceProviderCountsJson).toEqual({});
    expect(updateCalls[0]?.data.windowEnd).toBeNull();
    expect(updateCalls[0]?.data.windowStart).toBeNull();
    expect(result?.dirtyRevision).toBe(3n);
    expect(result?.dirtyResources).toEqual({});
    expect(result?.processedRevision).toBe(3n);
  });

  it("merges dirty manifest payload windows without folding distinct payload identities together", async () => {
    const existing = buildDirtyConnectionRecord({
      dirtyRevision: 3n,
      processedRevision: 1n,
    });
    let current: DirtyConnectionRecord | null = null;
    const createCalls: DirtyConnectionCreate[] = [];
    const updateCalls: DirtyConnectionUpdate[] = [];
    const prisma = {
      $queryRaw: vi.fn(async () => []),
      deviceSyncDirtyConnection: {
        create: vi.fn(async (input: DirtyConnectionCreate) => {
          createCalls.push(input);
          current = cloneDirtyConnectionRecord({
            ...input.data,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
          });
          return cloneDirtyConnectionRecord(current);
        }),
        findUnique: vi.fn(async () => current ? cloneDirtyConnectionRecord(current) : null),
        update: vi.fn(async (input: DirtyConnectionUpdate) => {
          updateCalls.push(input);
          expect(current).not.toBeNull();
          current = cloneDirtyConnectionRecord({
            ...(current as DirtyConnectionRecord),
            ...input.data,
            updatedAt: new Date("2026-03-26T12:01:00.000Z"),
          });
          return cloneDirtyConnectionRecord(current);
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: prisma as never,
    });

    await store.upsertDirtyConnection({
      connectionId: existing.connectionId,
      dirtyAt: "2026-03-26T12:00:00.000Z",
      eventType: "session.deleted",
      provider: "junction",
      resourceCategory: "session",
      resources: [
        {
          count: 1,
          jobKind: "delete",
          payload: {
            objectId: "session-42",
            sourceEventType: "session.deleted",
          },
          resource: null,
          resourceCategory: null,
          sourceProviderSlug: "garmin",
          windowEnd: "2026-03-26T00:00:00.000Z",
          windowStart: "2026-03-25T00:00:00.000Z",
        },
      ],
      traceId: "trace_123",
      userId: existing.userId,
    });

    const result = await store.upsertDirtyConnection({
      connectionId: existing.connectionId,
      dirtyAt: "2026-03-26T12:01:00.000Z",
      eventType: "session.deleted",
      provider: "junction",
      resourceCategory: "session",
      resources: [
        {
          count: 1,
          jobKind: "delete",
          payload: {
            objectId: "session-42",
            sourceEventType: "session.deleted",
          },
          resource: null,
          resourceCategory: null,
          sourceProviderSlug: "garmin",
          windowEnd: "2026-03-27T00:00:00.000Z",
          windowStart: "2026-03-24T00:00:00.000Z",
        },
        {
          count: 1,
          jobKind: "delete",
          payload: {
            accessToken: "drop-this-token",
            note: "x".repeat(700),
            objectId: "session-99",
            sourceEventType: "session.deleted",
          },
          resource: null,
          resourceCategory: null,
          sourceProviderSlug: "garmin",
          windowEnd: "2026-03-27T00:00:00.000Z",
          windowStart: "2026-03-24T00:00:00.000Z",
        },
      ],
      traceId: "trace_456",
      userId: existing.userId,
    });

    expect(createCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
    const dirtyResources = Object.values(result.dirty.dirtyResources)
      .sort((left, right) =>
        String(left.payload?.objectId).localeCompare(String(right.payload?.objectId))
      );

    expect(dirtyResources).toHaveLength(2);
    expect(dirtyResources[0]).toMatchObject({
      count: 2,
      jobKind: "delete",
      payload: {
        objectId: "session-42",
        sourceEventType: "session.deleted",
        windowEnd: "2026-03-27T00:00:00.000Z",
        windowStart: "2026-03-24T00:00:00.000Z",
      },
      resource: null,
      resourceCategory: null,
      sourceProviderSlug: "garmin",
      windowEnd: "2026-03-27T00:00:00.000Z",
      windowStart: "2026-03-24T00:00:00.000Z",
    });
    expect(dirtyResources[1]).toMatchObject({
      count: 1,
      jobKind: "delete",
      payload: {
        note: "x".repeat(512),
        objectId: "session-99",
        sourceEventType: "session.deleted",
        windowEnd: "2026-03-27T00:00:00.000Z",
        windowStart: "2026-03-24T00:00:00.000Z",
      },
      resource: null,
      resourceCategory: null,
      sourceProviderSlug: "garmin",
    });
    expect(dirtyResources.map((resource) => resource.payload?.objectId)).toEqual([
      "session-42",
      "session-99",
    ]);
    expect(JSON.stringify(dirtyResources)).not.toContain("drop-this-token");
    expect(dirtyResources[1]?.payload?.note).toHaveLength(512);
    expect(dirtyResources.some((resource) => resource.resource === "delete")).toBe(false);
    expect(dirtyResources.some((resource) => resource.resourceCategory === "delete")).toBe(false);
  });
});

function buildDirtyConnectionRecord(
  overrides: Partial<Pick<DirtyConnectionRecord, "dirtyRevision" | "processedRevision">> = {},
): DirtyConnectionRecord {
  return {
    connectionId: "dsc_123",
    createdAt: new Date("2026-03-26T11:00:00.000Z"),
    dirtyResourcesJson: {
      "garmin:timeseries:steps": {
        count: 3,
        jobKind: "resource",
        resource: "steps",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        windowEnd: "2026-03-26T00:00:00.000Z",
        windowStart: "2026-03-25T00:00:00.000Z",
      },
    },
    dirtyRevision: overrides.dirtyRevision ?? 1n,
    eventCount: 3n,
    firstDirtyAt: new Date("2026-03-26T11:59:00.000Z"),
    latestDirtyAt: new Date("2026-03-26T12:00:00.000Z"),
    latestEventType: "timeseries.updated",
    latestResourceCategory: "timeseries",
    latestTraceId: "trace_123",
    processedRevision: overrides.processedRevision ?? 0n,
    provider: "junction",
    resourceCategoryCountsJson: {
      timeseries: 3,
    },
    sourceProviderCountsJson: {
      garmin: 3,
    },
    updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    userId: "user-123",
    windowEnd: new Date("2026-03-26T00:00:00.000Z"),
    windowStart: new Date("2026-03-25T00:00:00.000Z"),
  };
}

function cloneDirtyConnectionRecord(record: DirtyConnectionRecord): DirtyConnectionRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    dirtyResourcesJson: record.dirtyResourcesJson ? structuredClone(record.dirtyResourcesJson) : null,
    firstDirtyAt: new Date(record.firstDirtyAt),
    latestDirtyAt: new Date(record.latestDirtyAt),
    resourceCategoryCountsJson: record.resourceCategoryCountsJson
      ? { ...record.resourceCategoryCountsJson }
      : null,
    sourceProviderCountsJson: record.sourceProviderCountsJson
      ? { ...record.sourceProviderCountsJson }
      : null,
    updatedAt: new Date(record.updatedAt),
    windowEnd: record.windowEnd ? new Date(record.windowEnd) : null,
    windowStart: record.windowStart ? new Date(record.windowStart) : null,
  };
}
