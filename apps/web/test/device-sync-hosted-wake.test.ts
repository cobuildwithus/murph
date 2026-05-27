import { DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES } from "@murphai/device-syncd/public-ingress";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    completeWebhookTrace: vi.fn(),
    createDeviceSyncPublicIngress: vi.fn(),
    createSignal: vi.fn(),
    ensureWebhookSubscriptions: vi.fn(),
    appendHostedMailboxEnvelope: vi.fn(),
    getConnectionForUser: vi.fn(),
    getConnectionOwnerId: vi.fn(),
    hasPendingDirtyConnection: vi.fn(),
    getStoredConnectionAccountForUser: vi.fn(),
    clearStoredProviderConfigCredential: vi.fn(),
    listConnectionSources: vi.fn(),
    listConnectionsForUser: vi.fn(),
    markConnectionSourcesDisconnected: vi.fn(),
    markDirtyConnectionProcessed: vi.fn(),
    persistStoredConnectionTokenBundle: vi.fn(),
    readHostedDeviceSyncEnvironment: vi.fn(),
    registryGet: vi.fn(),
    registryList: vi.fn(),
    syncDurableConnectionState: vi.fn(),
    getDirtyConnection: vi.fn(),
    upsertDirtyConnection: vi.fn(),
    upsertConnectionSource: vi.fn(),
    withConnectionMutationLock: vi.fn(),
    prismaTx: {
      __tx: true,
      $queryRaw: vi.fn(),
      deviceSyncSignal: {
        create: vi.fn(),
      },
    },
    prisma: {
      $transaction: vi.fn(),
    },
    nudgeHostedRunnerUserBestEffortResult: vi.fn(),
    signalHostedDeviceSyncBackgroundMaintenanceRuntime: vi.fn(),
    signalHostedDeviceSyncMailboxRuntime: vi.fn(),
    appendHostedMailboxEnvelopeTx: vi.fn(async (input: {
      envelope: { eventId: string; userId: string };
    }) => {
      await state.appendHostedMailboxEnvelope(input);
      return {
        dedupeConflict: false,
        duplicate: false,
        inserted: true,
        item: {
          id: "mailbox_123",
          userId: input.envelope.userId,
        },
      };
    }),
  };

  return state;
});

const ROUTING_INDEX_KEY = Buffer.alloc(32, 1);

vi.mock("@murphai/device-syncd/public-ingress", async () => {
  const actual = await vi.importActual<typeof import("@murphai/device-syncd/public-ingress")>("@murphai/device-syncd/public-ingress");
  return {
    ...actual,
    createDeviceSyncPublicIngress: mocks.createDeviceSyncPublicIngress,
    deviceSyncError: actual.deviceSyncError,
    isDeviceSyncError: actual.isDeviceSyncError,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => mocks.prisma),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedDeviceSyncBackgroundMaintenanceRuntime:
    mocks.signalHostedDeviceSyncBackgroundMaintenanceRuntime,
  signalHostedDeviceSyncMailboxRuntime: mocks.signalHostedDeviceSyncMailboxRuntime,
}));

vi.mock("@/src/lib/device-sync/auth", () => ({
  assertBrowserMutationOrigin: vi.fn(),
  requireAuthenticatedHostedUser: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/env", () => ({
  readHostedDeviceSyncEnvironment: mocks.readHostedDeviceSyncEnvironment.mockImplementation(() => ({
    allowedReturnOrigins: [],
    encryptionKey: "01234567890123456789012345678901",
    encryptionKeyVersion: "v1",
    isProduction: false,
    publicBaseUrl: "https://control.example.test/api/device-sync",
    routingIndexKey: ROUTING_INDEX_KEY,
  })),
}));

function createHostedEnv(overrides: Partial<{
  allowedReturnOrigins: string[];
  encryptionKey: string;
  encryptionKeyVersion: string;
  isProduction: boolean;
  publicBaseUrl: string | null;
  routingIndexKey: Buffer;
}> = {}) {
  return {
    allowedReturnOrigins: [],
    encryptionKey: "01234567890123456789012345678901",
    encryptionKeyVersion: "v1",
    isProduction: false,
    publicBaseUrl: "https://control.example.test/api/device-sync",
    routingIndexKey: ROUTING_INDEX_KEY,
    ...overrides,
  };
}

function buildHostedConnection(
  overrides: Partial<{
    accessTokenExpiresAt: string | null;
    connectedAt: string;
    createdAt: string;
    displayName: string | null;
    externalAccountId: string;
    id: string;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    lastSyncCompletedAt: string | null;
    lastSyncErrorAt: string | null;
    lastSyncStartedAt: string | null;
    lastWebhookAt: string | null;
    metadata: Record<string, unknown>;
    nextReconcileAt: string | null;
    provider: string;
    scopes: string[];
    setupExpiresAt: string | null;
    setupPhase: "pending_link" | "link_returned" | "source_confirmed" | "failed" | null;
    status: "active" | "reauthorization_required" | "disconnected";
    updatedAt: string;
  }> = {},
) {
  return {
    accessTokenExpiresAt: null,
    connectedAt: "2026-03-26T12:00:00.000Z",
    createdAt: "2026-03-26T12:00:00.000Z",
    displayName: "Oura",
    externalAccountId: "acct_sensitive",
    id: "dsc_123",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastSyncStartedAt: null,
    lastWebhookAt: null,
    metadata: {},
    nextReconcileAt: null,
    provider: "oura",
    scopes: ["heartrate"],
    setupExpiresAt: null,
    setupPhase: null,
    status: "active" as const,
    updatedAt: "2026-03-26T12:00:00.000Z",
    ...overrides,
  };
}

function buildStoredConnection(
  overrides: Parameters<typeof buildHostedConnection>[0] = {},
) {
  const connection = buildHostedConnection(overrides);

  return {
    ...connection,
    accessToken: "access-token",
    credential: {
      kind: "oauth_tokens",
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
    },
    disconnectGeneration: 0,
    keyVersion: "v1",
    refreshToken: "refresh-token",
    tokenVersion: 2,
  };
}

function buildProviderConfigStoredConnection(
  overrides: Parameters<typeof buildHostedConnection>[0] = {},
) {
  const connection = buildHostedConnection(overrides);

  return {
    ...connection,
    credential: {
      kind: "provider_config",
      credentialMetadata: {},
      providerConfigKey: "hosted-provider-config",
    },
    disconnectGeneration: 0,
    keyVersion: null,
    tokenVersion: null,
  };
}

function buildDirtyConnectionRecord(overrides: Partial<{
  connectionId: string;
  dirtyRevision: bigint;
  processedRevision: bigint;
  userId: string;
  provider: string;
}> = {}) {
  return {
    connectionId: overrides.connectionId ?? "dsc_123",
    userId: overrides.userId ?? "user-123",
    provider: overrides.provider ?? "oura",
    dirtyRevision: overrides.dirtyRevision ?? 1n,
    processedRevision: overrides.processedRevision ?? 0n,
    firstDirtyAt: "2026-03-26T11:59:00.000Z",
    latestDirtyAt: "2026-03-26T11:59:00.000Z",
    windowStart: "2026-03-19T00:00:00.000Z",
    windowEnd: null,
    eventCount: overrides.dirtyRevision ?? 1n,
    latestTraceId: "trace_123",
    latestEventType: "sleep.updated",
    latestResourceCategory: "daily_sleep",
    sourceProviderCounts: {
      unknown: 1,
    },
    resourceCategoryCounts: {
      reconcile: 1,
    },
    dirtyResources: {},
    createdAt: "2026-03-26T12:00:00.000Z",
    updatedAt: "2026-03-26T12:00:00.000Z",
  };
}

vi.mock("@/src/lib/device-sync/providers", () => ({
  createHostedDeviceSyncRegistry: vi.fn(() => ({
    get: mocks.registryGet,
    list: mocks.registryList,
  })),
  requireHostedDeviceSyncProvider: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/prisma-store", () => ({
  PrismaDeviceSyncControlPlaneStore: class PrismaDeviceSyncControlPlaneStore {
    completeWebhookTrace = mocks.completeWebhookTrace;
    createSignal = mocks.createSignal;
    getConnectionForUser = mocks.getConnectionForUser;
    getConnectionOwnerId = mocks.getConnectionOwnerId;
    hasPendingDirtyConnection = mocks.hasPendingDirtyConnection;
    getDirtyConnection = mocks.getDirtyConnection;
    getStoredConnectionAccountForUser = mocks.getStoredConnectionAccountForUser;
    clearStoredProviderConfigCredential = mocks.clearStoredProviderConfigCredential;
    listConnectionSources = mocks.listConnectionSources;
    listConnectionsForUser = mocks.listConnectionsForUser;
    markConnectionSourcesDisconnected = mocks.markConnectionSourcesDisconnected;
    markDirtyConnectionProcessed = mocks.markDirtyConnectionProcessed;
    persistStoredConnectionTokenBundle = mocks.persistStoredConnectionTokenBundle;
    syncDurableConnectionState = mocks.syncDurableConnectionState;
    upsertDirtyConnection = mocks.upsertDirtyConnection;
    upsertConnectionSource = mocks.upsertConnectionSource;
    withConnectionMutationLock = mocks.withConnectionMutationLock;
    prisma = mocks.prisma;
  },
  generateHostedAgentBearerToken: vi.fn(),
  hostedConnectionRecordArgs: {},
}));

