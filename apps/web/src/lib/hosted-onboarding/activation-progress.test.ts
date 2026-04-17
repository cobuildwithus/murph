import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readLatestHostedWakeLifecycleByKind: vi.fn(),
}));

vi.mock("../hosted-wake/store", () => ({
  readLatestHostedWakeLifecycleByKind: mocks.readLatestHostedWakeLifecycleByKind,
}));

import { isHostedMemberActivationPending } from "./activation-progress";

describe("hosted member activation progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readLatestHostedWakeLifecycleByKind.mockResolvedValue(null);
  });

  it("keeps activation pending when the latest hosted wake lifecycle is non-terminal", async () => {
    const prisma = {} as PrismaClient;
    mocks.readLatestHostedWakeLifecycleByKind.mockResolvedValue({
      eventId: "evt_activation",
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

  it("treats completed hosted wake lifecycle records as terminal", async () => {
    mocks.readLatestHostedWakeLifecycleByKind.mockResolvedValue({
      eventId: "evt_activation",
      state: "completed",
    });

    await expect(isHostedMemberActivationPending({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_123",
      prisma: {} as PrismaClient,
    })).resolves.toBe(false);
  });

  it("returns false when no activation wake has been recorded", async () => {
    mocks.readLatestHostedWakeLifecycleByKind.mockResolvedValue({
      eventId: "evt_activation",
      state: "poisoned",
    });

    await expect(isHostedMemberActivationPending({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_123",
      prisma: {} as PrismaClient,
    })).resolves.toBe(false);
  });
});
