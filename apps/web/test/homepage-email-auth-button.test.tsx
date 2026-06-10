import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

type LoginCallbacks = {
  onComplete?: (params: { user: { linkedAccounts?: unknown } }) => void;
};

const mocks = vi.hoisted(() => ({
  loginCallbacks: null as LoginCallbacks | null,
  loginWithCode: vi.fn(),
  onAuthenticated: vi.fn(),
  sendCode: vi.fn(),
  usePrivy: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useLoginWithEmail(callbacks?: LoginCallbacks) {
    mocks.loginCallbacks = callbacks ?? null;

    return {
      loginWithCode: mocks.loginWithCode,
      sendCode: mocks.sendCode,
      state: { status: "initial" },
    };
  },
  usePrivy: mocks.usePrivy,
}));

import { HostedEmailAuthButton } from "@/src/components/hosted-onboarding/hosted-email-auth-button";

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.loginCallbacks = null;
  mocks.usePrivy.mockReturnValue({
    ready: true,
  });
  mocks.sendCode.mockResolvedValue(undefined);
  mocks.loginWithCode.mockResolvedValue(undefined);
  mocks.onAuthenticated.mockResolvedValue(undefined);
});

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

function HomepageEmailAuthButtonHarness() {
  const [active, setActive] = useState(false);

  return (
    <HostedEmailAuthButton
      active={active}
      onActivate={() => setActive(true)}
      onAuthenticated={mocks.onAuthenticated}
    />
  );
}

function HomepageEmailLoginButtonHarness() {
  const [active, setActive] = useState(false);

  return (
    <HostedEmailAuthButton
      active={active}
      disableSignup
      onActivate={() => setActive(true)}
      onAuthenticated={mocks.onAuthenticated}
    />
  );
}

