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
  type TextareaHTMLAttributes,
} from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { HostedOnboardingApiError } from "@/src/components/hosted-onboarding/client-api";
import {
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
} from "@/src/lib/hosted-onboarding/usage-credit-capacity-conflict";

import {
  createMemoryStorage,
  renderClientComponent,
} from "./render-client-component";

const mocks = vi.hoisted(() => ({
  isMobile: vi.fn(() => false),
  randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
  requestHostedOnboardingJson: vi.fn(),
  routerRefresh: vi.fn(),
}));

const TEST_PAYER_MEMBER_ID = "hbm_usage_top_up_payer";
const RETIRED_USAGE_TERM_PATTERN = new RegExp(
  ["cost", "weighted"].join("-"),
  "iu",
);

const USAGE_TOP_UP_TARGET_CASES = [
  {
    addLabel: "Add usage · $5",
    checkoutUrl: "/api/settings/billing/usage-credit/checkout",
    openLabel: "Add usage",
    scope: "personal",
  },
  {
    addLabel: "Add usage · $5",
    checkoutUrl:
      "/api/settings/billing/family/members/hbm_familymember1/usage-credit/checkout",
    openLabel: "Add usage",
    scope: "family",
  },
  {
    addLabel: "Contribute $5",
    checkoutUrl: "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
    openLabel: "Make a one-time contribution",
    scope: "group",
  },
] as const;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock(
  "@/src/components/hosted-onboarding/client-api",
  async (importOriginal) => {
    const original = await importOriginal<
      typeof import("@/src/components/hosted-onboarding/client-api")
    >();
    return {
      ...original,
      requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
    };
  },
);

vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({
    authenticated: true,
    openAuthDialog: () => {},
  }),
}));

vi.mock("@/src/hooks/use-mobile", () => ({
  useIsMobile: mocks.isMobile,
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

vi.mock("@/src/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) =>
    createElement("button", {
      ...props,
      "aria-checked": checked ? "true" : "false",
      onClick: () => onCheckedChange?.(!checked),
      role: "checkbox",
      type: "button",
    }),
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
    DialogContent: React.forwardRef<
      HTMLDivElement,
      HTMLAttributes<HTMLDivElement> & {
        initialFocus?: unknown;
        showCloseButton?: boolean;
      }
    >(function DialogContent(
      {
        children,
        className,
        initialFocus: _initialFocus,
        showCloseButton: _showCloseButton,
        ...props
      },
      ref,
    ) {
      void _initialFocus;
      void _showCloseButton;
      const context = React.useContext(DialogContext);
      return context.open
        ? createElement(
            "div",
            {
              ...props,
              className,
              "data-slot": "dialog-content",
              ref,
              role: "dialog",
            },
            children,
          )
        : null;
    }),
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

vi.mock("@/src/components/ui/drawer", () => ({
  Drawer: ({
    children,
    open,
  }: {
    children?: ReactNode;
    open?: boolean;
  }) =>
    open
      ? createElement("div", { "data-drawer-open": "true" }, children)
      : null,
  DrawerClose: ({ children }: { children?: ReactNode }) => children,
  DrawerContent: ({
    children,
    className,
    ...props
  }: HTMLAttributes<HTMLDivElement>) =>
    createElement(
      "div",
      {
        ...props,
        className,
        "data-slot": "drawer-content",
        role: "dialog",
      },
      children,
    ),
  DrawerDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DrawerHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DrawerTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props),
  DrawerTrigger: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@/src/components/ui/field", () => ({
  Field: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  FieldDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  FieldError: ({ children }: { children?: ReactNode }) =>
    children ? createElement("div", { role: "alert" }, children) : null,
  FieldGroup: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  FieldLabel: (props: HTMLAttributes<HTMLLabelElement>) =>
    createElement("label", props),
  FieldLegend: (props: HTMLAttributes<HTMLLegendElement>) =>
    createElement("legend", props),
  FieldSet: (props: FieldsetHTMLAttributes<HTMLFieldSetElement>) =>
    createElement("fieldset", props),
}));

vi.mock("@/src/components/ui/collapsible", () => ({
  Collapsible: ({
    defaultOpen,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { defaultOpen?: boolean }) =>
    createElement("div", {
      ...props,
      "data-default-open": defaultOpen ? "true" : "false",
    }),
  CollapsibleContent: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", { ...props, "data-slot": "collapsible-content" }),
  CollapsibleTrigger: ({
    children,
    render,
  }: {
    children?: ReactNode;
    render: ReactElement;
  }) => createElement("div", null, render, children),
}));

vi.mock("@/src/components/ui/input", () => ({
  Input: forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
    function Input({ onChange, ...props }, ref) {
      return createElement("input", {
        ...props,
        onChange,
        onInput: onChange,
        ref,
      });
    },
  ),
}));

vi.mock("@/src/components/ui/textarea", () => ({
  Textarea: forwardRef<
    HTMLTextAreaElement,
    TextareaHTMLAttributes<HTMLTextAreaElement>
  >(function Textarea({ onChange, ...props }, ref) {
    return createElement("textarea", {
      ...props,
      onChange,
      onInput: onChange,
      ref,
    });
  }),
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
  mocks.isMobile.mockReset();
  mocks.isMobile.mockReturnValue(false);
  mocks.randomUUID.mockReset();
  mocks.randomUUID.mockReturnValue(
    "00000000-0000-4000-8000-000000000001",
  );
  mocks.requestHostedOnboardingJson.mockReset();
  mocks.routerRefresh.mockReset();
  vi.stubGlobal("crypto", {
    randomUUID: mocks.randomUUID,
  });
});

test("requires an explicit amount choice after opening from the settings deep link", async () => {
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
    assert.equal(
      rendered.container
        .querySelector('[role="radiogroup"]')
        ?.getAttribute("data-value"),
      "",
    );
    assert.equal(buttonByText(rendered.container, "Choose an amount").disabled, true);
    assert.equal(radioInputs.every((input) => !input.checked), true);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
    assert.equal(rendered.container.querySelector("h2")?.textContent, "Add usage");
    assert.equal(
      rendered.container.querySelector("h2 + p")?.classList.contains("sr-only"),
      true,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /one-time credit|saved card|Stripe/,
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
    assert.match(firstAmountCard.textContent ?? "", /\$5/);
    assert.match(firstAmountCard.textContent ?? "", /usage/);
    assert.doesNotMatch(
      firstAmountCard.textContent ?? "",
      /credit|messages|~100/,
    );
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
    await clickRadio(rendered.container, rendered.window, "usage_1000");
    assert.equal(
      rendered.container
        .querySelector('[role="radiogroup"]')
        ?.getAttribute("data-value"),
      "usage_1000",
    );
    const addUsageButton = buttonByText(rendered.container, "Add usage · $10");
    assert.equal(addUsageButton.disabled, false);
    const selectionActions = addUsageButton.parentElement;
    assert.ok(selectionActions);
    assert.equal(selectionActions.classList.contains("grid"), true);
    assert.equal(
      selectionActions.classList.contains("sm:grid-cols-[auto_minmax(0,1fr)]"),
      true,
    );
    assert.equal(
      rendered.container.querySelector("legend")?.textContent,
      "Usage amount",
    );
    assert.match(rendered.container.textContent ?? "", /Choose one usage amount\./);
    expect(rendered.replaceState).toHaveBeenCalledWith(
      {},
      "",
      "/settings?keep=1#subscription",
    );

    await clickRadio(rendered.container, rendered.window, "usage_1000");
    assert.equal(
      buttonByText(rendered.container, "Add usage · $10").disabled,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      initialOpen: true,
      offers: usageCreditOffers(),
      scope: "group",
    }),
    { requireButton: false },
  );

  try {
    assert.ok(
      rendered.container.querySelector('[data-slot="dialog-content"]'),
    );
    assert.equal(
      rendered.container.querySelector('[data-slot="drawer-content"]'),
      null,
    );
    assert.equal(
      rendered.container.querySelector("h2")?.textContent,
      "Make a one-time contribution",
    );
    const groupTrigger = Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) =>
      button.textContent?.trim() === "Make a one-time contribution"
    );
    assert.ok(groupTrigger);
    assert.equal(groupTrigger.dataset.size, "xl");
    assert.equal(groupTrigger.dataset.variant, "default");
    assert.equal(groupTrigger.classList.contains("w-full"), true);
    assert.match(
      rendered.container.textContent ?? "",
      /Choose how much usage to add to this chat\./,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      RETIRED_USAGE_TERM_PATTERN,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /We’ll use your saved card when available and ask only when card details or verification are needed\./,
    );
    await clickRadio(rendered.container, rendered.window, "usage_500");
    await clickButton(
      rendered.container,
      rendered.window,
      "Contribute $5",
    );
    assert.equal(
      buttonByText(rendered.container, "Sponsoring chat…").getAttribute(
        "aria-busy",
      ),
      "true",
    );
    assert.equal(
      buttonByText(rendered.container, "Sponsoring chat…").disabled,
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

test("keeps a customizable sponsorship quiet by default", async () => {
  const checkout = deferred<unknown>();
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(checkout.promise);
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      customizationAllowed: true,
      initialOpen: true,
      offers: groupSponsorshipOffers(),
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_5_usd");
    await clickButton(rendered.container, rendered.window, "Contribute $5");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_5_usd",
        sponsorship: {
          publicAlias: null,
          runningBitRequest: null,
          sponsorMessage: null,
        },
        sponsorshipKind: "one_time",
      },
      signal: expect.any(AbortSignal),
      url: "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
    });
  } finally {
    checkout.resolve({
      purchaseId: "hucp_group_quiet_sponsorship",
      status: "payment_pending",
    });
    await rendered.cleanup();
  }
});

test("keeps recognition consent independent when creative extras are disabled", async () => {
  const checkout = deferred<unknown>();
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(checkout.promise);
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      customizationAllowed: true,
      initialOpen: true,
      offers: groupSponsorshipOffers(),
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_20_usd");
    await clickCheckboxByLabel(
      rendered.container,
      rendered.window,
      "Send something to the group",
    );
    await setTextInput(
      requireTextControlByLabel(
        rendered.container,
        rendered.window,
        "Credit it as",
      ),
      rendered.window,
      "The Group Historian",
    );
    await setTextInput(
      requireTextControlByLabel(
        rendered.container,
        rendered.window,
        "What should it be about?",
      ),
      rendered.window,
      "Celebrate the room.",
    );
    await setTextInput(
      requireTextControlByLabel(
        rendered.container,
        rendered.window,
        "Temporary running bit",
      ),
      rendered.window,
      "Treat me like Murph’s exhausted CFO.",
    );

    await clickCheckboxByLabel(
      rendered.container,
      rendered.window,
      "Send something to the group",
    );
    await clickRadio(rendered.container, rendered.window, "usage_5_usd");

    assert.ok(controlByLabel(rendered.container, "Credit it as"));
    assert.equal(
      controlByLabel(rendered.container, "Temporary running bit"),
      null,
    );
    await clickButton(rendered.container, rendered.window, "Contribute $5");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_5_usd",
        sponsorship: {
          publicAlias: "The Group Historian",
          publicAliasRecognition: "funding_participants_v1",
          runningBitRequest: null,
          sponsorMessage: null,
        },
        sponsorshipKind: "one_time",
      },
      signal: expect.any(AbortSignal),
      url: "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
    });
  } finally {
    checkout.resolve({
      purchaseId: "hucp_group_hidden_sponsorship_details",
      status: "payment_pending",
    });
    await rendered.cleanup();
  }
});

