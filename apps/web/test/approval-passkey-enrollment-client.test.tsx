import { createElement, act } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), authenticated: true, openAuthDialog: vi.fn(),
  refresh: vi.fn(), requestJson: vi.fn(), startRegistration: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@simplewebauthn/browser", () => ({ startRegistration: mocks.startRegistration }));
vi.mock("@/src/components/hosted-onboarding/client-api", () => ({ requestHostedOnboardingJson: mocks.requestJson }));
vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({ useAuth: () => ({ openAuthDialog: mocks.openAuthDialog }) }));
vi.mock("@/src/components/sensitive-actions/use-sensitive-action-authorization", () => ({ useSensitiveActionAuthorization: () => ({ authorize: mocks.authorize, setup: { clientAuthenticated: mocks.authenticated } }) }));
import { useApprovalPasskeyEnrollment } from "@/src/components/sensitive-actions/use-approval-passkey-enrollment";
import { ApprovalPasskeyUpdate } from "@/src/components/settings/approval-passkey-status";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticated = true;
  mocks.authorize.mockResolvedValue({ token: "synthetic-proof" });
  mocks.requestJson.mockResolvedValue({ challenge: "synthetic-challenge" });
  mocks.startRegistration.mockResolvedValue({ id: "synthetic-key" });
});
function Harness() {
  const state = useApprovalPasskeyEnrollment();
  return createElement(ApprovalPasskeyUpdate, { ...state, onUpdate: () => void state.enroll() });
}
async function click(rendered: Awaited<ReturnType<typeof renderClientComponent>>) {
  const button = rendered.button;
  if (!button) throw new Error("Missing update action.");
  await act(async () => { button.dispatchEvent(new rendered.window.Event("click", { bubbles: true })); });
}

test("updates the passkey through protected authorization and refreshes canonical status", async () => {
  const rendered = await renderClientComponent(createElement(Harness));
  await click(rendered);
  expect(mocks.authorize).toHaveBeenCalledWith("approval.passkey.enroll");
  expect(mocks.requestJson).toHaveBeenLastCalledWith(expect.objectContaining({
    url: "/api/settings/approval-passkeys/register",
    payload: { authorization: { token: "synthetic-proof" }, response: { id: "synthetic-key" } },
  }));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(rendered.container.textContent).toContain("Your passkey is updated.");
  await rendered.cleanup();
});

test("reconciles a lost registration response instead of assuming the server did not save", async () => {
  mocks.requestJson.mockImplementation(async ({ url }: { url: string }) => {
    if (url.endsWith("/register")) throw new Error("The update could not be confirmed.");
    return { challenge: "synthetic-challenge" };
  });
  const rendered = await renderClientComponent(createElement(Harness));
  await click(rendered);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(rendered.container.querySelector('[role="alert"]')?.textContent).toBe("The update could not be confirmed.");
  expect(rendered.container.textContent).not.toContain("Your passkey is updated.");
  await rendered.cleanup();
});

test("cancellation never submits a registration or starts another login", async () => {
  mocks.startRegistration.mockRejectedValue(new Error("Passkey update canceled."));
  const rendered = await renderClientComponent(createElement(Harness));
  await click(rendered);
  expect(mocks.requestJson).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.openAuthDialog).not.toHaveBeenCalled();
  expect(rendered.container.textContent).toContain("Passkey update canceled.");
  await rendered.cleanup();
});

test("restores the existing provider session before asking its factor to authorize", async () => {
  mocks.authenticated = false;
  const rendered = await renderClientComponent(createElement(Harness));
  await click(rendered);
  expect(mocks.openAuthDialog).toHaveBeenCalledTimes(1);
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(mocks.requestJson).not.toHaveBeenCalled();
  await rendered.cleanup();
});
