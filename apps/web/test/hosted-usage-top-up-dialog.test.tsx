import assert from "node:assert/strict";

import {
  act,
  createElement,
  forwardRef,
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
    size,
    variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    nativeButton?: boolean;
    size?: string;
    variant?: string;
  }) => {
    void _nativeButton;
    return createElement(
      "button",
      { ...props, className, "data-size": size, "data-variant": variant },
      children,
    );
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
    DialogTitle: React.forwardRef<
      HTMLHeadingElement,
      HTMLAttributes<HTMLHeadingElement>
    >(function DialogTitle(props, ref) {
      return createElement("h2", { ...props, ref });
    }),
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
    value,
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
        // Surfaces the controlled selection the real primitive renders as
        // data-checked, so tests can assert which amount is selected.
        "data-value": value,
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
  ChoiceCard: forwardRef<
    HTMLInputElement,
    InputHTMLAttributes<HTMLInputElement> & {
      description: ReactNode;
      id: string;
      meta?: ReactNode;
      title: ReactNode;
    }
  >(function ChoiceCard(
    { className, description, disabled, id, meta, title, value },
    ref,
  ) {
    return createElement(
      "label",
      { className, htmlFor: id },
      createElement("input", {
        disabled,
        id,
        name: "usage-credit-offer",
        ref,
        type: "radio",
        value,
      }),
      title,
      createElement("span", null, description),
      meta ? createElement("span", null, meta) : null,
    );
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", {
    randomUUID: mocks.randomUUID,
  });
});

test("opens from the settings deep link on the default amount without starting checkout", async () => {
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
    const personalTrigger = buttonByText(rendered.container, "Add usage");
    assert.equal(personalTrigger.dataset.size, "lg");
    assert.equal(personalTrigger.dataset.variant, "outline");
    assert.equal(personalTrigger.classList.contains("w-full"), false);
    const dialog = rendered.container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.equal(dialog.classList.contains("overflow-y-auto"), true);
    assert.equal(dialog.classList.contains("sm:max-w-xl"), true);
    const radioInputs = Array.from(
      rendered.container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    );
    assert.equal(radioInputs.length, 3);
    // The picker opens on the middle amount so the primary action is live, but
    // a deep link must never itself request checkout.
    assert.equal(
      rendered.container
        .querySelector('[role="radiogroup"]')
        ?.getAttribute("data-value"),
      "usage_1000",
    );
    assert.equal(
      buttonByText(rendered.container, "Continue to checkout · $10").disabled,
      false,
    );
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
    assert.match(
      rendered.container.textContent ?? "",
      /Choose a one-time credit amount for your account\./,
    );
    assert.equal(
      rendered.container.querySelector("h2")?.classList.contains("text-3xl"),
      true,
    );
    assert.equal(rendered.container.querySelector("h2")?.tabIndex, -1);
    assert.equal(
      rendered.container
        .querySelector('[role="radiogroup"]')
        ?.classList.contains("sm:grid-cols-3"),
      true,
    );
    assert.equal(
      rendered.container
        .querySelector('[role="radiogroup"]')
        ?.classList.contains("grid-cols-3"),
      false,
    );
    const firstAmountCard = rendered.container.querySelector<HTMLLabelElement>(
      'label[for="usage-top-up-0"]',
    );
    assert.ok(firstAmountCard);
    assert.equal(firstAmountCard.classList.contains("h-24"), true);
    assert.equal(firstAmountCard.classList.contains("sm:h-28"), true);
    // Message estimate leads, price stays secondary, and the estimate is always
    // rendered as approximate.
    assert.match(firstAmountCard.textContent ?? "", /~100/);
    assert.match(firstAmountCard.textContent ?? "", /messages · \$5/);
    assert.equal(
      firstAmountCard.classList.contains(
        "[&_[data-slot=field-content]]:justify-center",
      ),
      true,
    );
    assert.equal(
      firstAmountCard.classList.contains(
        "[&_[data-slot=field-content]]:gap-0.5",
      ),
      true,
    );
    assert.equal(
      firstAmountCard.querySelector("span")?.classList.contains("text-3xl"),
      true,
    );
    assert.equal(
      firstAmountCard.querySelector("span")?.classList.contains("leading-none"),
      true,
    );
    assert.equal(
      firstAmountCard.querySelector("span")?.classList.contains("h-8"),
      true,
    );
    assert.equal(
      firstAmountCard.querySelector("span")?.classList.contains("items-center"),
      true,
    );
    const selectionActions = buttonByText(
      rendered.container,
      "Continue to checkout · $10",
    ).parentElement;
    assert.ok(selectionActions);
    assert.equal(selectionActions.classList.contains("grid"), true);
    assert.equal(
      selectionActions.classList.contains("sm:grid-cols-[auto_minmax(0,1fr)]"),
      true,
    );
    assert.equal(
      rendered.container.querySelector("legend")?.textContent,
      "Usage credit amount",
    );
    assert.match(rendered.container.textContent ?? "", /Choose one usage credit amount\./);
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

test("reuses the dialog state machine for a server-scoped group checkout", async () => {
  const checkout = deferred<unknown>();
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(checkout.promise);
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      initialOpen: true,
      offers: usageCreditOffers(),
      scope: "group",
    }),
    { requireButton: false },
  );

  try {
    assert.match(rendered.container.textContent ?? "", /How many messages\?/);
    const groupTrigger = Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Add messages");
    assert.ok(groupTrigger);
    assert.equal(groupTrigger.dataset.size, "xl");
    assert.equal(groupTrigger.dataset.variant, "default");
    assert.equal(groupTrigger.classList.contains("w-full"), true);
    assert.match(
      rendered.container.textContent ?? "",
      /Shared with everyone in the chat\./,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /saved card when available/,
    );
    await clickRadio(rendered.container, rendered.window, "usage_500");
    await clickButton(
      rendered.container,
      rendered.window,
      "Add messages · $5",
    );
    assert.equal(
      buttonByText(rendered.container, "Adding messages…").getAttribute(
        "aria-busy",
      ),
      "true",
    );
    assert.equal(
      buttonByText(rendered.container, "Adding messages…").disabled,
      true,
    );
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_500",
      },
      signal: expect.any(AbortSignal),
      url: "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
    });

    await act(async () => {
      checkout.resolve({
        purchaseId: "hucp_group_checkout",
        status: "checkout_open",
        url: "https://checkout.stripe.test/group-session",
      });
      await Promise.resolve();
    });
    expect(rendered.assign).toHaveBeenCalledWith(
      "https://checkout.stripe.test/group-session",
    );
  } finally {
    await rendered.cleanup();
  }
});

