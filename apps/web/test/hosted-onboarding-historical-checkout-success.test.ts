import type { HostedMemberBillingRef } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  createHostedStripeCheckoutSessionLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({
  core: { id: "member_history", billingStatus: "active", suspendedAt: null },
  prepare: vi.fn(),
  welcome: vi.fn(),
  email: vi.fn(),
  stripe: {
    checkout: { sessions: { retrieve: vi.fn() } },
    subscriptions: { retrieve: vi.fn(), cancel: vi.fn() },
    invoices: { list: vi.fn() },
    invoicePayments: { list: vi.fn() },
    refunds: { list: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({ requireHostedStripeApi: () => mocks.stripe }));
vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  requireHostedInviteForAuthentication: async () => ({ memberId: mocks.core.id }),
  getHostedInviteStatus: async () => ({ stage: "active" }),
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async (original) => ({
  ...await original<object>(),
  readHostedMemberCoreState: async () => mocks.core,
  upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx: mocks.email,
}));
vi.mock("@/src/lib/hosted-onboarding/family-plan", async (original) => ({
  ...await original<object>(),
  readHostedMemberFamilyBillingClaim: async () => null,
}));
vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", async (original) => ({
  ...await original<object>(),
  listHostedStripeCheckoutSessionMemberIds: async () => [mocks.core.id],
}));
vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", async (original) => ({
  ...await original<object>(),
  prepareHostedStripeCheckoutCompletion: mocks.prepare,
}));
vi.mock("@/src/lib/hosted-onboarding/signup-welcome-email", () => ({
  sendHostedSignupWelcomeEmailForMemberBestEffort: mocks.welcome,
}));


import { reconcileHostedBillingCheckoutSuccess } from "@/src/lib/hosted-onboarding/billing-success-service";

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.core.billingStatus = "active";
  mocks.stripe.refunds.list.mockResolvedValue({ data: [], has_more: false });
  mocks.stripe.refunds.create.mockResolvedValue({ amount: 2_000, status: "succeeded" });
  // Every subscription, including the historical paid one, has an ordinary
  // refundable invoice. A wrong loser classification therefore really refunds.
  mocks.stripe.invoices.list.mockResolvedValue({ data: [{
    id: "in_paid", amount_paid: 2_000, amount_due: 2_000, amount_remaining: 0,
    starting_balance: 0, pre_payment_credit_notes_amount: 0,
    post_payment_credit_notes_amount: 0, status: "paid",
  }], has_more: false });
  mocks.stripe.invoicePayments.list.mockResolvedValue({ data: [{
    amount_paid: 2_000, amount_requested: 2_000,
    payment: { type: "payment_intent", payment_intent: {
      id: "pi_paid", amount_received: 2_000, status: "succeeded",
    } },
  }], has_more: false });
});

it.each([false, true])("preserves paid historical browser replays through two replacements (legacy predecessor: %s)", async (legacy) => {
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v1:${Buffer.alloc(32, 41).toString("base64")}`);
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v1");
  const harness = createHarness();
  await harness.complete("sub_first", null);
  expect(harness.receipts.size).toBe(1);
  if (legacy) harness.receipts.clear(); // Canonical acceptance predates receipt deployment.
  await harness.complete("sub_second", "sub_first");
  await harness.replay("sub_first");
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v1:${Buffer.alloc(32, 41).toString("base64")},v2:${Buffer.alloc(32, 42).toString("base64")}`);
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
  await harness.complete("sub_third", "sub_second");
  await harness.replay("sub_first");
  await harness.replay("sub_second");
  expect(harness.receipts.size).toBe(3);
  expect(mocks.stripe.refunds.create).not.toHaveBeenCalled();
  expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
  expect(mocks.stripe.invoices.list).not.toHaveBeenCalled();
});

it("still retries genuine terminal loser refunds without recording acceptance", async () => {
  const harness = createHarness();
  await harness.complete("sub_winner", null);
  mocks.stripe.refunds.create.mockRejectedValueOnce(new Error("temporary refund outage"));
  await expect(harness.run("sub_loser", "canceled", null)).rejects.toThrow("temporary refund outage");
  await harness.run("sub_loser", "canceled", null);
  expect(mocks.stripe.refunds.create).toHaveBeenCalledTimes(2);
  expect(mocks.stripe.refunds.create.mock.calls[0]).toEqual(mocks.stripe.refunds.create.mock.calls[1]);
  expect(harness.receipts.size).toBe(1);
  expect(harness.state.stripeSubscriptionLookupKey).toBe(createHostedStripeSubscriptionLookupKey("sub_winner"));
});

