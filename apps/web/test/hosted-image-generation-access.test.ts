import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gate: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({ readHostedAiUsageGate: mocks.gate }));
import { readHostedImageGenerationAccess } from "@/src/lib/hosted-onboarding/image-generation-access";

const prisma = {
  hostedGroupSponsorshipAuthorization: { findFirst: vi.fn() },
  hostedUsageCreditPurchase: { findFirst: vi.fn() },
};
const read = () => readHostedImageGenerationAccess({ memberId: "member_synthetic", prisma: prisma as never });
describe("image funding authority", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.hostedGroupSponsorshipAuthorization.findFirst.mockResolvedValue(null);
    prisma.hostedUsageCreditPurchase.findFirst.mockResolvedValue(null);
  });

  it("requires subscription access while Starter text usage remains available", async () => {
    mocks.gate.mockResolvedValue({ allowed: true, allowanceSource: "direct_starter" });
    await expect(read()).resolves.toEqual({ allowed: false, reason: "subscription_required" });
    expect(mocks.gate).toHaveBeenCalledExactlyOnceWith({ memberId: "member_synthetic", prisma });
    expect(prisma.hostedGroupSponsorshipAuthorization.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedUsageCreditPurchase.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ["direct_paid_member_plan", "launch_monthly"],
    ["direct_paid_member_plan", "launch_group_monthly"],
    ["direct_paid_member_plan", "launch_edge_monthly"],
    ["direct_paid_member_plan", "launch_max_monthly"],
    ["family_sponsored_plan", "launch_family_monthly"],
  ])("preserves active %s / %s image access", async (allowanceSource, billingPlanCode) => {
    mocks.gate.mockResolvedValue({ allowed: true, allowanceSource, billingPlanCode });
    await expect(read()).resolves.toEqual({ allowed: true, reason: "allowed" });
    expect(prisma.hostedGroupSponsorshipAuthorization.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedUsageCreditPurchase.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ["house allowance only", 0n],
    ["ops-granted credit only", 5_000_000n],
  ])("denies a group with %s", async (_label, usageCreditBalanceUsdMicros) => {
    mocks.gate.mockResolvedValue({
      allowed: true, allowanceSource: "thread_container", usageCreditBalanceUsdMicros,
    });
    await expect(read()).resolves.toEqual({ allowed: false, reason: "subscription_required" });
    expect(prisma.hostedGroupSponsorshipAuthorization.findFirst).toHaveBeenCalledExactlyOnceWith({
      select: { id: true },
      where: { beneficiaryMemberId: "member_synthetic", status: "active" },
    });
    expect(prisma.hostedUsageCreditPurchase.findFirst).toHaveBeenCalledExactlyOnceWith({
      select: { id: true },
      where: {
        beneficiaryMemberId: "member_synthetic",
        status: "fulfilled",
        paidAt: { not: null },
        remainingCreditUsdMicros: { gt: 0n },
      },
    });
  });

  it("allows an active group sponsorship without another purchase read", async () => {
    mocks.gate.mockResolvedValue({ allowed: true, allowanceSource: "thread_container" });
    prisma.hostedGroupSponsorshipAuthorization.findFirst.mockResolvedValue({ id: "sponsorship_synthetic" });
    await expect(read()).resolves.toEqual({ allowed: true, reason: "allowed" });
    expect(prisma.hostedGroupSponsorshipAuthorization.findFirst).toHaveBeenCalledOnce();
    expect(prisma.hostedUsageCreditPurchase.findFirst).not.toHaveBeenCalled();
  });

  it("allows remaining paid group credit without an active sponsorship", async () => {
    mocks.gate.mockResolvedValue({ allowed: true, allowanceSource: "thread_container" });
    prisma.hostedUsageCreditPurchase.findFirst.mockResolvedValue({ id: "purchase_synthetic" });
    await expect(read()).resolves.toEqual({ allowed: true, reason: "allowed" });
  });

  it("rechecks group funding after sponsorship cancellation and paid credit depletion", async () => {
    mocks.gate.mockResolvedValue({ allowed: true, allowanceSource: "thread_container" });
    prisma.hostedGroupSponsorshipAuthorization.findFirst
      .mockResolvedValueOnce({ id: "sponsorship_synthetic" });
    prisma.hostedUsageCreditPurchase.findFirst
      .mockResolvedValueOnce({ id: "purchase_synthetic" });
    await expect(read()).resolves.toEqual({ allowed: true, reason: "allowed" });
    await expect(read()).resolves.toEqual({ allowed: true, reason: "allowed" });
    await expect(read()).resolves.toEqual({ allowed: false, reason: "subscription_required" });
  });

  it.each(["hostedGroupSponsorshipAuthorization", "hostedUsageCreditPurchase"] as const)(
    "does not grant group access when %s is unavailable", async (model) => {
      mocks.gate.mockResolvedValue({ allowed: true, allowanceSource: "thread_container" });
      prisma[model].findFirst.mockRejectedValue(new Error("unavailable"));
      await expect(read()).rejects.toThrow("unavailable");
    },
  );

  it.each(["direct_starter", "direct_paid_member_plan", "family_sponsored_plan", "thread_container"])(
    "preserves inactive, suspended, and exhausted %s denials", async (allowanceSource) => {
      mocks.gate.mockResolvedValue({ allowed: false, allowanceSource });
      await expect(read()).resolves.toEqual({ allowed: false, reason: "usage_unavailable" });
      expect(prisma.hostedGroupSponsorshipAuthorization.findFirst).not.toHaveBeenCalled();
      expect(prisma.hostedUsageCreditPurchase.findFirst).not.toHaveBeenCalled();
    },
  );

  it("rechecks access after subscribing and after falling back to Starter", async () => {
    mocks.gate.mockResolvedValueOnce({ allowed: true, allowanceSource: "direct_starter" })
      .mockResolvedValueOnce({ allowed: true, allowanceSource: "direct_paid_member_plan" })
      .mockResolvedValueOnce({ allowed: true, allowanceSource: "direct_starter" });
    await expect(read()).resolves.toMatchObject({ allowed: false });
    await expect(read()).resolves.toMatchObject({ allowed: true });
    await expect(read()).resolves.toMatchObject({ allowed: false });
  });

  it("does not grant access when the canonical usage gate fails", async () => {
    mocks.gate.mockRejectedValue(new Error("unavailable"));
    await expect(read()).rejects.toThrow("unavailable");
  });
});
