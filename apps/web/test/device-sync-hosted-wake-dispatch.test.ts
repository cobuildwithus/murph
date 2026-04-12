import { DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES } from "@murphai/device-syncd/public-ingress";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyDeviceSyncRuntimeUpdates: vi.fn(),
  completeWebhookTrace: vi.fn(),
  createDeviceSyncPublicIngress: vi.fn(),
  createSignal: vi.fn(),
  drainHostedExecutionOutboxBestEffort: vi.fn(),
  ensureWebhookSubscriptions: vi.fn(),
  enqueueHostedExecutionOutbox: vi.fn(),
  getConnectionForUser: vi.fn(),
  getRuntimeConnectionForUser: vi.fn(),
  getConnectionOwnerId: vi.fn(),
  getDeviceSyncRuntimeSnapshot: vi.fn(),
  listConnectionsForUser: vi.fn(),
  listRuntimeConnectionsForUser: vi.fn(),
  readHostedDeviceSyncEnvironment: vi.fn(),
  registryGet: vi.fn(),
  registryList: vi.fn(),
  syncDurableConnectionState: vi.fn(),
  prismaTx: {
    __tx: true,
    deviceSyncSignal: {
      create: vi.fn(),
    },
  },
  prisma: {
    $transaction: vi.fn(),
  },
}));

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

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  drainHostedExecutionOutboxBestEffort: mocks.drainHostedExecutionOutboxBestEffort,
  enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
}));

vi.mock("@/src/lib/device-sync/runtime-client", () => ({
  requireHostedDeviceSyncRuntimeClient: vi.fn(() => ({
    applyDeviceSyncRuntimeUpdates: mocks.applyDeviceSyncRuntimeUpdates,
    getDeviceSyncRuntimeSnapshot: mocks.getDeviceSyncRuntimeSnapshot,
  })),
}));

vi.mock("@/src/lib/device-sync/auth", () => ({
  assertBrowserMutationOrigin: vi.fn(),
  requireAuthenticatedHostedUser: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/crypto", () => ({
  createHostedSecretCodec: vi.fn(() => ({
    decrypt: vi.fn(),
    encrypt: vi.fn(),
    keyVersion: "v1",
  })),
}));

vi.mock("@/src/lib/device-sync/env", () => ({
  readHostedDeviceSyncEnvironment: mocks.readHostedDeviceSyncEnvironment.mockImplementation(() => ({
    allowedReturnOrigins: [],
    encryptionKey: "01234567890123456789012345678901",
    encryptionKeyVersion: "v1",
    isProduction: false,
    ouraWebhookVerificationToken: "verify-token-for-tests",
    publicBaseUrl: "https://control.example.test/api/device-sync",
    providers: {
      whoop: null,
      oura: {
        clientId: "oura-client-id",
        clientSecret: "oura-client-secret",
      },
    },
  })),
}));

function createHostedEnv(overrides: Partial<{
  allowedReturnOrigins: string[];
  encryptionKey: string;
  encryptionKeyVersion: string;
  isProduction: boolean;
  ouraWebhookVerificationToken: string | null;
  publicBaseUrl: string | null;
  providers: {
    whoop: null;
    oura: {
      clientId: string;
      clientSecret: string;
    } | null;
  };
}> = {}) {
  return {
    allowedReturnOrigins: [],
    encryptionKey: "01234567890123456789012345678901",
    encryptionKeyVersion: "v1",
    isProduction: false,
    ouraWebhookVerificationToken: "verify-token-for-tests",
    publicBaseUrl: "https://control.example.test/api/device-sync",
    providers: {
      whoop: null,
      oura: {
        clientId: "oura-client-id",
        clientSecret: "oura-client-secret",
      },
    },
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
    status: "active" as const,
    updatedAt: "2026-03-26T12:00:00.000Z",
    ...overrides,
  };
}

