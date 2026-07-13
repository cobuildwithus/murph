import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  onAuthenticated: vi.fn(),
  onNoticeChange: vi.fn(),
  requestHostedPrivyAuthIntent: vi.fn(),
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

vi.mock(
  "@/src/components/hosted-onboarding/hosted-privy-auth-support",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/src/components/hosted-onboarding/hosted-privy-auth-support")
    >();

    return {
      ...actual,
      requestHostedPrivyAuthIntent: mocks.requestHostedPrivyAuthIntent,
    };
  },
);

import { HostedTelegramAuthButton } from "@/src/components/hosted-onboarding/hosted-telegram-auth-button";

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usePrivy.mockReturnValue({
    ready: true,
  });
  mocks.login.mockResolvedValue(undefined);
  mocks.onAuthenticated.mockResolvedValue(undefined);
  mocks.requestHostedPrivyAuthIntent.mockResolvedValue(undefined);
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
  expect(mocks.requestHostedPrivyAuthIntent).toHaveBeenCalledWith({
    inviteCode: null,
    method: "telegram",
  });
  expect(
    mocks.requestHostedPrivyAuthIntent.mock.invocationCallOrder[0],
  ).toBeLessThan(mocks.login.mock.invocationCallOrder[0] ?? 0);
  expect(mocks.onAuthenticated).toHaveBeenCalledWith({
    authMethod: "telegram",
  });
});

test("HomepageTelegramAuthButton locks duplicate clicks while the auth intent is pending", async () => {
  const authIntent = createDeferred();
  mocks.requestHostedPrivyAuthIntent.mockReturnValueOnce(authIntent.promise);

  const { button, cleanup } = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
    button.dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(mocks.requestHostedPrivyAuthIntent).toHaveBeenCalledTimes(1);
  expect(mocks.login).not.toHaveBeenCalled();
  expect(button.disabled).toBe(true);
  expect(button.textContent).toContain("Connecting...");

  await act(async () => {
    authIntent.resolve();
    await authIntent.promise;
    await Promise.resolve();
  });

  expect(mocks.login).toHaveBeenCalledTimes(1);
  expect(mocks.onAuthenticated).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(false);
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

function createDeferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = () => resolvePromise();
  });
  return { promise, resolve };
}
