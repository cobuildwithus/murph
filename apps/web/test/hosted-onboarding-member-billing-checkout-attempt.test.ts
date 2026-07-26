import { describe, expect, it, vi } from "vitest";

import {
  acceptHostedMemberStripeCheckoutCompletionTx,
  bindHostedMemberStripeCheckoutSessionTx,
  clearHostedMemberStripeCheckoutAttemptTx,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  createHostedStripeCheckoutSessionLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { buildHostedMemberBillingPrivateColumns } from "@/src/lib/hosted-onboarding/member-private-codecs";

describe("hosted member billing Checkout attempt store", () => {
  it("accepts an older authoritative completion and max-preserves the event watermark", async () => {
    const laterWatermark = new Date("2026-07-25T18:00:00.000Z");
    const state = makeBillingRef({
      checkoutAttemptId: "attempt_123",
      checkoutCreatedAt: new Date("2026-07-25T17:00:00.000Z"),
      checkoutIntentHash: "intent_123",
      lastStripeEventCreatedAt: laterWatermark,
      stripeCheckoutSessionLookupKey:
        createHostedStripeCheckoutSessionLookupKey("cs_123"),
    });
    const tx = createStatefulTx(state);

    const outcome = await acceptHostedMemberStripeCheckoutCompletionTx({
      allowLegacyCompletion: false,
      checkoutAttemptId: "attempt_123",
      checkoutIntentHash: "intent_123",
      checkoutSessionId: "cs_123",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-25T17:30:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      tx: tx.client,
    });

    expect(outcome).toMatchObject({
      billingRef: {
        checkoutAttemptId: null,
        checkoutIntentHash: null,
        lastStripeEventCreatedAt: laterWatermark,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
      kind: "accepted",
    });
    expect(tx.state.checkoutAttemptId).toBeNull();
    expect(tx.state.stripeCheckoutSessionLookupKey).toBeNull();
    expect(tx.state.stripeSubscriptionLookupKey).not.toBeNull();
    expect(tx.updateMany).toHaveBeenCalledOnce();
  });

  it("accepts a legacy completion only when its Session owner allows the compatibility window", async () => {
    const tx = createStatefulTx(makeBillingRef());

    const outcome = await acceptHostedMemberStripeCheckoutCompletionTx({
      allowLegacyCompletion: true,
      checkoutAttemptId: null,
      checkoutIntentHash: null,
      checkoutSessionId: "cs_legacy",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-25T17:30:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_legacy",
      stripeSubscriptionId: "sub_legacy",
      tx: tx.client,
    });

    expect(outcome).toMatchObject({
      billingRef: {
        stripeCustomerId: "cus_legacy",
        stripeSubscriptionId: "sub_legacy",
      },
      kind: "accepted",
    });
    expect(tx.state.stripeSubscriptionLookupKey).not.toBeNull();
    expect(tx.updateMany).toHaveBeenCalledOnce();
  });

  it("returns expired legacy completion for superseded cleanup without binding it", async () => {
    const tx = createStatefulTx(makeBillingRef());

    await expect(acceptHostedMemberStripeCheckoutCompletionTx({
      allowLegacyCompletion: false,
      checkoutAttemptId: null,
      checkoutIntentHash: null,
      checkoutSessionId: "cs_legacy_expired",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-25T17:30:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_legacy_expired",
      stripeSubscriptionId: "sub_legacy_expired",
      tx: tx.client,
    })).resolves.toEqual({
      kind: "cleanup_superseded",
    });
    expect(tx.state.stripeSubscriptionLookupKey).toBeNull();
    expect(tx.updateMany).not.toHaveBeenCalled();
  });

  it("does not partially clear an attempt when the acceptance CAS loses", async () => {
    const state = makeBillingRef({
      checkoutAttemptId: "attempt_newer",
      checkoutCreatedAt: new Date("2026-07-25T18:00:00.000Z"),
      checkoutIntentHash: "intent_newer",
      stripeCheckoutSessionLookupKey:
        createHostedStripeCheckoutSessionLookupKey("cs_newer"),
    });
    const tx = createStatefulTx(state, {
      updateCount: 0,
    });

    const outcome = await acceptHostedMemberStripeCheckoutCompletionTx({
      allowLegacyCompletion: false,
      checkoutAttemptId: "attempt_newer",
      checkoutIntentHash: "intent_newer",
      checkoutSessionId: "cs_newer",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-25T18:30:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_loser",
      stripeSubscriptionId: "sub_loser",
      tx: tx.client,
    });

    expect(outcome).toEqual({
      kind: "cleanup_superseded",
    });
    expect(tx.state).toMatchObject({
      checkoutAttemptId: "attempt_newer",
      checkoutIntentHash: "intent_newer",
      stripeSubscriptionLookupKey: null,
    });
  });

  it("preserves a newer Checkout attempt when an already-bound subscription completes", async () => {
    const privateColumns = await buildHostedMemberBillingPrivateColumns({
      memberId: "member_123",
      stripeCustomerId: "cus_authoritative",
      stripeSubscriptionId: "sub_authoritative",
    });
    const state = makeBillingRef({
      ...privateColumns,
      checkoutAttemptId: "attempt_newer",
      checkoutCreatedAt: new Date("2026-07-25T18:00:00.000Z"),
      checkoutIntentHash: "intent_newer",
      stripeCheckoutSessionLookupKey:
        createHostedStripeCheckoutSessionLookupKey("cs_newer"),
      stripeCustomerLookupKey:
        createHostedStripeCustomerLookupKey("cus_authoritative"),
      stripeSubscriptionLookupKey:
        createHostedStripeSubscriptionLookupKey("sub_authoritative"),
    });
    const tx = createStatefulTx(state);

    const outcome = await acceptHostedMemberStripeCheckoutCompletionTx({
      allowLegacyCompletion: false,
      checkoutAttemptId: "attempt_older",
      checkoutIntentHash: "intent_older",
      checkoutSessionId: "cs_older",
      currentCheckoutOffer: "standard",
      eventCreatedAt: new Date("2026-07-25T18:30:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_authoritative",
      stripeSubscriptionId: "sub_authoritative",
      tx: tx.client,
    });

    expect(outcome).toMatchObject({
      kind: "already_accepted",
    });
    expect(tx.state).toMatchObject({
      checkoutAttemptId: "attempt_newer",
      checkoutIntentHash: "intent_newer",
      stripeCheckoutSessionLookupKey:
        createHostedStripeCheckoutSessionLookupKey("cs_newer"),
    });
    expect(tx.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        checkoutAttemptId: null,
        stripeCheckoutSessionLookupKey: null,
      }),
    }));
  });

  it("binds and clears only the exact attempt and Session", async () => {
    const bindUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    await bindHostedMemberStripeCheckoutSessionTx({
      attemptId: "attempt_123",
      intentHash: "intent_123",
      memberId: "member_123",
      sessionId: "cs_123",
      tx: {
        hostedMemberBillingRef: {
          updateMany: bindUpdateMany,
        },
      } as never,
    });
    expect(bindUpdateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stripeCheckoutSessionIdEncrypted: expect.any(String),
        stripeCheckoutSessionLookupKey:
          createHostedStripeCheckoutSessionLookupKey("cs_123"),
      }),
      where: {
        checkoutAttemptId: "attempt_123",
        checkoutIntentHash: "intent_123",
        memberId: "member_123",
        stripeSubscriptionLookupKey: null,
      },
    });

    const clearUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    await expect(clearHostedMemberStripeCheckoutAttemptTx({
      attemptId: "attempt_stale",
      expectedSessionId: "cs_stale",
      intentHash: "intent_stale",
      memberId: "member_123",
      tx: {
        hostedMemberBillingRef: {
          updateMany: clearUpdateMany,
        },
      } as never,
    })).resolves.toBe(false);
    expect(clearUpdateMany).toHaveBeenCalledWith({
      data: {
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutIntentHash: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
      where: {
        checkoutAttemptId: "attempt_stale",
        checkoutIntentHash: "intent_stale",
        memberId: "member_123",
        stripeCheckoutSessionLookupKey: {
          in: [
            createHostedStripeCheckoutSessionLookupKey("cs_stale"),
          ],
        },
      },
    });
  });

  it("clears an exact Session written with a prior blind-index key", async () => {
    const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
    const previousCurrentVersion =
      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
    const v1 = Buffer.alloc(32, 3).toString("base64");
    const v2 = Buffer.alloc(32, 5).toString("base64");

    try {
      process.env.HOSTED_CONTACT_PRIVACY_KEYS = `v1:${v1},v2:${v2}`;
      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
      clearHostedOnboardingEnvCache();
      const priorLookupKey =
        createHostedStripeCheckoutSessionLookupKey("cs_rotated");

      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";
      clearHostedOnboardingEnvCache();
      const currentLookupKey =
        createHostedStripeCheckoutSessionLookupKey("cs_rotated");
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });

      await expect(clearHostedMemberStripeCheckoutAttemptTx({
        attemptId: "attempt_rotated",
        expectedSessionId: "cs_rotated",
        intentHash: "intent_rotated",
        memberId: "member_123",
        tx: {
          hostedMemberBillingRef: {
            updateMany,
          },
        } as never,
      })).resolves.toBe(true);

      expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          stripeCheckoutSessionLookupKey: {
            in: [currentLookupKey, priorLookupKey],
          },
        }),
      }));
    } finally {
      restoreEnv(
        "HOSTED_CONTACT_PRIVACY_KEYS",
        previousKeys,
      );
      restoreEnv(
        "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
        previousCurrentVersion,
      );
      clearHostedOnboardingEnvCache();
    }
  });
});