test("freezes an opted-in sponsorship creative request with the selected offer", async () => {
  const checkout = deferred<unknown>();
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(checkout.promise);
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      customizationAllowed: true,
      initialOpen: true,
      offers: groupSponsorshipOffers(),
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false },
  );

  try {
    assert.match(
      rendered.container.textContent ?? "",
      /Personalize \(optional\)/u,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Otherwise the sponsorship stays quiet in the chat\./u,
    );
    assert.ok(rendered.container.querySelector(".h-auto"));
    assert.equal(
      rendered.container.querySelector('[data-default-open="false"]') !== null,
      true,
    );
    const sponsorAlias = requireTextControlByLabel(
      rendered.container,
      rendered.window,
      "Credit it as",
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Signed-in group members see this alias while your monthly sponsorship is active or while this is one of the 20 most recent contributions\./u,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Leave blank to show Anonymous\./u,
    );
    assert.equal(
      controlByLabel(rendered.container, "Temporary running bit"),
      null,
    );

    await clickRadio(rendered.container, rendered.window, "usage_5_usd");
    assert.equal(
      controlByLabel(rendered.container, "Temporary running bit"),
      null,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Lasts for/u);

    await clickRadio(rendered.container, rendered.window, "usage_20_usd");
    const runningBit = requireTextControlByLabel(
      rendered.container,
      rendered.window,
      "Temporary running bit",
    );
    assert.ok(controlByLabel(rendered.container, "Credit it as"));
    assert.match(rendered.container.textContent ?? "", /Lasts for 3 days\./u);

    await clickCheckboxByLabel(
      rendered.container,
      rendered.window,
      "Send something to the group",
    );
    await clickRadio(rendered.container, rendered.window, "song");

    const creativePrompt = requireTextControlByLabel(
      rendered.container,
      rendered.window,
      "What should it be about?",
    );
    const creativeStyle = requireTextControlByLabel(
      rendered.container,
      rendered.window,
      "Genre or style reference",
    );
    for (const field of [
      sponsorAlias,
      creativePrompt,
      creativeStyle,
      runningBit,
    ]) {
      assert.equal(field.classList.contains("focus-visible:ring-0"), true);
      assert.equal(field.classList.contains("focus-visible:ring-3"), false);
    }

    await setTextInput(
      sponsorAlias,
      rendered.window,
      "The Group Historian",
    );
    await setTextInput(
      creativePrompt,
      rendered.window,
      "For whatever adventure comes next.",
    );
    await setTextInput(
      creativeStyle,
      rendered.window,
      "Warm ensemble-sitcom theme with a bright acoustic intro",
    );
    await setTextInput(
      runningBit,
      rendered.window,
      "Treat me like Murph’s exhausted CFO.",
    );
    await clickButton(
      rendered.container,
      rendered.window,
      "Contribute $20",
    );

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_20_usd",
        sponsorship: {
          creativeRequest: {
            format: "song",
            prompt: "For whatever adventure comes next.",
            styleRequest:
              "Warm ensemble-sitcom theme with a bright acoustic intro",
          },
          publicAlias: "The Group Historian",
          publicAliasRecognition: "funding_participants_v1",
          runningBitRequest: "Treat me like Murph’s exhausted CFO.",
          sponsorMessage: null,
        },
        sponsorshipKind: "one_time",
      },
      signal: expect.any(AbortSignal),
      url: "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
    });
  } finally {
    checkout.resolve({
      purchaseId: "hucp_group_sponsorship",
      status: "payment_pending",
    });
    await rendered.cleanup();
  }
});

test("keeps the private monthly maximum out of the public sponsorship moment", async () => {
  const checkout = deferred<unknown>();
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(checkout.promise);
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      customizationAllowed: true,
      initialOpen: true,
      mode: "monthly",
      monthlyCapOptions: groupSponsorshipMonthlyCaps(),
      offers: [groupSponsorshipOffers()[0]],
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false },
  );

  try {
    const dialogText = rendered.container.textContent ?? "";
    assert.match(
      dialogText,
      /Choose your monthly sponsorship limit\./u,
    );
    assert.doesNotMatch(dialogText, /required first \$5 activation purchase/u);
    const initialChargeButton = Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (button) => button.textContent?.trim() === "Sponsor this chat · $5",
    );
    assert.ok(initialChargeButton);
    assert.match(dialogText, /Personalize \(optional\)/u);
    assert.ok(
      rendered.container.querySelector('[data-default-open="false"]'),
    );
    const personalizationContent = rendered.container.querySelector<HTMLElement>(
      '[data-slot="collapsible-content"]',
    );
    assert.ok(personalizationContent);
    assert.equal(
      personalizationContent.classList.contains("max-md:pb-24"),
      true,
    );
    const capSlider = rendered.container.querySelector<HTMLElement>(
      '[role="slider"][aria-valuetext="Up to $5 per month"]',
    );
    assert.ok(capSlider);
    assert.equal(capSlider.getAttribute("aria-valuemin"), "5");
    assert.equal(capSlider.getAttribute("aria-valuemax"), "20");
    const amountLabels = Array.from(
      rendered.container.querySelectorAll("span.font-serif.text-3xl"),
      (amountLabel) => amountLabel.textContent,
    );
    assert.deepEqual(amountLabels, ["$5", "$10", "$20"]);

    await act(async () => {
      const endKey = new rendered.window.Event("keydown", { bubbles: true });
      Object.defineProperty(endKey, "key", { value: "End" });
      capSlider.dispatchEvent(endKey);
      await Promise.resolve();
    });
    assert.equal(capSlider.getAttribute("aria-valuenow"), "20");
    assert.equal(
      capSlider.getAttribute("aria-valuetext"),
      "Up to $20 per month",
    );
    assert.equal(
      controlByLabel(rendered.container, "Temporary running bit"),
      null,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Lasts for/u);

    await clickCheckboxByLabel(
      rendered.container,
      rendered.window,
      "Send something to the group",
    );
    await setTextInput(
      requireTextControlByLabel(
        rendered.container,
        rendered.window,
        "Credit it as",
      ),
      rendered.window,
      "Chat sponsor",
    );
    await setTextInput(
      requireTextControlByLabel(
        rendered.container,
        rendered.window,
        "What should it be about?",
      ),
      rendered.window,
      "Glad to keep this going.",
    );
    const sponsorButtons = Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((button) => button.textContent?.includes("Sponsor this chat"));
    const submitButton = sponsorButtons.at(-1);
    assert.ok(submitButton);
    await act(async () => {
      submitButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        monthlyCapMinor: 2_000,
        offerCode: "usage_5_usd",
        sponsorship: {
          creativeRequest: {
            format: "message",
            prompt: "Glad to keep this going.",
            styleRequest: null,
          },
          publicAlias: "Chat sponsor",
          publicAliasRecognition: "funding_participants_v1",
          runningBitRequest: null,
          sponsorMessage: null,
        },
        sponsorshipKind: "monthly",
      },
      signal: expect.any(AbortSignal),
      url: "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
    });
  } finally {
    checkout.resolve({
      purchaseId: "hucp_group_monthly_sponsorship",
      status: "payment_pending",
    });
    await rendered.cleanup();
  }
});

test("identifies the fixed activation charge in the mobile sponsorship drawer", async () => {
  mocks.isMobile.mockReturnValue(true);
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      customizationAllowed: true,
      initialOpen: true,
      inert: true,
      mode: "monthly",
      monthlyCapOptions: groupSponsorshipMonthlyCaps(),
      offers: [groupSponsorshipOffers()[0]],
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false },
  );

  try {
    const drawer = rendered.container.querySelector<HTMLElement>(
      '[data-slot="drawer-content"]',
    );
    assert.ok(drawer);
    assert.equal(drawer.dataset.inert, "true");
    const initialChargeButton = Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (button) => button.textContent?.trim() === "Sponsor this chat · $5",
    );
    assert.ok(initialChargeButton);
  } finally {
    await rendered.cleanup();
  }
});

test("keeps mobile monthly payment recovery below the open note fields", async () => {
  mocks.isMobile.mockReturnValue(true);
  mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
    new Error("Payment status unavailable."),
  );
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      customizationAllowed: true,
      initialOpen: true,
      mode: "monthly",
      monthlyCapOptions: groupSponsorshipMonthlyCaps(),
      offers: [groupSponsorshipOffers()[0]],
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false },
  );

  try {
    await clickButton(
      rendered.container,
      rendered.window,
      "Sponsor this chat · $5",
    );

    const selection = rendered.container.querySelector<HTMLElement>(
      '[data-slot="usage-top-up-selection"]',
    );
    const details = rendered.container.querySelector<HTMLElement>(
      '[data-slot="group-sponsorship-selection-details"]',
    );
    const recovery = Array.from(
      rendered.container.querySelectorAll<HTMLElement>('[role="alert"]'),
    ).find((element) =>
      element.textContent?.includes("We couldn’t confirm this payment yet")
    );
    assert.ok(selection);
    assert.ok(details);
    assert.ok(recovery);
    const personalizationContent = rendered.container.querySelector<HTMLElement>(
      '[data-slot="collapsible-content"]',
    );
    assert.ok(personalizationContent);
    assert.equal(
      personalizationContent.classList.contains("max-md:pb-24"),
      false,
    );
    assert.equal(
      selection.classList.contains("max-md:min-h-full"),
      true,
    );
    assert.equal(selection.classList.contains("max-md:h-full"), false);
    assert.equal(details.classList.contains("max-md:min-h-0"), false);
    const selectionChildren = Array.from(selection.children);
    assert.ok(
      selectionChildren.indexOf(details) < selectionChildren.indexOf(recovery),
    );
  } finally {
    await rendered.cleanup();
  }
});

test("keeps the one-time contribution action reachable in the mobile drawer", async () => {
  mocks.isMobile.mockReturnValue(true);
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      customizationAllowed: true,
      initialOpen: true,
      mode: "one_time",
      monthlyCapOptions: groupSponsorshipMonthlyCaps(),
      offers: groupSponsorshipOffers(),
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false },
  );

  try {
    assert.ok(
      rendered.container.querySelector('[data-slot="drawer-content"]'),
    );
    assert.equal(
      rendered.container.querySelector('[data-slot="dialog-content"]'),
      null,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Choose how much usage to add to this chat\./,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      RETIRED_USAGE_TERM_PATTERN,
    );
    const selection = rendered.container.querySelector<HTMLElement>(
      '[data-slot="usage-top-up-selection"]',
    );
    assert.ok(selection);
    assert.equal(selection.classList.contains("max-md:min-h-full"), true);
    const personalizationContent = rendered.container.querySelector<HTMLElement>(
      '[data-slot="collapsible-content"]',
    );
    assert.ok(personalizationContent);
    assert.equal(
      personalizationContent.classList.contains("max-md:pb-24"),
      true,
    );
    const actions = buttonByText(
      rendered.container,
      "Choose an amount",
    ).parentElement;
    assert.ok(actions);
    assert.equal(actions.classList.contains("max-md:sticky"), true);
  } finally {
    await rendered.cleanup();
  }
});

