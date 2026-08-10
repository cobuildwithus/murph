import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  assertHostedLinqRouteEgressAuthority,
  assertHostedThreadRouteEgressAuthority,
  hasHostedMemberEstablishedLinqThreadRoute,
  readHostedThreadRouteByThreadIdentity,
  requiresHostedThreadDeliveryRouteRefresh,
} from "../src/lib/hosted-routing/thread-route-store";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedPhoneLookupKey,
} from "../src/lib/hosted-onboarding/contact-privacy";

const LINQ_ACCOUNT_LOOKUP_KEY = createHostedPhoneLookupKey("+15550000000");
if (!LINQ_ACCOUNT_LOOKUP_KEY) {
  throw new Error("Expected test Linq account lookup key.");
}

function createPrismaMock() {
  const hostedMember = {
    findUnique: vi.fn(),
  };
  const hostedMemberRouting = {
    findUnique: vi.fn(),
  };
  const hostedThreadRoute = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  };
  const hostedThreadContainerParticipant = {
    findFirst: vi.fn(),
  };

  return {
    hostedMember,
    hostedMemberRouting,
    hostedThreadContainerParticipant,
    hostedThreadRoute,
  } as unknown as Prisma.TransactionClient & {
    hostedMember: typeof hostedMember;
    hostedMemberRouting: typeof hostedMemberRouting;
    hostedThreadContainerParticipant: typeof hostedThreadContainerParticipant;
    hostedThreadRoute: typeof hostedThreadRoute;
  };
}

function buildThreadContainerAccessRecord(input: {
  containerSuspendedAt?: Date | null;
  ownerBillingStatus?: string;
  ownerSuspendedAt?: Date | null;
}) {
  return {
    accountGroupMemberships: [],
    billingStatus: "not_started",
    suspendedAt: input.containerSuspendedAt ?? null,
    threadContainer: {
      owner: {
        accountGroupMemberships: [],
        billingStatus: input.ownerBillingStatus ?? "paused",
        suspendedAt: input.ownerSuspendedAt ?? null,
      },
    },
  };
}

