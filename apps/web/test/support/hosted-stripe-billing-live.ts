import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import Stripe from "stripe";

import {
  buildHostedBillingOfferMetadata,
} from "../../src/lib/hosted-onboarding/billing-offer-metadata";

export const HOSTED_STRIPE_BILLING_RUN_METADATA_KEY =
  "murphHostedLocalRun";
export const HOSTED_STRIPE_BILLING_SCENARIO_METADATA_KEY =
  "murphHostedLocalScenario";

const STRIPE_POLL_INTERVAL_MS = 1_000;
const STRIPE_POLL_TIMEOUT_MS = 120_000;
const STRIPE_FIXTURE_TIMEOUT_MS = 120_000;
const CLEANUP_PAGE_LIMIT = 100;
const CHECKOUT_FIXTURE_PATH = fileURLToPath(new URL(
  "../fixtures/stripe/complete-checkout-session.json",
  import.meta.url,
));

export interface HostedStripeBillingCatalog {
  accountId: string;
  portalConfigurationId: string;
  privyAppId: string;
  priceIds: {
    edge: string;
    familyEdge: string;
    familyMax: string;
    familyPulse: string;
    pulse: string;
  };
  secretKey: string;
}

export interface HostedStripeBillingSandboxInput
  extends HostedStripeBillingCatalog {
  runId: string;
}

export interface HostedStripeSubscriptionFixture {
  customerId: string;
  paymentMethodId: string;
  subscriptionId: string;
  testClockId: string | null;
}

export interface HostedStripeSubscriptionTruth {
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  customerDefaultPaymentMethodPresent: boolean;
  latestInvoicePaid: boolean;
  latestInvoiceStatus: string | null;
  pendingUpdatePresent: boolean;
  priceIds: readonly string[];
  priceQuantities: readonly { priceId: string; quantity: number }[];
  scheduleId: string | null;
  status: string;
  subscriptionDefaultPaymentMethodPresent: boolean;
  trialEndsAt: Date | null;
  trialStartedAt: Date | null;
}

export interface HostedStripeScheduleTruth {
  currentPriceIds: readonly string[];
  nextPhasePriceIds: readonly string[];
  status: string;
}

export interface HostedStripeCheckoutOwnership {
  accountGroupId?: string;
  memberId?: string;
  scenario: string;
}

export interface HostedStripeCleanupSummary {
  checkoutSessionsExpired: number;
  customersDeleted: number;
  paymentMethodsDetached: number;
  schedulesReleased: number;
  subscriptionsCanceled: number;
  testClocksDeleted: number;
}

interface TrackedStripeResources {
  checkoutSessionIds: Set<string>;
  customerIds: Set<string>;
  scheduleIds: Set<string>;
  subscriptionIds: Set<string>;
  testClockIds: Set<string>;
}

export class HostedStripeBillingSandbox {
  readonly runId: string;
  readonly stripe: Stripe;
  readonly accountId: string;
  readonly portalConfigurationId: string;
  readonly privyAppId: string;
  readonly priceIds: HostedStripeBillingCatalog["priceIds"];

  private readonly secretKey: string;
  private readonly tracked: TrackedStripeResources = {
    checkoutSessionIds: new Set(),
    customerIds: new Set(),
    scheduleIds: new Set(),
    subscriptionIds: new Set(),
    testClockIds: new Set(),
  };

  constructor(input: HostedStripeBillingSandboxInput) {
    this.runId = input.runId;
    this.accountId = input.accountId;
    this.portalConfigurationId = input.portalConfigurationId;
    this.privyAppId = input.privyAppId;
    this.priceIds = { ...input.priceIds };
    this.secretKey = input.secretKey;
    this.stripe = new Stripe(input.secretKey, {
      maxNetworkRetries: 2,
      timeout: 30_000,
    });
  }

  buildHostedLocalEnvironment(): {
    additionalEnv: NodeJS.ProcessEnv;
    webProcessEnvOverrides: NodeJS.ProcessEnv;
  } {
    return {
      additionalEnv: {
        NODE_ENV: process.env.NODE_ENV,
        NEXT_PUBLIC_PRIVY_APP_ID: this.privyAppId,
        HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_EDGE_MONTHLY:
          this.portalConfigurationId,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY:
          this.priceIds.edge,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY:
          this.priceIds.familyEdge,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY:
          this.priceIds.familyMax,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY:
          this.priceIds.familyPulse,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY:
          this.priceIds.pulse,
        MURPH_DEV_SKIP_STRIPE_LISTEN: "0",
        // The live configuration secret is present only in the Vitest process.
        // Blank it before the full-stack harness derives any child environment.
        MURPH_HOSTED_STRIPE_BILLING_SECRET_KEY: "",
        STRIPE_API_KEY: this.secretKey,
        STRIPE_SECRET_KEY: "",
      },
      webProcessEnvOverrides: {
        NODE_ENV: process.env.NODE_ENV,
        NEXT_PUBLIC_PRIVY_APP_ID: this.privyAppId,
        STRIPE_SECRET_KEY: this.secretKey,
      },
    };
  }

