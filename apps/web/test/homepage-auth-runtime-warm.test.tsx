import { act, createElement, useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authDialogProps: null as null | {
    autoSendPastedPhoneNumber?: boolean;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    privyRuntime?: { kind: string };
  },
  panelPreload: vi.fn(),
  runtimeFailuresRemaining: 0,
  runtimeLoad: vi.fn(),
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
    return createElement(
      "div",
      {
        "data-auth-dialog-open": props.open ? "yes" : "no",
        "data-auth-runtime": props.privyRuntime?.kind ?? "standalone",
      },
      props.open ? "Auth dialog" : null,
    );
  },
  preloadHostedAuthPanelIsland: mocks.panelPreload,
  useHostedAuthPanelIslandIdlePreload: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/homepage-auth-runtime-loader", () => ({
  async loadHomepageAuthRuntime() {
    mocks.runtimeLoad();
    if (mocks.runtimeFailuresRemaining > 0) {
      mocks.runtimeFailuresRemaining -= 1;
      throw new Error("transient runtime load failure");
    }
    const runtimeModule = await import(
      "@/src/components/hosted-onboarding/hosted-auth-runtime"
    );
    return runtimeModule.HostedAuthRuntime;
  },
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
  default(props: {
    children?: ReactNode;
    href: string;
  }) {
    return createElement("a", { href: props.href }, props.children);
  },
}));

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authDialogProps = null;
  mocks.runtimeFailuresRemaining = 0;
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.useRealTimers();
});

test("warms one shared Privy runtime in the background and reuses it on click", async () => {
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
        preloadAuthPanel: true,
      }),
    ),
    { location: bareHomepageLocation() },
  );
  cleanupRender = rendered.cleanup;

  expect(mocks.runtimeMount).not.toHaveBeenCalled();
  expect(mocks.runtimeModuleLoad).not.toHaveBeenCalled();
  expect(mocks.authDialogProps).toMatchObject({ open: false });
  expect(mocks.authDialogProps?.autoSendPastedPhoneNumber).toBe(true);
  expect(mocks.authDialogProps?.privyRuntime).toBeUndefined();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_200);
  });
  await flushRuntimeLoad();

  expect(mocks.runtimeModuleLoad).toHaveBeenCalledTimes(1);
  expect(mocks.runtimeMount).toHaveBeenCalledTimes(1);
  expect(mocks.panelPreload).not.toHaveBeenCalled();
  expect(mocks.authDialogProps).toMatchObject({
    open: false,
    privyRuntime: { kind: "configured" },
  });

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.runtimeMount).toHaveBeenCalledTimes(1);
  expect(mocks.runtimeUnmount).not.toHaveBeenCalled();
  expect(mocks.authDialogProps).toMatchObject({
    open: true,
    privyRuntime: { kind: "configured" },
  });
});

test("leaves authenticated homepage children on the ordinary root auth owner", async () => {
  vi.useFakeTimers();
  const { HomepageAuthRuntimeProvider } = await import(
    "@/src/components/hosted-onboarding/homepage-auth-runtime-provider"
  );
  const rendered = await renderClientComponent(
    createElement(
      HomepageAuthRuntimeProvider,
      { authenticated: true },
      createElement("p", null, "Authenticated homepage"),
    ),
    { location: bareHomepageLocation(), requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_500);
  });
  await flushRuntimeLoad();

  expect(rendered.container.textContent).toContain("Authenticated homepage");
  expect(mocks.runtimeMount).not.toHaveBeenCalled();
  expect(mocks.authDialogProps).toBeNull();
});

test("keeps a standalone auth session stable and retries a failed background load", async () => {
  vi.useFakeTimers();
  mocks.runtimeFailuresRemaining = 1;
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
    { location: bareHomepageLocation() },
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_200);
  });
  await flushRuntimeLoad();

  expect(mocks.runtimeLoad).toHaveBeenCalledTimes(1);
  expect(mocks.runtimeMount).not.toHaveBeenCalled();
  expect(rendered.container.textContent).toContain("Get started");

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });
  await flushRuntimeLoad();

  expect(mocks.runtimeLoad).toHaveBeenCalledTimes(2);
  expect(mocks.runtimeMount).not.toHaveBeenCalled();
  expect(mocks.authDialogProps).toMatchObject({ open: true });
  expect(mocks.authDialogProps?.privyRuntime).toBeUndefined();

  await act(async () => {
    mocks.authDialogProps?.onOpenChange(false);
    await Promise.resolve();
  });

  expect(mocks.runtimeMount).toHaveBeenCalledTimes(1);
  expect(mocks.authDialogProps).toMatchObject({
    open: false,
    privyRuntime: { kind: "configured" },
  });
});

async function flushRuntimeLoad() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function bareHomepageLocation() {
  return {
    hash: "",
    href: "https://example.test/",
    origin: "https://example.test",
    pathname: "/",
    search: "",
  };
}
