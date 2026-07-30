import {
  act,
  createElement,
  useState,
} from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  onAuthenticated: vi.fn(),
  onNoticeChange: vi.fn(),
  telegramWidgetAvailable: true,
  useLoginWithTelegram: vi.fn(),
  usePrivy: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useLoginWithTelegram: mocks.useLoginWithTelegram,
  usePrivy: mocks.usePrivy,
}));

import { HostedTelegramAuthButton } from "@/src/components/hosted-onboarding/hosted-telegram-auth-button";

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usePrivy.mockReturnValue({
    ready: true,
  });
  mocks.telegramWidgetAvailable = true;
  mocks.useLoginWithTelegram.mockImplementation(() => {
    if (mocks.telegramWidgetAvailable && typeof window !== "undefined") {
      installTelegramLoginWidget(window);
    }
    return {
      login: mocks.login,
      state: { status: "initial" },
    };
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

test("HomepageTelegramAuthButton queues one login with busy feedback until Privy is ready", async () => {
  const queueAuth = vi.fn(() => true);
  const startAuth = vi.fn(() => true);
  let privyReady = false;
  mocks.usePrivy.mockImplementation(() => ({
    authenticated: false,
    ready: privyReady,
  }));

  function ReadyTelegramHarness() {
    return (
      <HostedTelegramAuthButton
        onActivate={() => {}}
        onAuthQueue={queueAuth}
        onAuthQueueCancel={() => {}}
        onAuthStart={startAuth}
        onAuthenticated={mocks.onAuthenticated}
      />
    );
  }

  const rendered = await renderClientComponent(
    createElement(ReadyTelegramHarness),
  );
  cleanupRender = rendered.cleanup;
  const { button } = rendered;

  expect(button.disabled).toBe(false);

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(queueAuth).toHaveBeenCalledTimes(1);
  expect(startAuth).not.toHaveBeenCalled();
  expect(mocks.login).not.toHaveBeenCalled();
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.textContent).toContain("Connecting...");
  expect(button.querySelector('[data-slot="spinner"]')).toBeTruthy();

  privyReady = true;
  await rendered.rerender(createElement(ReadyTelegramHarness));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(startAuth).not.toHaveBeenCalled();
  expect(mocks.login).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
  expect(button.getAttribute("aria-busy")).toBe("false");
  expect(button.textContent).toContain("Continue with Telegram");
  const readyStatus = rendered.container.querySelector('[role="status"]');
  expect(readyStatus?.getAttribute("aria-live")).toBe("polite");
  expect(readyStatus?.getAttribute("aria-atomic")).toBe("true");
  expect(readyStatus?.textContent).toContain(
    "Telegram is ready. Continue to open sign in.",
  );

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(startAuth).toHaveBeenCalledTimes(1);
  expect(mocks.login).toHaveBeenCalledTimes(1);
  expect(mocks.onAuthenticated).toHaveBeenCalledTimes(1);
});

test("HomepageTelegramAuthButton clears a queued continuation when shared ownership is denied", async () => {
  const queueAuth = vi.fn(() => true);
  const releaseQueue = vi.fn();
  const startAuth = vi.fn(() => false);
  let privyReady = false;
  mocks.usePrivy.mockImplementation(() => ({
    authenticated: false,
    ready: privyReady,
  }));

  function DeniedTelegramHarness() {
    return (
      <HostedTelegramAuthButton
        onActivate={() => {}}
        onAuthQueue={queueAuth}
        onAuthQueueCancel={releaseQueue}
        onAuthStart={startAuth}
        onAuthenticated={mocks.onAuthenticated}
      />
    );
  }

  const rendered = await renderClientComponent(
    createElement(DeniedTelegramHarness),
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  privyReady = true;
  await rendered.rerender(createElement(DeniedTelegramHarness));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(releaseQueue).toHaveBeenCalledTimes(1);
  expect(rendered.button.textContent).toContain("Continue with Telegram");

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(startAuth).toHaveBeenCalledTimes(1);
  expect(mocks.login).not.toHaveBeenCalled();
  expect(rendered.button.disabled).toBe(false);
  expect(rendered.button.getAttribute("aria-busy")).toBe("false");
  expect(rendered.button.textContent).toBe("Telegram");
});

test("HomepageTelegramAuthButton drops a ready continuation when another method becomes active", async () => {
  const releaseQueue = vi.fn();
  let privyReady = false;
  mocks.usePrivy.mockImplementation(() => ({
    authenticated: false,
    ready: privyReady,
  }));

  const renderButton = (active: boolean) =>
    createElement(HostedTelegramAuthButton, {
      active,
      onActivate: () => {},
      onAuthQueue: () => true,
      onAuthQueueCancel: releaseQueue,
      onAuthStart: () => true,
      onAuthenticated: mocks.onAuthenticated,
    });
  const rendered = await renderClientComponent(renderButton(true));
  cleanupRender = rendered.cleanup;

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  privyReady = true;
  await rendered.rerender(renderButton(true));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(rendered.button.textContent).toContain("Continue with Telegram");
  expect(releaseQueue).toHaveBeenCalledTimes(1);

  await rendered.rerender(renderButton(false));
  await act(async () => {
    await Promise.resolve();
  });

  expect(rendered.button.disabled).toBe(false);
  expect(rendered.button.textContent).toBe("Telegram");
  expect(rendered.container.querySelector('[role="status"]')).toBeNull();
  expect(mocks.login).not.toHaveBeenCalled();
});

test("HomepageTelegramAuthButton releases active ownership if widget readiness vanishes at login", async () => {
  const cancelAuth = vi.fn();
  const startAuth = vi.fn(() => true);
  const rendered = await renderClientComponent(
    createElement(HostedTelegramAuthButton, {
      active: true,
      onActivate: () => {},
      onAuthCancel: cancelAuth,
      onAuthStart: startAuth,
      onAuthenticated: mocks.onAuthenticated,
    }),
  );
  cleanupRender = rendered.cleanup;

  let authReads = 0;
  Reflect.set(rendered.window, "Telegram", {
    Login: {
      get auth() {
        authReads += 1;
        return authReads === 1 ? vi.fn() : undefined;
      },
    },
  });

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(startAuth).toHaveBeenCalledTimes(1);
  expect(cancelAuth).toHaveBeenCalledTimes(1);
  expect(mocks.login).not.toHaveBeenCalled();
  expect(rendered.button.disabled).toBe(false);
  expect(rendered.button.getAttribute("aria-busy")).toBe("false");
  expect(rendered.button.textContent).toBe("Telegram");
});

test("HomepageTelegramAuthButton waits for Privy's Telegram widget before asking for the follow-up click", async () => {
  mocks.telegramWidgetAvailable = false;
  const queueAuth = vi.fn(() => true);
  const releaseQueue = vi.fn();
  const startAuth = vi.fn(() => true);
  const rendered = await renderClientComponent(
    createElement(HostedTelegramAuthButton, {
      onActivate: () => {},
      onAuthQueue: queueAuth,
      onAuthQueueCancel: releaseQueue,
      onAuthStart: startAuth,
      onAuthenticated: mocks.onAuthenticated,
    }),
  );
  cleanupRender = rendered.cleanup;
  Reflect.deleteProperty(rendered.window, "Telegram");

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(queueAuth).toHaveBeenCalledTimes(1);
  expect(rendered.button.disabled).toBe(true);
  expect(rendered.button.textContent).toContain("Connecting...");
  expect(mocks.login).not.toHaveBeenCalled();

  installTelegramLoginWidget(rendered.window);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 110));
  });

  expect(releaseQueue).toHaveBeenCalledTimes(1);
  expect(rendered.button.disabled).toBe(false);
  expect(rendered.button.textContent).toContain("Continue with Telegram");
  expect(mocks.login).not.toHaveBeenCalled();

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(startAuth).toHaveBeenCalledTimes(1);
  expect(mocks.login).toHaveBeenCalledTimes(1);
});

test("HomepageTelegramAuthButton keeps account completion on the active CTA", async () => {
  const { button, cleanup } = await renderClientComponent(
    createElement(HostedTelegramAuthButton, {
      active: true,
      completionPending: true,
      onActivate: () => {},
      onAuthenticated: mocks.onAuthenticated,
    }),
  );
  cleanupRender = cleanup;

  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.textContent).toContain("Finishing...");
  expect(button.querySelector('[data-slot="spinner"]')).toBeTruthy();
  expect(mocks.login).not.toHaveBeenCalled();
});

test("HomepageTelegramAuthButton exposes Privy's own loading phase as button progress", async () => {
  mocks.useLoginWithTelegram.mockReturnValue({
    login: mocks.login,
    state: { status: "loading" },
  });

  const { button, cleanup } = await renderClientComponent(
    createElement(HomepageTelegramAuthButtonHarness),
  );
  cleanupRender = cleanup;

  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.textContent).toContain("Connecting...");
  expect(button.querySelector('[data-slot="spinner"]')).toBeTruthy();
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

function installTelegramLoginWidget(targetWindow: Window & typeof globalThis) {
  Reflect.set(targetWindow, "Telegram", {
    Login: {
      auth: vi.fn(),
    },
  });
}