  async assertCatalogContract(): Promise<void> {
    const account = await this.callStripe("account.retrieve", () =>
      this.stripe.accounts.retrieve(this.accountId)
    );
    if (account.id !== this.accountId) {
      throw new HostedStripeBillingLiveError(
        "Stripe sandbox account does not match the configured account contract.",
      );
    }

    const [pulsePrice, edgePrice] = await Promise.all([
      this.assertRecurringPrice({
        expectedAmount: 800,
        label: "Pulse",
        priceId: this.priceIds.pulse,
      }),
      this.assertRecurringPrice({
        expectedAmount: 2_000,
        label: "Edge",
        priceId: this.priceIds.edge,
      }),
    ]);
    if (coerceStripeId(pulsePrice.product) === coerceStripeId(edgePrice.product)) {
      throw new HostedStripeBillingLiveError(
        "Stripe sandbox Pulse and Edge prices must belong to distinct products.",
      );
    }
    await Promise.all([
      this.assertRecurringPrice({
        expectedAmount: 700,
        label: "Family Pulse seat",
        priceId: this.priceIds.familyPulse,
      }),
      this.assertRecurringPrice({
        expectedAmount: 1_900,
        label: "Family Edge seat",
        priceId: this.priceIds.familyEdge,
      }),
      this.assertRecurringPrice({
        expectedAmount: 4_900,
        label: "Family Max seat",
        priceId: this.priceIds.familyMax,
      }),
    ]);

    const configuration = await this.callStripe(
      "billing_portal.configuration.retrieve",
      () => this.stripe.billingPortal.configurations.retrieve(
        this.portalConfigurationId,
      ),
    );
    const subscriptionUpdate = configuration.features.subscription_update;
    if (
      !configuration.active
      || !configuration.is_default
      || !subscriptionUpdate.enabled
      || subscriptionUpdate.proration_behavior !== "always_invoice"
    ) {
      throw new HostedStripeBillingLiveError(
        "Stripe Portal configuration must be the active default and immediately invoice paid plan updates.",
      );
    }
  }

  async createPaidSubscription(input: {
    memberId: string;
    plan: "edge" | "pulse";
    scenario: string;
  }): Promise<HostedStripeSubscriptionFixture> {
    const customer = await this.createCustomer({ scenario: input.scenario });
    const paymentMethod = await this.callStripe("payment_method.attach", () =>
      this.stripe.paymentMethods.attach("pm_card_visa", {
        customer: customer.id,
      })
    );
    await this.callStripe("customer.update.default_payment_method", () =>
      this.stripe.customers.update(customer.id, {
        invoice_settings: {
          default_payment_method: paymentMethod.id,
        },
      })
    );
    const priceId = input.plan === "edge"
      ? this.priceIds.edge
      : this.priceIds.pulse;
    const subscription = await this.callStripe("subscription.create.paid", () =>
      this.stripe.subscriptions.create({
        customer: customer.id,
        default_payment_method: paymentMethod.id,
        expand: ["customer", "items.data.price", "latest_invoice"],
        items: [{ price: priceId }],
        metadata: this.memberBillingMetadata({
          memberId: input.memberId,
          plan: input.plan,
          scenario: input.scenario,
        }),
        payment_behavior: "error_if_incomplete",
        payment_settings: {
          save_default_payment_method: "on_subscription",
        },
      })
    );
    this.trackSubscription(subscription);
    return {
      customerId: customer.id,
      paymentMethodId: paymentMethod.id,
      subscriptionId: subscription.id,
      testClockId: null,
    };
  }

