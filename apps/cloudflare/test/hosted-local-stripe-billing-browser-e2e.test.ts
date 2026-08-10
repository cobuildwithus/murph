import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  HostedBillingBrowserDriver,
  HostedStripeBillingSandbox,
  issueHostedWebInviteForTest,
  readHostedBillingProjectionForTest,
  readHostedFamilyProjectionForTest,
  seedHostedBillingMemberForTest,
  seedHostedLaunchConsentForTest,
  waitForHostedBillingProjectionForTest,
  waitForHostedFamilyProjectionForTest,
  type HostedAppSessionForTest,
  type HostedBillingBrowserActor,
  type HostedBillingProjectionForTest,
  type HostedBillingRefSeedForTest,
  type HostedStripeSubscriptionFixture,
  type HostedStripeSubscriptionTruth,
} from "#hosted-web-testing";
import {
  removeHostedStripeBillingLiveEnvironment,
  resolveHostedStripeBillingLiveConfig,
} from "@murphai/hosted-local-harness/stripe-billing-live-config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const liveConfigResolution = resolveHostedStripeBillingLiveConfig(process.env);
const runId = liveConfigResolution.configured
  ? liveConfigResolution.config.runId
  : `billing_${randomUUID().replaceAll("-", "")}`;
const runToken = createHash("sha256").update(runId).digest("hex").slice(0, 12);
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const diagnosticsPath = `${repoRoot}/apps/web/playwright-report/hosted-stripe-billing/redacted.json`;

let browserDriver: HostedBillingBrowserDriver | null = null;
let sandbox: HostedStripeBillingSandbox | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
const actors = new Set<HostedBillingBrowserActor>();

describe("hosted-local Stripe billing browser matrix", () => {
  beforeAll(async () => {
    if (!liveConfigResolution.configured) {
      throw new Error(
        "The hosted-local Stripe billing browser matrix requires the dedicated live sandbox contract.",
      );
    }

    sandbox = new HostedStripeBillingSandbox({
      ...liveConfigResolution.config,
      runId,
    });
    removeHostedStripeBillingLiveEnvironment();
    await sandbox.assertCatalogContract();
    const hostedEnvironment = sandbox.buildHostedLocalEnvironment();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        ...hostedEnvironment.additionalEnv,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        MURPH_DEV_TEMPORAL: "disabled",
        MURPH_DEV_WEB_HOST: "localhost",
        MURPH_HOSTED_LOCAL_E2E_STRIPE_LISTENER: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-stripe-billing-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Hosted-local Stripe billing browser matrix",
      streamLogs: streamDevLogs,
      webProcessEnvOverrides: hostedEnvironment.webProcessEnvOverrides,
    });
    assertHostedStripeListenerAlive();
    browserDriver = new HostedBillingBrowserDriver({
      diagnosticsPath,
      runId,
      webBaseUrl: requireScenario().harness.webBaseUrl,
    });
    await browserDriver.start({
      headless: process.env.MURPH_E2E_BILLING_HEADLESS !== "0",
    });
  }, 600_000);

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    for (const actor of actors) {
      await actor.close().catch((error) => cleanupErrors.push(error));
    }
    actors.clear();
    await browserDriver?.close().catch((error) => cleanupErrors.push(error));
    browserDriver = null;
    await scenario?.stop().catch((error) => cleanupErrors.push(error));
    scenario = null;
    await sandbox?.cleanup().catch((error) => cleanupErrors.push(error));
    sandbox = null;
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Hosted Stripe billing cleanup failed.");
    }
  }, 300_000);

  it("starts a new-member Pulse Trial through Checkout", async () => {
    await proveNewMemberPulseTrialCheckout();
  }, 300_000);

  it("converts a Pulse Trial to paid Pulse after invoice reconciliation", async () => {
    await proveTrialStartsPaidPulseAfterInvoiceReconciliation();
  }, 300_000);

  it("updates the payment method before resuming a paused Pulse Trial", async () => {
    await provePausedTrialUpdateBeforeResumeIncidentRegression();
  }, 300_000);

  it("upgrades a Pulse Trial to Edge through the Portal boundary", async () => {
    await proveTrialUpgradesToEdgeThroughPortal();
  }, 300_000);

  it("upgrades paid Pulse to Edge through the Portal boundary", async () => {
    await provePaidPulseUpgradesToEdgeThroughPortal();
  }, 300_000);

  it("schedules an Edge to Pulse downgrade at renewal", async () => {
    await proveEdgeSchedulesPulseAtRenewal();
  }, 300_000);

  it("starts Family through Checkout and activates an invited member", async () => {
    const family = await proveIndividualStartsFamilyThroughCheckout();
    await proveFamilyInviteActivation(family);
  }, 450_000);

  it("converts paid individual billing to Family in place", async () => {
    await provePaidIndividualConvertsToFamilyInPlace();
  }, 300_000);
});

