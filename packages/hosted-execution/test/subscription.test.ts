import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_SUBSCRIPTION_ACTIONS,
  parseHostedRuntimeSubscriptionToolRequest,
  parseHostedRuntimeSubscriptionToolResponse,
  parseHostedSubscriptionControlRequest,
} from "../src/subscription.ts";

const ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;

const PULSE_PLAN = {
  code: "launch_monthly",
  displayName: "Pulse",
  interval: "month",
  recurringAmountUsdCents: 800,
} as const;

const EDGE_PLAN = {
  code: "launch_edge_monthly",
  displayName: "Edge",
  interval: "month",
  recurringAmountUsdCents: 2_000,
} as const;

const GROUP_PLAN = {
  code: "launch_group_monthly",
  displayName: "Group",
  interval: "month",
  recurringAmountUsdCents: 350,
} as const;

describe("hosted runtime subscription contract", () => {
  it("parses each bounded model action without accepting authority fields", () => {
    expect(HOSTED_RUNTIME_SUBSCRIPTION_ACTIONS).toEqual([
      "change_plan",
      "continue_pulse",
      "start_pulse_now",
      "upgrade_pulse",
      "upgrade_edge",
    ]);

    for (const action of HOSTED_RUNTIME_SUBSCRIPTION_ACTIONS.filter(
      (candidate) => candidate !== "change_plan",
    )) {
      expect(parseHostedRuntimeSubscriptionToolRequest({ action })).toEqual({ action });
    }
    expect(parseHostedRuntimeSubscriptionToolRequest({
      action: "change_plan",
      quoteId: "signed-quote",
      targetPlanCode: "launch_group_monthly",
    })).toEqual({
      action: "change_plan",
      quoteId: "signed-quote",
      targetPlanCode: "launch_group_monthly",
    });
    expect(() => parseHostedRuntimeSubscriptionToolRequest({
      action: "change_plan",
      targetPlanCode: "launch_group_monthly",
    })).toThrow();

    expect(() => parseHostedRuntimeSubscriptionToolRequest({
      action: "continue_pulse",
      assistantInputId: ASSISTANT_INPUT_ID,
    })).toThrow();
    expect(() => parseHostedRuntimeSubscriptionToolRequest({
      action: "cancel_pulse",
    })).toThrow();
  });

  it("requires a valid server-injected assistant input id on control requests", () => {
    expect(parseHostedSubscriptionControlRequest({
      action: "change_plan",
      assistantInputId: ASSISTANT_INPUT_ID,
      quoteId: "signed-quote",
      targetPlanCode: "launch_group_monthly",
    })).toMatchObject({
      action: "change_plan",
      targetPlanCode: "launch_group_monthly",
    });
    expect(parseHostedSubscriptionControlRequest({
      action: "upgrade_edge",
      assistantInputId: ASSISTANT_INPUT_ID,
    })).toEqual({
      action: "upgrade_edge",
      assistantInputId: ASSISTANT_INPUT_ID,
    });

    expect(() => parseHostedSubscriptionControlRequest({
      action: "upgrade_edge",
    })).toThrow();
    expect(() => parseHostedSubscriptionControlRequest({
      action: "upgrade_edge",
      assistantInputId: "ain_member_authored",
    })).toThrow();
    expect(() => parseHostedSubscriptionControlRequest({
      action: "upgrade_edge",
      assistantInputId: ASSISTANT_INPUT_ID,
      memberId: "member_spoofed",
    })).toThrow();
  });

  it("parses non-payment results without a URL", () => {
    expect(parseHostedRuntimeSubscriptionToolResponse({
      action: "change_plan",
      plan: GROUP_PLAN,
      status: "completed",
    })).toMatchObject({
      action: "change_plan",
      plan: GROUP_PLAN,
      status: "completed",
    });
    expect(parseHostedRuntimeSubscriptionToolResponse({
      action: "continue_pulse",
      plan: PULSE_PLAN,
      status: "no_action_required",
    })).toEqual({
      action: "continue_pulse",
      plan: PULSE_PLAN,
      status: "no_action_required",
    });
    expect(parseHostedRuntimeSubscriptionToolResponse({
      action: "start_pulse_now",
      plan: PULSE_PLAN,
      status: "completed",
    })).toMatchObject({ status: "completed" });
    expect(parseHostedRuntimeSubscriptionToolResponse({
      action: "upgrade_pulse",
      plan: PULSE_PLAN,
      status: "completed",
    })).toMatchObject({ action: "upgrade_pulse", status: "completed" });
    expect(parseHostedRuntimeSubscriptionToolResponse({
      action: "upgrade_edge",
      plan: EDGE_PLAN,
      status: "pending",
    })).toMatchObject({ status: "pending" });
  });

  it("allows an HTTPS payment URL only when payment is required", () => {
    expect(parseHostedRuntimeSubscriptionToolResponse({
      action: "upgrade_edge",
      paymentUrl: "https://billing.stripe.com/example",
      plan: EDGE_PLAN,
      status: "payment_required",
    })).toMatchObject({
      paymentUrl: "https://billing.stripe.com/example",
      status: "payment_required",
    });

    expect(() => parseHostedRuntimeSubscriptionToolResponse({
      action: "upgrade_edge",
      plan: EDGE_PLAN,
      status: "payment_required",
    })).toThrow();
    expect(() => parseHostedRuntimeSubscriptionToolResponse({
      action: "upgrade_edge",
      paymentUrl: "http://billing.example.test/pay",
      plan: EDGE_PLAN,
      status: "payment_required",
    })).toThrow();
    expect(() => parseHostedRuntimeSubscriptionToolResponse({
      action: "upgrade_edge",
      paymentUrl: "https://billing.stripe.com/unneeded",
      plan: EDGE_PLAN,
      status: "completed",
    })).toThrow();
  });

  it("rejects incoherent action and plan pairs", () => {
    expect(() => parseHostedRuntimeSubscriptionToolResponse({
      action: "continue_pulse",
      plan: EDGE_PLAN,
      status: "no_action_required",
    })).toThrow();
    expect(() => parseHostedRuntimeSubscriptionToolResponse({
      action: "upgrade_pulse",
      plan: EDGE_PLAN,
      status: "completed",
    })).toThrow();
    expect(() => parseHostedRuntimeSubscriptionToolResponse({
      action: "upgrade_edge",
      plan: PULSE_PLAN,
      status: "completed",
    })).toThrow();
  });
});
