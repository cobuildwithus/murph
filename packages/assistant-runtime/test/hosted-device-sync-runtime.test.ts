import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyHostedDeviceSyncRuntimeUpdates: vi.fn(async () => undefined),
  fetchHostedDeviceSyncRuntimeSnapshot: vi.fn(async () => null),
  normalizeHostedDeviceSyncJobHints: vi.fn(() => []),
  resolveHostedExecutionDeviceSyncRuntimeClient: vi.fn(),
  resolveHostedDeviceSyncWakeContext: vi.fn(() => ({
    connectionId: null,
    hint: null,
    provider: null,
  })),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>("@murphai/hosted-execution");
  return {
    ...actual,
    resolveHostedExecutionDeviceSyncRuntimeClient: mocks.resolveHostedExecutionDeviceSyncRuntimeClient,
    HOSTED_EXECUTION_PROXY_HOSTS: {
      ...actual.HOSTED_EXECUTION_PROXY_HOSTS,
      deviceSync: "device-sync.worker",
    },
    normalizeHostedDeviceSyncJobHints: mocks.normalizeHostedDeviceSyncJobHints,
    resolveHostedDeviceSyncWakeContext: mocks.resolveHostedDeviceSyncWakeContext,
  };
});

function normalizeHostedSnapshotFixture<T extends {
  connections: Array<{
    connection: Record<string, unknown>;
    localState?: Record<string, unknown>;
    tokenBundle: Record<string, unknown> | null;
  }>;
}>(fixture: T): T {
  return {
    ...fixture,
    connections: fixture.connections.map((entry) => {
      if (entry.localState) {
        return entry;
      }

      const {
        lastErrorCode = null,
        lastErrorMessage = null,
        lastSyncCompletedAt = null,
        lastSyncErrorAt = null,
        lastSyncStartedAt = null,
        lastWebhookAt = null,
        nextReconcileAt = null,
        ...connection
      } = entry.connection;

      return {
        ...entry,
        connection,
        localState: {
          lastErrorCode,
          lastErrorMessage,
          lastSyncCompletedAt,
          lastSyncErrorAt,
          lastSyncStartedAt,
          lastWebhookAt,
          nextReconcileAt,
        },
      };
    }),
  };
}

