import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyDeviceSyncRuntimeUpdates: vi.fn(),
  buildHostedDeviceSyncRuntimeSnapshot: vi.fn(),
  completeWebhookTrace: vi.fn(),
  createDeviceSyncPublicIngress: vi.fn(),
  createSignal: vi.fn(),
  drainHostedExecutionOutboxBestEffort: vi.fn(),
  ensureWebhookSubscriptions: vi.fn(),
  enqueueHostedExecutionOutbox: vi.fn(),
  getConnectionForUser: vi.fn(),
  getConnectionOwnerId: vi.fn(),
  getDeviceSyncRuntimeSnapshot: vi.fn(),
  listConnectionsForUser: vi.fn(),
  markConnectionDisconnected: vi.fn(),
  putDeviceSyncRuntimeSnapshot: vi.fn(),
  readHostedDeviceSyncEnvironment: vi.fn(),
  registryGet: vi.fn(),
  registryList: vi.fn(),
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
    deviceSyncError: vi.fn((input: { message: string }) => new Error(input.message)),
    isDeviceSyncError: vi.fn(() => false),
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => mocks.prisma),
}));

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  drainHostedExecutionOutboxBestEffort: mocks.drainHostedExecutionOutboxBestEffort,
  enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  requireHostedExecutionControlClient: vi.fn(() => ({
    applyDeviceSyncRuntimeUpdates: mocks.applyDeviceSyncRuntimeUpdates,
    getDeviceSyncRuntimeSnapshot: mocks.getDeviceSyncRuntimeSnapshot,
    putDeviceSyncRuntimeSnapshot: mocks.putDeviceSyncRuntimeSnapshot,
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

vi.mock("@/src/lib/device-sync/internal-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/device-sync/internal-runtime")>(
    "@/src/lib/device-sync/internal-runtime",
  );
  return {
    ...actual,
    buildHostedDeviceSyncRuntimeSnapshot: mocks.buildHostedDeviceSyncRuntimeSnapshot,
  };
});

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
    listConnectionsForUser = mocks.listConnectionsForUser;
    markConnectionDisconnected = mocks.markConnectionDisconnected;
    prisma = mocks.prisma;
  },
  generateHostedAgentBearerToken: vi.fn(),
  hostedConnectionWithSecretArgs: {},
  mapHostedInternalAccountRecord: vi.fn(),
  mapHostedPublicAccountRecord: vi.fn(),
  requireHostedConnectionBundleRecord: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/shared", () => ({
  parseInteger: vi.fn(),
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
    mocks.buildHostedDeviceSyncRuntimeSnapshot.mockResolvedValue({
      connections: [],
      generatedAt: "2026-03-26T12:00:00.000Z",
      userId: "user-123",
    });
    mocks.putDeviceSyncRuntimeSnapshot.mockResolvedValue({
      connections: [],
      generatedAt: "2026-03-26T12:00:00.000Z",
      userId: "user-123",
    });
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
            payload: {
              dataType: "daily_sleep",
              access_token: "provider-secret-token",
              nested: {
                ssn: "123-45-6789",
              },
              objectId: "daily-sleep-1",
            },
            traceId: "trace_123",
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
    mocks.getConnectionForUser.mockResolvedValue({
      id: "dsc_123",
      provider: "oura",
    });
    mocks.getConnectionOwnerId.mockResolvedValue("user-123");
    mocks.listConnectionsForUser.mockResolvedValue([]);
    mocks.markConnectionDisconnected.mockResolvedValue({
      id: "dsc_123",
      provider: "oura",
    });
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

    expect(mocks.prismaTx.deviceSyncSignal.create).toHaveBeenCalledWith({
      data: {
        connectionId: "dsc_123",
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        kind: "connected",
        payloadJson: {
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
        provider: "oura",
        userId: "user-123",
      },
    });
    expect(mocks.buildHostedDeviceSyncRuntimeSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      {
        connectionId: "dsc_123",
        provider: "oura",
        userId: "user-123",
      },
    );
    expect(mocks.putDeviceSyncRuntimeSnapshot).toHaveBeenCalledWith(
      "user-123",
      {
        connections: [],
        generatedAt: "2026-03-26T12:00:00.000Z",
        userId: "user-123",
      },
    );
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
            runtimeSnapshot: {
              connections: [],
              generatedAt: "2026-03-26T12:00:00.000Z",
              userId: "user-123",
            },
            userId: "user-123",
          }),
          eventId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
          occurredAt: "2026-03-26T12:00:00.000Z",
        }),
        sourceId: "8",
        sourceType: "device_sync_signal",
        storage: "reference",
        tx: mocks.prisma,
      }),
    );
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
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

    expect(mocks.prismaTx.deviceSyncSignal.create).toHaveBeenCalledWith({
      data: {
        connectionId: "dsc_123",
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        kind: "webhook_hint",
        payloadJson: {
          occurredAt: "2026-03-26T12:00:00.000Z",
          traceId: "trace_123",
        },
        provider: "oura",
        userId: "user-123",
      },
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
        sourceId: "8",
        sourceType: "device_sync_signal",
        storage: "reference",
      }),
    );
  });

  it("uses the dedicated device-sync wake path for disconnect events", async () => {
    await dispatchHostedDeviceSyncWake({
      connectionId: "dsc_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      provider: "oura",
      source: "disconnect",
      userId: "user-123",
    });

    expect(mocks.prismaTx.deviceSyncSignal.create).toHaveBeenCalledWith({
      data: {
        connectionId: "dsc_123",
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        kind: "disconnected",
        payloadJson: {
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
        provider: "oura",
        userId: "user-123",
      },
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
        sourceId: "8",
        sourceType: "device_sync_signal",
        storage: "reference",
      }),
    );
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("queues a disconnected signal and wake together inside the disconnect flow", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    mocks.listConnectionsForUser.mockResolvedValue([
      {
        id: "dsc_123",
        provider: "oura",
        externalAccountId: "acct_sensitive",
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
    ]);
    const publicConnectionId = controlPlane.createBrowserConnectionId("dsc_123");

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).resolves.toEqual({
      connection: {
        id: publicConnectionId,
        provider: "oura",
      },
    });
    expect(mocks.createSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "dsc_123",
        createdAt: "2026-03-26T12:00:00.000Z",
        kind: "disconnected",
        payload: {
          reason: "user_disconnect",
        },
        provider: "oura",
        tx: mocks.prismaTx,
        userId: "user-123",
      }),
    );
    expect(mocks.markConnectionDisconnected).toHaveBeenCalledWith({
      connectionId: "dsc_123",
      errorCode: null,
      errorMessage: null,
      now: "2026-03-26T12:00:00.000Z",
      tx: mocks.prismaTx,
      userId: "user-123",
    });
    expect(mocks.markConnectionDisconnected.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createSignal.mock.invocationCallOrder[0],
    );
    expect(mocks.createSignal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.applyDeviceSyncRuntimeUpdates.mock.invocationCallOrder[0],
    );
    expect(mocks.applyDeviceSyncRuntimeUpdates.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.putDeviceSyncRuntimeSnapshot.mock.invocationCallOrder[0],
    );
    expect(mocks.putDeviceSyncRuntimeSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enqueueHostedExecutionOutbox.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          eventId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
        }),
        sourceId: "8",
        sourceType: "device_sync_signal",
        tx: mocks.prisma,
      }),
    );
  });

  it("retries the Cloudflare disconnect clear when the first runtime write loses a version race", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync/connections/dsc_123/disconnect"),
    );
    mocks.listConnectionsForUser.mockResolvedValue([
      {
        id: "dsc_123",
        provider: "oura",
        externalAccountId: "acct_sensitive",
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
    ]);
    mocks.getDeviceSyncRuntimeSnapshot
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
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
              updatedAt: "2026-03-26T12:05:00.000Z",
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
              accessToken: "access-token-2",
              accessTokenExpiresAt: null,
              keyVersion: "v1",
              refreshToken: "refresh-token-2",
              tokenVersion: 3,
            },
          },
        ],
        generatedAt: "2026-03-26T12:05:00.000Z",
        userId: "user-123",
      });
    mocks.applyDeviceSyncRuntimeUpdates
      .mockResolvedValueOnce({
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
              status: "active",
              updatedAt: "2026-03-26T12:05:00.000Z",
            },
            connectionId: "dsc_123",
            status: "updated",
            tokenUpdate: "skipped_version_mismatch",
          },
        ],
        userId: "user-123",
      })
      .mockResolvedValueOnce({
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
          },
        ],
        userId: "user-123",
      });
    const publicConnectionId = controlPlane.createBrowserConnectionId("dsc_123");

    await expect(controlPlane.disconnectConnection("user-123", publicConnectionId)).resolves.toEqual({
      connection: {
        id: publicConnectionId,
        provider: "oura",
      },
    });

    expect(mocks.applyDeviceSyncRuntimeUpdates).toHaveBeenCalledTimes(2);
    expect(mocks.getDeviceSyncRuntimeSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
  });

  it("returns opaque browser connection ids and omits external account ids from browser reads", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/settings/device-sync"),
    );
    mocks.listConnectionsForUser.mockResolvedValue([
      {
        id: "dsc_123",
        provider: "oura",
        externalAccountId: "acct_sensitive",
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
      {
        id: "dsc_123",
        provider: "oura",
        externalAccountId: "acct_sensitive",
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

    expect(mocks.getDeviceSyncRuntimeSnapshot).toHaveBeenCalledWith(
      "user-123",
      {
        connectionId: "dsc_123",
        provider: "oura",
      },
    );
    expect(mocks.createSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "dsc_123",
        createdAt: "2026-03-26T12:00:00.000Z",
        kind: "connected",
        payload: {
          jobs: [],
          nextReconcileAt: null,
          occurredAt: "2026-03-26T12:00:00.000Z",
          scopes: ["heartrate"],
        },
        provider: "oura",
        tx: mocks.prismaTx,
        userId: "user-123",
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
        sourceId: "8",
        sourceType: "device_sync_signal",
        storage: "reference",
        tx: mocks.prisma,
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

    expect(mocks.createSignal).toHaveBeenCalledWith(
      {
        connectionId: "dsc_123",
        kind: "webhook_hint",
        payload: {
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
        userId: "user-123",
        provider: "oura",
        createdAt: "2026-03-26T12:00:00.000Z",
        tx: mocks.prismaTx,
      },
    );
    expect(JSON.stringify(signalInput?.payload ?? {})).not.toContain("provider-secret-token");
    expect(JSON.stringify(signalInput?.payload ?? {})).not.toContain("123-45-6789");
    expect(JSON.stringify(signalInput?.payload ?? {})).not.toContain("job-secret-refresh-token");
    expect(mocks.putDeviceSyncRuntimeSnapshot).toHaveBeenCalledWith(
      "user-123",
      {
        connections: [],
        generatedAt: "2026-03-26T12:00:00.000Z",
        userId: "user-123",
      },
    );
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123");
    expect(mocks.createSignal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.putDeviceSyncRuntimeSnapshot.mock.invocationCallOrder[0],
    );
    expect(mocks.putDeviceSyncRuntimeSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
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
        sourceId: "8",
        sourceType: "device_sync_signal",
        storage: "reference",
        tx: mocks.prisma,
      }),
    );
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
            traceId: "trace_case_123",
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
    const signalJson = JSON.stringify(signalInput?.payload ?? {});

    expect(signalJson).not.toContain("provider-secret-token");
    expect(signalJson).not.toContain("job-auth-secret");
    expect(signalJson).not.toContain("job-client-secret");
    expect(signalJson).not.toContain("provider-api-key");
    expect(signalJson).not.toContain("session-secret-token");
    expect(signalJson).not.toContain("provider-verification-token");
    expect(signalJson).not.toContain("job-next-page-token");
    expect(signalJson).not.toContain("array-secret-token");
    expect(signalInput?.payload).toEqual({
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
            payload: {
              resourceType: "workout",
            },
            traceId: "trace_whoop_123",
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
    const signalJson = JSON.stringify(signalInput?.payload ?? {});

    expect(signalJson).not.toContain("whoop-session-secret");
    expect(signalJson).not.toContain("drop-me");
    expect(signalJson).not.toContain("drop-trace");
    expect(signalInput?.payload).toEqual({
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

  it("skips signal creation and wake dispatch when ingress hooks cannot resolve an owner", async () => {
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

    await controlPlane.handleWebhook("oura");

    expect(consoleWarn).toHaveBeenCalledWith(
      "Closing hosted device-sync webhook trace without an owner mapping.",
      expect.objectContaining({
        connectionId: "dsc_123",
        provider: "oura",
        traceId: "trace_123",
      }),
    );
    expect(mocks.completeWebhookTrace).toHaveBeenCalledTimes(1);
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", mocks.prismaTx);
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
      payload: {
        dataType: "session",
        operation: "delete",
      },
      traceId: "trace_delete_123",
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

    const signalInput = mocks.createSignal.mock.calls[0]?.[0];
    const hintJob = Array.isArray(signalInput?.payload?.jobs) ? signalInput.payload.jobs[0] : null;
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
      webhookPayload: {
        data_type: "session",
        event_time: "2026-03-26T11:59:00.000Z",
        event_type: "delete",
        object_id: "session-42",
        user_id: "oura-user-1",
      },
    });
    expect(hintPayload).not.toHaveProperty("windowStart");
    expect(hintPayload).not.toHaveProperty("windowEnd");
    expect(hintPayload).not.toHaveProperty("includePersonalInfo");
    expect(signalInput?.payload?.traceId).toBe("trace_delete_123");
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
    mocks.getConnectionForUser.mockResolvedValue({
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
    mocks.getConnectionForUser.mockResolvedValue({
      id: "dsc_123",
      provider: "oura",
      status: "active",
    });
    mocks.listConnectionsForUser.mockResolvedValue([
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

    expect(mocks.getConnectionForUser).toHaveBeenCalledWith("user-123", "dsc_123");
    expect(mocks.listConnectionsForUser).not.toHaveBeenCalled();
    expect(ensureOuraSubscriptions).toHaveBeenCalledTimes(1);
  });
});
