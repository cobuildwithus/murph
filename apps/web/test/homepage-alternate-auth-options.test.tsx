import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { HomepageAlternateAuthOptions } from "@/src/components/homepage/homepage-alternate-auth-options";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  completeHomepagePrivyAuth: vi.fn(),
  createWallet: vi.fn(),
  loginWithCode: vi.fn(),
  loginWithTelegram: vi.fn(),
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
  useLoginWithTelegram() {
    return {
      login: mocks.loginWithTelegram,
      state: { status: "initial" },
    };
  },
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/homepage/homepage-privy-auth", () => ({
  completeHomepagePrivyAuth: mocks.completeHomepagePrivyAuth,
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
  mocks.completeHomepagePrivyAuth.mockResolvedValue("/settings");
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("HomepageAlternateAuthOptions keeps only one auth method active at a time", async () => {
  mocks.loginWithTelegram.mockRejectedValue(new Error("Telegram popup closed"));

  const { cleanup, container } = await renderClientComponent(
    createElement(HomepageAlternateAuthOptions),
  );
  cleanupRender = cleanup;

  const [telegramButton, emailButton] = Array.from(
    container.querySelectorAll("button"),
  ) as HTMLButtonElement[];

  expect(telegramButton?.textContent).toContain("Telegram");
  expect(emailButton?.textContent).toContain("Email");

  await act(async () => {
    telegramButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.textContent).toContain("Telegram popup closed");
  expect(container.querySelector('[role="alert"]')).toBeTruthy();

  await act(async () => {
    emailButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.textContent).not.toContain("Telegram popup closed");
  expect(container.querySelector('input[id="homepage-email-address"]')).toBeTruthy();

  await act(async () => {
    telegramButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.querySelector('input[id="homepage-email-address"]')).toBeNull();
});
