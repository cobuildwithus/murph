import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  readHostedThreadRouteByExternalThread,
} from "../src/lib/hosted-routing/thread-route-store";
import {
  createHostedExternalThreadLookupKey,
} from "../src/lib/hosted-onboarding/contact-privacy";

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
      readHostedThreadRouteByExternalThread({
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
      readHostedThreadRouteByExternalThread({
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
      readHostedThreadRouteByExternalThread({
        channel: "linq",
        prisma,
        threadId: "chat_group_abc",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_LOOKUP_AMBIGUOUS",
    });
  });
});
