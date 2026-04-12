import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { describe, test } from "vitest";

import { createSecretCodec } from "@murphai/device-syncd/crypto";
import { createDeviceSyncService } from "@murphai/device-syncd/service";
import {
  type DeviceSyncAccount,
  type DeviceSyncJobRecord,
  type DeviceSyncProvider,
  type ProviderAuthTokens,
} from "@murphai/device-syncd/types";
import type {
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

import {
  reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState,
} from "../src/hosted-device-sync-runtime.ts";
import type { HostedRuntimeDeviceSyncPort } from "../src/hosted-runtime/platform.ts";
import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

const DEVICE_SYNC_SECRET = "secret-for-tests";
type ApplyUpdatesRequest = Parameters<HostedRuntimeDeviceSyncPort["applyUpdates"]>[0];

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
    buildConnectUrl(context) {
      return `https://example.test/oauth?state=${context.state}`;
    },
    async exchangeAuthorizationCode(_context, code) {
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
    async executeJob(_context, _job: DeviceSyncJobRecord) {
      return {};
    },
  };

  return {
    ...baseProvider,
    ...overrides,
  };
}

function createDeviceSyncServiceForVault(vaultRoot: string) {
  return createDeviceSyncService({
    secret: DEVICE_SYNC_SECRET,
    config: {
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      vaultRoot,
    },
    providers: [createFakeProvider()],
  });
}

function buildCronDispatch(occurredAt: string) {
  return {
    event: {
      kind: "assistant.cron.tick" as const,
      reason: "manual" as const,
      userId: "member_123",
    },
    eventId: "evt_cron",
    occurredAt,
  };
}

function buildWakeDispatch(input: {
  connectionId: string;
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
  };
  occurredAt: string;
  reason: "disconnected" | "reauthorization_required" | "webhook_hint";
  runtimeSnapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse | null;
}) {
  return {
    event: {
      connectionId: input.connectionId,
      ...(input.hint ? { hint: input.hint } : {}),
      kind: "device-sync.wake" as const,
      provider: "demo" as const,
      reason: input.reason,
      runtimeSnapshot: input.runtimeSnapshot,
      userId: "member_123",
    },
    eventId: "evt_device_sync_wake",
    occurredAt: input.occurredAt,
  };
}

