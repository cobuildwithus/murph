import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, test, vi } from "vitest";
import {
  initializeVault,
  readIntegrationIngestEntries,
  readJsonlRecords,
  updateVaultSummary,
} from "@murphai/core";
import { openSqliteRuntimeDatabase } from "@murphai/runtime-state/node";

import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_RESOURCE,
  COMPANION_HRV_RMSSD_SCHEMA,
  eventRevisionFromLifecycle,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";
import { createConfiguredDeviceSyncProvidersFromConfigs } from "@murphai/device-syncd/config";
import { buildJunctionProviderSourceInstanceKey } from "@murphai/device-syncd/connect-config";
import { JUNCTION_COMPANION_HRV_OBSERVATION_INVALID_CODE } from "@murphai/device-syncd/junction-resources";
import { buildDeviceSyncTokenCipherOptions, createSecretCodec } from "@murphai/device-syncd/local-secret-codec";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  clearJunctionScheduleTimeExtendedHistoryCoverageForProvider,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PAGE_LIMIT,
} from "@murphai/device-syncd/hosted-runtime";
import {
  type DeviceSyncAccount,
  type DeviceSyncImporterPort,
  type DeviceSyncJobRecord,
  type DeviceSyncProvider,
  type ProviderAuthTokens,
  type StoredDeviceSyncAccount,
} from "@murphai/device-syncd/types";
import {
  createDefaultImporterPort,
  type DeviceSyncClock,
  type DeviceSyncService,
} from "@murphai/device-syncd/service";
import type {
  HostedExecutionDeviceSyncDirtyStateResponse,
  HostedExecutionDeviceSyncDirtyPendingResponse,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeConnectionStatus,
  HostedExecutionDeviceSyncRuntimeCredentialSnapshot,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

import {
  closeHostedRuntimeDeviceSyncService,
  createHostedRuntimeDeviceSyncService,
  requireHostedRuntimeDeviceSyncStore,
} from "../src/device-sync-service.ts";
import {
  fetchCompleteHostedDeviceSyncRuntimeSnapshot,
  promoteHostedCompletedDirtyPayloadAcks,
  reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState,
  type HostedDeviceSyncRuntimeSyncState,
} from "../src/hosted-device-sync-runtime.ts";
import {
  HostedRuntimeArtifactWriteError,
  type HostedRuntimeDeviceSyncPort,
} from "../src/hosted-runtime/platform.ts";
import { recordHostedDeviceSyncDirtyPostCheckpointRecord } from "../src/hosted-runtime/system-mailbox.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const hostedExecutionMocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: hostedExecutionMocks.emitHostedExecutionStructuredLog,
  };
});

const DEVICE_SYNC_SECRET = "secret-for-tests";
type ApplyUpdatesRequest = Parameters<HostedRuntimeDeviceSyncPort["applyUpdates"]>[0];

beforeEach(() => {
  hostedExecutionMocks.emitHostedExecutionStructuredLog.mockClear();
});

function requireStoredOAuthCredential(
  account: StoredDeviceSyncAccount | null | undefined,
): Extract<StoredDeviceSyncAccount["credential"], { kind: "oauth_tokens" }> {
  assert.ok(account);
  assert.equal(account.credential.kind, "oauth_tokens");
  return account.credential;
}

function assertStoredCredentialKind(
  account: StoredDeviceSyncAccount | null | undefined,
  kind: StoredDeviceSyncAccount["credential"]["kind"],
): void {
  assert.ok(account);
  assert.equal(account.credential.kind, kind);
}

function getStore(service: DeviceSyncService) {
  return requireHostedRuntimeDeviceSyncStore(service);
}

function createFakeProvider(overrides: Partial<DeviceSyncProvider> = {}): DeviceSyncProvider {
  const baseProvider: DeviceSyncProvider = {
    provider: "demo",
    descriptor: {
      provider: "demo",
      displayName: "Demo",
      transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
      oauth: {
        callbackPath: "/oauth/demo/callback",
        defaultScopes: ["offline", "read:data"],
      },
      webhook: {
        path: "/webhooks/demo",
        deliveryMode: "notification",
        supportsAdmin: false,
      },
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      sourcePriorityHints: {
        defaultPriority: 50,
        metricFamilies: {
          activity: 50,
        },
      },
    },
    connectionHandler: {
      async beginConnection(context) {
        return {
          authorizationUrl: `https://example.test/oauth?state=${context.state}`,
          scopes: context.scopes,
        };
      },
      async completeConnection(context) {
        const code = context.query.get("code") ?? "missing-code";
        return {
          connectedAt: "2026-04-04T09:00:00.000Z",
          displayName: `Demo ${code}`,
          externalAccountId: `demo-${code}`,
          initialJobs: [],
          metadata: {
            connectedBy: code,
          },
          nextReconcileAt: "2026-04-04T12:00:00.000Z",
          scopes: ["offline", "read:data"],
          tokens: {
            accessToken: "provider-access-token",
            refreshToken: "provider-refresh-token",
          },
        };
      },
      async refreshTokens(_account: DeviceSyncAccount): Promise<ProviderAuthTokens> {
        return {
          accessToken: "provider-access-token-2",
          refreshToken: "provider-refresh-token-2",
        };
      },
    },
    jobExecutor: {
      async executeJob(_context, _job: DeviceSyncJobRecord) {
        return {};
      },
    },
  };

  return {
    ...baseProvider,
    ...overrides,
  };
}

function createTestJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function readTestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function createDeviceSyncServiceForVault(
  vaultRoot: string,
  providers: readonly DeviceSyncProvider[] = [createFakeProvider()],
  options: {
    clock?: DeviceSyncClock;
    importer?: DeviceSyncImporterPort;
    shouldYieldJobExecution?: (() => boolean) | null;
  } = {},
) {
  const { shouldYieldJobExecution, ...serviceOptions } = options;
  return createHostedRuntimeDeviceSyncService({
    secret: DEVICE_SYNC_SECRET,
    config: {
      publicBaseUrl: "https://sync.example.test/device-sync",
      shouldYieldJobExecution,
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      vaultRoot,
    },
    providers,
    ...serviceOptions,
  });
}

function buildCronWake(occurredAt: string) {
  return {
    eventId: "evt_cron",
    kind: "runtime.timer" as const,
    occurredAt,
    triggerKind: "runtime_timer" as const,
    userId: "member_123",
  };
}

function buildHostedWorkoutRuntimeFixture(input: {
  connectionId: string;
  externalAccountId: string;
  workoutId: string;
}) {
  return {
    snapshot: buildRuntimeSnapshot({
      connectionId: input.connectionId,
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      externalAccountId: input.externalAccountId,
      provider: "junction",
      sources: [{
        displayName: "Garmin",
        firstSeenAt: "2026-04-04T09:00:00.000Z",
        lastDataAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-04-04T10:00:00.000Z",
        resourceCount: 1,
        resourceAvailabilitySummary: { workouts: true },
        sourceInstanceKey: "garmin",
        sourceProviderSlug: "garmin",
        status: "connected",
      }],
    }),
    dirtyState: buildDirtyState({
      connectionId: input.connectionId,
      dirtyResources: [{
        count: 1,
        jobKind: "resource",
        maxAttempts: 3,
        payload: {
          eventType: "daily.data.workout_stream.created",
          objectId: input.workoutId,
          occurredAt: "2026-04-04T10:00:00.000Z",
          resource: "workout_stream",
          resourceCategory: "timeseries",
          sourceLifecycleEpoch: 1,
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          sport: "running",
          windowEnd: "2026-04-04T10:00:00.000Z",
          windowStart: "2026-04-04T10:00:00.000Z",
        },
        resource: "workout_stream",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        windowEnd: "2026-04-04T10:00:00.000Z",
        windowStart: "2026-04-04T10:00:00.000Z",
      }],
      provider: "junction",
      resourceCategoryCounts: { timeseries: 1 },
      sourceProviderCounts: { garmin: 1 },
      windowEnd: "2026-04-04T10:00:00.000Z",
      windowStart: "2026-04-04T10:00:00.000Z",
    }),
  };
}

function createSingleHostedDirtyStatePort(
  snapshot: ReturnType<typeof buildRuntimeSnapshot>,
  dirtyState: ReturnType<typeof buildDirtyState>,
): HostedRuntimeDeviceSyncPort {
  return {
    ...createNoDirtyStateDeviceSyncPortMethods(),
    async applyUpdates() {
      throw new Error("applyUpdates should not be called during sync");
    },
    async createConnectLink() {
      throw new Error("createConnectLink should not be called during sync");
    },
    async fetchDirtyStates() {
      return {
        hasMore: false,
        items: [dirtyState],
        nextWakeAt: null,
        userId: "member_123",
      };
    },
    async fetchSnapshot() {
      return snapshot;
    },
  };
}

function buildDeviceSyncWake(input: {
  connectionId: string;
  eventId?: string;
  expectedConnectedAt?: string | null;
  hint?: {
    jobs?: Array<{
      availableAt?: string;
      dedupeKey?: string;
      kind: string;
      maxAttempts?: number;
      payload?: Record<string, unknown>;
      priority?: number;
    }>;
    nextReconcileAt?: string | null;
    memberEditConflictResolution?: "keep_member" | "use_provider";
    reason?: string | null;
  };
  occurredAt: string;
  provider?: string;
  reason: "disconnected" | "reauthorization_required" | "reconcile_due" | "webhook_hint";
}) {
  return {
    connectionId: input.connectionId,
    eventId: input.eventId ?? "evt_device_sync_wake",
    ...(input.expectedConnectedAt === null
      ? {}
      : {
          expectedConnectedAt:
            input.expectedConnectedAt ?? "2026-04-04T09:00:00.000Z",
        }),
    ...(input.hint ? { hint: input.hint } : {}),
    kind: "device-sync.wake" as const,
    occurredAt: input.occurredAt,
    provider: input.provider ?? "demo",
    reason: input.reason,
    userId: "member_123",
  };
}

function buildRuntimeSnapshot(input: {
  capabilities?: HostedExecutionDeviceSyncRuntimeSnapshotResponse["capabilities"];
  connectedAt?: string;
  connectionId: string;
  displayName?: string | null;
  externalAccountId: string;
  generatedAt?: string;
  hostedUpdatedAt?: string;
  localState?: {
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    lastSyncCompletedAt?: string | null;
    lastSyncErrorAt?: string | null;
    lastSyncStartedAt?: string | null;
    lastWebhookAt?: string | null;
    nextReconcileAt?: string | null;
  };
  metadata?: Record<string, unknown>;
  provider?: string;
  providerConfigs?: HostedExecutionDeviceSyncRuntimeSnapshotResponse["providerConfigs"];
  setupExpiresAt?: string | null;
  setupPhase?: "pending_link" | "link_returned" | "source_confirmed" | "failed" | null;
  status?: HostedExecutionDeviceSyncRuntimeConnectionStatus;
  sources?: NonNullable<HostedExecutionDeviceSyncRuntimeSnapshotResponse["connections"][number]["sources"]>;
  credential?: HostedExecutionDeviceSyncRuntimeCredentialSnapshot;
  tokenBundle?: {
    accessToken: string;
    accessTokenExpiresAt: string | null;
    refreshToken: string | null;
    tokenVersion: number;
  } | null;
}): HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  const credentialTokenBundle = input.credential?.kind === "oauth_tokens"
    ? input.credential.tokenBundle
    : null;
  const tokenBundleForConnection = credentialTokenBundle ?? (
    input.tokenBundle === null
      ? null
      : {
          accessToken: input.tokenBundle?.accessToken ?? "hosted-access-token",
          accessTokenExpiresAt: input.tokenBundle?.accessTokenExpiresAt ?? "2026-04-05T00:00:00.000Z",
          keyVersion: "hosted-runtime",
          refreshToken: input.tokenBundle?.refreshToken ?? "hosted-refresh-token",
          tokenVersion: input.tokenBundle?.tokenVersion ?? 4,
        }
  );
  const credential = input.credential ?? (
    tokenBundleForConnection
      ? {
          kind: "oauth_tokens" as const,
          tokenBundle: tokenBundleForConnection,
        }
      : {
          kind: "none" as const,
          credentialMetadata: {},
        }
  );
  return {
    ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
    connections: [
      {
        connection: {
          accessTokenExpiresAt: tokenBundleForConnection?.accessTokenExpiresAt ?? null,
          connectedAt: input.connectedAt ?? "2026-04-04T09:00:00.000Z",
          createdAt: input.connectedAt ?? "2026-04-04T09:00:00.000Z",
          displayName: input.displayName ?? "Hosted Demo",
          externalAccountId: input.externalAccountId,
          id: input.connectionId,
          metadata: input.metadata ?? {
            hosted: true,
          },
          provider: input.provider ?? "demo",
          scopes: ["offline", "read:data"],
          ...(input.setupExpiresAt === undefined ? {} : { setupExpiresAt: input.setupExpiresAt }),
          ...(input.setupPhase === undefined ? {} : { setupPhase: input.setupPhase }),
          status: input.status ?? "active",
          updatedAt: input.hostedUpdatedAt ?? "2026-04-04T09:05:00.000Z",
        },
        localState: {
          lastErrorCode: input.localState?.lastErrorCode ?? null,
          lastErrorMessage: input.localState?.lastErrorMessage ?? null,
          lastSyncCompletedAt: input.localState?.lastSyncCompletedAt ?? null,
          lastSyncErrorAt: input.localState?.lastSyncErrorAt ?? null,
          lastSyncStartedAt: input.localState?.lastSyncStartedAt ?? null,
          lastWebhookAt: input.localState?.lastWebhookAt ?? null,
          nextReconcileAt: input.localState?.nextReconcileAt ?? null,
        },
        ...(input.sources === undefined ? {} : { sources: input.sources }),
        credential,
      },
    ],
    generatedAt: input.generatedAt ?? "2026-04-04T09:10:00.000Z",
    ...(input.providerConfigs === undefined ? {} : { providerConfigs: input.providerConfigs }),
    userId: "member_123",
  };
}

function buildEmptyRuntimeSnapshot(): HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  return {
    connections: [],
    generatedAt: "2026-04-04T09:10:00.000Z",
    userId: "member_123",
  };
}

function buildRuntimeSnapshotPage(input: {
  count: number;
  nextCursor?: HostedExecutionDeviceSyncRuntimeSnapshotResponse["nextCursor"];
  startIndex: number;
  userId?: string;
}): HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  const connections = Array.from({ length: input.count }, (_, offset) => {
    const index = input.startIndex + offset;
    const updatedAt = new Date(Date.parse("2026-04-07T12:00:00.000Z") - index * 1_000)
      .toISOString();
    return buildRuntimeSnapshot({
      connectionId: `hosted_conn_${String(index).padStart(3, "0")}`,
      externalAccountId: `external_${index}`,
      hostedUpdatedAt: updatedAt,
    }).connections[0]!;
  });

  return {
    connections,
    generatedAt: "2026-04-07T12:01:00.000Z",
    ...(input.nextCursor === undefined ? {} : { nextCursor: input.nextCursor }),
    userId: input.userId ?? "member_123",
  };
}

function buildDirtyState(input: {
  connectionId: string;
  dirtyRevision?: string;
  dirtyResources?: HostedExecutionDeviceSyncDirtyStateResponse["dirtyResources"];
  eventCount?: string;
  provider?: string;
  resourceCategoryCounts?: Record<string, number>;
  sourceProviderCounts?: Record<string, number>;
  windowEnd?: string | null;
  windowStart?: string | null;
}): HostedExecutionDeviceSyncDirtyStateResponse {
  return {
    connectionId: input.connectionId,
    dirtyRevision: input.dirtyRevision ?? "1",
    dirtyResources: input.dirtyResources ?? [],
    eventCount: input.eventCount ?? "1",
    latestDirtyAt: "2026-04-04T10:00:00.000Z",
    processedRevision: "0",
    provider: input.provider ?? "demo",
    resourceCategoryCounts: input.resourceCategoryCounts ?? {},
    sourceProviderCounts: input.sourceProviderCounts ?? {},
    userId: "member_123",
    windowEnd: input.windowEnd ?? null,
    windowStart: input.windowStart ?? null,
  };
}

function createNoDirtyStateDeviceSyncPortMethods(): Pick<
  HostedRuntimeDeviceSyncPort,
  "ackDirtyStateProcessed" | "fetchDirtyStates"
> {
  return {
    async ackDirtyStateProcessed() {
      throw new Error("ackDirtyStateProcessed should not be called during sync");
    },
    async fetchDirtyStates() {
      return {
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: "member_123",
      };
    },
  };
}

function createSnapshotOnlyDeviceSyncPort(
  snapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse,
): HostedRuntimeDeviceSyncPort {
  return {
    ...createNoDirtyStateDeviceSyncPortMethods(),
    async applyUpdates() {
      throw new Error("applyUpdates should not be called during sync");
    },
    async createConnectLink() {
      throw new Error("createConnectLink should not be called during sync");
    },
    async fetchSnapshot() {
      return snapshot;
    },
  };
}

function createDeviceSyncPostCheckpointRuntime(
  deviceSyncPort: HostedRuntimeDeviceSyncPort,
): Parameters<typeof recordHostedDeviceSyncDirtyPostCheckpointRecord>[0]["runtime"] {
  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform: {
      artifactStore: {
        async get() {
          return null;
        },
        async put() {},
      },
      deviceSyncPort,
      effectsPort: {
        async readRawEmailMessage() {
          return null;
        },
        async sendEmail() {},
      },
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}

function requireApplyUpdatesRequest(
  request: ApplyUpdatesRequest | null,
): ApplyUpdatesRequest {
  assert.ok(request);
  return request;
}

function readJobsForAccount(service: DeviceSyncService, accountId: string) {
  const database = openSqliteRuntimeDatabase(getStore(service).databasePath);

  try {
    return database.prepare(`
      select
        available_at as availableAt,
        dedupe_key as dedupeKey,
        id,
        kind,
        last_error_code as lastErrorCode,
        last_error_message as lastErrorMessage,
        max_attempts as maxAttempts,
        payload_json as payloadJson,
        priority,
        status
      from device_job
      where account_id = ?
      order by created_at asc, id asc
    `).all(accountId) as Array<{
      availableAt: string;
      dedupeKey: string | null;
      id: string;
      kind: string;
      lastErrorCode: string | null;
      lastErrorMessage: string | null;
      maxAttempts: number;
      payloadJson: string;
      priority: number;
      status: string;
    }>;
  } finally {
    database.close();
  }
}

async function readCanonicalEventRecords(vaultRoot: string) {
  const eventPaths = [
    "ledger/events/2026/2026-04.jsonl",
  ];
  return (
    await Promise.all(eventPaths.map(async (relativePath) => {
      try {
        return await readJsonlRecords({ vaultRoot, relativePath });
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return [];
        }
        throw error;
      }
    }))
  ).flat();
}

function eventHasMetric(record: Awaited<ReturnType<typeof readCanonicalEventRecords>>[number], metric: string): boolean {
  if (record.kind === "observation") {
    return record.metric === metric;
  }
  return record.kind === "measurement"
    && Array.isArray(record.measurements)
    && record.measurements.some((measurement) =>
      typeof measurement === "object"
      && measurement !== null
      && !Array.isArray(measurement)
      && Reflect.get(measurement, "metric") === metric
    );
}

function eventExternalRefResourceId(
  record: Awaited<ReturnType<typeof readCanonicalEventRecords>>[number],
): string | null {
  const externalRef = record.externalRef;
  if (typeof externalRef !== "object" || externalRef === null || Array.isArray(externalRef)) {
    return null;
  }
  const resourceId = Reflect.get(externalRef, "resourceId");
  return typeof resourceId === "string" ? resourceId : null;
}

function setAccountUpdatedAtForTesting(
  service: DeviceSyncService,
  accountId: string,
  updatedAt: string,
): void {
  const database = openSqliteRuntimeDatabase(getStore(service).databasePath);

  try {
    database.prepare(`
      update device_connection
      set updated_at = ?
      where id = ?
    `).run(updatedAt, accountId);
  } finally {
    database.close();
  }
}

function clearAccountCredentialForTesting(service: DeviceSyncService, accountId: string): void {
  const database = openSqliteRuntimeDatabase(getStore(service).databasePath);
  const now = "2026-04-06T10:00:00.000Z";

  try {
    database.exec("begin immediate transaction");
    database.prepare(`
      update device_credential_state
      set credential_kind = 'none',
          provider_config_key = null,
          access_token_encrypted = null,
          refresh_token_encrypted = null,
          access_token_expires_at = null,
          credential_metadata_json = '{}',
          updated_at = ?
      where account_id = ?
    `).run(now, accountId);
    database.prepare(`
      update device_observation_state
      set local_token_revision = local_token_revision + 1,
          updated_at = ?
      where account_id = ?
    `).run(now, accountId);
    database.exec("commit");
  } catch (error) {
    database.exec("rollback");
    throw error;
  } finally {
    database.close();
  }
}

