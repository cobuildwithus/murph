import { describe, expect, it, vi } from "vitest";

import {
  executeMurphDynamicToolRequest,
  MURPH_FAMILY_PLAN_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import {
  type AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.js";

describe("assistant family plan tool", () => {
  it("exposes the dynamic tool only when the hosted family plan port is available", () => {
    expect(resolveMurphDynamicTools({
      familyPlanAvailable: true,
    })).toContain(MURPH_FAMILY_PLAN_TOOL);
    expect(resolveMurphDynamicTools({
      familyPlanAvailable: false,
    })).not.toContain(MURPH_FAMILY_PLAN_TOOL);
  });

  it("parses and executes structured family invite requests", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "create_invite",
          invite: {
            targetLabel: "dad",
            targetPhoneNumber: "+48 600 000 000",
            targetTelegramUsername: "dad_username",
          },
        },
        namespace: "murph",
        tool: "family_plan",
      },
    });

    expect(request).toEqual({
      kind: "family-plan",
      request: {
        action: "create_invite",
        invite: {
          targetLabel: "dad",
          targetPhoneNumber: "+48 600 000 000",
          targetTelegramUsername: "dad_username",
        },
      },
    });
    if (!request) {
      throw new Error("Expected a family plan dynamic tool request.");
    }

    const familyPlanTool = {
      request: vi.fn(async () => ({
        action: "create_invite" as const,
        result: {
          invite: {
            acceptUrl: null,
            expiresAt: "2026-06-25T00:00:00.000Z",
            status: "pending",
            targetLabel: "dad",
            targetPhoneHint: "+48 *** *** 000",
            telegramInviteUrl: "https://t.me/murphdevbot?start=family_token",
          },
          replyText: "Done. I prepared a Murph Family invite for dad.",
          seats: {
            active: 1,
            billed: 2,
            invited: 1,
            max: 6,
            min: 2,
            remaining: 0,
            used: 2,
          },
        },
      })),
    };
    const hostedToolContext: AssistantHostedToolContext = {
      computerToolsAvailable: false,
      familyPlanTool,
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      requiredUserMessageDeliveryAvailable: false,
      sendRequiredUserMessage: async () => ({
        kind: "failed",
        source: "model",
      }),
    };

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(familyPlanTool.request).toHaveBeenCalledWith({
      action: "create_invite",
      invite: {
        targetLabel: "dad",
        targetPhoneNumber: "+48 600 000 000",
        targetTelegramUsername: "dad_username",
      },
    });
    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain("Murph Family invite");
  });

  it("parses and executes Family checkout requests with optional next invite context", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "start_checkout",
          invite: {
            targetLabel: "Adam",
            targetPhoneNumber: null,
            targetTelegramUsername: "adam_username",
          },
        },
        namespace: "murph",
        tool: "family_plan",
      },
    });

    expect(request).toEqual({
      kind: "family-plan",
      request: {
        action: "start_checkout",
        invite: {
          targetLabel: "Adam",
          targetPhoneNumber: null,
          targetTelegramUsername: "adam_username",
        },
      },
    });
    if (!request) {
      throw new Error("Expected a family plan dynamic tool request.");
    }

    const familyPlanTool = {
      request: vi.fn(async () => ({
        action: "start_checkout" as const,
        result: {
          alreadyActive: false,
          billingActive: false,
          billingStatus: "not_started",
          checkoutUrl: "https://checkout.stripe.test/family",
          owner: true,
          preparedInvite: {
            acceptUrl: null,
            expiresAt: "2026-06-25T00:00:00.000Z",
            status: "pending",
            targetLabel: "Adam",
            targetPhoneHint: null,
            telegramInviteUrl: "https://t.me/murphdevbot?start=family_token",
          },
          preparedInviteReplyText: "Done. I prepared a Murph Family invite for Adam.",
          seats: {
            active: 1,
            billed: 2,
            invited: 0,
            max: 6,
            min: 2,
            remaining: 1,
            used: 1,
          },
          unavailableReason: null,
        },
      })),
    };
    const hostedToolContext: AssistantHostedToolContext = {
      computerToolsAvailable: false,
      familyPlanTool,
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      requiredUserMessageDeliveryAvailable: false,
      sendRequiredUserMessage: async () => ({
        kind: "failed",
        source: "model",
      }),
    };

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(familyPlanTool.request).toHaveBeenCalledWith({
      action: "start_checkout",
      invite: {
        targetLabel: "Adam",
        targetPhoneNumber: null,
        targetTelegramUsername: "adam_username",
      },
    });
    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain("checkout.stripe.test/family");
  });

  it("rejects invite requests without a phone number or Telegram username", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "create_invite",
          invite: {
            targetLabel: "dad",
          },
        },
        namespace: "murph",
        tool: "family_plan",
      },
    })?.kind).toBe("invalid-family-plan-arguments");
  });
});
