import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  bindHostedOperatorMessageDestination,
} from "../src/lib/hosted-ops/operator-task.ts";

describe("hosted operator message destination", () => {
  it("rejects first-contact participant delivery", () => {
    let thrown: unknown = null;
    try {
      bindHostedOperatorMessageDestination({
        destination: {
          conversationShape: "direct-member",
          externalThreadRouteAuthority: null,
          route: {
            actorId: "direct-actor",
            channel: "linq",
            delivery: {
              kind: "participant",
              source: {
                fromPhoneNumber: "+15555550999",
                kind: "linq",
              },
              target: "+15555550100",
            },
            identityId: "direct-identity",
            threadId: null,
            threadIsDirect: true,
          },
        },
        memberId: "direct-member",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "HOSTED_OPERATOR_TASK_DIRECT_ROUTE_REQUIRED",
      httpStatus: 409,
    });
  });

  it.each([
    {
      channel: "linq" as const,
      expectedDeliveryKind: "explicit" as const,
      threadId: "linq-direct-thread",
    },
    {
      channel: "telegram" as const,
      expectedDeliveryKind: "thread" as const,
      threadId: "telegram-direct-thread",
    },
  ])("binds an existing direct $channel thread with runtime authority", (fixture) => {
    const bound = bindHostedOperatorMessageDestination({
      destination: {
        conversationShape: "direct-member",
        externalThreadRouteAuthority: null,
        route: {
          actorId: null,
          channel: fixture.channel,
          delivery: { kind: "thread", target: fixture.threadId },
          identityId: "direct-identity",
          threadId: "direct-thread",
          threadIsDirect: true,
        },
      },
      memberId: "direct-member",
    });

    expect(bound).toMatchObject({
      externalThreadRouteAuthority: {
        channel: fixture.channel,
        containerMemberId: "direct-member",
        threadId: fixture.threadId,
      },
      route: {
        channel: fixture.channel,
        delivery: {
          kind: fixture.expectedDeliveryKind,
          target: fixture.threadId,
        },
        threadIsDirect: true,
      },
    });
  });
});