  async adoptCheckoutSession(
    sessionId: string,
    ownership: HostedStripeCheckoutOwnership,
  ): Promise<Stripe.Checkout.Session> {
    const session = await this.callStripe("checkout_session.retrieve", () =>
      this.stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["customer", "subscription"],
      })
    );
    assertCheckoutOwnership(session, ownership);
    this.tracked.checkoutSessionIds.add(session.id);
    await this.callStripe("checkout_session.update.metadata", () =>
      this.stripe.checkout.sessions.update(session.id, {
        metadata: this.metadata(ownership.scenario),
      })
    );

    const customerId = coerceStripeId(session.customer);
    if (customerId) {
      await this.adoptCustomer(customerId, ownership.scenario);
    }
    const subscriptionId = coerceStripeId(session.subscription);
    if (subscriptionId) {
      await this.adoptSubscription(subscriptionId, ownership.scenario);
    }
    return session;
  }

  async waitForCheckoutCompletion(input: {
    ownership: HostedStripeCheckoutOwnership;
    sessionId: string;
  }): Promise<Stripe.Checkout.Session> {
    const completed = await this.pollStripe({
      label: "Checkout Session complete",
      read: () => this.callStripe("checkout_session.retrieve.complete", () =>
        this.stripe.checkout.sessions.retrieve(input.sessionId, {
          expand: ["customer", "subscription"],
        })
      ),
      ready: (session) => session.status === "complete",
    });
    assertCheckoutOwnership(completed, input.ownership);
    await this.adoptCheckoutSession(completed.id, input.ownership);
    return completed;
  }

  async completeCheckoutSessionWithOfficialFixture(input: {
    expectedAmount: number;
    ownership: HostedStripeCheckoutOwnership;
    sessionId: string;
  }): Promise<Stripe.Checkout.Session> {
    if (!Number.isSafeInteger(input.expectedAmount) || input.expectedAmount < 0) {
      throw new HostedStripeBillingLiveError(
        "Stripe Checkout fixture expected amount must be a non-negative integer.",
      );
    }
    const session = await this.adoptCheckoutSession(
      input.sessionId,
      input.ownership,
    );
    if (
      session.livemode
      || session.mode !== "subscription"
      || session.status !== "open"
      || session.amount_total !== input.expectedAmount
    ) {
      throw new HostedStripeBillingLiveError(
        "Official Stripe fixture requires the expected owned open test-mode subscription Checkout Session.",
      );
    }

    await runOfficialStripeCheckoutFixture({
      expectedAmount: input.expectedAmount,
      runId: this.runId,
      scenario: input.ownership.scenario,
      secretKey: this.secretKey,
      sessionId: session.id,
      sourceEnv: process.env,
    });
    return this.waitForCheckoutCompletion({
      ownership: input.ownership,
      sessionId: session.id,
    });
  }

  async applyStripePortalPlanChange(input: {
    scenario: string;
    subscriptionId: string;
    targetPlan: "edge" | "pulse";
  }): Promise<Stripe.Subscription> {
    const subscription = await this.callStripe(
      "subscription.retrieve.portal_fixture",
      () => this.stripe.subscriptions.retrieve(input.subscriptionId, {
        expand: ["items.data.price", "latest_invoice"],
      }),
    );
    assertRunOwnership(subscription.metadata, this.runId, "Subscription");
    if (subscription.items.data.length !== 1) {
      throw new HostedStripeBillingLiveError(
        "Stripe Portal plan fixture requires one owned individual Subscription item.",
      );
    }
    const item = subscription.items.data[0];
    if (!item) {
      throw new HostedStripeBillingLiveError(
        "Stripe Portal plan fixture could not resolve the Subscription item.",
      );
    }
    const updated = await this.callStripe("subscription.update.portal_fixture", () =>
      this.stripe.subscriptions.update(subscription.id, {
        expand: ["items.data.price", "latest_invoice", "schedule"],
        items: [{
          id: item.id,
          price: input.targetPlan === "edge"
            ? this.priceIds.edge
            : this.priceIds.pulse,
          quantity: 1,
        }],
        metadata: this.metadata(input.scenario),
        payment_behavior: "error_if_incomplete",
        proration_behavior: "always_invoice",
      })
    );
    this.trackSubscription(updated);
    return updated;
  }

  async readSubscriptionTruth(
    subscriptionId: string,
  ): Promise<HostedStripeSubscriptionTruth> {
    const subscription = await this.callStripe("subscription.retrieve.truth", () =>
      this.stripe.subscriptions.retrieve(subscriptionId, {
        expand: [
          "customer",
          "items.data.price",
          "latest_invoice",
          "latest_invoice.payment_intent",
          "schedule",
        ],
      })
    );
    const invoice = readExpandedInvoice(subscription.latest_invoice);
    const periodEnds = subscription.items.data
      .map((item) => readStripeUnixSecond(item, "current_period_end"))
      .filter((value): value is number => value !== null);
    const periodStarts = subscription.items.data
      .map((item) => readStripeUnixSecond(item, "current_period_start"))
      .filter((value): value is number => value !== null);
    const priceQuantities = subscription.items.data.flatMap((item) => {
      const priceId = coerceStripeId(item.price);
      return priceId
        ? [{ priceId, quantity: item.quantity ?? 1 }]
        : [];
    }).sort((left, right) => left.priceId.localeCompare(right.priceId));
    return {
      currentPeriodEnd: periodEnds.length > 0
        ? new Date(Math.max(...periodEnds) * 1_000)
        : null,
      currentPeriodStart: periodStarts.length > 0
        ? new Date(Math.min(...periodStarts) * 1_000)
        : null,
      customerDefaultPaymentMethodPresent:
        readExpandedCustomerDefaultPaymentMethod(subscription) !== null,
      latestInvoicePaid: invoice?.status === "paid",
      latestInvoiceStatus: invoice?.status ?? null,
      pendingUpdatePresent: subscription.pending_update !== null,
      priceIds: priceQuantities.map((entry) => entry.priceId),
      priceQuantities,
      scheduleId: coerceStripeId(subscription.schedule),
      status: subscription.status,
      subscriptionDefaultPaymentMethodPresent:
        coerceStripeId(subscription.default_payment_method) !== null
        || coerceStripeId(subscription.default_source) !== null,
      trialEndsAt: typeof subscription.trial_end === "number"
        ? new Date(subscription.trial_end * 1_000)
        : null,
      trialStartedAt: typeof subscription.trial_start === "number"
        ? new Date(subscription.trial_start * 1_000)
        : null,
    };
  }

  async waitForSubscriptionTruth(input: {
    label: string;
    ready: (truth: HostedStripeSubscriptionTruth) => boolean;
    subscriptionId: string;
    timeoutMs?: number;
  }): Promise<HostedStripeSubscriptionTruth> {
    return this.pollStripe({
      label: input.label,
      read: () => this.readSubscriptionTruth(input.subscriptionId),
      ready: input.ready,
      timeoutMs: input.timeoutMs,
    });
  }

  async readScheduleTruth(scheduleId: string): Promise<HostedStripeScheduleTruth> {
    const schedule = await this.callStripe("subscription_schedule.retrieve.truth", () =>
      this.stripe.subscriptionSchedules.retrieve(scheduleId, {
        expand: ["phases.items.price"],
      })
    );
    const phases = schedule.phases ?? [];
    return {
      currentPriceIds: readSchedulePhasePriceIds(phases[0]),
      nextPhasePriceIds: readSchedulePhasePriceIds(phases[1]),
      status: schedule.status,
    };
  }

  async waitForScheduleTruth(input: {
    label: string;
    ready: (truth: HostedStripeScheduleTruth) => boolean;
    scheduleId: string;
    timeoutMs?: number;
  }): Promise<HostedStripeScheduleTruth> {
    return this.pollStripe({
      label: input.label,
      read: () => this.readScheduleTruth(input.scheduleId),
      ready: input.ready,
      timeoutMs: input.timeoutMs,
    });
  }

  async adoptSubscriptionSchedule(
    scheduleId: string,
    scenario: string,
  ): Promise<void> {
    const schedule = await this.callStripe("subscription_schedule.retrieve.adopt", () =>
      this.stripe.subscriptionSchedules.retrieve(scheduleId, {
        expand: ["subscription"],
      })
    );
    const subscriptionId = coerceStripeId(schedule.subscription);
    if (!subscriptionId || !this.tracked.subscriptionIds.has(subscriptionId)) {
      throw new HostedStripeBillingLiveError(
        "Refused to adopt a Stripe Subscription Schedule without an owned Subscription.",
      );
    }
    const subscription = await this.callStripe("subscription.retrieve.schedule_owner", () =>
      this.stripe.subscriptions.retrieve(subscriptionId)
    );
    assertRunOwnership(subscription.metadata, this.runId, "Subscription");
    await this.callStripe("subscription_schedule.update.adopt", () =>
      this.stripe.subscriptionSchedules.update(schedule.id, {
        metadata: this.metadata(scenario),
      })
    );
    this.tracked.scheduleIds.add(schedule.id);
  }

  async cleanup(): Promise<HostedStripeCleanupSummary> {
    return cleanupTrackedStripeResources({
      runId: this.runId,
      stripe: this.stripe,
      tracked: this.tracked,
    });
  }

  private metadata(scenario: string): Stripe.MetadataParam {
    return {
      [HOSTED_STRIPE_BILLING_RUN_METADATA_KEY]: this.runId,
      [HOSTED_STRIPE_BILLING_SCENARIO_METADATA_KEY]: scenario,
    };
  }

  private memberBillingMetadata(input: {
    memberId: string;
    plan: "edge" | "pulse";
    scenario: string;
  }): Stripe.MetadataParam {
    return {
      ...buildHostedBillingOfferMetadata({
        billingPlanCode: input.plan === "edge"
          ? "launch_edge_monthly"
          : "launch_monthly",
        memberId: input.memberId,
      }),
      ...this.metadata(input.scenario),
    };
  }

  private async createCustomer(input: {
    scenario: string;
    testClockId?: string;
  }): Promise<Stripe.Customer> {
    const customer = await this.callStripe("customer.create", () =>
      this.stripe.customers.create({
        metadata: this.metadata(input.scenario),
        ...(input.testClockId ? { test_clock: input.testClockId } : {}),
      })
    );
    this.tracked.customerIds.add(customer.id);
    return customer;
  }

  private async adoptCustomer(customerId: string, scenario: string): Promise<void> {
    const customer = await this.callStripe("customer.retrieve.adopt", () =>
      this.stripe.customers.retrieve(customerId)
    );
    if (customer.deleted) {
      throw new HostedStripeBillingLiveError(
        "Checkout returned a deleted Stripe Customer.",
      );
    }
    await this.callStripe("customer.update.adopt", () =>
      this.stripe.customers.update(customer.id, {
        metadata: this.metadata(scenario),
      })
    );
    this.tracked.customerIds.add(customer.id);
  }

  private async adoptSubscription(
    subscriptionId: string,
    scenario: string,
  ): Promise<void> {
    const subscription = await this.callStripe("subscription.retrieve.adopt", () =>
      this.stripe.subscriptions.retrieve(subscriptionId)
    );
    const updated = await this.callStripe("subscription.update.adopt", () =>
      this.stripe.subscriptions.update(subscription.id, {
        metadata: this.metadata(scenario),
        expand: ["schedule"],
      })
    );
    this.trackSubscription(updated);
  }

  private trackSubscription(subscription: Stripe.Subscription): void {
    this.tracked.subscriptionIds.add(subscription.id);
    const customerId = coerceStripeId(subscription.customer);
    if (customerId) {
      this.tracked.customerIds.add(customerId);
    }
    const scheduleId = coerceStripeId(subscription.schedule);
    if (scheduleId) {
      this.tracked.scheduleIds.add(scheduleId);
    }
  }

  private async assertRecurringPrice(input: {
    expectedAmount: number;
    label: string;
    priceId: string;
  }): Promise<Stripe.Price> {
    const price = await this.callStripe("price.retrieve.preflight", () =>
      this.stripe.prices.retrieve(input.priceId)
    );
    if (
      !price.active
      || price.currency !== "usd"
      || price.livemode
      || price.recurring?.interval !== "month"
      || price.type !== "recurring"
      || price.unit_amount !== input.expectedAmount
    ) {
      throw new HostedStripeBillingLiveError(
        `${input.label} Stripe price does not match the pre-provisioned monthly USD test contract.`,
      );
    }
    return price;
  }

  private async pollStripe<T>(input: {
    label: string;
    read: () => Promise<T>;
    ready: (value: T) => boolean;
    timeoutMs?: number;
  }): Promise<T> {
    const deadline = Date.now() + (input.timeoutMs ?? STRIPE_POLL_TIMEOUT_MS);
    let lastValue = await input.read();
    while (!input.ready(lastValue) && Date.now() < deadline) {
      await delay(STRIPE_POLL_INTERVAL_MS);
      lastValue = await input.read();
    }
    if (!input.ready(lastValue)) {
      throw new HostedStripeBillingLiveError(
        `Timed out waiting for Stripe state: ${input.label}.`,
      );
    }
    return lastValue;
  }

  private async callStripe<T>(
    operation: string,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw new HostedStripeBillingLiveError(
        `Stripe operation ${operation} failed (${formatStripeErrorDetails(
          readStripeErrorDetails(error),
        )}).`,
      );
    }
  }
}

