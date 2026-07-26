import { describe, expect, it, vi } from "vitest";

import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

import {
  MURPH_CREATE_PHONE_CALL_TOOL,
  createPhoneCallRequestKey,
  resolveAssistantUserActionAcceptedInputIds,
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
  callerName: "Alex",
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
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "Set allowTransferToUser=true for calls likely to require live user identity verification",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "Set allowTransferToUser=false for info-only calls",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "Set callerName to the user-approved first name",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "satisfy its ready-to-act gate",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "completed, user-approved readiness brief",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).not.toContain(
      "appointment type, acceptable dates and times, timezone, clinician",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "information-only or connectivity-test call must stay non-mutating",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "Murph resolves verified transfer numbers server-side",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "Group-chat calls never transfer to one participant",
    );
  });

  it("uses only eligible user-sourced accepted input as phone-call authority", () => {
    const acceptedInputItems = [
      { id: "initial_user", source: "initial" as const },
      { id: "initial", source: "manual" as const },
      { id: "assistant_input", source: "assistant-input" as const },
      { id: "manual_input", source: "manual" as const },
      { id: "system_input", source: "system" as const },
    ];

    expect(resolveAssistantUserActionAcceptedInputIds({
      acceptedInputItems,
      turnTrigger: null,
    })).toEqual(["assistant_input", "manual_input"]);
    expect(resolveAssistantUserActionAcceptedInputIds({
      acceptedInputItems,
      turnTrigger: "automation-cron",
    })).toEqual([]);
    expect(resolveAssistantUserActionAcceptedInputIds({
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
    const differentCallerName = createPhoneCallRequestKey({
      brief: {
        ...BASE_BRIEF,
        callerName: "Jordan",
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
    const liveSteeredInput = createPhoneCallRequestKey({
      brief: BASE_BRIEF,
      scope: {
        ...BASE_SCOPE,
        acceptedInputIds: ["assistant_input_1", "assistant_input_2"],
        inboundMailboxItemIds: ["mailbox_item_1", "mailbox_item_2"],
      },
    });
    const replayedInput = createPhoneCallRequestKey({
      brief: BASE_BRIEF,
      scope: {
        ...BASE_SCOPE,
        acceptedInputIds: ["assistant_input_2"],
        inboundMailboxItemIds: ["mailbox_item_2"],
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
    expect(differentCallerName).not.toBe(first);
    expect(differentInput).not.toBe(first);
    expect(liveSteeredInput).toBe(replayedInput);
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
        currentUserActionScope: () => null,
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
        originSessionId: "session_phone_call",
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
        currentUserActionScope: () => ({
          ...phoneCallScope,
          conversationScope: "direct",
          originSessionId: "session_phone_call",
        }),
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
    expect(result.rpcResult.contentItems[0]?.text).toContain("phone call accepted or placed: hpc_123");
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "When the call finishes, Murph reports the result back in this conversation if it is worth sharing; you may tell them you will follow up once you hear back.",
    );
  });

  it("canonicalizes group transfer permission before request-key creation and dispatch", async () => {
    const effectiveBrief = {
      ...BASE_BRIEF,
      allowTransferToUser: false,
    };
    const phoneCallScope = {
      ...BASE_SCOPE,
      acceptedInputIds: ["group_phone_call_input"],
      conversationScope: "group" as const,
      originSessionId: "session_group_phone_call",
    };
    const expectedRequestKey = createPhoneCallRequestKey({
      brief: effectiveBrief,
      scope: phoneCallScope,
    });
    const start = vi.fn(async () => ({
      phoneCallId: "hpc_group",
      status: "calling" as const,
    }));
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: BASE_BRIEF,
      tool: MURPH_CREATE_PHONE_CALL_TOOL.name,
    }));
    if (!request || request.kind !== "create-phone-call") {
      throw new Error("Expected create phone call request.");
    }

    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        currentUserActionScope: () => phoneCallScope,
        phoneCalls: { start },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(start).toHaveBeenCalledWith({
      brief: effectiveBrief,
      inboundMailboxItemIds: ["mailbox_item_1"],
      originSessionId: "session_group_phone_call",
      requestKey: expectedRequestKey,
    }, {
      signal: null,
    });
  });

  it.each([
    ["starting", "still being reconciled"],
    ["failed", "attempt was unsuccessful"],
  ] as const)("does not report %s phone-call authority as a successful tool result", async (
    status,
    expectedText,
  ) => {
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
        currentUserActionScope: () => ({
          ...BASE_SCOPE,
          acceptedInputIds: ["manual_phone_call_input"],
          conversationScope: "direct",
          originSessionId: "session_phone_call",
        }),
        phoneCalls: {
          start: vi.fn().mockResolvedValue({
            phoneCallId: "hpc_123",
            status,
          }),
        },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toContain(expectedText);
    expect(result.rpcResult.contentItems[0]?.text).toContain("hpc_123");
    if (status === "starting") {
      expect(result.rpcResult.contentItems[0]?.text).toContain(
        "When the call finishes, Murph reports the result back in this conversation if it is worth sharing; you may tell them you will follow up once you hear back.",
      );
    }
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
  currentUserActionScope?: AssistantHostedToolContext["currentUserActionScope"];
  phoneCalls?: AssistantHostedToolContext["phoneCalls"];
}): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentUserActionScope: input.currentUserActionScope,
    phoneCalls: input.phoneCalls ?? null,
    sendVaultFile: vi.fn(async () => {
      throw new Error("Vault-file sending is unavailable for this turn.");
    }),
    vaultFileSendAvailable: false,
  };
}
