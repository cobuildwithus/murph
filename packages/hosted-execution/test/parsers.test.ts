import { describe, expect, it } from "vitest";

import {
  parseHostedExecutionEvent,
  parseHostedExecutionWake,
  parseHostedRuntimeFamilyPlanToolRequest,
  parseHostedRuntimeFamilyPlanToolResponse,
} from "../src/parsers.ts";

describe("parseHostedExecutionEvent", () => {
  it("parses runtime control events", () => {
    expect(
      parseHostedExecutionEvent({
        kind: "runtime.maintenance-requested",
        userId: "user-1",
      }),
    ).toEqual({
      kind: "runtime.maintenance-requested",
      userId: "user-1",
    });
  });

  it("parses Codex auth runtime-control events with exact keys", () => {
    expect(
      parseHostedExecutionEvent({
        action: "connect",
        attemptId: "hca_abcdefghijklmnop",
        kind: "runtime.codex-auth-requested",
        userId: "user-1",
      }),
    ).toEqual({
      action: "connect",
      attemptId: "hca_abcdefghijklmnop",
      kind: "runtime.codex-auth-requested",
      userId: "user-1",
    });
    expect(() =>
      parseHostedExecutionEvent({
        action: "connect",
        attemptId: "hca_abcdefghijklmnop",
        kind: "runtime.codex-auth-requested",
        userCode: "ABCD-EFGH",
        userId: "user-1",
      })
    ).toThrow(/unsupported field/u);
  });

  it("parses Codex auth runtime-control wakes with exact keys", () => {
    expect(
      parseHostedExecutionWake({
        action: "disconnect",
        attemptId: "hca_abcdefghijklmnop",
        eventId: "runtime-control:codex-auth",
        kind: "runtime.codex-auth-requested",
        occurredAt: "2026-04-08T00:15:00.000Z",
        userId: "user-1",
      }),
    ).toEqual({
      action: "disconnect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      kind: "runtime.codex-auth-requested",
      occurredAt: "2026-04-08T00:15:00.000Z",
      userId: "user-1",
    });
    expect(() =>
      parseHostedExecutionWake({
        action: "disconnect",
        attemptId: "not-an-attempt",
        eventId: "runtime-control:codex-auth",
        kind: "runtime.codex-auth-requested",
        occurredAt: "2026-04-08T00:15:00.000Z",
        userId: "user-1",
      })
    ).toThrow(/attemptId/u);
  });

  it("parses explicit member channel sync events", () => {
    expect(
      parseHostedExecutionEvent({
        kind: "member.channels.updated",
        memberChannels: {
          email: true,
          linq: false,
          telegram: true,
        },
        userId: "user-1",
      }),
    ).toEqual({
      kind: "member.channels.updated",
      memberChannels: {
        email: true,
        linq: false,
        telegram: true,
      },
      userId: "user-1",
    });
  });

  it("parses member activation signup welcomes and ignores legacy fixed policy fields", () => {
    expect(
      parseHostedExecutionEvent({
        kind: "member.activated",
        memberChannels: {
          email: true,
          linq: true,
          telegram: false,
        },
        signupWelcome: {
          deliveryDispatchMode: "queue-only",
          deliveryDedupeToken: "signup-welcome:user-1",
          deliveryIdempotencyKey: "signup-welcome:user-1",
          firstContact: {
            markSeenOnDeliveryAccepted: true,
          },
          route: {
            actorId: "+15550002222",
            channel: "linq",
            delivery: {
              kind: "thread",
              target: "chat_home_123",
            },
            identityId: "hbidx:phone:v1:test",
            threadId: "chat_home_123",
            threadIsDirect: true,
          },
          text: "Welcome to Murph, your personal health assistant.",
        },
        userId: "user-1",
      }),
    ).toEqual({
      kind: "member.activated",
      memberChannels: {
        email: true,
        linq: true,
        telegram: false,
      },
      signupWelcome: {
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "chat_home_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "chat_home_123",
          threadIsDirect: true,
        },
        text: "Welcome to Murph, your personal health assistant.",
      },
      userId: "user-1",
    });
  });

  it("parses assistant notification requests with participant delivery routes", () => {
    expect(
      parseHostedExecutionEvent({
        kind: "assistant.notification.requested",
        notification: {
          deliveryDispatchMode: "queue-only",
          deliveryDedupeToken: "signup-welcome:user-1",
          deliveryIdempotencyKey: "signup-welcome:user-1",
          firstContact: {
            markSeenOnDeliveryAccepted: true,
          },
          instructions: "Send exactly the signup welcome.",
          responsePolicy: {
            kind: "require_send_exact_text",
            text: "Welcome to Murph, your personal health assistant.",
          },
          route: {
            actorId: "+15550002222",
            channel: "linq",
            delivery: {
              kind: "participant",
              source: {
                fromPhoneNumber: "+15550001111",
                kind: "linq",
              },
              target: "+15550002222",
            },
            identityId: "hbidx:phone:v1:test",
            threadId: null,
            threadIsDirect: true,
          },
        },
        userId: "user-1",
      }),
    ).toEqual({
      kind: "assistant.notification.requested",
      notification: {
        deliveryDispatchMode: "queue-only",
        deliveryDedupeToken: "signup-welcome:user-1",
        deliveryIdempotencyKey: "signup-welcome:user-1",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph, your personal health assistant.",
        },
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "participant",
            source: {
              fromPhoneNumber: "+15550001111",
              kind: "linq",
            },
            target: "+15550002222",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: null,
          threadIsDirect: true,
        },
      },
      userId: "user-1",
    });
  });

  it("parses device-sync wake events with hint jobs and revoke warnings", () => {
    expect(
      parseHostedExecutionEvent({
        connectionId: "connection-1",
        hint: {
          eventType: "sleep.updated",
          jobs: [
            {
              availableAt: "2026-04-09T00:00:00Z",
              dedupeKey: null,
              kind: "reconcile",
              maxAttempts: 3,
              payload: {
                resourceId: "sleep_123",
              },
              priority: 2,
            },
          ],
          nextReconcileAt: "2026-04-09T01:00:00Z",
          occurredAt: "2026-04-09T00:00:00Z",
          reason: "webhook",
          resourceCategory: "sleep",
          revokeWarning: {
            code: "reauthorization_required",
            message: "Reconnect your provider.",
          },
          scopes: ["sleep.read"],
          traceId: "trace-1",
        },
        kind: "device-sync.wake",
        provider: "oura",
        reason: "webhook_hint",
        userId: "user-1",
      }),
    ).toEqual({
      connectionId: "connection-1",
      hint: {
        eventType: "sleep.updated",
        jobs: [
          {
            availableAt: "2026-04-09T00:00:00.000Z",
            dedupeKey: null,
            kind: "reconcile",
            maxAttempts: 3,
            payload: {
              resourceId: "sleep_123",
            },
            priority: 2,
          },
        ],
        nextReconcileAt: "2026-04-09T01:00:00.000Z",
        occurredAt: "2026-04-09T00:00:00.000Z",
        reason: "webhook",
        resourceCategory: "sleep",
        revokeWarning: {
          code: "reauthorization_required",
          message: "Reconnect your provider.",
        },
        scopes: ["sleep.read"],
        traceId: "trace-1",
      },
      kind: "device-sync.wake",
      provider: "oura",
      reason: "webhook_hint",
      userId: "user-1",
    });
  });

  it("parses device-sync reconcile_due wakes", () => {
    expect(
      parseHostedExecutionEvent({
        connectionId: "connection-1",
        hint: {
          nextReconcileAt: "2026-04-09T01:00:00Z",
          occurredAt: "2026-04-09T00:00:00Z",
          reason: "scheduled-reconcile",
        },
        kind: "device-sync.wake",
        provider: "oura",
        reason: "reconcile_due",
        userId: "user-1",
      }),
    ).toEqual({
      connectionId: "connection-1",
      hint: {
        nextReconcileAt: "2026-04-09T01:00:00.000Z",
        occurredAt: "2026-04-09T00:00:00.000Z",
        reason: "scheduled-reconcile",
      },
      kind: "device-sync.wake",
      provider: "oura",
      reason: "reconcile_due",
      userId: "user-1",
    });
  });

  it("rejects invalid assistant notification route channels", () => {
    expect(() =>
      parseHostedExecutionEvent({
        kind: "assistant.notification.requested",
        notification: {
          instructions: "Send the Murph signup welcome.",
          route: {
            actorId: null,
            channel: "sms",
            delivery: {
              kind: "thread",
              target: "thread_123",
            },
            identityId: "assistant@example.com",
            threadId: "thread_123",
            threadIsDirect: true,
          },
        },
        userId: "user-1",
      }),
    ).toThrow(/channel is invalid/i);
  });

  it("rejects legacy provider message event kinds", () => {
    expect(() =>
      parseHostedExecutionEvent({
        kind: "telegram.message.received",
        telegramMessage: {
          messageId: "message-1",
          schema: "murph.hosted-telegram-message.v1",
          threadId: "thread-1",
        },
        userId: "user-1",
      }),
    ).toThrow(/Unsupported hosted execution event kind/i);

    expect(() =>
      parseHostedExecutionEvent({
        kind: "linq.message.received",
        linqMessage: {
          chatId: "chat_123",
          from: "+15551234567",
          isFromMe: false,
          messageId: "msg_123",
          parts: [],
        },
        phoneLookupKey: "phone_lookup_123",
        userId: "user-1",
      }),
    ).toThrow(/Unsupported hosted execution event kind/i);

    expect(() =>
      parseHostedExecutionEvent({
        identityId: null,
        kind: "email.message.received",
        rawMessageKey: "raw_123",
        userId: "user-1",
      }),
    ).toThrow(/Unsupported hosted execution event kind/i);
  });
});

