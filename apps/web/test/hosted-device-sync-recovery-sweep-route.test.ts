import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
} from "@murphai/hosted-execution/routes";

const mocks = vi.hoisted(() => ({
  requireHostedCloudflareCallbackRequest: vi.fn(),
  runHostedDeviceSyncRecoverySweep: vi.fn(),
  runClinicalDailySyncSweep: vi.fn(),
  withHostedRuntimeTemporalDeadline: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/device-sync/recovery-sweeper", () => ({
  runHostedDeviceSyncRecoverySweep: mocks.runHostedDeviceSyncRecoverySweep,
}));

vi.mock("@/src/lib/clinical-records/daily-sync", () => ({ runClinicalDailySyncSweep: mocks.runClinicalDailySyncSweep }));

vi.mock("@/src/lib/hosted-orchestration/temporal-client", () => ({
  withHostedRuntimeTemporalDeadline: mocks.withHostedRuntimeTemporalDeadline,
}));

type HostedDeviceSyncRecoverySweepRoute =
  typeof import("../app/api/internal/device-sync/recovery-sweep/route");

let route: HostedDeviceSyncRecoverySweepRoute;

describe("hosted device-sync scheduled wake sweep route", () => {
  beforeAll(async () => {
    route = await import("../app/api/internal/device-sync/recovery-sweep/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withHostedRuntimeTemporalDeadline.mockImplementation(
      async (_deadlineMs: number, run: () => Promise<unknown>) => run(),
    );
    mocks.runClinicalDailySyncSweep.mockResolvedValue({ checked: 0, queued: 0, failed: 0 });
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue(
      HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
    );
    mocks.runHostedDeviceSyncRecoverySweep.mockResolvedValue({
      dueReconcileSweeper: {
        dueConnections: 1,
        hasMoreDueConnections: false,
        wakeAccepted: 1,
        wakeAttempted: 1,
        wakeFailed: 0,
        wakeLimit: 100,
        wakeNotAccepted: 0,
      },
      preferenceHandoffSweeper: {
        candidateUsers: 1,
        handoffAccepted: 1,
        handoffAttempted: 1,
        handoffFailed: 0,
        handoffLimit: 25,
        handoffSkippedInactive: 0,
        skippedCandidateUsers: 0,
      },
    });
  });

  it("requires a signed Temporal callback identity and runs the scheduled wake sweep", async () => {
    const request = new Request(
      "https://join.example.test/api/internal/device-sync/recovery-sweep",
      {
        body: "{}",
        method: "POST",
      },
    );
    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      {
        maxBodyBytes: 4096,
      },
    );
    expect(mocks.runHostedDeviceSyncRecoverySweep).toHaveBeenCalledTimes(1);
    expect(mocks.runClinicalDailySyncSweep).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      dueReconcileSweeper: {
        dueConnections: 1,
        hasMoreDueConnections: false,
        wakeAccepted: 1,
        wakeAttempted: 1,
        wakeFailed: 0,
        wakeLimit: 100,
        wakeNotAccepted: 0,
      },
      preferenceHandoffSweeper: {
        candidateUsers: 1,
        handoffAccepted: 1,
        handoffAttempted: 1,
        handoffFailed: 0,
        handoffLimit: 25,
        handoffSkippedInactive: 0,
        skippedCandidateUsers: 0,
      },
    });
  });

  it("shares the deadline fixed before signature verification", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      mocks.requireHostedCloudflareCallbackRequest.mockImplementation(async () => {
        vi.setSystemTime(2_000);
        return HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID;
      });
      let temporalDeadlineMs: number | undefined;
      mocks.withHostedRuntimeTemporalDeadline.mockImplementation(async (deadlineMs, run) => {
        temporalDeadlineMs = deadlineMs;
        try { return await run(); } finally { temporalDeadlineMs = undefined; }
      });
      for (const sweep of [mocks.runHostedDeviceSyncRecoverySweep, mocks.runClinicalDailySyncSweep]) {
        sweep.mockImplementation(async ({ deadlineMs }) => {
          expect(temporalDeadlineMs).toBe(deadlineMs);
          return { failed: 0 };
        });
      }
      const response = await route.POST(new Request("https://example.test/recovery", { method: "POST", body: "{}" }));
      expect(response.status).toBe(200);
      expect(mocks.withHostedRuntimeTemporalDeadline).toHaveBeenCalledExactlyOnceWith(22_000, expect.any(Function));
      expect(mocks.runHostedDeviceSyncRecoverySweep).toHaveBeenCalledWith({ deadlineMs: 22_000 });
      expect(mocks.runClinicalDailySyncSweep).toHaveBeenCalledWith({ deadlineMs: 22_000 });
    } finally { vi.useRealTimers(); }
  });

  it("keeps clinical admission failures retryable with a 503", async () => {
    mocks.runClinicalDailySyncSweep.mockResolvedValue({ checked: 1, queued: 0, failed: 1 });
    const response = await route.POST(new Request("https://example.test/recovery", { method: "POST", body: "{}" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "CLINICAL_RECORD_DAILY_ADMISSION_FAILED" } });
  });

  it("rejects signed callbacks with the wrong callback identity", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_wrong");

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/device-sync/recovery-sweep",
      {
        body: "{}",
        method: "POST",
      },
    ));

    expect(response.status).toBe(401);
    expect(mocks.runHostedDeviceSyncRecoverySweep).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      },
    });
  });

  it("does not allow unsigned GET sweeps", async () => {
    const response = await route.GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedCloudflareCallbackRequest).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncRecoverySweep).not.toHaveBeenCalled();
  });
});
