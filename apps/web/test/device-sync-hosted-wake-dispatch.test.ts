import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeWebhookTrace: vi.fn(),
  createDeviceSyncPublicIngress: vi.fn(),
  createSignal: vi.fn(),
  drainHostedExecutionOutboxBestEffort: vi.fn(),
  ensureWebhookSubscriptions: vi.fn(),
  enqueueHostedExecutionOutbox: vi.fn(),
  getConnectionBundleForUser: vi.fn(),
  getConnectionForUser: vi.fn(),
  getConnectionOwnerId: vi.fn(),
  markConnectionDisconnected: vi.fn(),
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

vi.mock("@murph/device-syncd", () => ({
  createDeviceSyncPublicIngress: mocks.createDeviceSyncPublicIngress,
  deviceSyncError: vi.fn((input: { message: string }) => new Error(input.message)),
  isDeviceSyncError: vi.fn(() => false),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => mocks.prisma),
}));

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  drainHostedExecutionOutboxBestEffort: mocks.drainHostedExecutionOutboxBestEffort,
  enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
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
  readHostedDeviceSyncEnvironment: vi.fn(() => ({
    allowedReturnOrigins: [],
    encryptionKey: "01234567890123456789012345678901",
    encryptionKeyVersion: "v1",
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

vi.mock("@/src/lib/device-sync/providers", () => ({
  createHostedDeviceSyncRegistry: vi.fn(() => ({
    get: vi.fn(() => undefined),
    list: vi.fn(() => []),
  })),
  requireHostedDeviceSyncProvider: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/prisma-store", () => ({
  PrismaDeviceSyncControlPlaneStore: class PrismaDeviceSyncControlPlaneStore {
    completeWebhookTrace = mocks.completeWebhookTrace;
    createSignal = mocks.createSignal;
    getConnectionBundleForUser = mocks.getConnectionBundleForUser;
    getConnectionForUser = mocks.getConnectionForUser;
    getConnectionOwnerId = mocks.getConnectionOwnerId;
    markConnectionDisconnected = mocks.markConnectionDisconnected;
    prisma = mocks.prisma;
  },
  generateHostedAgentBearerToken: vi.fn(),
  hostedConnectionWithSecretArgs: {},
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
            id: "dsc_123",
            provider: "oura",
            scopes: ["heartrate"],
          },
          connection: {
            initialJobs: [],
            nextReconcileAt: null,
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
    mocks.getConnectionBundleForUser.mockResolvedValue(null);
    mocks.getConnectionForUser.mockResolvedValue({
      id: "dsc_123",
      provider: "oura",
    });
    mocks.getConnectionOwnerId.mockResolvedValue("user-123");
    mocks.markConnectionDisconnected.mockResolvedValue({
      id: "dsc_123",
      provider: "oura",
    });
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
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      {
        dispatch: {
          event: {
            connectionId: "dsc_123",
            hint: {
              occurredAt: "2026-03-26T12:00:00.000Z",
            },
            kind: "device-sync.wake",
            provider: "oura",
            reason: "connected",
            userId: "user-123",
          },
          eventId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
        sourceId: "8",
        sourceType: "device_sync_signal",
        tx: mocks.prismaTx,
      },
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
          event: {
            connectionId: "dsc_123",
            hint: {
              occurredAt: "2026-03-26T12:00:00.000Z",
              traceId: "trace_123",
            },
            kind: "device-sync.wake",
            provider: "oura",
            reason: "webhook_hint",
            userId: "user-123",
          },
          eventId: "device-sync:webhook-accepted:user-123:oura:dsc_123:trace_123",
        }),
        sourceId: "8",
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
        dispatch: {
          event: {
            connectionId: "dsc_123",
            hint: {
              occurredAt: "2026-03-26T12:00:00.000Z",
            },
            kind: "device-sync.wake",
            provider: "oura",
            reason: "disconnected",
            userId: "user-123",
          },
          eventId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
        sourceId: "8",
      }),
    );
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("queues a disconnected signal and wake together inside the disconnect flow", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/connections/dsc_123/disconnect"),
    );

    await expect(controlPlane.disconnectConnection("user-123", "dsc_123")).resolves.toEqual({
      connection: {
        id: "dsc_123",
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
      mocks.enqueueHostedExecutionOutbox.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          eventId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
        }),
        sourceId: "8",
        sourceType: "device_sync_signal",
        tx: mocks.prismaTx,
      }),
    );
  });

  it("dispatches a wake from the connected ingress hook when an owner exists", async () => {
    const controlPlane = new HostedDeviceSyncControlPlane(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
    );

    await controlPlane.handleOAuthCallback("oura");

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
          event: {
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
          },
          eventId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
        }),
        sourceId: "8",
        sourceType: "device_sync_signal",
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
      "Failed to ensure hosted webhook subscriptions during connection setup.",
      expect.objectContaining({
        provider: "oura",
        error: expect.any(Error),
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
    expect(mocks.completeWebhookTrace).toHaveBeenCalledWith("oura", "trace_123", mocks.prismaTx);
    expect(mocks.createSignal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enqueueHostedExecutionOutbox.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completeWebhookTrace.mock.invocationCallOrder[0],
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: {
          event: {
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
          },
          eventId: "device-sync:webhook-accepted:user-123:oura:dsc_123:trace_123",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
        sourceId: "8",
        sourceType: "device_sync_signal",
        tx: mocks.prismaTx,
      }),
    );
  });

  it("skips signal creation and wake dispatch when ingress hooks cannot resolve an owner", async () => {
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

    expect(mocks.createSignal).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });
});
