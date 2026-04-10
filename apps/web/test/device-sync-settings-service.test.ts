import assert from "node:assert/strict";

import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  listConnections: vi.fn(),
  readHostedDeviceSyncPublicBaseUrl: vi.fn(() => null),
  readHostedPublicBaseUrl: vi.fn(() => "https://murph.example"),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  readHostedDeviceSyncPublicBaseUrl: mocks.readHostedDeviceSyncPublicBaseUrl,
  readHostedPublicBaseUrl: mocks.readHostedPublicBaseUrl,
}));

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
    listConnections: mocks.listConnections,
  });
});

test("buildHostedDeviceSyncSettingsResponse reads device sync connections server-side for the authenticated member", async () => {
  mocks.listConnections.mockResolvedValue({
    connections: [],
    providers: [
      {
        callbackPath: "/oauth/oura/callback",
        callbackUrl: "https://murph.example/api/device-sync/oauth/oura/callback",
        defaultScopes: ["daily_read"],
        provider: "oura",
        supportsWebhooks: true,
        webhookPath: "/webhooks/oura",
        webhookUrl: "https://murph.example/api/device-sync/webhooks/oura",
      },
    ],
  });

  const { buildHostedDeviceSyncSettingsResponse } = await import("@/src/lib/device-sync/settings-service");
  const response = await buildHostedDeviceSyncSettingsResponse({
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
  });

  expect(mocks.createHostedDeviceSyncControlPlane).toHaveBeenCalledTimes(1);
  const syntheticRequest = mocks.createHostedDeviceSyncControlPlane.mock.calls[0]?.[0];
  assert.ok(syntheticRequest instanceof Request);
  assert.equal(syntheticRequest.url, "https://murph.example/settings");
  expect(mocks.listConnections).toHaveBeenCalledWith("member_123");
  expect(response.ok).toBe(true);
  expect(response.sources).toHaveLength(1);
  expect(response.sources[0]).toMatchObject({
    provider: "oura",
    providerLabel: "Oura",
    statusLabel: "Not connected",
  });
});

test("buildHostedDeviceSyncSettingsResponse rejects hosted members without active access before reading connections", async () => {
  const { buildHostedDeviceSyncSettingsResponse } = await import("@/src/lib/device-sync/settings-service");

  await expect(buildHostedDeviceSyncSettingsResponse({
    member: {
      billingStatus: "incomplete",
      id: "member_123",
      suspendedAt: null,
    },
  })).rejects.toMatchObject({
    code: "HOSTED_ACCESS_REQUIRED",
    message: "Finish hosted activation before continuing.",
  });

  expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
  expect(mocks.listConnections).not.toHaveBeenCalled();
});