test("names the exact Family beneficiary in the trigger and dialog", async () => {
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      offers: usageCreditOffers(),
      scope: "family",
      targetLabel: "Family member",
    }),
    { requireButton: false },
  );

  try {
    const trigger = buttonByText(rendered.container, "Add usage");
    assert.equal(
      trigger.getAttribute("aria-label"),
      "Add usage for Family member",
    );

    await clickButton(rendered.container, rendered.window, "Add usage");

    assert.equal(
      rendered.container.querySelector("h2")?.textContent,
      "Choose an amount for Family member",
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Choose a one-time credit amount for Family member\./,
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
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /No purchase is available/,
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
    assert.equal(hasButton(rendered.container, "Check again"), false);
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
    await clickButton(rendered.container, rendered.window, "Review checkout");

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

test("keeps a server-projected cross-target Checkout status-only before interaction", async () => {
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_other_target",
        retryAllowed: false,
        status: "checkout_open",
        targetConflict: true,
      },
      offers: [],
      scope: "group",
    }),
    {
      location: { href: "https://example.test/groups/fund/group_join_code_1234" },
      requireButton: false,
    },
  );

  try {
    await clickButton(rendered.container, rendered.window, "Review checkout");

    assert.match(
      rendered.container.textContent ?? "",
      /Another checkout is already open/,
    );
    assert.equal(hasButton(rendered.container, "Resume checkout"), false);
    assert.equal(hasButton(rendered.container, "Retry checkout"), false);
    assert.equal(buttonByText(rendered.container, "Cancel checkout").disabled, false);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/api/settings/billing/usage-credit/purchases/hucp_other_target",
      }),
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
    await clickButton(rendered.container, rendered.window, "Check payment");

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
    await clickButton(rendered.container, rendered.window, "Check payment");

    await act(async () => {
      vi.advanceTimersByTime(59_999);
      await Promise.resolve();
    });
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
    assert.equal(
      buttonByText(rendered.container, "Check payment").disabled,
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
      /Try again, or choose another amount\./,
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
    const title = rendered.container.querySelector("h2");
    assert.ok(title);
    const focus = vi.spyOn(title, "focus");
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
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    assert.equal(hasButton(rendered.container, "Check again"), false);
  } finally {
    await rendered.cleanup();
  }
});

