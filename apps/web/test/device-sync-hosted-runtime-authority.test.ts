import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedPublicDeviceSyncAccount: vi.fn((input: { record: ReturnType<typeof buildHostedRecord> }) =>
    buildPublicConnection(input.record)),
  createHostedDeviceSyncControlPlane: vi.fn(),
  mapHostedConnectionRecord: vi.fn((record: ReturnType<typeof buildHostedRecord>) => record),
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

function buildHostedRecord(
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
    status: "active" | "reauthorization_required" | "disconnected";
    updatedAt: string | undefined;
    userId: string;
  }> = {},
) {
  return {
    accessTokenExpiresAt: null,
    connectedAt: "2026-04-06T09:00:00.000Z",
    createdAt: "2026-04-06T09:00:00.000Z",
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
    scopes: ["daily"],
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
  return {
    ...buildPublicConnection(record),
    accessToken: "stored-access-token",
    accessTokenExpiresAt: record.accessTokenExpiresAt ?? null,
    disconnectGeneration: 0,
    keyVersion: "kv_stored",
    refreshToken: "stored-refresh-token",
    tokenVersion: 3,
    ...overrides,
  };
}

function createAuthorityHarness(input: {
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
      status: account.status,
      updatedAt: "2026-04-06T10:11:00.000Z",
    };
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
  const tx = {
    deviceConnection: {
      findFirst,
    },
  };

  const store = {
    getStoredConnectionAccountForUser: vi.fn(async () => currentStoredAccount),
    persistStoredConnectionTokenBundle,
    prisma: {
      deviceConnection: {
        findMany: vi.fn(),
      },
    },
    syncDurableConnectionState,
    withConnectionRefreshLock: vi.fn(async (
      _connectionId: string,
      callback: (tx: { deviceConnection: { findFirst: typeof findFirst } }) => Promise<unknown>,
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
  };
}

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
                tokenBundle: {
                  accessToken: "fresh-access-token",
                  accessTokenExpiresAt: null,
                  keyVersion: "kv_runtime",
                  refreshToken: "fresh-refresh-token",
                  tokenVersion: 1,
                },
              },
            ],
            userId: "user_123",
          }),
          method: "POST",
        }),
        trustedUserId: "user_123",
      }),
    ).rejects.toThrow(/observedTokenVersion is required when tokenBundle mutations are present/u);

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
              tokenBundle: {
                accessToken: "replayed-access-token",
                accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
                keyVersion: "kv_runtime",
                refreshToken: "replayed-refresh-token",
                tokenVersion: 2,
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
    expect(harness.record.displayName).toBe("Hosted Device");
    expect(harness.storedAccount?.accessToken).toBe("stored-access-token");
    expect(harness.storedAccount?.tokenVersion).toBe(3);
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
              tokenBundle: {
                accessToken: "fresh-access-token",
                accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
                keyVersion: "kv_runtime",
                refreshToken: "fresh-refresh-token",
                tokenVersion: 1,
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
      accessToken: "fresh-access-token",
      tokenVersion: 1,
    });
  });
});
