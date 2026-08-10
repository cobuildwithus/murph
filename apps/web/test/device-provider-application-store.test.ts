import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/provider-applications/crypto", () => ({
  decryptDeviceProviderApplication: mocks.decrypt,
  encryptDeviceProviderApplication: mocks.encrypt,
}));

import {
  resolveDeviceProviderApplication,
  saveDeviceProviderApplication,
} from "@/src/lib/device-sync/provider-applications/store";

describe("member-owned device provider application store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decrypt.mockResolvedValue({
      schema: "murph.device-provider-application.strava.v1",
      clientId: "member-client",
      clientSecret: "member-secret",
    });
    mocks.encrypt.mockResolvedValue("sealed-next");
  });

  it("resolves only the exact member, provider, and revision", async () => {
    const row = {
      configEncrypted: "sealed",
      createdAt: new Date("2026-08-10T00:00:00.000Z"),
      id: "dpa_123",
      memberId: "member_123",
      provider: "strava",
      revision: 4,
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    };
    const prisma = {
      deviceProviderApplication: {
        findUnique: vi.fn(async () => row),
      },
    };

    await expect(resolveDeviceProviderApplication({
      applicationId: "dpa_123",
      expectedRevision: 4,
      memberId: "member_123",
      prisma: prisma as never,
      provider: "strava",
    })).resolves.toEqual({
      applicationId: "dpa_123",
      provider: "strava",
      providerConfigs: {
        strava: {
          clientId: "member-client",
          clientSecret: "member-secret",
        },
      },
      revision: 4,
    });

    await expect(resolveDeviceProviderApplication({
      applicationId: "dpa_123",
      expectedRevision: 4,
      memberId: "member_other",
      prisma: prisma as never,
      provider: "strava",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_NOT_FOUND",
    });
    expect(mocks.decrypt).toHaveBeenCalledTimes(1);
  });

  it("classifies malformed decrypted config as repairable application state", async () => {
    mocks.decrypt.mockRejectedValue(new TypeError("invalid secret schema"));
    const prisma = {
      deviceProviderApplication: {
        findUnique: vi.fn(async () => ({
          configEncrypted: "sealed",
          createdAt: new Date("2026-08-10T00:00:00.000Z"),
          id: "dpa_123",
          memberId: "member_123",
          provider: "strava",
          revision: 4,
          updatedAt: new Date("2026-08-10T00:00:00.000Z"),
        })),
      },
    };

    await expect(resolveDeviceProviderApplication({
      applicationId: "dpa_123",
      expectedRevision: 4,
      memberId: "member_123",
      prisma: prisma as never,
      provider: "strava",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_INVALID",
    });
  });

  it("blocks private application creation while a legacy connection is active", async () => {
    const hostedMember = {
      findUnique: vi.fn(async () => ({
        id: "member_123",
        threadContainer: null,
      })),
    };
    const deviceProviderApplication = {
      findUnique: vi.fn(async () => null),
      create: vi.fn(),
    };
    const tx = {
      $queryRaw: vi.fn(async () => []),
      deviceConnection: {
        findFirst: vi.fn(async () => ({ id: "dsc_legacy" })),
      },
      deviceProviderApplication,
      hostedMember,
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)),
      deviceProviderApplication,
      hostedMember,
    };

    await expect(saveDeviceProviderApplication({
      clientId: "member-client",
      clientSecret: "member-secret",
      expectedRevision: null,
      memberId: "member_123",
      prisma: prisma as never,
      provider: "strava",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_CONNECTION_CONFLICT",
    });
    expect(deviceProviderApplication.create).not.toHaveBeenCalled();
  });

  it("does not re-encrypt an unchanged client identity", async () => {
    const row = {
      configEncrypted: "sealed",
      createdAt: new Date("2026-08-10T00:00:00.000Z"),
      id: "dpa_123",
      memberId: "member_123",
      provider: "strava",
      revision: 4,
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    };
    const hostedMember = {
      findUnique: vi.fn(async () => ({
        id: "member_123",
        threadContainer: null,
      })),
    };
    const deviceProviderApplication = {
      findUnique: vi.fn(async () => row),
    };
    const tx = {
      $queryRaw: vi.fn(async () => []),
      deviceProviderApplication,
      hostedMember,
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)),
      deviceProviderApplication,
      hostedMember,
    };

    await expect(saveDeviceProviderApplication({
      clientId: " member-client ",
      clientSecret: " member-secret ",
      expectedRevision: 4,
      memberId: "member_123",
      prisma: prisma as never,
      provider: "strava",
    })).resolves.toEqual({
      applicationId: "dpa_123",
      createdAt: "2026-08-10T00:00:00.000Z",
      provider: "strava",
      revision: 4,
      updatedAt: "2026-08-10T00:00:00.000Z",
    });
    expect(mocks.decrypt).toHaveBeenCalledTimes(1);
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it("rejects missing or synthetic members before any encryption work", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn(async () => null),
      },
    };

    await expect(saveDeviceProviderApplication({
      clientId: "member-client",
      clientSecret: "member-secret",
      expectedRevision: null,
      memberId: "member_missing",
      prisma: prisma as never,
      provider: "strava",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_MEMBER_NOT_FOUND",
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
});
