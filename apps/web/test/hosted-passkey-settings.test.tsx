import { act, createElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";
const mocks = vi.hoisted(() => ({ enroll: vi.fn(), state: { pending: false, registered: false, error: null as string | null } }));
vi.mock("@/src/components/sensitive-actions/use-approval-passkey-enrollment", () => ({
  useApprovalPasskeyEnrollment: () => ({ ...mocks.state, enroll: mocks.enroll }),
}));
import { HostedPasskeySettings } from "@/src/components/settings/hosted-passkey-settings";
beforeEach(() => { vi.clearAllMocks(); mocks.state.pending = false; mocks.state.registered = false; mocks.state.error = null; });

test("renders an established passkey and recovery without primary reauthentication", async () => {
  const rendered = await renderClientComponent(createElement(HostedPasskeySettings, {
    authenticated: true, enrollmentEnabled: true, secureApprovalStatus: { status: "configured", method: "passkey" },
  }));
  try {
    expect(rendered.container.textContent).toContain("Enabled");
    expect([...rendered.container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Save a recovery key", "Use a recovery key"]);
    expect(mocks.enroll).not.toHaveBeenCalled();
  } finally { await rendered.cleanup(); }
});

test("starts the initial passkey owner only when its server gate is open", async () => {
  const props = { authenticated: true, enrollmentEnabled: false, secureApprovalStatus: { status: "not_configured" as const, method: "initial" as const } };
  const rendered = await renderClientComponent(createElement(HostedPasskeySettings, props));
  try {
    expect(rendered.button.disabled).toBe(true);
    await rendered.rerender(createElement(HostedPasskeySettings, { ...props, enrollmentEnabled: true }));
    await act(async () => { rendered.container.querySelector("button")?.dispatchEvent(new rendered.window.Event("click", { bubbles: true })); });
    expect(mocks.enroll).toHaveBeenCalledOnce();
  } finally { await rendered.cleanup(); }
});

test("does not offer enrollment when the existing protection cannot be read", async () => {
  const rendered = await renderClientComponent(createElement(HostedPasskeySettings, {
    authenticated: true, enrollmentEnabled: true, secureApprovalStatus: { status: "unavailable" },
  }), { requireButton: false });
  try {
    expect(rendered.container.textContent).toContain("temporarily unavailable");
    expect(rendered.container.querySelector("button")).toBeNull();
  } finally { await rendered.cleanup(); }
});
