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
  mapHostedConnectionRecord: vi.fn((record: ReturnType<typeof buildHostedRecord>) => ({
    ...record,
    externalAccountId: null,
  })),
  resolveDeviceProviderApplication: vi.fn(),
  writeHostedRuntimeLogs: vi.fn(),
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

vi.mock("@/src/lib/hosted-runtime-log/write", () => ({
  writeHostedRuntimeLogs: mocks.writeHostedRuntimeLogs,
}));

vi.mock("@/src/lib/device-sync/provider-applications", () => ({
  isDeviceProviderApplicationError: (value: unknown) =>
    Boolean(value && typeof value === "object" && "code" in value),
  isMemberOwnedDeviceProviderApplicationProvider: (value: unknown) =>
    value === "strava",
  resolveDeviceProviderApplication: mocks.resolveDeviceProviderApplication,
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
    providerApplicationId: string | null;
    providerApplicationRevision: number | null;
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
    providerApplicationId: null,
    providerApplicationRevision: null,
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

function createAuthorityHarness(input: {
  connectionSources?: Array<{
    connectionId: string;
    displayName: string | null;
    firstSeenAt: string;
    lastDataAt?: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    lastSeenAt: string | null;
    lifecycleEpoch?: number;
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
  const providerApplicationFindFirst = vi.fn(async () => null);
  const tx = {
    deviceConnection: {
      findFirst,
      update,
    },
    deviceProviderApplication: {
      findFirst: providerApplicationFindFirst,
    },
  };

  const connectionSources = (input.connectionSources ?? []).map((source) => ({
    ...source,
    lifecycleEpoch: source.lifecycleEpoch ?? 1,
    sourceInstanceKey: source.sourceInstanceKey ?? source.sourceProviderSlug,
  }));
  const store = {
    getConnectionForUser: vi.fn(async () =>
      buildPublicConnection({
        ...currentRecord,
        externalAccountId: currentRecord.externalAccountId ?? "acct_123",
      })),
    getStoredConnectionAccountForUser: vi.fn(async () => currentStoredAccount),
    listConnectionSources: vi.fn(async () => connectionSources),
    listConnectionSourcesForConnections: vi.fn(async (connectionIds: readonly string[]) =>
      connectionSources.filter((source) => connectionIds.includes(source.connectionId))
    ),
    listRuntimeSnapshotConnectionSources: vi.fn(async () => connectionSources),
    materializeDurableConnectionRecord: vi.fn(async (record: ReturnType<typeof buildHostedRecord>) =>
      buildPublicConnection({
        ...record,
        externalAccountId: record.externalAccountId ?? "acct_123",
      })
    ),
    materializeStoredConnectionAccount: vi.fn(
      async (record: ReturnType<typeof buildHostedRecord>) => {
        void record;
        return currentStoredAccount;
      },
    ),
    persistStoredConnectionTokenBundle,
    providerApplicationFindFirst,
    prisma: {
      deviceConnection: {
        findMany: vi.fn(),
      },
      deviceProviderApplication: {
        findFirst: providerApplicationFindFirst,
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

  it("returns an immediate next wake when the acked dirty connection still has work", async () => {
    const markDirtyConnectionProcessed = vi.fn(async () => ({
      connectionId: "conn_dirty_first",
      dirtyRevision: 3n,
      processedRevision: 3n,
      stillDirty: true,
      userId: "user_123",
    }));
    const hasPendingDirtyConnectionForUser = vi.fn(async () => false);
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
    expect(hasPendingDirtyConnectionForUser).not.toHaveBeenCalled();
    expect(response.recorded).toBe(true);
    expect(response.stillDirty).toBe(true);
    expect(response.dirtyRevision).toBe("3");
    expect(response.processedRevision).toBe("3");
    expect(response.nextWakeAt).toEqual(expect.any(String));
    expect(Number.isFinite(Date.parse(response.nextWakeAt ?? ""))).toBe(true);
  });

  it("returns an immediate next wake when another dirty row remains after the acked row", async () => {
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

  it("does not return a next wake when an acknowledged payload leaves no dirty work", async () => {
    const markDirtyConnectionProcessed = vi.fn(async () => ({
      connectionId: "conn_dirty_first",
      dirtyRevision: 3n,
      processedRevision: 3n,
      stillDirty: false,
      userId: "user_123",
    }));
    const hasPendingDirtyConnectionForUser = vi.fn(async () => false);
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
    expect(response.nextWakeAt).toBeNull();
  });

  it("does not return a next wake when remaining dirty work is staged later in the same ack batch", async () => {
    const markDirtyConnectionProcessed = vi.fn(async () => ({
      connectionId: "conn_dirty_first",
      dirtyRevision: 3n,
      processedRevision: 3n,
      stillDirty: false,
      userId: "user_123",
    }));
    const hasPendingDirtyConnectionForUser = vi.fn(async () => {
      throw new Error("hasPendingDirtyConnectionForUser should not be called with staged acks");
    });
    const listPendingDirtyConnectionsForUser = vi.fn(async () => ({
      hasMore: false,
      items: [],
    }));
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      store: {
        hasPendingDirtyConnectionForUser,
        listPendingDirtyConnectionsForUser,
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
          processedRevision: "3",
          stagedDirtyAcks: [
            {
              connectionId: "conn_dirty_second",
              processedDirtyPayloadIds: ["dsp_payload_2"],
              processedRevision: "4",
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(listPendingDirtyConnectionsForUser).toHaveBeenCalledWith({
      limit: 1,
      stagedDirtyAcks: [
        {
          connectionId: "conn_dirty_second",
          processedDirtyPayloadIds: ["dsp_payload_2"],
          processedRevision: "4",
        },
      ],
      userId: "user_123",
    });
    expect(response.recorded).toBe(true);
    expect(response.stillDirty).toBe(false);
    expect(response.nextWakeAt).toBeNull();
  });

});

describe("applyHostedDeviceSyncRuntimeResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveDeviceProviderApplication.mockReset();
  });

  it("applies accepted connection updates sequentially in request order", async () => {
    let activeLocks = 0;
    let maxActiveLocks = 0;
    const withConnectionMutationLock = vi.fn(async (
      _connectionId: string,
      callback: (tx: {
        deviceConnection: {
          findFirst: () => Promise<null>;
        };
      }) => Promise<unknown>,
    ) => {
      activeLocks += 1;
      maxActiveLocks = Math.max(maxActiveLocks, activeLocks);
      await Promise.resolve();
      try {
        return await callback({
          deviceConnection: {
            findFirst: vi.fn(async () => null),
          },
        });
      } finally {
        activeLocks -= 1;
      }
    });
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      store: {
        withConnectionMutationLock,
      },
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            { connectionId: "conn_first" },
            { connectionId: "conn_second" },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(maxActiveLocks).toBe(1);
    expect(withConnectionMutationLock).toHaveBeenNthCalledWith(
      1,
      "conn_first",
      expect.any(Function),
    );
    expect(withConnectionMutationLock).toHaveBeenNthCalledWith(
      2,
      "conn_second",
      expect.any(Function),
    );
    expect(response.updates.map((update) => update.connectionId)).toEqual([
      "conn_first",
      "conn_second",
    ]);
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
    expect(mocks.writeHostedRuntimeLogs).not.toHaveBeenCalled();
    expect(harness.record.displayName).toBe("Hosted Device");
    expect(harness.storedAccount?.credential).toMatchObject({
      kind: "oauth_tokens",
      tokens: {
        accessToken: "stored-access-token",
      },
    });
    expect(harness.storedAccount?.tokenVersion).toBe(3);
  });

  it("rejects runtime writes after a provider-application binding becomes stale", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        provider: "strava",
        providerApplicationId: "dpa_123",
        providerApplicationRevision: 4,
      }),
    });
    harness.store.providerApplicationFindFirst.mockResolvedValue(null);
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "conn_123",
              localState: {
                lastSyncCompletedAt: "2026-04-06T10:05:00.000Z",
              },
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
        status: "reauthorization_required",
      }),
      connectionId: "conn_123",
      tokenUpdate: "missing",
      writeUpdate: "skipped_version_mismatch",
    });
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(harness.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
  });

  it("rejects a destructive apply when OAuth replacement changes connectedAt after snapshot hydration", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        connectedAt: "2026-04-06T10:30:00.000Z",
        updatedAt: "2026-04-06T10:31:00.000Z",
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
              connection: {
                status: "disconnected",
              },
              connectionId: "conn_123",
              credential: {
                clearTokens: true,
                kind: "oauth_tokens",
              },
              localState: {
                nextReconcileAt: null,
              },
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
              observedTokenVersion: 3,
              observedUpdatedAt: "2026-04-06T10:31:00.000Z",
              sources: [
                {
                  displayName: "Stale source",
                  firstSeenAt: "2026-04-06T09:00:00.000Z",
                  lastDataAt: "2026-04-06T10:29:00.000Z",
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  lastSeenAt: "2026-04-06T10:30:00.000Z",
                  observedLastSeenAt: null,
                  resourceAvailabilitySummary: { sleep: true },
                  sourceInstanceKey: "oura_primary",
                  sourceProviderSlug: "oura",
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
      connection: expect.objectContaining({
        connectedAt: "2026-04-06T10:30:00.000Z",
        status: "active",
      }),
      connectionId: "conn_123",
      tokenUpdate: "skipped_version_mismatch",
      writeUpdate: "skipped_version_mismatch",
    });
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(harness.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
    expect(harness.upsertConnectionSource).not.toHaveBeenCalled();
    expect(harness.record.status).toBe("active");
    expect(harness.storedAccount?.credential).toMatchObject({
      kind: "oauth_tokens",
      tokens: {
        accessToken: "stored-access-token",
      },
    });
    expect(harness.storedAccount?.tokenVersion).toBe(3);
  });

  it("treats a deploy-skewed apply without observedConnectedAt as superseded", async () => {
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
              localState: {
                nextReconcileAt: null,
              },
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
      connectionId: "conn_123",
      tokenUpdate: "unchanged",
      writeUpdate: "skipped_version_mismatch",
    });
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(harness.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
  });

  it("preserves the web-owned disconnect sentinel against an exact-revision local-state callback", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        lastErrorCode: "DISCONNECT_IN_PROGRESS",
        status: "reauthorization_required",
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
              localState: { clearError: true },
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
      connectionId: "conn_123",
      tokenUpdate: "missing",
      writeUpdate: "skipped_version_mismatch",
    });
    expect(harness.record).toMatchObject({
      lastErrorCode: "DISCONNECT_IN_PROGRESS",
      status: "reauthorization_required",
    });
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(harness.persistStoredConnectionTokenBundle).not.toHaveBeenCalled();
  });

  it("never lets a stale runtime source update rewind the recorded arrival", async () => {
    const applySourceUpdateWithArrival = async (lastDataAt: string | null) => {
      const harness = createAuthorityHarness({
        connectionSources: [
          {
            connectionId: "conn_123",
            displayName: null,
            firstSeenAt: "2026-04-06T09:00:00.000Z",
            lastDataAt: "2026-04-08T00:00:00.000Z",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSeenAt: "2026-04-06T10:00:00.000Z",
            resourceAvailabilitySummary: { activity: true },
            sourceInstanceKey: "junction_garmin",
            sourceProviderSlug: "garmin",
            status: "connected",
          },
        ],
      });
      const { applyHostedDeviceSyncRuntimeResult } = await import(
        "@/src/lib/device-sync/hosted-runtime-authority"
      );

      await applyHostedDeviceSyncRuntimeResult({
        request: new Request("https://example.test/device-sync/runtime/apply", {
          body: JSON.stringify({
            updates: [
              {
                connectionId: "conn_123",
                observedConnectedAt: "2026-04-06T09:00:00.000Z",
                sources: [
                  {
                    displayName: null,
                    firstSeenAt: "2026-04-06T09:00:00.000Z",
                    lastDataAt,
                    lastErrorCode: null,
                    lastErrorMessage: null,
                    lastSeenAt: "2026-04-06T10:05:00.000Z",
                    observedLastSeenAt: "2026-04-06T10:00:00.000Z",
                    resourceAvailabilitySummary: { activity: true },
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

      return harness.upsertConnectionSource;
    };

    // The runner snapshotted before Web recorded the newer arrival; replaying
    // its stale value would reopen a silence window that already closed.
    expect(await applySourceUpdateWithArrival("2026-04-07T00:00:00.000Z"))
      .toHaveBeenCalledWith(
        expect.objectContaining({ lastDataAt: "2026-04-08T00:00:00.000Z" }),
      );

    // A runner that has never seen an arrival must not erase one either.
    expect(await applySourceUpdateWithArrival(null)).toHaveBeenCalledWith(
      expect.objectContaining({ lastDataAt: "2026-04-08T00:00:00.000Z" }),
    );

    // A genuinely newer arrival still advances.
    expect(await applySourceUpdateWithArrival("2026-04-09T00:00:00.000Z"))
      .toHaveBeenCalledWith(
        expect.objectContaining({ lastDataAt: "2026-04-09T00:00:00.000Z" }),
      );
  });

  it("rejects a runtime source projection from an older reconnect epoch", async () => {
    const connectionId = "conn_junction_epoch";
    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId,
      sourceProviderSlug: "oura",
    });
    if (!sourceInstanceKey) {
      throw new Error("Expected a canonical Junction source instance key.");
    }
    const harness = createAuthorityHarness({
      connectionSources: [{
        connectionId,
        displayName: "Oura",
        firstSeenAt: "2026-04-06T09:00:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-04-06T10:00:00.000Z",
        lifecycleEpoch: 2,
        resourceAvailabilitySummary: { note: true },
        sourceInstanceKey,
        sourceProviderSlug: "oura",
        status: "connected",
      }],
      record: buildHostedRecord({
        id: connectionId,
        provider: "junction",
      }),
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [{
            connectionId,
            observedConnectedAt: "2026-04-06T09:00:00.000Z",
            observedUpdatedAt: "2026-04-06T10:00:00.000Z",
            sources: [{
              displayName: "Oura",
              firstSeenAt: "2026-04-06T09:00:00.000Z",
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSeenAt: "2026-04-06T10:05:00.000Z",
              lifecycleEpoch: 1,
              observedLifecycleEpoch: 1,
              observedLastSeenAt: "2026-04-06T10:00:00.000Z",
              resourceAvailabilitySummary: { note: true },
              sourceInstanceKey,
              sourceProviderSlug: "oura",
              status: "connected",
            }],
          }],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connectionId,
      writeUpdate: "skipped_version_mismatch",
    });
    expect(harness.upsertConnectionSource).not.toHaveBeenCalled();
  });

  it.each([
    "SOURCE_DISCONNECT_IN_PROGRESS",
    "SOURCE_START_CLEANUP_IN_PROGRESS",
    "SOURCE_USER_DISCONNECTED",
  ])("does not let a runtime source projection cross the %s fence", async (lastErrorCode) => {
    const connectionId = "conn_junction";
    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId,
      sourceProviderSlug: "oura",
    });
    if (!sourceInstanceKey) {
      throw new Error("Expected a canonical Junction source instance key.");
    }
    const harness = createAuthorityHarness({
      connectionSources: [{
        connectionId,
        displayName: null,
        firstSeenAt: "2026-04-06T09:00:00.000Z",
        lastErrorCode,
        lastErrorMessage: null,
        lastSeenAt: "2026-04-06T10:00:00.000Z",
        resourceAvailabilitySummary: { sleep: true },
        sourceInstanceKey,
        sourceProviderSlug: "oura",
        status: "disconnected",
      }],
      record: buildHostedRecord({
        id: connectionId,
        provider: "junction",
        updatedAt: "2026-04-06T10:00:00.000Z",
      }),
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const response = await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [{
            connectionId,
            observedConnectedAt: "2026-04-06T09:00:00.000Z",
            observedUpdatedAt: "2026-04-06T10:00:00.000Z",
            sources: [{
              displayName: null,
              firstSeenAt: "2026-04-06T09:00:00.000Z",
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSeenAt: "2026-04-06T10:05:00.000Z",
              observedLastSeenAt: "2026-04-06T10:00:00.000Z",
              resourceAvailabilitySummary: { sleep: true },
              sourceInstanceKey,
              sourceProviderSlug: "oura",
              status: "connected",
            }],
          }],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]).toMatchObject({
      connectionId,
      writeUpdate: "skipped_version_mismatch",
    });
    expect(harness.upsertConnectionSource).not.toHaveBeenCalled();
  });

  it("applies an update whose only change is the arrival timestamp", async () => {
    const harness = createAuthorityHarness({
      connectionSources: [
        {
          connectionId: "conn_123",
          displayName: null,
          firstSeenAt: "2026-04-06T09:00:00.000Z",
          lastDataAt: "2026-04-08T00:00:00.000Z",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: "2026-04-06T10:05:00.000Z",
          resourceAvailabilitySummary: { activity: true },
          sourceInstanceKey: "junction_garmin",
          sourceProviderSlug: "garmin",
          status: "connected",
        },
      ],
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    await applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          updates: [
            {
              connectionId: "conn_123",
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
              sources: [
                {
                  // Every field matches the current row except the arrival, which
                  // is exactly the shape a live carrier produces.
                  displayName: null,
                  firstSeenAt: "2026-04-06T09:00:00.000Z",
                  lastDataAt: "2026-04-09T00:00:00.000Z",
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  lastSeenAt: "2026-04-06T10:05:00.000Z",
                  observedLastSeenAt: "2026-04-06T10:05:00.000Z",
                  resourceAvailabilitySummary: { activity: true },
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

    // Dropping lastDataAt from the no-op comparison would silently discard this
    // and leave the stale timestamp behind as a false stall.
    expect(harness.upsertConnectionSource).toHaveBeenCalledWith(
      expect.objectContaining({ lastDataAt: "2026-04-09T00:00:00.000Z" }),
    );
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
              observedUpdatedAt: "2026-05-26T17:35:33.451Z",
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

  it("rejects a legacy Junction runner that would erase current exhausted recovery state", async () => {
    const hostedConnectionId = "conn_junction_exhausted";
    const runtimeLocalAccountId = "dsa_legacy_runtime";
    const windowStart = "2026-04-01T00:00:00.000Z";
    const windowEnd = "2026-04-03T00:00:00.000Z";
    const canonicalSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: hostedConnectionId,
      sourceProviderSlug: "garmin",
    });
    const runtimeSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: runtimeLocalAccountId,
      sourceProviderSlug: "garmin",
    });
    expect(canonicalSourceInstanceKey).toBeTruthy();
    expect(runtimeSourceInstanceKey).toBeTruthy();
    if (!canonicalSourceInstanceKey || !runtimeSourceInstanceKey) {
      throw new Error("Expected Junction source keys for the authority regression.");
    }

    const exhaustedMetadata = {
      junctionHistoricalBackfillEmptyAttempts: 5,
      junctionHistoricalBackfillEvidence: `e2|${windowStart}|${windowEnd}|garmin:1`,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
      junctionHistoricalBackfillWindowEnd: windowEnd,
      junctionHistoricalBackfillWindowStart: windowStart,
    };
    const harness = createAuthorityHarness({
      connectionSources: [
        {
          connectionId: hostedConnectionId,
          displayName: "Garmin",
          firstSeenAt: "2026-04-01T09:00:00.000Z",
          lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
          lastErrorMessage: "Historical data remained incomplete.",
          lastSeenAt: "2026-04-04T09:00:00.000Z",
          resourceAvailabilitySummary: { activity: true, sleep: true },
          sourceInstanceKey: canonicalSourceInstanceKey,
          sourceProviderSlug: "garmin",
          status: "error",
        },
      ],
      record: buildHostedRecord({
        id: hostedConnectionId,
        metadata: exhaustedMetadata,
        provider: "junction",
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
              connection: {
                metadata: {
                  junctionHistoricalBackfillEmptyAttempts: 0,
                  junctionHistoricalBackfillLastEmptyAt: null,
                  junctionHistoricalBackfillStatus: "complete",
                  junctionHistoricalBackfillWindowEnd: windowEnd,
                  junctionHistoricalBackfillWindowStart: windowStart,
                },
              },
              connectionId: hostedConnectionId,
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
              observedUpdatedAt: "2026-04-06T10:00:00.000Z",
              sources: [
                {
                  displayName: "Garmin",
                  firstSeenAt: "2026-04-01T09:00:00.000Z",
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  lastSeenAt: "2026-04-04T09:05:00.000Z",
                  observedLastSeenAt: null,
                  resourceAvailabilitySummary: { activity: true, sleep: true },
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

    expect(response.updates[0]?.writeUpdate).toBe("skipped_version_mismatch");
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(harness.upsertConnectionSource).not.toHaveBeenCalled();
    expect(harness.record.metadata).toEqual(exhaustedMetadata);
  });

  it("rejects exhausted Junction progress without a durable reset signal", async () => {
    const hostedConnectionId = "conn_junction_missing_reset_signal";
    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: hostedConnectionId,
      sourceProviderSlug: "garmin",
    });
    expect(sourceInstanceKey).toBeTruthy();
    if (!sourceInstanceKey) {
      throw new Error("Expected a Junction source key for the reset-signal regression.");
    }
    const windowStart = "2026-04-01T00:00:00.000Z";
    const windowEnd = "2026-04-03T00:00:00.000Z";
    const retryingMetadata = {
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillWindowEnd: windowEnd,
      junctionHistoricalBackfillWindowStart: windowStart,
    };
    const harness = createAuthorityHarness({
      connectionSources: [
        {
          connectionId: hostedConnectionId,
          displayName: "Garmin",
          firstSeenAt: "2026-04-01T09:00:00.000Z",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: "2026-04-06T10:00:00.000Z",
          resourceAvailabilitySummary: { activity: true },
          sourceInstanceKey,
          sourceProviderSlug: "garmin",
          status: "connected",
        },
      ],
      record: buildHostedRecord({
        id: hostedConnectionId,
        metadata: retryingMetadata,
        provider: "junction",
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
              connection: {
                metadata: {
                  junctionHistoricalBackfillEmptyAttempts: 5,
                  junctionHistoricalBackfillLastEmptyAt: "2026-04-06T10:05:00.000Z",
                  junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
                  junctionHistoricalBackfillWindowEnd: windowEnd,
                  junctionHistoricalBackfillWindowStart: windowStart,
                },
              },
              connectionId: hostedConnectionId,
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
              observedUpdatedAt: "2026-04-06T10:00:00.000Z",
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]?.writeUpdate).toBe("skipped_version_mismatch");
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(harness.upsertConnectionSource).not.toHaveBeenCalled();
    expect(harness.record.metadata).toEqual(retryingMetadata);
  });

  it("enforces terminal Junction progress while allowing provider reset markers during retrying", async () => {
    const hostedConnectionId = "conn_junction_reset_consistency";
    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: hostedConnectionId,
      sourceProviderSlug: "garmin",
    });
    if (!sourceInstanceKey) {
      throw new Error("Expected a Junction source key for reset consistency.");
    }
    const windowStart = "2026-04-01T00:00:00.000Z";
    const windowEnd = "2026-04-03T00:00:00.000Z";
    const progress = (
      status: "complete" | "exhausted" | "retrying",
      lastEmptyAt = "2026-04-06T10:00:00.000Z",
    ) => ({
      junctionHistoricalBackfillEmptyAttempts:
        status === "exhausted" ? 5 : status === "retrying" ? 4 : 0,
      junctionHistoricalBackfillLastEmptyAt: status === "complete" ? null : lastEmptyAt,
      junctionHistoricalBackfillStatus: `coverage_v3_${status}`,
      junctionHistoricalBackfillWindowEnd: windowEnd,
      junctionHistoricalBackfillWindowStart: windowStart,
    });
    const source = (resetRequired: boolean, lastSeenAt: string) => ({
      connectionId: hostedConnectionId,
      displayName: "Garmin",
      firstSeenAt: "2026-04-01T09:00:00.000Z",
      lastErrorCode: resetRequired ? "HISTORICAL_DATA_RECONNECT_REQUIRED" : null,
      lastErrorMessage: resetRequired ? "Historical data remained incomplete." : null,
      lastSeenAt,
      resourceAvailabilitySummary: { activity: true },
      sourceInstanceKey,
      sourceProviderSlug: "garmin",
      status: resetRequired ? "error" as const : "connected" as const,
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    const cases = [
      {
        expectedSource: {
          lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
          status: "error",
        },
        expectedWrite: "applied",
        name: "retrying progress with marker",
        storedMetadata: progress("retrying"),
        storedSource: source(false, "2026-04-06T10:00:00.000Z"),
        update: {
          connection: {
            metadata: progress("retrying", "2026-04-06T10:05:00.000Z"),
          },
          connectionId: hostedConnectionId,
          observedConnectedAt: "2026-04-06T09:00:00.000Z",
          observedUpdatedAt: "2026-04-06T10:00:00.000Z",
          sources: [{
            ...source(true, "2026-04-06T10:05:00.000Z"),
            connectionId: undefined,
            observedLastSeenAt: "2026-04-06T10:00:00.000Z",
          }],
        },
      },
      {
        expectedSource: {
          lastErrorCode: null,
          status: "connected",
        },
        expectedWrite: "applied",
        name: "retrying progress with marker clear",
        storedMetadata: progress("retrying"),
        storedSource: source(true, "2026-04-06T10:00:00.000Z"),
        update: {
          connection: {
            metadata: progress("retrying", "2026-04-06T10:05:00.000Z"),
          },
          connectionId: hostedConnectionId,
          observedConnectedAt: "2026-04-06T09:00:00.000Z",
          observedUpdatedAt: "2026-04-06T10:00:00.000Z",
          sources: [{
            ...source(false, "2026-04-06T10:05:00.000Z"),
            connectionId: undefined,
            observedLastSeenAt: "2026-04-06T10:00:00.000Z",
          }],
        },
      },
      {
        expectedSource: null,
        expectedWrite: "skipped_version_mismatch",
        name: "completed progress without marker clear",
        storedMetadata: progress("exhausted"),
        storedSource: source(true, "2026-04-06T10:00:00.000Z"),
        update: {
          connection: { metadata: progress("complete") },
          connectionId: hostedConnectionId,
          observedConnectedAt: "2026-04-06T09:00:00.000Z",
          observedUpdatedAt: "2026-04-06T10:00:00.000Z",
        },
      },
      {
        expectedSource: {
          lastErrorCode: null,
          status: "connected",
        },
        expectedWrite: "applied",
        name: "completed progress with marker clear",
        storedMetadata: progress("exhausted"),
        storedSource: source(true, "2026-04-06T10:00:00.000Z"),
        update: {
          connection: { metadata: progress("complete") },
          connectionId: hostedConnectionId,
          observedConnectedAt: "2026-04-06T09:00:00.000Z",
          observedUpdatedAt: "2026-04-06T10:00:00.000Z",
          sources: [{
            ...source(false, "2026-04-06T10:05:00.000Z"),
            connectionId: undefined,
            observedLastSeenAt: "2026-04-06T10:00:00.000Z",
          }],
        },
      },
    ] as const;

    for (const scenario of cases) {
      const harness = createAuthorityHarness({
        connectionSources: [scenario.storedSource],
        record: buildHostedRecord({
          id: hostedConnectionId,
          metadata: scenario.storedMetadata,
          provider: "junction",
        }),
      });
      const response = await applyHostedDeviceSyncRuntimeResult({
        request: new Request("https://example.test/device-sync/runtime/apply", {
          body: JSON.stringify({ updates: [scenario.update], userId: "user_123" }),
          method: "POST",
        }),
        trustedUserId: "user_123",
      });

      expect(response.updates[0]?.writeUpdate, scenario.name).toBe(scenario.expectedWrite);
      if (scenario.expectedWrite === "applied") {
        expect(harness.syncDurableConnectionState, scenario.name).toHaveBeenCalledTimes(1);
        expect(harness.upsertConnectionSource, scenario.name).toHaveBeenCalledWith(
          expect.objectContaining(scenario.expectedSource),
        );
      } else {
        expect(harness.syncDurableConnectionState, scenario.name).not.toHaveBeenCalled();
        expect(harness.upsertConnectionSource, scenario.name).not.toHaveBeenCalled();
      }
    }
  });

  it("applies monotonic Junction evidence unions without a permanent version mismatch", async () => {
    const windowStart = "2026-04-01T00:00:00.000Z";
    const windowEnd = "2026-04-03T00:00:00.000Z";
    const baselineMetadata = {
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillEvidence: `e2|${windowStart}|${windowEnd}|garmin:1`,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillWindowEnd: windowEnd,
      junctionHistoricalBackfillWindowStart: windowStart,
    };
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        id: "conn_junction_evidence_union",
        metadata: baselineMetadata,
        provider: "junction",
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
              connection: {
                metadata: {
                  ...baselineMetadata,
                  junctionHistoricalBackfillEvidence:
                    `e2|${windowStart}|${windowEnd}|oura:2`,
                  providerCursor: "cursor-next",
                },
              },
              connectionId: "conn_junction_evidence_union",
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
              observedUpdatedAt: "2026-04-06T10:00:00.000Z",
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(response.updates[0]?.writeUpdate).toBe("applied");
    expect(harness.syncDurableConnectionState).toHaveBeenCalledTimes(1);
    expect(harness.record.metadata).toEqual({
      ...baselineMetadata,
      junctionHistoricalBackfillEvidence:
        `e2|${windowStart}|${windowEnd}|garmin:1,oura:2`,
      providerCursor: "cursor-next",
    });
  });

  it.each([
    {
      emptyAttempts: 4,
      expectedSource: { lastErrorCode: null, status: "connected" },
      status: "retrying",
    },
    {
      emptyAttempts: 5,
      expectedSource: {
        lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
        lastErrorMessage: "Historical data remained incomplete.",
        status: "error",
      },
      status: "exhausted",
    },
  ] as const)("resolves newer provider source state while progress is $status", async ({
    emptyAttempts,
    expectedSource,
    status,
  }) => {
    const hostedConnectionId = "conn_junction_source_marker";
    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: hostedConnectionId,
      sourceProviderSlug: "garmin",
    });
    expect(sourceInstanceKey).toBeTruthy();
    if (!sourceInstanceKey) {
      throw new Error("Expected a Junction source key for the reset-marker regression.");
    }
    const windowStart = "2026-04-01T00:00:00.000Z";
    const windowEnd = "2026-04-03T00:00:00.000Z";
    const harness = createAuthorityHarness({
      connectionSources: [
        {
          connectionId: hostedConnectionId,
          displayName: "Garmin",
          firstSeenAt: "2026-04-01T09:00:00.000Z",
          lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
          lastErrorMessage: "Historical data remained incomplete.",
          lastSeenAt: "2026-04-06T10:00:00.000Z",
          resourceAvailabilitySummary: { activity: true },
          sourceInstanceKey,
          sourceProviderSlug: "garmin",
          status: "error",
        },
      ],
      record: buildHostedRecord({
        id: hostedConnectionId,
        metadata: {
          junctionHistoricalBackfillEmptyAttempts: emptyAttempts,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-06T10:00:00.000Z",
          junctionHistoricalBackfillStatus: `coverage_v3_${status}`,
          junctionHistoricalBackfillWindowEnd: windowEnd,
          junctionHistoricalBackfillWindowStart: windowStart,
        },
        provider: "junction",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
              observedUpdatedAt: "2026-04-06T10:00:00.000Z",
              sources: [
                {
                  displayName: "Garmin",
                  firstSeenAt: "2026-04-01T09:00:00.000Z",
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  lastSeenAt: "2026-04-06T10:05:00.000Z",
                  observedLastSeenAt: "2026-04-06T10:00:00.000Z",
                  resourceAvailabilitySummary: { activity: true, sleep: true },
                  sourceInstanceKey,
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

    expect(response.updates[0]?.writeUpdate).toBe("applied");
    expect(harness.upsertConnectionSource).toHaveBeenCalledWith(expect.objectContaining({
      ...expectedSource,
      sourceInstanceKey,
    }));
  });

  it("rejects a Junction source-only write from an older connection epoch", async () => {
    const hostedConnectionId = "conn_junction_stale_epoch";
    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: hostedConnectionId,
      sourceProviderSlug: "garmin",
    });
    if (!sourceInstanceKey) {
      throw new Error("Expected a Junction source key for the connection-epoch regression.");
    }
    const harness = createAuthorityHarness({
      connectionSources: [
        {
          connectionId: hostedConnectionId,
          displayName: "Garmin",
          firstSeenAt: "2026-04-06T09:00:00.000Z",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: "2026-04-06T10:05:00.000Z",
          resourceAvailabilitySummary: { activity: true },
          sourceInstanceKey,
          sourceProviderSlug: "garmin",
          status: "connected",
        },
      ],
      record: buildHostedRecord({
        id: hostedConnectionId,
        provider: "junction",
        updatedAt: "2026-04-06T10:10:00.000Z",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
              observedUpdatedAt: "2026-04-06T10:00:00.000Z",
              sources: [
                {
                  displayName: "Garmin",
                  firstSeenAt: "2026-04-06T09:00:00.000Z",
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  lastSeenAt: "2026-04-06T10:15:00.000Z",
                  observedLastSeenAt: "2026-04-06T10:05:00.000Z",
                  resourceAvailabilitySummary: { activity: true, sleep: true },
                  sourceInstanceKey,
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

    expect(response.updates[0]?.writeUpdate).toBe("skipped_version_mismatch");
    expect(harness.upsertConnectionSource).not.toHaveBeenCalled();
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
  });

  it("rejects a coupled Junction progress transition when its source fence is stale", async () => {
    const hostedConnectionId = "conn_junction_source_race";
    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: hostedConnectionId,
      sourceProviderSlug: "garmin",
    });
    expect(sourceInstanceKey).toBeTruthy();
    if (!sourceInstanceKey) {
      throw new Error("Expected a Junction source key for the source-fence regression.");
    }
    const windowStart = "2026-04-01T00:00:00.000Z";
    const windowEnd = "2026-04-03T00:00:00.000Z";
    const retryingMetadata = {
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillWindowEnd: windowEnd,
      junctionHistoricalBackfillWindowStart: windowStart,
    };
    const harness = createAuthorityHarness({
      connectionSources: [
        {
          connectionId: hostedConnectionId,
          displayName: "Garmin",
          firstSeenAt: "2026-04-01T09:00:00.000Z",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: "2026-04-06T10:10:00.000Z",
          resourceAvailabilitySummary: { activity: true },
          sourceInstanceKey,
          sourceProviderSlug: "garmin",
          status: "connected",
        },
      ],
      record: buildHostedRecord({
        id: hostedConnectionId,
        metadata: retryingMetadata,
        provider: "junction",
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
              connection: {
                metadata: {
                  junctionHistoricalBackfillEmptyAttempts: 5,
                  junctionHistoricalBackfillLastEmptyAt: "2026-04-06T10:05:00.000Z",
                  junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
                  junctionHistoricalBackfillWindowEnd: windowEnd,
                  junctionHistoricalBackfillWindowStart: windowStart,
                },
              },
              connectionId: hostedConnectionId,
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
              observedUpdatedAt: "2026-04-06T10:00:00.000Z",
              sources: [
                {
                  displayName: "Garmin",
                  firstSeenAt: "2026-04-01T09:00:00.000Z",
                  lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
                  lastErrorMessage: "Historical data remained incomplete.",
                  lastSeenAt: "2026-04-06T10:05:00.000Z",
                  observedLastSeenAt: "2026-04-06T10:00:00.000Z",
                  resourceAvailabilitySummary: { activity: true },
                  sourceInstanceKey,
                  sourceProviderSlug: "garmin",
                  status: "error",
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

    expect(response.updates[0]?.writeUpdate).toBe("skipped_version_mismatch");
    expect(harness.syncDurableConnectionState).not.toHaveBeenCalled();
    expect(harness.upsertConnectionSource).not.toHaveBeenCalled();
    expect(harness.record.metadata).toEqual(retryingMetadata);
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
    expect(mocks.writeHostedRuntimeLogs).toHaveBeenCalledWith({
      entries: [expect.objectContaining({
        at: "2026-05-19T22:03:27.378Z",
        component: "device-sync",
        errorCode: "WHOOP_TOKEN_REQUEST_FAILED",
        eventCode: "device-sync.job_failed",
        level: "warn",
        phase: "invoke",
        redactedJson: expect.objectContaining({
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
      })],
      userId: "user_123",
    });
  });

  it("flushes diagnostics for committed updates when a later update fails", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        id: "conn_whoop",
        provider: "whoop",
        updatedAt: "2026-05-19T22:00:44.000Z",
      }),
    });
    const originalError = new Error("second update failed");
    const scheduledTasks: Array<() => Promise<void>> = [];
    let primaryTransactionActive = false;
    const defaultWithConnectionMutationLock = harness.store.withConnectionMutationLock
      .getMockImplementation();
    if (!defaultWithConnectionMutationLock) {
      throw new Error("Expected the authority harness to own the connection lock.");
    }
    harness.store.withConnectionMutationLock.mockImplementation(async (
      connectionId,
      callback,
    ) => {
      primaryTransactionActive = true;
      try {
        if (connectionId === "conn_second") {
          throw originalError;
        }
        return await defaultWithConnectionMutationLock(connectionId, callback);
      } finally {
        primaryTransactionActive = false;
      }
    });
    const { applyHostedDeviceSyncRuntimeResult } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    await expect(applyHostedDeviceSyncRuntimeResult({
      request: new Request("https://example.test/device-sync/runtime/apply", {
        body: JSON.stringify({
          occurredAt: "2026-05-19T22:03:28.000Z",
          updates: [
            {
              connectionId: "conn_whoop",
              failureDiagnostic: {
                accountStatus: "reauthorization_required",
                code: "WHOOP_TOKEN_REQUEST_FAILED",
                retryable: false,
              },
              localState: {
                lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
                lastErrorMessage: "WHOOP token request failed.",
                lastSyncErrorAt: "2026-05-19T22:03:27.378Z",
              },
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
              observedUpdatedAt: "2026-05-19T22:00:44.000Z",
            },
            {
              connectionId: "conn_second",
            },
          ],
          userId: "user_123",
        }),
        method: "POST",
      }),
      scheduleFailureDiagnostics: (task) => {
        expect(primaryTransactionActive).toBe(false);
        scheduledTasks.push(task);
      },
      trustedUserId: "user_123",
    })).rejects.toBe(originalError);

    expect(scheduledTasks).toHaveLength(1);
    expect(mocks.writeHostedRuntimeLogs).not.toHaveBeenCalled();
    await scheduledTasks[0]?.();
    expect(mocks.writeHostedRuntimeLogs).toHaveBeenCalledTimes(1);
    expect(mocks.writeHostedRuntimeLogs).toHaveBeenCalledWith({
      entries: [expect.objectContaining({
        errorCode: "WHOOP_TOKEN_REQUEST_FAILED",
        eventCode: "device-sync.job_failed",
      })],
      userId: "user_123",
    });
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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

  it("projects exact member-owned provider config only with credential material", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        provider: "strava",
        providerApplicationId: "dpa_123",
        providerApplicationRevision: 4,
      }),
    });
    mocks.resolveDeviceProviderApplication.mockResolvedValue({
      applicationId: "dpa_123",
      provider: "strava",
      providerConfigs: {
        strava: {
          clientId: "member-client",
          clientSecret: "member-secret",
        },
      },
      revision: 4,
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

    expect(mocks.resolveDeviceProviderApplication).toHaveBeenCalledWith({
      applicationId: "dpa_123",
      expectedRevision: 4,
      memberId: "user_123",
      prisma: harness.store.prisma,
      provider: "strava",
    });
    expect(response.providerConfigs).toEqual({
      strava: {
        clientId: "member-client",
        clientSecret: "member-secret",
      },
    });
    expect(response.connections[0]).toMatchObject({
      connection: { status: "active" },
      credential: { kind: "oauth_tokens" },
    });
  });

  it("does not project client credentials for a non-active app-bound connection", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        provider: "strava",
        providerApplicationId: "dpa_123",
        providerApplicationRevision: 4,
        status: "reauthorization_required",
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

    expect(mocks.resolveDeviceProviderApplication).not.toHaveBeenCalled();
    expect(response.providerConfigs).toBeUndefined();
    expect(response.connections[0]).toMatchObject({
      connection: { status: "reauthorization_required" },
      credential: { kind: "oauth_tokens_redacted" },
    });
  });

  it("withholds tokens and forces repair when an app-bound config is stale", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        provider: "strava",
        providerApplicationId: "dpa_123",
        providerApplicationRevision: 4,
      }),
    });
    mocks.resolveDeviceProviderApplication.mockRejectedValue(
      Object.assign(new Error("stale application"), {
        code: "DEVICE_PROVIDER_APPLICATION_REVISION_MISMATCH",
      }),
    );
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

    expect(response.providerConfigs).toBeUndefined();
    expect(response.connections[0]).toMatchObject({
      connection: { status: "reauthorization_required" },
      credential: { kind: "oauth_tokens_redacted" },
    });
  });

  it("marks a stale app binding for repair in credential-free status snapshots", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        provider: "strava",
        providerApplicationId: "dpa_123",
        providerApplicationRevision: 4,
      }),
    });
    harness.store.providerApplicationFindFirst.mockResolvedValue(null);
    const { readHostedDeviceSyncRuntimeState } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );
    harness.store.prisma.deviceConnection.findMany.mockResolvedValue([harness.record]);

    const response = await readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          includeCredentialMaterial: false,
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(mocks.resolveDeviceProviderApplication).not.toHaveBeenCalled();
    expect(response.providerConfigs).toBeUndefined();
    expect(response.connections[0]).toMatchObject({
      connection: { status: "reauthorization_required" },
      credential: { kind: "oauth_tokens_redacted" },
    });
  });

  it("propagates provider-application storage outages instead of misclassifying them as repair", async () => {
    const harness = createAuthorityHarness({
      record: buildHostedRecord({
        provider: "strava",
        providerApplicationId: "dpa_123",
        providerApplicationRevision: 4,
      }),
    });
    const storageError = new Error("kms unavailable");
    mocks.resolveDeviceProviderApplication.mockRejectedValue(storageError);
    const { readHostedDeviceSyncRuntimeState } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );
    harness.store.prisma.deviceConnection.findMany.mockResolvedValue([harness.record]);

    await expect(readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          includeCredentialMaterial: true,
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    })).rejects.toBe(storageError);
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
    harness.store.materializeDurableConnectionRecord.mockResolvedValue({
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

    expect(harness.store.materializeDurableConnectionRecord).toHaveBeenCalledWith(harness.record);
    expect(harness.store.getConnectionForUser).not.toHaveBeenCalled();
    expect(harness.store.getStoredConnectionAccountForUser).not.toHaveBeenCalled();
    expect(harness.store.listConnectionSourcesForConnections).toHaveBeenCalledWith(["conn_123"]);
    expect(harness.store.listConnectionSources).not.toHaveBeenCalled();
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

  it("uses one set-based source read and no connection re-reads for unscoped snapshots", async () => {
    const harness = createAuthorityHarness();
    const { readHostedDeviceSyncRuntimeState } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );
    const records = [
      buildHostedRecord({ id: "conn_a", updatedAt: "2026-04-06T10:03:00.000Z" }),
      buildHostedRecord({ id: "conn_b", updatedAt: "2026-04-06T10:02:00.000Z" }),
      buildHostedRecord({ id: "conn_c", updatedAt: "2026-04-06T10:01:00.000Z" }),
    ];
    const sources = records.map((record, index) => ({
      connectionId: record.id,
      displayName: `Source ${index + 1}`,
      firstSeenAt: "2026-04-06T09:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: `2026-04-06T10:0${index}:00.000Z`,
      lifecycleEpoch: 1,
      resourceAvailabilitySummary: {},
      sourceInstanceKey: `source-${index + 1}`,
      sourceProviderSlug: `source_${index + 1}`,
      status: "connected" as const,
    }));

    harness.store.prisma.deviceConnection.findMany.mockResolvedValue(records);
    harness.store.materializeStoredConnectionAccount.mockImplementation(async (record) =>
      buildStoredAccount(record)
    );
    harness.store.listConnectionSourcesForConnections.mockResolvedValue(sources);

    const response = await readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(harness.store.prisma.deviceConnection.findMany).toHaveBeenCalledTimes(1);
    expect(harness.store.listConnectionSourcesForConnections).toHaveBeenCalledTimes(1);
    expect(harness.store.listConnectionSourcesForConnections).toHaveBeenCalledWith([
      "conn_a",
      "conn_b",
      "conn_c",
    ]);
    expect(harness.store.materializeStoredConnectionAccount).toHaveBeenCalledTimes(3);
    expect(harness.store.getStoredConnectionAccountForUser).not.toHaveBeenCalled();
    expect(harness.store.getConnectionForUser).not.toHaveBeenCalled();
    expect(harness.store.listConnectionSources).not.toHaveBeenCalled();
    expect(harness.store.listRuntimeSnapshotConnectionSources).not.toHaveBeenCalled();
    expect(response.connections).toHaveLength(3);
    expect(response.connections.map((connection) => ({
      connectionId: connection.connection.id,
      sourceProviderSlugs: (connection.sources ?? []).map(
        (source) => source.sourceProviderSlug,
      ),
    }))).toEqual([
      { connectionId: "conn_a", sourceProviderSlugs: ["source_1"] },
      { connectionId: "conn_b", sourceProviderSlugs: ["source_2"] },
      { connectionId: "conn_c", sourceProviderSlugs: ["source_3"] },
    ]);
  });

  it("filters hosted snapshots by direct providers and aggregator-backed source aliases", async () => {
    const harness = createAuthorityHarness();
    const { readHostedDeviceSyncRuntimeState } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    harness.store.prisma.deviceConnection.findMany.mockResolvedValue([harness.record]);

    await readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          limit: 4,
          provider: "whoop",
          sourceProviderSlug: "fitbit",
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(harness.store.prisma.deviceConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 4,
        where: expect.objectContaining({
          OR: [
            { provider: { in: ["whoop", "whoop_v2", "whoop-v2"] } },
            {
              sources: {
                some: {
                  sourceProviderSlug: { in: ["whoop", "whoop_v2", "whoop-v2"] },
                  status: {
                    not: "disconnected",
                  },
                },
              },
            },
          ],
          sources: {
            some: {
              sourceProviderSlug: { in: ["fitbit"] },
              status: {
                not: "disconnected",
              },
            },
          },
          userId: "user_123",
        }),
      }),
    );
  });

  it("uses a bounded source projection for limited provider-scoped hosted snapshots", async () => {
    const harness = createAuthorityHarness({
      connectionSources: [
        {
          connectionId: "conn_123",
          displayName: "WHOOP",
          firstSeenAt: "2026-04-06T09:00:00.000Z",
          lastErrorCode: "TOKEN_REFRESH_FAILED",
          lastErrorMessage: null,
          lastSeenAt: "2026-04-06T10:00:00.000Z",
          resourceAvailabilitySummary: {},
          sourceProviderSlug: "whoop_v2",
          status: "error",
        },
      ],
      record: buildHostedRecord({
        provider: "junction",
      }),
    });
    const { readHostedDeviceSyncRuntimeState } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    harness.store.prisma.deviceConnection.findMany.mockResolvedValue([harness.record]);

    const response = await readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          limit: 4,
          sourceProviderSlug: "whoop",
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(harness.store.listRuntimeSnapshotConnectionSources).toHaveBeenCalledWith({
      connectionId: "conn_123",
      limit: 4,
      sourceProviderSlugs: ["whoop", "whoop_v2", "whoop-v2"],
    });
    expect(harness.store.listConnectionSourcesForConnections).not.toHaveBeenCalled();
    expect(harness.store.listConnectionSources).not.toHaveBeenCalled();
    expect(response.connections[0]?.sources).toEqual([
      expect.objectContaining({
        sourceProviderSlug: "whoop_v2",
      }),
    ]);
  });

  it("keeps explicit blank hosted snapshot filters fail-closed", async () => {
    const harness = createAuthorityHarness();
    const { readHostedDeviceSyncRuntimeState } = await import(
      "@/src/lib/device-sync/hosted-runtime-authority"
    );

    harness.store.prisma.deviceConnection.findMany.mockResolvedValue([]);

    await readHostedDeviceSyncRuntimeState({
      request: new Request("https://example.test/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "   ",
          userId: "user_123",
        }),
        method: "POST",
      }),
      trustedUserId: "user_123",
    });

    expect(harness.store.prisma.deviceConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ id: { in: [] } }],
          userId: "user_123",
        }),
      }),
    );
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
    harness.store.materializeDurableConnectionRecord.mockResolvedValue({
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
              observedConnectedAt: "2026-04-06T09:00:00.000Z",
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
