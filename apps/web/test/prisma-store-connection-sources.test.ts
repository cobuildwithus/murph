import { describe, expect, it, vi } from "vitest";

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
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function createSourceStore(seed: MutableConnectionSourceRecord[] = []) {
  const records = new Map<string, MutableConnectionSourceRecord>();
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
      firstSeenAt: requireDate(input.create.firstSeenAt),
      lastSeenAt: requireDate(input.create.lastSeenAt),
      createdAt: new Date("2026-03-25T00:00:00.000Z"),
      updatedAt: new Date("2026-03-25T00:00:00.000Z"),
    } satisfies MutableConnectionSourceRecord;
    records.set(key, created);
    return cloneSourceRecord(created);
  });

  const findMany = vi.fn(async ({ where }: { where: { connectionId: string } }) =>
    [...records.values()]
      .filter((record) => record.connectionId === where.connectionId)
      .sort((left, right) =>
        right.lastSeenAt.getTime() - left.lastSeenAt.getTime()
        || left.sourceProviderSlug.localeCompare(right.sourceProviderSlug)
        || left.sourceInstanceKey.localeCompare(right.sourceInstanceKey)
        || left.id.localeCompare(right.id),
      )
      .map(cloneSourceRecord),
  );

  const updateMany = vi.fn(async (input: {
    where: {
      connectionId: string;
      status?: {
        not?: string;
      };
    };
    data: Partial<MutableConnectionSourceRecord>;
  }) => {
    let count = 0;

    for (const [key, record] of records.entries()) {
      if (record.connectionId !== input.where.connectionId) {
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
    } as never,
  });

  return {
    deviceConnectionUpdate,
    findMany,
    records,
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
      lastErrorCode: "SOURCE_UNAVAILABLE",
      resourceAvailabilitySummary: {
        profile: true,
        sleep: "available",
      },
      status: "error",
    });
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
      status: "disconnected",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    });
    expect(records.get(sourceMapKey("dsc_parent", "src_garmin_a"))).toMatchObject({
      lastErrorCode: null,
      lastErrorMessage: null,
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
    firstSeenAt: new Date("2026-03-25T00:00:00.000Z"),
    lastSeenAt: new Date("2026-03-25T01:00:00.000Z"),
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
