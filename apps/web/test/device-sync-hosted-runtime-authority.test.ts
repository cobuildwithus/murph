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
  recordHostedRuntimeLogTx: vi.fn(),
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
    listConnectionSources: vi.fn(async () => []),
    persistStoredConnectionTokenBundle,
    prisma: {
      deviceConnection: {
        findMany: vi.fn(),
      },
    },
    syncDurableConnectionState,
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
    updateConnectionRecord: update,
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
