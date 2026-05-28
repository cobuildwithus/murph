import { buildJunctionProviderSourceInstanceKey } from "@murphai/device-syncd/connect-config";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedPublicDeviceSyncAccount: vi.fn((input: {
    fallback?: { externalAccountId?: string | null };
    record: ReturnType<typeof buildHostedRecord>;
  }) =>
    buildPublicConnection({
      ...input.record,
      externalAccountId: input.record.externalAccountId ?? input.fallback?.externalAccountId ?? null,
    })),
  createHostedDeviceSyncControlPlane: vi.fn(),
  appendHostedDeviceSyncReconnectNoticeTx: vi.fn(async () => ({
    inserted: true,
    mailboxItemId: "hmi_reconnect_123",
    outcome: "inserted",
  })),
  mapHostedConnectionRecord: vi.fn((record: ReturnType<typeof buildHostedRecord>) => ({
    ...record,
    externalAccountId: null,
  })),
  recordHostedRuntimeLogTx: vi.fn(),
  startHostedDeviceSyncReconnectNoticeWorkflowBestEffort: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/device-sync/internal-runtime", () => ({
  buildHostedPublicDeviceSyncAccount: mocks.buildHostedPublicDeviceSyncAccount,
}));

vi.mock("@/src/lib/device-sync/prisma-store", () => ({
  hostedConnectionRecordArgs: {},
  mapHostedConnectionRecord: mocks.mapHostedConnectionRecord,
}));

vi.mock("@/src/lib/device-sync/reconnect-notice", () => ({
  appendHostedDeviceSyncReconnectNoticeTx: mocks.appendHostedDeviceSyncReconnectNoticeTx,
  startHostedDeviceSyncReconnectNoticeWorkflowBestEffort:
    mocks.startHostedDeviceSyncReconnectNoticeWorkflowBestEffort,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  recordHostedRuntimeLogTx: mocks.recordHostedRuntimeLogTx,
}));

function buildHostedRecord(
  overrides: Partial<{
    accessTokenExpiresAt: string | null;
    connectedAt: string;
    createdAt: string;
    credentialKind: "oauth_tokens" | "provider_config" | "none";
    credentialMetadata: Record<string, unknown>;
    displayName: string | null;
    externalAccountId: string | null;
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
    providerConfigKey: string | null;
    refreshLeaseExpiresAt: string | null;
    refreshLeaseOwner: string | null;
    refreshLeaseTokenVersion: number | null;
    scopes: string[];
    setupExpiresAt: string | null;
    setupPhase: "pending_link" | "link_returned" | "source_confirmed" | "failed" | null;
    status: "active" | "reauthorization_required" | "disconnected";
    updatedAt: string | undefined;
    userId: string;
  }> = {},
) {
  return {
    accessTokenExpiresAt: null,
    connectedAt: "2026-04-06T09:00:00.000Z",
    createdAt: "2026-04-06T09:00:00.000Z",
    credentialKind: "oauth_tokens" as const,
    credentialMetadata: {},
    displayName: "Hosted Device",
    externalAccountId: "acct_123",
    id: "conn_123",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastSyncStartedAt: null,
    lastWebhookAt: null,
    metadata: {
      source: "hosted",
    },
    nextReconcileAt: null,
    provider: "oura",
    providerConfigKey: null,
    refreshLeaseExpiresAt: null,
    refreshLeaseOwner: null,
    refreshLeaseTokenVersion: null,
    scopes: ["daily"],
    setupExpiresAt: null,
    setupPhase: null,
    status: "active" as const,
    updatedAt: "2026-04-06T10:00:00.000Z",
    userId: "user_123",
    ...overrides,
  };
}

function buildPublicConnection(record: ReturnType<typeof buildHostedRecord>) {
  return {
    accessTokenExpiresAt: record.accessTokenExpiresAt ?? null,
    connectedAt: record.connectedAt,
    createdAt: record.createdAt,
    displayName: record.displayName,
    externalAccountId: record.externalAccountId,
    id: record.id,
    lastErrorCode: record.lastErrorCode,
    lastErrorMessage: record.lastErrorMessage,
    lastSyncCompletedAt: record.lastSyncCompletedAt,
    lastSyncErrorAt: record.lastSyncErrorAt,
    lastSyncStartedAt: record.lastSyncStartedAt,
    lastWebhookAt: record.lastWebhookAt,
    metadata: record.metadata,
    nextReconcileAt: record.nextReconcileAt,
    provider: record.provider,
    scopes: [...record.scopes],
    setupExpiresAt: record.setupExpiresAt,
    setupPhase: record.setupPhase,
    status: record.status,
    updatedAt: record.updatedAt,
  };
}

function buildStoredAccount(
  record: ReturnType<typeof buildHostedRecord>,
  overrides: Partial<{
    accessToken: string;
    accessTokenExpiresAt: string | null;
    keyVersion: string;
    refreshToken: string | null;
    tokenVersion: number;
  }> = {},
) {
  const accessToken = overrides.accessToken ?? "stored-access-token";
  const accessTokenExpiresAt = overrides.accessTokenExpiresAt ?? record.accessTokenExpiresAt ?? null;
  const refreshToken = overrides.refreshToken ?? "stored-refresh-token";

  return {
    ...buildPublicConnection(record),
    accessTokenExpiresAt,
    credential: {
      kind: "oauth_tokens" as const,
      tokens: {
        accessToken,
        accessTokenExpiresAt,
        refreshToken,
      },
    },
    disconnectGeneration: 0,
    keyVersion: overrides.keyVersion ?? "kv_stored",
    tokenVersion: overrides.tokenVersion ?? 3,
  };
}

