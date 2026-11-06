import assert from "node:assert/strict";

import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type ComponentProps,
} from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { HostedOnboardingApiError } from "@/src/components/hosted-onboarding/client-api";
import type {
  GroupFundingCheckout as GroupFundingCheckoutComponent,
} from "@/src/components/hosted-groups/group-funding-checkout";
import {
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
} from "@/src/lib/hosted-onboarding/usage-credit-capacity-conflict";

import {
  createMemoryStorage,
  renderClientComponent,
} from "./render-client-component";

const mocks = vi.hoisted(() => ({
  randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
  requestHostedOnboardingJson: vi.fn(),
  routerRefresh: vi.fn(),
}));

const CHECKOUT_URL =
  "/api/groups/fund/group_join_code_1234/usage-credit/checkout";
const REQUEST_KEY = "00000000-0000-4000-8000-000000000001";
const ONE_TIME_OFFERS = [
  { amountLabel: "$5", offerCode: "usage_5_usd" },
  { amountLabel: "$10", offerCode: "usage_10_usd" },
  { amountLabel: "$20", offerCode: "usage_20_usd" },
];
const MONTHLY_PLAN = {
  capOptions: [
    { amountLabel: "$5", monthlyCapMinor: 500 },
    { amountLabel: "$10", monthlyCapMinor: 1_000 },
    { amountLabel: "$20", monthlyCapMinor: 2_000 },
    { amountLabel: "$50", monthlyCapMinor: 5_000 },
  ],
  offer: ONE_TIME_OFFERS[0]!,
} satisfies ComponentProps<typeof GroupFundingCheckoutComponent>["monthly"];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}));

vi.mock(
  "@/src/components/hosted-onboarding/client-api",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/src/components/hosted-onboarding/client-api")
    >()),
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  }),
);

vi.mock("@/src/components/ui/button", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement("button", props),
  buttonVariants: () => "",
}));

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.randomUUID.mockReset();
  mocks.randomUUID.mockReturnValue(REQUEST_KEY);
  mocks.requestHostedOnboardingJson.mockReset();
  mocks.routerRefresh.mockReset();
  vi.stubGlobal("crypto", { randomUUID: mocks.randomUUID });
});

test("sends the amount on the dial and says what it will do", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_monthly",
    status: "checkout_open",
    url: "https://checkout.stripe.test/group-monthly",
  });
  const rendered = await renderCheckout();

  try {
    assert.ok(buttonByText(rendered.container, "Sponsor up to $5 a month"));
    await tapStop(rendered, "$10 a month");

    assert.equal(
      sliderOf(rendered.container).getAttribute("aria-valuetext"),
      "$10 a month",
    );
    await clickButton(rendered, "Sponsor up to $10 a month");

    expect(postedPayloads()).toEqual([
      {
        clientRequestKey: REQUEST_KEY,
        monthlyCapMinor: 1_000,
        offerCode: "usage_5_usd",
        sponsorshipKind: "monthly",
      },
    ]);
    expect(rendered.assign).toHaveBeenCalledWith(
      "https://checkout.stripe.test/group-monthly",
    );
  } finally {
    await rendered.cleanup();
  }
});

test("moves the dial with the keyboard", async () => {
  const rendered = await renderCheckout();

  try {
    const slider = sliderOf(rendered.container);
    await pressKey(rendered, slider, "End");
    assert.equal(slider.getAttribute("aria-valuetext"), "$50 a month");
    await pressKey(rendered, slider, "ArrowLeft");
    assert.equal(slider.getAttribute("aria-valuetext"), "$20 a month");
    await pressKey(rendered, slider, "Home");
    assert.equal(slider.getAttribute("aria-valuetext"), "$5 a month");
    assert.ok(buttonByText(rendered.container, "Sponsor up to $5 a month"));
  } finally {
    await rendered.cleanup();
  }
});

test("offers no personalization and sends none", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_quiet",
    status: "checkout_open",
    url: "https://checkout.stripe.test/group-quiet",
  });
  const rendered = await renderCheckout();

  try {
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Personalize|Credit it as|running bit/iu,
    );
    assert.equal(rendered.container.querySelector("textarea, input"), null);
    await clickButton(rendered, "Sponsor up to $5 a month");

    assert.equal("sponsorship" in postedPayloads()[0]!, false);
  } finally {
    await rendered.cleanup();
  }
});