test("retries the exact pending saved-card payment from the group dialog", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson.mockImplementation(async (request: {
    method: string;
  }) => ({
    purchaseId: "hucp_saved_card_pending",
    recovered: request.method === "POST",
    status: "payment_pending",
  }));
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_saved_card_pending",
        retryAllowed: true,
        status: "payment_pending",
      },
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      offers: [],
      scope: "group",
    }),
    {
      location: {
        href: "https://example.test/groups/fund/group_join_code_1234",
      },
      requireButton: false,
    },
  );

  try {
    await clickButton(rendered.container, rendered.window, "Check payment");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    for (let readIndex = 1; readIndex < 10; readIndex += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1_250);
        await Promise.resolve();
      });
    }

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(10);
    await clickButton(rendered.container, rendered.window, "Retry payment");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_10_usd",
      },
      signal: expect.any(AbortSignal),
      url: "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
    });
    assert.equal(hasButton(rendered.container, "Retry checkout"), false);
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
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
    assert.match(rendered.container.textContent ?? "", /Usage added/);
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("preserves a frozen retry key across status-only recovery", async () => {
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
      status: statusReadCount === 1 ? "reconciling" : "checkout_open",
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
    assert.equal(buttonByText(rendered.container, "Retry checkout").disabled, false);
    assert.equal(hasButton(rendered.container, "Check again"), false);
    const firstPayload = mocks.requestHostedOnboardingJson.mock.calls.find(
      ([request]) => request.method === "POST",
    )?.[0]?.payload;

    await clickButton(rendered.container, rendered.window, "Retry checkout");
    const postPayloads = mocks.requestHostedOnboardingJson.mock.calls
      .map(([request]) => request)
      .filter((request) => request.method === "POST")
      .map((request) => request.payload);
    assert.deepEqual(postPayloads, [firstPayload, firstPayload]);
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("keeps an uncertain group payment locked to the original amount and request key", async () => {
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("Stripe is unavailable."))
    .mockResolvedValueOnce({
      purchaseId: "hucp_group_retry",
      recovered: true,
      status: "payment_pending",
    });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      initialOpen: true,
      offers: usageCreditOffers(),
      scope: "group",
    }),
    { requireButton: false },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_2500");
    await clickButton(rendered.container, rendered.window, "Add messages · $25");

    assert.match(
      rendered.container.textContent ?? "",
      /We couldn’t confirm this payment yet/,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Retry the same amount to check or continue it\./,
    );
    assert.equal(hasButton(rendered.container, "Change amount"), false);

    await clickButton(
      rendered.container,
      rendered.window,
      "Retry payment · $25",
    );

    const postPayloads = mocks.requestHostedOnboardingJson.mock.calls
      .map(([request]) => request)
      .filter((request) => request.method === "POST")
      .map((request) => request.payload);
    assert.deepEqual(postPayloads, [
      {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_2500",
      },
      {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_2500",
      },
    ]);
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
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

    assert.match(rendered.container.textContent ?? "", /Opening checkout…/);
    assert.equal(
      buttonByText(rendered.container, "Opening checkout…").getAttribute("aria-busy"),
      "true",
    );
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
    assert.equal(buttonByText(rendered.container, "Opening checkout…").disabled, true);

    const pageShowEvent = new rendered.window.Event("pageshow");
    Object.defineProperty(pageShowEvent, "persisted", { value: true });
    await act(async () => {
      rendered.window.dispatchEvent(pageShowEvent);
      await Promise.resolve();
    });
    assert.match(
      rendered.container.textContent ?? "",
      /Checkout was interrupted\. Retry to recover it\./,
    );
    assert.equal(
      buttonByText(rendered.container, "Try again · $5").disabled,
      false,
    );
    assert.equal(
      buttonByText(rendered.container, "Change amount").disabled,
      false,
    );
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("asks before resuming a recovered Checkout from a fresh browser request", async () => {
  mocks.requestHostedOnboardingJson.mockImplementation(
    ({ method, signal, url }: {
      method: string;
      signal: AbortSignal;
      url: string;
    }) => {
      if (
        method === "POST" &&
        url === "/api/settings/billing/usage-credit/checkout"
      ) {
        return Promise.resolve({
          purchaseId: "hucp_recovered",
          recovered: true,
          status: "checkout_open",
          url: "HTTPS://CHECKOUT.STRIPE.TEST",
        });
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
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
    const title = rendered.container.querySelector("h2");
    assert.ok(title);
    const focus = vi.spyOn(title, "focus");

    await clickRadio(rendered.container, rendered.window, "usage_500");
    await clickButton(rendered.container, rendered.window, "Continue to checkout · $5");

    assert.match(rendered.container.textContent ?? "", /Checkout already open/);
    assert.match(
      rendered.container.textContent ?? "",
      /Resume it or cancel it before starting a new one\./,
    );
    assert.equal(buttonByText(rendered.container, "Resume checkout").disabled, false);
    assert.equal(buttonByText(rendered.container, "Cancel checkout").disabled, false);
    assert.equal(hasButton(rendered.container, "Retry checkout"), false);
    const status = rendered.container.querySelector('[role="status"]');
    assert.ok(status);
    assert.equal(status.getAttribute("aria-live"), "polite");
    expect(rendered.assign).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });

    buttonByText(rendered.container, "Resume checkout").dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
    expect(rendered.assign).toHaveBeenCalledWith(
      "https://checkout.stripe.test/",
    );
  } finally {
    await rendered.cleanup();
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
    const title = rendered.container.querySelector("h2");
    assert.ok(title);
    const focus = vi.spyOn(title, "focus");
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
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.includes("Resume checkout"),
      ),
      false,
    );
    await clickButton(rendered.container, rendered.window, "Close");
    assert.equal(buttonByText(rendered.container, "Add usage").disabled, false);
    expect(rendered.assign).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("uses cancel-specific copy when the expire response is malformed", async () => {
  mocks.requestHostedOnboardingJson.mockImplementation(
    ({ method, signal, url }: {
      method: string;
      signal: AbortSignal;
      url: string;
    }) => {
      if (method === "POST" && url.endsWith("/expire")) {
        return Promise.resolve({ malformed: true });
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    },
  );
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_malformed_cancel",
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
    await clickButton(rendered.container, rendered.window, "Review checkout");
    await clickButton(rendered.container, rendered.window, "Cancel checkout");

    assert.match(
      rendered.container.textContent ?? "",
      /Could not cancel this checkout right now\. Try again\./,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Could not open Stripe/,
    );
  } finally {
    await rendered.cleanup();
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

    assert.equal(buttonByText(rendered.container, "Cancel").disabled, false);
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
      buttonByText(rendered.container, "Try again · $5").disabled,
      false,
    );
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("aborts an owned checkout on close and preserves its retry key", async () => {
  const checkout = deferred<unknown>();
  mocks.requestHostedOnboardingJson
    .mockImplementationOnce(() => checkout.promise)
    .mockResolvedValueOnce({
      purchaseId: "hucp_retry_after_close",
      status: "checkout_open",
      url: "https://checkout.stripe.test/retry-after-close",
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
    const firstPayload = mocks.requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload;

    await clickButton(rendered.container, rendered.window, "Cancel");
    await act(async () => {
      await Promise.resolve();
    });
    const firstSignal = mocks.requestHostedOnboardingJson.mock.calls[0]?.[0]?.signal;
    assert.equal(firstSignal?.aborted, true);
    assert.equal(rendered.container.querySelector('[role="dialog"]'), null);
    await act(async () => {
      checkout.resolve({
        purchaseId: "hucp_late_checkout",
        status: "checkout_open",
        url: "https://checkout.stripe.test/late",
      });
      await Promise.resolve();
    });
    expect(rendered.assign).not.toHaveBeenCalled();

    await clickButton(rendered.container, rendered.window, "Add usage");
    assert.match(
      rendered.container.textContent ?? "",
      /Checkout was interrupted\. Retry to recover it\./,
    );
    await clickButton(rendered.container, rendered.window, "Try again · $5");

    assert.deepEqual(
      mocks.requestHostedOnboardingJson.mock.calls[1]?.[0]?.payload,
      firstPayload,
    );
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
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
      /Try again, or choose another amount\./,
    );
    assert.equal(buttonByText(rendered.container, "Cancel").disabled, false);
    assert.equal(
      buttonByText(rendered.container, "Try again · $5").disabled,
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
    assert.match(
      rendered.container.textContent ?? "",
      /Try again, or choose another amount\./,
    );

    await clickButton(rendered.container, rendered.window, "Try again · $25");
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

test("lets the member choose a different amount with a fresh request key", async () => {
  mocks.randomUUID
    .mockImplementationOnce(() => "00000000-0000-4000-8000-000000000101")
    .mockImplementationOnce(() => "00000000-0000-4000-8000-000000000102");
  let checkoutAttempt = 0;
  mocks.requestHostedOnboardingJson.mockImplementation(async (request: {
    method: string;
  }) => {
    if (request.method === "GET") {
      return {
        purchaseId: "hucp_changed_amount",
        status: "checkout_open",
      };
    }
    checkoutAttempt += 1;
    if (checkoutAttempt === 1) {
      throw new Error("Stripe is unavailable.");
    }
    return {
      purchaseId: "hucp_changed_amount",
      recovered: true,
      status: "checkout_open",
      url: "https://checkout.stripe.test/changed-amount",
    };
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
    const firstAmount = rendered.container.querySelector<HTMLInputElement>(
      "#usage-top-up-0",
    );
    assert.ok(firstAmount);
    const focus = vi.spyOn(firstAmount, "focus");
    const lockedActions = buttonByText(
      rendered.container,
      "Change amount",
    ).parentElement;
    assert.ok(lockedActions);
    assert.equal(lockedActions.classList.contains("grid"), true);
    assert.equal(lockedActions.classList.contains("sm:grid-cols-2"), true);
    assert.match(rendered.container.textContent ?? "", /Checkout didn’t open/);
    assert.equal(
      buttonByText(rendered.container, "Try again · $5").dataset.size,
      "xl",
    );
    assert.equal(buttonByText(rendered.container, "Change amount").dataset.size, "xl");
    await clickButton(rendered.container, rendered.window, "Change amount");

    // Changing the amount returns to the same default the picker first offered.
    assert.equal(
      buttonByText(rendered.container, "Continue to checkout · $10").disabled,
      false,
    );
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    assert.equal(
      Array.from(
        rendered.container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      ).every((input) => !input.disabled),
      true,
    );

    await clickRadio(rendered.container, rendered.window, "usage_2500");
    await clickButton(rendered.container, rendered.window, "Continue to checkout · $25");
    const postPayloads = mocks.requestHostedOnboardingJson.mock.calls
      .map(([request]) => request)
      .filter((request) => request.method === "POST")
      .map((request) => request.payload);
    assert.deepEqual(postPayloads, [
      {
        clientRequestKey: "00000000-0000-4000-8000-000000000101",
        offerCode: "usage_500",
      },
      {
        clientRequestKey: "00000000-0000-4000-8000-000000000102",
        offerCode: "usage_2500",
      },
    ]);
    assert.equal(buttonByText(rendered.container, "Resume checkout").disabled, false);
    expect(rendered.assign).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("keeps a conflicting Family checkout nonpayable and refreshes on close", async () => {
  mocks.requestHostedOnboardingJson.mockImplementation(async (request: {
    method: string;
    url: string;
  }) => {
    if (request.method === "POST" && request.url.endsWith("/expire")) {
      return {
        purchaseId: "hucp_other_target",
        status: "expired",
      };
    }
    if (request.method === "GET") {
      return {
        purchaseId: "hucp_other_target",
        status: "checkout_open",
        url: "https://checkout.stripe.test/other-target",
      };
    }
    return {
      purchaseId: "hucp_other_target",
      recovered: true,
      status: "checkout_open",
      targetConflict: true,
    };
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      checkoutUrl:
        "/api/settings/billing/family/members/member_b/usage-credit/checkout",
      initialOpen: true,
      offers: usageCreditOffers(),
      scope: "family",
      targetLabel: "Member B",
    }),
    {
      location: { href: "https://example.test/groups/fund/group_join_code_1234" },
      requireButton: false,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_500");
    await clickButton(rendered.container, rendered.window, "Continue to checkout · $5");

    assert.match(
      rendered.container.textContent ?? "",
      /Another checkout is already open/,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /other usage destination/,
    );
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Change amount",
      ),
      false,
    );
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Resume checkout",
      ),
      false,
    );
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Retry checkout",
      ),
      false,
    );
    expect(rendered.assign).not.toHaveBeenCalled();

    await clickButton(rendered.container, rendered.window, "Cancel checkout");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/api/settings/billing/usage-credit/purchases/hucp_other_target/expire",
      }),
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Other checkout canceled/,
    );
    await clickButton(rendered.container, rendered.window, "Close");
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
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
        href: "https://example.test/settings?usagePurchase=hucp_return&usageCheckout=success&usageFamily=hbag_abcdefghijklmnop&usageMember=member_family&keep=1#family",
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
      /Payment submitted\. We’re confirming it\./,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Usage added/);
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
    expect(rendered.replaceState).toHaveBeenCalledWith(
      {},
      "",
      "/settings?keep=1#family",
    );

    await act(async () => {
      vi.advanceTimersByTime(1_250);
      await Promise.resolve();
    });

    assert.match(rendered.container.textContent ?? "", /Usage added/);
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
    assert.match(rendered.container.textContent ?? "", /Usage added/);
    assert.doesNotMatch(rendered.container.textContent ?? "", /couldn't check/);
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("keeps a recovery-only terminal return visible until the owner closes it", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_inactive_return",
    status: "fulfilled",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      deferTerminalRefreshUntilClose: true,
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_inactive_return",
      },
      scope: "family",
      targetLabel: "this former family member",
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
    assert.match(rendered.container.textContent ?? "", /Usage added/);
    assert.match(
      rendered.container.textContent ?? "",
      /The available usage for this former family member has been updated\./,
    );
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.includes("Add usage"),
      ),
      false,
    );
    expect(mocks.routerRefresh).not.toHaveBeenCalled();

    await clickButton(rendered.container, rendered.window, "Close");

    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("removes a recovery-only canceled return after its confirmation closes", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_inactive_cancel",
    status: "expired",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      deferTerminalRefreshUntilClose: true,
      offers: [],
      purchaseReturn: {
        kind: "cancel",
        purchaseId: "hucp_inactive_cancel",
      },
      scope: "family",
      targetLabel: "this former family member",
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_inactive_cancel&usageCheckout=cancel&usageFamily=hbag_abcdefghijklmnop&usageMember=member_former#family",
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
      /Checkout canceled\. No usage was added\./,
    );
    expect(mocks.routerRefresh).not.toHaveBeenCalled();

    await clickButton(rendered.container, rendered.window, "Close");

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
      /Payment submitted\. We’re confirming it\./,
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

    assert.match(rendered.container.textContent ?? "", /Usage added/);
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
    const checkAgainButton = buttonByText(rendered.container, "Check again");
    const title = rendered.container.querySelector("h2");
    assert.ok(title);
    const focus = vi.spyOn(title, "focus");
    checkAgainButton.focus();
    await clickButton(rendered.container, rendered.window, "Check again");
    await act(async () => {
      await Promise.resolve();
    });

    assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 11);
    assert.match(rendered.container.textContent ?? "", /Usage added/);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    assert.match(
      rendered.container.textContent ?? "",
      /Your available usage has been updated\./,
    );
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

test("offers Text Murph once a successful return is confirmed fulfilled", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_contact_added0",
    status: "fulfilled",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      contactOptions: [textMurphContactOption()],
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_contact_added0",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_contact_added0&usageCheckout=success",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.match(rendered.container.textContent ?? "", /Usage added/);
    const contactLink = rendered.container.querySelector("a");
    assert.ok(contactLink);
    assert.equal(contactLink.textContent, "Text Murph");
    assert.equal(
      contactLink.getAttribute("href"),
      "sms:+15555550100?body=Hey%20Murph%2C%20I%20just%20added%20more%20usage.",
    );
    assert.equal(
      contactLink.getAttribute("aria-label"),
      "Text Murph in Messages",
    );
    assert.equal(
      buttonByText(rendered.container, "Close").dataset.variant,
      "ghost",
    );
  } finally {
    await rendered.cleanup();
  }
});

test("keeps the fulfilled confirmation unchanged when no contact channel resolves", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_contact_none00",
    status: "fulfilled",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      contactOptions: [],
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_contact_none00",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_contact_none00&usageCheckout=success",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.match(rendered.container.textContent ?? "", /Usage added/);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Text Murph/);
    assert.equal(rendered.container.querySelector("a"), null);
    assert.equal(buttonByText(rendered.container, "Close").disabled, false);
  } finally {
    await rendered.cleanup();
  }
});

