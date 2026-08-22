import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedOnboardingReadClient } from "../src/lib/hosted-onboarding/shared";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
} from "../src/lib/hosted-onboarding/contact-privacy";
import {
  assertHostedAssistantNotificationRouteAuthority,
  assertHostedDirectAssistantNotificationRouteAuthority,
  bindHostedAssistantNotificationDestination,
  isHostedThreadContainerNotificationDestination,
  requireHostedAssistantNotificationDestination,
  resolveHostedAssistantNotificationDestination,
} from "../src/lib/hosted-routing/assistant-notification-destination";
import {
  buildHostedThreadDeliveryRoute,
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
  sealHostedThreadDeliveryRoute,
} from "../src/lib/hosted-routing/thread-delivery-route";

const destinationMocks = vi.hoisted(() => ({
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  readHostedMemberAssistantNotificationState: vi.fn(),
}));

vi.mock("../src/lib/hosted-routing/thread-route-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/hosted-routing/thread-route-store")
  >();
  return {
    ...actual,
    assertHostedThreadRouteEgressAuthority:
      destinationMocks.assertHostedThreadRouteEgressAuthority,
  };
});

vi.mock("../src/lib/hosted-onboarding/hosted-member-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/hosted-onboarding/hosted-member-store")
  >();
  return {
    ...actual,
    readHostedMemberAssistantNotificationState:
      destinationMocks.readHostedMemberAssistantNotificationState,
  };
});

