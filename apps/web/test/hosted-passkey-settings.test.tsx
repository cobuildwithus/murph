import { createElement } from "react";
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  ensureConfigured: vi.fn(),
  hookState: {
    clientAuthenticated: false,
    configured: false,
    error: null as string | null,
    pendingLabel: null as string | null,
    ready: true,
    walletAddress: null as string | null,
  },
  openAuthDialog: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({
    authenticated: true,
    openAuthDialog: mocks.openAuthDialog,
  }),
}));

vi.mock("@/src/components/sensitive-actions/use-passkey-wallet-mfa", () => ({
  usePasskeyWalletMfa: () => ({
    ...mocks.hookState,
    ensureConfigured: mocks.ensureConfigured,
  }),
}));

import { HostedPasskeySettings } from "@/src/components/settings/hosted-passkey-settings";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hookState.clientAuthenticated = false;
  mocks.hookState.configured = false;
  mocks.hookState.error = null;
  mocks.hookState.pendingLabel = null;
  mocks.hookState.ready = true;
  mocks.hookState.walletAddress = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows server-confirmed passkey enabled when the mobile Privy client user is absent", async () => {
  const rendered = await renderClientComponent(
    createElement(HostedPasskeySettings, {
      authenticated: true,
      secureApprovalStatus: { status: "configured" },
    }),
    { requireButton: false },
  );

  expect(rendered.container.textContent).toContain("Enabled");
  expect(rendered.container.textContent).not.toContain("Not set up");
  expect(rendered.container.textContent).not.toContain("Set up");
  expect(rendered.container.textContent).not.toContain("Sign in");

  await rendered.cleanup();
});

test("asks the user to sign in on this device before starting passkey setup", async () => {
  const rendered = await renderClientComponent(
    createElement(HostedPasskeySettings, {
      authenticated: true,
      secureApprovalStatus: { status: "not_configured" },
    }),
  );

  expect(rendered.container.textContent).toContain("Not set up");
  expect(rendered.container.textContent).toContain("Sign in on this device");
  expect(rendered.button.textContent).toBe("Sign in");

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(mocks.openAuthDialog).toHaveBeenCalledTimes(1);
  expect(mocks.ensureConfigured).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("starts passkey setup only when Privy has an authenticated client user", async () => {
  mocks.hookState.clientAuthenticated = true;
  mocks.ensureConfigured.mockResolvedValue({
    address: "0x1111111111111111111111111111111111111111",
    walletIndex: 0,
  });

  const rendered = await renderClientComponent(
    createElement(HostedPasskeySettings, {
      authenticated: true,
      secureApprovalStatus: { status: "not_configured" },
    }),
  );

  expect(rendered.button.textContent).toBe("Set up");

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(mocks.ensureConfigured).toHaveBeenCalledTimes(1);
  expect(mocks.openAuthDialog).not.toHaveBeenCalled();

  await rendered.cleanup();
});