test("withholds Text Murph until the returned payment is confirmed fulfilled", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce({
      purchaseId: "hucp_contact_wait00",
      status: "payment_pending",
    })
    .mockResolvedValueOnce({
      purchaseId: "hucp_contact_wait00",
      status: "fulfilled",
    });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      contactOptions: [textMurphContactOption()],
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_contact_wait00",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_contact_wait00&usageCheckout=success",
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
      /Payment submitted\. We’re confirming it\./,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Text Murph/);
    assert.equal(rendered.container.querySelector("a"), null);

    await act(async () => {
      vi.advanceTimersByTime(1_250);
      await Promise.resolve();
    });

    assert.match(rendered.container.textContent ?? "", /Usage added/);
    assert.match(rendered.container.textContent ?? "", /Text Murph/);
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("keeps confirming on a success return that still reads checkout_open", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce({
      purchaseId: "hucp_webhook_lag000",
      status: "checkout_open",
      url: "https://checkout.stripe.test/laggy-session",
    })
    .mockResolvedValueOnce({
      purchaseId: "hucp_webhook_lag000",
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
        purchaseId: "hucp_webhook_lag000",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_webhook_lag000&usageCheckout=success",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.match(rendered.container.textContent ?? "", /Confirming payment/);
    assert.match(
      rendered.container.textContent ?? "",
      /Payment submitted\. We’re confirming it\./,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Checkout already open/,
    );
    assert.equal(hasButton(rendered.container, "Resume checkout"), false);
    assert.equal(hasButton(rendered.container, "Cancel checkout"), false);

    await act(async () => {
      vi.advanceTimersByTime(1_250);
      await Promise.resolve();
    });

    assert.match(rendered.container.textContent ?? "", /Usage added/);
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("never offers Text Murph on a canceled checkout confirmation", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_contact_cancel",
    status: "expired",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      contactOptions: [textMurphContactOption()],
      offers: [],
      purchaseReturn: {
        kind: "cancel",
        purchaseId: "hucp_contact_cancel",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_contact_cancel&usageCheckout=cancel",
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
      /Checkout canceled\. No usage was added\./,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Text Murph/);
    assert.equal(rendered.container.querySelector("a"), null);
  } finally {
    await rendered.cleanup();
  }
});

test("offers Open Messages on a fulfilled group top-up return", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_group_added000",
    status: "fulfilled",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      contactOptions: [textMurphContactOption()],
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_group_added000",
      },
      scope: "group",
    }),
    {
      location: {
        href: "https://example.test/groups/fund/group_join_code_1234?usagePurchase=hucp_group_added000&usageCheckout=success",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.match(rendered.container.textContent ?? "", /Usage added/);
    assert.match(
      rendered.container.textContent ?? "",
      /This group's available usage has been updated\./,
    );
    const contactLink = rendered.container.querySelector("a");
    assert.ok(contactLink);
    assert.equal(contactLink.textContent, "Open Messages");
    assert.equal(contactLink.getAttribute("href"), "sms:");
    assert.doesNotMatch(rendered.container.textContent ?? "", /Text Murph/);
    assert.equal(buttonByText(rendered.container, "Close").disabled, false);
  } finally {
    await rendered.cleanup();
  }
});

