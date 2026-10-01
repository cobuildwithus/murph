import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  handleHostedOperatorMessageControl: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));
vi.mock("@/src/lib/hosted-ops/operator-task", () => ({
  handleHostedOperatorMessageControl:
    mocks.handleHostedOperatorMessageControl,
}));

import { POST } from "@/app/api/internal/hosted-execution/operator-tasks/runtime/route";

describe("hosted operator task runtime route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue(
      "hbm_synthetic",
    );
    mocks.handleHostedOperatorMessageControl.mockResolvedValue({
      status: "authorized",
    });
  });

  it("binds a parsed control request to the signed runtime member", async () => {
    const body = {
      action: "authorize",
      expiresAt: "2036-08-25T18:10:00.000Z",
      requestId:
        "assistant.notification.requested:operator-task:opt_synthetic",
      taskId: "opt_synthetic",
    };
    const request = new Request(
      "https://web.example.test/api/internal/hosted-execution/operator-tasks/runtime",
      {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "authorized",
    });
    expect(mocks.handleHostedOperatorMessageControl).toHaveBeenCalledWith({
      boundRuntimeMemberId: "hbm_synthetic",
      request: body,
    });
  });
});
