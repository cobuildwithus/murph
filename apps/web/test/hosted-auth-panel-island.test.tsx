import { act, createElement, useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  panelRender: vi.fn(),
  providerMount: vi.fn(),
  providerUnmount: vi.fn(),
  ready: false,
  track: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: mocks.ready }),
}));

vi.mock("@vercel/analytics", () => ({
  track: mocks.track,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel", () => ({
  HostedAuthPanel(props: unknown) {
    mocks.panelRender(props);
    return createElement(
      "div",
      { "data-hosted-auth-panel": "ready" },
      "Ready auth",
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/privy-provider", () => ({
  HostedPrivyProvider({ children }: { children: ReactNode }) {
    useEffect(() => {
      mocks.providerMount();
      return () => mocks.providerUnmount();
    }, []);

    return createElement(
      "div",
      { "data-hosted-privy-provider": "mounted" },
      children,
    );
  },
}));

import { HostedAuthPanelIsland } from "@/src/components/hosted-onboarding/hosted-auth-panel-island";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ready = false;
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "test-privy-app");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_CLIENT_ID", "test-privy-client");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("keeps every auth method hidden until Privy is ready", async () => {
  const rendered = await renderClientComponent(renderAuthIsland(), {
    requireButton: false,
  });

  try {
    expect(rendered.container.textContent).toContain("Preparing secure sign in");
    expect(
      rendered.container.querySelector("[data-hosted-auth-panel='ready']"),
    ).toBeNull();
    expect(mocks.panelRender).not.toHaveBeenCalled();
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);

    mocks.ready = true;
    await rendered.rerender(renderAuthIsland());

    expect(rendered.container.textContent).toContain("Ready auth");
    expect(mocks.panelRender).toHaveBeenCalledTimes(1);
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(mocks.providerUnmount).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("times out visibly and remounts Privy for a bounded retry", async () => {
  vi.useFakeTimers();
  const rendered = await renderClientComponent(renderAuthIsland(), {
    requireButton: false,
  });

  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(rendered.container.textContent).toContain("Sign in didn't load");
    expect(rendered.container.textContent).toContain("Nothing was submitted");
    expect(mocks.panelRender).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith(
      "hosted_auth_privy_ready_timeout",
      expect.objectContaining({ attempt: 1 }),
    );

    const retryButton = Array.from(
      rendered.container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Try again");
    expect(retryButton).toBeTruthy();

    await act(async () => {
      retryButton?.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    expect(rendered.container.textContent).toContain("Preparing secure sign in");
    expect(mocks.providerMount).toHaveBeenCalledTimes(2);
    expect(mocks.providerUnmount).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith(
      "hosted_auth_privy_ready_retry",
      expect.objectContaining({ attempt: 1 }),
    );
  } finally {
    await rendered.cleanup();
  }
});

function renderAuthIsland() {
  return createElement(HostedAuthPanelIsland, {
    methods: ["phone", "telegram", "email"] as const,
  });
}
