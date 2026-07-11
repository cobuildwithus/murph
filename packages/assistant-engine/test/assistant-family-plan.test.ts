import { describe, expect, it, vi } from "vitest";

import {
  executeMurphDynamicToolRequest,
  MURPH_BILLING_PLAN_TOOL,
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
    expect(MURPH_FAMILY_PLAN_TOOL.description).toContain("confirmed=false");
    expect(MURPH_FAMILY_PLAN_TOOL.description).toContain("confirmation_required");
    expect(MURPH_FAMILY_PLAN_TOOL.description).toContain("approval_required");
    expect(MURPH_FAMILY_PLAN_TOOL.description).toContain("approval_expired can also mean another execution consumed");
    expect(MURPH_FAMILY_PLAN_TOOL.description).toContain("outcome is uncertain");
    expect(MURPH_FAMILY_PLAN_TOOL.description).toContain("pending means initiated but not yet reconciled");
    expect(MURPH_FAMILY_PLAN_TOOL.description).toContain("unchanged means the requested state already existed");
  });

  it("exposes strict action-discriminated Family schemas", () => {
    const branches = MURPH_FAMILY_PLAN_TOOL.inputSchema.oneOf;
    expect(branches).toHaveLength(6);
    expect(branches.every((branch) => branch.additionalProperties === false)).toBe(true);
    expect(branches.find((branch) => branch.properties.action.const === "read_status"))
      .toMatchObject({ required: ["action"] });
    expect(branches.find((branch) => branch.properties.action.const === "change_seat_count"))
      .toMatchObject({
        required: ["action", "confirmed", "seatCount"],
        properties: { confirmed: { type: "boolean" } },
      });
    const schema = JSON.stringify(MURPH_FAMILY_PLAN_TOOL.inputSchema);
    expect(schema).toContain('"required":["targetEmail"]');
    expect(schema).toContain('"required":["targetPhoneNumber"]');
    expect(schema).toContain('"required":["targetTelegramUsername"]');
    expect(schema).toContain('^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$');
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
      sendVaultFile: vi.fn(async () => ({
        approvalUrl: "https://murph.test/approve/unused",
        filename: "unused.pdf",
        status: "pending" as const,
      })),
      vaultFileSendAvailable: false,
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

  it("parses email-only family invite requests", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "create_invite",
          invite: {
            targetEmail: "dad@example.com",
            targetLabel: "dad",
            targetPhoneNumber: null,
            targetTelegramUsername: null,
          },
        },
        namespace: "murph",
        tool: "family_plan",
      },
    })).toEqual({
      kind: "family-plan",
      request: {
        action: "create_invite",
        invite: {
          targetEmail: "dad@example.com",
          targetLabel: "dad",
          targetPhoneNumber: null,
          targetTelegramUsername: null,
        },
      },
    });
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "create_invite",
          invite: { targetEmail: "not-an-email" },
        },
        namespace: "murph",
        tool: "family_plan",
      },
    })?.kind).toBe("invalid-family-plan-arguments");
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
      sendVaultFile: vi.fn(async () => ({
        approvalUrl: "https://murph.test/approve/unused",
        filename: "unused.pdf",
        status: "pending" as const,
      })),
      vaultFileSendAvailable: false,
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

  it("rejects invite requests without a phone number, Telegram username, or email", () => {
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

  it("requires a confirmation decision and preserves Family preview requests", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "remove_member",
          memberId: "member_sponsored",
        },
        namespace: "murph",
        tool: "family_plan",
      },
    })?.kind).toBe("invalid-family-plan-arguments");
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "remove_member",
          confirmed: false,
          memberId: "member_sponsored",
        },
        namespace: "murph",
        tool: "family_plan",
      },
    })).toEqual({
      kind: "family-plan",
      request: {
        action: "remove_member",
        confirmed: false,
        memberId: "member_sponsored",
      },
    });
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "remove_member",
          confirmed: true,
          memberId: "member_sponsored",
        },
        namespace: "murph",
        tool: "family_plan",
      },
    })).toEqual({
      kind: "family-plan",
      request: {
        action: "remove_member",
        confirmed: true,
        memberId: "member_sponsored",
      },
    });
  });

  it("returns Family approval handoffs plainly and binds the return channel", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "change_seat_count",
          confirmed: true,
          seatCount: 4,
        },
        namespace: "murph",
        tool: "family_plan",
      },
    });
    if (!request) {
      throw new Error("Expected a Family plan dynamic tool request.");
    }
    const familyPlanTool = {
      request: vi.fn(async () => ({
        action: "change_seat_count" as const,
        result: {
          approvalUrl: "https://withmurph.ai/approve/family",
          expiresAt: "2026-07-10T16:15:00.000Z",
          status: "approval_required" as const,
        },
      })),
    };
    const hostedToolContext: AssistantHostedToolContext = {
      computerToolsAvailable: false,
      currentHostedDeliveryContext: () => ({
        conversationId: "conversation_1",
        recipientKey: "recipient_1",
        returnContactKind: "telegram",
      }),
      currentHostedMailboxItemIds: () => [],
      familyPlanTool,
      sendVaultFile: vi.fn(),
      vaultFileSendAvailable: false,
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
      action: "change_seat_count",
      confirmed: true,
      returnContactKind: "telegram",
      seatCount: 4,
    });
    expect(result.rpcResult.contentItems[0]?.text).toContain("approval_required");
    expect(result.rpcResult.contentItems[0]?.text)
      .toContain("https://withmurph.ai/approve/family");
  });
});