test("switching modes keeps the fixed $5 activation offer and the chosen cap", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_mode",
    status: "checkout_open",
    url: "https://checkout.stripe.test/group-mode",
  });
  const rendered = await renderCheckout();

  try {
    await tapStop(rendered, "$20 a month");
    await clickButton(rendered, "Give once instead");
    await tapStop(rendered, "$20 one time");
    assert.ok(buttonByText(rendered.container, "Give $20"));
    await clickButton(rendered, "Sponsor monthly instead");

    await clickButton(rendered, "Sponsor up to $20 a month");

    expect(postedPayloads()).toEqual([
      {
        clientRequestKey: REQUEST_KEY,
        monthlyCapMinor: 2_000,
        offerCode: "usage_5_usd",
        sponsorshipKind: "monthly",
      },
    ]);
  } finally {
    await rendered.cleanup();
  }
});

test("contributes the chosen one-time amount with no monthly terms", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_one_time",
    status: "checkout_open",
    url: "https://checkout.stripe.test/group-one-time",
  });
  const rendered = await renderCheckout({
    monthly: null,
    sponsoredByAnother: true,
  });

  try {
    assert.match(
      rendered.container.textContent ?? "",
      /Sunday sleep crew is sponsored\.You can still chip in\./u,
    );
    assert.equal(hasButton(rendered.container, "Sponsor monthly instead"), false);
    await tapStop(rendered, "$10 one time");
    await clickButton(rendered, "Give $10");

    expect(postedPayloads()).toEqual([
      {
        clientRequestKey: REQUEST_KEY,
        offerCode: "usage_10_usd",
        sponsorshipKind: "one_time",
      },
    ]);
  } finally {
    await rendered.cleanup();
  }
});

test("falls back to one-time terms when the chat gets a sponsor mid-visit", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_late",
    status: "checkout_open",
    url: "https://checkout.stripe.test/group-late",
  });
  const rendered = await renderCheckout();

  try {
    await rendered.rerender(await checkoutElement({ monthly: null }));
    await clickButton(rendered, "Give $5");

    expect(postedPayloads()).toEqual([
      {
        clientRequestKey: REQUEST_KEY,
        offerCode: "usage_5_usd",
        sponsorshipKind: "one_time",
      },
    ]);
  } finally {
    await rendered.cleanup();
  }
});

test("lands back on the page after canceling at Stripe", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_canceled",
    status: "expired",
  });
  const rendered = await renderCheckout({
    purchaseReturn: { kind: "cancel", purchaseId: "hucp_group_canceled" },
  });

  try {
    await settle();

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/api/settings/billing/usage-credit/purchases/hucp_group_canceled/expire",
      }),
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Checkout canceled\. Nothing was charged\./u,
    );
    assert.ok(buttonByText(rendered.container, "Sponsor up to $5 a month"));
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("clears the canceled note when a new checkout starts", async () => {
  mocks.requestHostedOnboardingJson.mockImplementation(
    async (request: { url: string }) =>
      request.url === CHECKOUT_URL
        ? {
            purchaseId: "hucp_group_retry",
            status: "checkout_open",
            url: "https://checkout.stripe.test/group-retry",
          }
        : { purchaseId: "hucp_group_canceled", status: "expired" },
  );
  const rendered = await renderCheckout({
    purchaseReturn: { kind: "cancel", purchaseId: "hucp_group_canceled" },
  });

  try {
    await settle();
    await clickButton(rendered, "Sponsor up to $5 a month");

    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Checkout canceled/u,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("follows the real outcome when a canceled return had already paid", async () => {
  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce({
      purchaseId: "hucp_group_paid",
      status: "payment_pending",
    })
    .mockResolvedValue({
      purchaseId: "hucp_group_paid",
      status: "fulfilled",
    });
  const rendered = await renderCheckout({
    purchaseReturn: { kind: "cancel", purchaseId: "hucp_group_paid" },
  });

  try {
    await settle();

    assert.match(
      rendered.container.textContent ?? "",
      /This group has more Murph/u,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Checkout canceled/u,
    );
    assert.ok(rendered.container.querySelector('a[href="sms:"]'));
  } finally {
    await rendered.cleanup();
  }
});

test("returns to the page after a failed payment", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_failed",
    status: "payment_failed",
  });
  const rendered = await renderCheckout({
    purchaseReturn: { kind: "success", purchaseId: "hucp_group_failed" },
  });

  try {
    await settle();

    assert.match(
      rendered.container.textContent ?? "",
      /That payment didn’t go through\. Nothing was charged\./u,
    );
    assert.ok(buttonByText(rendered.container, "Sponsor up to $5 a month"));
  } finally {
    await rendered.cleanup();
  }
});

