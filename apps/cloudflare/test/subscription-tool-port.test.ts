import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", () => ({
  fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
}));

import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import {
  createHostedRuntimeSubscriptionToolPort,
} from "../src/runtime-platform/subscription-tool-port.ts";

const ASSISTANT_INPUT_ID = `ain_${"b".repeat(32)}`;

describe("hosted subscription tool port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows only the bounded POST web-control route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
    })).toEqual({
      allowed: true,
      operation: "subscription_tool",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: `${HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH}/arbitrary`,
    }).allowed).toBe(false);
  });

  it("sends the input-bound action and validates the web-owned result", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      action: "continue_pulse",
      plan: {
        code: "launch_monthly",
        displayName: "Pulse",
        interval: "month",
        recurringAmountUsdCents: 800,
      },
      status: "no_action_required",
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const port = createHostedRuntimeSubscriptionToolPort({
      boundUserId: "member_bound",
      fetchImpl,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request({
      action: "continue_pulse",
      assistantInputId: ASSISTANT_INPUT_ID,
    })).resolves.toEqual({
      action: "continue_pulse",
      plan: {
        code: "launch_monthly",
        displayName: "Pulse",
        interval: "month",
        recurringAmountUsdCents: 800,
      },
      status: "no_action_required",
    });
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: {
        action: "continue_pulse",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
      boundUserId: "member_bound",
      description: "Hosted subscription tool",
      fetchImpl,
      path: HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });
  });

  it("rejects an invalid control-plane response", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      action: "upgrade_edge",
      paymentUrl: "https://billing.stripe.com/unneeded",
      plan: {
        code: "launch_edge_monthly",
        displayName: "Edge",
        interval: "month",
        recurringAmountUsdCents: 2_000,
      },
      status: "completed",
    });
    const port = createHostedRuntimeSubscriptionToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request({
      action: "upgrade_edge",
      assistantInputId: ASSISTANT_INPUT_ID,
    })).rejects.toThrow("Hosted subscription tool returned invalid JSON.");
  });
});
