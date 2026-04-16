import { ExecutionOutboxStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEventStatus: vi.fn(),
  getPrisma: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
}));

vi.mock("../hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: mocks.readHostedExecutionControlClientIfConfigured,
}));
vi.mock("../prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import { reconcileHostedShareAcceptanceLifecycle } from "./shared";

describe("hosted share lifecycle reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      getEventStatus: mocks.getEventStatus,
    });
  });

  it("finalizes a claimed share from the canonical lifecycle without transport-status gating", async () => {
    const prisma = createHostedSharePrisma({
      outboxRows: [
        {
          dispatchState: "queued",
          eventId: "evt_share",
          status: ExecutionOutboxStatus.delivery_failed,
        },
      ],
      share: {
        acceptedByMemberId: "member_123",
        lastEventId: "evt_share",
      },
    });
    mocks.getEventStatus.mockResolvedValue({
      eventId: "evt_share",
      lastError: null,
      state: "completed",
      userId: "member_123",
    });

    await expect(reconcileHostedShareAcceptanceLifecycle({
      eventId: "evt_share",
      memberId: "member_123",
      prisma: prisma as never,
      shareId: "share_123",
    })).resolves.toBe("completed");
    expect(prisma.share.consumedByMemberId).toBe("member_123");
    expect(prisma.share.lastEventId).toBe("evt_share");
  });

  it("releases a claimed share from the canonical lifecycle without waiting for dispatched transport state", async () => {
    const prisma = createHostedSharePrisma({
      outboxRows: [
        {
          dispatchState: "queued",
          eventId: "evt_share",
          status: ExecutionOutboxStatus.queued,
        },
      ],
      share: {
        acceptedByMemberId: "member_123",
        lastEventId: "evt_share",
      },
    });
    mocks.getEventStatus.mockResolvedValue({
      eventId: "evt_share",
      lastError: "runner failed",
      state: "poisoned",
      userId: "member_123",
    });

    await expect(reconcileHostedShareAcceptanceLifecycle({
      eventId: "evt_share",
      memberId: "member_123",
      prisma: prisma as never,
      shareId: "share_123",
    })).resolves.toBe("poisoned");
    expect(prisma.share.acceptedAt).toBeNull();
    expect(prisma.share.acceptedByMemberId).toBeNull();
    expect(prisma.share.lastEventId).toBeNull();
  });
});

function createHostedSharePrisma(input: {
  outboxRows: Array<{
    dispatchState: string;
    eventId: string;
    status: ExecutionOutboxStatus;
  }>;
  share?: Partial<HostedShareRow>;
}) {
  const share: HostedShareRow = {
    acceptedAt: new Date("2026-03-26T12:00:00.000Z"),
    acceptedByMemberId: "member_123",
    consumedAt: null,
    consumedByMemberId: null,
    id: "share_123",
    lastEventId: "evt_share",
    senderMemberId: "member_sender",
    ...input.share,
  };

  return {
    executionOutbox: {
      findUnique: vi.fn(async () => null),
    },
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
    outboxRows: input.outboxRows,
    share,
  };
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
