import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

type LoginCallbacks = {
  onComplete?: (params: { user: { linkedAccounts?: unknown } }) => void;
};

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  loginCallbacks: null as LoginCallbacks | null,
  onAuthenticated: vi.fn(),
  usePrivy: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useLoginWithTelegram(callbacks?: LoginCallbacks) {
    mocks.loginCallbacks = callbacks ?? null;

    return {
      login: mocks.login,
      state: { status: "initial" },
    };
  },
  usePrivy: mocks.usePrivy,
}));

import { HostedTelegramAuthButton } from "@/src/components/hosted-onboarding/hosted-telegram-auth-button";

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loginCallbacks = null;
  mocks.usePrivy.mockReturnValue({
    ready: true,
  });
  mocks.login.mockResolvedValue(undefined);
  mocks.onAuthenticated.mockResolvedValue(undefined);
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
      onAuthenticated={mocks.onAuthenticated}
    />
  );
}

test("HomepageTelegramAuthButton logs in with Telegram and reports the authenticated session", async () => {
  const { button, cleanup } = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.login).toHaveBeenCalledTimes(1);
  expect(mocks.onAuthenticated).toHaveBeenCalledWith({
    authMethod: "telegram",
    completedUser: null,
  });
});

test("HomepageTelegramAuthButton passes Privy's completed user along", async () => {
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

  expect(mocks.onAuthenticated).toHaveBeenCalledWith({
    authMethod: "telegram",
    completedUser,
  });
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
  expect(mocks.onAuthenticated).not.toHaveBeenCalled();
});