test("pins the one-time contribution action in a short mobile drawer", async () => {
  mocks.isMobile.mockReturnValue(true);
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      customizationAllowed: false,
      initialOpen: true,
      mode: "one_time",
      offers: groupSponsorshipOffers(),
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false },
  );

  try {
    const selection = rendered.container.querySelector<HTMLElement>(
      '[data-slot="usage-top-up-selection"]',
    );
    assert.ok(selection);
    assert.equal(selection.classList.contains("max-md:min-h-full"), true);
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Personalize \(optional\)|Send something to the group/u,
    );
    const actions = buttonByText(
      rendered.container,
      "Choose an amount",
    ).parentElement;
    assert.ok(actions);
    assert.equal(actions.classList.contains("max-md:sticky"), true);
    assert.equal(actions.classList.contains("max-md:mt-auto"), true);
  } finally {
    await rendered.cleanup();
  }
});

test("clears a lost group request after terminal recovery with a remounted sponsor draft", async () => {
  const checkoutUrl =
    "/api/groups/fund/group_join_code_1234/usage-credit/checkout";
  const firstRequestKey = "00000000-0000-4000-8000-000000000301";
  const secondRequestKey = "00000000-0000-4000-8000-000000000302";
  const sessionStorage = createMemoryStorage();
  mocks.randomUUID
    .mockImplementationOnce(() => firstRequestKey)
    .mockImplementationOnce(() => secondRequestKey);
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("Response was lost."))
    .mockResolvedValueOnce({
      purchaseId: "hucp_terminal_sponsor_recovery",
      recovered: true,
      requestKeyMatched: true,
      selectionConflict: "sponsorship",
      status: "fulfilled",
    })
    .mockResolvedValueOnce({
      purchaseId: "hucp_new_sponsor_after_recovery",
      status: "checkout_open",
      url: "https://checkout.stripe.test/new-sponsor",
    });
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      checkoutUrl,
      customizationAllowed: true,
      initialOpen: true,
      offers: groupSponsorshipOffers(),
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false, sessionStorage },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_10_usd");
    await clickCheckboxByLabel(
      rendered.container,
      rendered.window,
      "Send something to the group",
    );
    await setTextInput(
      requireTextControlByLabel(
        rendered.container,
        rendered.window,
        "Credit it as",
      ),
      rendered.window,
      "Original sponsor",
    );
    await setTextInput(
      requireTextControlByLabel(
        rendered.container,
        rendered.window,
        "What should it be about?",
      ),
      rendered.window,
      "Celebrate the room’s latest running joke.",
    );
    await clickButton(
      rendered.container,
      rendered.window,
      "Contribute $10",
    );
    assert.equal(
      sessionStorage.getItem(
        usageTopUpRequestStorageKey(checkoutUrl),
      ),
      firstRequestKey,
    );

    await rendered.rerender(
      createElement(GroupSponsorshipDialog, {
        checkoutUrl,
        customizationAllowed: true,
        initialOpen: true,
        key: "remounted-without-frozen-sponsorship",
        offers: groupSponsorshipOffers(),
        payerMemberId: TEST_PAYER_MEMBER_ID,
      }),
    );
    await clickRadio(rendered.container, rendered.window, "usage_10_usd");
    await clickButton(
      rendered.container,
      rendered.window,
      "Contribute $10",
    );

    assert.match(
      rendered.container.textContent ?? "",
      /sponsor details you just entered were not applied/,
    );
    assert.equal(
      sessionStorage.getItem(
        usageTopUpRequestStorageKey(checkoutUrl),
      ),
      null,
    );
    expect(rendered.assign).not.toHaveBeenCalled();

    await clickButton(rendered.container, rendered.window, "Close");
    await clickButton(
      rendered.container,
      rendered.window,
      "Make a one-time contribution",
    );
    await clickRadio(rendered.container, rendered.window, "usage_10_usd");
    await clickButton(
      rendered.container,
      rendered.window,
      "Contribute $10",
    );

    const postPayloads = mocks.requestHostedOnboardingJson.mock.calls
      .map(([request]) => request)
      .filter((request) => request.method === "POST")
      .map((request) => request.payload);
    assert.deepEqual(postPayloads, [
      {
        clientRequestKey: firstRequestKey,
        offerCode: "usage_10_usd",
        sponsorship: {
          creativeRequest: {
            format: "message",
            prompt: "Celebrate the room’s latest running joke.",
            styleRequest: null,
          },
          publicAlias: "Original sponsor",
          publicAliasRecognition: "funding_participants_v1",
          runningBitRequest: null,
          sponsorMessage: null,
        },
        sponsorshipKind: "one_time",
      },
      {
        clientRequestKey: firstRequestKey,
        offerCode: "usage_10_usd",
        sponsorship: {
          publicAlias: null,
          runningBitRequest: null,
          sponsorMessage: null,
        },
        sponsorshipKind: "one_time",
      },
      {
        clientRequestKey: secondRequestKey,
        offerCode: "usage_10_usd",
        sponsorship: {
          publicAlias: null,
          runningBitRequest: null,
          sponsorMessage: null,
        },
        sponsorshipKind: "one_time",
      },
    ]);
    expect(mocks.randomUUID).toHaveBeenCalledTimes(2);
    expect(rendered.assign).toHaveBeenCalledWith(
      "https://checkout.stripe.test/new-sponsor",
    );
  } finally {
    await rendered.cleanup();
  }
});

test(
  "keeps participant-only sponsorship fields out of an unauthorized group checkout",
  async () => {
    const checkout = deferred<unknown>();
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(checkout.promise);
    const { GroupSponsorshipDialog } = await import(
      "@/src/components/hosted-groups/group-sponsorship-dialog"
    );
    const rendered = await renderClientComponent(
      createElement(GroupSponsorshipDialog, {
        checkoutUrl:
          "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
        customizationAllowed: false,
        initialOpen: true,
        offers: groupSponsorshipOffers(),
        payerMemberId: TEST_PAYER_MEMBER_ID,
      }),
      { requireButton: false },
    );

    try {
      assert.doesNotMatch(
        rendered.container.textContent ?? "",
        /Personalize \(optional\)|Send something to the group/u,
      );
      assert.equal(controlByLabel(rendered.container, "Credit it as"), null);
      assert.equal(
        controlByLabel(rendered.container, "What should it be about?"),
        null,
      );
      assert.equal(
        controlByLabel(rendered.container, "Temporary running bit"),
        null,
      );

      await clickRadio(rendered.container, rendered.window, "usage_20_usd");
      await clickButton(
        rendered.container,
        rendered.window,
        "Contribute $20",
      );

      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
        method: "POST",
        payload: {
          clientRequestKey: "00000000-0000-4000-8000-000000000001",
          offerCode: "usage_20_usd",
          sponsorshipKind: "one_time",
        },
        signal: expect.any(AbortSignal),
        url: "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      });
    } finally {
      checkout.resolve({
        purchaseId: "hucp_group_sponsorship_without_customization",
        status: "payment_pending",
      });
      await rendered.cleanup();
    }
  },
);

test("shows and preserves exact modern creative details when retrying payment", async () => {
  const frozenSponsorship = {
    creativeRequest: {
      format: "song" as const,
      prompt: "For whatever adventure comes next.",
      styleRequest: "Bright acoustic ensemble theme",
    },
    publicAlias: "The Group Historian",
    runningBitRequest: "Treat me like Murph’s exhausted CFO.",
    sponsorMessage: null,
  };
  mocks.requestHostedOnboardingJson.mockImplementation(
    (request: { method: string }) =>
      request.method === "POST"
        ? Promise.resolve({
            purchaseId: "hucp_group_sponsorship_recovery",
            recovered: true,
            status: "payment_pending",
          })
        : new Promise(() => undefined),
  );
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_group_sponsorship_recovery",
        retryAllowed: true,
        status: "reconciling",
      },
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      customizationAllowed: false,
      frozenSponsorship,
      offers: [],
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false },
  );

  try {
    await clickExactButton(
      rendered.container,
      rendered.window,
      "Check payment",
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Your original sponsor details are still attached/u,
    );
    assert.match(rendered.container.textContent ?? "", /The Group Historian/u);
    assert.equal(
      definitionValueByTerm(rendered.container, "Creative response"),
      "Song",
    );
    assert.match(
      rendered.container.textContent ?? "",
      /For whatever adventure comes next\./u,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Bright acoustic ensemble theme/u,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Treat me like Murph’s exhausted CFO\./u,
    );

    await clickExactButton(
      rendered.container,
      rendered.window,
      "Retry payment",
    );

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_10_usd",
        recoveryOnly: true,
        sponsorship: frozenSponsorship,
        sponsorshipKind: "one_time",
      },
      signal: expect.any(AbortSignal),
      url: "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
    });
  } finally {
    await rendered.cleanup();
  }
});

test("keeps a legacy frozen note recoverable as a plain message", async () => {
  const frozenSponsorship = {
    publicAlias: "Legacy sponsor",
    runningBitRequest: null,
    sponsorMessage: "Keep the old note intact.",
  };
  mocks.requestHostedOnboardingJson.mockImplementation(
    (request: { method: string }) =>
      request.method === "POST"
        ? Promise.resolve({
            purchaseId: "hucp_group_legacy_sponsorship_recovery",
            recovered: true,
            status: "payment_pending",
          })
        : new Promise(() => undefined),
  );
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_group_legacy_sponsorship_recovery",
        retryAllowed: true,
        status: "reconciling",
      },
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      customizationAllowed: false,
      frozenSponsorship,
      offers: [],
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false },
  );

  try {
    await clickButton(rendered.container, rendered.window, "Check payment");
    assert.match(rendered.container.textContent ?? "", /Note/u);
    assert.match(
      rendered.container.textContent ?? "",
      /Keep the old note intact\./u,
    );
    await clickButton(rendered.container, rendered.window, "Retry payment");
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_10_usd",
        recoveryOnly: true,
        sponsorship: frozenSponsorship,
        sponsorshipKind: "one_time",
      },
      signal: expect.any(AbortSignal),
      url: "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
    });
  } finally {
    await rendered.cleanup();
  }
});

