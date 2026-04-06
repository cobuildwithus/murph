import { HostedBillingCheckoutStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  completeHostedBillingAttemptBySessionId,
  expireHostedBillingAttemptBySessionId,
  failHostedBillingAttemptById,
} from "@/src/lib/hosted-onboarding/billing-attempts";

describe("hosted-onboarding billing-attempts", () => {
  it("clears checkout urls when a billing attempt fails", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      hostedBillingCheckout: {
        updateMany,
      },
    } as never;

    await failHostedBillingAttemptById({
      checkoutId: "checkout_123",
      prisma,
      statuses: [HostedBillingCheckoutStatus.open],
      stripeCheckoutSessionId: "cs_123",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "checkout_123",
        status: {
          in: [HostedBillingCheckoutStatus.open],
        },
      },
      data: {
        checkoutUrl: null,
        status: HostedBillingCheckoutStatus.failed,
        stripeCheckoutSessionId: "cs_123",
      },
    });
  });

  it("clears checkout urls when a billing attempt completes", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      hostedBillingCheckout: {
        updateMany,
      },
    } as never;

    await completeHostedBillingAttemptBySessionId({
      amountTotal: 500,
      completedAt: new Date("2026-04-06T10:00:00.000Z"),
      currency: "usd",
      prisma,
      stripeCheckoutSessionId: "cs_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        stripeCheckoutSessionId: "cs_123",
      },
      data: {
        amountTotal: 500,
        checkoutUrl: null,
        completedAt: new Date("2026-04-06T10:00:00.000Z"),
        currency: "usd",
        status: HostedBillingCheckoutStatus.completed,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    });
  });

  it("clears checkout urls when a billing attempt expires", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      hostedBillingCheckout: {
        updateMany,
      },
    } as never;

    await expireHostedBillingAttemptBySessionId({
      expiredAt: new Date("2026-04-06T10:00:00.000Z"),
      prisma,
      stripeCheckoutSessionId: "cs_123",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        stripeCheckoutSessionId: "cs_123",
        status: HostedBillingCheckoutStatus.open,
      },
      data: {
        checkoutUrl: null,
        expiredAt: new Date("2026-04-06T10:00:00.000Z"),
        status: HostedBillingCheckoutStatus.expired,
      },
    });
  });
});
