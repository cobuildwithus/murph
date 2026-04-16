import {
  ExecutionOutboxStatus,
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";
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

import { isHostedMemberActivationPending } from "./activation-progress";

describe("hosted member activation progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);
  });

  it("keeps activation pending when the canonical lifecycle is non-terminal and Cloudflare has no fresh hint", async () => {
    const prisma = createActivationPrisma({
      dispatchState: "queued",
      eventId: "evt_activation",
      status: ExecutionOutboxStatus.dispatched,
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      getEventStatus: mocks.getEventStatus,
    });
    mocks.getEventStatus.mockResolvedValue(null);

    await expect(isHostedMemberActivationPending({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_123",
      prisma,
    })).resolves.toBe(true);
    expect(mocks.getEventStatus).toHaveBeenCalledWith("member_123", "evt_activation");
  });

  it("accepts a completed live hint without requiring transport status to be dispatched", async () => {
    const prisma = createActivationPrisma({
      dispatchState: "queued",
      eventId: "evt_activation",
      status: ExecutionOutboxStatus.delivery_failed,
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      getEventStatus: mocks.getEventStatus,
    });
    mocks.getEventStatus.mockResolvedValue({
      eventId: "evt_activation",
      lastError: null,
      state: "completed",
      userId: "member_123",
    });

    await expect(isHostedMemberActivationPending({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_123",
      prisma,
    })).resolves.toBe(false);
    expect(mocks.getEventStatus).toHaveBeenCalledWith("member_123", "evt_activation");
  });
});

function createActivationPrisma(record: {
  dispatchState: string;
  eventId: string;
  status: ExecutionOutboxStatus;
}): PrismaClient {
  return {
    executionOutbox: {
      findFirst: vi.fn(async () => ({
        dispatchState: record.dispatchState,
        eventId: record.eventId,
        status: record.status,
      })),
    },
  } as unknown as PrismaClient;
}
