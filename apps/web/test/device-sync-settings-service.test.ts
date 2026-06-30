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
  expect(response.sources).toEqual([]);
});

test("buildHostedDeviceSyncSettingsResponse allows a family-sponsored member without direct active billing", async () => {
  mocks.listConnections.mockResolvedValue({
    connections: [],
    providers: [],
  });
  const prisma = createFamilyAccessPrisma({
    activeMembershipCount: 2,
    billedSeatCount: 2,
    membership: {
      group: {
        billingStatus: "active",
        suspendedAt: null,
      },
      groupId: "hbag_family",
      status: "active",
    },
  });

  const { buildHostedDeviceSyncSettingsResponse } = await import("@/src/lib/device-sync/settings-service");
  const response = await buildHostedDeviceSyncSettingsResponse({
    member: {
      billingStatus: "not_started",
      id: "member_family",
      suspendedAt: null,
    },
    prisma: prisma as never,
  });

  expect(response.ok).toBe(true);
  expect(mocks.listConnections).toHaveBeenCalledWith("member_family");
  expect(prisma.hostedAccountGroupMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      memberId: "member_family",
      status: "active",
    }),
  }));
});

test("buildHostedDeviceSyncSettingsResponse explains canceled access before reading connections", async () => {
  const { buildHostedDeviceSyncSettingsResponse } = await import("@/src/lib/device-sync/settings-service");
  const prisma = createFamilyAccessPrisma({
    activeMembershipCount: 0,
    billedSeatCount: null,
    membership: null,
  });

  await expect(buildHostedDeviceSyncSettingsResponse({
    member: {
      billingStatus: "canceled",
      id: "member_123",
      suspendedAt: null,
    },
    prisma: prisma as never,
  })).rejects.toMatchObject({
    code: "HOSTED_ACCESS_REQUIRED",
    message: "Your subscription is canceled. Open billing to resume access.",
  });

  expect(prisma.hostedAccountGroupMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      memberId: "member_123",
      status: "active",
    }),
  }));
  expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
  expect(mocks.listConnections).not.toHaveBeenCalled();
});

function createFamilyAccessPrisma(input: {
  activeMembershipCount: number;
  billedSeatCount: number | null;
  membership: null | {
    group: {
      billingStatus: string;
      suspendedAt: Date | null;
    };
    groupId: string;
    status: string;
  };
}) {
  return {
    hostedAccountGroupBillingRef: {
      findUnique: vi.fn(async () =>
        input.billedSeatCount === null
          ? null
          : {
              billedSeatCount: input.billedSeatCount,
            }
      ),
    },
    hostedAccountGroupMembership: {
      count: vi.fn(async () => input.activeMembershipCount),
      findFirst: vi.fn(async () => input.membership),
    },
    hostedAccountGroupInvite: {
      count: vi.fn(async () => 0),
    },
  };
}
