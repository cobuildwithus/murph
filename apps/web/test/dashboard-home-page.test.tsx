import assert from "node:assert/strict";

import { cloneElement, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  resolveHostedMurphContactOption: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
  routerRefresh: vi.fn(),
  shouldShowHomeDeviceSyncStep: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default(props: {
    children?: ReactNode;
    className?: string;
    href: string;
    "data-slot"?: string;
  }) {
    return createElement(
      "a",
      {
        className: props.className,
        "data-slot": props["data-slot"],
        href: props.href,
      },
      props.children,
    );
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock("@/src/components/home/upload-labs-action", () => ({
  UploadLabsActionFallback: () =>
    createElement("button", { type: "button" }, "Sync fallback"),
  UploadLabsMurphContactAction: () =>
    createElement("button", { type: "button" }, "Sync"),
}));

vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOption: mocks.resolveHostedMurphContactOption,
}));

vi.mock("../app/(dashboard)/home/initial-visit-dialog-client", () => ({
  HomeInitialVisitDialogClient(props: {
    contactAction: { href: string } | null;
  }) {
    return createElement(
      "section",
      { "data-home-initial-visit-dialog": "shown" },
      "Initial visit dialog",
      props.contactAction
        ? createElement("a", { href: props.contactAction.href }, "Text Murph")
        : null,
      createElement("button", { type: "button" }, "Start exploring"),
    );
  },
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton(props: {
    children?: ReactNode;
    className?: string;
    render?: ReactNode;
  }) {
    if (isValidElement<{ children?: ReactNode; className?: string; "data-slot"?: string }>(props.render)) {
      return cloneElement(
        props.render,
        {
          className: props.className,
          "data-slot": "auth-button",
        },
        props.children,
      );
    }

    return createElement("button", {
      className: props.className,
      "data-slot": "auth-button",
      type: "button",
    }, props.children);
  },
}));

vi.mock("@/src/lib/device-sync/home-onboarding", () => ({
  shouldShowHomeDeviceSyncStep: mocks.shouldShowHomeDeviceSyncStep,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

const MEMBER = {
  billingStatus: "active",
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  id: "member_123",
  suspendedAt: null,
  updatedAt: new Date("2026-05-01T00:00:00.000Z"),
};

const PULSE_TRIAL_BILLING_REF = {
  currentBillingPhase: "trial",
  currentBillingPlanCode: "launch_monthly",
  currentCheckoutOffer: "pulse_trial_7d",
  currentPeriodEnd: null,
  currentPeriodStart: null,
  currentTrialEndsAt: new Date("2026-06-01T00:00:00.000Z"),
  currentTrialStartedAt: new Date("2026-05-25T00:00:00.000Z"),
  lastStripeEventCreatedAt: new Date("2026-05-25T00:00:00.000Z"),
  memberId: MEMBER.id,
  pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
  pulseTrialRedeemedAt: new Date("2026-05-25T00:00:00.000Z"),
  stripeCustomerId: "cus_trial",
  stripeSubscriptionId: "sub_trial",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-26T12:00:00.000Z"));
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: MEMBER,
    session: null,
  });
  mocks.shouldShowHomeDeviceSyncStep.mockResolvedValue(true);
  mocks.readHostedMemberStripeBillingRef.mockResolvedValue(null);
  mocks.resolveHostedMurphContactOption.mockResolvedValue({
    href: "sms:+15550100001?body=Hey%20Murph%2C%20do%20your%20thing",
    kind: "text",
    label: "Messages",
  });
  mocks.resolveHostedAiUsageGate.mockResolvedValue({
    allowed: true,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    remainingUsdMicros: 4_000_000n,
    spentUsdMicros: 6_000_000n,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

test("HomePage hides the connect devices card when device sync is already active", async () => {
  mocks.shouldShowHomeDeviceSyncStep.mockResolvedValueOnce(false);

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Welcome to Murph/);
  assert.doesNotMatch(markup, /Connect devices/);
  assert.doesNotMatch(markup, /href="\/connect"/);
  assert.match(markup, /Sync labs/);
  assert.match(markup, /Start an experiment/);
  assert.equal(mocks.shouldShowHomeDeviceSyncStep.mock.calls[0]?.[0]?.member, MEMBER);
  assert.equal(mocks.resolveHostedAiUsageGate.mock.calls[0]?.[0]?.memberId, MEMBER.id);
  assert.equal(
    mocks.resolveHostedAiUsageGate.mock.calls[0]?.[0]?.now.toISOString(),
    "2026-05-26T12:00:00.000Z",
  );
});

test("HomePage keeps active Pulse Trial users in the product without a start-paid banner", async () => {
  mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(PULSE_TRIAL_BILLING_REF);

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Welcome to Murph/);
  assert.doesNotMatch(markup, /Start Pulse now/);
  assert.doesNotMatch(markup, /End the remaining trial and start paid Pulse now/);
  assert.doesNotMatch(markup, /hit this month/);
  assert.doesNotMatch(markup, /Resume Pulse billing/);
});

test("HomePage shows the resume billing banner for paused Pulse Trial users", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: {
      ...MEMBER,
      billingStatus: "paused",
    },
    session: null,
  });
  mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(PULSE_TRIAL_BILLING_REF);

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Resume Pulse billing/);
  assert.match(markup, /Add a payment method and resume billing/);
  assert.match(markup, /href="\/settings"/);
  assert.doesNotMatch(markup, /hit this month/);
  assert.doesNotMatch(markup, /Start Pulse now/);
});

