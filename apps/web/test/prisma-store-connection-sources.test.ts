import { describe, expect, it, vi } from "vitest";
import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/types";
import { HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT } from "@murphai/device-syncd/hosted-runtime";

import { readCompanionDeviceSyncStatus } from "@/src/lib/device-sync/companion";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type MutableConnectionSourceRecord = {
  id: string;
  connectionId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  displayName: string | null;
  status: string;
  resourceAvailabilitySummaryJson: Record<string, unknown> | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lifecycleEpoch?: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastDataAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type MutableSignalRecord = {
  id: number;
  userId: string;
  connectionId: string | null;
  provider: string;
  kind: string;
  occurredAt: Date | null;
  traceId: string | null;
  eventType: string | null;
  resourceCategory: string | null;
  sourceProviderSlug: string | null;
  reason: string | null;
  nextReconcileAt: Date | null;
  revokeWarningCode: string | null;
  revokeWarningMessage: string | null;
  createdAt: Date;
};

function createSourceStore(seed: MutableConnectionSourceRecord[] = []) {
  const records = new Map<string, MutableConnectionSourceRecord>();
  const signals: MutableSignalRecord[] = [];
  const deviceConnectionUpdate = vi.fn(async () => {
    throw new Error("source projection writes must not mutate device connection metadata");
  });

  for (const record of seed) {
    records.set(sourceMapKey(record.connectionId, record.sourceInstanceKey), cloneSourceRecord(record));
  }

  const upsert = vi.fn(async (input: {
    where: {
      connectionId_sourceInstanceKey: {
        connectionId: string;
        sourceInstanceKey: string;
      };
    };
    create: Partial<MutableConnectionSourceRecord>;
    update: Partial<MutableConnectionSourceRecord>;
  }) => {
    const key = sourceMapKey(
      input.where.connectionId_sourceInstanceKey.connectionId,
      input.where.connectionId_sourceInstanceKey.sourceInstanceKey,
    );
    const existing = records.get(key);

    if (existing) {
      const updated = {
        ...existing,
        ...input.update,
        resourceAvailabilitySummaryJson: Object.prototype.hasOwnProperty.call(
            input.update,
            "resourceAvailabilitySummaryJson",
          )
          ? readJsonObject(input.update.resourceAvailabilitySummaryJson)
          : existing.resourceAvailabilitySummaryJson,
        updatedAt: new Date("2026-03-25T04:00:00.000Z"),
      };
      records.set(key, updated);
      return cloneSourceRecord(updated);
    }

    const created = {
      id: requireString(input.create.id),
      connectionId: requireString(input.create.connectionId),
      sourceInstanceKey: requireString(input.create.sourceInstanceKey),
      sourceProviderSlug: requireString(input.create.sourceProviderSlug),
      displayName: readNullableString(input.create.displayName),
      status: requireString(input.create.status),
      resourceAvailabilitySummaryJson: readJsonObject(input.create.resourceAvailabilitySummaryJson),
      lastErrorCode: readNullableString(input.create.lastErrorCode),
      lastErrorMessage: readNullableString(input.create.lastErrorMessage),
      lifecycleEpoch: typeof input.create.lifecycleEpoch === "number"
        ? input.create.lifecycleEpoch
        : null,
      firstSeenAt: requireDate(input.create.firstSeenAt),
      lastSeenAt: requireDate(input.create.lastSeenAt),
      lastDataAt: input.create.lastDataAt ?? null,
      createdAt: new Date("2026-03-25T00:00:00.000Z"),
      updatedAt: new Date("2026-03-25T00:00:00.000Z"),
    } satisfies MutableConnectionSourceRecord;
    records.set(key, created);
    return cloneSourceRecord(created);
  });

  const findMany = vi.fn(async (input: {
    take?: number;
    where: {
      connectionId: string;
      sourceProviderSlug?: {
        in: string[];
      };
      status?: {
        not?: string;
      };
    };
  }) => {
    const sorted = [...records.values()]
      .filter((record) => record.connectionId === input.where.connectionId)
      .filter((record) =>
        input.where.sourceProviderSlug?.in
          ? input.where.sourceProviderSlug.in.includes(record.sourceProviderSlug)
          : true
      )
      .filter((record) =>
        input.where.status?.not ? record.status !== input.where.status.not : true
      )
      .sort((left, right) =>
        right.lastSeenAt.getTime() - left.lastSeenAt.getTime()
        || left.sourceProviderSlug.localeCompare(right.sourceProviderSlug)
        || left.sourceInstanceKey.localeCompare(right.sourceInstanceKey)
        || left.id.localeCompare(right.id),
      );
    const limited = input.take === undefined ? sorted : sorted.slice(0, input.take);

    return limited.map(cloneSourceRecord);
  });

  const updateMany = vi.fn(async (input: {
    where: {
      connectionId: string;
      sourceProviderSlug?: string;
      status?: {
        not?: string;
      };
      OR?: Array<{ lastDataAt: null | { lt: Date } }>;
    };
    data: Partial<MutableConnectionSourceRecord>;
  }) => {
    let count = 0;

    for (const [key, record] of records.entries()) {
      if (record.connectionId !== input.where.connectionId) {
        continue;
      }

      if (
        input.where.sourceProviderSlug !== undefined
        && record.sourceProviderSlug !== input.where.sourceProviderSlug
      ) {
        continue;
      }

      if (input.where.OR && !input.where.OR.some((clause) =>
        clause.lastDataAt === null
          ? record.lastDataAt === null
          : record.lastDataAt !== null && record.lastDataAt.getTime() < clause.lastDataAt.lt.getTime()
      )) {
        continue;
      }

      if (input.where.status?.not && record.status === input.where.status.not) {
        continue;
      }

      records.set(key, {
        ...record,
        ...input.data,
      });
      count += 1;
    }

    return { count };
  });

  const createSignal = vi.fn(async (input: {
    data: Omit<MutableSignalRecord, "id">;
  }) => {
    const record = {
      ...input.data,
      id: signals.length + 1,
    } satisfies MutableSignalRecord;
    signals.push(record);
    return { ...record };
  });

  const findSignals = vi.fn(async (input: {
    take: number;
    where: {
      connectionId: { in: string[] };
      kind: string;
      sourceProviderSlug?: string;
      userId: string;
    };
  }) =>
    signals
      .filter((signal) => signal.userId === input.where.userId)
      .filter((signal) => signal.kind === input.where.kind)
      .filter((signal) =>
        signal.connectionId !== null
        && input.where.connectionId.in.includes(signal.connectionId)
      )
      .filter((signal) =>
        input.where.sourceProviderSlug === undefined
        || signal.sourceProviderSlug === input.where.sourceProviderSlug
      )
      .sort((left, right) => right.id - left.id)
      .slice(0, input.take)
      .map((signal) => ({ ...signal })));

  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: {
      deviceConnection: {
        update: deviceConnectionUpdate,
      },
      deviceConnectionSource: {
        findMany,
        updateMany,
        upsert,
      },
      deviceSyncSignal: {
        create: createSignal,
        findMany: findSignals,
      },
    } as never,
  });

  return {
    deviceConnectionUpdate,
    findMany,
    records,
    signals,
    store,
    updateMany,
    upsert,
  };
}

