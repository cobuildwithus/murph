import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedThreadContainerTx,
  ensureHostedThreadRouteTx,
  HOSTED_THREAD_CONTAINER_DEFAULT_MONTHLY_USAGE_LIMIT_USD_MICROS,
  readHostedThreadRouteByExternalThread,
} from "../src/lib/hosted-routing/thread-route-store";
import {
  createHostedExternalThreadLookupKey,
} from "../src/lib/hosted-onboarding/contact-privacy";

function createPrismaMock() {
  const hostedThreadContainer = {
    create: vi.fn(),
  };
  const hostedThreadRoute = {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  };

  return {
    hostedThreadContainer,
    hostedThreadRoute,
  } as unknown as Prisma.TransactionClient & {
    hostedThreadContainer: typeof hostedThreadContainer;
    hostedThreadRoute: typeof hostedThreadRoute;
  };
}

describe("hosted thread route store", () => {
  it("creates a thread-container marker with the default group usage cap", async () => {
    const prisma = createPrismaMock();

    await createHostedThreadContainerTx({
      memberId: "member_container_123",
      ownerMemberId: "member_owner_123",
      prisma,
    });

    expect(prisma.hostedThreadContainer.create).toHaveBeenCalledWith({
      data: {
        memberId: "member_container_123",
        monthlyUsageLimitUsdMicros:
          HOSTED_THREAD_CONTAINER_DEFAULT_MONTHLY_USAGE_LIMIT_USD_MICROS,
        ownerMemberId: "member_owner_123",
      },
    });
  });

  it("creates a channel-neutral thread route to an existing container", async () => {
    const prisma = createPrismaMock();
    prisma.hostedThreadRoute.findUnique.mockResolvedValueOnce(null);

    await ensureHostedThreadRouteTx({
      channel: "linq",
      containerMemberId: "member_container_123",
      prisma,
      threadId: "chat_group_abc",
    });

    const threadLookupKey = createHostedExternalThreadLookupKey({
      channel: "linq",
      threadId: "chat_group_abc",
    });

    expect(prisma.hostedThreadRoute.create).toHaveBeenCalledWith({
      data: {
        channel: "linq",
        containerMemberId: "member_container_123",
        threadLookupKey,
      },
    });
  });

  it("does not silently repoint an already-bound thread", async () => {
    const prisma = createPrismaMock();
    prisma.hostedThreadRoute.findUnique.mockResolvedValueOnce({
      containerMemberId: "member_container_existing",
    });

    await expect(
      ensureHostedThreadRouteTx({
        channel: "linq",
        containerMemberId: "member_container_new",
        prisma,
        threadId: "chat_group_abc",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
    });

    expect(prisma.hostedThreadRoute.create).not.toHaveBeenCalled();
  });

  it("leaves the same route unchanged when it is ensured again", async () => {
    const prisma = createPrismaMock();
    prisma.hostedThreadRoute.findUnique.mockResolvedValueOnce({
      containerMemberId: "member_container_123",
    });

    await ensureHostedThreadRouteTx({
      channel: "linq",
      containerMemberId: "member_container_123",
      prisma,
      threadId: "chat_group_abc",
    });

    expect(prisma.hostedThreadRoute.create).not.toHaveBeenCalled();
  });

  it("reads a routed external thread without exposing raw thread ids", async () => {
    const prisma = createPrismaMock();
    const container = {
      billingStatus: "active",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_container_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    prisma.hostedThreadRoute.findMany.mockResolvedValueOnce([
      {
        channel: "linq",
        container: {
          member: container,
          owner: {
            billingStatus: "active",
            createdAt: new Date("2026-06-24T00:00:00.000Z"),
            id: "member_owner_123",
            suspendedAt: null,
            updatedAt: new Date("2026-06-24T00:00:00.000Z"),
          },
        },
        containerMemberId: "member_container_123",
      },
    ]);

    await expect(
      readHostedThreadRouteByExternalThread({
        channel: "linq",
        prisma,
        threadId: "chat_group_abc",
      }),
    ).resolves.toEqual({
      channel: "linq",
      container,
      containerMemberId: "member_container_123",
    });

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: "linq",
          threadLookupKey: {
            in: expect.arrayContaining([
              createHostedExternalThreadLookupKey({
                channel: "linq",
                threadId: "chat_group_abc",
              }),
            ]),
          },
        }),
      }),
    );
  });

  it("fails closed when the route owner is inactive", async () => {
    const prisma = createPrismaMock();
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
          owner: {
            billingStatus: "paused",
            createdAt: new Date("2026-06-24T00:00:00.000Z"),
            id: "member_owner_123",
            suspendedAt: null,
            updatedAt: new Date("2026-06-24T00:00:00.000Z"),
          },
        },
        containerMemberId: "member_container_123",
      },
    ]);

    await expect(
      readHostedThreadRouteByExternalThread({
        channel: "linq",
        prisma,
        threadId: "chat_group_abc",
      }),
    ).resolves.toBeNull();
  });
});
