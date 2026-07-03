import assert from "node:assert/strict";

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
  requestHostedPulseTrialStartPaid: vi.fn(),
  routerRefresh: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  requestHostedPulseTrialStartPaid: mocks.requestHostedPulseTrialStartPaid,
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({
    authenticated: true,
    openAuthDialog: () => {},
  }),
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
  });

  test("renders the plan grid with the current plan, Family, and portal link", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
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

  test("shows the Pulse trial start action inline for Pulse trial members", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
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

  test("does not render Pulse trial affordances for a non-Pulse trial-shaped phase", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
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
      authenticated: true,
      familyState: "owner",
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Family/);
    assert.match(markup, /Current plan/);
    assert.doesNotMatch(markup, /Start Family/);
  });

  test("routes Family owners through Family billing before choosing individual plans", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      canSwitchToPulse: true,
      canUpgradeToEdge: true,
      familyState: "owner",
      currentBillingPlanCode: "launch_edge_monthly",
    }));

    assert.match(markup, /Manage Family billing/);
    assert.match(markup, /family members lose their included access/);
    assert.match(markup, /End or change the Family plan first/);
    assert.doesNotMatch(markup, /Choose Pulse/);
    assert.doesNotMatch(markup, /Choose Edge/);
  });

  test("does not offer billing management to sponsored Family members", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
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
      authenticated: true,
      canStartFamily: true,
      familyState: "none",
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Choose Family/);
  });

  test("shows the switch-to-Pulse action on the Pulse card for Edge members", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
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
    assert.match(markup, /Switching to Pulse on May 6, 2026/);
    assert.match(markup, /Want to keep Edge\? Contact support/);
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
    assert.match(rendered.window.document.body.textContent ?? "", /Your trial ends and Pulse begins at \$8\/mo\./);
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

  test("redirects to Stripe Billing Portal when the upgrade needs payment confirmation", async () => {
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      billingPlanCode: "launch_monthly",
      billingPortalUrl: "https://stripe.example.test/portal/session_123",
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