export function buildStripeFixtureChildEnvironmentForTest(input: {
  expectedAmount: number;
  runId: string;
  scenario: string;
  secretKey: string;
  sessionId: string;
  sourceEnv: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const inheritedKeys = [
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "TMPDIR",
  ] as const;
  return {
    ...Object.fromEntries(inheritedKeys.flatMap((key) => {
      const value = input.sourceEnv[key];
      return value === undefined ? [] : [[key, value]];
    })),
    NODE_ENV: input.sourceEnv.NODE_ENV,
    MURPH_HOSTED_STRIPE_FIXTURE_EXPECTED_AMOUNT: String(input.expectedAmount),
    MURPH_HOSTED_STRIPE_FIXTURE_RUN_ID: input.runId,
    MURPH_HOSTED_STRIPE_FIXTURE_SCENARIO: input.scenario,
    MURPH_HOSTED_STRIPE_FIXTURE_SESSION_ID: input.sessionId,
    STRIPE_API_KEY: input.secretKey,
  };
}

async function runOfficialStripeCheckoutFixture(input: {
  expectedAmount: number;
  runId: string;
  scenario: string;
  secretKey: string;
  sessionId: string;
  sourceEnv: NodeJS.ProcessEnv;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("stripe", ["fixtures", CHECKOUT_FIXTURE_PATH], {
      env: buildStripeFixtureChildEnvironmentForTest(input),
      shell: false,
      stdio: "ignore",
    });
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, STRIPE_FIXTURE_TIMEOUT_MS);
    child.once("error", () => {
      globalThis.clearTimeout(timeout);
      reject(new HostedStripeBillingLiveError(
        "Official Stripe Checkout fixture could not start.",
      ));
    });
    child.once("exit", (code, signal) => {
      globalThis.clearTimeout(timeout);
      if (!timedOut && signal === null && code === 0) {
        resolve();
        return;
      }
      reject(new HostedStripeBillingLiveError(
        timedOut
          ? "Official Stripe Checkout fixture timed out."
          : "Official Stripe Checkout fixture failed.",
      ));
    });
  });
}

