import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), prisma: {} }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/src/lib/hosted-onboarding/stripe-event-reconciliation", () => ({
  reconcileHostedStripeEventById: mocks.reconcile,
}));

import { processHostedStripeWebhookEventStep } from "@/src/lib/hosted-onboarding/stripe-webhook-workflow-steps";
import { hostedStripeWebhookReconciliationWorkflow } from "@/src/lib/hosted-onboarding/stripe-webhook-workflows";

beforeEach(() => vi.resetAllMocks());

describe("Stripe pointer execution transport", () => {
  it.each(["completed", "failed"])("leaves %s receipt retry policy with the receipt", async (status) => {
    mocks.reconcile.mockResolvedValue({ eventId: "evt_fixture", status });
    await hostedStripeWebhookReconciliationWorkflow({ eventId: "evt_fixture" });
    expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith({ eventId: "evt_fixture", prisma: mocks.prisma });
    expect(processHostedStripeWebhookEventStep).toHaveProperty("maxRetries", 0);
  });

  it("does not journal private provider errors or add another retry policy", async () => {
    mocks.reconcile.mockRejectedValue(new Error("private provider response"));
    await expect(processHostedStripeWebhookEventStep({ eventId: "evt_fixture" }))
      .rejects.toMatchObject({ message: "Stripe receipt attempt could not run." });
    expect(mocks.reconcile).toHaveBeenCalledOnce();
  });
});
