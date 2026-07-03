import { describe, expect, it } from "vitest";

import {
  parseHostedExecutionEvent,
  parseHostedExecutionWake,
  parseHostedRuntimeFamilyPlanToolRequest,
  parseHostedRuntimeFamilyPlanToolResponse,
  parseHostedRuntimeGroupToolRequest,
  parseHostedRuntimeGroupToolResponse,
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

  it("parses routed Linq conversation wakes with durable route authority", () => {
    expect(
      parseHostedExecutionWake({
        eventId: "linq-route-1",
        kind: "conversation.message",
        message: {
          accountLookupKey: "hbidx:phone:v1:account",
          channel: "linq",
          contactKind: "phone",
          contactLookupKey: "hbidx:phone:v1:sender",
          linqMessage: {
            chatId: "chat_123",
            from: "+15550001111",
            isFromMe: false,
            messageId: "msg_123",
            parts: [
              {
                type: "text",
                value: "hello",
              },
            ],
          },
          phoneLookupKey: "hbidx:phone:v1:sender",
          routeAuthority: {
            accountLookupKey: "hbidx:phone:v1:account",
            channel: "linq",
            containerMemberId: "member_container_123",
            threadId: "chat_123",
          },
        },
        occurredAt: "2026-04-08T00:15:00.000Z",
        userId: "member_container_123",
      }),
    ).toMatchObject({
      message: {
        routeAuthority: {
          accountLookupKey: "hbidx:phone:v1:account",
          channel: "linq",
          containerMemberId: "member_container_123",
          threadId: "chat_123",
        },
      },
    });
  });

  it("rejects routed Linq conversation wakes with non-Linq route authority", () => {
    expect(() =>
      parseHostedExecutionWake({
        eventId: "linq-route-1",
        kind: "conversation.message",
        message: {
          accountLookupKey: "hbidx:phone:v1:account",
          channel: "linq",
          contactKind: "phone",
          contactLookupKey: "hbidx:phone:v1:sender",
          linqMessage: {
            chatId: "chat_123",
            from: "+15550001111",
            isFromMe: false,
            messageId: "msg_123",
            parts: [
              {
                type: "text",
                value: "hello",
              },
            ],
          },
          phoneLookupKey: "hbidx:phone:v1:sender",
          routeAuthority: {
            accountLookupKey: "hbidx:phone:v1:account",
            channel: "telegram",
            containerMemberId: "member_container_123",
            threadId: "chat_123",
          },
        },
        occurredAt: "2026-04-08T00:15:00.000Z",
        userId: "member_container_123",
      })
    ).toThrow(/channel must be linq/u);
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

describe("parseHostedRuntimeGroupTool", () => {
  const GROUP_SUMMARY = {
    displayName: "Sunday sleep crew",
    id: "hgrp_123",
    kind: "friends",
    memberCount: 3,
    requestedVaultShareProjectionKinds: ["sleep-times.v0"],
    status: "active",
  };
  const PARSED_GROUP_SUMMARY = {
    ...GROUP_SUMMARY,
    members: [],
  };

  it("parses read and create_join_link requests and rejects other mutations", () => {
    expect(parseHostedRuntimeGroupToolRequest({
      action: "read_current",
    })).toEqual({
      action: "read_current",
    });

    expect(parseHostedRuntimeGroupToolRequest({
      action: "create_join_link",
    })).toEqual({
      action: "create_join_link",
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "create_join_link",
      joinLink: {
        displayName: "Sunday sleep crew",
        kind: "friends",
        requestedVaultShareProjectionKinds: ["sleep-times.v0", "activity-days.v0"],
      },
    })).toEqual({
      action: "create_join_link",
      joinLink: {
        displayName: "Sunday sleep crew",
        kind: "friends",
        requestedVaultShareProjectionKinds: ["sleep-times.v0", "activity-days.v0"],
      },
    });

    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "delete_group",
      })
    ).toThrow(/not supported/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "read_current",
        requestedVaultShareProjectionKinds: ["sleep-times.v0"],
      })
    ).toThrow(/not allowed/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "create_join_link",
        joinLink: { kind: "everyone" },
      })
    ).toThrow(/not supported/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionKinds: ["all-health-data"] },
      })
    ).toThrow(/unsupported projection kind/u);
    // Membership-implied, never requestable: the join-link request contract is closed
    // over the individually selectable kinds.
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionKinds: ["profile-name.v0"] },
      })
    ).toThrow(/unsupported projection kind/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "create_join_link",
        joinLink: { displayName: "   " },
      })
    ).toThrow(/must not be blank/u);
  });

  it("parses create_join_link responses", () => {
    expect(parseHostedRuntimeGroupToolResponse({
      action: "create_join_link",
      result: {
        group: GROUP_SUMMARY,
        joinUrl: "https://example.com/groups/join/abc123",
        status: "ok",
      },
    })).toEqual({
      action: "create_join_link",
      result: {
        group: PARSED_GROUP_SUMMARY,
        joinUrl: "https://example.com/groups/join/abc123",
        status: "ok",
      },
    });

    expect(parseHostedRuntimeGroupToolResponse({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "not_group_runtime",
      },
    })).toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "not_group_runtime",
      },
    });

    expect(() =>
      parseHostedRuntimeGroupToolResponse({
        action: "create_join_link",
        result: {
          group: GROUP_SUMMARY,
          joinCode: "abc123",
          joinUrl: "https://example.com/groups/join/abc123",
          status: "ok",
        },
      })
    ).toThrow(/not allowed/u);
  });

  it("parses group tool responses with the typed member roster only", () => {
    // Summaries without a roster stay parseable so a runner updated before web
    // keeps working during deploy skew.
    expect(parseHostedRuntimeGroupToolResponse({
      action: "read_current",
      result: {
        group: GROUP_SUMMARY,
        status: "ok",
      },
    })).toEqual({
      action: "read_current",
      result: {
        group: PARSED_GROUP_SUMMARY,
        status: "ok",
      },
    });

    expect(parseHostedRuntimeGroupToolResponse({
      action: "read_current",
      result: {
        group: {
          ...GROUP_SUMMARY,
          members: [
            {
              grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-times.v0"],
              handle: "+15551110000",
              memberId: "member_owner_123",
              role: "owner",
            },
            {
              grantedVaultShareProjectionKinds: [],
              handle: null,
              memberId: "member_joiner_456",
              role: "member",
            },
          ],
        },
        status: "ok",
      },
    })).toEqual({
      action: "read_current",
      result: {
        group: {
          ...GROUP_SUMMARY,
          members: [
            {
              grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-times.v0"],
              handle: "+15551110000",
              memberId: "member_owner_123",
              role: "owner",
            },
            {
              grantedVaultShareProjectionKinds: [],
              handle: null,
              memberId: "member_joiner_456",
              role: "member",
            },
          ],
        },
        status: "ok",
      },
    });

    // Roster entries stay a closed shape: unknown member fields are rejected.
    expect(() =>
      parseHostedRuntimeGroupToolResponse({
        action: "read_current",
        result: {
          group: {
            ...GROUP_SUMMARY,
            members: [{ id: "member_other" }],
          },
          status: "ok",
        },
      })
    ).toThrow(/not allowed/u);
  });

  const LINQ_THREAD = {
    authority: {
      accountLookupKey: "hplk_account",
      channel: "linq",
      containerMemberId: "member_container",
      threadId: "chat_group_1",
    },
    chatId: "chat_group_1",
  };

  it("parses chat-scoped requests with and without the runtime-injected linqThread", () => {
    expect(parseHostedRuntimeGroupToolRequest({
      action: "read_chat_participants",
    })).toEqual({
      action: "read_chat_participants",
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "share_contact_card",
      linqThread: LINQ_THREAD,
    })).toEqual({
      action: "share_contact_card",
      linqThread: LINQ_THREAD,
    });

    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "read_chat_participants",
        linqThread: { chatId: "chat_group_1" },
      })
    ).toThrow(/not allowed|authority/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "share_contact_card",
        linqThread: {
          ...LINQ_THREAD,
          authority: { ...LINQ_THREAD.authority, channel: "email" },
        },
      })
    ).toThrow(/channel/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "share_contact_card",
        chatId: "chat_group_1",
      })
    ).toThrow(/not allowed/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "share_contact_card",
        linqThread: {
          ...LINQ_THREAD,
          authority: { ...LINQ_THREAD.authority, extra: "field" },
        },
      })
    ).toThrow(/not allowed/u);
  });

  it("parses read_chat_participants responses and caps the participant list", () => {
    expect(parseHostedRuntimeGroupToolResponse({
      action: "read_chat_participants",
      result: {
        participants: [
          { handle: "+15550000001", hasOwnMurph: true },
          { handle: "person@example.com", hasOwnMurph: false },
        ],
        status: "ok",
      },
    })).toEqual({
      action: "read_chat_participants",
      result: {
        participants: [
          { handle: "+15550000001", hasOwnMurph: true },
          { handle: "person@example.com", hasOwnMurph: false },
        ],
        status: "ok",
      },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "read_chat_participants",
      result: {
        participants: null,
        status: "unavailable",
        unavailableReason: "linq_thread_unavailable",
      },
    })).toEqual({
      action: "read_chat_participants",
      result: {
        participants: null,
        status: "unavailable",
        unavailableReason: "linq_thread_unavailable",
      },
    });

    expect(() =>
      parseHostedRuntimeGroupToolResponse({
        action: "read_chat_participants",
        result: {
          participants: Array.from({ length: 33 }, (_, index) => ({
            handle: `+1555000${index}`,
            hasOwnMurph: false,
          })),
          status: "ok",
        },
      })
    ).toThrow(/at most 32/u);
    expect(() =>
      parseHostedRuntimeGroupToolResponse({
        action: "read_chat_participants",
        result: {
          participants: [{ handle: "+15550000001", hasOwnMurph: false, memberId: "m_1" }],
          status: "ok",
        },
      })
    ).toThrow(/not allowed/u);
  });

  it("parses share_contact_card responses", () => {
    expect(parseHostedRuntimeGroupToolResponse({
      action: "share_contact_card",
      result: { status: "sent" },
    })).toEqual({
      action: "share_contact_card",
      result: { status: "sent" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "share_contact_card",
      result: { status: "already_shared" },
    })).toEqual({
      action: "share_contact_card",
      result: { status: "already_shared" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "share_contact_card",
      result: { status: "unavailable", unavailableReason: "send_failed" },
    })).toEqual({
      action: "share_contact_card",
      result: { status: "unavailable", unavailableReason: "send_failed" },
    });
    expect(() =>
      parseHostedRuntimeGroupToolResponse({
        action: "share_contact_card",
        result: { status: "sent", messageId: "msg_1" },
      })
    ).toThrow(/not allowed/u);
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
        targetEmail: "dad@example.com",
        targetLabel: "dad",
        targetPhoneNumber: null,
        targetTelegramUsername: null,
      },
    })).toEqual({
      action: "create_invite",
      invite: {
        targetEmail: "dad@example.com",
        targetLabel: "dad",
        targetPhoneNumber: null,
        targetTelegramUsername: null,
      },
    });

    expect(() =>
      parseHostedRuntimeFamilyPlanToolRequest({
        action: "start_checkout",
        invite: {
          targetLabel: "dad",
        },
      })
    ).toThrow(/phone number, Telegram username, or email/u);

    expect(() =>
      parseHostedRuntimeFamilyPlanToolRequest({
        action: "create_invite",
        invite: {
          targetLabel: "dad",
        },
      })
    ).toThrow(/phone number, Telegram username, or email/u);
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
