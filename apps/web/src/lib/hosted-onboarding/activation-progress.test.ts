import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEventStatus: vi.fn(),
  getPrisma: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  readLatestHostedWakeLifecycleByKind: vi.fn(),
}));

vi.mock("../hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: mocks.readHostedExecutionControlClientIfConfigured,
}));
vi.mock("../hosted-wake/store", () => ({
  readLatestHostedWakeLifecycleByKind: mocks.readLatestHostedWakeLifecycleByKind,
}));
vi.mock("../prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import { isHostedMemberActivationPending } from "./activation-progress";

describe("hosted member activation progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);
    mocks.readLatestHostedWakeLifecycleByKind.mockResolvedValue(null);
  });

  it("keeps activation pending when the canonical lifecycle is non-terminal and Cloudflare has no fresh hint", async () => {
    const prisma = createActivationPrisma({
      dispatchState: "queued",
      eventId: "evt_activation",
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

  it("accepts a completed live hint without requiring a separate transport status", async () => {
    const prisma = createActivationPrisma({
      dispatchState: "queued",
      eventId: "evt_activation",
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

  it("falls back to the latest hosted wake lifecycle when the outbox row is absent", async () => {
    const prisma = createActivationPrisma(null);
    mocks.readLatestHostedWakeLifecycleByKind.mockResolvedValue({
      eventId: "evt_activation_from_wake",
      state: "queued",
    });

    await expect(isHostedMemberActivationPending({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_123",
      prisma,
    })).resolves.toBe(true);
    expect(mocks.readLatestHostedWakeLifecycleByKind).toHaveBeenCalledWith({
      kind: "member.activated",
      prisma,
      userId: "member_123",
    });
  });
});

function createActivationPrisma(record: {
  dispatchState: string;
  eventId: string;
} | null): PrismaClient {
  return {
    executionOutbox: {
      findFirst: vi.fn(async () => (
        record
          ? {
              dispatchState: record.dispatchState,
              eventId: record.eventId,
            }
          : null
      )),
    },
  } as unknown as PrismaClient;
}
