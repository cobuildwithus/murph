import assert from "node:assert/strict";

import { cloneElement, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  readHostedMemberBillingEligibilityState: vi.fn(),
  projectHostedPersonalAiUsageStatus: vi.fn(),
  resolveHostedMurphContactOption: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
  routerRefresh: vi.fn(),
  shouldShowHomeDeviceSyncStep: vi.fn(),
}));

vi.mock("server-only", () => ({}));

// The dashboard route-group template owns the browser vault, so the home
// page body reads it through context. Stub it here since these tests render the
// page in isolation without the layout.
vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider: ({ children }: { children: ReactNode }) => children,
  useBrowserVault: () => ({
    client: null,
    dataVersion: null,
    deviceSyncImportPending: false,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: async () => {},
    status: "empty",
  }),
}));

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

vi.mock("../app/(dashboard)/home/initial-visit-persona-picker-client", () => ({
  HomeInitialVisitPersonaPickerClient({
    showContactCard,
  }: {
    showContactCard: boolean;
  }) {
    return createElement(
      "section",
      {
        "data-show-contact-card": showContactCard ? "true" : "false",
        "data-home-initial-visit-persona-picker": "shown",
      },
      "Persona onboarding",
    );
  },
}));

vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOption: mocks.resolveHostedMurphContactOption,
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
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberBillingEligibilityState: mocks.readHostedMemberBillingEligibilityState,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-execution/usage-status", () => ({
  projectHostedPersonalAiUsageStatus: mocks.projectHostedPersonalAiUsageStatus,
}));

const MEMBER = {
  billingStatus: "active",
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  id: "member_123",
  suspendedAt: null,
  updatedAt: new Date("2026-05-01T00:00:00.000Z"),
};

