import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEVICE_SYNC_GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED_ERROR_CODE,
} from "@murphai/device-syncd/fitbit-migration";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
} from "@murphai/device-syncd/public-account";
import type {
  DeviceConnectionHandler,
  DeviceSyncRegistry,
  ListDeviceConnectionSourcesInput,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/types";

import { completeHostedGoogleHealthFitbitMigration } from "@/src/lib/device-sync/fitbit-migration-cutover";
import type {
  CreateHostedSignalInput,
  HostedDeviceConnectionSource,
  HostedPrismaTransactionClient,
  HostedSignalRecord,
} from "@/src/lib/device-sync/prisma-store";

const NOW = "2026-08-17T18:00:00.000Z";
const CONNECTION_ID = "dsc_fitbit_migration";
const USER_ID = "member_fitbit_migration";

function connection(): PublicDeviceSyncAccount {
  return {
    accessTokenExpiresAt: null,
    connectedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    displayName: "Fitbit",
    externalAccountId: "junction-fitbit-migration",
    id: CONNECTION_ID,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSyncCompletedAt: NOW,
    lastSyncErrorAt: null,
    lastSyncStartedAt: NOW,
    lastWebhookAt: NOW,
    metadata: {},
    nextReconcileAt: null,
    provider: "junction",
    scopes: [],
    status: "active",
    updatedAt: NOW,
  };
}

function source(input: {
  error?: string | null;
  lastSeenAt?: string;
  provider: "fitbit" | "google_health";
  status?: HostedDeviceConnectionSource["status"];
}): HostedDeviceConnectionSource {
  const legacy = input.provider === "fitbit";
  return {
    connectionId: CONNECTION_ID,
    createdAt: "2026-08-01T00:00:00.000Z",
    displayName: legacy ? "Fitbit" : "Google Health",
    firstSeenAt: legacy
      ? "2026-08-01T00:00:00.000Z"
      : "2026-08-16T10:00:00.000Z",
    id: `${input.provider}-source`,
    lastDataAt: legacy ? "2026-08-16T23:59:59.000Z" : NOW,
    lastErrorCode: input.error ?? null,
    lastErrorMessage: null,
    lifecycleEpoch: 1,
    lastSeenAt: input.lastSeenAt ?? "2026-08-17T17:59:00.000Z",
    resourceAvailabilitySummary: legacy
      ? {
          activity: true,
          canonicalCoverageBoundary_activity: "2026-08-16",
          canonicalCoverageFinalizedAt_activity: NOW,
          historicalBackfillCompletedAt: "2026-08-17T17:00:00.000Z",
        }
      : {
          activity: true,
          historicalBackfillCompletedAt: "2026-08-17T17:00:00.000Z",
        },
    sourceInstanceKey: `${CONNECTION_ID}:${input.provider}`,
    sourceProviderSlug: input.provider,
    status: input.status ?? "connected",
    updatedAt: NOW,
  };
}

class FakeCutoverStore {
  connection = connection();
  sources: HostedDeviceConnectionSource[] = [
    source({ provider: "fitbit" }),
    source({ provider: "google_health" }),
  ];
  pendingDirty = false;
  pendingDirtyChecks: boolean[] = [];
  signals: HostedSignalRecord[] = [];
  writes: Array<{ code: string | null; status: string }> = [];
  lockDepth = 0;

  async withConnectionMutationLock<T>(
    connectionId: string,
    callback: (tx: never) => Promise<T>,
  ): Promise<T> {
    expect(connectionId).toBe(CONNECTION_ID);
    this.lockDepth += 1;
    try {
      return await callback({} as never);
    } finally {
      this.lockDepth -= 1;
    }
  }

  async getConnectionForUser(userId: string, connectionId: string) {
    expect(this.lockDepth).toBeGreaterThan(0);
    return userId === USER_ID && connectionId === CONNECTION_ID
      ? structuredClone(this.connection)
      : null;
  }

  async getStoredConnectionAccountForUser(userId: string, connectionId: string) {
    const current = await this.getConnectionForUser(userId, connectionId);
    return current
      ? {
          ...current,
          credential: {
            credentialMetadata: {},
            kind: "provider_config" as const,
            providerConfigKey: "junction_default",
          },
          disconnectGeneration: 0,
          keyVersion: null,
          tokenVersion: null,
        }
      : null;
  }

  async listConnectionSources(
    input: ListDeviceConnectionSourcesInput,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedDeviceConnectionSource[]>;
  async listConnectionSources(
    input: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedDeviceConnectionSource[]>;
  async listConnectionSources(
    input: string | ListDeviceConnectionSourcesInput,
  ): Promise<HostedDeviceConnectionSource[]> {
    expect(this.lockDepth).toBeGreaterThan(0);
    const connectionId = typeof input === "string" ? input : input.connectionId;
    expect(connectionId).toBe(CONNECTION_ID);
    const sources = structuredClone(this.sources);
    if (typeof input === "string") {
      return sources;
    }
    return sources.filter((candidate) =>
      (!input.sourceProviderSlug
        || candidate.sourceProviderSlug === input.sourceProviderSlug)
      && (!input.status || candidate.status === input.status)
    );
  }

  async hasPendingDirtyConnection(connectionId: string) {
    expect(this.lockDepth).toBeGreaterThan(0);
    expect(connectionId).toBe(CONNECTION_ID);
    return this.pendingDirtyChecks.shift() ?? this.pendingDirty;
  }

  async upsertConnectionSource(input: {
    connectionId: string;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    lastSeenAt?: string | null;
    sourceInstanceKey: string;
    sourceProviderSlug: string;
    status?: HostedDeviceConnectionSource["status"] | null;
  }) {
    expect(this.lockDepth).toBeGreaterThan(0);
    const current = this.sources.find((candidate) =>
      candidate.sourceInstanceKey === input.sourceInstanceKey
    );
    if (!current) {
      throw new Error("Expected migration source.");
    }
    if (input.status) current.status = input.status;
    if (input.lastErrorCode !== undefined) current.lastErrorCode = input.lastErrorCode;
    if (input.lastErrorMessage !== undefined) {
      current.lastErrorMessage = input.lastErrorMessage;
    }
    if (input.lastSeenAt) current.lastSeenAt = input.lastSeenAt;
    this.writes.push({ code: current.lastErrorCode, status: current.status });
    return structuredClone(current);
  }

  async createSignal(input: CreateHostedSignalInput): Promise<HostedSignalRecord> {
    expect(this.lockDepth).toBeGreaterThan(0);
    const signal = {
      id: this.signals.length + 1,
      userId: input.userId,
      connectionId: input.connectionId ?? null,
      provider: input.provider,
      kind: input.kind,
      occurredAt: input.occurredAt ?? null,
      traceId: input.traceId ?? null,
      eventType: input.eventType ?? null,
      resourceCategory: input.resourceCategory ?? null,
      sourceProviderSlug: input.sourceProviderSlug ?? null,
      reason: input.reason ?? null,
      nextReconcileAt: input.nextReconcileAt ?? null,
      revokeWarning: input.revokeWarning ?? null,
      createdAt: input.createdAt ?? NOW,
    } satisfies HostedSignalRecord;
    this.signals.push(signal);
    return structuredClone(signal);
  }
}

function registry(input: {
  active?: () => boolean | Promise<boolean>;
  revoke?: () => void | Promise<void>;
}): DeviceSyncRegistry {
  const handler = {
    beginConnection: vi.fn(),
    completeConnection: vi.fn(),
    isSourceAccessActive: vi.fn(async () => input.active?.() ?? true),
    revokeSourceAccess: vi.fn(async () => input.revoke?.()),
  } satisfies DeviceConnectionHandler;
  return {
    get: (provider) => provider === "junction"
      ? ({ connectionHandler: handler, provider: "junction" } as never)
      : undefined,
    list: () => [],
    register: () => undefined,
  };
}

function legacy(value: FakeCutoverStore): HostedDeviceConnectionSource {
  const result = value.sources.find((candidate) => candidate.sourceProviderSlug === "fitbit");
  if (!result) throw new Error("Missing legacy Fitbit source.");
  return result;
}

async function complete(value: FakeCutoverStore, valueRegistry: DeviceSyncRegistry) {
  return completeHostedGoogleHealthFitbitMigration({
    connectionId: CONNECTION_ID,
    registry: valueRegistry,
    store: value,
    userId: USER_ID,
  });
}

describe("hosted Google Health Fitbit cutover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("claims under the connection lock, revokes only outside it, and finalizes", async () => {
    const value = new FakeCutoverStore();
    const valueRegistry = registry({
      revoke: () => {
        expect(value.lockDepth).toBe(0);
      },
    });

    await expect(complete(value, valueRegistry)).resolves.toEqual({
      connectionId: CONNECTION_ID,
      status: "complete",
    });
    expect(value.writes.map((write) => write.code)).toEqual([
      DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
    ]);
    expect(legacy(value).status).toBe("disconnected");
    expect(value.signals).toHaveLength(1);
    expect(value.signals[0]).toMatchObject({
      reason: "user_disconnect",
      sourceProviderSlug: "fitbit",
    });
    const revokeSourceAccess =
      valueRegistry.get("junction")?.connectionHandler?.revokeSourceAccess;
    expect(revokeSourceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: CONNECTION_ID }),
      "fitbit",
      { requiredActiveSourceProviderSlug: "google_health" },
    );

    await expect(complete(value, valueRegistry)).resolves.toEqual({
      connectionId: CONNECTION_ID,
      status: "complete",
    });
    expect(revokeSourceAccess).toHaveBeenCalledTimes(1);
    expect(value.signals).toHaveLength(1);
  });

  it("does not claim or call the provider while dirty work is pending", async () => {
    const value = new FakeCutoverStore();
    value.pendingDirty = true;
    const valueRegistry = registry({ revoke: vi.fn() });

    await expect(complete(value, valueRegistry)).resolves.toEqual({
      connectionId: CONNECTION_ID,
      status: "pending",
    });
    expect(value.writes).toEqual([]);
    expect(valueRegistry.get("junction")?.connectionHandler?.revokeSourceAccess)
      .not.toHaveBeenCalled();
    expect(legacy(value).status).toBe("connected");
  });

  it("keeps legacy Fitbit active and records a retry after provider failure", async () => {
    const value = new FakeCutoverStore();
    const valueRegistry = registry({
      active: () => true,
      revoke: () => {
        throw new Error("provider unavailable");
      },
    });

    await expect(complete(value, valueRegistry)).resolves.toEqual({
      connectionId: CONNECTION_ID,
      status: "pending",
    });
    expect(legacy(value)).toMatchObject({
      lastErrorCode: DEVICE_SYNC_GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED_ERROR_CODE,
      status: "connected",
    });
    expect(value.signals).toEqual([]);
  });

  it("recovers a crashed revoke from exact provider-confirmed inactivity", async () => {
    const value = new FakeCutoverStore();
    value.sources[0] = source({
      error: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      lastSeenAt: "2026-08-17T17:50:00.000Z",
      provider: "fitbit",
    });
    const revoke = vi.fn();
    const valueRegistry = registry({ active: () => false, revoke });

    await expect(complete(value, valueRegistry)).resolves.toEqual({
      connectionId: CONNECTION_ID,
      status: "complete",
    });
    expect(revoke).not.toHaveBeenCalled();
    expect(legacy(value)).toMatchObject({
      lastErrorCode: DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
      status: "disconnected",
    });
  });

  it("keeps an ambiguous recovery claim fenced without declaring Fitbit absent", async () => {
    const value = new FakeCutoverStore();
    value.sources[0] = source({
      error: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      lastSeenAt: "2026-08-17T17:50:00.000Z",
      provider: "fitbit",
    });
    const revoke = vi.fn();
    const valueRegistry = registry({
      active: () => {
        throw new Error("provider status is ambiguous");
      },
      revoke,
    });

    await expect(complete(value, valueRegistry)).resolves.toMatchObject({
      status: "pending",
    });
    expect(revoke).not.toHaveBeenCalled();
    expect(legacy(value)).toMatchObject({
      lastErrorCode: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      status: "connected",
    });
  });

  it("leaves a fresh cutover claim with its current owner", async () => {
    const value = new FakeCutoverStore();
    value.sources[0] = source({
      error: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      lastSeenAt: "2026-08-17T17:59:30.000Z",
      provider: "fitbit",
    });
    const revoke = vi.fn();
    const valueRegistry = registry({ active: () => true, revoke });

    await expect(complete(value, valueRegistry)).resolves.toMatchObject({
      status: "pending",
    });
    expect(revoke).not.toHaveBeenCalled();
    expect(value.writes).toEqual([]);
    expect(legacy(value).lastErrorCode).toBe(
      DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
    );
  });

  it("renews a stale active claim before retrying the exact revoke", async () => {
    const value = new FakeCutoverStore();
    value.sources[0] = source({
      error: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      lastSeenAt: "2026-08-17T17:50:00.000Z",
      provider: "fitbit",
    });
    const revoke = vi.fn();
    const valueRegistry = registry({ active: () => true, revoke });

    await expect(complete(value, valueRegistry)).resolves.toMatchObject({
      status: "complete",
    });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(value.writes.map((write) => write.code)).toEqual([
      DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
    ]);
  });

  it("finalizes a confirmed revoke even if successor readiness changes afterward", async () => {
    const value = new FakeCutoverStore();
    const valueRegistry = registry({
      revoke: () => {
        const successor = value.sources.find((candidate) =>
          candidate.sourceProviderSlug === "google_health"
        );
        if (!successor) throw new Error("Missing Google Health source.");
        successor.status = "error";
      },
    });

    await expect(complete(value, valueRegistry)).resolves.toMatchObject({
      status: "complete",
    });
    expect(legacy(value)).toMatchObject({
      lastErrorCode: DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
      status: "disconnected",
    });
  });

  it("waits for dirty acknowledgement after revoke, then recovers without a second revoke", async () => {
    const value = new FakeCutoverStore();
    value.pendingDirtyChecks = [false, true];
    let active = true;
    const revoke = vi.fn(() => {
      expect(value.lockDepth).toBe(0);
      active = false;
    });
    const valueRegistry = registry({ active: () => active, revoke });

    await expect(complete(value, valueRegistry)).resolves.toMatchObject({ status: "pending" });
    expect(legacy(value)).toMatchObject({
      lastErrorCode: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      status: "connected",
    });

    value.pendingDirty = false;
    await expect(complete(value, valueRegistry)).resolves.toMatchObject({ status: "complete" });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(legacy(value).status).toBe("disconnected");
  });

  it("preserves provider-terminal identity when local finalization catches up", async () => {
    const value = new FakeCutoverStore();
    value.sources[0] = source({
      error: DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
      provider: "fitbit",
      status: "disconnected",
    });

    await expect(complete(value, registry({}))).resolves.toMatchObject({ status: "complete" });
    expect(legacy(value).lastErrorCode).toBe(
      DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
    );
    expect(value.signals).toEqual([]);
  });
});
