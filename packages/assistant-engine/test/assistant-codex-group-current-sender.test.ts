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
const OLDER_REPLY_INPUT_ID = `ain_${"b".repeat(32)}`;

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

function parseCurrentSenderRequest() {
  const request = readMurphDynamicToolRequest(groupToolCall({
    action: "ask_current_sender",
  }));
  if (!request || request.kind !== "group") {
    throw new Error("Expected a parsed murph.group request.");
  }
  return request;
}

describe("murph.group ask_current_sender", () => {
  it("exposes exactly one argument-free model action", () => {
    expect(parseCurrentSenderRequest().request).toEqual({
      action: "ask_current_sender",
    });

    for (const argumentsValue of [
      { action: "message_current_sender" },
      { action: "ask_current_sender", message_ref: NEWEST_SENDER_INPUT_ID },
      { action: "ask_current_sender", member: "model-selected" },
      { action: "ask_current_sender", question: "model paraphrase" },
      { action: "ask_current_sender", audience: "group" },
      { action: "ask_current_sender", destination: "current_sender" },
      { action: "ask_current_sender", privacy: true },
    ]) {
      expect(readMurphDynamicToolRequest(groupToolCall(argumentsValue)))
        .toMatchObject({ kind: "invalid-group-arguments" });
    }

    expect(MURPH_GROUP_TOOL.inputSchema.allOf[1].oneOf[1]).toMatchObject({
      maxProperties: 1,
      properties: { action: { enum: ["ask_current_sender"] } },
      required: ["action"],
    });
  });

  it("binds the newest accepted group input and cannot select an earlier accepted input", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "ask_current_sender" as const,
      result: { status: "accepted" as const },
    }));
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        // The earlier input is a native reply. The later command can only bind
        // itself, never the earlier accepted id.
        acceptedInputIds: [OLDER_REPLY_INPUT_ID, NEWEST_SENDER_INPUT_ID],
        request: groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: parseCurrentSenderRequest(),
    });

    expect(groupRequest).toHaveBeenCalledWith({
      action: "ask_current_sender",
      origin: {
        assistantInputId: NEWEST_SENDER_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    });
    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).not.toContain(
      "responseDestination",
    );
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
        "newest accepted message in this group turn",
      );
      expect(groupRequest).not.toHaveBeenCalled();
    }
  });
});