test("offers the payer Text Murph on a fulfilled Family top-up return", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_contact_family",
    status: "fulfilled",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      contactOptions: [textMurphContactOption()],
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_contact_family",
      },
      scope: "family",
      targetLabel: "Family member",
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_contact_family&usageCheckout=success&usageFamily=hbag_abcdefghijklmnop&usageMember=member_family",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(
      rendered.container.querySelector("h2")?.textContent,
      "Usage added for Family member",
    );
    assert.match(
      rendered.container.textContent ?? "",
      /The available usage for Family member has been updated\./,
    );
    const contactLink = rendered.container.querySelector("a");
    assert.ok(contactLink);
    assert.equal(contactLink.textContent, "Text Murph");
    assert.equal(
      contactLink.getAttribute("href"),
      "sms:+15555550100?body=Hey%20Murph%2C%20I%20just%20added%20more%20usage.",
    );
  } finally {
    await rendered.cleanup();
  }

  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_contact_family",
    status: "fulfilled",
  });
  const renderedWithoutContact = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_contact_family",
      },
      scope: "family",
      targetLabel: "Family member",
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_contact_family&usageCheckout=success&usageFamily=hbag_abcdefghijklmnop&usageMember=member_family",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(
      renderedWithoutContact.container.querySelector("h2")?.textContent,
      "Usage added for Family member",
    );
    assert.doesNotMatch(
      renderedWithoutContact.container.textContent ?? "",
      /Text Murph/,
    );
    assert.equal(renderedWithoutContact.container.querySelector("a"), null);
  } finally {
    await renderedWithoutContact.cleanup();
  }
});

