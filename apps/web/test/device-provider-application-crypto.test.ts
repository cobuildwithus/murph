import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  seal: vi.fn(),
}));

vi.mock("@/src/lib/hosted-crypto/secure-box", () => ({
  openHostedUserSecureBoxString: mocks.open,
  sealHostedUserSecureBoxString: mocks.seal,
}));

import {
  decryptDeviceProviderApplication,
  DeviceProviderApplicationSecretInvalidError,
  encryptDeviceProviderApplication,
} from "@/src/lib/device-sync/provider-applications/crypto";

describe("member-owned device provider application crypto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds ciphertext to the member, provider, row, and exact revision", async () => {
    mocks.seal.mockResolvedValue("sealed-value");

    await expect(encryptDeviceProviderApplication({
      applicationId: "dpa_123",
      clientId: "member-client",
      clientSecret: "member-secret",
      memberId: "member_123",
      provider: "strava",
      revision: 7,
    })).resolves.toBe("sealed-value");

    expect(mocks.seal).toHaveBeenCalledWith(expect.objectContaining({
      aad: {
        field: "config_encrypted",
        purpose: "device-sync-provider-application",
        rowId: "dpa_123",
        table: "device_provider_application",
      },
      lane: "device-sync-provider-application",
      scope: "device-sync-provider-application:strava:dpa_123:r7:config",
      userId: "member_123",
    }));
  });

  it("fails when a different revision is used to open the ciphertext", async () => {
    mocks.open.mockRejectedValue(new Error("aad mismatch"));

    await expect(decryptDeviceProviderApplication({
      applicationId: "dpa_123",
      memberId: "member_123",
      provider: "strava",
      revision: 8,
      value: "sealed-value",
    })).rejects.toThrow(/aad mismatch/u);

    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({
      scope: "device-sync-provider-application:strava:dpa_123:r8:config",
    }));
  });

  it("classifies permanent envelope integrity failures as repairable", async () => {
    const integrityError = new Error("The operation failed.");
    integrityError.name = "OperationError";
    mocks.open.mockRejectedValue(integrityError);

    await expect(decryptDeviceProviderApplication({
      applicationId: "dpa_123",
      memberId: "member_123",
      provider: "strava",
      revision: 7,
      value: "sealed-value",
    })).rejects.toBeInstanceOf(DeviceProviderApplicationSecretInvalidError);
  });

  it("does not hide transient root-key or KMS failures", async () => {
    const transient = new Error("Hosted domain root service unavailable.");
    mocks.open.mockRejectedValue(transient);

    await expect(decryptDeviceProviderApplication({
      applicationId: "dpa_123",
      memberId: "member_123",
      provider: "strava",
      revision: 7,
      value: "sealed-value",
    })).rejects.toBe(transient);
  });

  it("does not hide transient DOM exception failures", async () => {
    const transient = new DOMException(
      "Timed out while opening the hosted root key.",
      "TimeoutError",
    );
    mocks.open.mockRejectedValue(transient);

    await expect(decryptDeviceProviderApplication({
      applicationId: "dpa_123",
      memberId: "member_123",
      provider: "strava",
      revision: 7,
      value: "sealed-value",
    })).rejects.toBe(transient);
  });

});