test("shows and preserves an intentionally empty frozen sponsor draft", async () => {
  mocks.requestHostedOnboardingJson.mockImplementation(
    (request: { method: string }) =>
      request.method === "POST"
        ? Promise.resolve({
            purchaseId: "hucp_group_sponsorship_empty_recovery",
            recovered: true,
            status: "payment_pending",
          })
        : new Promise(() => undefined),
  );
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_group_sponsorship_empty_recovery",
        retryAllowed: true,
        status: "reconciling",
      },
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      customizationAllowed: false,
      frozenSponsorship: null,
      offers: [],
      payerMemberId: TEST_PAYER_MEMBER_ID,
    }),
    { requireButton: false },
  );

  try {
    await clickButton(rendered.container, rendered.window, "Check payment");
    assert.match(
      rendered.container.textContent ?? "",
      /No sponsor details were added/u,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /No sponsor name, creative response, or running bit is attached/u,
    );

    await clickButton(rendered.container, rendered.window, "Retry payment");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_10_usd",
        recoveryOnly: true,
        sponsorship: {},
        sponsorshipKind: "one_time",
      },
      signal: expect.any(AbortSignal),
      url: "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
    });
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      "Add usage for Family member",
    );
    assert.equal(
      rendered.container.querySelector("h2 + p")?.classList.contains("sr-only"),
      true,
    );
    assert.doesNotMatch(
      rendered.container.querySelector('label[for="usage-top-up-0"]')
        ?.textContent ?? "",
      /messages|~100/,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
      initialOpen: true,
      offers: [],
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    assert.match(rendered.container.textContent ?? "", /Usage unavailable/);
    assert.match(
      rendered.container.textContent ?? "",
      /There isn’t more usage available for this account right now/,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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

test("keeps payer-owned cancellation available for a cross-target direct payment", async () => {
  mocks.requestHostedOnboardingJson.mockImplementation(async (request: {
    method: string;
  }) => request.method === "POST"
    ? {
        purchaseId: "hucp_other_direct_target",
        status: "expired",
      }
    : {
        cancelAllowed: true,
        purchaseId: "hucp_other_direct_target",
        status: "payment_pending",
      });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      activePurchase: {
        cancelAllowed: true,
        offerCode: "usage_10_usd",
        purchaseId: "hucp_other_direct_target",
        retryAllowed: false,
        status: "payment_pending",
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
    await clickButton(rendered.container, rendered.window, "Check payment");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(
      buttonByText(rendered.container, "Cancel payment").disabled,
      false,
    );
    assert.equal(hasButton(rendered.container, "Retry payment"), false);

    await clickButton(rendered.container, rendered.window, "Cancel payment");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      credentials: "same-origin",
      headers: { accept: "application/json" },
      method: "POST",
      signal: expect.any(AbortSignal),
      url:
        "/api/settings/billing/usage-credit/purchases/hucp_other_direct_target/expire",
    });
    assert.match(rendered.container.textContent ?? "", /Other checkout canceled/);
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
    await clickButton(rendered.container, rendered.window, "Add usage · $10");

    assert.match(
      rendered.container.textContent ?? "",
      /We couldn’t confirm this payment yet/,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /This check can’t start a new payment\./,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Change amount/);
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
        recoveryOnly: true,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
        recoveryOnly: true,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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

test("removes frozen sponsor recovery details once group usage is fulfilled", async () => {
  const status = deferred<unknown>();
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(status.promise);
  const { GroupSponsorshipDialog } = await import(
    "@/src/components/hosted-groups/group-sponsorship-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(GroupSponsorshipDialog, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_group_frozen_fulfilled",
        retryAllowed: true,
        status: "reconciling",
      },
      customizationAllowed: false,
      frozenSponsorship: {
        creativeRequest: {
          format: "message",
          prompt: "More room for the group.",
          styleRequest: null,
        },
        publicAlias: "Sunday sleep crew",
        runningBitRequest: "Keep the recovery jokes going.",
        sponsorMessage: null,
      },
      offers: [],
    }),
    {
      location: { href: "https://example.test/groups/fund/group_join_code_1234" },
      requireButton: false,
    },
  );

  try {
    await clickButton(rendered.container, rendered.window, "Check payment");
    assert.match(
      rendered.container.textContent ?? "",
      /Your original sponsor details are still attached/,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Cancel this payment before changing them\./,
    );

    await act(async () => {
      status.resolve({
        purchaseId: "hucp_group_frozen_fulfilled",
        status: "fulfilled",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.match(
      rendered.container.textContent ?? "",
      /This group has more Murph/,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /original sponsor details|Cancel this payment/,
    );
    const contactLink = rendered.container.querySelector("a");
    assert.ok(contactLink);
    assert.equal(contactLink.textContent, "Open Messages");
    assert.equal(contactLink.getAttribute("href"), "sms:");
    assert.equal(
      rendered.container.querySelectorAll('[role="status"]').length,
      1,
    );
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Done",
      ),
      false,
    );
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
      checkoutUrl:
        "/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      initialOpen: true,
      offers: usageCreditOffers(),
      scope: "group",
    }),
    { requireButton: false },
  );

  try {
    const dialog = rendered.container.querySelector<HTMLElement>(
      '[data-slot="dialog-content"]',
    );
    const title = rendered.container.querySelector("h2");
    assert.ok(dialog);
    assert.ok(title);
    dialog.scrollTop = 240;
    const focus = vi.spyOn(title, "focus");

    await clickRadio(rendered.container, rendered.window, "usage_2500");
    await clickButton(
      rendered.container,
      rendered.window,
      "Contribute $25",
    );

    assert.equal(dialog.scrollTop, 0);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    assert.match(
      rendered.container.textContent ?? "",
      /We couldn’t confirm this payment yet/,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /This check can’t start a new payment\./,
    );
    assert.equal(hasButton(rendered.container, "Change amount"), false);

    await clickButton(
      rendered.container,
      rendered.window,
      "Check payment · $25",
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
        recoveryOnly: true,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
    await clickButton(rendered.container, rendered.window, "Add usage · $5");

    assert.match(rendered.container.textContent ?? "", /Adding usage…/);
    assert.equal(
      buttonByText(rendered.container, "Adding usage…").getAttribute("aria-busy"),
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
    assert.equal(buttonByText(rendered.container, "Adding usage…").disabled, true);

    const pageShowEvent = new rendered.window.Event("pageshow");
    Object.defineProperty(pageShowEvent, "persisted", { value: true });
    await act(async () => {
      rendered.window.dispatchEvent(pageShowEvent);
      await Promise.resolve();
    });
    assert.match(
      rendered.container.textContent ?? "",
      /We couldn’t confirm this payment yet/,
    );
    assert.equal(
      buttonByText(rendered.container, "Check payment · $5").disabled,
      false,
    );
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Change amount",
      ),
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
    await clickButton(rendered.container, rendered.window, "Add usage · $5");

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

test.each([
  ["personal", "reconciling"],
  ["personal", "checkout_open"],
  ["personal", "payment_pending"],
  ["family", "reconciling"],
  ["family", "checkout_open"],
  ["family", "payment_pending"],
  ["group", "reconciling"],
  ["group", "checkout_open"],
  ["group", "payment_pending"],
] as const)(
  "shows the frozen %s %s purchase instead of retaining a stale amount retry",
  async (scope, status) => {
    let resolveStatus!: (value: unknown) => void;
    const statusRead = new Promise<unknown>((resolve) => {
      resolveStatus = resolve;
    });
    const purchaseId = `hucp_${scope}_${status}`;
    const checkoutUrl =
      scope === "family"
        ? "/api/settings/billing/family/members/member_b/usage-credit/checkout"
        : scope === "group"
          ? "/api/groups/fund/group_join_code_1234/usage-credit/checkout"
          : "/api/settings/billing/usage-credit/checkout";
    mocks.requestHostedOnboardingJson.mockImplementation(
      (request: { method: string; url: string }) => {
        if (request.method === "POST" && request.url === checkoutUrl) {
          return Promise.resolve({
            ...(status === "payment_pending" ? { cancelAllowed: true } : {}),
            selectionConflict: "offer",
            purchaseId,
            recovered: true,
            status,
          });
        }
        return statusRead;
      },
    );
    const { HostedUsageTopUpDialog } = await import(
      "@/src/components/settings/hosted-usage-top-up-dialog"
    );
    const rendered = await renderClientComponent(
      createElement(HostedUsageTopUpDialog, {
        payerMemberId: TEST_PAYER_MEMBER_ID,
        checkoutUrl,
        initialOpen: true,
        offers: usageCreditOffers(),
        scope,
        ...(scope === "family" ? { targetLabel: "Member B" } : {}),
      }),
      {
        location: { href: "https://example.test/settings?addUsage=true" },
        requireButton: false,
      },
    );

    try {
      await clickRadio(rendered.container, rendered.window, "usage_500");
      await clickButton(
        rendered.container,
        rendered.window,
        scope === "group" ? "Contribute $5" : "Add usage · $5",
      );

      assert.doesNotMatch(
        rendered.container.textContent ?? "",
        /We couldn’t confirm this payment yet/,
      );
      assert.match(
        rendered.container.textContent ?? "",
        status === "checkout_open"
          ? /Earlier amount already in progress/
          : status === "reconciling"
            ? /Earlier amount still starting/
            : /Earlier payment being confirmed/,
      );
      assert.match(
        rendered.container.textContent ?? "",
        /The amount you just selected was not started/,
      );
      assert.equal(hasButton(rendered.container, "Check payment · $5"), false);
      assert.equal(hasButton(rendered.container, "Retry checkout"), false);
      assert.equal(hasButton(rendered.container, "Change amount"), false);
      if (status === "checkout_open") {
        assert.equal(
          buttonByText(rendered.container, "Cancel checkout").disabled,
          false,
        );
      } else if (status === "payment_pending") {
        assert.equal(
          buttonByText(rendered.container, "Cancel payment").disabled,
          false,
        );
      }

      const postPayloads = mocks.requestHostedOnboardingJson.mock.calls
        .map(([request]) => request)
        .filter((request) => request.method === "POST")
        .map((request) => request.payload);
      assert.deepEqual(postPayloads, [{
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_500",
      }]);

      await act(async () => {
        resolveStatus({ purchaseId, status: "fulfilled" });
        await Promise.resolve();
        await Promise.resolve();
      });

      assert.match(
        rendered.container.textContent ?? "",
        /Earlier amount added/,
      );
      assert.doesNotMatch(rendered.container.textContent ?? "", /Open Messages/);
      assert.doesNotMatch(rendered.container.textContent ?? "", /Text Murph/);
      assert.equal(hasButton(rendered.container, "Check payment · $5"), false);
      assert.equal(
        mocks.requestHostedOnboardingJson.mock.calls.filter(
          ([request]) => request.method === "POST",
        ).length,
        1,
      );

      await clickButton(rendered.container, rendered.window, "Close");
      await clickButton(
        rendered.container,
        rendered.window,
        scope === "group" ? "Make a one-time contribution" : "Add usage",
      );
      assert.equal(
        rendered.container
          .querySelector('[role="radiogroup"]')
          ?.getAttribute("data-value"),
        "",
      );
      assert.equal(
        mocks.requestHostedOnboardingJson.mock.calls.filter(
          ([request]) => request.method === "POST",
        ).length,
        1,
      );
      expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
    } finally {
      await rendered.cleanup();
    }
  },
);

test.each([
  ["fulfilled", "dormant", "Earlier amount added"],
  ["expired", "dormant", "Earlier checkout canceled"],
  ["payment_failed", "dormant", "Earlier payment not completed"],
  ["payment_pending", "failed", "Couldn't check the earlier amount"],
] as const)(
  "keeps the losing amount explicit for an offer conflict in %s with %s polling",
  async (status, pollKind, title) => {
    const { readStatusContent } = await import(
      "@/src/components/settings/hosted-usage-top-up-contract"
    );

    const result = readStatusContent({
      canResumeCheckout: false,
      canRetryCheckout: false,
      selectionConflict: "offer",
      pollKind,
      returnedFromSuccessfulCheckout: false,
      status,
    });

    assert.equal(result.title, title);
    assert.match(result.message, /The amount you just selected was not started/);
  },
);

test("explains that remounted sponsor details were not applied to a terminal purchase", async () => {
  const { readStatusContent } = await import(
    "@/src/components/settings/hosted-usage-top-up-contract"
  );

  const result = readStatusContent({
    canResumeCheckout: false,
    canRetryCheckout: false,
    pollKind: "dormant",
    returnedFromSuccessfulCheckout: false,
    selectionConflict: "sponsorship",
    status: "fulfilled",
  });

  assert.equal(result.title, "Original sponsorship completed");
  assert.match(result.message, /sponsor details you just entered were not applied/);
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
    await clickButton(rendered.container, rendered.window, "Add usage · $25");
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
    await clickButton(rendered.container, rendered.window, "Add usage · $10");

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

test.each(USAGE_TOP_UP_TARGET_CASES)(
  "maps the exact capacity conflict to truthful $scope guidance",
  async ({ addLabel, checkoutUrl, scope }) => {
    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
      new HostedOnboardingApiError({
        code: HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
        message: "Server capacity response.",
      }),
    );
    const { HostedUsageTopUpDialog } = await import(
      "@/src/components/settings/hosted-usage-top-up-dialog"
    );
    const rendered = await renderClientComponent(
      createElement(HostedUsageTopUpDialog, {
        checkoutUrl,
        initialOpen: true,
        offers: usageCreditOffers(),
        payerMemberId: TEST_PAYER_MEMBER_ID,
        scope,
      }),
      {
        location: { href: "https://example.test/settings?addUsage=true" },
        requireButton: false,
      },
    );

    try {
      await clickRadio(rendered.container, rendered.window, "usage_500");
      await clickButton(rendered.container, rendered.window, addLabel);

      assert.equal(
        rendered.container.querySelector("h2")?.textContent,
        "More credit can’t be added right now",
      );
      assert.ok(
        (rendered.container.textContent ?? "").includes(
          HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
        ),
      );
      assert.doesNotMatch(
        rendered.container.textContent ?? "",
        /Server capacity response|choose another amount/iu,
      );
      assert.ok(
        rendered.container.querySelector(
          '[data-slot="usage-top-up-capacity-conflict"]',
        ),
      );
      assert.equal(
        rendered.container.querySelector('input[type="radio"]'),
        null,
      );
      assert.equal(hasButton(rendered.container, "Change amount"), false);
      assert.equal(hasButton(rendered.container, "Try again"), false);
      assert.equal(hasButton(rendered.container, "Check payment"), false);
      assert.equal(hasButton(rendered.container, "Close"), true);
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ offerCode: "usage_500" }),
          url: checkoutUrl,
        }),
      );
    } finally {
      await rendered.cleanup();
    }
  },
);