export class HostedStripeBillingLiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedStripeBillingLiveError";
  }
}

export function sanitizeHostedStripeBillingLiveFailure(
  error: unknown,
  operation: string,
): HostedStripeBillingLiveError {
  if (error instanceof HostedStripeBillingLiveError) {
    return error;
  }
  return new HostedStripeBillingLiveError(
    `Stripe operation ${operation} failed (${formatStripeErrorDetails(
      readStripeErrorDetails(error),
    )}).`,
  );
}

export function buildHostedStripeRunCorrelationToken(runId: string): string {
  return createHash("sha256").update(runId).digest("hex").slice(0, 12);
}

export function metadataCorrelatesHostedStripeRun(
  metadata: Stripe.Metadata | null,
  runId: string,
): boolean {
  if (ownsRun(metadata, runId)) {
    return true;
  }
  const token = buildHostedStripeRunCorrelationToken(runId);
  return Object.values(metadata ?? {}).some(
    (value) => typeof value === "string" && value.includes(token),
  );
}

export async function cleanupHostedStripeBillingRun(input: {
  runId: string;
  secretKey: string;
}): Promise<HostedStripeCleanupSummary> {
  const stripe = new Stripe(input.secretKey, {
    maxNetworkRetries: 2,
    timeout: 30_000,
  });
  const tracked: TrackedStripeResources = {
    checkoutSessionIds: new Set(),
    customerIds: new Set(),
    scheduleIds: new Set(),
    subscriptionIds: new Set(),
    testClockIds: new Set(),
  };
  const recoveryMetadata: Stripe.MetadataParam = {
    [HOSTED_STRIPE_BILLING_RUN_METADATA_KEY]: input.runId,
    [HOSTED_STRIPE_BILLING_SCENARIO_METADATA_KEY]: "bounded-cleanup-recovery",
  };

  const [sessions, subscriptions, customers, schedules, clocks] =
    await Promise.all([
      stripe.checkout.sessions.list({ limit: CLEANUP_PAGE_LIMIT }),
      stripe.subscriptions.list({ limit: CLEANUP_PAGE_LIMIT, status: "all" }),
      stripe.customers.list({ limit: CLEANUP_PAGE_LIMIT }),
      stripe.subscriptionSchedules.list({ limit: CLEANUP_PAGE_LIMIT }),
      stripe.testHelpers.testClocks.list({ limit: CLEANUP_PAGE_LIMIT }),
    ]);

  const adoptCustomer = async (customerId: string): Promise<void> => {
    if (tracked.customerIds.has(customerId)) {
      return;
    }
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return;
    }
    await stripe.customers.update(customer.id, { metadata: recoveryMetadata });
    tracked.customerIds.add(customer.id);
  };
  const adoptSubscription = async (subscriptionId: string): Promise<void> => {
    if (tracked.subscriptionIds.has(subscriptionId)) {
      return;
    }
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["schedule"],
    });
    const customerId = coerceStripeId(subscription.customer);
    if (customerId) {
      await adoptCustomer(customerId);
    }

    if (ownsRun(subscription.metadata, input.runId)) {
      tracked.subscriptionIds.add(subscription.id);
    } else if (subscription.status !== "canceled") {
      await stripe.subscriptions.update(subscription.id, {
        metadata: recoveryMetadata,
      });
      tracked.subscriptionIds.add(subscription.id);
    }

    const scheduleId = coerceStripeId(subscription.schedule);
    if (scheduleId) {
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      if (ownsRun(schedule.metadata, input.runId)) {
        tracked.scheduleIds.add(schedule.id);
      } else if (schedule.status === "active" || schedule.status === "not_started") {
        await stripe.subscriptionSchedules.update(schedule.id, {
          metadata: recoveryMetadata,
        });
        tracked.scheduleIds.add(schedule.id);
      }
    }
  };

  for (const session of sessions.data) {
    if (!metadataCorrelatesHostedStripeRun(session.metadata, input.runId)) {
      continue;
    }
    await stripe.checkout.sessions.update(session.id, {
      metadata: recoveryMetadata,
    });
    tracked.checkoutSessionIds.add(session.id);
    const customerId = coerceStripeId(session.customer);
    if (customerId) {
      await adoptCustomer(customerId);
    }
    const subscriptionId = coerceStripeId(session.subscription);
    if (subscriptionId) {
      await adoptSubscription(subscriptionId);
    }
  }
  for (const subscription of subscriptions.data) {
    if (metadataCorrelatesHostedStripeRun(subscription.metadata, input.runId)) {
      await adoptSubscription(subscription.id);
    }
  }
  for (const customer of customers.data) {
    if (metadataCorrelatesHostedStripeRun(customer.metadata, input.runId)) {
      await adoptCustomer(customer.id);
    }
  }
  for (const schedule of schedules.data) {
    if (!metadataCorrelatesHostedStripeRun(schedule.metadata, input.runId)) {
      continue;
    }
    if (ownsRun(schedule.metadata, input.runId)) {
      tracked.scheduleIds.add(schedule.id);
    } else if (schedule.status === "active" || schedule.status === "not_started") {
      await stripe.subscriptionSchedules.update(schedule.id, {
        metadata: recoveryMetadata,
      });
      tracked.scheduleIds.add(schedule.id);
    }
  }
  const clockNamePrefix = `murph-${buildHostedStripeRunCorrelationToken(input.runId)}-`;
  for (const clock of clocks.data) {
    if (clock.name?.startsWith(clockNamePrefix)) {
      tracked.testClockIds.add(clock.id);
    }
  }

  return cleanupTrackedStripeResources({
    runId: input.runId,
    stripe,
    tracked,
  });
}

