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
const OLDER_PRIVATE_INPUT_ID = `ain_${"b".repeat(32)}`;

type CurrentSenderDestination = "current_sender" | "group";

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
        responseDestination: "group" as const,
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
  responseDestination?: CurrentSenderDestination;
} = {}) {
  const request = readMurphDynamicToolRequest(groupToolCall({
    action: "ask_current_sender",
    message_ref: input.messageRef ?? FRESH_SELECTED_INPUT_ID,
    response_destination: input.responseDestination ?? "group",
  }));
  if (!request || request.kind !== "group") {
    throw new Error("Expected a parsed murph.group request.");
  }
  return request;
}

describe("murph.group ask_current_sender", () => {
  it("requires one exact Message ref and one explicit terminal destination", () => {
    expect(parseCurrentSenderRequest().request).toEqual({
      action: "ask_current_sender",
      messageRef: FRESH_SELECTED_INPUT_ID,
      responseDestination: "group",
    });
    expect(parseCurrentSenderRequest({
      responseDestination: "current_sender",
    }).request).toEqual({
      action: "ask_current_sender",
      messageRef: FRESH_SELECTED_INPUT_ID,
      responseDestination: "current_sender",
    });

    for (const argumentsValue of [
      {
        action: "ask_current_sender",
        message_ref: FRESH_SELECTED_INPUT_ID,
      },
      {
        action: "message_current_sender",
        message_ref: FRESH_SELECTED_INPUT_ID,
      },
      {
        action: "ask_current_sender",
        message_ref: FRESH_SELECTED_INPUT_ID,
        question: "model paraphrase",
        response_destination: "group",
      },
      {
        action: "ask_current_sender",
        memberId: "model_selected_member",
        message_ref: FRESH_SELECTED_INPUT_ID,
        response_destination: "group",
      },
      {
        action: "ask_current_sender",
        messageRef: FRESH_SELECTED_INPUT_ID,
        response_destination: "group",
      },
    ]) {
      expect(readMurphDynamicToolRequest(groupToolCall(argumentsValue)))
        .toMatchObject({ kind: "invalid-group-arguments" });
    }
  });

  it.each([
    ["group", "group"],
    ["current_sender", "current_sender"],
  ] as const)(
    "binds the %s destination to the same trusted accepted-input origin",
    async (
      responseDestination: CurrentSenderDestination,
      expectedDestination: CurrentSenderDestination,
    ) => {
      const groupRequest = vi.fn(async () => ({
        action: "ask_current_sender" as const,
        responseDestination: expectedDestination,
        result: { status: "accepted" as const },
      }));
      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createHostedToolContext({ request: groupRequest }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request: parseCurrentSenderRequest({ responseDestination }),
      });

      expect(groupRequest).toHaveBeenCalledWith({
        action: "ask_current_sender",
        origin: {
          assistantInputId: FRESH_SELECTED_INPUT_ID,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        responseDestination: expectedDestination,
      });
      expect(result.rpcResult.success).toBe(true);
      expect(result.rpcResult.contentItems[0]?.text).toContain(
        `"responseDestination":"${expectedDestination}"`,
      );
    },
  );

  it("does not reuse an older private destination for a fresh group request", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "ask_current_sender" as const,
      responseDestination: "group" as const,
      result: { status: "accepted" as const },
    }));
    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        acceptedInputIds: [OLDER_PRIVATE_INPUT_ID, FRESH_SELECTED_INPUT_ID],
        request: groupRequest,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: parseCurrentSenderRequest({
        messageRef: FRESH_SELECTED_INPUT_ID,
        responseDestination: "group",
      }),
    });

    expect(groupRequest).toHaveBeenCalledWith({
      action: "ask_current_sender",
      origin: {
        assistantInputId: FRESH_SELECTED_INPUT_ID,
        kind: "accepted_input",
        sessionId: "session_group",
      },
      responseDestination: "group",
    });
  });

  it("returns a missing direct route as a model-visible recovery result", async () => {
    const groupRequest = vi.fn(async () => ({
      action: "ask_current_sender" as const,
      responseDestination: "current_sender" as const,
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
      request: parseCurrentSenderRequest({
        responseDestination: "current_sender",
      }),
    });

    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"unavailableReason":"same_channel_direct_route_unavailable"',
    );
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"recovery":"Ask the sender to open a direct Murph chat on the same channel, then retry."',
    );
  });

  it.each(["group", "current_sender"] as const)(
    "fails the %s destination closed for a foreign ref, direct chat, or schedule",
    async (responseDestination: CurrentSenderDestination) => {
      for (const hostedToolContext of [
        createHostedToolContext({ acceptedInputIds: [OLDER_PRIVATE_INPUT_ID] }),
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
          request: parseCurrentSenderRequest({ responseDestination }),
        });
        expect(result.rpcResult.success).toBe(false);
        expect(result.rpcResult.contentItems[0]?.text).toMatch(
          /selected accepted message|scheduled group invocations/u,
        );
        expect(groupRequest).not.toHaveBeenCalled();
      }
    },
  );
});