function buildRuntimeSnapshot(input: {
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
  status?: "active" | "reauthorization_required" | "disconnected";
  tokenBundle?: {
    accessToken: string;
    accessTokenExpiresAt: string | null;
    refreshToken: string | null;
    tokenVersion: number;
  } | null;
}): HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  return {
    connections: [
      {
        connection: {
          accessTokenExpiresAt: input.tokenBundle?.accessTokenExpiresAt ?? null,
          connectedAt: input.connectedAt ?? "2026-04-04T09:00:00.000Z",
          createdAt: input.connectedAt ?? "2026-04-04T09:00:00.000Z",
          displayName: input.displayName ?? "Hosted Demo",
          externalAccountId: input.externalAccountId,
          id: input.connectionId,
          metadata: input.metadata ?? {
            hosted: true,
          },
          provider: "demo",
          scopes: ["offline", "read:data"],
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
        tokenBundle: input.tokenBundle === null
          ? null
          : {
              accessToken: input.tokenBundle?.accessToken ?? "hosted-access-token",
              accessTokenExpiresAt: input.tokenBundle?.accessTokenExpiresAt ?? "2026-04-05T00:00:00.000Z",
              keyVersion: "hosted-runtime",
              refreshToken: input.tokenBundle?.refreshToken ?? "hosted-refresh-token",
              tokenVersion: input.tokenBundle?.tokenVersion ?? 4,
            },
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

function requireApplyUpdatesRequest(
  request: ApplyUpdatesRequest | null,
): ApplyUpdatesRequest {
  assert.ok(request);
  return request;
}

function readJobsForAccount(service: ReturnType<typeof createDeviceSyncService>, accountId: string) {
  return service.store.database.prepare(`
    select
      available_at as availableAt,
      dedupe_key as dedupeKey,
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
    kind: string;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    maxAttempts: number;
    payloadJson: string;
    priority: number;
    status: string;
  }>;
}

describe("hosted device-sync runtime", () => {
  test("sync returns an empty state when neither an inline snapshot nor a device-sync client is available", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: null,
        dispatch: buildCronDispatch("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      assert.equal(state.snapshot, null);
      assert.equal(state.hostedToLocalAccountIds.size, 0);
      assert.equal(state.localToHostedAccountIds.size, 0);
      assert.equal(state.observedTokenVersions.size, 0);
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      assert.equal(fetchSnapshotCalls, 1);
      assert.deepEqual(state.snapshot, buildEmptyRuntimeSnapshot());
      assert.equal(state.hostedToLocalAccountIds.size, 0);
      assert.equal(state.localToHostedAccountIds.size, 0);
      assert.equal(state.observedTokenVersions.size, 0);
    } finally {
      service.close();
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
      const pendingJob = service.store.enqueueJob({
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
        dispatch: buildCronDispatch("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      assert.equal(fetchSnapshotCalls, 1);
      assert.deepEqual(state.snapshot, snapshot);
      assert.equal(
        state.hostedToLocalAccountIds.get("hosted_conn_disconnected"),
        connected.account.id,
      );
      assert.equal(
        state.localToHostedAccountIds.get(connected.account.id),
        "hosted_conn_disconnected",
      );
      assert.equal(state.observedTokenVersions.get("hosted_conn_disconnected"), null);

      const stored = service.store.getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.status, "disconnected");
      assert.equal(stored.displayName, "Hosted Demo");
      assert.deepEqual(stored.metadata, {
        hosted: true,
      });
      assert.deepEqual(stored.scopes, ["offline", "read:data"]);
      assert.equal(stored.accessTokenEncrypted, "");
      assert.equal(stored.refreshTokenEncrypted, null);
      assert.equal(stored.accessTokenExpiresAt, null);
      assert.equal(stored.lastWebhookAt, "2026-04-06T09:01:00.000Z");
      assert.equal(stored.lastSyncStartedAt, "2026-04-06T09:02:00.000Z");
      assert.equal(stored.lastSyncCompletedAt, "2026-04-06T09:03:00.000Z");

      const deadJob = service.store.getJobById(pendingJob.id);
      assert.equal(deadJob?.status, "dead");
      assert.equal(deadJob?.lastErrorCode, "HOSTED_CONTROL_PLANE_DISCONNECTED");
      assert.equal(
        deadJob?.lastErrorMessage,
        "Hosted control plane marked the device-sync connection as disconnected.",
      );
    } finally {
      service.close();
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
        dispatch: {
          event: {
            connectionId: "hosted_conn_wake",
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
            provider: "demo",
            reason: "webhook_hint",
            runtimeSnapshot: snapshot,
            userId: "member_123",
          },
          eventId: "evt_device_sync_wake",
          occurredAt: "2026-04-04T10:00:00.000Z",
        },
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      assert.equal(state.observedTokenVersions.get("hosted_conn_wake"), 4);

      const stored = service.store.getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.nextReconcileAt, "2026-04-04T12:00:00.000Z");
      assert.equal(stored.hostedObservedTokenVersion, 4);

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
      service.close();
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
        dispatch: buildWakeDispatch({
          connectionId: "hosted_conn_same_next_reconcile",
          hint: {
            nextReconcileAt: "2026-04-04T12:00:00.000Z",
          },
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "webhook_hint",
          runtimeSnapshot: snapshot,
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      const stored = service.store.getAccountById(connected.account.id);
      assert.ok(stored);
      assert.equal(stored.nextReconcileAt, "2026-04-04T12:00:00.000Z");
      assert.deepEqual(readJobsForAccount(service, connected.account.id), []);
    } finally {
      service.close();
      await cleanup();
    }
  });

  test("device-sync disconnected wakes disconnect the mapped account and kill queued jobs without fetching a control-plane snapshot", async () => {
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
      const pendingJob = service.store.enqueueJob({
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
        dispatch: buildWakeDispatch({
          connectionId: "hosted_conn_disconnect_wake",
          occurredAt: "2026-04-06T09:10:00.000Z",
          reason: "disconnected",
          runtimeSnapshot: snapshot,
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      assert.equal(fetchSnapshotCalls, 0);
      const stored = service.store.getAccountById(connected.account.id);
      assert.equal(stored?.status, "disconnected");

      const deadJob = service.store.getJobById(pendingJob.id);
      assert.equal(deadJob?.status, "dead");
      assert.equal(deadJob?.lastErrorCode, "HOSTED_DEVICE_SYNC_DISCONNECTED");
      assert.equal(
        deadJob?.lastErrorMessage,
        "Hosted device-sync wake marked the connection as disconnected.",
      );
    } finally {
      service.close();
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
      });

      await syncHostedDeviceSyncControlPlaneState({
        dispatch: buildWakeDispatch({
          connectionId: "hosted_conn_reauth",
          occurredAt: "2026-04-06T09:10:00.000Z",
          reason: "reauthorization_required",
          runtimeSnapshot: snapshot,
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      const stored = service.store.getAccountById(connected.account.id);
      assert.equal(stored?.status, "reauthorization_required");
      assert.deepEqual(readJobsForAccount(service, connected.account.id), []);
    } finally {
      service.close();
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
      service.store.markSyncFailed(
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
        dispatch: buildCronDispatch("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      const stored = service.store.getAccountById(connected.account.id);
      assert.equal(stored?.lastErrorCode, "LOCAL_ERR");
      assert.equal(stored?.lastErrorMessage, "local error still newer");
      assert.equal(stored?.lastSyncErrorAt, "2026-04-06T09:09:00.000Z");
    } finally {
      service.close();
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
        dispatch: buildWakeDispatch({
          connectionId: "hosted_conn_forward_next_reconcile",
          hint: {
            nextReconcileAt: "2026-04-04T13:00:00.000Z",
          },
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "webhook_hint",
          runtimeSnapshot: snapshot,
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      const stored = service.store.getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-04T13:00:00.000Z");
    } finally {
      service.close();
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
        dispatch: buildWakeDispatch({
          connectionId: "hosted_conn_no_hint",
          occurredAt: "2026-04-04T10:00:00.000Z",
          reason: "webhook_hint",
          runtimeSnapshot: snapshot,
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      const stored = service.store.getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-04T12:00:00.000Z");
      assert.deepEqual(readJobsForAccount(service, connected.account.id), []);
    } finally {
      service.close();
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
      service.store.markSyncFailed(
        connected.account.id,
        "2026-04-06T09:09:00.000Z",
        "LOCAL_ERR",
        "local error should clear",
        "active",
      );

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
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
        dispatch: buildCronDispatch("2026-04-06T09:11:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      const stored = service.store.getAccountById(connected.account.id);
      assert.equal(stored?.lastErrorCode, null);
      assert.equal(stored?.lastErrorMessage, null);
      assert.equal(stored?.lastSyncErrorAt, null);
      assert.equal(stored?.lastSyncCompletedAt, "2026-04-06T09:10:00.000Z");
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-06T09:06:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      service.store.patchAccount(connected.account.id, {
        nextReconcileAt: "2026-04-06T10:30:00.000Z",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
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
        dispatch: buildCronDispatch("2026-04-06T09:07:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      const stored = service.store.getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-06T11:00:00.000Z");
      assert.equal(stored?.hostedObservedUpdatedAt, "2026-04-06T09:05:00.000Z");
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-06T09:06:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      service.store.patchAccount(connected.account.id, {
        nextReconcileAt: "2026-04-06T10:30:00.000Z",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
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
        dispatch: buildCronDispatch("2026-04-06T09:07:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      const stored = service.store.getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-06T10:30:00.000Z");
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-06T09:06:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      service.store.patchAccount(connected.account.id, {
        nextReconcileAt: "not-a-timestamp",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
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
        dispatch: buildCronDispatch("2026-04-06T09:07:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      const stored = service.store.getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-06T11:00:00.000Z");
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-06T09:06:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      service.store.patchAccount(connected.account.id, {
        nextReconcileAt: "2026-04-06T10:30:00.000Z",
      });

      await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: {
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
        dispatch: buildCronDispatch("2026-04-06T09:07:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      const stored = service.store.getAccountById(connected.account.id);
      assert.equal(stored?.nextReconcileAt, "2026-04-06T10:30:00.000Z");
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-02T12:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_reconcile");
      assert.ok(localAccountId);

      service.store.patchAccount(localAccountId, {
        clearErrors: true,
        displayName: "Local Demo",
        metadata: {
          local: "delta",
        },
        scopes: ["offline", "heartrate"],
      });
      service.store.markWebhookReceived(localAccountId, "2026-04-02T13:05:00.000Z");
      service.store.markSyncStarted(localAccountId, "2026-04-02T13:06:00.000Z");

      const codec = createSecretCodec(DEVICE_SYNC_SECRET);
      const updated = service.store.updateAccountTokens(localAccountId, {
        accessToken: "local-access",
        accessTokenEncrypted: codec.encrypt("local-access"),
        accessTokenExpiresAt: "2026-04-04T00:00:00.000Z",
        refreshToken: "local-refresh",
        refreshTokenEncrypted: codec.encrypt("local-refresh"),
      });
      assert.ok(updated);

      assert.equal(
        service.store.markSyncSucceeded(
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
        dispatch: buildCronDispatch("2026-04-02T13:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
        timeoutMs: null,
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
        observedUpdatedAt: "2026-04-02T12:30:00.000Z",
        tokenBundle: {
          accessToken: "local-access",
          accessTokenExpiresAt: "2026-04-04T00:00:00.000Z",
          keyVersion: "local-runtime",
          refreshToken: "local-refresh",
          tokenVersion: 7,
        },
      });
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state: {
          hostedToLocalAccountIds: new Map(),
          localToHostedAccountIds: new Map(),
          observedTokenVersions: new Map(),
          snapshot: null,
        },
        timeoutMs: null,
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort: null,
        dispatch: buildCronDispatch("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state: {
          hostedToLocalAccountIds: new Map(),
          localToHostedAccountIds: new Map([["local_missing", "hosted_missing"]]),
          observedTokenVersions: new Map(),
          snapshot: buildRuntimeSnapshot({
            connectionId: "hosted_missing",
            externalAccountId: "demo-missing",
          }),
        },
        timeoutMs: null,
      });

      assert.equal(applyUpdatesCalls, 0);
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state: {
          hostedToLocalAccountIds: new Map([["hosted_missing", "local_missing"]]),
          localToHostedAccountIds: new Map([["local_missing", "hosted_missing"]]),
          observedTokenVersions: new Map(),
          snapshot: buildRuntimeSnapshot({
            connectionId: "hosted_missing",
            externalAccountId: "demo-missing",
          }),
        },
        timeoutMs: null,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest), {
        occurredAt: "2026-04-06T10:10:00.000Z",
        updates: [],
      });
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_disconnect_after_sync");
      assert.ok(localAccountId);

      service.store.disconnectAccount(localAccountId, "2026-04-06T09:40:00.000Z");

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        dispatch: buildCronDispatch("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
        timeoutMs: null,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest).updates[0], {
        connection: {
          status: "disconnected",
        },
        connectionId: "hosted_conn_disconnect_after_sync",
        observedUpdatedAt: "2026-04-04T09:05:00.000Z",
      });
    } finally {
      service.close();
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
      });
      let appliedRequest: ApplyUpdatesRequest | null = null;
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
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
        dispatch: buildCronDispatch("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_error_delta");
      assert.ok(localAccountId);

      service.store.markSyncFailed(
        localAccountId,
        "2026-04-06T09:40:00.000Z",
        "LOCAL_ERR",
        "local error delta",
        "reauthorization_required",
      );

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        dispatch: buildCronDispatch("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
        timeoutMs: null,
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
        },
        observedUpdatedAt: "2026-04-04T09:05:00.000Z",
      });
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_clear_tokens");
      assert.ok(localAccountId);

      service.store.updateAccountTokens(localAccountId, {
        accessToken: "",
        accessTokenEncrypted: "",
        refreshToken: null,
        refreshTokenEncrypted: null,
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        dispatch: buildCronDispatch("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
        timeoutMs: null,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest).updates[0], {
        connectionId: "hosted_conn_clear_tokens",
        observedTokenVersion: 4,
        observedUpdatedAt: "2026-04-04T09:05:00.000Z",
        tokenBundle: null,
      });
    } finally {
      service.close();
      await cleanup();
    }
  });

  test("reconciliation sends no updates when the mirrored local state is unchanged or older than the hosted baseline", async () => {
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
        dispatch: buildCronDispatch("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });
      const localAccountId = state.hostedToLocalAccountIds.get("hosted_conn_noop_reconcile");
      assert.ok(localAccountId);

      service.store.patchAccount(localAccountId, {
        nextReconcileAt: "2026-04-06T08:00:00.000Z",
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        dispatch: buildCronDispatch("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
        timeoutMs: null,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest), {
        occurredAt: "2026-04-06T10:10:00.000Z",
        updates: [],
      });
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        dispatch: buildCronDispatch("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
        timeoutMs: null,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest), {
        occurredAt: "2026-04-06T10:10:00.000Z",
        updates: [],
      });
    } finally {
      service.close();
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
        dispatch: buildCronDispatch("2026-04-06T09:35:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        timeoutMs: null,
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        dispatch: buildCronDispatch("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state,
        timeoutMs: null,
      });

      assert.deepEqual(requireApplyUpdatesRequest(appliedRequest), {
        occurredAt: "2026-04-06T10:10:00.000Z",
        updates: [],
      });
    } finally {
      service.close();
      await cleanup();
    }
  });
});