describe("PrismaDeviceSyncControlPlaneStore connection source projection", () => {
  it("keeps multiple upstream source instances under one parent connection from collapsing", async () => {
    const { deviceConnectionUpdate, records, store } = createSourceStore();

    const first = await store.upsertConnectionSource({
      connectionId: "dsc_parent",
      sourceInstanceKey: "src_oura_hash_a",
      sourceProviderSlug: "oura",
      displayName: "  Oura Ring A  ",
      status: "connected",
      resourceAvailabilitySummary: {
        available: true,
        deviceId: "provider-device-identifier",
        note: "provider-device-identifier",
        profile: true,
        resourceCount: 2,
        serialNumber: "provider-serial-identifier",
        sleep: "available",
      },
      firstSeenAt: "2026-03-25T00:00:00.000Z",
      lastSeenAt: "2026-03-25T01:00:00.000Z",
    });
    const second = await store.upsertConnectionSource({
      connectionId: "dsc_parent",
      sourceInstanceKey: "src_oura_hash_b",
      sourceProviderSlug: "oura",
      displayName: "Oura Ring B",
      status: "connected",
      resourceAvailabilitySummary: {
        profile: true,
      },
      firstSeenAt: "2026-03-25T00:05:00.000Z",
      lastSeenAt: "2026-03-25T01:05:00.000Z",
    });
    const updatedFirst = await store.upsertConnectionSource({
      connectionId: "dsc_parent",
      sourceInstanceKey: "src_oura_hash_a",
      sourceProviderSlug: "oura",
      displayName: "Oura Ring A",
      status: "error",
      resourceAvailabilitySummary: {
        available: false,
        profile: true,
      },
      lastErrorCode: "temporary_failure",
      lastErrorMessage: "Provider returned source-specific detail that should not be stored.",
      lastSeenAt: "2026-03-25T02:00:00.000Z",
    });

    expect(records.size).toBe(2);
    expect(first.sourceInstanceKey).toBe("src_oura_hash_a");
    expect(second.sourceInstanceKey).toBe("src_oura_hash_b");
    expect(updatedFirst).toMatchObject({
      connectionId: "dsc_parent",
      displayName: "Oura Ring A",
      lastErrorCode: "TEMPORARY_FAILURE",
      lastErrorMessage: null,
      sourceInstanceKey: "src_oura_hash_a",
      sourceProviderSlug: "oura",
      status: "error",
    });
    expect(first.resourceAvailabilitySummary).toEqual({
      available: true,
      profile: true,
      resourceCount: 2,
      sleep: "available",
    });
    expect(deviceConnectionUpdate).not.toHaveBeenCalled();
  });

  it("preserves optional source fields when partial updates omit them", async () => {
    const { store } = createSourceStore();

    await store.upsertConnectionSource({
      connectionId: "dsc_parent",
      sourceInstanceKey: "src_oura_hash_a",
      sourceProviderSlug: "oura",
      displayName: "Oura Ring A",
      status: "connected",
      resourceAvailabilitySummary: {
        profile: true,
        sleep: "available",
      },
      lastSeenAt: "2026-03-25T01:00:00.000Z",
    });

    const updated = await store.upsertConnectionSource({
      connectionId: "dsc_parent",
      sourceInstanceKey: "src_oura_hash_a",
      sourceProviderSlug: "oura",
      status: "error",
      lastErrorCode: "SOURCE_UNAVAILABLE",
      lastErrorMessage: "temporary provider detail",
      lastSeenAt: "2026-03-25T02:00:00.000Z",
    });

    expect(updated).toMatchObject({
      displayName: "Oura Ring A",
      firstSeenAt: "2026-03-25T01:00:00.000Z",
      lastErrorCode: "SOURCE_UNAVAILABLE",
      resourceAvailabilitySummary: {
        profile: true,
        sleep: "available",
      },
      status: "error",
    });
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["zero", 0],
  ])("reads a legacy %s lifecycle epoch as the original epoch", async (_label, lifecycleEpoch) => {
    const { store } = createSourceStore([
      createSourceRecord({ lifecycleEpoch }),
    ]);

    await expect(store.listConnectionSources("dsc_parent")).resolves.toEqual([
      expect.objectContaining({ lifecycleEpoch: 1 }),
    ]);
  });

  it("rejects an explicit nonpositive lifecycle epoch before a new write", async () => {
    const { store, upsert } = createSourceStore();

    await expect(store.upsertConnectionSource({
      connectionId: "dsc_parent",
      lifecycleEpoch: 0,
      sourceInstanceKey: "src_oura_hash_a",
      sourceProviderSlug: "oura",
    })).rejects.toMatchObject({
      code: "CONNECTION_SOURCE_LIFECYCLE_EPOCH_INVALID",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("lists connection sources with deterministic ordering", async () => {
    const { findMany, store } = createSourceStore([
      createSourceRecord({
        id: "dcs_3",
        sourceInstanceKey: "src_withings_b",
        sourceProviderSlug: "withings",
        lastSeenAt: new Date("2026-03-25T01:00:00.000Z"),
      }),
      createSourceRecord({
        id: "dcs_2",
        sourceInstanceKey: "src_oura_c",
        sourceProviderSlug: "oura",
        lastSeenAt: new Date("2026-03-25T02:00:00.000Z"),
      }),
      createSourceRecord({
        id: "dcs_1",
        sourceInstanceKey: "src_oura_a",
        sourceProviderSlug: "oura",
        lastSeenAt: new Date("2026-03-25T02:00:00.000Z"),
      }),
    ]);

    await expect(store.listConnectionSources("dsc_parent")).resolves.toEqual([
      expect.objectContaining({
        id: "dcs_1",
        sourceInstanceKey: "src_oura_a",
      }),
      expect.objectContaining({
        id: "dcs_2",
        sourceInstanceKey: "src_oura_c",
      }),
      expect.objectContaining({
        id: "dcs_3",
        sourceInstanceKey: "src_withings_b",
      }),
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { lastSeenAt: "desc" },
        { sourceProviderSlug: "asc" },
        { sourceInstanceKey: "asc" },
        { id: "asc" },
      ],
      where: {
        connectionId: "dsc_parent",
      },
    }));
  });

  it("marks all non-disconnected sources for one parent connection disconnected", async () => {
    const { records, store, updateMany } = createSourceStore([
      createSourceRecord({
        id: "dcs_parent_connected",
        sourceInstanceKey: "src_oura_a",
        status: "connected",
      }),
      createSourceRecord({
        id: "dcs_parent_error",
        sourceInstanceKey: "src_garmin_a",
        sourceProviderSlug: "garmin",
        status: "error",
        lastErrorCode: "SOURCE_UNAVAILABLE",
        lastErrorMessage: "temporary provider detail",
      }),
      createSourceRecord({
        id: "dcs_parent_disconnected",
        sourceInstanceKey: "src_strava_a",
        sourceProviderSlug: "strava",
        status: "disconnected",
        updatedAt: new Date("2026-03-25T03:00:00.000Z"),
      }),
      createSourceRecord({
        id: "dcs_other_connected",
        connectionId: "dsc_other",
        sourceInstanceKey: "src_oura_other",
        status: "connected",
      }),
    ]);

    await expect(store.markConnectionSourcesDisconnected({
      connectionId: "dsc_parent",
      now: "2026-03-26T12:00:00.000Z",
    })).resolves.toBe(2);

    expect(records.get(sourceMapKey("dsc_parent", "src_oura_a"))).toMatchObject({
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: new Date("2026-03-26T12:00:00.000Z"),
      status: "disconnected",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    });
    expect(records.get(sourceMapKey("dsc_parent", "src_garmin_a"))).toMatchObject({
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: new Date("2026-03-26T12:00:00.000Z"),
      status: "disconnected",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    });
    expect(records.get(sourceMapKey("dsc_parent", "src_strava_a"))).toMatchObject({
      status: "disconnected",
      updatedAt: new Date("2026-03-25T03:00:00.000Z"),
    });
    expect(records.get(sourceMapKey("dsc_other", "src_oura_other"))).toMatchObject({
      status: "connected",
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastSeenAt: new Date("2026-03-26T12:00:00.000Z"),
        status: "disconnected",
      }),
      where: {
        connectionId: "dsc_parent",
        status: {
          not: "disconnected",
        },
      },
    }));
  });

  it("rejects raw provider identifiers as source instance keys", async () => {
    const { store, upsert } = createSourceStore();

    await expect(store.upsertConnectionSource({
      connectionId: "dsc_parent",
      sourceInstanceKey: "oura:provider-device-identifier",
      sourceProviderSlug: "oura",
      displayName: "Oura",
    })).rejects.toMatchObject({
      code: "CONNECTION_SOURCE_INSTANCE_KEY_INVALID",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("records source data arrival on the production store, scoped and forward-only", async () => {
    const { store } = createSourceStore();

    for (const sourceProviderSlug of ["garmin", "oura"]) {
      await store.upsertConnectionSource({
        connectionId: "dsc_parent",
        sourceInstanceKey: `src_${sourceProviderSlug}`,
        sourceProviderSlug,
        status: "connected",
        firstSeenAt: "2026-07-01T00:00:00.000Z",
        lastSeenAt: "2026-07-01T00:00:00.000Z",
      });
    }

    const readBySlug = async () =>
      new Map(
        (await store.listConnectionSources("dsc_parent")).map((source) => [
          source.sourceProviderSlug,
          source,
        ]),
      );

    expect((await readBySlug()).get("garmin")?.lastDataAt).toBeNull();

    expect(
      await store.markConnectionSourceDataReceived({
        connectionId: "dsc_parent",
        now: "2026-07-05T00:00:00.000Z",
        sourceProviderSlug: "garmin",
      }),
    ).toBe(1);

    const afterArrival = await readBySlug();
    expect(afterArrival.get("garmin")?.lastDataAt).toBe("2026-07-05T00:00:00.000Z");
    expect(afterArrival.get("garmin")?.lastSeenAt).toBe("2026-07-01T00:00:00.000Z");
    expect(afterArrival.get("garmin")?.updatedAt).toBe("2026-07-05T00:00:00.000Z");
    // A live sibling on the same connection must not mask a silent source.
    expect(afterArrival.get("oura")?.lastDataAt).toBeNull();

    // Out-of-order redelivery cannot rewind the signal a stall is measured from.
    expect(
      await store.markConnectionSourceDataReceived({
        connectionId: "dsc_parent",
        now: "2026-07-03T00:00:00.000Z",
        sourceProviderSlug: "garmin",
      }),
    ).toBe(0);
    expect((await readBySlug()).get("garmin")?.lastDataAt).toBe("2026-07-05T00:00:00.000Z");

    // The reconcile projection refreshes lastSeenAt without claiming delivery.
    await store.upsertConnectionSource({
      connectionId: "dsc_parent",
      sourceInstanceKey: "src_garmin",
      sourceProviderSlug: "garmin",
      status: "connected",
      lastSeenAt: "2026-07-12T00:00:00.000Z",
    });
    const afterReconcile = await readBySlug();
    expect(afterReconcile.get("garmin")?.lastSeenAt).toBe("2026-07-12T00:00:00.000Z");
    expect(afterReconcile.get("garmin")?.lastDataAt).toBe("2026-07-05T00:00:00.000Z");
  });

  it("uses one hard-bounded set source projection and fails closed on saturation", async () => {
    const projectedRows = Array.from(
      { length: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT },
      (_, index) => ({
        ...createSourceRecord({
          id: `dcs_${String(index).padStart(2, "0")}`,
          lifecycleEpoch: 2,
          sourceInstanceKey: `src_${String(index).padStart(2, "0")}`,
          sourceProviderSlug: index % 2 === 0 ? "whoop" : "whoop_v2",
        }),
        projectionRowNumber: BigInt(index + 1),
      }),
    );
    const queryRaw = vi.fn(async (query: unknown) => {
      void query;
      return projectedRows;
    });
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $queryRaw: queryRaw,
      } as never,
    });

    const projected = await store.listBoundedConnectionSourcesForConnections({
      connectionIds: ["dsc_parent", "dsc_parent"],
      excludeDisconnected: true,
      limitPerConnection: 1_000,
      sourceProviderSlugs: ["whoop", "whoop_v2"],
    });
    expect(projected).toHaveLength(HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT);
    expect(projected[0]?.lifecycleEpoch).toBe(2);

    expect(queryRaw).toHaveBeenCalledOnce();
    const query = queryRaw.mock.calls[0]?.[0] as {
      strings?: readonly string[];
      values?: readonly unknown[];
    };
    expect(query.strings?.join(" ")).toContain("ROW_NUMBER() OVER");
    expect(query.strings?.join(" ")).toContain('lifecycle_epoch AS "lifecycleEpoch"');
    expect(query.strings?.join(" ")).toContain("status <> 'disconnected'");
    expect(query.values).toContain(
      HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT + 1,
    );
    expect(query.values).not.toContain(1_001);

    queryRaw.mockResolvedValueOnce([{
      ...createSourceRecord({
        id: "dcs_saturated",
        sourceInstanceKey: "src_saturated",
        sourceProviderSlug: "whoop",
      }),
      projectionRowNumber: 33n,
    }]);

    await expect(store.listBoundedConnectionSourcesForConnections({
      connectionIds: ["dsc_parent"],
      limitPerConnection: 32,
      sourceProviderSlugs: ["whoop"],
    })).rejects.toMatchObject({
      code: "CONNECTION_SOURCE_SNAPSHOT_SATURATED",
      retryable: false,
    });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("keeps the same-request receipt authoritative after source-arrival bookkeeping", async () => {
    const acceptedAt = "2026-07-25T19:00:00.000Z";
    const { store } = createSourceStore([
      createSourceRecord({
        connectionId: "dsc_parent",
        sourceInstanceKey: "src_health_connect",
        sourceProviderSlug: "health_connect",
        status: "disconnected",
        lastSeenAt: new Date("2026-07-25T18:00:00.000Z"),
        updatedAt: new Date("2026-07-25T18:00:00.000Z"),
      }),
    ]);
    const connection: PublicDeviceSyncAccount = {
      accessTokenExpiresAt: null,
      connectedAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      displayName: null,
      externalAccountId: "junction-user",
      id: "dsc_parent",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: acceptedAt,
      metadata: {},
      nextReconcileAt: null,
      provider: "junction",
      scopes: [],
      setupExpiresAt: null,
      setupPhase: "source_confirmed",
      status: "active",
      updatedAt: acceptedAt,
    };
    vi.spyOn(store, "listMemberConnectionStatuses").mockResolvedValue([{
      id: connection.id,
      status: "active",
    }]);

    // This is the production ordering after durable webhook acceptance: write
    // the receipt at T, then best-effort stamp source data arrival at the same
    // T without changing the lagging negative source projection.
    await store.createSignal({
      connectionId: connection.id,
      createdAt: acceptedAt,
      eventType: "daily.data.workouts.updated",
      kind: "webhook_hint",
      occurredAt: acceptedAt,
      provider: "junction",
      resourceCategory: "timeseries",
      sourceProviderSlug: "health_connect",
      traceId: "trace_health_connect",
      userId: "member_1",
    });
    await store.markConnectionSourceDataReceived({
      connectionId: connection.id,
      now: acceptedAt,
      sourceProviderSlug: "health_connect",
    });

    const [source] = await store.listConnectionSources(connection.id);
    expect(source).toMatchObject({
      lastDataAt: acceptedAt,
      lastSeenAt: "2026-07-25T18:00:00.000Z",
      status: "disconnected",
      updatedAt: acceptedAt,
    });
    vi.spyOn(store, "listBoundedConnectionSourcesForConnections").mockResolvedValue(
      source ? [source] : [],
    );
    await expect(readCompanionDeviceSyncStatus({
      memberId: "member_1",
      now: () => new Date("2026-07-25T20:00:00.000Z"),
      sourceProviderSlug: "health_connect",
      store,
    })).resolves.toEqual({
      lastDataReceivedAt: acceptedAt,
      observedAt: "2026-07-25T20:00:00.000Z",
      resources: {
        workouts: { lastReceivedAt: acceptedAt },
      },
    });
  });
});

function createSourceRecord(
  overrides: Partial<MutableConnectionSourceRecord> = {},
): MutableConnectionSourceRecord {
  return {
    id: "dcs_1",
    connectionId: "dsc_parent",
    sourceInstanceKey: "src_oura_a",
    sourceProviderSlug: "oura",
    displayName: "Oura",
    status: "connected",
    resourceAvailabilitySummaryJson: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lifecycleEpoch: 1,
    firstSeenAt: new Date("2026-03-25T00:00:00.000Z"),
    lastSeenAt: new Date("2026-03-25T01:00:00.000Z"),
    lastDataAt: null,
    createdAt: new Date("2026-03-25T00:00:00.000Z"),
    updatedAt: new Date("2026-03-25T00:00:00.000Z"),
    ...overrides,
  };
}

function cloneSourceRecord(record: MutableConnectionSourceRecord): MutableConnectionSourceRecord {
  return {
    ...record,
    resourceAvailabilitySummaryJson: record.resourceAvailabilitySummaryJson
      ? { ...record.resourceAvailabilitySummaryJson }
      : null,
  };
}

function sourceMapKey(connectionId: string, sourceInstanceKey: string): string {
  return `${connectionId}:${sourceInstanceKey}`;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Expected string");
  }

  return value;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requireDate(value: unknown): Date {
  if (!(value instanceof Date)) {
    throw new TypeError("Expected Date");
  }

  return value;
}

function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return { ...(value as Record<string, unknown>) };
}