test("locks an uncertain attempt to its amount and request key", async () => {
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("Stripe is unavailable."))
    .mockResolvedValueOnce({
      purchaseId: "hucp_group_retry",
      recovered: true,
      status: "payment_pending",
    });
  const rendered = await renderCheckout();

  try {
    await tapStop(rendered, "$20 a month");
    await clickButton(rendered, "Sponsor up to $20 a month");

    assert.match(
      rendered.container.textContent ?? "",
      /We couldn’t confirm that payment\./u,
    );
    assert.equal(hasButton(rendered.container, "Change amount"), false);
    assert.equal(hasButton(rendered.container, "Give once instead"), false);
    assert.equal(rendered.container.querySelector('[role="slider"]'), null);

    await clickButton(rendered, "Check payment");

    expect(postedPayloads()).toEqual([
      {
        clientRequestKey: REQUEST_KEY,
        monthlyCapMinor: 2_000,
        offerCode: "usage_5_usd",
        sponsorshipKind: "monthly",
      },
      {
        clientRequestKey: REQUEST_KEY,
        monthlyCapMinor: 2_000,
        offerCode: "usage_5_usd",
        recoveryOnly: true,
        sponsorshipKind: "monthly",
      },
    ]);
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("resumes or cancels an open checkout", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_open",
    status: "checkout_open",
    url: "https://checkout.stripe.test/group-open",
  });
  const rendered = await renderCheckout({
    activePurchase: {
      offerCode: "usage_5_usd",
      purchaseId: "hucp_group_open",
      retryAllowed: false,
      status: "checkout_open",
      url: "https://checkout.stripe.test/group-open",
    },
    initialMode: "monthly",
    initialMonthlyCapMinor: 2_000,
  });

  try {
    assert.match(
      rendered.container.textContent ?? "",
      /You left checkout open\./u,
    );
    await clickButton(rendered, "Keep going");
    expect(rendered.assign).toHaveBeenCalledWith(
      "https://checkout.stripe.test/group-open",
    );
    assert.ok(hasButton(rendered.container, "Cancel checkout"));
  } finally {
    await rendered.cleanup();
  }
});

test("retries a pending activation with its original cap", async () => {
  vi.useFakeTimers();
  mocks.requestHostedOnboardingJson.mockImplementation(
    async (request: { method: string }) => ({
      purchaseId: "hucp_group_pending",
      recovered: request.method === "POST",
      status: "payment_pending",
    }),
  );
  const rendered = await renderCheckout({
    activePurchase: {
      offerCode: "usage_5_usd",
      purchaseId: "hucp_group_pending",
      retryAllowed: true,
      status: "payment_pending",
    },
    initialMode: "monthly",
    initialMonthlyCapMinor: 5_000,
  });

  try {
    for (let readIndex = 0; readIndex < 10; readIndex += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1_250);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    await clickButton(rendered, "Retry payment");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        clientRequestKey: REQUEST_KEY,
        monthlyCapMinor: 5_000,
        offerCode: "usage_5_usd",
        recoveryOnly: true,
        sponsorshipKind: "monthly",
      },
      signal: expect.any(AbortSignal),
      url: CHECKOUT_URL,
    });
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("shows another chat's checkout without a way to pay for it here", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_other_target",
    status: "checkout_open",
  });
  const rendered = await renderCheckout({
    activePurchase: {
      offerCode: "usage_10_usd",
      purchaseId: "hucp_other_target",
      retryAllowed: false,
      status: "checkout_open",
      targetConflict: true,
    },
  });

  try {
    await settle();

    assert.match(rendered.container.textContent ?? "", /It’s for another chat/u);
    assert.equal(hasButton(rendered.container, "Keep going"), false);
    assert.equal(hasButton(rendered.container, "Retry payment"), false);
    assert.equal(
      buttonByText(rendered.container, "Cancel checkout").disabled,
      false,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("starts over once another chat's checkout is closed", async () => {
  mocks.requestHostedOnboardingJson.mockImplementation(
    async (request: { method: string }) =>
      request.method === "POST"
        ? { purchaseId: "hucp_other_target", status: "expired" }
        : { purchaseId: "hucp_other_target", status: "checkout_open" },
  );
  const rendered = await renderCheckout({
    activePurchase: {
      offerCode: "usage_10_usd",
      purchaseId: "hucp_other_target",
      retryAllowed: false,
      status: "checkout_open",
      targetConflict: true,
    },
  });

  try {
    await settle();
    await clickButton(rendered, "Cancel checkout");
    await settle();
    assert.match(
      rendered.container.textContent ?? "",
      /Your earlier checkout ended/u,
    );

    await clickButton(rendered, "Start over");

    assert.ok(buttonByText(rendered.container, "Sponsor up to $5 a month"));
    expect(mocks.routerRefresh).toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("never offers payment on a selection that doesn't match the open purchase", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_terms",
    recovered: true,
    selectionConflict: "sponsorship",
    status: "checkout_open",
  });
  const rendered = await renderCheckout();

  try {
    await tapStop(rendered, "$10 a month");
    await clickButton(rendered, "Sponsor up to $10 a month");
    await settle();

    assert.match(
      rendered.container.textContent ?? "",
      /Finish or cancel it before choosing another amount\./u,
    );
    assert.equal(hasButton(rendered.container, "Keep going"), false);
  } finally {
    await rendered.cleanup();
  }
});

test("explains a full group without a dead-end form", async () => {
  mocks.requestHostedOnboardingJson.mockRejectedValue(
    new HostedOnboardingApiError({
      code: HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
      message: HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
      retryable: false,
    }),
  );
  const rendered = await renderCheckout();

  try {
    await clickButton(rendered, "Sponsor up to $5 a month");

    assert.match(
      rendered.container.textContent ?? "",
      /The group’s topped up for now\./u,
    );
    assert.equal(rendered.container.querySelector('[role="slider"]'), null);

    await clickButton(rendered, "Try again");

    assert.ok(buttonByText(rendered.container, "Sponsor up to $5 a month"));
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("names a pending payment as a payment when offering to cancel it", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    cancelAllowed: true,
    purchaseId: "hucp_group_pending",
    status: "payment_pending",
  });
  const rendered = await renderCheckout({
    activePurchase: {
      cancelAllowed: true,
      offerCode: "usage_5_usd",
      purchaseId: "hucp_group_pending",
      retryAllowed: false,
      status: "payment_pending",
    },
  });

  try {
    assert.ok(hasButton(rendered.container, "Cancel payment"));
    assert.equal(hasButton(rendered.container, "Cancel checkout"), false);
  } finally {
    await rendered.cleanup();
  }
});

test("moves focus to the new state when an outcome replaces the control", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_recovered",
    recovered: true,
    status: "payment_pending",
  });
  const rendered = await renderCheckout();
  const focused = recordFocus(rendered);

  try {
    await clickButton(rendered, "Sponsor up to $5 a month");

    const heading = rendered.container.querySelector("h1");
    assert.ok(heading);
    assert.match(heading.textContent ?? "", /Confirming your payment\./u);
    assert.equal(focused.at(-1)?.tagName, "H1");
  } finally {
    await rendered.cleanup();
  }
});

