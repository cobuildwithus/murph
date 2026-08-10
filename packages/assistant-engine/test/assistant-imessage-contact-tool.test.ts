import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from "vitest";

import {
  executeMurphDynamicToolRequest,
  MURPH_IMESSAGE_CONTACT_TOOL,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import type {
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.js";

const ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;

describe("assistant iMessage contact tool", () => {
  it("is available only when the hosted assignment port is authorized", () => {
    expect(resolveMurphDynamicTools({ imessageContactAvailable: true }))
      .toContain(MURPH_IMESSAGE_CONTACT_TOOL);
    expect(resolveMurphDynamicTools({ imessageContactAvailable: false }))
      .not.toContain(MURPH_IMESSAGE_CONTACT_TOOL);
  });

  it("uses one current user input and returns the assigned number", async () => {
    const request = readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {},
        namespace: "murph",
        tool: "imessage_contact",
      },
    });
    expect(request).toEqual({ kind: "imessage-contact" });
    if (!request) {
      throw new Error("Expected an iMessage contact dynamic tool request.");
    }

    const ensure = vi.fn(async () => ({
      phoneNumber: "+15550100001",
      status: "assigned" as const,
      verifiedSenderPhoneHint: "*** 0009",
    }));
    const context = buildHostedToolContext(ensure);
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: context,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(ensure).toHaveBeenCalledWith({
      assistantInputId: ASSISTANT_INPUT_ID,
    });
    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toContain("+15550100001");
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "verified phone shown as *** 0009",
    );
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "another phone number or email",
    );
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "may start a separate Murph conversation",
    );

    const repeated = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: context,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });
    expect(repeated.rpcResult.success).toBe(false);
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it("rejects arguments that could select another member or number", () => {
    expect(readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: { phoneNumber: "+15550100009" },
        namespace: "murph",
        tool: "imessage_contact",
      },
    })?.kind).toBe("invalid-imessage-contact-arguments");
  });

  it("gives safe recovery guidance when no number is assigned", async () => {
    const request = readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {},
        namespace: "murph",
        tool: "imessage_contact",
      },
    });
    if (!request) {
      throw new Error("Expected an iMessage contact dynamic tool request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: buildHostedToolContext(vi.fn(async () => ({
        phoneNumber: null,
        status: "unavailable" as const,
        verifiedSenderPhoneHint: null,
      }))),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toBe(
      "No Murph iMessage number was assigned. The member can continue using Telegram and ask again later. Never guess or invent a phone number, and do not promise when one will become available.",
    );
  });

  it("explains how to connect an iMessage sender identity before assignment", async () => {
    const request = readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {},
        namespace: "murph",
        tool: "imessage_contact",
      },
    });
    if (!request) {
      throw new Error("Expected an iMessage contact dynamic tool request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: buildHostedToolContext(vi.fn(async () => ({
        phoneNumber: null,
        status: "identity_required" as const,
        verifiedSenderPhoneHint: null,
      }))),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]?.text).toBe(
      "No Murph iMessage number was assigned because this account does not have a verified phone number that can identify the same member in iMessage. Tell the member to connect and verify their iMessage phone number at https://withmurph.ai/settings, then ask again here. They can continue using Telegram. Never guess or invent a number.",
    );
  });

  it("does not claim assignment status when the request cannot be confirmed", async () => {
    const request = readTestMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {},
        namespace: "murph",
        tool: "imessage_contact",
      },
    });
    if (!request) {
      throw new Error("Expected an iMessage contact dynamic tool request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: buildHostedToolContext(vi.fn(async () => {
        throw new Error("response lost");
      })),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toBe(
      "The iMessage contact request could not be confirmed. Do not guess or invent a number. Tell the member they can continue using Telegram and ask again later, without promising timing.",
    );
  });
});

function buildHostedToolContext(
  ensure: NonNullable<
    AssistantHostedToolContext["imessageContactTool"]
  >["ensure"],
): AssistantHostedToolContext {
  let claimed = false;
  return {
    claimIMessageContactAssistantInputId: () => {
      if (claimed) {
        return null;
      }
      claimed = true;
      return ASSISTANT_INPUT_ID;
    },
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    imessageContactTool: { ensure },
    sendVaultFile: vi.fn(async () => ({
      approvalUrl: "https://example.test/approval/unused",
      filename: "unused.pdf",
      status: "pending" as const,
    })),
    vaultFileSendAvailable: false,
  };
}
