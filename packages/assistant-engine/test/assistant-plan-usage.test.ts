import { describe, expect, it, vi } from "vitest";

import {
  executeMurphDynamicToolRequest,
  MURPH_PLAN_USAGE_TOOL,
  readMurphDynamicToolRequest,
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
      "explicit plan, usage, billing request",
    );
    expect(MURPH_PLAN_USAGE_TOOL.description).toContain(
      "trusted low-usage context",
    );
    expect(MURPH_PLAN_USAGE_TOOL.description).toContain(
      "This is read-only",
    );
    expect(MURPH_PLAN_USAGE_TOOL.description).toContain(
      "overall AI-usage projection",
    );
    expect(MURPH_PLAN_USAGE_TOOL.description).toContain(
      "not an included/purchased split",
    );
  });

  it("exposes the tool only when the hosted read port is available", () => {
    expect(resolveMurphDynamicTools({ planUsageAvailable: true }))
      .toContain(MURPH_PLAN_USAGE_TOOL);
    expect(resolveMurphDynamicTools({ planUsageAvailable: false }))
      .not.toContain(MURPH_PLAN_USAGE_TOOL);
  });

  it("accepts empty arguments and returns the bound member's overall projection", async () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {},
        namespace: "murph",
        tool: "plan_usage",
      },
    });
    expect(request).toEqual({ kind: "plan-usage" });
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
          kind: "upgrade_edge" as const,
          label: "Upgrade to Edge",
          url: "https://example.test/settings#subscription",
        },
        subscriptionActionQuote: {
          action: "upgrade_edge" as const,
          label: "Upgrade to Edge ($20/month)",
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

    expect(planUsageTool.read).toHaveBeenCalledOnce();
    expect(result.rpcResult.success).toBe(true);
    const resultText = result.rpcResult.contentItems[0]?.text;
    expect(resultText).toContain('"usedPercent":76');
    expect(resultText).toContain('"remainingPercent":24');
    expect(resultText).not.toContain('"included');
    expect(resultText).not.toContain('"purchased');
    expect(resultText).toContain("upgrade_edge");
    expect(resultText).toContain(
      '"label":"Upgrade to Edge ($20/month)"',
    );
  });

  it("rejects extra arguments", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { memberId: "member_other" },
        namespace: "murph",
        tool: "plan_usage",
      },
    })?.kind).toBe("invalid-plan-usage-arguments");
  });

  it("does not expose hosted read failures", async () => {
    const backendError = "sensitive usage-store failure detail";
    const request = readMurphDynamicToolRequest({
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
    const request = readMurphDynamicToolRequest({
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
