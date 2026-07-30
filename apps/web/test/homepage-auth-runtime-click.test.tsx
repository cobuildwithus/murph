import { act, createElement, useEffect, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authDialogProps: null as null | {
    open: boolean;
    privyRuntime?: { kind: string };
  },
  runtimeModuleLoad: vi.fn(),
  runtimeMount: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: {
    open: boolean;
    privyRuntime?: { kind: string };
  }) {
    mocks.authDialogProps = props;
    return createElement("div", null, props.open ? "Auth dialog" : null);
  },
  preloadHostedAuthPanelIsland: vi.fn(),
  useHostedAuthPanelIslandIdlePreload: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-runtime", () => {
  mocks.runtimeModuleLoad();

  return {
    HostedAuthRuntime({
      children,
    }: {
      children: (state: {
        attempt: number;
        kind: "configured";
        restart: () => void;
      }) => ReactNode;
    }) {
      useEffect(() => {
        mocks.runtimeMount();
      }, []);

      return children({
        attempt: 1,
        kind: "configured",
        restart: () => {},
      });
    },
  };
});

vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({
  subscribeBrowserVaultSessionInvalidation: () => () => {},
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  navigateHostedAuthRedirect: vi.fn(),
  reloadCurrentHostedAuthDocument: vi.fn(),
}));

vi.mock("next/link", () => ({
  default(props: { children?: ReactNode; href: string }) {
    return createElement("a", { href: props.href }, props.children);
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.authDialogProps = null;
});

test("a homepage click before idle opens immediately and starts the shared runtime", async () => {
  const { AuthProvider } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const { LandingAuthActions } = await import("@/app/auth-controls");
  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(LandingAuthActions, {
        authLabel: "Get started",
        authenticated: false,
        context: "hero",
      }),
    ),
    { location: homepageLocation() },
  );

  try {
    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    expect(mocks.authDialogProps).toMatchObject({
      open: true,
      privyRuntime: { kind: "loading" },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.runtimeModuleLoad).toHaveBeenCalledTimes(1);
    expect(mocks.runtimeMount).toHaveBeenCalledTimes(1);
    expect(mocks.authDialogProps).toMatchObject({
      open: true,
      privyRuntime: { kind: "configured" },
    });
  } finally {
    await rendered.cleanup();
  }
});

function homepageLocation() {
  return {
    hash: "",
    href: "https://example.test/",
    origin: "https://example.test",
    pathname: "/",
    search: "",
  };
}
