import { describe, expect, it, vi } from "vitest";

import {
  executeMurphDynamicToolRequest,
  MURPH_SUBSCRIPTION_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import type {
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.js";

describe("assistant subscription tool", () => {
  it("is default-off and requires explicit availability", () => {
    expect(resolveMurphDynamicTools({ subscriptionAvailable: true }))
      .toContain(MURPH_SUBSCRIPTION_TOOL);
    expect(resolveMurphDynamicTools({ subscriptionAvailable: false }))
      .not.toContain(MURPH_SUBSCRIPTION_TOOL);
    expect(resolveMurphDynamicTools({}))
      .not.toContain(MURPH_SUBSCRIPTION_TOOL);
  });

  it.each([
    "continue_pulse",
    "start_pulse_now",
    "upgrade_edge",
  ] as const)("accepts the closed %s action", (action) => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { action },
        namespace: "murph",
        tool: "subscription",
      },
    })).toEqual({
      kind: "subscription",
      request: { action },
    });
  });

  it("keeps input authority out of model arguments", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "continue_pulse",
          assistantInputId: `ain_${"f".repeat(32)}`,
        },
        namespace: "murph",
        tool: "subscription",
      },
    })?.kind).toBe("invalid-subscription-arguments");
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { action: "cancel" },
        namespace: "murph",
        tool: "subscription",
      },
    })?.kind).toBe("invalid-subscription-arguments");
  });

  it("injects the current accepted input ID and returns server-owned plan facts", async () => {
    const assistantInputId = `ain_${"a".repeat(32)}`;
    const subscriptionTool = {
      request: vi.fn(async () => ({
        action: "continue_pulse" as const,
        plan: {
          code: "launch_monthly" as const,
          displayName: "Pulse" as const,
          interval: "month" as const,
          recurringAmountUsdCents: 800,
        },
        status: "no_action_required" as const,
      })),
    };
    const request = readSubscriptionRequest("continue_pulse");

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantInputId,
        subscriptionTool,
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(subscriptionTool.request).toHaveBeenCalledWith({
      action: "continue_pulse",
      assistantInputId,
    });
    expect(result.rpcResult.success).toBe(true);
    expect(JSON.parse(readToolText(result))).toEqual({
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

  it("fails closed before transport when current input authority is absent", async () => {
    const subscriptionTool = { request: vi.fn() };
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantInputId: null,
        subscriptionTool,
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: readSubscriptionRequest("upgrade_edge"),
    });

    expect(subscriptionTool.request).not.toHaveBeenCalled();
    expect(result.rpcResult.success).toBe(false);
    expect(readToolText(result)).toContain("current user-sourced input");
  });

  it("rejects a generic current input that is not the eligible user-action input", async () => {
    const subscriptionTool = { request: vi.fn() };
    const hostedToolContext = createHostedToolContext({
      assistantInputId: `ain_${"c".repeat(32)}`,
      subscriptionTool,
      userActionAssistantInputId: null,
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: readSubscriptionRequest("start_pulse_now"),
    });

    expect(hostedToolContext.currentAssistantInputId?.()).toBe(
      `ain_${"c".repeat(32)}`,
    );
    expect(subscriptionTool.request).not.toHaveBeenCalled();
    expect(result.rpcResult.success).toBe(false);
  });

  it("does not expose transport failures", async () => {
    const sensitiveDetail = "sensitive Stripe customer detail";
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantInputId: `ain_${"b".repeat(32)}`,
        subscriptionTool: {
          request: vi.fn(async () => {
            throw new Error(sensitiveDetail);
          }),
        },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: readSubscriptionRequest("start_pulse_now"),
    });

    expect(result.rpcResult.success).toBe(false);
    expect(readToolText(result)).toBe("subscription action could not be completed");
    expect(readToolText(result)).not.toContain(sensitiveDetail);
  });

  it("states the conversational consent, copy, silence, and payment-link policy", () => {
    const guidance = MURPH_SUBSCRIPTION_TOOL.description;

    expect(guidance).toContain("current user made in the current turn");
    expect(guidance).toContain("explicitly and unambiguously chose");
    expect(guidance).toContain(
      "require a current murph.plan_usage subscriptionActionQuote whose action exactly matches",
    );
    expect(guidance).toContain("A quote is not a recommendation or consent");
    expect(guidance).toContain("Never use post-action response facts as the first disclosure");
    expect(guidance).toContain("bare “yes” is not consent");
    expect(guidance).toContain(
      "Use continue_pulse only when the current murph.plan_usage result confirms an active trial",
    );
    expect(guidance).toContain(
      "trial_conversion_pending or an ended trial, do not use continue_pulse",
    );
    expect(guidance).toContain("one short reply-oriented question and include no URL");
    expect(guidance).toContain("should we part ways?");
    expect(guidance).toContain("say nothing");
    expect(guidance).toContain(
      "a less capable model that uses less of your included usage",
    );
    expect(guidance).toContain("Do not assume the member knows Luna, Terra, or Sol");
    expect(guidance).toContain("Never switch models automatically");
    expect(guidance).toContain(
      "returned plan facts only to acknowledge its result",
    );
    expect(guidance).toContain(
      "Send the returned paymentUrl only when status is payment_required",
    );
    expect(guidance).toContain(
      "For no_action_required, stay silent unless answering the member's explicit request",
    );
    expect(guidance).toContain(
      "when directly acknowledging continue_pulse, keep it brief and include no explanation or link",
    );
    expect(guidance).toContain(
      "Never call a payment method verified or guarantee a future charge",
    );
  });
});

function readSubscriptionRequest(
  action: "continue_pulse" | "start_pulse_now" | "upgrade_edge",
) {
  const request = readMurphDynamicToolRequest({
    method: "item/tool/call",
    params: {
      arguments: { action },
      namespace: "murph",
      tool: "subscription",
    },
  });
  if (!request || request.kind !== "subscription") {
    throw new Error("Expected a subscription dynamic tool request.");
  }
  return request;
}

function createHostedToolContext(input: {
  assistantInputId: string | null;
  subscriptionTool: NonNullable<AssistantHostedToolContext["subscriptionTool"]>;
  userActionAssistantInputId?: string | null;
}): AssistantHostedToolContext {
  let subscriptionActionClaimed = false;
  return {
    claimSubscriptionAssistantInputId: () => {
      if (subscriptionActionClaimed) {
        return null;
      }
      const assistantInputId = input.userActionAssistantInputId === undefined
        ? input.assistantInputId
        : input.userActionAssistantInputId;
      if (assistantInputId === null) {
        return null;
      }
      subscriptionActionClaimed = true;
      return assistantInputId;
    },
    computerToolsAvailable: false,
    currentAssistantInputId: () => input.assistantInputId,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    sendVaultFile: vi.fn(async () => ({
      approvalUrl: "https://example.test/approval/unused",
      filename: "unused.pdf",
      status: "pending" as const,
    })),
    subscriptionTool: input.subscriptionTool,
    vaultFileSendAvailable: false,
  };
}

function readToolText(
  result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>,
): string {
  const text = result.rpcResult.contentItems[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Expected subscription tool text output.");
  }
  return text;
}
