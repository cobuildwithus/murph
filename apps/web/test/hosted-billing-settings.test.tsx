import assert from "node:assert/strict";

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
  routerRefresh: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
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
  });

  test("renders the self-serve billing portal action", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      canUpgradeToEdge: true,
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Manage subscription/);
    assert.match(markup, /Pulse/);
    assert.doesNotMatch(markup, /Upgrade to Edge/);
    assert.doesNotMatch(markup, /You&#x27;re on a free trial/);
  });

  test("shows the Pulse trial plan and start action for Pulse trial members", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      canStartPaidPulse: true,
      canUpgradeToEdge: false,
      currentBillingPhase: "trial",
      currentCheckoutOffer: "pulse_trial_7d",
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.match(markup, /Manage subscription/);
    assert.match(markup, /Pulse trial/);
    assert.doesNotMatch(markup, /Start Pulse plan/);
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

    assert.match(markup, /Manage subscription/);
    assert.match(markup, /Pulse/);
    assert.doesNotMatch(markup, /Pulse trial/);
    assert.doesNotMatch(markup, /Start Pulse plan/);
    assert.doesNotMatch(markup, /You&#x27;re on a free trial/);
  });

  test("renders the free trial note beneath the billing action row", async () => {
    const { HostedBillingSettingsAction } = await import("@/src/components/settings/hosted-billing-settings-action");
    const rendered = await renderClientComponent(createElement(HostedBillingSettingsAction, {
      helperText: "You're on a free trial",
    }));

    const root = rendered.container.firstElementChild;
    assert.ok(root);
    assert.equal(root.tagName, "DIV");
    const [manageButton, helperRow] = [...root.children];
    assert.ok(manageButton);
    assert.equal(manageButton.tagName, "BUTTON");
    assert.ok(helperRow);
    assert.equal(helperRow.tagName, "P");
    assert.match(manageButton.textContent ?? "", /Manage subscription/);
    assert.equal(helperRow.textContent, "You're on a free trial");

    await rendered.cleanup();
  });

  test("omits the Edge upgrade action when settings already sees an Edge plan", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      canSwitchToPulse: true,
      canUpgradeToEdge: false,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentPeriodEnd: new Date("2026-05-06T12:00:00.000Z"),
    }));

    assert.doesNotMatch(markup, /Upgrade to Edge/);
    assert.match(markup, /Edge/);
    assert.match(markup, /Manage subscription/);
    assert.doesNotMatch(markup, /Switch to Pulse/);
    assert.doesNotMatch(markup, /You&#x27;re on a free trial/);
  });

  test("omits the Edge upgrade action when billing state is not eligible", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      canUpgradeToEdge: false,
      currentBillingPlanCode: "launch_monthly",
    }));

    assert.doesNotMatch(markup, /Upgrade to Edge/);
    assert.match(markup, /Pulse/);
    assert.match(markup, /Manage subscription/);
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
    assert.match(markup, /Pulse starts May 6, 2026 at \$8 \/ month/);
    assert.match(markup, /Manage subscription/);
    assert.match(markup, /Want to keep Edge\? Contact support/);
    assert.doesNotMatch(markup, /Switch to Pulse/);
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
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      billingPlanCode: "launch_monthly",
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

    assert.deepEqual(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0], {
      method: "POST",
      url: "/api/settings/billing/start-paid-pulse",
    });
    assert.equal(mocks.routerRefresh.mock.calls.length, 1);
    assert.equal(rendered.assign.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("keeps the Start Pulse confirmation open while billing is pending", async () => {
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      billingPlanCode: "launch_monthly",
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

  test("keeps the Settings Start Pulse modal open while billing is pending", async () => {
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });
    const { HostedBillingSettingsAction } = await import("@/src/components/settings/hosted-billing-settings-action");
    const rendered = await renderClientComponent(createElement(HostedBillingSettingsAction, {
      showStartPaidPulse: true,
    }));
    const manageButton = findButtonByText(rendered.window.document, "Manage subscription", rendered.window);

    await act(async () => {
      manageButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    const startPlanButton = findButtonByText(rendered.window.document, "Start Pulse plan", rendered.window);
    await act(async () => {
      startPlanButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
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
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_123",
      status: "payment_required",
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
    assert.deepEqual(rendered.assign.mock.calls[0], [
      "https://invoice.stripe.test/in_123",
    ]);

    await rendered.cleanup();
  });

  test("finishes Start Pulse from the Stripe payment-method return page", async () => {
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      billingPlanCode: "launch_monthly",
      status: "started",
    });
    const { HostedStartPaidPulseFinishAction } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-finish-action"
    );
    const rendered = await renderClientComponent(createElement(HostedStartPaidPulseFinishAction));

    assert.match(rendered.window.document.body.textContent ?? "", /Finish starting Pulse/);
    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.deepEqual(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0], {
      method: "POST",
      url: "/api/settings/billing/start-paid-pulse",
    });
    assert.deepEqual(mocks.routerReplace.mock.calls[0], ["/home"]);
    assert.equal(mocks.routerRefresh.mock.calls.length, 1);
    assert.equal(rendered.assign.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("keeps the Start Pulse return page open while billing is pending", async () => {
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });
    const { HostedStartPaidPulseFinishAction } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-finish-action"
    );
    const rendered = await renderClientComponent(createElement(HostedStartPaidPulseFinishAction));

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.match(rendered.window.document.body.textContent ?? "", /Billing is still finishing/);
    assert.match(rendered.window.document.body.textContent ?? "", /Check status/);
    assert.equal(mocks.routerReplace.mock.calls.length, 0);
    assert.equal(mocks.routerRefresh.mock.calls.length, 1);
    assert.equal(rendered.assign.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("redirects to payment confirmation from the Start Pulse return page", async () => {
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_return",
      status: "payment_required",
    });
    const { HostedStartPaidPulseFinishAction } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-finish-action"
    );
    const rendered = await renderClientComponent(createElement(HostedStartPaidPulseFinishAction));

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.deepEqual(rendered.assign.mock.calls[0], [
      "https://invoice.stripe.test/in_return",
    ]);
    assert.equal(mocks.routerReplace.mock.calls.length, 0);
    assert.equal(mocks.routerRefresh.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("announces the Start Pulse return action while it is submitting", async () => {
    const pendingStart = createDeferred<{
      billingPlanCode: "launch_monthly";
      status: "started";
    }>();
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(pendingStart.promise);
    const { HostedStartPaidPulseFinishAction } = await import(
      "@/src/components/settings/hosted-start-paid-pulse-finish-action"
    );
    const rendered = await renderClientComponent(createElement(HostedStartPaidPulseFinishAction));

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.match(rendered.window.document.body.textContent ?? "", /Starting Pulse billing/);
    pendingStart.resolve({
      billingPlanCode: "launch_monthly",
      status: "started",
    });
    await act(async () => {
      await pendingStart.promise;
    });
    assert.deepEqual(mocks.routerReplace.mock.calls[0], ["/home"]);

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

  test("keeps the upgrade confirmation request pending until the API resolves", async () => {
    const pendingUpgrade = createDeferred<{
      billingPlanCode: "launch_edge_monthly";
      status: "upgraded";
    }>();
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(pendingUpgrade.promise);
    const { HostedBillingSettingsAction } = await import("@/src/components/settings/hosted-billing-settings-action");
    const rendered = await renderClientComponent(createElement(HostedBillingSettingsAction, {
      showUpgrade: true,
    }));
    const manageButton = findButtonByText(rendered.window.document, "Manage subscription", rendered.window);

    await act(async () => {
      manageButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    const upgradeButton = findLastButtonByText(rendered.window.document, "Upgrade to Edge", rendered.window);
    assert.ok(upgradeButton instanceof rendered.window.HTMLButtonElement);

    await act(async () => {
      upgradeButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    const confirmButton = findLastButtonByText(rendered.window.document, "Upgrade to Edge", rendered.window);
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 1);
    assert.equal(mocks.routerRefresh.mock.calls.length, 0);

    pendingUpgrade.resolve({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });
    await act(async () => {
      await pendingUpgrade.promise;
    });
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}
