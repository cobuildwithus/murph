import { describe, expect, it, vi } from "vitest";

import {
  createAssistantHostedToolContext,
  resolveAssistantHostedPhoneCallResultNotificationChannel,
  resolveAssistantHostedScheduledPhoneCallScope,
} from "../src/assistant/hosted-tool-context.js";

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
    ["linq", "direct", true, "linq"],
    ["telegram", "direct", true, "telegram"],
    ["telegram", "direct", false, undefined],
    ["telegram", "group", true, undefined],
  ] as const)(
    "exposes bounded scheduled authority for a %s %s scheduled=%s call",
    (channel, conversationScope, scheduled, expectedChannel) => {
      const start = vi.fn(async () => ({
        phoneCallId: "hpc_test",
        status: "calling" as const,
      }));
      const occurrenceAt = "2026-08-06T18:00:00.000Z";
      const context = createAssistantHostedToolContext({
        executionContext: {
          memberId: "member_phone_call",
          phoneCalls: { start },
          userEnvKeys: [],
        },
        getConversationScope: () => conversationScope,
        messageInput: {
          channel,
          ...(scheduled
            ? {
                scheduledInvocationAuthority: {
                  automationId: "automation_phone_call",
                  occurrenceAt,
                },
                scheduledOccurrenceAt: occurrenceAt,
                turnTrigger: "automation-cron",
              }
            : {}),
        } as never,
        session: {
          binding: { channel },
          sessionId: "session_phone_call",
        } as never,
      });

      const scope = context.currentScheduledPhoneCallScope?.() ?? null;
      if (expectedChannel) {
        expect(scope).toEqual({
          automationId: "automation_phone_call",
          occurrenceAt,
          originSessionId: "session_phone_call",
          resultNotificationChannel: expectedChannel,
        });
      } else {
        expect(scope).toBeNull();
      }
      expect(start).not.toHaveBeenCalled();
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
      resultNotificationChannel: "telegram",
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
