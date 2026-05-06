import assert from "node:assert/strict";

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
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
    assert.match(markup, /Upgrade to Edge/);
    assert.match(markup, /Current plan/);
    assert.match(markup, /Pulse/);
    assert.match(markup, /\$8 \/ month/);
    assert.match(markup, /Manage your plan and payment details\./);
  });

  test("omits the Edge upgrade action when settings already sees an Edge plan", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
      canUpgradeToEdge: false,
      currentBillingPlanCode: "launch_edge_monthly",
    }));

    assert.doesNotMatch(markup, /Upgrade to Edge/);
    assert.match(markup, /Edge/);
    assert.match(markup, /\$20 \/ month/);
    assert.match(markup, /Manage subscription/);
    assert.match(markup, /Manage your plan and payment details\./);
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

  test("posts the Edge upgrade request and refreshes on success", async () => {
    const { UpgradeToEdgeButton } = await import("@/src/components/settings/hosted-plan-upgrade-button");
    const rendered = await renderClientComponent(createElement(UpgradeToEdgeButton));

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 0);
    assert.match(rendered.window.document.body.textContent ?? "", /Confirm Edge upgrade/);
    assert.match(rendered.window.document.body.textContent ?? "", /\$8\/month/);
    assert.match(rendered.window.document.body.textContent ?? "", /\$20\/month/);

    const confirmButton = findButtonByText(rendered.window.document, "Confirm upgrade", rendered.window);
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
    const confirmButton = findButtonByText(rendered.window.document, "Confirm upgrade", rendered.window);
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(mocks.routerRefresh.mock.calls.length, 0);
    assert.deepEqual(rendered.assign.mock.calls[0], [
      "https://stripe.example.test/portal/session_123",
    ]);

    await rendered.cleanup();
  });

  test("disables the billing portal action while the upgrade request is pending", async () => {
    const pendingUpgrade = createDeferred<{
      billingPlanCode: "launch_edge_monthly";
      status: "upgraded";
    }>();
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(pendingUpgrade.promise);
    const { HostedBillingSettingsAction } = await import("@/src/components/settings/hosted-billing-settings-action");
    const rendered = await renderClientComponent(createElement(HostedBillingSettingsAction, {
      showUpgrade: true,
    }));
    const buttons = [...rendered.container.querySelectorAll("button")];
    const upgradeButton = buttons.find((button) => button.textContent?.includes("Upgrade to Edge"));
    const manageButton = buttons.find((button) => button.textContent?.includes("Manage subscription"));
    assert.ok(upgradeButton instanceof rendered.window.HTMLButtonElement);
    assert.ok(manageButton instanceof rendered.window.HTMLButtonElement);

    await act(async () => {
      upgradeButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    const confirmButton = findButtonByText(rendered.window.document, "Confirm upgrade", rendered.window);
    await act(async () => {
      confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(manageButton.disabled, true);

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