async function cleanupTrackedStripeResources(input: {
  runId: string;
  stripe: Stripe;
  tracked: TrackedStripeResources;
}): Promise<HostedStripeCleanupSummary> {
  const summary: HostedStripeCleanupSummary = {
    checkoutSessionsExpired: 0,
    customersDeleted: 0,
    paymentMethodsDetached: 0,
    schedulesReleased: 0,
    subscriptionsCanceled: 0,
    testClocksDeleted: 0,
  };

  const runPaymentMethods = await input.stripe.paymentMethods.list({
    limit: CLEANUP_PAGE_LIMIT,
    type: "card",
  });
  for (const paymentMethod of runPaymentMethods.data) {
    if (!ownsRun(paymentMethod.metadata, input.runId)) {
      continue;
    }
    assertRunOwnership(paymentMethod.metadata, input.runId, "PaymentMethod");
    if (coerceStripeId(paymentMethod.customer)) {
      await ignoreMissingStripeResource(async () => {
        await input.stripe.paymentMethods.detach(paymentMethod.id);
        summary.paymentMethodsDetached += 1;
      });
    }
  }

  for (const sessionId of input.tracked.checkoutSessionIds) {
    await ignoreMissingStripeResource(async () => {
      const session = await input.stripe.checkout.sessions.retrieve(sessionId);
      assertRunOwnership(session.metadata, input.runId, "Checkout Session");
      if (session.status === "open") {
        await input.stripe.checkout.sessions.expire(session.id);
        summary.checkoutSessionsExpired += 1;
      }
    });
  }

  for (const scheduleId of input.tracked.scheduleIds) {
    await ignoreMissingStripeResource(async () => {
      const schedule = await input.stripe.subscriptionSchedules.retrieve(scheduleId);
      assertRunOwnership(schedule.metadata, input.runId, "Subscription Schedule");
      if (schedule.status === "active" || schedule.status === "not_started") {
        await input.stripe.subscriptionSchedules.release(schedule.id);
        summary.schedulesReleased += 1;
      }
    });
  }

  for (const subscriptionId of input.tracked.subscriptionIds) {
    await ignoreMissingStripeResource(async () => {
      const subscription = await input.stripe.subscriptions.retrieve(subscriptionId);
      assertRunOwnership(subscription.metadata, input.runId, "Subscription");
      if (subscription.status !== "canceled") {
        await input.stripe.subscriptions.cancel(subscription.id);
        summary.subscriptionsCanceled += 1;
      }
    });
  }

  for (const customerId of input.tracked.customerIds) {
    await ignoreMissingStripeResource(async () => {
      const customer = await input.stripe.customers.retrieve(customerId);
      if (customer.deleted) {
        return;
      }
      assertRunOwnership(customer.metadata, input.runId, "Customer");
      await input.stripe.customers.del(customer.id);
      summary.customersDeleted += 1;
    });
  }

  for (const testClockId of input.tracked.testClockIds) {
    await ignoreMissingStripeResource(async () => {
      const clock = await input.stripe.testHelpers.testClocks.retrieve(testClockId);
      if (!clock.name?.startsWith(
        `murph-${buildHostedStripeRunCorrelationToken(input.runId)}-`,
      )) {
        throw new HostedStripeBillingLiveError(
          "Refused to delete a Stripe Test Clock not owned by this run.",
        );
      }
      if (clock.status === "ready") {
        await input.stripe.testHelpers.testClocks.del(clock.id);
        summary.testClocksDeleted += 1;
      }
    });
  }

  return summary;
}

