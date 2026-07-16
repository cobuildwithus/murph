import assert from "node:assert/strict";

import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type FieldsetHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
  requestHostedOnboardingJson: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
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

vi.mock("@/src/components/ui/button", () => ({
  Button: ({
    children,
    className,
    nativeButton: _nativeButton,
    size: _size,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    nativeButton?: boolean;
    size?: string;
    variant?: string;
  }) => {
    void _nativeButton;
    void _size;
    void _variant;
    return createElement("button", { ...props, className }, children);
  },
  buttonVariants: () => "",
}));

vi.mock("@/src/components/ui/dialog", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const DialogContext = React.createContext<{
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }>({
    onOpenChange: () => {},
    open: false,
  });

  return {
    Dialog: ({
      children,
      onOpenChange = () => {},
      open = false,
    }: {
      children?: ReactNode;
      onOpenChange?: (open: boolean) => void;
      open?: boolean;
    }) =>
      createElement(
        DialogContext.Provider,
        { value: { onOpenChange, open } },
        children,
      ),
    DialogContent: ({
      children,
      className,
      showCloseButton: _showCloseButton,
    }: HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean }) => {
      void _showCloseButton;
      const context = React.useContext(DialogContext);
      return context.open
        ? createElement("div", { className, role: "dialog" }, children)
        : null;
    },
    DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
      createElement("p", props),
    DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
      createElement("div", props),
    DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
      createElement("h2", props),
    DialogTrigger: ({
      children,
      render,
    }: {
      children?: ReactNode;
      render: ReactElement<{ onClick?: () => void }>;
    }) => {
      const context = React.useContext(DialogContext);
      return React.cloneElement(
        render,
        { onClick: () => context.onOpenChange(true) },
        children,
      );
    },
  };
});

vi.mock("@/src/components/ui/field", () => ({
  FieldDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  FieldError: ({ children }: { children?: ReactNode }) =>
    children ? createElement("div", { role: "alert" }, children) : null,
  FieldLegend: (props: HTMLAttributes<HTMLLegendElement>) =>
    createElement("legend", props),
  FieldSet: (props: FieldsetHTMLAttributes<HTMLFieldSetElement>) =>
    createElement("fieldset", props),
}));

vi.mock("@/src/components/ui/radio-group", () => ({
  RadioGroup: ({
    children,
    className,
    onValueChange,
  }: {
    children?: ReactNode;
    className?: string;
    onValueChange?: (value: string) => void;
    value?: string;
  }) =>
    createElement(
      "div",
      {
        className,
        onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
          const target = event.target;
          if (target instanceof window.HTMLInputElement && target.type === "radio") {
            onValueChange?.(target.value);
          }
        },
        role: "radiogroup",
      },
      children,
    ),
}));

vi.mock("@/src/components/ui/choice-card", () => ({
  ChoiceCard: ({
    description,
    disabled,
    id,
    meta,
    title,
    value,
  }: InputHTMLAttributes<HTMLInputElement> & {
    description: ReactNode;
    id: string;
    meta?: ReactNode;
    title: ReactNode;
  }) =>
    createElement(
      "label",
      { htmlFor: id },
      createElement("input", {
        disabled,
        id,
        name: "usage-credit-offer",
        type: "radio",
        value,
      }),
      title,
      createElement("span", null, description),
      meta ? createElement("span", null, meta) : null,
    ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", {
    randomUUID: mocks.randomUUID,
  });
});

