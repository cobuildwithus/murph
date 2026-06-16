import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireHostedCloudflareCallbackRequest: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
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

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

describe("hosted AI usage gate route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a denied pending-nudge decision without claiming a user notice", async () => {
    const decision = {
      allowed: false,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 10_000_000n,
      memberId: "member_gate_1",
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
      retryAfter: new Date("2026-05-01T00:00:00.000Z"),
      spentUsdMicros: 10_000_000n,
      userNotice: {
        code: "pulse_upgrade_edge",
        message:
          "Hey, you've reached your usage limit for the month. Upgrade to Edge: https://withmurph.ai/home",
      },
    };
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_gate_1");
    mocks.resolveHostedAiUsageGate.mockResolvedValue(decision);

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

    await expect(response.json()).resolves.toMatchObject({
      allowed: false,
      noticeCode: "pulse_upgrade_edge",
      reason: "ai_usage_limit_exceeded",
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 512 },
    );
  });

  it("serializes deterministic quota notices from the web gate decision", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_gate_1");
    mocks.resolveHostedAiUsageGate.mockResolvedValue({
      allowed: false,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 10_000_000n,
      memberId: "member_gate_1",
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
      retryAfter: new Date("2026-05-01T00:00:00.000Z"),
      spentUsdMicros: 10_000_000n,
      userNotice: {
        code: "pulse_upgrade_edge",
        message:
          "Hey, you've reached your usage limit for the month. Upgrade to Edge: https://withmurph.ai/home",
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
      noticeCode: "pulse_upgrade_edge",
      reason: "ai_usage_limit_exceeded",
      retryAfter: "2026-05-01T00:00:00.000Z",
      userNotice:
        "Hey, you've reached your usage limit for the month. Upgrade to Edge: https://withmurph.ai/home",
    });
    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: "member_gate_1",
    });
  });
});