function createStatefulTx(
  initialState: ReturnType<typeof makeBillingRef>,
  input: {
    updateCount?: number;
  } = {},
) {
  let state = { ...initialState };
  const findUnique = vi.fn(async () => ({ ...state }));
  const findUniqueOrThrow = vi.fn(async () => ({ ...state }));
  const updateMany = vi.fn(async ({ data }: {
    data: Record<string, unknown>;
  }) => {
    const count = input.updateCount ?? 1;
    if (count === 1) {
      state = {
        ...state,
        ...data,
      };
    }
    return { count };
  });
  const client = {
    hostedMemberBillingRef: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique,
      findUniqueOrThrow,
      updateMany,
    },
  } as never;

  return {
    client,
    get state() {
      return state;
    },
    updateMany,
  };
}

function makeBillingRef(overrides: Record<string, unknown> = {}) {
  return {
    checkoutAttemptId: null,
    checkoutCreatedAt: null,
    checkoutIntentHash: null,
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
    stripeCheckoutSessionIdEncrypted: null,
    stripeCheckoutSessionLookupKey: null,
    stripeCustomerIdEncrypted: null,
    stripeCustomerLookupKey: null,
    stripeSubscriptionIdEncrypted: null,
    stripeSubscriptionLookupKey: null,
    stripeSubscriptionScheduleIdEncrypted: null,
    stripeSubscriptionScheduleLookupKey: null,
    ...overrides,
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
