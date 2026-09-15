import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";
import type { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";

const mocks = vi.hoisted(() => ({ dialog: null as ComponentProps<typeof AuthDialog> | null, preload: vi.fn() }));
vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: ComponentProps<typeof AuthDialog>) { mocks.dialog = props; return createElement("div", null, props.open ? "Auth dialog" : null); },
  preloadHostedAuthPanelIsland: mocks.preload,
}));
vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({ subscribeBrowserVaultSessionInvalidation: () => () => {} }));
vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({ navigateHostedAuthRedirect: vi.fn(), reloadCurrentHostedAuthDocument: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children?: ReactNode; href: string }) => createElement("a", { href }, children) }));
import { HomepageAuthRuntimeProvider } from "@/src/components/hosted-onboarding/homepage-auth-runtime-provider";
import { LandingAuthActions } from "@/app/auth-controls";

let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => { vi.clearAllMocks(); mocks.dialog = null; });
afterEach(async () => { await cleanup?.(); cleanup = null; });
async function render() {
  const rendered = await renderClientComponent(createElement(HomepageAuthRuntimeProvider, { authenticated: false },
    createElement(LandingAuthActions, { authLabel: "Get started", authenticated: false, context: "hero" })));
  cleanup = rendered.cleanup;
  return rendered;
}

test("focus warms code without opening authentication; click opens the shared dialog", async () => {
  const rendered = await render();
  expect(mocks.preload).not.toHaveBeenCalled();
  expect(mocks.dialog?.open).toBe(false);
  await act(async () => { rendered.button.dispatchEvent(new rendered.window.Event("focusin", { bubbles: true })); });
  expect(mocks.preload).toHaveBeenCalledOnce();
  expect(mocks.dialog?.open).toBe(false);
  await act(async () => { rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true })); });
  expect(mocks.dialog).toMatchObject({ open: true, autoSendPastedPhoneNumber: true, requireLaunchConsentOnCompletion: true });
});

test("a first click works without preloading and close permits a fresh dialog", async () => {
  const rendered = await render();
  await act(async () => { rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true })); });
  expect(mocks.dialog?.open).toBe(true);
  await act(async () => { mocks.dialog!.onOpenChange(false); });
  expect(mocks.dialog?.open).toBe(false);
  await act(async () => { rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true })); });
  expect(mocks.dialog?.open).toBe(true);
});

test("authenticated homepage children keep their existing root session owner", async () => {
  const rendered = await renderClientComponent(createElement(HomepageAuthRuntimeProvider, { authenticated: true }, createElement("p", null, "Your account")), { requireButton: false });
  cleanup = rendered.cleanup;
  expect(rendered.container.textContent).toContain("Your account");
  expect(mocks.dialog).toBeNull();
  expect(mocks.preload).not.toHaveBeenCalled();
});
