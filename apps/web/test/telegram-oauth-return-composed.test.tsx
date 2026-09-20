import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { HostedAuthenticationCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { renderClientComponent } from "./render-client-component";

const intentKey = "murph:telegram-oauth-dialog-intent:v1";
const mocks = vi.hoisted(() => ({


  navigate: vi.fn(),
  islandCompletions: [] as Array<(payload: HostedAuthenticationCompletionPayload) => Promise<void> | void>,
}));


vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  navigateHostedAuthRedirect: mocks.navigate,
  reloadCurrentHostedAuthDocument: vi.fn(),
}));
vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({
  subscribeBrowserVaultSessionInvalidation: () => () => {},
}));

vi.mock("@/src/components/hosted-onboarding/hosted-first-party-auth-panel", () => ({
  HostedFirstPartyAuthPanel({ onCompleted }: { onCompleted: (payload: HostedAuthenticationCompletionPayload) => Promise<void> | void }) {
    mocks.islandCompletions.push(onCompleted);
    return createElement("button", { type: "button" }, "Complete authentication");
  },
}));

let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => {
  vi.clearAllMocks();

  mocks.islandCompletions = [];


});
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

test("a stale Privy Telegram return waits for sign-in intent and preserves the route completion destination", async () => {
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
  const { AuthProvider, useAuth } = await import("@/src/components/hosted-onboarding/auth-dialog-provider");
  const { HomepageAuthRuntimeProvider } = await import("@/src/components/hosted-onboarding/homepage-auth-runtime-provider");
  function SignInAction() {
    const { openAuthDialog } = useAuth();
    return createElement("button", { onClick: openAuthDialog }, "Sign in");
  }
  await rendered.rerender(
    createElement(AuthProvider, { authenticated: false },
      createElement(HomepageAuthRuntimeProvider, { authenticated: false, authenticatedDestination: "/refer" },
        createElement(SignInAction))),
  );
  await act(async () => { await Promise.resolve(); });

  expect(rendered.window.document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  expect(mocks.islandCompletions).toHaveLength(0);

  await act(async () => {
    rendered.container.querySelector("button")?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(rendered.window.document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(mocks.islandCompletions.length).toBeGreaterThan(0);
  expect(storage.getItem(intentKey)).toBe("1");
  await act(async () => {
    await mocks.islandCompletions.at(-1)?.(completionPayload());
  });
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/refer");
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


function completionPayload(): HostedAuthenticationCompletionPayload {
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
