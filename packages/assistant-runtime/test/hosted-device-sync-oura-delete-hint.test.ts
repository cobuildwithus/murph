import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedDeviceSyncRuntimeSnapshot: vi.fn(async () => null),
  normalizeHostedDeviceSyncJobHints: vi.fn(() => []),
  resolveHostedDeviceSyncWakeContext: vi.fn(() => ({
    connectionId: null,
    hint: null,
    provider: null,
  })),
  resolveHostedExecutionDeviceSyncRuntimeClient: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>("@murphai/hosted-execution");
  return {
    ...actual,
    normalizeHostedDeviceSyncJobHints: mocks.normalizeHostedDeviceSyncJobHints,
    resolveHostedDeviceSyncWakeContext: mocks.resolveHostedDeviceSyncWakeContext,
    resolveHostedExecutionDeviceSyncRuntimeClient: mocks.resolveHostedExecutionDeviceSyncRuntimeClient,
  };
});

describe("hosted Oura delete wake replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue(null);
    mocks.normalizeHostedDeviceSyncJobHints.mockReturnValue([]);
    mocks.resolveHostedDeviceSyncWakeContext.mockReturnValue({
      connectionId: null,
      hint: null,
      provider: null,
    });
    mocks.resolveHostedExecutionDeviceSyncRuntimeClient.mockImplementation((input) =>
      input.baseUrl
        ? {
            applyUpdates: vi.fn(async () => undefined),
            fetchSnapshot: (request?: {
              connectionId?: string | null;
              provider?: string | null;
            }) => mocks.fetchHostedDeviceSyncRuntimeSnapshot({
              baseUrl: input.baseUrl,
              connectionId: request?.connectionId ?? null,
              fetchImpl: input.fetchImpl,
              internalToken: input.internalToken ?? null,
              provider: request?.provider ?? null,
              timeoutMs: input.timeoutMs ?? null,
              userId: input.boundUserId,
            }),
          }
        : null,
    );
  });

  it("queues the narrowed hosted delete hint payload needed by the Oura provider", async () => {
    const deleteJob = {
      dedupeKey: "oura-webhook:trace_delete_123",
      kind: "delete",
      maxAttempts: 5,
      payload: {
        dataType: "session",
        objectId: "session-42",
        occurredAt: "2026-03-27T08:03:00.000Z",
        sourceEventType: "session.deleted",
        webhookPayload: {
          data_type: "session",
          event_time: "2026-03-27T08:03:00.000Z",
          event_type: "delete",
          object_id: "session-42",
          trace_id: "trace_delete_123",
          user_id: "oura-user-1",
        },
      },
      priority: 95,
    };
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Alice Oura",
            externalAccountId: "oura_alice",
            id: "hosted_oura_delete",
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
            scopes: ["session"],
            status: "active",
            updatedAt: "2026-03-27T08:00:00.000Z",
          },
          tokenBundle: null,
        },
      ],
      generatedAt: "2026-03-27T08:05:00.000Z",
      userId: "user-123",
    });
    mocks.normalizeHostedDeviceSyncJobHints.mockReturnValue([deleteJob]);
    mocks.resolveHostedDeviceSyncWakeContext.mockReturnValue({
      connectionId: "hosted_oura_delete",
      hint: {
        jobs: [deleteJob],
      },
      provider: "oura",
    });

    const existing = {
      id: "local_oura_delete",
      provider: "oura",
      externalAccountId: "oura_alice",
      displayName: "Alice Oura",
      status: "active",
      scopes: ["session"],
      metadata: {
        source: "hosted",
      },
      connectedAt: "2026-03-26T12:00:00.000Z",
      lastWebhookAt: "2026-03-27T07:50:00.000Z",
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextReconcileAt: null,
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-27T08:00:00.000Z",
      disconnectGeneration: 0,
      accessTokenEncrypted: "enc:access",
      refreshTokenEncrypted: "enc:refresh",
    };
    const service = {
      store: {
        enqueueJob: vi.fn(),
        getAccountByExternalAccount: vi.fn(() => existing),
        getAccountById: vi.fn(() => existing),
        hydrateHostedAccount: vi.fn(() => existing),
        markPendingJobsDeadForAccount: vi.fn(),
        patchAccount: vi.fn(),
      },
    };

    const { syncHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    await syncHostedDeviceSyncControlPlaneState({
      dispatch: {
        event: {
          connectionId: "hosted_oura_delete",
          kind: "device-sync.wake",
          provider: "oura",
          reason: "webhook_hint",
          userId: "user-123",
        },
        eventId: "evt_oura_delete_hint",
        occurredAt: "2026-03-27T08:05:00.000Z",
      },
      secret: "secret-for-tests",
      service: service as never,
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        internalToken: "internal-token",
      },
    });

    expect(service.store.enqueueJob).toHaveBeenCalledWith({
      accountId: "local_oura_delete",
      availableAt: "2026-03-27T08:05:00.000Z",
      dedupeKey: "oura-webhook:trace_delete_123",
      kind: "delete",
      maxAttempts: 5,
      payload: {
        dataType: "session",
        objectId: "session-42",
        occurredAt: "2026-03-27T08:03:00.000Z",
        sourceEventType: "session.deleted",
        webhookPayload: {
          data_type: "session",
          event_time: "2026-03-27T08:03:00.000Z",
          event_type: "delete",
          object_id: "session-42",
          trace_id: "trace_delete_123",
          user_id: "oura-user-1",
        },
      },
      priority: 95,
      provider: "oura",
    });
    expect(service.store.patchAccount).not.toHaveBeenCalled();
  });
});
