import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

type LoginCallbacks = {
  onComplete?: (params: { user: { linkedAccounts?: unknown } }) => void;
};

const mocks = vi.hoisted(() => ({
  completeHostedPrivyAuth: vi.fn(),
  createWallet: vi.fn(),
  login: vi.fn(),
  loginCallbacks: null as LoginCallbacks | null,
  usePrivy: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useCreateWallet() {
    return {
      createWallet: mocks.createWallet,
    };
  },
  useLoginWithTelegram(callbacks?: LoginCallbacks) {
    mocks.loginCallbacks = callbacks ?? null;

    return {
      login: mocks.login,
      state: { status: "initial" },
    };
  },
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-completion", () => ({
  completeHostedPrivyAuth: mocks.completeHostedPrivyAuth,
}));

import { HostedTelegramAuthButton } from "@/src/components/hosted-onboarding/hosted-telegram-auth-button";

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loginCallbacks = null;
  mocks.usePrivy.mockReturnValue({
    ready: true,
  });
  mocks.useUser.mockReturnValue({
    refreshUser: vi.fn(),
    user: null,
  });
  mocks.login.mockResolvedValue(undefined);
  mocks.completeHostedPrivyAuth.mockResolvedValue({
    payload: {
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      stage: "active",
    },
    redirectUrl: "/home",
  });
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
    <HostedTelegramAuthButton
      active={active}
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
  expect(mocks.completeHostedPrivyAuth).toHaveBeenCalledWith({
    authMethod: "telegram",
    createWallet: mocks.createWallet,
    refreshUser: expect.any(Function),
    user: null,
  });
  expect(assign).toHaveBeenCalledWith("/home");
});

test("HomepageTelegramAuthButton passes Privy's completed user into shared completion", async () => {
  const completedUser = {
    linkedAccounts: [
      {
        id: 67890,
        type: "telegram",
        username: "new_user",
      },
    ],
  };
  mocks.login.mockImplementationOnce(async () => {
    mocks.loginCallbacks?.onComplete?.({
      user: completedUser,
    });
  });

  const { button, cleanup } = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.completeHostedPrivyAuth).toHaveBeenCalledWith(expect.objectContaining({
    authMethod: "telegram",
    completedUser,
    createWallet: mocks.createWallet,
    refreshUser: expect.any(Function),
    user: null,
  }));
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
  mocks.completeHostedPrivyAuth.mockRejectedValueOnce(
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
