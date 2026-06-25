import { describe, expect, it } from "vitest";

import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

import {
  MURPH_CREATE_PHONE_CALL_TOOL,
  createPhoneCallRequestKey,
  resolveAssistantPhoneCallAcceptedInputIds,
} from "../src/assistant-codex/dynamic-tools/phone-calls.js";
import {
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import type {
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
  assistantTurnOrdinal: "7",
  conversationId: "conversation_1",
  inboundMailboxItemIds: ["mailbox_item_1"],
  recipientKey: "recipient_1",
  turnId: "turn_1",
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

  it("uses only user/manual accepted input as phone-call authority", () => {
    const acceptedInputItems = [
      { id: "initial_user", source: "initial" as const },
      { id: "assistant_input", source: "assistant-input" as const },
      { id: "manual_input", source: "manual" as const },
      { id: "system_input", source: "system" as const },
    ];

    expect(resolveAssistantPhoneCallAcceptedInputIds({
      acceptedInputItems,
      turnTrigger: null,
    })).toEqual(["initial_user", "assistant_input", "manual_input"]);
    expect(resolveAssistantPhoneCallAcceptedInputIds({
      acceptedInputItems,
      turnTrigger: "automation-cron",
    })).toEqual([]);
    expect(resolveAssistantPhoneCallAcceptedInputIds({
      acceptedInputItems,
      turnTrigger: "automation-auto-reply",
    })).toEqual([]);
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

    expect(first).toMatch(/^phone_call_[a-f0-9]{64}$/u);
    expect(reworded).not.toBe(first);
    expect(differentDisclosure).not.toBe(first);
    expect(differentInput).not.toBe(first);
    expect(() => createPhoneCallRequestKey({
      brief: BASE_BRIEF,
      scope: {
        ...BASE_SCOPE,
        acceptedInputIds: [],
      },
    })).toThrow("accepted user input");
  });
});
