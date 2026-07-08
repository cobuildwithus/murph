import { describe, expect, it } from "vitest";

import {
  parseHostedExecutionExternalThreadRouteAuthority,
  parseHostedExecutionEvent,
  parseHostedExecutionWake,
  parseHostedRuntimeFamilyPlanToolRequest,
  parseHostedRuntimeFamilyPlanToolResponse,
  parseHostedRuntimeGroupToolRequest,
  parseHostedRuntimeGroupToolResponse,
  parseHostedRuntimeNewsletterToolRequest,
  parseHostedRuntimeNewsletterToolResponse,
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

  it("parses legacy external thread route authorities that still carry account lookup keys", () => {
    expect(parseHostedExecutionExternalThreadRouteAuthority({
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq",
      containerMemberId: "member_container_123",
      threadId: "chat_123",
    })).toEqual({
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq",
      containerMemberId: "member_container_123",
      threadId: "chat_123",
    });

    expect(parseHostedExecutionExternalThreadRouteAuthority({
      channel: "linq",
      containerMemberId: "member_container_123",
      threadId: "chat_123",
    })).toEqual({
      channel: "linq",
      containerMemberId: "member_container_123",
      threadId: "chat_123",
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

  it("parses group newsletter email-needed events and wakes", () => {
    expect(parseHostedExecutionEvent({
      directRoute: { channel: "linq", threadId: "linq_home_thread_123" },
      groupDisplayName: "Tempo Crew",
      groupId: "hgrp_123",
      kind: "group-newsletter.email-needed",
      userId: "member_123",
    })).toEqual({
      directRoute: { channel: "linq", threadId: "linq_home_thread_123" },
      groupDisplayName: "Tempo Crew",
      groupId: "hgrp_123",
      kind: "group-newsletter.email-needed",
      userId: "member_123",
    });

    expect(parseHostedExecutionWake({
      directRoute: { channel: "telegram", threadId: "telegram_thread_123" },
      eventId: "group-newsletter.email-needed:member_123:hgrp_123",
      groupDisplayName: "Tempo Crew",
      groupId: "hgrp_123",
      kind: "group-newsletter.email-needed",
      occurredAt: "2026-04-26T00:00:00.000Z",
      userId: "member_123",
    })).toEqual({
      directRoute: { channel: "telegram", threadId: "telegram_thread_123" },
      eventId: "group-newsletter.email-needed:member_123:hgrp_123",
      groupDisplayName: "Tempo Crew",
      groupId: "hgrp_123",
      kind: "group-newsletter.email-needed",
      occurredAt: "2026-04-26T00:00:00.000Z",
      userId: "member_123",
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
    requestedVaultShareProjectionScopes: [{ projectionKind: "sleep-times.v0" }],
    status: "active",
  };
  const PARSED_GROUP_SUMMARY = {
    ...GROUP_SUMMARY,
    members: [],
  };

  it("parses read, join-link, and join-offer requests and rejects other mutations", () => {
    expect(parseHostedRuntimeGroupToolRequest({
      action: "read_current",
    })).toEqual({
      action: "read_current",
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "update_display_name",
      updateDisplayName: {
        displayName: "  Weekly   Health Crew  ",
      },
    })).toEqual({
      action: "update_display_name",
      updateDisplayName: {
        displayName: "Weekly Health Crew",
      },
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
        requestedVaultShareProjectionScopes: [
          { projectionKind: "sleep-times.v0" },
          {
            projectionKind: "activity-minutes-days.v1",
            selector: { activityKind: "running" },
          },
        ],
      },
    })).toEqual({
      action: "create_join_link",
      joinLink: {
        displayName: "Sunday sleep crew",
        kind: "friends",
        requestedVaultShareProjectionKinds: null,
        requestedVaultShareProjectionScopes: [
          { projectionKind: "sleep-times.v0" },
          {
            projectionKind: "activity-minutes-days.v1",
            selector: { activityKind: "running" },
          },
        ],
      },
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "post_join_offer",
      joinOffer: {
        displayName: "Sunday Sleep Crew",
        messageTemplate:
          "  React here to join. Shares {{share_scope}}. Page: {{join_url}}.  ",
        projectionScopes: [{ projectionKind: "group-email.v0" }],
      },
    })).toEqual({
      action: "post_join_offer",
      joinOffer: {
        displayName: "Sunday Sleep Crew",
        messageTemplate: "React here to join. Shares {{share_scope}}. Page: {{join_url}}.",
        projectionKinds: null,
        projectionScopes: [{ projectionKind: "group-email.v0" }],
      },
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "post_join_offer",
      joinOffer: {
        messageTemplate: "React here. Shares {{share_scope}}. Customize: {{join_url}}.",
      },
    })).toEqual({
      action: "post_join_offer",
      joinOffer: {
        displayName: null,
        messageTemplate: "React here. Shares {{share_scope}}. Customize: {{join_url}}.",
        projectionKinds: null,
        projectionScopes: null,
      },
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "set_chat_avatar",
      groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
    })).toEqual({
      action: "set_chat_avatar",
      groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "preflight_set_chat_avatar",
    })).toEqual({
      action: "preflight_set_chat_avatar",
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "revoke_own_email_share",
      selfOptOut: {
        senderHandle: "person@example.test",
        source: "email",
      },
    })).toEqual({
      action: "revoke_own_email_share",
      selfOptOut: {
        senderHandle: "person@example.test",
        source: "email",
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
        action: "update_display_name",
        updateDisplayName: { displayName: "   " },
      })
    ).toThrow(/must not be blank/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "update_display_name",
        updateDisplayName: { displayName: "x".repeat(121) },
      })
    ).toThrow(/too long/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "update_display_name",
        displayName: "model-supplied shorthand",
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
        joinLink: { requestedVaultShareProjectionScopes: [{ projectionKind: "all-health-data" }] },
      })
    ).toThrow(/unsupported projection scope/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionScopes: [{ projectionKind: "activity-minutes-days.v1" }] },
      })
    ).toThrow(/unsupported projection scope/u);
    // Membership-implied, never requestable: the join-link request contract is closed
    // over the individually selectable scopes.
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionScopes: [{ projectionKind: "profile-name.v0" }] },
      })
    ).toThrow(/unsupported projection scope/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "create_join_link",
        joinLink: { displayName: "   " },
      })
    ).toThrow(/must not be blank/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "post_join_offer",
        joinOffer: { intro: "Like this to join us." },
      })
    ).toThrow(/not allowed/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "post_join_offer",
        joinOffer: {
          displayName: "   ",
          messageTemplate: "React here. Shares {{share_scope}}. Customize: {{join_url}}.",
        },
      })
    ).toThrow(/displayName must not be blank/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "post_join_offer",
        joinOffer: {
          displayName: "a".repeat(121),
          messageTemplate: "React here. Shares {{share_scope}}. Customize: {{join_url}}.",
        },
      })
    ).toThrow(/displayName is too long/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "post_join_offer",
        joinOffer: { messageTemplate: "   " },
      })
    ).toThrow(/messageTemplate must be between/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "post_join_offer",
        joinOffer: { projectionScopes: [{ projectionKind: "profile-name.v0" }] },
      })
    ).toThrow(/unsupported projection scope/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "set_chat_avatar",
        groupChatIconUrl: "http://example.com/avatar.png",
      })
    ).toThrow(/must be HTTPS/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "set_chat_avatar",
        groupChatIconUrl: "https://user:pass@example.com/avatar.png",
      })
    ).toThrow(/must be HTTPS/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "set_chat_avatar",
        groupChatIconUrl: "https://example.com/avatar.png",
      })
    ).toThrow(/groupChatIconUrl is invalid/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "set_chat_avatar",
        groupChatIconUrl: "https://imagedelivery.net/account/avatar",
      })
    ).toThrow(/groupChatIconUrl is invalid/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "set_chat_avatar",
        chatId: "chat_hijack",
        groupChatIconUrl: "https://example.com/avatar.png",
      })
    ).toThrow(/not allowed/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "revoke_own_email_share",
        selfOptOut: { senderHandle: "person@example.test", source: "sms" },
      })
    ).toThrow(/not supported/u);
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

  it("parses update_display_name responses", () => {
    expect(parseHostedRuntimeGroupToolResponse({
      action: "update_display_name",
      result: {
        group: {
          ...GROUP_SUMMARY,
          displayName: "Weekly Health Crew",
        },
        status: "ok",
      },
    })).toEqual({
      action: "update_display_name",
      result: {
        group: {
          ...PARSED_GROUP_SUMMARY,
          displayName: "Weekly Health Crew",
        },
        status: "ok",
      },
    });

    expect(parseHostedRuntimeGroupToolResponse({
      action: "update_display_name",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "group_not_found",
      },
    })).toEqual({
      action: "update_display_name",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "group_not_found",
      },
    });

    expect(() =>
      parseHostedRuntimeGroupToolResponse({
        action: "update_display_name",
        result: {
          group: GROUP_SUMMARY,
          status: "ok",
          updatedAt: "2026-07-07T00:00:00.000Z",
        },
      })
    ).toThrow(/not allowed/u);
  });

  it("parses set_chat_avatar responses", () => {
    expect(parseHostedRuntimeGroupToolResponse({
      action: "set_chat_avatar",
      result: {
        status: "requested",
      },
    })).toEqual({
      action: "set_chat_avatar",
      result: {
        status: "requested",
      },
    });

    expect(parseHostedRuntimeGroupToolResponse({
      action: "set_chat_avatar",
      result: {
        status: "ok",
      },
    })).toEqual({
      action: "set_chat_avatar",
      result: {
        status: "ok",
      },
    });

    expect(parseHostedRuntimeGroupToolResponse({
      action: "set_chat_avatar",
      result: {
        status: "unavailable",
        unavailableReason: "provider_unavailable",
      },
    })).toEqual({
      action: "set_chat_avatar",
      result: {
        status: "unavailable",
        unavailableReason: "provider_unavailable",
      },
    });

    expect(() =>
      parseHostedRuntimeGroupToolResponse({
        action: "set_chat_avatar",
        result: {
          status: "ok",
          url: "https://example.com/avatar.png",
        },
      })
    ).toThrow(/not allowed/u);
  });

  it("parses preflight_set_chat_avatar responses", () => {
    expect(parseHostedRuntimeGroupToolResponse({
      action: "preflight_set_chat_avatar",
      result: {
        status: "ok",
      },
    })).toEqual({
      action: "preflight_set_chat_avatar",
      result: {
        status: "ok",
      },
    });

    expect(parseHostedRuntimeGroupToolResponse({
      action: "preflight_set_chat_avatar",
      result: {
        status: "unavailable",
        unavailableReason: "linq_thread_unavailable",
      },
    })).toEqual({
      action: "preflight_set_chat_avatar",
      result: {
        status: "unavailable",
        unavailableReason: "linq_thread_unavailable",
      },
    });
  });

  it("parses post_join_offer responses", () => {
    expect(parseHostedRuntimeGroupToolResponse({
      action: "post_join_offer",
      result: {
        group: GROUP_SUMMARY,
        joinUrl: "https://example.com/groups/join/abc123",
        status: "sent",
      },
    })).toEqual({
      action: "post_join_offer",
      result: {
        group: PARSED_GROUP_SUMMARY,
        joinUrl: "https://example.com/groups/join/abc123",
        status: "sent",
      },
    });

    expect(parseHostedRuntimeGroupToolResponse({
      action: "post_join_offer",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "send_failed",
      },
    })).toEqual({
      action: "post_join_offer",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "send_failed",
      },
    });
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
              grantedVaultShareProjectionScopes: [
                { projectionKind: "profile-name.v0" },
                { projectionKind: "sleep-times.v0" },
              ],
              handle: "+15551110000",
              memberId: "member_owner_123",
              role: "owner",
            },
            {
              grantedVaultShareProjectionKinds: [],
              grantedVaultShareProjectionScopes: [],
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
              grantedVaultShareProjectionScopes: [
                { projectionKind: "profile-name.v0" },
                { projectionKind: "sleep-times.v0" },
              ],
              handle: "+15551110000",
              memberId: "member_owner_123",
              role: "owner",
            },
            {
              grantedVaultShareProjectionKinds: [],
              grantedVaultShareProjectionScopes: [],
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
      action: "update_display_name",
      linqThread: LINQ_THREAD,
      updateDisplayName: {
        displayName: "  Weekly   Health Crew  ",
      },
    })).toEqual({
      action: "update_display_name",
      linqThread: LINQ_THREAD,
      updateDisplayName: {
        displayName: "Weekly Health Crew",
      },
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "share_contact_card",
      linqThread: LINQ_THREAD,
    })).toEqual({
      action: "share_contact_card",
      linqThread: LINQ_THREAD,
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "read_chat_participants",
      linqThread: {
        ...LINQ_THREAD,
        authority: {
          accountLookupKey: "hplk_account",
          ...LINQ_THREAD.authority,
        },
      },
    })).toEqual({
      action: "read_chat_participants",
      linqThread: {
        ...LINQ_THREAD,
        authority: {
          accountLookupKey: "hplk_account",
          ...LINQ_THREAD.authority,
        },
      },
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
        action: "update_display_name",
        chatId: "chat_group_1",
        updateDisplayName: { displayName: "Weekly Health Crew" },
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

  it("parses revoke_own_email_share responses", () => {
    expect(parseHostedRuntimeGroupToolResponse({
      action: "revoke_own_email_share",
      result: { revokedCount: 1, status: "revoked" },
    })).toEqual({
      action: "revoke_own_email_share",
      result: { revokedCount: 1, status: "revoked" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "revoke_own_email_share",
      result: { revokedCount: 0, status: "already_removed" },
    })).toEqual({
      action: "revoke_own_email_share",
      result: { revokedCount: 0, status: "already_removed" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "revoke_own_email_share",
      result: { status: "unavailable", unavailableReason: "sender_unavailable" },
    })).toEqual({
      action: "revoke_own_email_share",
      result: { status: "unavailable", unavailableReason: "sender_unavailable" },
    });
    expect(() =>
      parseHostedRuntimeGroupToolResponse({
        action: "revoke_own_email_share",
        result: { revokedCount: 2, status: "revoked" },
      })
    ).toThrow(/must be 1/u);
  });
});

