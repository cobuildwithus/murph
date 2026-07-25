import { beforeEach, expect, test, vi } from "vitest";

import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  billingRefUpdate: vi.fn(),
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
  hostedMemberBillingRef: { update: mocks.billingRefUpdate },
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
  mocks.billingRefUpdate.mockResolvedValue({});
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
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(mocks.billingRefUpdate).toHaveBeenCalledWith({
    where: { memberId: "hbm_test_1" },
    data: {
      pulseTrialPaymentIntentAction: null,
      pulseTrialPaymentIntentExpiresAt: null,
    },
  });
  expect(mocks.startPulse.mock.invocationCallOrder[0])
    .toBeLessThan(mocks.billingRefUpdate.mock.invocationCallOrder[0]);
});

test("keeps the intent alive when the transition throws so the webhook retry can still recover", async () => {
  // Erasing the intent on a transient failure would strand the paused member
  // this fallback exists for: the retry would find nothing and quietly complete.
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });
  mocks.startPulse.mockRejectedValueOnce(new Error("Stripe is unavailable."));

  await expect(recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  })).rejects.toThrow("Stripe is unavailable.");

  expect(mocks.billingRefUpdate).not.toHaveBeenCalled();
});

test("recovers on redelivery after a failed attempt, then consumes the intent once", async () => {
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });
  mocks.startPulse.mockRejectedValueOnce(new Error("Stripe is unavailable."));

  await expect(recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  })).rejects.toThrow();

  // The intent row is untouched, so the next delivery still sees it.
  const retry = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(retry).toEqual({ memberId: "hbm_test_1" });
  expect(mocks.startPulse).toHaveBeenCalledTimes(2);
  expect(mocks.billingRefUpdate).toHaveBeenCalledTimes(1);
});

test("treats payment_required as no recovery and leaves the intent for the next attach", async () => {
  stubIntent({ action: "start_pulse_now", expiresAt: LIVE_EXPIRY });
  mocks.startPulse.mockResolvedValueOnce({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://billing.example.test/session",
    status: "payment_required",
  });

  const result = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(result).toBeNull();
  expect(mocks.billingRefUpdate).not.toHaveBeenCalled();
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
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(result).toEqual({ memberId: "hbm_test_1" });
  expect(mocks.billingRefUpdate).toHaveBeenCalledTimes(1);
});

test("routes a continue intent to the trial-end path rather than billing now", async () => {
  stubIntent({ action: "continue_pulse", expiresAt: LIVE_EXPIRY });

  await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
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
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(result).toBeNull();
  expect(mocks.startPulse).not.toHaveBeenCalled();
  expect(mocks.continuePulse).not.toHaveBeenCalled();
  expect(mocks.billingRefUpdate).not.toHaveBeenCalled();
});

test("ignores a payment method that maps to no Murph member", async () => {
  mocks.lookupBillingRef.mockResolvedValue(null);

  const result = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    paymentMethod: buildPaymentMethod(),
    prisma,
  });

  expect(result).toBeNull();
  expect(mocks.startPulse).not.toHaveBeenCalled();
});

test("ignores a payment method with no customer attached", async () => {
  const result = await recovery.applyStripePulseTrialPaymentMethodAttached({
    now: NOW,
    paymentMethod: { customer: null, id: "pm_test_1" } as Stripe.PaymentMethod,
    prisma,
  });

  expect(result).toBeNull();
  expect(mocks.lookupBillingRef).not.toHaveBeenCalled();
});
