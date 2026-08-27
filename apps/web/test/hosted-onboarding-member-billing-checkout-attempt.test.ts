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
      billingIdentityDisposition: "bind",
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
    expect(harness.findUnique).toHaveBeenCalledWith({
      select: {
        checkoutAttemptId: true,
        checkoutIntentHash: true,
        lastStripeEventCreatedAt: true,
        stripeCheckoutSessionLookupKey: true,
        stripeCustomerLookupKey: true,
        stripeSubscriptionLookupKey: true,
      },
      where: {
        memberId: "member_123",
      },
    });
  });

  it("accepts an in-flight legacy Checkout that has no persisted attempt metadata", async () => {
    const harness = await createBillingRefHarness({ openAttempt: false });

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      billingIdentityDisposition: "bind",
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
      billingIdentityDisposition: "bind" as const,
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

  it("keeps an accepted subscription replay out of terminal cleanup", async () => {
    const harness = await createBillingRefHarness({
      currentStripeCustomerId: "cus_winner",
      currentStripeSubscriptionId: "sub_winner",
      openAttempt: false,
    });

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      billingIdentityDisposition: "terminal",
      checkoutAttemptId: null,
      checkoutIntentHash: null,
      checkoutSessionId: "cs_winner",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-27T12:02:00.000Z"),
      memberId: "member_123",
      preparedCompletion: buildPreparedCompletion(
        "cus_winner",
        "sub_winner",
      ),
      tx: harness.tx as never,
    })).resolves.toEqual({ kind: "already_accepted" });

    expect(harness.update).not.toHaveBeenCalled();
  });

  it("keeps an unaccepted terminal Checkout owned by loser cleanup", async () => {
    const harness = await createBillingRefHarness();

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      billingIdentityDisposition: "terminal",
      checkoutAttemptId: "attempt_123",
      checkoutIntentHash: "intent_123",
      checkoutSessionId: "cs_winner",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-27T12:02:00.000Z"),
      memberId: "member_123",
      preparedCompletion: buildPreparedCompletion(
        "cus_winner",
        "sub_winner",
      ),
      tx: harness.tx as never,
    })).resolves.toEqual({ kind: "cleanup_terminal" });

    expect(harness.update).not.toHaveBeenCalled();
  });

  it("keeps a legacy unaccepted terminal Checkout owned by loser cleanup", async () => {
    const harness = await createBillingRefHarness({ openAttempt: false });

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      billingIdentityDisposition: "terminal",
      checkoutAttemptId: null,
      checkoutIntentHash: null,
      checkoutSessionId: "cs_legacy_terminal",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-27T12:02:00.000Z"),
      memberId: "member_123",
      preparedCompletion: buildPreparedCompletion(
        "cus_legacy_terminal",
        "sub_legacy_terminal",
      ),
      tx: harness.tx as never,
    })).resolves.toEqual({ kind: "cleanup_terminal" });

    expect(harness.update).not.toHaveBeenCalled();
  });

  it("does not clean up a terminal identity already owned by another member", async () => {
    const harness = await createBillingRefHarness({
      conflictingMemberId: "member_other",
    });

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      billingIdentityDisposition: "terminal",
      checkoutAttemptId: "attempt_123",
      checkoutIntentHash: "intent_123",
      checkoutSessionId: "cs_winner",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-27T12:02:00.000Z"),
      memberId: "member_123",
      preparedCompletion: buildPreparedCompletion(
        "cus_winner",
        "sub_winner",
      ),
      tx: harness.tx as never,
    })).rejects.toMatchObject({
      code: "STRIPE_BILLING_IDENTITY_CONFLICT",
      details: { violatedField: "stripeCustomerId" },
    });

    expect(harness.update).not.toHaveBeenCalled();
  });

  it("keeps the first subscription when a different Checkout completes later", async () => {
    const harness = await createBillingRefHarness();
    await acceptHostedMemberStripeCheckoutCompletionTx({
      billingIdentityDisposition: "bind",
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
      billingIdentityDisposition: "bind",
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

  it("lets an eligible Pulse Trial replace a stale identity only through its matching attempt", async () => {
    const harness = await createBillingRefHarness({
      checkoutSessionId: "cs_pulse_trial",
      currentStripeCustomerId: "cus_existing",
      currentStripeSubscriptionId: "sub_stale_incomplete",
    });

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      allowBillingIdentityReplacement: true,
      billingIdentityDisposition: "bind",
      checkoutAttemptId: "attempt_123",
      checkoutIntentHash: "intent_123",
      checkoutSessionId: "cs_pulse_trial",
      currentCheckoutOffer: "pulse_trial_7d",
      eventCreatedAt: new Date("2026-07-27T12:01:00.000Z"),
      memberId: "member_123",
      preparedCompletion: buildPreparedCompletion(
        "cus_existing",
        "sub_pulse_trial",
      ),
      tx: harness.tx as never,
    })).resolves.toMatchObject({
      kind: "accepted",
    });

    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        currentCheckoutOffer: "pulse_trial_7d",
        stripeSubscriptionLookupKey:
          createHostedStripeSubscriptionLookupKey("sub_pulse_trial"),
      }),
    }));
  });

  it("does not let Pulse Trial identity replacement bypass durable attempt ownership", async () => {
    const harness = await createBillingRefHarness({
      checkoutSessionId: "cs_current_attempt",
      currentStripeCustomerId: "cus_existing",
      currentStripeSubscriptionId: "sub_stale_incomplete",
    });

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      allowBillingIdentityReplacement: true,
      billingIdentityDisposition: "bind",
      checkoutAttemptId: "attempt_superseded",
      checkoutIntentHash: "intent_superseded",
      checkoutSessionId: "cs_superseded",
      currentCheckoutOffer: "pulse_trial_7d",
      eventCreatedAt: new Date("2026-07-27T12:01:00.000Z"),
      memberId: "member_123",
      preparedCompletion: buildPreparedCompletion(
        "cus_existing",
        "sub_pulse_trial",
      ),
      tx: harness.tx as never,
    })).resolves.toEqual({
      kind: "cleanup_superseded",
    });

    expect(harness.update).not.toHaveBeenCalled();
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
  checkoutSessionId?: string;
  conflictingMemberId?: string;
  currentStripeCustomerId?: string;
  currentStripeSubscriptionId?: string;
  openAttempt?: boolean;
} = {}) {
  const openAttempt = input.openAttempt ?? true;
  const privateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId: "member_123",
    stripeCustomerId: input.currentStripeCustomerId ?? null,
    stripeSubscriptionId: input.currentStripeSubscriptionId ?? null,
  });
  const checkoutSessionId =
    input.checkoutSessionId ?? "cs_winner";
  const checkoutPrivateColumn =
    await buildHostedMemberBillingCheckoutSessionPrivateColumn({
      memberId: "member_123",
      stripeCheckoutSessionId: openAttempt ? checkoutSessionId : null,
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
      ? createHostedStripeCheckoutSessionLookupKey(checkoutSessionId)
      : null,
    stripeCustomerLookupKey: createHostedStripeCustomerLookupKey(
      input.currentStripeCustomerId ?? null,
    ),
    stripeSubscriptionLookupKey:
      createHostedStripeSubscriptionLookupKey(
        input.currentStripeSubscriptionId ?? null,
      ),
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
  const findUnique = vi.fn().mockImplementation(async () => state);
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hostedMemberBillingRef: {
      findMany: vi.fn().mockResolvedValue(
        input.conflictingMemberId
          ? [{ memberId: input.conflictingMemberId }]
          : [],
      ),
      findUnique,
      update,
    },
  };

  return {
    tx,
    findUnique,
    update,
  };
}
