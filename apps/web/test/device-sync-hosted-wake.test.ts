import { createJunctionDeviceSyncProvider } from "@murphai/device-syncd";
import {
  DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
} from "@murphai/device-syncd/public-account";
import { buildJunctionProviderSourceInstanceKey } from "@murphai/device-syncd/connect-config";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import { DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES } from "@murphai/device-syncd/public-ingress";
import type { PreparedDeviceSyncWebhookV1 } from "@murphai/device-syncd/prepared-webhook";
import {
  addJunctionExtendedTimeseriesHistoryBackfillCoverage,
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
} from "@murphai/device-syncd/junction-historical-backfill-progress";
import type { StoredDeviceSyncAccount } from "@murphai/device-syncd/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    completeWebhookTrace: vi.fn(),
    createDeviceSyncPublicIngress: vi.fn(),
    createHostedDeviceSyncRegistryWithProviderConfigs: vi.fn(),
    createSdkSignInSession: vi.fn(),
    createSignal: vi.fn(),
    markWebhookReceived: vi.fn(),
    markConnectionSourceDataReceived: vi.fn(),
    materializeStoredConnectionAccount: vi.fn(),
    ensureSdkConnection: vi.fn(),
    ensureWebhookSubscriptions: vi.fn(),
    appendHostedMailboxEnvelope: vi.fn(),
    getConnectionForUser: vi.fn(),
    getConnectionRecordForUser: vi.fn(),
    getConnectionOwnerId: vi.fn(),
    hasPendingDirtyConnection: vi.fn(),
    inspectCompanionHrvNightReceipt: vi.fn(),
    getStoredConnectionAccountForUser: vi.fn(),
    requireHostedCloudflareCallbackRequest: vi.fn(),
    clearStaleConnectionRefreshLease: vi.fn(),
    clearStoredProviderConfigCredential: vi.fn(),
    listConnectionSourceAdmissionCandidates: vi.fn(),
    listConnectionSources: vi.fn(),
    listConnectionsForUser: vi.fn(),
    listConnectionsRequiringCleanupForUser: vi.fn(),
    markConnectionSourcesDisconnected: vi.fn(),
    markDirtyConnectionProcessed: vi.fn(),
    persistStoredConnectionTokenBundle: vi.fn(),
    readOAuthStateProviderApplicationBinding: vi.fn(),
    resolveDeviceProviderApplication: vi.fn(),
    resolveDeviceProviderApplicationForConnection: vi.fn(),
    revokeStravaDeviceSyncAccess: vi.fn(),
    readHostedDeviceSyncEnvironment: vi.fn(),
    registryGet: vi.fn(),
    registryList: vi.fn(),
    scopedRegistryGet: vi.fn(),
    scopedRegistryList: vi.fn(),
    resumeSdkSignInSession: vi.fn(),
    sha256Hex: vi.fn<(value: string) => string>(() => "a".repeat(64)),
    syncDurableConnectionState: vi.fn(),
    getDirtyConnection: vi.fn(),
    prepareDirtyConnectionUpsert: vi.fn(),
    shouldRequestWakeForDirtyConnectionUpsert: vi.fn(),
    upsertDirtyConnection: vi.fn(),
    upsertDirtyConnectionWithPreparedPlanTx: vi.fn(),
    upsertConnectionSource: vi.fn(),
    upsertConnectionWithProviderApplication: vi.fn(),
    withConnectionMutationLock: vi.fn(),
    withHealthDataAdmissionLock: vi.fn(),
    prismaTx: {
      __tx: true,
      $queryRaw: vi.fn(),
      deviceConnection: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      deviceSyncDirtyPayload: {
        count: vi.fn(),
      },
      deviceSyncSignal: {
        create: vi.fn(),
      },
    },
    prisma: {
      $transaction: vi.fn(),
      hostedConsentGrant: {
        findUnique: vi.fn(),
      },
    },
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
    prepareHostedMailboxItemAppendCrypto: vi.fn(async (input: { userId: string }) => ({
      domain: "ingress",
      rootKeyId: "root_test",
      userId: input.userId,
    })),
  };

  return state;
});

function addJunctionHistoryCoverage(
  metadata: Record<string, unknown>,
  providerSlug: string,
  resource: string,
): Record<string, unknown> {
  const update = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
    metadata,
    providerSlug,
    resource,
    version: resource === "note" ? 2 : 1,
  });
  if (!update) {
    throw new TypeError("Expected representable Junction history coverage.");
  }
  return { ...metadata, [update.metadataKey]: update.value };
}

function hasJunctionHistoryCoverage(
  metadata: Record<string, unknown>,
  providerSlug: string,
  resource: string,
): boolean {
  return hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
    metadata,
    providerSlug,
    resource,
    resource === "note" ? 2 : 1,
  );
}

function toFutureJunctionHistoryCoverage(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    key,
    typeof value === "string" ? value.replace(/^m1\|/u, "m2|") : value,
  ]));
}

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

