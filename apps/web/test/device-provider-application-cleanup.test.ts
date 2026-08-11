import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createScopedRegistry: vi.fn(),
  resolveApplication: vi.fn(),
  revokeStravaAccess: vi.fn(),
  scopedGet: vi.fn(),
  sharedGet: vi.fn(),
}));

vi.mock("@murphai/device-syncd/providers/strava", () => ({
  revokeStravaDeviceSyncAccess: mocks.revokeStravaAccess,
}));
vi.mock("@/src/lib/device-sync/provider-applications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/device-sync/provider-applications")>()),
  resolveDeviceProviderApplicationForConnection: mocks.resolveApplication,
}));
vi.mock("@/src/lib/device-sync/providers", () => ({
  createHostedDeviceSyncRegistryWithProviderConfigs: mocks.createScopedRegistry,
}));

import {
  DeviceProviderApplicationError,
} from "@/src/lib/device-sync/provider-applications";
import {
  resolveHostedDeviceSyncConnectionCleanup,
} from "@/src/lib/device-sync/provider-application-cleanup";

describe("member-owned provider application cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createScopedRegistry.mockReturnValue({ get: mocks.scopedGet });
  });

  it("uses the exact application registry when its credentials are valid", async () => {
    const revokeAccess = vi.fn();
    const providerConfigs = {
      strava: {
        clientId: "member-client",
        clientSecret: "member-secret",
      },
    };
    mocks.resolveApplication.mockResolvedValue({ providerConfigs });
    mocks.scopedGet.mockReturnValue({ connectionHandler: { revokeAccess } });

    await expect(resolveHostedDeviceSyncConnectionCleanup({
      connectionId: "dsc_private",
      memberId: "member_123",
      prisma: {} as never,
      provider: "strava",
      resolveSharedRegistry: () => ({ get: mocks.sharedGet }) as never,
    })).resolves.toEqual({
      repairRequired: false,
      registry: { get: mocks.scopedGet },
      warning: null,
    });

    expect(mocks.createScopedRegistry).toHaveBeenCalledWith({ providerConfigs });
    expect(mocks.sharedGet).not.toHaveBeenCalled();
  });

  it("uses token-only Strava revocation for repairable application state", async () => {
    mocks.resolveApplication.mockRejectedValue(new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_INVALID",
      "Private provider application credentials are invalid.",
    ));

    await expect(resolveHostedDeviceSyncConnectionCleanup({
      connectionId: "dsc_private",
      memberId: "member_123",
      prisma: {} as never,
      provider: "strava",
      resolveSharedRegistry: () => ({ get: mocks.sharedGet }) as never,
    })).resolves.toEqual({
      repairRequired: true,
      registry: null,
      revokeAccessOverride: mocks.revokeStravaAccess,
      warning: null,
    });

    expect(mocks.createScopedRegistry).not.toHaveBeenCalled();
    expect(mocks.sharedGet).not.toHaveBeenCalled();
  });

  it("propagates transient credential infrastructure failures without selecting operator credentials", async () => {
    const transientError = new Error("KMS unavailable");
    mocks.resolveApplication.mockRejectedValue(transientError);

    await expect(resolveHostedDeviceSyncConnectionCleanup({
      connectionId: "dsc_private",
      memberId: "member_123",
      prisma: {} as never,
      provider: "strava",
      resolveSharedRegistry: () => ({ get: mocks.sharedGet }) as never,
    })).rejects.toBe(transientError);

    expect(mocks.createScopedRegistry).not.toHaveBeenCalled();
    expect(mocks.sharedGet).not.toHaveBeenCalled();
  });
});