function buildDirtyConnectionRecord(overrides: Partial<{
  connectionId: string;
  dirtyRevision: bigint;
  processedRevision: bigint;
  provider: string;
  userId: string;
}> = {}) {
  return {
    connectionId: overrides.connectionId ?? "conn_dirty_123",
    createdAt: "2026-04-06T09:00:00.000Z",
    dirtyResources: {},
    dirtyRevision: overrides.dirtyRevision ?? 1n,
    eventCount: overrides.dirtyRevision ?? 1n,
    firstDirtyAt: "2026-04-06T09:00:00.000Z",
    latestDirtyAt: "2026-04-06T10:00:00.000Z",
    latestEventType: "sleep.updated",
    latestResourceCategory: "daily_sleep",
    latestTraceId: "trace_dirty_123",
    processedRevision: overrides.processedRevision ?? 0n,
    provider: overrides.provider ?? "oura",
    resourceCategoryCounts: {
      daily_sleep: 1,
    },
    sourceProviderCounts: {
      oura: 1,
    },
    updatedAt: "2026-04-06T10:00:00.000Z",
    userId: overrides.userId ?? "user_123",
    windowEnd: null,
    windowStart: "2026-04-06T00:00:00.000Z",
  };
}

function createAuthorityHarness(input: {
  connectionSources?: Array<{
    connectionId: string;
    displayName: string | null;
    firstSeenAt: string;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    lastSeenAt: string | null;
    resourceAvailabilitySummary: Record<string, unknown>;
    sourceInstanceKey?: string;
    sourceProviderSlug: string;
    status: "connected" | "disconnected" | "error" | "unavailable";
  }>;
  record?: ReturnType<typeof buildHostedRecord>;
  storedAccount?: ReturnType<typeof buildStoredAccount> | null;
} = {}) {
  let currentRecord = input.record ?? buildHostedRecord();
  let currentStoredAccount = input.storedAccount === undefined
    ? buildStoredAccount(currentRecord)
    : input.storedAccount;

  const syncDurableConnectionState = vi.fn(async (account: ReturnType<typeof buildPublicConnection>) => {
    currentRecord = {
      ...currentRecord,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      connectedAt: account.connectedAt,
      createdAt: account.createdAt,
      displayName: account.displayName,
      externalAccountId: account.externalAccountId,
      id: account.id,
      lastErrorCode: account.lastErrorCode,
      lastErrorMessage: account.lastErrorMessage,
      lastSyncCompletedAt: account.lastSyncCompletedAt,
      lastSyncErrorAt: account.lastSyncErrorAt,
      lastSyncStartedAt: account.lastSyncStartedAt,
      lastWebhookAt: account.lastWebhookAt,
      metadata: account.metadata,
      nextReconcileAt: account.nextReconcileAt,
      provider: account.provider,
      scopes: [...account.scopes],
      setupExpiresAt: account.setupExpiresAt,
      setupPhase: account.setupPhase,
      status: account.status,
      updatedAt: "2026-04-06T10:11:00.000Z",
    };
    if (currentStoredAccount) {
      currentStoredAccount = {
        ...currentStoredAccount,
        ...account,
        credential: currentStoredAccount.credential,
        disconnectGeneration: currentStoredAccount.disconnectGeneration,
        keyVersion: currentStoredAccount.keyVersion,
        tokenVersion: currentStoredAccount.tokenVersion,
        updatedAt: "2026-04-06T10:11:00.000Z",
      };
    }
  });

  const persistStoredConnectionTokenBundle = vi.fn(async (input: {
    tokenBundle: {
      accessToken: string;
      accessTokenExpiresAt: string | null;
      keyVersion: string;
      refreshToken: string | null;
      tokenVersion: number;
    } | null;
  }) => {
    currentStoredAccount = input.tokenBundle
      ? buildStoredAccount(currentRecord, input.tokenBundle)
      : null;
  });

  const findFirst = vi.fn(async () => currentRecord);
  const upsertConnectionSource = vi.fn(async () => undefined);
  const update = vi.fn(async ({ data }: { data: Partial<ReturnType<typeof buildHostedRecord>> }) => {
    currentRecord = {
      ...currentRecord,
      ...data,
      updatedAt: "2026-04-06T10:11:00.000Z",
    };
    currentStoredAccount = null;
    return currentRecord;
  });
  const tx = {
    deviceConnection: {
      findFirst,
      update,
    },
  };

  const store = {
    getConnectionForUser: vi.fn(async () =>
      buildPublicConnection({
        ...currentRecord,
        externalAccountId: currentRecord.externalAccountId ?? "acct_123",
      })),
    getStoredConnectionAccountForUser: vi.fn(async () => currentStoredAccount),
    listConnectionSources: vi.fn(async () =>
      (input.connectionSources ?? []).map((source) => ({
        ...source,
        sourceInstanceKey: source.sourceInstanceKey ?? source.sourceProviderSlug,
      }))
    ),
    persistStoredConnectionTokenBundle,
    prisma: {
      deviceConnection: {
        findMany: vi.fn(),
      },
    },
    syncDurableConnectionState,
    upsertConnectionSource,
    withConnectionMutationLock: vi.fn(async (
      _connectionId: string,
      callback: (tx: { deviceConnection: { findFirst: typeof findFirst; update: typeof update } }) => Promise<unknown>,
    ) =>
      callback(tx)),
  };

  mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
    store,
  });

  return {
    get record() {
      return currentRecord;
    },
    get storedAccount() {
      return currentStoredAccount;
    },
    persistStoredConnectionTokenBundle,
    store,
    syncDurableConnectionState,
    upsertConnectionSource,
    updateConnectionRecord: update,
  };
}

