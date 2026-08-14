import { describe, expect, it, vi } from "vitest";

import type {
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.ts";
import {
  executeMurphDynamicToolRequest,
  MURPH_GROUP_TOOL,
  readMurphDynamicToolRequest,
} from "../src/assistant-codex/dynamic-tools.ts";

const SELECTED_INPUT_ID = `ain_${"a".repeat(32)}`;
const OTHER_INPUT_ID = `ain_${"b".repeat(32)}`;

function groupToolCall(argumentsValue: unknown): Record<string, unknown> {
  return {
    id: "request-test",
    method: "item/tool/call",
    params: {
      arguments: argumentsValue,
      callId: "call-test",
      namespace: "murph",
      threadId: "thread-test",
      tool: MURPH_GROUP_TOOL.name,
      turnId: "turn-test",
    },
  };
}

function createHostedToolContext(input: {
  acceptedInputIds?: readonly string[];
  conversationScope?: "direct" | "group";
  currentInvocationScope?: AssistantHostedToolContext["currentInvocationScope"];
  request?: NonNullable<AssistantHostedToolContext["groupTool"]>["request"];
} = {}): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentInvocationScope: input.currentInvocationScope ?? (() => null),
    currentUserActionScope: () => ({
      acceptedInputIds: [...(input.acceptedInputIds ?? [SELECTED_INPUT_ID])],
      conversationId: "conversation_group",
      conversationScope: input.conversationScope ?? "group",
      inboundMailboxItemIds: ["mailbox_item_1"],
      originSessionId: "session_group",
      recipientKey: "recipient_group",
    }),
    groupTool: {
      request: input.request ?? vi.fn(async () => ({
        action: "ask_current_sender" as const,
        result: { status: "accepted" as const },
      })),
    },
    sendVaultFile: async () => {
      throw new Error("Vault-file sending is unavailable in this test.");
    },
    vaultFileSendAvailable: false,
  };
}

function parseCurrentSenderRequest(messageRef = SELECTED_INPUT_ID) {
  const request = readMurphDynamicToolRequest(groupToolCall({
    action: "ask_current_sender",
    message_ref: messageRef,
  }));
  if (!request || request.kind !== "group") {
    throw new Error("Expected a parsed murph.group request.");
  }
  return request;
}

describe("murph.group ask_current_sender", () => {
  it("accepts only the exact Message ref as model input", () => {
    expect(parseCurrentSenderRequest().request).toEqual({
      action: "ask_current_sender",
      messageRef: SELECTED_INPUT_ID,
    });

    const withQuestion = readMurphDynamicToolRequest(groupToolCall({
      action: "ask_current_sender",
      message_ref: SELECTED_INPUT_ID,
      question: "model paraphrase",
    }));
    expect(withQuestion).toMatchObject({ kind: "invalid-group-arguments" });

    const withMember = readMurphDynamicToolRequest(groupToolCall({
      action: "ask_current_sender",
      memberId: "model_selected_member",
      message_ref: SELECTED_INPUT_ID,
    }));
    expect(withMember).toMatchObject({ kind: "invalid-group-arguments" });

    const withCamelCaseRef = readMurphDynamicToolRequest(groupToolCall({
      action: "ask_current_sender",
      messageRef: SELECTED_INPUT_ID,
    }));
    expect(withCamelCaseRef).toMatchObject({
      kind: "invalid-group-arguments",
    });
  });

  it("replaces the Message ref with a trusted accepted-input origin", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "ask_current_sender" as const,
      result: { status: "accepted" as const },
    }));
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ request: groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: parseCurrentSenderRequest(),
    });

    expect(groupRequest).toHaveBeenCalledWith({
      action: "ask_current_sender",
      origin: {
        assistantInputId: SELECTED_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    });
    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"action":"ask_current_sender"',
    );
  });

  it("fails closed for a foreign Message ref or a private conversation", async () => {
    for (const hostedToolContext of [
      createHostedToolContext({ acceptedInputIds: [OTHER_INPUT_ID] }),
      createHostedToolContext({ conversationScope: "direct" }),
      createHostedToolContext({
        currentInvocationScope: () => ({
          conversationScope: null,
          origin: {
            automationId: "automation_group",
            kind: "automation_occurrence",
            occurrenceAt: "2026-07-27T20:00:00.000Z",
          },
        }),
      }),
    ]) {
      const groupRequest = hostedToolContext.groupTool?.request;
      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request: parseCurrentSenderRequest(),
      });
      expect(result.rpcResult.success).toBe(false);
      expect(result.rpcResult.contentItems[0]?.text).toMatch(
        /selected accepted message|scheduled group invocations/u,
      );
      expect(groupRequest).not.toHaveBeenCalled();
    }
  });
});

