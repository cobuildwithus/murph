import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
} from "@murphai/hosted-execution/routes";

const mocks = vi.hoisted(() => ({
  requireHostedCloudflareCallbackRequest: vi.fn(),
  runHostedDeviceSyncRecoverySweep: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/device-sync/recovery-sweeper", () => ({
  runHostedDeviceSyncRecoverySweep: mocks.runHostedDeviceSyncRecoverySweep,
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
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue(
      HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
    );
    mocks.runHostedDeviceSyncRecoverySweep.mockResolvedValue({
      dueReconcileSweeper: {
        dueConnections: 1,
        skippedDueConnections: 0,
        wakeAccepted: 1,
        wakeAttempted: 1,
        wakeFailed: 0,
        wakeLimit: 25,
        wakeNotAccepted: 0,
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
    await expect(response.json()).resolves.toEqual({
      dueReconcileSweeper: {
        dueConnections: 1,
        skippedDueConnections: 0,
        wakeAccepted: 1,
        wakeAttempted: 1,
        wakeFailed: 0,
        wakeLimit: 25,
        wakeNotAccepted: 0,
      },
    });
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
