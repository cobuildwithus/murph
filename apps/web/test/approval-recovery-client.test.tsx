import { act, createElement, type ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), authorize: vi.fn(), register: vi.fn(), refresh: vi.fn(), openAuth: vi.fn(), close: vi.fn(),
  enterKey: null as ((value: string) => void) | null, dismiss: null as (() => void) | null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@simplewebauthn/browser", () => ({ startRegistration: mocks.register }));
vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({ useAuth: () => ({ openAuthDialog: mocks.openAuth }) }));
vi.mock("@/src/components/hosted-onboarding/client-api", async (original) => ({
  ...await original<typeof import("@/src/components/hosted-onboarding/client-api")>(), requestHostedOnboardingJson: mocks.request,
}));
vi.mock("@/src/components/sensitive-actions/use-sensitive-action-authorization", () => ({ useSensitiveActionAuthorization: () => ({ authorize: mocks.authorize }) }));
vi.mock("@/src/components/ui/dialog", () => {
  const wrap = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return { Dialog: ({ children, onOpenChange }: { children?: ReactNode; onOpenChange: (open: boolean) => void }) => {
    mocks.dismiss = () => onOpenChange(false); return createElement("div", null, children);
  }, DialogContent: wrap, DialogDescription: wrap, DialogHeader: wrap, DialogTitle: wrap };
});
vi.mock("@/src/components/ui/input", () => ({ Input: ({ onChange, ...props }: { value: string; id: string; type?: string; readOnly?: boolean; onChange?: (event: { target: { value: string } }) => void }) => {
  if (onChange) mocks.enterKey = (value) => onChange({ target: { value } });
  return createElement("input", props);
} }));
import { ApprovalRecoveryDialog } from "@/src/components/settings/hosted-approval-recovery-settings";
import { HostedOnboardingApiError } from "@/src/components/hosted-onboarding/client-api";

const key = Buffer.alloc(32, 3).toString("base64url");
const proof = { method: "passkey", token: "synthetic-proof" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.enterKey = null; mocks.dismiss = null;
  mocks.authorize.mockResolvedValue(proof);
  mocks.register.mockResolvedValue({ id: "synthetic-passkey" });
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    if (url.endsWith("/recovery-key")) return { key };
    if (url.endsWith("/options")) return { token: "synthetic-recovery-challenge", options: { challenge: "synthetic-webauthn" } };
    return { recovered: true };
  });
});
async function render(mode: "rotate" | "recover") {
  const rendered = await renderClientComponent(createElement(ApprovalRecoveryDialog, { mode, onClose: mocks.close }));
  if (mode === "recover") await act(async () => { mocks.enterKey?.(key); });
  return rendered;
}
async function click(rendered: Awaited<ReturnType<typeof render>>, label: string) {
  const button = [...rendered.container.querySelectorAll("button")].find((entry) => entry.textContent === label);
  expect(button).toBeDefined();
  await act(async () => { button!.dispatchEvent(new rendered.window.Event("click", { bubbles: true })); });
}

test("key creation requires existing-factor approval and holds the returned key only in this dialog", async () => {
  const rendered = await render("rotate");
  expect(mocks.authorize).not.toHaveBeenCalled();
  await click(rendered, "Create recovery key");
  expect(mocks.authorize).toHaveBeenCalledWith("approval.recovery-key.rotate");
  expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ payload: { authorization: proof }, url: "/api/settings/approval-passkeys/recovery-key" }));
  expect(rendered.container.querySelector<HTMLInputElement>("#approval-saved-recovery-key")?.value).toBe(key);
  expect(rendered.container.textContent).toContain("shown only once");
  expect(mocks.refresh).not.toHaveBeenCalled();
  await rendered.cleanup();
});

test("recovery requires an explicit replacement and the newly created WebAuthn proof", async () => {
  const rendered = await render("recover");
  expect(mocks.request).not.toHaveBeenCalled();
  expect(rendered.container.textContent).toContain("signs out your other devices");
  await click(rendered, "Replace passkey");
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(mocks.register).toHaveBeenCalledWith({ optionsJSON: { challenge: "synthetic-webauthn" } });
  expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { key, token: "synthetic-recovery-challenge", response: { id: "synthetic-passkey" } }, url: "/api/settings/approval-passkeys/recovery/register" }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(rendered.container.querySelector("#approval-recovery-key")).toBeNull();
  expect(rendered.container.textContent).toContain("Save a new recovery key");
  await rendered.cleanup();
});

test("closing during WebAuthn prevents a late registration from replacing the factor", async () => {
  let finish!: (response: { id: string }) => void;
  mocks.register.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const rendered = await render("recover");
  await click(rendered, "Replace passkey");
  await act(async () => { mocks.dismiss?.(); finish({ id: "late-passkey" }); });
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).not.toHaveBeenCalled();
  await rendered.cleanup();
});

test("unmounting before approval completes cannot create a recovery key", async () => {
  let finish!: (value: typeof proof) => void;
  mocks.authorize.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const rendered = await render("rotate");
  await click(rendered, "Create recovery key");
  await rendered.cleanup();
  await act(async () => { finish(proof); });
  expect(mocks.request).not.toHaveBeenCalled();
});

test("a canceled ceremony preserves recovery proof and does not commit or open login", async () => {
  mocks.register.mockRejectedValue(new Error("Passkey setup canceled."));
  const rendered = await render("recover");
  await click(rendered, "Replace passkey");
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.openAuth).not.toHaveBeenCalled();
  expect(rendered.container.textContent).toContain("Passkey setup canceled.");
  await rendered.cleanup();
});

test("a lost commit response refreshes canonical state without retry or false success", async () => {
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    if (url.endsWith("/register")) throw new Error("Recovery could not be confirmed. Refresh Settings.");
    return { token: "synthetic", options: {} };
  });
  const rendered = await render("recover");
  await click(rendered, "Replace passkey");
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(rendered.container.textContent).not.toContain("Your passkey is replaced.");
  expect(rendered.container.textContent).toContain("Refresh Settings.");
  await rendered.cleanup();
});

test("stale primary proof closes recovery and opens first-party login", async () => {
  mocks.request.mockRejectedValue(new HostedOnboardingApiError({ code: "SENSITIVE_ACTION_FRESH_LOGIN_REQUIRED", message: "Sign in again." }));
  const rendered = await render("recover");
  await click(rendered, "Replace passkey");
  expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.openAuth).toHaveBeenCalledOnce();
  expect(mocks.register).not.toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledTimes(1);
  await rendered.cleanup();
});
