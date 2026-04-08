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
      let appliedRequest: {
        occurredAt?: string | null;
        updates: ReadonlyArray<{
          connection?: Record<string, unknown>;
          connectionId: string;
          localState?: Record<string, unknown>;
          observedTokenVersion?: number | null;
          observedUpdatedAt?: string | null;
          tokenBundle?: Record<string, unknown> | null;
        }>;
      } | null = null;
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

      assert.ok(appliedRequest);
      assert.equal(appliedRequest.occurredAt, "2026-04-02T13:10:00.000Z");
      assert.equal(appliedRequest.updates.length, 1);
      assert.deepEqual(appliedRequest.updates[0], {
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
});
