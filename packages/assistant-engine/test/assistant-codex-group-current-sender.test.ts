import { describe, expect, it, vi } from "vitest";

import type {
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.ts";
import {
  executeMurphDynamicToolRequest,
  MURPH_GROUP_TOOL,
  readMurphDynamicToolRequest,
} from "../src/assistant-codex/dynamic-tools.ts";

const NEWEST_SENDER_INPUT_ID = `ain_${"a".repeat(32)}`;
const EARLIER_SENDER_INPUT_ID = `ain_${"b".repeat(32)}`;
const FOREIGN_INPUT_ID = `ain_${"c".repeat(32)}`;

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
  request?: NonNullable<AssistantHostedToolContext["groupTool"]>["request"];
} = {}): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentInvocationScope: () => null,
    currentUserActionScope: () => ({
      acceptedInputIds: [
        ...(input.acceptedInputIds ?? [NEWEST_SENDER_INPUT_ID]),
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

function parseCurrentSenderRequest(
  messageRef = NEWEST_SENDER_INPUT_ID,
) {
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
  it("accepts only one exact Message ref with no model-selected authority", () => {
    expect(parseCurrentSenderRequest().request).toEqual({
      action: "ask_current_sender",
      messageRef: NEWEST_SENDER_INPUT_ID,
    });

    for (const argumentsValue of [
      { action: "message_current_sender" },
      { action: "ask_current_sender" },
      { action: "ask_current_sender", message_ref: "provider-message-id" },
      {
        action: "ask_current_sender",
        message_ref: NEWEST_SENDER_INPUT_ID,
        member: "model-selected",
      },
      {
        action: "ask_current_sender",
        message_ref: NEWEST_SENDER_INPUT_ID,
        question: "model paraphrase",
      },
      {
        action: "ask_current_sender",
        message_ref: NEWEST_SENDER_INPUT_ID,
        audience: "group",
      },
    ]) {
      expect(readMurphDynamicToolRequest(groupToolCall(argumentsValue)))
        .toMatchObject({ kind: "invalid-group-arguments" });
    }

    expect(MURPH_GROUP_TOOL.inputSchema.allOf[1].oneOf[0]).toMatchObject({
      maxProperties: 2,
      properties: {
        action: {
          enum: expect.arrayContaining(["ask_current_sender"]),
        },
        message_ref: { pattern: "^ain_[0-9a-f]{32}$" },
      },
      required: ["action", "message_ref"],
    });
  });

  it("binds either exact accepted request so simultaneous senders are independent", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "ask_current_sender" as const,
      result: { status: "accepted" as const },
    }));
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        acceptedInputIds: [EARLIER_SENDER_INPUT_ID, NEWEST_SENDER_INPUT_ID],
        request: groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: parseCurrentSenderRequest(EARLIER_SENDER_INPUT_ID),
    });
    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        acceptedInputIds: [EARLIER_SENDER_INPUT_ID, NEWEST_SENDER_INPUT_ID],
        request: groupRequest,
      }),
      nextUsageOrdinal: () => 2,
      progressDelivery: null,
      request: parseCurrentSenderRequest(NEWEST_SENDER_INPUT_ID),
    });

    expect(groupRequest.mock.calls).toEqual([
      [{
        action: "ask_current_sender",
        origin: {
          assistantInputId: EARLIER_SENDER_INPUT_ID,
          kind: "accepted_input",
          sessionId: "session_group",
        },
      }],
      [{
        action: "ask_current_sender",
        origin: {
          assistantInputId: NEWEST_SENDER_INPUT_ID,
          kind: "accepted_input",
          sessionId: "session_group",
        },
      }],
    ]);
    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).not.toContain(
      "responseDestination",
    );
  });

  it("rejects a foreign Message ref before calling Web", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "ask_current_sender" as const,
      result: { status: "accepted" as const },
    }));
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        acceptedInputIds: [EARLIER_SENDER_INPUT_ID, NEWEST_SENDER_INPUT_ID],
        request: groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: parseCurrentSenderRequest(FOREIGN_INPUT_ID),
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "selected accepted message in this group turn",
    );
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it("fails closed outside a fresh group turn", async () => {
    for (const hostedToolContext of [
      createHostedToolContext({ acceptedInputIds: [] }),
      createHostedToolContext({ conversationScope: "direct" }),
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
      expect(result.rpcResult.contentItems[0]?.text).toContain(
        "selected accepted message in this group turn",
      );
      expect(groupRequest).not.toHaveBeenCalled();
    }
  });
});
