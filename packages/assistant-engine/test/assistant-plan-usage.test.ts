import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from "vitest";

import {
  executeMurphDynamicToolRequest,
  MURPH_PLAN_USAGE_TOOL,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import type {
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.js";

describe("assistant plan usage tool", () => {
  it("advertises the private read and immediate authorization boundary", () => {
    expect(MURPH_PLAN_USAGE_TOOL.description).toContain(
      "current private hosted plan",
    );
    expect(MURPH_PLAN_USAGE_TOOL.description).toContain(
      "explicit plan, usage, billing",
    );
    expect(MURPH_PLAN_USAGE_TOOL.description).toContain(
      "trusted low-usage context",
    );
    expect(MURPH_PLAN_USAGE_TOOL.description).toContain(
      "Read-only",
    );
    expect(MURPH_PLAN_USAGE_TOOL.description).toContain(
      "AI-usage",
    );
    expect(MURPH_PLAN_USAGE_TOOL.description).toContain(
      "without credit-source splits",
    );
    expect(MURPH_PLAN_USAGE_TOOL.description).not.toContain(
      "included/purchased",
    );
  });

  it("exposes the tool only when the hosted read port is available", () => {
    expect(resolveMurphDynamicTools({ planUsageAvailable: true }))
      .toContain(MURPH_PLAN_USAGE_TOOL);
    expect(resolveMurphDynamicTools({ planUsageAvailable: false }))
      .not.toContain(MURPH_PLAN_USAGE_TOOL);
  });

  it("accepts empty arguments and returns the bound member's overall projection", async () => {
    const request = readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {},
        namespace: "murph",
        tool: "plan_usage",
      },
    });
    expect(request).toEqual({
      kind: "plan-usage",
      request: {
        includeSubscriptionActionQuote: true,
      },
    });
    if (!request) {
      throw new Error("Expected a plan usage dynamic tool request.");
    }

    const planUsageTool = {
      read: vi.fn(async () => ({
        accessKind: "paid" as const,
        forecast: null,
        generatedAt: "2026-07-03T12:00:00.000Z",
        periodEnd: "2026-08-01T00:00:00.000Z",
        periodKind: "monthly" as const,
        periodStart: "2026-07-01T00:00:00.000Z",
        planCode: "launch_monthly" as const,
        planName: "Pulse" as const,
        recommendedAction: {
          kind: "change_plan" as const,
          label: "Upgrade to Edge ($20/month)",
          targetPlanCode: "launch_edge_monthly" as const,
          url: "https://example.test/settings#subscription",
        },
        subscriptionActionQuote: {
          action: "change_plan" as const,
          expiresAt: "2026-07-03T12:10:00.000Z",
          label: "Upgrade to Edge ($20/month)",
          monthlyPriceUsdCents: 2_000,
          quoteId: "quote_test_edge",
          targetPlanCode: "launch_edge_monthly" as const,
          timing: "immediate" as const,
        },
        remainingPercent: 24,
        status: "active" as const,
        usedPercent: 76,
      })),
    };
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: buildHostedToolContext(planUsageTool),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(planUsageTool.read).toHaveBeenCalledWith({
      includeSubscriptionActionQuote: true,
    });
    expect(result.rpcResult.success).toBe(true);
    const resultText = result.rpcResult.contentItems[0]?.text;
    expect(resultText).toContain('"usedPercent":76');
    expect(resultText).toContain('"remainingPercent":24');
    expect(resultText).not.toContain('"included');
    expect(resultText).not.toContain('"usageCredit');
    expect(resultText).not.toContain('"purchase');
    expect(resultText).not.toContain('"referral');
    expect(resultText).toContain("change_plan");
    expect(resultText).toContain(
      '"label":"Upgrade to Edge ($20/month)"',
    );
  });

  it("projects the legacy Group wire name as Core for the assistant", async () => {
    const request = readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          targetPlanCode: "launch_group_monthly",
        },
        namespace: "murph",
        tool: "plan_usage",
      },
    });
    if (!request) {
      throw new Error("Expected a plan usage dynamic tool request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: buildHostedToolContext({
        read: vi.fn(async () => ({
          accessKind: "paid" as const,
          availablePlans: [
            {
              code: "launch_group_monthly" as const,
              displayName: "Group" as const,
              monthlyPriceUsdCents: 350,
              selectable: true as const,
            },
          ],
          forecast: null,
          generatedAt: "2026-07-30T12:00:00.000Z",
          periodEnd: "2026-08-30T12:00:00.000Z",
          periodKind: "monthly" as const,
          periodStart: "2026-07-30T12:00:00.000Z",
          planCode: "launch_group_monthly" as const,
          planName: "Group" as const,
          recommendedAction: {
            kind: "change_plan" as const,
            label: "Choose Group next month",
            targetPlanCode: "launch_group_monthly" as const,
            url: "https://example.test/settings#subscription",
          },
          remainingPercent: 50,
          scheduledPlan: {
            code: "launch_group_monthly" as const,
            displayName: "Group" as const,
            effectiveAt: "2026-08-30T12:00:00.000Z",
          },
          status: "active" as const,
          subscriptionActionQuote: {
            action: "change_plan" as const,
            expiresAt: "2026-07-30T12:10:00.000Z",
            label: "Choose Group after your trial ($3.50/month)",
            monthlyPriceUsdCents: 350,
            quoteId: "quote_test_group",
            targetPlanCode: "launch_group_monthly" as const,
            timing: "period_end" as const,
          },
          usedPercent: 50,
        })),
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    const resultText = result.rpcResult.contentItems[0]?.text ?? "";
    expect(result.rpcResult.success).toBe(true);
    expect(resultText).toContain('"planName":"Core"');
    expect(resultText).toContain('"displayName":"Core"');
    expect(resultText).toContain('"label":"Choose Core next month"');
    expect(resultText).toContain(
      '"label":"Choose Core after your trial ($3.50/month)"',
    );
    expect(resultText).not.toMatch(/\bGroup\b/u);
  });

  it("rejects extra arguments", () => {
    expect(readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { memberId: "member_other" },
        namespace: "murph",
        tool: "plan_usage",
      },
    })?.kind).toBe("invalid-plan-usage-arguments");
  });

  it("requests a quote only for an explicit direct plan target", () => {
    expect(readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          targetPlanCode: "launch_group_monthly",
        },
        namespace: "murph",
        tool: "plan_usage",
      },
    })).toEqual({
      kind: "plan-usage",
      request: {
        includeSubscriptionActionQuote: true,
        subscriptionActionTargetPlanCode: "launch_group_monthly",
      },
    });
  });

  it("does not expose hosted read failures", async () => {
    const backendError = "sensitive usage-store failure detail";
    const request = readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {},
        namespace: "murph",
        tool: "plan_usage",
      },
    });
    if (!request) {
      throw new Error("Expected a plan usage dynamic tool request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: buildHostedToolContext({
        read: vi.fn(async () => {
          throw new Error(backendError);
        }),
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    const publicMessage = result.rpcResult.contentItems[0]?.text;
    expect(result.rpcResult.success).toBe(false);
    expect(publicMessage).toBe("plan usage could not be read");
    expect(publicMessage).not.toContain(backendError);
  });

  it("fails safely when the hosted read port is absent", async () => {
    const request = readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {},
        namespace: "murph",
        tool: "plan_usage",
      },
    });
    if (!request) {
      throw new Error("Expected a plan usage dynamic tool request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: buildHostedToolContext(null),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toContain("unavailable");
  });
});

function buildHostedToolContext(
  planUsageTool: AssistantHostedToolContext["planUsageTool"],
): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    planUsageTool,
    sendVaultFile: vi.fn(async () => ({
      approvalUrl: "https://example.test/approval/unused",
      filename: "unused.pdf",
      status: "pending" as const,
    })),
    vaultFileSendAvailable: false,
  };
}
