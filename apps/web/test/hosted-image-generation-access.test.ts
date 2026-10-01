import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gate: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({ readHostedAiUsageGate: mocks.gate }));
import { readHostedImageGenerationAccess } from "@/src/lib/hosted-onboarding/image-generation-access";

const prisma = {} as never;
const read = () => readHostedImageGenerationAccess({ memberId: "member_synthetic", prisma });
describe("Starter image subscription authority", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires subscription access while Starter text usage remains available", async () => {
    mocks.gate.mockResolvedValue({ allowed: true, allowanceSource: "direct_starter" });
    await expect(read()).resolves.toEqual({ allowed: false, reason: "subscription_required" });
    expect(mocks.gate).toHaveBeenCalledExactlyOnceWith({ memberId: "member_synthetic", prisma });
  });

  it.each([
    ["direct_paid_member_plan", "launch_monthly"],
    ["direct_paid_member_plan", "launch_group_monthly"],
    ["direct_paid_member_plan", "launch_edge_monthly"],
    ["direct_paid_member_plan", "launch_max_monthly"],
    ["family_sponsored_plan", "launch_family_monthly"],
    ["thread_container", "launch_group_monthly"],
  ])("preserves active %s / %s image access", async (allowanceSource, billingPlanCode) => {
    mocks.gate.mockResolvedValue({ allowed: true, allowanceSource, billingPlanCode });
    await expect(read()).resolves.toEqual({ allowed: true, reason: "allowed" });
  });

  it.each(["direct_starter", "direct_paid_member_plan", "family_sponsored_plan", "thread_container"])(
    "preserves inactive, suspended, and exhausted %s denials", async (allowanceSource) => {
      mocks.gate.mockResolvedValue({ allowed: false, allowanceSource });
      await expect(read()).resolves.toEqual({ allowed: false, reason: "usage_unavailable" });
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
