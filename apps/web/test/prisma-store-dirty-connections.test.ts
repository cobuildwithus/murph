import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_RESOURCE,
  COMPANION_HRV_RMSSD_SCHEMA,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";

import {
  classifyHostedUnclassifiedDirtyPayloadsForConnection,
  PrismaHostedDirtyConnectionStore,
  supersedeHostedCredentialScopedDirtyStateForConnectionTx,
} from "@/src/lib/device-sync/prisma-store/dirty-connections";
import {
  openHostedDeviceSyncDirtyPayloadJson,
  sealHostedDeviceSyncDirtyPayloadJson,
} from "@/src/lib/device-sync/prisma-store/dirty-payloads";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";

describe("PrismaHostedDirtyConnectionStore dirty pending state", () => {
  it("supersedes reconnect-bound dirty work with set-based database mutations", async () => {
    const connectionId = "dsc_epoch_replacement";
    const userId = "member_epoch_replacement";
    const dirtyRevision = 4n;
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const findMany = vi.fn();
    const tx = {
      $queryRaw: vi.fn(async (query: unknown) => {
        expect(query).toBeDefined();
        return [{
          dirtyRevision,
          latestDirtyAt: new Date("2026-07-27T04:00:00.000Z"),
          processedRevision: 1n,
        }];
      }),
      deviceSyncDirtyConnection: {
        updateMany,
      },
      deviceSyncDirtyPayload: {
        count: vi.fn(async () => 0),
        deleteMany,
        findMany,
      },
    };

    await expect(
      supersedeHostedCredentialScopedDirtyStateForConnectionTx({
        connectionId,
        tx: tx as never,
        userId,
      }),
    ).resolves.toBeUndefined();
    const lockQuery = tx.$queryRaw.mock.calls[0]?.[0] as { sql?: string };
    expect(lockQuery.sql).toContain("device_sync_dirty_connection");
    expect(lockQuery.sql).toContain("user_id");
    expect(lockQuery.sql).toContain("FOR UPDATE");
    expect(tx.deviceSyncDirtyPayload.count).toHaveBeenCalledWith({
      where: {
        connectionId,
        credentialIndependent: null,
        userId,
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        dirtyResourcesJson: {},
        firstDirtyAt: new Date("2026-07-27T04:00:00.000Z"),
        processedRevision: dirtyRevision,
        resourceCategoryCountsJson: {},
        sourceProviderCountsJson: {},
        windowEnd: null,
        windowStart: null,
      },
      where: {
        connectionId,
        dirtyRevision,
        processedRevision: 1n,
        userId,
      },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        connectionId,
        credentialIndependent: false,
        userId,
      },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("classifies deploy-skew payloads only after taking the dirty-marker lock", async () => {
    installHostedSecureBoxStringTestCodec();
    const connectionId = "dsc_epoch_skew";
    const userId = "member_epoch_skew";
    const payloadId = "dsp_epoch_skew";
    const dirtyRevision = 3n;
    const operationOrder: string[] = [];

    try {
      const resourceEncrypted = await sealHostedDeviceSyncDirtyPayloadJson({
        connectionId,
        dirtyRevision,
        payloadId,
        provider: "junction",
        userId,
        value: {
          count: 1,
          jobKind: "deauthorization",
          payload: { webhookDataJson: JSON.stringify({ event: "deauthorize" }) },
          resource: "deauthorization",
        },
      });
      const tx = {
        $queryRaw: vi.fn(async () => {
          operationOrder.push("lock-dirty-marker");
          return [{
            dirtyRevision,
            latestDirtyAt: new Date("2026-07-27T04:00:00.000Z"),
            processedRevision: 2n,
          }];
        }),
        deviceSyncDirtyConnection: {
          updateMany: vi.fn(async () => {
            operationOrder.push("reset-dirty-marker");
            return { count: 1 };
          }),
        },
        deviceSyncDirtyPayload: {
          count: vi.fn()
            .mockImplementationOnce(async () => {
              operationOrder.push("count-nullable");
              return 1;
            })
            .mockImplementationOnce(async () => {
              operationOrder.push("count-nullable");
              return 0;
            }),
          deleteMany: vi.fn(async () => {
            operationOrder.push("delete-credential-scoped");
            return { count: 1 };
          }),
          findMany: vi.fn(async () => {
            operationOrder.push("read-nullable-payloads");
            return [{
              connectionId,
              dirtyRevision,
              id: payloadId,
              provider: "junction",
              resourceEncrypted,
            }];
          }),
          updateMany: vi.fn(async () => {
            operationOrder.push("classify-payload");
            return { count: 1 };
          }),
        },
      };

      await expect(supersedeHostedCredentialScopedDirtyStateForConnectionTx({
        connectionId,
        tx: tx as never,
        userId,
      })).resolves.toBeUndefined();
      expect(operationOrder).toEqual([
        "lock-dirty-marker",
        "count-nullable",
        "read-nullable-payloads",
        "classify-payload",
        "count-nullable",
        "reset-dirty-marker",
        "delete-credential-scoped",
      ]);
      expect(tx.deviceSyncDirtyPayload.updateMany).toHaveBeenCalledWith({
        data: { credentialIndependent: false },
        where: {
          connectionId,
          credentialIndependent: null,
          id: { in: [payloadId] },
          userId,
        },
      });
    } finally {
      setHostedSecureBoxStringTestCodecForTests(null);
    }
  });

  it("classifies nullable legacy payloads before replacement and preserves decrypt failures", async () => {
    installHostedSecureBoxStringTestCodec();
    const connectionId = "dsc_legacy_classification";
    const userId = "member_legacy_classification";
    const dirtyRevision = 4n;

    try {
      const makePayload = (payloadId: string, value: unknown) =>
        sealHostedDeviceSyncDirtyPayloadJson({
          connectionId,
          dirtyRevision,
          payloadId,
          provider: "junction",
          userId,
          value,
        });
      const rows = [
        {
          connectionId,
          dirtyRevision,
          id: "dsp_credential",
          provider: "junction",
          resourceEncrypted: await makePayload("dsp_credential", {
            count: 1,
            jobKind: "deauthorization",
            payload: { webhookDataJson: JSON.stringify({ event: "deauthorize" }) },
            resource: "deauthorization",
          }),
        },
        {
          connectionId,
          dirtyRevision,
          id: "dsp_companion",
          provider: "junction",
          resourceEncrypted: await makePayload("dsp_companion", {
            count: 1,
            jobKind: "resource",
            payload: { resource: COMPANION_HRV_RMSSD_RESOURCE },
            resource: COMPANION_HRV_RMSSD_RESOURCE,
          }),
        },
        {
          connectionId,
          dirtyRevision,
          id: "dsp_companion_metadata",
          provider: "junction",
          resourceEncrypted: await makePayload("dsp_companion_metadata", {
            count: 1,
            jobKind: "resource",
            payload: { resource: "companion_health_metadata" },
            resource: "companion_health_metadata",
          }),
        },
        {
          connectionId,
          dirtyRevision,
          id: "dsp_inline",
          provider: "junction",
          resourceEncrypted: await makePayload("dsp_inline", {
            count: 1,
            jobKind: "resource",
            payload: {
              resource: "sleep",
              resourceCategory: "summary",
              sourceProviderSlug: "garmin",
              webhookDataJson: JSON.stringify({ sourceProviderSlug: "garmin" }),
            },
            resource: "sleep",
          }),
        },
      ];
      const updateMany = vi.fn(async (input: { where: { id: { in: string[] } } }) => ({
        count: input.where.id.in.length,
      }));
      const prisma = {
        deviceSyncDirtyPayload: {
          findMany: vi.fn(async () => rows),
          updateMany,
        },
      };

      await expect(classifyHostedUnclassifiedDirtyPayloadsForConnection({
        connectionId,
        tx: prisma as never,
        userId,
      })).resolves.toBeUndefined();
      expect(updateMany).toHaveBeenCalledWith({
        data: { credentialIndependent: true },
        where: {
          connectionId,
          credentialIndependent: null,
          id: { in: ["dsp_companion", "dsp_companion_metadata", "dsp_inline"] },
          userId,
        },
      });
      expect(updateMany).toHaveBeenCalledWith({
        data: { credentialIndependent: false },
        where: {
          connectionId,
          credentialIndependent: null,
          id: { in: ["dsp_credential"] },
          userId,
        },
      });

      updateMany.mockClear();
      setHostedSecureBoxStringTestCodecForTests({
        decrypt() {
          throw new Error("kms unavailable");
        },
        encrypt(input) {
          return input.value;
        },
      });
      await expect(classifyHostedUnclassifiedDirtyPayloadsForConnection({
        connectionId,
        tx: prisma as never,
        userId,
      })).rejects.toThrow("kms unavailable");
      expect(updateMany).not.toHaveBeenCalled();
    } finally {
      setHostedSecureBoxStringTestCodecForTests(null);
    }
  });

  it("persists the server classifier result while sealing each new payload", async () => {
    installHostedSecureBoxStringTestCodec();
    const companionObservationJson = serializeCompanionHrvRmssdObservation({
      schema: COMPANION_HRV_RMSSD_SCHEMA,
      methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
      nightDate: "2026-07-10",
      rmssdMs: 52.75,
      completedWindowCount: 96,
      acceptedWindowCount: 72,
    });
    const classifyThroughAdmission = async (input: {
      connectionId: string;
      provider: string;
      resource: {
        count: number;
        jobKind: string;
        payload: Record<string, string>;
        resource: string;
        resourceCategory: string;
        sourceProviderSlug: string;
        windowEnd: null;
        windowStart: null;
      };
    }): Promise<boolean | undefined> => {
      const dirtyAt = new Date("2026-07-10T13:46:00.000Z");
      const createdRecord = {
        connectionId: input.connectionId,
        createdAt: dirtyAt,
        dirtyResourcesJson: {},
        dirtyRevision: 1n,
        eventCount: 1n,
        firstDirtyAt: dirtyAt,
        latestDirtyAt: dirtyAt,
        latestEventType: "resource.created",
        latestResourceCategory: input.resource.resourceCategory,
        latestTraceId: null,
        processedRevision: 0n,
        provider: input.provider,
        resourceCategoryCountsJson: {},
        sourceProviderCountsJson: {},
        updatedAt: dirtyAt,
        userId: "member_classify",
        windowEnd: null,
        windowStart: null,
      };
      let payloadRows: Array<Record<string, unknown>> = [];
      const tx = {
        deviceSyncCompanionCaptureReceipt: {
          count: vi.fn(async () => 0),
          createMany: vi.fn(async () => ({ count: 1 })),
          deleteMany: vi.fn(async () => ({ count: 0 })),
          findUnique: vi.fn(async () => null),
        },
        deviceSyncDirtyConnection: {
          createMany: vi.fn(async () => ({ count: 1 })),
          findUnique: vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(createdRecord),
        },
        deviceSyncDirtyPayload: {
          createMany: vi.fn(async (createInput: {
            data: Array<Record<string, unknown>>;
          }) => {
            payloadRows = createInput.data;
            return { count: createInput.data.length };
          }),
        },
      };
      const store = new PrismaHostedDirtyConnectionStore({} as never);

      await store.upsertDirtyConnection({
        connectionId: input.connectionId,
        dirtyAt: dirtyAt.toISOString(),
        eventType: "resource.created",
        provider: input.provider,
        resourceCategory: input.resource.resourceCategory,
        resources: [input.resource],
        tx: tx as never,
        userId: createdRecord.userId,
      });

      return payloadRows[0]?.credentialIndependent as boolean | undefined;
    };

    try {
      const ouraDelete = await classifyThroughAdmission({
        connectionId: "dsc_classify_oura",
        provider: "oura",
        resource: {
          count: 1,
          jobKind: "delete",
          payload: { objectId: "sleep-1" },
          resource: "sleep",
          resourceCategory: "sleep",
          sourceProviderSlug: "oura",
          windowEnd: null,
          windowStart: null,
        },
      });
      const junctionCompanion = await classifyThroughAdmission({
        connectionId: "dsc_classify_companion",
        provider: "junction",
        resource: {
          count: 1,
          jobKind: "resource",
          payload: {
            companionAdmissionId: createHash("sha256")
              .update(companionObservationJson)
              .digest("hex"),
            companionObservationJson,
            resource: COMPANION_HRV_RMSSD_RESOURCE,
          },
          resource: COMPANION_HRV_RMSSD_RESOURCE,
          resourceCategory: "derived",
          sourceProviderSlug: "whoop",
          windowEnd: null,
          windowStart: null,
        },
      });
      const junctionInline = await classifyThroughAdmission({
        connectionId: "dsc_classify_inline",
        provider: "junction",
        resource: {
          count: 1,
          jobKind: "resource",
          payload: {
            resource: "sleep",
            resourceCategory: "summary",
            sourceProviderSlug: "garmin",
            webhookDataJson: JSON.stringify({ sourceProviderSlug: "garmin" }),
          },
          resource: "sleep",
          resourceCategory: "summary",
          sourceProviderSlug: "garmin",
          windowEnd: null,
          windowStart: null,
        },
      });
      const junctionCredentialScoped = await classifyThroughAdmission({
        connectionId: "dsc_classify_credential",
        provider: "junction",
        resource: {
          count: 1,
          jobKind: "resource",
          payload: {
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
          },
          resource: "steps",
          resourceCategory: "timeseries",
          sourceProviderSlug: "garmin",
          windowEnd: null,
          windowStart: null,
        },
      });

      expect(ouraDelete).toBe(true);
      expect(junctionCompanion).toBe(true);
      expect(junctionInline).toBe(true);
      expect(junctionCredentialScoped).toBe(false);
    } finally {
      setHostedSecureBoxStringTestCodecForTests(null);
    }
  });

  it("binds store-owned payload preparation to the dirty connection owner", async () => {
    const prisma = {
      deviceSyncDirtyConnection: {
        findUnique: vi.fn(async () => ({
          dirtyRevision: 1n,
          processedRevision: 1n,
          userId: "member_owner_a",
        })),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);

    await expect(store.upsertDirtyConnection({
      connectionId: "dsc_owner_binding",
      dirtyAt: "2026-07-10T13:46:00.000Z",
      provider: "junction",
      resources: [{
        count: 1,
        jobKind: "resource",
        payload: { webhookDataJson: "{}" },
        resource: "steps",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        windowEnd: null,
        windowStart: null,
      }],
      userId: "member_owner_b",
    })).rejects.toThrow(
      "Dirty payload preparation owner did not match the dirty connection.",
    );
  });

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
      expect(payloadRow.credentialIndependent).toBe(false);
      expect(payloadRow.resourceEncrypted).toMatch(/^hsb-test:/u);
      expect(Object.values(result.dirty.dirtyResources)[0]?.dirtyPayloadId)
        .toBe(payloadRow.id);
    } finally {
      installHostedSecureBoxStringTestCodec();
    }
  });

  it("keeps retained nightly replays idempotent and rejects changed same-night content", async () => {
    const operationOrder: string[] = [];
    installHostedSecureBoxStringTestCodec(() => {
      operationOrder.push("encrypt-payload");
    });

    try {
      let dirtyRecord: Record<string, unknown> | null = null;
      const payloadRows = new Map<string, {
        connectionId: string;
        dirtyRevision: bigint;
        id: string;
        provider: string;
        resourceEncrypted: string;
        userId: string;
      }>();
      const receiptRows = new Map<string, {
        connectionId: string;
        createdAt: Date;
        envelopeHash: string;
        id: string;
        userId: string;
      }>();
      const prisma = {
        $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
        $queryRaw: vi.fn(async () => {
          operationOrder.push("lock-dirty-marker");
          return [{ pending: payloadRows.size > 0 }];
        }),
        deviceSyncCompanionCaptureReceipt: {
          createMany: vi.fn(async (input: { data: {
            connectionId: string;
            createdAt: Date;
            envelopeHash: string;
            id: string;
            userId: string;
          } }) => {
            operationOrder.push("claim-companion-receipt");
            if (receiptRows.has(input.data.id)) {
              return { count: 0 };
            }
            receiptRows.set(input.data.id, input.data);
            return { count: 1 };
          }),
          // Model a connection already holding 62 unrelated retained
          // receipts so two accepted rows bring it exactly to the hard cap.
          count: vi.fn(async () => receiptRows.size + 62),
          deleteMany: vi.fn(async (input: {
            where: { createdAt: { lt: Date } };
          }) => {
            let count = 0;
            for (const [id, row] of receiptRows) {
              if (row.createdAt < input.where.createdAt.lt) {
                receiptRows.delete(id);
                count += 1;
              }
            }
            return { count };
          }),
          findUnique: vi.fn(async (input: { where: { id: string } }) =>
            receiptRows.get(input.where.id) ?? null),
          findMany: vi.fn(async (input: {
            where: { createdAt: { gte: Date }; id: { in: string[] } };
          }) => [...receiptRows.values()].filter((row) =>
            input.where.id.in.includes(row.id)
            && row.createdAt >= input.where.createdAt.gte
          )),
        },
        deviceSyncDirtyConnection: {
          createMany: vi.fn(async (input: { data: Record<string, unknown> }) => {
            if (dirtyRecord) {
              return { count: 0 };
            }
            dirtyRecord = {
              ...input.data,
              createdAt: input.data.firstDirtyAt,
              updatedAt: input.data.latestDirtyAt,
            };
            return { count: 1 };
          }),
          findFirst: vi.fn(async () => dirtyRecord),
          findUnique: vi.fn(async () => dirtyRecord),
          updateMany: vi.fn(async (input: { data: Record<string, unknown> }) => {
            operationOrder.push("update-dirty-marker");
            if (!dirtyRecord) {
              return { count: 0 };
            }
            dirtyRecord = {
              ...dirtyRecord,
              ...input.data,
            };
            return { count: 1 };
          }),
        },
        deviceSyncDirtyPayload: {
          createMany: vi.fn(async (input: { data: Array<{
            connectionId: string;
            dirtyRevision: bigint;
            id: string;
            provider: string;
            resourceEncrypted: string;
            userId: string;
          }> }) => {
            operationOrder.push("insert-durable-payload");
            let count = 0;
            for (const row of input.data) {
              if (!payloadRows.has(row.id)) {
                payloadRows.set(row.id, row);
                count += 1;
              }
            }
            return { count };
          }),
          deleteMany: vi.fn(async (input: { where: { id: { in: string[] } } }) => {
            let count = 0;
            for (const id of input.where.id.in) {
              if (payloadRows.delete(id)) {
                count += 1;
              }
            }
            return { count };
          }),
        },
      };
      const store = new PrismaHostedDirtyConnectionStore(prisma as never);
      const observation = {
        schema: COMPANION_HRV_RMSSD_SCHEMA as typeof COMPANION_HRV_RMSSD_SCHEMA,
        methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION as typeof COMPANION_HRV_RMSSD_METHOD_VERSION,
        nightDate: "2026-07-10",
        rmssdMs: 52.75,
        completedWindowCount: 96,
        acceptedWindowCount: 72,
      };
      const buildInput = (
        rmssdMs: number,
        nightDate = observation.nightDate,
      ) => {
        const companionObservationJson = serializeCompanionHrvRmssdObservation({
          ...observation,
          nightDate,
          rmssdMs,
        });
        return {
          connectionId: "dsc_companion_hrv_1",
          dirtyAt: "2026-07-10T13:46:00.000Z",
          eventType: "companion.hrv-rmssd.created",
          provider: "junction",
          resourceCategory: "derived",
          resources: [{
            count: 1,
            jobKind: "resource",
            payload: {
              companionAdmissionId: createHash("sha256")
                .update(companionObservationJson)
                .digest("hex"),
              companionObservationJson,
              resource: COMPANION_HRV_RMSSD_RESOURCE,
              resourceCategory: "derived",
              sourceProviderSlug: "whoop",
            },
            resource: COMPANION_HRV_RMSSD_RESOURCE,
            resourceCategory: "derived",
            sourceProviderSlug: "whoop",
            windowEnd: null,
            windowStart: null,
          }],
          traceId: "trace_companion_hrv_1",
          userId: "member_companion_hrv_1",
        };
      };

      const first = await store.upsertDirtyConnection(buildInput(observation.rmssdMs));
      const acceptedPayloadId = Object.values(first.dirty.dirtyResources)[0]?.dirtyPayloadId;
      expect(acceptedPayloadId).toMatch(/^dsp_/u);

      expect(payloadRows.size).toBe(1);
      expect(receiptRows.size).toBe(1);

      const exactResource = buildInput(observation.rmssdMs).resources[0]!;
      await expect(store.inspectCompanionHrvNightReceipt({
        connectionIds: [buildInput(observation.rmssdMs).connectionId],
        nightDate: observation.nightDate,
        now: "2026-07-10T13:46:00.000Z",
        resource: exactResource,
        userId: buildInput(observation.rmssdMs).userId,
      })).resolves.toBe("exact");
      await expect(store.inspectCompanionHrvNightReceipt({
        connectionIds: [buildInput(observation.rmssdMs).connectionId],
        nightDate: observation.nightDate,
        now: "2026-07-10T13:46:00.000Z",
        resource: buildInput(49.25).resources[0]!,
        userId: buildInput(observation.rmssdMs).userId,
      })).resolves.toBe("conflict");
      await expect(store.inspectCompanionHrvNightReceipt({
        connectionIds: ["dsc_companion_hrv_2"],
        nightDate: observation.nightDate,
        now: "2026-07-10T13:46:00.000Z",
        resource: exactResource,
        userId: buildInput(observation.rmssdMs).userId,
      })).resolves.toBe("missing");
      await expect(store.inspectCompanionHrvNightReceipt({
        connectionIds: [buildInput(observation.rmssdMs).connectionId],
        nightDate: "2026-07-11",
        now: "2026-07-10T13:46:00.000Z",
        resource: buildInput(observation.rmssdMs, "2026-07-11").resources[0]!,
        userId: buildInput(observation.rmssdMs).userId,
      })).resolves.toBe("missing");

      const pendingReplay = await store.upsertDirtyConnection(buildInput(observation.rmssdMs));
      expect(pendingReplay.shouldRequestWake).toBe(false);
      expect(payloadRows.size).toBe(1);

      await store.markDirtyConnectionProcessed({
        connectionId: buildInput(observation.rmssdMs).connectionId,
        processedDirtyPayloadIds: [acceptedPayloadId].filter(
          (value): value is string => Boolean(value),
        ),
        processedRevision: first.dirty.dirtyRevision,
        userId: buildInput(observation.rmssdMs).userId,
      });
      expect(payloadRows.size).toBe(0);
      expect(receiptRows.size).toBe(1);

      const completedReplay = await store.upsertDirtyConnection(buildInput(observation.rmssdMs));
      expect(completedReplay.shouldRequestWake).toBe(false);
      expect(completedReplay.dirty.dirtyRevision).toBe(first.dirty.dirtyRevision);
      expect(payloadRows.size).toBe(0);

      operationOrder.length = 0;
      const nextNightInput = buildInput(observation.rmssdMs, "2026-07-11");
      await store.upsertDirtyConnection({
        ...nextNightInput,
        tx: prisma as never,
      });
      expect(operationOrder).toEqual([
        "encrypt-payload",
        "lock-dirty-marker",
        "claim-companion-receipt",
        "update-dirty-marker",
        "insert-durable-payload",
      ]);
      expect(payloadRows.size).toBe(1);
      expect(receiptRows.size).toBe(2);

      await expect(store.upsertDirtyConnection(buildInput(49.25))).rejects.toMatchObject({
        code: "COMPANION_HRV_NIGHT_CONFLICT",
        httpStatus: 409,
        retryable: false,
      });
      expect(payloadRows.size).toBe(1);
      expect(receiptRows.size).toBe(2);

      await expect(store.upsertDirtyConnection(buildInput(
        observation.rmssdMs,
        "2026-07-12",
      ))).rejects.toMatchObject({
        code: "COMPANION_HRV_NIGHT_RECEIPT_CAPACITY_REACHED",
        httpStatus: 429,
        retryable: true,
      });
      expect(payloadRows.size).toBe(1);
      expect(receiptRows.size).toBe(2);
    } finally {
      installHostedSecureBoxStringTestCodec();
    }
  });

  it("lazily removes expired companion night receipts before replay inspection", async () => {
    const oldReceipt = {
      connectionId: "dsc_companion_hrv_expired",
      createdAt: new Date("2026-06-09T13:46:00.000Z"),
      envelopeHash: "b".repeat(64),
      id: "receipt_expired",
      userId: "member_companion_hrv_expired",
    };
    const receiptRows = [oldReceipt];
    const prisma = {
      deviceSyncCompanionCaptureReceipt: {
        deleteMany: vi.fn(async (input: {
          where: { createdAt: { lt: Date } };
        }) => {
          const before = receiptRows.length;
          for (let index = receiptRows.length - 1; index >= 0; index -= 1) {
            if (receiptRows[index]!.createdAt < input.where.createdAt.lt) {
              receiptRows.splice(index, 1);
            }
          }
          return { count: before - receiptRows.length };
        }),
        findMany: vi.fn(async () => receiptRows),
      },
    };
    const store = new PrismaHostedDirtyConnectionStore(prisma as never);
    const observation = {
      schema: COMPANION_HRV_RMSSD_SCHEMA as typeof COMPANION_HRV_RMSSD_SCHEMA,
      methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION as typeof COMPANION_HRV_RMSSD_METHOD_VERSION,
      nightDate: "2026-07-10",
      rmssdMs: 52.75,
      completedWindowCount: 96,
      acceptedWindowCount: 72,
    };
    const resource = {
      count: 1,
      jobKind: "resource" as const,
      payload: {
        companionObservationJson: serializeCompanionHrvRmssdObservation(observation),
        resource: COMPANION_HRV_RMSSD_RESOURCE,
        resourceCategory: "derived",
        sourceProviderSlug: "whoop",
      },
      resource: COMPANION_HRV_RMSSD_RESOURCE,
      resourceCategory: "derived",
      sourceProviderSlug: "whoop",
      windowEnd: null,
      windowStart: null,
    };

    await expect(store.inspectCompanionHrvNightReceipt({
      connectionIds: [oldReceipt.connectionId],
      nightDate: observation.nightDate,
      now: "2026-07-10T13:46:00.000Z",
      resource,
      userId: oldReceipt.userId,
    })).resolves.toBe("missing");

    expect(prisma.deviceSyncCompanionCaptureReceipt.deleteMany).toHaveBeenCalledWith({
      where: {
        connectionId: { in: [oldReceipt.connectionId] },
        createdAt: { lt: new Date("2026-06-10T13:46:00.000Z") },
        userId: oldReceipt.userId,
      },
    });
    expect(receiptRows).toEqual([]);
  });

  it("prepares caller-owned payloads inside the consent transaction before the dirty-state CAS", async () => {
    let insideCallerOwnedTransaction = false;
    const encryptInsideCallerOwnedTransaction: boolean[] = [];
    const operationOrder: string[] = [];
    installHostedSecureBoxStringTestCodec(() => {
      encryptInsideCallerOwnedTransaction.push(insideCallerOwnedTransaction);
      operationOrder.push("encrypt-payload");
    });

    try {
      const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
      const existing = {
        connectionId: "dsc_caller_owned_1",
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
        userId: "member_caller_owned_1",
        windowEnd: null,
        windowStart: null,
      };
      const rootPrisma = {
        $transaction: vi.fn(),
        deviceSyncDirtyConnection: {
          findUnique: vi.fn(async () => existing),
        },
      };
      let payloadCreateData: Array<Record<string, unknown>> | null = null;
      const tx = {
        deviceSyncDirtyConnection: {
          findUnique: vi.fn()
            .mockResolvedValueOnce(existing)
            .mockResolvedValueOnce({
              ...existing,
              dirtyRevision: 3n,
              eventCount: 3n,
              latestTraceId: "trace_caller_owned_1",
              processedRevision: 2n,
            }),
          updateMany: vi.fn(async () => {
            operationOrder.push("update-dirty-marker");
            return { count: 1 };
          }),
        },
        deviceSyncDirtyPayload: {
          createMany: vi.fn(async (input: { data: Array<Record<string, unknown>> }) => {
            operationOrder.push("insert-durable-payload");
            payloadCreateData = input.data;
            return { count: input.data.length };
          }),
        },
      };
      const store = new PrismaHostedDirtyConnectionStore(rootPrisma as never);
      const input = {
        connectionId: existing.connectionId,
        dirtyAt: "2026-05-26T12:01:00.000Z",
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
        userId: existing.userId,
      } as const;
      insideCallerOwnedTransaction = true;
      const result = await store.upsertDirtyConnection({
        ...input,
        tx: tx as never,
      });
      insideCallerOwnedTransaction = false;

      expect(encryptInsideCallerOwnedTransaction).toEqual([true]);
      expect(operationOrder).toEqual([
        "encrypt-payload",
        "update-dirty-marker",
        "insert-durable-payload",
      ]);
      expect(rootPrisma.$transaction).not.toHaveBeenCalled();
      expect(rootPrisma.deviceSyncDirtyConnection.findUnique).not.toHaveBeenCalled();
      expect(tx.deviceSyncDirtyPayload.createMany).toHaveBeenCalledTimes(1);
      const payloadRow = expectFirstPayloadCreateRow(payloadCreateData);
      expect(payloadRow.credentialIndependent).toBe(false);
      expect(Object.values(result.dirty.dirtyResources)[0]?.dirtyPayloadId)
        .toBe(payloadRow.id);
    } finally {
      insideCallerOwnedTransaction = false;
      setHostedSecureBoxStringTestCodecForTests(null);
    }
  });

  it("recomputes store-owned dirty payload rows after a stale preseal revision contention", async () => {
    installHostedSecureBoxStringTestCodec();
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
      expect(tx.deviceSyncDirtyConnection.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.deviceSyncDirtyPayload.createMany).toHaveBeenCalledTimes(1);
      expect(tx.deviceSyncDirtyConnection.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.deviceSyncDirtyPayload.createMany.mock.invocationCallOrder[0] ?? 0,
      );
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      const payloadRow = expectFirstPayloadCreateRow(payloadCreateData);
      expect(payloadRow.dirtyRevision).toBe(4n);
      expect(Object.values(result.dirty.dirtyResources)[0]?.dirtyPayloadId)
        .toBe(payloadRow.id);
    } finally {
      setTimeoutSpy.mockRestore();
      setHostedSecureBoxStringTestCodecForTests(null);
    }
  });

  it("coalesces timing-only sources without changing compact import identity", async () => {
    const admitCompactResources = async (
      connectionId: string,
      timingSources: readonly [string, string],
    ) => {
      let createData: Record<string, unknown> | null = null;
      let persistedDirtyResources: object = {};
      let findCount = 0;
      const dirtyAt = new Date("2026-05-26T12:00:00.000Z");
      const prisma = {
        $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
        deviceSyncDirtyConnection: {
          createMany: vi.fn(async (input: { data: Record<string, unknown> }) => {
            createData = input.data;
            const dirtyResourcesJson = input.data.dirtyResourcesJson;
            persistedDirtyResources = dirtyResourcesJson
                && typeof dirtyResourcesJson === "object"
              ? dirtyResourcesJson
              : {};
            return { count: 1 };
          }),
          findUnique: vi.fn(async () => {
            findCount += 1;
            if (findCount === 1 || !createData) {
              return null;
            }
            return {
              ...createData,
              createdAt: dirtyAt,
              updatedAt: dirtyAt,
            };
          }),
        },
        deviceSyncDirtyPayload: {
          createMany: vi.fn(async () => ({ count: 0 })),
        },
      };
      const store = new PrismaHostedDirtyConnectionStore(prisma as never);

      const result = await store.upsertDirtyConnection({
        connectionId,
        dirtyAt: dirtyAt.toISOString(),
        eventType: "connection.updated",
        provider: "junction",
        resourceCategory: null,
        resources: timingSources.map((timingSourceProviderSlug) => ({
          count: 1,
          eventToProviderSendBucket: "under_5_minutes" as const,
          firstWebhookReceivedAt: dirtyAt.toISOString(),
          providerSendToWebhookMs: 30_000,
          jobKind: "reconcile",
          resource: null,
          resourceCategory: null,
          sourceProviderSlug: null,
          timingSourceProviderSlug,
          windowEnd: null,
          windowStart: null,
        })),
        userId: "member_timing_sources",
      });

      return {
        dirty: result.dirty,
        persistedDirtyResources,
      };
    };

    const agreeing = await admitCompactResources(
      "dsc_timing_source_agreeing",
      ["garmin", "garmin"],
    );
    const mixed = await admitCompactResources(
      "dsc_timing_source_mixed",
      ["garmin", "fitbit"],
    );
    const [agreeingResource] = Object.values(agreeing.dirty.dirtyResources);
    const [mixedResource] = Object.values(mixed.dirty.dirtyResources);

    expect(Object.keys(agreeing.dirty.dirtyResources)).toHaveLength(1);
    expect(agreeingResource).toMatchObject({
      count: 2,
      jobKind: "reconcile",
      sourceProviderSlug: null,
      timingSourceProviderSlug: "garmin",
    });
    expect(Object.keys(mixed.dirty.dirtyResources)).toHaveLength(1);
    expect(mixedResource).toMatchObject({
      count: 2,
      jobKind: "reconcile",
      sourceProviderSlug: null,
      timingSourceProviderSlug: null,
    });
    expect(agreeing.dirty.sourceProviderCounts).toEqual({ unknown: 2 });
    expect(mixed.dirty.sourceProviderCounts).toEqual({ unknown: 2 });
    expect(Object.keys(agreeing.persistedDirtyResources)).toHaveLength(1);
    expect(Object.keys(mixed.persistedDirtyResources)).toHaveLength(1);
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
          eventToProviderSendBucket: "under_5_minutes",
          firstWebhookReceivedAt: "2026-05-26T12:00:00.000Z",
          providerSendToWebhookMs: 60_000,
          jobKind: "resource",
          maxAttempts: 1,
          payload: {
            ordinary: "y".repeat(1_000),
            webhookDataJson,
          },
          resource: "steps",
          resourceCategory: "timeseries",
          sourceProviderSlug: "garmin",
          timingSourceProviderSlug: "garmin",
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
    expect(dirtyResource?.maxAttempts).toBe(1);
    expect(dirtyResource?.payload?.ordinary).toHaveLength(512);
    expect(compactDirtyJson).not.toContain("webhookDataJson");
    expect(compactDirtyJson.length).toBeLessThan(128);
    expect(payloadRowJson).not.toContain(webhookDataJson);
    expect(typeof resourceEncrypted).toBe("string");
    expect(resourceEncrypted).toMatch(/^hsb-test:/u);
    const payloadId = createdPayloadData?.[0]?.id;
    if (typeof payloadId !== "string" || typeof resourceEncrypted !== "string") {
      throw new TypeError("Expected the dirty payload row to be persisted.");
    }
    await expect(openHostedDeviceSyncDirtyPayloadJson({
      connectionId: "dsc_junction_123",
      dirtyRevision: 1n,
      payloadId,
      provider: "junction",
      userId: "member_123",
      value: resourceEncrypted,
    })).resolves.toMatchObject({
      eventToProviderSendBucket: "under_5_minutes",
      firstWebhookReceivedAt: "2026-05-26T12:00:00.000Z",
      maxAttempts: 1,
      providerSendToWebhookMs: 60_000,
      timingSourceProviderSlug: "garmin",
    });
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

  it("reuses the durable payload id when a companion batch is retried at a later receipt time", async () => {
    installHostedSecureBoxStringTestCodec();
    try {
      const dirtyAt = new Date("2026-07-09T12:00:00.000Z");
      const payloadCreates: Array<Array<Record<string, unknown>>> = [];
      const dirtyRecord = {
        connectionId: "dsc_companion_123",
        createdAt: dirtyAt,
        dirtyResourcesJson: {},
        dirtyRevision: 7n,
        eventCount: 7n,
        firstDirtyAt: dirtyAt,
        latestDirtyAt: dirtyAt,
        latestEventType: "companion.health_metadata.v1",
        latestResourceCategory: "summary",
        latestTraceId: null,
        processedRevision: 6n,
        provider: "junction",
        resourceCategoryCountsJson: {},
        sourceProviderCountsJson: {},
        updatedAt: dirtyAt,
        userId: "member_123",
        windowEnd: null,
        windowStart: null,
      };
      const prisma = {
        $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
        deviceSyncDirtyConnection: {
          findUnique: vi.fn(async () => dirtyRecord),
          updateMany: vi.fn(async () => ({ count: 1 })),
        },
        deviceSyncDirtyPayload: {
          createMany: vi.fn(async (input: {
            data: Array<Record<string, unknown>>;
            skipDuplicates: boolean;
          }) => {
            payloadCreates.push(input.data);
            return { count: input.data.length };
          }),
        },
      };
      const store = new PrismaHostedDirtyConnectionStore(prisma as never);
      const webhookDataJson = JSON.stringify({
        records: [{ recordId: "a".repeat(64) }],
        schemaVersion: 1,
      });
      const resource = (occurredAt: string) => ({
        count: 1,
        jobKind: "resource",
        payload: {
          eventType: "companion.health_metadata.v1",
          occurredAt,
          resource: "companion_health_metadata",
          resourceCategory: "summary",
          sourceProviderSlug: "apple-health-kit",
          webhookDataJson,
        },
        resource: "companion_health_metadata",
        resourceCategory: "summary",
        sourceProviderSlug: "apple-health-kit",
        windowEnd: "2026-07-08T12:00:00.000Z",
        windowStart: "2026-07-08T04:00:00.000Z",
      });

      await store.upsertDirtyConnection({
        connectionId: dirtyRecord.connectionId,
        dirtyAt: "2026-07-09T12:00:00.000Z",
        eventType: "companion.health_metadata.v1",
        provider: "junction",
        resourceCategory: "summary",
        resources: [resource("2026-07-09T12:00:00.000Z")],
        userId: dirtyRecord.userId,
      });
      await store.upsertDirtyConnection({
        connectionId: dirtyRecord.connectionId,
        dirtyAt: "2026-07-09T12:05:00.000Z",
        eventType: "companion.health_metadata.v1",
        provider: "junction",
        resourceCategory: "summary",
        resources: [resource("2026-07-09T12:05:00.000Z")],
        userId: dirtyRecord.userId,
      });

      expect(payloadCreates).toHaveLength(2);
      expect(expectFirstPayloadCreateRow(payloadCreates[0] ?? []).id)
        .toBe(expectFirstPayloadCreateRow(payloadCreates[1] ?? []).id);
      expect(prisma.deviceSyncDirtyPayload.createMany).toHaveBeenCalledWith(expect.objectContaining({
        skipDuplicates: true,
      }));
      expect(prisma.deviceSyncDirtyConnection.updateMany).not.toHaveBeenCalled();
    } finally {
      installHostedSecureBoxStringTestCodec();
    }
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
