import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleHostedRuntimeBillingPlanTool: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));
vi.mock("@/src/lib/hosted-execution/billing-plan-tool", () => ({
  handleHostedRuntimeBillingPlanTool: mocks.handleHostedRuntimeBillingPlanTool,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-execution/billing-plan/tool/route"
);

let route: RouteModule;

describe("hosted billing plan tool route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-execution/billing-plan/tool/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_current");
    mocks.handleHostedRuntimeBillingPlanTool.mockResolvedValue({
      action: "upgrade_to_edge",
      result: {
        currentBillingPlanCode: "launch_edge_monthly",
        status: "applied",
        targetBillingPlanCode: "launch_edge_monthly",
      },
    });
  });

  it("allows the bounded Stripe plan-switch transaction to finish", () => {
    expect(route.maxDuration).toBe(800);
  });

  it("binds a confirmed mutation to the signed callback member", async () => {
    const payload = JSON.stringify({
      action: "upgrade_to_edge",
      confirmed: true,
    });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/billing-plan/tool",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      {
        maxBodyBytes: 4_096,
        payloadText: payload,
      },
    );
    expect(mocks.handleHostedRuntimeBillingPlanTool).toHaveBeenCalledWith({
      memberId: "member_current",
      request: {
        action: "upgrade_to_edge",
        confirmed: true,
      },
    });
  });

  it("binds a confirmation preview to the signed callback member", async () => {
    mocks.handleHostedRuntimeBillingPlanTool.mockResolvedValueOnce({
      action: "upgrade_to_edge",
      result: {
        presentation: {
          body: "Upgrade to Edge now.",
          title: "Upgrade to Edge now?",
        },
        status: "confirmation_required",
      },
    });
    const payload = JSON.stringify({
      action: "upgrade_to_edge",
      confirmed: false,
    });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/billing-plan/tool",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.handleHostedRuntimeBillingPlanTool).toHaveBeenCalledWith({
      memberId: "member_current",
      request: {
        action: "upgrade_to_edge",
        confirmed: false,
      },
    });
  });
});