test("moves focus again when a status screen reaches a new outcome", async () => {
  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce({
      purchaseId: "hucp_group_paid",
      status: "payment_pending",
    })
    .mockResolvedValue({
      purchaseId: "hucp_group_paid",
      status: "fulfilled",
    });
  const rendered = await renderClientComponent(createElement("div"), {
    location: { href: "https://example.test/groups/fund/group_join_code_1234" },
    requireButton: false,
  });
  const focused = recordFocus(rendered);

  try {
    await rendered.rerender(await checkoutElement({
      purchaseReturn: { kind: "cancel", purchaseId: "hucp_group_paid" },
    }));
    await settle();

    expect(focused.length).toBeGreaterThan(1);
    assert.equal(focused.at(-1)?.tagName, "H1");
    assert.match(focused.at(-1)?.textContent ?? "", /This group has more Murph/u);
  } finally {
    await rendered.cleanup();
  }
});

test("leaves focus alone while a payment keeps confirming", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_pending",
    status: "payment_pending",
  });
  const rendered = await renderClientComponent(createElement("div"), {
    location: { href: "https://example.test/groups/fund/group_join_code_1234" },
    requireButton: false,
  });
  const focused = recordFocus(rendered);
  vi.useFakeTimers();

  try {
    await rendered.rerender(await checkoutElement({
      purchaseReturn: { kind: "success", purchaseId: "hucp_group_pending" },
    }));
    await settle();
    const settled = focused.length;
    const reads = mocks.requestHostedOnboardingJson.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(mocks.requestHostedOnboardingJson.mock.calls.length).toBeGreaterThan(reads);
    expect(focused.length).toBe(settled);
  } finally {
    vi.useRealTimers();
    await rendered.cleanup();
  }
});

