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
            planCode: "max",
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
          planCode: "max",
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
            planCode: "max" as const,
            status: "pending",
            targetLabel: "dad",
            targetPhoneHint: "+48 *** *** 000",
            telegramInviteUrl: "https://t.me/murphdevbot?start=family_token",
          },
          plans: {
            edge: {
              active: 0,
              billed: 0,
              invited: 0,
              remaining: 0,
              used: 0,
            },
            max: {
              active: 0,
              billed: 1,
              invited: 1,
              remaining: 0,
              used: 1,
            },
            pulse: {
              active: 1,
              billed: 1,
              invited: 0,
              remaining: 0,
              used: 1,
            },
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
        planCode: "max",
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
  });

  it("parses and executes Family checkout without invitation context", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "start_checkout",
        },
        namespace: "murph",
        tool: "family_plan",
      },
    });

    expect(request).toEqual({
      kind: "family-plan",
      request: {
        action: "start_checkout",
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
          plans: {
            edge: {
              active: 0,
              billed: 0,
              invited: 0,
              remaining: 0,
              used: 0,
            },
            max: {
              active: 0,
              billed: 0,
              invited: 0,
              remaining: 0,
              used: 0,
            },
            pulse: {
              active: 1,
              billed: 2,
              invited: 0,
              remaining: 1,
              used: 1,
            },
          },
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
    });
    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain("checkout.stripe.test/family");
  });

  it("preserves explicit active-trial conversion consent for Family checkout", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "start_checkout",
          confirmedTrialConversion: true,
        },
        namespace: "murph",
        tool: "family_plan",
      },
    })).toEqual({
      kind: "family-plan",
      request: {
        action: "start_checkout",
        confirmedTrialConversion: true,
      },
    });

    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "start_checkout",
          confirmedTrialConversion: false,
        },
        namespace: "murph",
        tool: "family_plan",
      },
    })?.kind).toBe("invalid-family-plan-arguments");
  });

  it("rejects invitation context on Family checkout", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "start_checkout",
          invite: {
            planCode: "max",
            targetEmail: "dad@example.com",
          },
        },
        namespace: "murph",
        tool: "family_plan",
      },
    })?.kind).toBe("invalid-family-plan-arguments");
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

  it("reports ambiguous Family mutations as unconfirmed without encouraging a duplicate", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "create_invite",
          invite: {
            planCode: "max",
            targetEmail: "dad@example.com",
          },
        },
        namespace: "murph",
        tool: "family_plan",
      },
    });
    if (!request) {
      throw new Error("Expected a family plan dynamic tool request.");
    }

    const familyPlanTool = {
      request: vi.fn(async () => {
        throw new Error("ambiguous transport result");
      }),
    };
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: {
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
      },
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(familyPlanTool.request).toHaveBeenCalledTimes(1);
    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "request was not confirmed",
    );
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "check Family Settings before retrying",
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toContain(
      "request failed",
    );
  });

  it("reports a failed Family status read as retry-safe with no possible change", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "read_status",
        },
        namespace: "murph",
        tool: "family_plan",
      },
    });
    if (!request) {
      throw new Error("Expected a family plan dynamic tool request.");
    }

    const familyPlanTool = {
      request: vi.fn(async () => {
        throw new Error("status transport unavailable");
      }),
    };
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: {
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
      },
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(familyPlanTool.request).toHaveBeenCalledWith({
      action: "read_status",
    });
    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "no change was attempted",
    );
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "retry the status read",
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toContain("duplicate");
    expect(result.rpcResult.contentItems[0]?.text).not.toContain(
      "Family Settings",
    );
  });
});