describe("assistant billing plan tool", () => {
  it("is hosted-only and requires a confirmation decision for mutations", () => {
    expect(resolveMurphDynamicTools({ billingPlanAvailable: true }))
      .toContain(MURPH_BILLING_PLAN_TOOL);
    expect(resolveMurphDynamicTools({ billingPlanAvailable: false }))
      .not.toContain(MURPH_BILLING_PLAN_TOOL);
    expect(MURPH_BILLING_PLAN_TOOL.description).toContain("confirmed=false");
    expect(MURPH_BILLING_PLAN_TOOL.description).toContain("confirmation_required");
    expect(MURPH_BILLING_PLAN_TOOL.description).toContain("approval_required");
    expect(MURPH_BILLING_PLAN_TOOL.description).toContain("approval_expired can also mean another execution consumed");
    expect(MURPH_BILLING_PLAN_TOOL.description).toContain("outcome is uncertain");
    expect(MURPH_BILLING_PLAN_TOOL.description).toContain("browser_handoff means the target change is not yet proven complete");

    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { action: "upgrade_to_edge" },
        namespace: "murph",
        tool: "billing_plan",
      },
    })?.kind).toBe("invalid-billing-plan-arguments");
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { action: "upgrade_to_edge", confirmed: false },
        namespace: "murph",
        tool: "billing_plan",
      },
    })).toEqual({
      kind: "billing-plan",
      request: { action: "upgrade_to_edge", confirmed: false },
    });
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { action: "upgrade_to_edge", confirmed: true },
        namespace: "murph",
        tool: "billing_plan",
      },
    })).toEqual({
      kind: "billing-plan",
      request: { action: "upgrade_to_edge", confirmed: true },
    });
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { action: "read_status" },
        namespace: "murph",
        tool: "billing_plan",
      },
    })).toEqual({
      kind: "billing-plan",
      request: { action: "read_status" },
    });
  });

  it("exposes strict monetary action schemas and returns the approval handoff plainly", async () => {
    const branches = MURPH_BILLING_PLAN_TOOL.inputSchema.oneOf;
    expect(branches).toHaveLength(5);
    expect(branches.every((branch) => branch.additionalProperties === false)).toBe(true);
    expect(branches.find((branch) => branch.properties.action.const === "open_portal"))
      .toMatchObject({ required: ["action"] });
    expect(branches.find((branch) => branch.properties.action.const === "upgrade_to_edge"))
      .toMatchObject({
        required: ["action", "confirmed"],
        properties: { confirmed: { type: "boolean" } },
      });

    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { action: "upgrade_to_edge", confirmed: true },
        namespace: "murph",
        tool: "billing_plan",
      },
    });
    if (!request) {
      throw new Error("Expected a billing plan dynamic tool request.");
    }
    const billingPlanTool = {
      request: vi.fn(async () => ({
        action: "upgrade_to_edge" as const,
        result: {
          approvalUrl: "https://withmurph.ai/approve/billing",
          expiresAt: "2026-07-10T16:15:00.000Z",
          status: "approval_required" as const,
        },
      })),
    };
    const hostedToolContext: AssistantHostedToolContext = {
      billingPlanTool,
      computerToolsAvailable: false,
      currentHostedDeliveryContext: () => ({
        conversationId: "conversation_1",
        recipientKey: "recipient_1",
        returnContactKind: "text",
      }),
      currentHostedMailboxItemIds: () => [],
      sendVaultFile: vi.fn(),
      vaultFileSendAvailable: false,
    };

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(billingPlanTool.request).toHaveBeenCalledWith({
      action: "upgrade_to_edge",
      confirmed: true,
      returnContactKind: "text",
    });
    expect(result.rpcResult.contentItems[0]?.text).toContain("approval_required");
    expect(result.rpcResult.contentItems[0]?.text)
      .toContain("https://withmurph.ai/approve/billing");
  });
});
