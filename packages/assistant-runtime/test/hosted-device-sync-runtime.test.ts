import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, test, vi } from "vitest";
import {
  initializeVault,
  readJsonlRecords,
  updateVaultSummary,
  VaultError,
  withHostedCanonicalWritePort,
} from "@murphai/core";
import type { HostedExecutionDeviceSyncWake } from "@murphai/hosted-execution";
import { parseHostedExecutionWake, parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import type { HostedRuntimeLogRequest } from "@murphai/hosted-execution/runtime-control";
import { drainHostedRuntimeLogWritesBestEffort } from "../src/hosted-runtime/runtime-logs.ts";
import { listMetricPoints, rebuildQueryProjection } from "@murphai/query";
import { JunctionSparseCalendarRepairNormalizationError } from "@murphai/importers/device-providers/junction";
import { openSqliteRuntimeDatabase } from "@murphai/runtime-state/node";
import {
  buildJunctionWearableHostedReplayPlan,
  DEFAULT_JUNCTION_WEARABLE_HOSTED_REPLAY_FIXTURE_RELATIVE_PATH,
  JUNCTION_WEARABLE_HOSTED_DIRECT_REPLAY_BROWSER_VAULT_METRIC_EXPECTATIONS,
} from "@murphai/vault-usecases/testing";

import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_RESOURCE,
  COMPANION_HRV_RMSSD_SCHEMA,
  eventRevisionFromLifecycle,
  isDeletedEventLifecycle,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";
import { createConfiguredDeviceSyncProvidersFromConfigs } from "@murphai/device-syncd/config";
import { buildJunctionProviderSourceInstanceKey, canonicalizeJunctionProviderSlug } from "@murphai/device-syncd/connect-config";
import {
  resolveGoogleHealthFitbitMigrationSources,
} from "@murphai/device-syncd/fitbit-migration";
import { JUNCTION_COMPANION_HRV_OBSERVATION_INVALID_CODE } from "@murphai/device-syncd/junction-resources";
import {
  addJunctionExtendedTimeseriesHistoryBackfillCoverage,
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
  resolveJunctionExtendedTimeseriesHistoryBackfillVersion,
} from "@murphai/device-syncd/junction-historical-backfill-progress";
import { buildDeviceSyncTokenCipherOptions, createSecretCodec } from "@murphai/device-syncd/local-secret-codec";
import { deviceSyncError, isDeviceSyncError } from "@murphai/device-syncd/errors";
import { DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE } from "@murphai/device-syncd/public-account";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PAGE_LIMIT,
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  encodeJunctionReconcileProof,
  readJunctionReconcileProof,
  JUNCTION_RECONCILE_PROOF_METADATA_KEY,
} from "@murphai/device-syncd/hosted-runtime";
import {
  type DeviceConnectionSourceResourceAvailabilitySummary,
  type DeviceSyncAccount,
  type DeviceSyncJobRecord,
  type DeviceSyncProvider,
  type ProviderAuthTokens,
  type StoredDeviceSyncAccount,
} from "@murphai/device-syncd/types";
import type { DeviceSyncService } from "@murphai/device-syncd/service";
import type {
  HostedExecutionDeviceSyncDirtyStateResponse,
  HostedExecutionDeviceSyncDirtyPendingResponse,
  HostedExecutionDeviceSyncStagedDirtyAck,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeConnectionStatus,
  HostedExecutionDeviceSyncRuntimeCredentialSnapshot,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

import {
  canonicalizeHostedJunctionSources,
  closeHostedRuntimeDeviceSyncService,
  createHostedRuntimeDeviceSyncService,
  requireHostedRuntimeDeviceSyncStore,
} from "../src/device-sync-service.ts";
import {
  fetchCompleteHostedDeviceSyncRuntimeSnapshot,
  hydrateHostedDeviceSyncControlPlaneState,
  promoteHostedCompletedDirtyPayloadAcks,
  publishHostedDeviceSyncCheckpointedProgress,
  reconcileHostedDeviceSyncControlPlaneState,
  resolveHostedDeviceSyncSchedulerAccountId,
  resolveHostedDeviceSyncWakeRecovery,
  syncHostedDeviceSyncControlPlaneState,
  type HostedDeviceSyncRuntimeSyncState,
} from "../src/hosted-device-sync-runtime.ts";
import { HOSTED_DEVICE_SYNC_PASS_JOB_LIMIT } from "../src/hosted-device-sync-limits.ts";
import {
  HostedRuntimeArtifactWriteError,
  type HostedRuntimeDeviceSyncPort,
} from "../src/hosted-runtime/platform.ts";
import {
  buildHostedDeviceSyncFailureJobLineage,
  buildHostedDeviceSyncPassLineageDiagnostics,
  runHostedDeviceSyncPass,
} from "../src/hosted-runtime/device-sync-maintenance.ts";
import type { HostedMaintenanceMetrics } from "../src/hosted-runtime/models.ts";
import {
  prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedDeviceSyncDirtyPostCheckpointRecord,
  recordHostedSystemMailboxItemAfterCheckpoint,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  findNextHostedSystemMailboxQueueItem,
  projectHostedDeviceHintCoverage,
  readHostedSystemMailboxState,
  systemMailboxItemIsDue,
  updateHostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
} from "../src/hosted-runtime/system-mailbox-state.ts";
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

function historyCoverageVersion(resource: string): number {
  const version = resolveJunctionExtendedTimeseriesHistoryBackfillVersion(resource);
  if (version === null) {
    throw new TypeError(`Expected an extended-history version for ${resource}.`);
  }
  return version;
}

const DEVICE_SYNC_SECRET = "secret-for-tests";
type ApplyUpdatesRequest = Parameters<HostedRuntimeDeviceSyncPort["applyUpdates"]>[0];
const FROZEN_PRE_EPOCH_SOURCE_APPLY_FIELDS = new Set([
  "displayName",
  "firstSeenAt",
  "lastDataAt",
  "lastErrorCode",
  "lastErrorMessage",
  "lastSeenAt",
  "observedLastSeenAt",
  "resourceAvailabilitySummary",
  "sourceInstanceKey",
  "sourceProviderSlug",
  "status",
]);

function assertFrozenPreEpochSourceApplyAccepts(request: ApplyUpdatesRequest): void {
  const wireRequest: unknown = JSON.parse(
    JSON.stringify({ ...request, userId: "member_123" }),
  );
  assert.ok(wireRequest !== null && typeof wireRequest === "object");
  const updates = Reflect.get(wireRequest, "updates");
  assert.ok(Array.isArray(updates));
  for (const [updateIndex, update] of updates.entries()) {
    assert.ok(update !== null && typeof update === "object");
    const sources = Reflect.get(update, "sources");
    assert.ok(sources === undefined || Array.isArray(sources));
    for (const [sourceIndex, source] of (sources ?? []).entries()) {
      assert.ok(source !== null && typeof source === "object");
      for (const field of Object.keys(source)) {
        assert.equal(
          FROZEN_PRE_EPOCH_SOURCE_APPLY_FIELDS.has(field),
          true,
          `Legacy source apply rejects updates[${updateIndex}].sources[${sourceIndex}].${field}`,
        );
      }
    }
  }
  parseHostedExecutionDeviceSyncRuntimeApplyRequest(wireRequest, "member_123");
}

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
      connection: {
        kind: "oauth2",
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
) {
  return createHostedRuntimeDeviceSyncService({
    secret: DEVICE_SYNC_SECRET,
    config: {
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      vaultRoot,
    },
    providers,
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

function buildDeviceSyncWake(input: {
  connectionId: string;
  eventId?: string;
  expectedConnectedAt?: string | null;
  hint?: {
    junctionTemporalSweepKey?: string;
    junctionReconcileProof?: string;
    jobs?: Array<{
      availableAt?: string;
      dedupeKey?: string;
      kind: string;
      maxAttempts?: number;
      payload?: Record<string, unknown>;
      priority?: number;
    }>;
    nextReconcileAt?: string | null;
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

function buildDirtyDeviceSyncWake(
  connectionId: string,
  occurredAt: string,
  provider = "demo",
) {
  return buildDeviceSyncWake({
    connectionId,
    hint: { reason: "dirty" },
    occurredAt,
    provider,
    reason: "webhook_hint",
  });
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
  processedRevision?: string;
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
    processedRevision: input.processedRevision ?? "0",
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
  const eventPaths = ["ledger/events/2026/2026-04.jsonl"];
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

function eventHasMetric(
  record: Awaited<ReturnType<typeof readCanonicalEventRecords>>[number],
  metric: string,
): boolean {
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

function setJobMaxAttemptsForTesting(
  service: DeviceSyncService,
  jobId: string,
  maxAttempts: number,
): void {
  const database = openSqliteRuntimeDatabase(getStore(service).databasePath);

  try {
    database.prepare(`
      update device_job
      set max_attempts = ?
      where id = ?
    `).run(maxAttempts, jobId);
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

test.each([
  { minutesUntilDue: 25, dirty: true, retained: false, expectedReconcile: true },
  { minutesUntilDue: 25, dirty: true, retained: true, expectedReconcile: true },
  { minutesUntilDue: 25, dirty: false, retained: true, expectedReconcile: false },
  { minutesUntilDue: 45, dirty: true, retained: true, expectedReconcile: false },
  { minutesUntilDue: 45, dirty: true, retained: false, expectedReconcile: false },
  { minutesUntilDue: 25, dirty: false, expectedReconcile: false },
])("hosted webhook cadence coalescing: $minutesUntilDue minutes, dirty=$dirty retained=$retained", async ({ minutesUntilDue, dirty, retained, expectedReconcile }) => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-cadence-coalescing-");
  const now = new Date().toISOString();
  const connectionId = "hosted-synthetic-coalescing";
  await initializeVault({ createdAt: now, timezone: "UTC", vaultRoot });
  const snapshot = buildRuntimeSnapshot({
    connectionId, connectedAt: now, externalAccountId: "synthetic-provider-account", provider: "junction",
    credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
    localState: { lastSyncCompletedAt: now, nextReconcileAt: new Date(Date.parse(now) + minutesUntilDue * 60_000).toISOString() },
    sources: [],
  });
  const port: HostedRuntimeDeviceSyncPort = {
    ...createSnapshotOnlyDeviceSyncPort(snapshot),
    async fetchDirtyStates() {
      return { hasMore: false, nextWakeAt: null, userId: "member_123", items: dirty ? [buildDirtyState({
        connectionId, provider: "junction", dirtyResources: [{
          count: 1, dirtyPayloadId: "synthetic-dirty-payload", jobKind: "resource",
          resource: "activity", resourceCategory: "summary", sourceProviderSlug: null,
          windowStart: now, windowEnd: now,
        }],
      })] : [] };
    },
  };
  let yieldBeforeDrain = false;
  try {
    let wake: HostedExecutionDeviceSyncWake = buildDeviceSyncWake({
      connectionId, expectedConnectedAt: now, occurredAt: now, provider: "junction", reason: "webhook_hint",
    });
    if (retained) {
      const retryAt = new Date(Date.parse(now) + 24 * 60 * 60_000).toISOString();
      const item: HostedSystemMailboxPendingItem = {
        attemptCount: 1, deviceSyncContinuationOwner: true, itemId: "synthetic-retained-owner", lastAttemptAt: now,
        lastErrorCode: null, lastErrorMessage: null, mailboxDedupeKey: "evt_device_sync_wake",
        mailboxLaneSeq: "1", nextAttemptAt: retryAt, occurredAt: now,
        postCheckpointRecord: null, requestId: null, routeAction: "run-device-sync-wake",
        status: "pending", wake: buildDeviceSyncWake({
          connectionId, expectedConnectedAt: now, occurredAt: now, provider: "junction", reason: "reconcile_due",
          hint: { jobs: [{ kind: "resource", availableAt: retryAt, dedupeKey: "synthetic-future-history",
            payload: { resource: "weight", resourceCategory: "timeseries" } }] },
        }),
      };
      const pending = [item, {
        ...item, attemptCount: 0, lastAttemptAt: null, deviceSyncContinuationOwner: undefined,
        itemId: "synthetic-webhook", mailboxLaneSeq: "2", nextAttemptAt: null, wake,
      }];
      const selected = findNextHostedSystemMailboxQueueItem({ now, state: { pending }, allowedRouteActions: ["run-device-sync-wake"] });
      assert.ok(selected);
      assert.equal(selected.itemId, item.itemId);
      assert.equal(selected.nextAttemptAt, null);
      const coverage = projectHostedDeviceHintCoverage({ now, pending });
      assert.equal(coverage.get(item.itemId)?.coveredHintIds.has("synthetic-webhook"), true);
      assert.equal(coverage.get(item.itemId)?.admittedWake, undefined);
      assert.equal(selected.wake.kind, "device-sync.wake");
      if (selected.wake.kind !== "device-sync.wake") throw new Error("Expected retained device wake");
      wake = selected.wake;
      assert.equal(wake.reason, "reconcile_due");
    }
    await withHostedCanonicalWritePort({ async persistCanonicalWrite() {}, async persistRuntimeState() {} }, () => runHostedDeviceSyncPass(wake, vaultRoot, {
      providerConfigs: { junction: { environment: "sandbox", region: "us" } },
      publicBaseUrl: "https://sync.example.test", secret: DEVICE_SYNC_SECRET,
    }, port, 120_000, {
      platformEnv: { JUNCTION_API_KEY: "sk_us_test_123", JUNCTION_CLIENT_USER_ID_SECRET: "synthetic-coalescing-secret", JUNCTION_ENV: "sandbox", JUNCTION_REGION: "us" },
      retainFollowUpWakeUntilCheckpoint: true,
      shouldYield: () => yieldBeforeDrain,
      onStage(stage) { if (stage === "worker_drain") yieldBeforeDrain = true; },
    }));
    const database = openSqliteRuntimeDatabase(path.join(vaultRoot, ".runtime", "operations", "device-sync", "state.sqlite"));
    try {
      const jobs = database.prepare("select kind from device_job where status = 'queued'").all();
      assert.equal(jobs.some((job) => job.kind === "reconcile"), expectedReconcile);
      assert.equal(jobs.some((job) => job.kind === "resource"), dirty || retained === true);
    } finally { database.close(); }
  } finally { await cleanup(); }
});
