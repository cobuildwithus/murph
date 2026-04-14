import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  completeHomepagePrivyAuth: vi.fn(),
  createWallet: vi.fn(),
  login: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useCreateWallet() {
    return {
      createWallet: mocks.createWallet,
    };
  },
  useLoginWithTelegram() {
    return {
      login: mocks.login,
      state: { status: "initial" },
    };
  },
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/homepage/homepage-privy-auth", () => ({
  completeHomepagePrivyAuth: mocks.completeHomepagePrivyAuth,
}));

import { HomepageTelegramAuthButton } from "@/src/components/homepage/homepage-telegram-auth-button";

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
  mocks.login.mockResolvedValue(undefined);
  mocks.completeHomepagePrivyAuth.mockResolvedValue("/settings");
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

function HomepageTelegramAuthButtonHarness() {
  const [active, setActive] = useState(false);

  return (
    <HomepageTelegramAuthButton
      isActive={active}
      onActivate={() => setActive(true)}
    />
  );
}

test("HomepageTelegramAuthButton logs in with Telegram and redirects through the shared homepage completion flow", async () => {
  const { assign, button, cleanup } = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.login).toHaveBeenCalledTimes(1);
  expect(mocks.completeHomepagePrivyAuth).toHaveBeenCalledWith({
    createWallet: mocks.createWallet,
    refreshUser: expect.any(Function),
    user: null,
  });
  expect(assign).toHaveBeenCalledWith("/settings");
});

test("HomepageTelegramAuthButton keeps the CTA disabled until Privy is ready", async () => {
  mocks.usePrivy.mockReturnValue({
    ready: false,
  });

  const { button, cleanup } = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = cleanup;

  expect(button.disabled).toBe(true);
});

test("HomepageTelegramAuthButton surfaces Telegram login failures and clears the loading state", async () => {
  mocks.login.mockRejectedValueOnce(new Error("Telegram popup closed"));

  const { button, cleanup, container } = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.textContent).toContain("Telegram popup closed");
  expect(container.querySelector('[role="alert"]')?.className).toContain("sm:col-span-2");
  expect(button.disabled).toBe(false);
});

test("HomepageTelegramAuthButton surfaces shared completion failures instead of redirecting", async () => {
  mocks.completeHomepagePrivyAuth.mockRejectedValueOnce(
    new Error("Checkout did not return a redirect URL."),
  );

  const { assign, button, cleanup, container } = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(assign).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Checkout did not return a redirect URL.");
});