vi.mock("@murphai/device-syncd/providers/strava", () => ({
  revokeStravaDeviceSyncAccess: mocks.revokeStravaDeviceSyncAccess,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => mocks.prisma),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  appendHostedMailboxEnvelopeWithPreparedCryptoTx: mocks.appendHostedMailboxEnvelopeTx,
  prepareHostedMailboxItemAppendCrypto: mocks.prepareHostedMailboxItemAppendCrypto,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedDeviceSyncMailboxRuntime: mocks.signalHostedDeviceSyncMailboxRuntime,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
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

function buildCompanionHrvRmssdObservation() {
  return {
    schema: "murph.companion.overnight-prv-rmssd.v1" as const,
    methodVersion: "prv-rmssd-5m-mean-scheduled-0000-0800-local-v1" as const,
    nightDate: "2026-07-10",
    rmssdMs: 52.75,
    completedWindowCount: 96,
    acceptedWindowCount: 72,
  };
}

function buildJunctionSourceConnectionWork(input: {
  now: string;
  sourceProviderSlug: string;
}) {
  return {
    initialJobs: [
      {
        kind: "backfill" as const,
        payload: { sourceProviderSlug: input.sourceProviderSlug },
      },
      {
        kind: "reconcile" as const,
        payload: { sourceProviderSlug: input.sourceProviderSlug },
      },
    ],
    nextReconcileAt: input.now,
  };
}

function acceptTestCompanionHrvRmssdObservation(options: {
  acceptedAt?: string;
  observation?: ReturnType<typeof buildCompanionHrvRmssdObservation>;
} = {}) {
  const ingress = createHostedDeviceSyncPublicIngressService(
    new Request("https://control.example.test/api/device-sync/companion/hrv-rmssd"),
  );

  return ingress.acceptCompanionHrvRmssdObservation({
    acceptedAt: options.acceptedAt ?? "2026-07-10T13:46:00.000Z",
    observation: options.observation ?? buildCompanionHrvRmssdObservation(),
    userId: "user-123",
  });
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
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

function buildWebhookAdmissionRecord(
  overrides: Parameters<typeof buildHostedConnection>[0] = {},
) {
  const connection = buildHostedConnection(overrides);
  return {
    accessTokenEncrypted: null,
    accessTokenExpiresAt: null,
    connectedAt: new Date(connection.connectedAt),
    createdAt: new Date(connection.createdAt),
    credentialKind: "provider_config",
    credentialMetadataJson: {},
    displayName: connection.displayName,
    externalAccountIdEncrypted: "enc:acct_sensitive",
    id: connection.id,
    keyVersion: null,
    lastErrorCode: connection.lastErrorCode,
    lastErrorMessage: connection.lastErrorMessage,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastSyncStartedAt: null,
    lastWebhookAt: null,
    metadataJson: {},
    nextReconcileAt: null,
    provider: connection.provider,
    providerAccountBlindIndex: "blind-account",
    providerApplicationId: null,
    providerApplicationRevision: null,
    providerConfigKey: "hosted-provider-config",
    refreshLeaseExpiresAt: null,
    refreshLeaseOwner: null,
    refreshLeaseTokenVersion: null,
    refreshTokenEncrypted: null,
    scopesJson: [],
    setupExpiresAt: null,
    setupPhase: connection.setupPhase,
    status: connection.status,
    tokenVersion: null,
    updatedAt: new Date(connection.updatedAt),
    userId: "user-123",
  };
}

function mockConnectionForAdmission(
  connection: ReturnType<typeof buildHostedConnection> | null,
): void {
  mocks.getConnectionForUser.mockResolvedValue(connection);
  mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
    connection ? buildWebhookAdmissionRecord(connection) : null,
  );
}

function buildDisconnectingConnection(
  connection: ReturnType<typeof buildHostedConnection>,
) {
  return {
    ...connection,
    lastErrorCode: DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
    lastErrorMessage: null,
    nextReconcileAt: null,
    setupExpiresAt: null,
    setupPhase: null,
    status: "reauthorization_required" as const,
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

const preparedWebhookCredentialEpochDrifts: ReadonlyArray<[
  label: string,
  patch: Readonly<Record<string, unknown>>,
]> = [
  ["provider configuration", { providerConfigKey: "rotated-provider-config" }],
  ["credential metadata", { credentialMetadataJson: { revision: 2 } }],
  ["provider account blind index", { providerAccountBlindIndex: "rotated-blind-account" }],
  ["external-account ciphertext", { externalAccountIdEncrypted: "enc:rotated-account" }],
  ["access-token ciphertext", { accessTokenEncrypted: "enc:rotated-access" }],
  ["refresh-token ciphertext", { refreshTokenEncrypted: "enc:rotated-refresh" }],
  ["token expiry", { accessTokenExpiresAt: new Date("2026-03-26T13:00:00.000Z") }],
  ["key version", { keyVersion: "v2" }],
  ["token version", { tokenVersion: 3 }],
];

function buildHostedConnectionSource(
  connectionId: string,
  sourceProviderSlug: string,
  overrides: Partial<{
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    lastSeenAt: string;
    resourceAvailabilitySummary: Record<string, string | number | boolean | null>;
    status: "connected" | "disconnected" | "error" | "unavailable";
  }> = {},
) {
  const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId,
    sourceProviderSlug,
  });
  if (!sourceInstanceKey) {
    throw new Error("Expected a canonical Junction source instance key.");
  }

  return {
    connectionId,
    createdAt: "2026-03-26T12:00:00.000Z",
    displayName: null,
    firstSeenAt: "2026-03-26T12:00:00.000Z",
    id: `dcs_${sourceProviderSlug}`,
    lastDataAt: "2026-03-26T11:59:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-03-26T12:00:00.000Z",
    resourceAvailabilitySummary: { sleep: true },
    sourceInstanceKey,
    sourceProviderSlug,
    status: "connected" as const,
    updatedAt: "2026-03-26T12:00:00.000Z",
    ...overrides,
  };
}

function buildHostedConnectionSourceAdmissionCandidate(
  source: ReturnType<typeof buildHostedConnectionSource>,
) {
  return {
    id: source.id,
    lastErrorCode: source.lastErrorCode,
    lastErrorMessage: source.lastErrorMessage,
    lastSeenAt: new Date(source.lastSeenAt),
    sourceInstanceKey: source.sourceInstanceKey,
    sourceProviderSlug: source.sourceProviderSlug,
    status: source.status,
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
  createHostedDeviceSyncRegistryWithProviderConfigs:
    mocks.createHostedDeviceSyncRegistryWithProviderConfigs,
  requireHostedDeviceSyncProvider: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/provider-applications", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/device-sync/provider-applications")
  >("@/src/lib/device-sync/provider-applications");
  return {
    ...actual,
    resolveDeviceProviderApplication: mocks.resolveDeviceProviderApplication,
    resolveDeviceProviderApplicationForConnection:
      mocks.resolveDeviceProviderApplicationForConnection,
  };
});

vi.mock("@/src/lib/device-sync/prisma-store", () => ({
  hasHostedDeviceSyncDirtyResourcePayload: (resource: {
    payload?: Record<string, unknown>;
  }) => Object.keys(resource.payload ?? {}).length > 0,
  PrismaDeviceSyncControlPlaneStore: class PrismaDeviceSyncControlPlaneStore {
    completeWebhookTrace = mocks.completeWebhookTrace;
    createSignal = mocks.createSignal;
    markWebhookReceived = mocks.markWebhookReceived;
    markConnectionSourceDataReceived = mocks.markConnectionSourceDataReceived;
    materializeStoredConnectionAccount = mocks.materializeStoredConnectionAccount;
    getConnectionForUser = mocks.getConnectionForUser;
    getConnectionRecordForUser = mocks.getConnectionRecordForUser;
    getConnectionOwnerId = mocks.getConnectionOwnerId;
    hasPendingDirtyConnection = mocks.hasPendingDirtyConnection;
    inspectCompanionHrvNightReceipt = mocks.inspectCompanionHrvNightReceipt;
    getDirtyConnection = mocks.getDirtyConnection;
    getStoredConnectionAccountForUser = mocks.getStoredConnectionAccountForUser;
    clearStaleConnectionRefreshLease = mocks.clearStaleConnectionRefreshLease;
    clearStoredProviderConfigCredential = mocks.clearStoredProviderConfigCredential;
    listConnectionSourceAdmissionCandidates = mocks.listConnectionSourceAdmissionCandidates;
    listConnectionSources = mocks.listConnectionSources;
    listConnectionsForUser = mocks.listConnectionsForUser;
    listConnectionsRequiringCleanupForUser = mocks.listConnectionsRequiringCleanupForUser;
    markConnectionSourcesDisconnected = mocks.markConnectionSourcesDisconnected;
    markDirtyConnectionProcessed = mocks.markDirtyConnectionProcessed;
    persistStoredConnectionTokenBundle = mocks.persistStoredConnectionTokenBundle;
    readOAuthStateProviderApplicationBinding = mocks.readOAuthStateProviderApplicationBinding;
    syncDurableConnectionState = mocks.syncDurableConnectionState;
    prepareDirtyConnectionUpsert = mocks.prepareDirtyConnectionUpsert;
    shouldRequestWakeForDirtyConnectionUpsert =
      mocks.shouldRequestWakeForDirtyConnectionUpsert;
    upsertDirtyConnection = mocks.upsertDirtyConnection;
    upsertDirtyConnectionWithPreparedPlanTx =
      mocks.upsertDirtyConnectionWithPreparedPlanTx;
    upsertConnectionSource = mocks.upsertConnectionSource;
    upsertConnectionWithProviderApplication =
      mocks.upsertConnectionWithProviderApplication;
    withConnectionMutationLock = mocks.withConnectionMutationLock;
    withHealthDataAdmissionLock = mocks.withHealthDataAdmissionLock;
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
  sha256Hex: mocks.sha256Hex,
  toIsoTimestamp: vi.fn(() => "2026-03-26T12:00:00.000Z"),
  toJsonRecord: vi.fn((value: unknown) => value),
}));

import {
  HostedDeviceSyncControlPlane,
} from "@/src/lib/device-sync/control-plane";
import { DeviceProviderApplicationError } from "@/src/lib/device-sync/provider-applications";
import {
  createHostedDeviceSyncPublicIngressService,
} from "@/src/lib/device-sync/public-ingress-service";
import {
  HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
} from "@/src/lib/device-sync/connection-source-lifecycle";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import {
  areHostedDomainRootProviderCallsDisabled,
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { HostedDomainRootPreparationMismatchError } from "@/src/lib/hosted-crypto/domain-root-store";
import { getPrisma } from "@/src/lib/prisma";
import {
  appendHostedDeviceSyncScheduledReconcileWake,
  buildHostedDeviceSyncScheduledReconcileWakeEventId,
  cleanupRejectedHostedDeviceSyncConnectionSource,
  handleHostedDeviceSyncConnectionEstablished,
  handleHostedDeviceSyncWebhookAccepted,
  persistHostedDeviceSyncCompanionMetadata,
  reconcileHostedDeviceSyncConnectionSourceRegistration,
} from "@/src/lib/device-sync/wake-service";
import { buildHostedDeviceSyncWakeEventId } from "@/src/lib/device-sync/wake";
import { createHostedBrowserConnectionId } from "@/src/lib/device-sync/public-connection";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  POST as reconcileRoutePost,
} from "../app/api/internal/device-sync/reconcile/route";

function buildPublicConnectionId(connectionId: string): string {
  return createHostedBrowserConnectionId(ROUTING_INDEX_KEY, connectionId);
}

describe("hosted device-sync wakes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionForUser.mockReset();
    mocks.getConnectionRecordForUser.mockReset();
    mocks.getStoredConnectionAccountForUser.mockReset();
    mocks.materializeStoredConnectionAccount.mockReset();
    mocks.readOAuthStateProviderApplicationBinding.mockReset();
    mocks.resolveDeviceProviderApplication.mockReset();
    mocks.resolveDeviceProviderApplicationForConnection.mockReset();
    mocks.revokeStravaDeviceSyncAccess.mockReset();
    mocks.revokeStravaDeviceSyncAccess.mockResolvedValue(undefined);
    mocks.upsertConnectionSource.mockReset();
    mocks.readHostedDeviceSyncEnvironment.mockImplementation(() => createHostedEnv());
    mocks.createHostedDeviceSyncRegistryWithProviderConfigs.mockImplementation(() => ({
      get: mocks.scopedRegistryGet,
      list: mocks.scopedRegistryList,
    }));
    mocks.ensureWebhookSubscriptions.mockResolvedValue(undefined);
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prismaTx) => Promise<unknown>) =>
      callback(mocks.prismaTx),
    );
    mocks.readOAuthStateProviderApplicationBinding.mockResolvedValue(null);
    mocks.resolveDeviceProviderApplicationForConnection.mockResolvedValue(null);
    mocks.prismaTx.$queryRaw.mockResolvedValue([{ acquired: true }]);
    mocks.prismaTx.deviceConnection.findUnique.mockReset();
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord(),
    );
    mocks.prismaTx.deviceSyncDirtyPayload.count.mockResolvedValue(0);
    mocks.getConnectionRecordForUser.mockResolvedValue(
      buildWebhookAdmissionRecord(),
    );
    mocks.materializeStoredConnectionAccount.mockResolvedValue(buildStoredConnection());
    mocks.createDeviceSyncPublicIngress.mockImplementation((input: {
      hooks?: {
        onConnectionEstablished?: (value: unknown) => Promise<void> | void;
        onLevelDirtyWebhookAlreadySatisfied?: (value: unknown) => Promise<{ accepted: true } | null> | { accepted: true } | null;
        onUnknownWebhook?: (value: unknown) => Promise<void> | void;
        onWebhookAccepted?: (value: unknown) => Promise<void> | void;
      };
    }) => {
      const defaultPreparedWebhook: PreparedDeviceSyncWebhookV1 = {
        acceptanceMode: "level_dirty_hint" as const,
        eventType: "sleep.updated",
        externalAccountId: "acct_sensitive",
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
        provider: "oura",
        receivedAt: "2026-03-26T12:00:00.000Z",
        resourceCategory: "daily_sleep",
        schema: "murph.device-sync-prepared-webhook.v1" as const,
        traceId: "trace_123",
      };
      const admitPreparedWebhook = async (
        preparedWebhook: PreparedDeviceSyncWebhookV1 = defaultPreparedWebhook,
      ) => {
        await input.hooks?.onWebhookAccepted?.({
          account: {
            connectedAt: "2026-03-26T12:00:00.000Z",
            id: "dsc_123",
            provider: preparedWebhook.provider,
            scopes: ["heartrate"],
          },
          now: preparedWebhook.receivedAt,
          provider: {
            provider: preparedWebhook.provider,
          },
          claimToken: "claim-token",
          sourceAdmissionDeferred: preparedWebhook.provider === "junction"
            && Boolean(preparedWebhook.sourceProviderSlug),
          traceId: preparedWebhook.traceId,
          webhook: {
            acceptanceMode: preparedWebhook.acceptanceMode,
            eventType: preparedWebhook.eventType,
            jobs: preparedWebhook.jobs,
            occurredAt: preparedWebhook.occurredAt,
            resourceCategory: preparedWebhook.resourceCategory,
            ...(preparedWebhook.sourceProviderSlug
              ? { sourceProviderSlug: preparedWebhook.sourceProviderSlug }
              : {}),
            ...(preparedWebhook.dataSourceProviderSlug
              ? { dataSourceProviderSlug: preparedWebhook.dataSourceProviderSlug }
              : {}),
          },
        });
        return { accepted: true };
      };
      return {
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
        createSdkSignInSession: mocks.createSdkSignInSession,
        handlePreparedWebhook: vi.fn(admitPreparedWebhook),
        handleWebhook: vi.fn(() => admitPreparedWebhook()),
        prepareWebhookForDurableEnqueue: vi.fn(async (provider: string) => ({
          ...defaultPreparedWebhook,
          provider,
        })),
        ensureSdkConnection: mocks.ensureSdkConnection,
        resumeSdkSignInSession: mocks.resumeSdkSignInSession,
        startConnection: vi.fn(),
      };
    });
    mocks.createSignal.mockResolvedValue({ id: 8 });
    mocks.createSdkSignInSession.mockResolvedValue({
      account: buildHostedConnection({
        id: "dsc_junction_123",
        provider: "junction",
        setupPhase: "source_confirmed",
      }),
      environment: "sandbox",
      signInToken: "junction-sign-in-token",
    });
    mocks.resumeSdkSignInSession.mockResolvedValue({
      account: buildHostedConnection({
        id: "dsc_junction_123",
        provider: "junction",
        setupPhase: "source_confirmed",
      }),
      environment: "sandbox",
      signInToken: "junction-sign-in-token",
    });
    mocks.prismaTx.deviceSyncSignal.create.mockResolvedValue({ id: 8 });
    mocks.completeWebhookTrace.mockResolvedValue(true);
    mocks.prisma.hostedConsentGrant.findUnique.mockResolvedValue({
      scope: "launch.health-data",
      status: "granted",
    });
    mocks.signalHostedDeviceSyncMailboxRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:user-123",
    });
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("user-123");
    mocks.appendHostedMailboxEnvelope.mockResolvedValue(undefined);
    mocks.getConnectionForUser.mockResolvedValue(buildHostedConnection());
    mocks.ensureSdkConnection.mockResolvedValue(buildHostedConnection({
      id: "dsc_junction_123",
      provider: "junction",
    }));
    mocks.getConnectionOwnerId.mockResolvedValue("user-123");
    mocks.hasPendingDirtyConnection.mockResolvedValue(false);
    mocks.inspectCompanionHrvNightReceipt.mockResolvedValue("missing");
    mocks.upsertDirtyConnection.mockResolvedValue({
      dirty: buildDirtyConnectionRecord(),
      shouldRequestWake: true,
    });
    mocks.prepareDirtyConnectionUpsert.mockImplementation(async (input) => ({
      ...input,
      dirtyRevision: 1n,
      shouldRequestWake: true,
    }));
    mocks.shouldRequestWakeForDirtyConnectionUpsert.mockResolvedValue(true);
    mocks.upsertDirtyConnectionWithPreparedPlanTx.mockImplementation(async (input) => {
      return mocks.upsertDirtyConnection({
        connectionId: input.prepared.connectionId,
        dirtyAt: input.prepared.dirtyAt,
        eventType: input.prepared.eventType,
        provider: input.prepared.provider,
        resourceCategory: input.prepared.resourceCategory,
        resources: input.prepared.resources,
        traceId: input.prepared.traceId,
        tx: input.tx,
        userId: input.prepared.userId,
      });
    });
    mocks.getDirtyConnection.mockResolvedValue(null);
    mocks.markDirtyConnectionProcessed.mockResolvedValue(null);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(buildStoredConnection());
    mocks.listConnectionSources.mockResolvedValue([]);
    mocks.listConnectionSourceAdmissionCandidates.mockResolvedValue([]);
    mocks.listConnectionsForUser.mockResolvedValue([]);
    mocks.listConnectionsRequiringCleanupForUser.mockResolvedValue([]);
    mocks.markConnectionSourcesDisconnected.mockResolvedValue(0);
    mocks.clearStoredProviderConfigCredential.mockResolvedValue(true);
    mocks.clearStaleConnectionRefreshLease.mockResolvedValue(true);
    mocks.persistStoredConnectionTokenBundle.mockResolvedValue(undefined);
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeAccess: vi.fn(async () => undefined),
      },
    });
    mocks.registryList.mockReturnValue([]);
    mocks.withConnectionMutationLock.mockImplementation(async (
      _connectionId: string,
      callback: (tx: typeof mocks.prismaTx) => Promise<unknown>,
    ) => callback(mocks.prismaTx));
    mocks.withHealthDataAdmissionLock.mockImplementation(async (
      _userId: string,
      _connectionId: string,
      callback: (tx: typeof mocks.prismaTx) => Promise<unknown>,
    ) => callback(mocks.prismaTx));
  });

  it("binds default wake identity to the connection epoch", () => {
    const base = {
      connectionId: "dsc_123",
      occurredAt: "2026-03-26T12:01:00.000Z",
      provider: "oura",
      source: "disconnect" as const,
      traceId: null,
      userId: "user-123",
    };

    const epochAWakeId = buildHostedDeviceSyncWakeEventId({
      ...base,
      expectedConnectedAt: "2026-03-26T12:00:00.000Z",
    });
    const epochBWakeId = buildHostedDeviceSyncWakeEventId({
      ...base,
      expectedConnectedAt: "2026-03-26T12:02:00.000Z",
    });

    expect(epochAWakeId).toBe(
      "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z:2026-03-26T12:01:00.000Z",
    );
    expect(epochBWakeId).not.toBe(epochAWakeId);
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

  it("forwards the required hosted callback owner to shared public ingress", async () => {
    const handleConnectionCallback = vi.fn().mockResolvedValue({
      account: buildHostedConnection(),
      returnTo: null,
    });
    mocks.createDeviceSyncPublicIngress.mockReturnValueOnce({
      describeProviders: vi.fn(() => []),
      handleConnectionCallback,
    });
    const ingress = createHostedDeviceSyncPublicIngressService(
      new Request(
        "https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz&scope=read%3Asleep",
      ),
    );

    await ingress.handleConnectionCallback("oura", {
      expectedOwnerId: "member_a",
    });

    expect(handleConnectionCallback).toHaveBeenCalledWith(expect.objectContaining({
      code: "abc",
      error: null,
      errorDescription: null,
      expectedOwnerId: "member_a",
      provider: "oura",
      scope: "read:sleep",
      state: "xyz",
    }));
  });

  it("opens a domain-root unwrap scope around webhook delivery and closes it on failure", async () => {
    const observedCacheDuringDelegation: unknown[] = [];
    const delegationFailure = new Error("webhook delegation sentinel");
    const handleWebhook = vi.fn(async () => {
      // The webhook owner must establish the scope before delegating: without
      // it every secure-box field repeats its envelope read and KMS unwrap.
      observedCacheDuringDelegation.push(getHostedDomainRootUnwrapCache());
      throw delegationFailure;
    });
    mocks.createDeviceSyncPublicIngress.mockReturnValueOnce({
      describeProviders: vi.fn(() => []),
      handleWebhook,
    });
    const ingress = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", {
        body: JSON.stringify({ event_type: "daily.data.steps.created" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(getHostedDomainRootUnwrapCache()).toBeUndefined();

    await expect(ingress.handleWebhook("junction")).rejects.toBe(delegationFailure);

    expect(handleWebhook).toHaveBeenCalledOnce();
    expect(observedCacheDuringDelegation).toHaveLength(1);
    expect(observedCacheDuringDelegation[0]).toBeInstanceOf(Map);
    // The scope is request-bounded: a rejection must not leak cached root keys
    // past the request that unwrapped them.
    expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
  });

  it("reopens companion weight history only for the new explicit-connect source epoch", async () => {
    let currentConnection = buildHostedConnection({
      id: "dsc_junction_123",
      metadata: addJunctionHistoryCoverage(
        addJunctionHistoryCoverage(
          addJunctionHistoryCoverage({}, "apple_health_kit", "caffeine"),
          "apple_health_kit",
          "weight",
        ),
        "withings",
        "weight",
      ),
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    let currentSource = buildHostedConnectionSource(
      currentConnection.id,
      "apple_health_kit",
      {
        lastErrorCode: "SOURCE_USER_DISCONNECTED",
        lastSeenAt: "2026-03-26T11:59:59.999Z",
        resourceAvailabilitySummary: { body_weight: true },
        status: "disconnected",
      },
    );
    mocks.getConnectionForUser.mockImplementation(async () => currentConnection);
    mocks.getStoredConnectionAccountForUser.mockImplementation(
      async () => buildProviderConfigStoredConnection(currentConnection),
    );
    mocks.listConnectionsForUser.mockResolvedValue([currentConnection]);
    mocks.listConnectionSources.mockImplementation(async () => [currentSource]);
    mocks.syncDurableConnectionState.mockImplementation(async (connection) => {
      currentConnection = {
        ...connection,
        updatedAt: "2026-03-26T12:01:00.001Z",
      };
    });
    mocks.upsertConnectionSource.mockImplementation(async (input) => {
      currentSource = {
        ...currentSource,
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        lastSeenAt: input.lastSeenAt ?? currentSource.lastSeenAt,
        status: input.status ?? currentSource.status,
      };
      return currentSource;
    });
    const ingress = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/companion/sign-in-token"),
    );

    await expect(
      ingress.createSdkSignInSession("user-123", "junction", "connect"),
    ).resolves.toMatchObject({ signInToken: "junction-sign-in-token" });

    expect(mocks.createSdkSignInSession).toHaveBeenCalledWith({
      ownerId: "user-123",
      provider: "junction",
    });
    expect(mocks.resumeSdkSignInSession).not.toHaveBeenCalled();
    expect(mocks.listConnectionsForUser).toHaveBeenCalledWith("user-123");
    expect(mocks.upsertConnectionSource).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: currentConnection.id,
      firstSeenAt: "2026-03-26T12:00:00.000Z",
      lastSeenAt: "2026-03-26T12:00:00.000Z",
      sourceInstanceKey: currentSource.sourceInstanceKey,
      sourceProviderSlug: "apple_health_kit",
      status: "disconnected",
      tx: mocks.prismaTx,
    }));
    expect(mocks.upsertConnectionSource.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.syncDurableConnectionState.mock.invocationCallOrder[0]!,
    );
    expect(currentSource).toMatchObject({
      firstSeenAt: "2026-03-26T12:00:00.000Z",
      lastErrorCode: null,
      lastSeenAt: "2026-03-26T12:00:00.000Z",
      sourceProviderSlug: "apple_health_kit",
      status: "disconnected",
    });
    expect(hasJunctionHistoryCoverage(
      currentConnection.metadata,
      "apple_health_kit",
      "weight",
    )).toBe(false);
    expect(hasJunctionHistoryCoverage(
      currentConnection.metadata,
      "withings",
      "weight",
    )).toBe(true);
    expect(hasJunctionHistoryCoverage(
      currentConnection.metadata,
      "apple_health_kit",
      "caffeine",
    )).toBe(true);
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: currentConnection.metadata }),
      mocks.prismaTx,
    );

    const isSourceAccessActive = vi.fn(async () => true);
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        buildSourceConnectionWork: buildJunctionSourceConnectionWork,
        isSourceAccessActive,
      },
    });
    const registry = { get: mocks.registryGet, list: mocks.registryList, register: vi.fn() };
    const store = new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() });

    await expect(reconcileHostedDeviceSyncConnectionSourceRegistration({
      account: currentConnection,
      registry,
      sourceProviderSlug: "apple_health_kit",
      store,
    })).resolves.toBe("admitted");
    expect(currentSource.status).toBe("connected");

    const provider = createJunctionDeviceSyncProvider({
      apiKey: "sk_us_junction-test",
      clientUserIdSecret: "junction-client-user-id-secret",
      environment: "sandbox",
      fetchImpl: vi.fn(async () => {
        throw new Error("Unexpected Junction request while scheduling.");
      }),
      region: "us",
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    });
    const createScheduledJobs = provider.jobExecutor?.createScheduledJobs;
    expect(createScheduledJobs).toBeDefined();
    const scheduledAccount = {
      ...currentConnection,
      credential: {
        kind: "provider_config" as const,
        credentialMetadata: {},
        providerConfigKey: "junction",
      },
      disconnectGeneration: 0,
      hostedObservedConnectionRevision: 0,
      hostedObservedTokenRevision: 0,
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: null,
      localConnectionRevision: 0,
      localTokenRevision: 0,
      sources: [{
        displayName: currentSource.displayName,
        firstSeenAt: currentSource.firstSeenAt,
        lastDataAt: currentSource.lastDataAt,
        lastErrorCode: currentSource.lastErrorCode,
        lastErrorMessage: currentSource.lastErrorMessage,
        lastSeenAt: currentSource.lastSeenAt,
        resourceAvailabilitySummary: currentSource.resourceAvailabilitySummary,
        resourceCount: Object.keys(currentSource.resourceAvailabilitySummary).length,
        sourceProviderSlug: currentSource.sourceProviderSlug,
        status: currentSource.status,
      }],
    } satisfies StoredDeviceSyncAccount;
    const scheduled = createScheduledJobs?.(
      scheduledAccount,
      "2026-03-27T12:00:00.000Z",
    );

    expect(scheduled?.jobs).toContainEqual(expect.objectContaining({
      kind: "resource",
      payload: expect.objectContaining({
        historicalBackfill: true,
        resource: "weight",
        sourceProviderSlug: "apple_health_kit",
      }),
    }));
  });

  it("preserves future companion weight coverage while still creating the explicit-connect epoch", async () => {
    const futureCoverage = toFutureJunctionHistoryCoverage(
      addJunctionHistoryCoverage(
        addJunctionHistoryCoverage({}, "apple_health_kit", "weight"),
        "withings",
        "weight",
      ),
    );
    const connection = buildHostedConnection({
      id: "dsc_junction_123",
      metadata: futureCoverage,
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    mockConnectionForAdmission(connection);
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mocks.listConnectionSources.mockResolvedValue([
      buildHostedConnectionSource(connection.id, "apple_health_kit", {
        lastErrorCode: "SOURCE_USER_DISCONNECTED",
        status: "disconnected",
      }),
    ]);
    const ingress = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/companion/sign-in-token"),
    );

    await expect(
      ingress.createSdkSignInSession("user-123", "junction", "connect"),
    ).resolves.toMatchObject({ signInToken: "junction-sign-in-token" });

    expect(mocks.upsertConnectionSource).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: connection.id,
      sourceProviderSlug: "apple_health_kit",
      status: "disconnected",
      tx: mocks.prismaTx,
    }));
    expect(connection.metadata).toEqual(futureCoverage);
    expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
  });

  it("does not reset companion weight coverage when explicit connect finds the source already connected", async () => {
    const connection = buildHostedConnection({
      id: "dsc_junction_123",
      metadata: addJunctionHistoryCoverage(
        addJunctionHistoryCoverage({}, "apple_health_kit", "weight"),
        "withings",
        "weight",
      ),
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    mocks.getConnectionForUser.mockResolvedValue(connection);
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mocks.listConnectionSources.mockResolvedValue([
      buildHostedConnectionSource(connection.id, "apple_health_kit"),
    ]);
    const ingress = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/companion/sign-in-token"),
    );

    await expect(
      ingress.createSdkSignInSession("user-123", "junction", "connect"),
    ).resolves.toMatchObject({ signInToken: "junction-sign-in-token" });

    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
    expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
  });

  it("defers current Junction source events to hosted canonical admission", () => {
    createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", {
        method: "POST",
      }),
    );
    const createInput = mocks.createDeviceSyncPublicIngress.mock.calls.at(-1)?.[0] as {
      hooks?: {
        onConnectionSourceObserved?: (input: {
          account: { provider: string };
          eventType: string;
          sourceProviderSlug: string;
        }) => unknown;
      };
    } | undefined;
    const observeSource = createInput?.hooks?.onConnectionSourceObserved;
    expect(observeSource).toBeTypeOf("function");

    expect(observeSource?.({
      account: { provider: "junction" },
      eventType: "provider.connection.created",
      sourceProviderSlug: "apple_health_kit",
    })).toEqual({ sourceAdmissionDeferred: true });
    expect(observeSource?.({
      account: { provider: "junction" },
      eventType: "provider.connection.updated",
      sourceProviderSlug: "apple_health_kit",
    })).toEqual({ sourceAdmissionDeferred: true });
    expect(observeSource?.({
      account: { provider: "junction" },
      eventType: "daily.data.sleep.updated",
      sourceProviderSlug: "apple_health_kit",
    })).toEqual({ sourceAdmissionDeferred: true });
    expect(observeSource?.({
      account: { provider: "junction" },
      eventType: "provider.connection.updated",
      sourceProviderSlug: "fitbit",
    })).toEqual({ sourceAdmissionDeferred: true });
    expect(observeSource?.({
      account: { provider: "oura" },
      eventType: "provider.connection.updated",
      sourceProviderSlug: "fitbit",
    })).toBeUndefined();
    expect(mocks.withHealthDataAdmissionLock).not.toHaveBeenCalled();
  });

  it("does not let an older native connect clear a newer source disconnect", async () => {
    const connection = buildHostedConnection({
      id: "dsc_junction_123",
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    let source = buildHostedConnectionSource(connection.id, "apple_health_kit", {
      lastErrorCode: "SOURCE_USER_DISCONNECTED",
      lastSeenAt: "2026-03-26T12:01:00.000Z",
      status: "disconnected",
    });
    const session = {
      account: connection,
      environment: "sandbox" as const,
      signInToken: "junction-sign-in-token",
    };
    const deferredSession = createDeferred<typeof session>();
    mocks.createSdkSignInSession.mockReturnValue(deferredSession.promise);
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mockConnectionForAdmission(connection);
    mocks.listConnectionSources.mockImplementation(async () => [source]);
    const ingress = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/companion/sign-in-token"),
    );

    const connect = ingress.createSdkSignInSession("user-123", "junction", "connect");
    await vi.waitFor(() => expect(mocks.createSdkSignInSession).toHaveBeenCalledOnce());

    source = {
      ...source,
      lastSeenAt: "2026-03-26T12:02:00.000Z",
    };
    deferredSession.resolve(session);

    await expect(connect).rejects.toMatchObject({
      code: "CONNECTION_CHANGED_DURING_DISCONNECT",
      httpStatus: 409,
      retryable: true,
    });
    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
  });

  it("does not return a native token after account-wide disconnect starts", async () => {
    const establishedConnection = buildHostedConnection({
      id: "dsc_junction_123",
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    let currentConnection = establishedConnection;
    const source = buildHostedConnectionSource(establishedConnection.id, "apple_health_kit", {
      lastErrorCode: "SOURCE_USER_DISCONNECTED",
      status: "disconnected",
    });
    const session = {
      account: establishedConnection,
      environment: "sandbox" as const,
      signInToken: "junction-sign-in-token",
    };
    const deferredSession = createDeferred<typeof session>();
    mocks.createSdkSignInSession.mockReturnValue(deferredSession.promise);
    mocks.listConnectionsForUser.mockResolvedValue([establishedConnection]);
    mocks.getConnectionForUser.mockImplementation(async () => currentConnection);
    mocks.listConnectionSources.mockResolvedValue([source]);
    const ingress = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/companion/sign-in-token"),
    );

    const connect = ingress.createSdkSignInSession("user-123", "junction", "connect");
    await vi.waitFor(() => expect(mocks.createSdkSignInSession).toHaveBeenCalledOnce());
    currentConnection = buildHostedConnection({
      ...establishedConnection,
      lastErrorCode: "DISCONNECT_IN_PROGRESS",
      provider: "junction",
      setupPhase: "source_confirmed",
      status: "reauthorization_required",
    });
    deferredSession.resolve(session);

    await expect(connect).rejects.toMatchObject({
      code: "CONNECTION_CHANGED_DURING_DISCONNECT",
      httpStatus: 409,
      retryable: true,
    });
    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
  });

  it.each(["resume", null] as const)(
    "resumes the one active companion SDK connection for intent %s without ensuring it",
    async (connectionIntent) => {
      mocks.listConnectionsForUser.mockResolvedValueOnce([
        buildHostedConnection({
          id: "dsc_junction_active",
          provider: "junction",
          setupPhase: "source_confirmed",
        }),
      ]);
      const ingress = createHostedDeviceSyncPublicIngressService(
        new Request("https://control.example.test/api/device-sync/companion/sign-in-token"),
      );

      await expect(
        ingress.createSdkSignInSession("user-123", "junction", connectionIntent),
      ).resolves.toMatchObject({ signInToken: "junction-sign-in-token" });

      expect(mocks.resumeSdkSignInSession).toHaveBeenCalledWith({
        accountId: "dsc_junction_active",
        ownerId: "user-123",
        provider: "junction",
      });
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
      expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
      expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
    },
  );

  it("preserves legacy first-connect behavior only when no provider row exists", async () => {
    mocks.listConnectionsForUser.mockResolvedValueOnce([]);
    const ingress = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/companion/sign-in-token"),
    );

    await expect(
      ingress.createSdkSignInSession("user-123", "junction", null),
    ).resolves.toMatchObject({ signInToken: "junction-sign-in-token" });

    expect(mocks.createSdkSignInSession).toHaveBeenCalledWith({
      ownerId: "user-123",
      provider: "junction",
    });
    expect(mocks.resumeSdkSignInSession).not.toHaveBeenCalled();
  });

  it("rejects explicit resume when no provider row exists without ensuring one", async () => {
    mocks.listConnectionsForUser.mockResolvedValueOnce([]);
    const ingress = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/companion/sign-in-token"),
    );

    await expect(
      ingress.createSdkSignInSession("user-123", "junction", "resume"),
    ).rejects.toMatchObject({
      code: "SDK_SIGN_IN_RECONNECT_REQUIRED",
      httpStatus: 409,
      retryable: false,
    });
    expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    expect(mocks.resumeSdkSignInSession).not.toHaveBeenCalled();
  });

  it.each(["resume", null] as const)(
    "requires an explicit reconnect for terminal companion state with intent %s",
    async (connectionIntent) => {
      mocks.listConnectionsForUser.mockResolvedValueOnce([
        buildHostedConnection({
          id: "dsc_junction_terminal",
          provider: "junction",
          setupPhase: "source_confirmed",
          status: "disconnected",
        }),
      ]);
      const ingress = createHostedDeviceSyncPublicIngressService(
        new Request("https://control.example.test/api/device-sync/companion/sign-in-token"),
      );

      await expect(
        ingress.createSdkSignInSession("user-123", "junction", connectionIntent),
      ).rejects.toMatchObject({
        code: "SDK_SIGN_IN_RECONNECT_REQUIRED",
        httpStatus: 409,
        retryable: false,
      });
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
      expect(mocks.resumeSdkSignInSession).not.toHaveBeenCalled();
    },
  );

  it("rejects ambiguous active companion SDK connections without minting or ensuring", async () => {
    mocks.listConnectionsForUser.mockResolvedValueOnce([
      buildHostedConnection({
        id: "dsc_junction_active_1",
        provider: "junction",
        setupPhase: "source_confirmed",
      }),
      buildHostedConnection({
        id: "dsc_junction_active_2",
        provider: "junction",
        setupPhase: "source_confirmed",
      }),
    ]);
    const ingress = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/companion/sign-in-token"),
    );

    await expect(
      ingress.createSdkSignInSession("user-123", "junction", "resume"),
    ).rejects.toMatchObject({
      code: "SDK_SIGN_IN_CONNECTION_AMBIGUOUS",
      httpStatus: 409,
      retryable: false,
    });
    expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    expect(mocks.resumeSdkSignInSession).not.toHaveBeenCalled();
  });

  it("uses explicit scheduled wake identity and created time for inserted due-reconcile signals", async () => {
    await appendHostedDeviceSyncScheduledReconcileWake({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:01:00.000Z",
      eventId: "device-sync:scheduled-reconcile:abc123",
      expectedConnectedAt: "2026-03-26T12:00:00.000Z",
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
          expectedConnectedAt: "2026-03-26T12:00:00.000Z",
          reason: "reconcile_due",
        }),
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
  });

  it("cuts scheduled wake identity over from consumed v2 envelopes", () => {
    const input = {
      connectionId: "dsc_123",
      expectedConnectedAt: "2026-03-26T12:00:00.000Z",
      nextReconcileAt: "2026-03-26T12:30:00.000Z",
    };
    const legacyConsumedEventId =
      "device-sync:scheduled-reconcile:v2:dsc_123:2026-03-26T12:00:00.000Z:2026-03-26T12:30:00.000Z";
    const currentEventId = buildHostedDeviceSyncScheduledReconcileWakeEventId(input);

    expect(currentEventId).toBe(
      "device-sync:scheduled-reconcile:v3:dsc_123:2026-03-26T12:00:00.000Z:2026-03-26T12:30:00.000Z",
    );
    expect(currentEventId).not.toBe(legacyConsumedEventId);
    expect(buildHostedDeviceSyncScheduledReconcileWakeEventId(input)).toBe(currentEventId);
  });

  it("does not append scheduled reconcile work after explicit consent withdrawal", async () => {
    mocks.prisma.hostedConsentGrant.findUnique.mockResolvedValueOnce({
      scope: "launch.health-data",
      status: "revoked",
    });
    await expect(appendHostedDeviceSyncScheduledReconcileWake({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:01:00.000Z",
      eventId: "device-sync:scheduled-reconcile:abc123",
      expectedConnectedAt: "2026-03-26T12:00:00.000Z",
      nextReconcileAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      userId: "user-123",
    })).resolves.toEqual({
      reason: "health_data_consent_withdrawn",
      wakeAccepted: false,
      wakeAppended: false,
      wakeDuplicate: false,
      wakeInserted: false,
    });

    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
  });

  it("returns queued after a manual reconcile commits even when its wake signal fails", async () => {
    mocks.signalHostedDeviceSyncMailboxRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const request = new Request(
        "https://control.example.test/api/internal/device-sync/reconcile",
        {
          body: JSON.stringify({ connectionId: "dsc_123" }),
          method: "POST",
        },
      );
      const response = await reconcileRoutePost(request);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        connectionId: "dsc_123",
        status: "queued",
      });
      expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(request, {
        maxBodyBytes: 4 * 1024,
      });
      expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: expect.objectContaining({
            connectionId: "dsc_123",
            hint: expect.objectContaining({ reason: "manual_reconcile" }),
            reason: "reconcile_due",
          }),
          tx: mocks.prismaTx,
        }),
      );
      expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
        mailboxItemId: "mailbox_123",
      });
      // Generic wake persistence has no provider redelivery loop, so it must
      // not opt into the webhook-only member-row lock bound.
      expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledWith(
        "user-123",
        "dsc_123",
        expect.any(Function),
      );
      expect(warn).toHaveBeenCalledWith(
        "Hosted device-sync wake Temporal signal failed after mailbox append.",
        expect.objectContaining({
          errorCode: "HOSTED_DEVICE_SYNC_TEMPORAL_SIGNAL_FAILED",
          mailboxItemIdPresent: true,
        }),
      );
      expect(mocks.createSignal).not.toHaveBeenCalled();
      expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("re-signals one unchanged due tuple in the next recovery bucket without appending another mailbox item", async () => {
    mocks.appendHostedMailboxEnvelopeTx
      .mockResolvedValueOnce({
        dedupeConflict: false,
        duplicate: false,
        inserted: true,
        item: {
          id: "mailbox_existing",
          userId: "user-123",
        },
      })
      .mockResolvedValueOnce({
        dedupeConflict: false,
        duplicate: true,
        inserted: false,
        item: {
          id: "mailbox_existing",
          userId: "user-123",
        },
      });
    const canonicalWake = {
      connectionId: "dsc_123",
      eventId: "device-sync:scheduled-reconcile:abc123",
      expectedConnectedAt: "2026-03-26T12:00:00.000Z",
      nextReconcileAt: "2026-03-26T12:00:00.000Z",
      provider: "oura" as const,
      userId: "user-123",
    };

    await expect(appendHostedDeviceSyncScheduledReconcileWake({
      ...canonicalWake,
      createdAt: "2026-03-26T12:00:30.000Z",
    })).resolves.toEqual({
      wakeAccepted: true,
      wakeAppended: true,
      wakeDuplicate: false,
      wakeInserted: true,
    });
    await expect(appendHostedDeviceSyncScheduledReconcileWake({
      ...canonicalWake,
      createdAt: "2026-03-26T12:05:00.000Z",
    })).resolves.toEqual({
      wakeAccepted: true,
      wakeAppended: false,
      wakeDuplicate: true,
      wakeInserted: false,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
    expect(
      mocks.appendHostedMailboxEnvelopeTx.mock.calls.map(([request]) =>
        request.envelope.eventId
      ),
    ).toEqual([canonicalWake.eventId, canonicalWake.eventId]);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime.mock.calls).toEqual([
      [{ mailboxItemId: "mailbox_existing" }],
      [{ mailboxItemId: "mailbox_existing" }],
    ]);
    expect(mocks.createSignal.mock.calls.map(([request]) => ({
      createdAt: request.createdAt,
      nextReconcileAt: request.nextReconcileAt,
    }))).toEqual([
      {
        createdAt: "2026-03-26T12:00:30.000Z",
        nextReconcileAt: canonicalWake.nextReconcileAt,
      },
      {
        createdAt: "2026-03-26T12:05:00.000Z",
        nextReconcileAt: canonicalWake.nextReconcileAt,
      },
    ]);
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
      expectedConnectedAt: "2026-03-26T12:00:00.000Z",
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

  it("appends one deterministic device-sync wake when a level webhook makes a connection dirty", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("oura", Buffer.from("{}"))).resolves.toEqual({
      accepted: true,
    });

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "dsc_123",
      dirtyAt: "2026-03-26T11:59:00.000Z",
      eventType: "sleep.updated",
      provider: "oura",
      resourceCategory: "daily_sleep",
      traceId: "trace_123",
      tx: mocks.prismaTx,
      userId: "user-123",
    }));
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          connectionId: "dsc_123",
          eventId: "device-sync:dirty:v1:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z:1",
          expectedConnectedAt: "2026-03-26T12:00:00.000Z",
          hint: expect.objectContaining({
            eventType: "sleep.updated",
            occurredAt: "2026-03-26T11:59:00.000Z",
            reason: "webhook_dirty_transition",
            resourceCategory: "daily_sleep",
            traceId: "trace_123",
          }),
          kind: "device-sync.wake",
          occurredAt: "2026-03-26T11:59:00.000Z",
          provider: "oura",
          reason: "webhook_hint",
          userId: "user-123",
        }),
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
  });

  it("completes but does not process a prepared queued webhook after consent withdrawal", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        method: "POST",
      }),
    );
    const prepared = await controlPlane.prepareWebhookForDurableEnqueue(
      "oura",
      Buffer.from("{}"),
      new Date("2026-03-26T12:00:00.000Z"),
    );
    mocks.withHealthDataAdmissionLock.mockRejectedValueOnce(deviceSyncError({
      code: "HEALTH_DATA_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Health data processing is no longer authorized.",
      retryable: false,
    }));

    await expect(controlPlane.handlePreparedWebhook(prepared)).resolves.toEqual({
      accepted: true,
    });

    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", "claim-token");
    expect(mocks.getConnectionOwnerId).toHaveBeenCalledTimes(1);
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ["cleanup pending", HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE],
    ["cleanup failed", "SOURCE_USER_DISCONNECTED"],
  ])("terminally settles a prepared Junction registration after consent withdrawal with %s", async (_label, lastErrorCode) => {
    const source = buildHostedConnectionSource("dsc_123", "apple_health_kit", {
      lastErrorCode,
      status: "disconnected",
    });
    const providerRead = vi.fn(async () => true);
    mocks.listConnectionSources.mockResolvedValue([source]);
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        buildSourceConnectionWork: buildJunctionSourceConnectionWork,
        isSourceAccessActive: providerRead,
      },
    });
    mocks.withHealthDataAdmissionLock.mockRejectedValueOnce(deviceSyncError({
      code: "HEALTH_DATA_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Health data processing is no longer authorized.",
      retryable: false,
    }));
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", { method: "POST" }),
    );
    const prepared: PreparedDeviceSyncWebhookV1 = {
      acceptanceMode: "level_dirty_hint",
      eventType: "provider.connection.updated",
      externalAccountId: "acct_sensitive",
      jobs: [],
      provider: "junction",
      receivedAt: "2026-03-26T12:00:00.000Z",
      schema: "murph.device-sync-prepared-webhook.v1",
      sourceProviderSlug: "apple_health_kit",
      traceId: "1".repeat(64),
    };

    await expect(controlPlane.handlePreparedWebhook(prepared)).resolves.toEqual({ accepted: true });

    expect(providerRead).not.toHaveBeenCalled();
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("junction", "1".repeat(64), "claim-token");
    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
    expect(mocks.markWebhookReceived).not.toHaveBeenCalled();
    expect(mocks.markConnectionSourceDataReceived).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("terminally settles prepared Junction work before provider I/O after application rebind", async () => {
    const providerRead = vi.fn(async () => true);
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        buildSourceConnectionWork: buildJunctionSourceConnectionWork,
        isSourceAccessActive: providerRead,
      },
    });
    mocks.getConnectionRecordForUser.mockResolvedValueOnce({
      ...buildWebhookAdmissionRecord({ provider: "junction", setupPhase: "source_confirmed" }),
      providerApplicationId: "dpa_private",
      providerApplicationRevision: 2,
    });
    mocks.listConnectionSources.mockResolvedValue([
      buildHostedConnectionSource("dsc_123", "apple_health_kit", { status: "disconnected" }),
    ]);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", { method: "POST" }),
    );
    const prepared: PreparedDeviceSyncWebhookV1 = {
      acceptanceMode: "level_dirty_hint",
      eventType: "provider.connection.updated",
      externalAccountId: "acct_sensitive",
      jobs: [],
      provider: "junction",
      receivedAt: "2026-03-26T12:00:00.000Z",
      schema: "murph.device-sync-prepared-webhook.v1",
      sourceProviderSlug: "apple_health_kit",
      traceId: "2".repeat(64),
    };

    await expect(controlPlane.handlePreparedWebhook(prepared)).resolves.toEqual({ accepted: true });
    expect(providerRead).not.toHaveBeenCalled();
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("junction", "2".repeat(64), "claim-token", mocks.prismaTx);
    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
    expect(mocks.markWebhookReceived).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("confirms pending Junction setup while admitting a provider-proved source event", async () => {
    const pendingRecord = buildWebhookAdmissionRecord({
      provider: "junction",
      setupExpiresAt: "2026-03-26T12:30:00.000Z",
      setupPhase: "pending_link",
    });
    const source = buildHostedConnectionSource("dsc_123", "garmin", {
      lastSeenAt: "2026-03-26T11:59:00.000Z",
      status: "disconnected",
    });
    const providerRead = vi.fn(async () => true);
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        buildSourceConnectionWork: buildJunctionSourceConnectionWork,
        isSourceAccessActive: providerRead,
      },
    });
    mocks.getConnectionRecordForUser.mockResolvedValue(pendingRecord);
    mocks.listConnectionSourceAdmissionCandidates.mockResolvedValue([
      buildHostedConnectionSourceAdmissionCandidate(source),
    ]);
    mocks.materializeStoredConnectionAccount.mockResolvedValue(
      buildProviderConfigStoredConnection({
        provider: "junction",
        setupExpiresAt: "2026-03-26T12:30:00.000Z",
        setupPhase: "pending_link",
      }),
    );

    await handleHostedDeviceSyncWebhookAccepted({
      account: {
        connectedAt: "2026-03-26T12:00:00.000Z",
        id: "dsc_123",
        provider: "junction",
      },
      claimToken: "claim-token",
      now: "2026-03-26T12:00:00.000Z",
      ownerId: "user-123",
      registry: {
        get: mocks.registryGet,
        list: mocks.registryList,
        register: vi.fn(),
      },
      sourceAdmissionDeferred: true,
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
      traceId: "trace_pending_source",
      webhook: {
        acceptanceMode: "level_dirty_hint",
        dataSourceProviderSlug: "garmin",
        eventType: "daily.data.heartrate.created",
        jobs: [],
        sourceProviderSlug: "garmin",
      },
    });

    expect(providerRead).toHaveBeenCalledOnce();
    expect(mocks.prismaTx.deviceConnection.update).toHaveBeenCalledWith({
      data: {
        setupExpiresAt: null,
        setupPhase: "source_confirmed",
      },
      where: { id: "dsc_123" },
    });
    expect(mocks.upsertConnectionSource).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "dsc_123",
      sourceProviderSlug: "garmin",
      status: "connected",
      tx: mocks.prismaTx,
    }));
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledOnce();
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        envelope: expect.objectContaining({
          hint: expect.objectContaining({
            jobs: [
              expect.objectContaining({
                kind: "backfill",
                payload: expect.objectContaining({ sourceProviderSlug: "garmin" }),
              }),
              expect.objectContaining({
                kind: "reconcile",
                payload: expect.objectContaining({ sourceProviderSlug: "garmin" }),
              }),
            ],
          }),
          reason: "connected",
        }),
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith(
      "junction",
      "trace_pending_source",
      "claim-token",
      mocks.prismaTx,
    );
  });

  it("keeps established source webhooks off the recovery read path", async () => {
    const source = buildHostedConnectionSource("dsc_123", "garmin", {
      status: "connected",
    });
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction" }),
    );
    mocks.listConnectionSourceAdmissionCandidates.mockResolvedValue([
      buildHostedConnectionSourceAdmissionCandidate(source),
    ]);

    await handleHostedDeviceSyncWebhookAccepted({
      account: {
        connectedAt: "2026-03-26T12:00:00.000Z",
        id: "dsc_123",
        provider: "junction",
      },
      claimToken: "claim-token",
      now: "2026-03-26T12:00:00.000Z",
      ownerId: "user-123",
      registry: {
        get: mocks.registryGet,
        list: mocks.registryList,
        register: vi.fn(),
      },
      sourceAdmissionDeferred: false,
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
      traceId: "trace_established_source",
      webhook: {
        acceptanceMode: "level_dirty_hint",
        eventType: "daily.data.heartrate.created",
        jobs: [],
        sourceProviderSlug: "garmin",
      },
    });

    expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledTimes(2);
    expect(mocks.getConnectionRecordForUser).not.toHaveBeenCalled();
    expect(mocks.materializeStoredConnectionAccount).not.toHaveBeenCalled();
    expect(mocks.registryGet).not.toHaveBeenCalled();
  });

  it("terminally settles prepared Junction work when the source epoch changes across provider I/O", async () => {
    const initialSource = buildHostedConnectionSource("dsc_123", "apple_health_kit", {
      lastSeenAt: "2026-03-26T11:59:00.000Z",
      status: "disconnected",
    });
    const providerRead = vi.fn(async () => {
      expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledTimes(1);
      return true;
    });
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        buildSourceConnectionWork: buildJunctionSourceConnectionWork,
        isSourceAccessActive: providerRead,
      },
    });
    mocks.listConnectionSourceAdmissionCandidates
      .mockResolvedValueOnce([buildHostedConnectionSourceAdmissionCandidate(initialSource)])
      .mockResolvedValueOnce([buildHostedConnectionSourceAdmissionCandidate({
        ...initialSource,
        lastSeenAt: "2026-03-26T12:01:00.000Z",
      })]);
    mocks.getConnectionRecordForUser.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction", setupPhase: "source_confirmed" }),
    );
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", { method: "POST" }),
    );
    const prepared: PreparedDeviceSyncWebhookV1 = {
      acceptanceMode: "level_dirty_hint",
      eventType: "provider.connection.updated",
      externalAccountId: "acct_sensitive",
      jobs: [],
      provider: "junction",
      receivedAt: "2026-03-26T12:00:00.000Z",
      schema: "murph.device-sync-prepared-webhook.v1",
      sourceProviderSlug: "apple_health_kit",
      traceId: "3".repeat(64),
    };

    await expect(controlPlane.handlePreparedWebhook(prepared)).resolves.toEqual({ accepted: true });
    expect(providerRead).toHaveBeenCalledOnce();
    expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledTimes(2);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("junction", "3".repeat(64), "claim-token", mocks.prismaTx);
    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
    expect(mocks.markWebhookReceived).not.toHaveBeenCalled();
    expect(mocks.markConnectionSourceDataReceived).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("reads current Apple registration outside transactions before phase-two activation and acceptance", async () => {
    const source = buildHostedConnectionSource("dsc_123", "apple_health_kit", {
      lastSeenAt: "2026-03-26T11:59:00.000Z",
      status: "disconnected",
    });
    let activeTransactions = 0;
    let admissionPhase = 0;
    mocks.withHealthDataAdmissionLock.mockImplementation(async (
      _userId: string,
      _connectionId: string,
      callback: (tx: typeof mocks.prismaTx) => Promise<unknown>,
    ) => {
      admissionPhase += 1;
      activeTransactions += 1;
      try {
        return await callback(mocks.prismaTx);
      } finally {
        activeTransactions -= 1;
      }
    });
    const providerRead = vi.fn(async () => {
      expect(activeTransactions).toBe(0);
      expect(admissionPhase).toBe(1);
      return true;
    });
    mocks.materializeStoredConnectionAccount.mockImplementation(async () => {
      expect(activeTransactions).toBe(0);
      expect(admissionPhase).toBe(1);
      return buildProviderConfigStoredConnection({ provider: "junction" });
    });
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        buildSourceConnectionWork: buildJunctionSourceConnectionWork,
        isSourceAccessActive: providerRead,
      },
    });
    mocks.listConnectionSourceAdmissionCandidates.mockResolvedValue([
      buildHostedConnectionSourceAdmissionCandidate(source),
    ]);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(buildStoredConnection({ provider: "junction" }));
    mocks.getConnectionRecordForUser.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction", setupPhase: "source_confirmed" }),
    );
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", { method: "POST" }),
    );
    const prepared: PreparedDeviceSyncWebhookV1 = {
      acceptanceMode: "level_dirty_hint",
      dataSourceProviderSlug: "apple_health_kit",
      eventType: "provider.connection.updated",
      externalAccountId: "acct_sensitive",
      jobs: [],
      provider: "junction",
      receivedAt: "2026-03-26T12:00:00.000Z",
      schema: "murph.device-sync-prepared-webhook.v1",
      sourceProviderSlug: "apple_health_kit",
      traceId: "4".repeat(64),
    };

    await expect(controlPlane.handlePreparedWebhook(prepared)).resolves.toEqual({ accepted: true });

    expect(providerRead).toHaveBeenCalledOnce();
    expect(admissionPhase).toBe(3);
    expect(mocks.materializeStoredConnectionAccount).toHaveBeenCalledOnce();
    expect(mocks.getStoredConnectionAccountForUser).not.toHaveBeenCalled();
    expect(mocks.getConnectionRecordForUser).toHaveBeenCalledTimes(3);
    expect(mocks.upsertConnectionSource).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "dsc_123",
      sourceProviderSlug: "apple_health_kit",
      status: "connected",
      tx: mocks.prismaTx,
    }));
    expect(mocks.markWebhookReceived).toHaveBeenCalledWith(
      "dsc_123",
      "2026-03-26T12:00:00.000Z",
      mocks.prismaTx,
    );
    expect(mocks.markConnectionSourceDataReceived).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      now: "2026-03-26T12:00:00.000Z",
      sourceProviderSlug: "apple_health_kit",
      tx: mocks.prismaTx,
    });
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledOnce();
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith(
      "junction",
      "4".repeat(64),
      "claim-token",
      mocks.prismaTx,
    );
  });

  it.each(preparedWebhookCredentialEpochDrifts)(
    "retries a prepared Apple registration when its %s changes across provider I/O",
    async (_label, credentialPatch) => {
    const source = buildHostedConnectionSource("dsc_123", "apple_health_kit", {
      lastSeenAt: "2026-03-26T11:59:00.000Z",
      status: "disconnected",
    });
    const providerRead = vi.fn(async () => true);
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        buildSourceConnectionWork: buildJunctionSourceConnectionWork,
        isSourceAccessActive: providerRead,
      },
    });
    mocks.listConnectionSourceAdmissionCandidates.mockResolvedValue([
      buildHostedConnectionSourceAdmissionCandidate(source),
    ]);
    const firstCredentialEpoch = buildWebhookAdmissionRecord({
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    mocks.getConnectionRecordForUser
      .mockResolvedValueOnce(firstCredentialEpoch)
      .mockResolvedValueOnce({
        ...firstCredentialEpoch,
        ...credentialPatch,
      });
    mocks.getConnectionRecordForUser.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction", setupPhase: "source_confirmed" }),
    );
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", { method: "POST" }),
    );
    const prepared: PreparedDeviceSyncWebhookV1 = {
      acceptanceMode: "level_dirty_hint",
      eventType: "provider.connection.updated",
      externalAccountId: "acct_sensitive",
      jobs: [],
      provider: "junction",
      receivedAt: "2026-03-26T12:00:00.000Z",
      schema: "murph.device-sync-prepared-webhook.v1",
      sourceProviderSlug: "apple_health_kit",
      traceId: "5".repeat(64),
    };

    await expect(controlPlane.handlePreparedWebhook(prepared)).rejects.toMatchObject({
      code: "CONNECTION_SOURCE_REGISTRATION_RECONCILIATION_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });
    expect(providerRead).toHaveBeenCalledOnce();
    expect(mocks.getConnectionRecordForUser).toHaveBeenCalledTimes(2);
    expect(mocks.getStoredConnectionAccountForUser).not.toHaveBeenCalled();
    expect(mocks.completeWebhookTrace).not.toHaveBeenCalled();
    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
    expect(mocks.markWebhookReceived).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    },
  );

  it("preserves the sole Junction source on webhook receipt signals", async () => {
    const connection = buildHostedConnection({ provider: "junction" });
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction" }),
    );

    await handleHostedDeviceSyncWebhookAccepted({
      account: {
        connectedAt: connection.connectedAt,
        id: connection.id,
        provider: connection.provider,
      },
      claimToken: "claim-token",
      now: "2026-03-26T12:00:00.000Z",
      ownerId: "user-123",
      store: new PrismaDeviceSyncControlPlaneStore({
        prisma: getPrisma(),
      }),
      traceId: "trace_123",
      webhook: {
        acceptanceMode: "level_dirty_hint",
        dataSourceProviderSlug: "health-connect",
        eventType: "daily.data.sleep.updated",
        jobs: [{
          kind: "resource",
          payload: {
            resource: "sleep",
            resourceCategory: "summary",
            sourceProviderSlug: "health-connect",
          },
        }],
        occurredAt: "2026-03-26T11:59:00.000Z",
        resourceCategory: "summary",
      },
    });

    expect(mocks.createSignal).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:00:00.000Z",
      eventType: "daily.data.sleep.updated",
      kind: "webhook_hint",
      occurredAt: "2026-03-26T11:59:00.000Z",
      provider: "junction",
      resourceCategory: "summary",
      sourceProviderSlug: "health_connect",
      traceId: "trace_123",
      userId: "user-123",
    }));
  });

  it("omits source attribution for a data-less historical completion", async () => {
    const connection = buildHostedConnection({ provider: "junction" });
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction" }),
    );

    await handleHostedDeviceSyncWebhookAccepted({
      account: {
        connectedAt: connection.connectedAt,
        id: connection.id,
        provider: connection.provider,
      },
      claimToken: "claim-token",
      now: "2026-03-26T12:00:00.000Z",
      ownerId: "user-123",
      store: new PrismaDeviceSyncControlPlaneStore({
        prisma: getPrisma(),
      }),
      traceId: "trace_123",
      webhook: {
        acceptanceMode: "level_dirty_hint",
        dataSourceProviderSlug: null,
        eventType: "historical.data.sleep.created",
        jobs: [{
          kind: "resource",
          payload: {
            resource: "sleep",
            sourceProviderSlug: "health-connect",
          },
        }],
        occurredAt: "2026-03-26T11:59:00.000Z",
      },
    });

    expect(mocks.createSignal).toHaveBeenCalledWith(expect.objectContaining({
      sourceProviderSlug: null,
    }));
  });

  it("stages companion metadata inside encrypted dirty state without copying health data into the wake", async () => {
    const connection = buildHostedConnection({
      displayName: "Apple Health",
      provider: "junction",
    });
    const dirty = buildDirtyConnectionRecord({
      provider: "junction",
    });
    mockConnectionForAdmission(connection);
    mocks.upsertDirtyConnection.mockResolvedValue({
      dirty,
      shouldRequestWake: true,
    });
    mocks.prismaTx.deviceSyncDirtyPayload.count.mockResolvedValue(16);
    const webhookDataJson = JSON.stringify({
      records: [{
        endAt: "2026-07-08T12:00:00.000Z",
        kind: "recovery_score",
        recordId: "a".repeat(64),
        startAt: "2026-07-08T04:00:00.000Z",
        value: 80,
      }],
      schemaVersion: 1,
    });

    await persistHostedDeviceSyncCompanionMetadata({
      connectionId: connection.id,
      occurredAt: "2026-07-09T12:00:00.000Z",
      resource: {
        count: 1,
        jobKind: "resource",
        payload: {
          resource: "companion_health_metadata",
          webhookDataJson,
        },
        resource: "companion_health_metadata",
        resourceCategory: "summary",
        sourceProviderSlug: "apple-health-kit",
        windowEnd: "2026-07-08T12:00:00.000Z",
        windowStart: "2026-07-08T04:00:00.000Z",
      },
      store: new PrismaDeviceSyncControlPlaneStore({
        prisma: getPrisma(),
      }),
      userId: "user-123",
    });

    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
    expect(mocks.prismaTx.deviceConnection.findUnique).toHaveBeenCalledWith({
      select: {
        connectedAt: true,
        provider: true,
        setupPhase: true,
        status: true,
        userId: true,
      },
      where: { id: connection.id },
    });
    // Companion ingestion has no provider redelivery loop, so it must not opt
    // into the webhook-only member-row lock bound (exact three-argument call).
    expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledWith(
      "user-123",
      connection.id,
      expect.any(Function),
    );
    expect(mocks.listConnectionSourceAdmissionCandidates).toHaveBeenCalledTimes(2);
    expect(mocks.listConnectionSourceAdmissionCandidates).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      sourceProviderSlug: "apple_health_kit",
      tx: mocks.prismaTx,
    });
    expect(mocks.prismaTx.deviceSyncDirtyPayload.count).toHaveBeenCalledWith({
      where: {
        connectionId: connection.id,
        userId: "user-123",
      },
    });
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: connection.id,
      eventType: "companion.health_metadata.v1",
      provider: "junction",
      resources: [expect.objectContaining({
        payload: expect.objectContaining({ webhookDataJson }),
      })],
      tx: mocks.prismaTx,
      userId: "user-123",
    }));
    const wakeEnvelope = mocks.appendHostedMailboxEnvelope.mock.calls[0]?.[0]?.envelope;
    expect(wakeEnvelope).toMatchObject({
      eventId: `device-sync:dirty:v1:user-123:junction:${connection.id}:${connection.connectedAt}:1`,
      expectedConnectedAt: connection.connectedAt,
      hint: {
        eventType: "companion.health_metadata.v1",
        occurredAt: "2026-07-09T12:00:00.000Z",
        reason: "companion_health_metadata",
        resourceCategory: "summary",
      },
      provider: "junction",
      reason: "webhook_hint",
    });
    expect(JSON.stringify(wakeEnvelope)).not.toContain(webhookDataJson);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
  });

  it("fully replans companion admission after the real mailbox root preparation drifts", async () => {
    const connection = buildHostedConnection({ provider: "junction" });
    const preparationCaches: unknown[] = [];
    mockConnectionForAdmission(connection);
    mocks.prepareDirtyConnectionUpsert.mockImplementation(async (input) => {
      preparationCaches.push(getHostedDomainRootUnwrapCache());
      return {
        ...input,
        dirtyRevision: 1n,
        shouldRequestWake: true,
      };
    });
    mocks.appendHostedMailboxEnvelopeTx.mockRejectedValueOnce(
      new HostedDomainRootPreparationMismatchError(),
    );

    await persistHostedDeviceSyncCompanionMetadata({
      connectionId: connection.id,
      occurredAt: "2026-07-09T12:00:00.000Z",
      resource: {
        count: 1,
        jobKind: "resource",
        payload: { webhookDataJson: "{}" },
        resource: "companion_health_metadata",
        resourceCategory: "summary",
        sourceProviderSlug: "apple-health-kit",
        windowEnd: "2026-07-08T12:00:00.000Z",
        windowStart: "2026-07-08T04:00:00.000Z",
      },
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
      userId: "user-123",
    });

    expect(preparationCaches).toHaveLength(2);
    expect(preparationCaches[0]).toBeDefined();
    expect(preparationCaches[1]).toBeDefined();
    expect(preparationCaches[1]).not.toBe(preparationCaches[0]);
    expect(mocks.prepareDirtyConnectionUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.prepareHostedMailboxItemAppendCrypto).toHaveBeenCalledTimes(2);
    expect(mocks.upsertDirtyConnectionWithPreparedPlanTx).toHaveBeenCalledTimes(2);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledTimes(1);
  });

  it("returns retryable stale preparation when companion mailbox root drift repeats", async () => {
    const connection = buildHostedConnection({ provider: "junction" });
    mockConnectionForAdmission(connection);
    mocks.appendHostedMailboxEnvelopeTx
      .mockRejectedValueOnce(new HostedDomainRootPreparationMismatchError())
      .mockRejectedValueOnce(new HostedDomainRootPreparationMismatchError());

    await expect(persistHostedDeviceSyncCompanionMetadata({
      connectionId: connection.id,
      occurredAt: "2026-07-09T12:00:00.000Z",
      resource: {
        count: 1,
        jobKind: "resource",
        payload: { webhookDataJson: "{}" },
        resource: "companion_health_metadata",
        resourceCategory: "summary",
        sourceProviderSlug: "apple-health-kit",
        windowEnd: "2026-07-08T12:00:00.000Z",
        windowStart: "2026-07-08T04:00:00.000Z",
      },
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
      userId: "user-123",
    })).rejects.toMatchObject({
      code: "HOSTED_DEVICE_SYNC_PREPARATION_STALE",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.prepareDirtyConnectionUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.prepareHostedMailboxItemAppendCrypto).toHaveBeenCalledTimes(2);
    expect(mocks.upsertDirtyConnectionWithPreparedPlanTx).toHaveBeenCalledTimes(2);
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("does not append a second wake while companion dirty work is already pending", async () => {
    const connection = buildHostedConnection({ provider: "junction" });
    mockConnectionForAdmission(connection);
    mocks.listConnectionSources.mockResolvedValue([{
      sourceProviderSlug: "apple_health_kit",
      status: "connected",
    }]);
    mocks.upsertDirtyConnection.mockResolvedValue({
      dirty: buildDirtyConnectionRecord({ provider: "junction" }),
      shouldRequestWake: false,
    });

    await persistHostedDeviceSyncCompanionMetadata({
      connectionId: connection.id,
      occurredAt: "2026-07-09T12:00:00.000Z",
      resource: {
        count: 1,
        jobKind: "resource",
        payload: { webhookDataJson: "{}" },
        resource: "companion_health_metadata",
        resourceCategory: "summary",
        sourceProviderSlug: "apple-health-kit",
        windowEnd: "2026-07-08T12:00:00.000Z",
        windowStart: "2026-07-08T04:00:00.000Z",
      },
      store: new PrismaDeviceSyncControlPlaneStore({
        prisma: getPrisma(),
      }),
      userId: "user-123",
    });

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("rejects companion metadata while the connection backlog is full", async () => {
    const connection = buildHostedConnection({ provider: "junction" });
    mockConnectionForAdmission(connection);
    mocks.listConnectionSources.mockResolvedValue([{
      sourceProviderSlug: "apple_health_kit",
      status: "connected",
    }]);
    mocks.prismaTx.deviceSyncDirtyPayload.count.mockResolvedValue(17);

    await expect(persistHostedDeviceSyncCompanionMetadata({
      connectionId: connection.id,
      occurredAt: "2026-07-09T12:00:00.000Z",
      resource: {
        count: 1,
        jobKind: "resource",
        payload: { webhookDataJson: "{}" },
        resource: "companion_health_metadata",
        resourceCategory: "summary",
        sourceProviderSlug: "apple-health-kit",
        windowEnd: "2026-07-08T12:00:00.000Z",
        windowStart: "2026-07-08T04:00:00.000Z",
      },
      store: new PrismaDeviceSyncControlPlaneStore({
        prisma: getPrisma(),
      }),
      userId: "user-123",
    })).rejects.toMatchObject({
      code: "COMPANION_HEALTH_BACKLOG_FULL",
      httpStatus: 429,
      retryable: true,
    });

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("accepts an exact replay at the backlog cap after the store no-ops it", async () => {
    const connection = buildHostedConnection({ provider: "junction" });
    mockConnectionForAdmission(connection);
    mocks.listConnectionSources.mockResolvedValue([{
      sourceProviderSlug: "apple_health_kit",
      status: "connected",
    }]);
    mocks.upsertDirtyConnection.mockResolvedValue({
      dirty: buildDirtyConnectionRecord({ provider: "junction" }),
      shouldRequestWake: false,
    });
    mocks.prismaTx.deviceSyncDirtyPayload.count.mockResolvedValue(16);

    await expect(persistHostedDeviceSyncCompanionMetadata({
      connectionId: connection.id,
      occurredAt: "2026-07-09T12:05:00.000Z",
      resource: {
        count: 1,
        jobKind: "resource",
        payload: {
          eventType: "companion.health_metadata.v1",
          occurredAt: "2026-07-09T12:05:00.000Z",
          resource: "companion_health_metadata",
          resourceCategory: "summary",
          sourceProviderSlug: "apple-health-kit",
          webhookDataJson: "{}",
        },
        resource: "companion_health_metadata",
        resourceCategory: "summary",
        sourceProviderSlug: "apple-health-kit",
        windowEnd: "2026-07-08T12:00:00.000Z",
        windowStart: "2026-07-08T04:00:00.000Z",
      },
      store: new PrismaDeviceSyncControlPlaneStore({
        prisma: getPrisma(),
      }),
      userId: "user-123",
    })).resolves.toBeUndefined();

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["inactive", buildHostedConnection({
      provider: "junction",
      setupPhase: "source_confirmed",
      status: "disconnected",
    })],
    ["non-Junction", buildHostedConnection({
      provider: "oura",
      setupPhase: "source_confirmed",
    })],
  ])("rejects companion metadata when the selected runtime lane is %s", async (_case, connection) => {
    mockConnectionForAdmission(connection);
    const connectionId = connection?.id ?? "dsc_missing";

    await expect(persistHostedDeviceSyncCompanionMetadata({
      connectionId,
      occurredAt: "2026-07-09T12:00:00.000Z",
      resource: {
        count: 1,
        jobKind: "resource",
        payload: { webhookDataJson: "{}" },
        resource: "companion_health_metadata",
        resourceCategory: "summary",
        sourceProviderSlug: "apple-health-kit",
        windowEnd: "2026-07-08T12:00:00.000Z",
        windowStart: "2026-07-08T04:00:00.000Z",
      },
      store: new PrismaDeviceSyncControlPlaneStore({
        prisma: getPrisma(),
      }),
      userId: "user-123",
    })).rejects.toMatchObject({
      code: "COMPANION_HEALTH_CONNECTION_REQUIRED",
    });

    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("does not append another device-sync wake for level webhooks while dirty work is already pending", async () => {
    mocks.upsertDirtyConnection.mockResolvedValueOnce({
      dirty: buildDirtyConnectionRecord(),
      shouldRequestWake: false,
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("oura", Buffer.from("{}"))).resolves.toEqual({
      accepted: true,
    });

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("surfaces scheduled wake Temporal signal failures before recording the due claim", async () => {
    mocks.signalHostedDeviceSyncMailboxRuntime.mockRejectedValue(new Error("Temporal unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(appendHostedDeviceSyncScheduledReconcileWake({
        connectionId: "dsc_123",
        createdAt: "2026-03-26T12:01:00.000Z",
        eventId: "device-sync:scheduled-reconcile:abc123",
        expectedConnectedAt: "2026-03-26T12:00:00.000Z",
        nextReconcileAt: "2026-03-26T12:00:00.000Z",
        provider: "oura",
        userId: "user-123",
      })).rejects.toThrow("Temporal unavailable");

      expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
      expect(mocks.createSignal).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        "Hosted device-sync wake Temporal signal failed after mailbox append.",
        expect.objectContaining({
          errorCode: "HOSTED_DEVICE_SYNC_TEMPORAL_SIGNAL_FAILED",
          errorMessage: "Temporal unavailable",
          mailboxItemIdPresent: true,
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("queues a disconnected signal and wake together inside the disconnect flow", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const activeConnection = buildHostedConnection({
      setupExpiresAt: "2026-03-26T12:30:00.000Z",
      setupPhase: "pending_link",
    });
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(activeConnection));
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
      clearCredential: true,
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
          eventId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z:2026-03-26T12:00:00.000Z",
          expectedConnectedAt: "2026-03-26T12:00:00.000Z",
        }),
        tx: mocks.prismaTx,
      }),
    );
  });

  it("disconnects only the selected Junction source and fences its late callback", async () => {
    const connection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-established",
      id: "dsc_junction_shared",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const storedConnection = buildProviderConfigStoredConnection(connection);
    let sources = [
      buildHostedConnectionSource(connection.id, "oura"),
      buildHostedConnectionSource(connection.id, "whoop_v2"),
      buildHostedConnectionSource(connection.id, "apple_health_kit"),
    ];
    const siblingSnapshot = sources.slice(1).map((source) => ({ ...source }));
    let releaseRevoke!: () => void;
    const revokePending = new Promise<void>((resolve) => {
      releaseRevoke = resolve;
    });
    const revokeSourceAccess = vi.fn(() => revokePending);
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mockConnectionForAdmission(connection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    mocks.listConnectionSources.mockImplementation(async () => sources);
    mocks.registryGet.mockReturnValue({
      connectionHandler: { revokeSourceAccess },
    });
    mocks.upsertConnectionSource.mockImplementation(async (input) => {
      const existing = sources.find((source) => source.sourceInstanceKey === input.sourceInstanceKey);
      if (!existing) {
        throw new Error("Test source was not found.");
      }
      const updated = {
        ...existing,
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        lastSeenAt: input.lastSeenAt ?? existing.lastSeenAt,
        status: input.status ?? existing.status,
      };
      sources = sources.map((source) => source.id === existing.id ? updated : source);
      return updated;
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/source/disconnect"),
    );

    const disconnect = controlPlane.disconnectConnectionSource(
      "user-123",
      buildPublicConnectionId(connection.id),
      "oura",
    );

    await vi.waitFor(() => {
      expect(revokeSourceAccess).toHaveBeenCalledTimes(1);
    });
    expect(sources[0]).toMatchObject({
      lastErrorCode: HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      sourceProviderSlug: "oura",
      status: "connected",
    });
    await expect(handleHostedDeviceSyncConnectionEstablished({
      account: {
        connectedAt: connection.connectedAt,
        id: connection.id,
        provider: "junction",
        scopes: [],
        status: "active",
      },
      connection: { initialJobs: [], nextReconcileAt: null },
      now: "2026-03-26T12:00:30.000Z",
      sourceProviderSlug: "oura",
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
    })).rejects.toMatchObject({
      code: "CONNECTION_ESTABLISHMENT_STALE",
      httpStatus: 409,
    });

    releaseRevoke();
    await expect(disconnect).resolves.toEqual({
      sourceProviderSlug: "oura",
      status: "disconnected",
    });

    expect(revokeSourceAccess).toHaveBeenCalledWith(storedConnection, "oura");
    expect(sources[0]).toMatchObject({
      lastErrorCode: "SOURCE_USER_DISCONNECTED",
      sourceProviderSlug: "oura",
      status: "disconnected",
    });
    expect(sources.slice(1)).toEqual(siblingSnapshot);
    expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.clearStoredProviderConfigCredential).not.toHaveBeenCalled();
    expect(mocks.createSignal).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: connection.id,
      kind: "source_disconnected",
      provider: "junction",
      sourceProviderSlug: "oura",
      tx: mocks.prismaTx,
      userId: "user-123",
    }));
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();

    await expect(handleHostedDeviceSyncConnectionEstablished({
      account: {
        connectedAt: connection.connectedAt,
        id: connection.id,
        provider: "junction",
        scopes: [],
        status: "active",
      },
      connection: { initialJobs: [], nextReconcileAt: null },
      now: "2026-03-26T12:01:00.000Z",
      sourceProviderSlug: "oura",
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
    })).rejects.toMatchObject({
      code: "CONNECTION_ESTABLISHMENT_STALE",
      httpStatus: 409,
    });

    sources = sources.map((source) => source.sourceProviderSlug === "oura"
      ? {
          ...source,
          lastErrorCode: null,
          lastSeenAt: "2026-03-26T12:02:00.000Z",
        }
      : source);
    await expect(handleHostedDeviceSyncConnectionEstablished({
      account: {
        connectedAt: connection.connectedAt,
        id: connection.id,
        provider: "junction",
        scopes: [],
        status: "active",
      },
      connection: { initialJobs: [], nextReconcileAt: null },
      connectionStartedAt: "2026-03-26T12:00:00.000Z",
      now: "2026-03-26T12:03:00.000Z",
      sourceProviderSlug: "oura",
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
    })).rejects.toMatchObject({
      code: "CONNECTION_ESTABLISHMENT_STALE",
      httpStatus: 409,
    });
    await expect(handleHostedDeviceSyncConnectionEstablished({
      account: {
        connectedAt: connection.connectedAt,
        id: connection.id,
        provider: "junction",
        scopes: [],
        status: "active",
      },
      connection: { initialJobs: [], nextReconcileAt: null },
      connectionStartedAt: "2026-03-26T12:02:00.000Z",
      now: "2026-03-26T12:04:00.000Z",
      sourceProviderSlug: "oura",
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
    })).resolves.toBeUndefined();
    expect(sources[0]).toMatchObject({
      lastErrorCode: null,
      sourceProviderSlug: "oura",
      status: "connected",
    });
    expect(mocks.upsertConnectionSource).toHaveBeenCalledTimes(3);
    expect(mocks.createSignal).toHaveBeenCalledTimes(2);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
  });

  it("restores the selected Junction source when provider revoke fails", async () => {
    const connection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-established",
      id: "dsc_junction_shared",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const storedConnection = buildProviderConfigStoredConnection(connection);
    let source = buildHostedConnectionSource(connection.id, "oura", {
      lastErrorCode: "TOKEN_REFRESH_FAILED",
      lastErrorMessage: "Reconnect this source.",
      status: "error",
    });
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mockConnectionForAdmission(connection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    mocks.listConnectionSources.mockImplementation(async () => [source]);
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeSourceAccess: vi.fn(async () => {
          throw new Error("provider unavailable");
        }),
      },
    });
    mocks.upsertConnectionSource.mockImplementation(async (input) => {
      source = {
        ...source,
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        lastSeenAt: input.lastSeenAt ?? source.lastSeenAt,
        status: input.status ?? source.status,
      };
      return source;
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/source/disconnect"),
    );

    await expect(controlPlane.disconnectConnectionSource(
      "user-123",
      buildPublicConnectionId(connection.id),
      "oura",
    )).rejects.toMatchObject({
      code: "CONNECTION_SOURCE_DISCONNECT_FAILED",
      httpStatus: 503,
      retryable: true,
    });
    expect(source).toMatchObject({
      lastErrorCode: "TOKEN_REFRESH_FAILED",
      lastErrorMessage: "Reconnect this source.",
      status: "error",
    });
    expect(mocks.createSignal).not.toHaveBeenCalled();
  });

  it("lets obsolete-Link cleanup take over an in-flight source disconnect", async () => {
    const connection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-established",
      id: "dsc_junction_shared",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const storedConnection = buildProviderConfigStoredConnection(connection);
    let sources = [
      buildHostedConnectionSource(connection.id, "oura"),
      buildHostedConnectionSource(connection.id, "whoop_v2"),
    ];
    const sibling = { ...sources[1]! };
    const store = new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() });
    const registry = { get: mocks.registryGet, list: mocks.registryList, register: vi.fn() };
    const revokeSourceAccess = vi.fn(async () => {
      if (revokeSourceAccess.mock.calls.length === 1) {
        for (const connectionStartedAt of [
          "2026-03-26T11:58:00.000Z",
          "2026-03-26T11:59:00.000Z",
        ]) {
          await cleanupRejectedHostedDeviceSyncConnectionSource({
            account: connection,
            connectionStartedAt,
            registry,
            sourceProviderSlug: "oura",
            store,
          });
        }
      }
    });
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mockConnectionForAdmission(connection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    mocks.listConnectionSources.mockImplementation(async () => sources);
    mocks.registryGet.mockReturnValue({ connectionHandler: { revokeSourceAccess } });
    mocks.upsertConnectionSource.mockImplementation(async (input) => {
      const existing = sources.find((source) => source.sourceInstanceKey === input.sourceInstanceKey);
      if (!existing) {
        throw new Error("Test source was not found.");
      }
      const updated = {
        ...existing,
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        lastSeenAt: input.lastSeenAt ?? existing.lastSeenAt,
        status: input.status ?? existing.status,
      };
      sources = sources.map((source) => source.id === existing.id ? updated : source);
      return updated;
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/source/disconnect"),
    );

    await expect(controlPlane.disconnectConnectionSource(
      "user-123",
      buildPublicConnectionId(connection.id),
      "oura",
    )).resolves.toEqual({ sourceProviderSlug: "oura", status: "disconnected" });

    expect(revokeSourceAccess).toHaveBeenCalledTimes(3);
    expect(sources[0]).toMatchObject({
      lastErrorCode: "SOURCE_USER_DISCONNECTED",
      sourceProviderSlug: "oura",
      status: "disconnected",
    });
    expect(sources[1]).toEqual(sibling);
    expect(mocks.createSignal).toHaveBeenCalledTimes(1);
  });

  it("restores the source when obsolete-Link takeover cannot revoke it", async () => {
    const connection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-established",
      id: "dsc_junction_shared",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const storedConnection = buildProviderConfigStoredConnection(connection);
    let sources = [
      buildHostedConnectionSource(connection.id, "oura"),
      buildHostedConnectionSource(connection.id, "whoop_v2"),
    ];
    const sourceSnapshot = { ...sources[0]! };
    const siblingSnapshot = { ...sources[1]! };
    const store = new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() });
    const registry = { get: mocks.registryGet, list: mocks.registryList, register: vi.fn() };
    const revokeSourceAccess = vi.fn(async () => {
      if (revokeSourceAccess.mock.calls.length === 1) {
        await cleanupRejectedHostedDeviceSyncConnectionSource({
          account: connection,
          connectionStartedAt: "2026-03-26T11:59:00.000Z",
          registry,
          sourceProviderSlug: "oura",
          store,
        });
        return;
      }
      throw new Error("provider unavailable");
    });
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mockConnectionForAdmission(connection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    mocks.listConnectionSources.mockImplementation(async () => sources);
    mocks.registryGet.mockReturnValue({ connectionHandler: { revokeSourceAccess } });
    mocks.upsertConnectionSource.mockImplementation(async (input) => {
      const existing = sources.find((source) => source.sourceInstanceKey === input.sourceInstanceKey);
      if (!existing) {
        throw new Error("Test source was not found.");
      }
      const updated = {
        ...existing,
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        lastSeenAt: input.lastSeenAt ?? existing.lastSeenAt,
        status: input.status ?? existing.status,
      };
      sources = sources.map((source) => source.id === existing.id ? updated : source);
      return updated;
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/source/disconnect"),
    );

    await expect(controlPlane.disconnectConnectionSource(
      "user-123",
      buildPublicConnectionId(connection.id),
      "oura",
    )).rejects.toMatchObject({
      code: "CONNECTION_SOURCE_DISCONNECT_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    expect(revokeSourceAccess).toHaveBeenCalledTimes(2);
    expect(sources[0]).toEqual(sourceSnapshot);
    expect(sources[1]).toEqual(siblingSnapshot);
    expect(mocks.createSignal).not.toHaveBeenCalled();
  });

  it("rechecks provider state when an already-disconnected Junction source is removed again", async () => {
    const connection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-established",
      id: "dsc_junction_shared",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const storedConnection = buildProviderConfigStoredConnection(connection);
    let source = buildHostedConnectionSource(connection.id, "oura", {
      lastErrorCode: "SOURCE_USER_DISCONNECTED",
      status: "disconnected",
    });
    const revokeSourceAccess = vi.fn(async () => undefined);
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mockConnectionForAdmission(connection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    mocks.listConnectionSources.mockImplementation(async () => [source]);
    mocks.registryGet.mockReturnValue({ connectionHandler: { revokeSourceAccess } });
    mocks.upsertConnectionSource.mockImplementation(async (input) => {
      source = {
        ...source,
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        lastSeenAt: input.lastSeenAt ?? source.lastSeenAt,
        status: input.status ?? source.status,
      };
      return source;
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/source/disconnect"),
    );

    await expect(controlPlane.disconnectConnectionSource(
      "user-123",
      buildPublicConnectionId(connection.id),
      "oura",
    )).resolves.toEqual({ sourceProviderSlug: "oura", status: "disconnected" });

    expect(revokeSourceAccess).toHaveBeenCalledOnce();
    expect(source).toMatchObject({
      lastErrorCode: "SOURCE_USER_DISCONNECTED",
      status: "disconnected",
    });
    expect(mocks.createSignal).not.toHaveBeenCalled();
  });

  it("cleans an obsolete Link registration without crossing a newer accepted source epoch", async () => {
    const connection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-established",
      id: "dsc_junction_shared",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const storedConnection = buildProviderConfigStoredConnection(connection);
    let sources = [
      buildHostedConnectionSource(connection.id, "oura", {
        lastErrorCode: "SOURCE_USER_DISCONNECTED",
        lastSeenAt: "2026-03-26T12:01:00.000Z",
        status: "disconnected",
      }),
      buildHostedConnectionSource(connection.id, "whoop"),
    ];
    const sibling = { ...sources[1]! };
    const revokeSourceAccess = vi.fn(async () => undefined);
    mockConnectionForAdmission(connection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    mocks.listConnectionSources.mockImplementation(async () => sources);
    mocks.registryGet.mockReturnValue({ connectionHandler: { revokeSourceAccess } });
    mocks.upsertConnectionSource.mockImplementation(async (input) => {
      const existing = sources.find((source) => source.sourceInstanceKey === input.sourceInstanceKey);
      if (!existing) {
        throw new Error("Test source was not found.");
      }
      const updated = {
        ...existing,
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        lastSeenAt: input.lastSeenAt ?? existing.lastSeenAt,
        status: input.status ?? existing.status,
      };
      sources = sources.map((source) => source.id === existing.id ? updated : source);
      return updated;
    });

    await cleanupRejectedHostedDeviceSyncConnectionSource({
      account: connection,
      connectionStartedAt: "2026-03-26T12:00:00.000Z",
      registry: { get: mocks.registryGet, list: mocks.registryList, register: vi.fn() },
      sourceProviderSlug: "oura",
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
    });

    expect(revokeSourceAccess).toHaveBeenCalledWith(storedConnection, "oura");
    expect(sources[0]).toMatchObject({
      lastErrorCode: "SOURCE_USER_DISCONNECTED",
      status: "disconnected",
    });
    expect(sources[1]).toEqual(sibling);

    sources = sources.map((source) => source.sourceProviderSlug === "oura"
      ? {
          ...source,
          lastErrorCode: null,
          lastSeenAt: "2026-03-26T12:02:00.000Z",
          status: "connected" as const,
        }
      : source);
    await cleanupRejectedHostedDeviceSyncConnectionSource({
      account: connection,
      connectionStartedAt: "2026-03-26T12:00:00.000Z",
      registry: { get: mocks.registryGet, list: mocks.registryList, register: vi.fn() },
      sourceProviderSlug: "oura",
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
    });

    expect(revokeSourceAccess).toHaveBeenCalledTimes(1);
    expect(sources[0]).toMatchObject({ status: "connected" });
  });

  it("re-reads inside the connection mutation lock before clearing refreshed tokens", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
      .mockResolvedValueOnce(buildDisconnectingConnection(afterRefresh));
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
      clearCredential: true,
      clearRefreshLease: true,
      connectionId: "dsc_123",
      externalAccountId: afterRefreshStored.externalAccountId,
      provider: "oura",
      tokenBundle: null,
      tx: mocks.prismaTx,
    });
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
  });

  it("blocks disconnect before provider work when an OAuth refresh lease is present", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const activeConnection = buildHostedConnection();
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser.mockResolvedValue(activeConnection);
    mocks.getConnectionRecordForUser.mockResolvedValue({
      credentialKind: "oauth_tokens",
      refreshLeaseExpiresAt: new Date("2099-03-26T12:05:00.000Z"),
      refreshLeaseOwner: "agent-refresh:lease-proof",
      refreshLeaseTokenVersion: 2,
      tokenVersion: 2,
    });

    await expect(controlPlane.disconnectConnection(
      "user-123",
      buildPublicConnectionId("dsc_123"),
    )).rejects.toMatchObject({
      code: "TOKEN_REFRESH_IN_PROGRESS",
      httpStatus: 409,
      retryable: true,
    });

    expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", {
      refreshLeaseExpiresAt: new Date("2020-03-26T12:05:00.000Z"),
      refreshLeaseOwner: "agent-refresh:expired",
      refreshLeaseTokenVersion: 2,
    }],
    ["malformed", {
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: "",
      refreshLeaseTokenVersion: 2,
    }],
    ["for an obsolete token version", {
      refreshLeaseExpiresAt: new Date("2099-03-26T12:05:00.000Z"),
      refreshLeaseOwner: "agent-refresh:obsolete",
      refreshLeaseTokenVersion: 1,
    }],
  ])("clears only the lease and blocks provider work when a refresh lease is %s", async (_label, lease) => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const activeConnection = buildHostedConnection();
    const revokeAccess = vi.fn(async () => undefined);
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser.mockResolvedValue(activeConnection);
    mocks.getConnectionRecordForUser.mockResolvedValue({
      credentialKind: "oauth_tokens",
      ...lease,
      tokenVersion: 2,
    });
    mocks.registryGet.mockReturnValue({ connectionHandler: { revokeAccess } });

    await expect(controlPlane.disconnectConnection(
      "user-123",
      buildPublicConnectionId("dsc_123"),
    )).rejects.toMatchObject({
      accountStatus: "reauthorization_required",
      code: "TOKEN_REFRESH_STATE_UNKNOWN",
      retryable: false,
    });

    expect(mocks.syncDurableConnectionState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastErrorCode: "TOKEN_REFRESH_STATE_UNKNOWN",
        nextReconcileAt: null,
        status: "reauthorization_required",
      }),
      mocks.prismaTx,
    );
    expect(mocks.clearStaleConnectionRefreshLease).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      tx: mocks.prismaTx,
      userId: "user-123",
    });
    expect(revokeAccess).not.toHaveBeenCalled();
    expect(mocks.getStoredConnectionAccountForUser).not.toHaveBeenCalled();
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.createSignal).toHaveBeenCalledWith(expect.objectContaining({
      kind: "reauthorization_required",
      reason: "token_refresh_state_unknown",
    }));
  });

  it.each([401, 404])(
    "keeps disconnect blocked after stale recovery even if the obsolete credential would receive provider %i",
    async (providerStatus) => {
      const controlPlane = createHostedDeviceSyncPublicIngressService(
        new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
      );
      const recoveredConnection = buildHostedConnection({
        lastErrorCode: "TOKEN_REFRESH_STATE_UNKNOWN",
        lastErrorMessage: "Token refresh state is unknown. Reconnect this source.",
        lastSyncErrorAt: "2026-03-26T12:00:00.000Z",
        status: "reauthorization_required",
      });
      const revokeAccess = vi.fn(async () => {
        throw deviceSyncError({
          code: "PROVIDER_REVOKE_FAILED",
          message: "The obsolete credential no longer identifies the active provider grant.",
          retryable: false,
          httpStatus: providerStatus,
        });
      });
      mocks.listConnectionsForUser.mockResolvedValue([recoveredConnection]);
      mocks.getConnectionForUser.mockResolvedValue(recoveredConnection);
      mocks.getStoredConnectionAccountForUser.mockResolvedValue(buildStoredConnection());
      mocks.getConnectionRecordForUser.mockResolvedValue({
        credentialKind: "oauth_tokens",
        refreshLeaseExpiresAt: null,
        refreshLeaseOwner: null,
        refreshLeaseTokenVersion: null,
        tokenVersion: 2,
      });
      mocks.registryGet.mockReturnValue({ connectionHandler: { revokeAccess } });

      await expect(controlPlane.disconnectConnection(
        "user-123",
        buildPublicConnectionId("dsc_123"),
      )).rejects.toMatchObject({
        accountStatus: "reauthorization_required",
        code: "TOKEN_REFRESH_STATE_UNKNOWN",
        retryable: false,
      });

      expect(mocks.clearStaleConnectionRefreshLease).not.toHaveBeenCalled();
      expect(revokeAccess).not.toHaveBeenCalled();
      expect(mocks.getStoredConnectionAccountForUser).not.toHaveBeenCalled();
      expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
      expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
    },
  );

  it("rejects a stale disconnect when OAuth tokens rotate during provider revoke", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const beforeRefresh = buildHostedConnection({
      accessTokenExpiresAt: "2026-03-26T12:05:00.000Z",
    });
    const afterRefresh = buildHostedConnection({
      accessTokenExpiresAt: "2026-03-26T13:00:00.000Z",
      updatedAt: "2026-03-26T12:01:00.000Z",
    });
    const beforeRefreshStored = buildStoredConnection({
      accessTokenExpiresAt: "2026-03-26T12:05:00.000Z",
    });
    const afterRefreshStored = {
      ...buildStoredConnection({
        accessTokenExpiresAt: "2026-03-26T13:00:00.000Z",
        updatedAt: "2026-03-26T12:01:00.000Z",
      }),
      tokenVersion: 3,
    };
    let currentConnection = beforeRefresh;
    let currentStoredConnection = beforeRefreshStored;
    let releaseRevoke: (() => void) | undefined;
    let markRevokeStarted: (() => void) | undefined;
    const revokeStarted = new Promise<void>((resolve) => {
      markRevokeStarted = resolve;
    });
    const revokeBlocked = new Promise<void>((resolve) => {
      releaseRevoke = resolve;
    });
    const revokeAccess = vi.fn(async () => {
      markRevokeStarted?.();
      await revokeBlocked;
    });
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeAccess,
      },
    });
    mocks.listConnectionsForUser.mockResolvedValue([beforeRefresh]);
    mocks.getConnectionForUser.mockImplementation(async () => currentConnection);
    mocks.getStoredConnectionAccountForUser.mockImplementation(async () => currentStoredConnection);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    const disconnect = controlPlane.disconnectConnection("user-123", publicConnectionId);
    await revokeStarted;
    currentConnection = afterRefresh;
    currentStoredConnection = afterRefreshStored;
    releaseRevoke?.();

    await expect(disconnect).rejects.toMatchObject({
      code: "CONNECTION_CHANGED_DURING_DISCONNECT",
      httpStatus: 409,
      retryable: true,
    });
    expect(revokeAccess).toHaveBeenCalledWith(beforeRefreshStored);
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledTimes(1);
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledWith(
      buildDisconnectingConnection(beforeRefresh),
      mocks.prismaTx,
    );
    expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.clearStoredProviderConfigCredential).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("leaves a reconnect alone after atomically observing a disconnected credential-less epoch", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const beforeReconnect = buildHostedConnection({ status: "disconnected" });
    const afterReconnect = buildHostedConnection({
      connectedAt: "2026-03-26T12:01:00.000Z",
      updatedAt: "2026-03-26T12:01:00.000Z",
    });
    const afterReconnectStored = buildStoredConnection({
      connectedAt: "2026-03-26T12:01:00.000Z",
      updatedAt: "2026-03-26T12:01:00.000Z",
    });
    let currentConnection = beforeReconnect;
    let currentStoredConnection: ReturnType<typeof buildStoredConnection> | null = null;
    let lockCount = 0;
    mocks.listConnectionsForUser.mockResolvedValue([beforeReconnect]);
    mocks.getConnectionForUser.mockImplementation(async () => currentConnection);
    mocks.getStoredConnectionAccountForUser.mockImplementation(async () => currentStoredConnection);
    mocks.getConnectionRecordForUser.mockResolvedValue({
      credentialKind: "none",
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
    });
    mocks.withConnectionMutationLock.mockImplementation(async (
      _connectionId: string,
      callback: (tx: typeof mocks.prismaTx) => Promise<unknown>,
    ) => {
      lockCount += 1;
      const result = await callback(mocks.prismaTx);
      if (lockCount === 1) {
        currentConnection = afterReconnect;
        currentStoredConnection = afterReconnectStored;
      }
      return result;
    });

    await expect(
      controlPlane.disconnectConnection("user-123", buildPublicConnectionId("dsc_123")),
    ).resolves.toMatchObject({
      connection: {
        status: "disconnected",
      },
    });

    expect(lockCount).toBe(1);
    expect(mocks.getConnectionForUser.mock.calls[0]?.[2]).toBe(mocks.prismaTx);
    expect(mocks.getStoredConnectionAccountForUser).not.toHaveBeenCalled();
    expect(mocks.registryGet).not.toHaveBeenCalled();
    expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("rejects a stale disconnect when a reconnect epoch lands during provider revoke", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const beforeReconnect = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
    });
    const afterReconnect = buildHostedConnection({
      connectedAt: "2026-03-26T12:01:00.000Z",
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
      updatedAt: "2026-03-26T12:01:00.000Z",
    });
    const beforeReconnectStored = buildProviderConfigStoredConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
    });
    const afterReconnectStored = buildProviderConfigStoredConnection({
      connectedAt: "2026-03-26T12:01:00.000Z",
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
      updatedAt: "2026-03-26T12:01:00.000Z",
    });
    let currentConnection = beforeReconnect;
    let currentStoredConnection = beforeReconnectStored;
    let releaseRevoke: (() => void) | undefined;
    let markRevokeStarted: (() => void) | undefined;
    const revokeStarted = new Promise<void>((resolve) => {
      markRevokeStarted = resolve;
    });
    const revokeBlocked = new Promise<void>((resolve) => {
      releaseRevoke = resolve;
    });
    const revokeAccess = vi.fn(async () => {
      markRevokeStarted?.();
      await revokeBlocked;
    });
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeAccess,
      },
    });
    mocks.listConnectionsForUser.mockResolvedValue([beforeReconnect]);
    mocks.getConnectionForUser.mockImplementation(async () => currentConnection);
    mocks.getStoredConnectionAccountForUser.mockImplementation(async () => currentStoredConnection);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    const disconnect = controlPlane.disconnectConnection("user-123", publicConnectionId);
    await revokeStarted;
    currentConnection = afterReconnect;
    currentStoredConnection = afterReconnectStored;
    releaseRevoke?.();

    await expect(disconnect).rejects.toMatchObject({
      code: "CONNECTION_CHANGED_DURING_DISCONNECT",
      httpStatus: 409,
      retryable: true,
    });
    expect(revokeAccess).toHaveBeenCalledWith(beforeReconnectStored);
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledTimes(1);
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledWith(
      buildDisconnectingConnection(beforeReconnect),
      mocks.prismaTx,
    );
    expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.clearStoredProviderConfigCredential).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("rejects companion HRV after disconnect intent commits and while provider revoke is pending", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    let currentConnection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const storedConnection = buildProviderConfigStoredConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    let releaseRevoke: (() => void) | undefined;
    let markRevokeStarted: (() => void) | undefined;
    const revokeStarted = new Promise<void>((resolve) => {
      markRevokeStarted = resolve;
    });
    const revokeBlocked = new Promise<void>((resolve) => {
      releaseRevoke = resolve;
    });
    const revokeAccess = vi.fn(async () => {
      markRevokeStarted?.();
      await revokeBlocked;
    });
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeAccess,
      },
    });
    mocks.listConnectionsForUser.mockImplementation(async () => [currentConnection]);
    mocks.getConnectionForUser.mockImplementation(async () => currentConnection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    mocks.syncDurableConnectionState.mockImplementation(async (connection) => {
      currentConnection = connection;
    });
    const disconnect = controlPlane.disconnectConnection(
      "user-123",
      buildPublicConnectionId("dsc_123"),
    );
    await revokeStarted;

    expect(currentConnection).toEqual(expect.objectContaining({
      lastErrorCode: DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      status: "reauthorization_required",
    }));
    expect(mocks.withConnectionMutationLock).toHaveBeenNthCalledWith(
      1,
      "dsc_123",
      expect.any(Function),
    );
    expect(mocks.syncDurableConnectionState).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        lastErrorCode: DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
        status: "reauthorization_required",
      }),
      mocks.prismaTx,
    );
    expect(mocks.syncDurableConnectionState.mock.invocationCallOrder[0]).toBeLessThan(
      revokeAccess.mock.invocationCallOrder[0],
    );
    await expect(acceptTestCompanionHrvRmssdObservation()).rejects.toMatchObject({
      code: "COMPANION_HRV_CONNECTION_REQUIRED",
      httpStatus: 409,
    });
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();

    releaseRevoke?.();
    await expect(disconnect).resolves.toMatchObject({
      connection: {
        status: "disconnected",
      },
    });
  });

  it("retries an interrupted disconnect from its durable intent", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const disconnectingConnection = buildDisconnectingConnection(buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    }));
    const storedConnection = buildProviderConfigStoredConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const revokeAccess = vi.fn(async () => {});
    mocks.registryGet.mockReturnValue({
      connectionHandler: { revokeAccess },
    });
    mocks.listConnectionsForUser.mockResolvedValue([disconnectingConnection]);
    mocks.getConnectionForUser.mockResolvedValue(disconnectingConnection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);

    await expect(controlPlane.disconnectConnection(
      "user-123",
      buildPublicConnectionId("dsc_123"),
    )).resolves.toMatchObject({
      connection: {
        status: "disconnected",
      },
    });

    expect(revokeAccess).toHaveBeenCalledWith(storedConnection);
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledTimes(1);
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastErrorCode: null,
        status: "disconnected",
      }),
      mocks.prismaTx,
    );
  });

  it("revokes active provider-config connections during hosted disconnect", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
      .mockResolvedValueOnce(buildDisconnectingConnection(activeConnection));
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

  it("revokes a member-owned connection with its exact application registry", async () => {
    const activeConnection = buildHostedConnection({
      displayName: "Strava",
      provider: "strava",
    });
    const storedConnection = buildStoredConnection({
      displayName: "Strava",
      provider: "strava",
    });
    const providerConfigs = {
      strava: {
        clientId: "member-client",
        clientSecret: "member-secret",
      },
    };
    const revokeAccess = vi.fn(async () => {});
    mocks.resolveDeviceProviderApplicationForConnection.mockResolvedValue({
      applicationId: "dpa_strava",
      provider: "strava",
      providerConfigs,
      revision: 4,
    });
    mocks.scopedRegistryGet.mockReturnValue({
      connectionHandler: { revokeAccess },
    });
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(activeConnection));
    mocks.getStoredConnectionAccountForUser
      .mockResolvedValueOnce(storedConnection)
      .mockResolvedValueOnce(storedConnection);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request(
        "https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect",
      ),
    );

    await expect(
      controlPlane.disconnectConnection(
        "user-123",
        buildPublicConnectionId("dsc_123"),
      ),
    ).resolves.toMatchObject({
      connection: {
        provider: "strava",
        status: "disconnected",
      },
    });

    expect(mocks.resolveDeviceProviderApplicationForConnection).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      memberId: "user-123",
      prisma: mocks.prisma,
    });
    expect(mocks.createHostedDeviceSyncRegistryWithProviderConfigs).toHaveBeenCalledWith({
      providerConfigs,
    });
    expect(mocks.scopedRegistryGet).toHaveBeenCalledWith("strava");
    expect(mocks.registryGet).not.toHaveBeenCalled();
    expect(revokeAccess).toHaveBeenCalledWith(storedConnection);
  });

  it("uses stored Strava authority to disconnect and purge when private credentials require repair", async () => {
    const activeConnection = buildHostedConnection({
      displayName: "Strava",
      provider: "strava",
    });
    const storedConnection = buildStoredConnection({
      displayName: "Strava",
      provider: "strava",
    });
    mocks.resolveDeviceProviderApplicationForConnection.mockRejectedValue(
      new DeviceProviderApplicationError(
        "DEVICE_PROVIDER_APPLICATION_INVALID",
        "Private provider application credentials are invalid.",
      ),
    );
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(activeConnection));
    mocks.getStoredConnectionAccountForUser
      .mockResolvedValueOnce(storedConnection)
      .mockResolvedValueOnce(storedConnection);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request(
        "https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect",
      ),
    );

    await expect(controlPlane.disconnectConnection(
      "user-123",
      buildPublicConnectionId("dsc_123"),
    )).resolves.toMatchObject({
      connection: {
        provider: "strava",
        status: "disconnected",
      },
    });

    expect(mocks.revokeStravaDeviceSyncAccess).toHaveBeenCalledWith(storedConnection);
    expect(mocks.registryGet).not.toHaveBeenCalled();
    expect(mocks.persistStoredConnectionTokenBundle).toHaveBeenCalledWith({
      clearCredential: true,
      clearRefreshLease: true,
      connectionId: "dsc_123",
      externalAccountId: storedConnection.externalAccountId,
      provider: "strava",
      tokenBundle: null,
      tx: mocks.prismaTx,
    });
  });

  it("propagates transient private-application failures before disconnect mutation", async () => {
    const transientError = Object.assign(new Error("KMS unavailable"), {
      name: "KmsUnavailableError",
    });
    const activeConnection = buildHostedConnection({
      displayName: "Strava",
      provider: "strava",
    });
    mocks.resolveDeviceProviderApplicationForConnection.mockRejectedValue(transientError);
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request(
        "https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect",
      ),
    );

    await expect(controlPlane.disconnectConnection(
      "user-123",
      buildPublicConnectionId("dsc_123"),
    )).rejects.toBe(transientError);

    expect(mocks.revokeStravaDeviceSyncAccess).not.toHaveBeenCalled();
    expect(mocks.registryGet).not.toHaveBeenCalled();
    expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
  });

  it("finishes consent-withdrawal disconnect when private Strava credentials require repair", async () => {
    const activeConnection = buildHostedConnection({
      displayName: "Strava",
      provider: "strava",
    });
    const storedConnection = buildStoredConnection({
      displayName: "Strava",
      provider: "strava",
    });
    mocks.prisma.hostedConsentGrant.findUnique.mockResolvedValue({
      scope: "launch.health-data",
      status: "revoked",
    });
    mocks.resolveDeviceProviderApplicationForConnection.mockRejectedValue(
      new DeviceProviderApplicationError(
        "DEVICE_PROVIDER_APPLICATION_INVALID",
        "Private provider application credentials are invalid.",
      ),
    );
    mocks.listConnectionsRequiringCleanupForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(activeConnection));
    mocks.getStoredConnectionAccountForUser
      .mockResolvedValueOnce(storedConnection)
      .mockResolvedValueOnce(storedConnection);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/legal/health-data-consent"),
    );

    await expect(controlPlane.disconnectAllConnections("user-123")).resolves.toEqual({
      attemptedCount: 1,
      disconnectedCount: 1,
      failedCount: 0,
    });

    expect(mocks.revokeStravaDeviceSyncAccess).toHaveBeenCalledWith(storedConnection);
    expect(mocks.registryGet).not.toHaveBeenCalled();
  });

  it("preserves established Junction siblings and blocks a new source until target cleanup succeeds", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/connect-sources/garmin/start", {
        method: "POST",
      }),
    );
    let currentConnection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-established",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const storedConnection = buildProviderConfigStoredConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-established",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const revokeSourceAccess = vi.fn()
      .mockRejectedValueOnce(new Error("provider cleanup unavailable"))
      .mockResolvedValueOnce(undefined);
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeSourceAccess,
      },
    });
    mocks.listConnectionsForUser.mockImplementation(async () => [currentConnection]);
    mocks.getConnectionForUser.mockImplementation(async () => currentConnection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    mocks.syncDurableConnectionState.mockImplementation(async (connection) => {
      currentConnection = connection;
    });
    mocks.upsertConnectionSource.mockImplementation(async (input) => ({
      ...buildHostedConnectionSource(input.connectionId, input.sourceProviderSlug, {
        lastSeenAt: input.lastSeenAt,
        status: input.status,
      }),
      sourceInstanceKey: input.sourceInstanceKey,
    }));

    await expect(
      controlPlane.prepareConnectionStart("user-123", {
        connectSourceId: "fitbit",
        connectTarget: "fitbit",
        label: "Fitbit",
        provider: "junction",
        sourceProviderSlug: "fitbit",
      }),
    ).rejects.toMatchObject({
      code: "JUNCTION_PENDING_LINK_CLEANUP_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    expect(currentConnection).toEqual(expect.objectContaining({
      setupPhase: "source_confirmed",
      status: "active",
    }));
    expect(revokeSourceAccess).toHaveBeenCalledWith(storedConnection, "fitbit");
    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();

    await expect(
      controlPlane.prepareConnectionStart("user-123", {
        connectSourceId: "fitbit",
        connectTarget: "fitbit",
        label: "Fitbit",
        provider: "junction",
        sourceProviderSlug: "fitbit",
      }),
    ).resolves.toBeUndefined();

    expect(revokeSourceAccess).toHaveBeenCalledTimes(2);
    expect(mocks.upsertConnectionSource).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: currentConnection.id,
        sourceProviderSlug: "fitbit",
        status: "disconnected",
      }),
    );
    expect(mocks.clearStoredProviderConfigCredential).not.toHaveBeenCalled();

    const ingress = mocks.createDeviceSyncPublicIngress.mock.results.at(-1)?.value as {
      startConnection: ReturnType<typeof vi.fn>;
    };
    await controlPlane.startConnection("user-123", "junction", null, {
      connectSourceId: "fitbit",
      connectTarget: "fitbit",
      sourceProviderSlug: "fitbit",
    });
    expect(ingress.startConnection).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceLifecycleProof: expect.objectContaining({
        connectionId: currentConnection.id,
        sourceProviderSlug: "fitbit",
      }),
      sourceProviderSlug: "fitbit",
    }));

    await controlPlane.startConnection("user-123", "junction", null, {
      connectSourceId: "fitbit",
      connectTarget: "fitbit",
      sourceProviderSlug: "fitbit",
    });
    expect(ingress.startConnection).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceLifecycleProof: null,
      sourceProviderSlug: "fitbit",
    }));
  });

  it("reopens only the reconnected source's weight history after provider cleanup", async () => {
    let currentConnection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-established",
      metadata: addJunctionHistoryCoverage({}, "renpho", "weight"),
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const storedConnection = buildProviderConfigStoredConnection(currentConnection);
    let currentSource = buildHostedConnectionSource(currentConnection.id, "withings");
    const revokeSourceAccess = vi.fn(async () => {
      currentConnection = {
        ...currentConnection,
        metadata: addJunctionHistoryCoverage(
          currentConnection.metadata,
          "withings",
          "weight",
        ),
      };
    });
    mocks.registryGet.mockReturnValue({ connectionHandler: { revokeSourceAccess } });
    mocks.listConnectionsForUser.mockImplementation(async () => [currentConnection]);
    mocks.getConnectionForUser.mockImplementation(async () => currentConnection);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    mocks.listConnectionSources.mockImplementation(async () => [currentSource]);
    mocks.upsertConnectionSource.mockImplementation(async (input) => {
      currentSource = {
        ...currentSource,
        lastErrorCode: input.lastErrorCode,
        lastErrorMessage: input.lastErrorMessage,
        lastSeenAt: input.lastSeenAt,
        status: input.status,
      };
      return currentSource;
    });
    mocks.syncDurableConnectionState.mockImplementation(async (connection) => {
      currentConnection = {
        ...connection,
        updatedAt: "2026-03-26T12:00:01.000Z",
      };
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/connect-sources/withings/start", {
        method: "POST",
      }),
    );

    await expect(controlPlane.prepareConnectionStart("user-123", {
      connectSourceId: "withings",
      connectTarget: "withings",
      label: "Withings",
      provider: "junction",
      sourceProviderSlug: "withings",
    })).resolves.toBeUndefined();

    expect(revokeSourceAccess).toHaveBeenCalledWith(storedConnection, "withings");
    expect(hasJunctionHistoryCoverage(
      currentConnection.metadata,
      "renpho",
      "weight",
    )).toBe(true);
    expect(hasJunctionHistoryCoverage(
      currentConnection.metadata,
      "withings",
      "weight",
    )).toBe(false);
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: currentConnection.metadata }),
      mocks.prismaTx,
    );
  });

  it("does not issue a new Link while exact-source provider cleanup is in progress", async () => {
    const connection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-established",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    const revokeSourceAccess = vi.fn(async () => undefined);
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mockConnectionForAdmission(connection);
    mocks.listConnectionSources.mockResolvedValue([
      buildHostedConnectionSource(connection.id, "fitbit", {
        lastErrorCode: HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      }),
    ]);
    mocks.registryGet.mockReturnValue({ connectionHandler: { revokeSourceAccess } });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/connect-sources/fitbit/start", {
        method: "POST",
      }),
    );

    await expect(controlPlane.prepareConnectionStart("user-123", {
      connectSourceId: "fitbit",
      connectTarget: "fitbit",
      label: "Fitbit",
      provider: "junction",
      sourceProviderSlug: "fitbit",
    })).rejects.toMatchObject({
      code: "JUNCTION_PENDING_LINK_CLEANUP_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    expect(revokeSourceAccess).not.toHaveBeenCalled();
    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
  });

  it("fails closed when Junction target cleanup authority is unavailable", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/connect-sources/fitbit/start", {
        method: "POST",
      }),
    );
    const connection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-established",
      provider: "junction",
      scopes: [],
      setupPhase: "source_confirmed",
    });
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(
      buildProviderConfigStoredConnection(connection),
    );
    mocks.registryGet.mockReturnValue({
      connectionHandler: {},
    });

    await expect(
      controlPlane.prepareConnectionStart("user-123", {
        connectSourceId: "fitbit",
        connectTarget: "fitbit",
        label: "Fitbit",
        provider: "junction",
        sourceProviderSlug: "fitbit",
      }),
    ).rejects.toMatchObject({
      code: "JUNCTION_PENDING_LINK_CLEANUP_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
  });

  it("fails closed when revoked provider-config credential cleanup loses its fence", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
      .mockResolvedValueOnce(buildDisconnectingConnection(activeConnection));
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

  it("retains a disconnected provider-config credential when provider cleanup is unavailable", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const disconnectedConnection = buildHostedConnection({
      status: "disconnected",
    });
    mocks.listConnectionsForUser.mockResolvedValue([disconnectedConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(disconnectedConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(disconnectedConnection));
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(buildProviderConfigStoredConnection({
      status: "disconnected",
    }));
    mocks.registryGet.mockReturnValue(undefined);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).resolves.toMatchObject({
      connection: {
        id: publicConnectionId,
        lastErrorCode: "DISCONNECT_RECOVERY_REQUIRED",
        status: "reauthorization_required",
      },
      warning: {
        code: "PROVIDER_REVOKE_NOT_CONFIGURED",
      },
    });

    expect(mocks.withConnectionMutationLock).toHaveBeenCalledWith("dsc_123", expect.any(Function));
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledTimes(2);
    expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.clearStoredProviderConfigCredential).not.toHaveBeenCalled();
    expect(mocks.createSignal).toHaveBeenCalledWith(expect.objectContaining({
      kind: "reauthorization_required",
      revokeWarning: expect.objectContaining({
        code: "PROVIDER_REVOKE_NOT_CONFIGURED",
      }),
    }));
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
  });

  it("reports consent-withdrawal cleanup as failed when the provider revoke hook is unavailable", async () => {
    const activeConnection = buildHostedConnection();
    mocks.prisma.hostedConsentGrant.findUnique.mockResolvedValue({
      scope: "launch.health-data",
      status: "revoked",
    });
    mocks.listConnectionsRequiringCleanupForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(activeConnection));
    mocks.getConnectionRecordForUser.mockResolvedValue({
      credentialKind: "oauth_tokens",
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
    });
    mocks.registryGet.mockReturnValue(undefined);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/legal/health-data-consent"),
    );

    await expect(controlPlane.disconnectAllConnections("user-123")).resolves.toEqual({
      attemptedCount: 1,
      disconnectedCount: 0,
      failedCount: 1,
    });

    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
    expect(mocks.syncDurableConnectionState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastErrorCode: "DISCONNECT_RECOVERY_REQUIRED",
        status: "reauthorization_required",
      }),
      mocks.prismaTx,
    );
  });

  it("retains provider-config authority when consent-withdrawal revoke fails", async () => {
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
    const revokeAccess = vi.fn(async () => {
      throw new Error("provider deregistration outcome unavailable");
    });
    mocks.prisma.hostedConsentGrant.findUnique.mockResolvedValue({
      scope: "launch.health-data",
      status: "revoked",
    });
    mocks.listConnectionsRequiringCleanupForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(activeConnection));
    mocks.getConnectionRecordForUser.mockResolvedValue({
      credentialKind: "provider_config",
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
    });
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    mocks.registryGet.mockReturnValue({ connectionHandler: { revokeAccess } });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/legal/health-data-consent"),
    );

    await expect(controlPlane.disconnectAllConnections("user-123")).resolves.toEqual({
      attemptedCount: 1,
      disconnectedCount: 0,
      failedCount: 1,
    });

    expect(revokeAccess).toHaveBeenCalledWith(storedConnection);
    expect(mocks.syncDurableConnectionState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastErrorCode: "DISCONNECT_RECOVERY_REQUIRED",
        status: "reauthorization_required",
      }),
      mocks.prismaTx,
    );
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.clearStoredProviderConfigCredential).not.toHaveBeenCalled();
    expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
  });

  it("retries consent cleanup for a disconnected retained provider-config credential", async () => {
    const disconnectedConnection = buildHostedConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
      status: "disconnected",
    });
    const storedConnection = buildProviderConfigStoredConnection({
      displayName: "Junction",
      externalAccountId: "junction-user-123",
      provider: "junction",
      scopes: [],
      status: "disconnected",
    });
    const revokeAccess = vi.fn(async () => undefined);
    mocks.prisma.hostedConsentGrant.findUnique.mockResolvedValue({
      scope: "launch.health-data",
      status: "revoked",
    });
    mocks.listConnectionsRequiringCleanupForUser.mockResolvedValue([disconnectedConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(disconnectedConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(disconnectedConnection));
    mocks.getConnectionRecordForUser.mockResolvedValue({
      credentialKind: "provider_config",
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
    });
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    mocks.registryGet.mockReturnValue({ connectionHandler: { revokeAccess } });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/legal/health-data-consent"),
    );

    await expect(controlPlane.disconnectAllConnections("user-123")).resolves.toEqual({
      attemptedCount: 1,
      disconnectedCount: 1,
      failedCount: 0,
    });

    expect(revokeAccess).toHaveBeenCalledWith(storedConnection);
    expect(mocks.clearStoredProviderConfigCredential).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      externalAccountId: "junction-user-123",
      provider: "junction",
      providerConfigKey: "hosted-provider-config",
      tx: mocks.prismaTx,
      userId: "user-123",
    });
    expect(mocks.markConnectionSourcesDisconnected).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      now: expect.any(String),
      tx: mocks.prismaTx,
    });
  });

  it("counts a disconnected non-none row with missing cleanup material as failed", async () => {
    const disconnectedConnection = buildHostedConnection({ status: "disconnected" });
    mocks.prisma.hostedConsentGrant.findUnique.mockResolvedValue({
      scope: "launch.health-data",
      status: "revoked",
    });
    mocks.listConnectionsRequiringCleanupForUser.mockResolvedValue([disconnectedConnection]);
    mocks.getConnectionForUser.mockResolvedValue(disconnectedConnection);
    mocks.getConnectionRecordForUser.mockResolvedValue({
      credentialKind: "oauth_tokens",
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
    });
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(null);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/legal/health-data-consent"),
    );

    await expect(controlPlane.disconnectAllConnections("user-123")).resolves.toEqual({
      attemptedCount: 1,
      disconnectedCount: 0,
      failedCount: 1,
    });

    expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(mocks.registryGet).not.toHaveBeenCalled();
  });

  it("retries remote revoke for disconnected provider-config connections without appending duplicate wakes", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
    mocks.getConnectionForUser
      .mockResolvedValueOnce(disconnectedConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(disconnectedConnection));
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
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledTimes(2);
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("uses the locked source snapshot after a historical marker clears while sanitizing revoke failures", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const activeConnection = buildHostedConnection();
    let currentSources = [{
      lastErrorCode: DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
      status: "error",
    }];
    const revokeAccess = vi.fn(async () => {
      currentSources = [];
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
      .mockResolvedValueOnce(buildDisconnectingConnection(activeConnection));
    mocks.listConnectionSources.mockImplementation(async () => currentSources);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    const result = await controlPlane.disconnectConnection("user-123", publicConnectionId);

    expect(result).toMatchObject({
      connection: {
        id: publicConnectionId,
        status: "reauthorization_required",
      },
    });
    // Exact shape: an ordinary revoke failure must not carry the historical-reset flag.
    expect(result.warning).toEqual({
      code: "PROVIDER_REVOKE_FAILED",
      message: "authorization=[redacted] refresh_token=[redacted]",
    });

    expect(revokeAccess).toHaveBeenCalledTimes(1);
    expect(mocks.listConnectionSources).toHaveBeenCalledWith("dsc_123", mocks.prismaTx);
    expect(mocks.createSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "reauthorization_required",
        revokeWarning: {
          code: "PROVIDER_REVOKE_FAILED",
          message: "authorization=[redacted] refresh_token=[redacted]",
        },
      }),
    );
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          reason: "reauthorization_required",
          hint: expect.objectContaining({
            revokeWarning: {
              code: "PROVIDER_REVOKE_FAILED",
              message: "authorization=[redacted] refresh_token=[redacted]",
            },
          }),
        }),
      }),
    );
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
  });

  it("uses a historical-reset marker that appears during provider revoke from the locked source snapshot", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const activeConnection = buildHostedConnection({
      provider: "junction",
    });
    let currentSources: Array<{
      lastErrorCode: string;
      sourceProviderSlug: string;
      status: string;
    }> = [];
    const revokeAccess = vi.fn(async () => {
      currentSources = [{
        lastErrorCode: DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
        sourceProviderSlug: "garmin",
        status: "error",
      }];
      throw new Error("junction deregistration failed upstream");
    });
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeAccess,
      },
    });
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(activeConnection));
    mocks.listConnectionSources.mockImplementation(async () => currentSources);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    const result = await controlPlane.disconnectConnection("user-123", publicConnectionId);

    expect(result.connection).toMatchObject({
      id: publicConnectionId,
      status: "reauthorization_required",
    });
    expect(result.warning).toEqual({
      code: "HISTORICAL_RESET_REVOKE_FAILED",
      historicalResetIncomplete: true,
      message: "Provider revoke did not complete while a historical data reset is pending. "
        + "Remove the connection in the provider account before reconnecting.",
    });
    expect(mocks.listConnectionSources).toHaveBeenCalledWith("dsc_123", mocks.prismaTx);
    expect(mocks.createSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "reauthorization_required",
        revokeWarning: {
          code: "HISTORICAL_RESET_REVOKE_FAILED",
          message: "Provider revoke did not complete while a historical data reset is pending. "
            + "Remove the connection in the provider account before reconnecting.",
        },
      }),
    );
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("deregistration failed upstream");
  });

  it("keeps the historical-reset warning when a repeated disconnect fails revoke after sources were cleared", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const disconnectedConnection = buildHostedConnection({
      lastErrorCode: "HISTORICAL_RESET_REVOKE_FAILED",
      lastErrorMessage: "Provider revoke did not complete while a historical data reset is pending. "
        + "Remove the connection in the provider account before reconnecting.",
      provider: "junction",
      status: "disconnected",
    });
    const revokeAccess = vi.fn(async () => {
      throw new Error("junction deregistration failed upstream again");
    });
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        revokeAccess,
      },
    });
    mocks.listConnectionsForUser.mockResolvedValue([disconnectedConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(disconnectedConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(disconnectedConnection));
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(buildProviderConfigStoredConnection({
      externalAccountId: "junction-user-123",
      lastErrorCode: "HISTORICAL_RESET_REVOKE_FAILED",
      provider: "junction",
      status: "disconnected",
    }));
    // The first disconnect attempt already cleared the source recovery markers.
    mocks.listConnectionSources.mockResolvedValue([]);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    const result = await controlPlane.disconnectConnection("user-123", publicConnectionId);

    expect(revokeAccess).toHaveBeenCalledTimes(1);
    expect(result.connection).toMatchObject({
      id: publicConnectionId,
      lastErrorCode: "HISTORICAL_RESET_REVOKE_FAILED",
      status: "reauthorization_required",
    });
    expect(result.warning).toEqual({
      code: "HISTORICAL_RESET_REVOKE_FAILED",
      historicalResetIncomplete: true,
      message: "Provider revoke did not complete while a historical data reset is pending. "
        + "Remove the connection in the provider account before reconnecting.",
    });
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledTimes(2);
    expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
    expect(mocks.clearStoredProviderConfigCredential).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("deregistration failed upstream");
    expect(JSON.stringify(result)).not.toContain("PROVIDER_REVOKE_FAILED");
  });

  it("clears a historical-reset warning when a repeated disconnect finishes remote revoke", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const disconnectedConnection = buildHostedConnection({
      lastErrorCode: "HISTORICAL_RESET_REVOKE_FAILED",
      lastErrorMessage: "Remove the old provider connection before reconnecting.",
      provider: "junction",
      status: "disconnected",
    });
    const storedConnection = buildProviderConfigStoredConnection({
      externalAccountId: "junction-user-123",
      lastErrorCode: "HISTORICAL_RESET_REVOKE_FAILED",
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
    mocks.getConnectionForUser
      .mockResolvedValueOnce(disconnectedConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(disconnectedConnection));
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(storedConnection);
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    const result = await controlPlane.disconnectConnection("user-123", publicConnectionId);

    expect(revokeAccess).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      connection: expect.objectContaining({
        id: publicConnectionId,
        lastErrorCode: null,
        lastErrorMessage: null,
        status: "disconnected",
      }),
    });
    expect(mocks.clearStoredProviderConfigCredential).toHaveBeenCalledTimes(1);
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dsc_123",
        lastErrorCode: null,
        lastErrorMessage: null,
        status: "disconnected",
      }),
      mocks.prismaTx,
    );
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("fails closed for a legacy disconnected OAuth row without durable credentials", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const disconnectedConnection = buildHostedConnection({ status: "disconnected" });
    mocks.listConnectionsForUser.mockResolvedValue([disconnectedConnection]);
    mocks.getConnectionForUser.mockResolvedValue(disconnectedConnection);
    mocks.getConnectionRecordForUser.mockResolvedValue({
      credentialKind: "oauth_tokens",
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
    });
    const publicConnectionId = buildPublicConnectionId("dsc_123");

    mocks.getStoredConnectionAccountForUser.mockResolvedValue(null);

    await expect(controlPlane.disconnectConnection(
      "user-123",
      publicConnectionId,
    )).rejects.toMatchObject({
      code: "CONNECTION_SECRET_MISSING",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("retains OAuth credentials when the provider registry has no revoke hook", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    const activeConnection = buildHostedConnection();
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(buildDisconnectingConnection(activeConnection));
    mocks.getConnectionRecordForUser.mockResolvedValue({
      credentialKind: "oauth_tokens",
      refreshLeaseExpiresAt: null,
      refreshLeaseOwner: null,
      refreshLeaseTokenVersion: null,
    });
    mocks.registryGet.mockReturnValue(undefined);

    await expect(controlPlane.disconnectConnection(
      "user-123",
      buildPublicConnectionId("dsc_123"),
    )).resolves.toMatchObject({
      connection: {
        lastErrorCode: "DISCONNECT_RECOVERY_REQUIRED",
        status: "reauthorization_required",
      },
      warning: {
        code: "PROVIDER_REVOKE_NOT_CONFIGURED",
      },
    });

    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.markConnectionSourcesDisconnected).not.toHaveBeenCalled();
    expect(mocks.createSignal).toHaveBeenCalledWith(expect.objectContaining({
      kind: "reauthorization_required",
      revokeWarning: expect.objectContaining({
        code: "PROVIDER_REVOKE_NOT_CONFIGURED",
      }),
    }));
  });

  it("resolves browser status reads through the opaque browser connection id", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
    );

    await controlPlane.handleOAuthCallback("oura", { expectedOwnerId: "user-123" });

    // Connection establishment must keep the full transaction budget: a
    // bounded member-row wait here would destroy a successful OAuth journey
    // (exact three-argument call proves no lock-timeout option is passed).
    expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledWith(
      "user-123",
      "dsc_123",
      expect.any(Function),
    );
    expect(mocks.getConnectionForUser).toHaveBeenCalledWith(
      "user-123",
      "dsc_123",
      mocks.prismaTx,
    );
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
          eventId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z:2026-03-26T12:00:00.000Z",
          expectedConnectedAt: "2026-03-26T12:00:00.000Z",
          kind: "device-sync.wake",
          occurredAt: "2026-03-26T12:00:00.000Z",
          provider: "oura",
          reason: "connected",
          userId: "user-123",
        }),
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
    expect(mocks.ensureWebhookSubscriptions).toHaveBeenCalledWith({
      publicBaseUrl: "https://control.example.test/api/device-sync",
    });
  });

  it("keeps member-owned OAuth start and callback on the exact application revision", async () => {
    const binding = {
      applicationId: "dpa_strava",
      provider: "strava" as const,
      revision: 4,
    };
    const providerConfigs = {
      strava: {
        clientId: "member-client",
        clientSecret: "member-secret",
      },
    };
    mocks.readOAuthStateProviderApplicationBinding.mockResolvedValue(binding);
    mocks.resolveDeviceProviderApplication.mockResolvedValue({
      ...binding,
      providerConfigs,
    });
    mocks.scopedRegistryGet.mockReturnValue({ provider: "strava" });
    mocks.upsertConnectionWithProviderApplication.mockResolvedValue({
      account: buildHostedConnection({
        displayName: "Strava",
        id: "dsc_strava",
        provider: "strava",
      }),
      previousAccount: null,
    });
    mocks.createDeviceSyncPublicIngress.mockImplementation((input: {
      registry: { get: (provider: string) => unknown };
      store: {
        upsertConnection: (value: {
          externalAccountId: string;
          provider: string;
        }) => Promise<unknown>;
      };
    }) => ({
      describeProviders: vi.fn(() => []),
      handleOAuthCallback: vi.fn(async () => {
        input.registry.get("strava");
        await input.store.upsertConnection({
          externalAccountId: "strava-account",
          provider: "strava",
        });
        return { connection: { id: "dsc_strava" } };
      }),
      startConnection: vi.fn(async () => {
        input.registry.get("strava");
        return { redirectUrl: "https://strava.example.test/oauth" };
      }),
    }));
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request(
        "https://control.example.test/api/device-sync/oauth/strava/callback?code=abc&state=state_app",
      ),
    );

    await controlPlane.startConnectionWithProviderApplication(
      "user-123",
      binding,
      null,
    );
    await controlPlane.handleOAuthCallback("strava", {
      expectedOwnerId: "user-123",
    });

    expect(mocks.readOAuthStateProviderApplicationBinding).toHaveBeenCalledWith({
      expectedOwnerId: "user-123",
      expectedProvider: "strava",
      now: expect.any(String),
      state: "state_app",
    });
    expect(mocks.resolveDeviceProviderApplication).toHaveBeenCalledTimes(2);
    expect(mocks.resolveDeviceProviderApplication).toHaveBeenNthCalledWith(1, {
      applicationId: "dpa_strava",
      expectedRevision: 4,
      memberId: "user-123",
      prisma: mocks.prisma,
      provider: "strava",
    });
    expect(mocks.resolveDeviceProviderApplication).toHaveBeenNthCalledWith(2, {
      applicationId: "dpa_strava",
      expectedRevision: 4,
      memberId: "user-123",
      prisma: mocks.prisma,
      provider: "strava",
    });
    expect(mocks.createHostedDeviceSyncRegistryWithProviderConfigs).toHaveBeenCalledTimes(2);
    expect(mocks.createHostedDeviceSyncRegistryWithProviderConfigs).toHaveBeenNthCalledWith(1, {
      providerConfigs,
    });
    expect(mocks.createHostedDeviceSyncRegistryWithProviderConfigs).toHaveBeenNthCalledWith(2, {
      providerConfigs,
    });
    expect(mocks.upsertConnectionWithProviderApplication).toHaveBeenCalledWith(
      {
        externalAccountId: "strava-account",
        provider: "strava",
      },
      binding,
    );
    expect(mocks.scopedRegistryGet).toHaveBeenCalledTimes(2);
    expect(mocks.registryGet).not.toHaveBeenCalled();
    expect(mocks.ensureWebhookSubscriptions).not.toHaveBeenCalled();
  });

  it("namespaces provider initial-job dedupe keys by connection epoch", async () => {
    const firstConnectedAt = "2026-03-26T12:00:00.000Z";
    const secondConnectedAt = "2026-03-26T12:01:00.000Z";
    mocks.sha256Hex.mockImplementation((value: string) => {
      if (value.includes(firstConnectedAt)) {
        return "a".repeat(64);
      }
      if (value.includes(secondConnectedAt)) {
        return "b".repeat(64);
      }
      return "c".repeat(64);
    });
    mocks.getConnectionForUser
      .mockResolvedValueOnce(buildHostedConnection({
        connectedAt: firstConnectedAt,
        id: "dsc_junction",
        provider: "junction",
        scopes: [],
      }))
      .mockResolvedValueOnce(buildHostedConnection({
        connectedAt: secondConnectedAt,
        id: "dsc_junction",
        provider: "junction",
        scopes: [],
      }));
    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: getPrisma(),
    });
    const connection = {
      initialJobs: [{
        dedupeKey: "junction:initial-reconcile",
        kind: "reconcile" as const,
        payload: {
          windowEnd: "2026-03-26T12:00:00.000Z",
          windowStart: "2026-03-19T12:00:00.000Z",
        },
      }],
      nextReconcileAt: null,
    };

    try {
      for (const connectedAt of [firstConnectedAt, secondConnectedAt]) {
        await handleHostedDeviceSyncConnectionEstablished({
          account: {
            connectedAt,
            id: "dsc_junction",
            provider: "junction",
            scopes: [],
            status: "active",
          },
          connection,
          now: connectedAt,
          store,
        });
      }

      const dedupeKeys = mocks.appendHostedMailboxEnvelope.mock.calls.map(
        ([input]) => input.envelope.hint.jobs[0]?.dedupeKey,
      );
      expect(dedupeKeys).toEqual([
        `hosted-device-sync:${"a".repeat(64)}`,
        `hosted-device-sync:${"b".repeat(64)}`,
      ]);
      expect(new Set(dedupeKeys)).toHaveLength(2);
    } finally {
      mocks.sha256Hex.mockImplementation(() => "a".repeat(64));
    }
  });

  it.each([
    ["a missing account", null],
    ["a disconnected account", buildHostedConnection({ status: "disconnected" })],
    ["a newer connection epoch", buildHostedConnection({
      connectedAt: "2026-03-26T12:01:00.000Z",
    })],
  ])("rejects a late callback over %s without admitting work", async (_label, current) => {
    mocks.getConnectionForUser.mockResolvedValue(current);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
    );

    await expect(
      controlPlane.handleOAuthCallback("oura", { expectedOwnerId: "user-123" }),
    ).rejects.toMatchObject({
      code: "CONNECTION_ESTABLISHMENT_STALE",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledWith(
      "user-123",
      "dsc_123",
      expect.any(Function),
    );
    expect(mocks.getConnectionForUser).toHaveBeenCalledWith(
      "user-123",
      "dsc_123",
      mocks.prismaTx,
    );
    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("rejects callback establishment when the connection owner is missing", async () => {
    mocks.getConnectionOwnerId.mockResolvedValue(null);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
    );

    await expect(
      controlPlane.handleOAuthCallback("oura", { expectedOwnerId: "user-123" }),
    ).rejects.toMatchObject({
      code: "CONNECTION_ESTABLISHMENT_STALE",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.withHealthDataAdmissionLock).not.toHaveBeenCalled();
    expect(mocks.upsertConnectionSource).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("rejects a conflicting connection-established mailbox identity", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValueOnce({
      dedupeConflict: true,
      duplicate: true,
      inserted: false,
      item: {
        id: "mailbox_conflict",
        userId: "user-123",
      },
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
    );

    await expect(
      controlPlane.handleOAuthCallback("oura", { expectedOwnerId: "user-123" }),
    ).rejects.toMatchObject({
      code: "CONNECTION_ESTABLISHMENT_WORK_CONFLICT",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.createSignal).toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
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
          sourceProviderSlug: "garmin",
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
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/connect/junction/callback?state=xyz"),
    );

    await controlPlane.handleConnectionCallback("junction", { expectedOwnerId: "user-123" });

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
          sourceProviderSlug: connectTarget,
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
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/oauth/junction/callback?code=abc&state=xyz"),
    );

    await controlPlane.handleOAuthCallback("junction", { expectedOwnerId: "user-123" });
    await controlPlane.handleOAuthCallback("junction", { expectedOwnerId: "user-123" });
    await controlPlane.handleOAuthCallback("junction", { expectedOwnerId: "user-123" });

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
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
    );

    await expect(
      controlPlane.handleOAuthCallback("oura", { expectedOwnerId: "user-123" }),
    ).resolves.toEqual({
      connection: {
        id: "dsc_123",
      },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to ensure hosted webhook admin upkeep.",
      expect.objectContaining({
        errorCode: "HOSTED_WEBHOOK_ADMIN_UPKEEP_FAILED",
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
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", {
        method: "POST",
        body: "{}",
      }),
    );
    await controlPlane.describeProviders();
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
      traceIdPresent: true,
    });
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("trace_old");
    consoleWarn.mockRestore();
  });

  it("persists dirty state before sparse webhook audit and appends a mailbox wake only for dirty transitions", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
        sourceProviderSlug: null,
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
          eventToProviderSendBucket: null,
          firstWebhookReceivedAt: "2026-03-26T12:00:00.000Z",
          providerSendToWebhookMs: null,
          jobKind: "reconcile",
          payload: {
            windowStart: "2026-03-19T00:00:00.000Z",
            windowEnd: "2026-03-26T00:00:00.000Z",
          },
          resource: null,
          resourceCategory: null,
          sourceProviderSlug: null,
          timingSourceProviderSlug: "oura",
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
      mocks.completeWebhookTrace.mock.invocationCallOrder[0],
    );
    expect(mocks.completeWebhookTrace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.appendHostedMailboxEnvelope.mock.invocationCallOrder[0],
    );
    expect(mocks.appendHostedMailboxEnvelope.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createSignal.mock.invocationCallOrder[0],
    );
    expect(mocks.completeWebhookTrace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signalHostedDeviceSyncMailboxRuntime.mock.invocationCallOrder[0],
    );
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "device-sync:dirty:v1:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z:1",
          expectedConnectedAt: "2026-03-26T12:00:00.000Z",
          kind: "device-sync.wake",
          reason: "webhook_hint",
          userId: "user-123",
        }),
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
  });

  it("terminally rejects prepared queued work after its connection is rebound to a private application", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/strava", {
        method: "POST",
      }),
    );
    const prepared = await controlPlane.prepareWebhookForDurableEnqueue(
      "strava",
      Buffer.from("{}"),
      new Date("2026-03-26T12:00:00.000Z"),
    );
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValueOnce({
      ...buildWebhookAdmissionRecord({
        provider: "strava",
      }),
      providerApplicationId: "dpa_private_strava",
      providerApplicationRevision: 2,
    });

    await expect(controlPlane.handlePreparedWebhook(prepared)).resolves.toEqual({
      accepted: true,
    });

    expect(mocks.getConnectionRecordForUser).not.toHaveBeenCalled();
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith(
      "strava",
      "trace_123",
      "claim-token",
      mocks.prismaTx,
    );
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
    expect(mocks.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(mocks.revokeStravaDeviceSyncAccess).not.toHaveBeenCalled();
  });

  it("terminally supersedes prepared queued work when reconnect replaces its observed epoch before dirty-state commit", async () => {
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValueOnce(
      buildWebhookAdmissionRecord({
        connectedAt: "2026-03-26T12:05:00.000Z",
      }),
    );
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
    const prepared = await controlPlane.prepareWebhookForDurableEnqueue(
      "oura",
      Buffer.from("{}"),
      new Date("2026-03-26T12:00:00.000Z"),
    );

    await expect(controlPlane.handlePreparedWebhook(prepared)).resolves.toMatchObject({
      accepted: true,
    });

    // Webhook acceptance is the only admission caller that bounds the
    // member-row lock wait; its failures are absorbed by provider redelivery.
    expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledWith(
      "user-123",
      "dsc_123",
      expect.any(Function),
      { memberRowLockTimeoutMs: 5_000 },
    );
    expect(mocks.getConnectionOwnerId).toHaveBeenCalledTimes(1);
    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
    expect(mocks.prismaTx.deviceConnection.findUnique).toHaveBeenCalledWith({
      where: {
        id: "dsc_123",
      },
      select: {
        connectedAt: true,
        provider: true,
        providerApplicationId: true,
        providerApplicationRevision: true,
        setupPhase: true,
        status: true,
        userId: true,
      },
    });
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith(
      "oura",
      "trace_123",
      "claim-token",
      mocks.prismaTx,
    );
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("terminally supersedes webhook work when the locked connection owner differs from the pre-lock owner", async () => {
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue({
      ...buildWebhookAdmissionRecord(),
      userId: "user-456",
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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

    expect(mocks.getConnectionOwnerId).toHaveBeenCalledTimes(1);
    expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledWith(
      "user-123",
      "dsc_123",
      expect.any(Function),
      { memberRowLockTimeoutMs: 5_000 },
    );
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith(
      "oura",
      "trace_123",
      "claim-token",
      mocks.prismaTx,
    );
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("retries webhook work when setup becomes pending before dirty-state commit", async () => {
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord({
        setupExpiresAt: "2026-03-26T12:15:00.000Z",
        setupPhase: "pending_link",
      }),
    );
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
      code: "WEBHOOK_ACCOUNT_NOT_READY",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.completeWebhookTrace).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("retries prepared queued source work when the target disconnects before dirty-state commit", async () => {
    const currentConnection = buildWebhookAdmissionRecord({
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    const providerRead = vi.fn(async () => false);
    mocks.registryGet.mockReturnValue({
      connectionHandler: {
        buildSourceConnectionWork: buildJunctionSourceConnectionWork,
        isSourceAccessActive: providerRead,
      },
    });
    mocks.getConnectionRecordForUser.mockResolvedValue(currentConnection);
    mocks.materializeStoredConnectionAccount.mockResolvedValue(
      buildProviderConfigStoredConnection({
        provider: "junction",
        setupPhase: "source_confirmed",
      }),
    );
    mocks.listConnectionSourceAdmissionCandidates.mockResolvedValueOnce([
      buildHostedConnectionSourceAdmissionCandidate(
        buildHostedConnectionSource("dsc_123", "fitbit", {
          lastSeenAt: "2026-03-26T11:59:00.000Z",
          status: "disconnected",
        }),
      ),
    ]);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", {
        method: "POST",
      }),
    );
    const prepared: PreparedDeviceSyncWebhookV1 = {
      acceptanceMode: "durable_webhook_work",
      eventType: "activity.updated",
      externalAccountId: "acct_sensitive",
      jobs: [{
        kind: "resource",
        payload: {
          resource: "activity",
          sourceProviderSlug: "fitbit",
        },
      }],
      provider: "junction",
      receivedAt: "2026-03-26T12:00:00.000Z",
      schema: "murph.device-sync-prepared-webhook.v1",
      sourceProviderSlug: "fitbit",
      traceId: "1".repeat(64),
    };

    await expect(controlPlane.handlePreparedWebhook(prepared)).rejects.toMatchObject({
      code: "WEBHOOK_SOURCE_NOT_READY",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.listConnectionSourceAdmissionCandidates).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      sourceProviderSlug: "fitbit",
      tx: mocks.prismaTx,
    });
    expect(providerRead).toHaveBeenCalledOnce();
    expect(mocks.completeWebhookTrace).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("resolves the companion lane, stages a compact RMSSD job, and wakes the runtime", async () => {
    const connection = buildHostedConnection({
      id: "dsc_junction_123",
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mockConnectionForAdmission(connection);

    await acceptTestCompanionHrvRmssdObservation();

    expect(mocks.listConnectionsForUser).toHaveBeenCalledWith("user-123");
    expect(mocks.inspectCompanionHrvNightReceipt).toHaveBeenCalledWith({
      connectionIds: ["dsc_junction_123"],
      nightDate: "2026-07-10",
      now: "2026-07-10T13:46:00.000Z",
      resource: expect.objectContaining({
        resource: "companion_hrv_rmssd",
        sourceProviderSlug: "whoop",
      }),
      userId: "user-123",
    });
    expect(mocks.ensureSdkConnection).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "dsc_junction_123",
      dirtyAt: "2026-07-10T13:46:00.000Z",
      eventType: "companion.hrv-rmssd.created",
      provider: "junction",
      resourceCategory: "derived",
      userId: "user-123",
      resources: [{
        count: 1,
        jobKind: "resource",
        payload: {
          companionAdmissionId: expect.stringMatching(/^[a-f0-9]{64}$/u),
          companionObservationJson: expect.any(String),
          resource: "companion_hrv_rmssd",
          resourceCategory: "derived",
          sourceProviderSlug: "whoop",
        },
        resource: "companion_hrv_rmssd",
        resourceCategory: "derived",
        sourceProviderSlug: "whoop",
        timingSourceProviderSlug: "whoop",
        windowEnd: null,
        windowStart: null,
      }],
    }));
    expect(mocks.withHealthDataAdmissionLock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upsertDirtyConnection.mock.invocationCallOrder[0] ?? 0,
    );
    const stagedPayload = mocks.upsertDirtyConnection.mock.calls[0]?.[0]?.resources?.[0]?.payload;
    const staged = stagedPayload?.companionObservationJson;
    expect(staged).toEqual(expect.any(String));
    if (typeof staged !== "string") {
      throw new TypeError("Expected a serialized companion HRV observation.");
    }
    expect(mocks.sha256Hex).toHaveBeenCalledWith(staged);
    expect(stagedPayload?.companionAdmissionId).toBe("a".repeat(64));
    expect(JSON.parse(staged)).toEqual(expect.objectContaining({
      nightDate: "2026-07-10",
      rmssdMs: 52.75,
    }));
    expect(staged).not.toContain("rrIntervals");
    expect(staged).not.toContain("rawBleBytes");
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      envelope: expect.objectContaining({
        occurredAt: "2026-07-10T13:46:00.000Z",
        hint: expect.objectContaining({
          occurredAt: "2026-07-10T13:46:00.000Z",
          reason: "companion_hrv_rmssd",
        }),
        reason: "webhook_hint",
        userId: "user-123",
      }),
    }));
  });

  it("rejects companion metadata when the exact Apple Health source is fenced", async () => {
    const connection = buildHostedConnection({
      displayName: "Apple Health",
      provider: "junction",
    });
    mockConnectionForAdmission(connection);
    mocks.listConnectionSourceAdmissionCandidates.mockResolvedValue([
      buildHostedConnectionSource(connection.id, "apple_health_kit", {
        lastErrorCode: "SOURCE_USER_DISCONNECTED",
        status: "disconnected",
      }),
    ]);

    await expect(persistHostedDeviceSyncCompanionMetadata({
      connectionId: connection.id,
      occurredAt: "2026-07-09T12:00:00.000Z",
      resource: {
        count: 1,
        jobKind: "resource",
        payload: {
          resource: "companion_health_metadata",
          webhookDataJson: JSON.stringify({ records: [], schemaVersion: 1 }),
        },
        resource: "companion_health_metadata",
        resourceCategory: "summary",
        sourceProviderSlug: "apple_health_kit",
        windowEnd: null,
        windowStart: null,
      },
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
      userId: "user-123",
    })).rejects.toMatchObject({
      code: "COMPANION_HEALTH_SOURCE_REQUIRED",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("accepts the oldest entry in a three-night outbox when the local date trails UTC", async () => {
    const connection = buildHostedConnection({
      id: "dsc_junction_123",
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mockConnectionForAdmission(connection);

    await expect(acceptTestCompanionHrvRmssdObservation({
      acceptedAt: "2026-07-11T06:00:00.000Z",
      observation: {
        ...buildCompanionHrvRmssdObservation(),
        nightDate: "2026-07-08",
      },
    })).resolves.toBeUndefined();

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "dsc_junction_123",
      userId: "user-123",
    }));
  });

  it("rechecks the exact Junction WHOOP source fence inside locked HRV admission", async () => {
    const connection = buildHostedConnection({
      id: "dsc_junction_123",
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    const connectedSource = buildHostedConnectionSource(connection.id, "whoop_v2");
    mocks.listConnectionsForUser.mockResolvedValue([connection]);
    mockConnectionForAdmission(connection);
    mocks.listConnectionSources.mockResolvedValueOnce([connectedSource]);
    mocks.listConnectionSourceAdmissionCandidates.mockResolvedValueOnce([{
        ...connectedSource,
        lastErrorCode: "SOURCE_USER_DISCONNECTED",
        status: "disconnected",
      }]);

    await expect(acceptTestCompanionHrvRmssdObservation()).rejects.toMatchObject({
      code: "COMPANION_HEALTH_SOURCE_REQUIRED",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("accepts a retained exact HRV retry before freshness and connection-liveness gates", async () => {
    mocks.listConnectionsForUser.mockResolvedValue([
      buildHostedConnection({
        id: "dsc_junction_disconnected",
        provider: "junction",
        status: "disconnected",
      }),
    ]);
    mocks.inspectCompanionHrvNightReceipt.mockResolvedValue("exact");

    await expect(acceptTestCompanionHrvRmssdObservation({
      acceptedAt: "2026-07-20T13:46:00.000Z",
    })).resolves.toBeUndefined();

    expect(mocks.inspectCompanionHrvNightReceipt).toHaveBeenCalledTimes(1);
    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("rejects changed retained HRV content before freshness and connection-liveness gates", async () => {
    mocks.listConnectionsForUser.mockResolvedValue([
      buildHostedConnection({
        id: "dsc_junction_disconnected",
        provider: "junction",
        status: "disconnected",
      }),
    ]);
    mocks.inspectCompanionHrvNightReceipt.mockResolvedValue("conflict");

    await expect(acceptTestCompanionHrvRmssdObservation({
      acceptedAt: "2026-07-20T13:46:00.000Z",
      observation: {
        ...buildCompanionHrvRmssdObservation(),
        rmssdMs: 49.25,
      },
    })).rejects.toMatchObject({
      code: "COMPANION_HRV_NIGHT_CONFLICT",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["stale", "2026-07-06"],
    ["future", "2026-07-12"],
  ])("rejects an unseen %s HRV night at first admission", async (_label, nightDate) => {
    const connection = buildHostedConnection({
      id: "dsc_junction_123",
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    mocks.listConnectionsForUser.mockResolvedValue([connection]);

    await expect(acceptTestCompanionHrvRmssdObservation({
      observation: {
        ...buildCompanionHrvRmssdObservation(),
        nightDate,
      },
    })).rejects.toMatchObject({
      code: "COMPANION_REQUEST_INVALID",
      httpStatus: 400,
      retryable: false,
    });

    expect(mocks.inspectCompanionHrvNightReceipt).toHaveBeenCalledTimes(1);
    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["a disconnected connection with retained provider identity", buildHostedConnection({
      externalAccountId: "junction-user-retained",
      id: "dsc_junction_retained",
      provider: "junction",
      status: "disconnected",
    })],
    ["a disconnected connection with scrubbed provider identity", buildHostedConnection({
      externalAccountId: "opaque:dsc_junction_scrubbed",
      id: "dsc_junction_scrubbed",
      provider: "junction",
      status: "disconnected",
    })],
    ["a connection awaiting reauthorization", buildHostedConnection({
      externalAccountId: "junction-user-reauthorization",
      id: "dsc_junction_reauthorization",
      provider: "junction",
      status: "reauthorization_required",
    })],
  ])("does not establish or stage HRV over %s", async (_label, connection) => {
    mocks.listConnectionsForUser.mockResolvedValue([connection]);

    await expect(acceptTestCompanionHrvRmssdObservation()).rejects.toMatchObject({
      code: "COMPANION_HRV_CONNECTION_REQUIRED",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.ensureSdkConnection).not.toHaveBeenCalled();
    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ["pending Link", "pending_link"],
    ["returned Link", "link_returned"],
    ["failed", "failed"],
    ["missing", null],
  ] as const)("does not stage HRV over an active Junction lane with %s setup", async (_label, setupPhase) => {
    mocks.listConnectionsForUser.mockResolvedValue([
      buildHostedConnection({
        id: "dsc_junction_unconfirmed",
        provider: "junction",
        setupPhase,
      }),
    ]);

    await expect(acceptTestCompanionHrvRmssdObservation()).rejects.toMatchObject({
      code: "COMPANION_HRV_CONNECTION_REQUIRED",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("selects one established Junction lane while ignoring pending setup", async () => {
    const establishedConnection = buildHostedConnection({
      id: "dsc_junction_established",
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    mocks.listConnectionsForUser.mockResolvedValue([
      buildHostedConnection({
        id: "dsc_junction_pending",
        provider: "junction",
        setupPhase: "pending_link",
      }),
      establishedConnection,
    ]);
    mockConnectionForAdmission(establishedConnection);

    await acceptTestCompanionHrvRmssdObservation();

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "dsc_junction_established",
    }));
  });

  it("rejects a Junction lane that loses establishment before locked HRV persistence", async () => {
    const establishedConnection = buildHostedConnection({
      id: "dsc_junction_123",
      provider: "junction",
      setupPhase: "source_confirmed",
    });
    mocks.listConnectionsForUser.mockResolvedValue([establishedConnection]);
    mockConnectionForAdmission(buildHostedConnection({
      id: "dsc_junction_123",
      provider: "junction",
      setupPhase: "pending_link",
    }));

    await expect(acceptTestCompanionHrvRmssdObservation()).rejects.toMatchObject({
      code: "COMPANION_HEALTH_CONNECTION_REQUIRED",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledWith(
      "user-123",
      establishedConnection.id,
      expect.any(Function),
    );
    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("rejects ambiguous established Junction lanes without staging HRV", async () => {
    mocks.listConnectionsForUser.mockResolvedValue([
      buildHostedConnection({
        id: "dsc_junction_1",
        provider: "junction",
        setupPhase: "source_confirmed",
      }),
      buildHostedConnection({
        id: "dsc_junction_2",
        provider: "junction",
        setupPhase: "source_confirmed",
      }),
    ]);

    await expect(acceptTestCompanionHrvRmssdObservation()).rejects.toMatchObject({
      code: "COMPANION_HRV_CONNECTION_AMBIGUOUS",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.ensureSdkConnection).not.toHaveBeenCalled();
    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("completes hosted webhook traces when audit and dirty state commit", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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

    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "device-sync:dirty:v1:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z:1",
          expectedConnectedAt: "2026-03-26T12:00:00.000Z",
          kind: "device-sync.wake",
        }),
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", "claim-token", mocks.prismaTx);
  });

  it("merges timing into pending dirty state without appending another wake", async () => {
    mocks.upsertDirtyConnection.mockResolvedValueOnce({
      dirty: buildDirtyConnectionRecord(),
      shouldRequestWake: false,
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("coalesces level-triggered webhooks after committed dirty state exists", async () => {
    mocks.upsertDirtyConnection.mockResolvedValueOnce({
      dirty: buildDirtyConnectionRecord(),
      shouldRequestWake: false,
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("accepts level-triggered webhooks before dirty state commits", async () => {
    mocks.hasPendingDirtyConnection.mockResolvedValueOnce(false);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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

  it("keeps hosted webhook traces completed when the post-commit mailbox signal fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.signalHostedDeviceSyncMailboxRuntime.mockRejectedValueOnce(new Error("Temporal unavailable"));
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
      expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
      expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
        mailboxItemId: "mailbox_123",
      });
      expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(1);
      expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", "claim-token", mocks.prismaTx);
      expect(consoleWarn).toHaveBeenCalledWith(
        "Hosted device-sync wake Temporal signal failed after mailbox append.",
        expect.objectContaining({
          errorCode: "HOSTED_DEVICE_SYNC_TEMPORAL_SIGNAL_FAILED",
          mailboxItemIdPresent: true,
        }),
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("classifies inactive runtime access without blaming Temporal", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.signalHostedDeviceSyncMailboxRuntime.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_RUNTIME_USER_INACTIVE",
      httpStatus: 403,
      message: "Hosted runtime user is not active.",
    }));
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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

      expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
      expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
        mailboxItemId: "mailbox_123",
      });
      expect(consoleWarn).toHaveBeenCalledOnce();
      expect(consoleWarn).toHaveBeenCalledWith(
        "Hosted device-sync wake skipped after mailbox append because runtime access is inactive.",
        expect.objectContaining({
          errorCode: "HOSTED_RUNTIME_USER_INACTIVE",
          errorMessage: "Hosted runtime user is not active.",
          mailboxItemIdPresent: true,
        }),
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("keeps webhook acceptance retryable when dirty wake mailbox append fails", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockRejectedValueOnce(new Error("mailbox append failed"));
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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

    await expect(controlPlane.handleWebhook("oura")).rejects.toThrow("mailbox append failed");

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", "claim-token", mocks.prismaTx);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("keeps the maximum webhook resource batch outside two sequential provider-closed transactions", async () => {
    const transactionProviderCallFences: boolean[] = [];
    const finalMutationProviderCallFences: boolean[] = [];
    let activeTransactions = 0;
    let peakTransactions = 0;
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction" }),
    );
    mocks.withHealthDataAdmissionLock.mockImplementation(async (
      _userId: string,
      _connectionId: string,
      callback: (tx: typeof mocks.prismaTx) => Promise<unknown>,
    ) => {
      activeTransactions += 1;
      peakTransactions = Math.max(peakTransactions, activeTransactions);
      transactionProviderCallFences.push(areHostedDomainRootProviderCallsDisabled());
      try {
        return await callback(mocks.prismaTx);
      } finally {
        activeTransactions -= 1;
      }
    });
    mocks.upsertDirtyConnectionWithPreparedPlanTx.mockImplementation(async (input) => {
      finalMutationProviderCallFences.push(areHostedDomainRootProviderCallsDisabled());
      return mocks.upsertDirtyConnection({
        connectionId: input.prepared.connectionId,
        dirtyAt: input.prepared.dirtyAt,
        eventType: input.prepared.eventType,
        provider: input.prepared.provider,
        resourceCategory: input.prepared.resourceCategory,
        resources: input.prepared.resources,
        traceId: input.prepared.traceId,
        tx: input.tx,
        userId: input.prepared.userId,
      });
    });

    await handleHostedDeviceSyncWebhookAccepted({
      account: {
        connectedAt: "2026-03-26T12:00:00.000Z",
        id: "dsc_123",
        provider: "junction",
      },
      claimToken: "claim-token",
      now: "2026-03-26T12:00:00.000Z",
      ownerId: "user-123",
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
      traceId: "trace_123",
      webhook: {
        acceptanceMode: "durable_webhook_work",
        eventType: "provider.connection.updated",
        jobs: [
          {
            kind: "backfill",
            payload: {
              windowEnd: "2026-03-26T00:00:00.000Z",
              windowStart: "2026-03-19T00:00:00.000Z",
            },
          },
          {
            kind: "reconcile",
            payload: {
              windowEnd: "2026-03-26T00:00:00.000Z",
              windowStart: "2026-03-25T00:00:00.000Z",
            },
          },
        ],
      },
    });

    expect(peakTransactions).toBe(1);
    expect(transactionProviderCallFences).toEqual([false, true]);
    expect(finalMutationProviderCallFences).toEqual([true]);
    expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledTimes(2);
    expect(mocks.prepareDirtyConnectionUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.shouldRequestWakeForDirtyConnectionUpsert).not.toHaveBeenCalled();
    expect(mocks.prepareDirtyConnectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: [
          expect.objectContaining({ jobKind: "backfill" }),
          expect.objectContaining({ jobKind: "reconcile" }),
        ],
      }),
    );
    expect(mocks.prepareHostedMailboxItemAppendCrypto).toHaveBeenCalledTimes(1);
    expect(mocks.upsertDirtyConnectionWithPreparedPlanTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
  });

  it("keeps compact-only webhook admission on the canonical final transaction owner", async () => {
    const finalMutationProviderCallFences: boolean[] = [];
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction" }),
    );
    mocks.shouldRequestWakeForDirtyConnectionUpsert.mockResolvedValue(false);
    mocks.upsertDirtyConnection.mockImplementation(async () => {
      finalMutationProviderCallFences.push(areHostedDomainRootProviderCallsDisabled());
      return {
        dirty: buildDirtyConnectionRecord({ dirtyRevision: 2n }),
        shouldRequestWake: false,
      };
    });

    await handleHostedDeviceSyncWebhookAccepted({
      account: {
        connectedAt: "2026-03-26T12:00:00.000Z",
        id: "dsc_123",
        provider: "junction",
      },
      claimToken: "claim-token",
      now: "2026-03-26T12:00:00.000Z",
      ownerId: "user-123",
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
      traceId: "trace_123",
      webhook: {
        acceptanceMode: "durable_webhook_work",
        eventType: "provider.connection.updated",
        jobs: [],
      },
    });

    expect(mocks.shouldRequestWakeForDirtyConnectionUpsert).toHaveBeenCalledOnce();
    expect(mocks.prepareDirtyConnectionUpsert).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnectionWithPreparedPlanTx).not.toHaveBeenCalled();
    expect(mocks.prepareHostedMailboxItemAppendCrypto).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledOnce();
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledWith(expect.objectContaining({
      resources: [expect.objectContaining({ jobKind: "reconcile" })],
      tx: mocks.prismaTx,
    }));
    expect(finalMutationProviderCallFences).toEqual([true]);
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("replans compact-only admission once when pending state becomes unexpectedly clean", async () => {
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction" }),
    );
    mocks.shouldRequestWakeForDirtyConnectionUpsert
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mocks.upsertDirtyConnection.mockResolvedValue({
      dirty: buildDirtyConnectionRecord({ dirtyRevision: 2n }),
      shouldRequestWake: true,
    });

    await handleHostedDeviceSyncWebhookAccepted({
      account: {
        connectedAt: "2026-03-26T12:00:00.000Z",
        id: "dsc_123",
        provider: "junction",
      },
      claimToken: "claim-token",
      now: "2026-03-26T12:00:00.000Z",
      ownerId: "user-123",
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
      traceId: "trace_123",
      webhook: {
        acceptanceMode: "durable_webhook_work",
        eventType: "provider.connection.updated",
        jobs: [],
      },
    });

    expect(mocks.shouldRequestWakeForDirtyConnectionUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.prepareDirtyConnectionUpsert).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(2);
    expect(mocks.prepareHostedMailboxItemAppendCrypto).toHaveBeenCalledOnce();
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledOnce();
  });

  it("rejects webhook resource batches above the provider-owned maximum before admission", async () => {
    await expect(handleHostedDeviceSyncWebhookAccepted({
      account: {
        connectedAt: "2026-03-26T12:00:00.000Z",
        id: "dsc_123",
        provider: "junction",
      },
      claimToken: "claim-token",
      now: "2026-03-26T12:00:00.000Z",
      ownerId: "user-123",
      store: new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() }),
      traceId: "trace_123",
      webhook: {
        acceptanceMode: "durable_webhook_work",
        eventType: "provider.connection.updated",
        jobs: [
          { kind: "backfill" },
          { kind: "reconcile" },
          { kind: "reconcile" },
        ],
      },
    })).rejects.toMatchObject({
      code: "HOSTED_DEVICE_SYNC_WEBHOOK_RESOURCE_BATCH_TOO_LARGE",
      retryable: false,
    });

    expect(mocks.withHealthDataAdmissionLock).not.toHaveBeenCalled();
    expect(mocks.prepareDirtyConnectionUpsert).not.toHaveBeenCalled();
    expect(mocks.prepareHostedMailboxItemAppendCrypto).not.toHaveBeenCalled();
  });

  it("performs one full fresh-cache replan after the real mailbox root preparation drifts", async () => {
    const preparationCaches: unknown[] = [];
    mocks.prepareDirtyConnectionUpsert.mockImplementation(async (input) => {
      preparationCaches.push(getHostedDomainRootUnwrapCache());
      return {
        ...input,
        dirtyRevision: 1n,
        shouldRequestWake: true,
      };
    });
    mocks.appendHostedMailboxEnvelopeTx.mockRejectedValueOnce(
      new HostedDomainRootPreparationMismatchError(),
    );
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({ event: "sleep.updated" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("oura")).resolves.toMatchObject({
      accepted: true,
    });

    expect(mocks.prepareDirtyConnectionUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.prepareHostedMailboxItemAppendCrypto).toHaveBeenCalledTimes(2);
    expect(mocks.upsertDirtyConnectionWithPreparedPlanTx).toHaveBeenCalledTimes(2);
    expect(preparationCaches).toHaveLength(2);
    expect(preparationCaches[0]).toBeDefined();
    expect(preparationCaches[1]).toBeDefined();
    expect(preparationCaches[1]).not.toBe(preparationCaches[0]);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(2);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
  });

  it("returns a retryable error when the real mailbox root preparation drifts twice", async () => {
    mocks.appendHostedMailboxEnvelopeTx
      .mockRejectedValueOnce(new HostedDomainRootPreparationMismatchError())
      .mockRejectedValueOnce(new HostedDomainRootPreparationMismatchError());
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/oura", {
        body: JSON.stringify({ event: "sleep.updated" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    await expect(controlPlane.handleWebhook("oura")).rejects.toMatchObject({
      code: "HOSTED_DEVICE_SYNC_PREPARATION_STALE",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.prepareDirtyConnectionUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.prepareHostedMailboxItemAppendCrypto).toHaveBeenCalledTimes(2);
    expect(mocks.upsertDirtyConnectionWithPreparedPlanTx).toHaveBeenCalledTimes(2);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(2);
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
  });

  it("keeps webhook acceptance retryable when dirty wake mailbox dedupe conflicts", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValueOnce({
      dedupeConflict: true,
      duplicate: true,
      inserted: false,
      item: {
        id: "mailbox_conflict",
        userId: "user-123",
      },
    });
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
      code: "HOSTED_DEVICE_SYNC_DIRTY_WAKE_DEDUPE_CONFLICT",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", "claim-token", mocks.prismaTx);
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("does not duplicate mailbox wakes when later level webhooks coalesce behind the dirty row", async () => {
    let dirtyRevision = 0n;
    mocks.upsertDirtyConnection.mockImplementation(async () => {
      dirtyRevision += 1n;
      return {
        dirty: buildDirtyConnectionRecord({ dirtyRevision }),
        shouldRequestWake: dirtyRevision === 1n,
      };
    });

    for (let index = 0; index < 2; index += 1) {
      const controlPlane = createHostedDeviceSyncPublicIngressService(
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

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(2);
    expect(mocks.createSignal).toHaveBeenCalledTimes(1);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(2);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledTimes(1);
  });

  it("coalesces a historical webhook burst into one dirty row and one mailbox wake while the connection stays dirty", async () => {
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
            connectedAt: "2026-03-26T12:00:00.000Z",
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
      const controlPlane = createHostedDeviceSyncPublicIngressService(
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
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(2_500);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(2_500);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledTimes(1);
  });

  it("requests another mailbox wake in the same wall-clock bucket after prior work is clean", async () => {
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
            connectedAt: "2026-03-26T12:00:00.000Z",
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
      const controlPlane = createHostedDeviceSyncPublicIngressService(
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
  });

  it("rejects hosted webhook bodies above the shared device-sync limit before ingress parsing", async () => {
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("does not nudge after a hosted webhook trace claim is lost before completion", async () => {
    mocks.completeWebhookTrace.mockResolvedValueOnce(false);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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

    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(1);
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
            connectedAt: "2026-03-26T12:00:00.000Z",
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
            providerSentAt: "2026-03-26T11:59:30.000Z",
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
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
        eventToProviderSendBucket: "under_5_minutes",
        firstWebhookReceivedAt: "2026-03-26T12:00:00.000Z",
        providerSendToWebhookMs: 30_000,
        jobKind: "reconcile",
        payload: {
          windowStart: "2026-03-19T00:00:00.000Z",
        },
        resource: null,
        resourceCategory: null,
        sourceProviderSlug: null,
        timingSourceProviderSlug: "oura",
        windowEnd: null,
        windowStart: "2026-03-19T00:00:00.000Z",
      },
    ]);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      envelope: expect.objectContaining({
        eventId: "device-sync:dirty:v1:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z:1",
        expectedConnectedAt: "2026-03-26T12:00:00.000Z",
        kind: "device-sync.wake",
      }),
    }));
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
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
    mocks.upsertDirtyConnection.mockResolvedValueOnce({
      dirty: buildDirtyConnectionRecord({
        dirtyRevision: 2n,
        processedRevision: 1n,
        provider: "junction",
      }),
      shouldRequestWake: false,
    });
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
            connectedAt: "2026-03-26T12:00:00.000Z",
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
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction" }),
    );
    mocks.getConnectionOwnerId.mockResolvedValueOnce("user-123");
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
        eventToProviderSendBucket: null,
        firstWebhookReceivedAt: "2026-05-26T12:00:00.000Z",
        providerSendToWebhookMs: null,
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
        timingSourceProviderSlug: "garmin",
        windowEnd: "2026-05-27T00:00:00.000Z",
        windowStart: "2026-05-26T00:00:00.000Z",
      },
    ]);
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).not.toHaveBeenCalled();
  });

  it("retains a verified Junction source for timing-only reconcile work", async () => {
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
            connectedAt: "2026-03-26T12:00:00.000Z",
            id: "dsc_123",
            provider: "junction",
          },
          now: "2026-03-26T12:00:00.000Z",
          provider: { provider: "junction" },
          traceId: "trace_fitbit_timing",
          webhook: {
            acceptanceMode: "durable_webhook_work",
            eventType: "connection.updated",
            jobs: [{
              kind: "reconcile",
              payload: {
                windowStart: "2026-03-19T00:00:00.000Z",
              },
            }],
            occurredAt: "2026-03-26T11:59:00.000Z",
            providerSentAt: "2026-03-26T11:59:30.000Z",
            sourceProviderSlug: "fitbit",
          },
        });
        return { accepted: true };
      }),
      startConnection: vi.fn(),
    }));
    const currentConnection = buildWebhookAdmissionRecord({ provider: "junction" });
    mocks.getConnectionRecordForUser.mockResolvedValue(currentConnection);
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(currentConnection);
    mocks.listConnectionSourceAdmissionCandidates.mockResolvedValue([
      buildHostedConnectionSourceAdmissionCandidate(
        buildHostedConnectionSource("dsc_123", "fitbit"),
      ),
    ]);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
      new Request("https://control.example.test/api/device-sync/webhooks/junction", {
        body: JSON.stringify({ event_type: "connection.updated" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    await controlPlane.handleWebhook("junction");

    expect(mocks.upsertDirtyConnection.mock.calls[0]?.[0]?.resources).toEqual([{
      count: 1,
      eventToProviderSendBucket: "under_5_minutes",
      firstWebhookReceivedAt: "2026-03-26T12:00:00.000Z",
      providerSendToWebhookMs: 30_000,
      jobKind: "reconcile",
      payload: {
        windowStart: "2026-03-19T00:00:00.000Z",
      },
      resource: null,
      resourceCategory: null,
      sourceProviderSlug: null,
      timingSourceProviderSlug: "fitbit",
      windowEnd: null,
      windowStart: "2026-03-19T00:00:00.000Z",
    }]);
  });

  it("accepts durable Junction payload webhooks under the connection acceptance lock", async () => {
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
            connectedAt: "2026-03-26T12:00:00.000Z",
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
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction" }),
    );
    mocks.getConnectionOwnerId.mockResolvedValueOnce("user-123");
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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

    const dirtyResources = mocks.upsertDirtyConnection.mock.calls[0]?.[0]?.resources;

    expect(mocks.upsertDirtyConnection).toHaveBeenCalledWith(expect.objectContaining({
      resources: dirtyResources,
    }));
    expect(mocks.withHealthDataAdmissionLock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upsertDirtyConnection.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.upsertDirtyConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createSignal).toHaveBeenCalledTimes(1);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith(
      "junction",
      "trace_junction_payload_busy",
      "claim-token",
      mocks.prismaTx,
    );
    expect(mocks.withHealthDataAdmissionLock).toHaveBeenCalledWith(
      "user-123",
      "dsc_123",
      expect.any(Function),
      { memberRowLockTimeoutMs: 5_000 },
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
            connectedAt: "2026-03-26T12:00:00.000Z",
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
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "junction" }),
    );
    mocks.getConnectionOwnerId.mockResolvedValueOnce("user-123");
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
            connectedAt: "2026-03-26T12:00:00.000Z",
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
    mocks.prismaTx.deviceConnection.findUnique.mockResolvedValue(
      buildWebhookAdmissionRecord({ provider: "whoop" }),
    );
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
        eventToProviderSendBucket: null,
        firstWebhookReceivedAt: "2026-03-26T12:00:00.000Z",
        providerSendToWebhookMs: null,
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
        timingSourceProviderSlug: "whoop",
        windowEnd: null,
        windowStart: null,
      },
      {
        count: 1,
        eventToProviderSendBucket: null,
        firstWebhookReceivedAt: "2026-03-26T12:00:00.000Z",
        providerSendToWebhookMs: null,
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
        timingSourceProviderSlug: "whoop",
        windowEnd: null,
        windowStart: null,
      },
    ]);
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
  });

  it("keeps hosted webhook traces retryable when ingress hooks cannot resolve an owner", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getConnectionOwnerId.mockResolvedValue(null);
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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

    expect(mocks.getConnectionOwnerId).toHaveBeenCalledTimes(1);
    expect(mocks.prismaTx.deviceConnection.findUnique).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      "Rejecting hosted device-sync webhook without an owner mapping.",
      expect.objectContaining({
        connectionFingerprint: "a".repeat(16),
        provider: "oura",
        traceIdPresent: true,
      }),
    );
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("dsc_123");
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("trace_123");
    expect(mocks.completeWebhookTrace).not.toHaveBeenCalled();
    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelope).not.toHaveBeenCalled();
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
            connectedAt: "2026-03-26T12:00:00.000Z",
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
    const controlPlane = createHostedDeviceSyncPublicIngressService(
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
        eventToProviderSendBucket: null,
        firstWebhookReceivedAt: "2026-03-26T12:00:00.000Z",
        providerSendToWebhookMs: null,
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
        timingSourceProviderSlug: "oura",
        windowEnd: null,
        windowStart: null,
      },
    ]);
    expect(JSON.stringify(dirtyResources)).not.toContain("oura-user-1");
    expect(mocks.appendHostedMailboxEnvelope).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
  });

});