async function proveNewMemberPulseTrialCheckout(): Promise<void> {
  const member = await createMember("trial_checkout");
  const invite = await issueHostedWebInviteForTest({
    environment: requireScenario().runtimeEnv,
    memberId: member.memberId,
  });
  const actor = await createActor(member.session);
  try {
    const checkout = await requireDriver().beginPulseTrialCheckout(
      actor,
      invite.inviteCode,
    );
    await requireDriver().assertStripeCheckoutReady(actor);
    assertHostedStripeListenerAlive();
    const completed = await requireSandbox().completeCheckoutSessionWithOfficialFixture({
      expectedAmount: 0,
      ownership: {
        memberId: member.memberId,
        scenario: "trial-checkout",
      },
      sessionId: checkout.sessionId,
    });
    const subscriptionId = requireStripeObjectId(completed.subscription, "Subscription");
    const stripeTruth = await requireSandbox().waitForSubscriptionTruth({
      label: "new-member Pulse Trial subscription",
      ready: (truth) =>
        truth.status === "trialing"
        && truth.priceIds.includes(requireSandbox().priceIds.pulse),
      subscriptionId,
    });
    expect(stripeTruth.trialStartedAt).not.toBeNull();
    expect(stripeTruth.trialEndsAt).not.toBeNull();

    const projection = await waitForHostedBillingProjectionForTest({
      environment: requireScenario().runtimeEnv,
      label: "new-member Pulse Trial webhook projection",
      memberId: member.memberId,
      ready: (candidate) =>
        candidate.billingStatus === "active"
        && candidate.currentBillingPhase === "trial"
        && candidate.currentBillingPlanCode === "launch_monthly"
        && candidate.currentCheckoutOffer === "pulse_trial_7d"
        && candidate.stripeSubscriptionId === subscriptionId,
    });
    expect(projection.currentTrialEndsAt).not.toBeNull();
    await requireDriver().assertSettingsPlanState(actor, {
      planName: "Pulse",
      stateLabel: "Free trial",
    });
  } finally {
    await closeActor(actor);
  }
}

async function proveTrialStartsPaidPulseAfterInvoiceReconciliation(): Promise<void> {
  const member = await createMember("trial_to_paid");
  const fixture = await requireSandbox().createTrialSubscription({
    memberId: member.memberId,
    paymentMethod: "pm_card_threeDSecure2Required",
    scenario: "trial-to-paid-pulse",
  });
  await bindDirectFixture(member.memberId, fixture, "trial", "launch_monthly");
  const actor = await createActor(member.session);
  try {
    assertHostedStripeListenerAlive();
    const result = await requireDriver().startPaidPulse(actor);
    const beforeInvoice = await readHostedBillingProjectionForTest({
      environment: requireScenario().runtimeEnv,
      memberId: member.memberId,
    });
    expect(beforeInvoice.currentBillingPhase).not.toBe("paid");
    expect(result.paymentUrlPresent).toBe(true);
    await requireDriver().assertStripeHostedInvoiceReady(actor);
    assertHostedStripeListenerAlive();
    await requireSandbox().payLatestInvoiceWithStripeTestApi({
      scenario: "trial-to-paid-pulse",
      subscriptionId: fixture.subscriptionId,
    });

    await requireSandbox().waitForSubscriptionTruth({
      label: "trial converted to paid Pulse",
      ready: (truth) =>
        truth.status === "active"
        && truth.latestInvoicePaid
        && truth.priceIds.includes(requireSandbox().priceIds.pulse),
      subscriptionId: fixture.subscriptionId,
    });
    await waitForPaidMemberProjection(member.memberId, "launch_monthly");
    await requireDriver().assertSettingsPlanState(actor, {
      planName: "Pulse",
      stateLabel: "Current plan",
    });
  } finally {
    await closeActor(actor);
  }
}

