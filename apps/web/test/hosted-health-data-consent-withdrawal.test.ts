import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  disconnectAllHostedDeviceSyncConnectionsForUser: vi.fn(),
  listMemberOwnedProviderSetups: vi.fn(),
  markMemberOwnedProviderSetupDisconnected: vi.fn(),
  readHostedConsentStatus: vi.fn(),
  readHostedHealthDataConsentState: vi.fn(),
  revokeAllMealPhotoCaptureEnrollmentsForMember: vi.fn(),
  revokeHostedConsentScope: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  disconnectAllHostedDeviceSyncConnectionsForUser:
    mocks.disconnectAllHostedDeviceSyncConnectionsForUser,
}));
vi.mock("@/src/lib/device-sync/provider-setup/store", () => ({
  PrismaDeviceProviderSetupStore: class {
    async listMemberSetups(memberId: string) {
      return await mocks.listMemberOwnedProviderSetups(memberId);
    }

    async markDisconnected(input: { memberId: string; provider: "strava" }) {
      return await mocks.markMemberOwnedProviderSetupDisconnected(input);
    }
  },
}));
vi.mock("@/src/lib/device-sync/meal-photo-capture", () => ({
  revokeAllMealPhotoCaptureEnrollmentsForMember:
    mocks.revokeAllMealPhotoCaptureEnrollmentsForMember,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ label: "test-prisma" }),
}));
vi.mock("@/src/lib/legal/consent", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/legal/consent")>(
    "@/src/lib/legal/consent",
  );
  return {
    ...actual,
    readHostedConsentStatus: mocks.readHostedConsentStatus,
    readHostedHealthDataConsentState: mocks.readHostedHealthDataConsentState,
    revokeHostedConsentScope: mocks.revokeHostedConsentScope,
  };
});

import {
  cleanupWithdrawnHostedHealthDataConsent,
  reconcileHostedHealthDataRuntimeConsent,
  withdrawHostedHealthDataConsent,
} from "@/src/lib/hosted-privacy/health-data-consent-withdrawal";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

const status: HostedConsentStatus = {
  documents: [],
  generatedAt: "2026-07-30T12:00:00.000Z",
  launchGranted: false,
  launchScopes: [],
  ok: true,
  schema: "murph.hosted-consent-status.v1",
  scopes: [],
};
const prisma = getPrisma();