describe("murph.group message_current_sender", () => {
  function parsePrivateMessageRequest(messageRef = SELECTED_INPUT_ID) {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "message_current_sender",
      message_ref: messageRef,
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected a parsed murph.group request.");
    }
    return request;
  }

  it("accepts only the exact Message ref as model input", () => {
    expect(parsePrivateMessageRequest().request).toEqual({
      action: "message_current_sender",
      messageRef: SELECTED_INPUT_ID,
    });
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "message_current_sender",
    }))).toMatchObject({ kind: "invalid-group-arguments" });
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "message_current_sender",
      message_ref: SELECTED_INPUT_ID,
      text: "model-authored private message",
    }))).toMatchObject({ kind: "invalid-group-arguments" });
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "message_current_sender",
      memberId: "model_selected_member",
      message_ref: SELECTED_INPUT_ID,
    }))).toMatchObject({ kind: "invalid-group-arguments" });
  });

  it("replaces the Message ref with a trusted accepted-input origin", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "message_current_sender" as const,
      result: { status: "accepted" as const },
    }));
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ request: groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: parsePrivateMessageRequest(),
    });

    expect(groupRequest).toHaveBeenCalledWith({
      action: "message_current_sender",
      origin: {
        assistantInputId: SELECTED_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    });
    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"action":"message_current_sender"',
    );
  });

  it("returns a missing direct route as a model-visible recovery result", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "message_current_sender" as const,
      result: {
        status: "unavailable" as const,
        unavailableReason: "same_channel_direct_route_unavailable",
      },
    }));
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ request: groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: parsePrivateMessageRequest(),
    });

    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"unavailableReason":"same_channel_direct_route_unavailable"',
    );
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"recovery":"Ask the sender to open a direct Murph chat on the same channel, then retry."',
    );
  });

  it("fails closed for a foreign Message ref, private chat, or schedule", async () => {
    for (const hostedToolContext of [
      createHostedToolContext({ acceptedInputIds: [OTHER_INPUT_ID] }),
      createHostedToolContext({ conversationScope: "direct" }),
      createHostedToolContext({
        currentInvocationScope: () => ({
          conversationScope: null,
          origin: {
            automationId: "automation_group",
            kind: "automation_occurrence",
            occurrenceAt: "2026-07-27T20:00:00.000Z",
          },
        }),
      }),
    ]) {
      const groupRequest = hostedToolContext.groupTool?.request;
      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request: parsePrivateMessageRequest(),
      });
      expect(result.rpcResult.success).toBe(false);
      expect(result.rpcResult.contentItems[0]?.text).toMatch(
        /selected accepted message|scheduled group invocations/u,
      );
      expect(groupRequest).not.toHaveBeenCalled();
    }
  });
});

describe("murph.group record_current_sender_daily_metric", () => {
  function parseDailyMetricRequest(messageRef = SELECTED_INPUT_ID) {
    const request = readMurphDynamicToolRequest(groupToolCall({
      action: "record_current_sender_daily_metric",
      date: "2026-08-13",
      message_ref: messageRef,
      metric: "steps",
      unit: "count",
      value: 8_000,
    }));
    if (!request || request.kind !== "group") {
      throw new Error("Expected a parsed murph.group request.");
    }
    return request;
  }

  it("accepts an exact dated metric without a model-selected member", () => {
    expect(parseDailyMetricRequest().request).toEqual({
      action: "record_current_sender_daily_metric",
      dailyMetric: {
        date: "2026-08-13",
        metric: "steps",
        unit: "count",
        value: 8_000,
      },
      messageRef: SELECTED_INPUT_ID,
    });
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "record_current_sender_daily_metric",
      date: "2026-02-30",
      message_ref: SELECTED_INPUT_ID,
      metric: "steps",
      unit: "count",
      value: 8_000,
    }))).toMatchObject({ kind: "invalid-group-arguments" });
    expect(readMurphDynamicToolRequest(groupToolCall({
      action: "record_current_sender_daily_metric",
      date: "2026-08-13",
      memberId: "model_selected_member",
      message_ref: SELECTED_INPUT_ID,
      metric: "steps",
      unit: "count",
      value: 8_000,
    }))).toMatchObject({ kind: "invalid-group-arguments" });
  });

  it("binds the report to the selected accepted group input", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "record_current_sender_daily_metric" as const,
      result: { status: "accepted" as const },
    }));
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ request: groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: parseDailyMetricRequest(),
    });

    expect(groupRequest).toHaveBeenCalledWith({
      action: "record_current_sender_daily_metric",
      dailyMetric: {
        date: "2026-08-13",
        metric: "steps",
        unit: "count",
        value: 8_000,
      },
      origin: {
        assistantInputId: SELECTED_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    });
    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"action":"record_current_sender_daily_metric"',
    );
  });

  it("fails closed for a foreign Message ref", async () => {
    const hostedToolContext = createHostedToolContext({
      acceptedInputIds: [OTHER_INPUT_ID],
    });
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: parseDailyMetricRequest(),
    });
    expect(result.rpcResult.success).toBe(false);
    expect(hostedToolContext.groupTool?.request).not.toHaveBeenCalled();
  });
});