describe("hosted thread route store", () => {
  it("checks established Linq thread routes by container member id", async () => {
    const prisma = createPrismaMock();
    prisma.hostedThreadRoute.findFirst.mockResolvedValueOnce({
      containerMemberId: "member_container_123",
    });

    await expect(hasHostedMemberEstablishedLinqThreadRoute({
      memberId: "member_container_123",
      prisma,
    })).resolves.toBe(true);

    expect(prisma.hostedThreadRoute.findFirst).toHaveBeenCalledWith({
      select: {
        containerMemberId: true,
      },
      where: {
        channel: "linq",
        containerMemberId: "member_container_123",
      },
    });
  });

  it("does not treat a missing Linq thread route as established", async () => {
    const prisma = createPrismaMock();
    prisma.hostedThreadRoute.findFirst.mockResolvedValueOnce(null);

    await expect(hasHostedMemberEstablishedLinqThreadRoute({
      memberId: "member_container_123",
      prisma,
    })).resolves.toBe(false);
  });

  it("reads a routed external thread by stable thread identity", async () => {
    const prisma = createPrismaMock();
    const container = {
      billingStatus: "active",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_container_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    const owner = {
      billingStatus: "active",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_owner_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_abc",
    });
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
      channel: "linq",
      threadId: "chat_group_abc",
    });
    if (!threadIdentityLookupKey || !threadLookupKey) {
      throw new Error("Expected test thread route lookup keys.");
    }
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([
      {
        channel: "linq",
        container: {
          member: container,
          owner,
        },
        containerMemberId: "member_container_123",
        deliveryRouteEncrypted: "sealed-route",
        threadIdentityLookupKey,
        threadLookupKey,
      },
    ]);

    await expect(
      readHostedThreadRouteByThreadIdentity({
        channel: "linq",
        prisma,
        threadId: "chat_group_abc",
      }),
    ).resolves.toEqual({
      channel: "linq",
      container,
      containerMemberId: "member_container_123",
      deliveryRouteState: {
        deliveryRouteEncrypted: "sealed-route",
        deliveryRouteEncryptedPresent: true,
        threadIdentityLookupKey,
        threadLookupKey,
      },
      owner,
    });

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: "linq",
          threadIdentityLookupKey: {
            in: expect.arrayContaining([threadIdentityLookupKey]),
          },
        }),
      }),
    );
  });

  it("validates every canonical delivery route before deciding whether to refresh", () => {
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_abc",
    });
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
      channel: "linq",
      threadId: "chat_group_abc",
    });
    if (!threadIdentityLookupKey || !threadLookupKey) {
      throw new Error("Expected test thread route lookup keys.");
    }
    const memberState = {
      billingStatus: "active" as const,
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_container_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    const route = {
      channel: "linq" as const,
      container: memberState,
      containerMemberId: memberState.id,
      deliveryRouteState: {
        deliveryRouteEncrypted: "sealed-route",
        deliveryRouteEncryptedPresent: true,
        threadIdentityLookupKey,
        threadLookupKey,
      },
      owner: {
        ...memberState,
        accountGroupMemberships: [],
        id: "member_owner_123",
      },
    };

    expect(requiresHostedThreadDeliveryRouteRefresh({
      accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
      route,
      threadId: "chat_group_abc",
    })).toBe(true);
    expect(requiresHostedThreadDeliveryRouteRefresh({
      accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
      route: {
        channel: route.channel,
        container: route.container,
        containerMemberId: route.containerMemberId,
        owner: route.owner,
      },
      threadId: "chat_group_abc",
    })).toBe(false);
  });

  it("authorizes legacy egress authorities with stale account lookup keys by thread identity", async () => {
    const prisma = createPrismaMock();
    const memberState = {
      billingStatus: "active",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_state_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([
      {
        channel: "linq",
        container: {
          member: {
            ...memberState,
            id: "member_container_123",
          },
          owner: {
            ...memberState,
            id: "member_owner_123",
          },
        },
        containerMemberId: "member_container_123",
      },
    ]);
    prisma.hostedMember.findUnique.mockResolvedValueOnce(buildThreadContainerAccessRecord({
      ownerBillingStatus: "active",
    }));

    await expect(
      assertHostedLinqRouteEgressAuthority({
        authority: {
          accountLookupKey: "hbidx:phone:v1:stale-line",
          channel: "linq",
          containerMemberId: "member_container_123",
          threadId: "chat_group_abc",
        },
        prisma,
      }),
    ).resolves.toMatchObject({
      channel: "linq",
      containerMemberId: "member_container_123",
    });

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: "linq",
          threadIdentityLookupKey: {
            in: expect.arrayContaining([
              createHostedExternalThreadIdentityLookupKey({
                channel: "linq",
                threadId: "chat_group_abc",
              }),
            ]),
          },
        }),
      }),
    );
  });

  it("authorizes new egress authorities that omit account lookup keys", async () => {
    const prisma = createPrismaMock();
    const memberState = {
      billingStatus: "active",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_state_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([
      {
        channel: "linq",
        container: {
          member: {
            ...memberState,
            id: "member_container_123",
          },
          owner: {
            ...memberState,
            id: "member_owner_123",
          },
        },
        containerMemberId: "member_container_123",
      },
    ]);
    prisma.hostedMember.findUnique.mockResolvedValueOnce(buildThreadContainerAccessRecord({
      ownerBillingStatus: "active",
    }));

    await expect(
      assertHostedLinqRouteEgressAuthority({
        authority: {
          channel: "linq",
          containerMemberId: "member_container_123",
          threadId: "chat_group_abc",
        },
        prisma,
      }),
    ).resolves.toMatchObject({
      channel: "linq",
      containerMemberId: "member_container_123",
    });
  });

  it("authorizes Telegram egress only for the route's exact runtime container", async () => {
    const memberState = {
      billingStatus: "active",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_state_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    const createAuthorizedPrisma = () => {
      const prisma = createPrismaMock();
      prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([{
        channel: "telegram",
        container: {
          member: { ...memberState, id: "member_container_123" },
          owner: { ...memberState, id: "member_owner_123" },
        },
        containerMemberId: "member_container_123",
      }]);
      prisma.hostedMember.findUnique.mockResolvedValueOnce(
        buildThreadContainerAccessRecord({ ownerBillingStatus: "active" }),
      );
      return prisma;
    };

    await expect(assertHostedThreadRouteEgressAuthority({
      authority: {
        channel: "telegram",
        containerMemberId: "member_container_123",
        threadId: "telegram_group_123",
      },
      prisma: createAuthorizedPrisma(),
    })).resolves.toMatchObject({
      channel: "telegram",
      containerMemberId: "member_container_123",
    });

    await expect(assertHostedThreadRouteEgressAuthority({
      authority: {
        channel: "telegram",
        containerMemberId: "member_other",
        threadId: "telegram_group_123",
      },
      prisma: createAuthorizedPrisma(),
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    });
  });

  it("returns matched inactive route authority instead of collapsing it to missing", async () => {
    const prisma = createPrismaMock();
    const owner = {
      billingStatus: "paused",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_owner_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([
      {
        channel: "linq",
        container: {
          member: {
            billingStatus: "active",
            createdAt: new Date("2026-06-24T00:00:00.000Z"),
            id: "member_container_123",
            suspendedAt: null,
            updatedAt: new Date("2026-06-24T00:00:00.000Z"),
          },
          owner,
        },
        containerMemberId: "member_container_123",
      },
    ]);

    await expect(
      readHostedThreadRouteByThreadIdentity({
        channel: "linq",
        prisma,
        threadId: "chat_group_abc",
      }),
    ).resolves.toMatchObject({
      channel: "linq",
      containerMemberId: "member_container_123",
      owner,
    });
  });

  it("does not authorize home Linq routing state without an explicit thread route", async () => {
    const prisma = createPrismaMock();
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([]);

    await expect(assertHostedLinqRouteEgressAuthority({
      authority: {
        accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
        channel: "linq",
        containerMemberId: "member_home_123",
        threadId: "chat_home_123",
      },
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    });

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: "linq",
          threadIdentityLookupKey: expect.any(Object),
        }),
      }),
    );
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.findFirst).not.toHaveBeenCalled();
  });

  it("authorizes egress when an active participant keeps an inactive-owner group alive", async () => {
    const prisma = createPrismaMock();
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_abc",
    });
    if (!threadIdentityLookupKey) {
      throw new Error("Expected test thread identity lookup key.");
    }
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([
      {
        channel: "linq",
        container: {
          member: {
            billingStatus: "not_started",
            createdAt: new Date("2026-06-24T00:00:00.000Z"),
            id: "member_container_123",
            suspendedAt: null,
            updatedAt: new Date("2026-06-24T00:00:00.000Z"),
          },
          owner: {
            accountGroupMemberships: [],
            billingStatus: "paused",
            createdAt: new Date("2026-06-24T00:00:00.000Z"),
            id: "member_owner_123",
            suspendedAt: null,
            updatedAt: new Date("2026-06-24T00:00:00.000Z"),
          },
        },
        containerMemberId: "member_container_123",
        threadIdentityLookupKey,
      },
    ]);
    prisma.hostedMember.findUnique.mockResolvedValueOnce(buildThreadContainerAccessRecord({
      ownerBillingStatus: "paused",
    }));
    prisma.hostedThreadContainerParticipant.findFirst.mockResolvedValueOnce({
      participantMemberId: "member_active_participant_123",
    });

    await expect(assertHostedLinqRouteEgressAuthority({
      authority: {
        accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
        channel: "linq",
        containerMemberId: "member_container_123",
        threadId: "chat_group_abc",
      },
      prisma,
    })).resolves.toMatchObject({
      channel: "linq",
      containerMemberId: "member_container_123",
    });

    expect(prisma.hostedThreadContainerParticipant.findFirst).toHaveBeenCalledWith({
      select: {
        participantMemberId: true,
      },
      where: expect.objectContaining({
        containerMemberId: "member_container_123",
        removedAt: null,
      }),
    });
  });

  it("does not authorize egress when owner and projected participants are inactive", async () => {
    const prisma = createPrismaMock();
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_abc",
    });
    if (!threadIdentityLookupKey) {
      throw new Error("Expected test thread identity lookup key.");
    }
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([
      {
        channel: "linq",
        container: {
          member: {
            billingStatus: "not_started",
            createdAt: new Date("2026-06-24T00:00:00.000Z"),
            id: "member_container_123",
            suspendedAt: null,
            updatedAt: new Date("2026-06-24T00:00:00.000Z"),
          },
          owner: {
            accountGroupMemberships: [],
            billingStatus: "paused",
            createdAt: new Date("2026-06-24T00:00:00.000Z"),
            id: "member_owner_123",
            suspendedAt: null,
            updatedAt: new Date("2026-06-24T00:00:00.000Z"),
          },
        },
        containerMemberId: "member_container_123",
        threadIdentityLookupKey,
      },
    ]);
    prisma.hostedMember.findUnique.mockResolvedValueOnce(buildThreadContainerAccessRecord({
      ownerBillingStatus: "paused",
    }));
    prisma.hostedThreadContainerParticipant.findFirst.mockResolvedValueOnce(null);

    await expect(assertHostedLinqRouteEgressAuthority({
      authority: {
        accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
        channel: "linq",
        containerMemberId: "member_container_123",
        threadId: "chat_group_abc",
      },
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    });

    expect(prisma.hostedThreadContainerParticipant.findFirst).toHaveBeenCalledTimes(1);
  });

  it("does not authorize egress for a suspended container even with an active participant", async () => {
    const prisma = createPrismaMock();
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_abc",
    });
    if (!threadIdentityLookupKey) {
      throw new Error("Expected test thread identity lookup key.");
    }
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([
      {
        channel: "linq",
        container: {
          member: {
            billingStatus: "not_started",
            createdAt: new Date("2026-06-24T00:00:00.000Z"),
            id: "member_container_123",
            suspendedAt: new Date("2026-06-24T00:00:00.000Z"),
            updatedAt: new Date("2026-06-24T00:00:00.000Z"),
          },
          owner: {
            accountGroupMemberships: [],
            billingStatus: "paused",
            createdAt: new Date("2026-06-24T00:00:00.000Z"),
            id: "member_owner_123",
            suspendedAt: null,
            updatedAt: new Date("2026-06-24T00:00:00.000Z"),
          },
        },
        containerMemberId: "member_container_123",
        threadIdentityLookupKey,
      },
    ]);
    prisma.hostedMember.findUnique.mockResolvedValueOnce(buildThreadContainerAccessRecord({
      containerSuspendedAt: new Date("2026-06-24T00:00:00.000Z"),
      ownerBillingStatus: "paused",
    }));
    prisma.hostedThreadContainerParticipant.findFirst.mockResolvedValueOnce({
      participantMemberId: "member_active_participant_123",
    });

    await expect(assertHostedLinqRouteEgressAuthority({
      authority: {
        accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
        channel: "linq",
        containerMemberId: "member_container_123",
        threadId: "chat_group_abc",
      },
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    });

    expect(prisma.hostedThreadContainerParticipant.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed when lookup candidates match multiple containers", async () => {
    const prisma = createPrismaMock();
    const memberState = {
      billingStatus: "active",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_owner_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([
      {
        channel: "linq",
        container: {
          member: {
            ...memberState,
            id: "member_container_1",
          },
          owner: memberState,
        },
        containerMemberId: "member_container_1",
      },
      {
        channel: "linq",
        container: {
          member: {
            ...memberState,
            id: "member_container_2",
          },
          owner: memberState,
        },
        containerMemberId: "member_container_2",
      },
    ]);

    await expect(
      readHostedThreadRouteByThreadIdentity({
        channel: "linq",
        prisma,
        threadId: "chat_group_abc",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_IDENTITY_LOOKUP_AMBIGUOUS",
    });
  });
});
