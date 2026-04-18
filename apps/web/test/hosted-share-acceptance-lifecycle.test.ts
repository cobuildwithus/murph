import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedWakeLifecycleState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/wake-lifecycle", () => ({
  readHostedWakeLifecycleState: mocks.readHostedWakeLifecycleState,
}));

import { reconcileHostedShareAcceptanceLifecycle } from "@/src/lib/hosted-share/shared-acceptance";

describe("hosted share acceptance lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finalizes a claimed share from the wake-backed lifecycle", async () => {
    const prisma = createHostedSharePrisma();
    mocks.readHostedWakeLifecycleState.mockResolvedValue("completed");

    await expect(reconcileHostedShareAcceptanceLifecycle({
      eventId: "evt_share",
      memberId: "member_123",
      prisma: prisma as never,
      shareId: "share_123",
    })).resolves.toBe("completed");
    expect(prisma.share.consumedByMemberId).toBe("member_123");
    expect(prisma.share.lastEventId).toBe("evt_share");
  });

  it("releases a claimed share when the wake-backed lifecycle is poisoned", async () => {
    const prisma = createHostedSharePrisma();
    mocks.readHostedWakeLifecycleState.mockResolvedValue("poisoned");

    await expect(reconcileHostedShareAcceptanceLifecycle({
      eventId: "evt_share",
      memberId: "member_123",
      prisma: prisma as never,
      shareId: "share_123",
    })).resolves.toBe("poisoned");
    expectReleased(prisma.share);
  });

  it("releases a claimed share when the canonical wake row is absent", async () => {
    const prisma = createHostedSharePrisma();
    mocks.readHostedWakeLifecycleState.mockResolvedValue(null);

    await expect(reconcileHostedShareAcceptanceLifecycle({
      eventId: "evt_share",
      memberId: "member_123",
      prisma: prisma as never,
      shareId: "share_123",
    })).resolves.toBe("poisoned");
    expectReleased(prisma.share);
  });
});

function createHostedSharePrisma() {
  const share: HostedShareRow = {
    acceptedAt: new Date("2026-03-26T12:00:00.000Z"),
    acceptedByMemberId: "member_123",
    consumedAt: null,
    consumedByMemberId: null,
    id: "share_123",
    lastEventId: "evt_share",
    senderMemberId: "member_sender",
  };

  return {
    hostedShareLink: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === share.id ? share : null),
      updateMany: vi.fn(async ({
        data,
        where,
      }: {
        data: Partial<HostedShareRow>;
        where: {
          acceptedByMemberId?: string;
          consumedAt?: null;
          id?: string;
          lastEventId?: string;
        };
      }) => {
        if (where.id !== undefined && where.id !== share.id) {
          return { count: 0 };
        }

        if (where.acceptedByMemberId && share.acceptedByMemberId !== where.acceptedByMemberId) {
          return { count: 0 };
        }

        if (where.consumedAt === null && share.consumedAt !== null) {
          return { count: 0 };
        }

        if (where.lastEventId !== undefined && share.lastEventId !== where.lastEventId) {
          return { count: 0 };
        }

        Object.assign(share, data);
        return { count: 1 };
      }),
    },
    share,
  };
}

function expectReleased(share: HostedShareRow): void {
  expect(share.acceptedAt).toBeNull();
  expect(share.acceptedByMemberId).toBeNull();
  expect(share.consumedAt).toBeNull();
  expect(share.consumedByMemberId).toBeNull();
  expect(share.lastEventId).toBeNull();
}

interface HostedShareRow {
  acceptedAt: Date | null;
  acceptedByMemberId: string | null;
  consumedAt: Date | null;
  consumedByMemberId: string | null;
  id: string;
  lastEventId: string | null;
  senderMemberId: string | null;
}