describe("withdrawHostedHealthDataConsent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedHealthDataConsentState.mockResolvedValue("granted");
    mocks.readHostedConsentStatus.mockResolvedValue(status);
    mocks.revokeHostedConsentScope.mockResolvedValue(status);
    mocks.disconnectAllHostedDeviceSyncConnectionsForUser.mockResolvedValue({
      attemptedCount: 1,
      disconnectedCount: 1,
      failedCount: 0,
    });
    mocks.listMemberOwnedProviderSetups.mockResolvedValue([{
      active: true,
      browserRunId: null,
      completedAt: null,
      connectSourceId: "strava",
      connectTarget: "strava",
      createdAt: new Date("2026-08-11T12:00:00.000Z"),
      id: "dps_strava_123",
      memberId: "member_123",
      provider: "strava",
      providerApplicationId: "dpa_strava_123",
      providerApplicationRevision: 2,
      sourceProviderSlug: null,
      status: "connected",
      updatedAt: new Date("2026-08-11T12:02:00.000Z"),
      version: 3,
    }]);
    mocks.markMemberOwnedProviderSetupDisconnected.mockResolvedValue(null);
    mocks.revokeAllMealPhotoCaptureEnrollmentsForMember.mockResolvedValue({
      revokedCount: 1,
    });
  });

  it("returns the committed revocation without waiting for cleanup", async () => {
    await expect(withdrawHostedHealthDataConsent({
      memberId: "member_123",
      prisma,
      source: "settings-health-data",
    })).resolves.toBe(status);

    expect(mocks.revokeHostedConsentScope).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
      scope: "launch.health-data",
      source: "settings-health-data",
    });
    expect(mocks.disconnectAllHostedDeviceSyncConnectionsForUser).not.toHaveBeenCalled();
    expect(mocks.revokeAllMealPhotoCaptureEnrollmentsForMember).not.toHaveBeenCalled();
  });

  it("runs both independently guarded provider cleanup owners", async () => {
    const request = new Request("https://app.example.test/api/legal/consent/revoke");

    await cleanupWithdrawnHostedHealthDataConsent({
      memberId: "member_123",
      prisma,
      request,
    });

    expect(mocks.disconnectAllHostedDeviceSyncConnectionsForUser).toHaveBeenCalledWith({
      request,
      userId: "member_123",
    });
    expect(mocks.listMemberOwnedProviderSetups).toHaveBeenCalledWith("member_123");
    expect(mocks.markMemberOwnedProviderSetupDisconnected).toHaveBeenCalledWith({
      memberId: "member_123",
      provider: "strava",
    });
    expect(mocks.revokeAllMealPhotoCaptureEnrollmentsForMember).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    expect(
      mocks.disconnectAllHostedDeviceSyncConnectionsForUser.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.revokeAllMealPhotoCaptureEnrollmentsForMember.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("continues best-effort cleanup when a provider is unavailable", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.disconnectAllHostedDeviceSyncConnectionsForUser.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );

    await expect(cleanupWithdrawnHostedHealthDataConsent({
      memberId: "member_123",
      prisma,
      request: new Request("https://app.example.test/api/legal/consent/revoke"),
    })).resolves.toBeUndefined();

    expect(mocks.revokeAllMealPhotoCaptureEnrollmentsForMember).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("retries cleanup without appending another event after withdrawal", async () => {
    mocks.readHostedHealthDataConsentState.mockResolvedValue("revoked");

    await expect(withdrawHostedHealthDataConsent({
      memberId: "member_123",
      prisma,
    })).resolves.toBe(status);

    expect(mocks.revokeHostedConsentScope).not.toHaveBeenCalled();
    expect(mocks.readHostedConsentStatus).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    expect(mocks.disconnectAllHostedDeviceSyncConnectionsForUser).not.toHaveBeenCalled();
  });

  it("does not reinterpret a missing legacy grant as withdrawal", async () => {
    mocks.readHostedHealthDataConsentState.mockResolvedValue("missing");

    await expect(withdrawHostedHealthDataConsent({
      memberId: "member_123",
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.revokeHostedConsentScope).not.toHaveBeenCalled();
    expect(mocks.disconnectAllHostedDeviceSyncConnectionsForUser).not.toHaveBeenCalled();
  });
});

describe("reconcileHostedHealthDataRuntimeConsent", () => {
  it("waits for the Cloudflare runtime consent barrier", async () => {
    const reconcileRuntimeHealthDataConsent = vi.fn().mockResolvedValue({
      activeInvocationPreempted: true,
      consentState: "revoked",
      processingAllowed: false,
      runnerContainerDestroyAttempted: true,
      runnerContainerDestroyOk: true,
      userId: "member_123",
    });

    await expect(reconcileHostedHealthDataRuntimeConsent({
      client: { reconcileRuntimeHealthDataConsent },
      memberId: "member_123",
    })).resolves.toMatchObject({
      activeInvocationPreempted: true,
      consentState: "revoked",
      runnerContainerDestroyOk: true,
    });
    expect(reconcileRuntimeHealthDataConsent).toHaveBeenCalledWith("member_123");
  });

  it("fails closed when runtime control is not configured", async () => {
    await expect(reconcileHostedHealthDataRuntimeConsent({
      client: null,
      memberId: "member_123",
    })).rejects.toMatchObject({
      code: "HOSTED_HEALTH_DATA_RUNTIME_CONTROL_NOT_CONFIGURED",
      httpStatus: 503,
    });
  });

  it("returns a safe retryable error when runtime reconciliation fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reconcileRuntimeHealthDataConsent = vi.fn().mockRejectedValue(
      new Error("private upstream detail"),
    );

    await expect(reconcileHostedHealthDataRuntimeConsent({
      client: { reconcileRuntimeHealthDataConsent },
      memberId: "member_123",
    })).rejects.toMatchObject({
      code: "HOSTED_HEALTH_DATA_RUNTIME_CONSENT_RECONCILIATION_FAILED",
      httpStatus: 503,
      retryable: true,
    });
    expect(errorLog).toHaveBeenCalledWith(
      "Hosted health-data runtime consent reconciliation failed.",
      expect.not.objectContaining({ message: "private upstream detail" }),
    );
    errorLog.mockRestore();
  });
});
