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
    dirtyRevision?: bigint;
    processedRevision?: bigint;
    userId?: string;
  };
};

type DirtyConnectionCreateMany = {
  data: Omit<DirtyConnectionRecord, "createdAt" | "updatedAt">;
  skipDuplicates?: boolean;
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
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        findFirst: vi.fn(async () => cloneDirtyConnectionRecord(current)),
        updateMany: vi.fn(async (input: DirtyConnectionUpdate) => {
          updateCalls.push(input);
          if (
            input.where.connectionId !== current.connectionId ||
            input.where.dirtyRevision !== current.dirtyRevision ||
            input.where.processedRevision !== current.processedRevision ||
            input.where.userId !== current.userId
          ) {
            return { count: 0 };
          }
          current = cloneDirtyConnectionRecord({
            ...current,
            ...input.data,
          });
          return { count: 1 };
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
    const createCalls: DirtyConnectionCreateMany[] = [];
    const updateCalls: DirtyConnectionUpdate[] = [];
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        createMany: vi.fn(async (input: DirtyConnectionCreateMany) => {
          createCalls.push(input);
          if (current) {
            return { count: 0 };
          }
          current = cloneDirtyConnectionRecord({
            ...input.data,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
          });
          return { count: 1 };
        }),
        findUnique: vi.fn(async () => current ? cloneDirtyConnectionRecord(current) : null),
        updateMany: vi.fn(async (input: DirtyConnectionUpdate) => {
          updateCalls.push(input);
          if (!current) {
            return { count: 0 };
          }
          if (
            input.where.connectionId !== current.connectionId ||
            input.where.dirtyRevision !== current.dirtyRevision ||
            input.where.processedRevision !== current.processedRevision
          ) {
            return { count: 0 };
          }
          current = cloneDirtyConnectionRecord({
            ...(current as DirtyConnectionRecord),
            ...input.data,
            updatedAt: new Date("2026-03-26T12:01:00.000Z"),
          });
          return { count: 1 };
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

  it("retries dirty writes when another writer advances the dirty revision first", async () => {
    let current = buildDirtyConnectionRecord({
      dirtyRevision: 1n,
      processedRevision: 0n,
    });
    let simulateConcurrentWrite = true;
    const updateCalls: DirtyConnectionUpdate[] = [];
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        createMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => cloneDirtyConnectionRecord(current)),
        updateMany: vi.fn(async (input: DirtyConnectionUpdate) => {
          updateCalls.push(input);
          if (simulateConcurrentWrite) {
            simulateConcurrentWrite = false;
            current = cloneDirtyConnectionRecord({
              ...current,
              dirtyRevision: current.dirtyRevision + 1n,
              eventCount: current.eventCount + 1n,
              latestTraceId: "trace_concurrent",
            });
            return { count: 0 };
          }
          if (
            input.where.connectionId !== current.connectionId ||
            input.where.dirtyRevision !== current.dirtyRevision ||
            input.where.processedRevision !== current.processedRevision
          ) {
            return { count: 0 };
          }
          current = cloneDirtyConnectionRecord({
            ...current,
            ...input.data,
          });
          return { count: 1 };
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: prisma as never,
    });

    const result = await store.upsertDirtyConnection({
      connectionId: current.connectionId,
      dirtyAt: "2026-03-26T12:02:00.000Z",
      eventType: "workout.updated",
      provider: "junction",
      resourceCategory: "workout",
      traceId: "trace_after_retry",
      userId: current.userId,
    });

    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]?.where.dirtyRevision).toBe(1n);
    expect(updateCalls[1]?.where.dirtyRevision).toBe(2n);
    expect(result.dirty.dirtyRevision).toBe(3n);
    expect(result.dirty.latestTraceId).toBe("trace_after_retry");
  });

  it("retries dirty writes after createMany skipDuplicates loses an insert race", async () => {
    let current: DirtyConnectionRecord | null = null;
    const createdByOtherWriter = buildDirtyConnectionRecord({
      dirtyRevision: 1n,
      processedRevision: 0n,
    });
    const createCalls: DirtyConnectionCreateMany[] = [];
    const updateCalls: DirtyConnectionUpdate[] = [];
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        createMany: vi.fn(async (input: DirtyConnectionCreateMany) => {
          createCalls.push(input);
          current = cloneDirtyConnectionRecord(createdByOtherWriter);
          return { count: 0 };
        }),
        findUnique: vi.fn(async () => current ? cloneDirtyConnectionRecord(current) : null),
        updateMany: vi.fn(async (input: DirtyConnectionUpdate) => {
          updateCalls.push(input);
          if (!current) {
            return { count: 0 };
          }
          if (
            input.where.connectionId !== current.connectionId ||
            input.where.dirtyRevision !== current.dirtyRevision ||
            input.where.processedRevision !== current.processedRevision
          ) {
            return { count: 0 };
          }
          current = cloneDirtyConnectionRecord({
            ...current,
            ...input.data,
          });
          return { count: 1 };
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: prisma as never,
    });

    const result = await store.upsertDirtyConnection({
      connectionId: createdByOtherWriter.connectionId,
      dirtyAt: "2026-03-26T12:02:00.000Z",
      eventType: "workout.updated",
      provider: "junction",
      resourceCategory: "workout",
      traceId: "trace_after_create_race",
      userId: createdByOtherWriter.userId,
    });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.skipDuplicates).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.where.dirtyRevision).toBe(1n);
    expect(updateCalls[0]?.where.processedRevision).toBe(0n);
    expect(result.shouldRequestWake).toBe(false);
    expect(result.dirty.dirtyRevision).toBe(2n);
    expect(result.dirty.latestTraceId).toBe("trace_after_create_race");
  });

  it("fails dirty writes after bounded optimistic retries are exhausted", async () => {
    let current = buildDirtyConnectionRecord({
      dirtyRevision: 1n,
      processedRevision: 0n,
    });
    const updateCalls: DirtyConnectionUpdate[] = [];
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        createMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => cloneDirtyConnectionRecord(current)),
        updateMany: vi.fn(async (input: DirtyConnectionUpdate) => {
          updateCalls.push(input);
          current = cloneDirtyConnectionRecord({
            ...current,
            dirtyRevision: current.dirtyRevision + 1n,
          });
          return { count: 0 };
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: prisma as never,
    });

    await expect(store.upsertDirtyConnection({
      connectionId: current.connectionId,
      dirtyAt: "2026-03-26T12:02:00.000Z",
      eventType: "workout.updated",
      provider: "junction",
      resourceCategory: "workout",
      traceId: "trace_retry_exhausted",
      userId: current.userId,
    })).rejects.toMatchObject({
      code: "HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION",
      httpStatus: 503,
      retryable: true,
    });

    expect(updateCalls).toHaveLength(12);
    expect(updateCalls.map((call) => call.where.dirtyRevision)).toEqual([
      1n,
      2n,
      3n,
      4n,
      5n,
      6n,
      7n,
      8n,
      9n,
      10n,
      11n,
      12n,
    ]);
  });

  it("retries processed markers when a dirty write races ahead", async () => {
    let current = buildDirtyConnectionRecord({
      dirtyRevision: 3n,
      processedRevision: 0n,
    });
    let simulateConcurrentWrite = true;
    const updateCalls: DirtyConnectionUpdate[] = [];
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        findFirst: vi.fn(async () => cloneDirtyConnectionRecord(current)),
        updateMany: vi.fn(async (input: DirtyConnectionUpdate) => {
          updateCalls.push(input);
          if (simulateConcurrentWrite) {
            simulateConcurrentWrite = false;
            current = cloneDirtyConnectionRecord({
              ...current,
              dirtyRevision: current.dirtyRevision + 1n,
              eventCount: current.eventCount + 1n,
            });
            return { count: 0 };
          }
          if (
            input.where.connectionId !== current.connectionId ||
            input.where.dirtyRevision !== current.dirtyRevision ||
            input.where.processedRevision !== current.processedRevision ||
            input.where.userId !== current.userId
          ) {
            return { count: 0 };
          }
          current = cloneDirtyConnectionRecord({
            ...current,
            ...input.data,
          });
          return { count: 1 };
        }),
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: prisma as never,
    });

    const result = await store.markDirtyConnectionProcessed({
      connectionId: current.connectionId,
      processedRevision: 3n,
      userId: current.userId,
    });

    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]?.where.dirtyRevision).toBe(3n);
    expect(updateCalls[1]?.where.dirtyRevision).toBe(4n);
    expect(result?.dirtyRevision).toBe(4n);
    expect(result?.processedRevision).toBe(3n);
    expect(result?.dirtyResources).not.toEqual({});
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
