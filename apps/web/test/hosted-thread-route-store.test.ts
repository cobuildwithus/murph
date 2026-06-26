import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  readHostedThreadRouteByExternalThread,
  readHostedThreadRouteByThreadIdentity,
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
  const hostedThreadRoute = {
    findMany: vi.fn(),
  };

  return {
    hostedThreadRoute,
  } as unknown as Prisma.TransactionClient & {
    hostedThreadRoute: typeof hostedThreadRoute;
  };
}

describe("hosted thread route store", () => {
  it("reads a routed external thread without exposing raw thread ids", async () => {
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
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
      channel: "linq",
      threadId: "chat_group_abc",
    });
    if (!threadLookupKey) {
      throw new Error("Expected test thread lookup key.");
    }
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([
      {
        channel: "linq",
        container: {
          member: container,
          owner,
        },
        containerMemberId: "member_container_123",
        threadLookupKey,
      },
    ]);

    await expect(
      readHostedThreadRouteByExternalThread({
        accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
        channel: "linq",
        prisma,
        threadId: "chat_group_abc",
      }),
    ).resolves.toEqual({
      accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
      channel: "linq",
      container,
      containerMemberId: "member_container_123",
      owner,
    });

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: "linq",
          threadLookupKey: {
            in: expect.arrayContaining([
              createHostedExternalThreadLookupKey({
                accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
                channel: "linq",
                threadId: "chat_group_abc",
              }),
            ]),
          },
        }),
      }),
    );
  });

  it("reads explicit thread identity without account authority", async () => {
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
  });

  it("matches prior account lookup-key candidates across privacy key rotation", async () => {
    const prisma = createPrismaMock();
    const priorAccountLookupKey = "hbidx:phone:v1:prior-account";
    const currentAccountLookupKey = "hbidx:phone:v2:current-account";
    const priorThreadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: priorAccountLookupKey,
      channel: "linq",
      threadId: "chat_group_abc",
    });
    if (!priorThreadLookupKey) {
      throw new Error("Expected prior thread lookup key.");
    }
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
        threadLookupKey: priorThreadLookupKey,
      },
    ]);

    await expect(
      readHostedThreadRouteByExternalThread({
        accountLookupKeys: [currentAccountLookupKey, priorAccountLookupKey],
        channel: "linq",
        prisma,
        threadId: "chat_group_abc",
      }),
    ).resolves.toMatchObject({
      accountLookupKey: priorAccountLookupKey,
      channel: "linq",
      containerMemberId: "member_container_123",
    });

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          threadLookupKey: {
            in: expect.arrayContaining([
              priorThreadLookupKey,
              createHostedExternalThreadLookupKey({
                accountLookupKey: currentAccountLookupKey,
                channel: "linq",
                threadId: "chat_group_abc",
              }),
            ]),
          },
        }),
      }),
    );
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
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
      channel: "linq",
      threadId: "chat_group_abc",
    });
    if (!threadLookupKey) {
      throw new Error("Expected test thread lookup key.");
    }
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
        threadLookupKey,
      },
    ]);

    await expect(
      readHostedThreadRouteByExternalThread({
        accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
        channel: "linq",
        prisma,
        threadId: "chat_group_abc",
      }),
    ).resolves.toMatchObject({
      accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
      channel: "linq",
      containerMemberId: "member_container_123",
      owner,
    });
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
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
      channel: "linq",
      threadId: "chat_group_abc",
    });
    if (!threadLookupKey) {
      throw new Error("Expected test thread lookup key.");
    }
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
        threadLookupKey,
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
        threadLookupKey,
      },
    ]);

    await expect(
      readHostedThreadRouteByExternalThread({
        accountLookupKey: LINQ_ACCOUNT_LOOKUP_KEY,
        channel: "linq",
        prisma,
        threadId: "chat_group_abc",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_LOOKUP_AMBIGUOUS",
    });
  });
});
