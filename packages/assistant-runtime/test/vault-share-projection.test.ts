import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildHostedVaultShareActivityDistanceProjectionScope,
  buildHostedVaultShareActivityMinutesProjectionScope,
  buildHostedVaultShareActivitySessionCountProjectionScope,
  getHostedVaultShareActivityDistanceProjectionSpec,
  getHostedVaultShareActivityMinutesProjectionSpec,
  getHostedVaultShareActivitySessionCountProjectionSpec,
  getHostedVaultShareDailyMetricProjectionSpec,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
  hostedVaultShareProjectionKindToScope,
  parseHostedVaultShareDeliverRequest,
  type HostedVaultShareDeliverRequest,
} from "@murphai/hosted-execution/vault-share";
import {
  selectMetricSeries,
  type MetricPoint,
  type MetricSeriesPoint,
} from "@murphai/query";
import { describe, expect, it, vi } from "vitest";

import {
  applyHostedVaultShareRevokeWake,
  importHostedVaultShareDeliveryWake,
  prepareSharedVaultShareModelView,
} from "../src/hosted-runtime/vault-share-import.ts";
import {
  HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS,
  offerHostedVaultShareProjectionBestEffort,
  readProjectableDeviceSyncStatus,
  readProjectableActivityDistanceDays,
  readProjectableActivityMinutesDays,
  readProjectableActivitySessionCountDays,
  readProjectableDailyMetricDays,
  readProjectableProfileName,
  selectProjectableDailyMetricDays,
  selectProjectableActivityDistanceDays,
  selectProjectableActivityMinutesDays,
  selectProjectableActivitySessionCountDays,
  selectProjectableHeartRateZoneDays,
  selectProjectableSleepNights,
  selectProjectableWorkoutDays,
  type ActivitySessionProjectionRow,
} from "../src/hosted-runtime/vault-share-projection.ts";
import type { HostedRuntimeDeviceSyncPort } from "../src/hosted-runtime/platform.ts";
import {
  CURRENT_VAULT_FORMAT_VERSION,
  createEmptyMemoryDocument,
  formatMemoryDisplayNameRecordText,
  renderMemoryDocument,
  setMemoryDisplayName,
  upsertMemoryRecord,
} from "@murphai/contracts";

const NIGHT = {
  date: "2026-06-09",
  sleepEndAt: "2026-06-10T06:31:00.000Z",
  sleepStartAt: "2026-06-09T22:04:00.000Z",
};

const RECORD = {
  data: NIGHT,
  occurredAt: `${NIGHT.date}T00:00:00.000Z`,
  recordKey: NIGHT.date,
};

const SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("sleep-times.v0");
const GROUP_EMAIL_SCOPE = hostedVaultShareProjectionKindToScope("group-email.v0");
const PROFILE_SCOPE = hostedVaultShareProjectionKindToScope("profile-name.v0");
const DEVICE_SYNC_STATUS_SCOPE = hostedVaultShareProjectionKindToScope(
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
);
const RUNNING_SCOPE = buildHostedVaultShareActivityMinutesProjectionScope({
  activityKind: "running",
});
const RUNNING_DISTANCE_SCOPE = buildHostedVaultShareActivityDistanceProjectionScope({
  activityKind: "running",
});
const RUNNING_SESSION_COUNT_SCOPE = buildHostedVaultShareActivitySessionCountProjectionScope({
  activityKind: "running",
});
const WALKING_SCOPE = buildHostedVaultShareActivityMinutesProjectionScope({
  activityKind: "walking",
});
const SAUNA_SCOPE = buildHostedVaultShareActivityMinutesProjectionScope({
  activityKind: "sauna",
});

const ACTIVITY_DAY = {
  date: "2026-07-03",
  metricKey: "activity-minutes",
  unit: "minutes",
  value: 73,
};

const ACTIVITY_RECORD = {
  data: ACTIVITY_DAY,
  occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
  recordKey: ACTIVITY_DAY.date,
};

const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9_-]{32}$/u;

type DeviceSyncSnapshot = Awaited<
  ReturnType<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>
>;

function createDeviceSyncPort(
  fetchSnapshot: HostedRuntimeDeviceSyncPort["fetchSnapshot"],
): HostedRuntimeDeviceSyncPort {
  const unused = async (): Promise<never> => {
    throw new Error("Unused device-sync operation.");
  };
  return {
    ackDirtyStateProcessed: unused,
    applyUpdates: unused,
    createConnectLink: unused,
    fetchDirtyStates: unused,
    fetchSnapshot,
  };
}

function buildDeviceSyncSnapshot(): DeviceSyncSnapshot {
  return {
    connections: [
      {
        connection: {
          accessTokenExpiresAt: null,
          connectedAt: "2026-07-01T00:00:00.000Z",
          createdAt: "2026-07-01T00:00:00.000Z",
          displayName: "Private account label",
          externalAccountId: "private-external-account",
          id: "private-connection-id",
          metadata: { privateMetadata: true },
          provider: "junction",
          scopes: ["private:scope"],
          setupPhase: "source_confirmed",
          status: "active",
          updatedAt: "2026-07-15T10:00:00.000Z",
        },
        credential: {
          credentialMetadata: { privateCredentialMetadata: true },
          kind: "oauth_tokens_redacted",
          tokenVersion: 7,
        },
        localState: {
          lastErrorCode: "PRIVATE_ERROR_CODE",
          lastErrorMessage: "Private provider error detail",
          lastSyncCompletedAt: "2026-07-15T09:30:00.000Z",
          lastSyncErrorAt: "2026-07-15T09:45:00.000Z",
          lastSyncStartedAt: "2026-07-15T09:29:00.000Z",
          lastWebhookAt: "2026-07-15T09:50:00.000Z",
          nextReconcileAt: "2026-07-16T09:30:00.000Z",
        },
        sources: [
          {
            displayName: "Private WHOOP account",
            firstSeenAt: "2026-07-01T00:00:00.000Z",
            lastErrorCode: "PRIVATE_SOURCE_ERROR",
            lastErrorMessage: "Private source error detail",
            lastSeenAt: "2026-07-15T09:45:00.000Z",
            resourceAvailabilitySummary: { privateResource: "detail" },
            resourceCount: 42,
            sourceInstanceKey: "private-source-instance",
            sourceProviderSlug: "whoop_v2",
            status: "error",
          },
        ],
      },
      {
        connection: {
          accessTokenExpiresAt: null,
          connectedAt: "2026-07-02T00:00:00.000Z",
          createdAt: "2026-07-02T00:00:00.000Z",
          displayName: null,
          externalAccountId: "private-direct-account",
          id: "private-direct-connection",
          metadata: {},
          provider: "oura",
          scopes: [],
          status: "reauthorization_required",
          updatedAt: "2026-07-15T10:30:00.000Z",
        },
        credential: {
          credentialMetadata: {},
          kind: "none",
        },
        localState: {
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          lastSyncStartedAt: null,
          lastWebhookAt: null,
          nextReconcileAt: null,
        },
      },
    ],
    generatedAt: "2026-07-16T09:12:00.000Z",
    userId: "private-user-id",
  };
}

type WorkoutMetricRow = Pick<
  MetricSeriesPoint,
  | "date"
  | "grain"
  | "metricKey"
  | "observedAt"
  | "pointIds"
  | "recordIds"
  | "sourceFamily"
  | "sourceKind"
  | "statistic"
  | "value"
>;

function workoutMetricRow(input: {
  date: string;
  metricKey: "activity-minutes" | "workout-count";
  recordIds?: string[];
  value: number;
}): WorkoutMetricRow {
  const recordIds = input.recordIds ?? [`evt_activity_${input.date}`];
  return {
    date: input.date,
    grain: "day",
    metricKey: input.metricKey,
    observedAt: `${input.date}T00:00:00.000Z`,
    pointIds: [`point_${input.metricKey}_${input.value}_${recordIds.join("_")}`],
    recordIds,
    sourceFamily: "derived",
    sourceKind: "activity-summary",
    statistic: "value",
    value: input.value,
  };
}

function workoutRows(input: {
  countRecordIds?: string[];
  date: string;
  minuteRecordIds?: string[];
  workoutCount: number;
  workoutMinutes: number;
}): {
  countRows: WorkoutMetricRow[];
  minuteRows: WorkoutMetricRow[];
  nowMs: number;
} {
  const recordIds = [`evt_activity_${input.date}`];
  return {
    countRows: [workoutMetricRow({
      date: input.date,
      metricKey: "workout-count",
      recordIds: input.countRecordIds ?? recordIds,
      value: input.workoutCount,
    })],
    minuteRows: [workoutMetricRow({
      date: input.date,
      metricKey: "activity-minutes",
      recordIds: input.minuteRecordIds ?? recordIds,
      value: input.workoutMinutes,
    })],
    nowMs: Date.parse("2026-07-04T00:00:00.000Z"),
  };
}

