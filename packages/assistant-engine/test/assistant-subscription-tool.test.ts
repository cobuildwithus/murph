import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from "vitest";

import {
  executeMurphDynamicToolRequest,
  MURPH_SUBSCRIPTION_TOOL,
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
  ] as const)("keeps legacy %s parsing only for backend compatibility", (action) => {
    expect(readTestMurphDynamicToolRequest({
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

  it("exposes only signed change_plan to the model", () => {
    expect(MURPH_SUBSCRIPTION_TOOL.inputSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        action: {
          enum: ["change_plan"],
        },
      },
      required: ["action", "targetPlanCode", "quoteId"],
      type: "object",
    });
    expect(JSON.stringify(MURPH_SUBSCRIPTION_TOOL.inputSchema))
      .not.toMatch(/continue_pulse|start_pulse_now|upgrade_edge/u);
  });

  it("keeps input authority out of model arguments", () => {
    expect(readTestMurphDynamicToolRequest({
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
    expect(readTestMurphDynamicToolRequest({
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

  it("projects the legacy Group wire name as Core for the assistant", async () => {
    const assistantInputId = `ain_${"e".repeat(32)}`;
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantInputId,
        subscriptionTool: {
          request: vi.fn(async () => ({
            action: "change_plan" as const,
            effectiveAt: "2026-08-30T12:00:00.000Z",
            plan: {
              code: "launch_group_monthly" as const,
              displayName: "Group" as const,
              interval: "month" as const,
              recurringAmountUsdCents: 350,
            },
            status: "scheduled" as const,
          })),
        },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: readQuotedSubscriptionRequest(),
    });

    expect(result.rpcResult.success).toBe(true);
    expect(JSON.parse(readToolText(result))).toMatchObject({
      plan: {
        code: "launch_group_monthly",
        displayName: "Core",
      },
      status: "scheduled",
    });
    expect(readToolText(result)).not.toMatch(/\bGroup\b/u);
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

  it("turns stale quotes into a fresh-terms recovery without exposing details", async () => {
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        assistantInputId: `ain_${"d".repeat(32)}`,
        subscriptionTool: {
          request: vi.fn(async () => {
            throw Object.assign(new Error("private billing state"), {
              code: "HOSTED_BILLING_PLAN_QUOTE_STALE",
            });
          }),
        },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: readQuotedSubscriptionRequest(),
    });

    expect(result.rpcResult.success).toBe(false);
    expect(readToolText(result)).toContain("call plan_usage again");
    expect(readToolText(result)).toContain("fresh confirmation");
    expect(readToolText(result)).not.toContain("private billing state");
  });

  it("states current-turn authority and scheduled-result semantics", () => {
    const contract = MURPH_SUBSCRIPTION_TOOL.description;

    expect(contract.length).toBeLessThanOrEqual(640);
    expect(contract).toContain("explicitly confirmed by the current user in this turn");
    expect(contract).toContain("a different target requires new eligible user input");
    expect(contract).toContain("scheduled result includes authoritative effectiveAt");
    expect(contract).toContain("Only payment_required includes paymentUrl");
    expect(contract).toContain("other results do not prove a payment method");
  });
});

function readSubscriptionRequest(
  action: "continue_pulse" | "start_pulse_now" | "upgrade_edge",
) {
  const request = readTestMurphDynamicToolRequest({
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

function readQuotedSubscriptionRequest() {
  const request = readTestMurphDynamicToolRequest({
    method: "item/tool/call",
    params: {
      arguments: {
        action: "change_plan",
        quoteId: "quote_group_123",
        targetPlanCode: "launch_group_monthly",
      },
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