test("HomepageEmailAuthButton prefills an initial email address", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(HostedEmailAuthButton, {
      active: true,
      initialEmailAddress: " buddy@example.com ",
      inline: true,
      onAuthenticated: mocks.onAuthenticated,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  const emailInput = container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;

  expect(emailInput?.value).toBe("buddy@example.com");
});

test("HomepageEmailAuthButton expands, sends a code, verifies it, and reports the authenticated session", async () => {
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(HomepageEmailAuthButtonHarness),
  );
  cleanupRender = cleanup;

  expect(button.className).toContain("order-2");

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.querySelector('label[for="homepage-email-address"]')).toBeNull();

  const emailInput = container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = container.querySelector("form");
  expect(emailInput).toBeTruthy();
  expect(emailForm).toBeTruthy();
  expect(emailInput?.className).toContain("w-full");

  await act(async () => {
    if (emailInput) {
      setInputValue(window, emailInput, " user@example.com ");
    }
    emailForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  expect(mocks.sendCode).toHaveBeenCalledWith({
    email: "user@example.com",
  });
  expect(container.textContent).toContain("Verify email");

  const codeInput = container.querySelector(
    "input[data-input-otp]",
  ) as HTMLInputElement | null;
  const verifyButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Verify email"),
  );
  expect(codeInput).toBeTruthy();
  expect(verifyButton).toBeTruthy();

  await act(async () => {
    if (codeInput) {
      setInputValue(window, codeInput, "654321");
    }
    verifyButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.loginWithCode).toHaveBeenCalledWith({
    code: "654321",
  });
  expect(mocks.onAuthenticated).toHaveBeenCalledWith({
    authMethod: "email",
    completedUser: null,
  });
});

test("HomepageEmailAuthButton passes Privy's completed user along", async () => {
  const completedUser = {
    linkedAccounts: [
      {
        address: "user@example.com",
        latest_verified_at: 1771977600,
        type: "email",
      },
    ],
  };
  mocks.loginWithCode.mockImplementationOnce(async () => {
    mocks.loginCallbacks?.onComplete?.({
      user: completedUser,
    });
  });

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(HomepageEmailAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  const emailInput = container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = container.querySelector("form");

  await act(async () => {
    if (emailInput) {
      setInputValue(window, emailInput, "user@example.com");
    }
    emailForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  const codeInput = container.querySelector(
    "input[data-input-otp]",
  ) as HTMLInputElement | null;
  const verifyButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Verify email"),
  );

  await act(async () => {
    if (codeInput) {
      setInputValue(window, codeInput, "654321");
    }
    verifyButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.onAuthenticated).toHaveBeenCalledWith({
    authMethod: "email",
    completedUser,
  });
});

test("HomepageEmailAuthButton uses no-signup mode for login code sends and resends", async () => {
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(HomepageEmailLoginButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  const emailInput = container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = container.querySelector("form");

  await act(async () => {
    if (emailInput) {
      setInputValue(window, emailInput, " user@example.com ");
    }
    emailForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  expect(mocks.sendCode).toHaveBeenCalledWith({
    email: "user@example.com",
    disableSignup: true,
  });

  const resendButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Resend code"),
  );
  expect(resendButton).toBeTruthy();

  await act(async () => {
    resendButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.sendCode).toHaveBeenLastCalledWith({
    email: "user@example.com",
    disableSignup: true,
  });
});

test("HomepageEmailAuthButton does not expose no-account send-code errors in login mode", async () => {
  mocks.sendCode.mockRejectedValueOnce(new Error("No account for this email"));

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(HomepageEmailLoginButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  const emailInput = container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = container.querySelector("form");

  await act(async () => {
    if (emailInput) {
      setInputValue(window, emailInput, " missing@example.com ");
    }
    emailForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  expect(mocks.sendCode).toHaveBeenCalledWith({
    email: "missing@example.com",
    disableSignup: true,
  });
  expect(container.textContent).toContain("Verify email");
  expect(container.textContent).toContain(
    "If an account exists for missing@example.com",
  );
  expect(container.textContent).not.toContain("No account for this email");
});

test("HomepageEmailAuthButton does not expose no-account verify errors in login mode", async () => {
  mocks.loginWithCode.mockRejectedValueOnce(new Error("No account for this email"));

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(HomepageEmailLoginButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  const emailInput = container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = container.querySelector("form");

  await act(async () => {
    if (emailInput) {
      setInputValue(window, emailInput, "missing@example.com");
    }
    emailForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  const codeInput = container.querySelector(
    "input[data-input-otp]",
  ) as HTMLInputElement | null;
  const verifyButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Verify email"),
  );

  await act(async () => {
    if (codeInput) {
      setInputValue(window, codeInput, "000000");
    }
    verifyButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.textContent).toContain("We could not verify that code.");
  expect(container.textContent).not.toContain("No account for this email");
});

test("HomepageEmailAuthButton validates the email address before sending a code", async () => {
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(HomepageEmailAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  const emailInput = container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = container.querySelector("form");

  await act(async () => {
    if (emailInput) {
      setInputValue(window, emailInput, "not-an-email");
    }
    emailForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  expect(mocks.sendCode).not.toHaveBeenCalled();
  expect(container.textContent).toContain(
    "Enter a valid email address before we send a code.",
  );
});

test("HomepageEmailAuthButton surfaces email verification failures and clears the loading state", async () => {
  mocks.loginWithCode.mockRejectedValueOnce(new Error("Invalid code"));

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(HomepageEmailAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  const emailInput = container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = container.querySelector("form");

  await act(async () => {
    if (emailInput) {
      setInputValue(window, emailInput, "user@example.com");
    }
    emailForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  const codeInput = container.querySelector(
    "input[data-input-otp]",
  ) as HTMLInputElement | null;
  const verifyButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Verify email"),
  );

  await act(async () => {
    if (codeInput) {
      setInputValue(window, codeInput, "000000");
    }
    verifyButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.textContent).toContain("Invalid code");
  expect(verifyButton?.hasAttribute("disabled")).toBe(false);
});

function setInputValue(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
) {
  const prototype = window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
