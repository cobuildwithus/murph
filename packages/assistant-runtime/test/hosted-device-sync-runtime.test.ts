import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { describe, test } from "vitest";
import { openSqliteRuntimeDatabase } from "@murphai/runtime-state/node";

import { buildDeviceSyncTokenCipherOptions, createSecretCodec } from "@murphai/device-syncd/crypto";
import {
  type DeviceSyncAccount,
  type DeviceSyncJobRecord,
  type DeviceSyncProvider,
  type ProviderAuthTokens,
  type StoredDeviceSyncAccount,
} from "@murphai/device-syncd/types";
import type { DeviceSyncService } from "@murphai/device-syncd/service";
import type {
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
  reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState,
} from "../src/hosted-device-sync-runtime.ts";
import type { HostedRuntimeDeviceSyncPort } from "../src/hosted-runtime/platform.ts";
import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

const DEVICE_SYNC_SECRET = "secret-for-tests";
type ApplyUpdatesRequest = Parameters<HostedRuntimeDeviceSyncPort["applyUpdates"]>[0];

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

function createDeviceSyncServiceForVault(vaultRoot: string) {
  return createHostedRuntimeDeviceSyncService({
    secret: DEVICE_SYNC_SECRET,
    config: {
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      vaultRoot,
    },
    providers: [createFakeProvider()],
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
}) {
  return {
    connectionId: input.connectionId,
    eventId: input.eventId ?? "evt_device_sync_wake",
    ...(input.hint ? { hint: input.hint } : {}),
    kind: "device-sync.wake" as const,
    occurredAt: input.occurredAt,
    provider: "demo" as const,
    reason: input.reason,
    userId: "member_123",
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
  setupExpiresAt?: string | null;
  setupPhase?: "pending_link" | "link_returned" | "source_confirmed" | "failed" | null;
  status?: HostedExecutionDeviceSyncRuntimeConnectionStatus;
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
          provider: "demo",
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

function createSnapshotOnlyDeviceSyncPort(
  snapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse,
): HostedRuntimeDeviceSyncPort {
  return {
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
  } finally {
    database.close();
  }
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
  test("sync returns an empty state when no device-sync client is available", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "hosted-device-sync-runtime-",
    );
    await mkdir(vaultRoot, { recursive: true });

    const service = createDeviceSyncServiceForVault(vaultRoot);

    try {
      const state = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort: null,
        wake: buildCronWake("2026-04-06T09:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(state.snapshot, null);
      assert.equal(state.hostedToLocalAccountIds.size, 0);
      assert.equal(state.localToHostedAccountIds.size, 0);
      assert.equal(state.observedTokenVersions.size, 0);
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
            observedUpdatedAt: "2026-04-06T09:20:00.000Z",
          },
        ],
      });
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

  test("device-sync disconnected wakes disconnect the mapped account and kill queued jobs after refreshing the control-plane snapshot", async () => {
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
          occurredAt: "2026-04-06T09:10:00.000Z",
          reason: "disconnected",
        }),
        secret: DEVICE_SYNC_SECRET,
        service,
      });

      assert.equal(fetchSnapshotCalls, 1);
      const stored = getStore(service).getAccountById(connected.account.id);
      assert.equal(stored?.status, "disconnected");

      const deadJob = getStore(service).getJobById(pendingJob.id);
      assert.equal(deadJob?.status, "dead");
      assert.equal(deadJob?.lastErrorCode, "HOSTED_DEVICE_SYNC_DISCONNECTED");
      assert.equal(
        deadJob?.lastErrorMessage,
        "Hosted device-sync wake marked the connection as disconnected.",
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
      assert.deepEqual(readJobsForAccount(service, connected.account.id), []);
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
      assert.equal(stored.nextReconcileAt, "2026-04-06T11:00:00.000Z");
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
      assert.equal(stored.nextReconcileAt, "2026-04-06T11:00:00.000Z");
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
        updates: [],
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
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
        secret: DEVICE_SYNC_SECRET,
        service,
        state: {
          hostedToLocalAccountIds: new Map(),
          localToHostedAccountIds: new Map(),
          observedTokenVersions: new Map(),
          snapshot: null,
        },
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort: null,
        wake: buildCronWake("2026-04-06T10:10:00.000Z"),
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
      });

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
        },
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
        updates: [],
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
});
