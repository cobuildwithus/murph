import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyHostedDeviceSyncRuntimeUpdates: vi.fn(async () => undefined),
  fetchHostedDeviceSyncRuntimeSnapshot: vi.fn(async () => null),
}));

vi.mock("../src/hosted-device-sync-control-plane.ts", () => ({
  applyHostedDeviceSyncRuntimeUpdates: mocks.applyHostedDeviceSyncRuntimeUpdates,
  fetchHostedDeviceSyncRuntimeSnapshot: mocks.fetchHostedDeviceSyncRuntimeSnapshot,
  normalizeHostedDeviceSyncJobHints: vi.fn(() => []),
  resolveHostedDeviceSyncWakeContext: vi.fn(() => ({
    connectionId: null,
    hint: null,
    provider: null,
  })),
}));

describe("hosted device-sync runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates hosted control-plane snapshots through the store-owned hosted primitive and clears local tokens on disconnect", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue({
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
    });

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
        internalToken: "internal-token",
      },
    });

    expect(hydrateHostedAccount).toHaveBeenCalledWith(expect.objectContaining({
      connectedAt: "2026-03-26T12:00:00.000Z",
      displayName: "Alice Oura",
      externalAccountId: "oura_alice",
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: "2026-03-27T08:00:00.000Z",
      lastSyncStartedAt: "2026-03-27T07:55:00.000Z",
      lastWebhookAt: "2026-03-27T07:50:00.000Z",
      metadata: {
        source: "hosted",
      },
      nextReconcileAt: null,
      provider: "oura",
      scopes: ["heartrate"],
      status: "disconnected",
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

  it("preserves fresher local tokens and nextReconcileAt when the hosted snapshot has not advanced", async () => {
    mocks.fetchHostedDeviceSyncRuntimeSnapshot.mockResolvedValue({
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
    });

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
        internalToken: "internal-token",
      },
    });

    expect(hydrateHostedAccount).toHaveBeenCalledWith(expect.objectContaining({
      displayName: "Local Whoop",
      externalAccountId: "whoop-user-1",
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "2026-03-27T08:00:00.000Z",
      metadata: {
        source: "local",
      },
      nextReconcileAt: "2026-03-27T18:00:00.000Z",
      provider: "whoop",
      scopes: ["offline"],
      status: "active",
    }));
    const hydrateInput = hydrateHostedAccount.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(hydrateInput).not.toHaveProperty("tokens");
  });

  it("reconciles only forward-moving timestamps and clears stale hosted errors even outside active status", async () => {
    const { reconcileHostedDeviceSyncControlPlaneState } = await import("../src/hosted-device-sync-runtime.ts");
    const { createSecretCodec } = await import("@murph/device-syncd");
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
        snapshot: {
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
        },
      },
      timeoutMs: null,
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: "https://control.example.test",
        internalToken: "internal-token",
      },
    });

    expect(mocks.applyHostedDeviceSyncRuntimeUpdates).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "https://control.example.test",
      internalToken: "internal-token",
      occurredAt: "2026-03-27T08:35:00.000Z",
      timeoutMs: null,
      updates: [
        expect.objectContaining({
          accessTokenExpiresAt: null,
          clearError: true,
          connectionId: "hosted_123",
          lastSyncCompletedAt: "2026-03-27T08:30:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-03-27T08:20:00.000Z",
          observedTokenVersion: null,
          tokenBundle: expect.objectContaining({
            accessToken: "access",
            refreshToken: "refresh",
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
});
