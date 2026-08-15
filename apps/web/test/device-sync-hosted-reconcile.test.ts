import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendWake: vi.fn(),
  getConnectionForUser: vi.fn(),
  requireCallback: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: vi.fn(() => ({
    store: {
      getConnectionForUser: mocks.getConnectionForUser,
    },
  })),
}));

vi.mock("@/src/lib/device-sync/wake-service", () => ({
  appendHostedDeviceSyncManualReconcileWake: mocks.appendWake,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireCallback,
}));

import {
  requestHostedDeviceSyncReconcile,
} from "@/src/lib/device-sync/hosted-runtime-reconcile";
import {
  POST as reconcileRoutePost,
} from "../app/api/internal/device-sync/reconcile/route";

describe("hosted device-sync reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendWake.mockResolvedValue({
      wakeAccepted: true,
      wakeAppended: true,
      wakeDuplicate: false,
      wakeInserted: true,
    });
    mocks.requireCallback.mockResolvedValue("member_123");
  });

  it("binds the internal POST route to the signed callback member", async () => {
    mocks.getConnectionForUser.mockResolvedValue({
      id: "dsc_123",
      provider: "oura",
      status: "active",
    });
    const request = new Request(
      "https://control.example.test/api/internal/device-sync/reconcile",
      {
        body: JSON.stringify({ connectionId: "dsc_123" }),
        method: "POST",
      },
    );

    const response = await reconcileRoutePost(request);

    expect(response.status).toBe(200);
    expect(mocks.requireCallback).toHaveBeenCalledWith(request, {
      maxBodyBytes: 4 * 1024,
    });
    expect(mocks.getConnectionForUser).toHaveBeenCalledWith("member_123", "dsc_123");
    await expect(response.json()).resolves.toMatchObject({
      connectionId: "dsc_123",
      status: "queued",
    });
  });

  it("queues one wake for an active member-owned connection", async () => {
    mocks.getConnectionForUser.mockResolvedValue({
      id: "dsc_123",
      provider: "oura",
      status: "active",
    });

    const result = await requestHostedDeviceSyncReconcile({
      request: new Request("https://control.example.test/api/internal/device-sync/reconcile", {
        body: JSON.stringify({
          connectionId: "dsc_123",
          memberEditConflictResolution: "use_provider",
        }),
        method: "POST",
      }),
      trustedUserId: "member_123",
    });

    expect(result).toMatchObject({
      connectionId: "dsc_123",
      status: "queued",
    });
    expect(mocks.getConnectionForUser).toHaveBeenCalledWith("member_123", "dsc_123");
    expect(mocks.appendWake).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "dsc_123",
      memberEditConflictResolution: "use_provider",
      provider: "oura",
      userId: "member_123",
    }));
  });

  it("fails closed for another member's or inactive connection", async () => {
    mocks.getConnectionForUser.mockResolvedValueOnce(null);
    await expect(requestHostedDeviceSyncReconcile({
      request: new Request("https://control.example.test", {
        body: JSON.stringify({ connectionId: "dsc_other" }),
        method: "POST",
      }),
      trustedUserId: "member_123",
    })).rejects.toMatchObject({ code: "CONNECTION_NOT_FOUND" });

    mocks.getConnectionForUser.mockResolvedValueOnce({
      id: "dsc_123",
      provider: "oura",
      status: "reauthorization_required",
    });
    await expect(requestHostedDeviceSyncReconcile({
      request: new Request("https://control.example.test", {
        body: JSON.stringify({ connectionId: "dsc_123" }),
        method: "POST",
      }),
      trustedUserId: "member_123",
    })).rejects.toMatchObject({ code: "ACCOUNT_REAUTHORIZATION_REQUIRED" });
    expect(mocks.appendWake).not.toHaveBeenCalled();
  });
});