function assertCheckoutOwnership(
  session: Stripe.Checkout.Session,
  ownership: HostedStripeCheckoutOwnership,
): void {
  const memberMatches = ownership.memberId === undefined
    || session.metadata?.memberId === ownership.memberId;
  const groupMatches = ownership.accountGroupId === undefined
    || session.metadata?.accountGroupId === ownership.accountGroupId;
  if (!memberMatches || !groupMatches) {
    throw new HostedStripeBillingLiveError(
      "Stripe Checkout Session metadata does not match the expected Murph owner.",
    );
  }
}

function assertRunOwnership(
  metadata: Stripe.Metadata | null,
  runId: string,
  objectType: string,
): void {
  if (!ownsRun(metadata, runId)) {
    throw new HostedStripeBillingLiveError(
      `Refused to clean up a ${objectType} not owned by this run.`,
    );
  }
}

function ownsRun(metadata: Stripe.Metadata | null, runId: string): boolean {
  return metadata?.[HOSTED_STRIPE_BILLING_RUN_METADATA_KEY] === runId;
}

async function ignoreMissingStripeResource(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const details = readStripeErrorDetails(error);
    if (details.statusCode === 404 || details.code === "resource_missing") {
      return;
    }
    if (error instanceof HostedStripeBillingLiveError) {
      throw error;
    }
    throw new HostedStripeBillingLiveError(
      `Stripe cleanup failed (${formatStripeErrorDetails(details)}).`,
    );
  }
}

