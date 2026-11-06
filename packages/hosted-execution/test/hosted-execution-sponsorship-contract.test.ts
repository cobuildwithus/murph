import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "../src/builders.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";
import {
  parseHostedMailboxFetchResponse,
} from "../src/parsers/runtime-control.ts";

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

describe("hosted group sponsorship contracts", () => {
  it("keeps exactly the retired creative profiles readable and rejects unknown profiles", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:group-sponsorship:test",
      memberId: "member-group-runtime",
      notification: {
        deliveryDedupeToken: "group-sponsorship:test",
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: "group-sponsorship:test",
        instructions: "Create a brief thank-you.",
        notificationPromptProfile: "creative-response",
        responsePolicy: { kind: "require_send" },
        route: ROUTE,
      },
      occurredAt: "2026-07-27T12:00:00.000Z",
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
    expect(parseHostedExecutionWake({
      ...wake,
      notification: {
        ...wake.notification,
        notificationPromptProfile: "creative-response-text",
      },
    })).toEqual({
      ...wake,
      notification: {
        ...wake.notification,
        notificationPromptProfile: "creative-response-text",
      },
    });
    expect(() => parseHostedExecutionWake({
      ...wake,
      notification: {
        ...wake.notification,
        notificationPromptProfile: "all-tools",
      },
    })).toThrow(/notificationPromptProfile/u);
  });

  it.each([
    null,
    { schema: "murph.group-sponsorship-bit.v1", expiresAt: "2026-07-28T12:00:00.000Z", publicAlias: "Synthetic contributor", requestedBit: "Use a nautical greeting." },
    { expiresAt: "invalid", permission: "admin" },
    "obsolete payload",
  ])("ignores a running bit from an older Web: %j", (groupRunningBit) => {
    const response = {
      fetchedAt: "2026-07-27T12:00:00.000Z",
      items: [],
      maxSeqByLane: [],
      userId: "member-group-runtime",
    };
    expect(parseHostedMailboxFetchResponse({ ...response, groupRunningBit })).toEqual(response);
  });
});
