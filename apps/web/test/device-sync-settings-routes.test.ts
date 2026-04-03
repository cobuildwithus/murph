import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  disconnectConnection: vi.fn(),
  listConnections: vi.fn(),
  requireHostedPrivyActiveRequestAuthContext: vi.fn(),
  startConnection: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireHostedPrivyActiveRequestAuthContext: mocks.requireHostedPrivyActiveRequestAuthContext,
}));

type SettingsDeviceSyncRouteModule = typeof import("../app/api/settings/device-sync/route");
type SettingsDeviceSyncConnectRouteModule = typeof import("../app/api/settings/device-sync/providers/[provider]/connect/route");
type SettingsDeviceSyncDisconnectRouteModule = typeof import("../app/api/settings/device-sync/connections/[connectionId]/disconnect/route");

let settingsDeviceSyncRoute: SettingsDeviceSyncRouteModule;
let settingsDeviceSyncConnectRoute: SettingsDeviceSyncConnectRouteModule;
let settingsDeviceSyncDisconnectRoute: SettingsDeviceSyncDisconnectRouteModule;

describe("device sync settings routes", () => {
  beforeAll(async () => {
    settingsDeviceSyncRoute = await import("../app/api/settings/device-sync/route");
    settingsDeviceSyncConnectRoute = await import("../app/api/settings/device-sync/providers/[provider]/connect/route");
    settingsDeviceSyncDisconnectRoute = await import("../app/api/settings/device-sync/connections/[connectionId]/disconnect/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.requireHostedPrivyActiveRequestAuthContext.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      disconnectConnection: mocks.disconnectConnection,
      listConnections: mocks.listConnections,
      startConnection: mocks.startConnection,
    });
    mocks.listConnections.mockResolvedValue({
      connections: [
        {
          accessTokenExpiresAt: null,
          connectedAt: "2026-04-01T08:00:00.000Z",
          createdAt: "2026-04-01T08:00:00.000Z",
          displayName: "Alice Oura",
          id: "dspc_oura_123",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-04-03T07:00:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-04-03T06:55:00.000Z",
          lastWebhookAt: "2026-04-03T07:01:00.000Z",
          metadata: {},
          nextReconcileAt: "2026-04-03T16:00:00.000Z",
          provider: "oura",
          scopes: ["daily"],
          status: "active",
          updatedAt: "2026-04-03T07:05:00.000Z",
        },
      ],
      providers: [
        {
          callbackPath: "/oauth/oura/callback",
          callbackUrl: "https://join.example.test/oauth/oura/callback",
          defaultScopes: ["daily"],
          provider: "oura",
          supportsWebhooks: true,
          webhookPath: "/webhooks/oura",
          webhookUrl: "https://join.example.test/webhooks/oura",
        },
      ],
    });
    mocks.startConnection.mockResolvedValue({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });
    mocks.disconnectConnection.mockResolvedValue({
      warning: {
        code: "REMOTE_REVOKE_FAILED",
        message: "Provider revocation timed out.",
      },
    });
  });

  it("lists calm settings sources for the authenticated hosted member", async () => {
    const response = await settingsDeviceSyncRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedPrivyActiveRequestAuthContext).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.listConnections).toHaveBeenCalledWith("member_123");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sources: [
        {
          connectionId: "dspc_oura_123",
          headline: "Connected and syncing normally",
          provider: "oura",
          providerLabel: "Oura",
          statusLabel: "Connected",
          tone: "calm",
        },
      ],
    });
  });

  it("starts a hosted settings connect flow for the requested provider", async () => {
    const response = await settingsDeviceSyncConnectRoute.POST(
      new Request("https://join.example.test/api/settings/device-sync/providers/oura/connect", {
        body: JSON.stringify({
          returnTo: "/settings?tab=wearables",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          provider: "oura",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.startConnection).toHaveBeenCalledWith("member_123", "oura", "/settings?tab=wearables");
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });
  });

  it("disconnects a hosted settings device-sync connection", async () => {
    const response = await settingsDeviceSyncDisconnectRoute.POST(
      new Request("https://join.example.test/api/settings/device-sync/connections/dspc_oura_123/disconnect", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectionId: "dspc_oura_123",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.disconnectConnection).toHaveBeenCalledWith("member_123", "dspc_oura_123");
    await expect(response.json()).resolves.toEqual({
      warning: {
        code: "REMOTE_REVOKE_FAILED",
        message: "Provider revocation timed out.",
      },
    });
  });

  it("requires hosted auth before starting a connect flow", async () => {
    mocks.requireHostedPrivyActiveRequestAuthContext.mockRejectedValue(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Verify your phone to continue.",
    }));

    const response = await settingsDeviceSyncConnectRoute.POST(
      new Request("https://join.example.test/api/settings/device-sync/providers/oura/connect", {
        body: JSON.stringify({
          returnTo: "/settings",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          provider: "oura",
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("rejects connect requests from an untrusted origin", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        httpStatus: 403,
        message: "Hosted browser mutation origin is not allowed.",
      });
    });

    const response = await settingsDeviceSyncConnectRoute.POST(
      new Request("https://join.example.test/api/settings/device-sync/providers/oura/connect", {
        body: JSON.stringify({
          returnTo: "/settings",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example.test",
        },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          provider: "oura",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(mocks.requireHostedPrivyActiveRequestAuthContext).not.toHaveBeenCalled();
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        message: "Hosted browser mutation origin is not allowed.",
        retryable: false,
      },
    });
  });

  it("requires hosted auth before disconnecting a source", async () => {
    mocks.requireHostedPrivyActiveRequestAuthContext.mockRejectedValue(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Verify your phone to continue.",
    }));

    const response = await settingsDeviceSyncDisconnectRoute.POST(
      new Request("https://join.example.test/api/settings/device-sync/connections/dspc_oura_123/disconnect", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectionId: "dspc_oura_123",
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(mocks.disconnectConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("rejects disconnect requests from an untrusted origin", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        httpStatus: 403,
        message: "Hosted browser mutation origin is not allowed.",
      });
    });

    const response = await settingsDeviceSyncDisconnectRoute.POST(
      new Request("https://join.example.test/api/settings/device-sync/connections/dspc_oura_123/disconnect", {
        headers: {
          origin: "https://evil.example.test",
        },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectionId: "dspc_oura_123",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(mocks.requireHostedPrivyActiveRequestAuthContext).not.toHaveBeenCalled();
    expect(mocks.disconnectConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        message: "Hosted browser mutation origin is not allowed.",
        retryable: false,
      },
    });
  });
});
