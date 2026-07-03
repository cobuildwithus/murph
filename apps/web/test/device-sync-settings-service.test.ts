import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  findManyDeviceConnectionSources: vi.fn(),
  findManyDeviceConnections: vi.fn(),
  findUniqueHostedMember: vi.fn(),
  getPrisma: vi.fn(),
  listConnections: vi.fn(),
  prismaClient: {} as {
    deviceConnection: { findMany: ReturnType<typeof vi.fn> };
    deviceConnectionSource: { findMany: ReturnType<typeof vi.fn> };
    hostedMember: { findUnique: ReturnType<typeof vi.fn> };
  },
  readHostedDeviceSyncPublicBaseUrl: vi.fn(() => null),
  readHostedPublicBaseUrl: vi.fn(() => "https://murph.example"),
  readHostedPublicOrigin: vi.fn(() => "https://murph.example"),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  readHostedDeviceSyncPublicBaseUrl: mocks.readHostedDeviceSyncPublicBaseUrl,
  readHostedPublicBaseUrl: mocks.readHostedPublicBaseUrl,
  readHostedPublicOrigin: mocks.readHostedPublicOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv(
    "HOSTED_DEVICE_ROUTING_INDEX_KEY",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  mocks.prismaClient.deviceConnection = {
    findMany: mocks.findManyDeviceConnections,
  };
  mocks.prismaClient.deviceConnectionSource = {
    findMany: mocks.findManyDeviceConnectionSources,
  };
  mocks.prismaClient.hostedMember = {
    findUnique: mocks.findUniqueHostedMember,
  };
  mocks.getPrisma.mockReturnValue(mocks.prismaClient);
  mocks.findManyDeviceConnections.mockResolvedValue([]);
  mocks.findManyDeviceConnectionSources.mockResolvedValue([]);
  mocks.findUniqueHostedMember.mockResolvedValue({
    accountGroupMemberships: [],
    billingStatus: "active",
    suspendedAt: null,
    threadContainer: null,
  });
  mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
    listConnections: mocks.listConnections,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("buildHostedDeviceSyncSettingsResponse reads device sync connections server-side for the authenticated member", async () => {
  const { buildHostedDeviceSyncSettingsResponse } = await import("@/src/lib/device-sync/settings-service");
  const response = await buildHostedDeviceSyncSettingsResponse({
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
  });

  expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
  expect(mocks.findManyDeviceConnections).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      userId: "member_123",
    },
  }));
  expect(response.ok).toBe(true);
  expect(response.sources).toEqual([]);
});

test("buildHostedDeviceSyncSettingsResponse allows a family-sponsored member without direct active billing", async () => {
  const prisma = createAccessPrisma({
    accountGroupMemberships: [
      {
        group: {
          billingStatus: "active",
          suspendedAt: null,
        },
        status: "active",
      },
    ],
    billingStatus: "not_started",
    suspendedAt: null,
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
  expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
  expect(mocks.findManyDeviceConnections).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      userId: "member_family",
    },
  }));
  expect(prisma.hostedMember.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      id: "member_family",
    },
  }));
});

test("buildHostedDeviceSyncSettingsResponse explains canceled access before reading connections", async () => {
  const { buildHostedDeviceSyncSettingsResponse } = await import("@/src/lib/device-sync/settings-service");
  const prisma = createAccessPrisma({
    accountGroupMemberships: [],
    billingStatus: "canceled",
    suspendedAt: null,
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

  expect(prisma.hostedMember.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      id: "member_123",
    },
  }));
  expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
  expect(mocks.listConnections).not.toHaveBeenCalled();
});

function createAccessPrisma(member: {
  accountGroupMemberships: Array<{
    group: {
      billingStatus: string;
      suspendedAt: Date | null;
    };
    status: string;
  }>;
  billingStatus: string;
  suspendedAt: Date | null;
}) {
  return {
    hostedMember: {
      findUnique: vi.fn(async () => ({
        ...member,
        threadContainer: null,
      })),
    },
  };
}
