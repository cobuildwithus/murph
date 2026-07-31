import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  disconnectAllHostedDeviceSyncConnectionsForUser: vi.fn(),
  readHostedConsentStatus: vi.fn(),
  readHostedHealthDataConsentState: vi.fn(),
  revokeAllMealPhotoCaptureEnrollmentsForMember: vi.fn(),
  revokeHostedConsentScope: vi.fn(),
  terminateHostedUserRuntimeWorkflowBestEffort: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  disconnectAllHostedDeviceSyncConnectionsForUser:
    mocks.disconnectAllHostedDeviceSyncConnectionsForUser,
}));
vi.mock("@/src/lib/device-sync/meal-photo-capture", () => ({
  revokeAllMealPhotoCaptureEnrollmentsForMember:
    mocks.revokeAllMealPhotoCaptureEnrollmentsForMember,
}));
vi.mock("@/src/lib/hosted-orchestration/workflow-termination", () => ({
  terminateHostedUserRuntimeWorkflowBestEffort:
    mocks.terminateHostedUserRuntimeWorkflowBestEffort,
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
    mocks.revokeAllMealPhotoCaptureEnrollmentsForMember.mockResolvedValue({
      revokedCount: 1,
    });
    mocks.terminateHostedUserRuntimeWorkflowBestEffort.mockResolvedValue({
      configured: true,
      errorCode: null,
      notFound: false,
      terminated: true,
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
    expect(mocks.terminateHostedUserRuntimeWorkflowBestEffort).not.toHaveBeenCalled();
  });

  it("terminates processing before best-effort provider cleanup", async () => {
    const request = new Request("https://app.example.test/api/legal/consent/revoke");
    mocks.readHostedHealthDataConsentState.mockResolvedValueOnce("revoked");

    await cleanupWithdrawnHostedHealthDataConsent({
      memberId: "member_123",
      prisma,
      request,
    });

    expect(mocks.terminateHostedUserRuntimeWorkflowBestEffort).toHaveBeenCalledWith({
      reason: "health-data-consent-withdrawn",
      userId: "member_123",
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
      mocks.terminateHostedUserRuntimeWorkflowBestEffort.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.disconnectAllHostedDeviceSyncConnectionsForUser.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("continues best-effort cleanup when a provider is unavailable", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readHostedHealthDataConsentState.mockResolvedValueOnce("revoked");
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

  it("does not run deferred cleanup after consent has been renewed", async () => {
    mocks.readHostedHealthDataConsentState.mockResolvedValueOnce("granted");

    await expect(cleanupWithdrawnHostedHealthDataConsent({
      memberId: "member_123",
      prisma,
      request: new Request("https://app.example.test/api/legal/consent/revoke"),
    })).resolves.toBeUndefined();

    expect(mocks.terminateHostedUserRuntimeWorkflowBestEffort).not.toHaveBeenCalled();
    expect(mocks.disconnectAllHostedDeviceSyncConnectionsForUser).not.toHaveBeenCalled();
    expect(mocks.revokeAllMealPhotoCaptureEnrollmentsForMember).not.toHaveBeenCalled();
  });

  it("fails closed when deferred cleanup cannot confirm the revoked grant", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readHostedHealthDataConsentState.mockRejectedValueOnce(
      new Error("consent unavailable"),
    );

    await expect(cleanupWithdrawnHostedHealthDataConsent({
      memberId: "member_123",
      prisma,
      request: new Request("https://app.example.test/api/legal/consent/revoke"),
    })).resolves.toBeUndefined();

    expect(mocks.terminateHostedUserRuntimeWorkflowBestEffort).not.toHaveBeenCalled();
    expect(mocks.disconnectAllHostedDeviceSyncConnectionsForUser).not.toHaveBeenCalled();
    expect(mocks.revokeAllMealPhotoCaptureEnrollmentsForMember).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "Hosted health-data consent withdrawal cleanup failed.",
      expect.objectContaining({ operation: "consent state" }),
    );
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
