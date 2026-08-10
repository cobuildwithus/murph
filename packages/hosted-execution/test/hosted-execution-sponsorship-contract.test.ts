import { readFileSync } from "node:fs";
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
  it("round-trips only the narrow creative notification prompt profile", () => {
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

  it("strictly parses the optional expiring group-bit sidecar", () => {
    const response = {
      fetchedAt: "2026-07-27T12:00:00.000Z",
      groupRunningBit: {
        expiresAt: "2026-07-28T12:00:00.000Z",
        publicAlias: "Jake’s Lower Back",
        requestedBit: "Treat me like the exhausted CFO.",
        schema: "murph.group-sponsorship-bit.v1",
      },
      items: [],
      maxSeqByLane: [],
      userId: "member-group-runtime",
    };
    expect(parseHostedMailboxFetchResponse(response)).toEqual(response);
    expect(() => parseHostedMailboxFetchResponse({
      ...response,
      groupRunningBit: {
        ...response.groupRunningBit,
        permission: "admin",
      },
    })).toThrow(/unknown fields/u);
    expect(() => parseHostedMailboxFetchResponse({
      ...response,
      groupRunningBit: {
        ...response.groupRunningBit,
        expiresAt: "tomorrow",
      },
    })).toThrow(/canonical/u);
  });
  it("documents the strict usage contract and old-Web sponsorship rollback floor", () => {
    const deployGuide = readFileSync(
      new URL("../../../apps/cloudflare/DEPLOY.md", import.meta.url),
      "utf8",
    );
    const section = deployGuide.match(
      /## Group Usage Projection Privacy and Monthly Sponsorship Rollout[\s\S]*?(?=\n## )/u,
    )?.[0];
    const normalizedSection = section?.replace(/\s+/gu, " ");

    expect(section).toBeDefined();
    expect(normalizedSection).toContain(
      "There is no strip-only reader phase or rollout-only feature flag",
    );
    expect(normalizedSection).toContain(
      "A mixed-version Web/runner window may temporarily make the strict read fail",
    );
    expect(normalizedSection).toContain(
      "Confirm both the migration and new Web have converged before enabling monthly authorization creation or automatic refill admission",
    );
    expect(normalizedSection).toContain(
      "The first monthly authorization is the old-Web rollback floor",
    );
    expect(normalizedSection).toContain("Recover with a forward fix");
    expect(normalizedSection).toContain("not a permanent rollout framework");
  });

});