test("HomePage shows a usage-limit upgrade banner when assistant usage is exhausted", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    userNotice: {
      code: "pulse_upgrade_edge",
      message:
        "Hey, you've reached your usage limit for the month. Upgrade to Edge: https://withmurph.ai/home",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /hit this month/);
  assert.match(markup, /Resets in 6 days/);
  assert.match(markup, /Upgrade to Edge for more/);
  assert.match(markup, /type="button"/);
});

test("HomePage shows a monthly usage reset countdown when assistant usage is exhausted", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    billingPlanCode: "launch_edge_monthly",
    limitUsdMicros: 25_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 25_000_000n,
    userNotice: {
      code: "edge_usage_limit_reached",
      message:
        "Hey, you've reached your usage limit for the month. Murph will resume when your included allowance resets: https://withmurph.ai/home",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /hit this month/);
  assert.match(markup, /Resets in 6 days/);
  assert.match(markup, /Murph will start replying again when your plan resets/);
});

test("HomePage shows Start Pulse directly when trial credits are exhausted", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 4_500_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-05-08T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-05-08T00:00:00.000Z"),
    spentUsdMicros: 4_500_000n,
    userNotice: {
      code: "trial_usage_limit_reached",
      message: "Your trial credits are used up.",
    },
  });
  mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(PULSE_TRIAL_BILLING_REF);

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Your trial credits are used up/);
  assert.match(markup, /Start Pulse to keep Murph replying/);
  assert.doesNotMatch(markup, /Start Pulse now/);
  assert.doesNotMatch(markup, /Start your Pulse plan/);
  assert.doesNotMatch(markup, /href="\/settings"/);
});

test("HomePage shows non-limit denied usage notices without a reset countdown", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 4_500_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-05-08T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "trial_expired_pending_billing",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-05-26T12:05:00.000Z"),
    spentUsdMicros: 4_500_000n,
    userNotice: {
      code: "trial_conversion_pending",
      message: "Your trial ended and billing is still pending.",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Your trial just ended/);
  assert.match(markup, /Billing is still finishing up/);
  assert.doesNotMatch(markup, /Resets in/u);
});

test("HomePage opens the welcome dialog for initial visits", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve({
        initialVisit: "true",
      }),
    }),
  );

  assert.match(markup, /Welcome to Murph/);
  assert.match(markup, /data-home-initial-visit-dialog="shown"/);
  assert.match(markup, /href="sms:\+15550100001\?body=Hey%20Murph%2C%20do%20your%20thing"/);
  assert.doesNotMatch(markup, /Let%27s|Let(?:&#x27;|')s/u);
  assert.doesNotMatch(markup, /Get(?:%20| )started(?:%20| )with(?:%20| )Murph/u);
  assert.match(markup, />Text Murph</);
  assert.match(markup, />Start exploring</);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 1);
  assert.equal(
    mocks.resolveHostedMurphContactOption.mock.calls[0]?.[0]?.message?.body,
    "Hey Murph, do your thing",
  );
  assert.equal(
    mocks.resolveHostedMurphContactOption.mock.calls[0]?.[0]?.message?.subject,
    "Hey Murph, do your thing",
  );
});