test("renders inline channel rows in the one dialog when several channels resolve", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_contact_multi0",
    status: "fulfilled",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      contactOptions: [
        textMurphContactOption(),
        {
          href: "https://t.me/withmurph_bot?text=Hey+Murph%2C+I+just+added+more+usage.",
          kind: "telegram",
          label: "Telegram",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      ],
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_contact_multi0",
      },
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_contact_multi0&usageCheckout=success",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.match(rendered.container.textContent ?? "", /Usage added/);
    // The channel rows live inside the success dialog itself; no nested
    // picker dialog opens on top of it.
    assert.equal(
      rendered.container.querySelectorAll('[role="dialog"]').length,
      1,
    );
    assert.match(rendered.container.textContent ?? "", /Text Murph/);
    const textLink = rendered.container.querySelector('a[href^="sms:"]');
    assert.ok(textLink);
    assert.equal(
      textLink.getAttribute("href"),
      "sms:+15555550100?body=Hey%20Murph%2C%20I%20just%20added%20more%20usage.",
    );
    assert.match(textLink.textContent ?? "", /Messages/);
    assert.equal(
      textLink.getAttribute("aria-label"),
      "Text Murph in Messages",
    );
    const telegramLink = rendered.container.querySelector(
      'a[href^="https://t.me/"]',
    );
    assert.ok(telegramLink);
    assert.equal(
      telegramLink.getAttribute("href"),
      "https://t.me/withmurph_bot?text=Hey+Murph%2C+I+just+added+more+usage.",
    );
    assert.match(telegramLink.textContent ?? "", /Telegram/);
    assert.equal(
      telegramLink.getAttribute("aria-label"),
      "Text Murph in Telegram (opens in a new tab)",
    );

    await clickButton(rendered.container, rendered.window, "Close");
    assert.equal(rendered.container.querySelector('[role="dialog"]'), null);
  } finally {
    await rendered.cleanup();
  }
});

function textMurphContactOption() {
  return {
    href: "sms:+15555550100?body=Hey%20Murph%2C%20I%20just%20added%20more%20usage.",
    kind: "text" as const,
    label: "Messages",
  };
}

function usageCreditOffers() {
  return [
    { amountLabel: "$5", estimatedMessages: 100, offerCode: "usage_500" },
    { amountLabel: "$10", estimatedMessages: 200, offerCode: "usage_1000" },
    { amountLabel: "$25", estimatedMessages: 500, offerCode: "usage_2500" },
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

function hasButton(container: HTMLElement, label: string): boolean {
  return Array.from(container.querySelectorAll("button")).some((button) =>
    button.textContent?.includes(label),
  );
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
