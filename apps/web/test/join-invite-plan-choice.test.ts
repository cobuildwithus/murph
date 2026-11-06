import assert from "node:assert/strict";

import { act, createElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { JoinInvitePlanChoice } from "@/src/components/hosted-onboarding/join-invite-plan-choice";
import { JOIN_FAMILY_FEATURES } from "@/src/lib/hosted-onboarding/plan-features";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  requestHostedBillingCheckout: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("next/image", () => ({
  default(props: { alt: string; src: string }) {
    return createElement("img", { alt: props.alt, src: props.src });
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
}));

vi.mock("@/src/components/settings/hosted-login-method-dialog", () => ({
  HostedLoginMethodEditor() {
    return null;
  },
}));

vi.mock("@/src/components/ui/payment-button", () => ({
  PaymentButton(props: {
    disabled?: boolean;
    idleLabel: string;
    onClick: () => Promise<void> | void;
    onError?: (error: unknown) => void;
    onSuccess?: () => void;
  }) {
    async function handleClick() {
      try {
        await props.onClick();
        props.onSuccess?.();
      } catch (error) {
        props.onError?.(error);
      }
    }

    return createElement(
      "button",
      {
        "data-payment-button": "true",
        disabled: props.disabled,
        onClick: handleClick,
        type: "button",
      },
      props.idleLabel,
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/client-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/components/hosted-onboarding/client-api")>();

  return {
    ...actual,
    requestHostedBillingCheckout: mocks.requestHostedBillingCheckout,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

const PULSE = {
  description: "Questions, decisions, plans, and follow-through.",
  idleLabel: "Get Pulse",
  name: "Pulse",
  planCode: "launch_monthly",
  price: "$8",
} as const;
const EDGE = {
  description: "More guidance and deeper research.",
  disabledLabel: "Coming soon",
  idleLabel: "Get Edge",
  name: "Edge",
  planCode: "launch_edge_monthly",
  price: "$20",
} as const;
const FAMILY = {
  description: "Private Murph accounts for the people closest to you.",
  features: JOIN_FAMILY_FEATURES,
  price: "$7",
};

beforeEach(() => {
  vi.clearAllMocks();
});

test("the pill is the selected plan, and checkout opens that plan", async () => {
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: "https://checkout.example.test/session",
  });
  const { assign, cleanup, container } = await render();

  expect(payButton(container).textContent).toBe("Get Pulse");

  await choose(container, "Edge");
  expect(payButton(container).textContent).toBe("Get Edge");

  await act(async () => {
    payButton(container).click();
    await Promise.resolve();
  });

  expect(mocks.requestHostedBillingCheckout).toHaveBeenCalledTimes(1);
  expect(mocks.requestHostedBillingCheckout).toHaveBeenCalledWith({
    billingPlanCode: "launch_edge_monthly",
    inviteCode: "invite-code",
  });
  expect(assign).toHaveBeenCalledWith("https://checkout.example.test/session");
  await cleanup();
});

test("selection locks while a checkout runs, so the pill can't change plans under it", async () => {
  let failCheckout: (error: Error) => void = () => {};
  mocks.requestHostedBillingCheckout.mockReturnValue(
    new Promise((_resolve, reject) => {
      failCheckout = reject;
    }),
  );
  const { cleanup, container } = await render();

  await act(async () => {
    payButton(container).click();
    await Promise.resolve();
  });
  expect(radio(container, "Edge").disabled).toBe(true);

  await choose(container, "Edge");
  expect(radio(container, "Pulse").checked).toBe(true);
  expect(payButton(container).textContent).toBe("Get Pulse");

  await act(async () => {
    failCheckout(new Error("Checkout is unavailable."));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(radio(container, "Edge").disabled).toBe(false);
  expect(container.querySelector("[role='alert']")?.textContent).toContain(
    "Unable to continue. Checkout is unavailable.",
  );

  await choose(container, "Edge");
  expect(payButton(container).textContent).toBe("Get Edge");
  expect(container.querySelector("[role='alert']")).toBeNull();
  await cleanup();
});

test("back from checkout gives the page its choice again", async () => {
  mocks.requestHostedBillingCheckout.mockReturnValue(new Promise(() => {}));
  const { cleanup, container, window } = await render();

  await act(async () => {
    payButton(container).click();
    await Promise.resolve();
  });
  expect(radio(container, "Edge").disabled).toBe(true);

  await act(async () => {
    const pageShow = new window.Event("pageshow");
    Object.defineProperty(pageShow, "persisted", { value: true });
    window.dispatchEvent(pageShow);
  });

  expect(radio(container, "Edge").disabled).toBe(false);
  await cleanup();
});

test("an unconfigured Edge plan stays on the page as Coming soon", async () => {
  const { cleanup, container } = await render({
    plans: [PULSE, { ...EDGE, planCode: null }],
  });

  expect(container.textContent).toContain("$20");
  expect(payButton(container).disabled).toBe(false);

  await choose(container, "Edge");

  expect(payButton(container).textContent).toBe("Coming soon");
  expect(payButton(container).disabled).toBe(true);
  await cleanup();
});

test("billing that isn't ready disables each plan with today's labels", async () => {
  const { cleanup, container } = await render({ billingReady: false });

  expect(payButton(container).textContent).toBe("Get Pulse");
  expect(payButton(container).disabled).toBe(true);

  await choose(container, "Edge");

  expect(payButton(container).textContent).toBe("Coming soon");
  expect(payButton(container).disabled).toBe(true);
  await cleanup();
});

test("Family recovery leads with Family and still offers both individual plans", async () => {
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: "https://checkout.example.test/session",
  });
  const { cleanup, container } = await render({ family: FAMILY });

  expect(radio(container, "Family").checked).toBe(true);
  expect(container.querySelector("[data-payment-button]")).toBeNull();
  expect(findButton(container, /^Restart Family$/)).toBeTruthy();
  for (const feature of JOIN_FAMILY_FEATURES) {
    expect(container.textContent).toContain(feature);
  }

  await choose(container, "Pulse");
  expect(payButton(container).textContent).toBe("Get Pulse");
  expect(container.textContent).not.toContain(JOIN_FAMILY_FEATURES[0]);

  await choose(container, "Edge");
  expect(payButton(container).textContent).toBe("Get Edge");
  await cleanup();
});

test("restarting Family uses the Family checkout and locks the choice", async () => {
  mocks.requestHostedOnboardingJson.mockReturnValue(new Promise(() => {}));
  const { cleanup, container } = await render({ family: FAMILY });

  await act(async () => {
    findButton(container, /^Restart Family$/).click();
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    url: "/api/settings/billing/family/checkout",
  });
  expect(mocks.requestHostedBillingCheckout).not.toHaveBeenCalled();
  expect(radio(container, "Pulse").disabled).toBe(true);
  await cleanup();
});

async function render(
  overrides: Partial<Parameters<typeof JoinInvitePlanChoice>[0]> = {},
) {
  return renderClientComponent(
    createElement(JoinInvitePlanChoice, {
      billingReady: true,
      family: null,
      inviteCode: "invite-code",
      plans: [PULSE, EDGE],
      ...overrides,
    }),
    { requireButton: false },
  );
}

// Linkedom forwards neither a label's click nor a disabled input's refusal, so
// this does what a browser does on a click: nothing when disabled.
async function choose(container: Element, name: string) {
  const input = radio(container, name);
  if (input.disabled) return;
  await act(async () => {
    input.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

function radio(container: Element, name: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${name}"]`,
  );
  assert.ok(input);
  return input;
}

function payButton(container: Element): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>("[data-payment-button]");
  assert.ok(button);
  return button;
}

function findButton(container: Element, pattern: RegExp): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    pattern.test(candidate.textContent ?? ""),
  );
  assert.ok(button);
  return button;
}
