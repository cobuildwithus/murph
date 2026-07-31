import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", () => ({
  fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
}));

import { HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH } from "@murphai/hosted-execution/routes";
import { createHostedRuntimePlanUsageToolPort } from "../src/runtime-platform/plan-usage-tool-port.ts";

describe("hosted plan usage tool port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads and validates the bound member status through web control", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      accessKind: "paid",
      forecast: null,
      generatedAt: "2026-07-03T12:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      periodKind: "monthly",
      periodStart: "2026-07-01T00:00:00.000Z",
      planCode: "launch_monthly",
      planName: "Pulse",
      recommendedAction: null,
      subscriptionActionQuote: {
        action: "change_plan",
        expiresAt: "2026-07-03T12:10:00.000Z",
        label: "Upgrade to Edge ($20/month)",
        monthlyPriceUsdCents: 2_000,
        quoteId: "quote_test_edge",
        targetPlanCode: "launch_edge_monthly",
        timing: "immediate",
      },
      remainingPercent: 50,
      status: "active",
      usedPercent: 50,
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const port = createHostedRuntimePlanUsageToolPort({
      boundUserId: "member_bound",
      fetchImpl,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });

    await expect(port.read({
      includeSubscriptionActionQuote: true,
    })).resolves.toMatchObject({
      planName: "Pulse",
      usedPercent: 50,
    });
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: { includeSubscriptionActionQuote: true },
      boundUserId: "member_bound",
      description: "Hosted plan usage tool",
      fetchImpl,
      path: HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });
  });

  it("rejects an invalid control-plane response", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      status: "active",
      usedPercent: 150,
    });
    const port = createHostedRuntimePlanUsageToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });

    await expect(port.read({
      includeSubscriptionActionQuote: true,
    })).rejects.toThrow(
      "Hosted plan usage tool returned invalid JSON.",
    );
  });
});
