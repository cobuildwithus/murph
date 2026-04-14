import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  completeHomepagePrivyAuth: vi.fn(),
  createWallet: vi.fn(),
  loginWithCode: vi.fn(),
  sendCode: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useCreateWallet() {
    return {
      createWallet: mocks.createWallet,
    };
  },
  useLoginWithEmail() {
    return {
      loginWithCode: mocks.loginWithCode,
      sendCode: mocks.sendCode,
      state: { status: "initial" },
    };
  },
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/homepage/homepage-privy-auth", () => ({
  completeHomepagePrivyAuth: mocks.completeHomepagePrivyAuth,
}));

import { HomepageEmailAuthButton } from "@/src/components/homepage/homepage-email-auth-button";

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usePrivy.mockReturnValue({
    ready: true,
  });
  mocks.useUser.mockReturnValue({
    refreshUser: vi.fn(),
    user: null,
  });
  mocks.sendCode.mockResolvedValue(undefined);
  mocks.loginWithCode.mockResolvedValue(undefined);
  mocks.completeHomepagePrivyAuth.mockResolvedValue("/settings");
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("HomepageEmailAuthButton expands, sends a code, verifies it, and redirects through the shared homepage completion flow", async () => {
  const { assign, button, cleanup, container, window } = await renderClientComponent(
    createElement(HomepageEmailAuthButton),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  const emailInput = container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = container.querySelector("form");
  expect(emailInput).toBeTruthy();
  expect(emailForm).toBeTruthy();

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
    'input[placeholder="123456"]',
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
  expect(mocks.completeHomepagePrivyAuth).toHaveBeenCalledWith({
    createWallet: mocks.createWallet,
    refreshUser: expect.any(Function),
    user: null,
  });
  expect(assign).toHaveBeenCalledWith("/settings");
});

test("HomepageEmailAuthButton validates the email address before sending a code", async () => {
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(HomepageEmailAuthButton),
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
    createElement(HomepageEmailAuthButton),
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
    'input[placeholder="123456"]',
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
