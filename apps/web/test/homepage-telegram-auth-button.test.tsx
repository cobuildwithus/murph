import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWallet: vi.fn(),
  ensureHostedPrivyWalletReady: vi.fn(),
  login: vi.fn(),
  refreshUser: vi.fn(),
  requestHostedBillingCheckout: vi.fn(),
  requestHostedPrivyCompletionWithRetry: vi.fn(),
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

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedBillingCheckout: mocks.requestHostedBillingCheckout,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth-support", () => ({
  requestHostedPrivyCompletionWithRetry: mocks.requestHostedPrivyCompletionWithRetry,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-client", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/privy-client")>(
    "@/src/lib/hosted-onboarding/privy-client",
  );

  return {
    ...actual,
    ensureHostedPrivyWalletReady: mocks.ensureHostedPrivyWalletReady,
  };
});

import { HomepageTelegramAuthButton } from "@/src/components/homepage/homepage-telegram-auth-button";

const requireFromHomepageTelegramAuthButtonTest = createRequire(import.meta.url);

let cleanupRender: (() => Promise<void> | void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usePrivy.mockReturnValue({
    ready: true,
  });
  mocks.useUser.mockReturnValue({
    refreshUser: mocks.refreshUser,
    user: null,
  });
  mocks.login.mockResolvedValue(undefined);
  mocks.ensureHostedPrivyWalletReady.mockResolvedValue(undefined);
  mocks.refreshUser.mockResolvedValue({
    linkedAccounts: [],
  });
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: false,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "active",
  });
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: true,
    url: null,
  });
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("HomepageTelegramAuthButton logs in with Telegram and sends active members to settings", async () => {
  const { assign, button } = await renderHomepageTelegramAuthButton();

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.login).toHaveBeenCalledTimes(1);
  expect(mocks.ensureHostedPrivyWalletReady).toHaveBeenCalledWith({
    createWallet: mocks.createWallet,
    user: {
      linkedAccounts: [],
    },
  });
  expect(mocks.requestHostedPrivyCompletionWithRetry).toHaveBeenCalledTimes(1);
  expect(assign).toHaveBeenCalledWith("/settings");
});

test("HomepageTelegramAuthButton sends checkout users straight into billing", async () => {
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: false,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "checkout",
  });
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: "https://checkout.example.test/session_123",
  });

  const { assign, button } = await renderHomepageTelegramAuthButton();

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.requestHostedBillingCheckout).toHaveBeenCalledWith({
    inviteCode: "invite-code",
  });
  expect(assign).toHaveBeenCalledWith("https://checkout.example.test/session_123");
});

test("HomepageTelegramAuthButton sends non-active users to the join URL returned by completion", async () => {
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: true,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "blocked",
  });

  const { assign, button } = await renderHomepageTelegramAuthButton();

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(assign).toHaveBeenCalledWith("https://join.example.test/join/invite-code");
});

test("HomepageTelegramAuthButton keeps the CTA disabled until Privy is ready", async () => {
  mocks.usePrivy.mockReturnValue({
    ready: false,
  });

  const { button } = await renderHomepageTelegramAuthButton();

  expect(button.disabled).toBe(true);
});

test("HomepageTelegramAuthButton falls back to the current user when refreshUser fails", async () => {
  mocks.refreshUser.mockRejectedValueOnce(new Error("stale user"));
  mocks.useUser.mockReturnValue({
    refreshUser: mocks.refreshUser,
    user: {
      linkedAccounts: [{ type: "telegram" }],
    },
  });

  const { assign, button } = await renderHomepageTelegramAuthButton();

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.ensureHostedPrivyWalletReady).toHaveBeenCalledWith({
    createWallet: mocks.createWallet,
    user: {
      linkedAccounts: [{ type: "telegram" }],
    },
  });
  expect(assign).toHaveBeenCalledWith("/settings");
});

test("HomepageTelegramAuthButton surfaces Telegram login failures and clears the loading state", async () => {
  mocks.login.mockRejectedValueOnce(new Error("Telegram popup closed"));

  const { button, container } = await renderHomepageTelegramAuthButton();

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.textContent).toContain("Telegram popup closed");
  expect(button.disabled).toBe(false);
});

test("HomepageTelegramAuthButton surfaces missing checkout URLs instead of redirecting", async () => {
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: false,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "checkout",
  });
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: null,
  });

  const { assign, button, container } = await renderHomepageTelegramAuthButton();

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(assign).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Checkout did not return a redirect URL.");
});

function loadLinkedom(): {
  parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
} {
  const resolvePaths = [
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "node_modules/.pnpm/node_modules"),
  ];

  for (const resolvePath of resolvePaths) {
    try {
      const resolvedEntry = requireFromHomepageTelegramAuthButtonTest.resolve("linkedom", {
        paths: [resolvePath],
      });
      return requireFromHomepageTelegramAuthButtonTest(resolvedEntry) as {
        parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
      };
    } catch {
      // Try the next resolution root.
    }
  }

  throw new Error("Unable to resolve linkedom for homepage Telegram auth button tests.");
}

function installGlobals(
  window: Window & typeof globalThis,
  document: Document,
) {
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("MouseEvent", window.MouseEvent);
  vi.stubGlobal("MutationObserver", window.MutationObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

async function renderHomepageTelegramAuthButton(): Promise<{
  assign: ReturnType<typeof vi.fn>;
  button: HTMLButtonElement;
  container: HTMLElement;
  window: Window & typeof globalThis;
}> {
  const { document, window } = loadLinkedom().parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  installGlobals(window, document);
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      assign,
    },
  });

  const container = document.getElementById("root");
  assert.ok(container);
  const root: Root = createRoot(container);
  cleanupRender = async () => {
    await act(async () => {
      root.unmount();
    });
  };

  await act(async () => {
    root.render(createElement(HomepageTelegramAuthButton));
  });

  const button = container.querySelector("button");
  assert.ok(button instanceof window.HTMLButtonElement);

  return {
    assign,
    button,
    container,
    window,
  };
}