describe("ackHostedDeviceSyncDirtyStateProcessed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an immediate wake when another dirty row remains after the acked row", async () => {
    const markDirtyConnectionProcessed = vi.fn(async () => ({
      connectionId: "conn_dirty_first",
      dirtyRevision: 3n,
      processedRevision: 3n,
      stillDirty: false,
      userId: "user_123",
    }));
    const hasPendingDirtyConnectionForUser = vi.fn(async () => true);
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      store: {
        hasPendingDirtyConnectionForUser,
        markDirtyConnectionProcessed,
      },
    });
    const { ackHostedDeviceSyncDirtyStateProcessed } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await ackHostedDeviceSyncDirtyStateProcessed({
      request: new Request("https://example.test/device-sync/runtime/dirty-ack", {
        body: JSON.stringify({
          connectionId: "conn_dirty_first",
          processedDirtyPayloadIds: ["dsp_payload_1"],
          processedRevision: "3",
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(markDirtyConnectionProcessed).toHaveBeenCalledWith({
      connectionId: "conn_dirty_first",
      processedDirtyPayloadIds: ["dsp_payload_1"],
      processedRevision: 3n,
      userId: "user_123",
    });
    expect(hasPendingDirtyConnectionForUser).toHaveBeenCalledWith("user_123");
    expect(response.recorded).toBe(true);
    expect(response.stillDirty).toBe(false);
    expect(response.dirtyRevision).toBe("3");
    expect(response.processedRevision).toBe("3");
    expect(response.nextWakeAt).toEqual(expect.any(String));
    expect(Number.isFinite(Date.parse(response.nextWakeAt ?? ""))).toBe(true);
  });
});

describe("applyHostedDeviceSyncRuntimeResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects omitted observedUpdatedAt fences for connection and local-state mutations", async () => {
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    await expect(
      applyHostedDeviceSyncRuntimeResult({
        request: new Request("https://example.test/device-sync/runtime/apply", {
          body: JSON.stringify({
            updates: [
              {
                connectionId: "conn_123",
                localState: {
                  lastSyncStartedAt: "2026-04-06T10:05:00.000Z",
                },
              },
            ],
            userId: "user_123",
          }),
          method: "POST",
        }),
        trustedUserId: "user_123",
      }),
    ).rejects.toThrow(/observedUpdatedAt is required when connection or localState mutations are present/u);

    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
  });

  it("rejects omitted observedTokenVersion fences for token mutations", async () => {
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    await expect(
      applyHostedDeviceSyncRuntimeResult({
        request: new Request("https://example.test/device-sync/runtime/apply", {
          body: JSON.stringify({
            updates: [
              {
                connectionId: "conn_123",
                credential: {
                  kind: "oauth_tokens",
                  tokenBundle: {
                    accessToken: "fresh-access-token",
                    accessTokenExpiresAt: null,
                    keyVersion: "kv_runtime",
                    refreshToken: "fresh-refresh-token",
                    tokenVersion: 1,
                  },
                },
              },
            ],
            userId: "user_123",
          }),
          method: "POST",
        }),
        trustedUserId: "user_123",
      }),
    ).rejects.toThrow(/observedTokenVersion is required when credential mutations are present/u);

    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
  });

  it("skips stale observed fences without mutating hosted durable state", async () => {
    const harness = createAuthorityHarness();
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connection: {
                displayName: "Local Replay",
              },
              connectionId: "conn_123",
              localState: {
                lastSyncCompletedAt: "2026-04-06T10:05:00.000Z",
              },
              observedTokenVersion: 2,
              observedUpdatedAt: "2026-04-06T09:59:00.000Z",
              credential: {
                kind: "oauth_tokens",
                tokenBundle: {
                  accessToken: "replayed-access-token",
                  accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
                  keyVersion: "kv_runtime",
                  refreshToken: "replayed-refresh-token",
                  tokenVersion: 2,
                },
              },
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connection: expect.objectContaining({
        displayName: "Hosted Device",
      }),
      connectionId: "conn_123",
      tokenUpdate: "skipped_version_mismatch",
      writeUpdate: "skipped_version_mismatch",
    });
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(harness.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(mocks.recordHostedRuntimeLogTx).not.toHaveBeenCalled();
    expect(harness.record.displayName).toBe("Hosted Device");
    expect(harness.storedAccount?.credential).toMatchObject({
      kind: "oauth_tokens",
      tokens: {
        accessToken: "stored-access-token",
      },
    });
    expect(harness.storedAccount?.tokenVersion).toBe(3);
  });

  it("persists runtime source availability updates without rewriting connection state", async () => {
    const harness = createAuthorityHarness();
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "conn_123",
              sources: [
                {
                  displayName: null,
                  firstSeenAt: "2026-04-06T09:00:00.000Z",
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
              ],
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connectionId: "conn_123",
      tokenUpdate: "unchanged",
      writeUpdate: "applied",
    });
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(harness.upsertConnectionSource).toHaveBeenCalledWith({
      connectionId: "conn_123",
      displayName: null,
      firstSeenAt: "2026-04-06T09:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-04-06T10:05:00.000Z",
      resourceAvailabilitySummary: {
        activity: true,
        heartrate: true,
      },
      sourceInstanceKey: "junction_garmin",
      sourceProviderSlug: "garmin",
      status: "connected",
      tx: expect.any(Object),
    });
  });

  it("applies Junction runtime source resources to the connect-link source row", async () => {
    const hostedConnectionId = "conn_junction";
    const runtimeLocalAccountId = "dsa_runtime";
    const canonicalSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: hostedConnectionId,
      sourceProviderSlug: "garmin",
    });
    const runtimeSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: runtimeLocalAccountId,
      sourceProviderSlug: "garmin",
    });

    expect(canonicalSourceInstanceKey).toMatch(/^jxn_src_/u);
    expect(runtimeSourceInstanceKey).toMatch(/^jxn_src_/u);
    expect(runtimeSourceInstanceKey).not.toBe(canonicalSourceInstanceKey);
    if (!canonicalSourceInstanceKey || !runtimeSourceInstanceKey) {
      throw new Error("Expected Junction source keys to be generated for test ids.");
    }

    const harness = createAuthorityHarness({
      connectionSources: [
        {
          connectionId: hostedConnectionId,
          displayName: null,
          firstSeenAt: "2026-05-26T17:35:33.451Z",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: "2026-05-26T17:35:33.451Z",
          resourceAvailabilitySummary: {},
          sourceInstanceKey: canonicalSourceInstanceKey,
          sourceProviderSlug: "garmin",
          status: "connected",
        },
      ],
      record: buildHostedRecord({
        id: hostedConnectionId,
        provider: "junction",
        updatedAt: "2026-05-26T17:35:33.451Z",
      }),
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: hostedConnectionId,
              sources: [
                {
                  displayName: null,
                  firstSeenAt: "2026-05-26T17:34:31.976Z",
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  lastSeenAt: "2026-05-26T17:37:45.454Z",
                  observedLastSeenAt: null,
                  resourceAvailabilitySummary: {
                    sleep: true,
                    steps: true,
                    workouts: true,
                  },
                  sourceInstanceKey: runtimeSourceInstanceKey,
                  sourceProviderSlug: "garmin",
                  status: "connected",
                },
              ],
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connectionId: hostedConnectionId,
      tokenUpdate: "unchanged",
      writeUpdate: "applied",
    });
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(harness.upsertConnectionSource).toHaveBeenCalledTimes(1);
    expect(harness.upsertConnectionSource).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: hostedConnectionId,
      lastSeenAt: "2026-05-26T17:37:45.454Z",
      resourceAvailabilitySummary: {
        sleep: true,
        steps: true,
        workouts: true,
      },
      sourceInstanceKey: canonicalSourceInstanceKey,
      sourceProviderSlug: "garmin",
      status: "connected",
    }));
    expect(harness.upsertConnectionSource).not.toHaveBeenCalledWith(expect.objectContaining({
      sourceInstanceKey: runtimeSourceInstanceKey,
    }));
  });

  it("skips stale runtime source availability updates", async () => {
    const harness = createAuthorityHarness({
      connectionSources: [
        {
          connectionId: "conn_123",
          displayName: null,
          firstSeenAt: "2026-04-06T09:00:00.000Z",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: "2026-04-06T10:10:00.000Z",
          resourceAvailabilitySummary: {
            activity: true,
            heartrate: true,
          },
          sourceInstanceKey: "junction_garmin",
          sourceProviderSlug: "garmin",
          status: "connected",
        },
      ],
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "conn_123",
              sources: [
                {
                  displayName: null,
                  firstSeenAt: "2026-04-06T09:00:00.000Z",
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  lastSeenAt: "2026-04-06T10:05:00.000Z",
                  observedLastSeenAt: "2026-04-06T10:00:00.000Z",
                  resourceAvailabilitySummary: {
                    activity: true,
                  },
                  sourceInstanceKey: "junction_garmin",
                  sourceProviderSlug: "garmin",
                  status: "connected",
                },
              ],
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connectionId: "conn_123",
      tokenUpdate: "unchanged",
      writeUpdate: "skipped_version_mismatch",
    });
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(harness.upsertConnectionSource).not.toHaveBeenCalled();
  });

  it("skips runtime token writes while an agent refresh lease owns the observed token version", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        refreshLeaseExpiresAt: "2026-04-06T10:15:00.000Z",
        refreshLeaseOwner: "agent-refresh:active",
        refreshLeaseTokenVersion: 3,
      }),
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "conn_123",
              observedTokenVersion: 3,
              observedUpdatedAt: "2026-04-06T10:00:00.000Z",
              credential: {
                kind: "oauth_tokens",
                tokenBundle: {
                  accessToken: "runtime-access-token",
                  accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
                  keyVersion: "kv_runtime",
                  refreshToken: "runtime-refresh-token",
                  tokenVersion: 3,
                },
              },
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connectionId: "conn_123",
      tokenUpdate: "skipped_version_mismatch",
      writeUpdate: "skipped_version_mismatch",
    });
    expect(harness.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(harness.storedAccount?.credential).toMatchObject({
      kind: "oauth_tokens",
      tokens: {
        accessToken: "stored-access-token",
        refreshToken: "stored-refresh-token",
      },
    });
    expect(harness.storedAccount?.tokenVersion).toBe(3);
  });

  it("records sanitized provider failure diagnostics when runtime apply advances a sync failure", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        id: "conn_whoop",
        lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-05-15T21:59:24.539Z",
        lastSyncErrorAt: "2026-05-19T18:26:06.996Z",
        nextReconcileAt: "2026-05-20T00:26:06.996Z",
        provider: "whoop",
        updatedAt: "2026-05-19T22:00:44.000Z",
      }),
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          occurredAt: "2026-05-19T22:03:28.000Z",
          updates: [
            {
              connectionId: "conn_whoop",
              failureDiagnostic: {
                accountStatus: "reauthorization_required",
                code: "WHOOP_TOKEN_REQUEST_FAILED",
                details: {
                  providerHttpStatus: 400,
                  providerHttpStatusText: "Bad Request",
                  providerRequestAuthKind: "oauth_client_secret_body",
                  providerRequestAuthPlacement: "body_parameters",
                  providerRequestBodyFieldCount: 5,
                  providerRequestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
                  providerRequestBodyKind: "form_urlencoded",
                  providerRequestContentType: "application_x_www_form_urlencoded",
                  providerRequestCredentialPresent: true,
                  providerRequestEndpointKind: "whoop_oauth_token",
                  providerRequestMethod: "POST",
                  providerRequestQueryParameterCount: 0,
                  providerResponseErrorCode: "invalid_grant",
                  providerResponseErrorDescription: "Refresh token expired. Reconnect WHOOP.",
                  providerResponseErrorDescriptionFieldPresent: true,
                  providerResponseErrorFieldPresent: true,
                  providerResponseShapeKind: "json_object",
                  providerOAuthErrorCode: "invalid_grant",
                  providerOAuthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
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
              },
              localState: {
                lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
                lastErrorMessage:
                  "WHOOP token request failed. Provider reason: Refresh token expired. Reconnect WHOOP.",
                lastSyncErrorAt: "2026-05-19T22:03:27.378Z",
                nextReconcileAt: "2026-05-20T04:03:27.376Z",
              },
              observedUpdatedAt: "2026-05-19T22:00:44.000Z",
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connectionId: "conn_whoop",
      tokenUpdate: "unchanged",
      writeUpdate: "applied",
    });
    expect(harness.syncDurableConnectionState).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedRuntimeLogTx).toHaveBeenCalledWith(expect.objectContaining({
      at: "2026-05-19T22:03:27.378Z",
      component: "device-sync",
      errorCode: "WHOOP_TOKEN_REQUEST_FAILED",
      eventCode: "device-sync.job_failed",
      level: "warn",
      phase: "invoke",
      redacted: expect.objectContaining({
        failureCode: "WHOOP_TOKEN_REQUEST_FAILED",
        failureRetryable: false,
        failureSummary: "WHOOP token request failed. Provider reason: Refresh token expired. Reconnect WHOOP.",
        hadPriorFailure: true,
        hadPriorSuccess: true,
        nextReconcileAt: "2026-05-20T04:03:27.376Z",
        provider: "whoop",
        providerAccountStatus: "reauthorization_required",
        providerHttpStatus: 400,
        providerHttpStatusText: "Bad Request",
        providerRequestAuthKind: "oauth_client_secret_body",
        providerRequestAuthPlacement: "body_parameters",
        providerRequestBodyFieldCount: 5,
        providerRequestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
        providerRequestBodyKind: "form_urlencoded",
        providerRequestContentType: "application_x_www_form_urlencoded",
        providerRequestCredentialPresent: true,
        providerRequestEndpointKind: "whoop_oauth_token",
        providerRequestMethod: "POST",
        providerRequestQueryParameterCount: 0,
        providerResponseErrorCode: "invalid_grant",
        providerResponseErrorDescription: "Refresh token expired. Reconnect WHOOP.",
        providerResponseErrorDescriptionFieldPresent: true,
        providerResponseErrorFieldPresent: true,
        providerResponseShapeKind: "json_object",
        providerOAuthErrorCode: "invalid_grant",
        providerOAuthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
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
        status: "active",
        syncCompletedAt: "2026-05-15T21:59:24.539Z",
        syncFailedAt: "2026-05-19T22:03:27.378Z",
      }),
      userId: "user_123",
    }));
  });

  it("queues a reconnect notice when runtime apply moves a connection to reauthorization required", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        id: "conn_whoop",
        provider: "whoop",
        updatedAt: "2026-05-19T22:00:44.000Z",
      }),
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          occurredAt: "2026-05-19T22:03:28.000Z",
          updates: [
            {
              connection: {
                status: "reauthorization_required",
              },
              connectionId: "conn_whoop",
              failureDiagnostic: {
                accountStatus: "reauthorization_required",
                code: "WHOOP_TOKEN_REQUEST_FAILED",
                details: {
                  providerOAuthErrorCode: "invalid_request",
                  providerOAuthGrantType: "refresh_token",
                },
                retryable: false,
              },
              localState: {
                lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
                lastErrorMessage: "WHOOP token request failed.",
                lastSyncErrorAt: "2026-05-19T22:03:27.378Z",
                nextReconcileAt: null,
              },
              observedTokenVersion: 3,
              observedUpdatedAt: "2026-05-19T22:00:44.000Z",
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(harness.syncDurableConnectionState).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedDeviceSyncReconnectNoticeTx).toHaveBeenCalledWith(expect.objectContaining({
      appliedAt: "2026-05-19T22:03:28.000Z",
      connection: expect.objectContaining({
        id: "conn_whoop",
        lastSyncErrorAt: "2026-05-19T22:03:27.378Z",
        status: "reauthorization_required",
      }),
      failureCode: "WHOOP_TOKEN_REQUEST_FAILED",
      observedTokenVersion: 3,
      userId: "user_123",
    }));
    expect(mocks.startHostedDeviceSyncReconnectNoticeWorkflowBestEffort).toHaveBeenCalledWith(
      "hmi_reconnect_123",
    );
  });

  it("passes stored connection sources to reconnect notice creation for Junction-backed recovery", async () => {
    createAuthorityHarness({
      connectionSources: [{
        connectionId: "conn_junction",
        displayName: null,
        firstSeenAt: "2026-05-01T00:00:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-05-19T22:00:00.000Z",
        resourceAvailabilitySummary: { sleep: 1 },
        sourceProviderSlug: "garmin",
        status: "error",
      }],
      record: buildHostedRecord({
        id: "conn_junction",
        provider: "junction",
        updatedAt: "2026-05-19T22:00:44.000Z",
      }),
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          occurredAt: "2026-05-19T22:03:28.000Z",
          updates: [
            {
              connection: {
                status: "reauthorization_required",
              },
              connectionId: "conn_junction",
              failureDiagnostic: {
                accountStatus: "reauthorization_required",
                code: "JUNCTION_TOKEN_REQUEST_FAILED",
                details: {},
                retryable: false,
              },
              localState: {
                lastErrorCode: "JUNCTION_TOKEN_REQUEST_FAILED",
                lastErrorMessage: "Junction token request failed.",
                lastSyncErrorAt: "2026-05-19T22:03:27.378Z",
                nextReconcileAt: null,
              },
              observedTokenVersion: null,
              observedUpdatedAt: "2026-05-19T22:00:44.000Z",
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(mocks.appendHostedDeviceSyncReconnectNoticeTx).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({
        id: "conn_junction",
        provider: "junction",
        sources: [expect.objectContaining({
          resourceCount: 1,
          sourceProviderSlug: "garmin",
          status: "error",
        })],
        status: "reauthorization_required",
      }),
      failureCode: "JUNCTION_TOKEN_REQUEST_FAILED",
    }));
  });

  it("does not clear OAuth tokens from a disconnected status update without a credential mutation", async () => {
    const harness = createAuthorityHarness();
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connection: {
                status: "disconnected",
              },
              connectionId: "conn_123",
              observedUpdatedAt: "2026-04-06T10:00:00.000Z",
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connection: expect.objectContaining({
        accessTokenExpiresAt: null,
        status: "disconnected",
        updatedAt: "2026-04-06T10:11:00.000Z",
      }),
      connectionId: "conn_123",
      tokenUpdate: "unchanged",
      writeUpdate: "applied",
    });
    expect(harness.syncDurableConnectionState).toHaveBeenCalledTimes(1);
    expect(harness.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(harness.record.accessTokenExpiresAt).toBeNull();
    expect(harness.record.status).toBe("disconnected");
    expect(harness.storedAccount).toMatchObject({
      credential: {
        kind: "oauth_tokens",
        tokens: {
          accessToken: "stored-access-token",
        },
      },
    });
  });

  it("preserves the durable external account binding across tokenless clears and retokenization", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        externalAccountId: null,
      }),
      storedAccount: null,
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const clearResponse = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "conn_123",
              observedTokenVersion: null,
              credential: {
                clearTokens: true,
                kind: "oauth_tokens",
              },
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(clearResponse.updates[0]).toMatchObject({
      connection: expect.objectContaining({
        externalAccountId: "acct_123",
      }),
      connectionId: "conn_123",
      tokenUpdate: "missing",
      writeUpdate: "applied",
    });
    expect(harness.persistStoredConnectionTokenBundle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        connectionId: "conn_123",
        externalAccountId: undefined,
        tokenBundle: null,
      }),
    );
    expect(harness.store.getConnectionForUser).toHaveBeenCalledWith("user_123", "conn_123", expect.any(Object));
    expect(harness.storedAccount).toBeNull();

    const retokenizedResponse = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "conn_123",
              observedTokenVersion: null,
              credential: {
                kind: "oauth_tokens",
                tokenBundle: {
                  accessToken: "fresh-access-token",
                  accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
                  keyVersion: "kv_runtime",
                  refreshToken: "fresh-refresh-token",
                  tokenVersion: 1,
                },
              },
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(retokenizedResponse.updates[0]).toMatchObject({
      connection: expect.objectContaining({
        externalAccountId: "acct_123",
      }),
      connectionId: "conn_123",
      tokenUpdate: "applied",
      writeUpdate: "applied",
    });
    expect(harness.persistStoredConnectionTokenBundle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        connectionId: "conn_123",
        externalAccountId: undefined,
        tokenBundle: expect.objectContaining({
          accessToken: "fresh-access-token",
          refreshToken: "fresh-refresh-token",
          tokenVersion: 1,
        }),
      }),
    );
    expect(harness.storedAccount).toMatchObject({
      credential: {
        kind: "oauth_tokens",
        tokens: {
          accessToken: "fresh-access-token",
          refreshToken: "fresh-refresh-token",
        },
      },
      externalAccountId: "acct_123",
      tokenVersion: 1,
    });
  });

  it("reads a tokenless hosted snapshot from the durable external account binding", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        externalAccountId: null,
      }),
      storedAccount: null,
    });
    const { readHostedDeviceSyncRuntimeState } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    harness.store.prisma.deviceConnection.findMany.mockResolvedValue([harness.record]);
    harness.store.getConnectionForUser.mockResolvedValue({
      ...buildPublicConnection(buildHostedRecord()),
      externalAccountId: "acct_123",
    });

    const response = await readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(harness.store.getConnectionForUser).toHaveBeenCalledWith("user_123", "conn_123");
    expect(mocks.buildHostedPublicDeviceSyncAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        fallback: expect.objectContaining({
          externalAccountId: "acct_123",
        }),
      }),
    );
    expect(response).toMatchObject({
      connections: [
        expect.objectContaining({
          connection: expect.objectContaining({
            externalAccountId: "acct_123",
            id: "conn_123",
          }),
        }),
      ],
      userId: "user_123",
    });
  });

  it("omits stored OAuth token bundles from snapshot responses unless runtime credential material is requested", async () => {
    const harness = createAuthorityHarness();
    const { readHostedDeviceSyncRuntimeState } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    harness.store.prisma.deviceConnection.findMany.mockResolvedValue([harness.record]);

    const tokenlessResponse = await readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(tokenlessResponse.connections[0]?.credential).toEqual({
      credentialMetadata: {},
      kind: "oauth_tokens_redacted",
      tokenVersion: 3,
    });
    expect(JSON.stringify(tokenlessResponse)).not.toContain("stored-access-token");
    expect(JSON.stringify(tokenlessResponse)).not.toContain("stored-refresh-token");

    const runtimeResponse = await readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          includeCredentialMaterial: true,
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(runtimeResponse.connections[0]?.credential).toMatchObject({
      kind: "oauth_tokens",
      tokenBundle: {
        accessToken: "stored-access-token",
        refreshToken: "stored-refresh-token",
      },
    });
  });

  it("withholds runtime OAuth material while a refresh lease covers the current token", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        refreshLeaseExpiresAt: "2026-04-06T10:15:00.000Z",
        refreshLeaseOwner: "agent-refresh:active",
        refreshLeaseTokenVersion: 3,
      }),
    });
    const { readHostedDeviceSyncRuntimeState } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    harness.store.prisma.deviceConnection.findMany.mockResolvedValue([harness.record]);

    const response = await readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          includeCredentialMaterial: true,
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.connections[0]?.credential).toEqual({
      credentialMetadata: {},
      kind: "oauth_tokens_redacted",
      tokenVersion: 3,
    });
    expect(JSON.stringify(response)).not.toContain("stored-access-token");
    expect(JSON.stringify(response)).not.toContain("stored-refresh-token");
  });

  it("redacts runtime OAuth material for terminal hosted connection statuses", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        status: "reauthorization_required",
      }),
      storedAccount: buildStoredAccount(buildHostedRecord({
        status: "reauthorization_required",
      })),
    });
    const { readHostedDeviceSyncRuntimeState } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    harness.store.prisma.deviceConnection.findMany.mockResolvedValue([harness.record]);

    const response = await readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          includeCredentialMaterial: true,
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.connections[0]?.credential).toEqual({
      credentialMetadata: {},
      kind: "oauth_tokens_redacted",
      tokenVersion: 3,
    });
    expect(JSON.stringify(response)).not.toContain("stored-access-token");
    expect(JSON.stringify(response)).not.toContain("stored-refresh-token");
  });

  it("reads provider-config hosted snapshots without token material", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        accessTokenExpiresAt: null,
        credentialKind: "provider_config",
        credentialMetadata: {
          authHeader: "Bearer drop-me",
          client: "raw-client",
          client_user_id: "raw-client-user",
          clientUserIdHash: "hash_client_user",
          hmacSecret: "do-not-store",
          opaqueNote: "abc123def456ghi789jkl012mno345pq",
          owner: "raw-owner",
          region: "us",
          user: "raw-user",
        },
        externalAccountId: null,
        provider: "junction",
        providerConfigKey: "junction",
        setupExpiresAt: "2026-04-06T09:30:00.000Z",
        setupPhase: "pending_link",
      }),
      storedAccount: null,
    });
    const { readHostedDeviceSyncRuntimeState } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    harness.store.prisma.deviceConnection.findMany.mockResolvedValue([harness.record]);
    harness.store.getConnectionForUser.mockResolvedValue({
      ...buildPublicConnection(buildHostedRecord({
        provider: "junction",
      })),
      externalAccountId: "junction-user-123",
    });

    const response = await readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.connections[0]).not.toHaveProperty("tokenBundle");
    expect(response.connections[0]).toMatchObject({
      connection: expect.objectContaining({
        externalAccountId: "junction-user-123",
        provider: "junction",
        setupExpiresAt: "2026-04-06T09:30:00.000Z",
        setupPhase: "pending_link",
      }),
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        credentialMetadata: {
          clientUserIdHash: "hash_client_user",
          region: "us",
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("Bearer drop-me");
    expect(JSON.stringify(response)).not.toContain("raw-client");
    expect(JSON.stringify(response)).not.toContain("raw-client-user");
    expect(JSON.stringify(response)).not.toContain("do-not-store");
    expect(JSON.stringify(response)).not.toContain("abc123def456ghi789jkl012mno345pq");
    expect(JSON.stringify(response)).not.toContain("raw-owner");
    expect(JSON.stringify(response)).not.toContain("raw-user");
  });

  it("applies runtime setup phase updates through durable connection state", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        setupExpiresAt: "2026-04-06T09:30:00.000Z",
        setupPhase: "pending_link",
      }),
      storedAccount: null,
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connection: {
                setupExpiresAt: null,
                setupPhase: "source_confirmed",
              },
              connectionId: "conn_123",
              observedUpdatedAt: "2026-04-06T10:00:00.000Z",
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connection: expect.objectContaining({
        setupExpiresAt: null,
        setupPhase: "source_confirmed",
      }),
      connectionId: "conn_123",
      tokenUpdate: "missing",
      writeUpdate: "applied",
    });
    expect(harness.syncDurableConnectionState).toHaveBeenCalledWith(
      expect.objectContaining({
        setupExpiresAt: null,
        setupPhase: "source_confirmed",
      }),
      expect.anything(),
    );
    expect(harness.record.setupExpiresAt).toBe(null);
    expect(harness.record.setupPhase).toBe("source_confirmed");
  });

  it("persists provider-config runtime credentials without writing token bundles", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        accessTokenExpiresAt: null,
        credentialKind: "provider_config",
        provider: "junction",
        providerConfigKey: "junction",
      }),
      storedAccount: null,
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "conn_123",
              credential: {
                kind: "provider_config",
                providerConfigKey: "junction",
                credentialMetadata: {
                  client_user_id: "raw-client-user",
                  hmacSecret: "do-not-store",
                  region: "us",
                },
              },
              observedTokenVersion: null,
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connectionId: "conn_123",
      tokenUpdate: "missing",
      writeUpdate: "applied",
    });
    expect(harness.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(harness.updateConnectionRecord).toHaveBeenCalledWith({
      where: {
        id: "conn_123",
      },
      data: expect.objectContaining({
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        credentialKind: "provider_config",
        credentialMetadataJson: {
          region: "us",
        },
        keyVersion: null,
        providerConfigKey: "junction",
        refreshTokenEncrypted: null,
        tokenVersion: null,
      }),
    });
  });

  it("rejects provider-config runtime credential replacement for OAuth manifest providers", async () => {
    const harness = createAuthorityHarness();
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    await expect(applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "conn_123",
              credential: {
                kind: "provider_config",
                providerConfigKey: "junction",
              },
              observedTokenVersion: null,
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    })).rejects.toThrow(/credential.*oauth_tokens|provider-config.*profile/u);
    expect(harness.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(harness.updateConnectionRecord).not.toHaveBeenCalled();
  });

  it("persists sanitized none credential metadata from runtime credential updates", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        credentialKind: "none",
        credentialMetadata: {
          previousReason: "initial",
        },
        provider: "custom",
      }),
      storedAccount: null,
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "conn_123",
              credential: {
                kind: "none",
                credentialMetadata: {
                  authHeader: "Bearer drop-me",
                  client: "raw-client",
                  reason: "manual_disconnect",
                  owner: "raw-owner",
                  sourceCount: 2,
                  user: "raw-user",
                },
              },
              observedTokenVersion: null,
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connectionId: "conn_123",
      tokenUpdate: "missing",
      writeUpdate: "applied",
    });
    expect(harness.updateConnectionRecord).toHaveBeenCalledWith({
      where: {
        id: "conn_123",
      },
      data: expect.objectContaining({
        credentialKind: "none",
        credentialMetadataJson: {
          reason: "manual_disconnect",
          sourceCount: 2,
        },
        providerConfigKey: null,
      }),
    });
  });

  it("rejects token-bundle mutations for provider-config runtime credentials", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        accessTokenExpiresAt: null,
        credentialKind: "provider_config",
        provider: "junction",
        providerConfigKey: "junction",
      }),
      storedAccount: null,
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    await expect(applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "conn_123",
              observedTokenVersion: null,
              credential: {
                clearTokens: true,
                kind: "oauth_tokens",
              },
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    })).rejects.toThrow(/credential update for junction must match/u);
    expect(harness.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
  });

  it("applies fresh null fences once and rejects a replay after the hosted version advances", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        updatedAt: undefined,
      }),
      storedAccount: null,
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );
    const request = () =>
      new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connection: {
                displayName: "Fresh Device",
              },
              connectionId: "conn_123",
              localState: {
                lastSyncStartedAt: "2026-04-06T10:05:00.000Z",
              },
              observedTokenVersion: null,
              observedUpdatedAt: null,
              credential: {
                kind: "oauth_tokens",
                tokenBundle: {
                  accessToken: "fresh-access-token",
                  accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
                  keyVersion: "kv_runtime",
                  refreshToken: "fresh-refresh-token",
                  tokenVersion: 1,
                },
              },
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      });

    const firstResponse = await applyHostedDeviceSyncRuntimeResult({
      request: request(),
      trustedUserId: "user_123",
    });
    const replayResponse = await applyHostedDeviceSyncRuntimeResult({
      request: request(),
      trustedUserId: "user_123",
    });

    expect(firstResponse.updates[0]).toMatchObject({
      connection: expect.objectContaining({
        displayName: "Fresh Device",
        updatedAt: "2026-04-06T10:11:00.000Z",
      }),
      connectionId: "conn_123",
      tokenUpdate: "applied",
      writeUpdate: "applied",
    });
    expect(replayResponse.updates[0]).toMatchObject({
      connection: expect.objectContaining({
        displayName: "Fresh Device",
        updatedAt: "2026-04-06T10:11:00.000Z",
      }),
      connectionId: "conn_123",
      tokenUpdate: "skipped_version_mismatch",
      writeUpdate: "skipped_version_mismatch",
    });
    expect(harness.syncDurableConnectionState).toHaveBeenCalledTimes(1);
    expect(harness.persistStoredConnectionTokenBundle).toHaveBeenCalledTimes(1);
    expect(harness.record.updatedAt).toBe("2026-04-06T10:11:00.000Z");
    expect(harness.storedAccount).toMatchObject({
      credential: {
        kind: "oauth_tokens",
        tokens: {
          accessToken: "fresh-access-token",
        },
      },
      tokenVersion: 1,
    });
  });
});
