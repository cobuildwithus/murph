import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";
import type { HostedContactCodeForm } from "@/src/components/hosted-onboarding/hosted-contact-code-form";
import type { HostedTelegramProofButton } from "@/src/components/hosted-onboarding/hosted-telegram-proof-button";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), sign: vi.fn(), saved: vi.fn(), enroll: vi.fn(),
  enrollment: { registered: false, pending: false, error: null as string | null }, refresh: vi.fn(), openAuth: vi.fn(), close: vi.fn(),
  contact: null as ComponentProps<typeof HostedContactCodeForm> | null,
  telegram: null as ComponentProps<typeof HostedTelegramProofButton> | null,
}));
vi.mock("@/src/components/sensitive-actions/use-approval-passkey-enrollment", () => ({
  useApprovalPasskeyEnrollment: () => ({ ...mocks.enrollment, enroll: mocks.enroll }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({ useAuth: () => ({ openAuthDialog: mocks.openAuth }) }));
vi.mock("@/src/components/hosted-onboarding/client-api", () => ({ requestHostedOnboardingJson: mocks.request }));
vi.mock("@/src/components/sensitive-actions/use-sensitive-action-authorization", () => ({ useSensitiveActionAuthorization: () => ({ signChallenge: mocks.sign }) }));
vi.mock("@/src/components/hosted-onboarding/hosted-contact-code-form", () => ({ HostedContactCodeForm: (props: ComponentProps<typeof HostedContactCodeForm>) => {
  mocks.contact = props; return createElement("button", { type: "button" }, props.verifyLabel);
} }));
vi.mock("@/src/components/hosted-onboarding/hosted-telegram-proof-button", () => ({ HostedTelegramProofButton: (props: ComponentProps<typeof HostedTelegramProofButton>) => {
  mocks.telegram = props; return createElement("button", { type: "button" }, "Continue with Telegram");
} }));
vi.mock("@/src/components/ui/dialog", () => {
  const wrap = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return { Dialog: wrap, DialogContent: wrap, DialogDescription: wrap, DialogHeader: wrap, DialogTitle: wrap };
});
import { HostedLoginMethodDialog } from "@/src/components/settings/hosted-login-method-dialog";

const methods = { email: "member@example.test", phone: null, telegram: "735001" };
const challenge = { token: "synthetic-challenge", message: "Approve the selected change", expiresAt: "2099-01-01T00:00:00Z" };
const authorization = { method: "passkey", token: challenge.token, assertion: { id: "synthetic-passkey" } };
beforeEach(() => {
  vi.resetAllMocks(); mocks.enrollment.registered = false; mocks.enrollment.pending = false; mocks.enrollment.error = null; mocks.contact = null; mocks.telegram = null;
  mocks.sign.mockResolvedValue(authorization);
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    if (url === "/api/settings/login-methods") return { ok: true, methods };
    if (url === "/api/settings/approval-passkeys") return { initialEnrollmentAllowed: false };
    if (url.endsWith("/challenge")) return challenge;
    return { ok: true };
  });
});

async function render(method: "email" | "phone" | "telegram", operation: "set" | "remove" = "set") {
  return renderClientComponent(createElement(HostedLoginMethodDialog, { method, operation, onOpenChange: mocks.close, onSaved: mocks.saved }), { requireButton: false });
}
async function click(rendered: Awaited<ReturnType<typeof render>>, text: string) {
  const button = [...rendered.container.querySelectorAll("button")].find((entry) => entry.textContent === text);
  expect(button).toBeDefined();
  await act(async () => { button!.dispatchEvent(new rendered.window.Event("click", { bubbles: true })); });
}

test("adding a method binds the destination and requires explicit approval after code entry", async () => {
  const rendered = await render("phone");
  expect(rendered.container.textContent).toContain("Your existing sessions stay signed in.");
  const form = mocks.contact!;
  expect(form.autoSubmit).toBe(false);
  const selected = { method: "phone", operation: "set", expectedIdentity: null, value: "+15555550127" };
  const signal = new AbortController().signal;
  await act(async () => { await form.onSend(selected.value, signal); });
  expect(mocks.sign).not.toHaveBeenCalled();
  await act(async () => { await form.onVerify(selected.value, "123456", signal); });
  expect(mocks.sign).toHaveBeenCalledWith(challenge, selected);
  expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({
    url: "/api/settings/login-methods/otp/verify", payload: { change: selected, authorization, code: "123456" },
  }));
  expect(mocks.saved).toHaveBeenCalledOnce();
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(rendered.container.textContent).toContain("Your account is updated.");
  await rendered.cleanup();
});

test("removal explains other-session revocation and signs only the current identity", async () => {
  const rendered = await render("email", "remove");
  expect(rendered.container.textContent).toContain("Other sessions will be signed out; this browser stays signed in.");
  await click(rendered, "Approve and remove email");
  const selected = { method: "email", operation: "remove", expectedIdentity: methods.email, value: null };
  expect(mocks.sign).toHaveBeenCalledWith(challenge, selected);
  expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ url: "/api/settings/login-methods/remove", payload: { change: selected, authorization } }));
  await rendered.cleanup();
});

