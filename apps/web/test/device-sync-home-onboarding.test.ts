import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberCoreState } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => {
  const findManyDeviceConnections = vi.fn();
  const findUniqueHostedMember = vi.fn();
  const getPrisma = vi.fn();
  const listConfiguredDeviceSyncProviderNames = vi.fn();
  const readConfiguredDeviceSyncProviderConfigs = vi.fn();
  const prismaClient = {
    deviceConnection: {
      findMany: findManyDeviceConnections,
    },
    hostedMember: {
      findUnique: findUniqueHostedMember,
    },
  };

  return {
    findManyDeviceConnections,
    findUniqueHostedMember,
    getPrisma,
    listConfiguredDeviceSyncProviderNames,
    prismaClient,
    readConfiguredDeviceSyncProviderConfigs,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@murphai/device-syncd/provider-configs", () => ({
  listConfiguredDeviceSyncProviderNames: mocks.listConfiguredDeviceSyncProviderNames,
  readConfiguredDeviceSyncProviderConfigs: mocks.readConfiguredDeviceSyncProviderConfigs,
}));

const MEMBER: HostedMemberCoreState = {
  billingStatus: "active",
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  id: "member_123",
  suspendedAt: null,
  updatedAt: new Date("2026-05-01T00:00:00.000Z"),
};

describe("shouldShowHomeDeviceSyncStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.readConfiguredDeviceSyncProviderConfigs.mockReturnValue({});
    mocks.listConfiguredDeviceSyncProviderNames.mockReturnValue([
      "junction",
      "oura",
      "strava",
      "whoop",
    ]);
    mocks.findUniqueHostedMember.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: "active",
      suspendedAt: null,
      threadContainer: null,
    });
    mocks.findManyDeviceConnections.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the device step for anonymous visitors", async () => {
    const { shouldShowHomeDeviceSyncStep } = await import(
      "@/src/lib/device-sync/home-onboarding"
    );

    await expect(shouldShowHomeDeviceSyncStep({ member: null })).resolves.toBe(true);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.findUniqueHostedMember).not.toHaveBeenCalled();
    expect(mocks.findManyDeviceConnections).not.toHaveBeenCalled();
  });

  it.each(["active", "reauthorization_required"])(
    "hides the device step when the member already has a %s connection",
    async (status) => {
      mocks.findManyDeviceConnections.mockResolvedValueOnce([
        {
          provider: "oura",
          setupExpiresAt: null,
          setupPhase: "source_confirmed",
          status,
        },
      ]);

      const { shouldShowHomeDeviceSyncStep } = await import(
        "@/src/lib/device-sync/home-onboarding"
      );

      await expect(shouldShowHomeDeviceSyncStep({ member: MEMBER })).resolves.toBe(false);
      expect(mocks.findUniqueHostedMember).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          id: MEMBER.id,
        },
      }));
      expect(mocks.findManyDeviceConnections).toHaveBeenCalledWith({
        select: {
          provider: true,
          setupExpiresAt: true,
          setupPhase: true,
          status: true,
        },
        where: {
          userId: MEMBER.id,
        },
      });
    },
  );

  it.each([
    {
      label: "disconnected",
      record: {
        provider: "oura",
        setupExpiresAt: null,
        setupPhase: "source_confirmed",
        status: "disconnected",
      },
    },
    {
      label: "failed setup",
      record: {
        provider: "junction",
        setupExpiresAt: null,
        setupPhase: "failed",
        status: "active",
      },
    },
    {
      label: "expired pending link",
      record: {
        provider: "junction",
        setupExpiresAt: new Date("2026-05-01T00:00:00.000Z"),
        setupPhase: "pending_link",
        status: "active",
      },
    },
    {
      label: "expired returned link",
      record: {
        provider: "junction",
        setupExpiresAt: new Date("2026-04-30T23:59:59.999Z"),
        setupPhase: "link_returned",
        status: "active",
      },
    },
    {
      label: "pending setup without an expiry",
      record: {
        provider: "junction",
        setupExpiresAt: null,
        setupPhase: "pending_link",
        status: "active",
      },
    },
  ])("keeps the device step visible for a $label connection", async ({ record }) => {
    mocks.findManyDeviceConnections.mockResolvedValueOnce([record]);

    const { shouldShowHomeDeviceSyncStep } = await import(
      "@/src/lib/device-sync/home-onboarding"
    );

    await expect(shouldShowHomeDeviceSyncStep({ member: MEMBER })).resolves.toBe(true);
  });

  it.each(["pending_link", "link_returned"])(
    "hides the device step while %s setup is still unexpired",
    async (setupPhase) => {
      mocks.findManyDeviceConnections.mockResolvedValueOnce([
        {
          provider: "junction",
          setupExpiresAt: new Date("2026-05-01T00:00:00.001Z"),
          setupPhase,
          status: "active",
        },
      ]);

      const { shouldShowHomeDeviceSyncStep } = await import(
        "@/src/lib/device-sync/home-onboarding"
      );

      await expect(shouldShowHomeDeviceSyncStep({ member: MEMBER })).resolves.toBe(false);
    },
  );

  it("keeps the device step visible when the only stored provider is unavailable", async () => {
    mocks.findManyDeviceConnections.mockResolvedValueOnce([
      {
        provider: "fitbit",
        setupExpiresAt: null,
        setupPhase: "source_confirmed",
        status: "active",
      },
    ]);

    const { shouldShowHomeDeviceSyncStep } = await import(
      "@/src/lib/device-sync/home-onboarding"
    );

    await expect(shouldShowHomeDeviceSyncStep({ member: MEMBER })).resolves.toBe(true);
  });

  it("keeps the device step visible when access is unavailable", async () => {
    mocks.findUniqueHostedMember.mockResolvedValueOnce({
      accountGroupMemberships: [],
      billingStatus: "canceled",
      suspendedAt: null,
      threadContainer: null,
    });

    const { shouldShowHomeDeviceSyncStep } = await import(
      "@/src/lib/device-sync/home-onboarding"
    );

    await expect(shouldShowHomeDeviceSyncStep({ member: MEMBER })).resolves.toBe(true);
    expect(mocks.findManyDeviceConnections).not.toHaveBeenCalled();
  });

  it("keeps the device step visible when device-sync state cannot be read", async () => {
    mocks.findManyDeviceConnections.mockRejectedValueOnce(new Error("unavailable"));

    const { shouldShowHomeDeviceSyncStep } = await import(
      "@/src/lib/device-sync/home-onboarding"
    );

    await expect(shouldShowHomeDeviceSyncStep({ member: MEMBER })).resolves.toBe(true);
  });
});
