import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleTool: vi.fn(),
  requireCallback: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireCallback,
}));

vi.mock("@/src/lib/hosted-execution/subscription-tool", () => ({
  handleHostedSubscriptionTool: mocks.handleTool,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-execution/subscription/tool/route"
);

let route: RouteModule;

const ASSISTANT_INPUT_ID = `ain_${"b".repeat(32)}`;

describe("hosted subscription tool route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-execution/subscription/tool/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCallback.mockResolvedValue("member_bound");
    mocks.handleTool.mockResolvedValue({
      action: "continue_pulse",
      plan: {
        code: "launch_monthly",
        displayName: "Pulse",
        interval: "month",
        recurringAmountUsdCents: 800,
      },
      status: "no_action_required",
    });
  });

  it("authenticates the exact payload and derives the member from the signed callback", async () => {
    const body = {
      action: "continue_pulse",
      assistantInputId: ASSISTANT_INPUT_ID,
    };
    const payloadText = JSON.stringify(body);
    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-execution/subscription/tool",
      {
        body: payloadText,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.requireCallback).toHaveBeenCalledWith(
      expect.any(Request),
      {
        maxBodyBytes: 1_024,
        payloadText,
      },
    );
    expect(mocks.handleTool).toHaveBeenCalledWith({
      memberId: "member_bound",
      request: body,
    });
  });

  it("accepts each closed server-defined subscription action", async () => {
    for (const action of [
      "continue_pulse",
      "start_pulse_now",
      "upgrade_pulse",
      "upgrade_edge",
    ] as const) {
      const request = {
        action,
        assistantInputId: ASSISTANT_INPUT_ID,
      };
      const response = await route.POST(new Request(
        "https://join.example.test/api/internal/hosted-execution/subscription/tool",
        {
          body: JSON.stringify(request),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ));

      expect(response.status).toBe(200);
      expect(mocks.handleTool).toHaveBeenLastCalledWith({
        memberId: "member_bound",
        request,
      });
    }

    const planChangeRequest = {
      action: "change_plan" as const,
      assistantInputId: ASSISTANT_INPUT_ID,
      quoteId: "signed-quote",
      targetPlanCode: "launch_group_monthly" as const,
    };
    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-execution/subscription/tool",
      {
        body: JSON.stringify(planChangeRequest),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.handleTool).toHaveBeenLastCalledWith({
      memberId: "member_bound",
      request: planChangeRequest,
    });
  });

  it("rejects model-supplied billing authority fields after callback authentication", async () => {
    const body = {
      action: "upgrade_edge",
      assistantInputId: ASSISTANT_INPUT_ID,
      memberId: "member_other",
      paymentUrl: "https://example.test/not-stripe",
      priceId: "price_model_supplied",
    };
    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-execution/subscription/tool",
      {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(400);
    expect(mocks.requireCallback).toHaveBeenCalledOnce();
    expect(mocks.handleTool).not.toHaveBeenCalled();
  });

  it("rejects an unsupported action before invoking the billing handler", async () => {
    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-execution/subscription/tool",
      {
        body: JSON.stringify({
          action: "cancel_subscription",
          assistantInputId: ASSISTANT_INPUT_ID,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(400);
    expect(mocks.handleTool).not.toHaveBeenCalled();
  });
});
