import assert from "node:assert/strict";

import type { HostedPlanUsageAvailableStatus } from "@murphai/hosted-execution/plan-usage";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test, vi } from "vitest";

vi.mock("@/src/components/settings/hosted-plan-checkout-button", () => ({
  HostedPlanCheckoutButton: (props: {
    children?: React.ReactNode;
    targetPlanCode: string;
  }) => createElement(
    "button",
    { "data-checkout-plan": props.targetPlanCode },
    props.children,
  ),
}));

vi.mock("@/src/components/settings/billing-portal-button", () => ({
  BillingPortalButton: (props: { label?: string }) =>
    createElement("button", null, props.label ?? "Manage billing"),
}));

vi.mock("@/src/components/settings/hosted-family-start-button", () => ({
  HostedFamilyStartButton: (props: { label?: string }) =>
    createElement("button", null, props.label ?? "Choose Family"),
}));

vi.mock("@/src/components/settings/hosted-plan-change-button", () => ({
  HostedPlanChangeButton: (props: { children?: React.ReactNode }) =>
    createElement("button", null, props.children),
}));

vi.mock("@/src/components/settings/hosted-plan-switch-to-pulse-button", () => ({
  SwitchToPulseButton: (props: { children?: React.ReactNode }) =>
    createElement("button", null, props.children),
}));

vi.mock("@/src/components/settings/hosted-plan-upgrade-button", () => ({
  UpgradeToEdgeButton: (props: { children?: React.ReactNode }) =>
    createElement("button", null, props.children),
}));

vi.mock("@/src/components/settings/hosted-usage-top-up-dialog", () => ({
  HostedUsageTopUpDialog: (props: { offers: readonly unknown[] }) =>
    props.offers.length > 0
      ? createElement("button", null, "Add usage")
      : null,
}));

vi.mock("@/src/components/support/contact-support-action", () => ({
  ContactSupportAction: (props: { children?: React.ReactNode }) =>
    createElement("button", null, props.children),
}));

function buildStarterStatus(
  overrides: Partial<HostedPlanUsageAvailableStatus> = {},
): HostedPlanUsageAvailableStatus {
  return {
    accessKind: "starter",
    forecast: null,
    generatedAt: "2026-08-07T20:00:00.000Z",
    periodEnd: "2026-09-01T00:00:00.000Z",
    periodKind: "lifetime",
    periodStart: "2026-08-01T00:00:00.000Z",
    planCode: "launch_monthly",
    planName: "Starter",
    recommendedAction: null,
    remainingPercent: 75,
    status: "active",
    usedPercent: 25,
    ...overrides,
  };
}

