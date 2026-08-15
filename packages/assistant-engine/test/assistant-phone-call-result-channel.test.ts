import { describe, expect, it, vi } from "vitest";

import type {
  HostedPhoneCallStartRequest,
} from "@murphai/hosted-execution/phone-calls";

import {
  createAssistantHostedToolContext,
  resolveAssistantHostedPhoneCallResultNotificationChannel,
  resolveAssistantHostedScheduledPhoneCallScope,
} from "../src/assistant/hosted-tool-context.js";

const START_REQUEST: HostedPhoneCallStartRequest = {
  brief: {
    allowTransferToUser: false,
    goal: "Confirm the reservation.",
    instructions: [],
    shareableFacts: {},
    successCriteria: "The reservation status is known.",
    timeZone: "America/New_York",
    to: { phoneNumber: "+14045550123" },
  },
  originSessionId: "session_phone_call",
  requestKey: "phone_call_request",
};

describe("assistant hosted phone-call result routing", () => {
  it.each([
    ["linq", "direct", "linq"],
    ["telegram", "direct", "telegram"],
    ["email", "direct", null],
    ["telegram", "group", null],
  ] as const)(
    "maps a %s %s turn to its bounded direct result channel",
    (channel, conversationScope, expected) => {
      expect(resolveAssistantHostedPhoneCallResultNotificationChannel({
        channel,
        conversationScope,
      })).toBe(expected);
    },
  );

  it.each([
    ["linq", "direct", "linq"],
    ["telegram", "direct", "telegram"],
    ["telegram", "group", undefined],
  ] as const)(
    "injects only the bounded result channel for a %s %s call",
    async (channel, conversationScope, expectedChannel) => {
      const start = vi.fn(async () => ({
        phoneCallId: "hpc_test",
        status: "calling" as const,
      }));
      const context = createAssistantHostedToolContext({
        executionContext: {
          memberId: "member_phone_call",
          phoneCalls: { start },
          userEnvKeys: [],
        },
        getConversationScope: () => conversationScope,
        messageInput: {
          channel,
        } as never,
        session: {
          binding: { channel },
          sessionId: "session_phone_call",
        } as never,
      });

      await expect(context.phoneCalls?.start(START_REQUEST)).resolves.toEqual({
        phoneCallId: "hpc_test",
        status: "calling",
      });
      expect(start).toHaveBeenCalledWith({
        ...START_REQUEST,
        ...(expectedChannel
          ? { resultNotificationChannel: expectedChannel }
          : {}),
      }, undefined);
    },
  );

  it("grants exact direct Telegram cron authority", () => {
    const occurrenceAt = "2026-08-06T18:00:00.000Z";

    expect(resolveAssistantHostedScheduledPhoneCallScope({
      channel: "telegram",
      conversationScope: "direct",
      messageInput: {
        scheduledInvocationAuthority: {
          automationId: "automation_telegram_call",
          occurrenceAt,
        },
        scheduledOccurrenceAt: occurrenceAt,
        turnTrigger: "automation-cron",
      },
      originSessionId: "session_telegram_call",
    })).toEqual({
      automationId: "automation_telegram_call",
      occurrenceAt,
      originSessionId: "session_telegram_call",
    });
  });

  it("still withholds email and group scheduled calls", () => {
    const occurrenceAt = "2026-08-06T18:00:00.000Z";
    const messageInput = {
      scheduledInvocationAuthority: {
        automationId: "automation_unsupported_call",
        occurrenceAt,
      },
      scheduledOccurrenceAt: occurrenceAt,
      turnTrigger: "automation-cron" as const,
    };

    expect(resolveAssistantHostedScheduledPhoneCallScope({
      channel: "email",
      conversationScope: "direct",
      messageInput,
      originSessionId: "session_email_call",
    })).toBeNull();
    expect(resolveAssistantHostedScheduledPhoneCallScope({
      channel: "telegram",
      conversationScope: "group",
      messageInput,
      originSessionId: "session_group_call",
    })).toBeNull();
  });
});
