import { describe, expect, it, vi } from "vitest";

const sealState = vi.hoisted(() => ({
  active: 0,
  calls: 0,
  failAtCall: null as number | null,
  insideTransaction: false,
  maxActive: 0,
  prepareInsideTransaction: [] as boolean[],
  revalidateInsideTransaction: [] as boolean[],
  sealInsideTransaction: [] as boolean[],
}));

vi.mock("@/src/lib/device-sync/prisma-store/dirty-payloads", () => {
  const seal = vi.fn(async () => {
    sealState.active += 1;
    sealState.calls += 1;
    const callNumber = sealState.calls;
    sealState.maxActive = Math.max(sealState.maxActive, sealState.active);
    sealState.sealInsideTransaction.push(sealState.insideTransaction);

    if (sealState.failAtCall === callNumber) {
      sealState.active -= 1;
      throw new Error("preseal failed");
    }

    await Promise.resolve();

    sealState.active -= 1;
    return `sealed-payload-${callNumber}`;
  });

  return {
    prepareHostedDeviceSyncDirtyPayloadCrypto: vi.fn(async (input: { userId: string }) => {
      sealState.prepareInsideTransaction.push(sealState.insideTransaction);
      return {
        domain: "device-sync-payload",
        rootKeyId: "prepared-root-test",
        userId: input.userId,
      };
    }),
    revalidatePreparedHostedDeviceSyncDirtyPayloadCryptoTx: vi.fn(async () => {
      sealState.revalidateInsideTransaction.push(sealState.insideTransaction);
    }),
    sealHostedDeviceSyncDirtyPayloadJson: seal,
    sealHostedDeviceSyncDirtyPayloadJsonFromPreparedCrypto: seal,
  };
});

describe("PrismaHostedDirtyConnectionStore dirty payload preseal concurrency", () => {
  function resetSealState(): void {
    sealState.active = 0;
    sealState.calls = 0;
    sealState.failAtCall = null;
    sealState.insideTransaction = false;
    sealState.maxActive = 0;
    sealState.prepareInsideTransaction = [];
    sealState.revalidateInsideTransaction = [];
    sealState.sealInsideTransaction = [];
  }

  async function importStore() {
    return import("@/src/lib/device-sync/prisma-store/dirty-connections");
  }

  function createPrismaStub() {
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
          if (findCount <= 2 || !createData) {
            return null;
          }

          const dirtyAt = createData.latestDirtyAt as Date;
          return {
            connectionId: createData.connectionId,
            createdAt: dirtyAt,
            dirtyResourcesJson: createData.dirtyResourcesJson,
            dirtyRevision: createData.dirtyRevision,
            eventCount: createData.eventCount,
            firstDirtyAt: createData.firstDirtyAt,
            latestDirtyAt: createData.latestDirtyAt,
            latestEventType: createData.latestEventType,
            latestResourceCategory: createData.latestResourceCategory,
            latestTraceId: createData.latestTraceId,
            processedRevision: createData.processedRevision,
            provider: createData.provider,
            resourceCategoryCountsJson: createData.resourceCategoryCountsJson,
            sourceProviderCountsJson: createData.sourceProviderCountsJson,
            updatedAt: dirtyAt,
            userId: createData.userId,
            windowEnd: createData.windowEnd,
            windowStart: createData.windowStart,
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

    return {
      prisma,
      readPayloadCreateData: () => payloadCreateData,
    };
  }

  function createDirtyResources(count: number) {
    return Array.from({ length: count }, (_value, index) => ({
      count: 1,
      jobKind: "resource",
      payload: {
        webhookDataJson: JSON.stringify({ index, source: "garmin" }),
      },
      resource: "steps",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowEnd: "2026-05-27T00:00:00.000Z",
      windowStart: "2026-05-26T00:00:00.000Z",
    }));
  }

  it("bounds store-owned dirty payload preseal fanout", async () => {
    resetSealState();

    const { PrismaHostedDirtyConnectionStore } = await importStore();
    const { prisma, readPayloadCreateData } = createPrismaStub();
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    await store.upsertDirtyConnection({
      connectionId: "dsc_preseal_bound_1",
      dirtyAt: "2026-05-26T12:00:00.000Z",
      eventType: "daily.data.steps.created",
      provider: "junction",
      resourceCategory: "timeseries",
      resources: createDirtyResources(20),
      traceId: "trace_preseal_bound_1",
      userId: "member_preseal_bound_1",
    });

    expect(sealState.calls).toBe(20);
    expect(sealState.maxActive).toBe(16);
    expect(readPayloadCreateData()).toHaveLength(20);
  });

  it("stops claiming new preseal work after in-flight failures settle", async () => {
    resetSealState();
    sealState.failAtCall = 3;

    const { PrismaHostedDirtyConnectionStore } = await importStore();
    const { prisma, readPayloadCreateData } = createPrismaStub();
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    await expect(store.upsertDirtyConnection({
      connectionId: "dsc_preseal_bound_2",
      dirtyAt: "2026-05-26T12:00:00.000Z",
      eventType: "daily.data.steps.created",
      provider: "junction",
      resourceCategory: "timeseries",
      resources: createDirtyResources(20),
      traceId: "trace_preseal_bound_2",
      userId: "member_preseal_bound_2",
    })).rejects.toThrow("preseal failed");
    await Promise.resolve();
    await Promise.resolve();

    expect(sealState.active).toBe(0);
    expect(sealState.calls).toBe(16);
    expect(readPayloadCreateData()).toBeNull();
  });

  it("prepares the provider-owned maximum webhook batch before the caller transaction", async () => {
    resetSealState();

    const { PrismaHostedDirtyConnectionStore } = await importStore();
    const { prisma, readPayloadCreateData } = createPrismaStub();
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);
    const input = {
      connectionId: "dsc_prepared_bound_1",
      dirtyAt: "2026-05-26T12:00:00.000Z",
      eventType: "provider.connection.updated",
      provider: "junction",
      resourceCategory: null,
      resources: createDirtyResources(2),
      traceId: "trace_prepared_bound_1",
      userId: "member_prepared_bound_1",
    } as const;

    const prepared = await store.prepareDirtyConnectionUpsert(input);
    sealState.insideTransaction = true;
    try {
      await store.upsertDirtyConnectionWithPreparedPlanTx({
        prepared,
        tx: prisma as never,
      });
    } finally {
      sealState.insideTransaction = false;
    }

    expect(sealState.prepareInsideTransaction).toEqual([false]);
    expect(sealState.sealInsideTransaction).toEqual([false, false]);
    expect(sealState.maxActive).toBe(2);
    expect(sealState.revalidateInsideTransaction).toEqual([true]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.deviceSyncDirtyConnection.findUnique).toHaveBeenCalledTimes(3);
    expect(prisma.deviceSyncDirtyConnection.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.deviceSyncDirtyPayload.createMany).toHaveBeenCalledTimes(1);
    expect(readPayloadCreateData()).toHaveLength(2);
  });
});
