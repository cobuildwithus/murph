import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedRuntimeAiAccessDecision: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  withJsonError: vi.fn((handler: (...args: never[]) => Promise<Response>) => handler),
  jsonOk: vi.fn((payload: unknown, status?: number) =>
    Response.json(payload, { status }),
  ),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/http", () => ({
  jsonOk: mocks.jsonOk,
  withJsonError: mocks.withJsonError,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readHostedRuntimeAiAccessDecision: mocks.readHostedRuntimeAiAccessDecision,
}));

describe("hosted AI usage gate route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the legacy gate callback off monthly allowance bookkeeping", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_gate_1");
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({ allowed: true });

    const { POST } = await import(
      "../app/api/internal/hosted-execution/usage/gate/route"
    );
    const response = await POST(new Request(
      "https://join.example.test/api/internal/hosted-execution/usage/gate",
      {
        body: JSON.stringify({
          deniedNoticeContext: "pending_nudge",
        }),
        method: "POST",
      },
    ));

    await expect(response.json()).resolves.toEqual({ allowed: true });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 512 },
    );
  });

  it("serializes expired-trial access denial for an old runtime consumer", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_gate_1");
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({
      allowed: false,
      reason: "trial_expired_pending_billing",
      retryAfter: new Date("2026-05-01T00:15:00.000Z"),
      userNotice: {
        code: "trial_conversion_pending",
        message: "Your trial needs billing before Murph can continue.",
      },
    });

    const { POST } = await import(
      "../app/api/internal/hosted-execution/usage/gate/route"
    );
    const response = await POST(new Request(
      "https://join.example.test/api/internal/hosted-execution/usage/gate",
      {
        method: "POST",
      },
    ));

    await expect(response.json()).resolves.toEqual({
      allowed: false,
      noticeCode: "trial_conversion_pending",
      reason: "trial_expired_pending_billing",
      retryAfter: "2026-05-01T00:15:00.000Z",
      userNotice: "Your trial needs billing before Murph can continue.",
    });
    expect(mocks.readHostedRuntimeAiAccessDecision).toHaveBeenCalledWith({
      memberId: "member_gate_1",
    });
  });
});