vi.mock("@/src/lib/device-sync/shared", () => ({
  normalizeNullableString: vi.fn((value: unknown) =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null),
  parseInteger: vi.fn(),
  sanitizeHostedRuntimeErrorCode: vi.fn((value: unknown) =>
    typeof value === "string" && value.trim().length > 0
      ? value.trim().replace(/([?&]?(?:access_token|refresh_token|id_token)=)[^\s]+/giu, "$1[redacted]")
      : null),
  sanitizeHostedRuntimeErrorText: vi.fn((value: unknown) =>
    typeof value === "string" && value.trim().length > 0
      ? value
          .replace(/\bBearer\s+\S+/giu, "Bearer [redacted]")
          .replace(/([?&]?(?:access_token|refresh_token|id_token)=)[^\s]+/giu, "$1[redacted]")
      : null),
  sha256Hex: vi.fn(() => "a".repeat(64)),
  toIsoTimestamp: vi.fn(() => "2026-03-26T12:00:00.000Z"),
  toJsonRecord: vi.fn((value: unknown) => value),
}));

import {
  HostedDeviceSyncControlPlane,
  appendHostedDeviceSyncWake,
} from "@/src/lib/device-sync/control-plane";
import {
  appendHostedDeviceSyncScheduledReconcileWake,
} from "@/src/lib/device-sync/wake-service";
import { createHostedBrowserConnectionId } from "@/src/lib/device-sync/public-connection";

function buildPublicConnectionId(connectionId: string): string {
  return createHostedBrowserConnectionId(ROUTING_INDEX_KEY, connectionId);
}

