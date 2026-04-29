import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { HostedAuthPanel } from "@/src/components/hosted-onboarding/hosted-auth-panel";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  completeHostedPrivyAuth: vi.fn(),
  createWallet: vi.fn(),
  loginWithCode: vi.fn(),
  loginWithTelegram: vi.fn(),
  sendCode: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  Captcha() {
    return createElement("div", { "data-privy-captcha": "mounted" });
  },
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
  useLoginWithTelegram() {
    return {
      login: mocks.loginWithTelegram,
      state: { status: "initial" },
    };
  },
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-completion", () => ({
  completeHostedPrivyAuth: mocks.completeHostedPrivyAuth,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => ({
  HostedPhoneAuth(input: {
    disableSignup?: boolean;
    showPassiveConsentNotice?: boolean;
    suppressAuthenticatedSessionIssue?: boolean;
  }) {
    return createElement(
      "div",
      {
        "data-hosted-phone-auth": "mounted",
        "data-hosted-phone-auth-disable-signup":
          input.disableSignup ? "yes" : "no",
        "data-hosted-phone-auth-passive-consent":
          input.showPassiveConsentNotice === false ? "hidden" : "shown",
        "data-hosted-phone-auth-suppressed":
          input.suppressAuthenticatedSessionIssue ? "yes" : "no",
      },
      "Hosted phone auth",
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-verification-code-step", () => ({
  HostedVerificationCodeStep({
    description,
    onResendCode,
  }: {
    description: string;
    onResendCode: () => void;
  }) {
    return createElement(
      "div",
      null,
      createElement("p", null, "Verify email"),
      createElement("p", null, description),
      createElement(
        "button",
        {
          type: "button",
          onClick: onResendCode,
        },
        "Resend code",
      ),
    );
  },
}));

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
  mocks.completeHostedPrivyAuth.mockResolvedValue({
    payload: {
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      stage: "active",
    },
    redirectUrl: "/settings",
  });
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("HostedAuthPanel keeps only one alternate auth method active at a time", async () => {
  mocks.loginWithTelegram.mockRejectedValue(new Error("Telegram popup closed"));

  const { cleanup, container } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      showLegalNotice: true,
    }),
  );
  cleanupRender = cleanup;

  const [telegramButton, emailButton] = Array.from(
    container.querySelectorAll("button"),
  ) as HTMLButtonElement[];

  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeTruthy();
  expect(container.querySelector('[data-hosted-phone-auth-disable-signup="no"]')).toBeTruthy();
  expect(container.querySelector('[data-hosted-phone-auth-passive-consent="hidden"]')).toBeTruthy();
  expect(container.querySelector('[data-hosted-phone-auth-suppressed="no"]')).toBeTruthy();
  expect(container.querySelectorAll("[data-privy-captcha]").length).toBe(1);
  expect(telegramButton?.textContent).toContain("Telegram");
  expect(emailButton?.textContent).toContain("Email");
  expect(container.textContent).toContain("By continuing, you agree to our");

  await act(async () => {
    telegramButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.querySelector('[data-hosted-phone-auth-suppressed="yes"]')).toBeTruthy();
  expect(container.textContent).toContain("Telegram popup closed");
  expect(container.querySelector('[role="alert"]')).toBeTruthy();

  await act(async () => {
    emailButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.querySelector('[data-hosted-phone-auth-suppressed="yes"]')).toBeTruthy();
  expect(container.textContent).not.toContain("Telegram popup closed");
  expect(container.querySelector('input[id="homepage-email-address"]')).toBeTruthy();

  await act(async () => {
    telegramButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.querySelector('input[id="homepage-email-address"]')).toBeNull();
});

test("HostedAuthPanel passes login mode through as no-signup auth", async () => {
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      authMode: "login",
      methods: ["phone", "telegram", "email"],
    }),
  );
  cleanupRender = cleanup;

  expect(container.querySelector('[data-hosted-phone-auth-disable-signup="yes"]')).toBeTruthy();

  const [telegramButton, emailButton] = Array.from(
    container.querySelectorAll("button"),
  ) as HTMLButtonElement[];

  await act(async () => {
    telegramButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.loginWithTelegram).toHaveBeenCalledWith({
    disableSignup: true,
  });

  await act(async () => {
    emailButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  const emailInput = container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = container.querySelector("form");

  await act(async () => {
    if (emailInput) {
      setInputValue(window, emailInput, " login@example.com ");
    }
    emailForm?.dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });

  expect(mocks.sendCode).toHaveBeenCalledWith({
    email: "login@example.com",
    disableSignup: true,
  });
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
