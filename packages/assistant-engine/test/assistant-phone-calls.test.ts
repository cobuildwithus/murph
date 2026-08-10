import { describe, expect, it, vi } from "vitest";

import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

import {
  MURPH_CREATE_PHONE_CALL_TOOL,
  createPhoneCallRequestKey,
  createScheduledPhoneCallRequestKey,
  resolveAssistantUserActionAcceptedInputIds,
} from "../src/assistant-codex/dynamic-tools/phone-calls.js";
import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import {
  resolveAssistantHostedScheduledInvocationScope,
  resolveAssistantHostedScheduledPhoneCallScope,
  type AssistantHostedToolContext,
  type AssistantHostedScheduledPhoneCallScope,
  type AssistantHostedToolRequestKeyScope,
} from "../src/assistant/hosted-tool-context.js";
import type {
  AssistantAcceptedMessageTargetAuthorizer,
} from "../src/assistant/message-target-selection.js";

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

const OTHER_GROUP_INPUT_ID = `ain_${"b".repeat(32)}`;
const BASE_SCOPE: AssistantHostedToolRequestKeyScope = {
  acceptedInputIds: ["assistant_input_1"],
  conversationId: "conversation_1",
  inboundMailboxItemIds: ["mailbox_item_1"],
  recipientKey: "recipient_1",
};
const GROUP_REQUEST_REF = "ain_0123456789abcdef0123456789abcdef";