test("lost commit responses refresh canonical state without replay or a false success", async () => {
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    if (url === "/api/settings/login-methods") return { ok: true, methods };
    if (url.endsWith("/challenge")) return challenge;
    if (url.endsWith("/remove")) throw new Error("The connection was interrupted. Refresh Settings.");
    return {};
  });
  const rendered = await render("email", "remove");
  await click(rendered, "Approve and remove email");
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.request.mock.calls.filter(([input]) => input.url.endsWith("/remove"))).toHaveLength(1);
  expect(rendered.container.textContent).toContain("Refresh Settings.");
  expect(rendered.container.textContent).not.toContain("was removed.");
  expect(mocks.saved).not.toHaveBeenCalled();
  await rendered.cleanup();
});

test("canceled and late approvals cannot submit the credential mutation", async () => {
  let finish!: (value: typeof authorization) => void;
  mocks.sign.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const rendered = await render("email", "remove");
  await click(rendered, "Approve and remove email");
  await rendered.cleanup();
  await act(async () => { finish(authorization); });
  expect(mocks.request.mock.calls.some(([input]) => input.url.endsWith("/remove"))).toBe(false);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

test("approval rejection leaves the contact and session untouched", async () => {
  mocks.sign.mockRejectedValue(new Error("Approval was canceled."));
  const rendered = await render("email", "remove");
  await click(rendered, "Approve and remove email");
  expect(rendered.container.textContent).toContain("Approval was canceled.");
  expect(mocks.request.mock.calls.some(([input]) => input.url.endsWith("/remove"))).toBe(false);
  expect(mocks.refresh).not.toHaveBeenCalled();
  await rendered.cleanup();
});

test("legacy browser access asks for login only when changing a method", async () => {
  mocks.request.mockResolvedValue({ ok: true, requiresLogin: true });
  const rendered = await render("phone");
  expect(mocks.contact).toBeNull();
  expect(mocks.openAuth).not.toHaveBeenCalled();
  await click(rendered, "Sign in to continue");
  expect(mocks.close).toHaveBeenCalledWith(false);
  expect(mocks.openAuth).toHaveBeenCalledOnce();
  expect(mocks.request.mock.calls.some(([input]) => input.url.includes("logout"))).toBe(false);
  await rendered.cleanup();
});

test("Telegram proof and explicit credential approval use separate endpoints", async () => {
  const selected = { method: "telegram", operation: "set", expectedIdentity: methods.telegram, value: "735002" };
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    if (url.endsWith("/prepare")) return { change: selected, challenge };
    if (url === "/api/settings/login-methods") return { ok: true, methods };
    return { ok: true };
  });
  const rendered = await render("telegram");
  expect(mocks.telegram!.purpose).toBe("credential");
  await act(async () => { await mocks.telegram!.onProof("synthetic-id-token", new AbortController().signal); });
  expect(mocks.sign).not.toHaveBeenCalled();
  await click(rendered, "Approve and save");
  expect(mocks.sign).toHaveBeenCalledWith(challenge, selected);
  expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({
    url: "/api/settings/login-methods/telegram/verify", payload: { change: selected, authorization, idToken: "synthetic-id-token" },
  }));
  expect(mocks.request.mock.calls.some(([input]) => input.url.startsWith("/api/auth/"))).toBe(false);
  await rendered.cleanup();
});

test("a Telegram connection changed in another session requires a new review", async () => {
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    if (url.endsWith("/prepare")) return { change: { method: "telegram", operation: "set", expectedIdentity: "735009", value: "735002" }, challenge };
    if (url === "/api/settings/login-methods") return { ok: true, methods };
    return {};
  });
  const rendered = await render("telegram");
  await expect(mocks.telegram!.onProof("synthetic-id-token", new AbortController().signal)).rejects.toThrow("connection changed");
  expect(mocks.sign).not.toHaveBeenCalled();
  await rendered.cleanup();
});


test("initial passkey setup stays in the connection dialog and resumes the selected method", async () => {
  let needsPasskey = true;
  mocks.request.mockImplementation(async ({ url }: { url: string }) => url === "/api/settings/login-methods"
    ? { ok: true, methods } : { initialEnrollmentAllowed: needsPasskey });
  const rendered = await render("phone");
  expect(mocks.contact).toBeNull();
  await click(rendered, "Set up");
  expect(mocks.enroll).toHaveBeenCalledOnce();
  expect(mocks.saved).not.toHaveBeenCalled();
  needsPasskey = false;
  mocks.enrollment.registered = true;
  await rendered.rerender(createElement(HostedLoginMethodDialog, { method: "phone", operation: "set", onOpenChange: mocks.close, onSaved: mocks.saved }));
  await vi.waitFor(() => expect(mocks.contact?.method).toBe("phone"));
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.openAuth).not.toHaveBeenCalled();
  await rendered.cleanup();
});
