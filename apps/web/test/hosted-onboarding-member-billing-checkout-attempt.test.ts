import type { HostedMemberBillingRef } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  acceptHostedMemberStripeCheckoutCompletionTx,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  createHostedStripeCheckoutSessionLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedMemberBillingCheckoutSessionPrivateColumn,
  buildHostedMemberBillingPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";

describe("hosted member Checkout completion ownership", () => {
  it("binds the matching first completion and clears its open attempt", async () => {
    const harness = await createBillingRefHarness();

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      checkoutAttemptId: "attempt_123",
      checkoutIntentHash: "intent_123",
      checkoutSessionId: "cs_winner",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-27T12:01:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_winner",
      stripeSubscriptionId: "sub_winner",
      tx: harness.tx as never,
    })).resolves.toMatchObject({
      billingRef: {
        checkoutAttemptId: null,
        checkoutIntentHash: null,
        stripeCheckoutSessionId: null,
        stripeCustomerId: "cus_winner",
        stripeSubscriptionId: "sub_winner",
      },
      kind: "accepted",
    });

    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutIntentHash: null,
        currentCheckoutOffer: "standard",
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      }),
      where: {
        memberId: "member_123",
      },
    }));
  });

  it("keeps the first subscription when a different Checkout completes later", async () => {
    const harness = await createBillingRefHarness();
    await acceptHostedMemberStripeCheckoutCompletionTx({
      checkoutAttemptId: "attempt_123",
      checkoutIntentHash: "intent_123",
      checkoutSessionId: "cs_winner",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-27T12:01:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_winner",
      stripeSubscriptionId: "sub_winner",
      tx: harness.tx as never,
    });

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      checkoutAttemptId: "attempt_loser",
      checkoutIntentHash: "intent_loser",
      checkoutSessionId: "cs_loser",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-27T12:02:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_winner",
      stripeSubscriptionId: "sub_loser",
      tx: harness.tx as never,
    })).resolves.toEqual({
      kind: "cleanup_superseded",
    });

    expect(harness.update).toHaveBeenCalledOnce();
  });
});

async function createBillingRefHarness() {
  const privateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId: "member_123",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  });
  const checkoutPrivateColumn =
    await buildHostedMemberBillingCheckoutSessionPrivateColumn({
      memberId: "member_123",
      stripeCheckoutSessionId: "cs_winner",
    });
  let state = {
    checkoutAttemptId: "attempt_123",
    checkoutCreatedAt: new Date("2026-07-27T12:00:00.000Z"),
    checkoutIntentHash: "intent_123",
    currentBillingPhase: null,
    currentBillingPlanCode: null,
    currentCheckoutOffer: null,
    currentPeriodEnd: null,
    currentPeriodStart: null,
    currentTrialEndsAt: null,
    currentTrialStartedAt: null,
    lastStripeEventCreatedAt: null,
    memberId: "member_123",
    pulseTrialPolicyVersion: null,
    pulseTrialRedeemedAt: null,
    scheduledBillingEffectiveAt: null,
    scheduledBillingPlanCode: null,
    stripeCheckoutSessionLookupKey:
      createHostedStripeCheckoutSessionLookupKey("cs_winner"),
    stripeCustomerLookupKey: null,
    stripeSubscriptionLookupKey: null,
    stripeSubscriptionScheduleLookupKey: null,
    ...checkoutPrivateColumn,
    ...privateColumns,
  } as unknown as HostedMemberBillingRef;
  const update = vi.fn().mockImplementation(async (input: {
    data: Partial<HostedMemberBillingRef>;
  }) => {
    state = {
      ...state,
      ...input.data,
    };
    return state;
  });
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hostedMemberBillingRef: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockImplementation(async () => state),
      update,
    },
  };

  return {
    tx,
    update,
  };
}