describe("hosted device-sync runtime", () => {
  test("credential hydration follows stable bounded cursors sequentially", async () => {
    const firstCursor = {
      createdAt: new Date(Date.parse("2026-04-07T12:00:00.000Z") - 31_000).toISOString(),
      id: "hosted_conn_031",
    };
    const pages = [
      buildRuntimeSnapshotPage({
        count: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PAGE_LIMIT,
        nextCursor: firstCursor,
        startIndex: 0,
      }),
      buildRuntimeSnapshotPage({
        count: 2,
        nextCursor: null,
        startIndex: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PAGE_LIMIT,
      }),
    ];
    const fetchSnapshot = vi.fn(async (
      _request: Parameters<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>[0],
    ) => pages.shift()!);
    const deviceSyncPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      applyUpdates: vi.fn(),
      createConnectLink: vi.fn(),
      fetchSnapshot,
    } satisfies HostedRuntimeDeviceSyncPort;

    const snapshot = await fetchCompleteHostedDeviceSyncRuntimeSnapshot({
      deviceSyncPort,
      includeCredentialMaterial: true,
    });

    assert.equal(snapshot.connections.length, 34);
    assert.deepEqual(
      snapshot.connections.map((entry) => entry.connection.id),
      Array.from({ length: 34 }, (_, index) =>
        `hosted_conn_${String(index).padStart(3, "0")}`
      ),
    );
    assert.deepEqual(fetchSnapshot.mock.calls, [
      [{
        includeCredentialMaterial: true,
      }],
      [{
        cursor: firstCursor,
        includeCredentialMaterial: true,
        limit: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PAGE_LIMIT,
      }],
    ]);
  });

  test("credential hydration fails closed at the total authority bound", async () => {
    const pageSizes = [32, 32, 32, 4];
    let startIndex = 0;
    const pages = pageSizes.map((count, pageIndex) => {
      const page = buildRuntimeSnapshotPage({
        count,
        nextCursor: {
          createdAt: new Date(Date.parse("2026-04-07T12:00:00.000Z") - startIndex * 1_000)
            .toISOString(),
          id: `cursor_${pageIndex}`,
        },
        startIndex,
      });
      startIndex += count;
      return page;
    });
    const fetchSnapshot = vi.fn(async (
      _request: Parameters<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>[0],
    ) => pages.shift()!);
    const deviceSyncPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      applyUpdates: vi.fn(),
      createConnectLink: vi.fn(),
      fetchSnapshot,
    } satisfies HostedRuntimeDeviceSyncPort;

    await assert.rejects(
      () => fetchCompleteHostedDeviceSyncRuntimeSnapshot({
        deviceSyncPort,
        includeCredentialMaterial: true,
      }),
      new RegExp(
        `${HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT}-connection hydration bound`,
        "u",
      ),
    );
    assert.equal(fetchSnapshot.mock.calls.length, 4);
    assert.deepEqual(
      fetchSnapshot.mock.calls.map(([request]) => request?.limit),
      [undefined, 32, 32, 4],
    );
  });

  test("credential hydration accepts a bounded legacy first page", async () => {
    const legacyPageWithoutCursor = buildRuntimeSnapshotPage({
      count: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PAGE_LIMIT + 2,
      startIndex: 0,
    });
    const legacyPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      applyUpdates: vi.fn(),
      createConnectLink: vi.fn(),
      fetchSnapshot: vi.fn(async (
        _request: Parameters<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>[0],
      ) => legacyPageWithoutCursor),
    } satisfies HostedRuntimeDeviceSyncPort;

    const snapshot = await fetchCompleteHostedDeviceSyncRuntimeSnapshot({
      deviceSyncPort: legacyPort,
      includeCredentialMaterial: true,
    });

    assert.equal(snapshot.connections.length, 34);
    assert.deepEqual(legacyPort.fetchSnapshot.mock.calls, [[{
      includeCredentialMaterial: true,
    }]]);
  });

  test("credential hydration rejects an oversized legacy page", async () => {
    const legacyPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      applyUpdates: vi.fn(),
      createConnectLink: vi.fn(),
      fetchSnapshot: vi.fn(async (
        _request: Parameters<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>[0],
      ) => buildRuntimeSnapshotPage({
        count: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT + 1,
        startIndex: 0,
      })),
    } satisfies HostedRuntimeDeviceSyncPort;

    await assert.rejects(
      () => fetchCompleteHostedDeviceSyncRuntimeSnapshot({
        deviceSyncPort: legacyPort,
        includeCredentialMaterial: true,
      }),
      new RegExp(
        `${HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT}-connection hydration bound`,
        "u",
      ),
    );
  });

  test("credential hydration rejects missing, repeated, and cross-member cursors", async () => {
    const firstCursor = {
      createdAt: "2026-04-07T12:00:00.000Z",
      id: "hosted_conn_000",
    };
    const cursorPages = [
      buildRuntimeSnapshotPage({ count: 1, nextCursor: firstCursor, startIndex: 0 }),
      buildRuntimeSnapshotPage({ count: 1, startIndex: 1 }),
    ];
    const missingCursorPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      applyUpdates: vi.fn(),
      createConnectLink: vi.fn(),
      fetchSnapshot: vi.fn(async (
        _request: Parameters<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>[0],
      ) => cursorPages.shift()!),
    } satisfies HostedRuntimeDeviceSyncPort;

    await assert.rejects(
      () => fetchCompleteHostedDeviceSyncRuntimeSnapshot({
        deviceSyncPort: missingCursorPort,
        includeCredentialMaterial: true,
      }),
      /omitted its continuation cursor after pagination began/u,
    );

    const cursor = {
      createdAt: "2026-04-07T12:00:00.000Z",
      id: "hosted_conn_000",
    };
    const memberPages = [
      buildRuntimeSnapshotPage({ count: 1, nextCursor: cursor, startIndex: 0 }),
      buildRuntimeSnapshotPage({
        count: 1,
        nextCursor: null,
        startIndex: 1,
        userId: "member_other",
      }),
    ];
    const memberPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      applyUpdates: vi.fn(),
      createConnectLink: vi.fn(),
      fetchSnapshot: vi.fn(async (
        _request: Parameters<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>[0],
      ) => memberPages.shift()!),
    } satisfies HostedRuntimeDeviceSyncPort;

    await assert.rejects(
      () => fetchCompleteHostedDeviceSyncRuntimeSnapshot({
        deviceSyncPort: memberPort,
        includeCredentialMaterial: true,
      }),
      /changed member authority/u,
    );

    const repeatedCursorPages = [
      buildRuntimeSnapshotPage({ count: 1, nextCursor: cursor, startIndex: 0 }),
      buildRuntimeSnapshotPage({ count: 1, nextCursor: cursor, startIndex: 1 }),
    ];
    const repeatedCursorPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      applyUpdates: vi.fn(),
      createConnectLink: vi.fn(),
      fetchSnapshot: vi.fn(async (
        _request: Parameters<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>[0],
      ) => repeatedCursorPages.shift()!),
    } satisfies HostedRuntimeDeviceSyncPort;

    await assert.rejects(
      () => fetchCompleteHostedDeviceSyncRuntimeSnapshot({
        deviceSyncPort: repeatedCursorPort,
        includeCredentialMaterial: true,
      }),
      /repeated a cursor/u,
    );
  });

  test("reconciliation sends source-heavy oversized updates as sequential count-bounded batches", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const store = getStore(service);
      const updateCount = HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT + 1;
      const localToHostedAccountIds = new Map<string, string>();
      const hostedToLocalAccountIds = new Map<string, string>();
      const observedTokenVersions = new Map<string, number | null>();

      for (let index = 0; index < updateCount; index += 1) {
        const account = store.upsertAccount({
          connectedAt: "2026-04-06T09:00:00.000Z",
          credential: {
            credentialMetadata: {},
            kind: "none",
          },
          displayName: `Device ${index}`,
          externalAccountId: `external_${index}`,
          provider: "demo",
          scopes: [],
          status: "active",
        });
        const hostedConnectionId = `hosted_conn_${index}`;
        localToHostedAccountIds.set(account.id, hostedConnectionId);
        hostedToLocalAccountIds.set(hostedConnectionId, account.id);
        observedTokenVersions.set(hostedConnectionId, null);
        for (let sourceIndex = 0; sourceIndex < 64; sourceIndex += 1) {
          store.upsertConnectionSource({
            connectionId: account.id,
            displayName: null,
            firstSeenAt: "2026-04-06T09:00:00.000Z",
            lastSeenAt: "2026-04-06T10:05:00.000Z",
            resourceAvailabilitySummary: {
              activity: true,
              heartrate: true,
            },
            sourceInstanceKey:
              `source_${String(index).padStart(3, "0")}_${String(sourceIndex).padStart(2, "0")}_${"x".repeat(80)}`,
            sourceProviderSlug: `source_${sourceIndex}`,
            status: "connected",
          });
        }
      }

      let activeApplyCalls = 0;
      let maxActiveApplyCalls = 0;
      const appliedRequests: ApplyUpdatesRequest[] = [];
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          activeApplyCalls += 1;
          maxActiveApplyCalls = Math.max(maxActiveApplyCalls, activeApplyCalls);
          await Promise.resolve();
          appliedRequests.push(input);
          activeApplyCalls -= 1;
          return {
            appliedAt: "2026-04-06T09:11:00.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          throw new Error("fetchSnapshot should not be called during reconciliation");
        },
      };

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        secret: DEVICE_SYNC_SECRET,
        service,
        state: {
          hostedToLocalAccountIds,
          localToHostedAccountIds,
          observedTokenVersions,
          pendingDirtyAcks: [],
          pendingDirtyPayloadJobs: [],
          snapshot: {
            ...buildEmptyRuntimeSnapshot(),
            capabilities: {
              connectionSourceApply: true,
            },
          },
        },
        wake: buildCronWake("2026-04-06T09:10:00.000Z"),
      });

      assert.equal(appliedRequests.length, 2);
      assert.equal(
        appliedRequests[0]?.updates.length,
        HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT,
      );
      assert.equal(appliedRequests[1]?.updates.length, 1);
      assert.equal(maxActiveApplyCalls, 1);
      assert.equal(
        appliedRequests[0]?.updates.every((update) => update.sources?.length === 64),
        true,
      );
      assert.ok(
        new TextEncoder().encode(JSON.stringify({
          updates: appliedRequests[0]?.updates,
          userId: "member_123",
        })).byteLength > HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES,
      );
      assert.deepEqual(
        appliedRequests.flatMap((request) => request.updates.map((update) => update.connectionId)),
        Array.from({ length: updateCount }, (_, index) => `hosted_conn_${index}`),
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync fails closed when no device-sync client is available", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      await assert.rejects(
        () => syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort: null,
          wake: buildCronWake("2026-04-06T09:10:00.000Z"),
          secret: DEVICE_SYNC_SECRET,
          service,
        }),
        /configured hosted device-sync control-plane port/u,
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync preserves a null hosted snapshot without trying to hydrate accounts", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);
    let fetchSnapshotCalls = 0;
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      async applyUpdates() {
        throw new Error("applyUpdates should not be called during sync");
      },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync");
        },
        async fetchSnapshot() {
          fetchSnapshotCalls += 1;
          return buildEmptyRuntimeSnapshot();
        },
    };

    try {
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(fetchSnapshotCalls, 1);
      assert.deepEqual(state.snapshot, buildEmptyRuntimeSnapshot());
      assert.equal(state.hostedToLocalAccountIds.size, 0);
      assert.equal(state.localToHostedAccountIds.size, 0);
      assert.equal(state.observedTokenVersions.size, 0);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync carries the source arrival signal and merges it monotonically", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({ provider: "demo" });
      const connected = await service.handleOAuthCallback({
        code: "source-arrival",
        provider: "demo",
        state: begin.state,
      });
      const buildSnapshotWith = (lastDataAt: string | null, lastSeenAt: string) =>
        buildRuntimeSnapshot({
          connectionId: "hosted_conn_source_arrival",
          externalAccountId: connected.account.externalAccountId,
          sources: [
            {
              displayName: "Garmin",
              firstSeenAt: "2026-04-01T09:00:00.000Z",
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSeenAt,
              lastDataAt,
              resourceCount: 2,
              sourceInstanceKey: "hosted-source-garmin",
              sourceProviderSlug: "garmin",
              status: "connected",
            },
          ],
        });
      let snapshot = buildSnapshotWith("2026-04-05T09:00:00.000Z", "2026-04-05T09:00:00.000Z");
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates() {
          throw new Error("applyUpdates should not be called during sync");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };
      const readArrival = () =>
        getStore(service).listConnectionSources({
          connectionId: connected.account.id,
        })[0]?.lastDataAt ?? null;

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      // A non-null hosted arrival must reach the runner, or every source looks
      // like it has never delivered and trips the never-delivered rule.
      assert.equal(readArrival(), "2026-04-05T09:00:00.000Z");

      // A later hosted arrival advances it even when nothing else changed.
      snapshot = buildSnapshotWith("2026-04-07T09:00:00.000Z", "2026-04-05T09:00:00.000Z");
      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-07T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      assert.equal(readArrival(), "2026-04-07T09:00:00.000Z");

      // An older or absent hosted value must never rewind what the runner saw.
      snapshot = buildSnapshotWith("2026-04-02T09:00:00.000Z", "2026-04-08T09:00:00.000Z");
      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-08T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      assert.equal(readArrival(), "2026-04-07T09:00:00.000Z");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync seeds hosted connection sources without overwriting unpublished local state", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({ provider: "demo" });
      const connected = await service.handleOAuthCallback({
        code: "source-hydration",
        provider: "demo",
        state: begin.state,
      });
      let snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_source_hydration",
        externalAccountId: connected.account.externalAccountId,
        sources: [
          {
            displayName: "Garmin",
            firstSeenAt: "2026-04-01T09:00:00.000Z",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSeenAt: "2026-04-04T09:00:00.000Z",
            lastDataAt: null,
            resourceCount: 2,
            resourceAvailabilitySummary: {
              activity: true,
              sleep: true,
            },
            sourceInstanceKey: "hosted-source-garmin",
            sourceProviderSlug: "garmin",
            status: "connected",
          },
          {
            displayName: null,
            firstSeenAt: "2026-04-01T09:00:00.000Z",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSeenAt: "2026-04-04T09:00:00.000Z",
            lastDataAt: null,
            resourceCount: 0,
            sourceProviderSlug: "legacy",
            status: "connected",
          },
        ],
      });
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates() {
          throw new Error("applyUpdates should not be called during sync");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const seededSources = getStore(service).listConnectionSources({
        connectionId: connected.account.id,
      });
      assert.equal(seededSources.length, 1);
      const [seededSource] = seededSources;
      assert.ok(seededSource);
      assert.deepEqual(
        {
          displayName: seededSource.displayName,
          firstSeenAt: seededSource.firstSeenAt,
          lastErrorCode: seededSource.lastErrorCode,
          lastErrorMessage: seededSource.lastErrorMessage,
          lastSeenAt: seededSource.lastSeenAt,
          resourceAvailabilitySummary: seededSource.resourceAvailabilitySummary,
          sourceInstanceKey: seededSource.sourceInstanceKey,
          sourceProviderSlug: seededSource.sourceProviderSlug,
          status: seededSource.status,
        },
        {
          displayName: "Garmin",
          firstSeenAt: "2026-04-01T09:00:00.000Z",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: "2026-04-04T09:00:00.000Z",
          resourceAvailabilitySummary: {
            activity: true,
            sleep: true,
          },
          sourceInstanceKey: "hosted-source-garmin",
          sourceProviderSlug: "garmin",
          status: "connected",
        },
      );

      snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_source_hydration",
        externalAccountId: connected.account.externalAccountId,
        sources: [
          {
            displayName: "Garmin updated",
            firstSeenAt: "2026-04-01T09:00:00.000Z",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSeenAt: "2026-04-06T09:12:00.000Z",
            lastDataAt: null,
            resourceCount: 3,
            resourceAvailabilitySummary: {
              activity: true,
              hypnogram: true,
              sleep: true,
            },
            sourceInstanceKey: "hosted-source-garmin",
            sourceProviderSlug: "garmin",
            status: "unavailable",
          },
        ],
      });
      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:13:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const [refreshedSource] = getStore(service).listConnectionSources({
        connectionId: connected.account.id,
      });

      assert.equal(refreshedSource?.displayName, "Garmin updated");
      assert.equal(refreshedSource?.status, "unavailable");
      assert.equal(refreshedSource?.lastSeenAt, "2026-04-06T09:12:00.000Z");
      assert.deepEqual(refreshedSource?.resourceAvailabilitySummary, {
        activity: true,
        hypnogram: true,
        sleep: true,
      });
      assert.ok(refreshedSource);

      getStore(service).upsertConnectionSource({
        connectionId: connected.account.id,
        sourceInstanceKey: refreshedSource.sourceInstanceKey,
        sourceProviderSlug: refreshedSource.sourceProviderSlug,
        displayName: refreshedSource.displayName,
        status: "error",
        resourceAvailabilitySummary: refreshedSource.resourceAvailabilitySummary,
        lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
        lastErrorMessage: "Historical data remained incomplete.",
        firstSeenAt: refreshedSource.firstSeenAt,
        lastSeenAt: "2026-04-06T09:15:00.000Z",
      });

      const repeatedState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:20:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const [preservedSource] = getStore(service).listConnectionSources({
        connectionId: connected.account.id,
      });

      assert.equal(repeatedState.snapshot?.connections[0]?.sources?.[0]?.status, "unavailable");
      assert.equal(preservedSource?.status, "error");
      assert.equal(preservedSource?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
      assert.equal(preservedSource?.lastSeenAt, "2026-04-06T09:15:00.000Z");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync reuses one semantic Junction source across hosted and local key spaces", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        fetchImpl: async () => {
          throw new Error("Junction network access is not expected during source hydration.");
        },
        region: "us",
        summaryBackfillDays: 2,
        summaryResources: ["activity", "sleep"],
        timeseriesResources: [],
      },
    });
    assert.ok(provider);
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider]);
    const hostedConnectionId = "hosted_conn_junction_source_identity";
    const externalAccountId = "junction-source-identity";
    const windowStart = "2026-04-01T00:00:00.000Z";
    const windowEnd = "2026-04-03T00:00:00.000Z";
    const retryingMetadata = {
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillEvidence: `e2|${windowStart}|${windowEnd}|garmin:1`,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillWindowEnd: windowEnd,
      junctionHistoricalBackfillWindowStart: windowStart,
    };
    let hostedSnapshot = buildRuntimeSnapshot({
      connectionId: hostedConnectionId,
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      externalAccountId,
      metadata: retryingMetadata,
      provider: "junction",
    });
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      async applyUpdates() {
        throw new Error("applyUpdates should not be called during source hydration.");
      },
      async createConnectLink() {
        throw new Error("createConnectLink should not be called during source hydration.");
      },
      async fetchSnapshot() {
        return hostedSnapshot;
      },
    };

    try {
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get(hostedConnectionId);
      assert.ok(localAccountId);
      const localSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: localAccountId,
        sourceProviderSlug: "garmin",
      });
      const hostedSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: hostedConnectionId,
        sourceProviderSlug: "garmin",
      });
      assert.ok(localSourceInstanceKey);
      assert.ok(hostedSourceInstanceKey);
      assert.notEqual(localSourceInstanceKey, hostedSourceInstanceKey);

      getStore(service).upsertConnectionSource({
        connectionId: localAccountId,
        displayName: "Garmin",
        firstSeenAt: "2026-04-01T09:00:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-04-06T09:20:00.000Z",
        resourceAvailabilitySummary: { activity: true },
        sourceInstanceKey: localSourceInstanceKey,
        sourceProviderSlug: "garmin",
        status: "connected",
      });
      hostedSnapshot = buildRuntimeSnapshot({
        connectionId: hostedConnectionId,
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId,
        metadata: retryingMetadata,
        provider: "junction",
        sources: [
          {
            displayName: "Garmin",
            firstSeenAt: "2026-04-01T09:00:00.000Z",
            lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
            lastErrorMessage: "Historical data remained incomplete.",
            lastSeenAt: "2026-04-06T09:25:00.000Z",
            lastDataAt: null,
            resourceCount: 2,
            resourceAvailabilitySummary: { activity: true, sleep: true },
            sourceInstanceKey: hostedSourceInstanceKey,
            sourceProviderSlug: "garmin",
            status: "error",
          },
        ],
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:25:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const sources = getStore(service).listConnectionSources({
        connectionId: localAccountId,
      });
      assert.equal(sources.length, 1);
      assert.equal(sources[0]?.sourceInstanceKey, localSourceInstanceKey);
      assert.equal(sources[0]?.sourceProviderSlug, "garmin");
      assert.equal(sources[0]?.status, "error");
      assert.equal(
        sources[0]?.lastErrorCode,
        "HISTORICAL_DATA_RECONNECT_REQUIRED",
      );
      assert.equal(sources[0]?.lastSeenAt, "2026-04-06T09:25:00.000Z");
      assert.deepEqual(sources[0]?.resourceAvailabilitySummary, {
        activity: true,
        sleep: true,
      });

      hostedSnapshot = buildRuntimeSnapshot({
        connectionId: hostedConnectionId,
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:30:00.000Z",
        metadata: retryingMetadata,
        provider: "junction",
        sources: [
          {
            displayName: "Garmin",
            firstSeenAt: "2026-04-01T09:00:00.000Z",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSeenAt: "2026-04-06T09:30:00.000Z",
            lastDataAt: null,
            resourceCount: 1,
            resourceAvailabilitySummary: { activity: true },
            sourceInstanceKey: hostedSourceInstanceKey,
            sourceProviderSlug: "garmin",
            status: "connected",
          },
        ],
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const reconnectedSources = getStore(service).listConnectionSources({
        connectionId: localAccountId,
      });
      assert.equal(reconnectedSources.length, 1);
      assert.equal(reconnectedSources[0]?.sourceInstanceKey, localSourceInstanceKey);
      assert.equal(reconnectedSources[0]?.status, "connected");
      assert.equal(reconnectedSources[0]?.lastErrorCode, null);
      assert.equal(reconnectedSources[0]?.lastSeenAt, "2026-04-06T09:30:00.000Z");
      assert.equal(
        getStore(service).getAccountById(localAccountId)?.metadata
          .junctionHistoricalBackfillStatus,
        "coverage_v3_retrying",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync makes Junction reconnect history clearing authoritative over stale local coverage", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        fetchImpl: async () => {
          throw new Error("Junction network access is not expected during source hydration.");
        },
        region: "us",
        summaryBackfillDays: 2,
        summaryResources: ["activity", "sleep"],
        timeseriesResources: [],
      },
    });
    assert.ok(provider);
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider]);
    const hostedConnectionId = "hosted_conn_junction_reestablished";
    const externalAccountId = "junction-reestablished";
    const metadata = {
      junctionBloodPressureHistoryBackfillCoverage: "v2|garmin,oura",
      junctionNoteHistoryBackfillCoverage: "v2|garmin,oura",
    };
    const source = (
      sourceProviderSlug: "garmin" | "oura",
      status: "connected" | "disconnected",
      lastSeenAt: string,
      lifecycleEpoch: number,
    ) => {
      const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: hostedConnectionId,
        sourceProviderSlug,
      });
      assert.ok(sourceInstanceKey);
      return {
        displayName: sourceProviderSlug === "garmin" ? "Garmin" : "Oura",
        firstSeenAt: "2026-04-01T09:00:00.000Z",
        lastDataAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt,
        lifecycleEpoch,
        resourceCount: 2,
        resourceAvailabilitySummary: { blood_pressure: true, note: true },
        sourceInstanceKey,
        sourceProviderSlug,
        status,
      };
    };
    let hostedSnapshot = buildRuntimeSnapshot({
      connectionId: hostedConnectionId,
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      externalAccountId,
      hostedUpdatedAt: "2026-04-06T09:15:00.000Z",
      metadata,
      provider: "junction",
      sources: [
        source("garmin", "connected", "2026-04-06T09:15:00.000Z", 1),
        source("oura", "connected", "2026-04-06T09:15:00.000Z", 1),
      ],
    });
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      async applyUpdates() {
        throw new Error("applyUpdates should not be called during source hydration.");
      },
      async createConnectLink() {
        throw new Error("createConnectLink should not be called during source hydration.");
      },
      async fetchSnapshot() {
        return hostedSnapshot;
      },
    };

    try {
      const initialState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:15:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = initialState.hostedToLocalAccountIds.get(hostedConnectionId);
      assert.ok(localAccountId);
      const beforeReconnect = getStore(service).getAccountById(localAccountId);
      assert.ok(beforeReconnect);
      assert.equal(
        [
          beforeReconnect.metadata.junctionBloodPressureHistoryBackfillCoverage,
          beforeReconnect.metadata.junctionNoteHistoryBackfillCoverage,
        ].filter((value) => typeof value === "string" && /^m2\|/u.test(value)).length,
        1,
      );
      getStore(service).patchAccount(localAccountId, {
        displayName: beforeReconnect.displayName,
      });
      const dirtyBeforeReconnect = getStore(service).getAccountById(localAccountId);
      assert.ok(dirtyBeforeReconnect);
      assert.notEqual(
        dirtyBeforeReconnect.localConnectionRevision,
        dirtyBeforeReconnect.hostedObservedConnectionRevision,
      );

      hostedSnapshot = buildRuntimeSnapshot({
        connectionId: hostedConnectionId,
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:30:00.000Z",
        metadata: clearJunctionScheduleTimeExtendedHistoryCoverageForProvider({
          metadata,
          providerSlug: "garmin",
        }),
        provider: "junction",
        sources: [
          source("garmin", "connected", "2026-04-06T09:30:00.000Z", 2),
          source("oura", "connected", "2026-04-06T09:15:00.000Z", 1),
        ],
      });
      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:30:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const afterReconnect = getStore(service).getAccountById(localAccountId);
      assert.ok(afterReconnect);
      assert.deepEqual(
        afterReconnect.metadata,
        clearJunctionScheduleTimeExtendedHistoryCoverageForProvider({
          metadata: beforeReconnect.metadata,
          providerSlug: "garmin",
        }),
      );
      assert.equal(
        getStore(service).listConnectionSources({ connectionId: localAccountId })
          .find((candidate) => candidate.sourceProviderSlug === "garmin")?.status,
        "connected",
      );
      assert.equal(
        getStore(service).listConnectionSources({ connectionId: localAccountId })
          .find((candidate) => candidate.sourceProviderSlug === "garmin")?.lifecycleEpoch,
        2,
      );

      hostedSnapshot = buildRuntimeSnapshot({
        connectionId: hostedConnectionId,
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:30:00.000Z",
        metadata: afterReconnect.metadata,
        provider: "junction",
        sources: [
          source("garmin", "connected", "2026-04-06T09:30:00.000Z", 2),
          source("oura", "connected", "2026-04-06T09:15:00.000Z", 1),
        ],
      });
      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      assert.deepEqual(
        getStore(service).getAccountById(localAccountId)?.metadata,
        afterReconnect.metadata,
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test.each([
    {
      initialTargetStatus: "missing",
      label: "account summary whose source appears disconnected before projection",
      resource: "activity",
      resourceCategory: "summary",
      windowEnd: "2026-07-29T00:00:00.000Z",
      windowStart: "2026-07-27T00:00:00.000Z",
    },
    {
      initialTargetStatus: "connected",
      label: "chunked timeseries with a stale connected runner source",
      resource: "blood_oxygen",
      resourceCategory: "timeseries",
      windowEnd: "2026-07-29T00:00:00.000Z",
      windowStart: "2026-07-27T00:00:00.000Z",
    },
  ] as const)(
    "hosted Junction imports reread Web source state for $label",
    async (testCase) => {
      const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
        "hosted-device-sync-runtime-live-source-",
      );
      await initializeVault({
        createdAt: "2026-07-27T00:00:00.000Z",
        timezone: "UTC",
        vaultRoot,
      });

      const hostedConnectionId = `hosted_conn_live_source_${testCase.resourceCategory}`;
      const externalAccountId = `junction-live-source-${testCase.resourceCategory}`;
      const buildSource = (
        sourceProviderSlug: "garmin" | "oura",
        status: "connected" | "disconnected",
      ) => {
        const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
          connectionId: hostedConnectionId,
          sourceProviderSlug,
        });
        assert.ok(sourceInstanceKey);
        return {
          displayName: sourceProviderSlug === "garmin" ? "Garmin" : "Oura",
          firstSeenAt: "2026-07-27T00:00:00.000Z",
          lastDataAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: status === "connected"
            ? "2026-07-27T00:00:00.000Z"
            : "2026-07-30T00:00:00.000Z",
          resourceCount: 2,
          resourceAvailabilitySummary: {
            activity: true,
            blood_pressure: true,
            blood_oxygen: true,
          },
          sourceInstanceKey,
          sourceProviderSlug,
          status,
        };
      };
      const buildSnapshot = (targetStatus: "missing" | "connected" | "disconnected") =>
        buildRuntimeSnapshot({
          connectedAt: "2026-07-27T00:00:00.000Z",
          connectionId: hostedConnectionId,
          credential: {
            credentialMetadata: {},
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          externalAccountId,
          hostedUpdatedAt: targetStatus === "disconnected"
            ? "2026-07-30T00:00:00.000Z"
            : "2026-07-27T00:00:00.000Z",
          provider: "junction",
          sources: [
            buildSource("oura", "connected"),
            ...(targetStatus === "missing"
              ? []
              : [buildSource("garmin", targetStatus)]),
          ],
        });
      let hostedSnapshot = buildSnapshot(testCase.initialTargetStatus);
      let releaseProviderRequest: () => void = () => undefined;
      let markProviderRequestStarted: () => void = () => undefined;
      let shouldBlockProviderRequest = true;
      const providerRequestStarted = new Promise<void>((resolve) => {
        markProviderRequestStarted = resolve;
      });
      const providerRequestRelease = new Promise<void>((resolve) => {
        releaseProviderRequest = resolve;
      });
      const importedSnapshots: unknown[] = [];
      const liveSnapshotRequests: Array<Parameters<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>[0]> = [];
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates() {
          throw new Error("applyUpdates should not be called during live source admission.");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during live source admission.");
        },
        async fetchSnapshot(input) {
          liveSnapshotRequests.push(input);
          return hostedSnapshot;
        },
      };
      const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
        junction: {
          apiKey: "sk_us_test_123",
          clientUserIdSecret: "junction-live-source-secret",
          environment: "sandbox",
          fetchImpl: async (input) => {
            const url = readTestUrl(input);

            if (
              url
                === `https://api.sandbox.us.junction.com/v2/user/providers/${externalAccountId}`
            ) {
              return createTestJsonResponse({
                providers: [
                  {
                    id: "provider-garmin-1",
                    name: "Garmin",
                    resource_availability: {
                      activity: true,
                      blood_pressure: true,
                      blood_oxygen: true,
                    },
                    slug: "garmin",
                    status: "connected",
                  },
                  {
                    id: "provider-oura-1",
                    name: "Oura",
                    resource_availability: {
                      activity: true,
                      blood_pressure: true,
                      blood_oxygen: true,
                    },
                    slug: "oura",
                    status: "connected",
                  },
                ],
              });
            }

            const isSummaryRequest = url.includes(
              `/v2/summary/activity/${externalAccountId}`,
            );
            const isTimeseriesRequest = url.includes(
              `/v2/timeseries/${externalAccountId}/blood_oxygen/grouped`,
            );
            if (isSummaryRequest || isTimeseriesRequest) {
              if (shouldBlockProviderRequest) {
                shouldBlockProviderRequest = false;
                markProviderRequestStarted();
                await providerRequestRelease;
              }

              if (isSummaryRequest) {
                return createTestJsonResponse({
                  data: [
                    {
                      connectionId: "provider-garmin-1",
                      id: "garmin-activity-1",
                      steps: 4321,
                    },
                    {
                      connectionId: "provider-oura-1",
                      id: "oura-activity-1",
                      steps: 1234,
                    },
                  ],
                });
              }

              const observedAt = new URL(url).searchParams.get("start_date");
              return createTestJsonResponse({
                groups: {
                  garmin: [{
                    data: [{
                      id: `garmin-blood-oxygen-${observedAt}`,
                      timestamp: observedAt,
                      unit: "%",
                      value: 97,
                    }],
                    source: { provider: "garmin", type: "watch" },
                  }],
                  oura: [{
                    data: [{
                      id: `oura-blood-oxygen-${observedAt}`,
                      timestamp: observedAt,
                      unit: "%",
                      value: 95,
                    }],
                    source: { provider: "oura", type: "ring" },
                  }],
                },
              });
            }

            throw new Error(`Unexpected Junction request during live source admission: ${url}`);
          },
          region: "us",
          summaryResources: ["activity"],
          timeseriesBackfillDays: 5,
          timeseriesResources: ["blood_oxygen", "blood_pressure"],
        },
      });
      assert.ok(provider);
      const service = createHostedRuntimeDeviceSyncService({
        config: {
          publicBaseUrl: "https://sync.example.test/device-sync",
          stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
          vaultRoot,
        },
        importer: {
          async importDeviceProviderSnapshot(input) {
            importedSnapshots.push(input.snapshot);
            return { events: [{}] };
          },
        },
        deviceSyncPort,
        providers: [provider],
        secret: DEVICE_SYNC_SECRET,
      });

      try {
        const initialState = await syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort,
          secret: DEVICE_SYNC_SECRET,
          service,
          wake: buildCronWake("2026-07-30T00:00:00.000Z"),
        });
        const localAccountId = initialState.hostedToLocalAccountIds.get(hostedConnectionId);
        assert.ok(localAccountId);
        assert.equal(
          getStore(service).listConnectionSources({ connectionId: localAccountId }).length,
          testCase.initialTargetStatus === "missing" ? 1 : 2,
        );
        getStore(service).enqueueJob({
          accountId: localAccountId,
          availableAt: "2026-07-30T00:00:00.000Z",
          dedupeKey: `live-source-denied-${testCase.resourceCategory}`,
          kind: "resource",
          payload: {
            resource: testCase.resource,
            resourceCategory: testCase.resourceCategory,
            windowEnd: testCase.windowEnd,
            windowStart: testCase.windowStart,
          },
          provider: "junction",
        });

        const deniedWorker = service.runWorkerOnce();
        await providerRequestStarted;
        hostedSnapshot = buildSnapshot("disconnected");
        releaseProviderRequest();
        await deniedWorker;

        const deniedImport = JSON.stringify(importedSnapshots);
        assert.match(deniedImport, /oura/u);
        assert.doesNotMatch(
          deniedImport,
          /garmin|provider-garmin-1|garmin-activity-1|4321|"value":97/u,
        );
        const deniedSources = getStore(service).listConnectionSources({
          connectionId: localAccountId,
        });
        assert.equal(deniedSources.length, 2);
        assert.equal(
          deniedSources.find((source) => source.sourceProviderSlug === "garmin")?.status,
          "connected",
        );
        assert.equal(
          deniedSources.find((source) => source.sourceProviderSlug === "garmin")?.firstSeenAt,
          "2026-07-27T00:00:00.000Z",
        );

        hostedSnapshot = buildSnapshot("connected");
        await syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort,
          secret: DEVICE_SYNC_SECRET,
          service,
          wake: buildCronWake("2026-07-30T00:05:00.000Z"),
        });
        importedSnapshots.length = 0;
        getStore(service).enqueueJob({
          accountId: localAccountId,
          availableAt: "2026-07-30T00:05:00.000Z",
          dedupeKey: `live-source-admitted-${testCase.resourceCategory}`,
          kind: "resource",
          payload: {
            resource: testCase.resource,
            resourceCategory: testCase.resourceCategory,
            windowEnd: testCase.windowEnd,
            windowStart: testCase.windowStart,
          },
          provider: "junction",
        });

        await service.runWorkerOnce();

        const admittedImport = JSON.stringify(importedSnapshots);
        assert.match(admittedImport, /garmin/u);
        assert.match(admittedImport, /oura/u);
        const finalSources = getStore(service).listConnectionSources({
          connectionId: localAccountId,
        });
        assert.equal(finalSources.length, 2);
        assert.equal(
          finalSources.find((source) => source.sourceProviderSlug === "garmin")
            ?.sourceInstanceKey,
          buildJunctionProviderSourceInstanceKey({
            connectionId: hostedConnectionId,
            sourceProviderSlug: "garmin",
          }),
        );
        assert.equal(
          finalSources.find((source) => source.sourceProviderSlug === "garmin")
            ?.firstSeenAt,
          "2026-07-27T00:00:00.000Z",
        );
        const recoveredAccount = getStore(service).getAccountById(localAccountId);
        assert.ok(recoveredAccount);
        const createScheduledJobs = provider.jobExecutor?.createScheduledJobs;
        assert.ok(createScheduledJobs);
        const scheduledPressureHistory = createScheduledJobs(
          recoveredAccount,
          "2026-07-30T00:10:00.000Z",
        ).jobs.find((job) =>
          job.kind === "resource"
          && job.payload?.resource === "blood_pressure"
          && job.payload?.sourceProviderSlug === "garmin"
        );
        assert.ok(scheduledPressureHistory);
        assert.equal(
          scheduledPressureHistory.payload?.historicalWindowStart,
          "2026-07-22T00:00:00.000Z",
        );
        assert.equal(
          scheduledPressureHistory.payload?.windowStart,
          "2026-07-22T00:00:00.000Z",
        );
        assert.equal(
          scheduledPressureHistory.payload?.windowEnd,
          "2026-07-27T00:00:00.000Z",
        );
        assert.equal(
          liveSnapshotRequests.some((input) =>
            input?.connectionId === hostedConnectionId
            && input.includeCredentialMaterial === false
            && input.sourceProviderSlug === undefined
          ),
          true,
        );
      } finally {
        closeHostedRuntimeDeviceSyncService(service);
        await cleanup();
      }
    },
  );

  test("hosted job source reads fail closed when Web cannot return the mapped connection", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-live-source-missing-",
    );
    await mkdir(vaultRoot, { recursive: true });
    const hostedConnectionId = "hosted_conn_live_source_missing";
    let hostedSnapshot = buildRuntimeSnapshot({
      connectionId: hostedConnectionId,
      externalAccountId: "demo-live-source-missing",
      sources: [],
    });
    let imported = false;
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      async applyUpdates() {
        throw new Error("applyUpdates should not be called during source read failure.");
      },
      async createConnectLink() {
        throw new Error("createConnectLink should not be called during source read failure.");
      },
      async fetchSnapshot() {
        return hostedSnapshot;
      },
    };
    const provider = createFakeProvider({
      jobExecutor: {
        async executeJob(context) {
          await context.listConnectionSources?.();
          await context.importSnapshot({ provider: "demo" });
          return {};
        },
      },
    });
    const service = createHostedRuntimeDeviceSyncService({
      config: {
        publicBaseUrl: "https://sync.example.test/device-sync",
        stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
        vaultRoot,
      },
      deviceSyncPort,
      importer: {
        async importDeviceProviderSnapshot() {
          imported = true;
          return { events: [{}] };
        },
      },
      providers: [provider],
      secret: DEVICE_SYNC_SECRET,
    });

    try {
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        secret: DEVICE_SYNC_SECRET,
        service,
        wake: buildCronWake("2026-07-30T00:00:00.000Z"),
      });
      const localAccountId = state.hostedToLocalAccountIds.get(hostedConnectionId);
      assert.ok(localAccountId);
      const job = getStore(service).enqueueJob({
        accountId: localAccountId,
        availableAt: "2026-07-30T00:00:00.000Z",
        kind: "reconcile",
        payload: {},
        provider: "demo",
      });
      hostedSnapshot = buildEmptyRuntimeSnapshot();

      await service.runWorkerOnce();

      assert.equal(imported, false);
      assert.equal(getStore(service).getJobById(job.id)?.status, "queued");
      assert.deepEqual(
        service.listJobFailureDiagnostics().map((diagnostic) => ({
          code: diagnostic.code,
          retryable: diagnostic.retryable,
        })),
        [{
          code: "HOSTED_DEVICE_SYNC_SOURCE_STATE_UNAVAILABLE",
          retryable: true,
        }],
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test.each([
    { expectedStatus: "queued", retryable: true },
    { expectedStatus: "dead", retryable: false },
  ] as const)("hosted artifact write failures preserve retryable=$retryable for device-sync jobs", async ({
    expectedStatus,
    retryable,
  }) => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      `hosted-device-sync-artifact-write-${retryable ? "retryable" : "terminal"}-`,
    );
    await mkdir(vaultRoot, { recursive: true });
    const provider = createFakeProvider({
      jobExecutor: {
        async executeJob(context) {
          await context.importSnapshot({ provider: "demo" });
          return {};
        },
      },
    });
    const service = createHostedRuntimeDeviceSyncService({
      config: {
        publicBaseUrl: "https://sync.example.test/device-sync",
        stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
        vaultRoot,
      },
      importer: {
        async importDeviceProviderSnapshot() {
          throw new HostedRuntimeArtifactWriteError({
            cause: new Error("Hosted artifact upload failed."),
            retryable,
          });
        },
      },
      providers: [provider],
      secret: DEVICE_SYNC_SECRET,
    });

    try {
      const begin = await service.startConnection({ provider: "demo" });
      const connected = await service.handleOAuthCallback({
        code: "artifact-write-classification",
        provider: "demo",
        state: begin.state,
      });
      const job = getStore(service).enqueueJob({
        accountId: connected.account.id,
        availableAt: "2026-07-30T00:00:00.000Z",
        kind: "reconcile",
        payload: {},
        provider: "demo",
      });

      await service.runWorkerOnce();

      assert.equal(getStore(service).getJobById(job.id)?.status, expectedStatus);
      assert.deepEqual(
        service.listJobFailureDiagnostics().map((diagnostic) => ({
          code: diagnostic.code,
          retryable: diagnostic.retryable,
        })),
        [{
          code: "HOSTED_DEVICE_SYNC_ARTIFACT_WRITE_FAILED",
          retryable,
        }],
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test.each([
    {
      localLastSeenAt: "2026-04-06T09:20:00.000Z",
      timestampOrder: "newer than",
    },
    {
      localLastSeenAt: "2026-04-06T09:15:00.000Z",
      timestampOrder: "equal to",
    },
  ])("a hosted source disconnect replaces warm local source state $timestampOrder the hosted timestamp and cannot be republished", async ({
    localLastSeenAt,
  }) => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({ provider: "demo" });
      const connected = await service.handleOAuthCallback({
        code: "source-disconnect-hydration",
        provider: "demo",
        state: begin.state,
      });
      getStore(service).upsertConnectionSource({
        connectionId: connected.account.id,
        displayName: "Garmin",
        firstSeenAt: "2026-04-01T09:00:00.000Z",
        lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
        lastErrorMessage: "Historical data remained incomplete.",
        lastSeenAt: localLastSeenAt,
        resourceAvailabilitySummary: {
          activity: true,
          sleep: true,
        },
        sourceInstanceKey: "hosted-source-garmin",
        sourceProviderSlug: "garmin",
        status: "error",
      });

      const snapshot = buildRuntimeSnapshot({
        capabilities: {
          connectionSourceApply: true,
        },
        connectionId: "hosted_conn_source_disconnect_hydration",
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:15:00.000Z",
        sources: [
          {
            displayName: "Garmin",
            firstSeenAt: "2026-04-01T09:00:00.000Z",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSeenAt: "2026-04-06T09:15:00.000Z",
            lastDataAt: null,
            resourceCount: 2,
            resourceAvailabilitySummary: {
              activity: true,
              sleep: true,
            },
            sourceInstanceKey: "hosted-source-garmin",
            sourceProviderSlug: "garmin",
            status: "disconnected",
          },
        ],
        status: "disconnected",
        tokenBundle: null,
      });
      const appliedRequests: ApplyUpdatesRequest[] = [];
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequests.push(input);
          return {
            appliedAt: "2026-04-06T09:17:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync or reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };
      const disconnectedState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:16:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const [disconnectedSource] = getStore(service).listConnectionSources({
        connectionId: connected.account.id,
      });
      assert.equal(disconnectedSource?.status, "disconnected");
      assert.equal(disconnectedSource?.lastErrorCode, null);
      assert.equal(disconnectedSource?.lastErrorMessage, null);
      assert.equal(disconnectedSource?.lastSeenAt, "2026-04-06T09:15:00.000Z");

      getStore(service).upsertConnectionSource({
        connectionId: connected.account.id,
        displayName: "Garmin",
        firstSeenAt: "2026-04-01T09:00:00.000Z",
        lastErrorCode: "LATE_RUNNER_UPDATE",
        lastErrorMessage: "A runner job completed after disconnect hydration.",
        lastSeenAt: "2026-04-06T09:18:00.000Z",
        resourceAvailabilitySummary: {
          activity: true,
          sleep: true,
        },
        sourceInstanceKey: "hosted-source-garmin",
        sourceProviderSlug: "garmin",
        status: "error",
      });
      const [lateRunnerSource] = getStore(service).listConnectionSources({
        connectionId: connected.account.id,
      });
      assert.equal(lateRunnerSource?.status, "error");
      assert.equal(lateRunnerSource?.lastSeenAt, "2026-04-06T09:18:00.000Z");

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:17:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state: disconnectedState,
      });

      assert.deepEqual(appliedRequests, [
        {
          occurredAt: "2026-04-06T09:17:00.000Z",
          updates: [],
        },
      ]);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation projects an arrival-only source change", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({ provider: "demo" });
      const connected = await service.handleOAuthCallback({
        code: "source-arrival-projection",
        provider: "demo",
        state: begin.state,
      });
      const baselineSource = {
        displayName: null,
        firstSeenAt: "2026-04-06T09:00:00.000Z",
        lastDataAt: "2026-04-06T09:30:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-04-06T10:05:00.000Z",
        resourceCount: 0,
        sourceInstanceKey: "hosted-source-garmin",
        sourceProviderSlug: "garmin",
        status: "connected" as const,
      };
      const snapshot = buildRuntimeSnapshot({
        capabilities: { connectionSourceApply: true },
        connectionId: "hosted_conn_arrival_projection",
        externalAccountId: connected.account.externalAccountId,
        sources: [baselineSource],
      });
      const appliedRequests: { updates: { sources?: unknown[] }[] }[] = [];
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(request) {
          appliedRequests.push(request);
          return {
            appliedAt: "2026-04-06T10:10:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      // Only the arrival advances; everything else matches the baseline. If the
      // outbound comparator ignored lastDataAt this would be dropped as a no-op
      // and the hosted row would keep a stale arrival.
      getStore(service).markConnectionSourceDataReceived({
        connectionId: connected.account.id,
        now: "2026-04-06T10:08:00.000Z",
        sourceProviderSlug: "garmin",
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      const projectedSources = appliedRequests
        .flatMap((request) => request.updates)
        .flatMap((update) => update.sources ?? []);
      assert.deepEqual(
        projectedSources.map((source) => (source as { lastDataAt?: string | null }).lastDataAt),
        ["2026-04-06T10:08:00.000Z"],
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation projects local connection sources only when hosted supports source apply", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "source-projection",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        capabilities: {
          connectionSourceApply: true,
        },
        connectionId: "hosted_conn_sources",
        externalAccountId: connected.account.externalAccountId,
        sources: [],
      });
      const appliedRequests: ApplyUpdatesRequest[] = [];
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequests.push(input);
          return {
            appliedAt: "2026-04-06T09:21:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync or reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      getStore(service).upsertConnectionSource({
        connectionId: connected.account.id,
        displayName: null,
        firstSeenAt: "2026-04-06T09:00:00.000Z",
        lastSeenAt: "2026-04-06T10:05:00.000Z",
        resourceAvailabilitySummary: {
          activity: true,
          heartrate: true,
        },
        sourceInstanceKey: "junction_garmin",
        sourceProviderSlug: "garmin",
        status: "connected",
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:20:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(appliedRequests[0]?.updates[0]?.sources, [
        {
          displayName: null,
          firstSeenAt: "2026-04-06T09:00:00.000Z",
          lastDataAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: "2026-04-06T10:05:00.000Z",
          observedLastSeenAt: null,
          resourceAvailabilitySummary: {
            activity: true,
            heartrate: true,
          },
          sourceInstanceKey: "junction_garmin",
          sourceProviderSlug: "garmin",
          status: "connected",
        },
      ]);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync hydration mirrors a hosted disconnect and kills pending local jobs", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "seed",
        provider: "demo",
        state: begin.state,
      });
      const pendingJob = getStore(service).enqueueJob({
        accountId: connected.account.id,
        availableAt: "2026-04-06T09:05:00.000Z",
        kind: "manual-backfill",
        payload: {
          source: "local",
        },
        priority: 1,
        provider: connected.account.provider,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_disconnected",
        displayName: "Hosted Demo",
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:04:00.000Z",
        localState: {
          lastSyncCompletedAt: "2026-04-06T09:03:00.000Z",
          lastSyncStartedAt: "2026-04-06T09:02:00.000Z",
          lastWebhookAt: "2026-04-06T09:01:00.000Z",
        },
        metadata: {
          hosted: true,
          nested: {
            drop: "me",
          },
        },
        status: "disconnected",
        tokenBundle: null,
      });
      let fetchSnapshotCalls = 0;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates() {
          throw new Error("applyUpdates should not be called during sync");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync");
        },
        async fetchSnapshot() {
          fetchSnapshotCalls += 1;
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(fetchSnapshotCalls, 1);
      assert.deepEqual(state.snapshot, {
        ...snapshot,
        connections: [
          {
            ...snapshot.connections[0],
            connection: {
              ...snapshot.connections[0]!.connection,
              metadata: {
                hosted: true,
              },
              setupExpiresAt: null,
              setupPhase: null,
            },
          },
        ],
      });
      assert.equal(
        state.hostedToLocalAccountIds.get("hosted_conn_disconnected"),
        connected.account.id,
      );
      assert.equal(
        state.localToHostedAccountIds.get(connected.account.id),
        "hosted_conn_disconnected",
      );
      assert.equal(state.observedTokenVersions.get("hosted_conn_disconnected"), null);

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.status, "disconnected");
      assert.equal(stored.displayName, "Hosted Demo");
      assert.deepEqual(stored.metadata, {
        hosted: true,
      });
      assert.deepEqual(stored.scopes, ["offline", "read:data"]);
      assertStoredCredentialKind(stored, "none");
      assert.equal(stored.accessTokenExpiresAt, null);
      assert.equal(stored.lastWebhookAt, "2026-04-06T09:01:00.000Z");
      assert.equal(stored.lastSyncStartedAt, "2026-04-06T09:02:00.000Z");
      assert.equal(stored.lastSyncCompletedAt, "2026-04-06T09:03:00.000Z");

      const deadJob = getStore(service).getJobById(pendingJob.id);
      assert.equal(deadJob?.status, "dead");
      assert.equal(deadJob?.lastErrorCode, "HOSTED_CONTROL_PLANE_DISCONNECTED");
      assert.equal(
        deadJob?.lastErrorMessage,
        "Hosted control plane marked the device-sync connection as disconnected.",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync accepts a hosted reconnect after an accepted token clear and reconciliation stays quiet", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "reconnect-after-clear",
        provider: "demo",
        state: begin.state,
      });

      let currentSnapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_reconnect_after_clear",
        displayName: "Hosted Fresh",
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:10:00.000Z",
        tokenBundle: {
          accessToken: "hosted-access-v5",
          accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
          refreshToken: "hosted-refresh-v5",
          tokenVersion: 5,
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T09:21:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync or reconciliation");
        },
        async fetchSnapshot() {
          return currentSnapshot;
        },
      };

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:11:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      currentSnapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_reconnect_after_clear",
        displayName: "Hosted Disconnected",
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:15:00.000Z",
        localState: {
          lastSyncCompletedAt: "2026-04-06T09:14:00.000Z",
        },
        metadata: {
          disconnected: true,
        },
        status: "disconnected",
        tokenBundle: null,
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:16:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const disconnected = getStore(service).getAccountById(connected.account.id);
      assert.ok(disconnected);
      assert.equal(disconnected.status, "disconnected");
      assertStoredCredentialKind(disconnected, "none");
      assert.equal(disconnected.hostedObservedTokenVersion, null);

      currentSnapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_reconnect_after_clear",
        displayName: "Hosted Reconnected",
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:20:00.000Z",
        metadata: {
          reconnected: true,
        },
        tokenBundle: {
          accessToken: "hosted-access-v1",
          accessTokenExpiresAt: "2026-04-07T01:00:00.000Z",
          refreshToken: "hosted-refresh-v1",
          tokenVersion: 1,
        },
      });

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:21:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(state.observedTokenVersions.get("hosted_conn_reconnect_after_clear"), 1);

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.status, "active");
      assert.equal(stored.displayName, "Hosted Reconnected");
      assert.equal(stored.hostedObservedTokenVersion, 1);
      const storedCredential = requireStoredOAuthCredential(stored);
      const codec = createSecretCodec(DEVICE_SYNC_SECRET);
      assert.equal(
        codec.decrypt(
          storedCredential.accessTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-access-token",
          }),
        ),
        "hosted-access-v1",
      );
      assert.ok(storedCredential.refreshTokenEncrypted);
      assert.equal(
        codec.decrypt(
          storedCredential.refreshTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-refresh-token",
          }),
        ),
        "hosted-refresh-v1",
      );

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:22:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest), {
        occurredAt: "2026-04-06T09:22:00.000Z",
        updates: [
          {
            connectionId: "hosted_conn_reconnect_after_clear",
            localState: {
              lastSyncCompletedAt: "2026-04-06T09:14:00.000Z",
            },
            observedConnectedAt: "2026-04-04T09:00:00.000Z",
            observedUpdatedAt: "2026-04-06T09:20:00.000Z",
          },
        ],
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync hydrates a fresh WHOOP OAuth runtime snapshot before running device jobs", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const observedAccessTokens: string[] = [];
    const whoopProvider = createFakeProvider({
      provider: "whoop",
      descriptor: {
        provider: "whoop",
        displayName: "WHOOP",
        transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
        oauth: {
          callbackPath: "/oauth/whoop/callback",
          defaultScopes: ["offline", "read:recovery"],
        },
        webhook: {
          path: "/webhooks/whoop",
          deliveryMode: "notification",
          supportsAdmin: false,
        },
        normalization: {
          metricFamilies: ["recovery"],
          snapshotParser: "schema",
        },
        sourcePriorityHints: {
          defaultPriority: 50,
          metricFamilies: {
            recovery: 50,
          },
        },
      },
      jobExecutor: {
        async executeJob(context) {
          assert.equal(context.account.provider, "whoop");
          assert.equal(context.account.credential.kind, "oauth_tokens");
          observedAccessTokens.push(context.account.credential.tokens.accessToken);
          return {
            nextReconcileAt: "2026-04-06T12:00:00.000Z",
          };
        },
      },
    });
    const service = createDeviceSyncServiceForVault(vaultRoot, [whoopProvider]);

    try {
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_whoop_token_snapshot",
        displayName: "Hosted WHOOP",
        externalAccountId: "whoop-account-token-snapshot",
        hostedUpdatedAt: "2026-04-06T09:10:00.000Z",
        provider: "whoop",
        tokenBundle: {
          accessToken: "hosted-whoop-access",
          accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
          refreshToken: "hosted-whoop-refresh",
          tokenVersion: 6,
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T09:21:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during WHOOP sync");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_whoop_token_snapshot",
          eventId: "evt_whoop_token_snapshot",
          hint: {
            jobs: [
              {
                dedupeKey: "hosted-whoop-token-snapshot",
                kind: "reconcile",
                priority: 80,
              },
            ],
            reason: "scheduled-reconcile",
          },
          occurredAt: "2026-04-06T09:20:00.000Z",
          provider: "whoop",
          reason: "webhook_hint",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(state.observedTokenVersions.get("hosted_conn_whoop_token_snapshot"), 6);
      const stored = getStore(service).getAccountByExternalAccount(
        "whoop",
        "whoop-account-token-snapshot",
      );
      assert.ok(stored);
      assert.equal(stored.status, "active");
      const storedCredential = requireStoredOAuthCredential(stored);
      const codec = createSecretCodec(DEVICE_SYNC_SECRET);
      assert.equal(
        codec.decrypt(
          storedCredential.accessTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-access-token",
          }),
        ),
        "hosted-whoop-access",
      );

      assert.equal(await service.drainWorker(), 1);
      assert.deepEqual(observedAccessTokens, ["hosted-whoop-access"]);

      const afterJob = getStore(service).getAccountById(stored.id);
      assert.ok(afterJob);
      assert.equal(afterJob.status, "active");
      assert.equal(afterJob.lastErrorCode, null);
      assert.equal(afterJob.lastErrorMessage, null);

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:22:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      const apply = requireApplyUpdatesRequest(appliedRequest);
      assert.equal(apply.updates[0]?.connection?.status, undefined);
      assert.equal(apply.updates[0]?.localState?.lastErrorCode, undefined);
      assert.equal(apply.updates[0]?.credential, undefined);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync hydrates provider-config credentials without token material or export", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "provider-config",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_provider_config",
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:15:00.000Z",
        setupExpiresAt: "2026-04-06T09:45:00.000Z",
        setupPhase: "pending_link",
        status: "active",
        credential: {
          kind: "provider_config",
          providerConfigKey: "demo",
          credentialMetadata: {
            authHeader: "Bearer hosted-secret",
            clientUserId: "raw-client-user",
            clientUserIdHash: "hash_client_user",
            ownerId: "raw-owner",
            webhookSecret: "hosted-secret",
          },
        },
        metadata: {
          providerConfig: true,
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T09:20:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:16:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.deepEqual(state.snapshot?.connections[0]?.credential, {
        kind: "provider_config",
        providerConfigKey: "demo",
        credentialMetadata: {
          clientUserIdHash: "hash_client_user",
        },
      });
      assert.equal(
        Object.prototype.hasOwnProperty.call(state.snapshot?.connections[0] ?? {}, "tokenBundle"),
        false,
      );

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.status, "active");
      assert.equal(stored.setupPhase, "pending_link");
      assert.equal(stored.setupExpiresAt, "2026-04-06T09:45:00.000Z");
      assert.equal(stored.credential.kind, "provider_config");
      assert.equal(stored.credential.providerConfigKey, "demo");
      assert.deepEqual(stored.credential.credentialMetadata, {
        clientUserIdHash: "hash_client_user",
      });
      assert.equal(stored.hostedObservedTokenVersion, null);
      assert.equal(stored.accessTokenExpiresAt, null);

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:20:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest), {
        occurredAt: "2026-04-06T09:20:00.000Z",
        updates: [],
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync preserves local OAuth tokens when hosted snapshot redacts credential material", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "redacted-oauth",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_redacted_oauth",
        displayName: connected.account.displayName,
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: connected.account.updatedAt,
        metadata: connected.account.metadata,
        credential: {
          credentialMetadata: {},
          kind: "oauth_tokens_redacted",
          tokenVersion: 4,
        },
        tokenBundle: null,
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T09:20:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:16:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.deepEqual(state.snapshot?.connections[0]?.credential, {
        credentialMetadata: {},
        kind: "oauth_tokens_redacted",
        tokenVersion: 4,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.hostedObservedTokenVersion, 4);
      const storedCredential = requireStoredOAuthCredential(stored);
      const codec = createSecretCodec(DEVICE_SYNC_SECRET);
      assert.equal(
        codec.decrypt(
          storedCredential.accessTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-access-token",
          }),
        ),
        "provider-access-token",
      );

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:20:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.equal(
        requireApplyUpdatesRequest(appliedRequest).updates.some((update) =>
          Object.prototype.hasOwnProperty.call(update, "credential")
        ),
        false,
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation includes provider failure diagnostics when sync failure advances", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createHostedRuntimeDeviceSyncService({
      secret: DEVICE_SYNC_SECRET,
      config: {
        publicBaseUrl: "https://sync.example.test/device-sync",
        stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
        vaultRoot,
      },
      providers: [
        createFakeProvider({
          jobExecutor: {
            async executeJob() {
              throw deviceSyncError({
                accountStatus: "disconnected",
                code: "TOKEN_REQUEST_FAILED",
                details: {
                  httpStatusText: "Bad Request",
                  oauthErrorCode: "invalid_grant",
                  oauthErrorDescription: "Refresh token expired. Reconnect provider.",
                  oauthGrantType: "refresh_token",
                  oauthRequestBodyBuilderKind: "url_search_params_record",
                  oauthRequestClientAuthPlacement: "body_parameters",
                  oauthRequestClientCredentialPresent: true,
                  oauthRequestClientIdPresent: true,
                  oauthRequestContentType: "application_x_www_form_urlencoded",
                  oauthRequestDuplicateParameterCount: 0,
                  oauthRequestEncodingKind: "form_urlencoded",
                  oauthRequestHasDuplicateParameters: false,
                  oauthRequestMethod: "POST",
                  oauthRequestOfflineScopePresent: true,
                  oauthRequestParameterCount: 5,
                  oauthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
                  oauthRequestRefreshCredentialPresent: true,
                  oauthRequestScopeCount: 1,
                  oauthRequestScopePresent: true,
                  oauthRequestScopeValue: "offline",
                  oauthRequestTokenEndpointKind: "whoop_oauth_token",
                  oauthResponseErrorDescriptionFieldPresent: true,
                  oauthResponseErrorFieldPresent: true,
                  oauthResponseShapeKind: "json_object",
                },
                httpStatus: 400,
                message: "Provider token request failed.",
                retryable: false,
              });
            },
          },
        }),
      ],
    });

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "failure-diagnostic",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_failure_diagnostic",
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:15:00.000Z",
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T09:18:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:16:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_failure_diagnostic");
      assert.ok(localAccountId);

      getStore(service).enqueueJob({
        accountId: localAccountId,
        availableAt: "2026-04-06T09:17:00.000Z",
        kind: "backfill",
        maxAttempts: 1,
        payload: {},
        provider: "demo",
      });
      assert.equal(await service.drainWorker(1), 1);

      const failed = getStore(service).getAccountById(localAccountId);
      assert.ok(failed);
      assert.equal(failed.lastErrorCode, "TOKEN_REQUEST_FAILED");
      assert.equal(failed.status, "disconnected");
      assert.ok(failed.lastSyncErrorAt);

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:18:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      const request = requireApplyUpdatesRequest(appliedRequest);
      assert.equal(request.occurredAt, "2026-04-06T09:18:00.000Z");
      assert.equal(request.updates.length, 1);
      assert.equal(request.updates[0]?.connectionId, "hosted_conn_failure_diagnostic");
      assert.deepEqual(request.updates[0]?.failureDiagnostic, {
        accountStatus: "disconnected",
        code: "TOKEN_REQUEST_FAILED",
        details: {
          providerHttpStatus: 400,
          providerHttpStatusText: "Bad Request",
          providerOAuthErrorCode: "invalid_grant",
          providerOAuthErrorDescription: "Refresh token expired. Reconnect provider.",
          providerOAuthGrantType: "refresh_token",
          providerOAuthRequestBodyBuilderKind: "url_search_params_record",
          providerOAuthRequestClientAuthPlacement: "body_parameters",
          providerOAuthRequestClientCredentialPresent: true,
          providerOAuthRequestClientIdPresent: true,
          providerOAuthRequestContentType: "application_x_www_form_urlencoded",
          providerOAuthRequestDuplicateParameterCount: 0,
          providerOAuthRequestEncodingKind: "form_urlencoded",
          providerOAuthRequestHasDuplicateParameters: false,
          providerOAuthRequestMethod: "POST",
          providerOAuthRequestOfflineScopePresent: true,
          providerOAuthRequestParameterCount: 5,
          providerOAuthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
          providerOAuthRequestRefreshCredentialPresent: true,
          providerOAuthRequestScopeCount: 1,
          providerOAuthRequestScopePresent: true,
          providerOAuthRequestScopeValue: "offline",
          providerOAuthRequestTokenEndpointKind: "whoop_oauth_token",
          providerOAuthResponseErrorDescriptionFieldPresent: true,
          providerOAuthResponseErrorFieldPresent: true,
          providerOAuthResponseShapeKind: "json_object",
        },
        retryable: false,
      });
      assert.equal(
        request.updates[0]?.localState?.lastErrorMessage,
        "Provider token request failed. Provider reason: Refresh token expired. Reconnect provider.",
      );
      assert.equal(request.updates[0]?.localState?.lastSyncErrorAt, failed.lastSyncErrorAt);
      assert.equal(request.updates[0]?.observedUpdatedAt, "2026-04-06T09:15:00.000Z");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("device-sync wake hints enqueue hosted jobs without moving next reconcile backward", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "wake",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_wake",
        externalAccountId: connected.account.externalAccountId,
        localState: {
          nextReconcileAt: "2026-04-04T12:00:00.000Z",
        },
        tokenBundle: {
          accessToken: "hosted-inline-access",
          accessTokenExpiresAt: "2026-04-05T00:00:00.000Z",
          refreshToken: "hosted-inline-refresh",
          tokenVersion: 4,
        },
      });

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(snapshot),
        wake: {
          connectionId: "hosted_conn_wake",
          eventId: "evt_device_sync_wake",
          expectedConnectedAt: "2026-04-04T09:00:00.000Z",
          hint: {
            jobs: [
              {
                availableAt: "2026-04-04T10:05:00.000Z",
                dedupeKey: "wake:resource-sync",
                kind: "resource-sync",
                maxAttempts: 5,
                payload: {
                  resourceId: "step-count",
                },
                priority: 7,
              },
            ],
            nextReconcileAt: "2026-04-04T11:00:00.000Z",
          },
          kind: "device-sync.wake",
          occurredAt: "2026-04-04T10:00:00.000Z",
          provider: "demo",
          reason: "webhook_hint",
          userId: "member_123",
        },
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(state.observedTokenVersions.get("hosted_conn_wake"), 4);

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.nextReconcileAt, "2026-04-04T12:00:00.000Z");
      assert.equal(stored.hostedObservedTokenVersion, 4);
      const storedCredential = requireStoredOAuthCredential(stored);
      assert.equal(
        createSecretCodec(DEVICE_SYNC_SECRET).decrypt(
          storedCredential.accessTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-access-token",
          }),
        ),
        "hosted-inline-access",
      );
      assert.throws(
        () =>
          createSecretCodec(DEVICE_SYNC_SECRET).decrypt(
            storedCredential.accessTokenEncrypted,
            buildDeviceSyncTokenCipherOptions({
              externalAccountId: stored.externalAccountId,
              provider: stored.provider,
              purpose: "device-sync-refresh-token",
            }),
          ),
      );
      assert.ok(storedCredential.refreshTokenEncrypted);
      assert.equal(
        createSecretCodec(DEVICE_SYNC_SECRET).decrypt(
          storedCredential.refreshTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-refresh-token",
          }),
        ),
        "hosted-inline-refresh",
      );

      const jobs = readJobsForAccount(service, connected.account.id);
      assert.equal(jobs.length, 1);
      assert.deepEqual(
        {
          availableAt: jobs[0]?.availableAt,
          dedupeKey: jobs[0]?.dedupeKey,
          kind: jobs[0]?.kind,
          maxAttempts: jobs[0]?.maxAttempts,
          payload: jobs[0]?.payloadJson ? JSON.parse(jobs[0].payloadJson) : null,
          priority: jobs[0]?.priority,
          status: jobs[0]?.status,
        },
        {
          availableAt: "2026-04-04T10:05:00.000Z",
          dedupeKey: "wake:resource-sync",
          kind: "resource-sync",
          maxAttempts: 5,
          payload: {
            resourceId: "step-count",
          },
          priority: 7,
          status: "queued",
        },
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("device-sync wakes track successful timed compact resource imports", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);
    const pendingRequests: Array<{ limit?: number | null }> = [];

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "dirty-wake",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_dirty_wake",
        externalAccountId: connected.account.externalAccountId,
      });
      const dirtyState: HostedExecutionDeviceSyncDirtyStateResponse = {
        connectionId: "hosted_conn_dirty_wake",
        dirtyRevision: "42",
        dirtyResources: [
          {
            count: 12,
            eventToProviderSendBucket: "under_5_minutes",
            firstWebhookReceivedAt: "2026-04-04T10:00:00.000Z",
            providerSendToWebhookMs: 60_000,
            jobKind: "resource",
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
            timingSourceProviderSlug: "garmin",
            windowEnd: "2026-04-04T00:00:00.000Z",
            windowStart: "2026-04-02T00:00:00.000Z",
          },
        ],
        eventCount: "12",
        latestDirtyAt: "2026-04-04T10:00:00.000Z",
        processedRevision: "0",
        provider: "demo",
        resourceCategoryCounts: {
          timeseries: 12,
        },
        sourceProviderCounts: {
          garmin: 12,
        },
        userId: "member_123",
        windowEnd: "2026-04-04T00:00:00.000Z",
        windowStart: "2026-04-02T00:00:00.000Z",
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates(input = {}) {
            pendingRequests.push(input);
            return {
              hasMore: false,
              items: [dirtyState],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_dirty_wake",
          eventId: "evt_device_sync_dirty_wake",
          hint: {
            reason: "dirty",
          },
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "webhook_hint",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
        stagedDirtyAcks: [
          {
            connectionId: "hosted_conn_dirty_wake",
            processedDirtyPayloadIds: ["dsp_payload_previous"],
            processedRevision: "41",
          },
        ],
      });

      assert.deepEqual(pendingRequests, [
        {
          limit: 10,
          stagedDirtyAcks: [
            {
              connectionId: "hosted_conn_dirty_wake",
              processedDirtyPayloadIds: ["dsp_payload_previous"],
              processedRevision: "41",
            },
          ],
        },
      ]);
      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_conn_dirty_wake",
        nextWakeAt: null,
        processedRevision: "42",
      }]);
      const jobs = readJobsForAccount(service, connected.account.id);
      assert.equal(jobs.length, 1);
      assert.deepEqual(state.pendingDirtyPayloadJobs, [{
        connectionId: "hosted_conn_dirty_wake",
        dirtyPayloadId: null,
        jobId: jobs[0]?.id,
        processedRevision: "42",
        timing: {
          eventToProviderSendBucket: "under_5_minutes",
          firstWebhookReceivedAt: "2026-04-04T10:00:00.000Z",
          providerSendToWebhookMs: 60_000,
          sourceProvider: "garmin",
        },
      }]);
      assert.deepEqual(
        {
          dedupeKey: jobs[0]?.dedupeKey,
          kind: jobs[0]?.kind,
          payload: jobs[0]?.payloadJson ? JSON.parse(jobs[0].payloadJson) : null,
          priority: jobs[0]?.priority,
          status: jobs[0]?.status,
        },
        {
          dedupeKey:
            "hosted-dirty:demo:resource:garmin:timeseries:steps:033d08b7160ff3a70cc8cb5f:2026-04-02T00:00:00.000Z:2026-04-04T00:00:00.000Z",
          kind: "resource",
          payload: {
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
            windowEnd: "2026-04-04T00:00:00.000Z",
            windowStart: "2026-04-02T00:00:00.000Z",
          },
          priority: 60,
          status: "queued",
        },
      );

      assert.equal(await service.drainWorker(1), 1);
      const completedImports = promoteHostedCompletedDirtyPayloadAcks({ service, state });
      const [completedImport] = completedImports;
      assert.ok(completedImport);
      assert.match(completedImport.importCompletedAt, /^\d{4}-\d{2}-\d{2}T/u);
      assert.match(completedImport.importExecutionStartedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.match(completedImport.jobCreatedAt, /^\d{4}-\d{2}-\d{2}T/u);
      assert.deepEqual({
        ...completedImport,
        importCompletedAt: "<timestamp>",
        importExecutionStartedAt: "<timestamp>",
        jobCreatedAt: "<timestamp>",
      }, {
        eventToProviderSendBucket: "under_5_minutes",
        firstWebhookReceivedAt: "2026-04-04T10:00:00.000Z",
        importCompletedAt: "<timestamp>",
        importExecutionStartedAt: "<timestamp>",
        jobCreatedAt: "<timestamp>",
        jobKind: "resource",
        provider: "demo",
        providerSendToWebhookMs: 60_000,
        sourceProvider: "garmin",
      });
      assert.equal(completedImports.length, 1);
      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_conn_dirty_wake",
        nextWakeAt: null,
        processedRevision: "42",
      }]);
      assert.deepEqual(state.pendingDirtyPayloadJobs, []);

      const [timedResource] = dirtyState.dirtyResources;
      assert.ok(timedResource);
      const directProviderState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [{
                ...dirtyState,
                dirtyResources: [{
                  ...timedResource,
                  resource: "sleep",
                  resourceCategory: "summary",
                  sourceProviderSlug: null,
                  timingSourceProviderSlug: undefined,
                }],
                dirtyRevision: "43",
                eventCount: "1",
                processedRevision: "42",
                resourceCategoryCounts: { summary: 1 },
                sourceProviderCounts: {},
              }],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_dirty_wake",
          eventId: "evt_device_sync_direct_timing",
          hint: { reason: "dirty" },
          occurredAt: "2026-04-04T10:01:00.000Z",
          reason: "webhook_hint",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      assert.equal(
        directProviderState.pendingDirtyPayloadJobs[0]?.timing?.sourceProvider,
        "demo",
      );
      const directProviderJob = readJobsForAccount(service, connected.account.id)
        .find((job) => job.id === directProviderState.pendingDirtyPayloadJobs[0]?.jobId);
      assert.deepEqual(
        directProviderJob?.payloadJson ? JSON.parse(directProviderJob.payloadJson) : null,
        {
          resource: "sleep",
          resourceCategory: "summary",
          windowEnd: "2026-04-04T00:00:00.000Z",
          windowStart: "2026-04-02T00:00:00.000Z",
        },
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("hosted workout dirty state uses three durable executions with one stream GET each", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-workout-retry-",
    );
    await mkdir(vaultRoot, { recursive: true });
    let streamRequests = 0;
    let now = new Date("2030-04-04T10:00:00.000Z");
    const externalAccountId = "junction-hosted-workout-retry";
    const connectionId = "hosted_conn_workout_retry";
    const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        fetchImpl: async (input) => {
          const url = new URL(readTestUrl(input));
          if (url.pathname === `/v2/user/providers/${externalAccountId}`) {
            return createTestJsonResponse({ providers: [{
              slug: "garmin",
              status: "connected",
              resource_availability: { workouts: true },
            }] });
          }
          if (url.pathname === "/v2/timeseries/workouts/workout-hosted-retry/stream") {
            streamRequests += 1;
            return new Response(JSON.stringify({ detail: "temporary" }), {
              status: 503,
              headers: { "content-type": "application/json", "retry-after": "0" },
            });
          }
          throw new Error(`Unexpected Junction request: ${url.pathname}`);
        },
        region: "us",
        summaryResources: [],
        timeseriesResources: [],
      },
    });
    assert.ok(provider);
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider], {
      clock: { now: () => now },
    });
    const snapshot = buildRuntimeSnapshot({
      connectionId,
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      externalAccountId,
      provider: "junction",
      sources: [{
        displayName: "Garmin",
        firstSeenAt: "2026-04-04T09:00:00.000Z",
        lastDataAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-04-04T10:00:00.000Z",
        resourceCount: 1,
        resourceAvailabilitySummary: { workouts: true },
        sourceInstanceKey: "garmin",
        sourceProviderSlug: "garmin",
        status: "connected",
      }],
    });
    const dirtyState = buildDirtyState({
      connectionId,
      dirtyResources: [{
        count: 1,
        jobKind: "resource",
        maxAttempts: 3,
        payload: {
          eventType: "daily.data.workout_stream.created",
          objectId: "workout-hosted-retry",
          occurredAt: "2026-04-04T10:00:00.000Z",
          resource: "workout_stream",
          resourceCategory: "timeseries",
          sourceLifecycleEpoch: 1,
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          sport: "running",
          windowEnd: "2026-04-04T10:00:00.000Z",
          windowStart: "2026-04-04T10:00:00.000Z",
        },
        resource: "workout_stream",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        windowEnd: "2026-04-04T10:00:00.000Z",
        windowStart: "2026-04-04T10:00:00.000Z",
      }],
      provider: "junction",
      resourceCategoryCounts: { timeseries: 1 },
      sourceProviderCounts: { garmin: 1 },
      windowEnd: "2026-04-04T10:00:00.000Z",
      windowStart: "2026-04-04T10:00:00.000Z",
    });

    try {
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [dirtyState],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildCronWake("2026-04-04T10:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const accountId = state.hostedToLocalAccountIds.get(connectionId);
      assert.ok(accountId);
      const [queued] = readJobsForAccount(service, accountId);
      assert.ok(queued);
      assert.equal(queued.maxAttempts, 3);

      assert.equal(await service.drainWorker(1), 1);
      assert.equal(streamRequests, 1);
      assert.equal(getStore(service).getJobById(queued.id)?.status, "queued");
      now = new Date("2030-04-04T10:00:16.000Z");
      assert.equal(await service.drainWorker(1), 1);
      assert.equal(streamRequests, 2);
      assert.equal(getStore(service).getJobById(queued.id)?.status, "queued");
      now = new Date("2030-04-04T10:01:17.000Z");
      assert.equal(await service.drainWorker(1), 1);

      const terminal = getStore(service).getJobById(queued.id);
      assert.equal(streamRequests, 3);
      assert.equal(terminal?.attempts, 3);
      assert.equal(terminal?.maxAttempts, 3);
      assert.equal(terminal?.status, "dead");
      assert.equal(terminal?.lastErrorCode, "JUNCTION_API_REQUEST_FAILED");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("hosted exact workout timeouts recover on attempt three or dead-letter after three", async () => {
    for (const scenario of [
      { label: "third-success", timeoutCount: 2, expectedStatus: "succeeded" },
      { label: "terminal", timeoutCount: 3, expectedStatus: "dead" },
    ] as const) {
      const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
        `hosted-device-sync-runtime-workout-timeout-${scenario.label}-`,
      );
      await initializeVault({
        createdAt: "2026-04-04T00:00:00.000Z",
        vaultRoot,
      });
      let now = new Date("2030-04-04T10:00:00.000Z");
      let streamRequests = 0;
      const externalAccountId = `junction-hosted-workout-timeout-${scenario.label}`;
      const connectionId = `hosted_conn_workout_timeout_${scenario.label}`;
      const workoutId = `workout-hosted-timeout-${scenario.label}`;
      const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
        junction: {
          apiKey: "sk_us_test_123",
          clientUserIdSecret: "junction-client-user-id-secret",
          environment: "sandbox",
          fetchImpl: async (input, init) => {
            const url = new URL(readTestUrl(input));
            if (url.pathname === `/v2/user/providers/${externalAccountId}`) {
              return createTestJsonResponse({ providers: [{
                id: `provider-garmin-${scenario.label}`,
                slug: "garmin",
                status: "connected",
                resource_availability: { workouts: true },
              }] });
            }
            if (url.pathname === `/v2/timeseries/workouts/${workoutId}/stream`) {
              streamRequests += 1;
              if (streamRequests <= scenario.timeoutCount) {
                const signal = init?.signal;
                assert.ok(signal);
                return await new Promise<Response>((_resolve, reject) => {
                  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                });
              }
              return createTestJsonResponse({
                cadence: [80, 82],
                distance: [0, 1_000],
                heartrate: [120, 130],
                source: { provider: "garmin", type: "watch" },
                time: [1_775_174_400, 1_775_174_460],
              });
            }
            throw new Error(`Unexpected Junction request: ${url.pathname}`);
          },
          region: "us",
          requestTimeoutMs: 1,
          summaryResources: [],
          timeseriesResources: [],
        },
      });
      assert.ok(provider);
      const service = createDeviceSyncServiceForVault(vaultRoot, [provider], {
        clock: { now: () => now },
      });
      const fixture = buildHostedWorkoutRuntimeFixture({
        connectionId,
        externalAccountId,
        workoutId,
      });

      try {
        const state = await syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort: createSingleHostedDirtyStatePort(fixture.snapshot, fixture.dirtyState),
          wake: buildCronWake(now.toISOString()),
          secret: DEVICE_SYNC_SECRET,
          service,
        });
        const accountId = state.hostedToLocalAccountIds.get(connectionId);
        assert.ok(accountId);
        const [job] = readJobsForAccount(service, accountId);
        assert.ok(job);
        assert.equal(job.maxAttempts, 3);

        assert.equal(await service.drainWorker(1), 1);
        assert.equal(streamRequests, 1);
        now = new Date("2030-04-04T10:00:16.000Z");
        assert.equal(await service.drainWorker(1), 1);
        assert.equal(streamRequests, 2);
        now = new Date("2030-04-04T10:01:17.000Z");
        assert.equal(await service.drainWorker(1), 1);

        const terminal = getStore(service).getJobById(job.id);
        assert.equal(streamRequests, 3);
        assert.equal(terminal?.attempts, 3);
        assert.equal(terminal?.status, scenario.expectedStatus);
        const records = scenario.expectedStatus === "succeeded"
          ? await readCanonicalEventRecords(vaultRoot)
          : [];
        assert.equal(
          records.filter((record) => eventHasMetric(record, "average-workout-cadence")).length,
          scenario.expectedStatus === "succeeded" ? 1 : 0,
        );
      } finally {
        closeHostedRuntimeDeviceSyncService(service);
        await cleanup();
      }
    }
  });

  test("hosted exact workout work is reclaimed after lease expiry and runtime restart", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-workout-lease-restart-",
    );
    await initializeVault({
      createdAt: "2026-04-04T00:00:00.000Z",
      vaultRoot,
    });
    let now = new Date("2030-04-04T10:00:00.000Z");
    let streamRequests = 0;
    const externalAccountId = "junction-hosted-workout-lease-restart";
    const connectionId = "hosted_conn_workout_lease_restart";
    const workoutId = "workout-hosted-lease-restart";
    const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        fetchImpl: async (input) => {
          const url = new URL(readTestUrl(input));
          if (url.pathname === `/v2/user/providers/${externalAccountId}`) {
            return createTestJsonResponse({ providers: [{
              id: "provider-garmin-lease-restart",
              slug: "garmin",
              status: "connected",
              resource_availability: { workouts: true },
            }] });
          }
          if (url.pathname === `/v2/timeseries/workouts/${workoutId}/stream`) {
            streamRequests += 1;
            return createTestJsonResponse({
              cadence: [80, 82],
              distance: [0, 1_000],
              source: { provider: "garmin", type: "watch" },
              time: [1_775_174_400, 1_775_174_460],
            });
          }
          throw new Error(`Unexpected Junction request: ${url.pathname}`);
        },
        region: "us",
        summaryResources: [],
        timeseriesResources: [],
      },
    });
    assert.ok(provider);
    let service = createDeviceSyncServiceForVault(vaultRoot, [provider], {
      clock: { now: () => now },
    });
    let serviceClosed = false;
    const fixture = buildHostedWorkoutRuntimeFixture({
      connectionId,
      externalAccountId,
      workoutId,
    });

    try {
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSingleHostedDirtyStatePort(fixture.snapshot, fixture.dirtyState),
        wake: buildCronWake(now.toISOString()),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const accountId = state.hostedToLocalAccountIds.get(connectionId);
      assert.ok(accountId);
      const [job] = readJobsForAccount(service, accountId);
      assert.ok(job);
      const claimed = getStore(service).claimDueJob(
        "interrupted-hosted-worker",
        now.toISOString(),
        60_000,
      );
      assert.equal(claimed?.id, job.id);
      assert.equal(claimed?.attempts, 1);
      closeHostedRuntimeDeviceSyncService(service);
      serviceClosed = true;

      now = new Date("2030-04-04T10:01:01.000Z");
      service = createDeviceSyncServiceForVault(vaultRoot, [provider], {
        clock: { now: () => now },
      });
      serviceClosed = false;
      assert.equal(await service.drainWorker(1), 1);

      const completed = getStore(service).getJobById(job.id);
      assert.equal(streamRequests, 1);
      assert.equal(completed?.attempts, 2);
      assert.equal(completed?.status, "succeeded");
      assert.equal(
        (await readCanonicalEventRecords(vaultRoot))
          .filter((record) => eventHasMetric(record, "average-workout-cadence")).length,
        1,
      );
    } finally {
      if (!serviceClosed) {
        closeHostedRuntimeDeviceSyncService(service);
      }
      await cleanup();
    }
  });

  test("hosted runner yield during exact workout body reading releases durable work for continuation", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-workout-body-yield-",
    );
    await initializeVault({
      createdAt: "2026-04-04T00:00:00.000Z",
      vaultRoot,
    });
    const now = new Date("2030-04-04T10:00:00.000Z");
    let shouldYield = false;
    let streamRequests = 0;
    let markBodyReadStarted: (() => void) | null = null;
    const bodyReadStarted = new Promise<void>((resolve) => {
      markBodyReadStarted = resolve;
    });
    const externalAccountId = "junction-hosted-workout-body-yield";
    const connectionId = "hosted_conn_workout_body_yield";
    const workoutId = "workout-hosted-body-yield";
    const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        fetchImpl: async (input, init) => {
          const url = new URL(readTestUrl(input));
          if (url.pathname === `/v2/user/providers/${externalAccountId}`) {
            return createTestJsonResponse({ providers: [{
              id: "provider-garmin-body-yield",
              slug: "garmin",
              status: "connected",
              resource_availability: { workouts: true },
            }] });
          }
          if (url.pathname === `/v2/timeseries/workouts/${workoutId}/stream`) {
            streamRequests += 1;
            if (streamRequests === 1) {
              const signal = init?.signal;
              assert.ok(signal);
              return new Response(new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("{"));
                  markBodyReadStarted?.();
                  signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
                },
              }), {
                headers: { "content-type": "application/json" },
              });
            }
            return createTestJsonResponse({
              cadence: [80, 82],
              distance: [0, 1_000],
              source: { provider: "garmin", type: "watch" },
              time: [1_775_174_400, 1_775_174_460],
            });
          }
          throw new Error(`Unexpected Junction request: ${url.pathname}`);
        },
        region: "us",
        requestTimeoutMs: 10_000,
        summaryResources: [],
        timeseriesResources: [],
      },
    });
    assert.ok(provider);
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider], {
      clock: { now: () => now },
      shouldYieldJobExecution: () => shouldYield,
    });
    const fixture = buildHostedWorkoutRuntimeFixture({
      connectionId,
      externalAccountId,
      workoutId,
    });

    try {
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSingleHostedDirtyStatePort(fixture.snapshot, fixture.dirtyState),
        wake: buildCronWake(now.toISOString()),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const accountId = state.hostedToLocalAccountIds.get(connectionId);
      assert.ok(accountId);
      const [job] = readJobsForAccount(service, accountId);
      assert.ok(job);

      const yieldingExecution = service.runWorkerOnce();
      await bodyReadStarted;
      shouldYield = true;
      assert.equal((await yieldingExecution)?.id, job.id);
      shouldYield = false;
      const released = getStore(service).getJobById(job.id);
      assert.equal(streamRequests, 1);
      assert.equal(released?.attempts, 0);
      assert.equal(released?.status, "queued");

      assert.equal(await service.drainWorker(1), 1);
      const completed = getStore(service).getJobById(job.id);
      assert.equal(streamRequests, 2);
      assert.equal(completed?.attempts, 1);
      assert.equal(completed?.status, "succeeded");
      assert.equal(
        (await readCanonicalEventRecords(vaultRoot))
          .filter((record) => eventHasMetric(record, "average-workout-cadence")).length,
        1,
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("hosted exact workout replay is a no-op after a post-import worker crash", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-workout-post-import-crash-",
    );
    await initializeVault({
      createdAt: "2026-04-04T00:00:00.000Z",
      vaultRoot,
    });
    let now = new Date("2030-04-04T10:00:00.000Z");
    let streamRequests = 0;
    const importResults: unknown[] = [];
    const defaultImporter = createDefaultImporterPort();
    const importer: DeviceSyncImporterPort = {
      async importDeviceProviderSnapshot(input) {
        const result = await defaultImporter.importDeviceProviderSnapshot(input);
        importResults.push(result);
        if (importResults.length === 1) {
          throw deviceSyncError({
            code: "POST_IMPORT_WORKER_CRASH",
            message: "Worker stopped after canonical import and before durable completion.",
            retryable: true,
          });
        }
        return result;
      },
    };
    const externalAccountId = "junction-hosted-workout-post-import-crash";
    const connectionId = "hosted_conn_workout_post_import_crash";
    const workoutId = "workout-hosted-post-import-crash";
    const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        fetchImpl: async (input) => {
          const url = new URL(readTestUrl(input));
          if (url.pathname === `/v2/user/providers/${externalAccountId}`) {
            return createTestJsonResponse({ providers: [{
              id: "provider-garmin-post-import-crash",
              slug: "garmin",
              status: "connected",
              resource_availability: { workouts: true },
            }] });
          }
          if (url.pathname === `/v2/timeseries/workouts/${workoutId}/stream`) {
            streamRequests += 1;
            return createTestJsonResponse({
              cadence: [80, 82],
              distance: [0, 1_000],
              source: { provider: "garmin", type: "watch" },
              time: [1_775_174_400, 1_775_174_460],
            });
          }
          throw new Error(`Unexpected Junction request: ${url.pathname}`);
        },
        region: "us",
        summaryResources: [],
        timeseriesResources: [],
      },
    });
    assert.ok(provider);
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider], {
      clock: { now: () => now },
      importer,
    });
    const fixture = buildHostedWorkoutRuntimeFixture({
      connectionId,
      externalAccountId,
      workoutId,
    });

    try {
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSingleHostedDirtyStatePort(fixture.snapshot, fixture.dirtyState),
        wake: buildCronWake(now.toISOString()),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const accountId = state.hostedToLocalAccountIds.get(connectionId);
      assert.ok(accountId);
      const [job] = readJobsForAccount(service, accountId);
      assert.ok(job);

      assert.equal(await service.drainWorker(1), 1);
      assert.equal(getStore(service).getJobById(job.id)?.status, "queued");
      const afterCrash = await readCanonicalEventRecords(vaultRoot);
      assert.equal(
        afterCrash.filter((record) => eventHasMetric(record, "average-workout-cadence")).length,
        1,
      );

      now = new Date("2030-04-04T10:00:16.000Z");
      assert.equal(await service.drainWorker(1), 1);
      const completed = getStore(service).getJobById(job.id);
      const afterReplay = await readCanonicalEventRecords(vaultRoot);
      assert.equal(streamRequests, 2);
      assert.equal(completed?.attempts, 2);
      assert.equal(completed?.status, "succeeded");
      assert.deepEqual(
        importResults.map((result) =>
          typeof result === "object" && result !== null ? Reflect.get(result, "applied") : undefined
        ),
        [true, false],
      );
      assert.equal(
        afterReplay.filter((record) => eventHasMetric(record, "average-workout-cadence")).length,
        1,
      );
      assert.deepEqual(afterReplay, afterCrash);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("grouped workout duration joins only by explicit ID through the real vault path", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-grouped-workout-duration-",
    );
    await initializeVault({
      createdAt: "2026-04-02T00:00:00.000Z",
      vaultRoot,
    });
    const defaultImporter = createDefaultImporterPort();
    await defaultImporter.importDeviceProviderSnapshot({
      provider: "junction",
      vaultRoot,
      snapshot: {
        accountId: "junction-grouped-workout-duration",
        importedAt: "2026-04-02T15:00:00.000Z",
        summaries: {
          workouts: [{
            id: "workout-group-linked-1",
            time_start: "2026-04-02T14:00:00.000Z",
            time_end: "2026-04-02T14:30:00.000Z",
            source: {
              device_id: "grouped-workout-device-1",
              provider: "garmin",
              type: "watch",
            },
            sport: { slug: "running" },
          }],
        },
      },
    });
    const externalAccountId = "junction-grouped-workout-duration";
    const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        fetchImpl: async (input) => {
          const url = new URL(readTestUrl(input));
          if (url.pathname === `/v2/user/providers/${externalAccountId}`) {
            return createTestJsonResponse({ providers: [{
              slug: "garmin",
              status: "connected",
              resource_availability: { workout_duration: true, workouts: true },
            }] });
          }
          if (url.pathname === `/v2/timeseries/${externalAccountId}/workout_duration/grouped`) {
            return createTestJsonResponse({ groups: { garmin: [{
              data: [{
                start: "2026-04-02T14:00:00.000Z",
                end: "2026-04-02T14:30:00.000Z",
                unit: "minutes",
                value: 30,
              }],
              source: {
                device_id: "grouped-workout-device-1",
                provider: "garmin",
                type: "watch",
                workout_id: "workout-group-linked-1",
                sport: { slug: "running", raw_marker: "raw-linked-sport" },
                raw_marker: "raw-linked-group",
              },
            }, {
              data: [{
                start: "2026-04-02T14:00:00.000Z",
                end: "2026-04-02T14:30:00.000Z",
                unit: "minutes",
                value: 31,
              }],
              source: {
                device_id: "grouped-workout-device-2",
                provider: "garmin",
                type: "chest_strap",
                raw_marker: "raw-unattributed-group",
              },
            }] } });
          }
          throw new Error(`Unexpected Junction request: ${url.pathname}`);
        },
        region: "us",
        summaryResources: [],
        timeseriesResources: ["workout_duration"],
      },
    });
    assert.ok(provider);
    const clock = { now: () => new Date("2030-04-02T15:00:00.000Z") };
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider], { clock });

    try {
      const account = getStore(service).upsertAccount({
        connectedAt: "2026-04-02T12:00:00.000Z",
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        displayName: "Junction",
        externalAccountId,
        provider: "junction",
        scopes: [],
        status: "active",
      });
      const enqueueDuration = () => getStore(service).enqueueJob({
        accountId: account.id,
        availableAt: clock.now().toISOString(),
        kind: "resource",
        payload: {
          occurredAt: "2026-04-02T14:30:00.000Z",
          resource: "workout_duration",
          resourceCategory: "timeseries",
          sourceProviderSlug: "garmin",
          windowStart: "2026-04-02T00:00:00.000Z",
          windowEnd: "2026-04-03T00:00:00.000Z",
        },
        provider: "junction",
      });
      enqueueDuration();
      assert.equal(await service.drainWorker(1), 1);

      const records = await readCanonicalEventRecords(vaultRoot);
      const session = records.find((record) => record.kind === "activity_session");
      assert.ok(session);
      const sessionResourceId = eventExternalRefResourceId(session);
      assert.ok(sessionResourceId);
      const durations = records.filter((record) => eventHasMetric(record, "workout-duration"));
      assert.equal(durations.length, 2);
      const linked = durations.find((record) =>
        eventExternalRefResourceId(record) === sessionResourceId
      );
      const unattributed = durations.find((record) => record.id !== linked?.id);
      assert.ok(linked);
      assert.ok(unattributed);
      assert.notEqual(eventExternalRefResourceId(unattributed), sessionResourceId);
      const linkedMeasurements = linked.kind === "measurement" && Array.isArray(linked.measurements)
        ? linked.measurements
        : [];
      const qualifiers = linkedMeasurements[0]
        && typeof linkedMeasurements[0] === "object"
        && !Array.isArray(linkedMeasurements[0])
        ? Reflect.get(linkedMeasurements[0], "qualifiers")
        : undefined;
      assert.deepEqual(qualifiers, { sport: "running" });

      const ingests = await readIntegrationIngestEntries(vaultRoot);
      const durationIngest = ingests.find((entry) =>
        entry.record.parts.some((part) => part.role.includes("workout-duration"))
      );
      assert.ok(durationIngest);
      const retainedText = JSON.stringify(durationIngest.record.parts);
      assert.doesNotMatch(
        retainedText,
        /provider-snapshot|raw-linked-group|raw-linked-sport|raw-unattributed-group/u,
      );

      const beforeReplay = await readCanonicalEventRecords(vaultRoot);
      enqueueDuration();
      assert.equal(await service.drainWorker(1), 1);
      assert.deepEqual(await readCanonicalEventRecords(vaultRoot), beforeReplay);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("duplicate pending timing entries merge conservatively after local job deduplication", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-deduped-timing-",
    );
    await mkdir(vaultRoot, { recursive: true });
    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({ provider: "demo" });
      const connected = await service.handleOAuthCallback({
        code: "deduped-timing",
        provider: "demo",
        state: begin.state,
      });
      const store = getStore(service);
      const enqueue = () => store.enqueueJob({
        accountId: connected.account.id,
        dedupeKey: "hosted-dirty:demo:reconcile:provider:category:resource",
        kind: "reconcile",
        payload: {},
        provider: "demo",
      });
      const firstJob = enqueue();
      const secondJob = enqueue();
      assert.equal(firstJob.id, secondJob.id);
      assert.equal(readJobsForAccount(service, connected.account.id).length, 1);

      const state = {
        hostedToLocalAccountIds: new Map([["hosted_conn_deduped", connected.account.id]]),
        localToHostedAccountIds: new Map([[connected.account.id, "hosted_conn_deduped"]]),
        observedTokenVersions: new Map<string, number | null>(),
        pendingDirtyAcks: [{
          connectionId: "hosted_conn_deduped",
          nextWakeAt: null,
          processedRevision: "9",
        }],
        pendingDirtyPayloadJobs: [{
          connectionId: "hosted_conn_deduped",
          dirtyPayloadId: "dsp_deduped_1",
          jobId: firstJob.id,
          processedRevision: "9",
          timing: {
            eventToProviderSendBucket: "under_5_minutes",
            firstWebhookReceivedAt: "2026-04-08T00:04:00.000Z",
            providerSendToWebhookMs: 60_000,
            sourceProvider: "garmin",
          },
        }, {
          connectionId: "hosted_conn_deduped",
          dirtyPayloadId: "dsp_deduped_2",
          jobId: secondJob.id,
          processedRevision: "9",
          timing: {
            eventToProviderSendBucket: "5_to_30_minutes",
            firstWebhookReceivedAt: "2026-04-08T00:03:00.000Z",
            providerSendToWebhookMs: 120_000,
            sourceProvider: "fitbit",
          },
        }],
        snapshot: null,
      } satisfies HostedDeviceSyncRuntimeSyncState;

      assert.equal(await service.drainWorker(1), 1);
      const completedImports = promoteHostedCompletedDirtyPayloadAcks({ service, state });

      assert.equal(completedImports.length, 1);
      const [completedImport] = completedImports;
      assert.ok(completedImport);
      assert.match(completedImport.importCompletedAt, /^\d{4}-\d{2}-\d{2}T/u);
      assert.match(completedImport.importExecutionStartedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.deepEqual({
        ...completedImport,
        importCompletedAt: "<timestamp>",
        importExecutionStartedAt: "<timestamp>",
      }, {
        eventToProviderSendBucket: "5_to_30_minutes",
        firstWebhookReceivedAt: "2026-04-08T00:03:00.000Z",
        importCompletedAt: "<timestamp>",
        importExecutionStartedAt: "<timestamp>",
        jobCreatedAt: firstJob.createdAt,
        jobKind: "reconcile",
        provider: "demo",
        providerSendToWebhookMs: 120_000,
        sourceProvider: null,
      });
      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_conn_deduped",
        nextWakeAt: null,
        processedDirtyPayloadIds: ["dsp_deduped_1", "dsp_deduped_2"],
        processedRevision: "9",
      }]);
      assert.deepEqual(state.pendingDirtyPayloadJobs, []);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("one mixed-source compact reconcile stays one import and omits source attribution", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-mixed-source-timing-",
    );
    await mkdir(vaultRoot, { recursive: true });
    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({ provider: "demo" });
      const connected = await service.handleOAuthCallback({
        code: "mixed-source-timing",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_mixed_source_timing",
        externalAccountId: connected.account.externalAccountId,
      });
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [{
                connectionId: "hosted_conn_mixed_source_timing",
                dirtyRevision: "1",
                dirtyResources: [{
                  count: 2,
                  eventToProviderSendBucket: "5_to_30_minutes",
                  firstWebhookReceivedAt: "2026-04-08T00:03:00.000Z",
                  providerSendToWebhookMs: 120_000,
                  jobKind: "reconcile",
                  resource: null,
                  resourceCategory: null,
                  sourceProviderSlug: null,
                  timingSourceProviderSlug: null,
                  windowEnd: null,
                  windowStart: null,
                }],
                eventCount: "2",
                latestDirtyAt: "2026-04-08T00:03:00.000Z",
                processedRevision: "0",
                provider: "demo",
                resourceCategoryCounts: { reconcile: 2 },
                sourceProviderCounts: { unknown: 2 },
                userId: "member_mixed_source_timing",
                windowEnd: null,
                windowStart: null,
              }],
              nextWakeAt: null,
              userId: "member_mixed_source_timing",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_mixed_source_timing",
          eventId: "evt_device_sync_mixed_source_timing",
          hint: { reason: "dirty" },
          occurredAt: "2026-04-08T00:03:00.000Z",
          reason: "webhook_hint",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const jobs = readJobsForAccount(service, connected.account.id);
      assert.equal(jobs.length, 1);
      const payload = jobs[0]?.payloadJson ? JSON.parse(jobs[0].payloadJson) : {};
      assert.deepEqual(payload, {
        windowEnd: "2026-04-08T00:03:00.000Z",
        windowStart: "2026-04-08T00:03:00.000Z",
      });
      assert.equal(Object.prototype.hasOwnProperty.call(payload, "sourceProviderSlug"), false);
      assert.equal(state.pendingDirtyPayloadJobs.length, 1);
      assert.equal(state.pendingDirtyPayloadJobs[0]?.timing?.sourceProvider, null);

      assert.equal(await service.drainWorker(1), 1);
      const completedImports = promoteHostedCompletedDirtyPayloadAcks({ service, state });
      assert.equal(completedImports.length, 1);
      assert.equal(completedImports[0]?.sourceProvider, null);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("device-sync dirty pending fetch processes multiple ackable states in one bounded pass", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const firstBegin = await service.startConnection({
        provider: "demo",
      });
      const firstConnected = await service.handleOAuthCallback({
        code: "dirty-batch-first",
        provider: "demo",
        state: firstBegin.state,
      });
      const secondBegin = await service.startConnection({
        provider: "demo",
      });
      const secondConnected = await service.handleOAuthCallback({
        code: "dirty-batch-second",
        provider: "demo",
        state: secondBegin.state,
      });
      const firstSnapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_dirty_batch_1",
        externalAccountId: firstConnected.account.externalAccountId,
      });
      const secondSnapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_dirty_batch_2",
        externalAccountId: secondConnected.account.externalAccountId,
      });
      const snapshot = {
        ...firstSnapshot,
        connections: [
          ...firstSnapshot.connections,
          ...secondSnapshot.connections,
        ],
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [
                buildDirtyState({
                  connectionId: "hosted_conn_dirty_batch_1",
                  dirtyRevision: "51",
                  dirtyResources: [
                    {
                      count: 1,
                      dirtyPayloadId: "dsp_payload_batch_1",
                      jobKind: "resource",
                      resource: "steps",
                      resourceCategory: "timeseries",
                      sourceProviderSlug: "garmin",
                      windowEnd: "2026-04-04T00:00:00.000Z",
                      windowStart: "2026-04-03T00:00:00.000Z",
                    },
                  ],
                }),
                buildDirtyState({
                  connectionId: "hosted_conn_dirty_batch_2",
                  dirtyRevision: "52",
                  dirtyResources: [
                    {
                      count: 1,
                      dirtyPayloadId: "dsp_payload_batch_2",
                      jobKind: "resource",
                      resource: "sleep",
                      resourceCategory: "summary",
                      sourceProviderSlug: "garmin",
                      windowEnd: "2026-04-04T00:00:00.000Z",
                      windowStart: "2026-04-03T00:00:00.000Z",
                    },
                  ],
                }),
              ],
              nextWakeAt: "2026-04-04T10:01:00.000Z",
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_dirty_batch_1",
          eventId: "evt_device_sync_dirty_batch",
          hint: {
            reason: "dirty",
          },
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "webhook_hint",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.deepEqual(state.pendingDirtyAcks, [
        {
          connectionId: "hosted_conn_dirty_batch_1",
          nextWakeAt: "2026-04-04T10:01:00.000Z",
          processedRevision: "51",
        },
        {
          connectionId: "hosted_conn_dirty_batch_2",
          nextWakeAt: "2026-04-04T10:01:00.000Z",
          processedRevision: "52",
        },
      ]);
      assert.equal(readJobsForAccount(service, firstConnected.account.id).length, 1);
      assert.equal(readJobsForAccount(service, secondConnected.account.id).length, 1);
      assert.deepEqual(
        state.pendingDirtyPayloadJobs.map(({ connectionId, dirtyPayloadId }) => ({
          connectionId,
          dirtyPayloadId,
        })),
        [{
          connectionId: "hosted_conn_dirty_batch_1",
          dirtyPayloadId: "dsp_payload_batch_1",
        }, {
          connectionId: "hosted_conn_dirty_batch_2",
          dirtyPayloadId: "dsp_payload_batch_2",
        }],
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("generic Strava payloads honor local retry timing and survive a cold restore", async () => {
    const firstWorkspace = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-strava-retry-first-",
    );
    const restoredWorkspace = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-strava-retry-restored-",
    );
    await mkdir(firstWorkspace.vaultRoot, { recursive: true });
    await mkdir(restoredWorkspace.vaultRoot, { recursive: true });
    const baseProvider = createFakeProvider();
    const stravaProvider: DeviceSyncProvider = {
      ...baseProvider,
      provider: "strava",
      descriptor: {
        ...baseProvider.descriptor,
        displayName: "Strava",
        provider: "strava",
      },
      jobExecutor: {
        async executeJob(_context, job) {
          const terminal = job.payload.resourceId === "strava-activity-terminal";
          throw deviceSyncError({
            code: terminal ? "STRAVA_ACTIVITY_INVALID" : "STRAVA_API_RATE_LIMITED",
            httpStatus: terminal ? 400 : 429,
            message: terminal
              ? "Strava activity fetch cannot be retried."
              : "Strava activity fetch was rate limited.",
            retryable: !terminal,
          });
        },
      },
    };
    const service = createDeviceSyncServiceForVault(firstWorkspace.vaultRoot, [stravaProvider]);
    const restoredService = createDeviceSyncServiceForVault(
      restoredWorkspace.vaultRoot,
      [{
        ...stravaProvider,
        jobExecutor: baseProvider.jobExecutor,
      }],
    );
    const connectionId = "hosted_strava_retry";
    const dirtyPayloadId = "dsp_strava_retry";
    const terminalDirtyPayloadId = "dsp_strava_terminal";
    const pendingPayloadIds = new Set([dirtyPayloadId, terminalDirtyPayloadId]);
    const ackRequests: Array<Parameters<HostedRuntimeDeviceSyncPort["ackDirtyStateProcessed"]>[0]> = [];
    let firstClosed = false;

    try {
      const begin = await service.startConnection({ provider: "strava" });
      const connected = await service.handleOAuthCallback({
        code: "strava-retry",
        provider: "strava",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId,
        externalAccountId: connected.account.externalAccountId,
        provider: "strava",
      });
      const dirtyState = buildDirtyState({
        connectionId,
        dirtyRevision: "7",
        dirtyResources: [{
          count: 1,
          dirtyPayloadId,
          jobKind: "resource",
          payload: {
            eventType: "activity.create",
            occurredAt: "2026-04-04T10:00:00.000Z",
            resourceId: "strava-activity-123",
            resourceType: "activity",
          },
          resource: "activity",
          resourceCategory: "activity",
          sourceProviderSlug: "strava",
          windowEnd: null,
          windowStart: null,
        }, {
          count: 1,
          dirtyPayloadId: terminalDirtyPayloadId,
          jobKind: "resource",
          payload: {
            eventType: "activity.create",
            occurredAt: "2026-04-04T10:00:00.000Z",
            resourceId: "strava-activity-terminal",
            resourceType: "activity",
          },
          resource: "activity",
          resourceCategory: "activity",
          sourceProviderSlug: "strava",
          windowEnd: null,
          windowStart: null,
        }],
        provider: "strava",
      });
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        async ackDirtyStateProcessed(input) {
          ackRequests.push(input);
          for (const processedId of input.processedDirtyPayloadIds ?? []) {
            pendingPayloadIds.delete(processedId);
          }
          const stillDirty = pendingPayloadIds.size > 0;
          return {
            connectionId,
            dirtyRevision: "7",
            nextWakeAt: stillDirty ? "2026-04-04T10:00:01.000Z" : null,
            processedRevision: "7",
            recorded: true,
            stillDirty,
            userId: "member_123",
          };
        },
        async applyUpdates() {
          throw new Error("applyUpdates should not be called during dirty-state sync.");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during dirty-state sync.");
        },
        async fetchDirtyStates() {
          const pendingResources = dirtyState.dirtyResources.filter((resource) =>
            resource.dirtyPayloadId && pendingPayloadIds.has(resource.dirtyPayloadId)
          );
          return {
            hasMore: false,
            items: pendingResources.length > 0
              ? [{ ...dirtyState, dirtyResources: pendingResources }]
              : [],
            nextWakeAt: null,
            userId: "member_123",
          };
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T10:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const retryScheduledAfter = Date.now();
      assert.equal(await service.drainWorker(2), 2);
      promoteHostedCompletedDirtyPayloadAcks({ service, state });
      const jobs = readJobsForAccount(service, connected.account.id);
      const retryJob = jobs.find((job) =>
        JSON.parse(job.payloadJson).resourceId === "strava-activity-123"
      );
      const terminalJob = jobs.find((job) =>
        JSON.parse(job.payloadJson).resourceId === "strava-activity-terminal"
      );
      assert.equal(retryJob?.status, "queued");
      assert.ok(Date.parse(retryJob?.availableAt ?? "") > retryScheduledAfter);
      assert.equal(terminalJob?.status, "dead");
      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId,
        nextWakeAt: null,
        processedDirtyPayloadIds: [terminalDirtyPayloadId],
        processedRevision: "7",
      }]);
      assert.deepEqual(state.pendingDirtyPayloadJobs, [{
        connectionId,
        dirtyPayloadId,
        jobId: retryJob?.id,
        processedRevision: "7",
      }]);

      const [ack] = state.pendingDirtyAcks;
      assert.ok(ack);
      assert.ok(retryJob);
      const recorded = await recordHostedDeviceSyncDirtyPostCheckpointRecord({
        record: {
          kind: "device-sync.dirty-processed",
          ...ack,
          nextWakeAt: retryJob.availableAt,
        },
        runtime: createDeviceSyncPostCheckpointRuntime(deviceSyncPort),
      });
      assert.deepEqual(recorded, {
        nextWakeAt: retryJob.availableAt,
        recorded: 1,
        stillDirty: true,
      });
      assert.deepEqual(ackRequests, [{
        connectionId,
        processedDirtyPayloadIds: [terminalDirtyPayloadId],
        processedRevision: "7",
      }]);
      assert.deepEqual([...pendingPayloadIds], [dirtyPayloadId]);

      closeHostedRuntimeDeviceSyncService(service);
      firstClosed = true;

      const restoredState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T10:00:01.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service: restoredService,
      });
      assert.equal(restoredState.pendingDirtyPayloadJobs.length, 1);
      assert.equal(await restoredService.drainWorker(1), 1);
      promoteHostedCompletedDirtyPayloadAcks({
        service: restoredService,
        state: restoredState,
      });
      assert.deepEqual(restoredState.pendingDirtyAcks, [{
        connectionId,
        nextWakeAt: null,
        processedDirtyPayloadIds: [dirtyPayloadId],
        processedRevision: "7",
      }]);
      assert.deepEqual(restoredState.pendingDirtyPayloadJobs, []);
      const [restoredAck] = restoredState.pendingDirtyAcks;
      assert.ok(restoredAck);
      assert.deepEqual(
        await recordHostedDeviceSyncDirtyPostCheckpointRecord({
          record: {
            kind: "device-sync.dirty-processed",
            ...restoredAck,
          },
          runtime: createDeviceSyncPostCheckpointRuntime(deviceSyncPort),
        }),
        {
          nextWakeAt: null,
          recorded: 1,
          stillDirty: false,
        },
      );
      assert.equal(pendingPayloadIds.size, 0);
      const restoredAccountId = restoredState.hostedToLocalAccountIds.get(connectionId);
      assert.ok(restoredAccountId);
      assert.equal(
        readJobsForAccount(restoredService, restoredAccountId).length,
        1,
      );
    } finally {
      if (!firstClosed) {
        closeHostedRuntimeDeviceSyncService(service);
      }
      closeHostedRuntimeDeviceSyncService(restoredService);
      await firstWorkspace.cleanup();
      await restoredWorkspace.cleanup();
    }
  });

  test("companion payload acknowledgement remains deferred after retryable canonical import failure", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });
    const baseProvider = createFakeProvider();
    const junctionProvider: DeviceSyncProvider = {
      ...baseProvider,
      provider: "junction",
      descriptor: {
        ...baseProvider.descriptor,
        displayName: "Junction",
        provider: "junction",
      },
      jobExecutor: {
        async executeJob() {
          throw deviceSyncError({
            code: "IMPORT_RETRYABLE",
            httpStatus: 503,
            message: "Canonical import is temporarily unavailable.",
            retryable: true,
          });
        },
      },
    };
    const service = createDeviceSyncServiceForVault(vaultRoot, [junctionProvider]);

    try {
      const account = getStore(service).upsertAccount({
        connectedAt: "2026-04-04T09:00:00.000Z",
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        displayName: "Junction",
        externalAccountId: "junction-retryable-companion-payload",
        provider: "junction",
        scopes: [],
        status: "active",
      });
      const companionObservationJson = serializeCompanionHrvRmssdObservation({
        schema: COMPANION_HRV_RMSSD_SCHEMA,
        methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
        nightDate: "2026-04-04",
        rmssdMs: 48.25,
        completedWindowCount: 84,
        acceptedWindowCount: 56,
      });
      const job = getStore(service).enqueueJob({
        accountId: account.id,
        kind: "resource",
        payload: {
          companionAdmissionId: createHash("sha256")
            .update(companionObservationJson)
            .digest("hex"),
          companionObservationJson,
          resource: COMPANION_HRV_RMSSD_RESOURCE,
          resourceCategory: "derived",
          sourceProviderSlug: "whoop",
        },
        provider: "junction",
      });
      const state = {
        hostedToLocalAccountIds: new Map([["hosted_retryable", account.id]]),
        localToHostedAccountIds: new Map([[account.id, "hosted_retryable"]]),
        observedTokenVersions: new Map<string, number | null>(),
        pendingDirtyAcks: [{
          connectionId: "hosted_retryable",
          nextWakeAt: null,
          processedRevision: "7",
        }],
        pendingDirtyPayloadJobs: [{
          connectionId: "hosted_retryable",
          dirtyPayloadId: "dsp_retryable",
          jobId: job.id,
          processedRevision: "7",
        }],
        snapshot: null,
      };

      assert.equal(await service.drainWorker(1), 1);
      assert.equal(getStore(service).getJobById(job.id)?.status, "queued");
      promoteHostedCompletedDirtyPayloadAcks({ service, state });

      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_retryable",
        nextWakeAt: null,
        processedRevision: "7",
      }]);
      assert.deepEqual(state.pendingDirtyPayloadJobs, [{
        connectionId: "hosted_retryable",
        dirtyPayloadId: "dsp_retryable",
        jobId: job.id,
        processedRevision: "7",
      }]);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("structurally invalid companion work promotes its hosted payload exactly once", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-invalid-companion-",
    );
    const baseProvider = createFakeProvider();
    const junctionProvider: DeviceSyncProvider = {
      ...baseProvider,
      provider: "junction",
      descriptor: {
        ...baseProvider.descriptor,
        displayName: "Junction",
        provider: "junction",
      },
      jobExecutor: {
        async executeJob() {
          throw deviceSyncError({
            code: JUNCTION_COMPANION_HRV_OBSERVATION_INVALID_CODE,
            message: "Companion HRV observation payload was invalid.",
            retryable: false,
          });
        },
      },
    };
    const service = createDeviceSyncServiceForVault(vaultRoot, [junctionProvider]);
    const store = getStore(service);

    try {
      const account = getStore(service).upsertAccount({
        connectedAt: "2026-04-04T09:00:00.000Z",
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        displayName: "Junction",
        externalAccountId: "junction-invalid-companion-payload",
        provider: "junction",
        scopes: [],
        status: "active",
      });
      const job = getStore(service).enqueueJob({
        accountId: account.id,
        kind: "resource",
        maxAttempts: 1,
        payload: {
          companionAdmissionId: "f".repeat(64),
          companionObservationJson: "{}",
          resource: COMPANION_HRV_RMSSD_RESOURCE,
          resourceCategory: "derived",
          sourceProviderSlug: "whoop",
        },
        provider: "junction",
      });
      const state = {
        hostedToLocalAccountIds: new Map([["hosted_invalid", account.id]]),
        localToHostedAccountIds: new Map([[account.id, "hosted_invalid"]]),
        observedTokenVersions: new Map<string, number | null>(),
        pendingDirtyAcks: [{
          connectionId: "hosted_invalid",
          nextWakeAt: null,
          processedRevision: "8",
        }],
        pendingDirtyPayloadJobs: [{
          connectionId: "hosted_invalid",
          dirtyPayloadId: "dsp_invalid",
          jobId: job.id,
          processedRevision: "8",
        }],
        snapshot: null,
      };

      assert.equal(await service.drainWorker(1), 1);
      const terminalJob = store.getJobById(job.id);
      assert.equal(terminalJob?.lastErrorCode, JUNCTION_COMPANION_HRV_OBSERVATION_INVALID_CODE);
      assert.equal(terminalJob?.status, "dead");

      const retainedJob = store.enqueueJob({
        accountId: account.id,
        availableAt: "2026-04-04T10:00:00.000Z",
        kind: "resource",
        maxAttempts: 1,
        payload: {
          companionAdmissionId: "e".repeat(64),
          companionObservationJson: "{}",
          resource: COMPANION_HRV_RMSSD_RESOURCE,
          resourceCategory: "derived",
          sourceProviderSlug: "whoop",
        },
        provider: "junction",
      });
      assert.equal(
        store.claimDueJob("lease-expired-worker", "2026-04-04T10:00:00.000Z", 60_000)?.id,
        retainedJob.id,
      );
      assert.equal(
        store.failJobIfOwned(
          retainedJob.id,
          "lease-expired-worker",
          "2026-04-04T10:00:01.000Z",
          "LEASE_EXPIRED",
          "Companion worker lease expired before completion.",
          null,
          false,
        ),
        true,
      );
      assert.equal(store.getJobById(retainedJob.id)?.status, "dead");
      state.pendingDirtyPayloadJobs.push({
        connectionId: "hosted_invalid",
        dirtyPayloadId: "dsp_lease_expired",
        jobId: retainedJob.id,
        processedRevision: "8",
      });

      promoteHostedCompletedDirtyPayloadAcks({ service, state });
      promoteHostedCompletedDirtyPayloadAcks({ service, state });

      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_invalid",
        nextWakeAt: null,
        processedDirtyPayloadIds: ["dsp_invalid"],
        processedRevision: "8",
      }]);
      assert.deepEqual(state.pendingDirtyPayloadJobs, [{
        connectionId: "hosted_invalid",
        dirtyPayloadId: "dsp_lease_expired",
        jobId: retainedJob.id,
        processedRevision: "8",
      }]);
      assert.equal(readJobsForAccount(service, account.id).length, 2);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("a fresh local runtime refetches retained companion work after a pre-worker yield", async () => {
    const firstWorkspace = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-cold-restore-first-",
    );
    const restoredWorkspace = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-cold-restore-second-",
    );
    await mkdir(firstWorkspace.vaultRoot, { recursive: true });
    await mkdir(restoredWorkspace.vaultRoot, { recursive: true });
    const baseProvider = createFakeProvider();
    const junctionProvider: DeviceSyncProvider = {
      ...baseProvider,
      provider: "junction",
      descriptor: {
        ...baseProvider.descriptor,
        displayName: "Junction",
        provider: "junction",
      },
    };
    const firstService = createDeviceSyncServiceForVault(
      firstWorkspace.vaultRoot,
      [junctionProvider],
    );
    const restoredService = createDeviceSyncServiceForVault(
      restoredWorkspace.vaultRoot,
      [junctionProvider],
    );
    let firstClosed = false;
    let fetchCount = 0;
    const connectionId = "hosted_cold_restore";
    const companionObservationJson = serializeCompanionHrvRmssdObservation({
      schema: COMPANION_HRV_RMSSD_SCHEMA,
      methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
      nightDate: "2026-04-04",
      rmssdMs: 48.25,
      completedWindowCount: 84,
      acceptedWindowCount: 56,
    });
    const dirtyState = buildDirtyState({
      connectionId,
      dirtyRevision: "9",
      dirtyResources: [{
        count: 1,
        dirtyPayloadId: "dsp_cold_restore",
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
      provider: "junction",
    });

    const syncFreshRuntime = async (service: DeviceSyncService) => {
      const account = getStore(service).upsertAccount({
        connectedAt: "2026-04-04T09:00:00.000Z",
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        displayName: "Junction",
        externalAccountId: "junction-companion-cold-restore",
        provider: "junction",
        scopes: [],
        status: "active",
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId,
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId: account.externalAccountId,
        provider: "junction",
        tokenBundle: null,
      });
      return syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            fetchCount += 1;
            return {
              hasMore: false,
              items: [dirtyState],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildCronWake("2026-04-04T10:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
    };

    try {
      const yieldedState = await syncFreshRuntime(firstService);
      assert.deepEqual(yieldedState.pendingDirtyAcks, [{
        connectionId,
        nextWakeAt: null,
        processedRevision: "9",
      }]);
      assert.equal(yieldedState.pendingDirtyPayloadJobs.length, 1);

      closeHostedRuntimeDeviceSyncService(firstService);
      firstClosed = true;

      const restoredState = await syncFreshRuntime(restoredService);
      assert.equal(fetchCount, 2);
      assert.deepEqual(restoredState.pendingDirtyAcks, [{
        connectionId,
        nextWakeAt: null,
        processedRevision: "9",
      }]);
      assert.equal(await restoredService.drainWorker(1), 1);
      promoteHostedCompletedDirtyPayloadAcks({
        service: restoredService,
        state: restoredState,
      });
      assert.deepEqual(restoredState.pendingDirtyAcks, [{
        connectionId,
        nextWakeAt: null,
        processedDirtyPayloadIds: ["dsp_cold_restore"],
        processedRevision: "9",
      }]);
    } finally {
      if (!firstClosed) {
        closeHostedRuntimeDeviceSyncService(firstService);
      }
      closeHostedRuntimeDeviceSyncService(restoredService);
      await firstWorkspace.cleanup();
      await restoredWorkspace.cleanup();
    }
  });

  test("retains a disconnect-skipped generic payload for an authoritative active snapshot", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });
    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const account = getStore(service).upsertAccount({
        connectedAt: "2026-04-04T09:00:00.000Z",
        credential: {
          credentialMetadata: {},
          kind: "none",
        },
        displayName: "Demo",
        externalAccountId: "demo-skipped-dirty-payload",
        provider: "demo",
        scopes: [],
        status: "disconnected",
      });
      const job = getStore(service).enqueueJob({
        accountId: account.id,
        kind: "resource",
        payload: { resource: "steps" },
        provider: "demo",
      });
      const state = {
        hostedToLocalAccountIds: new Map([["hosted_skipped", account.id]]),
        localToHostedAccountIds: new Map([[account.id, "hosted_skipped"]]),
        observedTokenVersions: new Map<string, number | null>(),
        pendingDirtyAcks: [{
          connectionId: "hosted_skipped",
          nextWakeAt: null,
          processedRevision: "8",
        }],
        pendingDirtyPayloadJobs: [{
          connectionId: "hosted_skipped",
          dirtyPayloadId: "dsp_skipped",
          jobId: job.id,
          processedRevision: "8",
        }],
        snapshot: null,
      };

      assert.equal(await service.drainWorker(1), 1);
      assert.equal(getStore(service).getJobById(job.id)?.status, "succeeded");
      promoteHostedCompletedDirtyPayloadAcks({ service, state });

      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_skipped",
        nextWakeAt: null,
        processedRevision: "8",
      }]);
      assert.deepEqual(state.pendingDirtyPayloadJobs, [{
        connectionId: "hosted_skipped",
        dirtyPayloadId: "dsp_skipped",
        jobId: job.id,
        processedRevision: "8",
      }]);

      const recoveredState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during recovery sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during recovery sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [buildDirtyState({
                connectionId: "hosted_skipped",
                dirtyRevision: "8",
                dirtyResources: [{
                  count: 1,
                  dirtyPayloadId: "dsp_skipped",
                  jobKind: "resource",
                  resource: "steps",
                  resourceCategory: "timeseries",
                  sourceProviderSlug: "demo",
                  windowEnd: "2026-04-04T00:00:00.000Z",
                  windowStart: "2026-04-03T00:00:00.000Z",
                }],
              })],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_skipped",
              externalAccountId: account.externalAccountId,
            });
          },
        },
        wake: buildCronWake("2026-04-04T10:01:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(getStore(service).getAccountById(account.id)?.status, "active");
      assert.equal(recoveredState.pendingDirtyPayloadJobs.length, 1);
      assert.equal(await service.drainWorker(1), 1);
      promoteHostedCompletedDirtyPayloadAcks({ service, state: recoveredState });
      assert.deepEqual(recoveredState.pendingDirtyAcks, [{
        connectionId: "hosted_skipped",
        nextWakeAt: null,
        processedDirtyPayloadIds: ["dsp_skipped"],
        processedRevision: "8",
      }]);
      assert.deepEqual(recoveredState.pendingDirtyPayloadJobs, []);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("device-sync dirty payload jobs keep manifest payload without semantic defaults", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "dirty-payload",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_dirty_payload",
        externalAccountId: connected.account.externalAccountId,
      });
      const dirtyState: HostedExecutionDeviceSyncDirtyStateResponse = {
        connectionId: "hosted_conn_dirty_payload",
        dirtyRevision: "43",
        dirtyResources: [
          {
            count: 1,
            jobKind: "delete",
            payload: {
              objectId: "session-42",
              occurredAt: "2026-04-04T09:00:00.000Z",
              sourceEventType: "session.deleted",
            },
            resource: null,
            resourceCategory: null,
            sourceProviderSlug: null,
            windowEnd: null,
            windowStart: null,
          },
        ],
        eventCount: "1",
        latestDirtyAt: "2026-04-04T10:00:00.000Z",
        processedRevision: "0",
        provider: "demo",
        resourceCategoryCounts: {},
        sourceProviderCounts: {},
        userId: "member_123",
        windowEnd: "2026-04-04T00:00:00.000Z",
        windowStart: "2026-04-02T00:00:00.000Z",
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [dirtyState],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_dirty_payload",
          eventId: "evt_device_sync_dirty_payload",
          hint: {
            reason: "dirty",
          },
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "webhook_hint",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_conn_dirty_payload",
        nextWakeAt: null,
        processedRevision: "43",
      }]);
      const jobs = readJobsForAccount(service, connected.account.id);
      assert.equal(jobs.length, 1);
      const payload = jobs[0]?.payloadJson ? JSON.parse(jobs[0].payloadJson) : null;
      assert.deepEqual(payload, {
        objectId: "session-42",
        occurredAt: "2026-04-04T09:00:00.000Z",
        sourceEventType: "session.deleted",
      });
      assert.equal(Object.prototype.hasOwnProperty.call(payload, "resource"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload, "resourceCategory"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload, "sourceProviderSlug"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload, "windowStart"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload, "windowEnd"), false);
      assert.equal(jobs[0]?.kind, "delete");
      assert.equal(jobs[0]?.priority, 60);
      assert.equal(jobs[0]?.status, "queued");
      assert.equal(
        jobs[0]?.dedupeKey?.startsWith("hosted-dirty:demo:delete:provider:category:resource:"),
        true,
      );
      assert.equal(jobs[0]?.dedupeKey?.endsWith("::"), true);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("device-sync wake hints skip terminal hydrated accounts", async () => {
    for (const status of ["disconnected", "reauthorization_required"] as const) {
      const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
        "hosted-device-sync-runtime-",
      );
      await mkdir(vaultRoot, { recursive: true });

      const service = createDeviceSyncServiceForVault(vaultRoot);

      try {
        const begin = await service.startConnection({
          provider: "demo",
        });
        const connected = await service.handleOAuthCallback({
          code: `terminal-wake-${status}`,
          provider: "demo",
          state: begin.state,
        });
        const snapshot = buildRuntimeSnapshot({
          connectionId: `hosted_conn_terminal_wake_${status}`,
          externalAccountId: connected.account.externalAccountId,
          status,
          tokenBundle: status === "disconnected" ? null : undefined,
        });

        await syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort: createSnapshotOnlyDeviceSyncPort(snapshot),
          wake: buildDeviceSyncWake({
            connectionId: `hosted_conn_terminal_wake_${status}`,
            eventId: `evt_device_sync_terminal_wake_${status}`,
            hint: {
              jobs: [
                {
                  availableAt: "2026-04-04T10:05:00.000Z",
                  dedupeKey: `wake:terminal-resource-sync:${status}`,
                  kind: "resource-sync",
                },
              ],
            },
            occurredAt: "2026-04-04T10:00:00.000Z",
            reason: "webhook_hint",
          }),
          secret: DEVICE_SYNC_SECRET,
          service,
        });

        const stored = getStore(service).getAccountById(connected.account.id);
        assert.ok(stored);
        assert.equal(stored.status, status);
        assert.equal(readJobsForAccount(service, connected.account.id).length, 0);
      } finally {
        closeHostedRuntimeDeviceSyncService(service);
        await cleanup();
      }
    }
  });

  test("terminal hosted snapshot status wins over stale explicit terminal wake reasons", async () => {
    for (const scenario of [
      {
        deadJobCode: "HOSTED_CONTROL_PLANE_DISCONNECTED",
        snapshotStatus: "disconnected",
        wakeReason: "reauthorization_required",
      },
      {
        deadJobCode: "HOSTED_CONTROL_PLANE_REAUTHORIZATION_REQUIRED",
        snapshotStatus: "reauthorization_required",
        wakeReason: "disconnected",
      },
    ] as const) {
      const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
        "hosted-device-sync-runtime-",
      );
      await mkdir(vaultRoot, { recursive: true });

      const service = createDeviceSyncServiceForVault(vaultRoot);

      try {
        const begin = await service.startConnection({
          provider: "demo",
        });
        const connected = await service.handleOAuthCallback({
          code: `terminal-stale-wake-${scenario.snapshotStatus}`,
          provider: "demo",
          state: begin.state,
        });
        const pendingJob = getStore(service).enqueueJob({
          accountId: connected.account.id,
          availableAt: "2026-04-06T09:05:00.000Z",
          dedupeKey: `terminal-stale-wake:${scenario.snapshotStatus}`,
          kind: "resource-sync",
          payload: {},
          priority: 1,
          provider: connected.account.provider,
        });
        const snapshot = buildRuntimeSnapshot({
          connectionId: `hosted_conn_terminal_stale_wake_${scenario.snapshotStatus}`,
          externalAccountId: connected.account.externalAccountId,
          status: scenario.snapshotStatus,
          tokenBundle: scenario.snapshotStatus === "disconnected" ? null : undefined,
        });
        let appliedRequest: ApplyUpdatesRequest | null = null;
        const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
            appliedRequest = input;
            return {
              appliedAt: "2026-04-06T10:10:01.000Z",
              updates: [],
              userId: "member_123",
            };
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return snapshot;
          },
        };

        const state = await syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort,
          wake: buildDeviceSyncWake({
            connectionId: `hosted_conn_terminal_stale_wake_${scenario.snapshotStatus}`,
            eventId: `evt_device_sync_terminal_stale_wake_${scenario.snapshotStatus}`,
            occurredAt: "2026-04-06T09:10:00.000Z",
            reason: scenario.wakeReason,
          }),
          secret: DEVICE_SYNC_SECRET,
          service,
        });

        const stored = getStore(service).getAccountById(connected.account.id);
        assert.ok(stored);
        assert.equal(stored.status, scenario.snapshotStatus);
        const jobs = readJobsForAccount(service, connected.account.id);
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0]?.status, "dead");
        assert.equal(jobs[0]?.lastErrorCode, scenario.deadJobCode);
        assert.equal(getStore(service).getJobById(pendingJob.id)?.status, "dead");

        await reconcileHostedDeviceSyncControlPlaneState({
          deviceSyncPort,
          wake: buildCronWake("2026-04-06T10:10:00.000Z"),
          secret: DEVICE_SYNC_SECRET,
          service,
          state,
        });

        assert.deepEqual(requireApplyUpdatesRequest(appliedRequest).updates, []);
      } finally {
        closeHostedRuntimeDeviceSyncService(service);
        await cleanup();
      }
    }
  });

  test("runtime timer wakes pull pending dirty state without a mailbox wake", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);
    const pendingRequests: Array<{ limit?: number | null }> = [];

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "dirty-pending",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_dirty_pending",
        externalAccountId: connected.account.externalAccountId,
      });
      const dirtyState: HostedExecutionDeviceSyncDirtyStateResponse = {
        connectionId: "hosted_conn_dirty_pending",
        dirtyRevision: "7",
        dirtyResources: [
          {
            count: 3,
            jobKind: "resource",
            resource: "sleep",
            resourceCategory: "summary",
            sourceProviderSlug: "garmin",
            windowEnd: "2026-04-04T00:00:00.000Z",
            windowStart: "2026-04-03T00:00:00.000Z",
          },
        ],
        eventCount: "3",
        latestDirtyAt: "2026-04-04T10:00:00.000Z",
        processedRevision: "0",
        provider: "demo",
        resourceCategoryCounts: {
          summary: 3,
        },
        sourceProviderCounts: {
          garmin: 3,
        },
        userId: "member_123",
        windowEnd: "2026-04-04T00:00:00.000Z",
        windowStart: "2026-04-03T00:00:00.000Z",
      };
      const pendingResponse: HostedExecutionDeviceSyncDirtyPendingResponse = {
        hasMore: true,
        items: [dirtyState],
        nextWakeAt: "2026-04-04T10:00:01.000Z",
        userId: "member_123",
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates(input = {}) {
            pendingRequests.push(input);
            return pendingResponse;
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildCronWake("2026-04-04T10:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.deepEqual(pendingRequests, [
        {
          limit: 10,
        },
      ]);
      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_conn_dirty_pending",
        nextWakeAt: "2026-04-04T10:00:01.000Z",
        processedRevision: "7",
      }]);
      const jobs = readJobsForAccount(service, connected.account.id);
      assert.equal(jobs.length, 1);
      assert.equal(
        jobs[0]?.dedupeKey,
        "hosted-dirty:demo:resource:garmin:summary:sleep:7ae8a0d6ecadc9aa74304031:2026-04-03T00:00:00.000Z:2026-04-04T00:00:00.000Z",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("device-sync dirty legacy non-resource rows do not rehydrate resource payload fields", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "dirty-reconcile",
        provider: "demo",
        state: begin.state,
      });
      const dirtyState = buildDirtyState({
        connectionId: "hosted_conn_dirty_reconcile",
        dirtyRevision: "11",
        dirtyResources: [
          {
            count: 1,
            jobKind: "reconcile",
            resource: "reconcile",
            resourceCategory: "reconcile",
            sourceProviderSlug: null,
            windowEnd: "2026-04-04T00:00:00.000Z",
            windowStart: "2026-04-03T00:00:00.000Z",
          },
        ],
        windowEnd: "2026-04-04T00:00:00.000Z",
        windowStart: "2026-04-03T00:00:00.000Z",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [dirtyState],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_dirty_reconcile",
              externalAccountId: connected.account.externalAccountId,
            });
          },
        },
        wake: buildCronWake("2026-04-04T10:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const jobs = readJobsForAccount(service, connected.account.id);
      assert.equal(jobs.length, 1);
      assert.deepEqual(jobs[0]?.payloadJson ? JSON.parse(jobs[0].payloadJson) : null, {
        windowEnd: "2026-04-04T00:00:00.000Z",
        windowStart: "2026-04-03T00:00:00.000Z",
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("pending dirty state skips unmapped rows and processes the first executable row", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);
    const pendingRequests: Array<{ limit?: number | null }> = [];

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "dirty-supported-after-missing",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_dirty_supported",
        externalAccountId: connected.account.externalAccountId,
      });
      const missingDirtyState = buildDirtyState({
        connectionId: "hosted_conn_dirty_missing",
        dirtyRevision: "8",
      });
      const supportedDirtyState = buildDirtyState({
        connectionId: "hosted_conn_dirty_supported",
        dirtyRevision: "9",
        dirtyResources: [
          {
            count: 2,
            jobKind: "resource",
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
            windowEnd: "2026-04-04T00:00:00.000Z",
            windowStart: "2026-04-03T00:00:00.000Z",
          },
        ],
        eventCount: "2",
        resourceCategoryCounts: {
          timeseries: 2,
        },
        sourceProviderCounts: {
          garmin: 2,
        },
        windowEnd: "2026-04-04T00:00:00.000Z",
        windowStart: "2026-04-03T00:00:00.000Z",
      });

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates(input = {}) {
            pendingRequests.push(input);
            return {
              hasMore: false,
              items: [missingDirtyState, supportedDirtyState],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildCronWake("2026-04-04T10:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.deepEqual(pendingRequests, [
        {
          limit: 10,
        },
      ]);
      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_conn_dirty_supported",
        nextWakeAt: null,
        processedRevision: "9",
      }]);
      assert.equal(readJobsForAccount(service, connected.account.id).length, 1);
      assert.equal(hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls.length, 1);
      assert.equal(
        hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls[0]?.[0].details?.eventCode,
        "dirty_state.connection_missing",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("pending dirty state for an unregistered provider is not enqueued or acknowledged", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_junction_dirty",
        credential: {
          kind: "provider_config",
          credentialMetadata: {},
          providerConfigKey: "junction",
        },
        externalAccountId: "junction-user-123",
        provider: "junction",
      });
      const dirtyState = buildDirtyState({
        connectionId: "hosted_conn_junction_dirty",
        dirtyRevision: "5",
        dirtyResources: [
          {
            count: 1,
            jobKind: "resource",
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
            windowEnd: "2026-04-04T00:00:00.000Z",
            windowStart: "2026-04-03T00:00:00.000Z",
          },
        ],
        provider: "junction",
      });

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [dirtyState],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildCronWake("2026-04-04T10:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountByExternalAccount("junction", "junction-user-123");

      assert.deepEqual(state.pendingDirtyAcks, []);
      assert.ok(stored);
      assert.equal(readJobsForAccount(service, stored.id).length, 0);
      assert.equal(
        hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls[0]?.[0].details?.eventCode,
        "dirty_state.provider_not_registered",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("terminal pending dirty state for an unregistered provider is acknowledged without enqueuing jobs", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_junction_dirty_terminal",
        credential: {
          kind: "provider_config",
          credentialMetadata: {},
          providerConfigKey: "junction",
        },
        externalAccountId: "junction-user-terminal",
        provider: "junction",
        status: "disconnected",
      });
      const dirtyState = buildDirtyState({
        connectionId: "hosted_conn_junction_dirty_terminal",
        dirtyRevision: "15",
        dirtyResources: [
          {
            count: 1,
            jobKind: "resource",
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
            windowEnd: "2026-04-04T00:00:00.000Z",
            windowStart: "2026-04-03T00:00:00.000Z",
          },
        ],
        provider: "junction",
      });

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [dirtyState],
              nextWakeAt: "2026-04-04T10:15:00.000Z",
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildCronWake("2026-04-04T10:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountByExternalAccount(
        "junction",
        "junction-user-terminal",
      );

      assert.ok(stored);
      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_conn_junction_dirty_terminal",
        nextWakeAt: "2026-04-04T10:15:00.000Z",
        processedRevision: "15",
      }]);
      assert.equal(readJobsForAccount(service, stored.id).length, 0);
      assert.equal(
        hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls[0]?.[0].details?.eventCode,
        "dirty_state.disconnected",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("pending dirty state with a provider mismatch is not enqueued or acknowledged", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "dirty-provider-mismatch",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_dirty_provider_mismatch",
        externalAccountId: connected.account.externalAccountId,
        provider: "demo",
      });
      const dirtyState = buildDirtyState({
        connectionId: "hosted_conn_dirty_provider_mismatch",
        dirtyRevision: "11",
        dirtyResources: [
          {
            count: 1,
            jobKind: "resource",
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
            windowEnd: "2026-04-04T00:00:00.000Z",
            windowStart: "2026-04-03T00:00:00.000Z",
          },
        ],
        provider: "junction",
      });

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [dirtyState],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildCronWake("2026-04-04T10:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.deepEqual(state.pendingDirtyAcks, []);
      assert.equal(readJobsForAccount(service, connected.account.id).length, 0);
      assert.equal(
        hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls[0]?.[0].details?.eventCode,
        "dirty_state.provider_mismatch",
      );
      assert.equal(
        hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls[0]?.[0].details?.dirtyProvider,
        "junction",
      );
      assert.equal(
        hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls[0]?.[0].details?.localProvider,
        "demo",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("pending dirty state for reauthorization-required accounts is acknowledged without enqueuing jobs", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "dirty-reauth",
        provider: "demo",
        state: begin.state,
      });
      getStore(service).markSyncFailed(
        connected.account.id,
        "2026-04-04T09:30:00.000Z",
        "PROVIDER_REAUTH_REQUIRED",
        "Provider asked for reconnection.",
        "reauthorization_required",
      );

      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_dirty_reauth",
        externalAccountId: connected.account.externalAccountId,
        status: "reauthorization_required",
      });
      const dirtyState = buildDirtyState({
        connectionId: "hosted_conn_dirty_reauth",
        dirtyRevision: "13",
        dirtyResources: [
          {
            count: 4,
            jobKind: "resource",
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
            windowEnd: "2026-04-04T00:00:00.000Z",
            windowStart: "2026-04-03T00:00:00.000Z",
          },
        ],
        eventCount: "4",
        resourceCategoryCounts: {
          timeseries: 4,
        },
        sourceProviderCounts: {
          garmin: 4,
        },
      });

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [dirtyState],
              nextWakeAt: "2026-04-04T10:15:00.000Z",
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildCronWake("2026-04-04T10:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_conn_dirty_reauth",
        nextWakeAt: "2026-04-04T10:15:00.000Z",
        processedRevision: "13",
      }]);
      assert.equal(readJobsForAccount(service, connected.account.id).length, 0);
      assert.equal(
        hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls[0]?.[0].details?.eventCode,
        "dirty_state.reauthorization_required",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("pending dirty state for disconnected accounts is acknowledged without enqueuing jobs", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "dirty-disconnected",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_dirty_disconnected",
        externalAccountId: connected.account.externalAccountId,
        status: "disconnected",
        tokenBundle: null,
      });
      const dirtyState = buildDirtyState({
        connectionId: "hosted_conn_dirty_disconnected",
        dirtyRevision: "14",
        dirtyResources: [
          {
            count: 4,
            dirtyPayloadId: "dsp_dirty_disconnected",
            jobKind: "resource",
            resource: "steps",
            resourceCategory: "timeseries",
            sourceProviderSlug: "garmin",
            windowEnd: "2026-04-04T00:00:00.000Z",
            windowStart: "2026-04-03T00:00:00.000Z",
          },
        ],
        eventCount: "4",
        resourceCategoryCounts: {
          timeseries: 4,
        },
        sourceProviderCounts: {
          garmin: 4,
        },
      });

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [dirtyState],
              nextWakeAt: "2026-04-04T10:15:00.000Z",
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildCronWake("2026-04-04T10:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.deepEqual(state.pendingDirtyAcks, [{
        connectionId: "hosted_conn_dirty_disconnected",
        nextWakeAt: "2026-04-04T10:15:00.000Z",
        processedDirtyPayloadIds: ["dsp_dirty_disconnected"],
        processedRevision: "14",
      }]);
      assert.equal(readJobsForAccount(service, connected.account.id).length, 0);
      assert.equal(
        hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls[0]?.[0].details?.eventCode,
        "dirty_state.disconnected",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("terminal Junction accounts retain distinct accepted companion RMSSD dirty work", async () => {
    for (const status of ["disconnected", "reauthorization_required"] as const) {
      const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
        "hosted-device-sync-runtime-",
      );
      await mkdir(vaultRoot, { recursive: true });
      const demoProvider = createFakeProvider();
      const junctionProvider: DeviceSyncProvider = {
        ...demoProvider,
        provider: "junction",
        descriptor: {
          ...demoProvider.descriptor,
          provider: "junction",
          displayName: "Junction",
        },
      };
      const service = createDeviceSyncServiceForVault(vaultRoot, [junctionProvider]);

      try {
        const account = getStore(service).upsertAccount({
          connectedAt: "2026-04-04T09:00:00.000Z",
          credential: {
            credentialMetadata: {},
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          displayName: "Junction",
          externalAccountId: `junction-terminal-${status}`,
          provider: "junction",
          scopes: [],
          status,
        });
        const connectionId = `hosted_conn_companion_hrv_${status}`;
        const snapshot = buildRuntimeSnapshot({
          connectionId,
          credential: {
            credentialMetadata: {},
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          externalAccountId: account.externalAccountId,
          provider: "junction",
          status,
          tokenBundle: null,
        });
        const companionObservationJson = serializeCompanionHrvRmssdObservation({
          schema: COMPANION_HRV_RMSSD_SCHEMA,
          methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
          nightDate: "2026-04-04",
          rmssdMs: 48.25,
          completedWindowCount: 84,
          acceptedWindowCount: 56,
        });
        const changedCompanionObservationJson = JSON.stringify({
          ...JSON.parse(companionObservationJson),
          rmssdMs: 49.25,
        });
        const companionAdmissionId = createHash("sha256")
          .update(companionObservationJson)
          .digest("hex");
        const changedCompanionAdmissionId = createHash("sha256")
          .update(changedCompanionObservationJson)
          .digest("hex");
        const dirtyState = buildDirtyState({
          connectionId,
          dirtyRevision: "15",
          dirtyResources: [{
            count: 1,
            dirtyPayloadId: `dsp_companion_hrv_${status}`,
            jobKind: "resource",
            payload: {
              companionAdmissionId,
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
          }, {
            count: 1,
            dirtyPayloadId: `dsp_companion_hrv_changed_${status}`,
            jobKind: "resource",
            payload: {
              companionAdmissionId: changedCompanionAdmissionId,
              companionObservationJson: changedCompanionObservationJson,
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
          provider: "junction",
        });

        const state = await syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort: {
            ...createNoDirtyStateDeviceSyncPortMethods(),
            async applyUpdates() {
              throw new Error("applyUpdates should not be called during sync");
            },
            async createConnectLink() {
              throw new Error("createConnectLink should not be called during sync");
            },
            async fetchDirtyStates() {
              return {
                hasMore: false,
                items: [dirtyState],
                nextWakeAt: null,
                userId: "member_123",
              };
            },
            async fetchSnapshot() {
              return snapshot;
            },
          },
          wake: buildCronWake("2026-04-04T10:00:00.000Z"),
          secret: DEVICE_SYNC_SECRET,
          service,
        });

        assert.deepEqual([...state.pendingDirtyAcks], [{
          connectionId,
          nextWakeAt: null,
          processedRevision: "15",
        }]);
        const jobs = readJobsForAccount(service, account.id);
        assert.equal(jobs.length, 2);
        assert.ok(jobs.every((job) => job.status === "queued"));
        assert.ok(jobs.every((job) => job.dedupeKey?.includes("companion-admission-")));
        assert.deepEqual(
          jobs.map((job) => job.payloadJson ? JSON.parse(job.payloadJson).companionAdmissionId : null)
            .sort(),
          [companionAdmissionId, changedCompanionAdmissionId].sort(),
        );
        assert.equal(await service.drainWorker(1), 1);
        promoteHostedCompletedDirtyPayloadAcks({ service, state });
        assert.equal(state.pendingDirtyAcks[0]?.processedDirtyPayloadIds?.length, 1);
        assert.equal(await service.drainWorker(1), 1);
        promoteHostedCompletedDirtyPayloadAcks({ service, state });
        assert.equal(state.pendingDirtyAcks.length, 1);
        assert.deepEqual(state.pendingDirtyAcks[0]?.connectionId, connectionId);
        assert.deepEqual(state.pendingDirtyAcks[0]?.nextWakeAt, null);
        assert.deepEqual(state.pendingDirtyAcks[0]?.processedRevision, "15");
        assert.deepEqual(
          [...(state.pendingDirtyAcks[0]?.processedDirtyPayloadIds ?? [])].sort(),
          [
            `dsp_companion_hrv_${status}`,
            `dsp_companion_hrv_changed_${status}`,
          ].sort(),
        );
      } finally {
        closeHostedRuntimeDeviceSyncService(service);
        await cleanup();
      }
    }
  });

  test("retained companion RMSSD replay stays ackable after the vault timezone changes", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-companion-timezone-replay-",
    );
    await initializeVault({
      createdAt: "2026-07-10T01:00:00.000Z",
      timezone: "America/New_York",
      vaultRoot,
    });
    const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        fetchImpl: async () => {
          throw new Error("Junction network access is not expected for companion RMSSD replay.");
        },
        region: "us",
        summaryBackfillDays: 2,
        summaryResources: [],
        timeseriesResources: [],
      },
    });
    assert.ok(provider);
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider]);
    const connectionId = "hosted_conn_companion_timezone_replay";
    const dirtyPayloadId = "dsp_companion_timezone_replay";
    const companionObservationJson = serializeCompanionHrvRmssdObservation({
      schema: COMPANION_HRV_RMSSD_SCHEMA,
      methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
      nightDate: "2026-07-10",
      rmssdMs: 48.25,
      completedWindowCount: 84,
      acceptedWindowCount: 56,
    });
    const companionAdmissionId = createHash("sha256")
      .update(companionObservationJson)
      .digest("hex");
    const dirtyState = buildDirtyState({
      connectionId,
      dirtyRevision: "16",
      dirtyResources: [{
        count: 1,
        dirtyPayloadId,
        jobKind: "resource",
        payload: {
          companionAdmissionId,
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
      provider: "junction",
    });
    const snapshot = buildRuntimeSnapshot({
      connectionId,
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      externalAccountId: "junction-companion-timezone-replay",
      provider: "junction",
    });
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...createNoDirtyStateDeviceSyncPortMethods(),
      async applyUpdates() {
        throw new Error("applyUpdates should not be called during companion RMSSD replay.");
      },
      async createConnectLink() {
        throw new Error("createConnectLink should not be called during companion RMSSD replay.");
      },
      async fetchDirtyStates() {
        return {
          hasMore: false,
          items: [dirtyState],
          nextWakeAt: null,
          userId: "member_123",
        };
      },
      async fetchSnapshot() {
        return snapshot;
      },
    };

    try {
      const firstState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-07-10T02:31:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      assert.equal(await service.drainWorker(1), 1);
      assert.equal(firstState.pendingDirtyAcks[0]?.processedDirtyPayloadIds, undefined);

      await updateVaultSummary({ vaultRoot, timezone: "UTC" });

      const replayState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-07-10T03:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      assert.equal(await service.drainWorker(1), 1);
      promoteHostedCompletedDirtyPayloadAcks({ service, state: replayState });

      assert.deepEqual(replayState.pendingDirtyAcks, [{
        connectionId,
        nextWakeAt: null,
        processedDirtyPayloadIds: [dirtyPayloadId],
        processedRevision: "16",
      }]);
      const localAccountId = replayState.hostedToLocalAccountIds.get(connectionId);
      assert.ok(localAccountId);
      assert.equal(
        readJobsForAccount(service, localAccountId)
          .filter((job) => job.status === "succeeded")
          .length,
        2,
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("terminal hydration precedes a newer reconnect and keeps both hosted epochs distinct", async () => {
    for (const activeFirst of [true, false]) {
      const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
        "hosted-device-sync-runtime-reconnect-order-",
      );
      await mkdir(vaultRoot, { recursive: true });
      const demoProvider = createFakeProvider();
      const junctionProvider: DeviceSyncProvider = {
        ...demoProvider,
        provider: "junction",
        descriptor: {
          ...demoProvider.descriptor,
          provider: "junction",
          displayName: "Junction",
        },
      };
      const service = createDeviceSyncServiceForVault(vaultRoot, [junctionProvider]);

      try {
        const externalAccountId = `junction-reconnect-${activeFirst ? "active-first" : "terminal-first"}`;
        const original = getStore(service).upsertAccount({
          connectedAt: "2026-07-13T01:00:00.000Z",
          credential: {
            credentialMetadata: {},
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          displayName: "Original Junction",
          externalAccountId,
          provider: "junction",
          scopes: [],
          status: "active",
        });
        const originalConnectionId = `hosted-reconnect-a-${activeFirst}`;
        const reconnectedConnectionId = `hosted-reconnect-b-${activeFirst}`;
        const originalActiveSnapshot = buildRuntimeSnapshot({
          connectedAt: "2026-07-13T01:00:00.000Z",
          connectionId: originalConnectionId,
          credential: {
            credentialMetadata: {},
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          displayName: "Original Junction",
          externalAccountId,
          hostedUpdatedAt: "2026-07-13T01:01:00.000Z",
          provider: "junction",
          status: "active",
          tokenBundle: null,
        });
        await syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort: createSnapshotOnlyDeviceSyncPort(originalActiveSnapshot),
          wake: buildCronWake("2026-07-13T01:01:30.000Z"),
          secret: DEVICE_SYNC_SECRET,
          service,
        });
        const providerJob = getStore(service).enqueueJob({
          accountId: original.id,
          availableAt: "2026-07-13T01:02:00.000Z",
          kind: "resource-sync",
          payload: {},
          provider: "junction",
        });
        const activeReconnectSnapshot = buildRuntimeSnapshot({
          connectedAt: "2026-07-13T02:00:00.000Z",
          connectionId: reconnectedConnectionId,
          credential: {
            credentialMetadata: {},
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          displayName: "Reconnected Junction",
          externalAccountId,
          hostedUpdatedAt: "2026-07-13T02:01:00.000Z",
          provider: "junction",
          status: "active",
          tokenBundle: null,
        });
        const terminalOriginalSnapshot = buildRuntimeSnapshot({
          connectedAt: "2026-07-13T01:00:00.000Z",
          connectionId: originalConnectionId,
          credential: {
            credentialMetadata: {},
            kind: "none",
          },
          displayName: "Disconnected Junction",
          externalAccountId: `opaque:${originalConnectionId}`,
          hostedUpdatedAt: "2026-07-13T01:30:00.000Z",
          provider: "junction",
          status: "disconnected",
          tokenBundle: null,
        });
        const snapshot = {
          ...activeReconnectSnapshot,
          connections: activeFirst
            ? [
                ...activeReconnectSnapshot.connections,
                ...terminalOriginalSnapshot.connections,
              ]
            : [
                ...terminalOriginalSnapshot.connections,
                ...activeReconnectSnapshot.connections,
              ],
        };

        const state = await syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort: createSnapshotOnlyDeviceSyncPort(snapshot),
          wake: buildCronWake("2026-07-13T02:02:00.000Z"),
          secret: DEVICE_SYNC_SECRET,
          service,
        });

        const terminalAccount = getStore(service).getAccountByHostedConnectionId(
          originalConnectionId,
        );
        const activeAccount = getStore(service).getAccountByHostedConnectionId(
          reconnectedConnectionId,
        );
        assert.ok(terminalAccount);
        assert.ok(activeAccount);
        assert.notEqual(activeAccount.id, terminalAccount.id);
        assert.equal(terminalAccount.id, original.id);
        assert.equal(terminalAccount.status, "disconnected");
        assert.equal(terminalAccount.externalAccountId, `opaque:${originalConnectionId}`);
        assert.equal(activeAccount.status, "active");
        assert.equal(activeAccount.externalAccountId, externalAccountId);
        assert.equal(activeAccount.connectedAt, "2026-07-13T02:00:00.000Z");
        assert.equal(state.hostedToLocalAccountIds.get(originalConnectionId), terminalAccount.id);
        assert.equal(state.hostedToLocalAccountIds.get(reconnectedConnectionId), activeAccount.id);
        assert.equal(state.localToHostedAccountIds.get(terminalAccount.id), originalConnectionId);
        assert.equal(state.localToHostedAccountIds.get(activeAccount.id), reconnectedConnectionId);
        assert.equal(getStore(service).getJobById(providerJob.id)?.status, "dead");
      } finally {
        closeHostedRuntimeDeviceSyncService(service);
        await cleanup();
      }
    }
  });

  test("a reconnect without its predecessor terminal snapshot cannot adopt a bound account", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-reconnect-collision-",
    );
    await mkdir(vaultRoot, { recursive: true });
    const demoProvider = createFakeProvider();
    const junctionProvider: DeviceSyncProvider = {
      ...demoProvider,
      provider: "junction",
      descriptor: {
        ...demoProvider.descriptor,
        provider: "junction",
        displayName: "Junction",
      },
    };
    const service = createDeviceSyncServiceForVault(vaultRoot, [junctionProvider]);

    try {
      const externalAccountId = "junction-reconnect-without-terminal";
      const original = getStore(service).upsertAccount({
        connectedAt: "2026-07-13T01:00:00.000Z",
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        displayName: "Original Junction",
        externalAccountId,
        provider: "junction",
        scopes: [],
        status: "active",
      });
      const originalConnectionId = "hosted-reconnect-without-terminal-a";
      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(buildRuntimeSnapshot({
          connectedAt: "2026-07-13T01:00:00.000Z",
          connectionId: originalConnectionId,
          credential: {
            credentialMetadata: {},
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          displayName: "Original Junction",
          externalAccountId,
          hostedUpdatedAt: "2026-07-13T01:01:00.000Z",
          provider: "junction",
          status: "active",
          tokenBundle: null,
        })),
        wake: buildCronWake("2026-07-13T01:01:30.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      await assert.rejects(
        () => syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort: createSnapshotOnlyDeviceSyncPort(buildRuntimeSnapshot({
            connectedAt: "2026-07-13T02:00:00.000Z",
            connectionId: "hosted-reconnect-without-terminal-b",
            credential: {
              credentialMetadata: {},
              kind: "provider_config",
              providerConfigKey: "junction",
            },
            displayName: "Wrong reconnect",
            externalAccountId,
            hostedUpdatedAt: "2026-07-13T02:01:00.000Z",
            provider: "junction",
            status: "active",
            tokenBundle: null,
          })),
          wake: buildCronWake("2026-07-13T02:02:00.000Z"),
          secret: DEVICE_SYNC_SECRET,
          service,
        }),
        /bound to another hosted connection/u,
      );

      const preserved = getStore(service).getAccountById(original.id);
      assert.ok(preserved);
      assert.equal(preserved.displayName, "Original Junction");
      assert.equal(preserved.connectedAt, "2026-07-13T01:00:00.000Z");
      assert.equal(preserved.externalAccountId, externalAccountId);
      assert.equal(preserved.status, "active");
      assert.equal(
        getStore(service).getAccountByHostedConnectionId(originalConnectionId)?.id,
        original.id,
      );
      assert.equal(
        getStore(service).getAccountByHostedConnectionId("hosted-reconnect-without-terminal-b"),
        null,
      );
      assert.equal(getStore(service).listAccounts().length, 1);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("an active binding of the original legacy account still consolidates the terminal identity fork", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });
    const demoProvider = createFakeProvider();
    const junctionProvider: DeviceSyncProvider = {
      ...demoProvider,
      provider: "junction",
      descriptor: {
        ...demoProvider.descriptor,
        provider: "junction",
        displayName: "Junction",
      },
    };
    const service = createDeviceSyncServiceForVault(vaultRoot, [junctionProvider]);

    try {
      const account = getStore(service).upsertAccount({
        connectedAt: "2026-07-13T01:00:00.000Z",
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        displayName: "Junction",
        externalAccountId: "junction-account-before-terminal-scrub",
        provider: "junction",
        scopes: [],
        status: "active",
      });
      const connectionId = "hosted-connection-terminal-scrub";
      const fork = getStore(service).upsertAccount({
        connectedAt: "2026-07-13T01:00:00.000Z",
        credential: {
          credentialMetadata: {},
          kind: "none",
        },
        displayName: "Junction",
        externalAccountId: `opaque:${connectionId}`,
        provider: "junction",
        scopes: [],
        status: "disconnected",
      });
      const activeSnapshot = buildRuntimeSnapshot({
        connectedAt: "2026-07-13T01:00:00.000Z",
        connectionId,
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId: account.externalAccountId,
        hostedUpdatedAt: "2026-07-13T01:02:00.000Z",
        provider: "junction",
        status: "active",
        tokenBundle: null,
      });
      const activeState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(activeSnapshot),
        wake: buildCronWake("2026-07-13T01:02:30.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      assert.equal(activeState.hostedToLocalAccountIds.get(connectionId), account.id);
      const providerJob = getStore(service).enqueueJob({
        accountId: fork.id,
        availableAt: "2026-07-13T01:02:00.000Z",
        dedupeKey: "terminal-scrub-provider-work",
        kind: "resource-sync",
        payload: {},
        priority: 1,
        provider: "junction",
      });
      const companionObservationJson = serializeCompanionHrvRmssdObservation({
        schema: COMPANION_HRV_RMSSD_SCHEMA,
        methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
        nightDate: "2026-07-13",
        rmssdMs: 47.5,
        completedWindowCount: 84,
        acceptedWindowCount: 56,
      });
      const companionJob = getStore(service).enqueueJob({
        accountId: account.id,
        availableAt: "2026-07-13T01:02:00.000Z",
        kind: "resource",
        payload: {
          companionAdmissionId: createHash("sha256")
            .update(companionObservationJson)
            .digest("hex"),
          companionObservationJson,
          resource: COMPANION_HRV_RMSSD_RESOURCE,
          resourceCategory: "derived",
          sourceProviderSlug: "whoop",
        },
        provider: "junction",
      });
      const terminalSnapshot = buildRuntimeSnapshot({
        connectedAt: "2026-07-13T01:00:00.000Z",
        connectionId,
        credential: {
          credentialMetadata: {},
          kind: "none",
        },
        externalAccountId: `opaque:${connectionId}`,
        hostedUpdatedAt: "2026-07-13T01:03:00.000Z",
        provider: "junction",
        status: "disconnected",
        tokenBundle: null,
      });
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(terminalSnapshot),
        wake: buildCronWake("2026-07-13T01:03:30.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const accounts = getStore(service).listAccounts();
      assert.equal(accounts.length, 1);
      assert.equal(accounts[0]?.id, account.id);
      assert.equal(accounts[0]?.externalAccountId, `opaque:${connectionId}`);
      assert.equal(accounts[0]?.status, "disconnected");
      assert.equal(getStore(service).getAccountById(fork.id), null);
      assert.equal(state.hostedToLocalAccountIds.get(connectionId), account.id);
      const jobs = readJobsForAccount(service, account.id);
      assert.equal(getStore(service).getJobById(providerJob.id)?.accountId, account.id);
      assert.equal(getStore(service).getJobById(providerJob.id)?.status, "dead");
      assert.equal(getStore(service).getJobById(companionJob.id)?.accountId, account.id);
      const companionJobs = jobs.filter((job) => {
        const payload = job.payloadJson ? JSON.parse(job.payloadJson) : null;
        return payload?.companionObservationJson === companionObservationJson;
      });
      assert.equal(companionJobs.length, 1);
      assert.equal(companionJobs[0]?.status, "queued");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("same-connection device-sync wake hints enqueue both distinct jobs", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "double-wake",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_double_wake",
        externalAccountId: connected.account.externalAccountId,
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(snapshot),
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_double_wake",
          eventId: "evt_device_sync_wake_first",
          hint: {
            jobs: [
              {
                availableAt: "2026-04-04T10:05:00.000Z",
                dedupeKey: "wake:resource-sync",
                kind: "resource-sync",
              },
            ],
          },
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "webhook_hint",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(snapshot),
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_double_wake",
          eventId: "evt_device_sync_wake_second",
          hint: {
            jobs: [
              {
                availableAt: "2026-04-04T10:06:00.000Z",
                dedupeKey: "wake:sleep-sync",
                kind: "sleep-sync",
              },
            ],
          },
          occurredAt: "2026-04-04T10:00:01.000Z",
          reason: "webhook_hint",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const jobs = readJobsForAccount(service, connected.account.id);
      assert.equal(jobs.length, 2);
      assert.deepEqual(
        jobs
          .map((job) => ({
            availableAt: job.availableAt,
            dedupeKey: job.dedupeKey,
            kind: job.kind,
            status: job.status,
          }))
          .sort((left, right) => String(left.dedupeKey).localeCompare(String(right.dedupeKey))),
        [
          {
            availableAt: "2026-04-04T10:05:00.000Z",
            dedupeKey: "wake:resource-sync",
            kind: "resource-sync",
            status: "queued",
          },
          {
            availableAt: "2026-04-04T10:06:00.000Z",
            dedupeKey: "wake:sleep-sync",
            kind: "sleep-sync",
            status: "queued",
          },
        ],
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("epoch-bound device-sync wake hints still drain while the runtime checks dirty state", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);
    let dirtyPendingFetches = 0;

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "legacy-dirty-pending",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_legacy_wake",
        externalAccountId: connected.account.externalAccountId,
      });

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          ...createSnapshotOnlyDeviceSyncPort(snapshot),
          async fetchDirtyStates() {
            dirtyPendingFetches += 1;
            return {
              hasMore: false,
              items: [],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
        },
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_legacy_wake",
          eventId: "evt_device_sync_legacy_wake",
          hint: {
            jobs: [
              {
                availableAt: "2026-04-04T10:05:00.000Z",
                dedupeKey: "wake:legacy-resource-sync",
                kind: "resource-sync",
              },
            ],
          },
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "webhook_hint",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(dirtyPendingFetches, 1);
      assert.deepEqual(state.pendingDirtyAcks, []);
      const jobs = readJobsForAccount(service, connected.account.id);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]?.dedupeKey, "wake:legacy-resource-sync");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("device-sync wake hints do not patch next reconcile when the hint is unchanged", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "same-next-reconcile",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_same_next_reconcile",
        externalAccountId: connected.account.externalAccountId,
        localState: {
          nextReconcileAt: "2026-04-04T12:00:00.000Z",
        },
      });

      await syncHostedDeviceSyncControlPlaneState({
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_same_next_reconcile",
          hint: {
            nextReconcileAt: "2026-04-04T12:00:00.000Z",
          },
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "webhook_hint",
        }),
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(snapshot),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.nextReconcileAt, "2026-04-04T12:00:00.000Z");
      assert.deepEqual(readJobsForAccount(service, connected.account.id), []);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("manual reconcile wakes delegate job creation to the device-sync service", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });
    const demoProvider = createFakeProvider();
    const junctionProvider: DeviceSyncProvider = {
      ...demoProvider,
      provider: "junction",
      descriptor: {
        ...demoProvider.descriptor,
        provider: "junction",
        displayName: "Junction",
      },
    };
    const service = createDeviceSyncServiceForVault(vaultRoot, [junctionProvider]);

    try {
      const account = getStore(service).upsertAccount({
        connectedAt: "2026-04-04T09:00:00.000Z",
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        displayName: "Junction",
        externalAccountId: "manual-reconcile",
        provider: "junction",
        scopes: [],
        status: "active",
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_manual_reconcile",
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId: account.externalAccountId,
        localState: {
          lastErrorCode: "DEVICE_DATA_MEMBER_EDIT_CONFLICT",
          lastErrorMessage: "A member-owned correction conflicts with connected data.",
          lastSyncErrorAt: "2026-04-04T09:30:00.000Z",
          nextReconcileAt: "2026-04-04T12:00:00.000Z",
        },
        provider: "junction",
        tokenBundle: null,
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(snapshot),
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_manual_reconcile",
          hint: {
            memberEditConflictResolution: "keep_member",
            reason: "manual_reconcile",
          },
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "reconcile_due",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const jobs = readJobsForAccount(service, account.id);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]?.kind, "reconcile");
      assert.equal(jobs[0]?.priority, 80);
      assert.equal(
        JSON.parse(jobs[0]?.payloadJson ?? "{}").memberEditConflictResolution,
        "keep_member",
      );
      assert.equal(jobs[0]?.status, "queued");
      assert.equal(
        getStore(service).getAccountById(account.id)?.nextReconcileAt,
        "2026-04-04T12:00:00.000Z",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("preserves a Junction inline carrier across hydration without loading importers at boot", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-junction-inline-reconnect-",
    );
    await initializeVault({
      createdAt: "2026-07-27T03:00:00.000Z",
      timezone: "UTC",
      vaultRoot,
    });
    const [junctionProvider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_inline_authority",
        clientUserIdSecret: "junction-inline-authority-secret",
        environment: "sandbox",
        fetchImpl: async () => {
          throw new Error("Junction network access is not expected during hydration.");
        },
        region: "us",
        summaryResources: ["sleep"],
        timeseriesResources: [],
      },
    });
    assert.ok(junctionProvider);
    const service = createDeviceSyncServiceForVault(vaultRoot, [junctionProvider]);

    try {
      const connectionId = "hosted_conn_junction_inline_reconnect";
      const externalAccountId = "junction-inline-reconnect";
      let snapshot = buildRuntimeSnapshot({
        connectedAt: "2026-07-27T03:00:00.000Z",
        connectionId,
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId,
        provider: "junction",
      });
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates() {
          throw new Error("applyUpdates should not be called during hydration.");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during hydration.");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };
      const epochAState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-07-27T03:01:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = epochAState.hostedToLocalAccountIds.get(connectionId);
      assert.ok(localAccountId);
      const inlineCarrier = getStore(service).enqueueJob({
        accountId: localAccountId,
        availableAt: "2026-07-27T03:01:00.000Z",
        kind: "resource",
        payload: {
          resource: "meal",
          resourceCategory: "summary",
          sourceProviderSlug: "garmin",
          webhookDataJson: JSON.stringify({
            calories: 640,
            id: "meal-inline-hydration",
            sourceProviderSlug: "garmin",
          }),
        },
        provider: "junction",
      });
      const credentialScoped = getStore(service).enqueueJob({
        accountId: localAccountId,
        availableAt: "2026-07-27T03:01:00.000Z",
        kind: "resource",
        payload: {
          resource: "meal",
          resourceCategory: "summary",
        },
        provider: "junction",
      });

      snapshot = buildRuntimeSnapshot({
        connectedAt: "2026-07-27T04:00:00.000Z",
        connectionId,
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId,
        hostedUpdatedAt: "2026-07-27T04:01:00.000Z",
        provider: "junction",
      });
      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-07-27T04:02:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(getStore(service).getJobById(inlineCarrier.id)?.status, "queued");
      assert.equal(
        getStore(service).getJobById(credentialScoped.id)?.lastErrorCode,
        "HOSTED_CONNECTION_EPOCH_REPLACED",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("executes an accepted Oura tombstone exactly once across a same-account reconnect", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-tombstone-reconnect-",
    );
    await initializeVault({
      createdAt: "2026-07-27T04:00:00.000Z",
      timezone: "UTC",
      vaultRoot,
    });
    const baseProvider = createFakeProvider();
    const importedJobIds: string[] = [];
    const ouraProvider: DeviceSyncProvider = {
      ...baseProvider,
      provider: "oura",
      descriptor: {
        ...baseProvider.descriptor,
        displayName: "Oura",
        provider: "oura",
      },
      jobExecutor: {
        async executeJob(context, job) {
          assert.equal(job.kind, "delete");
          assert.equal(context.account.provider, "oura");
          importedJobIds.push(job.id);
          return {};
        },
      },
    };
    const service = createDeviceSyncServiceForVault(vaultRoot, [ouraProvider]);

    try {
      const begin = await service.startConnection({ provider: "oura" });
      const connected = await service.handleOAuthCallback({
        code: "tombstone-reconnect",
        provider: "oura",
        state: begin.state,
      });
      const connectionId = "hosted_conn_tombstone_reconnect";
      const dirtyPayloadId = "dsp_tombstone_reconnect";
      const dirtyState = buildDirtyState({
        connectionId,
        dirtyRevision: "11",
        dirtyResources: [{
          count: 1,
          dirtyPayloadId,
          jobKind: "delete",
          payload: {
            dataType: "session",
            objectId: "deleted-session",
            occurredAt: "2026-07-27T04:01:00.000Z",
            sourceEventType: "session.deleted",
          },
          resource: null,
          resourceCategory: "session",
          sourceProviderSlug: null,
          windowEnd: null,
          windowStart: null,
        }],
        provider: "oura",
      });
      let snapshot = buildRuntimeSnapshot({
        connectedAt: connected.account.connectedAt,
        connectionId,
        externalAccountId: connected.account.externalAccountId,
        provider: "oura",
      });
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates() {
          throw new Error("applyUpdates should not be called during tombstone replay.");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during tombstone replay.");
        },
        async fetchDirtyStates() {
          return {
            hasMore: false,
            items: [dirtyState],
            nextWakeAt: null,
            userId: "member_123",
          };
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const epochAState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-07-27T04:02:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = epochAState.hostedToLocalAccountIds.get(connectionId);
      assert.ok(localAccountId);
      const [epochADelete] = readJobsForAccount(service, localAccountId);
      assert.ok(epochADelete);
      const epochACredentialJob = getStore(service).enqueueJob({
        accountId: localAccountId,
        availableAt: "2026-07-27T04:02:00.000Z",
        kind: "resource",
        payload: { objectId: "credential-scoped-resource" },
        provider: "oura",
      });

      snapshot = buildRuntimeSnapshot({
        connectedAt: "2026-07-27T05:00:00.000Z",
        connectionId,
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-07-27T05:01:00.000Z",
        provider: "oura",
        tokenBundle: {
          accessToken: "epoch-b-access-token",
          accessTokenExpiresAt: "2026-07-28T05:00:00.000Z",
          refreshToken: "epoch-b-refresh-token",
          tokenVersion: 2,
        },
      });
      const epochBState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-07-27T05:02:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(getStore(service).getJobById(epochADelete.id)?.status, "queued");
      assert.equal(
        getStore(service).getJobById(epochACredentialJob.id)?.lastErrorCode,
        "HOSTED_CONNECTION_EPOCH_REPLACED",
      );
      assert.equal(readJobsForAccount(service, localAccountId).filter((job) =>
        job.kind === "delete"
      ).length, 1);

      assert.equal(await service.drainWorker(2), 1);
      promoteHostedCompletedDirtyPayloadAcks({
        service,
        state: epochBState,
      });
      assert.deepEqual(importedJobIds, [epochADelete.id]);
      assert.deepEqual(epochBState.pendingDirtyAcks, [{
        connectionId,
        nextWakeAt: null,
        processedDirtyPayloadIds: [dirtyPayloadId],
        processedRevision: "11",
      }]);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("supersedes an old disconnect wake and all credential-scoped work after hydrating a replacement connection epoch", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({ provider: "demo" });
      const connected = await service.handleOAuthCallback({
        code: "disconnect-wake-replacement",
        provider: "demo",
        state: begin.state,
      });
      const store = getStore(service);
      const runningJob = store.enqueueJob({
        accountId: connected.account.id,
        availableAt: "2026-04-06T09:00:00.000Z",
        kind: "initial",
        payload: { source: "epoch-a-running" },
        priority: 100,
        provider: connected.account.provider,
      });
      assert.equal(
        store.claimDueJob("epoch-a-worker", "2026-04-06T09:01:00.000Z", 60_000)?.id,
        runningJob.id,
      );
      const retryableJob = store.enqueueJob({
        accountId: connected.account.id,
        availableAt: "2026-04-06T09:02:00.000Z",
        kind: "backfill",
        maxAttempts: 3,
        payload: { source: "epoch-a-retry" },
        priority: 90,
        provider: connected.account.provider,
      });
      store.failJob(
        retryableJob.id,
        "2026-04-06T09:02:01.000Z",
        "PROVIDER_RETRY",
        "Provider asked the worker to retry.",
        "2026-04-06T12:30:00.000Z",
        true,
      );
      const pendingJobs = [
        "deauthorization",
        "delete",
        "resource",
        "reconcile",
      ].map((kind, index) =>
        store.enqueueJob({
          accountId: connected.account.id,
          availableAt: `2026-04-06T1${index + 2}:00:00.000Z`,
          kind,
          payload: { source: `epoch-a-${kind}` },
          priority: index,
          provider: connected.account.provider,
        })
      );
      const snapshot = buildRuntimeSnapshot({
        connectedAt: "2026-04-06T10:00:00.000Z",
        connectionId: "hosted_conn_disconnect_wake_replacement",
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-04-06T10:05:00.000Z",
        localState: {
          nextReconcileAt: "2026-04-06T12:00:00.000Z",
        },
        status: "active",
        tokenBundle: {
          accessToken: "replacement-access-token",
          accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
          refreshToken: "replacement-refresh-token",
          tokenVersion: 9,
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      let dirtyFetchCalls = 0;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        async ackDirtyStateProcessed() {
          throw new Error("ackDirtyStateProcessed should not be called for a superseded wake");
        },
        async applyUpdates(input) {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T10:11:00.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync");
        },
        async fetchDirtyStates() {
          dirtyFetchCalls += 1;
          return {
            hasMore: false,
            items: [],
            nextWakeAt: null,
            userId: "member_123",
          };
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_disconnect_wake_replacement",
          expectedConnectedAt: "2026-04-06T09:00:00.000Z",
          occurredAt: "2026-04-06T10:10:00.000Z",
          reason: "disconnected",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(state.wakeSuperseded, true);
      assert.equal(dirtyFetchCalls, 0);
      const stored = getStore(service).getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.connectedAt, "2026-04-06T10:00:00.000Z");
      assert.equal(stored.status, "active");
      assert.equal(stored.hostedObservedTokenVersion, 9);
      const storedCredential = requireStoredOAuthCredential(stored);
      const codec = createSecretCodec(DEVICE_SYNC_SECRET);
      assert.equal(
        codec.decrypt(
          storedCredential.accessTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-access-token",
          }),
        ),
        "replacement-access-token",
      );
      assert.ok(storedCredential.refreshTokenEncrypted);
      assert.equal(
        codec.decrypt(
          storedCredential.refreshTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-refresh-token",
          }),
        ),
        "replacement-refresh-token",
      );
      for (const job of [runningJob, retryableJob, ...pendingJobs]) {
        const supersededJob = store.getJobById(job.id);
        assert.equal(supersededJob?.status, "dead");
        assert.equal(
          supersededJob?.lastErrorCode,
          "HOSTED_CONNECTION_EPOCH_REPLACED",
        );
      }

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_disconnect_wake_replacement",
          expectedConnectedAt: "2026-04-06T09:00:00.000Z",
          occurredAt: "2026-04-06T10:11:00.000Z",
          reason: "disconnected",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest).updates, []);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("consumes a legacy connection-scoped wake without applying its hint and retires pre-replacement work", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({ provider: "demo" });
      const connected = await service.handleOAuthCallback({
        code: "legacy-disconnect-wake",
        provider: "demo",
        state: begin.state,
      });
      const pendingJob = getStore(service).enqueueJob({
        accountId: connected.account.id,
        availableAt: "2026-04-06T12:00:00.000Z",
        kind: "legacy-wake-preserved-job",
        payload: {},
        priority: 1,
        provider: connected.account.provider,
      });
      let dirtyFetchCalls = 0;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates() {
          throw new Error("applyUpdates should not be called during sync");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync");
        },
        async fetchDirtyStates() {
          dirtyFetchCalls += 1;
          return {
            hasMore: false,
            items: [],
            nextWakeAt: null,
            userId: "member_123",
          };
        },
        async fetchSnapshot() {
          return buildRuntimeSnapshot({
            connectionId: "hosted_conn_legacy_disconnect_wake",
            externalAccountId: connected.account.externalAccountId,
            status: "active",
          });
        },
      };

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_legacy_disconnect_wake",
          expectedConnectedAt: null,
          occurredAt: "2026-04-06T10:10:00.000Z",
          reason: "disconnected",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(dirtyFetchCalls, 0);
      assert.equal(getStore(service).getAccountById(connected.account.id)?.status, "active");
      const supersededJob = getStore(service).getJobById(pendingJob.id);
      assert.equal(supersededJob?.status, "dead");
      assert.equal(
        supersededJob?.lastErrorCode,
        "HOSTED_CONNECTION_EPOCH_REPLACED",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("matching-epoch disconnected wakes disconnect the mapped account and kill queued jobs after snapshot hydration", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "disconnect-wake",
        provider: "demo",
        state: begin.state,
      });
      const pendingJob = getStore(service).enqueueJob({
        accountId: connected.account.id,
        availableAt: "2026-04-06T09:05:00.000Z",
        kind: "manual-backfill",
        payload: {
          source: "local",
        },
        priority: 1,
        provider: connected.account.provider,
      });
      let fetchSnapshotCalls = 0;
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_disconnect_wake",
        externalAccountId: connected.account.externalAccountId,
        status: "active",
      });
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates() {
          throw new Error("applyUpdates should not be called during sync");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync");
        },
        async fetchSnapshot() {
          fetchSnapshotCalls += 1;
          return snapshot;
        },
      };

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_disconnect_wake",
          expectedConnectedAt: "2026-04-04T09:00:00.000Z",
          occurredAt: "2026-04-06T09:10:00.000Z",
          reason: "disconnected",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(fetchSnapshotCalls, 1);
      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.status, "disconnected");
      assertStoredCredentialKind(stored, "none");

      const deadJob = getStore(service).getJobById(pendingJob.id);
      assert.equal(deadJob?.status, "dead");
      assert.equal(deadJob?.lastErrorCode, "HOSTED_CONNECTION_EPOCH_REPLACED");
      assert.equal(
        deadJob?.lastErrorMessage,
        "Device-sync work belonged to a replaced hosted connection epoch.",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("device-sync reauthorization wakes mark the mapped account without enqueuing jobs", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "reauthorize",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_reauth",
        externalAccountId: connected.account.externalAccountId,
        localState: {
          nextReconcileAt: "2026-04-06T10:00:00.000Z",
        },
      });
      getStore(service).enqueueJob({
        accountId: connected.account.id,
        availableAt: "2026-04-06T09:09:00.000Z",
        kind: "pending-before-reauth",
        payload: {},
        provider: "demo",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(snapshot),
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_reauth",
          occurredAt: "2026-04-06T09:10:00.000Z",
          reason: "reauthorization_required",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.status, "reauthorization_required");
      assert.equal(stored?.nextReconcileAt, null);
      assert.deepEqual(readJobsForAccount(service, connected.account.id).map((job) => ({
        code: job.lastErrorCode,
        status: job.status,
      })), [{
        code: "HOSTED_CONNECTION_EPOCH_REPLACED",
        status: "dead",
      }]);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("snapshot hydration dead-letters pending jobs for reauthorization-required accounts", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "reauthorize",
        provider: "demo",
        state: begin.state,
      });
      getStore(service).enqueueJob({
        accountId: connected.account.id,
        availableAt: "2026-04-06T09:09:00.000Z",
        kind: "pending-before-hydration-reauth",
        payload: {},
        provider: "demo",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(buildRuntimeSnapshot({
          connectionId: "hosted_conn_reauth_snapshot",
          externalAccountId: connected.account.externalAccountId,
          localState: {
            nextReconcileAt: "2026-04-06T10:00:00.000Z",
          },
          status: "reauthorization_required",
        })),
        wake: buildCronWake("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.status, "reauthorization_required");
      assert.equal(stored?.nextReconcileAt, null);
      assert.deepEqual(readJobsForAccount(service, connected.account.id).map((job) => ({
        code: job.lastErrorCode,
        status: job.status,
      })), [{
        code: "HOSTED_CONTROL_PLANE_REAUTHORIZATION_REQUIRED",
        status: "dead",
      }]);

      const stalePendingJob = getStore(service).enqueueJob({
        accountId: connected.account.id,
        availableAt: "2026-04-06T09:11:00.000Z",
        kind: "stale-pending-after-hydration-reauth",
        payload: {},
        provider: "demo",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(buildRuntimeSnapshot({
          connectionId: "hosted_conn_reauth_snapshot",
          externalAccountId: connected.account.externalAccountId,
          localState: {
            nextReconcileAt: "2026-04-06T10:00:00.000Z",
          },
          status: "reauthorization_required",
        })),
        wake: buildCronWake("2026-04-06T09:12:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const staleDeadJob = getStore(service).getJobById(stalePendingJob.id);
      assert.equal(staleDeadJob?.status, "dead");
      assert.equal(
        staleDeadJob?.lastErrorCode,
        "HOSTED_CONTROL_PLANE_REAUTHORIZATION_REQUIRED",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync keeps a newer local error when the hosted snapshot only clears stale state without a newer completion", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "local-error",
        provider: "demo",
        state: begin.state,
      });
      getStore(service).markSyncFailed(
        connected.account.id,
        "2026-04-06T09:09:00.000Z",
        "LOCAL_ERR",
        "local error still newer",
        "active",
      );
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_local_error",
        externalAccountId: connected.account.externalAccountId,
        localState: {
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-04-06T09:08:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-04-06T09:07:00.000Z",
          lastWebhookAt: "2026-04-06T09:06:00.000Z",
          nextReconcileAt: "2026-04-06T10:00:00.000Z",
        },
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildCronWake("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.lastErrorCode, "LOCAL_ERR");
      assert.equal(stored?.lastErrorMessage, "local error still newer");
      assert.equal(stored?.lastSyncErrorAt, "2026-04-06T09:09:00.000Z");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("device-sync wake hints forward a later next reconcile to the mapped account", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "forward-next-reconcile",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_forward_next_reconcile",
        externalAccountId: connected.account.externalAccountId,
        localState: {
          nextReconcileAt: "2026-04-04T12:00:00.000Z",
        },
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(snapshot),
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_forward_next_reconcile",
          hint: {
            nextReconcileAt: "2026-04-04T13:00:00.000Z",
          },
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "webhook_hint",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-04T13:00:00.000Z");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("device-sync wakes without a hint leave the mapped account unchanged", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "wake-without-hint",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_no_hint",
        externalAccountId: connected.account.externalAccountId,
        localState: {
          nextReconcileAt: "2026-04-04T12:00:00.000Z",
        },
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: createSnapshotOnlyDeviceSyncPort(snapshot),
        wake: buildDeviceSyncWake({
          connectionId: "hosted_conn_no_hint",
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "webhook_hint",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-04T12:00:00.000Z");
      assert.deepEqual(readJobsForAccount(service, connected.account.id), []);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync clears a local error when the hosted snapshot shows a newer successful completion", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "clear-local-error",
        provider: "demo",
        state: begin.state,
      });
      getStore(service).markSyncFailed(
        connected.account.id,
        "2026-04-06T09:09:00.000Z",
        "LOCAL_ERR",
        "local error should clear",
        "active",
      );

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_clear_local_error",
              externalAccountId: connected.account.externalAccountId,
              localState: {
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: "2026-04-06T09:10:00.000Z",
                lastSyncErrorAt: null,
                lastSyncStartedAt: "2026-04-06T09:07:00.000Z",
                lastWebhookAt: "2026-04-06T09:06:00.000Z",
                nextReconcileAt: "2026-04-06T10:00:00.000Z",
              },
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:11:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.lastErrorCode, null);
      assert.equal(stored?.lastErrorMessage, null);
      assert.equal(stored?.lastSyncErrorAt, null);
      assert.equal(stored?.lastSyncCompletedAt, "2026-04-06T09:10:00.000Z");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync keeps the latest next reconcile when hosted state has not advanced", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "stale-hosted-state",
        provider: "demo",
        state: begin.state,
      });
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_stale_state",
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:05:00.000Z",
        localState: {
          nextReconcileAt: "2026-04-06T10:00:00.000Z",
        },
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return snapshot;
          },
        },
        wake: buildCronWake("2026-04-06T09:06:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      getStore(service).patchAccount(connected.account.id, {
        nextReconcileAt: "2026-04-06T10:30:00.000Z",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_stale_state",
              externalAccountId: connected.account.externalAccountId,
              hostedUpdatedAt: "2026-04-06T09:05:00.000Z",
              localState: {
                nextReconcileAt: "2026-04-06T11:00:00.000Z",
              },
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:07:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-06T11:00:00.000Z");
      assert.equal(stored?.hostedObservedUpdatedAt, "2026-04-06T09:05:00.000Z");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync ignores stale hosted disconnect replays while keeping newer local tokens and connection state", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "stale-hosted-disconnect",
        provider: "demo",
        state: begin.state,
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_stale_disconnect",
              displayName: "Hosted Fresh",
              externalAccountId: connected.account.externalAccountId,
              hostedUpdatedAt: "2026-04-06T09:10:00.000Z",
              localState: {
                nextReconcileAt: "2026-04-06T10:00:00.000Z",
              },
              metadata: {
                hosted: true,
              },
              tokenBundle: {
                accessToken: "hosted-access-v5",
                accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
                refreshToken: "hosted-refresh-v5",
                tokenVersion: 5,
              },
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:11:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const hydrated = getStore(service).getAccountById(connected.account.id);
      assert.ok(hydrated);

      const codec = createSecretCodec(DEVICE_SYNC_SECRET);
      const locallyRefreshed = getStore(service).updateAccountTokens(
        hydrated.id,
        {
          accessToken: "local-access-refresh",
          accessTokenEncrypted: codec.encrypt(
            "local-access-refresh",
            buildDeviceSyncTokenCipherOptions({
              externalAccountId: hydrated.externalAccountId,
              provider: hydrated.provider,
              purpose: "device-sync-access-token",
            }),
          ),
          accessTokenExpiresAt: "2026-04-07T01:00:00.000Z",
          refreshToken: "local-refresh-refresh",
          refreshTokenEncrypted: codec.encrypt(
            "local-refresh-refresh",
            buildDeviceSyncTokenCipherOptions({
              externalAccountId: hydrated.externalAccountId,
              provider: hydrated.provider,
              purpose: "device-sync-refresh-token",
            }),
          ),
        },
        hydrated.disconnectGeneration,
      );

      assert.ok(locallyRefreshed);

      getStore(service).patchAccount(connected.account.id, {
        displayName: "Local Fresh",
        metadata: {
          local: true,
        },
        nextReconcileAt: "2026-04-06T10:30:00.000Z",
        scopes: ["offline", "read:data", "manual"],
        status: "reauthorization_required",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_stale_disconnect",
              displayName: "Hosted Stale Disconnect",
              externalAccountId: connected.account.externalAccountId,
              hostedUpdatedAt: "2026-04-06T09:05:00.000Z",
              localState: {
                nextReconcileAt: "2026-04-06T11:00:00.000Z",
              },
              metadata: {
                stale: true,
              },
              status: "disconnected",
              tokenBundle: null,
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:12:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.status, "reauthorization_required");
      assert.equal(stored.displayName, "Local Fresh");
      assert.deepEqual(stored.metadata, {
        hosted: true,
        local: true,
      });
      assert.deepEqual(stored.scopes, ["offline", "read:data", "manual"]);
      assert.equal(stored.nextReconcileAt, null);
      assert.equal(stored.hostedObservedUpdatedAt, "2026-04-06T09:10:00.000Z");
      assert.equal(stored.hostedObservedTokenVersion, 5);
      const storedCredential = requireStoredOAuthCredential(stored);
      assert.equal(
        codec.decrypt(
          storedCredential.accessTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-access-token",
          }),
        ),
        "local-access-refresh",
      );
      assert.ok(storedCredential.refreshTokenEncrypted);
      assert.equal(
        codec.decrypt(
          storedCredential.refreshTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-refresh-token",
          }),
        ),
        "local-refresh-refresh",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync ignores same-snapshot hosted disconnect replays after newer local token and connection writes even when local timestamps skew older", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "same-snapshot-hosted-disconnect",
        provider: "demo",
        state: begin.state,
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_same_snapshot_disconnect",
              displayName: "Hosted Fresh",
              externalAccountId: connected.account.externalAccountId,
              hostedUpdatedAt: "2026-04-06T09:10:00.000Z",
              localState: {
                nextReconcileAt: "2026-04-06T10:00:00.000Z",
              },
              metadata: {
                hosted: true,
              },
              tokenBundle: {
                accessToken: "hosted-access-v5",
                accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
                refreshToken: "hosted-refresh-v5",
                tokenVersion: 5,
              },
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:11:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const hydrated = getStore(service).getAccountById(connected.account.id);
      assert.ok(hydrated);

      const codec = createSecretCodec(DEVICE_SYNC_SECRET);
      const locallyRefreshed = getStore(service).updateAccountTokens(
        hydrated.id,
        {
          accessToken: "local-access-refresh",
          accessTokenEncrypted: codec.encrypt(
            "local-access-refresh",
            buildDeviceSyncTokenCipherOptions({
              externalAccountId: hydrated.externalAccountId,
              provider: hydrated.provider,
              purpose: "device-sync-access-token",
            }),
          ),
          accessTokenExpiresAt: "2026-04-07T01:00:00.000Z",
          refreshToken: "local-refresh-refresh",
          refreshTokenEncrypted: codec.encrypt(
            "local-refresh-refresh",
            buildDeviceSyncTokenCipherOptions({
              externalAccountId: hydrated.externalAccountId,
              provider: hydrated.provider,
              purpose: "device-sync-refresh-token",
            }),
          ),
        },
        hydrated.disconnectGeneration,
      );

      assert.ok(locallyRefreshed);

      getStore(service).patchAccount(connected.account.id, {
        displayName: "Local Fresh",
        metadata: {
          local: true,
        },
        nextReconcileAt: "2026-04-06T10:30:00.000Z",
        scopes: ["offline", "read:data", "manual"],
        status: "reauthorization_required",
      });

      setAccountUpdatedAtForTesting(service, connected.account.id, "2026-04-06T08:00:00.000Z");

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_same_snapshot_disconnect",
              displayName: "Hosted Replayed Disconnect",
              externalAccountId: connected.account.externalAccountId,
              hostedUpdatedAt: "2026-04-06T09:10:00.000Z",
              localState: {
                lastErrorCode: "REPLAY_IGNORED",
                lastErrorMessage: "same hosted snapshot",
                lastSyncCompletedAt: "2026-04-06T09:45:00.000Z",
                lastSyncErrorAt: "2026-04-06T09:40:00.000Z",
                lastSyncStartedAt: "2026-04-06T09:35:00.000Z",
                lastWebhookAt: "2026-04-06T09:30:00.000Z",
                nextReconcileAt: "2026-04-06T11:00:00.000Z",
              },
              metadata: {
                replay: true,
              },
              status: "disconnected",
              tokenBundle: null,
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:12:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.status, "reauthorization_required");
      assert.equal(stored.displayName, "Local Fresh");
      assert.deepEqual(stored.metadata, {
        hosted: true,
        local: true,
      });
      assert.deepEqual(stored.scopes, ["offline", "read:data", "manual"]);
      assert.equal(stored.nextReconcileAt, null);
      assert.equal(stored.hostedObservedUpdatedAt, "2026-04-06T09:10:00.000Z");
      assert.equal(stored.hostedObservedTokenVersion, 5);
      assert.equal(stored.lastErrorCode, "REPLAY_IGNORED");
      const storedCredential = requireStoredOAuthCredential(stored);
      assert.equal(
        codec.decrypt(
          storedCredential.accessTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-access-token",
          }),
        ),
        "local-access-refresh",
      );
      assert.ok(storedCredential.refreshTokenEncrypted);
      assert.equal(
        codec.decrypt(
          storedCredential.refreshTokenEncrypted,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: stored.externalAccountId,
            provider: stored.provider,
            purpose: "device-sync-refresh-token",
          }),
        ),
        "local-refresh-refresh",
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("same-wake reconcile uses the accepted baseline after a same-snapshot replay is fenced", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "same-wake-replay-baseline",
        provider: "demo",
        state: begin.state,
      });

      let currentSnapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_same_wake_replay",
        displayName: "Hosted Fresh",
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:10:00.000Z",
        tokenBundle: {
          accessToken: "hosted-access-v5",
          accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
          refreshToken: "hosted-refresh-v5",
          tokenVersion: 5,
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T09:13:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during sync or reconciliation");
        },
        async fetchSnapshot() {
          return currentSnapshot;
        },
      };

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:11:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const hydrated = getStore(service).getAccountById(connected.account.id);
      assert.ok(hydrated);

      const codec = createSecretCodec(DEVICE_SYNC_SECRET);
      const locallyRefreshed = getStore(service).updateAccountTokens(
        hydrated.id,
        {
          accessToken: "local-access-refresh",
          accessTokenEncrypted: codec.encrypt(
            "local-access-refresh",
            buildDeviceSyncTokenCipherOptions({
              externalAccountId: hydrated.externalAccountId,
              provider: hydrated.provider,
              purpose: "device-sync-access-token",
            }),
          ),
          accessTokenExpiresAt: "2026-04-07T01:00:00.000Z",
          refreshToken: "local-refresh-refresh",
          refreshTokenEncrypted: codec.encrypt(
            "local-refresh-refresh",
            buildDeviceSyncTokenCipherOptions({
              externalAccountId: hydrated.externalAccountId,
              provider: hydrated.provider,
              purpose: "device-sync-refresh-token",
            }),
          ),
        },
        hydrated.disconnectGeneration,
      );

      assert.ok(locallyRefreshed);

      getStore(service).patchAccount(connected.account.id, {
        displayName: "Local Fresh",
        metadata: {
          local: true,
        },
        nextReconcileAt: "2026-04-06T10:30:00.000Z",
        scopes: ["offline", "read:data", "manual"],
        status: "reauthorization_required",
      });

      currentSnapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_same_wake_replay",
        displayName: "Hosted Replayed Disconnect",
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: "2026-04-06T09:10:00.000Z",
        localState: {
          lastErrorCode: "REPLAY_IGNORED",
          lastErrorMessage: "same hosted snapshot",
          lastSyncCompletedAt: "2026-04-06T09:12:00.000Z",
          lastSyncErrorAt: "2026-04-06T09:11:30.000Z",
          lastSyncStartedAt: "2026-04-06T09:11:15.000Z",
          lastWebhookAt: "2026-04-06T09:11:05.000Z",
          nextReconcileAt: "2026-04-06T11:00:00.000Z",
        },
        metadata: {
          replay: true,
        },
        status: "disconnected",
        tokenBundle: null,
      });

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:12:30.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:13:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest), {
        occurredAt: "2026-04-06T09:13:00.000Z",
        updates: [{
          connectionId: "hosted_conn_same_wake_replay",
          localState: {
            nextReconcileAt: null,
          },
          observedConnectedAt: "2026-04-04T09:00:00.000Z",
          observedUpdatedAt: "2026-04-06T09:10:00.000Z",
        }],
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync keeps the local next reconcile when the hosted snapshot omits it without advancing state", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "keep-local-next-reconcile",
        provider: "demo",
        state: begin.state,
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_keep_local_next",
              externalAccountId: connected.account.externalAccountId,
              hostedUpdatedAt: "2026-04-06T09:05:00.000Z",
              localState: {
                nextReconcileAt: "2026-04-06T10:00:00.000Z",
              },
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:06:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      getStore(service).patchAccount(connected.account.id, {
        nextReconcileAt: "2026-04-06T10:30:00.000Z",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_keep_local_next",
              externalAccountId: connected.account.externalAccountId,
              hostedUpdatedAt: "2026-04-06T09:05:00.000Z",
              localState: {
                nextReconcileAt: null,
              },
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:07:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-06T10:30:00.000Z");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync prefers a valid hosted next reconcile over an invalid local timestamp", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "invalid-local-next-reconcile",
        provider: "demo",
        state: begin.state,
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_invalid_local_next",
              externalAccountId: connected.account.externalAccountId,
              hostedUpdatedAt: "2026-04-06T09:05:00.000Z",
              localState: {
                nextReconcileAt: "2026-04-06T10:00:00.000Z",
              },
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:06:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      getStore(service).patchAccount(connected.account.id, {
        nextReconcileAt: "not-a-timestamp",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_invalid_local_next",
              externalAccountId: connected.account.externalAccountId,
              hostedUpdatedAt: "2026-04-06T09:05:00.000Z",
              localState: {
                nextReconcileAt: "2026-04-06T11:00:00.000Z",
              },
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:07:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-06T11:00:00.000Z");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync keeps a valid local next reconcile when the hosted timestamp is invalid", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "invalid-hosted-next-reconcile",
        provider: "demo",
        state: begin.state,
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_invalid_hosted_next",
              externalAccountId: connected.account.externalAccountId,
              hostedUpdatedAt: "2026-04-06T09:05:00.000Z",
              localState: {
                nextReconcileAt: "2026-04-06T10:00:00.000Z",
              },
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:06:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      getStore(service).patchAccount(connected.account.id, {
        nextReconcileAt: "2026-04-06T10:30:00.000Z",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            throw new Error("applyUpdates should not be called during sync");
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during sync");
          },
          async fetchSnapshot() {
            return buildRuntimeSnapshot({
              connectionId: "hosted_conn_invalid_hosted_next",
              externalAccountId: connected.account.externalAccountId,
              hostedUpdatedAt: "2026-04-06T09:05:00.000Z",
              localState: {
                nextReconcileAt: "still-not-a-timestamp",
              },
            });
          },
        },
        wake: buildCronWake("2026-04-06T09:07:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-06T10:30:00.000Z");
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation sends local token rotation, cleared errors, and newer timestamps back to hosted control plane", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_reconcile",
        externalAccountId: "demo-reconcile",
        hostedUpdatedAt: "2026-04-02T12:30:00.000Z",
        localState: {
          lastErrorCode: "HOSTED_ERR",
          lastErrorMessage: "stale hosted error",
          lastSyncCompletedAt: "2026-04-02T11:00:00.000Z",
          lastSyncErrorAt: "2026-04-02T12:00:00.000Z",
          lastSyncStartedAt: "2026-04-02T11:55:00.000Z",
          lastWebhookAt: "2026-04-02T11:50:00.000Z",
          nextReconcileAt: "2026-04-02T13:00:00.000Z",
        },
        metadata: {
          source: "hosted",
        },
        tokenBundle: {
          accessToken: "hosted-access",
          accessTokenExpiresAt: "2026-04-03T00:00:00.000Z",
          refreshToken: "hosted-refresh",
          tokenVersion: 7,
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-02T13:10:01.000Z",
            updates: input.updates.map((update) => ({
              connection: null,
              connectionId: update.connectionId,
              status: "updated",
              tokenUpdate: "applied",
              writeUpdate: "applied",
            })),
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-02T12:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_reconcile");
      assert.ok(localAccountId);

      getStore(service).patchAccount(localAccountId, {
        clearErrors: true,
        displayName: "Local Demo",
        metadata: {
          local: "delta",
        },
        scopes: ["offline", "heartrate"],
      });
      getStore(service).markWebhookReceived(localAccountId, "2026-04-02T13:05:00.000Z");
      getStore(service).markSyncStarted(localAccountId, "2026-04-02T13:06:00.000Z");

      const codec = createSecretCodec(DEVICE_SYNC_SECRET);
      const storedLocalAccount = getStore(service).getAccountById(localAccountId);
      assert.ok(storedLocalAccount);
      const updated = getStore(service).updateAccountTokens(localAccountId, {
        accessToken: "local-access",
        accessTokenEncrypted: codec.encrypt(
          "local-access",
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: storedLocalAccount.externalAccountId,
            provider: storedLocalAccount.provider,
            purpose: "device-sync-access-token",
          }),
        ),
        accessTokenExpiresAt: "2026-04-04T00:00:00.000Z",
        refreshToken: "local-refresh",
        refreshTokenEncrypted: codec.encrypt(
          "local-refresh",
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: storedLocalAccount.externalAccountId,
            provider: storedLocalAccount.provider,
            purpose: "device-sync-refresh-token",
          }),
        ),
      });
      assert.ok(updated);

      assert.equal(
        getStore(service).markSyncSucceeded(
          localAccountId,
          "2026-04-02T13:07:00.000Z",
          null,
          {
            nextReconcileAt: "2026-04-02T14:00:00.000Z",
          },
        ),
        true,
      );

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-02T13:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      const request = requireApplyUpdatesRequest(appliedRequest);
      assert.equal(request.occurredAt, "2026-04-02T13:10:00.000Z");
      assert.equal(request.updates.length, 1);
      assert.deepEqual(request.updates[0], {
        connection: {
          displayName: "Local Demo",
          metadata: {
            local: "delta",
            source: "hosted",
          },
          scopes: ["offline", "heartrate"],
        },
        connectionId: "hosted_conn_reconcile",
        localState: {
          clearError: true,
          lastSyncCompletedAt: "2026-04-02T13:07:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-04-02T13:06:00.000Z",
          lastWebhookAt: "2026-04-02T13:05:00.000Z",
          nextReconcileAt: "2026-04-02T14:00:00.000Z",
        },
        observedTokenVersion: 7,
        observedConnectedAt: "2026-04-04T09:00:00.000Z",
        observedUpdatedAt: "2026-04-02T12:30:00.000Z",
        credential: {
          kind: "oauth_tokens",
          tokenBundle: {
            accessToken: "local-access",
            accessTokenExpiresAt: "2026-04-04T00:00:00.000Z",
            keyVersion: "local-runtime",
            refreshToken: "local-refresh",
            tokenVersion: 7,
          },
        },
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation publishes earlier empty-backfill retry wakes before hosted hydration and scheduling", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const executedAt = "2026-04-04T00:00:00.000Z";
    const retryDueAt = "2026-04-04T00:15:00.000Z";
    const laterBaselineAt = "2026-04-04T01:00:00.000Z";
    const connectionId = "hosted_conn_empty_backfill_retry";
    const initialHostedUpdatedAt = "2026-04-04T00:00:10.000Z";
    const appliedHostedUpdatedAt = "2026-04-04T00:00:30.000Z";
    const backfillPayload = {
      windowEnd: "2026-04-03",
      windowStart: "2026-04-01",
    };
    const scheduledInputs: Array<{ nextReconcileAt: string | null; now: string }> = [];
    const workerExecutions: Array<{ kind: string; now: string }> = [];
    const provider = createFakeProvider({
      jobExecutor: {
        createScheduledJobs(account, now) {
          scheduledInputs.push({
            nextReconcileAt: account.nextReconcileAt,
            now,
          });
          return {
            jobs: [
              {
                availableAt: now,
                dedupeKey: "empty-backfill-retry",
                kind: "backfill",
                payload: backfillPayload,
                priority: 30,
              },
            ],
            nextReconcileAt: laterBaselineAt,
          };
        },
        async executeJob(context, job) {
          workerExecutions.push({
            kind: job.kind,
            now: context.now,
          });
          return {
            metadataPatch: {
              emptyBackfillLastEmptyAt: context.now,
              emptyBackfillStatus: "retrying",
            },
            nextReconcileAt: retryDueAt,
          };
        },
      },
    });
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider]);
    let fakeTimersEnabled = false;

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "empty-backfill-retry",
        provider: "demo",
        state: begin.state,
      });
      let hostedSnapshot = buildRuntimeSnapshot({
        connectionId,
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: initialHostedUpdatedAt,
        localState: {
          nextReconcileAt: laterBaselineAt,
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          const currentUpdatedAt = hostedSnapshot.connections[0]?.connection.updatedAt ?? null;

          return {
            appliedAt: "2026-04-04T00:00:20.000Z",
            updates: input.updates.map((update) => {
              const writeUpdate = update.observedUpdatedAt === currentUpdatedAt
                ? "applied"
                : "skipped_version_mismatch";

              if (writeUpdate === "applied" && update.connectionId === connectionId) {
                const nextReconcileAt = update.localState
                  && Object.prototype.hasOwnProperty.call(update.localState, "nextReconcileAt")
                  ? update.localState.nextReconcileAt ?? null
                  : hostedSnapshot.connections[0]?.localState.nextReconcileAt ?? null;

                hostedSnapshot = buildRuntimeSnapshot({
                  connectionId,
                  externalAccountId: connected.account.externalAccountId,
                  hostedUpdatedAt: appliedHostedUpdatedAt,
                  localState: {
                    nextReconcileAt,
                  },
                });
              }

              return {
                connection: null,
                connectionId: update.connectionId,
                status: "updated",
                tokenUpdate: "unchanged",
                writeUpdate,
              };
            }),
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return hostedSnapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake(executedAt),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get(connectionId);
      assert.ok(localAccountId);
      assert.equal(getStore(service).getAccountById(localAccountId)?.nextReconcileAt, laterBaselineAt);

      getStore(service).enqueueJob({
        accountId: localAccountId,
        availableAt: executedAt,
        dedupeKey: "empty-backfill-initial",
        kind: "backfill",
        payload: backfillPayload,
        priority: 30,
        provider: "demo",
      });

      vi.useFakeTimers();
      fakeTimersEnabled = true;
      vi.setSystemTime(new Date(executedAt));

      const processed = await service.runWorkerOnce();
      assert.equal(processed?.kind, "backfill");
      assert.deepEqual(workerExecutions, [
        {
          kind: "backfill",
          now: executedAt,
        },
      ]);
      assert.equal(getStore(service).getAccountById(localAccountId)?.nextReconcileAt, retryDueAt);

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T00:00:20.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      const request = requireApplyUpdatesRequest(appliedRequest);
      assert.equal(request.updates.length, 1);
      assert.equal(request.updates[0]?.observedUpdatedAt, initialHostedUpdatedAt);
      assert.equal(request.updates[0]?.localState?.nextReconcileAt, retryDueAt);
      assert.equal(hostedSnapshot.connections[0]?.localState.nextReconcileAt, retryDueAt);

      getStore(service).patchAccount(localAccountId, {
        nextReconcileAt: laterBaselineAt,
      });
      vi.setSystemTime(new Date(retryDueAt));

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake(retryDueAt),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(getStore(service).getAccountById(localAccountId)?.nextReconcileAt, retryDueAt);

      await service.runSchedulerOnce();

      assert.deepEqual(scheduledInputs, [
        {
          nextReconcileAt: retryDueAt,
          now: retryDueAt,
        },
      ]);
      assert.equal(getStore(service).getAccountById(localAccountId)?.nextReconcileAt, laterBaselineAt);

      const queuedRetryJobs = readJobsForAccount(service, localAccountId).filter(
        (job) => job.status === "queued" && job.dedupeKey === "empty-backfill-retry",
      );
      assert.equal(queuedRetryJobs.length, 1);
      assert.equal(queuedRetryJobs[0]?.availableAt, retryDueAt);
    } finally {
      if (fakeTimersEnabled) {
        vi.useRealTimers();
      }

      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync preserves unpublished Junction retry progress after hosted version mismatch", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const executedAt = "2026-04-04T00:00:00.000Z";
    const retryDueAt = "2026-04-04T00:15:00.000Z";
    const laterBaselineAt = "2026-04-04T01:00:00.000Z";
    const connectionId = "hosted_conn_empty_backfill_retry_race";
    const externalAccountId = "junction-empty-backfill-retry-race";
    const initialHostedUpdatedAt = "2026-04-04T00:00:10.000Z";
    const concurrentHostedUpdatedAt = "2026-04-04T00:00:25.000Z";
    const backfillPayload = {
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-01T00:00:00.000Z",
    };
    const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        region: "us",
        summaryBackfillDays: 2,
        summaryResources: ["activity"],
        timeseriesResources: [],
        fetchImpl: async (input) => {
          const url = readTestUrl(input);

          if (url === `https://api.sandbox.us.junction.com/v2/user/providers/${externalAccountId}`) {
            return createTestJsonResponse({
              providers: [
                {
                  id: "provider-garmin-1",
                  slug: "garmin",
                  name: "Garmin",
                  status: "connected",
                  resource_availability: {
                    activity: true,
                  },
                },
              ],
            });
          }

          if (url.includes("/v2/summary/") && url.includes(`/${externalAccountId}`)) {
            return createTestJsonResponse({ data: [] });
          }

          if (new URL(url).pathname === "/v2/introspect/historical_pull") {
            return createTestJsonResponse({ data: [] });
          }

          throw new Error(`Unexpected Junction request: ${url}`);
        },
      },
    });
    assert.ok(provider);
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider]);
    let fakeTimersEnabled = false;

    try {
      let hostedSnapshot = buildRuntimeSnapshot({
        connectedAt: "2026-04-03T00:00:00.000Z",
        connectionId,
        credential: {
          kind: "provider_config",
          credentialMetadata: {},
          providerConfigKey: "junction",
        },
        externalAccountId,
        hostedUpdatedAt: initialHostedUpdatedAt,
        localState: {
          nextReconcileAt: laterBaselineAt,
        },
        provider: "junction",
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          const currentUpdatedAt = hostedSnapshot.connections[0]?.connection.updatedAt ?? null;

          return {
            appliedAt: "2026-04-04T00:00:30.000Z",
            updates: input.updates.map((update) => {
              const writeUpdate = update.observedUpdatedAt === currentUpdatedAt
                ? "applied"
                : "skipped_version_mismatch";

              if (writeUpdate === "applied") {
                const hostedEntry = hostedSnapshot.connections.find(
                  (entry) => entry.connection.id === update.connectionId,
                );

                if (hostedEntry) {
                  if (update.connection?.metadata) {
                    hostedEntry.connection.metadata = { ...update.connection.metadata };
                  }

                  if (update.localState && "nextReconcileAt" in update.localState) {
                    hostedEntry.localState.nextReconcileAt = update.localState.nextReconcileAt ?? null;
                  }

                  hostedEntry.connection.updatedAt = "2026-04-04T00:00:35.000Z";
                }
              }

              return {
                connection: null,
                connectionId: update.connectionId,
                status: "updated",
                tokenUpdate: "unchanged",
                writeUpdate,
              };
            }),
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return hostedSnapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake(executedAt),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get(connectionId);
      assert.ok(localAccountId);

      getStore(service).enqueueJob({
        accountId: localAccountId,
        availableAt: executedAt,
        dedupeKey: "empty-backfill-race-initial",
        kind: "backfill",
        payload: backfillPayload,
        priority: 30,
        provider: "junction",
      });

      vi.useFakeTimers();
      fakeTimersEnabled = true;
      vi.setSystemTime(new Date(executedAt));

      const processed = await service.runWorkerOnce();
      assert.equal(processed?.kind, "backfill");
      const afterEmptyBackfill = getStore(service).getAccountById(localAccountId);
      assert.equal(afterEmptyBackfill?.nextReconcileAt, retryDueAt);
      const retryJobsAfterEmptyBackfill = readJobsForAccount(service, localAccountId).filter(
        (job) => job.status === "queued" && job.kind === "backfill",
      );
      assert.equal(retryJobsAfterEmptyBackfill.length, 0);
      assert.deepEqual(
        {
          junctionHistoricalBackfillEmptyAttempts:
            afterEmptyBackfill?.metadata.junctionHistoricalBackfillEmptyAttempts,
          junctionHistoricalBackfillLastEmptyAt:
            afterEmptyBackfill?.metadata.junctionHistoricalBackfillLastEmptyAt,
          junctionHistoricalBackfillStatus:
            afterEmptyBackfill?.metadata.junctionHistoricalBackfillStatus,
          junctionHistoricalBackfillWindowEnd:
            afterEmptyBackfill?.metadata.junctionHistoricalBackfillWindowEnd,
          junctionHistoricalBackfillWindowStart:
            afterEmptyBackfill?.metadata.junctionHistoricalBackfillWindowStart,
        },
        {
          junctionHistoricalBackfillEmptyAttempts: 1,
          junctionHistoricalBackfillLastEmptyAt: executedAt,
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        },
      );

      hostedSnapshot = buildRuntimeSnapshot({
        connectedAt: "2026-04-03T00:00:00.000Z",
        connectionId,
        credential: {
          kind: "provider_config",
          credentialMetadata: {},
          providerConfigKey: "junction",
        },
        externalAccountId,
        hostedUpdatedAt: concurrentHostedUpdatedAt,
        localState: {
          nextReconcileAt: laterBaselineAt,
        },
        metadata: {
          hosted: true,
        },
        provider: "junction",
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T00:00:30.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      const request = requireApplyUpdatesRequest(appliedRequest);
      assert.equal(request.updates.length, 1);
      assert.equal(request.updates[0]?.observedUpdatedAt, initialHostedUpdatedAt);
      assert.equal(request.updates[0]?.localState?.nextReconcileAt, retryDueAt);
      assert.deepEqual(request.updates[0]?.connection?.metadata, {
        hosted: true,
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: executedAt,
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      });

      vi.setSystemTime(new Date(retryDueAt));
      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake(retryDueAt),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const afterConcurrentHydration = getStore(service).getAccountById(localAccountId);
      assert.equal(afterConcurrentHydration?.nextReconcileAt, retryDueAt);
      assert.deepEqual(afterConcurrentHydration?.metadata, {
        hosted: true,
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: executedAt,
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      });
      assert.notEqual(
        afterConcurrentHydration?.localConnectionRevision,
        afterConcurrentHydration?.hostedObservedConnectionRevision,
      );

      await service.runSchedulerOnce();
      const queuedRetryJobs = readJobsForAccount(service, localAccountId)
        .filter((job) => job.status === "queued" && job.kind === "backfill");
      assert.equal(queuedRetryJobs.length, 1);
      assert.equal(queuedRetryJobs[0]?.availableAt, retryDueAt);
      assert.equal(queuedRetryJobs[0]?.priority, 50);
      assert.deepEqual(JSON.parse(queuedRetryJobs[0]?.payloadJson ?? "{}"), backfillPayload);
    } finally {
      if (fakeTimersEnabled) {
        vi.useRealTimers();
      }

      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync starts fresh Junction history recovery for a same-day reconnect epoch", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const connectionId = "hosted_conn_same_day_reconnect";
    const externalAccountId = "junction-same-day-reconnect";
    const originalConnectedAt = "2026-04-03T08:00:00.000Z";
    const reconnectedAt = "2026-04-03T08:05:00.000Z";
    const originalWindowStart = "2026-04-01T00:00:00.000Z";
    const originalWindowEnd = "2026-04-03T00:00:00.000Z";
    const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        fetchImpl: async () => {
          throw new Error("Junction network access is not expected during hydration or scheduling.");
        },
        region: "us",
        summaryBackfillDays: 2,
        summaryResources: ["activity"],
        timeseriesResources: [],
      },
    });
    assert.ok(provider);
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider]);

    try {
      let hostedSnapshot = buildRuntimeSnapshot({
        connectedAt: originalConnectedAt,
        connectionId,
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId,
        hostedUpdatedAt: "2026-04-04T00:00:10.000Z",
        localState: {
          nextReconcileAt: "2026-04-04T02:00:00.000Z",
        },
        metadata: {},
        provider: "junction",
      });
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates() {
          throw new Error("applyUpdates should not be called during hydration.");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during hydration.");
        },
        async fetchSnapshot() {
          return hostedSnapshot;
        },
      };

      const initialState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T00:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = initialState.hostedToLocalAccountIds.get(connectionId);
      assert.ok(localAccountId);

      getStore(service).patchAccount(localAccountId, {
        metadata: {
          junctionHistoricalBackfillEmptyAttempts: 5,
          junctionHistoricalBackfillEvidence:
            `e2|${originalWindowStart}|${originalWindowEnd}|garmin:1`,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
          junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
          junctionHistoricalBackfillWindowEnd: originalWindowEnd,
          junctionHistoricalBackfillWindowStart: originalWindowStart,
        },
        nextReconcileAt: "2026-04-04T03:00:00.000Z",
      });
      const unpublishedAccount = getStore(service).getAccountById(localAccountId);
      assert.notEqual(
        unpublishedAccount?.localConnectionRevision,
        unpublishedAccount?.hostedObservedConnectionRevision,
      );

      hostedSnapshot = buildRuntimeSnapshot({
        connectedAt: reconnectedAt,
        connectionId,
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId,
        hostedUpdatedAt: "2026-04-04T00:00:40.000Z",
        localState: {
          nextReconcileAt: "2026-04-04T01:00:00.000Z",
        },
        metadata: {
          hostedConnectionEpoch: "fresh",
        },
        provider: "junction",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T01:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const reconnectedAccount = getStore(service).getAccountById(localAccountId);
      assert.equal(reconnectedAccount?.connectedAt, reconnectedAt);
      assert.deepEqual(reconnectedAccount?.metadata, {
        hostedConnectionEpoch: "fresh",
      });

      await service.runSchedulerOnce();
      const backfillJobs = readJobsForAccount(service, localAccountId).filter(
        (job) => job.kind === "backfill" && job.status === "queued",
      );
      assert.equal(backfillJobs.length, 1);
      assert.deepEqual(JSON.parse(backfillJobs[0]?.payloadJson ?? "{}"), {
        windowEnd: originalWindowEnd,
        windowStart: originalWindowStart,
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync preserves unpublished retry metadata alongside capped hosted metadata", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const connectionId = "hosted_conn_full_metadata_backfill_race";
    const initialHostedUpdatedAt = "2026-04-04T00:00:10.000Z";
    const fullHostedUpdatedAt = "2026-04-04T00:00:40.000Z";
    const retryDueAt = "2026-04-04T00:15:00.000Z";
    const hostedMetadata = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [`hostedKey${index}`, `hosted-value-${index}`]),
    );
    const localRetryMetadata = {
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillStatus: "coverage_v2_retrying",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    };
    const expectedCappedHostedMetadata = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [`hostedKey${index}`, `hosted-value-${index}`]),
    );
    const expectedMergedMetadata = {
      ...localRetryMetadata,
      ...expectedCappedHostedMetadata,
    };
    const provider = createFakeProvider();
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider]);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "full-metadata-backfill-race",
        provider: "demo",
        state: begin.state,
      });
      let hostedSnapshot = buildRuntimeSnapshot({
        connectionId,
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: initialHostedUpdatedAt,
      });
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          return {
            appliedAt: "2026-04-04T00:01:00.000Z",
            updates: input.updates.map((update) => ({
              connection: null,
              connectionId: update.connectionId,
              status: "updated",
              tokenUpdate: "unchanged",
              writeUpdate: "applied",
            })),
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return hostedSnapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T00:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get(connectionId);
      assert.ok(localAccountId);

      getStore(service).patchAccount(localAccountId, {
        metadata: localRetryMetadata,
        nextReconcileAt: retryDueAt,
      });

      hostedSnapshot = buildRuntimeSnapshot({
        connectionId,
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: fullHostedUpdatedAt,
        localState: {
          nextReconcileAt: "2026-04-04T01:00:00.000Z",
        },
        metadata: hostedMetadata,
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake(retryDueAt),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const hydratedAccount = getStore(service).getAccountById(localAccountId);
      assert.ok(hydratedAccount);
      const hydratedMetadata = hydratedAccount.metadata;
      assert.deepEqual(hydratedMetadata, expectedMergedMetadata);
      assert.equal(Object.keys(hydratedMetadata).length, 16);
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(hydratedMetadata).filter(([key]) =>
            key === "hostedKey0" || key === "hostedKey10"
          ),
        ),
        {
          hostedKey0: "hosted-value-0",
          hostedKey10: "hosted-value-10",
        },
      );
      assert.equal(Object.hasOwn(hydratedMetadata, "hostedKey11"), false);
      assert.equal(hydratedAccount.nextReconcileAt, retryDueAt);
      assert.notEqual(
        hydratedAccount.localConnectionRevision,
        hydratedAccount.hostedObservedConnectionRevision,
      );
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync preserves unpublished completed backfill progress over hosted exhausted progress", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const connectionId = "hosted_conn_completed_backfill_race";
    const initialHostedUpdatedAt = "2026-04-04T00:00:10.000Z";
    const exhaustedHostedUpdatedAt = "2026-04-04T00:00:40.000Z";
    const localCompleteMetadata = {
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillStatus: "coverage_v2_complete",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    };
    const hostedExhaustedMetadata = {
      hosted: true,
      junctionHistoricalBackfillEmptyAttempts: 5,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillStatus: "coverage_v2_exhausted",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    };
    const expectedMergedMetadata = {
      hosted: true,
      ...localCompleteMetadata,
    };
    const provider = createFakeProvider();
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider]);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "completed-backfill-race",
        provider: "demo",
        state: begin.state,
      });
      let hostedSnapshot = buildRuntimeSnapshot({
        connectionId,
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: initialHostedUpdatedAt,
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-04T00:01:00.000Z",
            updates: input.updates.map((update) => ({
              connection: null,
              connectionId: update.connectionId,
              status: "updated",
              tokenUpdate: "unchanged",
              writeUpdate: "applied",
            })),
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return hostedSnapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T00:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get(connectionId);
      assert.ok(localAccountId);

      getStore(service).patchAccount(localAccountId, {
        metadata: localCompleteMetadata,
        nextReconcileAt: "2026-04-04T02:00:00.000Z",
      });

      hostedSnapshot = buildRuntimeSnapshot({
        connectionId,
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: exhaustedHostedUpdatedAt,
        localState: {
          nextReconcileAt: "2026-04-04T01:00:00.000Z",
        },
        metadata: hostedExhaustedMetadata,
      });

      const hydratedState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T01:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const hydratedAccount = getStore(service).getAccountById(localAccountId);
      assert.deepEqual(hydratedAccount?.metadata, expectedMergedMetadata);
      assert.equal(hydratedAccount?.nextReconcileAt, "2026-04-04T01:00:00.000Z");
      assert.notEqual(
        hydratedAccount?.localConnectionRevision,
        hydratedAccount?.hostedObservedConnectionRevision,
      );

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T01:00:05.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state: hydratedState,
      });

      const republishRequest = requireApplyUpdatesRequest(appliedRequest);
      assert.equal(republishRequest.updates.length, 1);
      assert.equal(republishRequest.updates[0]?.observedUpdatedAt, exhaustedHostedUpdatedAt);
      assert.deepEqual(republishRequest.updates[0]?.connection?.metadata, expectedMergedMetadata);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("sync keeps newer hosted backfill progress over stale unpublished local progress", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const connectionId = "hosted_conn_newer_backfill_progress";
    const initialHostedUpdatedAt = "2026-04-04T00:00:10.000Z";
    const newerHostedUpdatedAt = "2026-04-04T00:00:40.000Z";
    const localRetryDueAt = "2026-04-04T00:15:00.000Z";
    const hostedRetryDueAt = "2026-04-04T00:30:00.000Z";
    const localBackfillMetadata = {
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillStatus: "coverage_v2_retrying",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    };
    const hostedBackfillMetadata = {
      hosted: true,
      junctionHistoricalBackfillEmptyAttempts: 2,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:10:00.000Z",
      junctionHistoricalBackfillStatus: "coverage_v2_retrying",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    };
    const provider = createFakeProvider();
    const service = createDeviceSyncServiceForVault(vaultRoot, [provider]);

    try {
      const begin = await service.startConnection({
        provider: "demo",
      });
      const connected = await service.handleOAuthCallback({
        code: "newer-backfill-progress",
        provider: "demo",
        state: begin.state,
      });
      let hostedSnapshot = buildRuntimeSnapshot({
        connectionId,
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: initialHostedUpdatedAt,
        localState: {
          nextReconcileAt: hostedRetryDueAt,
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-04T00:01:00.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return hostedSnapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T00:00:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get(connectionId);
      assert.ok(localAccountId);

      getStore(service).patchAccount(localAccountId, {
        metadata: localBackfillMetadata,
        nextReconcileAt: localRetryDueAt,
      });

      hostedSnapshot = buildRuntimeSnapshot({
        connectionId,
        externalAccountId: connected.account.externalAccountId,
        hostedUpdatedAt: newerHostedUpdatedAt,
        localState: {
          nextReconcileAt: hostedRetryDueAt,
        },
        metadata: hostedBackfillMetadata,
      });

      const hydratedState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T00:30:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      const hydratedAccount = getStore(service).getAccountById(localAccountId);
      assert.deepEqual(hydratedAccount?.metadata, hostedBackfillMetadata);
      assert.equal(hydratedAccount?.nextReconcileAt, hostedRetryDueAt);
      assert.equal(
        hydratedAccount?.localConnectionRevision,
        hydratedAccount?.hostedObservedConnectionRevision,
      );

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-04T00:30:05.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state: hydratedState,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest).updates, []);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation is a no-op when the hosted snapshot or client is unavailable", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);
    let applyUpdatesCalls = 0;

    try {
      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates() {
            applyUpdatesCalls += 1;
            return {
              appliedAt: "2026-04-06T10:10:01.000Z",
              updates: [],
              userId: "member_123",
            };
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during reconciliation");
          },
          async fetchSnapshot() {
            return buildEmptyRuntimeSnapshot();
          },
        },
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state: {
          hostedToLocalAccountIds: new Map(),
          localToHostedAccountIds: new Map(),
          observedTokenVersions: new Map(),
          pendingDirtyAcks: [],
          pendingDirtyPayloadJobs: [],
          snapshot: null,
        },
      });

      await assert.rejects(
        () => reconcileHostedDeviceSyncControlPlaneState({
          deviceSyncPort: null,
          wake: buildCronWake("2026-04-06T10:10:00.000Z"),
          secret: DEVICE_SYNC_SECRET,
          service,
          state: {
            hostedToLocalAccountIds: new Map(),
            localToHostedAccountIds: new Map([["local_missing", "hosted_missing"]]),
            observedTokenVersions: new Map(),
            pendingDirtyAcks: [],
            pendingDirtyPayloadJobs: [],
            snapshot: buildRuntimeSnapshot({
              connectionId: "hosted_missing",
              externalAccountId: "demo-missing",
            }),
          },
        }),
        /configured hosted device-sync control-plane port/u,
      );

      assert.equal(applyUpdatesCalls, 0);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation skips mapped accounts that no longer exist locally", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);
    let appliedRequest: ApplyUpdatesRequest | null = null;

    try {
      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
          ...createNoDirtyStateDeviceSyncPortMethods(),
          async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
            appliedRequest = input;
            return {
              appliedAt: "2026-04-06T10:10:01.000Z",
              updates: [],
              userId: "member_123",
            };
          },
          async createConnectLink() {
            throw new Error("createConnectLink should not be called during reconciliation");
          },
          async fetchSnapshot() {
            return buildEmptyRuntimeSnapshot();
          },
        },
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state: {
          hostedToLocalAccountIds: new Map([["hosted_missing", "local_missing"]]),
          localToHostedAccountIds: new Map([["local_missing", "hosted_missing"]]),
          observedTokenVersions: new Map(),
          pendingDirtyAcks: [],
          pendingDirtyPayloadJobs: [],
          snapshot: buildRuntimeSnapshot({
            connectionId: "hosted_missing",
            externalAccountId: "demo-missing",
          }),
        },
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest), {
        occurredAt: "2026-04-06T10:10:00.000Z",
        updates: [],
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation sends a disconnected update when the local account disconnects after sync", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_disconnect_after_sync",
        externalAccountId: "demo-disconnect-after-sync",
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T10:10:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_disconnect_after_sync");
      assert.ok(localAccountId);

      getStore(service).disconnectAccount(localAccountId, "2026-04-06T09:40:00.000Z");

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest).updates[0], {
        connection: {
          status: "disconnected",
        },
        connectionId: "hosted_conn_disconnect_after_sync",
        observedTokenVersion: 4,
        observedConnectedAt: "2026-04-04T09:00:00.000Z",
        observedUpdatedAt: "2026-04-04T09:05:00.000Z",
        credential: {
          clearTokens: true,
          kind: "oauth_tokens",
        },
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation sends status and error deltas for active accounts", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_error_delta",
        externalAccountId: "demo-error-delta",
        localState: {
          nextReconcileAt: "2026-04-06T11:00:00.000Z",
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T10:10:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_error_delta");
      assert.ok(localAccountId);

      getStore(service).markSyncFailed(
        localAccountId,
        "2026-04-06T09:40:00.000Z",
        "LOCAL_ERR",
        "local error delta",
        "reauthorization_required",
      );

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest).updates[0], {
        connection: {
          status: "reauthorization_required",
        },
        connectionId: "hosted_conn_error_delta",
        localState: {
          lastErrorCode: "LOCAL_ERR",
          lastErrorMessage: "local error delta",
          lastSyncErrorAt: "2026-04-06T09:40:00.000Z",
          nextReconcileAt: null,
        },
        observedConnectedAt: "2026-04-04T09:00:00.000Z",
        observedUpdatedAt: "2026-04-04T09:05:00.000Z",
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation clears the hosted token bundle when local escrow is empty", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_clear_tokens",
        externalAccountId: "demo-clear-tokens",
        tokenBundle: {
          accessToken: "hosted-access",
          accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
          refreshToken: "hosted-refresh",
          tokenVersion: 4,
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T10:10:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_clear_tokens");
      assert.ok(localAccountId);

      clearAccountCredentialForTesting(service, localAccountId);

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest).updates[0], {
        connectionId: "hosted_conn_clear_tokens",
        observedTokenVersion: 4,
        observedConnectedAt: "2026-04-04T09:00:00.000Z",
        observedUpdatedAt: "2026-04-04T09:05:00.000Z",
        credential: {
          clearTokens: true,
          kind: "oauth_tokens",
        },
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation clears hosted OAuth credentials with explicit credential update", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_clear_oauth_credential",
        externalAccountId: "demo-clear-oauth-credential",
        credential: {
          kind: "oauth_tokens",
          tokenBundle: {
            accessToken: "hosted-access",
            accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
            keyVersion: "hosted-runtime",
            refreshToken: "hosted-refresh",
            tokenVersion: 4,
          },
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T10:10:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_clear_oauth_credential");
      assert.ok(localAccountId);

      clearAccountCredentialForTesting(service, localAccountId);

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest).updates[0], {
        connectionId: "hosted_conn_clear_oauth_credential",
        credential: {
          clearTokens: true,
          kind: "oauth_tokens",
        },
        observedTokenVersion: 4,
        observedConnectedAt: "2026-04-04T09:00:00.000Z",
        observedUpdatedAt: "2026-04-04T09:05:00.000Z",
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation sends explicit null observed fences when the hosted baseline has no versioned state yet", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const snapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse = {
        connections: [
          {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-04T09:00:00.000Z",
              createdAt: "2026-04-04T09:00:00.000Z",
              displayName: "Hosted Demo",
              externalAccountId: "demo-null-fence",
              id: "hosted_conn_null_fence",
              metadata: {
                hosted: true,
              },
              provider: "demo",
              scopes: ["offline", "read:data"],
              status: "active",
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
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
          },
        ],
        generatedAt: "2026-04-04T09:10:00.000Z",
        userId: "member_123",
      };
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T10:10:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const seeded = getStore(service).upsertAccount({
        connectedAt: "2026-04-04T09:00:00.000Z",
        displayName: "Hosted Demo",
        externalAccountId: "demo-null-fence",
        metadata: {
          hosted: true,
        },
        provider: "demo",
        scopes: ["offline", "read:data"],
        status: "active",
        tokens: {
          accessToken: "seed-access-token",
          accessTokenEncrypted: "enc:seed-access-token",
          accessTokenExpiresAt: "2026-04-05T00:00:00.000Z",
          refreshToken: "seed-refresh-token",
          refreshTokenEncrypted: "enc:seed-refresh-token",
        },
      });

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_null_fence");
      assert.equal(localAccountId, seeded.id);

      getStore(service).patchAccount(localAccountId, {
        displayName: "Local Null Fence",
      });
      getStore(service).markSyncStarted(localAccountId, "2026-04-06T09:40:00.000Z");

      const codec = createSecretCodec(DEVICE_SYNC_SECRET);
      const storedLocalAccount = getStore(service).getAccountById(localAccountId);
      assert.ok(storedLocalAccount);
      const updated = getStore(service).upsertAccount({
        connectedAt: storedLocalAccount.connectedAt,
        displayName: "Local Null Fence",
        externalAccountId: storedLocalAccount.externalAccountId,
        metadata: storedLocalAccount.metadata,
        provider: storedLocalAccount.provider,
        scopes: storedLocalAccount.scopes,
        status: storedLocalAccount.status,
        tokens: {
          accessToken: "local-first-access",
          accessTokenEncrypted: codec.encrypt(
            "local-first-access",
            buildDeviceSyncTokenCipherOptions({
              externalAccountId: storedLocalAccount.externalAccountId,
              provider: storedLocalAccount.provider,
              purpose: "device-sync-access-token",
            }),
          ),
          accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
          refreshToken: "local-first-refresh",
          refreshTokenEncrypted: codec.encrypt(
            "local-first-refresh",
            buildDeviceSyncTokenCipherOptions({
              externalAccountId: storedLocalAccount.externalAccountId,
              provider: storedLocalAccount.provider,
              purpose: "device-sync-refresh-token",
            }),
          ),
        },
      });
      assert.ok(updated);

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest).updates[0], {
        connection: {
          displayName: "Local Null Fence",
        },
        connectionId: "hosted_conn_null_fence",
        localState: {
          lastSyncStartedAt: "2026-04-06T09:40:00.000Z",
        },
        observedTokenVersion: null,
        observedConnectedAt: "2026-04-04T09:00:00.000Z",
        observedUpdatedAt: null,
        credential: {
          kind: "oauth_tokens",
          tokenBundle: {
            accessToken: "local-first-access",
            accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
            keyVersion: "local-runtime",
            refreshToken: "local-first-refresh",
            tokenVersion: 1,
          },
        },
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation sends earlier owner next reconcile values with the observed hosted fence", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_noop_reconcile",
        externalAccountId: "demo-noop",
        hostedUpdatedAt: "2026-04-06T09:30:00.000Z",
        localState: {
          lastSyncCompletedAt: "2026-04-06T09:25:00.000Z",
          lastSyncStartedAt: "2026-04-06T09:20:00.000Z",
          lastWebhookAt: "2026-04-06T09:15:00.000Z",
          nextReconcileAt: "2026-04-06T10:00:00.000Z",
        },
        tokenBundle: {
          accessToken: "hosted-noop-access",
          accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
          refreshToken: "hosted-noop-refresh",
          tokenVersion: 4,
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T10:10:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_noop_reconcile");
      assert.ok(localAccountId);

      getStore(service).patchAccount(localAccountId, {
        nextReconcileAt: "2026-04-06T08:00:00.000Z",
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest), {
        occurredAt: "2026-04-06T10:10:00.000Z",
        updates: [
          {
            connectionId: "hosted_conn_noop_reconcile",
            localState: {
              nextReconcileAt: "2026-04-06T08:00:00.000Z",
            },
            observedConnectedAt: "2026-04-04T09:00:00.000Z",
            observedUpdatedAt: "2026-04-06T09:30:00.000Z",
          },
        ],
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation skips disconnected accounts that already match the hosted baseline", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_disconnected_noop",
        externalAccountId: "demo-disconnected-noop",
        status: "disconnected",
        tokenBundle: null,
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T10:10:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest), {
        occurredAt: "2026-04-06T10:10:00.000Z",
        updates: [],
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("reconciliation skips equal mirrored state without emitting any hosted update", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const snapshot = buildRuntimeSnapshot({
        connectionId: "hosted_conn_equal_noop",
        externalAccountId: "demo-equal-noop",
        hostedUpdatedAt: "2026-04-06T09:30:00.000Z",
        localState: {
          lastSyncCompletedAt: "2026-04-06T09:25:00.000Z",
          lastSyncStartedAt: "2026-04-06T09:20:00.000Z",
          lastWebhookAt: "2026-04-06T09:15:00.000Z",
          nextReconcileAt: "2026-04-06T10:00:00.000Z",
        },
        tokenBundle: {
          accessToken: "hosted-equal-access",
          accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
          refreshToken: "hosted-equal-refresh",
          tokenVersion: 4,
        },
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...createNoDirtyStateDeviceSyncPortMethods(),
        async applyUpdates(input): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
          appliedRequest = input;
          return {
            appliedAt: "2026-04-06T10:10:01.000Z",
            updates: [],
            userId: "member_123",
          };
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called during reconciliation");
        },
        async fetchSnapshot() {
          return snapshot;
        },
      };

      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest), {
        occurredAt: "2026-04-06T10:10:00.000Z",
        updates: [],
      });
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });

  test("hosted Junction yields keep prior daily resources durable across multiple slow peers", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-junction-resource-boundary-",
    );
    await initializeVault({
      createdAt: "2026-04-01T00:00:00.000Z",
      timezone: "UTC",
      vaultRoot,
    });
    const connectedAt = "2026-04-01T00:00:00.000Z";
    const externalAccountId = "junction-hosted-resource-boundary";
    const hostedConnectionId = "hosted_conn_junction_resource_boundary";
    const yieldedAt = "2026-04-03T00:00:00.000Z";
    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: hostedConnectionId,
      sourceProviderSlug: "garmin",
    });
    assert.ok(sourceInstanceKey);
    const metadata = {
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2026-03-31T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: connectedAt,
    };
    const snapshot = buildRuntimeSnapshot({
      connectedAt,
      connectionId: hostedConnectionId,
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        credentialMetadata: {},
      },
      externalAccountId,
      generatedAt: yieldedAt,
      hostedUpdatedAt: yieldedAt,
      localState: { nextReconcileAt: yieldedAt },
      metadata,
      provider: "junction",
      providerConfigs: {
        junction: {
          environment: "sandbox",
          reconcileDays: 1,
          reconcileIntervalMs: 60 * 60_000,
          region: "us",
          summaryBackfillDays: 1,
          summaryResources: [],
          timeseriesBackfillDays: 1,
        },
      },
      sources: [{
        displayName: "Garmin",
        firstSeenAt: connectedAt,
        lastDataAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: yieldedAt,
        resourceCount: 4,
        resourceAvailabilitySummary: {
          blood_oxygen: true,
          caffeine: true,
          stress_level: true,
          water: true,
        },
        sourceInstanceKey,
        sourceProviderSlug: "garmin",
        status: "connected",
      }],
    });
    let failurePhase: "stress" | "caffeine" | "recovered" = "stress";
    let shouldYield = false;
    let stressRequestCount = 0;
    let caffeineRequestCount = 0;
    let waterRequestCount = 0;
    let resolveThirdStressRequest: (() => void) | null = null;
    let resolveThirdCaffeineRequest: (() => void) | null = null;
    const thirdStressRequest = new Promise<void>((resolve) => {
      resolveThirdStressRequest = resolve;
    });
    const thirdCaffeineRequest = new Promise<void>((resolve) => {
      resolveThirdCaffeineRequest = resolve;
    });
    const [provider] = createConfiguredDeviceSyncProvidersFromConfigs({
      junction: {
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        region: "us",
        reconcileDays: 1,
        reconcileIntervalMs: 60 * 60_000,
        requestTimeoutMs: 500,
        summaryBackfillDays: 1,
        summaryResources: [],
        timeseriesBackfillDays: 1,
        timeseriesResources: ["blood_oxygen", "stress_level", "caffeine", "water"],
        fetchImpl: async (input, init) => {
          const url = new URL(readTestUrl(input));
          if (url.pathname === `/v2/user/providers/${externalAccountId}`) {
            return createTestJsonResponse({ providers: [{
              id: "provider-garmin-hosted-resource-boundary",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                blood_oxygen: true,
                caffeine: true,
                stress_level: true,
                water: true,
              },
            }] });
          }
          if (url.pathname.startsWith("/v2/summary/") && url.pathname.endsWith(`/${externalAccountId}`)) {
            return createTestJsonResponse({ data: [] });
          }
          if (url.pathname === `/v2/timeseries/${externalAccountId}/blood_oxygen/grouped`) {
            return createTestJsonResponse({ groups: { garmin: [{
              data: [{
                id: "blood-oxygen-hosted-stable",
                timestamp: "2026-04-02T08:00:00.000Z",
                unit: "%",
                value: 97,
              }],
              source: { provider: "garmin", type: "watch" },
            }] } });
          }
          if (url.pathname === `/v2/timeseries/${externalAccountId}/stress_level/grouped`) {
            stressRequestCount += 1;
            if (failurePhase === "stress") {
              if (stressRequestCount < 3) {
                await new Promise((resolve) => setTimeout(resolve, 450));
                return new Response(JSON.stringify({ code: "upstream_unavailable" }), {
                  status: 503,
                  headers: {
                    "Content-Type": "application/json",
                    "Retry-After": "0",
                  },
                });
              }
              resolveThirdStressRequest?.();
              await new Promise<void>((resolve, reject) => {
                const abort = () => reject(init?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
                init?.signal?.addEventListener("abort", abort, { once: true });
                setTimeout(resolve, 2_000);
              });
              throw new Error("The hosted yield should abort the slow resource request.");
            }
            return createTestJsonResponse({ groups: { garmin: [{
              data: [{ start: "2026-04-02T09:00:00.000Z", value: 31 }],
              source: { provider: "garmin", type: "watch" },
            }] } });
          }
          if (url.pathname === `/v2/timeseries/${externalAccountId}/caffeine/grouped`) {
            caffeineRequestCount += 1;
            if (failurePhase === "caffeine") {
              if (caffeineRequestCount < 3) {
                await new Promise((resolve) => setTimeout(resolve, 450));
                return new Response(JSON.stringify({ code: "upstream_unavailable" }), {
                  status: 503,
                  headers: {
                    "Content-Type": "application/json",
                    "Retry-After": "0",
                  },
                });
              }
              resolveThirdCaffeineRequest?.();
              await new Promise<void>((resolve, reject) => {
                const abort = () => reject(init?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
                init?.signal?.addEventListener("abort", abort, { once: true });
                setTimeout(resolve, 2_000);
              });
              throw new Error("The hosted yield should abort the second slow resource request.");
            }
            return createTestJsonResponse({ groups: { garmin: [{
              data: [{ start: "2026-04-02T10:00:00.000Z", value: 0.095 }],
              source: { provider: "garmin", type: "watch" },
            }] } });
          }
          if (url.pathname === `/v2/timeseries/${externalAccountId}/water/grouped`) {
            waterRequestCount += 1;
            return createTestJsonResponse({ groups: { garmin: [{
              data: [{ start: "2026-04-02T11:00:00.000Z", value: 250 }],
              source: { provider: "garmin", type: "watch" },
            }] } });
          }
          throw new Error(`Unexpected Junction hosted-resource request: ${url.pathname}`);
        },
      },
    });
    assert.ok(provider);
    const service = createHostedRuntimeDeviceSyncService({
      clock: { now: () => new Date(yieldedAt) },
      deviceSyncPort: createSnapshotOnlyDeviceSyncPort(snapshot),
      secret: DEVICE_SYNC_SECRET,
      config: {
        publicBaseUrl: "https://sync.example.test/device-sync",
        shouldYieldJobExecution: () => shouldYield,
        stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
        vaultRoot,
      },
      providers: [provider],
    });

    try {
      const deviceSyncPort = createSnapshotOnlyDeviceSyncPort(snapshot);
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        secret: DEVICE_SYNC_SECRET,
        service,
        snapshot,
        wake: buildCronWake(yieldedAt),
      });
      const localAccountId = state.hostedToLocalAccountIds.get(hostedConnectionId);
      assert.ok(localAccountId);
      await service.runSchedulerOnce();
      const scheduledJobs = readJobsForAccount(service, localAccountId);
      assert.equal(
        scheduledJobs.filter((job) => job.kind === "reconcile" && job.status === "queued").length,
        1,
        JSON.stringify(scheduledJobs),
      );
      const yieldingWorker = service.runWorkerOnce();
      await Promise.race([
        thirdStressRequest,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("Timed out waiting for Junction's third stress request.")), 10_000);
        }),
      ]);
      shouldYield = true;
      assert.equal((await yieldingWorker)?.kind, "reconcile");
      shouldYield = false;

      const firstRecords = await readCanonicalEventRecords(vaultRoot);
      const firstSpo2 = firstRecords.filter((record) => eventHasMetric(record, "spo2"));
      assert.equal(firstSpo2.length, 1);
      assert.equal(firstRecords.some((record) => eventHasMetric(record, "stress-level")), false);
      assert.equal(firstRecords.some((record) => eventHasMetric(record, "caffeine")), false);
      assert.equal(caffeineRequestCount, 0);
      assert.equal(waterRequestCount, 0);
      assert.equal(
        Object.hasOwn(
          getStore(service).getAccountById(localAccountId)?.metadata ?? {},
          "junctionExtendedHistoryCoverage",
        ),
        false,
      );
      const yieldedJobs = readJobsForAccount(service, localAccountId);
      assert.equal(yieldedJobs.filter((job) => job.kind === "reconcile" && job.status === "queued").length, 1);

      failurePhase = "caffeine";
      const secondYieldingWorker = service.runWorkerOnce();
      await Promise.race([
        thirdCaffeineRequest,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("Timed out waiting for Junction's third caffeine request.")), 10_000);
        }),
      ]);
      shouldYield = true;
      assert.equal((await secondYieldingWorker)?.kind, "reconcile");
      shouldYield = false;

      const secondRecords = await readCanonicalEventRecords(vaultRoot);
      const firstStress = secondRecords.filter((record) => eventHasMetric(record, "stress-level"));
      assert.equal(firstStress.length, 1);
      assert.equal(secondRecords.some((record) => eventHasMetric(record, "caffeine")), false);
      assert.equal(waterRequestCount, 0);
      const twiceYieldedJobs = readJobsForAccount(service, localAccountId);
      assert.equal(twiceYieldedJobs.filter((job) => job.kind === "reconcile" && job.status === "queued").length, 1);

      failurePhase = "recovered";
      assert.equal((await service.runWorkerOnce())?.kind, "reconcile");
      const recoveredRecords = await readCanonicalEventRecords(vaultRoot);
      for (const firstRecord of firstSpo2) {
        assert.deepEqual(
          recoveredRecords
            .filter((record) => record.id === firstRecord.id)
            .map((record) => eventRevisionFromLifecycle(record.lifecycle)),
          [1],
        );
      }
      for (const stressRecord of firstStress) {
        assert.deepEqual(
          recoveredRecords
            .filter((record) => record.id === stressRecord.id)
            .map((record) => eventRevisionFromLifecycle(record.lifecycle)),
          [1],
        );
      }
      assert.equal(recoveredRecords.filter((record) => eventHasMetric(record, "caffeine")).length, 1);
      assert.equal(recoveredRecords.filter((record) => eventHasMetric(record, "water")).length, 1);
      // The retained-lease checkpoint prevents the already-terminal stress
      // resource from replaying after the later caffeine request is aborted.
      assert.equal(stressRequestCount, 4);
      assert.equal(caffeineRequestCount, 4);
      assert.equal(waterRequestCount, 1);
    } finally {
      closeHostedRuntimeDeviceSyncService(service);
      await cleanup();
    }
  });
});