function createHarness() {
  let state: Partial<HostedMemberBillingRef> = {
    memberId: mocks.core.id, stripeSubscriptionLookupKey: null,
    stripeCustomerLookupKey: createHostedStripeCustomerLookupKey("cus_history"),
    checkoutAttemptId: null, checkoutIntentHash: null, stripeCheckoutSessionLookupKey: null,
    lastStripeEventCreatedAt: null,
  };
  const receipts = new Map<string, object>();
  const update = vi.fn(async ({ data }: { data: Partial<HostedMemberBillingRef> }) => {
    state = { ...state, ...data };
    return state;
  });
  const tx = {
    $queryRaw: vi.fn(async () => []),
    hostedMember: { findUnique: async () => mocks.core },
    hostedMemberBillingRef: {
      findUnique: async () => state, findMany: async () => [], update,
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    hostedMemberAcceptedSubscription: {
      findFirst: async ({ where }: { where: { memberId: string; stripeSubscriptionLookupKey: { in: string[] } } }) =>
        where.memberId === mocks.core.id ? where.stripeSubscriptionLookupKey.in.map((key) => receipts.get(key)).find(Boolean) ?? null : null,
      upsert: async ({ create }: { create: { stripeSubscriptionLookupKey: string } }) => {
        receipts.set(create.stripeSubscriptionLookupKey, create);
        return create;
      },
    },
  };
  const prisma = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
  async function run(id: string, status: string, replaces: string | null, historical = false) {
    const subscription = { id, status, customer: "cus_history", metadata: {} };
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(subscription);
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: `cs_${id}`, status: "complete", customer: "cus_history", subscription,
      client_reference_id: mocks.core.id, created: 1_800_000_000,
      metadata: { memberId: mocks.core.id, checkoutAttemptId: `attempt_${id}`,
        checkoutIntentHash: `intent_${id}`, ...(replaces ? { replacesSubscriptionId: replaces } : {}) },
    });
    mocks.prepare.mockResolvedValue({
      memberId: mocks.core.id, canonicalSubscription: subscription,
      stripeCheckoutEmail: historical ? { syntheticPreparedEmail: true } : null,
      billingCompletion: {
        memberId: mocks.core.id, stripeCustomerId: "cus_history",
        stripeCustomerLookupKey: createHostedStripeCustomerLookupKey("cus_history"),
        stripeCustomerIdEncrypted: "encrypted:customer",
        stripeSubscriptionId: id, stripeSubscriptionLookupKey: createHostedStripeSubscriptionLookupKey(id),
        stripeSubscriptionIdEncrypted: `encrypted:${id}`,
      },
    });
    return reconcileHostedBillingCheckoutSuccess({
      inviteCode: "current-invite", member: mocks.core as never, prisma: prisma as never, sessionId: `cs_${id}`,
    });
  }
  return {
    receipts, run, get state() { return state; },
    async complete(id: string, replaces: string | null) {
      mocks.core.billingStatus = replaces ? "canceled" : "not_started";
      state = { ...state, checkoutAttemptId: `attempt_${id}`, checkoutIntentHash: `intent_${id}`,
        stripeCheckoutSessionLookupKey: createHostedStripeCheckoutSessionLookupKey(`cs_${id}`) };
      await run(id, "active", replaces);
      // Invoice projection has granted the replacement entitlement and watermark.
      mocks.core.billingStatus = "active";
      state = { ...state, currentBillingPlanCode: "edge", currentBillingPhase: "active",
        lastStripeEventCreatedAt: new Date("2026-11-08T12:00:00Z") };
    },
    async replay(id: string) {
      const before = { ...state };
      const writes = update.mock.calls.length;
      const welcomes = mocks.welcome.mock.calls.length;
      await run(id, "canceled", null, true);
      // A stale nonterminal completion must be a no-op too.
      await run(id, "active", null, true);
      expect(state).toEqual(before);
      expect(update).toHaveBeenCalledTimes(writes);
      expect(mocks.welcome).toHaveBeenCalledTimes(welcomes);
      expect(mocks.email).not.toHaveBeenCalled();
      expect(mocks.core.billingStatus).toBe("active");
    },
  };
}