test("opens from the settings deep link without preselecting a top-up", async () => {
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      initialOpen: true,
      offers: usageCreditOffers(),
    }),
    {
      location: {
        href: "https://example.test/settings?addUsage=true&keep=1#subscription",
      },
      requireButton: false,
    },
  );

  try {
    assert.match(rendered.container.textContent ?? "", /Add usage/);
    const radioInputs = Array.from(
      rendered.container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    );
    assert.equal(radioInputs.length, 3);
    assert.ok(radioInputs.every((input) => input.checked === false));
    assert.equal(buttonByText(rendered.container, "Choose an amount").disabled, true);
    expect(rendered.replaceState).toHaveBeenCalledWith(
      {},
      "",
      "/settings?keep=1#subscription",
    );

    await clickRadio(rendered.container, rendered.window, "usage_1000");
    assert.equal(
      buttonByText(rendered.container, "Continue to checkout · $10").disabled,
      false,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("opens an honest unavailable state when a deep link has no current offers", async () => {
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      initialOpen: true,
      offers: [],
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    assert.match(rendered.container.textContent ?? "", /Usage credit unavailable/);
    assert.match(
      rendered.container.textContent ?? "",
      /There isn’t a usage-credit offer available for this account right now/,
    );
    assert.equal(rendered.container.querySelectorAll('input[type="radio"]').length, 0);
    assert.equal(buttonByText(rendered.container, "Close").disabled, false);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("keeps a frozen open Checkout resumable and cancelable without current offers", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_frozen_open",
    recovered: true,
    status: "checkout_open",
    url: "https://checkout.stripe.test/frozen-open",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_frozen_open",
        retryAllowed: false,
        status: "checkout_open",
        url: "https://checkout.stripe.test/frozen-open",
      },
      offers: [],
    }),
    {
      location: { href: "https://example.test/settings" },
      requireButton: false,
    },
  );

  try {
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
    await clickButton(rendered.container, rendered.window, "Continue checkout");

    assert.equal(buttonByText(rendered.container, "Resume checkout").disabled, false);
    assert.equal(buttonByText(rendered.container, "Cancel checkout").disabled, false);
  } finally {
    await rendered.cleanup();
  }
});

test("withholds Resume but keeps Cancel for a suspended payer's open Checkout", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_suspended_open",
    status: "checkout_open",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_suspended_open",
        retryAllowed: false,
        status: "checkout_open",
      },
      offers: [],
    }),
    {
      location: { href: "https://example.test/settings" },
      requireButton: false,
    },
  );

  try {
    await clickButton(rendered.container, rendered.window, "Continue checkout");

    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.includes("Resume checkout"),
      ),
      false,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /it can’t be resumed from this account right now\. You can cancel it\./,
    );
    assert.equal(buttonByText(rendered.container, "Cancel checkout").disabled, false);
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.includes("Retry checkout"),
      ),
      false,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("does not advertise Retry for a suspended reconciling purchase", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_suspended_reconciling",
    status: "reconciling",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_suspended_reconciling",
        retryAllowed: false,
        status: "reconciling",
      },
      offers: [],
    }),
    {
      location: { href: "https://example.test/settings" },
      requireButton: false,
    },
  );

  try {
    await clickButton(rendered.container, rendered.window, "Continue checkout");

    assert.match(
      rendered.container.textContent ?? "",
      /Checkout is not available right now/,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /safely retry/i);
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.includes("Retry checkout"),
      ),
      false,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("refreshes an open recovery dialog at the exact frozen expiry", async () => {
  vi.useFakeTimers();
  const now = new Date("2026-07-16T19:29:00.000Z");
  const restartAt = "2026-07-16T19:30:00.000Z";
  vi.setSystemTime(now);
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_expiring_recovery",
    restartAt,
    status: "reconciling",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_expiring_recovery",
        restartAt,
        retryAllowed: false,
        status: "reconciling",
      },
      offers: usageCreditOffers(),
    }),
    {
      location: { href: "https://example.test/settings" },
      requireButton: false,
    },
  );

  try {
    await clickButton(rendered.container, rendered.window, "Continue checkout");

    await act(async () => {
      vi.advanceTimersByTime(59_999);
      await Promise.resolve();
    });
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
    assert.equal(
      buttonByText(rendered.container, "Continue checkout").disabled,
      false,
    );

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
    assert.match(rendered.container.textContent ?? "", /Add usage/);
    assert.match(rendered.container.textContent ?? "", /Choose an amount/);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Checkout not open yet/);
    assert.ok(rendered.container.querySelector('[role="dialog"]'));
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("rejects a malformed recovery restart timestamp", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_bad_restart",
    recovered: true,
    restartAt: "not-a-timestamp",
    status: "reconciling",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      initialOpen: true,
      offers: usageCreditOffers(),
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_1000");
    await clickButton(rendered.container, rendered.window, "Continue to checkout · $10");

    assert.match(
      rendered.container.textContent ?? "",
      /Could not open Stripe right now\. Try again\./,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Checkout not open yet/);
  } finally {
    await rendered.cleanup();
  }
});