test("renders the exact inert capacity state without a request", async () => {
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      checkoutUrl: "/api/design/usage-credit-preview",
      inert: true,
      initialCheckoutErrorCode: HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
      initialOpen: true,
      offers: [],
      payerMemberId: "design_usage_top_up_payer",
      scope: "personal",
    }),
    {
      location: { href: "https://example.test/design?tab=components" },
      requireButton: false,
    },
  );

  try {
    assert.equal(
      rendered.container.querySelector("h2")?.textContent,
      "More credit can’t be added right now",
    );
    assert.ok(
      (rendered.container.textContent ?? "").includes(
        HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
      ),
    );
    assert.equal(
      rendered.container
        .querySelector('[role="dialog"]')
        ?.getAttribute("data-inert"),
      "true",
    );
    assert.ok(
      rendered.container.querySelector(
        '[data-slot="usage-top-up-capacity-conflict"]',
      ),
    );
    assert.equal(
      rendered.container.querySelector('input[type="radio"]'),
      null,
    );
    assert.equal(hasButton(rendered.container, "Change amount"), false);
    assert.equal(hasButton(rendered.container, "Try again"), false);
    assert.equal(hasButton(rendered.container, "Close"), true);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test.each(USAGE_TOP_UP_TARGET_CASES)(
  "bounds a timed-out $scope checkout with recovery-only controls",
  async ({ addLabel, checkoutUrl, scope }) => {
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
      checkoutUrl,
      initialOpen: true,
      offers: usageCreditOffers(),
      scope,
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_500");
    await clickButton(rendered.container, rendered.window, addLabel);

    assert.equal(buttonByText(rendered.container, "Cancel").disabled, false);
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
    });

    assert.match(
      rendered.container.textContent ?? "",
      /We couldn’t confirm this payment yet/,
    );
    assert.equal(buttonByText(rendered.container, "Cancel").disabled, false);
    assert.equal(
      buttonByText(rendered.container, "Check payment · $5").disabled,
      false,
    );
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
  },
);

test.each(USAGE_TOP_UP_TARGET_CASES)(
  "aborts a dismissed $scope checkout and preserves its recovery key",
  async ({ addLabel, checkoutUrl, openLabel, scope }) => {
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
      checkoutUrl,
      initialOpen: true,
      offers: usageCreditOffers(),
      scope,
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_500");
    await clickButton(rendered.container, rendered.window, addLabel);
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

    await clickButton(rendered.container, rendered.window, openLabel);
    assert.match(
      rendered.container.textContent ?? "",
      /We couldn’t confirm this payment yet/,
    );
    await clickButton(rendered.container, rendered.window, "Check payment · $5");

    assert.deepEqual(
      mocks.requestHostedOnboardingJson.mock.calls[1]?.[0]?.payload,
      {
        ...firstPayload,
        recoveryOnly: true,
      },
    );
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
  },
);

