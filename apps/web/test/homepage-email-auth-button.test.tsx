import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  loginWithCode: vi.fn(),
  onAuthenticated: vi.fn(),
  sendCode: vi.fn(),
  usePrivy: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useLoginWithEmail() {
    return {
      loginWithCode: mocks.loginWithCode,
      sendCode: mocks.sendCode,
      state: { status: "initial" },
    };
  },
  usePrivy: mocks.usePrivy,
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
      children?: React.ReactNode;
      onOpenChange?: (open: boolean) => void;
      open?: boolean;
    }) =>
      React.createElement(
        DialogContext.Provider,
        { value: { onOpenChange, open } },
        children,
      ),
    DialogContent: ({
      children,
      className,
      showCloseButton: _showCloseButton,
    }: React.HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean }) => {
      void _showCloseButton;
      const context = React.useContext(DialogContext);
      return context.open
        ? React.createElement("div", { className, role: "dialog" }, children)
        : null;
    },
    DialogDescription: (props: React.HTMLAttributes<HTMLParagraphElement>) =>
      React.createElement("p", props),
    DialogHeader: (props: React.HTMLAttributes<HTMLDivElement>) =>
      React.createElement("div", props),
    DialogTitle: (props: React.HTMLAttributes<HTMLHeadingElement>) =>
      React.createElement("h2", props),
  };
});

import { HostedEmailAuthButton } from "@/src/components/hosted-onboarding/hosted-email-auth-button";

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
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

test("HostedEmailAuthButton locks the invite email and sends the code to it", async () => {
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedEmailAuthButton, {
      active: true,
      inline: true,
      lockedEmailAddress: " buddy@icloud.com ",
      onAuthenticated: mocks.onAuthenticated,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  expect(container.querySelector('input[id="homepage-email-address"]')).toBeNull();

  const lockedEmail = container.querySelector('[data-hosted-locked-email="true"]');
  expect(lockedEmail?.textContent).toBe("buddy@icloud.com");
  expect(container.textContent).toContain("Change email");

  const emailForm = container.querySelector("form");

  await act(async () => {
    emailForm?.dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });

  expect(mocks.sendCode).toHaveBeenCalledWith({
    email: "buddy@icloud.com",
  });
  expect(container.textContent).toContain("Verify email");
  expect(container.textContent).toContain("Change email");
  expect(container.textContent).not.toContain("Use another email");
});

test("HostedEmailAuthButton explains how to change a locked invite email", async () => {
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedEmailAuthButton, {
      active: true,
      inline: true,
      lockedEmailAddress: "buddy@icloud.com",
      onAuthenticated: mocks.onAuthenticated,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  expect(container.querySelector('[role="dialog"]')).toBeNull();

  const changeEmailButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Change email"),
  );
  expect(changeEmailButton).toBeTruthy();

  await act(async () => {
    changeEmailButton?.dispatchEvent(
      new window.Event("click", { bubbles: true }),
    );
  });

  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).toBeTruthy();
  expect(dialog?.textContent).toContain("Want a different email?");
  expect(dialog?.textContent).toContain("buddy@icloud.com");
  expect(dialog?.textContent).toContain("Send & Receive");
  expect(dialog?.textContent).toContain("Text Murph again");

  const gotItButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Got it"),
  );

  await act(async () => {
    gotItButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(container.querySelector('[role="dialog"]')).toBeNull();
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
  });
});

test("HostedEmailAuthButton keeps account completion on the verify button", async () => {
  const renderButton = (completionPending: boolean) =>
    createElement(HostedEmailAuthButton, {
      active: true,
      completionPending,
      inline: true,
      onAuthenticated: mocks.onAuthenticated,
    });
  const rendered = await renderClientComponent(renderButton(false), {
    requireButton: false,
  });
  cleanupRender = rendered.cleanup;

  const emailInput = rendered.container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = rendered.container.querySelector("form");

  await act(async () => {
    if (emailInput) {
      setInputValue(rendered.window, emailInput, "user@example.com");
    }
    emailForm?.dispatchEvent(
      new rendered.window.Event("submit", {
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await rendered.rerender(renderButton(true));

  const verifyButton = Array.from(
    rendered.container.querySelectorAll("button"),
  ).find((candidate) => candidate.textContent?.includes("Finishing..."));

  expect(verifyButton).toBeTruthy();
  expect(verifyButton?.disabled).toBe(true);
  expect(verifyButton?.getAttribute("aria-busy")).toBe("true");
  expect(verifyButton?.querySelector('[data-slot="spinner"]')).toBeTruthy();
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

  const codeInput = container.querySelector(
    "input[data-input-otp]",
  ) as HTMLInputElement | null;
  expect(codeInput).toBeTruthy();

  await act(async () => {
    if (codeInput) {
      setInputValue(window, codeInput, "654321");
    }
  });

  expect(codeInput?.value).toBe("654321");

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
  expect(codeInput?.value).toBe("");
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
