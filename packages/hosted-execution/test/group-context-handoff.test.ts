import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "../src/builders.ts";
import {
  HOSTED_EXECUTION_ASSISTANT_NOTIFICATION_PROMPT_PROFILES,
} from "../src/contracts.ts";
import {
  parseHostedExecutionWake,
  parseHostedRuntimeGroupToolRequest,
  parseHostedRuntimeGroupToolResponse,
} from "../src/parsers.ts";
import {
  HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_EVENT_ID_PREFIX,
  HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_MAX_CODE_POINTS,
} from "../src/runtime-control.ts";

const ORIGIN_ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;
const EVENT_ID =
  `${HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_EVENT_ID_PREFIX}${"b".repeat(64)}`;
const ROUTE = {
  actorId: null,
  channel: "linq" as const,
  delivery: {
    kind: "thread" as const,
    target: "linq-group-chat",
  },
  identityId: "group-identity",
  threadId: "group-thread",
  threadIsDirect: false,
};

function createHandoffWake() {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: EVENT_ID,
    memberId: "member-group-runtime",
    notification: {
      deliveryDedupeToken: EVENT_ID,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: EVENT_ID,
      externalThreadRouteAuthority: {
        accountLookupKey: "linq-account-key",
        channel: "linq",
        containerMemberId: "member-group-runtime",
        threadId: "linq-group-chat",
      },
      groupContextHandoff: {
        membershipId: "membership-generation-one",
        originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      },
      instructions: "Use the bounded handoff context.",
      notificationPromptProfile: "context-handoff",
      responsePolicy: { kind: "require_send" },
      route: ROUTE,
    },
    occurredAt: "2026-08-21T03:00:00.000Z",
  });
}

describe("private-to-group context handoff contracts", () => {
  it("round-trips and copies the closed notification proof", () => {
    const notification = {
      deliveryDedupeToken: EVENT_ID,
      deliveryDispatchMode: "queue-only" as const,
      deliveryIdempotencyKey: EVENT_ID,
      externalThreadRouteAuthority: {
        accountLookupKey: "linq-account-key",
        channel: "linq" as const,
        containerMemberId: "member-group-runtime",
        threadId: "linq-group-chat",
      },
      groupContextHandoff: {
        membershipId: "membership-generation-one",
        originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      },
      instructions: "Use the bounded handoff context.",
      notificationPromptProfile: "context-handoff" as const,
      responsePolicy: { kind: "require_send" as const },
      route: ROUTE,
    };
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: EVENT_ID,
      memberId: "member-group-runtime",
      notification,
      occurredAt: "2026-08-21T03:00:00.000Z",
    });

    notification.groupContextHandoff.membershipId = "mutated";

    expect(wake.notification.groupContextHandoff).toEqual({
      membershipId: "membership-generation-one",
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    });
    expect(parseHostedExecutionWake(wake)).toEqual(wake);
    expect(HOSTED_EXECUTION_ASSISTANT_NOTIFICATION_PROMPT_PROFILES)
      .toContain("context-handoff");
  });

  it("parses the strict bounded model-hidden request and selection response", () => {
    expect(parseHostedRuntimeGroupToolRequest({
      action: "handoff",
      context: "  Sunny logged a 405 lb deadlift personal record today.  ",
      groupLabel: "  Lifting Club  ",
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    })).toEqual({
      action: "handoff",
      context: "Sunny logged a 405 lb deadlift personal record today.",
      groupLabel: "Lifting Club",
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "handoff",
      result: { status: "accepted", targetLabel: "Lifting Club" },
    })).toEqual({
      action: "handoff",
      result: { status: "accepted", targetLabel: "Lifting Club" },
    });
  });

  it("rejects widened requests and malformed durable proof", () => {
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "handoff",
      groupLabel: "Lifting Club",
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    })).toThrow();
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "handoff",
      context: "x".repeat(
        HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_MAX_CODE_POINTS + 1,
      ),
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    })).toThrow();
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "handoff",
      context: "A bounded fact.",
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      route: "model-controlled",
    })).toThrow();

    const wake = createHandoffWake();
    expect(() => parseHostedExecutionWake({
      ...wake,
      notification: {
        ...wake.notification,
        groupContextHandoff: {
          ...wake.notification.groupContextHandoff,
          role: "admin",
        },
      },
    })).toThrow(/groupContextHandoff/u);
    expect(() => parseHostedExecutionWake({
      ...wake,
      notification: {
        ...wake.notification,
        groupContextHandoff: {
          membershipId: " membership-generation-one ",
          originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
        },
      },
    })).toThrow(/membershipId/u);
  });
});
