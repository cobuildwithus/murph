import type { HostedMemberBillingRef } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  acceptHostedMemberStripeCheckoutCompletionTx,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  createHostedStripeCheckoutSessionLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,
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
      preparedCompletion: buildPreparedCompletion(
        "cus_winner",
        "sub_winner",
      ),
      tx: harness.tx as never,
    })).resolves.toMatchObject({
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

  it("accepts an in-flight legacy Checkout that has no persisted attempt metadata", async () => {
    const harness = await createBillingRefHarness({ openAttempt: false });

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      checkoutAttemptId: null,
      checkoutIntentHash: null,
      checkoutSessionId: "cs_legacy",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-27T12:01:00.000Z"),
      memberId: "member_123",
      preparedCompletion: buildPreparedCompletion(
        "cus_legacy",
        "sub_legacy",
      ),
      tx: harness.tx as never,
    })).resolves.toMatchObject({
      kind: "accepted",
    });
  });

  it("treats a repeated completion for the accepted subscription as idempotent", async () => {
    const harness = await createBillingRefHarness();
    const completion = {
      checkoutAttemptId: "attempt_123",
      checkoutIntentHash: "intent_123",
      checkoutSessionId: "cs_winner",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-27T12:01:00.000Z"),
      memberId: "member_123",
      preparedCompletion: buildPreparedCompletion(
        "cus_winner",
        "sub_winner",
      ),
      tx: harness.tx as never,
    };

    await expect(acceptHostedMemberStripeCheckoutCompletionTx(completion))
      .resolves.toMatchObject({ kind: "accepted" });
    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      ...completion,
      eventCreatedAt: new Date("2026-07-27T12:02:00.000Z"),
    })).resolves.toMatchObject({
      kind: "already_accepted",
    });

    expect(harness.update).toHaveBeenCalledTimes(2);
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
      preparedCompletion: buildPreparedCompletion(
        "cus_winner",
        "sub_winner",
      ),
      tx: harness.tx as never,
    });

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      checkoutAttemptId: "attempt_loser",
      checkoutIntentHash: "intent_loser",
      checkoutSessionId: "cs_loser",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-27T12:02:00.000Z"),
      memberId: "member_123",
      preparedCompletion: buildPreparedCompletion(
        "cus_winner",
        "sub_loser",
      ),
      tx: harness.tx as never,
    })).resolves.toEqual({
      kind: "cleanup_superseded",
    });

    expect(harness.update).toHaveBeenCalledOnce();
  });
});

function buildPreparedCompletion(
  stripeCustomerId: string,
  stripeSubscriptionId: string,
) {
  const stripeCustomerLookupKey =
    createHostedStripeCustomerLookupKey(stripeCustomerId);
  const stripeSubscriptionLookupKey =
    createHostedStripeSubscriptionLookupKey(stripeSubscriptionId);
  if (!stripeCustomerLookupKey || !stripeSubscriptionLookupKey) {
    throw new TypeError("Test Stripe identifiers are invalid.");
  }
  return {
    memberId: "member_123",
    stripeCustomerId,
    stripeCustomerIdEncrypted: `encrypted:${stripeCustomerId}`,
    stripeCustomerLookupKey,
    stripeSubscriptionId,
    stripeSubscriptionIdEncrypted: `encrypted:${stripeSubscriptionId}`,
    stripeSubscriptionLookupKey,
  };
}

async function createBillingRefHarness(input: {
  openAttempt?: boolean;
} = {}) {
  const openAttempt = input.openAttempt ?? true;
  const privateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId: "member_123",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  });
  const checkoutPrivateColumn =
    await buildHostedMemberBillingCheckoutSessionPrivateColumn({
      memberId: "member_123",
      stripeCheckoutSessionId: openAttempt ? "cs_winner" : null,
    });
  let state = {
    checkoutAttemptId: openAttempt ? "attempt_123" : null,
    checkoutCreatedAt: openAttempt
      ? new Date("2026-07-27T12:00:00.000Z")
      : null,
    checkoutIntentHash: openAttempt ? "intent_123" : null,
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
    stripeCheckoutSessionLookupKey: openAttempt
      ? createHostedStripeCheckoutSessionLookupKey("cs_winner")
      : null,
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
