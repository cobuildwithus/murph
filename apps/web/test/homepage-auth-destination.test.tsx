import { createElement, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  navigateHostedAuthRedirect: vi.fn(),
  onCompleted: null as
    | null
    | ((payload: HostedPrivyCompletionPayload) => void),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: {
    onCompleted: (payload: HostedPrivyCompletionPayload) => void;
  }) {
    mocks.onCompleted = props.onCompleted;
    return createElement("div", null, "Auth dialog");
  },
  preloadHostedAuthPanelIsland: vi.fn(),
  useHostedAuthPanelIslandIdlePreload: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-runtime", () => ({
  HostedAuthRuntime({
    children,
  }: {
    children: (state: { kind: "configured" }) => ReactNode;
  }) {
    return children({ kind: "configured" });
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  navigateHostedAuthRedirect: mocks.navigateHostedAuthRedirect,
  reloadCurrentHostedAuthDocument: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.onCompleted = null;
});

async function renderProvider(authenticatedDestination?: string) {
  const { HomepageAuthRuntimeProvider } = await import(
    "@/src/components/hosted-onboarding/homepage-auth-runtime-provider"
  );
  return renderClientComponent(
    createElement(
      HomepageAuthRuntimeProvider,
      { authenticated: false, authenticatedDestination },
      createElement("span", null, "content"),
    ),
    { requireButton: false },
  );
}

function completionPayload(
  overrides: Partial<HostedPrivyCompletionPayload>,
): HostedPrivyCompletionPayload {
  return {
    joinUrl: "/join?token=join_token",
    stage: "active",
    ...overrides,
  } as HostedPrivyCompletionPayload;
}

test("an accessible member returns to the configured destination after auth", async () => {
  const rendered = await renderProvider("/refer");
  try {
    mocks.onCompleted?.(completionPayload({ stage: "active" }));
    expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledExactlyOnceWith(
      "/refer",
    );
  } finally {
    await rendered.cleanup();
  }
});

test("an accessible member still lands on home without a destination", async () => {
  const rendered = await renderProvider();
  try {
    mocks.onCompleted?.(completionPayload({ stage: "activating" }));
    expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledExactlyOnceWith(
      "/home",
    );
  } finally {
    await rendered.cleanup();
  }
});

test("incomplete onboarding still follows the server-issued join URL", async () => {
  const rendered = await renderProvider("/refer");
  try {
    mocks.onCompleted?.(completionPayload({ stage: "checkout" }));
    expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledExactlyOnceWith(
      "/join?token=join_token",
    );
  } finally {
    await rendered.cleanup();
  }
});