test("retries a frozen reconciling purchase through the existing checkout route", async () => {
  let checkoutRetried = false;
  mocks.requestHostedOnboardingJson.mockImplementation(async (request: {
    method: string;
  }) => {
    if (request.method === "POST") {
      checkoutRetried = true;
      return {
        purchaseId: "hucp_frozen_retry",
        recovered: true,
        status: "checkout_open",
        url: "https://checkout.stripe.test/frozen-retry",
      };
    }
    return {
      purchaseId: "hucp_frozen_retry",
      status: checkoutRetried ? "checkout_open" : "reconciling",
    };
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_frozen_retry",
        retryAllowed: true,
        status: "reconciling",
      },
      offers: [],
    }),
    {
      location: { href: "https://example.test/settings" },
      requireButton: false,
    },
  );

  try {
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
    await clickButton(rendered.container, rendered.window, "Continue checkout");
    await clickButton(rendered.container, rendered.window, "Retry checkout");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_10_usd",
      },
      signal: expect.any(AbortSignal),
      url: "/api/settings/billing/usage-credit/checkout",
    });
    assert.equal(buttonByText(rendered.container, "Resume checkout").disabled, false);
  } finally {
    await rendered.cleanup();
  }
});

test("restarts polling when a frozen retry advances the same purchase", async () => {
  let statusReadCount = 0;
  mocks.requestHostedOnboardingJson.mockImplementation(async (request: {
    method: string;
  }) => {
    if (request.method === "POST") {
      return {
        purchaseId: "hucp_frozen_pending",
        recovered: true,
        status: "payment_pending",
      };
    }

    statusReadCount += 1;
    return {
      purchaseId: "hucp_frozen_pending",
      status: statusReadCount === 1 ? "reconciling" : "fulfilled",
    };
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_frozen_pending",
        retryAllowed: true,
        status: "reconciling",
      },
      offers: [],
    }),
    {
      location: { href: "https://example.test/settings" },
      requireButton: false,
    },
  );

  try {
    await clickButton(rendered.container, rendered.window, "Continue checkout");
    await clickButton(rendered.container, rendered.window, "Retry checkout");

    assert.equal(statusReadCount, 2);
    assert.match(rendered.container.textContent ?? "", /Usage added\./);
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("resumes polling when a frozen retry request fails", async () => {
  let statusReadCount = 0;
  mocks.requestHostedOnboardingJson.mockImplementation(async (request: {
    method: string;
  }) => {
    if (request.method === "POST") {
      throw new Error("temporary checkout failure");
    }

    statusReadCount += 1;
    return {
      purchaseId: "hucp_frozen_retry_failure",
      status: statusReadCount === 1 ? "reconciling" : "fulfilled",
    };
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_frozen_retry_failure",
        retryAllowed: true,
        status: "reconciling",
      },
      offers: [],
    }),
    {
      location: { href: "https://example.test/settings" },
      requireButton: false,
    },
  );

  try {
    await clickButton(rendered.container, rendered.window, "Continue checkout");
    await clickButton(rendered.container, rendered.window, "Retry checkout");

    assert.equal(statusReadCount, 2);
    assert.match(rendered.container.textContent ?? "", /Usage added\./);
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("posts the exact offer payload, shows pending text, and redirects to Stripe", async () => {
  vi.useFakeTimers();
  const checkout = deferred<unknown>();
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(checkout.promise);
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      initialOpen: true,
      offers: usageCreditOffers(),
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_500");
    await clickButton(rendered.container, rendered.window, "Continue to checkout · $5");

    assert.match(rendered.container.textContent ?? "", /Opening Stripe…/);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_500",
      },
      signal: expect.any(AbortSignal),
      url: "/api/settings/billing/usage-credit/checkout",
    });
    assert.equal(
      rendered.container.querySelector('[aria-label="Complete"]'),
      null,
    );

    await act(async () => {
      checkout.resolve({
        purchaseId: "hucp_checkout",
        status: "checkout_open",
        url: "https://checkout.stripe.test/session",
      });
      await Promise.resolve();
    });

    expect(rendered.assign).toHaveBeenCalledWith(
      "https://checkout.stripe.test/session",
    );
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("asks before resuming a recovered Checkout from a fresh browser request", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_recovered",
    recovered: true,
    status: "checkout_open",
    url: "https://checkout.stripe.test/existing-session",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      initialOpen: true,
      offers: usageCreditOffers(),
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_500");
    await clickButton(rendered.container, rendered.window, "Continue to checkout · $5");

    assert.match(rendered.container.textContent ?? "", /Checkout already open/);
    assert.match(
      rendered.container.textContent ?? "",
      /Resume it or cancel it before starting a new one\./,
    );
    assert.equal(buttonByText(rendered.container, "Resume checkout").disabled, false);
    assert.equal(buttonByText(rendered.container, "Cancel checkout").disabled, false);
    expect(rendered.assign).not.toHaveBeenCalled();

    await clickButton(rendered.container, rendered.window, "Resume checkout");
    expect(rendered.assign).toHaveBeenCalledWith(
      "https://checkout.stripe.test/existing-session",
    );
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("cancels a recovered open Checkout through the existing expire route", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson.mockImplementation(
    ({ method, signal, url }: {
      method: string;
      signal: AbortSignal;
      url: string;
    }) => {
      if (url === "/api/settings/billing/usage-credit/checkout") {
        return Promise.resolve({
          purchaseId: "hucp_recovered_cancel",
          recovered: true,
          status: "checkout_open",
          url: "https://checkout.stripe.test/existing-session",
        });
      }
      if (method === "POST" && url.endsWith("/expire")) {
        return Promise.resolve({
          purchaseId: "hucp_recovered_cancel",
          status: "expired",
        });
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    },
  );
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      initialOpen: true,
      offers: usageCreditOffers(),
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_2500");
    await clickButton(rendered.container, rendered.window, "Continue to checkout · $25");
    await clickButton(rendered.container, rendered.window, "Cancel checkout");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      credentials: "same-origin",
      headers: {
        accept: "application/json",
      },
      method: "POST",
      signal: expect.any(AbortSignal),
      url: "/api/settings/billing/usage-credit/purchases/hucp_recovered_cancel/expire",
    });
    assert.match(
      rendered.container.textContent ?? "",
      /Checkout canceled\. No usage was added\./,
    );
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.includes("Resume checkout"),
      ),
      false,
    );
    expect(rendered.assign).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("shows recovered reconciliation without offering an unsafe early cancel", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_recovered_pending",
    recovered: true,
    status: "reconciling",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      initialOpen: true,
      offers: usageCreditOffers(),
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_1000");
    await clickButton(rendered.container, rendered.window, "Continue to checkout · $10");

    assert.match(
      rendered.container.textContent ?? "",
      /This purchase is still being reconciled\. Checkout is not available right now\./,
    );
    const buttonLabels = Array.from(
      rendered.container.querySelectorAll("button"),
      (button) => button.textContent ?? "",
    );
    assert.equal(buttonLabels.some((label) => label.includes("Resume checkout")), false);
    assert.equal(buttonLabels.some((label) => label.includes("Cancel checkout")), false);
    expect(rendered.assign).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("bounds checkout creation and restores retry and dismiss controls", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson.mockImplementationOnce(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }),
  );
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      initialOpen: true,
      offers: usageCreditOffers(),
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_500");
    await clickButton(rendered.container, rendered.window, "Continue to checkout · $5");

    assert.equal(buttonByText(rendered.container, "Cancel").disabled, true);
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
    });

    assert.match(
      rendered.container.textContent ?? "",
      /Checkout took too long to open\. Try again\./,
    );
    assert.equal(buttonByText(rendered.container, "Cancel").disabled, false);
    assert.equal(
      buttonByText(rendered.container, "Continue to checkout · $5").disabled,
      false,
    );
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("restores controls when the browser cannot create a request key", async () => {
  vi.stubGlobal("crypto", {});
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      initialOpen: true,
      offers: usageCreditOffers(),
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_500");
    await clickButton(rendered.container, rendered.window, "Continue to checkout · $5");

    assert.match(
      rendered.container.textContent ?? "",
      /Could not open Stripe right now\. Try again\./,
    );
    assert.equal(buttonByText(rendered.container, "Cancel").disabled, false);
    assert.equal(
      buttonByText(rendered.container, "Continue to checkout · $5").disabled,
      false,
    );
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("retries a failed checkout with the same client request key", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("Stripe is unavailable."))
    .mockResolvedValueOnce({
      purchaseId: "hucp_retry",
      status: "checkout_open",
      url: "https://checkout.stripe.test/retry",
    });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      initialOpen: true,
      offers: usageCreditOffers(),
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_2500");
    await clickButton(rendered.container, rendered.window, "Continue to checkout · $25");
    assert.match(rendered.container.textContent ?? "", /Stripe is unavailable\./);

    await clickButton(rendered.container, rendered.window, "Continue to checkout · $25");
    const checkoutCalls = mocks.requestHostedOnboardingJson.mock.calls;
    assert.equal(checkoutCalls.length, 2);
    assert.deepEqual(checkoutCalls[0]?.[0]?.payload, checkoutCalls[1]?.[0]?.payload);
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(650);
    });
    expect(rendered.assign).toHaveBeenCalledWith(
      "https://checkout.stripe.test/retry",
    );
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("treats a Stripe return as a status lookup, not proof of fulfillment", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce({
      purchaseId: "hucp_return",
      status: "payment_pending",
    })
    .mockResolvedValueOnce({
      purchaseId: "hucp_return",
      status: "fulfilled",
    });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      offers: usageCreditOffers(),
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_return",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_return&usageCheckout=success&keep=1#subscription",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.match(
      rendered.container.textContent ?? "",
      /Payment submitted\. Stripe is confirming it\./,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Usage added\./);
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
    expect(rendered.replaceState).toHaveBeenCalledWith(
      {},
      "",
      "/settings?keep=1#subscription",
    );

    await act(async () => {
      vi.advanceTimersByTime(1_250);
      await Promise.resolve();
    });

    assert.match(rendered.container.textContent ?? "", /Usage added\./);
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(1, {
      method: "GET",
      signal: expect.any(AbortSignal),
      url: "/api/settings/billing/usage-credit/purchases/hucp_return",
    });

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    assert.match(rendered.container.textContent ?? "", /Usage added\./);
    assert.doesNotMatch(rendered.container.textContent ?? "", /couldn't check/);
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("checks an owned return even when the account no longer has top-up offers", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_inactive_return",
    status: "fulfilled",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_inactive_return",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_inactive_return&usageCheckout=success",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "GET",
      signal: expect.any(AbortSignal),
      url: "/api/settings/billing/usage-credit/purchases/hucp_inactive_return",
    });
    assert.match(rendered.container.textContent ?? "", /Usage added\./);
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.includes("Add usage"),
      ),
      false,
    );
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("expires a canceled Stripe return through the authenticated mutation", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_cancel",
    status: "expired",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      offers: usageCreditOffers(),
      purchaseReturn: {
        kind: "cancel",
        purchaseId: "hucp_cancel",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_cancel&usageCheckout=cancel",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      credentials: "same-origin",
      headers: {
        accept: "application/json",
      },
      method: "POST",
      signal: expect.any(AbortSignal),
      url: "/api/settings/billing/usage-credit/purchases/hucp_cancel/expire",
    });
    assert.match(
      rendered.container.textContent ?? "",
      /Checkout canceled\. No usage was added\./,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("keeps polling when cancel reconciliation reports payment pending", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce({
      purchaseId: "hucp_cancel_pending",
      status: "payment_pending",
    })
    .mockResolvedValueOnce({
      purchaseId: "hucp_cancel_pending",
      status: "payment_pending",
    })
    .mockResolvedValueOnce({
      purchaseId: "hucp_cancel_pending",
      status: "fulfilled",
    });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      offers: usageCreditOffers(),
      purchaseReturn: {
        kind: "cancel",
        purchaseId: "hucp_cancel_pending",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_cancel_pending&usageCheckout=cancel",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.match(
      rendered.container.textContent ?? "",
      /Payment submitted\. Stripe is confirming it\./,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Checkout canceled\. No usage was added\./,
    );
    expect(mocks.routerRefresh).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1_250);
      await Promise.resolve();
    });

    assert.match(rendered.container.textContent ?? "", /Usage added\./);
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("bounds status polling and leaves an honest delayed confirmation message", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_slow",
    status: "reconciling",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      offers: usageCreditOffers(),
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_slow",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_slow&usageCheckout=success",
      },
      requireButton: false,
    },
  );

  try {
    for (let readIndex = 1; readIndex < 10; readIndex += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1_250);
        await Promise.resolve();
      });
    }

    assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 10);
    assert.match(
      rendered.container.textContent ?? "",
      /Your payment is still being confirmed\. You can safely leave this page\./,
    );
    assert.equal(buttonByText(rendered.container, "Check again").disabled, false);
    expect(mocks.routerRefresh).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    assert.match(
      rendered.container.textContent ?? "",
      /Your payment is still being confirmed\. You can safely leave this page\./,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /couldn't check/);
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("distinguishes a failed status lookup and lets the member check again", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson.mockRejectedValue(new Error("not found"));
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      offers: usageCreditOffers(),
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_missing",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_missing&usageCheckout=success",
      },
      requireButton: false,
    },
  );

  try {
    for (let readIndex = 1; readIndex < 10; readIndex += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1_250);
        await Promise.resolve();
      });
    }

    assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 10);
    assert.match(
      rendered.container.textContent ?? "",
      /We couldn't check this payment right now\. Try again\./,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /still being confirmed/,
    );

    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      purchaseId: "hucp_missing",
      status: "fulfilled",
    });
    await clickButton(rendered.container, rendered.window, "Check again");
    await act(async () => {
      await Promise.resolve();
    });

    assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 11);
    assert.match(rendered.container.textContent ?? "", /Usage added\./);
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("times out a stalled status lookup and lets the member check again", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson.mockReturnValue(new Promise(() => {}));
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      offers: usageCreditOffers(),
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_stalled",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_stalled&usageCheckout=success",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    assert.match(
      rendered.container.textContent ?? "",
      /We couldn't check this payment right now\. Try again\./,
    );
    assert.equal(buttonByText(rendered.container, "Check again").disabled, false);
    assert.equal(buttonByText(rendered.container, "Close").disabled, false);
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

function usageCreditOffers() {
  return [
    { amountLabel: "$5", offerCode: "usage_500" },
    { amountLabel: "$10", offerCode: "usage_1000" },
    { amountLabel: "$25", offerCode: "usage_2500" },
  ] as const;
}

async function clickRadio(
  container: HTMLElement,
  window: Window & typeof globalThis,
  value: string,
) {
  const input = container.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${value}"]`,
  );
  assert.ok(input instanceof window.HTMLInputElement);
  await act(async () => {
    input.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

async function clickButton(
  container: HTMLElement,
  window: Window & typeof globalThis,
  label: string,
) {
  const button = buttonByText(container, label);
  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  assert.ok(button);
  return button;
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}
