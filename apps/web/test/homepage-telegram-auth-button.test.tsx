import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const TELEGRAM_OAUTH_DIALOG_INTENT_KEY =
  "murph:telegram-oauth-dialog-intent:v1";

const mocks = vi.hoisted(() => ({
  initOAuth: vi.fn(),
  onNoticeChange: vi.fn(),
  useLoginWithOAuth: vi.fn(),
  usePrivy: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useLoginWithOAuth: mocks.useLoginWithOAuth,
  usePrivy: mocks.usePrivy,
}));

import { HostedTelegramAuthButton } from "@/src/components/hosted-onboarding/hosted-telegram-auth-button";

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usePrivy.mockReturnValue({ ready: true });
  mocks.useLoginWithOAuth.mockReturnValue({
    initOAuth: mocks.initOAuth,
    loading: false,
    state: { status: "initial" },
  });
  mocks.initOAuth.mockResolvedValue(undefined);
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
      onNoticeChange={mocks.onNoticeChange}
    />
  );
}

test("HomepageTelegramAuthButton starts Telegram OAuth and preserves the dialog intent across redirect", async () => {
  const rendered = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.initOAuth).toHaveBeenCalledWith({ provider: "telegram" });
  expect(
    rendered.window.sessionStorage.getItem(TELEGRAM_OAUTH_DIALOG_INTENT_KEY),
  ).toBe("1");
});

test("HomepageTelegramAuthButton forwards the no-signup boundary to Telegram OAuth", async () => {
  const rendered = await renderClientComponent(
    createElement(HostedTelegramAuthButton, {
      disableSignup: true,
      onActivate: () => {},
    }),
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.initOAuth).toHaveBeenCalledWith({
    disableSignup: true,
    provider: "telegram",
  });
});

test("HomepageTelegramAuthButton waits until Privy can start OAuth", async () => {
  mocks.usePrivy.mockReturnValue({ ready: false });
  const startAuth = vi.fn(() => true);
  const rendered = await renderClientComponent(
    createElement(HostedTelegramAuthButton, {
      onActivate: () => {},
      onAuthStart: startAuth,
    }),
  );
  cleanupRender = rendered.cleanup;

  expect(rendered.button.disabled).toBe(true);
  rendered.button.dispatchEvent(
    new rendered.window.Event("click", { bubbles: true }),
  );

  expect(startAuth).not.toHaveBeenCalled();
  expect(mocks.initOAuth).not.toHaveBeenCalled();
});

test("HomepageTelegramAuthButton respects shared auth ownership", async () => {
  const startAuth = vi.fn(() => false);
  const rendered = await renderClientComponent(
    createElement(HostedTelegramAuthButton, {
      onActivate: () => {},
      onAuthStart: startAuth,
    }),
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(startAuth).toHaveBeenCalledTimes(1);
  expect(mocks.initOAuth).not.toHaveBeenCalled();
});

test("HomepageTelegramAuthButton keeps account completion on the active CTA", async () => {
  const rendered = await renderClientComponent(
    createElement(HostedTelegramAuthButton, {
      active: true,
      completionPending: true,
      onActivate: () => {},
    }),
  );
  cleanupRender = rendered.cleanup;

  expect(rendered.button.disabled).toBe(true);
  expect(rendered.button.getAttribute("aria-busy")).toBe("true");
  expect(rendered.button.textContent).toContain("Finishing...");
  expect(rendered.button.querySelector('[data-slot="spinner"]')).toBeTruthy();
  expect(mocks.initOAuth).not.toHaveBeenCalled();
});

test("HomepageTelegramAuthButton exposes Privy's OAuth loading phase as button progress", async () => {
  mocks.useLoginWithOAuth.mockReturnValue({
    initOAuth: mocks.initOAuth,
    loading: true,
    state: { status: "loading" },
  });

  const rendered = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = rendered.cleanup;

  expect(rendered.button.disabled).toBe(true);
  expect(rendered.button.getAttribute("aria-busy")).toBe("true");
  expect(rendered.button.textContent).toContain("Connecting...");
  expect(rendered.button.querySelector('[data-slot="spinner"]')).toBeTruthy();
});

test("HomepageTelegramAuthButton softens cancellation and clears the redirect intent", async () => {
  mocks.initOAuth.mockRejectedValueOnce(
    new Error("Telegram auth failed or was canceled by the client"),
  );
  const cancelAuth = vi.fn();
  const rendered = await renderClientComponent(
    createElement(HostedTelegramAuthButton, {
      onActivate: () => {},
      onAuthCancel: cancelAuth,
      onNoticeChange: mocks.onNoticeChange,
    }),
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(cancelAuth).toHaveBeenCalledTimes(1);
  expect(mocks.onNoticeChange).toHaveBeenLastCalledWith({
    message: "Telegram sign-in was canceled. Try again or use another option.",
    tone: "cancel",
  });
  expect(
    rendered.window.sessionStorage.getItem(TELEGRAM_OAUTH_DIALOG_INTENT_KEY),
  ).toBeNull();
  expect(rendered.button.disabled).toBe(false);
});

test("HomepageTelegramAuthButton surfaces unexpected Telegram failures", async () => {
  mocks.initOAuth.mockRejectedValueOnce(new Error("Telegram is unreachable"));
  const rendered = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.onNoticeChange).toHaveBeenLastCalledWith({
    message: "Telegram is unreachable",
    tone: "error",
  });
  expect(rendered.button.disabled).toBe(false);
});

test("HomepageTelegramAuthButton clears the notice before redirecting", async () => {
  const rendered = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.onNoticeChange).toHaveBeenCalledWith(null);
});
