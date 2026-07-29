import assert from "node:assert/strict";

import type {
  HostedPlanUsageAvailableStatus,
  HostedPlanUsageSubscriptionActionQuote,
} from "@murphai/hosted-execution/plan-usage";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
  requestHostedPulseTrialContinuation: vi.fn(),
  requestHostedPulseTrialStartPaid: vi.fn(),
  requestHostedTrialPlanStartPaid: vi.fn(),
  routerRefresh: vi.fn(),
  routerReplace: vi.fn(),
}));

const TEST_PAYER_MEMBER_ID = "hbm_billing_settings_payer";

function buildUsageStatus(
  overrides: Partial<HostedPlanUsageAvailableStatus> = {},
): HostedPlanUsageAvailableStatus {
  return {
    accessKind: "paid",
    forecast: null,
    generatedAt: "2026-07-10T12:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    periodKind: "monthly",
    periodStart: "2026-07-01T00:00:00.000Z",
    planCode: "launch_monthly",
    planName: "Pulse",
    recommendedAction: null,
    remainingPercent: 65,
    status: "active",
    usedPercent: 35,
    ...overrides,
  };
}

function buildSubscriptionActionQuote(input: {
  label: string;
  targetPlanCode: HostedPlanUsageSubscriptionActionQuote["targetPlanCode"];
  timing: HostedPlanUsageSubscriptionActionQuote["timing"];
}): HostedPlanUsageSubscriptionActionQuote {
  const monthlyPriceUsdCents = input.targetPlanCode === "launch_group_monthly"
    ? 350
    : input.targetPlanCode === "launch_monthly"
      ? 800
      : 2_000;
  return {
    action: "change_plan",
    expiresAt: "2026-07-10T12:10:00.000Z",
    label: input.label,
    monthlyPriceUsdCents,
    quoteId: `quote_${input.targetPlanCode}_${input.timing}`,
    targetPlanCode: input.targetPlanCode,
    timing: input.timing,
  };
}

vi.mock("@/src/components/hosted-onboarding/client-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/components/hosted-onboarding/client-api")
  >("@/src/components/hosted-onboarding/client-api");
  return {
    ...actual,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
    requestHostedPulseTrialContinuation: mocks.requestHostedPulseTrialContinuation,
    requestHostedPulseTrialStartPaid: mocks.requestHostedPulseTrialStartPaid,
    requestHostedTrialPlanStartPaid: mocks.requestHostedTrialPlanStartPaid,
  };
});

vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({
    authenticated: true,
    openAuthDialog: () => {},
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/personal-usage-credit-eligibility", () => ({
  readHostedPersonalUsageCreditOfferCodes: vi.fn(async () => [
    "usage_5_usd",
  ]),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
    replace: mocks.routerReplace,
  }),
}));

vi.mock("@/src/components/ui/dialog", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const noopOpenChange: (open: boolean) => void = () => {};
  const DialogContext = React.createContext<{
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }>({
    onOpenChange: noopOpenChange,
    open: false,
  });
  const passthrough = (tag: keyof HTMLElementTagNameMap) =>
    function Passthrough(props: {
      children?: React.ReactNode;
      className?: string;
    }) {
      return React.createElement(tag, props, props.children);
    };

  return {
    Dialog(props: {
      children?: React.ReactNode;
      onOpenChange?: (open: boolean) => void;
      open?: boolean;
    }) {
      return React.createElement(
        DialogContext.Provider,
        {
          value: {
            onOpenChange: props.onOpenChange ?? (() => {}),
            open: props.open === true,
          },
        },
        props.children,
      );
    },
    DialogContent(props: { children?: React.ReactNode; className?: string }) {
      const context = React.useContext(DialogContext);
      return context.open
        ? React.createElement("div", { className: props.className, role: "dialog" }, props.children)
        : null;
    },
    DialogDescription: passthrough("p"),
    DialogHeader: passthrough("div"),
    DialogTitle: passthrough("h2"),
    DialogTrigger(props: {
      children?: React.ReactNode;
      render?: React.ReactElement;
    }) {
      return props.render
        ? React.cloneElement(props.render, undefined, props.children)
        : React.createElement("div", null, props.children);
    },
  };
});

