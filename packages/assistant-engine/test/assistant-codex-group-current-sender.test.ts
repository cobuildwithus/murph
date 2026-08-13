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

function parseCurrentSenderRequest(input: {
  action?:
    | "ask_current_sender"
    | "clarify_current_sender"
    | "continue_current_sender_in_group"
    | "continue_current_sender_privately"
    | "message_current_sender";
  messageRef?: string;
} = {}) {
  const request = readMurphDynamicToolRequest(groupToolCall({
    action: input.action ?? "ask_current_sender",
    message_ref: input.messageRef ?? NEWEST_SENDER_INPUT_ID,
  }));
  if (!request || request.kind !== "group") {
    throw new Error("Expected a parsed murph.group request.");
  }
  return request;
}

function sentProgressDelivery() {
  return {
    send: vi.fn(async () => ({
      kind: "sent" as const,
      source: "system" as const,
    })),
  };
}

describe("murph.group current-sender intent", () => {
  it("maps natural-intent actions to one exact Message ref", () => {
    expect(parseCurrentSenderRequest().request).toEqual({
      action: "ask_current_sender",
      audience: "group",
      messageRef: NEWEST_SENDER_INPUT_ID,
      mode: "new",
    });
    expect(parseCurrentSenderRequest({
      action: "message_current_sender",
    }).request).toMatchObject({
      audience: "current_sender",
      mode: "new",
    });
    expect(parseCurrentSenderRequest({
      action: "clarify_current_sender",
    }).request).toEqual({
      action: "ask_current_sender",
      messageRef: NEWEST_SENDER_INPUT_ID,
      mode: "clarification",
    });
    expect(parseCurrentSenderRequest({
      action: "continue_current_sender_in_group",
    }).request).toMatchObject({ audience: "group", mode: "continuation" });
    expect(parseCurrentSenderRequest({
      action: "continue_current_sender_privately",
    }).request).toMatchObject({
      audience: "current_sender",
      mode: "continuation",
    });

    for (const argumentsValue of [
      { action: "message_current_sender" },
      { action: "ask_current_sender" },
      { action: "ask_current_sender", message_ref: "provider-message-id" },
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
          enum: expect.arrayContaining([
            "ask_current_sender",
            "clarify_current_sender",
            "continue_current_sender_in_group",
            "continue_current_sender_privately",
            "message_current_sender",
          ]),
        },
        message_ref: { pattern: "^ain_[0-9a-f]{32}$" },
      },
      required: ["action", "message_ref"],
    });
  });

  it("sends the group notice before forwarding exact-source authority", async () => {
    const events: string[] = [];
    const groupRequest = vi.fn(async () => {
      events.push("request");
      return {
        action: "ask_current_sender" as const,
        result: { status: "accepted" as const },
      };
    });
    const progressDelivery = {
      send: vi.fn(async () => {
        events.push("notice");
        return { kind: "sent" as const, source: "system" as const };
      }),
    };
    const result = await executeMurphDynamicToolRequest({
      deliveryContextOrdinal: 3,
      env: {},
      fetchImpl: fetch,
      groupSharedReadTurnState: {
        currentSenderGroupPreviewedMessageRefs: new Set(),
        invalid: false,
        readProjectionScopeKeyBatches: [],
        roster: [],
      },
      hostedToolContext: createHostedToolContext({
        acceptedInputIds: [EARLIER_SENDER_INPUT_ID, NEWEST_SENDER_INPUT_ID],
        request: groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery,
      request: parseCurrentSenderRequest({
        messageRef: EARLIER_SENDER_INPUT_ID,
      }),
    });

    expect(events).toEqual(["notice", "request"]);
    expect(progressDelivery.send).toHaveBeenCalledWith(
      "I’ll ask your Murph and share the answer here.",
      { deliveryContextOrdinal: 3, required: true, source: "system" },
    );
    expect(groupRequest).toHaveBeenCalledWith({
      action: "ask_current_sender",
      audience: "group",
      mode: "new",
      origin: {
        assistantInputId: EARLIER_SENDER_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    });
    expect(result).toMatchObject({
      externallyVisibleOutput: true,
      finalActionPatch: { kind: "none", owner: "current-sender-ask" },
      rpcResult: { success: true },
    });
  });

  it("fails closed when the group notice cannot be sent", async () => {
    const groupRequest = vi.fn();
    const progressDelivery = {
      send: vi.fn(async () => ({
        kind: "failed" as const,
        source: "system" as const,
      })),
    };
    const result = await executeMurphDynamicToolRequest({
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ request: groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery,
      request: parseCurrentSenderRequest(),
    });

    expect(result.rpcResult.success).toBe(false);
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it("keeps private and clarification paths silent in the group", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "ask_current_sender" as const,
      result: { status: "clarification_required" as const },
    }));
    const progressDelivery = sentProgressDelivery();
    await executeMurphDynamicToolRequest({
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ request: groupRequest }),
      nextUsageOrdinal: () => 1,
      progressDelivery,
      request: parseCurrentSenderRequest({ action: "clarify_current_sender" }),
    });
    await executeMurphDynamicToolRequest({
      deliveryContextOrdinal: 1,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ request: groupRequest }),
      nextUsageOrdinal: () => 2,
      progressDelivery,
      request: parseCurrentSenderRequest({ action: "message_current_sender" }),
    });

    expect(progressDelivery.send).not.toHaveBeenCalled();
    expect(groupRequest.mock.calls).toEqual([
      [{
        action: "ask_current_sender",
        mode: "clarification",
        origin: expect.objectContaining({
          assistantInputId: NEWEST_SENDER_INPUT_ID,
        }),
      }],
      [{
        action: "ask_current_sender",
        audience: "current_sender",
        mode: "new",
        origin: expect.objectContaining({
          assistantInputId: NEWEST_SENDER_INPUT_ID,
        }),
      }],
    ]);
  });

  it("rejects a foreign Message ref before any notice or Web request", async () => {
    const groupRequest = vi.fn();
    const progressDelivery = sentProgressDelivery();
    const result = await executeMurphDynamicToolRequest({
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        acceptedInputIds: [EARLIER_SENDER_INPUT_ID, NEWEST_SENDER_INPUT_ID],
        request: groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery,
      request: parseCurrentSenderRequest({ messageRef: FOREIGN_INPUT_ID }),
    });

    expect(result.rpcResult.success).toBe(false);
    expect(progressDelivery.send).not.toHaveBeenCalled();
    expect(groupRequest).not.toHaveBeenCalled();
  });
});
