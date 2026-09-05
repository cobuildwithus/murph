import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  disconnectAllHostedDeviceSyncConnectionsForUser: vi.fn(),
  revokeAllMealPhotoCaptureEnrollmentsForMember: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  disconnectAllHostedDeviceSyncConnectionsForUser:
    mocks.disconnectAllHostedDeviceSyncConnectionsForUser,
}));
vi.mock("@/src/lib/device-sync/meal-photo-capture", () => ({
  revokeAllMealPhotoCaptureEnrollmentsForMember:
    mocks.revokeAllMealPhotoCaptureEnrollmentsForMember,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ label: "test-prisma" }),
}));

import {
  cleanupWithdrawnHostedHealthDataConsent,
  reconcileHostedHealthDataRuntimeConsent,
} from "@/src/lib/hosted-privacy/health-data-consent-withdrawal";
import { getPrisma } from "@/src/lib/prisma";

const prisma = getPrisma();

describe("cleanupWithdrawnHostedHealthDataConsent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.disconnectAllHostedDeviceSyncConnectionsForUser.mockResolvedValue({
      attemptedCount: 1,
      disconnectedCount: 1,
      failedCount: 0,
    });
    mocks.revokeAllMealPhotoCaptureEnrollmentsForMember.mockResolvedValue({
      revokedCount: 1,
    });
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
