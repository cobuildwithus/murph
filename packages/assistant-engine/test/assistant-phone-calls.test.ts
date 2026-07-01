import { describe, expect, it, vi } from "vitest";

import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

import {
  MURPH_CREATE_PHONE_CALL_TOOL,
  createPhoneCallRequestKey,
  resolveAssistantPhoneCallAcceptedInputIds,
} from "../src/assistant-codex/dynamic-tools/phone-calls.js";
import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import type {
  AssistantHostedToolContext,
  AssistantHostedToolRequestKeyScope,
} from "../src/assistant/hosted-tool-context.js";

const BASE_BRIEF: HostedPhoneCallBrief = {
  allowTransferToUser: true,
  goal: "Schedule a routine eye examination for Friday, June 26, 2026.",
  instructions: [
    "Only accept an appointment on Friday, June 26, 2026.",
  ],
  shareableFacts: {
    callback_number: "+12125550111",
    patient_name: "Alex",
  },
  successCriteria: "The office confirms the exact appointment time and location.",
  timeZone: "America/New_York",
  to: {
    label: "Eye doctor's office",
    phoneNumber: "+12125550123",
  },
};

const BASE_SCOPE: AssistantHostedToolRequestKeyScope = {
  acceptedInputIds: ["assistant_input_1"],
  conversationId: "conversation_1",
  inboundMailboxItemIds: ["mailbox_item_1"],
  recipientKey: "recipient_1",
};

describe("assistant phone calls", () => {
  it("exposes the dynamic tool only when phone-call availability is explicitly enabled", () => {
    expect(resolveMurphDynamicTools({
      phoneCallsAvailable: true,
    })).toContain(MURPH_CREATE_PHONE_CALL_TOOL);
    expect(resolveMurphDynamicTools({
      phoneCallsAvailable: false,
    })).not.toContain(MURPH_CREATE_PHONE_CALL_TOOL);
  });

  it("uses only eligible user-sourced accepted input as phone-call authority", () => {
    const acceptedInputItems = [
      { id: "initial_user", source: "initial" as const },
      { id: "initial", source: "manual" as const },
      { id: "assistant_input", source: "assistant-input" as const },
      { id: "manual_input", source: "manual" as const },
      { id: "system_input", source: "system" as const },
    ];

    expect(resolveAssistantPhoneCallAcceptedInputIds({
      acceptedInputItems,
      turnTrigger: null,
    })).toEqual(["assistant_input", "manual_input"]);
    expect(resolveAssistantPhoneCallAcceptedInputIds({
      acceptedInputItems,
      turnTrigger: "automation-cron",
    })).toEqual([]);
    expect(resolveAssistantPhoneCallAcceptedInputIds({
      acceptedInputItems,
      turnTrigger: "automation-auto-reply",
    })).toEqual(["assistant_input", "manual_input"]);
  });

  it("keys calls by accepted input and the exact bounded brief", () => {
    const first = createPhoneCallRequestKey({
      brief: BASE_BRIEF,
      scope: BASE_SCOPE,
    });
    const reworded = createPhoneCallRequestKey({
      brief: {
        ...BASE_BRIEF,
        goal: "Book the eye appointment on the requested day.",
        instructions: [
          "Ask for any opening on the requested Friday.",
        ],
        successCriteria: "The office confirms a booking.",
        timeZone: "America/Chicago",
        to: {
          label: "The clinic",
          phoneNumber: BASE_BRIEF.to.phoneNumber,
        },
      },
      scope: BASE_SCOPE,
    });
    const differentDisclosure = createPhoneCallRequestKey({
      brief: {
        ...BASE_BRIEF,
        shareableFacts: {
          ...BASE_BRIEF.shareableFacts,
          insurance_member_id: "member-123",
        },
      },
      scope: BASE_SCOPE,
    });
    const differentInput = createPhoneCallRequestKey({
      brief: BASE_BRIEF,
      scope: {
        ...BASE_SCOPE,
        acceptedInputIds: ["assistant_input_2"],
      },
    });
    const runtimeTurnOnlyScope: AssistantHostedToolRequestKeyScope & { turnId: string } = {
      ...BASE_SCOPE,
      turnId: "runtime_turn_retry",
    };
    const runtimeOrdinalOnlyScope: AssistantHostedToolRequestKeyScope & {
      assistantTurnOrdinal: string;
    } = {
      ...BASE_SCOPE,
      assistantTurnOrdinal: "runtime_turn_retry_ordinal",
    };

    expect(first).toMatch(/^phone_call_[a-f0-9]{64}$/u);
    expect(reworded).not.toBe(first);
    expect(differentDisclosure).not.toBe(first);
    expect(differentInput).not.toBe(first);
    expect(createPhoneCallRequestKey({
      brief: BASE_BRIEF,
      scope: runtimeTurnOnlyScope,
    })).toBe(first);
    expect(createPhoneCallRequestKey({
      brief: BASE_BRIEF,
      scope: runtimeOrdinalOnlyScope,
    })).toBe(first);
    expect(() => createPhoneCallRequestKey({
      brief: BASE_BRIEF,
      scope: {
        ...BASE_SCOPE,
        acceptedInputIds: [],
      },
    })).toThrow("accepted user input");
  });

  it("fails closed when a hidden phone-call request has transport but no execution authority", async () => {
    const start = vi.fn();
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: BASE_BRIEF,
      tool: MURPH_CREATE_PHONE_CALL_TOOL.name,
    }));
    if (!request || request.kind !== "create-phone-call") {
      throw new Error("Expected create phone call request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        currentPhoneCallToolRequestKeyScope: () => null,
        phoneCalls: { start },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(start).not.toHaveBeenCalled();
    expect(result.rpcResult).toMatchObject({
      success: false,
    });
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "user-sourced input",
    );
  });

  it("derives phone-call request keys from the eligible phone-call input set", async () => {
    const phoneCallScope: AssistantHostedToolRequestKeyScope = {
      ...BASE_SCOPE,
      acceptedInputIds: ["manual_phone_call_input"],
    };
    const expectedRequestKey = createPhoneCallRequestKey({
      brief: BASE_BRIEF,
      scope: phoneCallScope,
    });
    const start = vi.fn(async (input) => {
      expect(input).toEqual({
        brief: BASE_BRIEF,
        requestKey: expectedRequestKey,
      });
      return {
        phoneCallId: "hpc_123",
        status: "calling" as const,
      };
    });
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: BASE_BRIEF,
      tool: MURPH_CREATE_PHONE_CALL_TOOL.name,
    }));
    if (!request || request.kind !== "create-phone-call") {
      throw new Error("Expected create phone call request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        currentPhoneCallToolRequestKeyScope: () => phoneCallScope,
        phoneCalls: { start },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(result.rpcResult).toMatchObject({
      success: true,
    });
    expect(result.rpcResult.contentItems[0]?.text).toContain("phone call calling: hpc_123");
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
  currentPhoneCallToolRequestKeyScope?: () => AssistantHostedToolRequestKeyScope | null;
  phoneCalls?: AssistantHostedToolContext["phoneCalls"];
}): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentPhoneCallToolRequestKeyScope: input.currentPhoneCallToolRequestKeyScope,
    phoneCalls: input.phoneCalls ?? null,
    sendVaultFile: vi.fn(async () => {
      throw new Error("Vault-file sending is unavailable for this turn.");
    }),
    vaultFileSendAvailable: false,
  };
}