describe("hosted device-sync runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveHostedExecutionDeviceSyncRuntimeClient.mockImplementation((input) =>
      input.baseUrl
        ? {
            applyUpdates: (request: {
              occurredAt?: string | null;
              updates: unknown;
            }) => mocks.applyHostedDeviceSyncRuntimeUpdates({
              baseUrl: input.baseUrl,
              fetchImpl: input.fetchImpl,
              signingSecret: null,
              occurredAt: request.occurredAt ?? null,
              timeoutMs: input.timeoutMs ?? null,
              updates: request.updates,
              userId: input.boundUserId,
            }),
            fetchSnapshot: (request?: {
              connectionId?: string | null;
              provider?: string | null;
            }) => mocks.fetchHostedDeviceSyncRuntimeSnapshot({
              baseUrl: input.baseUrl,
              connectionId: request?.connectionId ?? null,
              fetchImpl: input.fetchImpl,
              signingSecret: null,
              provider: request?.provider ?? null,
              timeoutMs: input.timeoutMs ?? null,
              userId: input.boundUserId,
            }),
          }
        : null
    );
    mocks.normalizeHostedDeviceSyncJobHints.mockReturnValue([]);
    mocks.resolveHostedDeviceSyncWakeContext.mockReturnValue({
      connectionId: null,
      hint: null,
      provider: null,
    });
  });

  it("hydrates hosted control-plane snapshots through the store-owned hosted primitive and clears local tokens on disconnect", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Alice Oura",
            externalAccountId: "oura_alice",
            id: "hosted_123",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
            lastWebhookAt: "2026-03-27T07:50:00.000Z",
            metadata: {
              source: "hosted",
            },
            nextReconcileAt: null,
            provider: "oura",
            scopes: ["heartrate"],
            status: "disconnected",
            updatedAt: "2026-03-27T08:00:00.000Z",
          },
          tokenBundle: null,
        },
      ],
      generatedAt: "2026-03-27T08:05:00.000Z",
      userId: "user-123",
    }));

    const existing = {
      id: "local_123",
      provider: "oura",
      externalAccountId: "oura_alice",
      displayName: "Old Name",
      status: "active",
      scopes: ["offline"],
      metadata: {
        stale: true,
      },
      connectedAt: "2026-03-20T10:00:00.000Z",
      lastWebhookAt: null,
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastErrorCode: "STALE",
      lastErrorMessage: "stale",
      nextReconcileAt: "2026-03-28T00:00:00.000Z",
      createdAt: "2026-03-20T10:00:00.000Z",
      updatedAt: "2026-03-20T10:00:00.000Z",
      disconnectGeneration: 0,
      accessTokenEncrypted: "enc:old",
      refreshTokenEncrypted: "enc:refresh",
    };
    const hydrateHostedAccount = vi.fn(() => ({
      ...existing,
      accessTokenEncrypted: "",
      disconnectGeneration: 1,
      displayName: "Alice Oura",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
      lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
      lastWebhookAt: "2026-03-27T07:50:00.000Z",
      metadata: {
        source: "hosted",
      },
      nextReconcileAt: null,
      scopes: ["heartrate"],
      status: "disconnected",
    }));
    const markPendingJobsDeadForAccount = vi.fn();
    const service = {
      store: {
        getAccountByExternalAccount: vi.fn(() => existing),
        hydrateHostedAccount,
        markPendingJobsDeadForAccount,
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    const state = await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_123",
        occurredAt: "2026-03-27T08:05:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(hydrateHostedAccount).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({
        connectedAt: "2026-03-26T12:00:00.000Z",
        displayName: "Alice Oura",
        externalAccountId: "oura_alice",
        metadata: {
          source: "hosted",
        },
        provider: "oura",
        scopes: ["heartrate"],
        status: "disconnected",
        updatedAt: "2026-03-27T08:00:00.000Z",
      }),
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
      localState: expect.objectContaining({
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
        lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
        lastWebhookAt: "2026-03-27T07:50:00.000Z",
        nextReconcileAt: null,
      }),
    }));
    expect(markPendingJobsDeadForAccount).toHaveBeenCalledWith(
      "local_123",
      "2026-03-27T08:05:00.000Z",
      "HOSTED_CONTROL_PLANE_DISCONNECTED",
      "Hosted control plane marked the device-sync connection as disconnected.",
    );
    expect(state.hostedToLocalAccountIds.get("hosted_123")).toBe("local_123");
    expect(state.localToHostedAccountIds.get("local_123")).toBe("hosted_123");
  });

  it("uses the worker proxy device-sync endpoint even when no web token is exposed to the runner", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [],
      generatedAt: "2026-03-27T08:05:00.000Z",
      userId: "user-123",
    }));
    const service = {
      store: {
        getAccountByExternalAccount: vi.fn(),
        hydrateHostedAccount: vi.fn(),
        markPendingJobsDeadForAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    const state = await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_proxy_snapshot",
        occurredAt: "2026-03-27T08:05:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: 5_000,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "http://device-sync.worker",
        signingSecret: null,
      },
    });

    expect(mocks.fetchHostedDeviceSyncRuntimeSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "http://device-sync.worker",
      connectionId: null,
      fetchImpl: undefined,
      signingSecret: null,
      provider: null,
      timeoutMs: 5_000,
      userId: "user-123",
    }));
    expect(state.snapshot).toEqual({
      connections: [],
      generatedAt: "2026-03-27T08:05:00.000Z",
      userId: "user-123",
    });
  });

  it("forwards a custom fetch implementation into hosted device-sync snapshot reads", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [],
      generatedAt: "2026-03-27T08:05:00.000Z",
      userId: "user-123",
    }));
    const service = {
      store: {
        getAccountByExternalAccount: vi.fn(),
        hydrateHostedAccount: vi.fn(),
        markPendingJobsDeadForAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_forward_snapshot_fetch",
        occurredAt: "2026-03-27T08:05:00.000Z",
      },
      fetchImpl: fetchImpl as typeof fetch,
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: 5_000,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "http://device-sync.worker",
        signingSecret: null,
      },
    });

    expect(mocks.fetchHostedDeviceSyncRuntimeSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "http://device-sync.worker",
      fetchImpl,
      signingSecret: null,
      timeoutMs: 5_000,
      userId: "user-123",
    }));
  });

  it("ignores hosted wake hints whose connection id was never reconciled to a local account id", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [],
      generatedAt: "2026-03-27T08:05:00.000Z",
      userId: "user-123",
    }));
    mocks.resolveHostedDeviceSyncWakeContext.mockReturnValue({
      connectionId: "hosted_missing",
      hint: {
        jobs: [
          {
            kind: "reconcile",
            payload: {
              windowStart: "2026-03-19T00:00:00.000Z",
            },
          },
        ],
      },
      provider: "oura",
    });
    const service = {
      store: {
        enqueueJob: vi.fn(),
        getAccountByExternalAccount: vi.fn(),
        getAccountById: vi.fn(),
        hydrateHostedAccount: vi.fn(),
        markPendingJobsDeadForAccount: vi.fn(),
        patchAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    const state = await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          connectionId: "hosted_missing",
          kind: "device-sync.wake",
          provider: "oura",
          reason: "webhook_hint",
          userId: "user-123",
        },
        eventId: "evt_missing_hosted_mapping",
        occurredAt: "2026-03-27T08:05:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(service.store.getAccountById).not.toHaveBeenCalled();
    expect(service.store.enqueueJob).not.toHaveBeenCalled();
    expect(state.hostedToLocalAccountIds.size).toBe(0);
  });

  it("treats hosted wake hints as advisory and ignores scope rewrites", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Alice Oura",
            externalAccountId: "oura_alice",
            id: "hosted_advisory",
            metadata: {},
            provider: "oura",
            scopes: ["heartrate"],
            status: "active",
            updatedAt: "2026-03-27T08:00:00.000Z",
          },
          tokenBundle: null,
        },
      ],
      generatedAt: "2026-03-27T08:05:00.000Z",
      userId: "user-123",
    }));
    mocks.resolveHostedDeviceSyncWakeContext.mockReturnValue({
      connectionId: "hosted_advisory",
      hint: {
        jobs: [],
        nextReconcileAt: "2026-03-27T19:00:00.000Z",
        scopes: ["spoofed-scope"],
      },
      provider: "oura",
    });
    const account = {
      id: "local_advisory",
      provider: "oura",
      externalAccountId: "oura_alice",
      displayName: "Alice Oura",
      status: "active",
      scopes: ["heartrate"],
      metadata: {},
      connectedAt: "2026-03-26T12:00:00.000Z",
      lastWebhookAt: null,
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextReconcileAt: "2026-03-27T18:00:00.000Z",
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-27T08:00:00.000Z",
      disconnectGeneration: 0,
      accessTokenEncrypted: "enc:access",
      refreshTokenEncrypted: null,
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
    };
    const service = {
      store: {
        enqueueJob: vi.fn(),
        getAccountByExternalAccount: vi.fn(() => account),
        getAccountById: vi.fn(() => account),
        hydrateHostedAccount: vi.fn(() => account),
        markPendingJobsDeadForAccount: vi.fn(),
        patchAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          connectionId: "hosted_advisory",
          hint: {
            jobs: [],
            nextReconcileAt: "2026-03-27T19:00:00.000Z",
            scopes: ["spoofed-scope"],
          },
          kind: "device-sync.wake",
          provider: "oura",
          reason: "webhook_hint",
          userId: "user-123",
        },
        eventId: "evt_advisory_wake",
        occurredAt: "2026-03-27T08:05:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(service.store.patchAccount).toHaveBeenCalledWith("local_advisory", {
      nextReconcileAt: "2026-03-27T19:00:00.000Z",
    });
    expect(service.store.patchAccount).not.toHaveBeenCalledWith(
      "local_advisory",
      expect.objectContaining({
        scopes: expect.anything(),
      }),
    );
  });

  it("hydrates hosted connection and token state while preserving local nextReconcileAt", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Hosted Whoop",
            externalAccountId: "whoop-user-1",
            id: "hosted_456",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
            lastWebhookAt: "2026-03-27T07:50:00.000Z",
            metadata: {
              source: "hosted",
            },
            nextReconcileAt: "2026-03-27T12:00:00.000Z",
            provider: "whoop",
            scopes: ["offline"],
            status: "active",
            updatedAt: "2026-03-27T08:00:00.000Z",
          },
          tokenBundle: {
            accessToken: "hosted-access",
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            keyVersion: "v1",
            refreshToken: "hosted-refresh",
            tokenVersion: 4,
          },
        },
      ],
      generatedAt: "2026-03-27T08:05:00.000Z",
      userId: "user-123",
    }));

    const existing = {
      id: "local_456",
      provider: "whoop",
      externalAccountId: "whoop-user-1",
      displayName: "Local Whoop",
      status: "active",
      scopes: ["offline"],
      metadata: {
        source: "local",
      },
      connectedAt: "2026-03-26T12:00:00.000Z",
      lastWebhookAt: "2026-03-27T07:50:00.000Z",
      lastSyncStartedAt: "2026-03-27T08:10:00.000Z",
      lastSyncCompletedAt: "2026-03-27T08:20:00.000Z",
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextReconcileAt: "2026-03-27T18:00:00.000Z",
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-27T08:20:00.000Z",
      disconnectGeneration: 0,
      accessTokenEncrypted: "enc:new-access",
      refreshTokenEncrypted: "enc:new-refresh",
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
    };
    const hydrateHostedAccount = vi.fn(() => existing);
    const service = {
      store: {
        getAccountByExternalAccount: vi.fn(() => existing),
        hydrateHostedAccount,
        markPendingJobsDeadForAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_456",
        occurredAt: "2026-03-27T08:25:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(hydrateHostedAccount).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({
        displayName: "Hosted Whoop",
        externalAccountId: "whoop-user-1",
        metadata: {
          source: "hosted",
        },
        provider: "whoop",
        scopes: ["offline"],
        status: "active",
        updatedAt: "2026-03-27T08:00:00.000Z",
      }),
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
      localState: expect.objectContaining({
        nextReconcileAt: "2026-03-27T18:00:00.000Z",
      }),
      tokens: expect.objectContaining({
        accessToken: "hosted-access",
        refreshToken: "hosted-refresh",
      }),
    }));
  });

  it("hydrates hosted connection and token state on first sync while preserving local error state", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Hosted Whoop",
            externalAccountId: "whoop-rollout-user",
            id: "hosted_rollout_user",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
            lastWebhookAt: "2026-03-27T07:50:00.000Z",
            metadata: {
              source: "hosted",
            },
            nextReconcileAt: "2026-03-27T12:00:00.000Z",
            provider: "whoop",
            scopes: ["offline"],
            status: "active",
            updatedAt: "2026-03-27T08:00:00.000Z",
          },
          tokenBundle: {
            accessToken: "hosted-access",
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            keyVersion: "v1",
            refreshToken: "hosted-refresh",
            tokenVersion: 2,
          },
        },
      ],
      generatedAt: "2026-03-27T08:05:00.000Z",
      userId: "user-123",
    }));

    const existing = {
      id: "local_rollout_user",
      provider: "whoop",
      externalAccountId: "whoop-rollout-user",
      displayName: "Local Whoop",
      status: "reauthorization_required",
      scopes: ["offline"],
      metadata: {
        source: "local",
      },
      connectedAt: "2026-03-26T12:00:00.000Z",
      lastWebhookAt: "2026-03-27T07:50:00.000Z",
      lastSyncStartedAt: "2026-03-27T08:10:00.000Z",
      lastSyncCompletedAt: "2026-03-27T08:20:00.000Z",
      lastSyncErrorAt: "2026-03-27T08:20:00.000Z",
      lastErrorCode: "PROVIDER_AUTH",
      lastErrorMessage: "Reconnect locally",
      nextReconcileAt: "2026-03-27T18:00:00.000Z",
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-27T08:20:00.000Z",
      disconnectGeneration: 0,
      accessTokenEncrypted: "enc:local-access",
      refreshTokenEncrypted: "enc:local-refresh",
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: null,
    };
    const hydrateHostedAccount = vi.fn(() => existing);
    const service = {
      store: {
        getAccountByExternalAccount: vi.fn(() => existing),
        hydrateHostedAccount,
        markPendingJobsDeadForAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_rollout_user",
        occurredAt: "2026-03-27T08:25:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(hydrateHostedAccount).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({
        displayName: "Hosted Whoop",
        status: "active",
        updatedAt: "2026-03-27T08:00:00.000Z",
      }),
      hostedObservedTokenVersion: 2,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
      localState: expect.objectContaining({
        lastErrorCode: "PROVIDER_AUTH",
        lastErrorMessage: "Reconnect locally",
        nextReconcileAt: "2026-03-27T12:00:00.000Z",
      }),
      tokens: expect.objectContaining({
        accessToken: "hosted-access",
        refreshToken: "hosted-refresh",
      }),
    }));
  });

  it("does not let a webhook-only hosted touch clear fresher local auth errors while hosted connection state still wins", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Hosted Whoop",
            externalAccountId: "whoop-webhook-touch",
            id: "hosted_webhook_touch",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
            lastWebhookAt: "2026-03-27T08:24:00.000Z",
            metadata: {
              source: "hosted",
            },
            nextReconcileAt: "2026-03-27T12:00:00.000Z",
            provider: "whoop",
            scopes: ["offline"],
            status: "active",
            updatedAt: "2026-03-27T08:00:00.000Z",
          },
          tokenBundle: {
            accessToken: "hosted-access",
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            keyVersion: "v1",
            refreshToken: "hosted-refresh",
            tokenVersion: 4,
          },
        },
      ],
      generatedAt: "2026-03-27T08:25:00.000Z",
      userId: "user-123",
    }));

    const existing = {
      id: "local_webhook_touch",
      provider: "whoop",
      externalAccountId: "whoop-webhook-touch",
      displayName: "Local Whoop",
      status: "reauthorization_required",
      scopes: ["offline"],
      metadata: {
        source: "local",
      },
      connectedAt: "2026-03-26T12:00:00.000Z",
      lastWebhookAt: "2026-03-27T08:20:00.000Z",
      lastSyncStartedAt: "2026-03-27T08:10:00.000Z",
      lastSyncCompletedAt: "2026-03-27T08:20:00.000Z",
      lastSyncErrorAt: "2026-03-27T08:20:00.000Z",
      lastErrorCode: "PROVIDER_AUTH",
      lastErrorMessage: "Reconnect locally",
      nextReconcileAt: "2026-03-27T18:00:00.000Z",
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-27T08:23:00.000Z",
      disconnectGeneration: 0,
      accessTokenEncrypted: "enc:local-access",
      refreshTokenEncrypted: "enc:local-refresh",
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
    };
    const hydrateHostedAccount = vi.fn(() => existing);
    const service = {
      store: {
        getAccountByExternalAccount: vi.fn(() => existing),
        hydrateHostedAccount,
        markPendingJobsDeadForAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_webhook_touch",
        occurredAt: "2026-03-27T08:25:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(hydrateHostedAccount).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({
        displayName: "Hosted Whoop",
        status: "active",
        updatedAt: "2026-03-27T08:00:00.000Z",
      }),
      localState: expect.objectContaining({
        lastErrorCode: "PROVIDER_AUTH",
        lastErrorMessage: "Reconnect locally",
        lastWebhookAt: "2026-03-27T08:24:00.000Z",
      }),
      tokens: expect.objectContaining({
        accessToken: "hosted-access",
        refreshToken: "hosted-refresh",
      }),
    }));
  });

  it("uses hosted connection and token state even when the hosted snapshot omits updatedAt", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Hosted Whoop",
            externalAccountId: "whoop-user-missing-updated-at",
            id: "hosted_missing_updated_at",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
            lastWebhookAt: "2026-03-27T07:50:00.000Z",
            metadata: {
              source: "hosted",
            },
            nextReconcileAt: "2026-03-27T12:00:00.000Z",
            provider: "whoop",
            scopes: ["offline"],
            status: "active",
          },
          tokenBundle: {
            accessToken: "stale-hosted-access",
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            keyVersion: "v1",
            refreshToken: "stale-hosted-refresh",
            tokenVersion: 4,
          },
        },
      ],
      generatedAt: "2026-03-27T08:45:00.000Z",
      userId: "user-123",
    }));

    const existing = {
      id: "local_missing_updated_at",
      provider: "whoop",
      externalAccountId: "whoop-user-missing-updated-at",
      displayName: "Local Whoop",
      status: "active",
      scopes: ["offline"],
      metadata: {
        source: "local",
      },
      connectedAt: "2026-03-26T12:00:00.000Z",
      lastWebhookAt: "2026-03-27T07:50:00.000Z",
      lastSyncStartedAt: "2026-03-27T08:10:00.000Z",
      lastSyncCompletedAt: "2026-03-27T08:20:00.000Z",
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextReconcileAt: "2026-03-27T18:00:00.000Z",
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-27T08:40:00.000Z",
      disconnectGeneration: 0,
      accessTokenEncrypted: "enc:new-access",
      refreshTokenEncrypted: "enc:new-refresh",
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "2026-03-27T08:30:00.000Z",
    };
    const hydrateHostedAccount = vi.fn(() => existing);
    const service = {
      store: {
        getAccountByExternalAccount: vi.fn(() => existing),
        hydrateHostedAccount,
        markPendingJobsDeadForAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_missing_updated_at",
        occurredAt: "2026-03-27T08:45:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(hydrateHostedAccount).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({
        displayName: "Hosted Whoop",
        updatedAt: "2026-03-27T08:30:00.000Z",
      }),
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "2026-03-27T08:30:00.000Z",
      localState: expect.objectContaining({
        nextReconcileAt: "2026-03-27T18:00:00.000Z",
      }),
      tokens: expect.objectContaining({
        accessToken: "stale-hosted-access",
        refreshToken: "stale-hosted-refresh",
      }),
    }));
  });

  it("replaces malformed local observed timestamps with the hosted snapshot markers", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Hosted Whoop",
            externalAccountId: "whoop-user-malformed-marker",
            id: "hosted_malformed_marker",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
            lastWebhookAt: "2026-03-27T07:50:00.000Z",
            metadata: {
              source: "hosted",
            },
            nextReconcileAt: "2026-03-27T12:00:00.000Z",
            provider: "whoop",
            scopes: ["offline"],
            status: "active",
            updatedAt: "2026-03-27T08:00:00.000Z",
          },
          tokenBundle: {
            accessToken: "stale-hosted-access",
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            keyVersion: "v1",
            refreshToken: "stale-hosted-refresh",
            tokenVersion: 4,
          },
        },
      ],
      generatedAt: "2026-03-27T08:45:00.000Z",
      userId: "user-123",
    }));

    const existing = {
      id: "local_malformed_marker",
      provider: "whoop",
      externalAccountId: "whoop-user-malformed-marker",
      displayName: "Local Whoop",
      status: "active",
      scopes: ["offline"],
      metadata: {
        source: "local",
      },
      connectedAt: "2026-03-26T12:00:00.000Z",
      lastWebhookAt: "2026-03-27T07:50:00.000Z",
      lastSyncStartedAt: "2026-03-27T08:10:00.000Z",
      lastSyncCompletedAt: "2026-03-27T08:20:00.000Z",
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextReconcileAt: "2026-03-27T18:00:00.000Z",
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-27T08:40:00.000Z",
      disconnectGeneration: 0,
      accessTokenEncrypted: "enc:new-access",
      refreshTokenEncrypted: "enc:new-refresh",
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "not-a-date",
    };
    const hydrateHostedAccount = vi.fn(() => existing);
    const service = {
      store: {
        getAccountByExternalAccount: vi.fn(() => existing),
        hydrateHostedAccount,
        markPendingJobsDeadForAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_malformed_marker",
        occurredAt: "2026-03-27T08:45:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(hydrateHostedAccount).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({
        displayName: "Hosted Whoop",
        updatedAt: "2026-03-27T08:00:00.000Z",
      }),
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
      localState: expect.objectContaining({
        nextReconcileAt: "2026-03-27T12:00:00.000Z",
      }),
      tokens: expect.objectContaining({
        accessToken: "stale-hosted-access",
        refreshToken: "stale-hosted-refresh",
      }),
    }));
  });

  it("tracks hosted observed markers directly when hosted connection and token state are authoritative", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Hosted Whoop",
            externalAccountId: "whoop-user-3",
            id: "hosted_987",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
            lastWebhookAt: "2026-03-27T07:50:00.000Z",
            metadata: {
              source: "hosted",
            },
            nextReconcileAt: "2026-03-27T12:00:00.000Z",
            provider: "whoop",
            scopes: ["offline"],
            status: "active",
            updatedAt: "2026-03-27T08:20:00.000Z",
          },
          tokenBundle: {
            accessToken: "stale-hosted-access",
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            keyVersion: "v1",
            refreshToken: "stale-hosted-refresh",
            tokenVersion: 5,
          },
        },
      ],
      generatedAt: "2026-03-27T08:45:00.000Z",
      userId: "user-123",
    }));

    const existing = {
      id: "local_987",
      provider: "whoop",
      externalAccountId: "whoop-user-3",
      displayName: "Local Whoop",
      status: "active",
      scopes: ["offline"],
      metadata: {
        source: "local",
      },
      connectedAt: "2026-03-26T12:00:00.000Z",
      lastWebhookAt: "2026-03-27T07:50:00.000Z",
      lastSyncStartedAt: "2026-03-27T08:10:00.000Z",
      lastSyncCompletedAt: "2026-03-27T08:20:00.000Z",
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextReconcileAt: "2026-03-27T18:00:00.000Z",
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-27T08:40:00.000Z",
      disconnectGeneration: 0,
      accessTokenEncrypted: "enc:new-access",
      refreshTokenEncrypted: "enc:new-refresh",
      hostedObservedTokenVersion: 6,
      hostedObservedUpdatedAt: "2026-03-27T08:30:00.000Z",
    };
    const hydrateHostedAccount = vi.fn(() => existing);
    const service = {
      store: {
        getAccountByExternalAccount: vi.fn(() => existing),
        hydrateHostedAccount,
        markPendingJobsDeadForAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_987",
        occurredAt: "2026-03-27T08:45:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(hydrateHostedAccount).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({
        displayName: "Hosted Whoop",
        externalAccountId: "whoop-user-3",
        metadata: {
          source: "hosted",
        },
        updatedAt: "2026-03-27T08:20:00.000Z",
      }),
      hostedObservedTokenVersion: 5,
      hostedObservedUpdatedAt: "2026-03-27T08:20:00.000Z",
      localState: expect.objectContaining({
        nextReconcileAt: "2026-03-27T18:00:00.000Z",
      }),
      tokens: expect.objectContaining({
        accessToken: "stale-hosted-access",
        refreshToken: "stale-hosted-refresh",
      }),
    }));
  });

  it("hydrates hosted tokens and hosted connection state together", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Hosted Whoop",
            externalAccountId: "whoop-user-3",
            id: "hosted_999",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
            lastWebhookAt: "2026-03-27T07:50:00.000Z",
            metadata: {
              source: "hosted",
            },
            nextReconcileAt: "2026-03-27T12:00:00.000Z",
            provider: "whoop",
            scopes: ["offline"],
            status: "active",
            updatedAt: "2026-03-27T08:00:00.000Z",
          },
          tokenBundle: {
            accessToken: "hosted-access-v5",
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            keyVersion: "v1",
            refreshToken: "hosted-refresh-v5",
            tokenVersion: 5,
          },
        },
      ],
      generatedAt: "2026-03-27T08:05:00.000Z",
      userId: "user-123",
    }));

    const existing = {
      id: "local_999",
      provider: "whoop",
      externalAccountId: "whoop-user-3",
      displayName: "Local Whoop",
      status: "active",
      scopes: ["offline"],
      metadata: {
        source: "local",
      },
      connectedAt: "2026-03-26T12:00:00.000Z",
      lastWebhookAt: "2026-03-27T07:50:00.000Z",
      lastSyncStartedAt: "2026-03-27T08:10:00.000Z",
      lastSyncCompletedAt: "2026-03-27T08:20:00.000Z",
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextReconcileAt: "2026-03-27T18:00:00.000Z",
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-27T08:20:00.000Z",
      disconnectGeneration: 0,
      accessTokenEncrypted: "enc:new-access",
      refreshTokenEncrypted: "enc:new-refresh",
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
    };
    const hydrateHostedAccount = vi.fn(() => existing);
    const service = {
      store: {
        getAccountByExternalAccount: vi.fn(() => existing),
        hydrateHostedAccount,
        markPendingJobsDeadForAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_999",
        occurredAt: "2026-03-27T08:25:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(hydrateHostedAccount).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({
        displayName: "Hosted Whoop",
        externalAccountId: "whoop-user-3",
        metadata: {
          source: "hosted",
        },
        provider: "whoop",
        scopes: ["offline"],
        status: "active",
        updatedAt: "2026-03-27T08:00:00.000Z",
      }),
      hostedObservedTokenVersion: 5,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
      localState: expect.objectContaining({
        nextReconcileAt: "2026-03-27T18:00:00.000Z",
      }),
      tokens: expect.objectContaining({
        accessToken: "hosted-access-v5",
        refreshToken: "hosted-refresh-v5",
      }),
    }));

    const hydrateInput = hydrateHostedAccount.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(hydrateInput).toHaveProperty("tokens");
    const tokens = (hydrateInput.tokens ?? null) as Record<string, unknown> | null;
    expect(tokens?.accessToken).toBe("hosted-access-v5");
    expect(tokens?.refreshToken).toBe("hosted-refresh-v5");

    const { createSecretCodec } = await import("@murphai/device-syncd/crypto");
    const codec = createSecretCodec("secret-for-tests");
    expect(codec.decrypt(String(tokens?.accessTokenEncrypted))).toBe("hosted-access-v5");
    expect(codec.decrypt(String(tokens?.refreshTokenEncrypted))).toBe("hosted-refresh-v5");
  });

  it("hydrates hosted-owned nextReconcileAt once the hosted connection state advances", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(normalizeHostedSnapshotFixture({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Hosted Whoop",
            externalAccountId: "whoop-user-2",
            id: "hosted_789",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
            lastWebhookAt: "2026-03-27T07:50:00.000Z",
            metadata: {
              source: "hosted",
            },
            nextReconcileAt: "2026-03-27T10:00:00.000Z",
            provider: "whoop",
            scopes: ["offline"],
            status: "active",
            updatedAt: "2026-03-27T08:30:00.000Z",
          },
          tokenBundle: {
            accessToken: "hosted-access",
            accessTokenExpiresAt: "2026-03-27T09:00:00.000Z",
            keyVersion: "v1",
            refreshToken: "hosted-refresh",
            tokenVersion: 4,
          },
        },
      ],
      generatedAt: "2026-03-27T08:35:00.000Z",
      userId: "user-123",
    }));

    const existing = {
      id: "local_789",
      provider: "whoop",
      externalAccountId: "whoop-user-2",
      displayName: "Local Whoop",
      status: "active",
      scopes: ["offline"],
      metadata: {
        source: "local",
      },
      connectedAt: "2026-03-26T12:00:00.000Z",
      lastWebhookAt: "2026-03-27T07:50:00.000Z",
      lastSyncStartedAt: "2026-03-27T08:10:00.000Z",
      lastSyncCompletedAt: "2026-03-27T08:20:00.000Z",
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextReconcileAt: "2026-03-27T18:00:00.000Z",
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-27T08:20:00.000Z",
      disconnectGeneration: 0,
      accessTokenEncrypted: "enc:new-access",
      refreshTokenEncrypted: "enc:new-refresh",
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
    };
    const hydrateHostedAccount = vi.fn(() => existing);
    const service = {
      store: {
        getAccountByExternalAccount: vi.fn(() => existing),
        hydrateHostedAccount,
        markPendingJobsDeadForAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_789",
        occurredAt: "2026-03-27T08:35:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(hydrateHostedAccount).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({
        displayName: "Hosted Whoop",
        externalAccountId: "whoop-user-2",
        metadata: {
          source: "hosted",
        },
        provider: "whoop",
        scopes: ["offline"],
        status: "active",
        updatedAt: "2026-03-27T08:30:00.000Z",
      }),
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "2026-03-27T08:30:00.000Z",
      localState: expect.objectContaining({
        nextReconcileAt: "2026-03-27T10:00:00.000Z",
      }),
    }));
  });

  it("does not emit an empty token bundle when the hosted-authoritative snapshot cleared active escrow", async () => {
    const { reconcileHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    const service = {
      store: {
        getAccountById: vi.fn(() => ({
          accessTokenEncrypted: "",
          accessTokenExpiresAt: null,
          connectedAt: "2026-03-26T12:00:00.000Z",
          createdAt: "2026-03-26T12:00:00.000Z",
          disconnectGeneration: 0,
          displayName: "Hosted Whoop",
          externalAccountId: "whoop-cleared-escrow",
          hostedObservedTokenVersion: null,
          hostedObservedUpdatedAt: "2026-03-27T08:30:00.000Z",
          id: "local_cleared_escrow",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-03-27T08:20:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-03-27T08:10:00.000Z",
          lastWebhookAt: "2026-03-27T07:50:00.000Z",
          metadata: {
            source: "hosted",
          },
          nextReconcileAt: "2026-03-27T18:00:00.000Z",
          provider: "whoop",
          refreshTokenEncrypted: null,
          scopes: ["offline"],
          status: "active",
          updatedAt: "2026-03-27T08:30:00.000Z",
        })),
      },
    };

    await reconcileHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_cleared_escrow",
        occurredAt: "2026-03-27T08:35:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      state: {
        hostedToLocalAccountIds: new Map([["hosted_cleared_escrow", "local_cleared_escrow"]]),
        localToHostedAccountIds: new Map([["local_cleared_escrow", "hosted_cleared_escrow"]]),
        observedTokenVersions: new Map([["hosted_cleared_escrow", null]]),
        snapshot: normalizeHostedSnapshotFixture({
          connections: [
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-03-26T12:00:00.000Z",
                createdAt: "2026-03-26T12:00:00.000Z",
                displayName: "Hosted Whoop",
                externalAccountId: "whoop-cleared-escrow",
                id: "hosted_cleared_escrow",
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: "2026-03-27T08:20:00.000Z",
                lastSyncErrorAt: null,
                lastSyncStartedAt: "2026-03-27T08:10:00.000Z",
                lastWebhookAt: "2026-03-27T07:50:00.000Z",
                metadata: {
                  source: "hosted",
                },
                nextReconcileAt: "2026-03-27T18:00:00.000Z",
                provider: "whoop",
                scopes: ["offline"],
                status: "active",
                updatedAt: "2026-03-27T08:30:00.000Z",
              },
              tokenBundle: null,
            },
          ],
          generatedAt: "2026-03-27T08:35:00.000Z",
          userId: "user-123",
        }),
      },
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(mocks.applyHostedDeviceSyncRuntimeUpdates).toHaveBeenCalledWith(expect.objectContaining({
      updates: [],
    }));
  });

  it("does not push a regressed nextReconcileAt back to the hosted control plane", async () => {
    const { reconcileHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    const { createSecretCodec } = await import("@murphai/device-syncd/crypto");
    const codec = createSecretCodec("secret-for-tests");
    const service = {
      store: {
        getAccountById: vi.fn(() => ({
          accessTokenEncrypted: codec.encrypt("access"),
          accessTokenExpiresAt: null,
          connectedAt: "2026-03-26T12:00:00.000Z",
          createdAt: "2026-03-26T12:00:00.000Z",
          disconnectGeneration: 0,
          displayName: "Alice Oura",
          externalAccountId: "oura_alice",
          hostedObservedTokenVersion: 7,
          hostedObservedUpdatedAt: "2026-03-27T08:25:00.000Z",
          id: "local_regressed_next_reconcile",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-03-27T08:30:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-03-27T08:20:00.000Z",
          lastWebhookAt: "2026-03-27T08:00:00.000Z",
          metadata: {
            source: "hosted",
          },
          nextReconcileAt: "2026-03-27T17:00:00.000Z",
          provider: "oura",
          refreshTokenEncrypted: null,
          scopes: ["heartrate"],
          status: "active",
          updatedAt: "2026-03-27T08:30:00.000Z",
        })),
      },
    };

    await reconcileHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_regressed_next_reconcile",
        occurredAt: "2026-03-27T08:35:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      state: {
        hostedToLocalAccountIds: new Map([["hosted_regressed_next_reconcile", "local_regressed_next_reconcile"]]),
        localToHostedAccountIds: new Map([["local_regressed_next_reconcile", "hosted_regressed_next_reconcile"]]),
        observedTokenVersions: new Map([["hosted_regressed_next_reconcile", 7]]),
        snapshot: normalizeHostedSnapshotFixture({
          connections: [
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-03-26T12:00:00.000Z",
                createdAt: "2026-03-26T12:00:00.000Z",
                displayName: "Alice Oura",
                externalAccountId: "oura_alice",
                id: "hosted_regressed_next_reconcile",
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: "2026-03-27T08:30:00.000Z",
                lastSyncErrorAt: null,
                lastSyncStartedAt: "2026-03-27T08:20:00.000Z",
                lastWebhookAt: "2026-03-27T08:00:00.000Z",
                metadata: {
                  source: "hosted",
                },
                nextReconcileAt: "2026-03-27T18:00:00.000Z",
                provider: "oura",
                scopes: ["heartrate"],
                status: "active",
                updatedAt: "2026-03-27T08:25:00.000Z",
              },
              tokenBundle: {
                accessToken: "access",
                accessTokenExpiresAt: null,
                keyVersion: "v1",
                refreshToken: null,
                tokenVersion: 7,
              },
            },
          ],
          generatedAt: "2026-03-27T08:35:00.000Z",
          userId: "user-123",
        }),
      },
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(mocks.applyHostedDeviceSyncRuntimeUpdates).toHaveBeenCalledWith(expect.objectContaining({
      updates: [],
    }));
  });

  it("reconciles only forward-moving timestamps and clears stale hosted errors even outside active status", async () => {
    const { reconcileHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    const { createSecretCodec } = await import("@murphai/device-syncd/crypto");
    const codec = createSecretCodec("secret-for-tests");
    const service = {
      store: {
        getAccountById: vi.fn(() => ({
          accessTokenEncrypted: codec.encrypt("access"),
          accessTokenExpiresAt: null,
          connectedAt: "2026-03-26T12:00:00.000Z",
          createdAt: "2026-03-26T12:00:00.000Z",
          disconnectGeneration: 0,
          displayName: "Alice Oura",
          externalAccountId: "oura_alice",
          hostedObservedTokenVersion: null,
          hostedObservedUpdatedAt: "2026-03-27T08:25:00.000Z",
          id: "local_123",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-03-27T08:30:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-03-27T08:20:00.000Z",
          lastWebhookAt: "2026-03-27T08:00:00.000Z",
          metadata: {
            source: "hosted",
          },
          nextReconcileAt: "2026-03-28T00:00:00.000Z",
          provider: "oura",
          refreshTokenEncrypted: codec.encrypt("refresh"),
          scopes: ["heartrate"],
          status: "reauthorization_required",
          updatedAt: "2026-03-27T08:30:00.000Z",
        })),
      },
    };

    await reconcileHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_123",
        occurredAt: "2026-03-27T08:35:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      state: {
        hostedToLocalAccountIds: new Map([["hosted_123", "local_123"]]),
        localToHostedAccountIds: new Map([["local_123", "hosted_123"]]),
        observedTokenVersions: new Map([["hosted_123", null]]),
        snapshot: normalizeHostedSnapshotFixture({
          connections: [
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-03-26T12:00:00.000Z",
                createdAt: "2026-03-26T12:00:00.000Z",
                displayName: "Alice Oura",
                externalAccountId: "oura_alice",
                id: "hosted_123",
                lastErrorCode: "STALE",
                lastErrorMessage: "stale hosted error",
                lastSyncCompletedAt: "2026-03-27T08:10:00.000Z",
                lastSyncErrorAt: "2026-03-27T08:05:00.000Z",
                lastSyncStartedAt: "2026-03-27T08:15:00.000Z",
                lastWebhookAt: "2026-03-27T08:25:00.000Z",
                metadata: {
                  source: "hosted",
                },
                nextReconcileAt: "2026-03-28T00:00:00.000Z",
                provider: "oura",
                scopes: ["heartrate"],
                status: "reauthorization_required",
                updatedAt: "2026-03-27T08:25:00.000Z",
              },
              tokenBundle: null,
            },
          ],
          generatedAt: "2026-03-27T08:35:00.000Z",
          userId: "user-123",
        }),
      },
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(mocks.applyHostedDeviceSyncRuntimeUpdates).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "https://control.example.test",
      signingSecret: null,
      occurredAt: "2026-03-27T08:35:00.000Z",
      timeoutMs: null,
      updates: [
        expect.objectContaining({
          connectionId: "hosted_123",
          localState: expect.objectContaining({
            clearError: true,
            lastSyncCompletedAt: "2026-03-27T08:30:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-03-27T08:20:00.000Z",
          }),
          observedUpdatedAt: "2026-03-27T08:25:00.000Z",
          observedTokenVersion: null,
          tokenBundle: expect.objectContaining({
            accessToken: "access",
            refreshToken: "refresh",
            tokenVersion: 1,
          }),
        }),
      ],
      userId: "user-123",
    }));
    const applyInput = mocks.applyHostedDeviceSyncRuntimeUpdates.mock.calls[0]?.[0] as {
      updates: Array<Record<string, unknown>>;
    };
    expect(applyInput?.updates[0]).not.toHaveProperty("lastWebhookAt");
  });

  it("clears stale hosted errors when a disconnected local mirror no longer has an error", async () => {
    const { reconcileHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    const service = {
      store: {
        getAccountById: vi.fn(() => ({
          accessTokenEncrypted: "",
          accessTokenExpiresAt: null,
          connectedAt: "2026-03-26T12:00:00.000Z",
          createdAt: "2026-03-26T12:00:00.000Z",
          disconnectGeneration: 1,
          displayName: "Alice Oura",
          externalAccountId: "oura_alice",
          hostedObservedTokenVersion: null,
          hostedObservedUpdatedAt: "2026-03-27T08:25:00.000Z",
          id: "local_321",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-03-27T08:30:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-03-27T08:20:00.000Z",
          lastWebhookAt: "2026-03-27T08:00:00.000Z",
          metadata: {
            source: "hosted",
          },
          nextReconcileAt: null,
          provider: "oura",
          refreshTokenEncrypted: null,
          scopes: ["heartrate"],
          status: "disconnected",
          updatedAt: "2026-03-27T08:30:00.000Z",
        })),
      },
    };

    await reconcileHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_321",
        occurredAt: "2026-03-27T08:35:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      state: {
        hostedToLocalAccountIds: new Map([["hosted_321", "local_321"]]),
        localToHostedAccountIds: new Map([["local_321", "hosted_321"]]),
        observedTokenVersions: new Map([["hosted_321", null]]),
        snapshot: normalizeHostedSnapshotFixture({
          connections: [
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-03-26T12:00:00.000Z",
                createdAt: "2026-03-26T12:00:00.000Z",
                displayName: "Alice Oura",
                externalAccountId: "oura_alice",
                id: "hosted_321",
                lastErrorCode: "STALE",
                lastErrorMessage: "stale hosted error",
                lastSyncCompletedAt: "2026-03-27T08:10:00.000Z",
                lastSyncErrorAt: "2026-03-27T08:05:00.000Z",
                lastSyncStartedAt: "2026-03-27T08:15:00.000Z",
                lastWebhookAt: "2026-03-27T08:25:00.000Z",
                metadata: {
                  source: "hosted",
                },
                nextReconcileAt: null,
                provider: "oura",
                scopes: ["heartrate"],
                status: "disconnected",
                updatedAt: "2026-03-27T08:25:00.000Z",
              },
              tokenBundle: null,
            },
          ],
          generatedAt: "2026-03-27T08:35:00.000Z",
          userId: "user-123",
        }),
      },
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(mocks.applyHostedDeviceSyncRuntimeUpdates).toHaveBeenCalledWith(expect.objectContaining({
      updates: [
        expect.objectContaining({
          connectionId: "hosted_321",
          localState: expect.objectContaining({
            clearError: true,
            lastSyncErrorAt: null,
          }),
        }),
      ],
    }));
    const applyInput = mocks.applyHostedDeviceSyncRuntimeUpdates.mock.calls[0]?.[0] as {
      updates: Array<Record<string, unknown>>;
    };
    expect(applyInput?.updates[0]).not.toHaveProperty("lastErrorCode");
    expect(applyInput?.updates[0]).not.toHaveProperty("lastErrorMessage");
  });

  it("forwards a custom fetch implementation into hosted device-sync apply calls", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const service = {
      store: {
        getAccountById: vi.fn(() => ({
          accessTokenEncrypted: "",
          accessTokenExpiresAt: null,
          connectedAt: "2026-03-26T12:00:00.000Z",
          createdAt: "2026-03-26T12:00:00.000Z",
          disconnectGeneration: 1,
          displayName: "Alice Oura",
          externalAccountId: "oura_alice",
          hostedObservedTokenVersion: null,
          hostedObservedUpdatedAt: "2026-03-27T08:25:00.000Z",
          id: "local_fetch_impl",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-03-27T08:30:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-03-27T08:20:00.000Z",
          lastWebhookAt: "2026-03-27T08:00:00.000Z",
          metadata: {
            source: "hosted",
          },
          nextReconcileAt: null,
          provider: "oura",
          refreshTokenEncrypted: null,
          scopes: ["heartrate"],
          status: "disconnected",
          updatedAt: "2026-03-27T08:30:00.000Z",
        })),
      },
    };

    const { reconcileHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await reconcileHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_forward_apply_fetch",
        occurredAt: "2026-03-27T08:35:00.000Z",
      },
      fetchImpl: fetchImpl as typeof fetch,
      secret: "secret-for-tests",
      service: service as never,
      state: {
        hostedToLocalAccountIds: new Map([["hosted_fetch_impl", "local_fetch_impl"]]),
        localToHostedAccountIds: new Map([["local_fetch_impl", "hosted_fetch_impl"]]),
        observedTokenVersions: new Map([["hosted_fetch_impl", null]]),
        snapshot: normalizeHostedSnapshotFixture({
          connections: [
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-03-26T12:00:00.000Z",
                createdAt: "2026-03-26T12:00:00.000Z",
                displayName: "Alice Oura",
                externalAccountId: "oura_alice",
                id: "hosted_fetch_impl",
                lastErrorCode: "STALE",
                lastErrorMessage: "stale hosted error",
                lastSyncCompletedAt: "2026-03-27T08:10:00.000Z",
                lastSyncErrorAt: "2026-03-27T08:05:00.000Z",
                lastSyncStartedAt: "2026-03-27T08:15:00.000Z",
                lastWebhookAt: "2026-03-27T08:25:00.000Z",
                metadata: {
                  source: "hosted",
                },
                nextReconcileAt: null,
                provider: "oura",
                scopes: ["heartrate"],
                status: "disconnected",
                updatedAt: "2026-03-27T08:25:00.000Z",
              },
              tokenBundle: null,
            },
          ],
          generatedAt: "2026-03-27T08:35:00.000Z",
          userId: "user-123",
        }),
      },
      timeoutMs: 7_000,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "http://device-sync.worker",
        signingSecret: null,
      },
    });

    expect(mocks.applyHostedDeviceSyncRuntimeUpdates).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "http://device-sync.worker",
      fetchImpl,
      signingSecret: null,
      occurredAt: "2026-03-27T08:35:00.000Z",
      timeoutMs: 7_000,
      userId: "user-123",
    }));
  });

  it("clears only the stale disconnected hosted error field that the local mirror removed", async () => {
    const { reconcileHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    const service = {
      store: {
        getAccountById: vi.fn(() => ({
          accessTokenEncrypted: "",
          accessTokenExpiresAt: null,
          connectedAt: "2026-03-26T12:00:00.000Z",
          createdAt: "2026-03-26T12:00:00.000Z",
          disconnectGeneration: 1,
          displayName: "Alice Oura",
          externalAccountId: "oura_alice",
          hostedObservedTokenVersion: null,
          hostedObservedUpdatedAt: "2026-03-27T08:25:00.000Z",
          id: "local_654",
          lastErrorCode: null,
          lastErrorMessage: "fresh local message",
          lastSyncCompletedAt: "2026-03-27T08:30:00.000Z",
          lastSyncErrorAt: "2026-03-27T08:20:00.000Z",
          lastSyncStartedAt: "2026-03-27T08:20:00.000Z",
          lastWebhookAt: "2026-03-27T08:00:00.000Z",
          metadata: {
            source: "hosted",
          },
          nextReconcileAt: null,
          provider: "oura",
          refreshTokenEncrypted: null,
          scopes: ["heartrate"],
          status: "disconnected",
          updatedAt: "2026-03-27T08:30:00.000Z",
        })),
      },
    };

    await reconcileHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-123",
        },
        eventId: "evt_654",
        occurredAt: "2026-03-27T08:35:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      state: {
        hostedToLocalAccountIds: new Map([["hosted_654", "local_654"]]),
        localToHostedAccountIds: new Map([["local_654", "hosted_654"]]),
        observedTokenVersions: new Map([["hosted_654", null]]),
        snapshot: normalizeHostedSnapshotFixture({
          connections: [
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-03-26T12:00:00.000Z",
                createdAt: "2026-03-26T12:00:00.000Z",
                displayName: "Alice Oura",
                externalAccountId: "oura_alice",
                id: "hosted_654",
                lastErrorCode: "STALE",
                lastErrorMessage: "fresh local message",
                lastSyncCompletedAt: "2026-03-27T08:10:00.000Z",
                lastSyncErrorAt: "2026-03-27T08:05:00.000Z",
                lastSyncStartedAt: "2026-03-27T08:15:00.000Z",
                lastWebhookAt: "2026-03-27T08:25:00.000Z",
                metadata: {
                  source: "hosted",
                },
                nextReconcileAt: null,
                provider: "oura",
                scopes: ["heartrate"],
                status: "disconnected",
                updatedAt: "2026-03-27T08:25:00.000Z",
              },
              tokenBundle: null,
            },
          ],
          generatedAt: "2026-03-27T08:35:00.000Z",
          userId: "user-123",
        }),
      },
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        signingSecret: "internal-token",
      },
    });

    expect(mocks.applyHostedDeviceSyncRuntimeUpdates).toHaveBeenCalledWith(expect.objectContaining({
      updates: [
        expect.objectContaining({
          connectionId: "hosted_654",
          localState: expect.objectContaining({
            lastErrorCode: null,
          }),
        }),
      ],
    }));
    const applyInput = mocks.applyHostedDeviceSyncRuntimeUpdates.mock.calls[0]?.[0] as {
      updates: Array<Record<string, unknown>>;
    };
    expect(applyInput?.updates[0]).not.toHaveProperty("clearError");
    expect(applyInput?.updates[0]).not.toHaveProperty("lastErrorMessage");
  });
});
