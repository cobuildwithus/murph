import { beforeEach, expect, test, vi } from "vitest";

import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  billingRefUpdateMany: vi.fn(),
  continuePulse: vi.fn(),
  lookupBillingRef: vi.fn(),
  startPulse: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  lookupHostedMemberStripeBillingRefByStripeCustomerId: mocks.lookupBillingRef,
}));

vi.mock(
  "@/src/lib/hosted-onboarding/billing-start-paid-pulse-service",
  async (importOriginal) => {
    const actual = await importOriginal<typeof import(
      "../src/lib/hosted-onboarding/billing-start-paid-pulse-service"
    )>();
    return {
      ...actual,
      continueHostedPulseTrialPaidPlan: mocks.continuePulse,
      startHostedPulseTrialPaidPlan: mocks.startPulse,
    };
  },
);

const NOW = new Date("2026-07-25T12:00:00.000Z");
const LIVE_EXPIRY = new Date(NOW.getTime() + 10 * 60_000);
const STALE_EXPIRY = new Date(NOW.getTime() - 1);

const prisma = {
  hostedMemberBillingRef: { updateMany: mocks.billingRefUpdateMany },
} as never;

function buildPaymentMethod(): Stripe.PaymentMethod {
  return { customer: "cus_test_1", id: "pm_test_1" } as Stripe.PaymentMethod;
}

function stubIntent(intent: {
  action: string | null;
  expiresAt: Date | null;
}): void {
  mocks.lookupBillingRef.mockResolvedValue({
    billingRef: {
      memberId: "hbm_test_1",
      pulseTrialPaymentIntentAction: intent.action,
      pulseTrialPaymentIntentExpiresAt: intent.expiresAt,
      stripeCustomerId: "cus_test_1",
      stripeSubscriptionId: "sub_test_1",
    },
    core: { id: "hbm_test_1" },
    matchedBy: "stripeCustomerId",
  });
}

let recovery: typeof import(
  "../src/lib/hosted-onboarding/billing-pulse-trial-payment-method-recovery"
);

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.billingRefUpdateMany.mockResolvedValue({});
  mocks.startPulse.mockResolvedValue({ status: "started" });
  mocks.continuePulse.mockResolvedValue({ status: "continuing" });
  recovery = await import(
    "../src/lib/hosted-onboarding/billing-pulse-trial-payment-method-recovery"
  );
});

test("finishes the start-now switch the browser round trip never completed", async () => {
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });

  const result = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(result).toEqual({ memberId: "hbm_test_1" });
  expect(mocks.startPulse).toHaveBeenCalledWith({
    memberId: "hbm_test_1",
    now: NOW,
    prisma,
  });
  expect(mocks.continuePulse).not.toHaveBeenCalled();
});

test("consumes the recorded intent only after the transition lands", async () => {
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });

  await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(mocks.billingRefUpdateMany).toHaveBeenCalledWith({
    where: {
      memberId: "hbm_test_1",
      pulseTrialPaymentIntentAction: "start_pulse_now",
      pulseTrialPaymentIntentExpiresAt: LIVE_EXPIRY,
    },
    data: {
      pulseTrialPaymentIntentAction: null,
      pulseTrialPaymentIntentExpiresAt: null,
    },
  });
  expect(mocks.startPulse.mock.invocationCallOrder[0])
    .toBeLessThan(mocks.billingRefUpdateMany.mock.invocationCallOrder[0]);
});

test("keeps the intent alive when the transition throws so the webhook retry can still recover", async () => {
  // Erasing the intent on a transient failure would strand the paused member
  // this fallback exists for: the retry would find nothing and quietly complete.
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });
  mocks.startPulse.mockRejectedValueOnce(new Error("Stripe is unavailable."));

  await expect(recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  })).rejects.toThrow("Stripe is unavailable.");

  expect(mocks.billingRefUpdateMany).not.toHaveBeenCalled();
});

test("recovers on redelivery after a failed attempt, then consumes the intent once", async () => {
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });
  mocks.startPulse.mockRejectedValueOnce(new Error("Stripe is unavailable."));

  await expect(recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  })).rejects.toThrow();

  // The intent row is untouched, so the next delivery still sees it.
  const retry = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(retry).toEqual({ memberId: "hbm_test_1" });
  expect(mocks.startPulse).toHaveBeenCalledTimes(2);
  expect(mocks.billingRefUpdateMany).toHaveBeenCalledTimes(1);
});