describe("parseHostedRuntimeFamilyPlanTool", () => {
  it("parses checkout and create-invite requests and rejects missing invite routes", () => {
    expect(parseHostedRuntimeFamilyPlanToolRequest({
      action: "start_checkout",
    })).toEqual({
      action: "start_checkout",
    });
    expect(parseHostedRuntimeFamilyPlanToolRequest({
      action: "start_checkout",
      invite: {
        targetLabel: "dad",
        targetPhoneNumber: null,
        targetTelegramUsername: "dad_username",
      },
    })).toEqual({
      action: "start_checkout",
      invite: {
        targetLabel: "dad",
        targetPhoneNumber: null,
        targetTelegramUsername: "dad_username",
      },
    });

    expect(parseHostedRuntimeFamilyPlanToolRequest({
      action: "create_invite",
      invite: {
        targetLabel: "dad",
        targetPhoneNumber: "+48 600 000 000",
        targetTelegramUsername: "dad_username",
      },
    })).toEqual({
      action: "create_invite",
      invite: {
        targetLabel: "dad",
        targetPhoneNumber: "+48 600 000 000",
        targetTelegramUsername: "dad_username",
      },
    });

    expect(() =>
      parseHostedRuntimeFamilyPlanToolRequest({
        action: "start_checkout",
        invite: {
          targetLabel: "dad",
        },
      })
    ).toThrow(/phone number or Telegram username/u);

    expect(() =>
      parseHostedRuntimeFamilyPlanToolRequest({
        action: "create_invite",
        invite: {
          targetLabel: "dad",
        },
      })
    ).toThrow(/phone number or Telegram username/u);
  });

  it("parses family plan status responses with sanitized member and invite fields", () => {
    expect(parseHostedRuntimeFamilyPlanToolResponse({
      action: "read_status",
      result: {
        billingActive: true,
        billingStatus: "active",
        members: [
          {
            isOwner: true,
            label: null,
            role: "owner",
            status: "active",
          },
        ],
        owner: true,
        pendingInvites: [
          {
            acceptUrl: null,
            expiresAt: "2026-06-25T00:00:00.000Z",
            status: "pending",
            targetLabel: "dad",
            targetPhoneHint: "+48 *** *** 000",
            telegramInviteUrl: "https://t.me/murphdevbot?start=family_token",
          },
        ],
        seats: {
          active: 1,
          billed: 2,
          invited: 1,
          max: 6,
          min: 2,
          remaining: 0,
          used: 2,
        },
      },
    })).toMatchObject({
      action: "read_status",
      result: {
        billingActive: true,
        seats: {
          billed: 2,
          max: 6,
          min: 2,
          remaining: 0,
        },
      },
    });
  });

  it("parses family plan checkout responses", () => {
    expect(parseHostedRuntimeFamilyPlanToolResponse({
      action: "start_checkout",
      result: {
        alreadyActive: false,
        billingActive: false,
        billingStatus: "not_started",
        checkoutUrl: "https://checkout.stripe.test/family",
        owner: true,
        preparedInvite: {
          acceptUrl: null,
          expiresAt: "2026-06-25T00:00:00.000Z",
          status: "pending",
          targetLabel: "Adam",
          targetPhoneHint: null,
          telegramInviteUrl: "https://t.me/murphdevbot?start=family_token",
        },
        preparedInviteReplyText: "Done. I prepared a Murph Family invite for Adam.",
        seats: {
          active: 1,
          billed: 2,
          invited: 0,
          max: 6,
          min: 2,
          remaining: 1,
          used: 1,
        },
        unavailableReason: null,
      },
    })).toEqual({
      action: "start_checkout",
      result: {
        alreadyActive: false,
        billingActive: false,
        billingStatus: "not_started",
        checkoutUrl: "https://checkout.stripe.test/family",
        owner: true,
        preparedInvite: {
          acceptUrl: null,
          expiresAt: "2026-06-25T00:00:00.000Z",
          status: "pending",
          targetLabel: "Adam",
          targetPhoneHint: null,
          telegramInviteUrl: "https://t.me/murphdevbot?start=family_token",
        },
        preparedInviteReplyText: "Done. I prepared a Murph Family invite for Adam.",
        seats: {
          active: 1,
          billed: 2,
          invited: 0,
          max: 6,
          min: 2,
          remaining: 1,
          used: 1,
        },
        unavailableReason: null,
      },
    });

    expect(parseHostedRuntimeFamilyPlanToolResponse({
      action: "start_checkout",
      result: {
        alreadyActive: false,
        billingActive: false,
        billingStatus: "none",
        checkoutUrl: null,
        owner: false,
        preparedInvite: null,
        preparedInviteReplyText: null,
        seats: {
          active: 0,
          billed: 2,
          invited: 0,
          max: 6,
          min: 2,
          remaining: 2,
          used: 0,
        },
        unavailableReason: "already_sponsored",
      },
    })).toMatchObject({
      action: "start_checkout",
      result: {
        unavailableReason: "already_sponsored",
      },
    });
  });
});