async function provePausedTrialUpdateBeforeResumeIncidentRegression(): Promise<void> {
  const member = await createMember("paused_trial_resume");
  const fixture = await requireSandbox().createPausedTrialWithCustomerPaymentMethod({
    memberId: member.memberId,
    scenario: "paused-trial-resume",
  });
  await bindDirectFixture(member.memberId, fixture, "trial", "launch_monthly", "paused");
  await requireSandbox().assertUnsupportedResumePaymentMethodRejected({
    paymentMethodId: fixture.paymentMethodId,
    subscriptionId: fixture.subscriptionId,
  });
  const baselineEventIds = await requireSandbox().captureSubscriptionEventBaseline(
    fixture.subscriptionId,
  );
  const actor = await createActor(member.session);
  try {
    assertHostedStripeListenerAlive();
    const result = await requireDriver().startPaidPulse(actor);
    expect(result.paymentUrlPresent).toBe(true);
    await requireDriver().assertStripeHostedInvoiceReady(actor);
    const trace = await requireSandbox().waitForUpdateBeforeResumeTrace({
      baselineEventIds,
      paymentMethodId: fixture.paymentMethodId,
      subscriptionId: fixture.subscriptionId,
    });
    expect(trace.updateBeforeResume).toBe(true);
    assertHostedStripeListenerAlive();
    await requireSandbox().payLatestInvoiceWithStripeTestApi({
      paymentMethodId: fixture.paymentMethodId,
      scenario: "paused-trial-resume",
      subscriptionId: fixture.subscriptionId,
    });
    const truth = await requireSandbox().waitForSubscriptionTruth({
      label: "paused Pulse Trial resumed and invoiced",
      ready: (candidate) =>
        candidate.status === "active"
        && candidate.subscriptionDefaultPaymentMethodPresent
        && candidate.latestInvoicePaid,
      subscriptionId: fixture.subscriptionId,
    });
    expect(truth.customerDefaultPaymentMethodPresent).toBe(true);
    await waitForPaidMemberProjection(member.memberId, "launch_monthly");
    await requireDriver().assertSettingsPlanState(actor, {
      planName: "Pulse",
      stateLabel: "Current plan",
    });
  } finally {
    await closeActor(actor);
  }
}

async function proveTrialUpgradesToEdgeThroughPortal(): Promise<void> {
  const member = await createMember("trial_to_edge");
  const fixture = await requireSandbox().createTrialSubscription({
    memberId: member.memberId,
    paymentMethod: "pm_card_visa",
    scenario: "trial-to-edge",
  });
  await bindDirectFixture(member.memberId, fixture, "trial", "launch_monthly");
  const actor = await createActor(member.session);
  try {
    await requireDriver().openEdgeFromTrialPortal(actor);
    assertHostedStripeListenerAlive();
    await requireSandbox().applyStripePortalPlanChange({
      endTrial: true,
      scenario: "trial-to-edge",
      subscriptionId: fixture.subscriptionId,
      targetPlan: "edge",
    });
    await waitForPaidEdgeTruthAndProjection(member.memberId, fixture.subscriptionId);
    await requireDriver().assertSettingsPlanState(actor, {
      planName: "Edge",
      stateLabel: "Current plan",
    });
  } finally {
    await closeActor(actor);
  }
}

async function provePaidPulseUpgradesToEdgeThroughPortal(): Promise<void> {
  const member = await createMember("paid_pulse_to_edge");
  const fixture = await requireSandbox().createPaidSubscription({
    memberId: member.memberId,
    plan: "pulse",
    scenario: "paid-pulse-to-edge",
  });
  await bindDirectFixture(member.memberId, fixture, "paid", "launch_monthly");
  const actor = await createActor(member.session);
  try {
    await requireDriver().openPaidPulseEdgeConfirmation(actor);
    assertHostedStripeListenerAlive();
    await requireSandbox().applyStripePortalPlanChange({
      endTrial: false,
      scenario: "paid-pulse-to-edge",
      subscriptionId: fixture.subscriptionId,
      targetPlan: "edge",
    });
    await waitForPaidEdgeTruthAndProjection(member.memberId, fixture.subscriptionId);
    await requireDriver().assertSettingsPlanState(actor, {
      planName: "Edge",
      stateLabel: "Current plan",
    });
  } finally {
    await closeActor(actor);
  }
}