function buildBrowserConnection(
  overrides: Parameters<typeof buildHostedConnection>[0] = {},
): Omit<ReturnType<typeof buildHostedConnection>, "externalAccountId"> {
  const connection = Object.fromEntries(
    Object.entries(buildHostedConnection(overrides)).filter(([key]) => key !== "externalAccountId"),
  );

  return connection as Omit<ReturnType<typeof buildHostedConnection>, "externalAccountId">;
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
    getRuntimeConnectionForUser = mocks.getRuntimeConnectionForUser;
    getConnectionOwnerId = mocks.getConnectionOwnerId;
    listConnectionsForUser = mocks.listConnectionsForUser;
    listRuntimeConnectionsForUser = mocks.listRuntimeConnectionsForUser;
    syncDurableConnectionState = mocks.syncDurableConnectionState;
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
  sha256Hex: vi.fn(),
  toIsoTimestamp: vi.fn(() => "2026-03-26T12:00:00.000Z"),
  toJsonRecord: vi.fn((value: unknown) => value),
}));

import {
  HostedDeviceSyncControlPlane,
  dispatchHostedDeviceSyncWake,
} from "@/src/lib/device-sync/control-plane";

describe("dispatchHostedDeviceSyncWake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedDeviceSyncEnvironment.mockImplementation(() => createHostedEnv());
    mocks.getDeviceSyncRuntimeSnapshot.mockResolvedValue({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Oura",
            externalAccountId: "acct_sensitive",
            id: "dsc_123",
            metadata: {},
            provider: "oura",
            scopes: ["heartrate"],
            status: "active",
            updatedAt: "2026-03-26T12:00:00.000Z",
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
          tokenBundle: {
            accessToken: "access-token",
            accessTokenExpiresAt: null,
            keyVersion: "v1",
            refreshToken: "refresh-token",
            tokenVersion: 2,
          },
        },
      ],
      generatedAt: "2026-03-26T12:00:00.000Z",
      userId: "user-123",
    });
    mocks.applyDeviceSyncRuntimeUpdates.mockResolvedValue({
      appliedAt: "2026-03-26T12:00:00.000Z",
      updates: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-03-26T12:00:00.000Z",
            createdAt: "2026-03-26T12:00:00.000Z",
            displayName: "Oura",
            externalAccountId: "acct_sensitive",
            id: "dsc_123",
            metadata: {},
            provider: "oura",
            scopes: ["heartrate"],
            status: "disconnected",
            updatedAt: "2026-03-26T12:00:00.000Z",
        },
        connectionId: "dsc_123",
        status: "updated",
        tokenUpdate: "cleared",
        writeUpdate: "applied",
      },
    ],
    userId: "user-123",
    });
    mocks.ensureWebhookSubscriptions.mockResolvedValue(undefined);
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prismaTx) => Promise<unknown>) =>
      callback(mocks.prismaTx),
    );
    mocks.createDeviceSyncPublicIngress.mockImplementation((input: {
      hooks?: {
        onConnectionEstablished?: (value: unknown) => Promise<void> | void;
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
          traceId: "trace_123",
          webhook: {
            eventType: "sleep.updated",
            jobs: [
              {
                kind: "reconcile",
                payload: {
                  windowStart: "2026-03-19T00:00:00.000Z",
                  oauthRefreshToken: "job-secret-refresh-token",
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
    mocks.completeWebhookTrace.mockResolvedValue(undefined);
    mocks.drainHostedExecutionOutboxBestEffort.mockResolvedValue(undefined);
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.getConnectionForUser.mockResolvedValue(buildHostedConnection());
    mocks.getRuntimeConnectionForUser.mockImplementation(async (...args: [string, string]) =>
      mocks.getConnectionForUser(...args));
    mocks.getConnectionOwnerId.mockResolvedValue("user-123");
    mocks.listConnectionsForUser.mockResolvedValue([]);
    mocks.listRuntimeConnectionsForUser.mockImplementation(async (...args: [string]) =>
      mocks.listConnectionsForUser(...args));
    mocks.registryGet.mockReturnValue(undefined);
    mocks.registryList.mockReturnValue([]);
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
    await dispatchHostedDeviceSyncWake({
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
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            connectionId: "dsc_123",
            hint: {
              occurredAt: "2026-03-26T12:00:00.000Z",
            },
            kind: "device-sync.wake",
            provider: "oura",
            reason: "connected",
            userId: "user-123",
          }),
          eventId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
          occurredAt: "2026-03-26T12:00:00.000Z",
        }),
        sourceId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
        sourceType: "device_sync_signal",
        storage: "reference",
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.drainHostedExecutionOutboxBestEffort).toHaveBeenCalledWith({
      eventIds: [
        "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
      ],
      limit: 1,
      prisma: mocks.prisma,
    });
  });

  it("uses the webhook trace id for a stable wake event id when one is available", async () => {
    await dispatchHostedDeviceSyncWake({
      connectionId: "dsc_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      source: "webhook-accepted",
      traceId: "trace_123",
      userId: "user-123",
    });

    expect(mocks.createSignal).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      createdAt: "2026-03-26T12:00:00.000Z",
      eventType: null,
      kind: "webhook_hint",
      nextReconcileAt: null,
      occurredAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      reason: null,
      resourceCategory: null,
      revokeWarning: null,
      traceId: "trace_123",
      tx: mocks.prismaTx,
      userId: "user-123",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            connectionId: "dsc_123",
            hint: {
              occurredAt: "2026-03-26T12:00:00.000Z",
              traceId: "trace_123",
            },
            kind: "device-sync.wake",
            provider: "oura",
            reason: "webhook_hint",
            userId: "user-123",
          }),
          eventId: "device-sync:webhook-accepted:user-123:oura:dsc_123:trace_123",
          occurredAt: "2026-03-26T12:00:00.000Z",
        }),
        sourceId: "device-sync:webhook-accepted:user-123:oura:dsc_123:trace_123",
        sourceType: "device_sync_signal",
        storage: "reference",
        tx: mocks.prismaTx,
      }),
    );
  });

  it("does not wait for the best-effort outbox drain before returning a wake dispatch", async () => {
    mocks.drainHostedExecutionOutboxBestEffort.mockReturnValue(new Promise(() => {}));

    await expect(dispatchHostedDeviceSyncWake({
      connectionId: "dsc_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      source: "connection-established",
      userId: "user-123",
    })).resolves.toEqual({
      dispatched: true,
    });

    expect(mocks.drainHostedExecutionOutboxBestEffort).toHaveBeenCalledTimes(1);
  });

  it("uses the dedicated device-sync wake path for disconnect events", async () => {
    await dispatchHostedDeviceSyncWake({
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
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            connectionId: "dsc_123",
            hint: {
              occurredAt: "2026-03-26T12:00:00.000Z",
            },
            kind: "device-sync.wake",
            provider: "oura",
            reason: "disconnected",
            userId: "user-123",
          }),
          eventId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
          occurredAt: "2026-03-26T12:00:00.000Z",
        }),
        sourceId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
        sourceType: "device_sync_signal",
        storage: "reference",
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.drainHostedExecutionOutboxBestEffort).toHaveBeenCalledWith({
      eventIds: [
        "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
      ],
      limit: 1,
      prisma: mocks.prisma,
    });
  });

  it("queues a disconnected signal and wake together inside the disconnect flow", async () => {
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
    const publicConnectionId = controlPlane.createBrowserConnectionId("dsc_123");

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
    expect(mocks.applyDeviceSyncRuntimeUpdates.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createSignal.mock.invocationCallOrder[0],
    );
    expect(mocks.createSignal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enqueueHostedExecutionOutbox.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          eventId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
        }),
        sourceId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
        sourceType: "device_sync_signal",
        tx: mocks.prismaTx,
      }),
    );
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
      revokeAccess,
    });
    mocks.listConnectionsForUser.mockResolvedValue([activeConnection]);
    mocks.getConnectionForUser
      .mockResolvedValueOnce(activeConnection)
      .mockResolvedValueOnce(disconnectedConnection);
    const publicConnectionId = controlPlane.createBrowserConnectionId("dsc_123");

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
    expect(mocks.applyDeviceSyncRuntimeUpdates).toHaveBeenCalledWith(
      "user-123",
      expect.objectContaining({
        updates: [
          expect.objectContaining({
            localState: expect.objectContaining({
              lastErrorCode: "PROVIDER_REVOKE_FAILED",
              lastErrorMessage: "authorization=[redacted] refresh_token=[redacted]",
            }),
            seed: expect.objectContaining({
              localState: expect.objectContaining({
                lastErrorCode: "PROVIDER_REVOKE_FAILED",
                lastErrorMessage: "authorization=[redacted] refresh_token=[redacted]",
              }),
            }),
          }),
        ],
      }),
    );
    expect(mocks.createSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        revokeWarning: {
          code: "PROVIDER_REVOKE_FAILED",
          message: "authorization=[redacted] refresh_token=[redacted]",
        },
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            hint: expect.objectContaining({
              revokeWarning: {
                code: "PROVIDER_REVOKE_FAILED",
                message: "authorization=[redacted] refresh_token=[redacted]",
              },
            }),
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
    mocks.getDeviceSyncRuntimeSnapshot.mockResolvedValueOnce({
      connections: [],
      generatedAt: "2026-03-26T12:00:00.000Z",
      userId: "user-123",
    });
    const publicConnectionId = controlPlane.createBrowserConnectionId("dsc_123");

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).rejects.toThrow(
      "Hosted device-sync runtime is missing provider identity for connection dsc_123.",
    );

    expect(mocks.getDeviceSyncRuntimeSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.applyDeviceSyncRuntimeUpdates).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("returns opaque browser connection ids and omits external account ids from browser reads", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync"),
    );
    mocks.listConnectionsForUser.mockResolvedValue([
      buildBrowserConnection(),
    ]);

    await expect(controlPlane.listConnections("user-123")).resolves.toEqual({
      providers: [],
      connections: [
        {
          id: controlPlane.createBrowserConnectionId("dsc_123"),
          provider: "oura",
          displayName: "Oura",
          status: "active",
          scopes: ["heartrate"],
          accessTokenExpiresAt: null,
          metadata: {},
          connectedAt: "2026-03-26T12:00:00.000Z",
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
    });
  });

  it("resolves browser status reads through the opaque browser connection id", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dspc_demo/status"),
    );
    mocks.listConnectionsForUser.mockResolvedValue([
      buildBrowserConnection(),
    ]);
    const publicConnectionId = controlPlane.createBrowserConnectionId("dsc_123");

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

    expect(mocks.getDeviceSyncRuntimeSnapshot).not.toHaveBeenCalled();
    expect(mocks.applyDeviceSyncRuntimeUpdates).toHaveBeenCalledWith(
      "user-123",
      expect.objectContaining({
        updates: [
          expect.objectContaining({
            connectionId: "dsc_123",
            tokenBundle: expect.objectContaining({
              accessToken: "access-token",
              refreshToken: "refresh-token",
              tokenVersion: 1,
            }),
          }),
        ],
      }),
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
    expect(mocks.syncDurableConnectionState).toHaveBeenCalledWith(
      expect.objectContaining({
        accessTokenExpiresAt: null,
        connectedAt: "2026-03-26T12:00:00.000Z",
        createdAt: "2026-03-26T12:00:00.000Z",
        displayName: "Oura",
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
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            connectionId: "dsc_123",
            hint: {
              jobs: [],
              nextReconcileAt: null,
              occurredAt: "2026-03-26T12:00:00.000Z",
              scopes: ["heartrate"],
            },
            kind: "device-sync.wake",
            provider: "oura",
            reason: "connected",
            userId: "user-123",
          }),
          eventId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
          occurredAt: "2026-03-26T12:00:00.000Z",
        }),
        sourceId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
        sourceType: "device_sync_signal",
        storage: "reference",
        tx: mocks.prismaTx,
      }),
    );
    expect(mocks.ensureWebhookSubscriptions).toHaveBeenCalledWith({
      publicBaseUrl: "https://control.example.test/api/device-sync",
      verificationToken: "verify-token-for-tests",
    });
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
        callbackBaseUrlSource: "configured",
        provider: "oura",
        reason: "connection-established",
        errorMessage: "sync upkeep failure",
        errorType: "Error",
      }),
    );
  });

  it("stores and dispatches only sparse webhook hints from the ingress hook", async () => {
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
    const dispatchedHint = mocks.enqueueHostedExecutionOutbox.mock.calls[0]?.[0]?.dispatch?.event?.hint;

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
    expect(JSON.stringify(signalInput ?? {})).not.toContain("job-secret-refresh-token");
    expect(dispatchedHint).toEqual({
      eventType: "sleep.updated",
      jobs: [
        {
          dedupeKey: expect.any(String),
          kind: "reconcile",
          payload: {
            windowStart: "2026-03-19T00:00:00.000Z",
          },
        },
      ],
      occurredAt: "2026-03-26T11:59:00.000Z",
      resourceCategory: "daily_sleep",
      traceId: "trace_123",
    });
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", mocks.prismaTx);
    expect(mocks.createSignal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enqueueHostedExecutionOutbox.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completeWebhookTrace.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            connectionId: "dsc_123",
            hint: {
              eventType: "sleep.updated",
              jobs: [
                {
                  dedupeKey: expect.any(String),
                  kind: "reconcile",
                  payload: {
                    windowStart: "2026-03-19T00:00:00.000Z",
                  },
                },
              ],
              occurredAt: "2026-03-26T11:59:00.000Z",
              resourceCategory: "daily_sleep",
              traceId: "trace_123",
            },
            kind: "device-sync.wake",
            provider: "oura",
            reason: "webhook_hint",
            userId: "user-123",
          }),
          eventId: "device-sync:webhook-accepted:user-123:oura:dsc_123:trace_123",
          occurredAt: "2026-03-26T12:00:00.000Z",
        }),
        sourceId: "device-sync:webhook-accepted:user-123:oura:dsc_123:trace_123",
        sourceType: "device_sync_signal",
        storage: "reference",
        tx: mocks.prismaTx,
      }),
    );
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
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("does not complete or drain a hosted webhook trace when the outbox enqueue fails", async () => {
    mocks.enqueueHostedExecutionOutbox.mockRejectedValueOnce(new Error("outbox failed"));
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

    await expect(controlPlane.handleWebhook("oura")).rejects.toThrow("outbox failed");

    expect(mocks.createSignal).toHaveBeenCalledTimes(1);
    expect(mocks.completeWebhookTrace).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("shapes hosted webhook hints by provider and job allowlists instead of key redaction", async () => {
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
    const dispatchedHint = mocks.enqueueHostedExecutionOutbox.mock.calls[0]?.[0]?.dispatch?.event?.hint;

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
    expect(dispatchedHint).toEqual({
      eventType: "sleep.updated",
      jobs: [
        {
          dedupeKey: expect.any(String),
          kind: "reconcile",
          payload: {
            windowStart: "2026-03-19T00:00:00.000Z",
          },
        },
      ],
      occurredAt: "2026-03-26T11:59:00.000Z",
      resourceCategory: null,
      traceId: "trace_case_123",
    });
  });

  it("shapes Whoop hosted webhook hints through the provider-owned allowlists", async () => {
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
    const dispatchedHint = mocks.enqueueHostedExecutionOutbox.mock.calls[0]?.[0]?.dispatch?.event?.hint;

    expect(signalJson).not.toContain("whoop-session-secret");
    expect(signalJson).not.toContain("drop-me");
    expect(signalJson).not.toContain("drop-trace");
    expect(signalInput).toEqual(expect.objectContaining({
      eventType: "workout.updated",
      occurredAt: "2026-03-26T11:59:00.000Z",
      resourceCategory: "workout",
      traceId: "trace_whoop_123",
    }));
    expect(dispatchedHint).toEqual({
      eventType: "workout.updated",
      jobs: [
        {
          dedupeKey: expect.any(String),
          kind: "resource",
          payload: {
            eventType: "workout.updated",
            occurredAt: "2026-03-26T11:58:00.000Z",
            resourceId: "workout-7",
            resourceType: "workout",
          },
        },
        {
          dedupeKey: expect.any(String),
          kind: "delete",
          payload: {
            eventType: "workout.deleted",
            occurredAt: "2026-03-26T11:59:00.000Z",
            resourceId: "workout-8",
            resourceType: "workout",
          },
        },
      ],
      occurredAt: "2026-03-26T11:59:00.000Z",
      resourceCategory: "workout",
      traceId: "trace_whoop_123",
    });
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
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("keeps delete webhook hints narrow across the hosted handoff", async () => {
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

    const dispatchedHint = mocks.enqueueHostedExecutionOutbox.mock.calls[0]?.[0]?.dispatch?.event?.hint;
    const hintJob = Array.isArray(dispatchedHint?.jobs) ? dispatchedHint.jobs[0] : null;
    const hintPayload =
      hintJob && typeof hintJob === "object" && "payload" in hintJob
        ? (hintJob.payload as Record<string, unknown>)
        : null;

    expect(hintJob).toEqual({
      dedupeKey: "oura-webhook:trace_delete_123",
      kind: "delete",
      payload: hintPayload,
    });
    expect(hintPayload).toEqual({
      dataType: "session",
      objectId: "session-42",
      occurredAt: "2026-03-26T11:59:00.000Z",
      sourceEventType: "session.deleted",
    });
    expect(hintPayload).not.toHaveProperty("windowStart");
    expect(hintPayload).not.toHaveProperty("windowEnd");
    expect(hintPayload).not.toHaveProperty("includePersonalInfo");
    expect(dispatchedHint?.traceId).toBe("trace_delete_123");
  });

  it("resolves runtime-snapshot webhook admin upkeep from active connections only once per provider", async () => {
    const ensureOuraSubscriptions = vi.fn().mockResolvedValue(undefined);
    mocks.listConnectionsForUser.mockResolvedValue([
      {
        id: "dsc_123",
        provider: "oura",
        status: "active",
      },
      {
        id: "dsc_456",
        provider: "oura",
        status: "active",
      },
      {
        id: "dsc_789",
        provider: "oura",
        status: "disconnected",
      },
      {
        id: "dsc_987",
        provider: "whoop",
        status: "active",
      },
    ]);
    mocks.registryGet.mockImplementation((provider: string) => {
      if (provider === "oura") {
        return {
          provider: "oura",
          webhookAdmin: {
            ensureSubscriptions: ensureOuraSubscriptions,
          },
        };
      }

      return {
        provider,
      };
    });
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/internal/device-sync/runtime/snapshot"),
    );

    await controlPlane.ensureHostedWebhookAdminUpkeepForRuntimeSnapshot({
      userId: "user-123",
    });

    expect(ensureOuraSubscriptions).toHaveBeenCalledTimes(1);
    expect(ensureOuraSubscriptions).toHaveBeenCalledWith({
      publicBaseUrl: "https://control.example.test/api/device-sync",
      verificationToken: "verify-token-for-tests",
    });
  });

  it("skips runtime-snapshot webhook admin upkeep when the provider filter does not match the selected connection", async () => {
    const ensureOuraSubscriptions = vi.fn().mockResolvedValue(undefined);
    mocks.getRuntimeConnectionForUser.mockResolvedValue({
      id: "dsc_123",
      provider: "oura",
      status: "active",
    });
    mocks.registryGet.mockImplementation((provider: string) => {
      if (provider === "oura") {
        return {
          provider: "oura",
          webhookAdmin: {
            ensureSubscriptions: ensureOuraSubscriptions,
          },
        };
      }

      return undefined;
    });
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/internal/device-sync/runtime/snapshot"),
    );

    await controlPlane.ensureHostedWebhookAdminUpkeepForRuntimeSnapshot({
      userId: "user-123",
      provider: "whoop",
      connectionId: "dsc_123",
    });

    expect(ensureOuraSubscriptions).not.toHaveBeenCalled();
  });

  it("uses the requested connection for runtime-snapshot webhook admin upkeep instead of scanning all connections", async () => {
    const ensureOuraSubscriptions = vi.fn().mockResolvedValue(undefined);
    mocks.getRuntimeConnectionForUser.mockResolvedValue({
      id: "dsc_123",
      provider: "oura",
      status: "active",
    });
    mocks.listRuntimeConnectionsForUser.mockResolvedValue([
      {
        id: "dsc_ignore",
        provider: "whoop",
        status: "active",
      },
    ]);
    mocks.registryGet.mockImplementation((provider: string) => {
      if (provider === "oura") {
        return {
          provider: "oura",
          webhookAdmin: {
            ensureSubscriptions: ensureOuraSubscriptions,
          },
        };
      }

      return {
        provider,
      };
    });
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/internal/device-sync/runtime/snapshot"),
    );

    await controlPlane.ensureHostedWebhookAdminUpkeepForRuntimeSnapshot({
      userId: "user-123",
      connectionId: "dsc_123",
    });

    expect(mocks.getRuntimeConnectionForUser).toHaveBeenCalledWith("user-123", "dsc_123");
    expect(mocks.listRuntimeConnectionsForUser).not.toHaveBeenCalled();
    expect(ensureOuraSubscriptions).toHaveBeenCalledTimes(1);
  });
});