describe("parseHostedExecutionWake", () => {
  it("parses runtime control wakes", () => {
    expect(
      parseHostedExecutionWake({
        eventId: "evt_runtime_control",
        kind: "runtime.maintenance-requested",
        occurredAt: "2026-04-18T00:00:00.000Z",
        userId: "user-1",
      }),
    ).toEqual({
      eventId: "evt_runtime_control",
      kind: "runtime.maintenance-requested",
      occurredAt: "2026-04-18T00:00:00.000Z",
      userId: "user-1",
    });
  });

  it("parses member activation wakes with embedded signup welcomes", () => {
    expect(
      parseHostedExecutionWake({
        eventId: "member.activated:stripe:user-1:evt-1",
        kind: "member.activated",
        memberChannels: {
          email: false,
          linq: true,
          telegram: false,
        },
        occurredAt: "2026-04-18T00:00:00.000Z",
        signupWelcome: {
          deliveryDispatchMode: "immediate",
          deliveryDedupeToken: "legacy-dedupe-should-not-persist",
          deliveryIdempotencyKey: "legacy-idempotency-should-not-persist",
          firstContact: {
            markSeenOnDeliveryAccepted: false,
          },
          route: {
            actorId: "+15550002222",
            channel: "linq",
            delivery: {
              kind: "thread",
              target: "chat_home_123",
            },
            identityId: "hbidx:phone:v1:test",
            threadId: "chat_home_123",
            threadIsDirect: true,
          },
          text: "Welcome to Murph.",
        },
        userId: "user-1",
      }),
    ).toEqual({
      eventId: "member.activated:stripe:user-1:evt-1",
      kind: "member.activated",
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      occurredAt: "2026-04-18T00:00:00.000Z",
      signupWelcome: {
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "chat_home_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "chat_home_123",
          threadIsDirect: true,
        },
        text: "Welcome to Murph.",
      },
      userId: "user-1",
    });
  });

  it("parses WhatsApp conversation wakes", () => {
    expect(
      parseHostedExecutionWake({
        eventId: "evt_whatsapp",
        kind: "conversation.message",
        message: {
          channel: "whatsapp",
          whatsappMessage: {
            fromWaId: "15551234567",
            messageId: "wamid.test",
            phoneNumberId: "phone-number-id",
            schema: "murph.hosted-whatsapp-message.v1",
            text: "CHECKIN",
            threadId: "15551234567",
          },
        },
        occurredAt: "2026-04-18T00:00:00.000Z",
        userId: "user-1",
      }),
    ).toEqual({
      eventId: "evt_whatsapp",
      kind: "conversation.message",
      message: {
        channel: "whatsapp",
        whatsappMessage: {
          fromWaId: "15551234567",
          messageId: "wamid.test",
          phoneNumberId: "phone-number-id",
          schema: "murph.hosted-whatsapp-message.v1",
          text: "CHECKIN",
          threadId: "15551234567",
        },
      },
      occurredAt: "2026-04-18T00:00:00.000Z",
      userId: "user-1",
    });
  });

  it("parses Linq conversation wakes keyed by email contact lookup", () => {
    expect(
      parseHostedExecutionWake({
        eventId: "evt_linq_email",
        kind: "conversation.message",
        message: {
          channel: "linq",
          contactKind: "email",
          contactLookupKey: "hbidx:email:v1:test",
          linqMessage: {
            chatId: "chat_email",
            from: "buddy@icloud.com",
            isFromMe: false,
            messageId: "msg_email",
            parts: [
              {
                type: "text",
                value: "hello",
              },
            ],
          },
        },
        occurredAt: "2026-04-18T00:00:00.000Z",
        userId: "user-1",
      }),
    ).toEqual({
      eventId: "evt_linq_email",
      kind: "conversation.message",
      message: {
        channel: "linq",
        contactKind: "email",
        contactLookupKey: "hbidx:email:v1:test",
        linqMessage: {
          chatId: "chat_email",
          from: "buddy@icloud.com",
          isFromMe: false,
          messageId: "msg_email",
          parts: [
            {
              type: "text",
              value: "hello",
            },
          ],
        },
      },
      occurredAt: "2026-04-18T00:00:00.000Z",
      userId: "user-1",
    });
  });
});