async function proveEdgeSchedulesPulseAtRenewal(): Promise<void> {
  const member = await createMember("edge_to_pulse_schedule");
  const fixture = await requireSandbox().createPaidSubscription({
    memberId: member.memberId,
    plan: "edge",
    scenario: "edge-to-pulse-schedule",
  });
  await bindDirectFixture(member.memberId, fixture, "paid", "launch_edge_monthly");
  const actor = await createActor(member.session);
  try {
    assertHostedStripeListenerAlive();
    await requireDriver().schedulePulseAtRenewal(actor);
    const projection = await waitForHostedBillingProjectionForTest({
      environment: requireScenario().runtimeEnv,
      label: "scheduled Edge to Pulse local projection",
      memberId: member.memberId,
      ready: (candidate) =>
        candidate.currentBillingPlanCode === "launch_edge_monthly"
        && candidate.scheduledBillingPlanCode === "launch_monthly"
        && candidate.scheduledBillingEffectiveAt !== null
        && candidate.stripeSubscriptionScheduleId !== null,
    });
    const scheduleId = requireNonEmpty(
      projection.stripeSubscriptionScheduleId,
      "local Subscription Schedule",
    );
    await requireSandbox().adoptSubscriptionSchedule(
      scheduleId,
      "edge-to-pulse-schedule",
    );
    const scheduleTruth = await requireSandbox().waitForScheduleTruth({
      label: "Stripe Edge to Pulse renewal schedule",
      ready: (truth) =>
        truth.status === "active"
        && truth.currentPriceIds.includes(requireSandbox().priceIds.edge)
        && truth.nextPhasePriceIds.includes(requireSandbox().priceIds.pulse),
      scheduleId,
    });
    expect(scheduleTruth.currentPriceIds.includes(requireSandbox().priceIds.edge)).toBe(true);
    const subscriptionTruth = await requireSandbox().readSubscriptionTruth(
      fixture.subscriptionId,
    );
    expect(subscriptionTruth.priceIds.includes(requireSandbox().priceIds.edge)).toBe(true);
    expect(subscriptionTruth.priceIds.includes(requireSandbox().priceIds.pulse)).toBe(false);
    await requireDriver().assertSettingsPlanState(actor, {
      planName: "Edge",
      stateLabel: "Current plan",
    });
    await requireDriver().assertSettingsText(actor, /Pulse starts/iu);
    await requireDriver().assertSettingsText(actor, /Edge stays active until then/iu);
  } finally {
    await closeActor(actor);
  }
}

async function proveIndividualStartsFamilyThroughCheckout(): Promise<{
  actor: HostedBillingBrowserActor;
  ownerMemberId: string;
  subscriptionId: string;
}> {
  const owner = await createMember("lapsed_to_family_checkout", "canceled");
  const actor = await createActor(owner.session);
  const checkout = await requireDriver().beginFamilyCheckout(actor);
  const pendingFamily = await waitForHostedFamilyProjectionForTest({
    environment: requireScenario().runtimeEnv,
    label: "Family Checkout owner projection",
    memberId: owner.memberId,
    ready: (projection) => projection.groupId !== null,
  });
  const groupId = requireNonEmpty(pendingFamily.groupId, "Family group");
  await requireDriver().assertStripeCheckoutReady(actor);
  assertHostedStripeListenerAlive();
  const completed = await requireSandbox().completeCheckoutSessionWithOfficialFixture({
    expectedAmount: 1_400,
    ownership: {
      accountGroupId: groupId,
      scenario: "individual-to-family-checkout",
    },
    sessionId: checkout.sessionId,
  });
  const subscriptionId = requireStripeObjectId(completed.subscription, "Subscription");
  const stripeTruth = await requireSandbox().waitForSubscriptionTruth({
    label: "Family Checkout subscription",
    ready: (truth) =>
      truth.status === "active"
      && truth.priceQuantities.some((entry) =>
        entry.priceId === requireSandbox().priceIds.familyPulse
        && entry.quantity === 2
      ),
    subscriptionId,
  });
  expect(stripeTruth.latestInvoicePaid).toBe(true);
  const family = await waitForHostedFamilyProjectionForTest({
    environment: requireScenario().runtimeEnv,
    label: "reconciled Family owner projection",
    memberId: owner.memberId,
    ready: (projection) =>
      projection.billingActive
      && projection.billingStatus === "active"
      && projection.currentBillingPlanCode === "launch_family_monthly"
      && projection.billedSeatCount === 2
      && projection.stripeSubscriptionId === subscriptionId,
  });
  expect(family.seats?.billed).toBe(2);
  expect(family.seats?.active).toBe(1);
  await requireDriver().assertSettingsPlanState(actor, {
    planName: "Family",
    stateLabel: "Current plan",
  });
  return { actor, ownerMemberId: owner.memberId, subscriptionId };
}

