import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES,
} from "@murphai/device-syncd/hosted-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyHostedDeviceSyncRuntimeResult: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/hosted-runtime-authority", () => ({
  applyHostedDeviceSyncRuntimeResult: mocks.applyHostedDeviceSyncRuntimeResult,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

import {
  POST as runtimeApplyPost,
} from "../app/api/internal/device-sync/runtime/apply/route";

describe("hosted device-sync runtime apply route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_runtime_1");
    mocks.applyHostedDeviceSyncRuntimeResult.mockResolvedValue({
      appliedAt: "2026-08-11T12:00:00.000Z",
      updates: [],
      userId: "member_runtime_1",
    });
  });

  it("authenticates the signed callback with the shared runtime-apply body limit", async () => {
    const request = new Request("https://control.example.test/api/internal/device-sync/runtime/apply", {
      body: JSON.stringify({
        updates: [],
        userId: "member_runtime_1",
      }),
      method: "POST",
    });

    const response = await runtimeApplyPost(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(request, {
      maxBodyBytes: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES,
    });
    expect(mocks.applyHostedDeviceSyncRuntimeResult).toHaveBeenCalledWith({
      request,
      trustedUserId: "member_runtime_1",
    });
  });
});