function activitySessionRow(input: {
  activityKind: string | null;
  date: string;
  distanceMeters?: number | null;
  durationMinutes?: number | null;
  endedAt?: string | null;
  recordIds?: string[];
  startedAt?: string | null;
}): ActivitySessionProjectionRow {
  const recordIds = input.recordIds ?? [`evt_${input.activityKind ?? "unknown"}_${input.date}`];
  return {
    activityKind: input.activityKind,
    date: input.date,
    ...(input.distanceMeters === undefined ? {} : { distanceMeters: input.distanceMeters }),
    ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }),
    endedAt: input.endedAt ?? null,
    observedAt: `${input.date}T12:00:00.000Z`,
    pointIds: [`point_${recordIds.join("_")}`],
    recordIds,
    sourceFamily: "event",
    sourceKind: "activity_session",
    startedAt: input.startedAt ?? `${input.date}T12:00:00.000Z`,
  };
}

async function createActivitySessionVault(
  records: readonly Record<string, unknown>[],
): Promise<string> {
  const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-activity-session-"));
  await mkdir(join(vaultRoot, "ledger", "events", "2026"), { recursive: true });
  await writeFile(
    join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4C",
      createdAt: "2026-07-03T00:00:00.000Z",
      title: "Vault share activity session test",
      timezone: "UTC",
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(vaultRoot, "ledger", "events", "2026", "2026-07.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  return vaultRoot;
}

async function createMemoryDisplayNameVault(displayName: string | null): Promise<string> {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-share-memory-name-"));
  if (!displayName) {
    return vaultRoot;
  }

  const document = setMemoryDisplayName(
    createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z")),
    {
      displayName,
      now: new Date("2026-07-01T00:00:00.000Z"),
    },
  ).document;
  await mkdir(join(vaultRoot, "bank"), { recursive: true });
  await writeFile(
    join(vaultRoot, "bank", "memory.md"),
    renderMemoryDocument({ document }),
    "utf8",
  );

  return vaultRoot;
}

async function createLegacyMemoryDisplayNameVault(...texts: string[]): Promise<string> {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-share-memory-name-"));
  let document = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));
  for (const [index, text] of texts.entries()) {
    document = upsertMemoryRecord(document, {
      now: new Date(Date.parse("2026-07-01T00:00:00.000Z") + (index + 1) * 1000),
      section: "Identity",
      text,
    }).document;
  }

  await mkdir(join(vaultRoot, "bank"), { recursive: true });
  await writeFile(
    join(vaultRoot, "bank", "memory.md"),
    renderMemoryDocument({ document }),
    "utf8",
  );

  return vaultRoot;
}

async function createLegacyProfileDisplayNameVault(displayName: string): Promise<string> {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-share-legacy-profile-name-"));
  await mkdir(join(vaultRoot, "bank"), { recursive: true });
  await writeFile(
    join(vaultRoot, "bank", "profile.md"),
    [
      "---",
      "docType: profile",
      "schemaVersion: 1",
      `displayName: ${JSON.stringify(displayName)}`,
      "updatedAt: 2026-07-01T00:00:00.000Z",
      "---",
      "# Profile",
      "",
    ].join("\n"),
    "utf8",
  );
  return vaultRoot;
}

