import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireHostedCloudflareCallbackRequest: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

describe("hosted AI usage gate route", () => {
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