test("restores controls when the browser cannot create a request key", async () => {
  vi.stubGlobal("crypto", {});
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
    await clickButton(rendered.container, rendered.window, "Add usage · $5");

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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
    await clickButton(rendered.container, rendered.window, "Add usage · $25");
    assert.match(
      rendered.container.textContent ?? "",
      /We couldn’t confirm this payment yet/,
    );

    await clickButton(rendered.container, rendered.window, "Check payment · $25");
    const checkoutCalls = mocks.requestHostedOnboardingJson.mock.calls;
    assert.equal(checkoutCalls.length, 2);
    assert.deepEqual(checkoutCalls[1]?.[0]?.payload, {
      ...checkoutCalls[0]?.[0]?.payload,
      recoveryOnly: true,
    });
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

test.each(USAGE_TOP_UP_TARGET_CASES)(
  "reuses the unresolved $scope request identity after a recovery-miss remount",
  async ({ addLabel, checkoutUrl, scope }) => {
    mocks.randomUUID
      .mockImplementationOnce(() => "00000000-0000-4000-8000-000000000201")
      .mockImplementationOnce(() => "00000000-0000-4000-8000-000000000202");
    mocks.requestHostedOnboardingJson
      .mockRejectedValueOnce(new Error("Response was lost."))
      .mockResolvedValueOnce({ recoveryMiss: true })
      .mockResolvedValueOnce({
        purchaseId: "hucp_fresh_after_recovery",
        requestKeyMatched: true,
        status: "checkout_open",
        url: "https://checkout.stripe.test/fresh-after-recovery",
      })
      .mockResolvedValueOnce({
        purchaseId: "hucp_independent_after_durable_response",
        status: "checkout_open",
        url: "https://checkout.stripe.test/independent",
      });
    const { HostedUsageTopUpDialog } = await import(
      "@/src/components/settings/hosted-usage-top-up-dialog"
    );
    const rendered = await renderClientComponent(
      createElement(HostedUsageTopUpDialog, {
        payerMemberId: TEST_PAYER_MEMBER_ID,
        checkoutUrl,
        initialOpen: true,
        offers: usageCreditOffers(),
        scope,
      }),
      {
        location: { href: "https://example.test/settings?addUsage=true" },
        requireButton: false,
      },
    );

    try {
      await clickRadio(rendered.container, rendered.window, "usage_500");
      await clickButton(rendered.container, rendered.window, addLabel);
      await clickButton(rendered.container, rendered.window, "Check payment · $5");

      assert.equal(
        rendered.container.querySelector('[role="radiogroup"]')?.getAttribute(
          "data-value",
        ),
        "",
      );
      assert.equal(
        buttonByText(rendered.container, "Choose an amount").disabled,
        true,
      );

      await rendered.rerender(
        createElement(HostedUsageTopUpDialog, {
          payerMemberId: TEST_PAYER_MEMBER_ID,
          checkoutUrl,
          initialOpen: true,
          key: "after-recovery-miss",
          offers: usageCreditOffers(),
          scope,
        }),
      );
      await clickRadio(rendered.container, rendered.window, "usage_500");
      await clickButton(rendered.container, rendered.window, addLabel);

      const postPayloads = mocks.requestHostedOnboardingJson.mock.calls
        .map(([request]) => request)
        .filter((request) => request.method === "POST")
        .map((request) => request.payload);
      assert.deepEqual(postPayloads, [
        {
          clientRequestKey: "00000000-0000-4000-8000-000000000201",
          offerCode: "usage_500",
        },
        {
          clientRequestKey: "00000000-0000-4000-8000-000000000201",
          offerCode: "usage_500",
          recoveryOnly: true,
        },
        {
          clientRequestKey: "00000000-0000-4000-8000-000000000201",
          offerCode: "usage_500",
        },
      ]);
      expect(rendered.assign).toHaveBeenCalledWith(
        "https://checkout.stripe.test/fresh-after-recovery",
      );

      await rendered.rerender(
        createElement(HostedUsageTopUpDialog, {
          payerMemberId: TEST_PAYER_MEMBER_ID,
          checkoutUrl,
          initialOpen: true,
          key: "after-durable-response",
          offers: usageCreditOffers(),
          scope,
        }),
      );
      await clickRadio(rendered.container, rendered.window, "usage_1000");
      await clickButton(
        rendered.container,
        rendered.window,
        scope === "group" ? "Contribute $10" : "Add usage · $10",
      );

      const finalPostPayloads = mocks.requestHostedOnboardingJson.mock.calls
        .map(([request]) => request)
        .filter((request) => request.method === "POST")
        .map((request) => request.payload);
      assert.deepEqual(finalPostPayloads.at(-1), {
        clientRequestKey: "00000000-0000-4000-8000-000000000202",
        offerCode: "usage_1000",
      });
      expect(mocks.randomUUID).toHaveBeenCalledTimes(2);
    } finally {
      await rendered.cleanup();
    }
  },
);

test.each(USAGE_TOP_UP_TARGET_CASES)(
  "keeps an unresolved $scope identity isolated across same-tab payer switches",
  async ({ addLabel, checkoutUrl, scope }) => {
    const payerA = "hbm_shared_tab_payer_a";
    const payerB = "hbm_shared_tab_payer_b";
    const payerARequestKey = "00000000-0000-4000-8000-000000000231";
    const payerBRequestKey = "00000000-0000-4000-8000-000000000232";
    const sessionStorage = createMemoryStorage();
    mocks.randomUUID
      .mockImplementationOnce(() => payerARequestKey)
      .mockImplementationOnce(() => payerBRequestKey);
    mocks.requestHostedOnboardingJson
      // Payer A's provider operation reaches a terminal result, but its browser
      // loses the response and must retain the original request identity.
      .mockRejectedValueOnce(new Error("Response was lost."))
      .mockResolvedValueOnce({
        purchaseId: "hucp_payer_b_fulfilled",
        requestKeyMatched: true,
        status: "fulfilled",
      })
      // Payer A later recovers that terminal purchase instead of creating a
      // second provider lifecycle.
      .mockResolvedValueOnce({
        purchaseId: "hucp_payer_a_fulfilled",
        recovered: true,
        requestKeyMatched: true,
        status: "fulfilled",
      });
    const { HostedUsageTopUpDialog } = await import(
      "@/src/components/settings/hosted-usage-top-up-dialog"
    );

    const payerARender = await renderClientComponent(
      createElement(HostedUsageTopUpDialog, {
        checkoutUrl,
        initialOpen: true,
        offers: usageCreditOffers(),
        payerMemberId: payerA,
        scope,
      }),
      {
        location: { href: "https://example.test/settings?addUsage=true" },
        requireButton: false,
        sessionStorage,
      },
    );
    try {
      await clickRadio(payerARender.container, payerARender.window, "usage_500");
      await clickButton(payerARender.container, payerARender.window, addLabel);
      assert.equal(
        sessionStorage.getItem(
          usageTopUpRequestStorageKey(checkoutUrl, payerA),
        ),
        payerARequestKey,
      );
      assert.equal(
        sessionStorage.getItem(
          usageTopUpRequestStorageKey(checkoutUrl, payerB),
        ),
        null,
      );
    } finally {
      await payerARender.cleanup();
    }

    const payerBRender = await renderClientComponent(
      createElement(HostedUsageTopUpDialog, {
        checkoutUrl,
        initialOpen: true,
        offers: usageCreditOffers(),
        payerMemberId: payerB,
        scope,
      }),
      {
        location: { href: "https://example.test/settings?addUsage=true" },
        requireButton: false,
        sessionStorage,
      },
    );
    try {
      await clickRadio(payerBRender.container, payerBRender.window, "usage_500");
      await clickButton(payerBRender.container, payerBRender.window, addLabel);
      assert.equal(
        sessionStorage.getItem(
          usageTopUpRequestStorageKey(checkoutUrl, payerB),
        ),
        null,
      );
      assert.equal(
        sessionStorage.getItem(
          usageTopUpRequestStorageKey(checkoutUrl, payerA),
        ),
        payerARequestKey,
      );
    } finally {
      await payerBRender.cleanup();
    }

    const payerAReturn = await renderClientComponent(
      createElement(HostedUsageTopUpDialog, {
        checkoutUrl,
        initialOpen: true,
        offers: usageCreditOffers(),
        payerMemberId: payerA,
        scope,
      }),
      {
        location: { href: "https://example.test/settings?addUsage=true" },
        requireButton: false,
        sessionStorage,
      },
    );
    try {
      await clickRadio(payerAReturn.container, payerAReturn.window, "usage_500");
      await clickButton(payerAReturn.container, payerAReturn.window, addLabel);

      const postPayloads = mocks.requestHostedOnboardingJson.mock.calls
        .map(([request]) => request)
        .filter((request) => request.method === "POST")
        .map((request) => request.payload);
      assert.deepEqual(postPayloads, [
        {
          clientRequestKey: payerARequestKey,
          offerCode: "usage_500",
        },
        {
          clientRequestKey: payerBRequestKey,
          offerCode: "usage_500",
        },
        {
          clientRequestKey: payerARequestKey,
          offerCode: "usage_500",
        },
      ]);
      expect(mocks.randomUUID).toHaveBeenCalledTimes(2);
      assert.equal(
        sessionStorage.getItem(
          usageTopUpRequestStorageKey(checkoutUrl, payerA),
        ),
        null,
      );
    } finally {
      await payerAReturn.cleanup();
    }
  },
);

test.each(USAGE_TOP_UP_TARGET_CASES)(
  "keeps the unresolved $scope identity when the next authorization changes amount",
  async ({ addLabel, checkoutUrl, scope }) => {
    mocks.randomUUID
      .mockImplementationOnce(() => "00000000-0000-4000-8000-000000000211");
    mocks.requestHostedOnboardingJson
      .mockRejectedValueOnce(new Error("Response was lost."))
      .mockResolvedValueOnce({ recoveryMiss: true })
      .mockResolvedValueOnce({
        selectionConflict: "offer",
        purchaseId: "hucp_delayed_original_winner",
        recovered: true,
        status: "checkout_open",
      });
    const { HostedUsageTopUpDialog } = await import(
      "@/src/components/settings/hosted-usage-top-up-dialog"
    );
    const rendered = await renderClientComponent(
      createElement(HostedUsageTopUpDialog, {
        payerMemberId: TEST_PAYER_MEMBER_ID,
        checkoutUrl,
        initialOpen: true,
        offers: usageCreditOffers(),
        scope,
      }),
      {
        location: { href: "https://example.test/settings?addUsage=true" },
        requireButton: false,
      },
    );

    try {
      await clickRadio(rendered.container, rendered.window, "usage_500");
      await clickButton(rendered.container, rendered.window, addLabel);
      await clickButton(rendered.container, rendered.window, "Check payment · $5");
      await rendered.rerender(
        createElement(HostedUsageTopUpDialog, {
          payerMemberId: TEST_PAYER_MEMBER_ID,
          checkoutUrl,
          initialOpen: true,
          key: "changed-offer-after-recovery-miss",
          offers: usageCreditOffers(),
          scope,
        }),
      );
      await clickRadio(rendered.container, rendered.window, "usage_2500");
      await clickButton(
        rendered.container,
        rendered.window,
        scope === "group" ? "Contribute $25" : "Add usage · $25",
      );

      const postPayloads = mocks.requestHostedOnboardingJson.mock.calls
        .map(([request]) => request)
        .filter((request) => request.method === "POST")
        .map((request) => request.payload);
      assert.deepEqual(postPayloads, [
        {
          clientRequestKey: "00000000-0000-4000-8000-000000000211",
          offerCode: "usage_500",
        },
        {
          clientRequestKey: "00000000-0000-4000-8000-000000000211",
          offerCode: "usage_500",
          recoveryOnly: true,
        },
        {
          clientRequestKey: "00000000-0000-4000-8000-000000000211",
          offerCode: "usage_2500",
        },
      ]);
      expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
      expect(rendered.assign).not.toHaveBeenCalled();
      assert.match(
        rendered.container.textContent ?? "",
        /Earlier amount already in progress/,
      );
    } finally {
      await rendered.cleanup();
    }
  },
);

test.each(USAGE_TOP_UP_TARGET_CASES)(
  "retains the unresolved $scope identity across a cross-target purchase projection",
  async ({ addLabel, checkoutUrl, scope }) => {
    const requestKey = "00000000-0000-4000-8000-000000000220";
    const sessionStorage = createMemoryStorage();
    sessionStorage.setItem(
      usageTopUpRequestStorageKey(checkoutUrl),
      requestKey,
    );
    mocks.requestHostedOnboardingJson.mockImplementation(
      async (request: { method: string }) =>
        request.method === "GET"
          ? {
              purchaseId: "hucp_other_target_projection",
              status: "fulfilled",
            }
          : {
              purchaseId: "hucp_owned_after_projection",
              status: "checkout_open",
              url: "https://checkout.stripe.test/owned-after-projection",
            },
    );
    const { HostedUsageTopUpDialog } = await import(
      "@/src/components/settings/hosted-usage-top-up-dialog"
    );
    const rendered = await renderClientComponent(
      createElement(HostedUsageTopUpDialog, {
        payerMemberId: TEST_PAYER_MEMBER_ID,
        activePurchase: {
          offerCode: "usage_10_usd",
          purchaseId: "hucp_other_target_projection",
          retryAllowed: false,
          status: "checkout_open",
          targetConflict: true,
        },
        checkoutUrl,
        offers: usageCreditOffers(),
        scope,
      }),
      {
        location: { href: "https://example.test/settings" },
        requireButton: false,
        sessionStorage,
      },
    );

    try {
      await rendered.rerender(
        createElement(HostedUsageTopUpDialog, {
          payerMemberId: TEST_PAYER_MEMBER_ID,
          checkoutUrl,
          initialOpen: true,
          key: "selection-after-cross-target-projection",
          offers: usageCreditOffers(),
          scope,
        }),
      );
      await clickRadio(rendered.container, rendered.window, "usage_500");
      await clickButton(rendered.container, rendered.window, addLabel);

      const postPayload = mocks.requestHostedOnboardingJson.mock.calls
        .map(([request]) => request)
        .find((request) => request.method === "POST")?.payload;
      assert.deepEqual(postPayload, {
        clientRequestKey: requestKey,
        offerCode: "usage_500",
      });
      expect(mocks.randomUUID).not.toHaveBeenCalled();
    } finally {
      await rendered.cleanup();
    }
  },
);

test.each(USAGE_TOP_UP_TARGET_CASES)(
  "retains the unresolved $scope identity across a purchase-return projection",
  async ({ addLabel, checkoutUrl, scope }) => {
    const requestKey = "00000000-0000-4000-8000-000000000221";
    const sessionStorage = createMemoryStorage();
    sessionStorage.setItem(
      usageTopUpRequestStorageKey(checkoutUrl),
      requestKey,
    );
    mocks.requestHostedOnboardingJson.mockImplementation(
      async (request: { method: string }) =>
        request.method === "GET"
          ? {
              purchaseId: "hucp_return_projection",
              status: "fulfilled",
            }
          : {
              purchaseId: "hucp_owned_after_return",
              status: "checkout_open",
              url: "https://checkout.stripe.test/owned-after-return",
            },
    );
    const { HostedUsageTopUpDialog } = await import(
      "@/src/components/settings/hosted-usage-top-up-dialog"
    );
    const rendered = await renderClientComponent(
      createElement(HostedUsageTopUpDialog, {
        payerMemberId: TEST_PAYER_MEMBER_ID,
        checkoutUrl,
        offers: usageCreditOffers(),
        purchaseReturn: {
          kind: "success",
          purchaseId: "hucp_return_projection",
        },
        scope,
      }),
      {
        location: {
          href: "https://example.test/settings?usagePurchase=hucp_return_projection&usageCheckout=success",
        },
        requireButton: false,
        sessionStorage,
      },
    );

    try {
      await rendered.rerender(
        createElement(HostedUsageTopUpDialog, {
          payerMemberId: TEST_PAYER_MEMBER_ID,
          checkoutUrl,
          initialOpen: true,
          key: "selection-after-return-projection",
          offers: usageCreditOffers(),
          scope,
        }),
      );
      await clickRadio(rendered.container, rendered.window, "usage_500");
      await clickButton(rendered.container, rendered.window, addLabel);

      const postPayload = mocks.requestHostedOnboardingJson.mock.calls
        .map(([request]) => request)
        .find((request) => request.method === "POST")?.payload;
      assert.deepEqual(postPayload, {
        clientRequestKey: requestKey,
        offerCode: "usage_500",
      });
      expect(mocks.randomUUID).not.toHaveBeenCalled();
    } finally {
      await rendered.cleanup();
    }
  },
);

test.each(USAGE_TOP_UP_TARGET_CASES)(
  "retains the unresolved $scope identity when a projected purchase is retried",
  async ({ addLabel, checkoutUrl, scope }) => {
    const storedRequestKey = "00000000-0000-4000-8000-000000000223";
    const retryRequestKey = "00000000-0000-4000-8000-000000000224";
    const sessionStorage = createMemoryStorage();
    sessionStorage.setItem(
      usageTopUpRequestStorageKey(checkoutUrl),
      storedRequestKey,
    );
    mocks.randomUUID.mockImplementationOnce(() => retryRequestKey);
    let postCount = 0;
    mocks.requestHostedOnboardingJson.mockImplementation(
      async (request: { method: string }) => {
        if (request.method === "GET") {
          return {
            purchaseId: "hucp_projected_retry",
            status: "reconciling",
          };
        }
        postCount += 1;
        return postCount === 1
          ? {
              purchaseId: "hucp_projected_retry",
              recovered: true,
              status: "checkout_open",
              url: "https://checkout.stripe.test/projected-retry",
            }
          : {
              purchaseId: "hucp_owned_after_projected_retry",
              requestKeyMatched: true,
              status: "checkout_open",
              url: "https://checkout.stripe.test/owned-after-projected-retry",
            };
      },
    );
    const { HostedUsageTopUpDialog } = await import(
      "@/src/components/settings/hosted-usage-top-up-dialog"
    );
    const rendered = await renderClientComponent(
      createElement(HostedUsageTopUpDialog, {
        payerMemberId: TEST_PAYER_MEMBER_ID,
        activePurchase: {
          offerCode: "usage_10_usd",
          purchaseId: "hucp_projected_retry",
          retryAllowed: true,
          status: "reconciling",
        },
        checkoutUrl,
        initialOpen: true,
        offers: usageCreditOffers(),
        scope,
      }),
      {
        location: { href: "https://example.test/settings" },
        requireButton: false,
        sessionStorage,
      },
    );

    try {
      await clickButton(
        rendered.container,
        rendered.window,
        scope === "group" ? "Retry payment" : "Retry checkout",
      );
      await rendered.rerender(
        createElement(HostedUsageTopUpDialog, {
          payerMemberId: TEST_PAYER_MEMBER_ID,
          checkoutUrl,
          initialOpen: true,
          key: "selection-after-projected-retry",
          offers: usageCreditOffers(),
          scope,
        }),
      );
      await clickRadio(rendered.container, rendered.window, "usage_500");
      await clickButton(rendered.container, rendered.window, addLabel);

      const postPayloads = mocks.requestHostedOnboardingJson.mock.calls
        .map(([request]) => request)
        .filter((request) => request.method === "POST")
        .map((request) => request.payload);
      assert.deepEqual(postPayloads, [
        {
          clientRequestKey: retryRequestKey,
          offerCode: "usage_10_usd",
          recoveryOnly: true,
        },
        {
          clientRequestKey: storedRequestKey,
          offerCode: "usage_500",
        },
      ]);
      expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
    } finally {
      await rendered.cleanup();
    }
  },
);

test.each(USAGE_TOP_UP_TARGET_CASES)(
  "retains the unresolved $scope identity when selection recovers another request",
  async ({ addLabel, checkoutUrl, scope }) => {
    const requestKey = "00000000-0000-4000-8000-000000000225";
    const sessionStorage = createMemoryStorage();
    sessionStorage.setItem(
      usageTopUpRequestStorageKey(checkoutUrl),
      requestKey,
    );
    mocks.requestHostedOnboardingJson
      .mockResolvedValueOnce({
        purchaseId: "hucp_other_request",
        recovered: true,
        status: "checkout_open",
        url: "https://checkout.stripe.test/other-request",
      })
      .mockResolvedValueOnce({
        purchaseId: "hucp_owned_after_other_request",
        requestKeyMatched: true,
        status: "checkout_open",
        url: "https://checkout.stripe.test/owned-after-other-request",
      });
    const { HostedUsageTopUpDialog } = await import(
      "@/src/components/settings/hosted-usage-top-up-dialog"
    );
    const rendered = await renderClientComponent(
      createElement(HostedUsageTopUpDialog, {
        payerMemberId: TEST_PAYER_MEMBER_ID,
        checkoutUrl,
        initialOpen: true,
        offers: usageCreditOffers(),
        scope,
      }),
      {
        location: { href: "https://example.test/settings" },
        requireButton: false,
        sessionStorage,
      },
    );

    try {
      await clickRadio(rendered.container, rendered.window, "usage_500");
      await clickButton(rendered.container, rendered.window, addLabel);
      await rendered.rerender(
        createElement(HostedUsageTopUpDialog, {
          payerMemberId: TEST_PAYER_MEMBER_ID,
          checkoutUrl,
          initialOpen: true,
          key: "selection-after-other-request-recovery",
          offers: usageCreditOffers(),
          scope,
        }),
      );
      await clickRadio(rendered.container, rendered.window, "usage_500");
      await clickButton(rendered.container, rendered.window, addLabel);

      const postPayloads = mocks.requestHostedOnboardingJson.mock.calls
        .map(([request]) => request)
        .filter((request) => request.method === "POST")
        .map((request) => request.payload);
      assert.deepEqual(postPayloads, [
        {
          clientRequestKey: requestKey,
          offerCode: "usage_500",
        },
        {
          clientRequestKey: requestKey,
          offerCode: "usage_500",
        },
      ]);
      expect(mocks.randomUUID).not.toHaveBeenCalled();
    } finally {
      await rendered.cleanup();
    }
  },
);

test("fails closed when the stored ambiguous request identity cannot be verified", async () => {
  const requestKey = "00000000-0000-4000-8000-000000000226";
  const sessionStorage: Storage = {
    clear() {},
    getItem() {
      return requestKey;
    },
    key() {
      return "stored-usage-top-up-request";
    },
    length: 1,
    removeItem() {},
    setItem() {
      throw new Error("Session storage unavailable.");
    },
  };
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      initialOpen: true,
      offers: usageCreditOffers(),
    }),
    {
      location: { href: "https://example.test/settings?addUsage=true" },
      requireButton: false,
      sessionStorage,
    },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_500");
    await clickButton(rendered.container, rendered.window, "Add usage · $5");

    assert.match(
      rendered.container.textContent ?? "",
      /browser tab can’t safely start a payment/,
    );
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
    expect(mocks.randomUUID).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("keeps the exact amount and request key after an ambiguous payment failure", async () => {
  mocks.randomUUID
    .mockImplementationOnce(() => "00000000-0000-4000-8000-000000000101");
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
    await clickButton(rendered.container, rendered.window, "Add usage · $5");
    const lockedActions = buttonByText(
      rendered.container,
      "Check payment · $5",
    ).parentElement;
    assert.ok(lockedActions);
    assert.equal(lockedActions.classList.contains("grid"), true);
    assert.equal(lockedActions.classList.contains("sm:grid-cols-2"), false);
    assert.match(
      rendered.container.textContent ?? "",
      /We couldn’t confirm this payment yet/,
    );
    assert.equal(
      buttonByText(rendered.container, "Check payment · $5").dataset.size,
      "xl",
    );
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Change amount",
      ),
      false,
    );

    await clickButton(rendered.container, rendered.window, "Check payment · $5");
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
        clientRequestKey: "00000000-0000-4000-8000-000000000101",
        offerCode: "usage_500",
        recoveryOnly: true,
      },
    ]);
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
    await clickButton(rendered.container, rendered.window, "Add usage · $5");

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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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

