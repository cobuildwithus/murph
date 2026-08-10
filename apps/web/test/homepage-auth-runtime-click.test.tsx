import { act, createElement, useEffect, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authDialogProps: null as null | {
    autoSendPastedPhoneNumber?: boolean;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    privyRuntime?: { kind: string };
  },
  runtimeModuleLoad: vi.fn(),
  runtimeMount: vi.fn(),
  runtimeUnmount: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: {
    autoSendPastedPhoneNumber?: boolean;
    onOpenChange: (open: boolean) => void;
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
        return () => mocks.runtimeUnmount();
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
  vi.useRealTimers();
  mocks.authDialogProps = null;
});

test("a homepage click before idle opens immediately and starts the shared runtime", async () => {
  vi.useFakeTimers();
  const { HomepageAuthRuntimeProvider } = await import(
    "@/src/components/hosted-onboarding/homepage-auth-runtime-provider"
  );
  const { LandingAuthActions } = await import("@/app/auth-controls");
  const rendered = await renderClientComponent(
    createElement(
      HomepageAuthRuntimeProvider,
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
    act(() => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    expect(mocks.runtimeMount).not.toHaveBeenCalled();
    expect(mocks.authDialogProps).toMatchObject({
      autoSendPastedPhoneNumber: true,
      open: true,
    });

    await flushRuntimeLoad();

    expect(mocks.runtimeModuleLoad).toHaveBeenCalledTimes(1);
    expect(mocks.runtimeMount).not.toHaveBeenCalled();
    expect(mocks.runtimeUnmount).not.toHaveBeenCalled();
    expect(mocks.authDialogProps).toMatchObject({ open: true });
    expect(mocks.authDialogProps?.privyRuntime).toBeUndefined();

    await act(async () => {
      mocks.authDialogProps?.onOpenChange(false);
      await Promise.resolve();
    });

    expect(mocks.runtimeMount).toHaveBeenCalledTimes(1);
    expect(mocks.runtimeUnmount).not.toHaveBeenCalled();
    expect(mocks.authDialogProps).toMatchObject({
      open: false,
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

async function flushRuntimeLoad() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