test("moves focus to the note after a canceled checkout", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    purchaseId: "hucp_group_canceled",
    status: "expired",
  });
  const rendered = await renderClientComponent(createElement("div"), {
    location: { href: "https://example.test/groups/fund/group_join_code_1234" },
    requireButton: false,
  });
  const focused = recordFocus(rendered);

  try {
    await rendered.rerender(await checkoutElement({
      purchaseReturn: { kind: "cancel", purchaseId: "hucp_group_canceled" },
    }));
    await settle();

    assert.match(
      focused.at(-1)?.textContent ?? "",
      /Checkout canceled\. Nothing was charged\./u,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("keeps the amount but blocks paying when the tab can't hold a request key", async () => {
  const sessionStorage = createMemoryStorage();
  sessionStorage.getItem = () => {
    throw new Error("Storage is blocked.");
  };
  const rendered = await renderCheckout({}, { sessionStorage });

  try {
    await settle();
    assert.match(
      rendered.container.textContent ?? "",
      /can’t safely start a payment/u,
    );
    assert.equal(
      buttonByText(rendered.container, "Sponsor up to $5 a month").disabled,
      true,
    );
    await tapStop(rendered, "$10 a month");
    assert.ok(buttonByText(rendered.container, "Sponsor up to $10 a month"));
  } finally {
    await rendered.cleanup();
  }
});

test("explains and blocks a retry when the tab can't save the request key", async () => {
  const sessionStorage = createMemoryStorage();
  sessionStorage.setItem = () => {
    throw new Error("Storage is full.");
  };
  const rendered = await renderCheckout({}, { sessionStorage });

  try {
    await clickButton(rendered, "Sponsor up to $5 a month");

    assert.match(rendered.container.textContent ?? "", /Checkout didn’t open\./u);
    assert.match(
      rendered.container.textContent ?? "",
      /can’t safely start a payment/u,
    );
    assert.equal(buttonByText(rendered.container, "Try again").disabled, true);
    assert.equal(hasButton(rendered.container, "Change amount"), true);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

type CheckoutProps = ComponentProps<typeof GroupFundingCheckoutComponent>;

async function checkoutElement(overrides: Partial<CheckoutProps> = {}) {
  const { GroupFundingCheckout } = await import(
    "@/src/components/hosted-groups/group-funding-checkout"
  );
  return createElement(GroupFundingCheckout, {
    checkoutUrl: CHECKOUT_URL,
    groupName: "Sunday sleep crew",
    monthly: MONTHLY_PLAN,
    oneTimeOffers: ONE_TIME_OFFERS,
    payerMemberId: "hbm_group_funding_payer",
    ...overrides,
  });
}

async function renderCheckout(
  overrides: Partial<CheckoutProps> = {},
  options: { sessionStorage?: Storage } = {},
) {
  const rendered = await renderClientComponent(await checkoutElement(overrides), {
    location: { href: "https://example.test/groups/fund/group_join_code_1234" },
    requireButton: false,
    ...options,
  });
  await settle();
  return rendered;
}

async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) {
      await Promise.resolve();
    }
  });
}

type RenderedCheckout = Awaited<ReturnType<typeof renderCheckout>>;

// The test DOM has no focus model, so record the calls instead.
function recordFocus(rendered: Pick<RenderedCheckout, "window">): HTMLElement[] {
  const focused: HTMLElement[] = [];
  vi.spyOn(rendered.window.HTMLElement.prototype, "focus").mockImplementation(
    function record(this: HTMLElement) {
      focused.push(this);
    },
  );
  return focused;
}

function postedPayloads(): Array<Record<string, unknown>> {
  return mocks.requestHostedOnboardingJson.mock.calls
    .map(([request]) => request)
    .filter((request) => request.url === CHECKOUT_URL)
    .map((request) => request.payload);
}

function sliderOf(container: HTMLElement): HTMLElement {
  const slider = container.querySelector<HTMLElement>('[role="slider"]');
  assert.ok(slider);
  return slider;
}

async function tapStop(rendered: RenderedCheckout, label: string) {
  const stop = rendered.container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  assert.ok(stop, `missing dial stop ${label}`);
  await clickResolved(rendered, stop);
}

async function pressKey(
  rendered: RenderedCheckout,
  element: HTMLElement,
  key: string,
) {
  await act(async () => {
    element.dispatchEvent(
      Object.assign(new rendered.window.Event("keydown", { bubbles: true }), {
        key,
      }),
    );
    await Promise.resolve();
  });
}

async function clickButton(rendered: RenderedCheckout, label: string) {
  await clickResolved(rendered, buttonByText(rendered.container, label));
}

async function clickResolved(
  rendered: RenderedCheckout,
  button: HTMLButtonElement,
) {
  await act(async () => {
    button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  assert.ok(button, `missing button ${label}`);
  return button;
}

function hasButton(container: HTMLElement, label: string): boolean {
  return Array.from(container.querySelectorAll("button")).some((button) =>
    button.textContent?.includes(label),
  );
}