describe("assistant phone calls", () => {
  it("exposes the dynamic tool only when phone-call availability is explicitly enabled", () => {
    expect(resolveMurphDynamicTools({
      phoneCallsAvailable: true,
    })).toContain(MURPH_CREATE_PHONE_CALL_TOOL);
    expect(resolveMurphDynamicTools({
      phoneCallsAvailable: false,
    })).not.toContain(MURPH_CREATE_PHONE_CALL_TOOL);
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "$MURPH_ASSISTANT_SKILLS_ROOT/phone-calls/SKILL.md",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "Use the same explicit-consent or ready-to-act flow in private and hosted group conversations",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "does not require a special structured preview or a later confirmation solely because it is a group",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "one participant cannot approve another participant's private facts",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "Before a real health care appointment booking",
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
      "Murph resolves eligible verified transfer numbers server-side for private calls",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "Group-chat calls never transfer to one participant",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "message_ref is required",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      "never supply a canonical member id",
    );
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).not.toContain(
      ["GROUP", "CALL", "PREVIEW"].join(" "),
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

  it.each([
    ["exact direct Linq occurrence", "linq", "direct", "automation-cron", "2026-08-05T18:00:00.000Z", true],
    ["direct email occurrence", "email", "direct", "automation-cron", "2026-08-05T18:00:00.000Z", false],
    ["direct Telegram occurrence", "telegram", "direct", "automation-cron", "2026-08-05T18:00:00.000Z", false],
    ["group occurrence", "linq", "group", "automation-cron", "2026-08-05T18:00:00.000Z", false],
    ["mismatched occurrence", "linq", "direct", "automation-cron", "2026-08-05T18:01:00.000Z", false],
    ["manual trigger", "linq", "direct", "manual-ask", "2026-08-05T18:00:00.000Z", false],
  ] as const)("grants scheduled phone-call authority only for an %s", (
    _case,
    channel,
    conversationScope,
    turnTrigger,
    scheduledOccurrenceAt,
    expectedAuthorized,
  ) => {
    const scope = resolveAssistantHostedScheduledPhoneCallScope({
      channel,
      conversationScope,
      messageInput: {
        scheduledInvocationAuthority: {
          automationId: "automation-scheduled-call",
          occurrenceAt: "2026-08-05T18:00:00.000Z",
        },
        scheduledOccurrenceAt,
        turnTrigger,
      },
      originSessionId: "session-scheduled-call",
    });

    expect(scope !== null).toBe(expectedAuthorized);
    if (expectedAuthorized) {
      expect(scope).toEqual({
        automationId: "automation-scheduled-call",
        occurrenceAt: "2026-08-05T18:00:00.000Z",
        originSessionId: "session-scheduled-call",
      });
    }
  });

  it("keeps generic scheduled authority route-neutral while phone authority stays direct Linq", () => {
    const messageInput = {
      scheduledInvocationAuthority: {
        automationId: "automation-scheduled-tools",
        occurrenceAt: "2026-08-05T18:00:00.000Z",
      },
      scheduledOccurrenceAt: "2026-08-05T18:00:00.000Z",
      turnTrigger: "automation-cron" as const,
    };
    const generic = resolveAssistantHostedScheduledInvocationScope({
      conversationScope: "direct",
      messageInput,
      originSessionId: "session-scheduled-tools",
    });
    const emailPhone = resolveAssistantHostedScheduledPhoneCallScope({
      channel: "email",
      conversationScope: "direct",
      messageInput,
      originSessionId: "session-scheduled-tools",
    });

    expect(generic).toMatchObject({
      conversationScope: "direct",
      origin: {
        automationId: "automation-scheduled-tools",
        kind: "automation_occurrence",
        occurrenceAt: "2026-08-05T18:00:00.000Z",
      },
      originSessionId: "session-scheduled-tools",
    });
    expect(emailPhone).toBeNull();
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

  it("keys scheduled calls only by the exact automation occurrence", () => {
    const scope: AssistantHostedScheduledPhoneCallScope = {
      automationId: "automation-scheduled-call",
      occurrenceAt: "2026-08-05T18:00:00.000Z",
      originSessionId: "session-scheduled-call",
    };
    const first = createScheduledPhoneCallRequestKey({
      scope,
    });

    expect(first).toMatch(/^phone_call_scheduled_[a-f0-9]{64}$/u);
    expect(createScheduledPhoneCallRequestKey({
      scope: {
        ...scope,
        originSessionId: "session-scheduled-call-retry",
      },
    })).toBe(first);
    expect(createScheduledPhoneCallRequestKey({
      scope: {
        ...scope,
        occurrenceAt: "2026-08-05T18:01:00.000Z",
      },
    })).not.toBe(first);
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
      "user-sourced input or direct scheduled automation authority",
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

  it("starts a direct scheduled call with deterministic occurrence authority", async () => {
    const scheduledScope: AssistantHostedScheduledPhoneCallScope = {
      automationId: "automation-scheduled-call",
      occurrenceAt: "2026-08-05T18:00:00.000Z",
      originSessionId: "session-scheduled-call",
    };
    const expectedRequestKey = createScheduledPhoneCallRequestKey({
      scope: scheduledScope,
    });
    const start = vi.fn(async () => ({
      phoneCallId: "hpc_scheduled",
      status: "calling" as const,
    }));
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
        currentScheduledPhoneCallScope: () => scheduledScope,
        currentUserActionScope: () => null,
        phoneCalls: { start },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(start).toHaveBeenCalledWith({
      brief: BASE_BRIEF,
      originSessionId: "session-scheduled-call",
      requestKey: expectedRequestKey,
    }, {
      signal: null,
    });
    expect(result.rpcResult.success).toBe(true);
  });

  it("keeps scheduled start errors uncertainty-safe", async () => {
    const scheduledScope: AssistantHostedScheduledPhoneCallScope = {
      automationId: "automation-scheduled-call",
      occurrenceAt: "2026-08-05T18:00:00.000Z",
      originSessionId: "session-scheduled-call-retry",
    };
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
        currentScheduledPhoneCallScope: () => scheduledScope,
        currentUserActionScope: () => null,
        phoneCalls: {
          start: vi.fn(async () => {
            throw new Error("Hosted phone call request key collision.");
          }),
        },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "phone call start could not be confirmed",
    );
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "Do not retry automatically",
    );
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "a later result may arrive, but it is not guaranteed",
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toContain(
      "wait for the existing attempt's result",
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toBe(
      "phone call could not be started",
    );
  });

  it("reports a known pre-provider scheduled failure and asks for rescheduling", async () => {
    const scheduledScope: AssistantHostedScheduledPhoneCallScope = {
      automationId: "automation-scheduled-call",
      occurrenceAt: "2026-08-05T18:00:00.000Z",
      originSessionId: "session-scheduled-call-reconciliation-failure",
    };
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
        currentScheduledPhoneCallScope: () => scheduledScope,
        currentUserActionScope: () => null,
        phoneCalls: {
          start: vi.fn(async () => {
            throw Object.assign(
              new Error("Phone call start reconciliation is temporarily unavailable."),
              {
                code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
                retryable: true,
                status: 503,
              },
            );
          }),
        },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "no phone call was started",
    );
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "ask the requester to reschedule",
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toContain(
      "a later result",
    );
  });

  it("keeps attended start errors on the existing result", async () => {
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
          start: vi.fn(async () => {
            throw new Error("Hosted phone call request failed.");
          }),
        },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.contentItems[0]?.text).toBe(
      "phone call could not be started",
    );
  });

  it("uses the exact current group request for requester authority", async () => {
    const effectiveBrief = {
      ...BASE_BRIEF,
      allowTransferToUser: false,
    };
    const phoneCallScope = {
      ...BASE_SCOPE,
      acceptedInputIds: [
        OTHER_GROUP_INPUT_ID,
        GROUP_REQUEST_REF,
      ],
      inboundMailboxItemIds: [
        "earlier_group_mailbox_item",
        "group-request-mailbox-item",
      ],
      conversationScope: "group" as const,
      originSessionId: "session_group_phone_call",
    };
    const expectedRequestKey = createPhoneCallRequestKey({
      brief: effectiveBrief,
      scope: phoneCallScope,
    });
    const groupRequester = {
      assistantInputId: GROUP_REQUEST_REF,
      senderHandle: "+15551110003",
      source: "linq" as const,
    };
    const authorizeAcceptedMessageTarget = vi.fn(async () => ({
      participant: groupRequester,
      targetInputId: GROUP_REQUEST_REF,
    }));
    const start = vi.fn(async () => ({
      phoneCallId: "hpc_group",
      status: "calling" as const,
    }));
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        ...BASE_BRIEF,
        message_ref: GROUP_REQUEST_REF,
      },
      tool: MURPH_CREATE_PHONE_CALL_TOOL.name,
    }));
    if (!request || request.kind !== "create-phone-call") {
      throw new Error("Expected create phone call request.");
    }

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
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

    expect(authorizeAcceptedMessageTarget).toHaveBeenCalledTimes(1);
    expect(authorizeAcceptedMessageTarget).toHaveBeenCalledWith({
      action: "participant-effect",
      deliveryContextOrdinal: 0,
      messageRef: GROUP_REQUEST_REF,
    });
    expect(start).toHaveBeenCalledWith({
      brief: effectiveBrief,
      groupRequester,
      originSessionId: "session_group_phone_call",
      requestKey: expectedRequestKey,
    }, {
      signal: null,
    });
    expect(result.rpcResult.success).toBe(true);
  });

  it("rejects a stale group message ref before participant authorization", async () => {
    const start = vi.fn();
    const authorizeAcceptedMessageTarget = vi.fn();
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        ...BASE_BRIEF,
        message_ref: OTHER_GROUP_INPUT_ID,
      },
      tool: MURPH_CREATE_PHONE_CALL_TOOL.name,
    }));
    if (!request || request.kind !== "create-phone-call") {
      throw new Error("Expected create phone call request.");
    }

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        currentUserActionScope: () => ({
          ...BASE_SCOPE,
          acceptedInputIds: [OTHER_GROUP_INPUT_ID, GROUP_REQUEST_REF],
          conversationScope: "group",
          originSessionId: "session_group_phone_call",
        }),
        phoneCalls: { start },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(authorizeAcceptedMessageTarget).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "exact current accepted Message ref from the requesting participant",
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toContain("preview");
    expect(result.rpcResult.contentItems[0]?.text).not.toContain("later message");
  });

  it.each([
    ["missing message_ref", BASE_BRIEF, async (): ReturnType<
      AssistantAcceptedMessageTargetAuthorizer
    > => ({
      participant: {
        assistantInputId: GROUP_REQUEST_REF,
        senderHandle: "+15551110003",
        source: "linq" as const,
      },
      targetInputId: GROUP_REQUEST_REF,
    })],
    ["invented message_ref", { ...BASE_BRIEF, message_ref: GROUP_REQUEST_REF }, async (): ReturnType<
      AssistantAcceptedMessageTargetAuthorizer
    > => null],
    [
      "cross-message requester",
      { ...BASE_BRIEF, message_ref: GROUP_REQUEST_REF },
      async (): ReturnType<AssistantAcceptedMessageTargetAuthorizer> => ({
        participant: {
          assistantInputId: OTHER_GROUP_INPUT_ID,
          senderHandle: "+15551110002",
          source: "linq" as const,
        },
        targetInputId: GROUP_REQUEST_REF,
      }),
    ],
  ] as const)("fails closed for group phone calls with %s", async (
    _case,
    argumentsValue,
    authorizeAcceptedMessageTarget,
  ) => {
    const start = vi.fn();
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue,
      tool: MURPH_CREATE_PHONE_CALL_TOOL.name,
    }));
    if (!request || request.kind !== "create-phone-call") {
      throw new Error("Expected create phone call request.");
    }

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        currentUserActionScope: () => ({
          ...BASE_SCOPE,
          acceptedInputIds: [OTHER_GROUP_INPUT_ID, GROUP_REQUEST_REF],
          conversationScope: "group",
          originSessionId: "session_group_phone_call",
        }),
        phoneCalls: { start },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      "exact current accepted Message ref from the requesting participant",
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toContain("preview");
    expect(start).not.toHaveBeenCalled();
  });

  it("keeps group requester authorization failures neutral", async () => {
    const groupRequester = {
      assistantInputId: GROUP_REQUEST_REF,
      senderHandle: "+15551110003",
      source: "linq" as const,
    };
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        ...BASE_BRIEF,
        message_ref: GROUP_REQUEST_REF,
      },
      tool: MURPH_CREATE_PHONE_CALL_TOOL.name,
    }));
    if (!request || request.kind !== "create-phone-call") {
      throw new Error("Expected create phone call request.");
    }

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget: async () => ({
        participant: groupRequester,
        targetInputId: GROUP_REQUEST_REF,
      }),
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        currentUserActionScope: () => ({
          ...BASE_SCOPE,
          acceptedInputIds: [GROUP_REQUEST_REF],
          conversationScope: "group",
          originSessionId: "session_group_phone_call",
        }),
        phoneCalls: {
          start: vi.fn(async () => {
            throw {
              code:
                "HOSTED_GROUP_PHONE_CALL_REQUESTER_ACTIVATION_REQUIRED",
            };
          }),
        },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.contentItems[0]?.text).toBe(
      "the group phone call could not be started for the selected participant",
    );
    expect(result.rpcResult.contentItems[0]?.text).not.toContain("set one up");
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
  currentScheduledPhoneCallScope?: AssistantHostedToolContext["currentScheduledPhoneCallScope"];
  currentUserActionScope?: AssistantHostedToolContext["currentUserActionScope"];
  phoneCalls?: AssistantHostedToolContext["phoneCalls"];
}): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentScheduledPhoneCallScope: input.currentScheduledPhoneCallScope,
    currentUserActionScope: input.currentUserActionScope,
    phoneCalls: input.phoneCalls ?? null,
    sendVaultFile: vi.fn(async () => {
      throw new Error("Vault-file sending is unavailable for this turn.");
    }),
    vaultFileSendAvailable: false,
  };
}
