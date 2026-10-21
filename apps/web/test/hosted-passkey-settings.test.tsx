import { createElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  openAuthDialog: vi.fn(),
  request: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({ authenticated: true, openAuthDialog: mocks.openAuthDialog }),
}));
vi.mock("@/src/components/hosted-onboarding/client-api", async (original) => ({
  ...await original<typeof import("@/src/components/hosted-onboarding/client-api")>(), requestHostedOnboardingJson: mocks.request,
}));


import { HostedPasskeySettings } from "@/src/components/settings/hosted-passkey-settings";

beforeEach(() => { vi.clearAllMocks(); });

function buttons(container: { querySelectorAll(selector: string): Iterable<{ textContent: string | null; disabled: boolean }> }) {
  return [...container.querySelectorAll("button")].map((button) => `${button.textContent}${button.disabled ? " (disabled)" : ""}`);
}

// The Settings control renders the outputs of readHostedSecureApprovalStatus.
test("established Murph passkey shows recovery only", async () => {
  const rendered = await renderClientComponent(createElement(HostedPasskeySettings, {
    authenticated: true, enrollmentEnabled: true, secureApprovalStatus: { status: "configured", method: "passkey" },
  }), { requireButton: false });
  expect(rendered.container.textContent).toContain("Enabled");
  expect(buttons(rendered.container)).toEqual(["Recovery key"]);
  await rendered.cleanup();
});

test("new unprotected account offers initial setup", async () => {
  const rendered = await renderClientComponent(createElement(HostedPasskeySettings, {
    authenticated: true, enrollmentEnabled: true, secureApprovalStatus: { status: "not_configured", method: "initial" },
  }));
  expect(rendered.container.textContent).toContain("Not set up");
  expect(buttons(rendered.container)).toEqual(["Set up"]);
  expect(rendered.container.textContent).toContain("already linked");
  await rendered.cleanup();
});

test("unavailable status stays closed without setup, restoration or migration actions", async () => {
  const rendered = await renderClientComponent(createElement(HostedPasskeySettings, {
    authenticated: true, enrollmentEnabled: true, secureApprovalStatus: { status: "unavailable" },
  }), { requireButton: false });
  expect(rendered.container.textContent).toContain("Unavailable");
  expect(rendered.container.textContent).toContain("temporarily unavailable");
  expect(buttons(rendered.container)).toEqual([]);
  expect(mocks.openAuthDialog).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
  await rendered.cleanup();
});

test("renders nothing before authentication", async () => {
  const rendered = await renderClientComponent(createElement(HostedPasskeySettings, {
    authenticated: false, secureApprovalStatus: { status: "unavailable" },
  }), { requireButton: false });
  expect(rendered.container.textContent).toBe("");
  await rendered.cleanup();
});