async function provePaidIndividualConvertsToFamilyInPlace(): Promise<void> {
  const owner = await createMember("paid_individual_to_family");
  const fixture = await requireSandbox().createPaidSubscription({
    memberId: owner.memberId,
    plan: "pulse",
    scenario: "paid-individual-to-family",
  });
  await bindDirectFixture(owner.memberId, fixture, "paid", "launch_monthly");
  const actor = await createActor(owner.session);
  try {
    assertHostedStripeListenerAlive();
    await requireDriver().convertPaidIndividualToFamily(actor);
    const family = await waitForHostedFamilyProjectionForTest({
      environment: requireScenario().runtimeEnv,
      label: "paid individual converted to Family in place",
      memberId: owner.memberId,
      ready: (projection) =>
        projection.billingActive
        && projection.billingStatus === "active"
        && projection.currentBillingPhase === "paid"
        && projection.currentBillingPlanCode === "launch_family_monthly"
        && projection.billedSeatCount === 2
        && projection.stripeSubscriptionId === fixture.subscriptionId,
    });
    expect(family.seats?.billed).toBe(2);
    expect(family.seats?.active).toBe(1);

    const stripeTruth = await requireSandbox().waitForSubscriptionTruth({
      label: "in-place paid individual to Family subscription",
      ready: (truth) =>
        truth.status === "active"
        && truth.latestInvoicePaid
        && truth.priceQuantities.some((entry) =>
          entry.priceId === requireSandbox().priceIds.familyPulse
          && entry.quantity === 2
        )
        && !truth.priceIds.includes(requireSandbox().priceIds.pulse),
      subscriptionId: fixture.subscriptionId,
    });
    expect(stripeTruth.scheduleId).toBeNull();
    await requireDriver().assertSettingsPlanState(actor, {
      planName: "Family",
      stateLabel: "Current plan",
    });
  } finally {
    await closeActor(actor);
  }
}

async function proveFamilyInviteActivation(input: {
  actor: HostedBillingBrowserActor;
  ownerMemberId: string;
  subscriptionId: string;
}): Promise<void> {
  try {
    const invite = await requireDriver().createNameOnlyFamilyInvite(input.actor);
    const member = await createMember("family_invitee");
    const memberActor = await createActor(member.session);
    try {
      await requireDriver().acceptFamilyInvite(memberActor, invite.acceptUrl);
      const ownerProjection = await waitForHostedFamilyProjectionForTest({
        environment: requireScenario().runtimeEnv,
        label: "Family owner roster after web invite activation",
        memberId: input.ownerMemberId,
        ready: (projection) =>
          projection.members.length === 2
          && projection.members.some((entry) =>
            entry.memberId === member.memberId
            && entry.status === "active"
            && entry.planCode === "pulse"
          ),
      });
      const memberProjection = await waitForHostedFamilyProjectionForTest({
        environment: requireScenario().runtimeEnv,
        label: "sponsored Family member projection",
        memberId: member.memberId,
        ready: (projection) =>
          projection.billingActive
          && projection.memberRole === "member"
          && projection.memberStatus === "active"
          && projection.memberPlanCode === "pulse"
          && projection.stripeSubscriptionId === input.subscriptionId,
      });
      expect(ownerProjection.ownerMemberId === input.ownerMemberId).toBe(true);
      expect(memberProjection.ownerMemberId === input.ownerMemberId).toBe(true);
      const stripeTruth = await requireSandbox().readSubscriptionTruth(
        input.subscriptionId,
      );
      expect(stripeTruth.priceQuantities.some((entry) =>
        entry.priceId === requireSandbox().priceIds.familyPulse
        && entry.quantity === 2
      )).toBe(true);
      await requireDriver().assertFamilyActivePulseMemberRow(input.actor);
      await requireDriver().assertSettingsPlanState(input.actor, {
        planName: "Family",
        stateLabel: "Current plan",
      });
      await requireDriver().assertSettingsText(
        memberActor,
        /Billing is managed by your Family plan owner/iu,
      );
      await requireDriver().assertSettingsPlanState(memberActor, {
        planName: "Family",
        stateLabel: "Sponsored",
      });
    } finally {
      await closeActor(memberActor);
    }
  } finally {
    await closeActor(input.actor);
  }
}