describe("appendHostedDeviceSyncWake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedDeviceSyncEnvironment.mockImplementation(() => createHostedEnv());
    mocks.ensureWebhookSubscriptions.mockResolvedValue(undefined);
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prismaTx) => Promise<unknown>) =>
      callback(mocks.prismaTx),
    );
    mocks.prismaTx.$queryRaw.mockResolvedValue([{ acquired: true }]);
    mocks.createDeviceSyncPublicIngress.mockImplementation((input: {
      hooks?: {
        onConnectionEstablished?: (value: unknown) => Promise<void> | void;
        onLevelDirtyWebhookAlreadySatisfied?: (value: unknown) => Promise<{ accepted: true } | null> | { accepted: true } | null;
        onUnknownWebhook?: (value: unknown) => Promise<void> | void;
        onWebhookAccepted?: (value: unknown) => Promise<void> | void;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(async () => {
        await input.hooks?.onConnectionEstablished?.({
          account: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Oura",
            externalAccountId: "acct_sensitive",
            id: "dsc_123",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: null,
            lastSyncErrorAt: null,
            lastSyncStartedAt: null,
            lastWebhookAt: null,
            metadata: {},
            nextReconcileAt: null,
            provider: "oura",
            scopes: ["heartrate"],
            status: "active",
            updatedAt: "2026-03-26T12:00:00.000Z",
          },
          connection: {
            initialJobs: [],
            nextReconcileAt: null,
            tokens: {
              accessToken: "access-token",
              accessTokenExpiresAt: null,
              refreshToken: "refresh-token",
            },
          },
          now: "2026-03-26T12:00:00.000Z",
          provider: {
            provider: "oura",
            webhookAdmin: {
              ensureSubscriptions: mocks.ensureWebhookSubscriptions,
            },
          },
        });
        return {
          connection: {
            id: "dsc_123",
          },
        };
      }),
      handleWebhook: vi.fn(async () => {
        await input.hooks?.onWebhookAccepted?.({
          account: {
            id: "dsc_123",
            provider: "oura",
            scopes: ["heartrate"],
          },
          now: "2026-03-26T12:00:00.000Z",
          provider: {},
          claimToken: "claim-token",
          traceId: "trace_123",
          webhook: {
            acceptanceMode: "level_dirty_hint",
            eventType: "sleep.updated",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-03-19T00:00:00.000Z",
                  windowEnd: "2026-03-26T00:00:00.000Z",
                },
              },
            ],
            occurredAt: "2026-03-26T11:59:00.000Z",
            resourceCategory: "daily_sleep",
          },
        });
        return {
          accepted: true,
        };
      }),
      startConnection: vi.fn(),
    }));
    mocks.createSignal.mockResolvedValue({ id: 8 });
    mocks.prismaTx.deviceSyncSignal.create.mockResolvedValue({ id: 8 });
    mocks.completeWebhookTrace.mockResolvedValue(true);
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.signalHostedDeviceSyncMailboxRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:user-123",
    });
    mocks.signalHostedDeviceSyncBackgroundMaintenanceRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:user-123",
    });
    mocks.appendHostedMailboxEnvelope.mockResolvedValue(undefined);
    mocks.getConnectionForUser.mockResolvedValue(buildHostedConnection());
    mocks.getConnectionOwnerId.mockResolvedValue("user-123");
    mocks.hasPendingDirtyConnection.mockResolvedValue(false);
    mocks.upsertDirtyConnection.mockResolvedValue({
      dirty: buildDirtyConnectionRecord(),
      shouldRequestWake: true,
    });
    mocks.getDirtyConnection.mockResolvedValue(null);
    mocks.markDirtyConnectionProcessed.mockResolvedValue(null);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(buildStoredConnection());
    mocks.listConnectionSources.mockResolvedValue([]);
    mocks.listConnectionsForUser.mockResolvedValue([]);
    mocks.markConnectionSourcesDisconnected.mockResolvedValue(0);
    mocks.clearStoredProviderConfigCredential.mockResolvedValue(true);
    mocks.persistStoredConnectionTokenBundle.mockResolvedValue(undefined);
    mocks.registryGet.mockReturnValue(undefined);
    mocks.registryList.mockReturnValue([]);
    mocks.withConnectionMutationLock.mockImplementation(async (
      _connectionId: string,
      callback: (tx: typeof mocks.prismaTx) => Promise<unknown>,
    ) => callback(mocks.prismaTx));
  });

  it("requires an explicit hosted public base URL in production instead of trusting the request host", () => {
    mocks.readHostedDeviceSyncEnvironment.mockImplementation(() => createHostedEnv({
      isProduction: true,
      publicBaseUrl: null,
    }));

    expect(() => new HostedDeviceSyncControlPlane(
      new Request("https://attacker.example/api/settings/device-sync"),
    )).toThrow(
      "Hosted device-sync public callback and webhook routes require DEVICE_SYNC_PUBLIC_BASE_URL or a canonical hosted public URL in production.",
    );
  });

  it("does not implicitly allow callback redirects back to the request host when a canonical public base URL is configured", () => {
    mocks.readHostedDeviceSyncEnvironment.mockImplementation(() => createHostedEnv({
      allowedReturnOrigins: ["https://app.example.test"],
      publicBaseUrl: "https://control.example.test/api/device-sync",
    }));

    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://preview.example.test/api/settings/device-sync"),
    );

    expect(controlPlane.allowedReturnOrigins).toEqual([
      "https://control.example.test",
      "https://app.example.test",
    ]);
  });

  it("keeps localhost-style development fallbacks bound to the active request origin", () => {
    mocks.readHostedDeviceSyncEnvironment.mockImplementation(() => createHostedEnv({
      publicBaseUrl: null,
    }));

    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("http://localhost:3000/api/settings/device-sync"),
    );

    expect(controlPlane.publicIngressBaseUrl).toBe("http://localhost:3000/api/device-sync");
    expect(controlPlane.allowedReturnOrigins).toEqual(["http://localhost:3000"]);
  });

  it("wakes hosted execution with a dedicated device-sync wake event for connection events", async () => {
    await appendHostedDeviceSyncWake({
      connectionId: "dsc_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      source: "connection-established",
      userId: "user-123",
    });

    expect(mocks.createSignal).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:00:00.000Z",
      eventType: null,
      kind: "connected",
      nextReconcileAt: null,
      occurredAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      reason: null,
      resourceCategory: null,
      revokeWarning: null,
      traceId: null,
      tx: mocks.prismaTx,
      userId: "user-123",
    });
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          connectionId: "dsc_123",
          hint: {
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
          eventId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
          kind: "device-sync.wake",
          occurredAt: "2026-03-26T12:00:00.000Z",
          provider: "oura",
          reason: "connected",
          userId: "user-123",
        }),
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      recoveryIntent: null,
    });
  });

  it("signals the hosted user runtime after appending the wake", async () => {
    await expect(appendHostedDeviceSyncWake({
      connectionId: "dsc_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      source: "connection-established",
      userId: "user-123",
    })).resolves.toEqual({
      wakeAppended: true,
    });

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      recoveryIntent: null,
    });
  });

  it("uses explicit scheduled wake identity and created time for inserted due-reconcile signals", async () => {
    await appendHostedDeviceSyncScheduledReconcileWake({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:01:00.000Z",
      eventId: "device-sync:scheduled-reconcile:abc123",
      nextReconcileAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      userId: "user-123",
    });

    expect(mocks.createSignal).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:01:00.000Z",
      eventType: null,
      kind: "reconcile_due",
      nextReconcileAt: "2026-03-26T12:00:00.000Z",
      occurredAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      reason: null,
      resourceCategory: null,
      revokeWarning: null,
      traceId: null,
      userId: "user-123",
    });
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "device-sync:scheduled-reconcile:abc123",
          reason: "reconcile_due",
        }),
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      recoveryIntent: "device-sync-reconcile-recovery",
    });
  });

  it("re-signals duplicate due-reconcile wakes and records the successful due claim", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: true,
      inserted: false,
      item: {
        id: "mailbox_existing",
        userId: "user-123",
      },
    });

    await expect(appendHostedDeviceSyncScheduledReconcileWake({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:01:00.000Z",
      eventId: "device-sync:scheduled-reconcile:abc123",
      nextReconcileAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      userId: "user-123",
    })).resolves.toEqual({
      wakeAccepted: true,
      wakeAppended: false,
      wakeDuplicate: true,
      wakeInserted: false,
    });

    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_existing",
      recoveryIntent: "device-sync-reconcile-recovery",
    });
    expect(mocks.createSignal).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:01:00.000Z",
      eventType: null,
      kind: "reconcile_due",
      nextReconcileAt: "2026-03-26T12:00:00.000Z",
      occurredAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      reason: null,
      resourceCategory: null,
      revokeWarning: null,
      traceId: null,
      userId: "user-123",
    });
  });

  it("surfaces duplicate due-reconcile dedupe conflicts without writing signals or Temporal signals", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValueOnce({
      dedupeConflict: true,
      duplicate: true,
      inserted: false,
      item: {
        id: "mailbox_existing",
        userId: "user-123",
      },
    });

    await expect(appendHostedDeviceSyncScheduledReconcileWake({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:01:00.000Z",
      eventId: "device-sync:scheduled-reconcile:abc123",
      nextReconcileAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      userId: "user-123",
    })).resolves.toEqual({
      reason: "dedupe_conflict",
      wakeAccepted: false,
      wakeAppended: false,
      wakeDuplicate: false,
      wakeInserted: false,
    });

    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("keeps committed wakes when the post-commit Temporal signal fails", async () => {
    mocks.signalHostedDeviceSyncMailboxRuntime.mockRejectedValue(new Error("Temporal unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(appendHostedDeviceSyncWake({
        connectionId: "dsc_123",
        occurredAt: "2026-03-26T12:00:00.000Z",
        provider: "oura",
        source: "connection-established",
        userId: "user-123",
      })).resolves.toEqual({
        wakeAppended: true,
      });

      expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "Hosted device-sync wake Temporal signal failed after mailbox append.",
        {
          code: "HOSTED_DEVICE_SYNC_TEMPORAL_SIGNAL_FAILED",
          mailboxItemIdPresent: true,
        },
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("surfaces scheduled recovery Temporal signal failures before recording the due claim", async () => {
    mocks.signalHostedDeviceSyncMailboxRuntime.mockRejectedValue(new Error("Temporal unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(appendHostedDeviceSyncScheduledReconcileWake({
        connectionId: "dsc_123",
        createdAt: "2026-03-26T12:01:00.000Z",
        eventId: "device-sync:scheduled-reconcile:abc123",
        nextReconcileAt: "2026-03-26T12:00:00.000Z",
        provider: "oura",
        userId: "user-123",
      })).rejects.toThrow("Temporal unavailable");

      expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
      expect(mocks.createSignal).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        "Hosted device-sync wake Temporal signal failed after mailbox append.",
        {
          code: "HOSTED_DEVICE_SYNC_TEMPORAL_SIGNAL_FAILED",
          mailboxItemIdPresent: true,
        },
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("uses the dedicated device-sync wake path for disconnect events", async () => {
    await appendHostedDeviceSyncWake({
      connectionId: "dsc_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      source: "disconnect",
      userId: "user-123",
    });

    expect(mocks.createSignal).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:00:00.000Z",
      eventType: null,
      kind: "disconnected",
      nextReconcileAt: null,
      occurredAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      reason: null,
      resourceCategory: null,
      revokeWarning: null,
      traceId: null,
      tx: mocks.prismaTx,
      userId: "user-123",
    });
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          connectionId: "dsc_123",
          hint: {
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
          eventId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
          kind: "device-sync.wake",
          occurredAt: "2026-03-26T12:00:00.000Z",
          provider: "oura",
          reason: "disconnected",
          userId: "user-123",
        }),
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      recoveryIntent: null,
    });
  });

  it("queues a disconnected signal and wake together inside the disconnect flow", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const activeConnection = buildHostedConnection({
      setupExpiresAt: "2026-03-26T12:30:00.000Z",
      setupPhase: "pending_link",
    });
    const disconnectedConnection = buildHostedConnection({
      status: "disconnected",
    });
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(disconnectedConnection);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).resolves.toMatchObject({
      connection: {
        id: publicConnectionId,
        provider: "oura",
        status: "disconnected",
      },
    });
    expect(mocks.createSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "dsc_123",
        createdAt: "2026-03-26T12:00:00.000Z",
        kind: "disconnected",
        occurredAt: "2026-03-26T12:00:00.000Z",
        provider: "oura",
        reason: "user_disconnect",
        revokeWarning: null,
        tx: mocks.prismaTx,
        userId: "user-123",
      }),
    );
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dsc_123",
        setupExpiresAt: null,
        setupPhase: null,
        status: "disconnected",
      }),
      mocks.prismaTx,
    );
    expect(mocks.markConnectionSourcesDisconnected).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      now: "2026-03-26T12:00:00.000Z",
      tx: mocks.prismaTx,
    });
    expect(mocks.persistStoredConnectionTokenBundle).toHaveBeenCalledWith({
      clearRefreshLease: true,
      connectionId: "dsc_123",
      externalAccountId: "acct_sensitive",
      provider: "oura",
      tokenBundle: null,
      tx: mocks.prismaTx,
    });
    expect(mocks.syncDurableConnectionState.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.appendHostedMailboxEnvelope.mock.invocationCallOrder[0],
    );
    expect(mocks.markConnectionSourcesDisconnected.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.appendHostedMailboxEnvelope.mock.invocationCallOrder[0],
    );
    expect(mocks.persistStoredConnectionTokenBundle.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.appendHostedMailboxEnvelope.mock.invocationCallOrder[0],
    );
    expect(mocks.createSignal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.appendHostedMailboxEnvelope.mock.invocationCallOrder[0],
    );
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
        }),
        tx: mocks.prismaTx,
      }),
    );
  });

  it("re-reads inside the connection mutation lock before clearing refreshed tokens", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const beforeRefresh = buildHostedConnection({
      accessTokenExpiresAt: "2026-03-26T12:05:00.000Z",
      lastSyncCompletedAt: null,
      nextReconcileAt: "2026-03-26T12:10:00.000Z",
    });
    const afterRefresh = buildHostedConnection({
      accessTokenExpiresAt: "2026-03-26T13:00:00.000Z",
      lastSyncCompletedAt: "2026-03-26T12:01:00.000Z",
      nextReconcileAt: "2026-03-26T13:10:00.000Z",
      updatedAt: "2026-03-26T12:01:00.000Z",
    });
    const beforeRefreshStored = buildStoredConnection({
      accessTokenExpiresAt: "2026-03-26T12:05:00.000Z",
    });
    const afterRefreshStored = buildStoredConnection({
      accessTokenExpiresAt: "2026-03-26T13:00:00.000Z",
      updatedAt: "2026-03-26T12:01:00.000Z",
    });
    mocks.listConnectionsForUser.mockResolvedValue([beforeRefresh]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(beforeRefresh)
      .mockResolvedValueOnce(afterRefresh);
    mocks.getStoredConnectionAccountForUser
      .mockResolvedValueOnce(beforeRefreshStored)
      .mockResolvedValueOnce(afterRefreshStored);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).resolves.toMatchObject({
      connection: {
        id: publicConnectionId,
        status: "disconnected",
      },
    });

    expect(mocks.withConnectionMutationLock).toHaveBeenCalledWith("dsc_123", expect.any(Function));
    expect(mocks.getConnectionForUser).toHaveBeenNthCalledWith(2, "user-123", "dsc_123", mocks.prismaTx);
    expect(mocks.getStoredConnectionAccountForUser).toHaveBeenNthCalledWith(2, "user-123", "dsc_123", mocks.prismaTx);
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledWith(
      expect.objectContaining({
        accessTokenExpiresAt: null,
        id: "dsc_123",
        lastSyncCompletedAt: "2026-03-26T12:01:00.000Z",
        nextReconcileAt: null,
        status: "disconnected",
      }),
      mocks.prismaTx,
    );
    expect(mocks.persistStoredConnectionTokenBundle).toHaveBeenCalledWith({
      clearRefreshLease: true,
      connectionId: "dsc_123",
      externalAccountId: afterRefreshStored.externalAccountId,
      provider: "oura",
      tokenBundle: null,
      tx: mocks.prismaTx,
    });
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
  });

  it("revokes active provider-config connections during hosted disconnect", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const activeConnection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
    });
    const storedConnection = buildProviderConfigStoredConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
    });
    const revokeAccess = vi.fn(async () => {});
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeAccess,
      },
    });
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(activeConnection);
    mocks.getStoredConnectionAccountForUser
      .mockResolvedValueOnce(storedConnection)
      .mockResolvedValueOnce(storedConnection);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).resolves.toMatchObject({
      connection: {
        id: publicConnectionId,
        provider: "junction",
        status: "disconnected",
      },
    });

    expect(revokeAccess).toHaveBeenCalledTimes(1);
    expect(revokeAccess).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({
        kind: "provider_config",
        providerConfigKey: "hosted-provider-config",
      }),
      externalAccountId: "junction-user-123",
      provider: "junction",
    }));
    expect(mocks.clearStoredProviderConfigCredential).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      externalAccountId: "junction-user-123",
      provider: "junction",
      tx: mocks.prismaTx,
      providerConfigKey: "hosted-provider-config",
      userId: "user-123",
    });
  });

  it("fails closed when revoked provider-config credential cleanup loses its fence", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const activeConnection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
    });
    const storedConnection = buildProviderConfigStoredConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
    });
    const revokeAccess = vi.fn(async () => {});
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeAccess,
      },
    });
    mocks.clearStoredProviderConfigCredential.mockResolvedValueOnce(false);
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(activeConnection);
    mocks.getStoredConnectionAccountForUser
      .mockResolvedValueOnce(storedConnection)
      .mockResolvedValueOnce(storedConnection);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).rejects.toMatchObject({
      code: "CONNECTION_CHANGED_DURING_DISCONNECT",
      httpStatus: 409,
      retryable: true,
    });

    expect(revokeAccess).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("does not append duplicate disconnect wakes for disconnected tokenless provider-config connections", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const disconnectedConnection = buildHostedConnection({
      status: "disconnected",
    });
    mocks.listConnectionsForUser.mockResolvedValue([disconnectedConnection]);
    mocks.getConnectionForUser.mockResolvedValue(disconnectedConnection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(buildProviderConfigStoredConnection({
      status: "disconnected",
    }));
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).resolves.toMatchObject({
      connection: {
        id: publicConnectionId,
        status: "disconnected",
      },
    });

    expect(mocks.withConnectionMutationLock).toHaveBeenCalledWith("dsc_123", expect.any(Function));
    expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("retries remote revoke for disconnected provider-config connections without appending duplicate wakes", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const disconnectedConnection = buildHostedConnection({
      provider: "junction",
      status: "disconnected",
    });
    const storedConnection = buildProviderConfigStoredConnection({
      externalAccountId: "junction-user-123",
      provider: "junction",
      status: "disconnected",
    });
    const revokeAccess = vi.fn(async () => {});
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeAccess,
      },
    });
    mocks.listConnectionsForUser.mockResolvedValue([disconnectedConnection]);
    mocks.getConnectionForUser.mockResolvedValue(disconnectedConnection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).resolves.toMatchObject({
      connection: {
        id: publicConnectionId,
        status: "disconnected",
      },
    });

    expect(revokeAccess).toHaveBeenCalledTimes(1);
    expect(revokeAccess).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({
        kind: "provider_config",
      }),
      externalAccountId: "junction-user-123",
      provider: "junction",
    }));
    expect(mocks.clearStoredProviderConfigCredential).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      externalAccountId: "junction-user-123",
      provider: "junction",
      tx: mocks.prismaTx,
      providerConfigKey: "hosted-provider-config",
      userId: "user-123",
    });
    expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("sanitizes revoke failures before they fan out to runtime state, signals, dispatches, and the browser response", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const activeConnection = buildHostedConnection();
    const disconnectedConnection = buildHostedConnection({
      lastErrorCode: "PROVIDER_REVOKE_FAILED",
      lastErrorMessage: "authorization=[redacted] refresh_token=[redacted]",
      status: "disconnected",
    });
    const revokeAccess = vi.fn(async () => {
      throw new Error("authorization=Bearer secret-token refresh_token=refresh-secret");
    });
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeAccess,
      },
    });
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(disconnectedConnection);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).resolves.toMatchObject({
      connection: {
        id: publicConnectionId,
        status: "disconnected",
      },
      warning: {
        code: "PROVIDER_REVOKE_FAILED",
        message: "authorization=[redacted] refresh_token=[redacted]",
      },
    });

    expect(revokeAccess).toHaveBeenCalledTimes(1);
    expect(mocks.createSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        revokeWarning: {
          code: "PROVIDER_REVOKE_FAILED",
          message: "authorization=[redacted] refresh_token=[redacted]",
        },
      }),
    );
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          hint: expect.objectContaining({
            revokeWarning: {
              code: "PROVIDER_REVOKE_FAILED",
              message: "authorization=[redacted] refresh_token=[redacted]",
            },
          }),
        }),
      }),
    );
  });

  it("fails disconnect when the runtime no longer has provider identity to reseed", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const activeConnection = buildHostedConnection();
    const disconnectedConnection = buildHostedConnection({
      status: "disconnected",
    });
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(disconnectedConnection);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    mocks.getStoredConnectionAccountForUser.mockResolvedValueOnce(null);

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).resolves.toMatchObject({
      connection: {
        id: publicConnectionId,
        status: "disconnected",
      },
    });

    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
  });

  it("returns opaque browser connection ids and omits external account ids from browser reads", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync"),
    );
    mocks.listConnectionsForUser.mockResolvedValue([
      buildHostedConnection({
        displayName: "Oura acct_sensitive",
      }),
    ]);
    mocks.listConnectionSources.mockResolvedValueOnce([
      {
        id: "src_123",
        connectionId: "dsc_123",
        sourceInstanceKey: "jxn_hidden",
        sourceProviderSlug: "oura",
        displayName: null,
        status: "connected",
        resourceAvailabilitySummary: {
          heartrate: true,
          sourceInstanceKeyFallback: true,
        },
        lastErrorCode: null,
        lastErrorMessage: null,
        firstSeenAt: "2026-03-26T12:00:00.000Z",
        lastSeenAt: "2026-03-26T12:00:00.000Z",
        createdAt: "2026-03-26T12:00:00.000Z",
        updatedAt: "2026-03-26T12:00:00.000Z",
      },
    ]);

    await expect(controlPlane.listConnections("user-123")).resolves.toEqual({
      providers: [],
      connections: [
        {
          id: buildPublicConnectionId("dsc_123"),
          provider: "oura",
          displayName: "Oura",
          status: "active",
          scopes: ["heartrate"],
          accessTokenExpiresAt: null,
          metadata: {},
          connectedAt: "2026-03-26T12:00:00.000Z",
          setupExpiresAt: null,
          setupPhase: null,
          lastWebhookAt: null,
          lastSyncStartedAt: null,
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          nextReconcileAt: null,
          createdAt: "2026-03-26T12:00:00.000Z",
          updatedAt: "2026-03-26T12:00:00.000Z",
        },
      ],
      connectionSources: [
        {
          connectionId: buildPublicConnectionId("dsc_123"),
          firstSeenAt: "2026-03-26T12:00:00.000Z",
          lastSeenAt: "2026-03-26T12:00:00.000Z",
          resourceCount: 1,
          sourceProviderSlug: "oura",
          status: "connected",
        },
      ],
    });
  });

  it("resolves browser status reads through the opaque browser connection id", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dspc_demo/status"),
    );
    mocks.listConnectionsForUser.mockResolvedValue([
      buildHostedConnection({
        displayName: "Oura acct_sensitive",
      }),
    ]);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    await expect(controlPlane.getConnectionStatus("user-123", publicConnectionId)).resolves.toEqual({
      connection: {
        id: publicConnectionId,
        provider: "oura",
        displayName: "Oura",
        status: "active",
        scopes: ["heartrate"],
        accessTokenExpiresAt: null,
        metadata: {},
        connectedAt: "2026-03-26T12:00:00.000Z",
        setupExpiresAt: null,
        setupPhase: null,
        lastWebhookAt: null,
        lastSyncStartedAt: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextReconcileAt: null,
        createdAt: "2026-03-26T12:00:00.000Z",
        updatedAt: "2026-03-26T12:00:00.000Z",
      },
    });
  });

  it("dispatches a wake from the connected ingress hook when an owner exists", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
    );

    await controlPlane.handleOAuthCallback("oura");

    expect(mocks.createSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "dsc_123",
        createdAt: "2026-03-26T12:00:00.000Z",
        kind: "connected",
        nextReconcileAt: null,
        occurredAt: "2026-03-26T12:00:00.000Z",
        provider: "oura",
        tx: mocks.prismaTx,
        userId: "user-123",
      }),
    );
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          connectionId: "dsc_123",
          hint: {
            jobs: [],
            nextReconcileAt: null,
            occurredAt: "2026-03-26T12:00:00.000Z",
            scopes: ["heartrate"],
          },
          eventId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
          kind: "device-sync.wake",
          occurredAt: "2026-03-26T12:00:00.000Z",
          provider: "oura",
          reason: "connected",
          userId: "user-123",
        }),
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.ensureWebhookSubscriptions).toHaveBeenCalledWith({
      publicBaseUrl: "https://control.example.test/api/device-sync",
    });
  });

  it("durably upserts a Junction source row from the connected ingress hook", async () => {
    mocks.createDeviceSyncPublicIngress.mockImplementationOnce((input: {
      hooks?: {
        onConnectionEstablished?: (value: unknown) => Promise<void> | void;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(async () => {
        await input.hooks?.onConnectionEstablished?.({
          account: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Junction",
            externalAccountId: "junction-user-1",
            id: "dsc_junction",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: null,
            lastSyncErrorAt: null,
            lastSyncStartedAt: null,
            lastWebhookAt: null,
            metadata: {},
            nextReconcileAt: null,
            provider: "junction",
            scopes: [],
            status: "active",
            updatedAt: "2026-03-26T12:00:00.000Z",
          },
          connectSourceId: "garmin",
          connectTarget: "garmin",
          connection: {
            initialJobs: [],
            nextReconcileAt: null,
          },
          now: "2026-03-26T12:00:00.000Z",
          provider: {
            provider: "junction",
          },
        });
        return {
          connection: {
            id: "dsc_junction",
          },
        };
      }),
      handleWebhook: vi.fn(),
      startConnection: vi.fn(),
    }));
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/connect/junction/callback?state=xyz"),
    );

    await controlPlane.handleConnectionCallback("junction");

    expect(mocks.upsertConnectionSource).toHaveBeenCalledWith({
      connectionId: "dsc_junction",
      firstSeenAt: "2026-03-26T12:00:00.000Z",
      lastSeenAt: "2026-03-26T12:00:00.000Z",
      sourceInstanceKey: expect.stringMatching(/^jxn_src_[a-f0-9]{32}$/u),
      sourceProviderSlug: "garmin",
      status: "connected",
      tx: mocks.prismaTx,
    });
    const sourceInstanceKey = mocks.upsertConnectionSource.mock.calls[0]?.[0]?.sourceInstanceKey;
    expect(sourceInstanceKey).not.toMatch(/dsc|junction|garmin/u);
  });

  it("reuses the same Junction source row key for repeated slugs and keeps distinct slugs separate", async () => {
    const upsertedSourceKeys: Array<{ sourceInstanceKey: string; sourceProviderSlug: string }> = [];
    const connectTargets: Array<"garmin" | "garmin" | "peloton"> = ["garmin", "garmin", "peloton"];

    mocks.getConnectionOwnerId.mockResolvedValue("user-123");
    mocks.createDeviceSyncPublicIngress.mockImplementation((input: {
      hooks?: {
        onConnectionEstablished?: (value: unknown) => Promise<void> | void;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(async () => {
        const connectTarget = connectTargets.shift() ?? null;
        await input.hooks?.onConnectionEstablished?.({
          account: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Junction",
            externalAccountId: "junction-user-1",
            id: "dsc_junction",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: null,
            lastSyncErrorAt: null,
            lastSyncStartedAt: null,
            lastWebhookAt: null,
            metadata: {},
            nextReconcileAt: null,
            provider: "junction",
            scopes: [],
            status: "active",
            updatedAt: "2026-03-26T12:00:00.000Z",
          },
          connectSourceId: connectTarget,
          connectTarget,
          connection: {
            initialJobs: [],
            nextReconcileAt: null,
          },
          now: connectTarget === "peloton"
            ? "2026-03-26T12:10:00.000Z"
            : "2026-03-26T12:00:00.000Z",
          provider: {
            provider: "junction",
          },
        });
        return {
          connection: {
            id: "dsc_junction",
          },
        };
      }),
      handleWebhook: vi.fn(),
      startConnection: vi.fn(),
    }));
    mocks.upsertConnectionSource.mockImplementation(async (input: {
      connectionId: string;
      firstSeenAt: string;
      lastSeenAt: string;
      sourceInstanceKey: string;
      sourceProviderSlug: string;
      status: "connected";
      tx: typeof mocks.prismaTx;
    }) => {
      upsertedSourceKeys.push({
        sourceInstanceKey: input.sourceInstanceKey,
        sourceProviderSlug: input.sourceProviderSlug,
      });
      return {
        id: `src_${String(upsertedSourceKeys.length).padStart(2, "0")}`,
        connectionId: input.connectionId,
        sourceInstanceKey: input.sourceInstanceKey,
        sourceProviderSlug: input.sourceProviderSlug,
        displayName: null,
        status: input.status,
        resourceAvailabilitySummary: {},
        lastErrorCode: null,
        lastErrorMessage: null,
        firstSeenAt: input.firstSeenAt,
        lastSeenAt: input.lastSeenAt,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
    });
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/oauth/junction/callback?code=abc&state=xyz"),
    );

    await controlPlane.handleOAuthCallback("junction");
    await controlPlane.handleOAuthCallback("junction");
    await controlPlane.handleOAuthCallback("junction");

    expect(upsertedSourceKeys).toHaveLength(3);
    expect(upsertedSourceKeys[0]?.sourceProviderSlug).toBe("garmin");
    expect(upsertedSourceKeys[1]?.sourceProviderSlug).toBe("garmin");
    expect(upsertedSourceKeys[2]?.sourceProviderSlug).toBe("peloton");
    expect(upsertedSourceKeys[0]?.sourceInstanceKey).toBe(upsertedSourceKeys[1]?.sourceInstanceKey);
    expect(upsertedSourceKeys[2]?.sourceInstanceKey).not.toBe(upsertedSourceKeys[0]?.sourceInstanceKey);
    expect(upsertedSourceKeys[0]?.sourceInstanceKey).toMatch(/^jxn_src_[a-f0-9]{32}$/u);
    expect(upsertedSourceKeys[0]?.sourceInstanceKey ?? "").not.toMatch(/dsc|junction|garmin|peloton/u);
  });

  it("keeps connect-time webhook upkeep best-effort when provider admin throws before returning a promise", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.ensureWebhookSubscriptions.mockImplementation(() => {
      throw new Error("sync upkeep failure");
    });
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
    );

    await expect(controlPlane.handleOAuthCallback("oura")).resolves.toEqual({
      connection: {
        id: "dsc_123",
      },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to ensure hosted webhook admin upkeep.",
      expect.objectContaining({
        publicIngressBaseUrlSource: "configured",
        provider: "oura",
        reason: "connection-established",
        errorMessage: "sync upkeep failure",
        errorType: "Error",
      }),
    );
  });

  it("wires an unknown webhook hook so verified orphan deliveries can be accepted", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", {
        method: "POST",
        body: "{}",
      }),
    );
    const ingressInput = mocks.createDeviceSyncPublicIngress.mock.calls.at(-1)?.[0] as {
      hooks?: {
        onUnknownWebhook?: (value: {
          externalAccountId: string;
          now: string;
          provider: { provider: string };
          traceId: string;
          webhook: {
            acceptanceMode: "level_dirty_hint" | "durable_webhook_work";
            eventType: string;
            jobs: Array<{
              kind: "reconcile";
              payload: {
                windowStart: string;
                windowEnd: string;
              };
            }>;
            resourceCategory: string | null;
          };
        }) => Promise<void> | void;
      };
    } | undefined;

    await ingressInput?.hooks?.onUnknownWebhook?.({
      externalAccountId: "junction-user-old",
      now: "2026-03-26T12:00:00.000Z",
      provider: { provider: "junction" },
      traceId: "trace_old",
      webhook: {
        acceptanceMode: "level_dirty_hint",
        eventType: "daily.data.steps.updated",
        jobs: [
          {
            kind: "reconcile",
            payload: {
              windowStart: "2026-03-19T00:00:00.000Z",
              windowEnd: "2026-03-26T00:00:00.000Z",
            },
          },
        ],
        resourceCategory: "timeseries",
      },
    });

    expect(consoleWarn).toHaveBeenCalledWith("Accepted orphan hosted device-sync webhook.", {
      externalAccountIdHash: "a".repeat(64),
      eventType: "daily.data.steps.updated",
      provider: "junction",
      resourceCategory: "timeseries",
      traceId: "trace_old",
    });
    consoleWarn.mockRestore();
  });

  it("persists dirty state before sparse webhook audit and nudges background maintenance only for dirty transitions", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({
          event: "sleep.updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await controlPlane.handleWebhook("oura");

    const signalInput = mocks.createSignal.mock.calls[0]?.[0];
    expect(mocks.createSignal).toHaveBeenCalledWith(
      {
        connectionId: "dsc_123",
        kind: "webhook_hint",
        eventType: "sleep.updated",
        occurredAt: "2026-03-26T11:59:00.000Z",
        resourceCategory: "daily_sleep",
        traceId: "trace_123",
        userId: "user-123",
        provider: "oura",
        createdAt: "2026-03-26T12:00:00.000Z",
        tx: mocks.prismaTx,
      },
    );
    expect(JSON.stringify(signalInput ?? {})).not.toContain("provider-secret-token");
    expect(JSON.stringify(signalInput ?? {})).not.toContain("123-45-6789");
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      dirtyAt: "2026-03-26T11:59:00.000Z",
      eventType: "sleep.updated",
      provider: "oura",
      resourceCategory: "daily_sleep",
      resources: [
        {
          count: 1,
          jobKind: "reconcile",
          payload: {
            windowStart: "2026-03-19T00:00:00.000Z",
            windowEnd: "2026-03-26T00:00:00.000Z",
          },
          resource: null,
          resourceCategory: null,
          sourceProviderSlug: null,
          windowEnd: "2026-03-26T00:00:00.000Z",
          windowStart: "2026-03-19T00:00:00.000Z",
        },
      ],
      traceId: "trace_123",
      tx: mocks.prismaTx,
      userId: "user-123",
    });
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", "claim-token", mocks.prismaTx);
    expect(mocks.upsertDirtyConnection.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createSignal.mock.invocationCallOrder[0],
    );
    expect(mocks.createSignal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completeWebhookTrace.mock.invocationCallOrder[0],
    );
    expect(mocks.completeWebhookTrace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signalHostedDeviceSyncBackgroundMaintenanceRuntime.mock.invocationCallOrder[0],
    );
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncBackgroundMaintenanceRuntime).toHaveBeenCalledWith({
      userId: "user-123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("completes hosted webhook traces when audit and dirty state commit", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({
          event: "sleep.updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await controlPlane.handleWebhook("oura");

    expect(mocks.signalHostedDeviceSyncBackgroundMaintenanceRuntime).toHaveBeenCalledWith({
      userId: "user-123",
    });
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", "claim-token", mocks.prismaTx);
  });

  it("does not rewrite dirty state when a level-triggered hint is already pending inside acceptance", async () => {
    mocks.hasPendingDirtyConnection.mockResolvedValueOnce(true);
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({
          event: "sleep.updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("oura")).resolves.toMatchObject({
      accepted: true,
    });

    expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(1);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", "claim-token", mocks.prismaTx);
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncBackgroundMaintenanceRuntime).not.toHaveBeenCalled();
  });

  it("coalesces level-triggered webhooks after committed dirty state exists", async () => {
    mocks.hasPendingDirtyConnection.mockResolvedValueOnce(true);
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({
          event: "sleep.updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("oura")).resolves.toMatchObject({
      accepted: true,
    });

    expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(1);
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncBackgroundMaintenanceRuntime).not.toHaveBeenCalled();
  });

  it("accepts level-triggered webhooks before dirty state commits", async () => {
    mocks.hasPendingDirtyConnection.mockResolvedValueOnce(false);
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({
          event: "sleep.updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("oura")).resolves.toMatchObject({
      accepted: true,
    });

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createSignal).toHaveBeenCalledTimes(1);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", "claim-token", mocks.prismaTx);
  });

  it("keeps hosted webhook traces completed when the post-commit background nudge fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.signalHostedDeviceSyncBackgroundMaintenanceRuntime.mockRejectedValueOnce(new Error("Temporal unavailable"));
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({
          event: "sleep.updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    try {
      await expect(controlPlane.handleWebhook("oura")).resolves.toMatchObject({
        accepted: true,
      });

      expect(mocks.createSignal).toHaveBeenCalledTimes(1);
      expect(mocks.signalHostedDeviceSyncBackgroundMaintenanceRuntime).toHaveBeenCalledWith({
        userId: "user-123",
      });
      expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
      expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
      expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(1);
      expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", "claim-token", mocks.prismaTx);
      expect(consoleWarn).toHaveBeenCalledWith(
        "Hosted device-sync dirty background maintenance signal failed after webhook acceptance.",
        expect.objectContaining({
          code: "HOSTED_DEVICE_SYNC_BACKGROUND_MAINTENANCE_SIGNAL_FAILED",
          traceIdPresent: true,
          userIdPresent: true,
        }),
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("coalesces a historical webhook burst into one dirty row and one device-sync wake while the connection stays dirty", async () => {
    let traceIndex = 0;
    mocks.createDeviceSyncPublicIngress.mockImplementation((input: {
      hooks?: {
        onLevelDirtyWebhookAlreadySatisfied?: (value: unknown) => Promise<{ accepted: true } | null> | { accepted: true } | null;
        onWebhookAccepted?: (value: unknown) => Promise<void> | void;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(),
      handleWebhook: vi.fn(async () => {
        traceIndex += 1;
        const acceptedInput = {
          account: {
            id: "dsc_123",
            provider: "oura",
            scopes: ["heartrate"],
          },
          now: "2026-03-26T12:00:00.000Z",
          provider: {},
          traceId: `trace_burst_${traceIndex}`,
          webhook: {
            acceptanceMode: "level_dirty_hint",
            eventType: traceIndex % 2 === 0 ? "sleep.updated" : "activity.updated",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-03-19T00:00:00.000Z",
                  windowEnd: "2026-03-26T00:00:00.000Z",
                },
              },
            ],
            occurredAt: "2026-03-26T11:59:00.000Z",
            resourceCategory: traceIndex % 2 === 0 ? "sleep" : "activity",
          },
        };
        const alreadySatisfied = await input.hooks?.onLevelDirtyWebhookAlreadySatisfied?.(acceptedInput);
        if (alreadySatisfied?.accepted === true) {
          return {
            accepted: true,
          };
        }

        await input.hooks?.onWebhookAccepted?.(acceptedInput);
        return {
          accepted: true,
        };
      }),
      startConnection: vi.fn(),
    }));
    let dirtyRevision = 0n;
    mocks.upsertDirtyConnection.mockImplementation(async () => {
      dirtyRevision += 1n;
      return {
        dirty: buildDirtyConnectionRecord({
          dirtyRevision,
        }),
        shouldRequestWake: dirtyRevision === 1n,
      };
    });
    mocks.hasPendingDirtyConnection.mockImplementation(async () => dirtyRevision > 0n);

    for (let index = 0; index < 2_500; index += 1) {
      const controlPlane = new HostedDeviceSyncControlPlane(
        new Request("https://control.example.test/api/device-sync/webhooks/oura", {
          body: JSON.stringify({
            event: "historical.updated",
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        }),
      );
      await expect(controlPlane.handleWebhook("oura")).resolves.toMatchObject({
        accepted: true,
      });
    }

    expect(mocks.createSignal).toHaveBeenCalledTimes(1);
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("appends a new device-sync wake in the same wall-clock bucket after prior work is clean", async () => {
    let traceIndex = 0;
    mocks.createDeviceSyncPublicIngress.mockImplementation((input: {
      hooks?: {
        onWebhookAccepted?: (value: unknown) => Promise<void> | void;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(),
      handleWebhook: vi.fn(async () => {
        traceIndex += 1;
        await input.hooks?.onWebhookAccepted?.({
          account: {
            id: "dsc_123",
            provider: "oura",
          },
          now: "2026-03-26T12:00:00.000Z",
          provider: {},
          traceId: `trace_same_minute_${traceIndex}`,
          webhook: {
            acceptanceMode: "level_dirty_hint",
            eventType: "sleep.updated",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-03-19T00:00:00.000Z",
                  windowEnd: "2026-03-26T00:00:00.000Z",
                },
              },
            ],
            occurredAt: traceIndex === 1
              ? "2026-03-26T12:00:05.000Z"
              : "2026-03-26T12:00:45.000Z",
            resourceCategory: "sleep",
          },
        });
        return {
          accepted: true,
        };
      }),
      startConnection: vi.fn(),
    }));
    mocks.upsertDirtyConnection
      .mockResolvedValueOnce({
        dirty: buildDirtyConnectionRecord({
          dirtyRevision: 10n,
          processedRevision: 9n,
        }),
        shouldRequestWake: true,
      })
      .mockResolvedValueOnce({
        dirty: buildDirtyConnectionRecord({
          dirtyRevision: 11n,
          processedRevision: 10n,
        }),
        shouldRequestWake: true,
      });

    for (let index = 0; index < 2; index += 1) {
      const controlPlane = new HostedDeviceSyncControlPlane(
        new Request("https://control.example.test/api/device-sync/webhooks/oura", {
          body: JSON.stringify({
            event: "sleep.updated",
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        }),
      );
      await expect(controlPlane.handleWebhook("oura")).resolves.toMatchObject({
        accepted: true,
      });
    }

    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledTimes(2);
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("rejects hosted webhook bodies above the shared device-sync limit before ingress parsing", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: "x".repeat(DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES + 1),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("oura")).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      httpStatus: 413,
      message: `Request body exceeded ${DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES} bytes.`,
      retryable: false,
    });

    const ingress = mocks.createDeviceSyncPublicIngress.mock.results[0]?.value as {
      handleWebhook: ReturnType<typeof vi.fn>;
    };
    expect(ingress.handleWebhook).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.completeWebhookTrace).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("does not complete or nudge a hosted webhook trace when dirty-state persistence fails", async () => {
    mocks.upsertDirtyConnection.mockRejectedValueOnce(new Error("dirty upsert failed"));
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({
          event: "sleep.updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("oura")).rejects.toThrow("dirty upsert failed");

    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.completeWebhookTrace).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("does not nudge after a hosted webhook trace claim is lost before completion", async () => {
    mocks.completeWebhookTrace.mockResolvedValueOnce(false);
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({
          event: "sleep.updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("oura")).rejects.toMatchObject({
      code: "WEBHOOK_TRACE_CLAIM_LOST",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.createSignal).toHaveBeenCalledTimes(1);
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(1);
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("shapes hosted webhook dirty resources by provider and job allowlists instead of key redaction", async () => {
    mocks.createDeviceSyncPublicIngress.mockImplementationOnce((input: {
      hooks?: {
        onConnectionEstablished?: (value: unknown) => Promise<void> | void;
        onWebhookAccepted?: (value: unknown) => Promise<void> | void;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(),
      handleWebhook: vi.fn(async () => {
        await input.hooks?.onWebhookAccepted?.({
          account: {
            id: "dsc_123",
            provider: "oura",
            scopes: ["heartrate"],
          },
          now: "2026-03-26T12:00:00.000Z",
          provider: {},
          traceId: "trace_case_123",
          webhook: {
            acceptanceMode: "durable_webhook_work",
            eventType: "sleep.updated",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  Authorization: "Bearer job-auth-secret",
                  clientSecret: "job-client-secret",
                  objectId: "daily-sleep-1",
                  pageToken: "job-next-page-token",
                  windowStart: "2026-03-19T00:00:00.000Z",
                },
              },
            ],
            occurredAt: "2026-03-26T11:59:00.000Z",
            payload: {
              Authorization: "Bearer provider-secret-token",
              nested: [
                {
                  "Bearer-Token": "array-secret-token",
                  keep: "ok",
                },
              ],
              objectId: "daily-sleep-1",
              sessionToken: "session-secret-token",
              "X-Api-Key": "provider-api-key",
              verification_token: "provider-verification-token",
            },
          },
        });
        return {
          accepted: true,
        };
      }),
      startConnection: vi.fn(),
    }));
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({
          event: "sleep.updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await controlPlane.handleWebhook("oura");

    const signalInput = mocks.createSignal.mock.calls[0]?.[0];
    const signalJson = JSON.stringify(signalInput ?? {});
    const dirtyResources = mocks.upsertDirtyConnection.mock.calls[0]?.[0]?.resources as Array<{
      payload?: { webhookDataJson?: unknown };
      resource: string;
      resourceCategory: string;
      sourceProviderSlug: string | null;
    }> | undefined;

    expect(signalJson).not.toContain("provider-secret-token");
    expect(signalJson).not.toContain("job-auth-secret");
    expect(signalJson).not.toContain("job-client-secret");
    expect(signalJson).not.toContain("provider-api-key");
    expect(signalJson).not.toContain("session-secret-token");
    expect(signalJson).not.toContain("provider-verification-token");
    expect(signalJson).not.toContain("job-next-page-token");
    expect(signalJson).not.toContain("array-secret-token");
    expect(signalInput).toEqual(expect.objectContaining({
      eventType: "sleep.updated",
      occurredAt: "2026-03-26T11:59:00.000Z",
      resourceCategory: null,
      traceId: "trace_case_123",
    }));
    expect(JSON.stringify(dirtyResources ?? [])).not.toContain("job-auth-secret");
    expect(JSON.stringify(dirtyResources ?? [])).not.toContain("job-client-secret");
    expect(JSON.stringify(dirtyResources ?? [])).not.toContain("job-next-page-token");
    expect(dirtyResources).toEqual([
      {
        count: 1,
        jobKind: "reconcile",
        payload: {
          windowStart: "2026-03-19T00:00:00.000Z",
        },
        resource: null,
        resourceCategory: null,
        sourceProviderSlug: null,
        windowEnd: null,
        windowStart: "2026-03-19T00:00:00.000Z",
      },
    ]);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "device-sync.wake",
        reason: "webhook_hint",
        userId: "user-123",
      }),
      tx: mocks.prismaTx,
    });
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      recoveryIntent: null,
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("does not suppress Junction daily data webhook payloads when dirty state would already be pending", async () => {
    const webhookDataJson = JSON.stringify({
      data: Array.from({ length: 30 }, (_, index) => ({
        end: `2026-05-26T${String(index % 24).padStart(2, "0")}:30:00.000Z`,
        start: `2026-05-26T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
        unit: "count",
        value: 100 + index,
      })),
      sourceProviderSlug: "garmin",
    });
    expect(webhookDataJson.length).toBeGreaterThan(512);
    mocks.hasPendingDirtyConnection.mockResolvedValue(true);
    mocks.createDeviceSyncPublicIngress.mockImplementationOnce((input: {
      hooks?: {
        onConnectionEstablished?: (value: unknown) => Promise<void> | void;
        onWebhookAccepted?: (value: unknown) => Promise<void> | void;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(),
      handleWebhook: vi.fn(async () => {
        await input.hooks?.onWebhookAccepted?.({
          account: {
            id: "dsc_123",
            provider: "junction",
            scopes: [],
          },
          now: "2026-05-26T12:00:00.000Z",
          provider: {},
          traceId: "trace_junction_123",
          webhook: {
            acceptanceMode: "durable_webhook_work",
            eventType: "daily.data.steps.created",
            jobs: [
              {
                kind: "resource",
                payload: {
                  eventType: "daily.data.steps.created",
                  objectId: "steps-2026-05-26",
                  occurredAt: "2026-05-26T11:59:00.000Z",
                  resource: "steps",
                  resourceCategory: "timeseries",
                  sourceProviderSlug: "garmin",
                  webhookDataJson,
                  windowEnd: "2026-05-27T00:00:00.000Z",
                  windowStart: "2026-05-26T00:00:00.000Z",
                },
              },
            ],
            occurredAt: "2026-05-26T11:59:00.000Z",
            resourceCategory: "timeseries",
          },
        });
        return {
          accepted: true,
        };
      }),
      startConnection: vi.fn(),
    }));
    mocks.getConnectionForUser.mockResolvedValueOnce(buildHostedConnection({
      provider: "junction",
    }));
    mocks.getConnectionOwnerId.mockResolvedValueOnce("user-123");
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", {
        body: JSON.stringify({
          event_type: "daily.data.steps.created",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await controlPlane.handleWebhook("junction");

    const dirtyResources = mocks.upsertDirtyConnection.mock.calls[0]?.[0]?.resources;

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(dirtyResources).toEqual([
      {
        count: 1,
        jobKind: "resource",
        payload: {
          eventType: "daily.data.steps.created",
          objectId: "steps-2026-05-26",
          occurredAt: "2026-05-26T11:59:00.000Z",
          resource: "steps",
          resourceCategory: "timeseries",
          sourceProviderSlug: "garmin",
          webhookDataJson,
          windowEnd: "2026-05-27T00:00:00.000Z",
          windowStart: "2026-05-26T00:00:00.000Z",
        },
        resource: "steps",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        windowEnd: "2026-05-27T00:00:00.000Z",
        windowStart: "2026-05-26T00:00:00.000Z",
      },
    ]);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "device-sync.wake",
        provider: "junction",
        reason: "webhook_hint",
        userId: "user-123",
      }),
      tx: mocks.prismaTx,
    });
  });

  it("accepts durable Junction payload webhooks without a connection acceptance lock", async () => {
    const webhookDataJson = JSON.stringify({
      data: [
        {
          end: "2026-05-26T00:30:00.000Z",
          start: "2026-05-26T00:00:00.000Z",
          unit: "count",
          value: 123,
        },
      ],
      sourceProviderSlug: "garmin",
    });
    mocks.createDeviceSyncPublicIngress.mockImplementationOnce((input: {
      hooks?: {
        onWebhookAccepted?: (value: unknown) => Promise<void> | void;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(),
      handleWebhook: vi.fn(async () => {
        await input.hooks?.onWebhookAccepted?.({
          account: {
            id: "dsc_123",
            provider: "junction",
            scopes: [],
          },
          now: "2026-05-26T12:00:00.000Z",
          provider: {},
          claimToken: "claim-token",
          traceId: "trace_junction_payload_busy",
          webhook: {
            acceptanceMode: "durable_webhook_work",
            eventType: "daily.data.steps.created",
            jobs: [
              {
                kind: "resource",
                payload: {
                  eventType: "daily.data.steps.created",
                  objectId: "steps-2026-05-26",
                  occurredAt: "2026-05-26T11:59:00.000Z",
                  resource: "steps",
                  resourceCategory: "timeseries",
                  sourceProviderSlug: "garmin",
                  webhookDataJson,
                  windowEnd: "2026-05-27T00:00:00.000Z",
                  windowStart: "2026-05-26T00:00:00.000Z",
                },
              },
            ],
            occurredAt: "2026-05-26T11:59:00.000Z",
            resourceCategory: "timeseries",
          },
        });
        return {
          accepted: true,
        };
      }),
      startConnection: vi.fn(),
    }));
    mocks.getConnectionForUser.mockResolvedValueOnce(buildHostedConnection({
      provider: "junction",
    }));
    mocks.getConnectionOwnerId.mockResolvedValueOnce("user-123");
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", {
        body: JSON.stringify({
          event_type: "daily.data.steps.created",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("junction")).resolves.toMatchObject({
      accepted: true,
    });

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createSignal).toHaveBeenCalledTimes(1);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith(
      "junction",
      "trace_junction_payload_busy",
      "claim-token",
      mocks.prismaTx,
    );
  });

  it("preserves split Junction daily data webhook payload chunks across the hosted dirty handoff", async () => {
    const webhookDataJsons = [0, 1].map((chunkIndex) =>
      JSON.stringify({
        chunkIndex,
        data: Array.from({ length: 12 }, (_, index) => ({
          end: `2026-05-26T${String(index % 12).padStart(2, "0")}:30:00.000Z`,
          sampleMemo: "x".repeat(80),
          start: `2026-05-26T${String(index % 12).padStart(2, "0")}:00:00.000Z`,
          unit: "count",
          value: chunkIndex * 100 + index,
        })),
        sourceProviderSlug: "garmin",
      })
    );
    expect(webhookDataJsons.every((payload) => payload.length > 512)).toBe(true);
    mocks.createDeviceSyncPublicIngress.mockImplementationOnce((input: {
      hooks?: {
        onConnectionEstablished?: (value: unknown) => Promise<void> | void;
        onWebhookAccepted?: (value: unknown) => Promise<void> | void;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(),
      handleWebhook: vi.fn(async () => {
        await input.hooks?.onWebhookAccepted?.({
          account: {
            id: "dsc_123",
            provider: "junction",
            scopes: [],
          },
          now: "2026-05-26T12:00:00.000Z",
          provider: {},
          traceId: "trace_junction_chunks_123",
          webhook: {
            acceptanceMode: "durable_webhook_work",
            eventType: "daily.data.steps.created",
            jobs: webhookDataJsons.map((webhookDataJson, index) => ({
              kind: "resource",
              payload: {
                eventType: "daily.data.steps.created",
                objectId: "steps-2026-05-26",
                occurredAt: "2026-05-26T11:59:00.000Z",
                resource: "steps",
                resourceCategory: "timeseries",
                sourceProviderSlug: "garmin",
                webhookDataJson,
                windowEnd: "2026-05-27T00:00:00.000Z",
                windowStart: "2026-05-26T00:00:00.000Z",
              },
              dedupeKey: `chunk-${index}`,
            })),
            occurredAt: "2026-05-26T11:59:00.000Z",
            resourceCategory: "timeseries",
          },
        });
        return {
          accepted: true,
        };
      }),
      startConnection: vi.fn(),
    }));
    mocks.getConnectionForUser.mockResolvedValueOnce(buildHostedConnection({
      provider: "junction",
    }));
    mocks.getConnectionOwnerId.mockResolvedValueOnce("user-123");
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", {
        body: JSON.stringify({
          event_type: "daily.data.steps.created",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await controlPlane.handleWebhook("junction");

    const dirtyResources = (mocks.upsertDirtyConnection.mock.calls[0]?.[0]?.resources ?? []) as Array<{
      payload?: {
        webhookDataJson?: unknown;
      };
      resource: string;
      resourceCategory: string;
      sourceProviderSlug: string | null;
    }>;

    expect(dirtyResources.map((resource) => resource.payload?.webhookDataJson)).toEqual(webhookDataJsons);
    expect(dirtyResources.map((resource) => resource.resource)).toEqual(["steps", "steps"]);
    expect(dirtyResources.map((resource) => resource.resourceCategory)).toEqual(["timeseries", "timeseries"]);
    expect(dirtyResources.map((resource) => resource.sourceProviderSlug)).toEqual(["garmin", "garmin"]);
  });

  it("shapes Whoop hosted dirty resources through the provider-owned allowlists", async () => {
    mocks.createDeviceSyncPublicIngress.mockImplementationOnce((input: {
      hooks?: {
        onConnectionEstablished?: (value: unknown) => Promise<void> | void;
        onWebhookAccepted?: (value: unknown) => Promise<void> | void;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(),
      handleWebhook: vi.fn(async () => {
        await input.hooks?.onWebhookAccepted?.({
          account: {
            id: "dsc_123",
            provider: "whoop",
            scopes: ["offline"],
          },
          now: "2026-03-26T12:00:00.000Z",
          provider: {},
          traceId: "trace_whoop_123",
          webhook: {
            acceptanceMode: "durable_webhook_work",
            eventType: "workout.updated",
            jobs: [
              {
                kind: "resource",
                payload: {
                  eventType: "workout.updated",
                  occurredAt: "2026-03-26T11:58:00.000Z",
                  resourceId: "workout-7",
                  resourceType: "workout",
                  sessionToken: "whoop-session-secret",
                  webhookPayload: {
                    extra: "drop-me",
                  },
                },
              },
              {
                kind: "delete",
                payload: {
                  eventType: "workout.deleted",
                  occurredAt: "2026-03-26T11:59:00.000Z",
                  resourceId: "workout-8",
                  resourceType: "workout",
                  traceId: "drop-trace",
                },
              },
            ],
            occurredAt: "2026-03-26T11:59:00.000Z",
            resourceCategory: "workout",
          },
        });
        return {
          accepted: true,
        };
      }),
      startConnection: vi.fn(),
    }));
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/whoop", {
        body: JSON.stringify({
          event: "workout.updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await controlPlane.handleWebhook("whoop");

    const signalInput = mocks.createSignal.mock.calls[0]?.[0];
    const signalJson = JSON.stringify(signalInput ?? {});
    const dirtyResources = mocks.upsertDirtyConnection.mock.calls[0]?.[0]?.resources;

    expect(signalJson).not.toContain("whoop-session-secret");
    expect(signalJson).not.toContain("drop-me");
    expect(signalJson).not.toContain("drop-trace");
    expect(signalInput).toEqual(expect.objectContaining({
      eventType: "workout.updated",
      occurredAt: "2026-03-26T11:59:00.000Z",
      resourceCategory: "workout",
      traceId: "trace_whoop_123",
    }));
    expect(JSON.stringify(dirtyResources ?? [])).not.toContain("whoop-session-secret");
    expect(JSON.stringify(dirtyResources ?? [])).not.toContain("drop-me");
    expect(JSON.stringify(dirtyResources ?? [])).not.toContain("drop-trace");
    expect(dirtyResources).toEqual([
      {
        count: 1,
        jobKind: "resource",
        payload: {
          eventType: "workout.updated",
          occurredAt: "2026-03-26T11:58:00.000Z",
          resourceId: "workout-7",
          resourceType: "workout",
        },
        resource: null,
        resourceCategory: null,
        sourceProviderSlug: null,
        windowEnd: null,
        windowStart: null,
      },
      {
        count: 1,
        jobKind: "delete",
        payload: {
          eventType: "workout.deleted",
          occurredAt: "2026-03-26T11:59:00.000Z",
          resourceId: "workout-8",
          resourceType: "workout",
        },
        resource: null,
        resourceCategory: null,
        sourceProviderSlug: null,
        windowEnd: null,
        windowStart: null,
      },
    ]);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "device-sync.wake",
        provider: "whoop",
        reason: "webhook_hint",
        userId: "user-123",
      }),
      tx: mocks.prismaTx,
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("keeps hosted webhook traces retryable when ingress hooks cannot resolve an owner", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getConnectionOwnerId.mockResolvedValue(null);
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({
          event: "sleep.updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("oura")).rejects.toMatchObject({
      code: "CONNECTION_OWNER_NOT_FOUND",
      httpStatus: 503,
      message: "Hosted device-sync connection owner mapping is missing. Retry later.",
      retryable: true,
    });

    expect(consoleWarn).toHaveBeenCalledWith(
      "Rejecting hosted device-sync webhook without an owner mapping.",
      expect.objectContaining({
        connectionId: "dsc_123",
        provider: "oura",
        traceId: "trace_123",
      }),
    );
    expect(mocks.completeWebhookTrace).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("keeps delete webhook dirty resources narrow across the hosted handoff", async () => {
    const deleteWebhook = {
      eventType: "session.deleted",
      jobs: [
        {
          kind: "delete",
          dedupeKey: "oura-webhook:trace_delete_123",
          payload: {
            dataType: "session",
            objectId: "session-42",
            occurredAt: "2026-03-26T11:59:00.000Z",
            sourceEventType: "session.deleted",
            webhookPayload: {
              data_type: "session",
              event_time: "2026-03-26T11:59:00.000Z",
              event_type: "delete",
              object_id: "session-42",
              user_id: "oura-user-1",
            },
          },
        },
      ],
      occurredAt: "2026-03-26T11:59:00.000Z",
      resourceCategory: "session",
    };
    mocks.createDeviceSyncPublicIngress.mockImplementationOnce((input: {
      hooks?: {
        onConnectionEstablished?: (value: unknown) => Promise<void> | void;
        onWebhookAccepted?: (value: unknown) => Promise<void> | void;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(),
      handleWebhook: vi.fn(async () => {
        await input.hooks?.onWebhookAccepted?.({
          account: {
            id: "dsc_123",
            provider: "oura",
          },
          now: "2026-03-26T12:00:00.000Z",
          provider: {
            provider: "oura",
          },
          traceId: "trace_delete_123",
          webhook: deleteWebhook,
        });
        return {
          accepted: true,
        };
      }),
      startConnection: vi.fn(),
    }));
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({
          event: "session.deleted",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    await controlPlane.handleWebhook("oura");

    const dirtyResources = mocks.upsertDirtyConnection.mock.calls[0]?.[0]?.resources;

    expect(dirtyResources).toEqual([
      {
        count: 1,
        jobKind: "delete",
        payload: {
          dataType: "session",
          objectId: "session-42",
          occurredAt: "2026-03-26T11:59:00.000Z",
          sourceEventType: "session.deleted",
        },
        resource: null,
        resourceCategory: null,
        sourceProviderSlug: null,
        windowEnd: null,
        windowStart: null,
      },
    ]);
    expect(JSON.stringify(dirtyResources)).not.toContain("oura-user-1");
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "device-sync.wake",
        reason: "webhook_hint",
        userId: "user-123",
      }),
      tx: mocks.prismaTx,
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

});