test("keeps the receipt obligation when Stripe has no usable card yet", async () => {
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });
  mocks.startPulse.mockResolvedValueOnce({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://billing.example.test/session",
    status: "payment_required",
  });

  // Returning normally here would let the reconciler mark an unfinished
  // recovery complete and deliver a fresh portal URL to nobody.
  await expect(recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  })).rejects.toMatchObject({
    code: "HOSTED_PULSE_TRIAL_PAYMENT_METHOD_RECOVERY_PENDING",
  });

  expect(mocks.billingRefUpdateMany).not.toHaveBeenCalled();
});

test("still executes when a slow retry runs after the intent window closed", async () => {
  // The receipt retry ladder reaches ~81 minutes, well past the 30-minute
  // intent lifetime. Judging by the retry clock would silently revoke work the
  // member authorised and complete the receipt anyway.
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });

  const result = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: new Date(LIVE_EXPIRY.getTime() + 71 * 60_000),
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(result).toEqual({ memberId: "hbm_test_1" });
  expect(mocks.startPulse).toHaveBeenCalledTimes(1);
});

test("stays a terminal no-op when the card was attached after the intent window", async () => {
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });

  const result = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: new Date(LIVE_EXPIRY.getTime() + 1),
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(result).toBeNull();
  expect(mocks.startPulse).not.toHaveBeenCalled();
  expect(mocks.billingRefUpdateMany).not.toHaveBeenCalled();
});

test("does not erase a newer intent recorded after the one it acted on", async () => {
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });

  await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  // The compare-and-set names the exact observed row, so a superseding write
  // between the read and the clear survives.
  expect(mocks.billingRefUpdateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        pulseTrialPaymentIntentAction: "start_pulse_now",
        pulseTrialPaymentIntentExpiresAt: LIVE_EXPIRY,
      }),
    }),
  );
});

test.each([
  ["billing_pending"],
  ["started"],
] as const)("consumes the intent on a terminal %s result", async (status) => {
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });
  mocks.startPulse.mockResolvedValueOnce({
    billingPlanCode: "launch_monthly",
    status,
  });

  const result = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(result).toEqual({ memberId: "hbm_test_1" });
  expect(mocks.billingRefUpdateMany).toHaveBeenCalledTimes(1);
});

test("routes a continue intent to the trial-end path rather than billing now", async () => {
  stubIntent({ action: "continue_pulse", expiresAt: LIVE_EXPIRY });

  await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(mocks.continuePulse).toHaveBeenCalledTimes(1);
  expect(mocks.startPulse).not.toHaveBeenCalled();
});

test.each([
  ["no recorded intent", { action: null, expiresAt: null }],
  ["an expired intent", { action: "start_pulse_now", expiresAt: STALE_EXPIRY }],
  ["an intent with no expiry", { action: "start_pulse_now", expiresAt: null }],
  ["an unrecognised action", { action: "cancel_everything", expiresAt: LIVE_EXPIRY }],
] as const)("never charges a card attached with %s", async (_label, intent) => {
  // A card can reach a customer through unrelated flows such as a usage top-up,
  // so an attach on its own must never be read as permission to start billing.
  stubIntent(intent);

  const result = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(result).toBeNull();
  expect(mocks.startPulse).not.toHaveBeenCalled();
  expect(mocks.continuePulse).not.toHaveBeenCalled();
  expect(mocks.billingRefUpdateMany).not.toHaveBeenCalled();
});

test("ignores a payment method that maps to no Murph member", async () => {
  mocks.lookupBillingRef.mockResolvedValue(null);

  const result = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(result).toBeNull();
  expect(mocks.startPulse).not.toHaveBeenCalled();
});

test("ignores a payment method with no customer attached", async () => {
  const result = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    occurredAt: NOW,
    paymentMethod: { customer: null, id: "pm_test_1" } as Stripe.PaymentMethod,
    prisma,
  });

  expect(result).toBeNull();
  expect(mocks.lookupBillingRef).not.toHaveBeenCalled();
});