describe("offerHostedVaultShareProjectionBestEffort", () => {
  it("is a no-op without a vault-share port", async () => {
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/nonexistent",
      vaultSharePort: null,
    });

    expect(result.outcome).toBe("no-port");
  });

  it("offers projectable records and reports delivery", async () => {
    const vaultRoot = await createMemoryDisplayNameVault("Theo");
    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => [PROFILE_SCOPE],
      },
    });

    expect(result.outcome).toBe("delivered");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({
      projectionKind: "profile-name.v0",
      projectionScope: PROFILE_SCOPE,
      records: [{
        data: { displayName: "Theo" },
        occurredAt: "2026-07-01T00:00:00.000Z",
        recordKey: "profile-name",
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }],
    });
  });

  it("does not read or deliver payloads when the control plane reports no active kinds", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/nonexistent",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => [],
      },
    });

    expect(result.outcome).toBe("no-active-share");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("skips email delivery authorization grants because they carry no records", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/nonexistent",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => [GROUP_EMAIL_SCOPE],
      },
    });

    expect(result.outcome).toBe("no-projectable-records");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("sends nothing when the vault has no projectable share data", async () => {
    const vaultRoot = await createMemoryDisplayNameVault(null);
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => [PROFILE_SCOPE],
      },
    });

    expect(result.outcome).toBe("no-projectable-records");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("never throws when the port fails", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/unused",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => {
          throw new Error("network down");
        },
      },
    });

    expect(result.outcome).toBe("error");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("fetches a credential-free device snapshot only for an active diagnostic scope", async () => {
    const snapshot = buildDeviceSyncSnapshot();
    const fetchSnapshot = vi.fn<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>(
      async () => snapshot,
    );
    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const deviceSyncPort = createDeviceSyncPort(fetchSnapshot);

    const inactiveResult = await offerHostedVaultShareProjectionBestEffort({
      deviceSyncPort,
      vaultRoot: "/unused",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => [],
      },
    });
    expect(inactiveResult.outcome).toBe("no-active-share");
    expect(fetchSnapshot).not.toHaveBeenCalled();

    const activeResult = await offerHostedVaultShareProjectionBestEffort({
      deviceSyncPort,
      vaultRoot: "/unused",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => [DEVICE_SYNC_STATUS_SCOPE],
      },
    });
    expect(activeResult.outcome).toBe("delivered");
    expect(fetchSnapshot).toHaveBeenCalledOnce();
    expect(fetchSnapshot).toHaveBeenCalledWith({
      includeCredentialMaterial: false,
      limit: 100,
    });
  });

  it("fails closed when an active diagnostic scope has no usable device snapshot", async () => {
    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const vaultSharePort = {
      deliver,
      listActiveProjectionScopes: async () => [DEVICE_SYNC_STATUS_SCOPE],
    };

    await expect(offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/unused",
      vaultSharePort,
    })).resolves.toEqual({ outcome: "no-projectable-records" });

    const fetchSnapshot = vi.fn<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>(
      async () => {
        throw new Error("private snapshot failure");
      },
    );
    await expect(offerHostedVaultShareProjectionBestEffort({
      deviceSyncPort: createDeviceSyncPort(fetchSnapshot),
      vaultRoot: "/unused",
      vaultSharePort,
    })).resolves.toEqual({ outcome: "error" });

    expect(fetchSnapshot).toHaveBeenCalledWith({
      includeCredentialMaterial: false,
      limit: 100,
    });
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("readProjectableDeviceSyncStatus", () => {
  it("projects only public labels, coarse state, and honestly named sync-job completion", async () => {
    const snapshot = buildDeviceSyncSnapshot();
    const records = await readProjectableDeviceSyncStatus(createDeviceSyncPort(
      async () => snapshot,
    ));

    expect(records).toEqual([{
      data: {
        observedAt: "2026-07-16T00:00:00.000Z",
        sources: [
          {
            connectionSyncJobCompletedAt: null,
            label: "Oura",
            status: "needs-reconnect",
            statusObservedAt: "2026-07-15T10:30:00.000Z",
          },
          {
            connectionSyncJobCompletedAt: "2026-07-15T09:30:00.000Z",
            label: "WHOOP",
            status: "needs-attention",
            statusObservedAt: "2026-07-15T09:45:00.000Z",
          },
        ],
      },
      occurredAt: "2026-07-16T00:00:00.000Z",
      recordKey: "device-sync-status",
    }]);

    const serialized = JSON.stringify(records);
    for (const privateValue of [
      "junction",
      "whoop_v2",
      "private-user-id",
      "private-connection-id",
      "private-external-account",
      "private-source-instance",
      "private:scope",
      "PRIVATE_ERROR_CODE",
      "Private provider error detail",
      "privateCredentialMetadata",
      "privateResource",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("uses a connected duplicate label instead of falsely reporting a reconnect problem", async () => {
    const snapshot = buildDeviceSyncSnapshot();
    const firstConnection = snapshot.connections[0]!;
    const firstSource = firstConnection.sources![0]!;
    firstConnection.connection.status = "reauthorization_required";
    snapshot.connections.push({
      connection: {
        ...firstConnection.connection,
        id: "second-private-connection",
        status: "active",
        updatedAt: "2026-07-15T08:00:00.000Z",
      },
      credential: firstConnection.credential,
      localState: {
        ...firstConnection.localState,
        lastSyncCompletedAt: "2026-07-15T11:00:00.000Z",
      },
      sources: [{
        ...firstSource,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-07-15T08:00:00.000Z",
        sourceInstanceKey: "second-private-source",
        status: "connected",
      }],
    });

    const records = await readProjectableDeviceSyncStatus(createDeviceSyncPort(
      async () => snapshot,
    ));
    const data = records[0]?.data;
    expect(data).toMatchObject({
      sources: expect.arrayContaining([{
        connectionSyncJobCompletedAt: "2026-07-15T11:00:00.000Z",
        label: "WHOOP",
        status: "connected",
        statusObservedAt: "2026-07-15T08:00:00.000Z",
      }]),
    });
  });

  it("maps every closed connection and source problem state", async () => {
    const directSnapshot = (
      connection: Partial<DeviceSyncSnapshot["connections"][number]["connection"]>,
    ): DeviceSyncSnapshot => {
      const snapshot = buildDeviceSyncSnapshot();
      const entry = structuredClone(snapshot.connections[1]!);
      entry.connection = {
        ...entry.connection,
        setupPhase: "source_confirmed",
        status: "active",
        ...connection,
      };
      snapshot.connections = [entry];
      return snapshot;
    };
    const sourceSnapshot = (
      status: NonNullable<
        DeviceSyncSnapshot["connections"][number]["sources"]
      >[number]["status"],
    ): DeviceSyncSnapshot => {
      const snapshot = buildDeviceSyncSnapshot();
      const entry = structuredClone(snapshot.connections[0]!);
      entry.connection.status = "active";
      entry.connection.setupPhase = "source_confirmed";
      entry.sources = [{ ...entry.sources![0]!, status }];
      snapshot.connections = [entry];
      return snapshot;
    };
    const cases = [
      {
        expectedStatus: "disconnected",
        snapshot: directSnapshot({ status: "disconnected" }),
      },
      {
        expectedStatus: "setting-up",
        snapshot: directSnapshot({ setupPhase: "pending_link" }),
      },
      {
        expectedStatus: "setting-up",
        snapshot: directSnapshot({ setupPhase: "link_returned" }),
      },
      {
        expectedStatus: "needs-attention",
        snapshot: directSnapshot({ setupPhase: "failed" }),
      },
      {
        expectedStatus: "disconnected",
        snapshot: sourceSnapshot("disconnected"),
      },
      {
        expectedStatus: "needs-attention",
        snapshot: sourceSnapshot("unavailable"),
      },
    ] as const;

    for (const testCase of cases) {
      const records = await readProjectableDeviceSyncStatus(createDeviceSyncPort(
        async () => testCase.snapshot,
      ));
      const data = records[0]?.data;
      if (!data || !("sources" in data)) {
        throw new Error("Expected a device-sync-status projection record.");
      }
      expect(data.sources).toHaveLength(1);
      expect(data.sources[0]?.status).toBe(testCase.expectedStatus);
    }
  });

  it("sorts and caps the projected public source list at eight entries", async () => {
    const snapshot = buildDeviceSyncSnapshot();
    const directConnection = snapshot.connections[1]!;
    const safeProviderSlugs = [
      "withings",
      "whoop_v2",
      "strava",
      "samsung_health",
      "oura",
      "google_fit",
      "garmin",
      "fitbit",
      "apple_health_kit",
    ];
    snapshot.connections = safeProviderSlugs.map((provider, index) => ({
      ...structuredClone(directConnection),
      connection: {
        ...directConnection.connection,
        id: `private-connection-${index}`,
        provider,
        status: "active" as const,
      },
    }));

    const records = await readProjectableDeviceSyncStatus(createDeviceSyncPort(
      async () => snapshot,
    ));
    const data = records[0]?.data;
    if (!data || !("sources" in data)) {
      throw new Error("Expected a device-sync-status projection record.");
    }

    expect(data.sources.map((source) => source.label)).toEqual([
      "Apple Health",
      "Fitbit",
      "Garmin",
      "Google Fit",
      "Oura",
      "Samsung Health",
      "Strava",
      "WHOOP",
    ]);
  });

  it("drops intermediary, unknown, and internal provider slugs", async () => {
    const snapshot = buildDeviceSyncSnapshot();
    const junctionConnection = snapshot.connections[0]!;
    const directConnection = snapshot.connections[1]!;
    const internalSource = junctionConnection.sources![0]!;
    snapshot.connections = [
      {
        ...structuredClone(junctionConnection),
        sources: [],
      },
      {
        ...structuredClone(junctionConnection),
        sources: [{
          ...internalSource,
          sourceProviderSlug: "private_internal_source",
        }],
      },
      {
        ...structuredClone(directConnection),
        connection: {
          ...directConnection.connection,
          provider: "source_0",
          status: "active" as const,
        },
      },
      {
        ...structuredClone(directConnection),
        connection: {
          ...directConnection.connection,
          provider: "strava",
          status: "active" as const,
        },
      },
    ];

    const records = await readProjectableDeviceSyncStatus(createDeviceSyncPort(
      async () => snapshot,
    ));

    expect(records[0]?.data).toMatchObject({
      sources: [{ label: "Strava" }],
    });
    expect(JSON.stringify(records)).not.toMatch(/junction|private_internal_source|source_0/u);
  });

  it("emits a day-bucketed empty record for a successful snapshot with no public source", async () => {
    const snapshot = buildDeviceSyncSnapshot();
    snapshot.connections = [{
      ...snapshot.connections[0]!,
      sources: [],
    }];

    await expect(readProjectableDeviceSyncStatus(createDeviceSyncPort(
      async () => snapshot,
    ))).resolves.toEqual([{
      data: {
        observedAt: "2026-07-16T00:00:00.000Z",
        sources: [],
      },
      occurredAt: "2026-07-16T00:00:00.000Z",
      recordKey: "device-sync-status",
    }]);
  });

  it("keeps the daily record stable across private snapshot changes", async () => {
    const firstSnapshot = buildDeviceSyncSnapshot();
    const secondSnapshot = structuredClone(firstSnapshot);
    secondSnapshot.generatedAt = "2026-07-16T20:00:00.000Z";
    secondSnapshot.userId = "different-private-user";
    secondSnapshot.connections[0]!.connection.externalAccountId =
      "different-private-account";
    secondSnapshot.connections[0]!.connection.metadata = {
      differentPrivateMetadata: true,
    };

    const first = await readProjectableDeviceSyncStatus(createDeviceSyncPort(
      async () => firstSnapshot,
    ));
    const second = await readProjectableDeviceSyncStatus(createDeviceSyncPort(
      async () => secondSnapshot,
    ));

    expect(second).toEqual(first);
  });
});

describe("selectProjectableDailyMetricDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const activitySpec = requireDailyMetricSpec("activity-days.v0");
  const sleepDurationSpec = requireDailyMetricSpec("sleep-duration-days.v0");
  const stepsSpec = requireDailyMetricSpec("steps-days.v0");

  it("keeps total sleep duration distinct from the bedtime-to-wake window", () => {
    const date = "2026-07-03";
    const sleepWindows = selectProjectableSleepNights([{
      date,
      sleepEndAt: "2026-07-04T07:51:00.000Z",
      sleepStartAt: "2026-07-03T22:00:00.000Z",
    }], nowMs);
    const sleepDurations = selectProjectableDailyMetricDays([{
      date,
      grain: "day",
      metricKey: "total-sleep-minutes",
      statistic: "value",
      unit: "minutes",
      value: 477,
    }], sleepDurationSpec, nowMs);

    expect(Date.parse("2026-07-04T07:51:00.000Z") - Date.parse("2026-07-03T22:00:00.000Z"))
      .toBe(591 * 60_000);
    expect(sleepDurations).toEqual([{
      data: {
        date,
        metricKey: "total-sleep-minutes",
        unit: "minutes",
        value: 477,
      },
      occurredAt: `${date}T00:00:00.000Z`,
      recordKey: date,
    }]);
    expect(sleepWindows[0]?.data).toEqual({
      date,
      sleepEndAt: "2026-07-04T07:51:00.000Z",
      sleepStartAt: "2026-07-03T22:00:00.000Z",
    });
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-duration-days.v0",
        records: sleepDurations,
      }).records,
    ).toEqual(sleepDurations);
  });

  it("maps recent selected daily metric rows to generic scalar records", () => {
    const selected = selectProjectableDailyMetricDays([
      {
        date: ACTIVITY_DAY.date,
        grain: "day",
        metricKey: "steps",
        statistic: "value",
        unit: "count",
        value: 12_345,
      },
      {
        date: ACTIVITY_DAY.date,
        grain: "event",
        metricKey: "steps",
        statistic: "value",
        unit: "count",
        value: 999,
      },
      {
        date: ACTIVITY_DAY.date,
        grain: "day",
        metricKey: "steps",
        statistic: "value",
        unit: "count",
        value: 1_000_001,
      },
    ], stepsSpec, nowMs);

    expect(selected).toEqual([
      {
        data: {
          date: ACTIVITY_DAY.date,
          metricKey: "steps",
          unit: "count",
          value: 12_345,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "steps-days.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("shares selected day-grain activity-minutes rows through the scalar activity spec", () => {
    const dailyActivitySummary = activityMetricPoint({
      date: ACTIVITY_DAY.date,
      grain: "day",
      id: "metric-point:activity-minutes:activity-summary",
      observedAt: "2026-07-03T08:00:00.000Z",
      sourceKind: "activity-summary",
      value: 73,
    });
    const eventMeasurement = activityMetricPoint({
      date: ACTIVITY_DAY.date,
      grain: "event",
      id: "metric-point:activity-minutes:event-measurement",
      observedAt: "2026-07-03T18:00:00.000Z",
      sourceKind: "measurement",
      value: 45,
    });
    const series = selectMetricSeries({
      duplicatePolicy: "selection-policy",
      grain: "day",
      metricKey: "activity-minutes",
      points: [dailyActivitySummary, eventMeasurement],
      statistic: "value",
    });

    expect(series.rows.map((row) => row.pointIds)).toEqual([[dailyActivitySummary.id]]);
    expect(selectProjectableDailyMetricDays([{
      date: ACTIVITY_DAY.date,
      grain: "event",
      metricKey: "activity-minutes",
      statistic: "value",
      unit: "minutes",
      value: 45,
    }], activitySpec, nowMs)).toEqual([]);
    const selected = selectProjectableDailyMetricDays(series.rows, activitySpec, nowMs);
    expect(selected).toEqual([{
      ...ACTIVITY_RECORD,
      sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
    }]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-days.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("reads allowlisted activity-session workout metrics as scalar share records", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-workout-metrics-"));
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const expectedRecords = [
      ["active-calories-days.v0", "active-calories", "kcal", 360],
      ["distance-days.v0", "distance-km", "km", 5],
      ["elevation-gain-days.v0", "elevation-gain-meters", "meter", 42],
      ["max-heart-rate-days.v0", "max-heart-rate", "bpm", 165],
      ["workout-strain-days.v0", "workout-strain", "strain", 13.2],
    ] as const;

    try {
      await mkdir(join(vaultRoot, "ledger", "events", "2026"), { recursive: true });
      await writeFile(
        join(vaultRoot, "vault.json"),
        `${JSON.stringify({
          formatVersion: CURRENT_VAULT_FORMAT_VERSION,
          vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
          createdAt: "2026-07-03T00:00:00.000Z",
          title: "Vault share workout metrics test",
          timezone: "UTC",
        })}\n`,
        "utf8",
      );
      await writeFile(
        join(vaultRoot, "ledger", "events", "2026", "2026-07.jsonl"),
        `${JSON.stringify({
          schemaVersion: "murph.event.v1",
          id: "evt_vault_share_workout_metrics_01",
          kind: "activity_session",
          occurredAt: "2026-07-03T12:00:00Z",
          dayKey: "2026-07-03",
          recordedAt: "2026-07-03T12:45:00Z",
          title: "Shared challenge workout",
          durationMinutes: 35,
          distanceKm: 5,
          source: "device",
          externalRef: {
            system: "strava",
            resourceType: "activity_session",
            resourceId: "strava_activity_01",
          },
          workout: {
            metrics: {
              activeCalories: 360,
              averagePowerWatts: 215,
              maxHeartRate: 165,
              totalElevationGainMeters: 42,
              workoutStrain: 13.2,
            },
          },
        })}\n`,
        "utf8",
      );

      for (const [projectionKind, metricKey, unit, value] of expectedRecords) {
        const selected = await readProjectableDailyMetricDays(
          vaultRoot,
          requireDailyMetricSpec(projectionKind),
        );

        expect(selected).toEqual([{
          data: {
            date: ACTIVITY_DAY.date,
            metricKey,
            unit,
            value,
          },
          occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
          recordKey: ACTIVITY_DAY.date,
          sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
        }]);
        expect(JSON.stringify(selected)).not.toContain("strava");
        expect(JSON.stringify(selected)).not.toContain("averagePowerWatts");
      }
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});

describe("selectProjectableWorkoutDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");

  it("maps selected workout session summaries without raw workout details", () => {
    const selected = selectProjectableWorkoutDays({
      ...workoutRows({
        date: ACTIVITY_DAY.date,
        workoutCount: 2,
        workoutMinutes: 85,
      }),
      nowMs,
    });

    expect(selected).toEqual([
      {
        data: {
          date: ACTIVITY_DAY.date,
          workoutCount: 2,
          workoutMinutes: 85,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/u),
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "workout-days.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("drops split-provider workout tuples instead of joining count and minutes by date", () => {
    const selected = selectProjectableWorkoutDays({
      ...workoutRows({
        countRecordIds: ["evt_garmin_count"],
        date: ACTIVITY_DAY.date,
        minuteRecordIds: ["evt_oura_minutes"],
        workoutCount: 1,
        workoutMinutes: 85,
      }),
      nowMs,
    });

    expect(selected).toEqual([]);
  });
});

describe("selectProjectableActivityMinutesDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const runningSpec = requireActivityMinutesSpec(RUNNING_SCOPE);

  it("maps structured activity sessions to activity-specific daily minute records", () => {
    const selected = selectProjectableActivityMinutesDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_run_1"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "run",
          date: ACTIVITY_DAY.date,
          durationMinutes: 35,
          recordIds: ["evt_run_2"],
          startedAt: "2026-07-03T17:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "walking",
          date: ACTIVITY_DAY.date,
          durationMinutes: 60,
          recordIds: ["evt_walk_1"],
        }),
      ],
      spec: runningSpec,
    });

    expect(selected).toEqual([
      {
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 2,
          sessionMinutes: 75,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-minutes-days.v1",
        projectionScope: RUNNING_SCOPE,
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("does not count durationless sessions as activity-minute records", () => {
    const selected = selectProjectableActivityMinutesDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          recordIds: ["evt_run_no_duration"],
        }),
      ],
      spec: runningSpec,
    });

    expect(selected).toEqual([]);
  });

  it("drops exact duplicate activity sessions before scoring a day", () => {
    const selected = selectProjectableActivityMinutesDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_garmin_run"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_strava_run"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
      ],
      spec: runningSpec,
    });

    expect(selected[0]?.data).toEqual({
      activityKind: "running",
      date: ACTIVITY_DAY.date,
      sessionCount: 1,
      sessionMinutes: 40,
    });
  });

  it("deduplicates matching activity aliases before scoring a day", () => {
    const selected = selectProjectableActivityMinutesDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_garmin_run"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "run",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_strava_run"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
      ],
      spec: runningSpec,
    });

    expect(selected[0]?.data).toEqual({
      activityKind: "running",
      date: ACTIVITY_DAY.date,
      sessionCount: 1,
      sessionMinutes: 40,
    });
  });

  it("deduplicates overlapping provider copies with rounded duration drift", () => {
    const selected = selectProjectableActivityMinutesDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          endedAt: "2026-07-03T07:40:00.000Z",
          recordIds: ["evt_garmin_run"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "run",
          date: ACTIVITY_DAY.date,
          durationMinutes: 41,
          endedAt: "2026-07-03T07:41:30.000Z",
          recordIds: ["evt_strava_run"],
          startedAt: "2026-07-03T07:00:30.000Z",
        }),
      ],
      spec: runningSpec,
    });

    expect(selected[0]?.data).toEqual({
      activityKind: "running",
      date: ACTIVITY_DAY.date,
      sessionCount: 1,
      sessionMinutes: 40,
    });
  });

  it("reads nested workout sport before generic activity labels from canonical vaults", async () => {
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_nested_run_1",
      kind: "activity_session",
      occurredAt: "2026-07-03T07:00:00.000Z",
      dayKey: ACTIVITY_DAY.date,
      recordedAt: "2026-07-03T08:00:00.000Z",
      startAt: "2026-07-03T07:00:00.000Z",
      endAt: "2026-07-03T07:42:00.000Z",
      activityType: "workout",
      durationMinutes: 42,
      workout: {
        sportName: "Run",
        heartRateZones: [{ durationMinutes: 12, label: "Zone 5", zone: 5 }],
      },
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivityMinutesDays(
        vaultRoot,
        runningSpec,
      )).resolves.toEqual([{
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
          sessionMinutes: 42,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("reads sauna minutes from canonical intervention sessions", async () => {
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_sauna_1",
      kind: "intervention_session",
      occurredAt: "2026-07-03T18:00:00.000Z",
      sessionLocalDate: ACTIVITY_DAY.date,
      interventionType: "sauna",
      durationMinutes: 20,
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivityMinutesDays(
        vaultRoot,
        requireActivityMinutesSpec(SAUNA_SCOPE),
      )).resolves.toEqual([{
        data: {
          activityKind: "sauna",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
          sessionMinutes: 20,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("keeps activity-minute reads bounded to query projection entities", async () => {
    const source = await readFile(
      new URL("../src/hosted-runtime/vault-share-projection.ts", import.meta.url),
      "utf8",
    );
    const readerStart = source.indexOf("async function readProjectableActivitySessionRows");
    const readerEnd = source.indexOf("function toActivitySessionProjectionRow");

    expect(readerStart).toBeGreaterThanOrEqual(0);
    expect(readerEnd).toBeGreaterThan(readerStart);
    const activitySessionReader = source.slice(readerStart, readerEnd);

    expect(activitySessionReader).toContain("listCanonicalEntities");
    expect(activitySessionReader).toContain('family: "event"');
    expect(activitySessionReader).toContain('from: cutoffDate');
    expect(activitySessionReader).toContain("ACTIVITY_SESSION_SOURCE_ROW_QUERY_LIMIT");
    expect(activitySessionReader).toContain("entities.length > ACTIVITY_SESSION_SOURCE_ROW_LIMIT");
    expect(activitySessionReader).toContain('"activity_session"');
    expect(activitySessionReader).toContain('"intervention_session"');
    expect(activitySessionReader).not.toContain("limit: null");
    expect(activitySessionReader).not.toContain("readVault(");
  });

  it("fails closed when activity-session source rows exceed the read cap", async () => {
    const startMs = Date.parse("2026-07-03T07:00:00.000Z");
    const vaultRoot = await createActivitySessionVault(Array.from(
      { length: 501 },
      (_, index) => ({
        schemaVersion: "murph.event.v1",
        id: `evt_run_overflow_${index}`,
        kind: "activity_session",
        occurredAt: new Date(startMs + index * 60_000).toISOString(),
        dayKey: ACTIVITY_DAY.date,
        recordedAt: "2026-07-03T20:00:00.000Z",
        startAt: new Date(startMs + index * 60_000).toISOString(),
        endAt: new Date(startMs + index * 60_000 + 30 * 60_000).toISOString(),
        activityType: "running",
        distanceKm: 5,
        durationMinutes: 30,
      }),
    ));
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivityMinutesDays(
        vaultRoot,
        runningSpec,
      )).resolves.toEqual([]);
      await expect(readProjectableActivityDistanceDays(
        vaultRoot,
        requireActivityDistanceSpec(RUNNING_DISTANCE_SCOPE),
      )).resolves.toEqual([]);
      await expect(readProjectableActivitySessionCountDays(
        vaultRoot,
        requireActivitySessionCountSpec(RUNNING_SESSION_COUNT_SCOPE),
      )).resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("shares one cached session read across activity selector scopes in an offer", async () => {
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_run_cache_1",
      kind: "activity_session",
      occurredAt: "2026-07-03T07:00:00.000Z",
      dayKey: ACTIVITY_DAY.date,
      recordedAt: "2026-07-03T08:00:00.000Z",
      startAt: "2026-07-03T07:00:00.000Z",
      endAt: "2026-07-03T07:40:00.000Z",
      activityType: "running",
      distanceKm: 5,
      durationMinutes: 40,
      workout: {
        heartRateZones: [{ durationMinutes: 8, label: "Zone 5", zone: 5 }],
      },
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const deliver = vi.fn(async (request: HostedVaultShareDeliverRequest) => {
      if (request.projectionScope === RUNNING_SCOPE) {
        await rm(vaultRoot, { recursive: true, force: true });
      }
      return { status: "delivered" as const };
    });

    try {
      await expect(offerHostedVaultShareProjectionBestEffort({
        vaultRoot,
        vaultSharePort: {
          deliver,
          listActiveProjectionScopes: async () => [
            RUNNING_SCOPE,
            RUNNING_DISTANCE_SCOPE,
            RUNNING_SESSION_COUNT_SCOPE,
          ],
        },
      })).resolves.toEqual({ outcome: "delivered" });
      expect(deliver).toHaveBeenCalledTimes(3);
      expect(deliver.mock.calls.map(([request]) => request.projectionScope)).toEqual([
        RUNNING_SCOPE,
        RUNNING_DISTANCE_SCOPE,
        RUNNING_SESSION_COUNT_SCOPE,
      ]);
      expect(deliver.mock.calls[1]?.[0].records).toEqual([{
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
          sessionDistanceMeters: 5_000,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
      expect(deliver.mock.calls[2]?.[0].records).toEqual([{
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});

describe("selectProjectableActivityDistanceDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const runningDistanceSpec = requireActivityDistanceSpec(RUNNING_DISTANCE_SCOPE);

  it("maps activity-session distance to activity-specific daily distance records", () => {
    const selected = selectProjectableActivityDistanceDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          distanceMeters: 5_000,
          durationMinutes: 40,
          recordIds: ["evt_run_1"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "run",
          date: ACTIVITY_DAY.date,
          distanceMeters: 3_400,
          durationMinutes: 35,
          recordIds: ["evt_run_2"],
          startedAt: "2026-07-03T17:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "walking",
          date: ACTIVITY_DAY.date,
          distanceMeters: 2_000,
          durationMinutes: 30,
          recordIds: ["evt_walk_1"],
        }),
      ],
      spec: runningDistanceSpec,
    });

    expect(selected).toEqual([
      {
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 2,
          sessionDistanceMeters: 8_400,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-distance-days.v1",
        projectionScope: RUNNING_DISTANCE_SCOPE,
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("does not infer distance when matching sessions have no canonical distance", () => {
    const selected = selectProjectableActivityDistanceDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_run_no_distance"],
        }),
      ],
      spec: runningDistanceSpec,
    });

    expect(selected).toEqual([]);
  });

  it("preserves distance when duplicate matching session rows disagree on distance", () => {
    const selected = selectProjectableActivityDistanceDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          distanceMeters: 5_000,
          durationMinutes: 40,
          recordIds: ["evt_run_with_distance"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          endedAt: "2026-07-03T07:40:00.000Z",
          recordIds: ["evt_run_without_distance"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
      ],
      spec: runningDistanceSpec,
    });

    expect(selected).toEqual([{
      data: {
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        sessionCount: 1,
        sessionDistanceMeters: 5_000,
      },
      occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
      recordKey: ACTIVITY_DAY.date,
      sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
    }]);
  });

  it("skips a distance day when any matching same-day session lacks distance", () => {
    const rows = [
      activitySessionRow({
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        distanceMeters: 5_000,
        durationMinutes: 40,
        recordIds: ["evt_run_with_distance"],
        startedAt: "2026-07-03T07:00:00.000Z",
      }),
      activitySessionRow({
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        durationMinutes: 35,
        recordIds: ["evt_run_no_distance"],
        startedAt: "2026-07-03T17:00:00.000Z",
      }),
    ];

    expect(selectProjectableActivityDistanceDays({
      nowMs,
      rows,
      spec: runningDistanceSpec,
    })).toEqual([]);
    expect(selectProjectableActivitySessionCountDays({
      nowMs,
      rows,
      spec: requireActivitySessionCountSpec(RUNNING_SESSION_COUNT_SCOPE),
    })).toEqual([{
      data: {
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        sessionCount: 2,
      },
      occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
      recordKey: ACTIVITY_DAY.date,
      sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
    }]);
  });

  it("reads canonical distanceKm from activity-session vault entities", async () => {
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_distance_run_1",
      kind: "activity_session",
      occurredAt: "2026-07-03T07:00:00.000Z",
      dayKey: ACTIVITY_DAY.date,
      recordedAt: "2026-07-03T08:00:00.000Z",
      startAt: "2026-07-03T07:00:00.000Z",
      endAt: "2026-07-03T07:42:00.000Z",
      activityType: "running",
      distanceKm: 8.4,
      durationMinutes: 42,
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivityDistanceDays(
        vaultRoot,
        runningDistanceSpec,
      )).resolves.toEqual([{
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
          sessionDistanceMeters: 8_400,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});

describe("selectProjectableActivitySessionCountDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const runningSessionCountSpec =
    requireActivitySessionCountSpec(RUNNING_SESSION_COUNT_SCOPE);

  it("maps activity sessions to activity-specific daily count records", () => {
    const selected = selectProjectableActivitySessionCountDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_run_1"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "run",
          date: ACTIVITY_DAY.date,
          durationMinutes: 35,
          recordIds: ["evt_run_2"],
          startedAt: "2026-07-03T17:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "walking",
          date: ACTIVITY_DAY.date,
          durationMinutes: 60,
          recordIds: ["evt_walk_1"],
        }),
      ],
      spec: runningSessionCountSpec,
    });

    expect(selected).toEqual([
      {
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 2,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-session-count-days.v1",
        projectionScope: RUNNING_SESSION_COUNT_SCOPE,
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("deduplicates count rows when one copy omits duration", () => {
    const selected = selectProjectableActivitySessionCountDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_run_duration"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          recordIds: ["evt_run_no_duration"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
      ],
      spec: runningSessionCountSpec,
    });

    expect(selected).toEqual([
      {
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
  });

  it("counts canonical intervention sessions without requiring duration", async () => {
    const saunaSessionCountSpec = requireActivitySessionCountSpec(
      buildHostedVaultShareActivitySessionCountProjectionScope({
        activityKind: "sauna",
      }),
    );
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_sauna_count_1",
      kind: "intervention_session",
      occurredAt: "2026-07-03T18:00:00.000Z",
      sessionLocalDate: ACTIVITY_DAY.date,
      interventionType: "sauna",
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivitySessionCountDays(
        vaultRoot,
        saunaSessionCountSpec,
      )).resolves.toEqual([{
        data: {
          activityKind: "sauna",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("does not count missed or skipped intervention sessions", async () => {
    const saunaSessionCountSpec = requireActivitySessionCountSpec(
      buildHostedVaultShareActivitySessionCountProjectionScope({
        activityKind: "sauna",
      }),
    );
    const vaultRoot = await createActivitySessionVault([
      {
        schemaVersion: "murph.event.v1",
        id: "evt_sauna_missed",
        kind: "intervention_session",
        occurredAt: "2026-07-03T18:00:00.000Z",
        sessionLocalDate: ACTIVITY_DAY.date,
        interventionType: "sauna",
        sessionStatus: "missed",
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_sauna_skipped",
        kind: "intervention_session",
        occurredAt: "2026-07-03T19:00:00.000Z",
        sessionLocalDate: ACTIVITY_DAY.date,
        interventionType: "sauna",
        sessionStatus: "skipped",
      },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivitySessionCountDays(
        vaultRoot,
        saunaSessionCountSpec,
      )).resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});

describe("selectProjectableHeartRateZoneDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");

  it("maps selected workout heart-rate zone summaries to bounded daily buckets", () => {
    const selected = selectProjectableHeartRateZoneDays([
      {
        context: {
          maxHeartRate: 140,
          minHeartRate: 120,
          zoneLabel: "Zone 2",
        },
        date: ACTIVITY_DAY.date,
        grain: "day",
        metricKey: "heart-rate-zone-2-minutes",
        observedAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        pointIds: ["point_zone_2"],
        recordIds: ["evt_activity_2026-07-03"],
        sourceFamily: "derived",
        sourceKind: "activity-summary",
        statistic: "value",
        value: 24,
      },
    ], nowMs);

    expect(selected).toEqual([
      {
        data: {
          date: ACTIVITY_DAY.date,
          zones: [
            {
              durationMinutes: 24,
              label: "Zone 2",
              zone: 2,
            },
          ],
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/u),
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "heart-rate-zones-days.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });
});

function activityMetricPoint(input: {
  date: string;
  grain: MetricPoint["grain"];
  id: string;
  observedAt: string;
  sourceKind: string;
  value: number;
}): MetricPoint {
  return {
    biomarkerKey: null,
    canonicalUnit: "minutes",
    canonicalValue: input.value,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: input.date,
    grain: input.grain,
    id: input.id,
    metricKey: "activity-minutes",
    observedAt: input.observedAt,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: input.sourceKind,
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: "murph.metric-point.v1",
    source: {
      family: "derived",
      kind: input.sourceKind,
      path: "",
      recordId: input.id,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: "minutes",
    value: input.value,
  };
}

function requireDailyMetricSpec(kind: Parameters<typeof getHostedVaultShareDailyMetricProjectionSpec>[0]) {
  const spec = getHostedVaultShareDailyMetricProjectionSpec(kind);
  if (!spec) {
    throw new Error(`Missing daily metric projection spec for ${kind}.`);
  }
  return spec;
}

function requireActivityMinutesSpec(
  kind: Parameters<typeof getHostedVaultShareActivityMinutesProjectionSpec>[0],
) {
  const spec = getHostedVaultShareActivityMinutesProjectionSpec(kind);
  if (!spec) {
    throw new Error(`Missing activity minutes projection spec for ${kind}.`);
  }
  return spec;
}

function requireActivityDistanceSpec(
  kind: Parameters<typeof getHostedVaultShareActivityDistanceProjectionSpec>[0],
) {
  const spec = getHostedVaultShareActivityDistanceProjectionSpec(kind);
  if (!spec) {
    throw new Error("Missing activity distance projection spec.");
  }
  return spec;
}

function requireActivitySessionCountSpec(
  kind: Parameters<typeof getHostedVaultShareActivitySessionCountProjectionSpec>[0],
) {
  const spec = getHostedVaultShareActivitySessionCountProjectionSpec(kind);
  if (!spec) {
    throw new Error("Missing activity session count projection spec.");
  }
  return spec;
}

describe("selectProjectableSleepNights", () => {
  const nowMs = Date.parse("2026-06-10T00:00:00.000Z");

  it("maps recent fully-timed nights to records keyed by night date and drops stale or partial ones", () => {
    const staleDate = "2026-05-01";
    const summaries = [
      { date: NIGHT.date, sleepEndAt: NIGHT.sleepEndAt, sleepStartAt: NIGHT.sleepStartAt },
      { date: "2026-06-08", sleepEndAt: null, sleepStartAt: "2026-06-08T22:00:00.000Z" },
      {
        date: staleDate,
        sleepEndAt: "2026-05-02T06:00:00.000Z",
        sleepStartAt: "2026-05-01T22:00:00.000Z",
      },
    ];

    const selected = selectProjectableSleepNights(summaries, nowMs);

    // recordKey is the night date and occurredAt is the night date at UTC midnight, so the
    // dedupe key, vault path, and plaintext mailbox metadata all reduce to the night itself
    // — the exact sleep timestamps travel only inside the encrypted payload.
    expect(selected).toEqual([RECORD]);
    expect(selected[0]?.recordKey).toBe(NIGHT.date);
    expect(selected[0]?.occurredAt).toBe(`${NIGHT.date}T00:00:00.000Z`);
  });

  it("emits records the hosted-execution deliver-request parser accepts unchanged", () => {
    // Cross-package drift guard: the deliver parser pins occurredAt to the night-date
    // midnight and bounds the sleep window, so a projector that drifts from that contract
    // would make web reject every offer. Pipe real projector output through the real parser.
    const selected = selectProjectableSleepNights([NIGHT], nowMs);

    expect(selected).toHaveLength(1);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        projectionScope: SLEEP_SCOPE,
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("drops nights older than the recency cutoff exactly", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const justInsideMs = nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS * dayMs;
    const justInsideDate = new Date(justInsideMs).toISOString().slice(0, 10);
    const justOutsideDate = new Date(justInsideMs - dayMs).toISOString().slice(0, 10);
    const summaries = [justInsideDate, justOutsideDate].map((date) => ({
      date,
      sleepEndAt: `${date}T06:00:00.000Z`,
      sleepStartAt: `${date}T22:00:00.000Z`,
    }));

    const selected = selectProjectableSleepNights(summaries, nowMs);

    expect(selected.map((record) => record.recordKey)).toEqual([justInsideDate]);
  });
});

describe("importHostedVaultShareDeliveryWake", () => {
  const wake = {
    delivery: {
      grantorMemberId: "member_grantor",
      projectionKind: "sleep-times.v0" as const,
      projectionScope: SLEEP_SCOPE,
      record: RECORD,
      schema: "murph.vault-share.delivery.v1" as const,
      shareId: "share_1",
    },
    eventId: "vault-share:share_1:2026-06-09",
    kind: "vault-share.delivery" as const,
    occurredAt: "2026-06-10T07:00:00.000Z",
    userId: "member_referee",
  };
  const storePath = (vaultRoot: string) =>
    join(vaultRoot, "derived", "vault-share", "projections.json");
  const withheldPath = (vaultRoot: string) =>
    join(
      vaultRoot,
      ".runtime",
      "operations",
      "assistant",
      "state",
      "vault-share-withheld.json",
    );

  it("lands the shared record as durable vault content, idempotently", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));

    const first = await importHostedVaultShareDeliveryWake({ vaultRoot, wake });
    const second = await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    expect(first).toEqual({ status: "imported" });
    expect(second).toEqual({ status: "imported" });

    const stored = JSON.parse(
      await readFile(
        storePath(vaultRoot),
        "utf8",
      ),
    );
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.records).toHaveLength(1);
    expect(grantor.records[0].record).toEqual(RECORD);
    expect(grantor.records[0].shareId).toBe("share_1");
    expect(grantor.records[0].receivedEventId).toBe(wake.eventId);
    await expect(readFile(
      join(vaultRoot, "raw", "shared", "vault-share-projections.json"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reconciles revoked, former-member, and old-generation entries before reads", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-authority-"));
    for (const [grantorMemberId, shareId] of [
      ["member_current", "share_current"],
      ["member_revoked", "share_revoked"],
      ["member_former", "share_former"],
      ["member_regranted", "share_old_generation"],
    ] as const) {
      await importHostedVaultShareDeliveryWake({
        vaultRoot,
        wake: {
          ...wake,
          delivery: {
            ...wake.delivery,
            grantorMemberId,
            shareId,
          },
          eventId: `vault-share:${shareId}:2026-06-09`,
        },
      });
    }
    const before = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const currentGrantor =
      before.projections["sleep-times.v0"].grantors.member_current;
    currentGrantor.records.push({
      ...currentGrantor.records[0],
      receivedEventId: "vault-share:wrong-record-generation",
      shareId: "share_wrong_generation",
    });
    await writeFile(storePath(vaultRoot), JSON.stringify(before));

    await expect(prepareSharedVaultShareModelView({
      readAuthority: async () => [{
        memberId: "member_current",
        projectionScopeKey: "sleep-times.v0",
        shareId: "share_current",
      }, {
        memberId: "member_regranted",
        projectionScopeKey: "sleep-times.v0",
        shareId: "share_new_generation",
      }],
      vaultRoot,
    })).resolves.toEqual({ status: "ready" });

    const after = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    expect(Object.keys(after.projections["sleep-times.v0"].grantors))
      .toEqual(["member_current"]);
    expect(after.projections["sleep-times.v0"].grantors.member_current.records)
      .toHaveLength(1);
    expect(after.projections["sleep-times.v0"].grantors.member_current.records[0].shareId)
      .toBe("share_current");
  });

  it("deletes the projection file when current authority retains no entries", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-authority-"));
    await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    await expect(prepareSharedVaultShareModelView({
      readAuthority: async () => [],
      vaultRoot,
    })).resolves.toEqual({ status: "empty" });
    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("withholds landed data without deleting it when authority is unavailable", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-authority-"));
    await importHostedVaultShareDeliveryWake({ vaultRoot, wake });
    const before = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));

    await expect(prepareSharedVaultShareModelView({
      readAuthority: async () => {
        throw new Error("control unavailable");
      },
      vaultRoot,
    })).resolves.toEqual({
      reasonCode: "vault_share.authority_unavailable",
      status: "unavailable",
    });
    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    const marker = JSON.parse(await readFile(
      join(vaultRoot, "derived", "vault-share", "authority-unavailable.json"),
      "utf8",
    ));
    expect(marker.schema).toBe("murph.shared-vault-authority-unavailable.v1");
    const withheld = JSON.parse(await readFile(withheldPath(vaultRoot), "utf8"));
    expect(withheld.projections).toEqual(before.projections);

    await expect(prepareSharedVaultShareModelView({
      readAuthority: async () => [{
        memberId: wake.delivery.grantorMemberId,
        projectionScopeKey: "sleep-times.v0",
        shareId: wake.delivery.shareId,
      }],
      vaultRoot,
    })).resolves.toEqual({ status: "ready" });
    const restored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    expect(restored.projections).toEqual(before.projections);
    await expect(readFile(withheldPath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(
      join(vaultRoot, "derived", "vault-share", "authority-unavailable.json"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("lands imports invisibly while the shared view is withheld", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-authority-"));
    await importHostedVaultShareDeliveryWake({ vaultRoot, wake });
    await prepareSharedVaultShareModelView({
      readAuthority: async () => {
        throw new Error("control unavailable");
      },
      vaultRoot,
    });

    await expect(importHostedVaultShareDeliveryWake({
      vaultRoot,
      wake: {
        ...wake,
        delivery: {
          ...wake.delivery,
          grantorMemberId: "member_outage_import",
          shareId: "share_outage_import",
        },
        eventId: "vault-share:outage-import",
      },
    })).resolves.toEqual({ status: "imported" });
    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    const withheld = JSON.parse(await readFile(withheldPath(vaultRoot), "utf8"));
    expect(Object.keys(withheld.projections["sleep-times.v0"].grantors).sort())
      .toEqual([wake.delivery.grantorMemberId, "member_outage_import"].sort());
  });

  it("skips the authority control read when no landed store exists", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-authority-"));
    const readAuthority = vi.fn(async () => []);

    await expect(prepareSharedVaultShareModelView({
      readAuthority,
      vaultRoot,
    })).resolves.toEqual({ status: "empty" });
    expect(readAuthority).not.toHaveBeenCalled();
  });

  it("skips email delivery authorization imports because they carry no records", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));

    await expect(importHostedVaultShareDeliveryWake({
      vaultRoot,
      wake: {
        ...wake,
        delivery: {
          ...wake.delivery,
          projectionKind: "group-email.v0",
          projectionScope: GROUP_EMAIL_SCOPE,
        },
      },
    })).resolves.toEqual({ status: "imported" });

    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces a shared record when a corrected delivery revision arrives", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    const correctedRecord = {
      ...RECORD,
      data: {
        ...RECORD.data,
        sleepEndAt: "2026-06-10T06:59:00.000Z",
      },
    };

    await expect(importHostedVaultShareDeliveryWake({ vaultRoot, wake }))
      .resolves.toEqual({ status: "imported" });
    await expect(importHostedVaultShareDeliveryWake({
      vaultRoot,
      wake: {
        ...wake,
        delivery: {
          ...wake.delivery,
          record: correctedRecord,
        },
        eventId: "vault-share:share_1:2026-06-09:revision_2",
      },
    })).resolves.toEqual({ status: "imported" });

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.records).toHaveLength(1);
    expect(grantor.records[0].record).toEqual(correctedRecord);
    expect(grantor.records[0].receivedEventId)
      .toBe("vault-share:share_1:2026-06-09:revision_2");
  });

  it("keeps one compact file with only the latest bounded records", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));

    for (let day = 1; day <= HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS + 1; day += 1) {
      const date = `2026-06-${String(day).padStart(2, "0")}`;
      const nextDate = `2026-06-${String(day + 1).padStart(2, "0")}`;
      const record = {
        data: {
          date,
          sleepEndAt: `${nextDate}T06:31:00.000Z`,
          sleepStartAt: `${date}T22:04:00.000Z`,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
      };

      await expect(importHostedVaultShareDeliveryWake({
        vaultRoot,
        wake: {
          ...wake,
          delivery: { ...wake.delivery, record },
          eventId: `vault-share:share_1:${date}`,
          occurredAt: record.occurredAt,
        },
      })).resolves.toEqual({ status: "imported" });
    }

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const records = stored.projections["sleep-times.v0"].grantors.member_grantor.records;
    expect(records).toHaveLength(HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS);
    expect(records.map((entry: { record: { recordKey: string } }) => entry.record.recordKey))
      .not.toContain("2026-06-01");
    await expect(readFile(
      join(vaultRoot, "raw", "shared", "sleep-times.v0", "member_grantor", "2026-06-09.json"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("applies revoke wakes by removing the grantor projection entry", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    await expect(applyHostedVaultShareRevokeWake({
      vaultRoot,
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          projectionScope: SLEEP_SCOPE,
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    })).resolves.toEqual({ status: "imported" });

    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves legacy raw shared records when a share is revoked", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    const legacyDirectory = join(vaultRoot, "raw", "shared", "sleep-times.v0", "member_grantor");
    const revokedLegacyPath = join(legacyDirectory, "2026-06-09.json");
    const activeLegacyPath = join(legacyDirectory, "2026-06-10.json");
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(
      revokedLegacyPath,
      JSON.stringify({
        grantorMemberId: "member_grantor",
        projectionKind: "sleep-times.v0",
        receivedEventId: "vault-share:share_1:2026-06-09",
        record: RECORD,
        schema: "murph.vault-share.delivery.v1",
        shareId: "share_1",
      }),
    );
    await writeFile(
      activeLegacyPath,
      JSON.stringify({
        grantorMemberId: "member_grantor",
        projectionKind: "sleep-times.v0",
        receivedEventId: "vault-share:share_2:2026-06-10",
        record: {
          ...RECORD,
          recordKey: "2026-06-10",
        },
        schema: "murph.vault-share.delivery.v1",
        shareId: "share_2",
      }),
    );

    await expect(applyHostedVaultShareRevokeWake({
      vaultRoot,
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          projectionScope: SLEEP_SCOPE,
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    })).resolves.toEqual({ status: "imported" });

    await expect(readFile(revokedLegacyPath, "utf8")).resolves.toContain("share_1");
    await expect(readFile(activeLegacyPath, "utf8")).resolves.toContain("share_2");
    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not let a stale revoke remove a newer grant epoch", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await importHostedVaultShareDeliveryWake({
      vaultRoot,
      wake: {
        ...wake,
        delivery: { ...wake.delivery, shareId: "share_2" },
        eventId: "vault-share:share_2:2026-06-09",
      },
    });

    await expect(applyHostedVaultShareRevokeWake({
      vaultRoot,
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          projectionScope: SLEEP_SCOPE,
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    })).resolves.toEqual({ status: "imported" });

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.shareId).toBe("share_2");
    expect(grantor.records).toHaveLength(1);
  });

  it("starts a fresh record list when a delivery arrives for a new grant epoch", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    const nextRecord = {
      data: {
        date: "2026-06-10",
        sleepEndAt: "2026-06-11T06:31:00.000Z",
        sleepStartAt: "2026-06-10T22:04:00.000Z",
      },
      occurredAt: "2026-06-10T00:00:00.000Z",
      recordKey: "2026-06-10",
    };
    await expect(importHostedVaultShareDeliveryWake({
      vaultRoot,
      wake: {
        ...wake,
        delivery: {
          ...wake.delivery,
          record: nextRecord,
          shareId: "share_2",
        },
        eventId: "vault-share:share_2:2026-06-10",
        occurredAt: "2026-06-10T00:00:00.000Z",
      },
    })).resolves.toEqual({ status: "imported" });

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.shareId).toBe("share_2");
    expect(grantor.records.map((entry: { record: { recordKey: string } }) =>
      entry.record.recordKey,
    )).toEqual(["2026-06-10"]);
  });

  it("repairs a corrupt derived projection file before importing a delivery", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await mkdir(join(vaultRoot, "derived", "vault-share"), { recursive: true });
    await writeFile(storePath(vaultRoot), "{not-json");

    await expect(importHostedVaultShareDeliveryWake({ vaultRoot, wake }))
      .resolves.toEqual({ status: "imported" });

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.records).toHaveLength(1);
    expect(grantor.records[0].record).toEqual(RECORD);
  });

  it("repairs a corrupt derived projection file before consuming a revoke", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await mkdir(join(vaultRoot, "derived", "vault-share"), { recursive: true });
    await writeFile(
      storePath(vaultRoot),
      JSON.stringify({ schema: "murph.shared-vault-projections.v0" }),
    );

    await expect(applyHostedVaultShareRevokeWake({
      vaultRoot,
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          projectionScope: SLEEP_SCOPE,
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    })).resolves.toEqual({ status: "imported" });

    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps delivery import read failures retryable so shared data is not consumed", async () => {
    const result = await importHostedVaultShareDeliveryWake({
      vaultRoot: "/dev/null/not-a-dir",
      wake,
    });

    expect(result).toEqual({
      reasonCode: "vault_share.read_failed",
      retryable: true,
      status: "blocked",
    });
  });

  it("keeps revoke import read failures retryable so stale shared data is not consumed", async () => {
    const result = await applyHostedVaultShareRevokeWake({
      vaultRoot: "/dev/null/not-a-dir",
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          projectionScope: SLEEP_SCOPE,
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    });

    expect(result).toEqual({
      reasonCode: "vault_share.read_failed",
      retryable: true,
      status: "blocked",
    });
  });

  it("blocks unsafe path segments without touching the filesystem", async () => {
    const result = await importHostedVaultShareDeliveryWake({
      vaultRoot: "/unused",
      wake: {
        ...wake,
        delivery: { ...wake.delivery, grantorMemberId: "../escape" },
      },
    });

    expect(result).toEqual({
      reasonCode: "vault_share.unsafe_path_segment",
      retryable: false,
      status: "blocked",
    });
  });
});

describe("readProjectableProfileName", () => {
  it("delivers the typed memory display name and the parser accepts it unchanged", async () => {
    const vaultRoot = await createMemoryDisplayNameVault("Theo");
    const records = await readProjectableProfileName(vaultRoot);
    expect(records).toEqual([
      {
        data: { displayName: "Theo" },
        occurredAt: "2026-07-01T00:00:00.000Z",
        recordKey: "profile-name",
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "profile-name.v0",
        projectionScope: PROFILE_SCOPE,
        records,
      })
    ).not.toThrow();

    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => [PROFILE_SCOPE],
      },
    });
    expect(result.outcome).toBe("delivered");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({
      projectionKind: "profile-name.v0",
      projectionScope: PROFILE_SCOPE,
      records,
    });
  });

  it("backfills the projection from unambiguous legacy Identity memory", async () => {
    const vaultRoot = await createLegacyMemoryDisplayNameVault("The user's name is Theo.");
    const records = await readProjectableProfileName(vaultRoot);

    expect(records).toEqual([
      {
        data: { displayName: "Theo" },
        occurredAt: "2026-07-01T00:00:01.000Z",
        recordKey: "profile-name",
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
  });

  it("falls back to an existing profile-only display name without mutating memory", async () => {
    const vaultRoot = await createLegacyProfileDisplayNameVault("Theo");
    const records = await readProjectableProfileName(vaultRoot);

    expect(records).toEqual([
      {
        data: { displayName: "Theo" },
        occurredAt: "2026-07-01T00:00:00.000Z",
        recordKey: "profile-name",
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual(records);
    await expect(readFile(join(vaultRoot, "bank", "memory.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("falls back to legacy profile when memory exists without display-name evidence", async () => {
    const vaultRoot = await createLegacyProfileDisplayNameVault("Alice");
    await writeFile(
      join(vaultRoot, "bank", "memory.md"),
      renderMemoryDocument({
        document: createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z")),
      }),
      "utf8",
    );

    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([
      {
        data: { displayName: "Alice" },
        occurredAt: "2026-07-01T00:00:00.000Z",
        recordKey: "profile-name",
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
  });

  it("does not fall back to legacy profile when memory display-name evidence is ambiguous", async () => {
    const vaultRoot = await createLegacyProfileDisplayNameVault("Alice");
    let document = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));
    document = upsertMemoryRecord(document, {
      now: new Date("2026-07-01T00:00:01.000Z"),
      section: "Identity",
      text: formatMemoryDisplayNameRecordText("Ari"),
    }).document;
    document = upsertMemoryRecord(document, {
      now: new Date("2026-07-01T00:00:02.000Z"),
      section: "Identity",
      text: formatMemoryDisplayNameRecordText("Riley"),
    }).document;
    await writeFile(
      join(vaultRoot, "bank", "memory.md"),
      renderMemoryDocument({ document }),
      "utf8",
    );

    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([]);
  });

  it("does not fall back to legacy profile when memory has invalid canonical display-name evidence", async () => {
    const vaultRoot = await createLegacyProfileDisplayNameVault("Alice");
    const document = upsertMemoryRecord(
      createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z")),
      {
        now: new Date("2026-07-01T00:00:01.000Z"),
        section: "Identity",
        text: `Preferred display name: ${"a".repeat(121)}`,
      },
    ).document;
    await writeFile(
      join(vaultRoot, "bank", "memory.md"),
      renderMemoryDocument({ document }),
      "utf8",
    );

    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([]);
  });

  it("projects nothing for compound legacy Identity memory display-name candidates", async () => {
    const vaultRoot = await createLegacyMemoryDisplayNameVault(
      "The user's name is Theo from Seattle.",
    );

    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([]);
  });

  it("projects nothing when legacy Identity memory names are ambiguous", async () => {
    const vaultRoot = await createLegacyMemoryDisplayNameVault(
      "The user's name is Theo.",
      "The user goes by Ari.",
    );

    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([]);
  });

  it("projects nothing when the memory display name is absent", async () => {
    const vaultRoot = await createMemoryDisplayNameVault(null);
    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([]);

    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => [PROFILE_SCOPE],
      },
    });
    expect(result.outcome).toBe("no-projectable-records");
    expect(deliver).not.toHaveBeenCalled();
  });
});
