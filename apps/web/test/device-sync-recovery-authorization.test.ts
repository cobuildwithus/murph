import { beforeEach, describe, expect, it, vi } from "vitest";

import { isHostedDeviceSyncExistingConnectionRecoveryAuthorized } from "@/src/lib/device-sync/recovery-authorization";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    deviceConnection: {
      fields: {
        lastSyncCompletedAt: "DeviceConnection.lastSyncCompletedAt",
      },
      findFirst: mocks.findFirst,
    },
  }),
}));

const DEXCOM_TARGET = {
  connectSourceId: "dexcom",
  connectTarget: "dexcom_v3",
  label: "Dexcom",
  provider: "junction",
  sourceProviderSlug: "dexcom_v3",
} as const;

describe("existing device connection recovery authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a healthy existing Dexcom connection as a fresh start", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(isHostedDeviceSyncExistingConnectionRecoveryAuthorized({
      memberId: "member_existing",
      target: DEXCOM_TARGET,
    })).resolves.toBe(false);
  });

  it("allows an established member-owned Dexcom account that requires reauthorization", async () => {
    mocks.findFirst.mockResolvedValue({ id: "connection_existing" });

    await expect(isHostedDeviceSyncExistingConnectionRecoveryAuthorized({
      memberId: "member_existing",
      target: DEXCOM_TARGET,
    })).resolves.toBe(true);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true },
      where: expect.objectContaining({
        provider: "junction",
        setupPhase: "source_confirmed",
        userId: "member_existing",
        sources: {
          some: {
            sourceProviderSlug: "dexcom_v3",
            status: { not: "disconnected" },
          },
        },
      }),
    }));
  });

  it("allows an exact Dexcom source with a token-refresh recovery marker", async () => {
    mocks.findFirst.mockResolvedValue({ id: "connection_existing" });

    await expect(isHostedDeviceSyncExistingConnectionRecoveryAuthorized({
      memberId: "member_existing",
      target: DEXCOM_TARGET,
    })).resolves.toBe(true);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          {
            status: "active",
            sources: {
              some: {
                lastErrorCode: { in: ["TOKEN_REFRESH_FAILED"] },
                sourceProviderSlug: "dexcom_v3",
                status: "error",
              },
            },
          },
        ]),
      }),
    }));
  });

  it("allows the same recent-error recovery state projected by Settings", async () => {
    mocks.findFirst.mockResolvedValue({ id: "connection_existing" });

    await expect(isHostedDeviceSyncExistingConnectionRecoveryAuthorized({
      memberId: "member_existing",
      target: DEXCOM_TARGET,
    })).resolves.toBe(true);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          {
            status: "active",
            lastSyncErrorAt: { not: null },
            OR: [
              { lastSyncCompletedAt: null },
              {
                lastSyncErrorAt: {
                  gt: "DeviceConnection.lastSyncCompletedAt",
                },
              },
            ],
          },
        ]),
      }),
    }));
  });

  it("rejects disconnect-in-progress and missing member-owned Dexcom state", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(isHostedDeviceSyncExistingConnectionRecoveryAuthorized({
      memberId: "member_existing",
      target: DEXCOM_TARGET,
    })).resolves.toBe(false);
    await expect(isHostedDeviceSyncExistingConnectionRecoveryAuthorized({
      memberId: "member_without_dexcom",
      target: DEXCOM_TARGET,
    })).resolves.toBe(false);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          {
            status: "reauthorization_required",
            OR: [
              { lastErrorCode: null },
              { lastErrorCode: { not: "DISCONNECT_IN_PROGRESS" } },
            ],
          },
        ]),
      }),
    }));
  });

  it("keeps disabled Strava recovery closed without reading connection state", async () => {
    await expect(isHostedDeviceSyncExistingConnectionRecoveryAuthorized({
      memberId: "member_existing",
      target: {
        connectSourceId: "strava",
        connectTarget: "strava",
        label: "Strava",
        provider: "strava",
      },
    })).resolves.toBe(false);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