describe("hosted assistant notification destination", () => {
  beforeEach(() => {
    destinationMocks.assertHostedThreadRouteEgressAuthority.mockReset();
    destinationMocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue({});
    destinationMocks.readHostedMemberAssistantNotificationState.mockReset();
  });

  it.each([
    {
      accountLookupKey: "linq-account-lookup",
      channel: "linq" as const,
      expectedIdentitySource: "linq-account-lookup",
      expectedSecret: "linq-account-lookup",
      threadId: "linq-group-chat",
    },
    {
      accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
      channel: "telegram" as const,
      expectedIdentitySource: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
      expectedSecret: "-100987654321",
      threadId: "-100987654321",
    },
  ])("reconstructs the exact non-direct $channel conversation identity", async (fixture) => {
    const containerMemberId = `container-${fixture.channel}`;
    const row = await buildRouteRow({
      accountLookupKey: fixture.accountLookupKey,
      channel: fixture.channel,
      containerMemberId,
      threadId: fixture.threadId,
    });
    const prisma = createPrisma({
      containerMemberId,
      rows: [row],
    });

    const destination = await resolveHostedAssistantNotificationDestination({
      memberId: containerMemberId,
      prisma,
    });
    const blind = createHostedAssistantConversationIdentifierBlind({
      secret: fixture.expectedSecret,
      userId: containerMemberId,
    });

    expect(destination).toEqual({
      conversationShape: "thread-container",
      externalThreadRouteAuthority: {
        ...(fixture.channel === "linq"
          ? { accountLookupKey: fixture.accountLookupKey }
          : {}),
        channel: fixture.channel,
        containerMemberId,
        threadId: fixture.threadId,
      },
      route: {
        actorId: null,
        channel: fixture.channel,
        delivery: {
          kind: "thread",
          target: fixture.threadId,
        },
        identityId: hashHostedAssistantConversationIdentifier(
          blind,
          fixture.expectedIdentitySource,
        ),
        threadId: hashHostedAssistantConversationIdentifier(
          blind,
          fixture.threadId,
        ),
        threadIsDirect: false,
      },
    });
    expect(destination && isHostedThreadContainerNotificationDestination(destination)).toBe(true);
    expect(destinationMocks.readHostedMemberAssistantNotificationState).not.toHaveBeenCalled();
    expect(destinationMocks.assertHostedThreadRouteEgressAuthority).toHaveBeenCalledWith({
      authority: destination?.externalThreadRouteAuthority,
      prisma,
    });
  });

  it.each([
    {
      member: {
        identity: {
          phoneLookupKey: "member-phone-lookup",
          phoneNumber: "+15555550100",
        },
        routing: {
          linqChatId: "direct-linq-chat",
          linqRecipientPhone: "+15555550999",
          pendingLinqChatId: null,
          pendingLinqParticipantContact: null,
          pendingLinqRecipientPhone: null,
          telegramThreadId: null,
          telegramUserId: null,
        },
      },
      expectedChannel: "linq",
    },
    {
      member: {
        identity: null,
        routing: {
          linqChatId: null,
          linqRecipientPhone: null,
          pendingLinqChatId: null,
          pendingLinqParticipantContact: null,
          pendingLinqRecipientPhone: null,
          telegramThreadId: "telegram-direct-chat",
          telegramUserId: "telegram-user",
        },
      },
      expectedChannel: "telegram",
    },
  ])("preserves existing direct $expectedChannel route derivation", async (fixture) => {
    destinationMocks.readHostedMemberAssistantNotificationState.mockResolvedValue(
      fixture.member,
    );
    const prisma = createPrisma({
      containerMemberId: null,
      rows: [],
    });

    const destination = await resolveHostedAssistantNotificationDestination({
      memberId: "direct-member",
      prisma,
    });

    expect(destination?.conversationShape).toBe("direct-member");
    expect(destination?.externalThreadRouteAuthority).toBeNull();
    expect(destination?.route.channel).toBe(fixture.expectedChannel);
    expect(destination?.route.threadIsDirect).toBe(true);
    expect(destination && isHostedThreadContainerNotificationDestination(destination)).toBe(false);
    expect(destinationMocks.assertHostedThreadRouteEgressAuthority).not.toHaveBeenCalled();
  });

  it("resolves an explicitly frozen direct channel instead of the preferred one", async () => {
    destinationMocks.readHostedMemberAssistantNotificationState.mockResolvedValue({
      identity: {
        phoneLookupKey: "member-phone-lookup",
        phoneNumber: "+15555550100",
      },
      routing: {
        linqChatId: "direct-linq-chat",
        linqRecipientPhone: "+15555550999",
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: "telegram-direct-chat",
        telegramUserId: "telegram-user",
      },
    });
    const prisma = createPrisma({
      containerMemberId: null,
      rows: [],
    });

    const preferred = await resolveHostedAssistantNotificationDestination({
      memberId: "direct-member",
      prisma,
    });
    const frozen = await requireHostedAssistantNotificationDestination({
      directChannel: "telegram",
      memberId: "direct-member",
      prisma,
    });

    expect(preferred?.route.channel).toBe("linq");
    expect(frozen?.route).toMatchObject({
      channel: "telegram",
      delivery: { kind: "thread", target: "telegram-direct-chat" },
      threadIsDirect: true,
    });
  });

  it("rejects a thread-container route when an exact direct channel is required", async () => {
    const row = await buildRouteRow({
      accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
      channel: "telegram",
      containerMemberId: "container-member",
      threadId: "-100987654321",
    });
    const prisma = createPrisma({
      containerMemberId: "container-member",
      rows: [row],
    });

    await expect(requireHostedAssistantNotificationDestination({
      directChannel: "telegram",
      memberId: "container-member",
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_NOTIFICATION_ROUTE_REQUIRED",
      retryable: true,
    });
  });

  it.each([
    {
      channel: "linq" as const,
      expectedDeliveryKind: "explicit" as const,
      target: "linq-direct-chat",
    },
    {
      channel: "telegram" as const,
      expectedDeliveryKind: "thread" as const,
      target: "telegram-direct-chat",
    },
  ])("binds a direct $channel destination to one validated target", (fixture) => {
    const bound = bindHostedAssistantNotificationDestination({
      destination: {
        conversationShape: "direct-member",
        externalThreadRouteAuthority: null,
        route: {
          actorId: null,
          channel: fixture.channel,
          delivery: {
            kind: "thread",
            target: fixture.target,
          },
          identityId: "direct-identity",
          threadId: "direct-thread",
          threadIsDirect: true,
        },
      },
      memberId: "direct-member",
    });

    expect(bound).toEqual({
      externalThreadRouteAuthority: {
        channel: fixture.channel,
        containerMemberId: "direct-member",
        threadId: fixture.target,
      },
      route: {
        actorId: null,
        channel: fixture.channel,
        delivery: {
          kind: fixture.expectedDeliveryKind,
          target: fixture.target,
        },
        identityId: "direct-identity",
        threadId: "direct-thread",
        threadIsDirect: true,
      },
    });
  });

  it("leaves direct participant delivery on its existing binding", () => {
    const route = {
      actorId: "direct-actor",
      channel: "linq" as const,
      delivery: {
        kind: "participant" as const,
        source: {
          fromPhoneNumber: "+15555550999",
          kind: "linq" as const,
        },
        target: "+15555550100",
      },
      identityId: "direct-identity",
      threadId: null,
      threadIsDirect: true,
    };

    expect(bindHostedAssistantNotificationDestination({
      destination: {
        conversationShape: "direct-member",
        externalThreadRouteAuthority: null,
        route,
      },
      memberId: "direct-member",
    })).toEqual({
      externalThreadRouteAuthority: null,
      route,
    });
  });

  it("keeps group authority unchanged and rejects a mismatched owner", () => {
    const destination = {
      conversationShape: "thread-container" as const,
      externalThreadRouteAuthority: {
        accountLookupKey: "linq-account",
        channel: "linq" as const,
        containerMemberId: "group-member",
        threadId: "linq-group-chat",
      },
      route: {
        actorId: null,
        channel: "linq" as const,
        delivery: {
          kind: "thread" as const,
          target: "linq-group-chat",
        },
        identityId: "group-identity",
        threadId: "group-thread",
        threadIsDirect: false,
      },
    };

    expect(bindHostedAssistantNotificationDestination({
      destination,
      memberId: "group-member",
    })).toEqual({
      externalThreadRouteAuthority: destination.externalThreadRouteAuthority,
      route: destination.route,
    });
    expect(() => bindHostedAssistantNotificationDestination({
      destination,
      memberId: "different-member",
    })).toThrow("inconsistent");
  });

  it("does not classify a thread-container route as direct authority", async () => {
    const row = await buildRouteRow({
      accountLookupKey: "account",
      channel: "linq",
      containerMemberId: "container-member",
      threadId: "provider-group-thread",
    });
    const prisma = createPrisma({
      containerMemberId: "container-member",
      rows: [row],
    });

    await expect(assertHostedDirectAssistantNotificationRouteAuthority({
      authority: {
        channel: "linq",
        containerMemberId: "container-member",
        threadId: "provider-group-thread",
      },
      prisma,
      requireThreadDelivery: true,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    });
  });

  it("requires a current thread route for legacy direct-Linq repair", async () => {
    destinationMocks.readHostedMemberAssistantNotificationState.mockResolvedValue({
      identity: {
        phoneLookupKey: "member-phone-lookup",
        phoneNumber: "+15555550100",
      },
      routing: {
        linqChatId: null,
        linqRecipientPhone: "+15555550999",
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: null,
        telegramUserId: null,
      },
    });
    const prisma = createPrisma({
      containerMemberId: null,
      rows: [],
    });

    await expect(assertHostedDirectAssistantNotificationRouteAuthority({
      authority: {
        channel: "linq",
        containerMemberId: "direct-member",
        threadId: "+15555550100",
      },
      prisma,
      requireThreadDelivery: true,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    });
  });

  it("rechecks a direct Telegram route for provider-entry authority", async () => {
    destinationMocks.readHostedMemberAssistantNotificationState
      .mockResolvedValueOnce({
        identity: null,
        routing: {
          linqChatId: null,
          linqRecipientPhone: null,
          pendingLinqChatId: null,
          pendingLinqParticipantContact: null,
          pendingLinqRecipientPhone: null,
          telegramThreadId: "telegram-direct-chat",
          telegramUserId: "telegram-user",
        },
      })
      .mockResolvedValueOnce({
        identity: null,
        routing: {
          linqChatId: null,
          linqRecipientPhone: null,
          pendingLinqChatId: null,
          pendingLinqParticipantContact: null,
          pendingLinqRecipientPhone: null,
          telegramThreadId: null,
          telegramUserId: "telegram-user",
        },
      });
    const prisma = createPrisma({
      containerMemberId: null,
      rows: [],
    });
    const authority = {
      channel: "telegram" as const,
      containerMemberId: "direct-member",
      threadId: "telegram-direct-chat",
    };

    await expect(assertHostedAssistantNotificationRouteAuthority({
      authority,
      prisma,
    })).resolves.toBeUndefined();
    await expect(assertHostedAssistantNotificationRouteAuthority({
      authority,
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    });
  });

  it("fails closed on a missing route without falling back to member routing", async () => {
    const prisma = createPrisma({
      containerMemberId: "container-member",
      rows: [],
    });

    await expect(resolveHostedAssistantNotificationDestination({
      memberId: "container-member",
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_NOTIFICATION_ROUTE_REQUIRED",
    });
    expect(destinationMocks.readHostedMemberAssistantNotificationState).not.toHaveBeenCalled();
  });

  it("fails closed when more than one route belongs to the container", async () => {
    const row = await buildRouteRow({
      accountLookupKey: "account",
      channel: "linq",
      containerMemberId: "container-member",
      threadId: "thread-one",
    });
    const prisma = createPrisma({
      containerMemberId: "container-member",
      rows: [
        row,
        {
          ...row,
          threadIdentityLookupKey: "another-identity-key",
          threadLookupKey: "another-authority-key",
        },
      ],
    });

    await expect(resolveHostedAssistantNotificationDestination({
      memberId: "container-member",
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_NOTIFICATION_ROUTE_AMBIGUOUS",
      details: { matchCount: 2 },
    });
  });

  it("fails closed when the route has no encrypted delivery material", async () => {
    const prisma = createPrisma({
      containerMemberId: "container-member",
      rows: [{
        channel: "linq",
        containerMemberId: "container-member",
        deliveryRouteEncrypted: null,
        threadIdentityLookupKey: "identity",
        threadLookupKey: "authority",
      }],
    });

    await expect(resolveHostedAssistantNotificationDestination({
      memberId: "container-member",
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_NOTIFICATION_ROUTE_INVALID",
    });
  });

  it("fails closed on corrupt or lookup-mismatched encrypted material", async () => {
    const corruptPrisma = createPrisma({
      containerMemberId: "container-member",
      rows: [{
        channel: "linq",
        containerMemberId: "container-member",
        deliveryRouteEncrypted: "not-a-secure-box",
        threadIdentityLookupKey: "identity",
        threadLookupKey: "authority",
      }],
    });
    await expect(resolveHostedAssistantNotificationDestination({
      memberId: "container-member",
      prisma: corruptPrisma,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_NOTIFICATION_ROUTE_INVALID",
    });

    const mismatched = await buildRouteRow({
      accountLookupKey: "account",
      channel: "linq",
      containerMemberId: "container-member",
      threadId: "encrypted-thread",
    });
    const mismatchedPrisma = createPrisma({
      containerMemberId: "container-member",
      rows: [{
        ...mismatched,
        threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({
          channel: "linq",
          threadId: "different-thread",
        })!,
      }],
    });
    await expect(resolveHostedAssistantNotificationDestination({
      memberId: "container-member",
      prisma: mismatchedPrisma,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_NOTIFICATION_ROUTE_MISMATCH",
    });
  });

  it("rejects a caller-supplied inconsistent conversation shape", () => {
    expect(() => isHostedThreadContainerNotificationDestination({
      conversationShape: "thread-container",
      externalThreadRouteAuthority: null,
      route: {
        actorId: null,
        channel: "linq",
        delivery: { kind: "thread", target: "thread" },
        identityId: "identity",
        threadId: "thread",
        threadIsDirect: true,
      },
    })).toThrow("inconsistent");
  });
});

async function buildRouteRow(input: {
  accountLookupKey: string;
  channel: "linq" | "telegram";
  containerMemberId: string;
  threadId: string;
}) {
  const route = buildHostedThreadDeliveryRoute(input);
  const deliveryRouteEncrypted = await sealHostedThreadDeliveryRoute({
    containerMemberId: input.containerMemberId,
    route,
  });
  return {
    channel: input.channel,
    containerMemberId: input.containerMemberId,
    deliveryRouteEncrypted,
    threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({
      channel: input.channel,
      threadId: input.threadId,
    })!,
    threadLookupKey: createHostedExternalThreadLookupKey({
      accountLookupKey: input.accountLookupKey,
      channel: input.channel,
      threadId: input.threadId,
    })!,
  };
}

function createPrisma(input: {
  containerMemberId: string | null;
  rows: Array<{
    channel: string;
    containerMemberId: string;
    deliveryRouteEncrypted: string | null;
    threadIdentityLookupKey: string;
    threadLookupKey: string;
  }>;
}): HostedOnboardingReadClient {
  return {
    hostedThreadContainer: {
      findUnique: vi.fn(async () => input.containerMemberId
        ? { memberId: input.containerMemberId }
        : null),
    },
    hostedThreadRoute: {
      findMany: vi.fn(async () => input.rows),
    },
  } as never;
}