describe("parseHostedRuntimeNewsletterTool", () => {
  const PARTICIPANT = {
    displayName: "Alex",
    hasEmail: true,
    memberId: "member_123",
  };

  it("parses read_stats and scheduled send requests", () => {
    expect(parseHostedRuntimeNewsletterToolRequest({
      action: "read_stats",
      groupId: "group_123",
    })).toEqual({
      action: "read_stats",
      groupId: "group_123",
    });

    expect(parseHostedRuntimeNewsletterToolRequest({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly health note</p>",
      subject: "Weekly health note",
      text: "Weekly health note",
    })).toEqual({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly health note</p>",
      subject: "Weekly health note",
      text: "Weekly health note",
    });

    expect(parseHostedRuntimeNewsletterToolRequest({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly health note</p>",
      subject: "Weekly health note",
    })).toEqual({
      action: "send",
      groupId: "group_123",
      html: "<p>Weekly health note</p>",
      subject: "Weekly health note",
      text: null,
    });

    expect(() =>
      parseHostedRuntimeNewsletterToolRequest({
        action: "send",
        groupId: "group_123",
        html: "<p>Weekly health note</p>",
        scheduledAutomationAuthority: {
          automationId: "automation_123",
          occurrenceAt: "2026-07-12T13:00:00.000Z",
        },
        subject: "Weekly health note",
      })
    ).toThrow(/not allowed/u);
    expect(() =>
      parseHostedRuntimeNewsletterToolRequest({
        action: "send",
        groupId: "group_123",
        html: " ",
        subject: "Weekly health note",
      })
    ).toThrow(/html must not be blank/u);
    expect(() =>
      parseHostedRuntimeNewsletterToolRequest({
        action: "send",
        groupId: "group_123",
        html: "<p>Weekly health note</p>",
        subject: " ",
      })
    ).toThrow(/subject must not be blank/u);
  });

  it("parses read_stats responses without exposing email addresses", () => {
    expect(parseHostedRuntimeNewsletterToolResponse({
      action: "read_stats",
      result: {
        groupId: "group_123",
        missingEmailParticipants: [{ ...PARTICIPANT, hasEmail: false }],
        participants: [PARTICIPANT],
        status: "ok",
      },
    })).toEqual({
      action: "read_stats",
      result: {
        groupId: "group_123",
        missingEmailParticipants: [{ ...PARTICIPANT, hasEmail: false }],
        participants: [PARTICIPANT],
        status: "ok",
      },
    });

    expect(parseHostedRuntimeNewsletterToolResponse({
      action: "read_stats",
      result: {
        status: "unavailable",
        unavailableReason: "not_group_runtime",
      },
    })).toEqual({
      action: "read_stats",
      result: {
        status: "unavailable",
        unavailableReason: "not_group_runtime",
      },
    });

    expect(() =>
      parseHostedRuntimeNewsletterToolResponse({
        action: "read_stats",
        result: {
          groupId: "group_123",
          missingEmailParticipants: [],
          participants: [{ ...PARTICIPANT, email: "alex@example.test" }],
          status: "ok",
        },
      })
    ).toThrow(/not allowed/u);
  });

  it("parses newsletter send outcomes and validates partial counts", () => {
    expect(parseHostedRuntimeNewsletterToolResponse({
      action: "send",
      result: {
        participantCount: 2,
        skippedNoEmailMemberIds: ["member_without_email"],
        status: "sent",
      },
    })).toEqual({
      action: "send",
      result: {
        participantCount: 2,
        skippedNoEmailMemberIds: ["member_without_email"],
        status: "sent",
      },
    });

    expect(parseHostedRuntimeNewsletterToolResponse({
      action: "send",
      result: {
        failedRecipientCount: 1,
        participantCount: 3,
        sentRecipientCount: 1,
        skippedNoEmailMemberIds: ["member_without_email"],
        status: "partial_failure",
      },
    })).toEqual({
      action: "send",
      result: {
        failedRecipientCount: 1,
        participantCount: 3,
        sentRecipientCount: 1,
        skippedNoEmailMemberIds: ["member_without_email"],
        status: "partial_failure",
      },
    });

    expect(parseHostedRuntimeNewsletterToolResponse({
      action: "send",
      result: {
        participantCount: 0,
        skippedNoEmailMemberIds: ["member_without_email"],
        status: "no_recipients",
      },
    })).toEqual({
      action: "send",
      result: {
        participantCount: 0,
        skippedNoEmailMemberIds: ["member_without_email"],
        status: "no_recipients",
      },
    });

    expect(parseHostedRuntimeNewsletterToolResponse({
      action: "send",
      result: {
        status: "unavailable",
        unavailableReason: "scheduled_authority_required",
      },
    })).toEqual({
      action: "send",
      result: {
        status: "unavailable",
        unavailableReason: "scheduled_authority_required",
      },
    });

    expect(() =>
      parseHostedRuntimeNewsletterToolResponse({
        action: "send",
        result: {
          participantCount: 1,
          skippedNoEmailMemberIds: [],
          status: "no_recipients",
        },
      })
    ).toThrow(/participantCount must be 0/u);
    expect(() =>
      parseHostedRuntimeNewsletterToolResponse({
        action: "send",
        result: {
          failedRecipientCount: -1,
          participantCount: 1,
          sentRecipientCount: 1,
          skippedNoEmailMemberIds: [],
          status: "partial_failure",
        },
      })
    ).toThrow(/failedRecipientCount must be a non-negative integer/u);
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
