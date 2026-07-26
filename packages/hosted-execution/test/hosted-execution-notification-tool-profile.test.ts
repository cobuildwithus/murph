import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "../src/builders.ts";
import {
  parseHostedExecutionWake,
} from "../src/parsers.ts";

const ROUTE = {
  actorId: null,
  channel: "telegram" as const,
  delivery: {
    kind: "thread" as const,
    target: "telegram-group-123",
  },
  identityId: "identity-group-123",
  threadId: "thread-group-123",
  threadIsDirect: false,
};

function makeWake() {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: "assistant.notification.requested:group-usage-funded:test",
    memberId: "member-group-runtime",
    notification: {
      deliveryDedupeToken: "group-usage-funded:test",
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: "group-usage-funded:test",
      instructions: "Thank the contributor.",
      notificationToolProfile: "response-audio",
      responsePolicy: { kind: "require_send" },
      route: ROUTE,
    },
    occurredAt: "2026-07-25T22:00:00.000Z",
  });
}

describe("hosted assistant notification tool profile", () => {
  it("round-trips the narrow response-audio profile", () => {
    expect(parseHostedExecutionWake(makeWake())).toEqual(makeWake());
  });

  it("rejects unknown notification tool profiles", () => {
    expect(() => parseHostedExecutionWake({
      ...makeWake(),
      notification: {
        ...makeWake().notification,
        notificationToolProfile: "all-tools",
      },
    })).toThrow(/notificationToolProfile/u);
  });
});
