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

test("clears the recorded intent before charging so a redelivery cannot double-bill", async () => {
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
  expect(mocks.billingRefUpdate.mock.invocationCallOrder[0])
    .toBeLessThan(mocks.startPulse.mock.invocationCallOrder[0]);
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
