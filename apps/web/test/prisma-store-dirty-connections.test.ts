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
    firstDirtyAt?: Date;
    processedRevision: bigint;
  };
  where: {
    connectionId: string;
  };
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
            firstDirtyAt: input.data.firstDirtyAt ?? current.firstDirtyAt,
            processedRevision: input.data.processedRevision,
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
    expect(result?.dirtyRevision).toBe(3n);
    expect(result?.processedRevision).toBe(3n);
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
