import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_RUNTIME_BILLING_PLAN_TOOL_PATH } from
  "@murphai/hosted-execution/routes";
import { HOSTED_RUNTIME_BILLING_CONTROL_TIMEOUT_MS } from
  "@murphai/hosted-execution/runtime-control";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", async () => {
  const actual = await vi.importActual<typeof import(
    "../src/runtime-platform/web-control-transport.ts"
  )>("../src/runtime-platform/web-control-transport.ts");
  return {
    ...actual,
    fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
  };
});

import { createHostedRuntimeBillingPlanToolPort } from
  "../src/runtime-platform/billing-plan-tool-port.ts";

describe("hosted billing plan tool port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the typed request through the member-bound web-control transport", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      action: "switch_to_pulse_at_renewal",
      result: {
        effectiveAt: "2026-08-01T00:00:00.000Z",
        scheduledBillingPlanCode: "launch_monthly",
        status: "scheduled",
      },
    });
    const transport = { mode: "proxy" } as const;
    const fetchImpl = vi.fn<typeof fetch>();
    const port = createHostedRuntimeBillingPlanToolPort({
      boundUserId: "member_current",
      fetchImpl,
      transport,
    });

    await expect(port.request({
      action: "switch_to_pulse_at_renewal",
      confirmed: true,
    })).resolves.toMatchObject({
      result: { status: "scheduled" },
    });
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: {
        action: "switch_to_pulse_at_renewal",
        confirmed: true,
      },
      boundUserId: "member_current",
      description: "Hosted billing plan tool",
      fetchImpl,
      path: HOSTED_RUNTIME_BILLING_PLAN_TOOL_PATH,
      timeoutMs: HOSTED_RUNTIME_BILLING_CONTROL_TIMEOUT_MS,
      transport,
    });
  });

  it("preserves the read-only confirmation preview across web control", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      action: "start_paid_pulse",
      result: {
        presentation: {
          body: "Start Pulse now at $8.00 USD per month.",
          title: "Start paid Pulse?",
        },
        status: "confirmation_required",
      },
    });
    const transport = { mode: "proxy" } as const;
    const fetchImpl = vi.fn<typeof fetch>();
    const port = createHostedRuntimeBillingPlanToolPort({
      boundUserId: "member_current",
      fetchImpl,
      transport,
    });

    await expect(port.request({
      action: "start_paid_pulse",
      confirmed: false,
    })).resolves.toMatchObject({
      result: { status: "confirmation_required" },
    });
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { action: "start_paid_pulse", confirmed: false },
      }),
    );
  });
});