describe("HostedBillingSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });
    mocks.requestHostedPulseTrialStartPaid.mockResolvedValue({
      status: "started",
    });
    mocks.requestHostedTrialPlanStartPaid.mockResolvedValue({
      status: "scheduled",
    });
    mocks.requestHostedPulseTrialContinuation.mockResolvedValue({
      status: "started",
    });
  });

  test("renders the plan grid with the current plan, Family, and portal link", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canUpgradeToEdge: true,
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Pulse/);
    assert.match(markup, /Edge/);
    assert.match(markup, /Family/);
    assert.match(markup, /\$7\/person/);
    assert.match(markup, /\$20/);
    assert.match(markup, /Current plan/);
    assert.match(markup, /Choose Edge/);
    assert.match(markup, /Manage billing/);
  });

  test("shows the $3.50 Group plan only from the server-authorized catalog", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );

    const hiddenMarkup = renderToStaticMarkup(createElement(
      HostedBillingSettings,
      {
        authenticated: true,
        currentBillingPlanCode: "launch_monthly",
      },
    ));
    const visibleMarkup = renderToStaticMarkup(createElement(
      HostedBillingSettings,
      {
        authenticated: true,
        canSwitchToGroup: true,
        currentBillingPlanCode: "launch_monthly",
        currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
        showGroupPlan: true,
      },
    ));

    assert.doesNotMatch(hiddenMarkup, />Group</);
    assert.match(visibleMarkup, />Group</);
    assert.match(visibleMarkup, /\$3\.50/);
    assert.match(visibleMarkup, /Choose Group/);
    assert.match(visibleMarkup, /Available to confirmed members/);
  });

  test("keeps Group members on the ordinary upgrade path", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );

    const markup = renderToStaticMarkup(createElement(
      HostedBillingSettings,
      {
        authenticated: true,
        canUpgradeToEdge: true,
        canUpgradeToPulse: true,
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_group_monthly",
        showGroupPlan: true,
      },
    ));

    assert.match(markup, />Group</);
    assert.match(markup, /Current plan/);
    assert.match(markup, /Choose Pulse/);
    assert.match(markup, /Choose Edge/);
  });

  test("acknowledges a saved card and requires fresh exact-price Group confirmation", async () => {
    mocks.requestHostedTrialPlanStartPaid.mockResolvedValueOnce({
      status: "started",
    });
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const rendered = await renderClientComponent(createElement(
      HostedBillingSettings,
      {
        authenticated: true,
        canStartPaidPulse: true,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        groupPaymentMethodSaved: true,
        showGroupPlan: true,
      },
    ));

    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Payment method saved/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Group has not started/,
    );

    const reviewButton = findLastButtonByText(
      rendered.window.document,
      "Review and start Group",
      rendered.window,
    );
    await act(async () => {
      reviewButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Group begins at \$3\.50\/month/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /charged immediately/,
    );

    const dialog = rendered.window.document.querySelector("[role=dialog]");
    const confirmButton = [...(dialog?.querySelectorAll("button") ?? [])]
      .find((button) => button.textContent === "Start Group");
    assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);
    await act(async () => {
      confirmButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    assert.deepEqual(
      mocks.requestHostedTrialPlanStartPaid.mock.calls[0]?.[0],
      {
        targetPlanCode: "launch_group_monthly",
        timing: "now",
      },
    );
    assert.deepEqual(mocks.routerReplace.mock.calls, [
      ["/settings#subscription"],
    ]);
    await rendered.cleanup();

    const currentMarkup = renderToStaticMarkup(createElement(
      HostedBillingSettings,
      {
        authenticated: true,
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_group_monthly",
        showGroupPlan: true,
      },
    ));
    assert.match(currentMarkup, /Current plan/);
    assert.doesNotMatch(currentMarkup, /Group has not started/);
  });

  test("confirms the exact Group price and trial-end timing before scheduling", async () => {
    const { StartPaidPulseButton } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-button"
    );
    const rendered = await renderClientComponent(createElement(
      StartPaidPulseButton,
      {
        targetPlanCode: "launch_group_monthly",
        timing: "at_trial_end",
      },
      "Choose Group",
    ));

    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Group begins at \$3\.50\/month when it ends/,
    );

    const confirmButton = findLastButtonByText(
      rendered.window.document,
      "Choose Group",
      rendered.window,
    );
    await act(async () => {
      confirmButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    assert.deepEqual(
      mocks.requestHostedTrialPlanStartPaid.mock.calls[0]?.[0],
      {
        targetPlanCode: "launch_group_monthly",
        timing: "at_trial_end",
      },
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Group is set/,
    );
    await rendered.cleanup();
  });

  test("gives Pulse members a recovery path for a scheduled Group switch", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(
      HostedBillingSettings,
      {
        authenticated: true,
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        scheduledBillingEffectiveAt:
          new Date("2026-08-01T00:00:00.000Z"),
        scheduledBillingPlanCode: "launch_group_monthly",
        showGroupPlan: true,
      },
    ));

    assert.match(markup, /Group starts Aug 1, 2026/);
    assert.match(markup, /Pulse stays active until then/);
    assert.match(markup, /Change scheduled plan/);
    assert.match(markup, /mailto:support@withmurph\.ai/);
  });

  test("says syncing continues when Group AI usage is exhausted", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(
      HostedBillingSettings,
      {
        authenticated: true,
        usageStatus: buildUsageStatus({
          planCode: "launch_group_monthly",
          planName: "Group",
          remainingPercent: 0,
          status: "exhausted",
          usedPercent: 100,
        }),
      },
    ));

    assert.match(markup, /wearable keeps syncing/);
    assert.match(markup, /group activity stays current/);
  });

  test("shows trial usage, timing, and a conservative forecast before the plan cards", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      usageStatus: buildUsageStatus({
        accessKind: "trial",
        forecast: {
          estimatedDaysRemaining: 3,
          estimatedExhaustionAt: "2026-07-13T12:00:00.000Z",
        },
        periodEnd: "2026-07-17T00:00:00.000Z",
        periodKind: "trial",
        planName: "Pulse Trial",
      }),
    }));

    assert.match(markup, /AI usage/);
    assert.match(markup, /aria-label="Pulse Trial AI usage"/);
    assert.match(markup, /35% used/);
    assert.match(markup, /65% remaining/);
    assert.match(markup, /Trial ends Jul 17, 2026/);
    assert.match(markup, /may run out in about 3 days/);
    assert.ok(markup.indexOf("AI usage") < markup.indexOf("Run experiments"));
  });

  test.each([
    {
      accessKind: "paid",
      planCode: "launch_monthly",
      planName: "Pulse",
    },
    {
      accessKind: "paid",
      planCode: "launch_edge_monthly",
      planName: "Edge",
    },
    {
      accessKind: "family_sponsored",
      planCode: "launch_monthly",
      planName: "Family",
    },
  ] as const)("shows the $planName overall usage state", async ({ accessKind, planCode, planName }) => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      usageStatus: buildUsageStatus({ accessKind, planCode, planName }),
    }));

    assert.match(markup, new RegExp(`aria-label="${planName} AI usage"`));
    assert.match(markup, /Resets Aug 1, 2026/);
  });

  test("shows exhausted overall usage without inventing a forecast", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      usageStatus: buildUsageStatus({
        remainingPercent: 0,
        status: "exhausted",
        usedPercent: 100,
      }),
    }));

    assert.match(markup, /100% used/);
    assert.match(markup, /0% remaining/);
    assert.match(markup, /You&#x27;ve used all available usage\. Murph pauses new usage until more capacity is available/);
    assert.doesNotMatch(markup, /recent pace/);
  });

  test("renders purchased capacity inside the overall usage bar", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      usageStatus: buildUsageStatus({
        remainingPercent: 24,
        status: "active",
        usedPercent: 76,
      }),
      usageTopUpOffers: [{
        amountLabel: "$5",
        estimatedMessages: 100,
        offerCode: "usage_5_usd",
      }],
    }));

    assert.match(markup, /76% used/);
    assert.match(markup, /24% remaining/);
    assert.doesNotMatch(markup, /remaining usage credit/);
    assert.doesNotMatch(markup, /usage credit remaining/);
    assert.doesNotMatch(markup, /Add usage to continue/);
    assert.doesNotMatch(markup, /pauses new usage/);
  });

  test("renders overall capacity from the production usage projection", async () => {
    const {
      projectHostedPersonalAiUsageStatus,
    } = await import("@/src/lib/hosted-execution/usage-status");
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");
    const periodStart = new Date("2026-07-01T00:00:00.000Z");
    const periodEnd = new Date("2026-08-01T00:00:00.000Z");
    const memberId = "member_credit_backed";
    const usageStatus = await projectHostedPersonalAiUsageStatus({
      decision: {
        allowed: true,
        allowanceSource: "direct_paid_member_plan",
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 10_000_000n,
        memberId,
        periodEnd,
        periodStart,
        remainingUsdMicros: 3_000_000n,
        spentUsdMicros: 10_000_000n,
        usageCreditBalanceUsdMicros: 3_000_000n,
        usageCreditLedgerVersion: 4n,
      },
      memberId,
      now: "2026-07-10T12:00:00.000Z",
      prisma: {
        hostedAiUsage: {
          findFirst: vi.fn(async () => null),
        },
      } as never,
      publicBaseUrl: null,
    });

    assert.equal(usageStatus.status, "active");
    assert.equal(usageStatus.usedPercent, 76);
    assert.equal(usageStatus.remainingPercent, 24);

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      usageStatus,
      usageTopUpOffers: [{
        amountLabel: "$5",
        estimatedMessages: 100,
        offerCode: "usage_5_usd",
      }],
    }));

    assert.match(markup, /76% used/);
    assert.match(markup, /24% remaining/);
    assert.doesNotMatch(markup, /\$3\.00/);
    assert.doesNotMatch(markup, /remaining usage credit/);
    assert.doesNotMatch(markup, /usage credit remaining/);
    assert.match(markup, /Add usage/);
  });

  test("keeps overall usage and top-up actions clear without showing an exact credit balance", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      usageStatus: buildUsageStatus({
        remainingPercent: 99,
        usedPercent: 1,
      }),
      usageTopUpOffers: [
        {
          amountLabel: "$5",
          estimatedMessages: 100,
          offerCode: "usage_5_usd",
        },
        {
          amountLabel: "$10",
          estimatedMessages: 200,
          offerCode: "usage_10_usd",
        },
        {
          amountLabel: "$25",
          estimatedMessages: 500,
          offerCode: "usage_25_usd",
        },
      ],
    }));

    assert.match(markup, /1% used/);
    assert.match(markup, /99% remaining/);
    assert.doesNotMatch(markup, /\$8\.42/);
    assert.doesNotMatch(markup, /usage credit remaining/);
    assert.match(markup, /Add usage/);
    const addUsageButton = markup.match(/<button[^>]*>Add usage<\/button>/u)?.[0];
    assert.ok(addUsageButton);
    assert.match(addUsageButton, /\bh-11\b/u);
    assert.match(addUsageButton, /\bborder-foreground\/20\b/u);
    assert.doesNotMatch(addUsageButton, /\bw-full\b/u);
  });

  test("renders server-projected top-up offers without duplicating billing eligibility", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      usageStatus: buildUsageStatus(),
      usageTopUpInitialOpen: true,
      usageTopUpOffers: [{
        amountLabel: "$10",
        estimatedMessages: 200,
        offerCode: "usage_10_usd",
      }],
    }));

    assert.match(markup, /Add usage/);
    assert.match(markup, /\$10/);
  });

  test("shows the amount picker after an expired unattached purchase is omitted", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      usageStatus: buildUsageStatus(),
      usageTopUpActivePurchase: null,
      usageTopUpInitialOpen: true,
      usageTopUpOffers: [{
        amountLabel: "$10",
        estimatedMessages: 200,
        offerCode: "usage_10_usd",
      }],
    }));

    assert.match(markup, /Add usage/);
    assert.match(markup, /\$10/);
    assert.match(markup, /Choose an amount/);
    assert.doesNotMatch(markup, /Continue checkout/);
    assert.doesNotMatch(markup, /reconcil/iu);
  });

  test("offers Text Murph on a fulfilled top-up when a contact channel resolves", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const fulfilledPurchase = {
      offerCode: "usage_10_usd",
      purchaseId: "hucp_fulfilled_added",
      retryAllowed: false,
      status: "fulfilled" as const,
    };
    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      usageStatus: buildUsageStatus({
        remainingPercent: 45,
        usedPercent: 55,
      }),
      usageTopUpActivePurchase: fulfilledPurchase,
      usageTopUpContactOptions: [{
        href: "sms:+15555550100?body=Hey%20Murph%2C%20I%20just%20added%20more%20usage.",
        kind: "text" as const,
        label: "Messages",
      }],
      usageTopUpInitialOpen: true,
    }));

    assert.match(markup, /Usage added/);
    assert.match(markup, /55% used/);
    assert.match(markup, /45% remaining/);
    assert.match(markup, /Text Murph/);
    assert.match(
      markup,
      /sms:\+15555550100\?body=Hey%20Murph%2C%20I%20just%20added%20more%20usage\./,
    );
    assert.match(markup, /aria-label="Text Murph in Messages"/);

    const withoutContactMarkup = renderToStaticMarkup(
      createElement(HostedBillingSettings, {
        payerMemberId: TEST_PAYER_MEMBER_ID,
        authenticated: true,
        usageStatus: buildUsageStatus(),
        usageTopUpActivePurchase: fulfilledPurchase,
        usageTopUpInitialOpen: true,
      }),
    );

    assert.match(withoutContactMarkup, /Usage added/);
    assert.doesNotMatch(withoutContactMarkup, /Text Murph/);
  });

  test("offers the same top-up primitive to a direct paid Edge member", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      usageStatus: buildUsageStatus({
        planCode: "launch_edge_monthly",
        planName: "Edge",
      }),
      usageTopUpOffers: [{
        amountLabel: "$5",
        estimatedMessages: 100,
        offerCode: "usage_5_usd",
      }],
    }));

    assert.match(markup, /aria-label="Edge AI usage"/);
    assert.match(markup, /Add usage/);
  });

  test("keeps unavailable and forecast-free usage states honest", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const unavailableMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      usageStatus: {
        generatedAt: "2026-07-10T12:00:00.000Z",
        reason: "group_not_supported",
        recommendedAction: null,
        status: "unavailable",
      },
    }));
    const noForecastMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      usageStatus: buildUsageStatus(),
    }));

    assert.doesNotMatch(unavailableMarkup, /AI usage/);
    assert.doesNotMatch(noForecastMarkup, /recent pace/);
  });

  test("shows only the actionable unavailable trial conversion state", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const conversionMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canStartPaidPulse: true,
      usageStatus: {
        generatedAt: "2026-07-10T12:00:00.000Z",
        reason: "trial_conversion_pending",
        recommendedAction: {
          kind: "start_pulse",
          label: "Start Pulse from usage",
          url: "https://example.test/settings#subscription",
        },
        status: "unavailable",
      },
    }));
    const groupMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canStartPaidPulse: true,
      usageStatus: {
        generatedAt: "2026-07-10T12:00:00.000Z",
        reason: "group_not_supported",
        recommendedAction: null,
        status: "unavailable",
      },
    }));
    const actionFreeConversionMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canStartPaidPulse: true,
      usageStatus: {
        generatedAt: "2026-07-10T12:00:00.000Z",
        reason: "trial_conversion_pending",
        recommendedAction: null,
        status: "unavailable",
      },
    }));

    assert.match(conversionMarkup, /Trial ended/);
    assert.match(conversionMarkup, /Start Pulse from usage/);
    assert.match(actionFreeConversionMarkup, /Trial ended/);
    assert.doesNotMatch(actionFreeConversionMarkup, /Start Pulse/);
    assert.doesNotMatch(groupMarkup, /AI usage/);
  });

  test("shows usage actions only from the server-projected descriptor", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");
    const startAction = buildUsageStatus({
      accessKind: "trial",
      planName: "Pulse Trial",
      recommendedAction: {
        kind: "start_pulse",
        label: "Start Pulse from usage",
        url: "https://example.test/settings#subscription",
      },
    });
    const upgradeAction = buildUsageStatus({
      recommendedAction: {
        kind: "upgrade_edge",
        label: "Upgrade from usage",
        url: "https://example.test/settings#subscription",
      },
    });

    const eligibleStartMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canStartPaidPulse: true,
      usageStatus: startAction,
    }));
    const ineligibleStartMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canStartPaidPulse: false,
      usageStatus: startAction,
    }));
    const eligibleUpgradeMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canUpgradeToEdge: true,
      usageStatus: upgradeAction,
    }));
    const ineligibleUpgradeMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canUpgradeToEdge: false,
      usageStatus: upgradeAction,
    }));

    assert.match(eligibleStartMarkup, /Start Pulse from usage/);
    assert.match(ineligibleStartMarkup, /Start Pulse from usage/);
    assert.match(eligibleUpgradeMarkup, /Upgrade from usage/);
    assert.match(ineligibleUpgradeMarkup, /Upgrade from usage/);
  });

  test("keeps an active trial on the server-selected trial-end path", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const rendered = await renderClientComponent(createElement(
      HostedBillingSettings,
      {
        authenticated: true,
        usageStatus: buildUsageStatus({
          accessKind: "trial",
          periodKind: "trial",
          planName: "Pulse Trial",
          recommendedAction: {
            kind: "change_plan",
            label: "Keep Pulse from usage",
            targetPlanCode: "launch_monthly",
            url: "https://example.test/settings#subscription",
          },
          subscriptionActionQuote: buildSubscriptionActionQuote({
            label: "Keep Pulse from usage",
            targetPlanCode: "launch_monthly",
            timing: "at_trial_end",
          }),
        }),
      },
    ));

    const actionButton = findButtonByText(
      rendered.window.document,
      "Keep Pulse from usage",
      rendered.window,
    );
    await act(async () => {
      actionButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Your current trial continues/,
    );

    const confirmButton = findLastButtonByText(
      rendered.window.document,
      "Keep Pulse",
      rendered.window,
    );
    await act(async () => {
      confirmButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    assert.deepEqual(
      mocks.requestHostedTrialPlanStartPaid.mock.calls[0]?.[0],
      {
        targetPlanCode: "launch_monthly",
        timing: "at_trial_end",
      },
    );
    assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 0);
    await rendered.cleanup();
  });

  test("uses the immediate paid endpoint selected by the usage status", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const rendered = await renderClientComponent(createElement(
      HostedBillingSettings,
      {
        authenticated: true,
        usageStatus: buildUsageStatus({
          planCode: "launch_group_monthly",
          planName: "Group",
          recommendedAction: {
            kind: "change_plan",
            label: "Start Pulse now from usage",
            targetPlanCode: "launch_monthly",
            url: "https://example.test/settings#subscription",
          },
          subscriptionActionQuote: buildSubscriptionActionQuote({
            label: "Start Pulse now from usage",
            targetPlanCode: "launch_monthly",
            timing: "immediate",
          }),
        }),
      },
    ));

    const actionButton = findButtonByText(
      rendered.window.document,
      "Start Pulse now from usage",
      rendered.window,
    );
    await act(async () => {
      actionButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });
    const confirmButton = findLastButtonByText(
      rendered.window.document,
      "Confirm upgrade",
      rendered.window,
    );
    await act(async () => {
      confirmButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    assert.deepEqual(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0], {
      method: "POST",
      payload: {
        targetPlanCode: "launch_monthly",
      },
      url: "/api/settings/billing/upgrade-plan",
    });
    assert.equal(mocks.requestHostedTrialPlanStartPaid.mock.calls.length, 0);
    await rendered.cleanup();
  });

  test("uses the period-end paid endpoint selected by the usage status", async () => {
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      effectiveAt: "2026-08-01T00:00:00.000Z",
      scheduledBillingPlanCode: "launch_group_monthly",
      status: "scheduled",
    });
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const rendered = await renderClientComponent(createElement(
      HostedBillingSettings,
      {
        authenticated: true,
        usageStatus: buildUsageStatus({
          recommendedAction: {
            kind: "change_plan",
            label: "Choose Group next month from usage",
            targetPlanCode: "launch_group_monthly",
            url: "https://example.test/settings#subscription",
          },
          subscriptionActionQuote: buildSubscriptionActionQuote({
            label: "Choose Group next month from usage",
            targetPlanCode: "launch_group_monthly",
            timing: "period_end",
          }),
        }),
      },
    ));

    const actionButton = findButtonByText(
      rendered.window.document,
      "Choose Group next month from usage",
      rendered.window,
    );
    await act(async () => {
      actionButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /current plan continues through Aug 1, 2026/,
    );
    const confirmButton = findLastButtonByText(
      rendered.window.document,
      "Confirm switch",
      rendered.window,
    );
    await act(async () => {
      confirmButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    assert.deepEqual(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0], {
      method: "POST",
      payload: {
        targetPlanCode: "launch_group_monthly",
      },
      url: "/api/settings/billing/switch-plan",
    });
    assert.equal(mocks.requestHostedTrialPlanStartPaid.mock.calls.length, 0);
    await rendered.cleanup();
  });

  test("suppresses a plan change when the signed quote targets another plan", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(
      HostedBillingSettings,
      {
        authenticated: true,
        usageStatus: buildUsageStatus({
          recommendedAction: {
            kind: "change_plan",
            label: "Choose Group next month from usage",
            targetPlanCode: "launch_group_monthly",
            url: "https://example.test/settings#subscription",
          },
          subscriptionActionQuote: buildSubscriptionActionQuote({
            label: "Keep Pulse",
            targetPlanCode: "launch_monthly",
            timing: "period_end",
          }),
        }),
      },
    ));

    assert.doesNotMatch(markup, /Choose Group next month from usage/);
  });

  test("shows the Pulse trial start action inline for Pulse trial members", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canStartPaidPulse: true,
      canUpgradeToEdge: false,
      currentBillingPhase: "trial",
      currentCheckoutOffer: "pulse_trial_7d",
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Start Pulse plan/);
    assert.doesNotMatch(markup, /Upgrade to Edge/);
  });

  test("suppresses every Start Pulse action with action-neutral copy while continuation is pending", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");
    const usageStatus = buildUsageStatus({
      accessKind: "trial",
      planName: "Pulse Trial",
      recommendedAction: {
        kind: "start_pulse",
        label: "Start Pulse from usage",
        url: "https://example.test/settings#subscription",
      },
    });

    const availableMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canStartPaidPulse: true,
      currentBillingPhase: "trial",
      currentCheckoutOffer: "pulse_trial_7d",
      currentBillingPlanCode: "launch_monthly",
      pulseTrialBillingContinuationPending: true,
      usageStatus,
    }));
    const unavailableMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canStartPaidPulse: true,
      pulseTrialBillingContinuationPending: true,
      usageStatus: {
        generatedAt: "2026-07-10T12:00:00.000Z",
        reason: "trial_conversion_pending",
        recommendedAction: usageStatus.recommendedAction,
        status: "unavailable",
      },
    }));

    assert.doesNotMatch(availableMarkup, /Start Pulse (?:plan|from usage)/);
    assert.doesNotMatch(unavailableMarkup, /Start Pulse from usage/);
    assert.match(unavailableMarkup, /Finishing your Pulse update/);
  });

  test("does not render Pulse trial affordances for a non-Pulse trial-shaped phase", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canStartPaidPulse: false,
      canUpgradeToEdge: false,
      currentBillingPhase: "trial",
      currentCheckoutOffer: "standard",
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Pulse/);
    assert.match(markup, /Current plan/);
    assert.doesNotMatch(markup, /Start Pulse plan/);
  });

  test("shows the Family card as current for the family owner", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      familyState: "owner",
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Family/);
    assert.match(markup, /Current plan/);
    assert.doesNotMatch(markup, /Start Family/);
  });

  test("routes family-plan owners through Family billing before choosing individual plans", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canSwitchToPulse: true,
      canUpgradeToEdge: true,
      familyState: "owner",
      currentBillingPlanCode: "launch_edge_monthly",
    }));

    assert.match(markup, /Manage Family billing/);
    assert.match(markup, /family members lose their included access/);
    assert.match(markup, /End or change the Family plan first/);
    assert.doesNotMatch(markup, />Choose Pulse</);
    assert.doesNotMatch(markup, />Choose Edge</);
  });

  test("does not offer billing management to sponsored Family members", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      familyState: "sponsored",
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Sponsored/);
    assert.match(markup, /Billing is managed by your Family plan owner/);
    assert.doesNotMatch(markup, /Manage billing/);
  });

  test("offers the Family start action to an eligible member", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canStartFamily: true,
      familyState: "none",
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Choose Family/);
    assert.match(markup, /Choose Pulse or Edge for each person/);
    assert.match(markup, /From \$7\/person/);
  });

  test("shows the switch-to-Pulse action on the Pulse card for Edge members", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canSwitchToPulse: true,
      canUpgradeToEdge: false,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentPeriodEnd: new Date("2026-05-06T12:00:00.000Z"),
    }));

    assert.match(markup, /Edge/);
    assert.match(markup, /Current plan/);
    assert.match(markup, /Choose Pulse/);
    assert.doesNotMatch(markup, /Upgrade to Edge/);
  });

  test("renders a pending Pulse switch without another switch action", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      authenticated: true,
      canSwitchToPulse: true,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentPeriodEnd: new Date("2026-05-06T12:00:00.000Z"),
      scheduledBillingEffectiveAt: new Date("2026-05-06T12:00:00.000Z"),
      scheduledBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Edge/);
    assert.match(markup, /Scheduled to start May 6, 2026/);
    assert.match(markup, /Pulse starts May 6, 2026/);
    assert.match(markup, /Edge stays active until then/);
    assert.match(markup, /Change scheduled plan/);
    assert.doesNotMatch(markup, /Switch to Pulse</);
  });

  test("posts the Edge upgrade request and refreshes on success", async () => {
    const { UpgradeToEdgeButton } = await import("@/src/components/settings/hosted-plan-upgrade-button");
    const rendered = await renderClientComponent(createElement(UpgradeToEdgeButton));

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 0);
    assert.match(rendered.window.document.body.textContent ?? "", /For when you want the full picture\./);
    assert.match(rendered.window.document.body.textContent ?? "", /\$20\/ month/);

    const confirmButton = findLastButtonByText(rendered.window.document, "Upgrade to Edge", rendered.window);
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.deepEqual(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0], {
      method: "POST",
      payload: {
        targetPlanCode: "launch_edge_monthly",
      },
      url: "/api/settings/billing/upgrade-plan",
    });
    assert.equal(mocks.routerRefresh.mock.calls.length, 1);
    assert.equal(rendered.assign.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("posts the Pulse switch request and refreshes on success", async () => {
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      effectiveAt: "2026-05-06T12:00:00.000Z",
      scheduledBillingPlanCode: "launch_monthly",
      status: "scheduled",
    });
    const { SwitchToPulseButton } = await import("@/src/components/settings/hosted-plan-switch-to-pulse-button");
    const rendered = await renderClientComponent(createElement(SwitchToPulseButton, {
      currentPeriodEnd: "2026-05-06T12:00:00.000Z",
    }));

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 0);
    assert.match(rendered.window.document.body.textContent ?? "", /You keep Edge through May 6, 2026, then Pulse at \$8\/mo\./);
    assert.match(rendered.window.document.body.textContent ?? "", /Edge/);
    assert.match(rendered.window.document.body.textContent ?? "", /Pulse/);
    assert.match(rendered.window.document.body.textContent ?? "", /\$20\/mo/);
    assert.match(rendered.window.document.body.textContent ?? "", /\$8\/mo/);

    const confirmButton = findButtonByText(rendered.window.document, "Confirm switch", rendered.window);
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.deepEqual(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0], {
      method: "POST",
      url: "/api/settings/billing/switch-to-pulse",
    });
    assert.equal(mocks.routerRefresh.mock.calls.length, 1);

    await rendered.cleanup();
  });

  test("posts the Start Pulse request without a body and refreshes on success", async () => {
    mocks.requestHostedPulseTrialStartPaid.mockResolvedValueOnce({
      status: "started",
    });
    const { StartPaidPulseButton } = await import("@/src/components/settings/hosted-start-paid-pulse-button");
    const rendered = await renderClientComponent(createElement(StartPaidPulseButton));

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 0);
    assert.match(rendered.window.document.body.textContent ?? "", /Start Pulse plan/);
    assert.match(rendered.window.document.body.textContent ?? "", /Your trial ends now and Pulse begins at \$8\/month/);
    assert.match(rendered.window.document.body.textContent ?? "", /\$8\/ month/);

    const confirmButton = findLastButtonByText(rendered.window.document, "Start Pulse", rendered.window);
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(mocks.requestHostedPulseTrialStartPaid.mock.calls.length, 1);
    assert.equal(mocks.routerRefresh.mock.calls.length, 1);
    assert.equal(rendered.assign.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("keeps the Start Pulse confirmation open while billing is pending", async () => {
    mocks.requestHostedPulseTrialStartPaid.mockResolvedValueOnce({
      status: "billing_pending",
    });
    const { StartPaidPulseButton } = await import("@/src/components/settings/hosted-start-paid-pulse-button");
    const rendered = await renderClientComponent(createElement(StartPaidPulseButton));

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    const confirmButton = findLastButtonByText(rendered.window.document, "Start Pulse", rendered.window);
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.match(rendered.window.document.body.textContent ?? "", /Billing is still finishing/);
    assert.match(rendered.window.document.body.textContent ?? "", /Check status/);
    assert.equal(mocks.routerRefresh.mock.calls.length, 1);
    assert.equal(rendered.assign.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("redirects to the hosted invoice when Start Pulse needs payment confirmation", async () => {
    mocks.requestHostedPulseTrialStartPaid.mockResolvedValueOnce({
      status: "redirecting",
    });
    const { StartPaidPulseButton } = await import("@/src/components/settings/hosted-start-paid-pulse-button");
    const rendered = await renderClientComponent(createElement(StartPaidPulseButton));

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    const confirmButton = findLastButtonByText(rendered.window.document, "Start Pulse", rendered.window);
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(mocks.routerRefresh.mock.calls.length, 0);
    assert.equal(mocks.requestHostedPulseTrialStartPaid.mock.calls.length, 1);
    assert.equal(rendered.assign.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("shows and confirms start-now timing without posting on render", async () => {
    mocks.requestHostedPulseTrialContinuation.mockResolvedValueOnce({
      status: "started",
    });
    const { PulseTrialBillingContinuation } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-button"
    );
    const rendered = await renderClientComponent(
      createElement(PulseTrialBillingContinuation, {
        action: "start_pulse_now",
      }),
      { requireButton: false },
    );

    assert.equal(mocks.requestHostedPulseTrialContinuation.mock.calls.length, 0);
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Start paid Pulse now\?/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /trial will end and paid Pulse billing will begin now at \$8\/month/,
    );

    const confirmButton = findLastButtonByText(
      rendered.window.document,
      "End trial and start Pulse",
      rendered.window,
    );
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });

    assert.deepEqual(mocks.requestHostedPulseTrialContinuation.mock.calls, [[{
      action: "start_pulse_now",
      redirectIfPaymentRequired: false,
    }]]);
    assert.deepEqual(mocks.routerReplace.mock.calls, [["/settings#subscription"]]);
    assert.equal(mocks.routerRefresh.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("checks an active continue return without mutating billing and shows a receipt", async () => {
    mocks.requestHostedPulseTrialContinuation.mockResolvedValueOnce({
      status: "continuing",
    });
    const { PulseTrialBillingContinuation } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-button"
    );
    const rendered = await renderClientComponent(
      createElement(PulseTrialBillingContinuation, {
        action: "continue_pulse",
      }),
      { requireButton: false },
    );

    await act(async () => {
      await Promise.resolve();
    });

    assert.deepEqual(mocks.requestHostedPulseTrialContinuation.mock.calls, [[{
      action: "continue_pulse",
      redirectIfPaymentRequired: false,
    }]]);
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Your Pulse trial is set/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /current trial continues as scheduled/,
    );
    assert.doesNotMatch(
      rendered.window.document.body.textContent ?? "",
      /Not now/,
    );
    assert.equal(mocks.routerReplace.mock.calls.length, 0);

    const doneButton = findLastButtonByText(
      rendered.window.document,
      "Done",
      rendered.window,
    );
    await act(async () => {
      doneButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.deepEqual(mocks.routerReplace.mock.calls, [["/settings#subscription"]]);

    await rendered.cleanup();
  });

  test("shows a paid-plan receipt when the trial converted before the return", async () => {
    mocks.requestHostedPulseTrialContinuation.mockResolvedValueOnce({
      status: "started",
    });
    const { PulseTrialBillingContinuation } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-button"
    );
    const rendered = await renderClientComponent(
      createElement(PulseTrialBillingContinuation, {
        action: "continue_pulse",
      }),
      { requireButton: false },
    );

    await act(async () => {
      await Promise.resolve();
    });

    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Your Pulse plan is active/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /paid Pulse is active at \$8\/month/,
    );
    assert.doesNotMatch(
      rendered.window.document.body.textContent ?? "",
      /Start Pulse/,
    );
    assert.equal(mocks.routerReplace.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("dismisses a recovered Pulse choice without invoking billing", async () => {
    const { PulseTrialBillingContinuation } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-button"
    );
    const rendered = await renderClientComponent(
      createElement(PulseTrialBillingContinuation, {
        action: "start_pulse_now",
      }),
      { requireButton: false },
    );

    const dismissButton = findLastButtonByText(
      rendered.window.document,
      "Not now",
      rendered.window,
    );
    await act(async () => {
      dismissButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(mocks.requestHostedPulseTrialContinuation.mock.calls.length, 0);
    assert.deepEqual(mocks.routerReplace.mock.calls, [["/settings#subscription"]]);
    assert.equal(rendered.window.document.body.textContent, "");

    await rendered.cleanup();
  });

  test("does not redirect back to Stripe until the member explicitly retries", async () => {
    mocks.requestHostedPulseTrialContinuation
      .mockResolvedValueOnce({
        status: "payment_required",
      })
      .mockResolvedValueOnce({
        status: "continuing",
      });
    const { PulseTrialBillingContinuation } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-button"
    );
    const rendered = await renderClientComponent(
      createElement(PulseTrialBillingContinuation, {
        action: "continue_pulse",
      }),
      { requireButton: false },
    );

    await act(async () => {
      await Promise.resolve();
    });

    assert.match(
      rendered.window.document.body.textContent ?? "",
      /payment method is still being confirmed/i,
    );
    assert.equal(mocks.routerReplace.mock.calls.length, 0);
    assert.equal(mocks.routerRefresh.mock.calls.length, 0);

    const retryButton = findLastButtonByText(
      rendered.window.document,
      "Check again",
      rendered.window,
    );
    await act(async () => {
      retryButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });

    assert.deepEqual(mocks.requestHostedPulseTrialContinuation.mock.calls, [
      [{
        action: "continue_pulse",
        redirectIfPaymentRequired: false,
      }],
      [{
        action: "continue_pulse",
        redirectIfPaymentRequired: true,
      }],
    ]);
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Your Pulse trial is set/,
    );
    assert.equal(mocks.routerReplace.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("sends an ended continue return to a fresh start-now choice", async () => {
    const { HostedOnboardingApiError } = await import(
      "@/src/components/hosted-onboarding/client-api"
    );
    mocks.requestHostedPulseTrialContinuation.mockRejectedValueOnce(
      new HostedOnboardingApiError({
        code: "HOSTED_PULSE_TRIAL_CONTINUE_REQUIRES_START",
        message:
          "Your Pulse trial has ended. Review the plan before starting paid Pulse.",
      }),
    );
    const { PulseTrialBillingContinuation } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-button"
    );
    const rendered = await renderClientComponent(
      createElement(PulseTrialBillingContinuation, {
        action: "continue_pulse",
      }),
      { requireButton: false },
    );

    await act(async () => {
      await Promise.resolve();
    });

    assert.deepEqual(mocks.requestHostedPulseTrialContinuation.mock.calls, [[{
      action: "continue_pulse",
      redirectIfPaymentRequired: false,
    }]]);
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Your trial has ended/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Paid Pulse was not started from this return/,
    );
    assert.equal(mocks.routerReplace.mock.calls.length, 0);
    assert.doesNotMatch(
      rendered.window.document.body.textContent ?? "",
      /Continue after trial/,
    );

    const gotItButton = findLastButtonByText(
      rendered.window.document,
      "Got it",
      rendered.window,
    );
    await act(async () => {
      gotItButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.deepEqual(mocks.routerReplace.mock.calls, [["/settings#subscription"]]);

    await rendered.cleanup();
  });

  test("keeps a changed-choice notice visible until acknowledgment", async () => {
    const { HostedOnboardingApiError } = await import(
      "@/src/components/hosted-onboarding/client-api"
    );
    mocks.requestHostedPulseTrialContinuation.mockRejectedValueOnce(
      new HostedOnboardingApiError({
        code: "HOSTED_PULSE_TRIAL_CONTINUATION_CHANGED",
        message:
          "This Pulse choice changed in another tab. Continue from the latest return.",
      }),
    );
    const { PulseTrialBillingContinuation } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-button"
    );
    const rendered = await renderClientComponent(
      createElement(PulseTrialBillingContinuation, {
        action: "continue_pulse",
      }),
      { requireButton: false },
    );

    await act(async () => {
      await Promise.resolve();
    });

    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Your Pulse choice changed/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Continue from the latest return/,
    );
    assert.equal(mocks.routerReplace.mock.calls.length, 0);

    const gotItButton = findLastButtonByText(
      rendered.window.document,
      "Got it",
      rendered.window,
    );
    await act(async () => {
      gotItButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.deepEqual(mocks.routerReplace.mock.calls, [["/settings#subscription"]]);

    await rendered.cleanup();
  });

  test("returns to ordinary Settings when the continuation claim is terminal", async () => {
    const { HostedOnboardingApiError } = await import(
      "@/src/components/hosted-onboarding/client-api"
    );
    mocks.requestHostedPulseTrialContinuation.mockRejectedValueOnce(
      new HostedOnboardingApiError({
        code: "HOSTED_PULSE_TRIAL_CONTINUATION_INVALID",
        message: "Your Pulse confirmation expired. Try again.",
      }),
    );
    const { PulseTrialBillingContinuation } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-button"
    );
    const rendered = await renderClientComponent(
      createElement(PulseTrialBillingContinuation, {
        action: "start_pulse_now",
      }),
      { requireButton: false },
    );

    const confirmButton = findLastButtonByText(
      rendered.window.document,
      "End trial and start Pulse",
      rendered.window,
    );
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });

    assert.deepEqual(mocks.routerReplace.mock.calls, [["/settings#subscription"]]);
    assert.doesNotMatch(
      rendered.window.document.body.textContent ?? "",
      /Try again/,
    );

    await rendered.cleanup();
  });

  test("refreshes Settings automatically while started billing is settling", async () => {
    vi.useFakeTimers();
    mocks.requestHostedPulseTrialContinuation.mockResolvedValueOnce({
      status: "billing_pending",
    });
    const { PulseTrialBillingContinuation } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-button"
    );
    const rendered = await renderClientComponent(
      createElement(PulseTrialBillingContinuation, {
        action: "start_pulse_now",
      }),
      { requireButton: false },
    );

    const confirmButton = findLastButtonByText(
      rendered.window.document,
      "End trial and start Pulse",
      rendered.window,
    );
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Checking billing status/,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    assert.deepEqual(mocks.routerReplace.mock.calls, [["/settings#subscription"]]);
    assert.equal(mocks.routerRefresh.mock.calls.length, 0);

    await rendered.cleanup();
    vi.useRealTimers();
  });

  test("redirects to Stripe when the upgrade needs payment confirmation", async () => {
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://stripe.example.test/portal/session_123",
      status: "pending_payment",
    });

    const { UpgradeToEdgeButton } = await import("@/src/components/settings/hosted-plan-upgrade-button");
    const rendered = await renderClientComponent(createElement(UpgradeToEdgeButton));

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    const confirmButton = findLastButtonByText(rendered.window.document, "Upgrade to Edge", rendered.window);
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(mocks.routerRefresh.mock.calls.length, 0);
    assert.deepEqual(rendered.assign.mock.calls[0], [
      "https://stripe.example.test/portal/session_123",
    ]);

    await rendered.cleanup();
  });
});

function findButtonByText(
  document: Document,
  text: string,
  window: Window & typeof globalThis,
): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes(text));
  assert.ok(button instanceof window.HTMLButtonElement);
  return button;
}

function findLastButtonByText(
  document: Document,
  text: string,
  window: Window & typeof globalThis,
): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")]
    .filter((candidate) => candidate.textContent?.includes(text))
    .at(-1);
  assert.ok(button instanceof window.HTMLButtonElement);
  return button;
}
