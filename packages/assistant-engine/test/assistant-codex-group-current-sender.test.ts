import { describe, expect, it, vi } from "vitest";

import type {
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.ts";
import {
  executeMurphDynamicToolRequest,
  MURPH_GROUP_TOOL,
  readMurphDynamicToolRequest,
} from "../src/assistant-codex/dynamic-tools.ts";

const FRESH_SELECTED_INPUT_ID = `ain_${"a".repeat(32)}`;
const OLDER_INPUT_ID = `ain_${"b".repeat(32)}`;

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
      acceptedInputIds: [
        ...(input.acceptedInputIds ?? [FRESH_SELECTED_INPUT_ID]),
      ],
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

function parseCurrentSenderRequest(input: {
  messageRef?: string;
} = {}) {
  const request = readMurphDynamicToolRequest(groupToolCall({
    action: "ask_current_sender",
    message_ref: input.messageRef ?? FRESH_SELECTED_INPUT_ID,
  }));
  if (!request || request.kind !== "group") {
    throw new Error("Expected a parsed murph.group request.");
  }
  return request;
}

describe("murph.group ask_current_sender", () => {
  it("accepts only one exact fresh Message ref with no model-authored destination", () => {
    expect(parseCurrentSenderRequest().request).toEqual({
      action: "ask_current_sender",
      messageRef: FRESH_SELECTED_INPUT_ID,
    });

    for (const argumentsValue of [
      { action: "ask_current_sender" },
      {
        action: "message_current_sender",
        message_ref: FRESH_SELECTED_INPUT_ID,
      },
      {
        action: "ask_current_sender",
        message_ref: FRESH_SELECTED_INPUT_ID,
        question: "model paraphrase",
      },
      {
        action: "ask_current_sender",
        memberId: "model_selected_member",
        message_ref: FRESH_SELECTED_INPUT_ID,
      },
      {
        action: "ask_current_sender",
        messageRef: FRESH_SELECTED_INPUT_ID,
      },
      {
        action: "ask_current_sender",
        message_ref: FRESH_SELECTED_INPUT_ID,
        response_destination: "group",
      },
    ]) {
      expect(readMurphDynamicToolRequest(groupToolCall(argumentsValue)))
        .toMatchObject({ kind: "invalid-group-arguments" });
    }
  });

  it("binds the neutral request to the exact trusted accepted-input origin", async () => {
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
        assistantInputId: FRESH_SELECTED_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    });
    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"action":"ask_current_sender"',
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toContain(
      "responseDestination",
    );
  });

  it("does not substitute an older accepted message for the selected fresh ref", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "ask_current_sender" as const,
      result: { status: "accepted" as const },
    }));
    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        acceptedInputIds: [OLDER_INPUT_ID, FRESH_SELECTED_INPUT_ID],
        request: groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: parseCurrentSenderRequest({
        messageRef: FRESH_SELECTED_INPUT_ID,
      }),
    });

    expect(groupRequest).toHaveBeenCalledWith({
      action: "ask_current_sender",
      origin: {
        assistantInputId: FRESH_SELECTED_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    });
  });

  it("returns host unavailability without inventing a destination-specific recovery path", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "ask_current_sender" as const,
      result: {
        status: "unavailable" as const,
        unavailableReason: "current_sender_unavailable",
      },
    }));
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ request: groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: parseCurrentSenderRequest(),
    });

    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"unavailableReason":"current_sender_unavailable"',
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toContain("recovery");
  });

  it("fails closed for a foreign ref, direct chat, or scheduled invocation", async () => {
    for (const hostedToolContext of [
      createHostedToolContext({ acceptedInputIds: [OLDER_INPUT_ID] }),
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