test("uses an exact return without inheriting a newer purchase conflict", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_ownerreturn00000",
    status: "fulfilled",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        cancelAllowed: true,
        offerCode: "usage_10_usd",
        purchaseId: "hucp_memberactive0000",
        retryAllowed: false,
        status: "checkout_open",
        targetConflict: true,
      },
      offers: [],
      payerMemberId: TEST_PAYER_MEMBER_ID,
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_ownerreturn00000",
      },
      scope: "family",
      targetLabel: "you",
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_ownerreturn00000&usageCheckout=success#subscription",
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
      url: "/api/settings/billing/usage-credit/purchases/hucp_ownerreturn00000",
    });
    assert.match(rendered.container.textContent ?? "", /Usage added/);
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Other checkout|unfinished checkout|another usage destination/i,
    );
    assert.equal(hasButton(rendered.container, "Cancel checkout"), false);
    assert.equal(hasButton(rendered.container, "Retry checkout"), false);
  } finally {
    await rendered.cleanup();
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
      deferTerminalRefreshUntilClose: true,
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_inactive_return",
      },
      renderPurchaseDetails: createElement("p", null, "Purchase details"),
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
      /Usage credit was added for this former family member\./,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Purchase details/);
    assert.match(
      rendered.container.querySelector('[role="dialog"]')?.className ?? "",
      /sm:max-w-md/,
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

test("shows a compact target-specific result for another active Family member", async () => {
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_family_member_return",
        retryAllowed: false,
        status: "fulfilled",
      },
      deferTerminalRefreshUntilClose: true,
      initialOpen: true,
      offers: [],
      payerMemberId: TEST_PAYER_MEMBER_ID,
      renderPurchaseDetails: createElement("p", null, "Purchase details"),
      scope: "family",
      targetLabel: "Family member",
    }),
    { requireButton: false },
  );

  try {
    await act(async () => {
      await Promise.resolve();
    });

    assert.match(
      rendered.container.textContent ?? "",
      /Usage added for Family member/,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Usage credit was added for Family member\./,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Purchase details/);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Text Murph/);
    assert.match(
      rendered.container.querySelector('[role="dialog"]')?.className ?? "",
      /sm:max-w-md/,
    );
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
      offers: usageCreditOffers(),
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_stalled",
      },
      quietSuccessfulReturn: true,
      renderPurchaseDetails: createElement("p", null, "Purchase details"),
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_stalled&usageCheckout=success",
      },
      requireButton: false,
    },
  );

  try {
    assert.equal(rendered.container.querySelector('[role="dialog"]'), null);

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
    assert.doesNotMatch(rendered.container.textContent ?? "", /Purchase details/);
    assert.match(
      rendered.container.querySelector('[role="dialog"]')?.className ?? "",
      /sm:max-w-md/,
    );
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("reconciles a fulfilled Settings return without presenting a confirmation", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_quiet_added00",
    status: "fulfilled",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      offers: usageCreditOffers(),
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_quiet_added00",
      },
      quietSuccessfulReturn: true,
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_quiet_added00&usageCheckout=success",
      },
      requireButton: false,
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(rendered.container.querySelector('[role="dialog"]'), null);
    assert.equal(
      rendered.container.querySelectorAll('[role="status"]').length,
      1,
    );
    const status = rendered.container.querySelector('[role="status"]');
    assert.ok(status);
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.match(
      status.textContent ?? "",
      /Usage added\. Your available usage has been updated\./,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Text Murph/);
    assert.equal(buttonByText(rendered.container, "Add usage").disabled, false);
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);

    await clickButton(rendered.container, rendered.window, "Add usage");
    assert.equal(
      rendered.container.querySelector("h2")?.textContent,
      "Add usage",
    );
    assert.match(rendered.container.textContent ?? "", /Choose an amount/);
  } finally {
    await rendered.cleanup();
  }
});