const PULSE_TRIAL_BILLING_STATE = {
  currentBillingPhase: "trial",
  currentBillingPlanCode: "launch_monthly",
  currentCheckoutOffer: "pulse_trial_7d",
  hasStripeCustomerId: true,
  hasStripeSubscriptionId: true,
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
  mocks.readHostedMemberBillingEligibilityState.mockResolvedValue(null);
  mocks.resolveHostedMurphContactOption.mockResolvedValue({
    href: "sms:+15555550123",
    kind: "text",
    label: "Text Murph",
    rel: undefined,
    target: undefined,
  });
  mocks.resolveHostedAiUsageGate.mockResolvedValue({
    allowed: true,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    remainingUsdMicros: 4_000_000n,
    spentUsdMicros: 6_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
  });
  mocks.projectHostedPersonalAiUsageStatus.mockResolvedValue({
    generatedAt: "2026-05-26T12:00:00.000Z",
    reason: "hosted_access_inactive",
    recommendedAction: null,
    status: "unavailable",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

test("HomePage stops before page loaders when dashboard auth redirects", async () => {
  mocks.getHostedPageAuthSnapshot.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/join"));

  const { default: HomePage } = await import("../app/(dashboard)/home/page");

  await assert.rejects(async () => {
    await HomePage();
  }, /NEXT_REDIRECT:\/join/);
  assert.equal(mocks.shouldShowHomeDeviceSyncStep.mock.calls.length, 0);
  assert.equal(mocks.readHostedMemberBillingEligibilityState.mock.calls.length, 0);
  assert.equal(mocks.resolveHostedAiUsageGate.mock.calls.length, 0);
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
  mocks.readHostedMemberBillingEligibilityState.mockResolvedValueOnce(PULSE_TRIAL_BILLING_STATE);

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
  mocks.readHostedMemberBillingEligibilityState.mockResolvedValueOnce(PULSE_TRIAL_BILLING_STATE);

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Resume Pulse billing/);
  assert.match(markup, /Add a payment method and resume billing/);
  assert.match(markup, /href="\/settings"/);
  assert.doesNotMatch(markup, /hit this month/);
  assert.doesNotMatch(markup, /Start Pulse now/);
  assert.equal(mocks.readHostedMemberBillingEligibilityState.mock.calls.length, 1);
});

test("HomePage does not show a blocked banner while purchased usage remains", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: true,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    remainingUsdMicros: 2_000_000n,
    spentUsdMicros: 10_000_000n,
    usageCreditBalanceUsdMicros: 2_000_000n,
    usageCreditLedgerVersion: 3n,
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.doesNotMatch(markup, /Account notice/);
  assert.doesNotMatch(markup, /New replies and other AI work are blocked/);
  assert.doesNotMatch(markup, />Add usage</);
  assert.equal(mocks.projectHostedPersonalAiUsageStatus.mock.calls.length, 0);
});

test("HomePage shows blocked Pulse usage with an add-usage action", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "pulse_upgrade_edge",
      message:
        "You've used 100% of this month's included Pulse usage. New usage is blocked.",
    },
  });
  mocks.projectHostedPersonalAiUsageStatus.mockResolvedValueOnce({
    generatedAt: "2026-05-26T12:00:00.000Z",
    recommendedAction: {
      kind: "add_usage",
      label: "Add usage",
      url: "/settings?addUsage=true#subscription",
    },
    status: "unavailable",
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /used 100% of this month(?:&#x27;|')s included Pulse usage/u);
  assert.match(markup, /Resets in 6 days/);
  assert.match(markup, /New replies and other AI work are blocked/);
  assert.match(markup, /until you add usage or your included usage resets/);
  assert.match(markup, /You can add more usage now/);
  assert.match(markup, />Add usage</);
  assert.match(markup, /href="\/settings\?addUsage=true#subscription"/);
  assert.equal(mocks.resolveHostedAiUsageGate.mock.calls.length, 1);
  assert.equal(mocks.projectHostedPersonalAiUsageStatus.mock.calls.length, 1);
  assert.equal(
    mocks.projectHostedPersonalAiUsageStatus.mock.calls[0]?.[0]?.decision.userNotice.code,
    "pulse_upgrade_edge",
  );
});

test("HomePage keeps the exhausted Pulse block notice when action resolution fails closed", async () => {
  mocks.readHostedMemberBillingEligibilityState.mockRejectedValue(
    new Error("billing eligibility unavailable"),
  );
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "pulse_upgrade_edge",
      message:
        "You've used 100% of this month's included Pulse usage. New usage is blocked.",
    },
  });
  mocks.projectHostedPersonalAiUsageStatus.mockResolvedValueOnce({
    accessKind: "paid",
    forecast: null,
    generatedAt: "2026-05-26T12:00:00.000Z",
    periodEnd: "2026-06-01T00:00:00.000Z",
    periodKind: "monthly",
    periodStart: "2026-05-01T00:00:00.000Z",
    planCode: "launch_monthly",
    planName: "Pulse",
    recommendedAction: null,
    remainingPercent: 0,
    status: "exhausted",
    usedPercent: 100,
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /used 100% of this month(?:&#x27;|')s included Pulse usage/u);
  assert.match(markup, /New replies and other AI work are blocked/);
  assert.match(markup, /until your included usage resets/);
  assert.doesNotMatch(markup, /You can add more usage now/);
  assert.doesNotMatch(markup, />Add usage</);
  assert.doesNotMatch(markup, /addUsage=true/);
  assert.equal(mocks.readHostedMemberBillingEligibilityState.mock.calls.length, 0);
});

test("UsageLimitBanner omits thread-container notices from the personal dashboard", async () => {
  const { UsageLimitBanner } = await import(
    "../src/components/home/usage-limit-banner"
  );

  const markup = renderToStaticMarkup(createElement(UsageLimitBanner, {
    noticeCode: "thread_usage_limit_reached",
  }));

  assert.equal(markup, "");
});

test("HomePage shows blocked Edge usage with an add-usage action", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_edge_monthly",
    limitUsdMicros: 25_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 25_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "edge_usage_limit_reached",
      message:
        "You've used 100% of this month's included Edge usage. New usage is blocked.",
    },
  });
  mocks.projectHostedPersonalAiUsageStatus.mockResolvedValueOnce({
    generatedAt: "2026-05-26T12:00:00.000Z",
    recommendedAction: {
      kind: "add_usage",
      label: "Add usage",
      url: "/settings?addUsage=true#subscription",
    },
    status: "unavailable",
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /used 100% of this month(?:&#x27;|')s included Edge usage/u);
  assert.match(markup, /Resets in 6 days/);
  assert.match(markup, /New replies and other AI work are blocked/);
  assert.match(markup, /until you add usage or your included usage resets/);
  assert.match(markup, />Add usage</);
  assert.match(markup, /href="\/settings\?addUsage=true#subscription"/);
});

test("HomePage shows a blocked Family usage notice without a personal action", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "family_sponsored_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "family_usage_limit_reached",
      message: "Unused test fixture message",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /used 100% of your included usage this month/u);
  assert.match(markup, /Other Family members have separate allowances/u);
  assert.match(markup, /New replies and other AI work are blocked/);
  assert.match(markup, /until your included usage resets/);
  assert.doesNotMatch(markup, /shared allowance|Family(?:&#x27;|')s included usage/u);
  assert.match(markup, /Resets in 6 days/);
  assert.doesNotMatch(markup, />Add usage</);
});

test("HomePage shows blocked trial usage with the existing Start Pulse action", async () => {
  mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "direct_trial",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 4_500_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-05-08T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-05-08T00:00:00.000Z"),
    spentUsdMicros: 4_500_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "trial_usage_limit_reached",
      message: "You've used 100% of your included trial usage. New usage is blocked.",
    },
  });
  mocks.projectHostedPersonalAiUsageStatus.mockResolvedValueOnce({
    generatedAt: "2026-05-26T12:00:00.000Z",
    recommendedAction: {
      kind: "start_pulse",
      label: "Start from usage projection",
      url: "https://example.test/settings#subscription",
    },
    status: "unavailable",
  });
  mocks.readHostedMemberBillingEligibilityState.mockResolvedValueOnce(PULSE_TRIAL_BILLING_STATE);

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /used 100% of your included trial usage/u);
  assert.match(markup, /New replies and other AI work are blocked/);
  assert.match(markup, /included trial usage is exhausted/);
  assert.match(markup, /Start Pulse to continue/iu);
  assert.match(markup, /Start from usage projection/);
  assert.match(markup, /href="https:\/\/example\.test\/settings#subscription"/);
  assert.doesNotMatch(markup, /Resets in/u);
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
  assert.match(markup, /included trial access is no longer active/);
  assert.doesNotMatch(markup, /Start Pulse|Upgrade to Edge/);
  assert.doesNotMatch(markup, /href="\/settings/);
  assert.doesNotMatch(markup, /Resets in/u);
});

test("HomePage opens persona onboarding for initial visits", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve({
        initialVisit: "true",
      }),
    }),
  );

  assert.match(markup, /Welcome to Murph/);
  assert.match(markup, /data-home-initial-visit-persona-picker="shown"/);
  assert.match(markup, /data-show-contact-card="true"/);
  assert.match(markup, /Persona onboarding/);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 1);
  assert.doesNotMatch(markup, /data-home-initial-visit-dialog/);
});

test("HomePage keeps persona onboarding gated behind the exact initial-visit marker", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve({
        initialVisit: "false",
      }),
    }),
  );

  assert.doesNotMatch(markup, /data-home-initial-visit-persona-picker/);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 0);
});