describe("HostedBillingSettings", () => {
  test("presents Starter as non-expiring and starts paid plans through Checkout", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      billingStatus: "active",
      canStartDirectPlan: true,
      usageStatus: buildStarterStatus(),
    }));

    assert.match(markup, /non-expiring starter usage is active/i);
    assert.match(markup, /Starter · Does not expire/);
    assert.match(markup, /data-checkout-plan="launch_monthly"/);
    assert.match(markup, /data-checkout-plan="launch_edge_monthly"/);
    assert.doesNotMatch(markup, /trial|days? left|expires/i);
    assert.doesNotMatch(markup, /recent pace|run out in about|days? remaining/i);
  });

  test("explains exhaustion without inventing a time-based reset", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      billingStatus: "active",
      canStartDirectPlan: true,
      usageTopUpOffers: [
        { amountLabel: "$5", offerCode: "usage_5_usd" },
      ],
      usageStatus: buildStarterStatus({
        remainingPercent: 0,
        status: "exhausted",
        usedPercent: 100,
      }),
    }));

    assert.match(markup, /used your starter usage/i);
    assert.match(markup, /choose a monthly plan/i);
    assert.match(markup, /Does not expire/);
    assert.doesNotMatch(markup, /Add usage/i);
    assert.doesNotMatch(markup, /resets? /i);
  });

  test("marks a paid Pulse subscription as the current plan", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      billingStatus: "active",
      canManageBilling: true,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Current plan/);
    assert.match(markup, /Manage billing/);
    assert.doesNotMatch(markup, /non-expiring starter usage/i);
  });

  test.each([
    "paused",
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
  ] as const)(
    "keeps %s existing billing on the portal recovery path",
    async (billingStatus) => {
      const { HostedBillingSettings } = await import(
        "@/src/components/settings/hosted-billing-settings"
      );
      const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
        authenticated: true,
        billingStatus,
        canManageBilling: true,
        canStartDirectPlan: false,
      }));

      assert.match(markup, /Manage billing/);
      assert.doesNotMatch(markup, /data-checkout-plan=/);
    },
  );

  test.each(["not_started", "incomplete"] as const)(
    "keeps %s first-time billing on direct Checkout",
    async (billingStatus) => {
      const { HostedBillingSettings } = await import(
        "@/src/components/settings/hosted-billing-settings"
      );
      const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
        authenticated: true,
        billingStatus,
        canManageBilling: false,
        canStartDirectPlan: true,
      }));

      assert.match(markup, /data-checkout-plan="launch_monthly"/);
      assert.doesNotMatch(markup, /Manage billing/);
    },
  );


  test("lets Starter choose Max directly when the configured plan is visible", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      billingStatus: "active",
      canStartDirectPlan: true,
      showMaxPlan: true,
      usageStatus: buildStarterStatus(),
    }));

    assert.match(markup, /data-checkout-plan="launch_max_monthly"/);
    assert.match(markup, />Max</);
    assert.match(markup, /\$50/);
  });

  test("renders Max and an exact Edge-to-Max upgrade only when authorized", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );

    const hiddenMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
    }));
    const availableMarkup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      billingStatus: "active",
      canUpgradeToMax: true,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      showMaxPlan: true,
    }));

    assert.doesNotMatch(hiddenMarkup, />Max</);
    assert.match(availableMarkup, />Max</);
    assert.match(availableMarkup, /\$50/);
    assert.match(availableMarkup, /Highest included monthly AI usage/);
    assert.match(availableMarkup, /Choose Max/);
  });

  test("does not route unauthorized paid members to generic Max billing", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      billingStatus: "active",
      canManageBilling: true,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      showMaxPlan: true,
    }));

    assert.match(markup, />Max</);
    assert.doesNotMatch(markup, /Choose Max/);
  });

  test("uses exact period-end actions for Max downgrades", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      billingStatus: "active",
      canSwitchToEdge: true,
      canSwitchToPulse: true,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_max_monthly",
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      showMaxPlan: true,
    }));

    assert.match(markup, /Max/);
    assert.match(markup, /Current plan/);
    assert.match(markup, /Choose Edge/);
    assert.match(markup, /Choose Pulse/);
    assert.doesNotMatch(markup, /Choose Max/);
  });

  test("keeps one recovery owner for a scheduled Max-to-Edge downgrade", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_max_monthly",
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      scheduledBillingEffectiveAt: new Date("2026-09-01T00:00:00.000Z"),
      scheduledBillingPlanCode: "launch_edge_monthly",
      showMaxPlan: true,
    }));

    assert.match(markup, /Edge starts Sep 1, 2026/);
    assert.match(markup, /Max stays active until then/);
    assert.match(markup, /Scheduled to start Sep 1, 2026/);
    assert.equal(
      (markup.match(/Change scheduled plan/g) ?? []).length,
      1,
      "exactly one scheduled-plan recovery action",
    );
  });

  test("does not expose Max inside Family billing", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      familyState: "owner",
      showMaxPlan: true,
    }));

    assert.doesNotMatch(markup, />Max</);
    assert.match(markup, /Manage Family billing/);
    assert.match(markup, /End or change the Family plan first/);
  });

  test("does not expose plan mutations while projection is pending", async () => {
    const { HostedBillingSettings } = await import(
      "@/src/components/settings/hosted-billing-settings"
    );
    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      billingStatus: "active",
      canStartDirectPlan: true,
      planChangePending: true,
      usageStatus: buildStarterStatus(),
    }));

    assert.doesNotMatch(markup, /data-checkout-plan=/);
  });
});
