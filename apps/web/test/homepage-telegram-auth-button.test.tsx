import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  onAuthenticated: vi.fn(),
  onNoticeChange: vi.fn(),
  usePrivy: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useLoginWithTelegram() {
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
      onNoticeChange={mocks.onNoticeChange}
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

test("HomepageTelegramAuthButton softens cancellation messages without alarming the user", async () => {
  mocks.login.mockRejectedValueOnce(new Error("Telegram auth failed or was canceled by the client"));

  const { button, cleanup } = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.onNoticeChange).toHaveBeenLastCalledWith({
    message: "Telegram sign-in was canceled. Try again or use another option.",
    tone: "cancel",
  });
  expect(button.disabled).toBe(false);
  expect(mocks.onAuthenticated).not.toHaveBeenCalled();
});

test("HomepageTelegramAuthButton surfaces unexpected Telegram failures as a destructive notice", async () => {
  mocks.login.mockRejectedValueOnce(new Error("Telegram is unreachable"));

  const { button, cleanup } = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.onNoticeChange).toHaveBeenLastCalledWith({
    message: "Telegram is unreachable",
    tone: "error",
  });
  expect(button.disabled).toBe(false);
  expect(mocks.onAuthenticated).not.toHaveBeenCalled();
});

test("HomepageTelegramAuthButton clears the notice before retrying", async () => {
  const { button, cleanup } = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.onNoticeChange).toHaveBeenCalledWith(null);
});
