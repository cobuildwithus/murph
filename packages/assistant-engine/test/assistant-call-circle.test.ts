import { describe, expect, it, vi } from "vitest";

import {
  MURPH_CALL_CIRCLE_RESPOND_TOOL,
} from "../src/assistant-codex/dynamic-tools/call-circle.js";
import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import type {
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.js";

const REQUEST = {
  groupId: "hgrp_123",
  kind: "confirm",
  matchId: "hccm_123",
  side: "A",
} as const;

describe("assistant Call Circle dynamic tool", () => {
  it("exposes the response tool only when Call Circle transport is available", () => {
    expect(resolveMurphDynamicTools({
      callCircleAvailable: true,
    })).toContain(MURPH_CALL_CIRCLE_RESPOND_TOOL);
    expect(resolveMurphDynamicTools({
      callCircleAvailable: false,
    })).not.toContain(MURPH_CALL_CIRCLE_RESPOND_TOOL);
    expect(MURPH_CALL_CIRCLE_RESPOND_TOOL.description).toContain(
      "Never record an answer for another person",
    );
  });

  it("parses and executes member-owned responses through the hosted transport", async () => {
    const respond = vi.fn(async (request) => {
      expect(request).toEqual(REQUEST);
      return { status: "ok" as const };
    });
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: REQUEST,
      tool: MURPH_CALL_CIRCLE_RESPOND_TOOL.name,
    }));
    if (!request || request.kind !== "call-circle-respond") {
      throw new Error("Expected Call Circle response request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        callCircle: { respond },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(respond).toHaveBeenCalledTimes(1);
    expect(result.rpcResult).toMatchObject({ success: true });
  });
});

function dynamicToolCall(input: {
  argumentsValue: unknown;
  tool: string;
}): Record<string, unknown> {
  return {
    method: "item/tool/call",
    params: {
      arguments: input.argumentsValue,
      namespace: "murph",
      tool: input.tool,
    },
  };
}

function createHostedToolContext(input: {
  callCircle?: AssistantHostedToolContext["callCircle"];
}): AssistantHostedToolContext {
  return {
    callCircle: input.callCircle ?? null,
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    sendVaultFile: vi.fn(async () => {
      throw new Error("Vault-file sending is unavailable for this turn.");
    }),
    vaultFileSendAvailable: false,
  };
}