test("keeps an in-place Family saved-card result visible until dismissal", async () => {
  mocks.requestHostedOnboardingJson.mockImplementation(async (request: {
    method: string;
  }) => request.method === "POST"
    ? {
        purchaseId: "hucp_family_owner_saved_card",
        status: "payment_pending",
      }
    : {
        purchaseId: "hucp_family_owner_saved_card",
        status: "fulfilled",
      });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      checkoutUrl:
        "/api/settings/billing/family/members/member_owner/usage-credit/checkout",
      initialOpen: true,
      offers: usageCreditOffers(),
      payerMemberId: TEST_PAYER_MEMBER_ID,
      scope: "family",
      targetLabel: "you",
    }),
    { requireButton: false },
  );

  try {
    await clickRadio(rendered.container, rendered.window, "usage_1000");
    await clickButton(rendered.container, rendered.window, "Add usage · $10");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(1, {
      method: "POST",
      payload: {
        clientRequestKey: "00000000-0000-4000-8000-000000000001",
        offerCode: "usage_1000",
      },
      signal: expect.any(AbortSignal),
      url:
        "/api/settings/billing/family/members/member_owner/usage-credit/checkout",
    });
    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(2, {
      method: "GET",
      signal: expect.any(AbortSignal),
      url:
        "/api/settings/billing/usage-credit/purchases/hucp_family_owner_saved_card",
    });
    assert.match(rendered.container.textContent ?? "", /Usage added for you/);
    assert.match(
      rendered.container.textContent ?? "",
      /The available usage for you has been updated\./,
    );
    assert.ok(rendered.container.querySelector('[role="dialog"]'));
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.match(rendered.container.textContent ?? "", /Usage added for you/);

    await clickButton(rendered.container, rendered.window, "Close");
    assert.equal(rendered.container.querySelector('[role="dialog"]'), null);

    await clickButton(rendered.container, rendered.window, "Add usage");
    assert.equal(
      rendered.container.querySelector("h2")?.textContent,
      "Add usage for you",
    );
    assert.match(rendered.container.textContent ?? "", /Choose an amount/);
  } finally {
    await rendered.cleanup();
  }
});

test("keeps a lagging successful Settings return quiet through fulfillment", async () => {
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_webhook_lag000",
      },
      quietSuccessfulReturn: true,
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

    assert.equal(rendered.container.querySelector('[role="dialog"]'), null);
    assert.equal(hasButton(rendered.container, "Resume checkout"), false);
    assert.equal(hasButton(rendered.container, "Cancel checkout"), false);
    const status = rendered.container.querySelector('[role="status"]');
    assert.ok(status);
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.equal(status.textContent, "");

    await act(async () => {
      vi.advanceTimersByTime(1_250);
      await Promise.resolve();
    });

    assert.equal(rendered.container.querySelector('[role="dialog"]'), null);
    assert.equal(rendered.container.querySelector('[role="status"]'), status);
    assert.match(
      status.textContent ?? "",
      /Usage added\. Your available usage has been updated\./,
    );
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("shows a compact recovery dialog when a successful return did not complete", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    purchaseId: "hucp_quiet_failed00",
    status: "payment_failed",
  });
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      offers: [],
      purchaseReturn: {
        kind: "success",
        purchaseId: "hucp_quiet_failed00",
      },
      quietSuccessfulReturn: true,
      renderPurchaseDetails: createElement("p", null, "Purchase details"),
    }),
    {
      location: {
        href: "https://example.test/settings?usagePurchase=hucp_quiet_failed00&usageCheckout=success",
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
      /The payment did not complete\. No usage was added\./,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Purchase details/);
    assert.match(
      rendered.container.querySelector('[role="dialog"]')?.className ?? "",
      /sm:max-w-md/,
    );
    assert.equal(buttonByText(rendered.container, "Close").disabled, false);
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
      payerMemberId: TEST_PAYER_MEMBER_ID,
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

    assert.doesNotMatch(rendered.container.textContent ?? "", /Nice one/);
    assert.match(
      rendered.container.textContent ?? "",
      /This group has more Murph/,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Your contribution is ready\./,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Open Messages, then choose this group to keep going\./,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Back to the chat/,
    );
    const contactLink = rendered.container.querySelector("a");
    assert.ok(contactLink);
    assert.equal(contactLink.textContent, "Open Messages");
    assert.equal(contactLink.getAttribute("href"), "sms:");
    assert.match(contactLink.className, /w-full/);
    assert.ok(contactLink.querySelector('[data-icon="inline-start"]'));
    const dialog = rendered.container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.className, /sm:max-w-lg/);
    assert.doesNotMatch(dialog.className, /sm:max-w-2xl/);
    const title = dialog.querySelector("h2");
    assert.ok(title);
    assert.match(title.className, /text-4xl/);
    assert.doesNotMatch(title.className, /sm:text-5xl/);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Text Murph/);
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Done",
      ),
      false,
    );
    assert.equal(
      rendered.container.querySelectorAll('[role="status"]').length,
      1,
    );
    const status = rendered.container.querySelector('[role="status"]');
    assert.ok(status);
    assert.equal(
      status.getAttribute("aria-label"),
      "This group has more Murph. Your contribution is ready.",
    );
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.equal(
      status.querySelector("svg")?.getAttribute("aria-hidden"),
      "true",
    );
  } finally {
    await rendered.cleanup();
  }
});

test("keeps the fulfilled group receipt content-height on mobile", async () => {
  mocks.isMobile.mockReturnValue(true);
  const { HostedUsageTopUpDialog } = await import(
    "@/src/components/settings/hosted-usage-top-up-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(HostedUsageTopUpDialog, {
      payerMemberId: TEST_PAYER_MEMBER_ID,
      activePurchase: {
        offerCode: "usage_10_usd",
        purchaseId: "hucp_group_mobile_fulfilled",
        retryAllowed: false,
        status: "fulfilled",
      },
      initialOpen: true,
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
    const drawer = rendered.container.querySelector(
      '[data-slot="drawer-content"]',
    );
    assert.ok(drawer);
    assert.doesNotMatch(drawer.className, /h-\[calc\(100dvh-0\.75rem\)\]/);
    assert.match(
      rendered.container.textContent ?? "",
      /Your contribution is ready/,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Open Messages, then choose this group to keep going/,
    );
    const contactLink = rendered.container.querySelector('a[href="sms:"]');
    assert.ok(contactLink);
    const scrollBody = contactLink.closest(".overflow-y-auto");
    assert.ok(scrollBody);
    assert.match(scrollBody.className, /min-h-0/);
    assert.match(scrollBody.className, /overscroll-contain/);
    assert.equal(
      Array.from(rendered.container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Done",
      ),
      false,
    );
    assert.equal(buttonByText(rendered.container, "Close").disabled, false);
    assert.equal(
      rendered.container.querySelectorAll('[role="status"]').length,
      1,
    );
  } finally {
    await rendered.cleanup();
  }
});

function usageCreditOffers() {
  return [
    { amountLabel: "$5", offerCode: "usage_500" },
    { amountLabel: "$10", offerCode: "usage_1000" },
    { amountLabel: "$25", offerCode: "usage_2500" },
  ] as const;
}

function usageTopUpRequestStorageKey(
  checkoutUrl: string,
  payerMemberId = TEST_PAYER_MEMBER_ID,
): string {
  return [
    "murph:usage-top-up:unresolved:v1:",
    encodeURIComponent(payerMemberId),
    ":",
    encodeURIComponent(checkoutUrl),
  ].join("");
}

function groupSponsorshipOffers() {
  return [
    {
      amountLabel: "$5",
      offerCode: "usage_5_usd",
      runningBitDurationLabel: null,
    },
    {
      amountLabel: "$10",
      offerCode: "usage_10_usd",
      runningBitDurationLabel: "1 day",
    },
    {
      amountLabel: "$20",
      offerCode: "usage_20_usd",
      runningBitDurationLabel: "3 days",
    },
  ] as const;
}

function groupSponsorshipMonthlyCaps() {
  return [
    { amountLabel: "$5", monthlyCapMinor: 500 },
    { amountLabel: "$10", monthlyCapMinor: 1_000 },
    { amountLabel: "$20", monthlyCapMinor: 2_000 },
  ] as const;
}

function definitionValueByTerm(
  container: HTMLElement,
  term: string,
): string | null {
  const termElement = Array.from(container.querySelectorAll("dt")).find(
    (candidate) => candidate.textContent?.trim() === term,
  );
  return (
    termElement?.parentElement?.querySelector("dd")?.textContent?.trim() ?? null
  );
}

function controlByLabel(
  container: HTMLElement,
  labelText: string,
): HTMLElement | null {
  const label = Array.from(
    container.querySelectorAll<HTMLLabelElement>("label"),
  ).find((candidate) => candidate.textContent?.includes(labelText));
  const controlId = label?.getAttribute("for");
  if (!controlId) {
    return null;
  }
  return (
    Array.from(container.querySelectorAll<HTMLElement>("[id]")).find(
      (candidate) => candidate.id === controlId,
    ) ?? null
  );
}

function requireTextControlByLabel(
  container: HTMLElement,
  window: Window & typeof globalThis,
  labelText: string,
): HTMLInputElement | HTMLTextAreaElement {
  const control = controlByLabel(container, labelText);
  assert.ok(
    control instanceof window.HTMLInputElement ||
      control instanceof window.HTMLTextAreaElement,
  );
  return control;
}

async function clickCheckboxByLabel(
  container: HTMLElement,
  window: Window & typeof globalThis,
  labelText: string,
) {
  const control = controlByLabel(container, labelText);
  assert.ok(control instanceof window.HTMLButtonElement);
  assert.equal(control.getAttribute("role"), "checkbox");
  await act(async () => {
    control.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function setTextInput(
  element: Element | null,
  window: Window & typeof globalThis,
  value: string,
) {
  assert.ok(
    element instanceof window.HTMLInputElement ||
      element instanceof window.HTMLTextAreaElement,
  );
  await act(async () => {
    const prototype = element instanceof window.HTMLInputElement
      ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
    await Promise.resolve();
  });
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
  await clickResolvedButton(buttonByText(container, label), window);
}

async function clickExactButton(
  container: HTMLElement,
  window: Window & typeof globalThis,
  label: string,
) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  assert.ok(button);
  await clickResolvedButton(button, window);
}

async function clickResolvedButton(
  button: HTMLButtonElement,
  window: Window & typeof globalThis,
) {
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
