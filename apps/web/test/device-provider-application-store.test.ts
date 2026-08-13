import { beforeEach, describe, expect, it, vi } from "vitest";

import { isDeviceSyncError } from "@murphai/device-syncd/errors";

const mocks = vi.hoisted(() => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/provider-applications/crypto", () => ({
  decryptDeviceProviderApplication: mocks.decrypt,
  encryptDeviceProviderApplication: mocks.encrypt,
  isDeviceProviderApplicationSecretInvalidError: (value: unknown) =>
    value instanceof Error
    && value.name === "DeviceProviderApplicationSecretInvalidError",
}));

import {
  DeviceProviderApplicationError,
  isRepairableDeviceProviderApplicationStateError,
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

  it("exposes provider-application failures through the device-sync error contract", () => {
    const error = new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_INVALID",
      "Private provider application credentials are invalid.",
    );

    expect(isDeviceSyncError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_INVALID",
      httpStatus: 409,
      retryable: false,
    });
  });

  it("distinguishes repairable application state from ownership and operational failures", () => {
    expect(isRepairableDeviceProviderApplicationStateError(
      new DeviceProviderApplicationError(
        "DEVICE_PROVIDER_APPLICATION_INVALID",
        "Private provider application credentials are invalid.",
      ),
    )).toBe(true);
    expect(isRepairableDeviceProviderApplicationStateError(
      new DeviceProviderApplicationError(
        "DEVICE_PROVIDER_APPLICATION_REVISION_MISMATCH",
        "Private provider application changed.",
      ),
    )).toBe(true);
    expect(isRepairableDeviceProviderApplicationStateError(
      new DeviceProviderApplicationError(
        "DEVICE_PROVIDER_APPLICATION_PERSONAL_MEMBER_REQUIRED",
        "A personal member is required.",
      ),
    )).toBe(false);
    expect(isRepairableDeviceProviderApplicationStateError(new Error("KMS unavailable"))).toBe(false);
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
      hostedMember: {
        findUnique: vi.fn(async () => ({
          hostedGroupRuntime: null,
          id: "member_123",
          suspendedAt: null,
          threadContainer: null,
        })),
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
          scopes: ["activity:read"],
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
    const invalid = new Error("invalid secret schema");
    invalid.name = "DeviceProviderApplicationSecretInvalidError";
    mocks.decrypt.mockRejectedValue(invalid);
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
      hostedMember: {
        findUnique: vi.fn(async () => ({
          hostedGroupRuntime: null,
          id: "member_123",
          suspendedAt: null,
          threadContainer: null,
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

  it("does not turn transient decryption failures into repair state", async () => {
    const transient = new TypeError("Hosted KMS configuration is unavailable.");
    mocks.decrypt.mockRejectedValue(transient);
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
      hostedMember: {
        findUnique: vi.fn(async () => ({
          hostedGroupRuntime: null,
          id: "member_123",
          suspendedAt: null,
          threadContainer: null,
        })),
      },
    };

    await expect(resolveDeviceProviderApplication({
      applicationId: "dpa_123",
      expectedRevision: 4,
      memberId: "member_123",
      prisma: prisma as never,
      provider: "strava",
    })).rejects.toBe(transient);
  });

  it("repairs permanently invalid ciphertext after live connections are gone", async () => {
    const invalid = new Error("ciphertext integrity failure");
    invalid.name = "DeviceProviderApplicationSecretInvalidError";
    mocks.decrypt.mockRejectedValue(invalid);
    const row = {
      configEncrypted: "corrupted",
      createdAt: new Date("2026-08-10T00:00:00.000Z"),
      id: "dpa_123",
      memberId: "member_123",
      provider: "strava",
      revision: 4,
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    };
    const updated = {
      ...row,
      configEncrypted: "sealed-next",
      revision: 5,
      updatedAt: new Date("2026-08-10T00:01:00.000Z"),
    };
    const hostedMember = {
      findUnique: vi.fn(async () => ({
        hostedGroupRuntime: null,
        id: "member_123",
        suspendedAt: null,
        threadContainer: null,
      })),
    };
    const deviceProviderApplication = {
      findUnique: vi.fn(async () => row),
      update: vi.fn(async () => updated),
    };
    const tx = {
      $queryRaw: vi.fn(async () => []),
      deviceConnection: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      deviceOauthSession: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
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
      clientId: "replacement-client",
      clientSecret: "replacement-secret",
      expectedRevision: 4,
      memberId: "member_123",
      prisma: prisma as never,
      provider: "strava",
    })).resolves.toEqual({
      applicationId: "dpa_123",
      createdAt: "2026-08-10T00:00:00.000Z",
      provider: "strava",
      revision: 5,
      updatedAt: "2026-08-10T00:01:00.000Z",
    });
    expect(mocks.encrypt).toHaveBeenCalledWith(expect.objectContaining({
      revision: 5,
    }));
    expect(deviceProviderApplication.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        configEncrypted: "sealed-next",
        revision: 5,
      }),
    }));
    expect(tx.deviceConnection.updateMany).toHaveBeenCalledWith({
      data: {
        providerApplicationId: null,
        providerApplicationRevision: null,
      },
      where: {
        providerApplicationId: "dpa_123",
        status: "disconnected",
      },
    });
    expect(tx.deviceOauthSession.deleteMany).toHaveBeenCalledWith({
      where: { providerApplicationId: "dpa_123" },
    });
    expect(
      tx.deviceConnection.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      tx.deviceOauthSession.deleteMany.mock.invocationCallOrder[0]
        ?? Number.POSITIVE_INFINITY,
    );
    expect(
      tx.deviceOauthSession.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      deviceProviderApplication.update.mock.invocationCallOrder[0]
        ?? Number.POSITIVE_INFINITY,
    );
  });

  it("rejects a concurrent application change after credentials are prepared", async () => {
    const initial = {
      configEncrypted: "sealed-initial",
      createdAt: new Date("2026-08-10T00:00:00.000Z"),
      id: "dpa_123",
      memberId: "member_123",
      provider: "strava",
      revision: 4,
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    };
    const concurrent = {
      ...initial,
      configEncrypted: "sealed-concurrent",
      revision: 5,
      updatedAt: new Date("2026-08-10T00:00:30.000Z"),
    };
    const hostedMember = {
      findUnique: vi.fn(async () => ({
        hostedGroupRuntime: null,
        id: "member_123",
        suspendedAt: null,
        threadContainer: null,
      })),
    };
    const update = vi.fn();
    const tx = {
      $queryRaw: vi.fn(async () => []),
      deviceConnection: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
      deviceOauthSession: {
        deleteMany: vi.fn(),
      },
      deviceProviderApplication: {
        findUnique: vi.fn(async () => concurrent),
        update,
      },
      hostedMember,
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)),
      deviceProviderApplication: {
        findUnique: vi.fn(async () => initial),
      },
      hostedMember,
    };

    await expect(saveDeviceProviderApplication({
      clientId: "replacement-client",
      clientSecret: "replacement-secret",
      expectedRevision: 4,
      memberId: "member_123",
      prisma: prisma as never,
      provider: "strava",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_CONFLICT",
    });
    expect(mocks.encrypt).toHaveBeenCalledWith(expect.objectContaining({
      revision: 5,
    }));
    expect(tx.deviceConnection.findFirst).not.toHaveBeenCalled();
    expect(tx.deviceConnection.updateMany).not.toHaveBeenCalled();
    expect(tx.deviceOauthSession.deleteMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("does not replace invalid ciphertext while a live connection still depends on it", async () => {
    const invalid = new Error("ciphertext integrity failure");
    invalid.name = "DeviceProviderApplicationSecretInvalidError";
    mocks.decrypt.mockRejectedValue(invalid);
    const row = {
      configEncrypted: "corrupted",
      createdAt: new Date("2026-08-10T00:00:00.000Z"),
      id: "dpa_123",
      memberId: "member_123",
      provider: "strava",
      revision: 4,
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    };
    const hostedMember = {
      findUnique: vi.fn(async () => ({
        hostedGroupRuntime: null,
        id: "member_123",
        suspendedAt: null,
        threadContainer: null,
      })),
    };
    const deviceProviderApplication = {
      findUnique: vi.fn(async () => row),
      update: vi.fn(),
    };
    const tx = {
      $queryRaw: vi.fn(async () => []),
      deviceConnection: {
        findFirst: vi.fn(async () => ({ id: "dsc_live" })),
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
      clientId: "replacement-client",
      clientSecret: "replacement-secret",
      expectedRevision: 4,
      memberId: "member_123",
      prisma: prisma as never,
      provider: "strava",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_CONNECTION_CONFLICT",
    });
    expect(deviceProviderApplication.update).not.toHaveBeenCalled();
  });

  it("blocks private application creation while a legacy connection is active", async () => {
    const hostedMember = {
      findUnique: vi.fn(async () => ({
        hostedGroupRuntime: null,
        id: "member_123",
        suspendedAt: null,
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
        hostedGroupRuntime: null,
        id: "member_123",
        suspendedAt: null,
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

  it("rejects a missing member before any encryption work", async () => {
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
      httpStatus: 404,
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it("rejects a suspended member before any encryption or application save", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn(async () => ({
          hostedGroupRuntime: null,
          id: "member_suspended",
          suspendedAt: new Date("2026-08-13T00:00:00.000Z"),
          threadContainer: null,
        })),
      },
    };

    await expect(saveDeviceProviderApplication({
      clientId: "member-client",
      clientSecret: "member-secret",
      expectedRevision: null,
      memberId: "member_suspended",
      prisma: prisma as never,
      provider: "strava",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_MEMBER_SUSPENDED",
      httpStatus: 409,
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it("rejects a synthetic thread-container member before any encryption work", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn(async () => ({
          hostedGroupRuntime: null,
          id: "member_thread_runtime",
          threadContainer: { memberId: "member_thread_runtime" },
        })),
      },
    };

    await expect(saveDeviceProviderApplication({
      clientId: "member-client",
      clientSecret: "member-secret",
      expectedRevision: null,
      memberId: "member_thread_runtime",
      prisma: prisma as never,
      provider: "strava",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_PERSONAL_MEMBER_REQUIRED",
      httpStatus: 403,
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it("rejects a synthetic group runtime member before any encryption work", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn(async () => ({
          hostedGroupRuntime: { id: "group_123" },
          id: "member_group_runtime",
          threadContainer: null,
        })),
      },
    };

    await expect(saveDeviceProviderApplication({
      clientId: "member-client",
      clientSecret: "member-secret",
      expectedRevision: null,
      memberId: "member_group_runtime",
      prisma: prisma as never,
      provider: "strava",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_PERSONAL_MEMBER_REQUIRED",
      httpStatus: 403,
    });
    await expect(resolveDeviceProviderApplication({
      applicationId: "dpa_group",
      expectedRevision: 1,
      memberId: "member_group_runtime",
      prisma: prisma as never,
      provider: "strava",
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_APPLICATION_PERSONAL_MEMBER_REQUIRED",
      httpStatus: 403,
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
});