function readExpandedCustomerDefaultPaymentMethod(
  subscription: Stripe.Subscription,
): string | null {
  const customer = subscription.customer;
  if (
    !customer
    || typeof customer !== "object"
    || customer.object !== "customer"
    || customer.deleted
  ) {
    return null;
  }
  return coerceStripeId(customer.invoice_settings.default_payment_method)
    ?? coerceStripeId(customer.default_source);
}

function readExpandedInvoice(
  invoice: Stripe.Subscription["latest_invoice"],
): Stripe.Invoice | null {
  return invoice && typeof invoice === "object" && invoice.object === "invoice"
    ? invoice
    : null;
}

function readSchedulePhasePriceIds(
  phase: Stripe.SubscriptionSchedule["phases"][number] | undefined,
): readonly string[] {
  if (!phase) {
    return [];
  }
  return phase.items
    .map((item) => coerceStripeId(item.price))
    .filter((value): value is string => value !== null)
    .sort();
}

function readStripeUnixSecond(
  value: object,
  field: "current_period_end" | "current_period_start",
): number | null {
  const candidate = Reflect.get(value, field);
  return typeof candidate === "number" && Number.isSafeInteger(candidate)
    ? candidate
    : null;
}

function coerceStripeId(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (
    value
    && typeof value === "object"
    && typeof Reflect.get(value, "id") === "string"
  ) {
    return Reflect.get(value, "id").trim() || null;
  }
  return null;
}

interface StripeErrorDetails {
  code: string | null;
  param: string | null;
  statusCode: number | null;
  type: string | null;
}

function readStripeErrorDetails(error: unknown): StripeErrorDetails {
  if (!error || typeof error !== "object") {
    return { code: null, param: null, statusCode: null, type: null };
  }
  return {
    code: typeof Reflect.get(error, "code") === "string"
      ? Reflect.get(error, "code")
      : null,
    param: typeof Reflect.get(error, "param") === "string"
      ? Reflect.get(error, "param")
      : null,
    statusCode: typeof Reflect.get(error, "statusCode") === "number"
      ? Reflect.get(error, "statusCode")
      : null,
    type: typeof Reflect.get(error, "type") === "string"
      ? Reflect.get(error, "type")
      : null,
  };
}

function formatStripeErrorDetails(details: StripeErrorDetails): string {
  return [
    details.type ? `type=${details.type}` : null,
    details.code ? `code=${details.code}` : null,
    details.param ? `param=${details.param}` : null,
    details.statusCode ? `status=${details.statusCode}` : null,
  ].filter((value): value is string => value !== null).join(", ") || "provider error";
}