async function createMember(
  label: string,
  billingStatus: "canceled" | "not_started" = "not_started",
): Promise<{
  memberId: string;
  session: HostedAppSessionForTest;
}> {
  const memberId = `member_hsb_${runToken}_${label}`;
  const privyUserId = `did:privy:hsb_${runToken}_${label}`;
  const verifiedEmail = `${label}.${runToken}@example.invalid`;
  await seedHostedBillingMemberForTest({
    billingStatus,
    environment: requireScenario().runtimeEnv,
    memberId,
    privyUserId,
    verifiedEmail,
  });
  await seedHostedLaunchConsentForTest({
    environment: requireScenario().runtimeEnv,
    memberId,
  });
  const session = await requireScenario().issueHostedAppSession({
    memberId,
    privyUserId,
  });
  return { memberId, session };
}

async function bindDirectFixture(
  memberId: string,
  fixture: HostedStripeSubscriptionFixture,
  phase: "paid" | "trial",
  planCode: "launch_edge_monthly" | "launch_monthly",
  billingStatus: "active" | "paused" = "active",
): Promise<void> {
  const truth = await requireSandbox().readSubscriptionTruth(fixture.subscriptionId);
  await seedHostedBillingMemberForTest({
    billingRef: buildBillingRefSeed({
      fixture,
      phase,
      planCode,
      truth,
    }),
    billingStatus,
    environment: requireScenario().runtimeEnv,
    memberId,
  });
}

function buildBillingRefSeed(input: {
  fixture: HostedStripeSubscriptionFixture;
  phase: "paid" | "trial";
  planCode: "launch_edge_monthly" | "launch_monthly";
  truth: HostedStripeSubscriptionTruth;
}): HostedBillingRefSeedForTest {
  return {
    currentBillingPhase: input.phase,
    currentBillingPlanCode: input.planCode,
    currentCheckoutOffer: input.phase === "trial" ? "pulse_trial_7d" as const : "standard" as const,
    currentPeriodEnd: input.truth.currentPeriodEnd,
    currentPeriodStart: input.truth.currentPeriodStart,
    currentTrialEndsAt: input.truth.trialEndsAt,
    currentTrialStartedAt: input.truth.trialStartedAt,
    pulseTrialRedeemedAt: input.phase === "trial" ? input.truth.trialStartedAt : null,
    stripeCustomerId: input.fixture.customerId,
    stripeSubscriptionId: input.fixture.subscriptionId,
  };
}

async function waitForPaidMemberProjection(
  memberId: string,
  planCode: "launch_edge_monthly" | "launch_monthly",
): Promise<HostedBillingProjectionForTest> {
  return waitForHostedBillingProjectionForTest({
    environment: requireScenario().runtimeEnv,
    label: `paid ${planCode} local projection`,
    memberId,
    ready: (projection) =>
      projection.billingStatus === "active"
      && projection.currentBillingPhase === "paid"
      && projection.currentBillingPlanCode === planCode,
  });
}

async function waitForPaidEdgeTruthAndProjection(
  memberId: string,
  subscriptionId: string,
): Promise<void> {
  await requireSandbox().waitForSubscriptionTruth({
    label: "Stripe Edge subscription after Portal confirmation",
    ready: (truth) =>
      truth.status === "active"
      && truth.latestInvoicePaid
      && truth.priceIds.includes(requireSandbox().priceIds.edge)
      && !truth.priceIds.includes(requireSandbox().priceIds.pulse),
    subscriptionId,
  });
  await waitForPaidMemberProjection(memberId, "launch_edge_monthly");
}

async function createActor(
  session: HostedAppSessionForTest,
): Promise<HostedBillingBrowserActor> {
  const actor = await requireDriver().createActor(session);
  actors.add(actor);
  return actor;
}

async function closeActor(actor: HostedBillingBrowserActor): Promise<void> {
  if (!actors.delete(actor)) {
    return;
  }
  await actor.close();
}

function assertHostedStripeListenerAlive(): void {
  requireScenario().harness.assertStripeListenerAlive();
}

function requireStripeObjectId(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (value && typeof value === "object") {
    const id = Reflect.get(value, "id");
    if (typeof id === "string" && id.trim()) {
      return id;
    }
  }
  throw new Error(`Stripe Checkout did not return a ${label}.`);
}

function requireNonEmpty(value: string | null, label: string): string {
  if (!value?.trim()) {
    throw new Error(`${label} was not available.`);
  }
  return value;
}

function requireDriver(): HostedBillingBrowserDriver {
  if (!browserDriver) {
    throw new Error("Hosted billing browser driver is unavailable.");
  }
  return browserDriver;
}

function requireSandbox(): HostedStripeBillingSandbox {
  if (!sandbox) {
    throw new Error("Hosted Stripe billing sandbox is unavailable.");
  }
  return sandbox;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted-local billing scenario is unavailable.");
  }
  return scenario;
}
