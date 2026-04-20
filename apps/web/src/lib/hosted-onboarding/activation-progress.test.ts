import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readLatestHostedIngressLifecycleByKind: vi.fn(),
}));

vi.mock("../hosted-ingress/store", () => ({
  readLatestHostedIngressLifecycleByKind: mocks.readLatestHostedIngressLifecycleByKind,
}));

import { isHostedMemberActivationPending } from "./activation-progress";

describe("hosted member activation progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readLatestHostedIngressLifecycleByKind.mockResolvedValue(null);
  });

  it("keeps activation pending when the latest hosted wake lifecycle is non-terminal", async () => {
    const prisma = {} as PrismaClient;
    mocks.readLatestHostedIngressLifecycleByKind.mockResolvedValue({
      eventId: "evt_activation",
      state: "queued",
    });

    await expect(isHostedMemberActivationPending({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_123",
      prisma,
    })).resolves.toBe(true);
    expect(mocks.readLatestHostedIngressLifecycleByKind).toHaveBeenCalledWith({
      kind: "member.activated",
      prisma,
      userId: "member_123",
    });
  });

  it("treats completed hosted wake lifecycle records as terminal", async () => {
    mocks.readLatestHostedIngressLifecycleByKind.mockResolvedValue({
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
    mocks.readLatestHostedIngressLifecycleByKind.mockResolvedValue({
      eventId: "evt_activation",
      state: "quarantined",
    });

    await expect(isHostedMemberActivationPending({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_123",
      prisma: {} as PrismaClient,
    })).resolves.toBe(false);
  });
});
