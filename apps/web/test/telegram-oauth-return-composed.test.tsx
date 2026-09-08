import { act, createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { renderClientComponent } from "./render-client-component";

const intentKey = "murph:telegram-oauth-dialog-intent:v1";
const mocks = vi.hoisted(() => ({
  callbacks: null as null | { onComplete?: () => void; onError?: (error: unknown) => void },
  complete: vi.fn(),
  initOAuth: vi.fn(),
  navigate: vi.fn(),
  islandCompletions: [] as Array<(payload: HostedPrivyCompletionPayload) => Promise<void> | void>,
}));

vi.mock("@privy-io/react-auth", () => ({
  Captcha: () => null,
  usePrivy: () => ({ authenticated: true, ready: true, logout: vi.fn() }),
  useUser: () => ({
    user: { linkedAccounts: [
      { type: "phone", phone_number: "+12025550123", latest_verified_at: 1741194420 },
      { type: "telegram", id: "synthetic-telegram-account" },
    ] },
  }),
  useLoginWithOAuth(callbacks: typeof mocks.callbacks) {
    mocks.callbacks = callbacks;
    return { initOAuth: mocks.initOAuth, loading: false };
  },
  useLoginWithSms: () => ({ loginWithCode: vi.fn(), sendCode: vi.fn() }),
  useLoginWithEmail: () => ({ loginWithCode: vi.fn(), sendCode: vi.fn(), state: { status: "initial" } }),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-completion", () => ({
  completeHostedPrivyAuth: mocks.complete,
}));
vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  navigateHostedAuthRedirect: mocks.navigate,
  reloadCurrentHostedAuthDocument: vi.fn(),
}));
vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({
  subscribeBrowserVaultSessionInvalidation: () => () => {},
}));
vi.mock("@/src/components/hosted-onboarding/hosted-auth-runtime", () => ({
  HostedAuthRuntime({ children }: { children: (runtime: { kind: "configured"; attempt: number; restart: () => void }) => ReactNode }) {
    return children({ kind: "configured", attempt: 1, restart: () => {} });
  },
}));
vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel-island", () => ({
  HostedAuthPanelIsland({ onCompleted }: { onCompleted: (payload: HostedPrivyCompletionPayload) => Promise<void> | void }) {
    mocks.islandCompletions.push(onCompleted);
    return createElement("button", { type: "button" }, "Complete authentication");
  },
}));

let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.callbacks = null;
  mocks.islandCompletions = [];
  mocks.initOAuth.mockResolvedValue(undefined);
  mocks.complete.mockReturnValue(new Promise(() => {}));
});
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

test("a Telegram return opens one composed dialog and preserves the route completion destination", async () => {
  const storage = memoryStorage("1");
  const rendered = await renderClientComponent(createElement("div"), {
    requireButton: false,
    sessionStorage: storage,
    location: { pathname: "/refer", search: "", href: "https://example.test/refer" },
  });
  cleanup = rendered.cleanup;
  // Linkedom has no layout engine; preserve the real modal while making its
  // scroll-lock feature observe an already locked document.
  rendered.window.document.documentElement.style.overflowY = "hidden";
  rendered.window.getComputedStyle = (element) => {
    if (!(element instanceof rendered.window.HTMLElement)) {
      throw new Error("Expected an HTML element in the modal fixture");
    }
    return element.style;
  };
  const { AuthProvider } = await import("@/src/components/hosted-onboarding/auth-dialog-provider");
  const { HomepageAuthRuntimeProvider } = await import("@/src/components/hosted-onboarding/homepage-auth-runtime-provider");
  await rendered.rerender(
    createElement(AuthProvider, { authenticated: false },
      createElement(HomepageAuthRuntimeProvider, { authenticated: false, authenticatedDestination: "/refer" })),
  );
  await act(async () => { await Promise.resolve(); });

  expect(rendered.window.document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(mocks.islandCompletions.length).toBeGreaterThan(0);
  expect(storage.getItem(intentKey)).toBe("claimed");
  await act(async () => {
    await mocks.islandCompletions.at(-1)?.(completionPayload());
  });
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/refer");
});

test("a returned phone-linked Telegram session shows pending completion and disables competing methods", async () => {
  const { HostedAuthPanel } = await import("@/src/components/hosted-onboarding/hosted-auth-panel");
  const rendered = await renderClientComponent(createElement(HostedAuthPanel, {
    methods: ["phone", "telegram", "email"],
  }), { sessionStorage: memoryStorage("claimed"), matchMedia: desktopMatchMedia });
  cleanup = rendered.cleanup;
  await act(async () => {
    mocks.callbacks?.onComplete?.();
    mocks.callbacks?.onComplete?.();
  });

  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith({ authMethod: "telegram" });
  const buttons = Array.from(rendered.container.querySelectorAll("button"));
  expect(buttons.find((button) => button.textContent?.trim() === "Finishing...")?.disabled).toBe(true);
  expect(buttons.find((button) => button.textContent?.trim() === "Email")?.disabled).toBe(true);
  expect(buttons.some((button) => button.textContent?.trim() === "Continue")).toBe(false);
  expect(rendered.container.querySelector<HTMLInputElement>('input[type="tel"]')?.disabled).toBe(true);
  expect(rendered.window.sessionStorage.getItem(intentKey)).toBeNull();
});

test("a failed Telegram return displays its retry notice with the real phone UI", async () => {
  const { HostedAuthPanel } = await import("@/src/components/hosted-onboarding/hosted-auth-panel");
  const rendered = await renderClientComponent(createElement(HostedAuthPanel, {
    methods: ["phone", "telegram", "email"],
  }), { sessionStorage: memoryStorage("claimed"), matchMedia: desktopMatchMedia });
  cleanup = rendered.cleanup;
  await act(async () => { mocks.callbacks?.onError?.(new Error("Telegram authorization could not finish.")); });

  expect(rendered.container.textContent).toContain("Telegram authorization could not finish.");
  const retry = Array.from(rendered.container.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === "Telegram");
  expect(retry?.disabled).toBe(false);
  await act(async () => { retry?.dispatchEvent(new rendered.window.Event("click", { bubbles: true })); });
  expect(mocks.initOAuth).toHaveBeenCalledExactlyOnceWith({ provider: "telegram" });
  expect(mocks.complete).not.toHaveBeenCalled();
});

function memoryStorage(marker: string): Storage {
  const values = new Map([[intentKey, marker]]);
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function desktopMatchMedia(media: string): MediaQueryList {
  return {
    matches: false,
    media,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
}

function completionPayload(): HostedPrivyCompletionPayload {
  return {
    inviteCode: "synthetic-invite",
    joinUrl: "/join/synthetic-invite",
    messagingSetupRequired: false,
    stage: "active",
    status: {
      billing: { defaultPlanCode: null, plans: [] },
      capabilities: { billingReady: true, phoneAuthReady: true },
      invite: null,
      messagingSetupRequired: false,
      session: { authenticated: true, expiresAt: null, matchesInvite: true },
      stage: "active",
      telegramStartRequired: false,
    },
  };
}
