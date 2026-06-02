import { describe, expect, it, vi } from "vitest";

import { PrismaHostedDirtyConnectionStore } from "@/src/lib/device-sync/prisma-store/dirty-connections";
import { sealHostedDeviceSyncDirtyPayloadJson } from "@/src/lib/device-sync/prisma-store/dirty-payloads";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";

describe("PrismaHostedDirtyConnectionStore dirty pending state", () => {
  it("preseals dirty payload rows before opening store-owned transactions", async () => {
    let insideTransaction = false;
    const encryptInsideTransaction: boolean[] = [];
    installHostedSecureBoxStringTestCodec(() => {
      encryptInsideTransaction.push(insideTransaction);
    });

    try {
      let createData: Record<string, unknown> | null = null;
      let payloadCreateData: Array<Record<string, unknown>> | null = null;
      let findCount = 0;
      const prisma = {
        $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
          insideTransaction = true;
          try {
            return await callback(prisma);
          } finally {
            insideTransaction = false;
          }
        }),
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

      const result = await store.upsertDirtyConnection({
        connectionId: "dsc_preseal_1",
        dirtyAt: "2026-05-26T12:00:00.000Z",
        eventType: "daily.data.steps.created",
        provider: "junction",
        resourceCategory: "timeseries",
        resources: [
          {
            count: 1,
            jobKind: "resource",
            payload: {
              webhookDataJson: JSON.stringify({ source: "garmin", value: 123 }),
            },
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
            windowEnd: "2026-05-27T00:00:00.000Z",
            windowStart: "2026-05-26T00:00:00.000Z",
          },
        ],
        traceId: "trace_preseal_1",
        userId: "member_preseal_1",
      });

      expect(encryptInsideTransaction).toEqual([false]);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.deviceSyncDirtyConnection.findUnique).toHaveBeenCalledTimes(3);
      expect(prisma.deviceSyncDirtyPayload.createMany).toHaveBeenCalledTimes(1);
      const payloadRow = expectFirstPayloadCreateRow(payloadCreateData);
      expect(payloadRow.resourceEncrypted).toMatch(/^hsb-test:/u);
      expect(Object.values(result.dirty.dirtyResources)[0]?.dirtyPayloadId)
        .toBe(payloadRow.id);
    } finally {
      installHostedSecureBoxStringTestCodec();
    }
  });

  it("seals through caller-owned dirty transactions instead of precomputing on the root client", async () => {
    let insideCallerOwnedTransaction = false;
    const encryptInsideCallerOwnedTransaction: boolean[] = [];
    installHostedSecureBoxStringTestCodec(() => {
      encryptInsideCallerOwnedTransaction.push(insideCallerOwnedTransaction);
    });

    try {
      const rootPrisma = {
        $transaction: vi.fn(),
        deviceSyncDirtyConnection: {
          findUnique: vi.fn(async () => {
            throw new Error("Root Prisma client should not precompute caller-owned dirty payload rows.");
          }),
        },
      };
      let createData: Record<string, unknown> | null = null;
      let payloadCreateData: Array<Record<string, unknown>> | null = null;
      let findCount = 0;
      const tx = {
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
      const store = new PrismaHostedDirtyConnectionStore(rootPrisma as never);

      insideCallerOwnedTransaction = true;
      const result = await store.upsertDirtyConnection({
        connectionId: "dsc_caller_owned_1",
        dirtyAt: "2026-05-26T12:00:00.000Z",
        eventType: "daily.data.steps.created",
        provider: "junction",
        resourceCategory: "timeseries",
        resources: [
          {
            count: 1,
            jobKind: "resource",
            payload: {
              webhookDataJson: JSON.stringify({ source: "garmin", value: 456 }),
            },
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
            windowEnd: "2026-05-27T00:00:00.000Z",
            windowStart: "2026-05-26T00:00:00.000Z",
          },
        ],
        traceId: "trace_caller_owned_1",
        tx: tx as never,
        userId: "member_caller_owned_1",
      });
      insideCallerOwnedTransaction = false;

      expect(encryptInsideCallerOwnedTransaction).toEqual([true]);
      expect(rootPrisma.$transaction).not.toHaveBeenCalled();
      expect(rootPrisma.deviceSyncDirtyConnection.findUnique).not.toHaveBeenCalled();
      expect(tx.deviceSyncDirtyPayload.createMany).toHaveBeenCalledTimes(1);
      const payloadRow = expectFirstPayloadCreateRow(payloadCreateData);
      expect(Object.values(result.dirty.dirtyResources)[0]?.dirtyPayloadId)
        .toBe(payloadRow.id);
    } finally {
      insideCallerOwnedTransaction = false;
      installHostedSecureBoxStringTestCodec();
    }
  });

  it("recomputes store-owned dirty payload rows after a stale preseal revision contention", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout")
      .mockImplementation((callback: TimerHandler) => {
        if (typeof callback === "function") {
          callback();
        }
        return 0 as never;
      });
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const rootFindUnique = vi.fn()
      .mockResolvedValueOnce({
        connectionId: "dsc_preseal_retry_1",
        createdAt: dirtyAt,
        dirtyResourcesJson: {},
        dirtyRevision: 2n,
        eventCount: 2n,
        firstDirtyAt: dirtyAt,
        latestDirtyAt: dirtyAt,
        latestEventType: "daily.data.steps.created",
        latestResourceCategory: "timeseries",
        latestTraceId: "trace_previous",
        processedRevision: 2n,
        provider: "junction",
        resourceCategoryCountsJson: {},
        sourceProviderCountsJson: {},
        updatedAt: dirtyAt,
        userId: "member_preseal_retry_1",
        windowEnd: null,
        windowStart: null,
      })
      .mockResolvedValueOnce({
        connectionId: "dsc_preseal_retry_1",
        createdAt: dirtyAt,
        dirtyResourcesJson: {},
        dirtyRevision: 3n,
        eventCount: 3n,
        firstDirtyAt: dirtyAt,
        latestDirtyAt: dirtyAt,
        latestEventType: "daily.data.steps.created",
        latestResourceCategory: "timeseries",
        latestTraceId: "trace_concurrent",
        processedRevision: 3n,
        provider: "junction",
        resourceCategoryCountsJson: {},
        sourceProviderCountsJson: {},
        updatedAt: dirtyAt,
        userId: "member_preseal_retry_1",
        windowEnd: null,
        windowStart: null,
      });
    let payloadCreateData: Array<Record<string, unknown>> | null = null;
    const tx = {
      deviceSyncDirtyConnection: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            connectionId: "dsc_preseal_retry_1",
            createdAt: dirtyAt,
            dirtyResourcesJson: {},
            dirtyRevision: 3n,
            eventCount: 3n,
            firstDirtyAt: dirtyAt,
            latestDirtyAt: dirtyAt,
            latestEventType: "daily.data.steps.created",
            latestResourceCategory: "timeseries",
            latestTraceId: "trace_concurrent",
            processedRevision: 3n,
            provider: "junction",
            resourceCategoryCountsJson: {},
            sourceProviderCountsJson: {},
            updatedAt: dirtyAt,
            userId: "member_preseal_retry_1",
            windowEnd: null,
            windowStart: null,
          })
          .mockResolvedValueOnce({
            connectionId: "dsc_preseal_retry_1",
            createdAt: dirtyAt,
            dirtyResourcesJson: {},
            dirtyRevision: 3n,
            eventCount: 3n,
            firstDirtyAt: dirtyAt,
            latestDirtyAt: dirtyAt,
            latestEventType: "daily.data.steps.created",
            latestResourceCategory: "timeseries",
            latestTraceId: "trace_concurrent",
            processedRevision: 3n,
            provider: "junction",
            resourceCategoryCountsJson: {},
            sourceProviderCountsJson: {},
            updatedAt: dirtyAt,
            userId: "member_preseal_retry_1",
            windowEnd: null,
            windowStart: null,
          })
          .mockResolvedValueOnce({
            connectionId: "dsc_preseal_retry_1",
            createdAt: dirtyAt,
            dirtyResourcesJson: {},
            dirtyRevision: 4n,
            eventCount: 4n,
            firstDirtyAt: dirtyAt,
            latestDirtyAt: new Date("2026-05-26T12:01:00.000Z"),
            latestEventType: "daily.data.steps.created",
            latestResourceCategory: "timeseries",
            latestTraceId: "trace_preseal_retry_1",
            processedRevision: 3n,
            provider: "junction",
            resourceCategoryCountsJson: { timeseries: 1 },
            sourceProviderCountsJson: { garmin: 1 },
            updatedAt: new Date("2026-05-26T12:01:00.000Z"),
            userId: "member_preseal_retry_1",
            windowEnd: new Date("2026-05-27T00:00:00.000Z"),
            windowStart: new Date("2026-05-26T00:00:00.000Z"),
          }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      deviceSyncDirtyPayload: {
        createMany: vi.fn(async (input: { data: Array<Record<string, unknown>> }) => {
          payloadCreateData = input.data;
          return { count: input.data.length };
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (txInput: unknown) => Promise<unknown>) =>
        callback(tx),
      ),
      deviceSyncDirtyConnection: {
        findUnique: rootFindUnique,
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    try {
      const result = await store.upsertDirtyConnection({
        connectionId: "dsc_preseal_retry_1",
        dirtyAt: "2026-05-26T12:01:00.000Z",
        eventType: "daily.data.steps.created",
        provider: "junction",
        resourceCategory: "timeseries",
        resources: [
          {
            count: 1,
            jobKind: "resource",
            payload: {
              webhookDataJson: JSON.stringify({ source: "garmin", value: 789 }),
            },
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
            windowEnd: "2026-05-27T00:00:00.000Z",
            windowStart: "2026-05-26T00:00:00.000Z",
          },
        ],
        traceId: "trace_preseal_retry_1",
        userId: "member_preseal_retry_1",
      });

      expect(rootFindUnique).toHaveBeenCalledTimes(2);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(tx.deviceSyncDirtyConnection.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.deviceSyncDirtyPayload.createMany).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      const payloadRow = expectFirstPayloadCreateRow(payloadCreateData);
      expect(payloadRow.dirtyRevision).toBe(4n);
      expect(Object.values(result.dirty.dirtyResources)[0]?.dirtyPayloadId)
        .toBe(payloadRow.id);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("moves Junction webhook payload JSON out of the compact dirty row while preserving the runtime resource", async () => {
    installHostedSecureBoxStringTestCodec();
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

  it("omits oversized direct webhook JSON instead of truncating it", async () => {
    installHostedSecureBoxStringTestCodec();
    let payloadCreateData: Array<Record<string, unknown>> | null = null;
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        createMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async () => ({
          connectionId: "dsc_junction_oversized",
          userId: "member_123",
          provider: "junction",
          dirtyRevision: 1n,
          processedRevision: 0n,
          firstDirtyAt: dirtyAt,
          latestDirtyAt: dirtyAt,
          windowStart: new Date("2026-05-26T00:00:00.000Z"),
          windowEnd: new Date("2026-05-27T00:00:00.000Z"),
          eventCount: 1n,
          latestTraceId: "trace_junction_oversized",
          latestEventType: "daily.data.steps.created",
          latestResourceCategory: "timeseries",
          sourceProviderCountsJson: { garmin: 1 },
          resourceCategoryCountsJson: { timeseries: 1 },
          dirtyResourcesJson: {},
          createdAt: dirtyAt,
          updatedAt: dirtyAt,
        })),
      },
      deviceSyncDirtyPayload: {
        createMany: vi.fn(async (input: { data: Array<Record<string, unknown>> }) => {
          payloadCreateData = input.data;
          return { count: input.data.length };
        }),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);
    const oversizedWebhookDataJson = JSON.stringify({
      data: "x".repeat(64_001),
      sourceProviderSlug: "garmin",
    });

    const result = await store.upsertDirtyConnection({
      connectionId: "dsc_junction_oversized",
      dirtyAt: "2026-05-26T12:00:00.000Z",
      eventType: "daily.data.steps.created",
      provider: "junction",
      resourceCategory: "timeseries",
      resources: [
        {
          count: 1,
          jobKind: "resource",
          payload: {
            ordinary: "kept",
            webhookDataJson: oversizedWebhookDataJson,
          },
          resource: "steps",
          resourceCategory: "timeseries",
          sourceProviderSlug: "garmin",
          windowEnd: "2026-05-27T00:00:00.000Z",
          windowStart: "2026-05-26T00:00:00.000Z",
        },
      ],
      traceId: "trace_junction_oversized",
      userId: "member_123",
    });

    const dirtyResource = Object.values(result.dirty.dirtyResources)[0];
    const payloadRow = expectFirstPayloadCreateRow(payloadCreateData);

    expect(dirtyResource?.payload?.ordinary).toBe("kept");
    expect(dirtyResource?.payload).not.toHaveProperty("webhookDataJson");
    expect(String(payloadRow.resourceEncrypted ?? ""))
      .not.toContain(oversizedWebhookDataJson.slice(0, 256));
    expect(prisma.deviceSyncDirtyPayload.createMany).toHaveBeenCalledTimes(1);
  });

  it("keeps payload-only oversized direct webhook work in durable payload rows", async () => {
    installHostedSecureBoxStringTestCodec();
    let payloadCreateData: Array<Record<string, unknown>> | null = null;
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        createMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async () => ({
          connectionId: "dsc_junction_oversized_payload_only",
          userId: "member_123",
          provider: "junction",
          dirtyRevision: 1n,
          processedRevision: 0n,
          firstDirtyAt: dirtyAt,
          latestDirtyAt: dirtyAt,
          windowStart: new Date("2026-05-26T00:00:00.000Z"),
          windowEnd: new Date("2026-05-27T00:00:00.000Z"),
          eventCount: 1n,
          latestTraceId: "trace_junction_oversized_payload_only",
          latestEventType: "daily.data.steps.created",
          latestResourceCategory: "timeseries",
          sourceProviderCountsJson: { garmin: 1 },
          resourceCategoryCountsJson: { timeseries: 1 },
          dirtyResourcesJson: {},
          createdAt: dirtyAt,
          updatedAt: dirtyAt,
        })),
      },
      deviceSyncDirtyPayload: {
        createMany: vi.fn(async (input: { data: Array<Record<string, unknown>> }) => {
          payloadCreateData = input.data;
          return { count: input.data.length };
        }),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);
    const oversizedWebhookDataJson = JSON.stringify({
      data: "x".repeat(64_001),
      sourceProviderSlug: "garmin",
    });

    const result = await store.upsertDirtyConnection({
      connectionId: "dsc_junction_oversized_payload_only",
      dirtyAt: "2026-05-26T12:00:00.000Z",
      eventType: "daily.data.steps.created",
      provider: "junction",
      resourceCategory: "timeseries",
      resources: [
        {
          count: 1,
          jobKind: "resource",
          payload: {
            webhookDataJson: oversizedWebhookDataJson,
          },
          resource: "steps",
          resourceCategory: "timeseries",
          sourceProviderSlug: "garmin",
          windowEnd: "2026-05-27T00:00:00.000Z",
          windowStart: "2026-05-26T00:00:00.000Z",
        },
      ],
      traceId: "trace_junction_oversized_payload_only",
      userId: "member_123",
    });

    const dirtyResource = Object.values(result.dirty.dirtyResources)[0];
    const payloadRow = expectFirstPayloadCreateRow(payloadCreateData);

    expect(dirtyResource?.dirtyPayloadId).toBe(payloadRow.id);
    expect(dirtyResource?.payload).toBeUndefined();
    expect(String(payloadRow.resourceEncrypted ?? ""))
      .not.toContain(oversizedWebhookDataJson.slice(0, 256));
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

  it("keeps acknowledged dirty revisions pending while durable payload rows remain", async () => {
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const webhookDataJson = JSON.stringify({ sampleCount: 1, source: "garmin" });
    const payloadResource = {
      count: 1,
      dirtyPayloadId: "dsp_payload_embedded_id_should_not_win",
      jobKind: "resource",
      payload: {
        webhookDataJson,
      },
      resource: "steps",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowEnd: "2026-05-26T12:10:00.000Z",
      windowStart: "2026-05-26T12:00:00.000Z",
    };
    const payloadRowId = "dsp_payload_pending_after_revision_ack";
    const resourceEncrypted = await sealHostedDeviceSyncDirtyPayloadJson({
      connectionId: "dsc_junction_revision_ack",
      dirtyRevision: 4n,
      payloadId: payloadRowId,
      provider: "junction",
      userId: "member_123",
      value: payloadResource,
    });
    const queryCalls: unknown[] = [];
    const prisma = {
      $queryRaw: vi.fn(async (query: unknown) => {
        queryCalls.push(query);
        return [{ connection_id: "dsc_junction_revision_ack" }];
      }),
      deviceSyncDirtyConnection: {
        findMany: vi.fn(async () => [
          {
            connectionId: "dsc_junction_revision_ack",
            createdAt: dirtyAt,
            dirtyResourcesJson: {},
            dirtyRevision: 4n,
            eventCount: 4n,
            firstDirtyAt: dirtyAt,
            latestDirtyAt: dirtyAt,
            latestEventType: "daily.data.steps.created",
            latestResourceCategory: "timeseries",
            latestTraceId: "trace_revision_ack",
            processedRevision: 4n,
            provider: "junction",
            resourceCategoryCountsJson: {},
            sourceProviderCountsJson: {},
            updatedAt: dirtyAt,
            userId: "member_123",
            windowEnd: null,
            windowStart: null,
          },
        ]),
      },
      deviceSyncDirtyPayload: {
        findMany: vi.fn(async () => [
          {
            connectionId: "dsc_junction_revision_ack",
            dirtyRevision: 4n,
            id: payloadRowId,
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

    expect(result.items[0]).toMatchObject({
      connectionId: "dsc_junction_revision_ack",
      dirtyRevision: 4n,
      processedRevision: 4n,
    });
    const dirtyResource = Object.values(result.items[0]?.dirtyResources ?? {})[0];
    expect(dirtyResource?.dirtyPayloadId).toBe(payloadRowId);
    expect(dirtyResource?.payload?.webhookDataJson).toBe(webhookDataJson);
    const query = queryCalls[0] as {
      text: string;
    };
    expect(query.text).toMatch(
      /and\s*\(\s*"dirty_revision"\s*>\s*"processed_revision"\s*or\s+exists\s*\(/su,
    );
    expect(query.text).toContain(
      '"payload"."connection_id" = "device_sync_dirty_connection"."connection_id"',
    );
    expect(query.text).toContain(
      '"payload"."user_id" = "device_sync_dirty_connection"."user_id"',
    );
  });

  it("uses staged dirty acks as a read overlay without deleting pending payload rows", async () => {
    installHostedSecureBoxStringTestCodec();
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const acceptedPayloadId = "dsp_payload_staged_accepted";
    const remainingPayloadId = "dsp_payload_staged_remaining";
    const compactResource = {
      count: 1,
      jobKind: "resource",
      payload: undefined,
      resource: "sleep",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      windowEnd: "2026-05-26T12:10:00.000Z",
      windowStart: "2026-05-26T12:00:00.000Z",
    };
    const remainingPayloadResource = {
      count: 1,
      jobKind: "resource",
      payload: {
        webhookDataJson: JSON.stringify({ sampleCount: 1, source: "garmin" }),
      },
      resource: "steps",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowEnd: "2026-05-26T12:20:00.000Z",
      windowStart: "2026-05-26T12:10:00.000Z",
    };
    const remainingResourceEncrypted = await sealHostedDeviceSyncDirtyPayloadJson({
      connectionId: "dsc_junction_staged_overlay",
      dirtyRevision: 4n,
      payloadId: remainingPayloadId,
      provider: "junction",
      userId: "member_123",
      value: remainingPayloadResource,
    });
    const prisma = {
      $queryRaw: vi.fn(async () => [{ connection_id: "dsc_junction_staged_overlay" }]),
      deviceSyncDirtyConnection: {
        findMany: vi.fn(async () => [
          {
            connectionId: "dsc_junction_staged_overlay",
            createdAt: dirtyAt,
            dirtyResourcesJson: { compact: compactResource },
            dirtyRevision: 4n,
            eventCount: 4n,
            firstDirtyAt: dirtyAt,
            latestDirtyAt: dirtyAt,
            latestEventType: "daily.data.steps.created",
            latestResourceCategory: "timeseries",
            latestTraceId: "trace_staged_overlay",
            processedRevision: 3n,
            provider: "junction",
            resourceCategoryCountsJson: { summary: 1 },
            sourceProviderCountsJson: { garmin: 1 },
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
            connectionId: "dsc_junction_staged_overlay",
            dirtyRevision: 4n,
            id: remainingPayloadId,
            provider: "junction",
            resourceEncrypted: remainingResourceEncrypted,
          },
        ]),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    const result = await store.listPendingDirtyConnectionsForUser({
      limit: 10,
      stagedDirtyAcks: [
        {
          connectionId: "dsc_junction_staged_overlay",
          processedDirtyPayloadIds: [acceptedPayloadId],
          processedRevision: "4",
        },
      ],
      userId: "member_123",
    });

    expect(prisma.deviceSyncDirtyPayload.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: {
          notIn: [acceptedPayloadId],
        },
      }),
    }));
    expect(result.items[0]).toMatchObject({
      connectionId: "dsc_junction_staged_overlay",
      processedRevision: 4n,
    });
    const dirtyResources = Object.values(result.items[0]?.dirtyResources ?? {});
    expect(dirtyResources).toHaveLength(1);
    expect(dirtyResources[0]?.dirtyPayloadId).toBe(remainingPayloadId);
    expect(dirtyResources[0]?.resource).toBe("steps");
  });

  it("caps durable payload hydration per pending dirty connection", async () => {
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const firstPayloadId = "dsp_payload_cap_1";
    const secondPayloadId = "dsp_payload_cap_2";
    const firstPayloadResource = {
      count: 1,
      jobKind: "resource",
      payload: {
        webhookDataJson: JSON.stringify({ sampleCount: 1, source: "garmin" }),
      },
      resource: "steps",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowEnd: "2026-05-26T12:10:00.000Z",
      windowStart: "2026-05-26T12:00:00.000Z",
    };
    const secondPayloadResource = {
      count: 1,
      jobKind: "resource",
      payload: {
        webhookDataJson: JSON.stringify({ sampleCount: 1, source: "garmin" }),
      },
      resource: "heartrate",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowEnd: "2026-05-26T12:10:00.000Z",
      windowStart: "2026-05-26T12:00:00.000Z",
    };
    const firstResourceEncrypted = await sealHostedDeviceSyncDirtyPayloadJson({
      connectionId: "dsc_junction_cap_1",
      dirtyRevision: 2n,
      payloadId: firstPayloadId,
      provider: "junction",
      userId: "member_123",
      value: firstPayloadResource,
    });
    const secondResourceEncrypted = await sealHostedDeviceSyncDirtyPayloadJson({
      connectionId: "dsc_junction_cap_2",
      dirtyRevision: 4n,
      payloadId: secondPayloadId,
      provider: "junction",
      userId: "member_123",
      value: secondPayloadResource,
    });
    const dirtyRecords = [
      {
        connectionId: "dsc_junction_cap_1",
        createdAt: dirtyAt,
        dirtyResourcesJson: {},
        dirtyRevision: 2n,
        eventCount: 2n,
        firstDirtyAt: dirtyAt,
        latestDirtyAt: dirtyAt,
        latestEventType: "daily.data.steps.created",
        latestResourceCategory: "timeseries",
        latestTraceId: "trace_cap_1",
        processedRevision: 1n,
        provider: "junction",
        resourceCategoryCountsJson: { timeseries: 2 },
        sourceProviderCountsJson: { garmin: 2 },
        updatedAt: dirtyAt,
        userId: "member_123",
        windowEnd: new Date("2026-05-26T12:10:00.000Z"),
        windowStart: dirtyAt,
      },
      {
        connectionId: "dsc_junction_cap_2",
        createdAt: dirtyAt,
        dirtyResourcesJson: {},
        dirtyRevision: 4n,
        eventCount: 4n,
        firstDirtyAt: dirtyAt,
        latestDirtyAt: dirtyAt,
        latestEventType: "daily.data.heartrate.created",
        latestResourceCategory: "timeseries",
        latestTraceId: "trace_cap_2",
        processedRevision: 3n,
        provider: "junction",
        resourceCategoryCountsJson: { timeseries: 4 },
        sourceProviderCountsJson: { garmin: 4 },
        updatedAt: dirtyAt,
        userId: "member_123",
        windowEnd: new Date("2026-05-26T12:10:00.000Z"),
        windowStart: dirtyAt,
      },
    ];
    const prisma = {
      $queryRaw: vi.fn(async () => [
        { connection_id: "dsc_junction_cap_1" },
        { connection_id: "dsc_junction_cap_2" },
      ]),
      deviceSyncDirtyConnection: {
        findMany: vi.fn(async () => dirtyRecords),
      },
      deviceSyncDirtyPayload: {
        findMany: vi.fn(async (query: { where: { connectionId: string } }) => {
          if (query.where.connectionId === "dsc_junction_cap_1") {
            return [
              {
                connectionId: "dsc_junction_cap_1",
                dirtyRevision: 2n,
                id: firstPayloadId,
                provider: "junction",
                resourceEncrypted: firstResourceEncrypted,
              },
            ];
          }

          return [
            {
              connectionId: "dsc_junction_cap_2",
              dirtyRevision: 4n,
              id: secondPayloadId,
              provider: "junction",
              resourceEncrypted: secondResourceEncrypted,
            },
          ];
        }),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    const result = await store.listPendingDirtyConnectionsForUser({
      limit: 10,
      userId: "member_123",
    });

    expect(prisma.deviceSyncDirtyPayload.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.deviceSyncDirtyPayload.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      take: 501,
      where: {
        connectionId: "dsc_junction_cap_1",
        userId: "member_123",
      },
    }));
    expect(prisma.deviceSyncDirtyPayload.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      take: 501,
      where: {
        connectionId: "dsc_junction_cap_2",
        userId: "member_123",
      },
    }));
    expect(result.items.map((item) => Object.values(item.dirtyResources)[0]?.dirtyPayloadId))
      .toEqual([firstPayloadId, secondPayloadId]);
  });

  it("caps durable payload hydration across one pending dirty response", async () => {
    installHostedSecureBoxStringTestCodec();
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const connectionIds = [
      "dsc_junction_response_cap_1",
      "dsc_junction_response_cap_2",
      "dsc_junction_response_cap_3",
    ];
    const buildDirtyRecord = (connectionId: string, revision: bigint) => ({
      connectionId,
      createdAt: dirtyAt,
      dirtyResourcesJson: {},
      dirtyRevision: revision,
      eventCount: revision,
      firstDirtyAt: dirtyAt,
      latestDirtyAt: dirtyAt,
      latestEventType: "daily.data.steps.created",
      latestResourceCategory: "timeseries",
      latestTraceId: `trace_${connectionId}`,
      processedRevision: revision,
      provider: "junction",
      resourceCategoryCountsJson: { timeseries: Number(revision) },
      sourceProviderCountsJson: { garmin: Number(revision) },
      updatedAt: dirtyAt,
      userId: "member_123",
      windowEnd: new Date("2026-05-26T12:10:00.000Z"),
      windowStart: dirtyAt,
    });
    const payloadRowsByConnectionId = new Map<string, Array<{
      connectionId: string;
      dirtyRevision: bigint;
      id: string;
      provider: string;
      resourceEncrypted: string;
    }>>();

    for (const [connectionIndex, connectionId] of connectionIds.entries()) {
      const count = connectionIndex < 2 ? 500 : 1;
      const dirtyRevision = BigInt(connectionIndex + 1);
      const rows = [];
      for (let index = 0; index < count; index += 1) {
        const payloadId = `dsp_response_cap_${connectionIndex}_${index}`;
        rows.push({
          connectionId,
          dirtyRevision,
          id: payloadId,
          provider: "junction",
          resourceEncrypted: await sealHostedDeviceSyncDirtyPayloadJson({
            connectionId,
            dirtyRevision,
            payloadId,
            provider: "junction",
            userId: "member_123",
            value: {
              count: 1,
              jobKind: "resource",
              payload: {
                webhookDataJson: JSON.stringify({ index, source: "garmin" }),
              },
              resource: "steps",
              resourceCategory: "timeseries",
              sourceProviderSlug: "garmin",
              windowEnd: "2026-05-26T12:10:00.000Z",
              windowStart: "2026-05-26T12:00:00.000Z",
            },
          }),
        });
      }
      payloadRowsByConnectionId.set(connectionId, rows);
    }

    const prisma = {
      $queryRaw: vi.fn(async () =>
        connectionIds.map((connectionId) => ({ connection_id: connectionId }))
      ),
      deviceSyncDirtyConnection: {
        findMany: vi.fn(async () => [
          buildDirtyRecord(connectionIds[0] ?? "", 1n),
          buildDirtyRecord(connectionIds[1] ?? "", 2n),
          buildDirtyRecord(connectionIds[2] ?? "", 3n),
        ]),
      },
      deviceSyncDirtyPayload: {
        findMany: vi.fn(async (query: { where: { connectionId: string } }) =>
          payloadRowsByConnectionId.get(query.where.connectionId) ?? []
        ),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    const result = await store.listPendingDirtyConnectionsForUser({
      limit: 10,
      userId: "member_123",
    });

    expect(result.hasMore).toBe(true);
    expect(result.items.map((item) => item.connectionId))
      .toEqual(connectionIds.slice(0, 2));
    expect(Object.values(result.items[0]?.dirtyResources ?? {})).toHaveLength(500);
    expect(Object.values(result.items[1]?.dirtyResources ?? {})).toHaveLength(500);
    expect(prisma.deviceSyncDirtyPayload.findMany).toHaveBeenCalledTimes(2);
  });

  it("appends payload-only webhooks to an already dirty connection without rewriting the marker row", async () => {
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    let payloadCreateData: Array<Record<string, unknown>> | null = null;
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      deviceSyncDirtyConnection: {
        findUnique: vi.fn(async () => ({
          connectionId: "dsc_junction_123",
          createdAt: dirtyAt,
          dirtyResourcesJson: {},
          dirtyRevision: 7n,
          eventCount: 7n,
          firstDirtyAt: dirtyAt,
          latestDirtyAt: dirtyAt,
          latestEventType: "daily.data.steps.created",
          latestResourceCategory: "timeseries",
          latestTraceId: "trace_existing",
          processedRevision: 6n,
          provider: "junction",
          resourceCategoryCountsJson: {},
          sourceProviderCountsJson: {},
          updatedAt: dirtyAt,
          userId: "member_123",
          windowEnd: null,
          windowStart: null,
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      deviceSyncDirtyPayload: {
        createMany: vi.fn(async (input: { data: Array<Record<string, unknown>> }) => {
          payloadCreateData = input.data;
          return { count: input.data.length };
        }),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    const result = await store.upsertDirtyConnection({
      connectionId: "dsc_junction_123",
      dirtyAt: "2026-05-26T12:01:00.000Z",
      eventType: "daily.data.steps.created",
      provider: "junction",
      resourceCategory: "timeseries",
      resources: [
        {
          count: 1,
          jobKind: "resource",
          payload: {
            webhookDataJson: JSON.stringify({ source: "garmin", value: 123 }),
          },
          resource: "steps",
          resourceCategory: "timeseries",
          sourceProviderSlug: "garmin",
          windowEnd: "2026-05-27T00:00:00.000Z",
          windowStart: "2026-05-26T00:00:00.000Z",
        },
      ],
      traceId: "trace_new_payload",
      userId: "member_123",
    });

    expect(prisma.deviceSyncDirtyConnection.updateMany).not.toHaveBeenCalled();
    const payloadRow = expectFirstPayloadCreateRow(payloadCreateData);
    expect(payloadRow.dirtyRevision).toBe(7n);
    expect(Object.values(result.dirty.dirtyResources)[0]?.dirtyPayloadId)
      .toBe(payloadRow.id);
    expect(result.shouldRequestWake).toBe(false);
  });

  it("deletes only explicitly acknowledged durable payload ids", async () => {
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      $queryRaw: vi.fn(async () => [{ pending: true }]),
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
        findMany: vi.fn(async () => {
          throw new Error("dirty ack should not hydrate remaining payload rows");
        }),
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
    expect(result).toMatchObject({
      connectionId: "dsc_junction_123",
      dirtyRevision: 3n,
      processedRevision: 3n,
      stillDirty: true,
      userId: "member_123",
    });
    expect(prisma.deviceSyncDirtyPayload.findMany).not.toHaveBeenCalled();
  });

  it("leaves durable payload rows pending when ack omits explicit payload ids", async () => {
    const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      $queryRaw: vi.fn(async () => [{ pending: true }]),
      deviceSyncDirtyConnection: {
        findFirst: vi.fn(async () => ({
          connectionId: "dsc_junction_123",
          dirtyRevision: 3n,
          latestDirtyAt: dirtyAt,
          processedRevision: 1n,
          userId: "member_123",
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      deviceSyncDirtyPayload: {
        deleteMany: vi.fn(async () => ({ count: 2 })),
        findMany: vi.fn(async () => {
          throw new Error("dirty ack should not hydrate remaining payload rows");
        }),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    const result = await store.markDirtyConnectionProcessed({
      connectionId: "dsc_junction_123",
      processedRevision: 3n,
      userId: "member_123",
    });

    expect(prisma.deviceSyncDirtyPayload.deleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      connectionId: "dsc_junction_123",
      dirtyRevision: 3n,
      processedRevision: 3n,
      stillDirty: true,
      userId: "member_123",
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.deviceSyncDirtyPayload.findMany).not.toHaveBeenCalled();
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

});

function installHostedSecureBoxStringTestCodec(onEncrypt?: () => void): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const decoded = JSON.parse(
        Buffer.from(input.value.replace(/^hsb-test:/u, ""), "base64url").toString("utf8"),
      ) as {
        lane?: string;
        scope?: string;
        userId?: string;
        value?: string;
      };
      if (
        decoded.lane !== input.lane
        || decoded.scope !== input.scope
        || decoded.userId !== input.userId
        || typeof decoded.value !== "string"
      ) {
        throw new Error("Hosted secure-box test codec metadata mismatch.");
      }
      return decoded.value;
    },
    encrypt(input) {
      onEncrypt?.();
      return `hsb-test:${Buffer.from(JSON.stringify({
        lane: input.lane,
        scope: input.scope,
        userId: input.userId,
        value: input.value,
      }), "utf8").toString("base64url")}`;
    },
  });
}

function expectFirstPayloadCreateRow(
  rows: Array<Record<string, unknown>> | null,
): Record<string, unknown> {
  expect(rows).not.toBeNull();
  expect(rows?.[0]).toBeTruthy();
  return rows?.[0] ?? {};
}
