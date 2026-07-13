import type { Prisma, PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyHostedLinqThreadRosterSnapshotStrict: vi.fn(),
  readHostedLinqThreadRosterStrict: vi.fn(),
}));

vi.mock("../src/lib/hosted-routing/linq-thread-roster", () => ({
  applyHostedLinqThreadRosterSnapshotStrict:
    mocks.applyHostedLinqThreadRosterSnapshotStrict,
  readHostedLinqThreadRosterStrict:
    mocks.readHostedLinqThreadRosterStrict,
}));

import {
  assertHostedLinqRouteEgressAuthority,
  assertHostedThreadRouteEgressAuthority,
  hasHostedMemberEstablishedLinqThreadRoute,
  prepareHostedLinqRouteEgressRosterSnapshot,
  readHostedThreadRouteByThreadIdentity,
} from "../src/lib/hosted-routing/thread-route-store";
import {
  createHostedExternalThreadIdentityLookupKey,
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
    $transaction: vi.fn(),
    hostedMember,
    hostedMemberRouting,
    hostedThreadContainerParticipant,
    hostedThreadRoute,
  } as unknown as PrismaClient & Prisma.TransactionClient & {
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedLinqThreadRosterStrict.mockResolvedValue({
      handles: [{ handle: "+15550001111", isMe: false, status: "active" }],
      observationOrdinal: 7n,
      observedAt: new Date("2026-07-10T12:00:00.000Z"),
    });
    mocks.applyHostedLinqThreadRosterSnapshotStrict.mockResolvedValue({
      hasActiveParticipantAccess: true,
    });
  });

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
    if (!threadIdentityLookupKey) {
      throw new Error("Expected test thread identity lookup key.");
    }
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([
      {
        channel: "linq",
        container: {
          member: container,
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
    ).resolves.toEqual({
      channel: "linq",
      container,
      containerMemberId: "member_container_123",
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
    expect(mocks.readHostedLinqThreadRosterStrict).not.toHaveBeenCalled();
    expect(mocks.applyHostedLinqThreadRosterSnapshotStrict).not.toHaveBeenCalled();
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
      rosterSnapshot: null,
      route: {
        channel: "linq",
        containerMemberId: "member_container_123",
      },
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
    expect(mocks.readHostedLinqThreadRosterStrict).not.toHaveBeenCalled();
    expect(mocks.applyHostedLinqThreadRosterSnapshotStrict).not.toHaveBeenCalled();
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
      rosterSnapshot: null,
      route: {
        channel: "linq",
        containerMemberId: "member_container_123",
      },
    });
    expect(mocks.readHostedLinqThreadRosterStrict).not.toHaveBeenCalled();
    expect(mocks.applyHostedLinqThreadRosterSnapshotStrict).not.toHaveBeenCalled();
  });

  it("returns one requested live roster without applying it for an active owner", async () => {
    const prisma = createPrismaMock();
    const memberState = {
      billingStatus: "active",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([{
      channel: "linq",
      container: {
        member: { ...memberState, id: "member_container_123" },
        owner: { ...memberState, id: "member_owner_123" },
      },
      containerMemberId: "member_container_123",
    }]);

    await expect(assertHostedLinqRouteEgressAuthority({
      authority: {
        channel: "linq",
        containerMemberId: "member_container_123",
        threadId: "chat_group_abc",
      },
      includeRosterSnapshot: true,
      prisma,
    })).resolves.toMatchObject({
      rosterSnapshot: {
        handles: [{ handle: "+15550001111", isMe: false, status: "active" }],
        observationOrdinal: 7n,
        observedAt: new Date("2026-07-10T12:00:00.000Z"),
      },
      route: { containerMemberId: "member_container_123" },
    });

    expect(mocks.readHostedLinqThreadRosterStrict).toHaveBeenCalledOnce();
    expect(mocks.applyHostedLinqThreadRosterSnapshotStrict).not.toHaveBeenCalled();
  });

  it("rejects a requested live roster on a transaction client before provider I/O", async () => {
    const prisma = createPrismaMock();
    const transaction = { ...prisma };
    Reflect.deleteProperty(transaction, "$transaction");
    const memberState = {
      billingStatus: "active",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    transaction.hostedThreadRoute.findMany.mockResolvedValueOnce([{
      channel: "linq",
      container: {
        member: { ...memberState, id: "member_container_123" },
        owner: { ...memberState, id: "member_owner_123" },
      },
      containerMemberId: "member_container_123",
    }]);

    await expect(assertHostedLinqRouteEgressAuthority({
      authority: {
        channel: "linq",
        containerMemberId: "member_container_123",
        threadId: "chat_group_abc",
      },
      includeRosterSnapshot: true,
      prisma: transaction,
    })).rejects.toMatchObject({
      code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
      httpStatus: 503,
    });

    expect(mocks.readHostedLinqThreadRosterStrict).not.toHaveBeenCalled();
    expect(mocks.applyHostedLinqThreadRosterSnapshotStrict).not.toHaveBeenCalled();
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
    await expect(assertHostedThreadRouteEgressAuthority({
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

    expect(mocks.readHostedLinqThreadRosterStrict).toHaveBeenCalledOnce();
    expect(mocks.readHostedLinqThreadRosterStrict).toHaveBeenCalledWith({
      chatId: "chat_group_abc",
      prisma,
    });
    expect(mocks.applyHostedLinqThreadRosterSnapshotStrict).toHaveBeenCalledWith({
      chatId: "chat_group_abc",
      containerMemberId: "member_container_123",
      handles: [{ handle: "+15550001111", isMe: false, status: "active" }],
      observationOrdinal: 7n,
      observedAt: new Date("2026-07-10T12:00:00.000Z"),
      prisma,
    });
    expect(prisma.hostedThreadContainerParticipant.findFirst).not.toHaveBeenCalled();
  });

  it("fetches an inactive-owner roster before a transaction and applies it under the route check", async () => {
    const prisma = createPrismaMock();
    const transaction = { ...prisma };
    Reflect.deleteProperty(transaction, "$transaction");
    const routeRow = {
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
    };
    prisma.hostedThreadRoute.findMany.mockResolvedValue([routeRow]);
    const authority = {
      channel: "linq" as const,
      containerMemberId: "member_container_123",
      threadId: "chat_group_abc",
    };

    const rosterSnapshot = await prepareHostedLinqRouteEgressRosterSnapshot({
      authority,
      prisma,
    });
    expect(rosterSnapshot).toEqual({
      handles: [{ handle: "+15550001111", isMe: false, status: "active" }],
      observationOrdinal: 7n,
      observedAt: new Date("2026-07-10T12:00:00.000Z"),
    });
    expect(mocks.applyHostedLinqThreadRosterSnapshotStrict).not.toHaveBeenCalled();

    await expect(assertHostedLinqRouteEgressAuthority({
      authority,
      prisma: transaction,
      rosterSnapshot,
    })).resolves.toMatchObject({
      route: { containerMemberId: "member_container_123" },
      rosterSnapshot,
    });
    expect(mocks.readHostedLinqThreadRosterStrict).toHaveBeenCalledTimes(1);
    expect(mocks.applyHostedLinqThreadRosterSnapshotStrict).toHaveBeenCalledWith({
      chatId: "chat_group_abc",
      containerMemberId: "member_container_123",
      handles: rosterSnapshot?.handles,
      observationOrdinal: rosterSnapshot?.observationOrdinal,
      observedAt: rosterSnapshot?.observedAt,
      prisma: transaction,
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
    mocks.applyHostedLinqThreadRosterSnapshotStrict.mockResolvedValueOnce({
      hasActiveParticipantAccess: false,
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

    expect(mocks.readHostedLinqThreadRosterStrict).toHaveBeenCalledTimes(1);
    expect(mocks.applyHostedLinqThreadRosterSnapshotStrict).toHaveBeenCalledTimes(1);
    expect(prisma.hostedThreadContainerParticipant.findFirst).not.toHaveBeenCalled();
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

    expect(mocks.readHostedLinqThreadRosterStrict).not.toHaveBeenCalled();
    expect(mocks.applyHostedLinqThreadRosterSnapshotStrict).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.findFirst).not.toHaveBeenCalled();
  });

  it("propagates retryable current-roster failures for inactive-owner Linq egress", async () => {
    const prisma = createPrismaMock();
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([{
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
    }]);
    mocks.readHostedLinqThreadRosterStrict.mockRejectedValueOnce(
      Object.assign(new Error("Linq roster unavailable"), {
        code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
        httpStatus: 503,
        retryable: true,
      }),
    );

    await expect(assertHostedThreadRouteEgressAuthority({
      authority: {
        accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
        channel: "linq",
        containerMemberId: "member_container_123",
        threadId: "chat_group_abc",
      },
      prisma,
    })).rejects.toMatchObject({
      code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });

    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.applyHostedLinqThreadRosterSnapshotStrict).not.toHaveBeenCalled();
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
