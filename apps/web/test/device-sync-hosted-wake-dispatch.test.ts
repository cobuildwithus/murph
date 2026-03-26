import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDeviceSyncPublicIngress: vi.fn(),
  createSignal: vi.fn(),
  dispatchHostedExecutionBestEffort: vi.fn(),
  getConnectionBundleForUser: vi.fn(),
  getConnectionForUser: vi.fn(),
  getConnectionOwnerId: vi.fn(),
  markConnectionDisconnected: vi.fn(),
}));

vi.mock("@healthybob/device-syncd", () => ({
  createDeviceSyncPublicIngress: mocks.createDeviceSyncPublicIngress,
  deviceSyncError: vi.fn((input: { message: string }) => new Error(input.message)),
  isDeviceSyncError: vi.fn(() => false),
  resolveOuraWebhookVerificationChallenge: vi.fn(() => null),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => ({})),
}));

vi.mock("@/src/lib/hosted-execution/dispatch", () => ({
  dispatchHostedExecutionBestEffort: mocks.dispatchHostedExecutionBestEffort,
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
    ouraWebhookVerificationToken: null,
    publicBaseUrl: "https://control.example.test/api/device-sync",
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
    createSignal = mocks.createSignal;
    getConnectionBundleForUser = mocks.getConnectionBundleForUser;
    getConnectionForUser = mocks.getConnectionForUser;
    getConnectionOwnerId = mocks.getConnectionOwnerId;
    markConnectionDisconnected = mocks.markConnectionDisconnected;
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
          provider: {},
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
            jobs: [],
            occurredAt: "2026-03-26T11:59:00.000Z",
            payload: {
              accountId: "oura-account-123",
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
    mocks.dispatchHostedExecutionBestEffort.mockResolvedValue({
      dispatched: true,
    });
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

    expect(mocks.dispatchHostedExecutionBestEffort).toHaveBeenCalledWith(
      {
        event: {
          connectionId: "dsc_123",
          kind: "device-sync.wake",
          provider: "oura",
          reason: "connected",
          userId: "user-123",
        },
        eventId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
      {
        context: "device-sync connection-established user=user-123 provider=oura connection=dsc_123",
      },
    );
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

    expect(mocks.dispatchHostedExecutionBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "device-sync:webhook-accepted:user-123:oura:dsc_123:trace_123",
      }),
      expect.any(Object),
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

    expect(mocks.dispatchHostedExecutionBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        event: {
          connectionId: "dsc_123",
          kind: "device-sync.wake",
          provider: "oura",
          reason: "disconnected",
          userId: "user-123",
        },
        eventId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
      }),
      {
        context: "device-sync disconnect user=user-123 provider=oura connection=dsc_123",
      },
    );
  });

  it("keeps disconnect successful when wake dispatch reports a failure", async () => {
    mocks.dispatchHostedExecutionBestEffort.mockResolvedValue({
      dispatched: false,
      reason: "dispatch-failed",
    });
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
        kind: "disconnected",
        userId: "user-123",
      }),
    );
    expect(mocks.dispatchHostedExecutionBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        event: {
          connectionId: "dsc_123",
          kind: "device-sync.wake",
          provider: "oura",
          reason: "disconnected",
          userId: "user-123",
        },
        eventId: "device-sync:disconnect:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
      }),
      {
        context: "device-sync disconnect user=user-123 provider=oura connection=dsc_123",
      },
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
        kind: "connected",
        userId: "user-123",
      }),
    );
    expect(mocks.dispatchHostedExecutionBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        event: {
          connectionId: "dsc_123",
          kind: "device-sync.wake",
          provider: "oura",
          reason: "connected",
          userId: "user-123",
        },
        eventId: "device-sync:connection-established:user-123:oura:dsc_123:2026-03-26T12:00:00.000Z",
      }),
      {
        context: "device-sync connection-established user=user-123 provider=oura connection=dsc_123",
      },
    );
  });

  it("dispatches a wake from the webhook ingress hook with the webhook trace id", async () => {
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

    expect(mocks.createSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "dsc_123",
        kind: "webhook_hint",
        userId: "user-123",
      }),
    );
    expect(mocks.dispatchHostedExecutionBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        event: {
          connectionId: "dsc_123",
          kind: "device-sync.wake",
          provider: "oura",
          reason: "webhook_hint",
          userId: "user-123",
        },
        eventId: "device-sync:webhook-accepted:user-123:oura:dsc_123:trace_123",
      }),
      {
        context: "device-sync webhook-accepted user=user-123 provider=oura connection=dsc_123",
      },
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
    expect(mocks.dispatchHostedExecutionBestEffort).not.toHaveBeenCalled();
  });
});
