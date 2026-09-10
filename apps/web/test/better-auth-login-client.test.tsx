import { act, createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";
import type { HostedContactCodeForm } from "@/src/components/hosted-onboarding/hosted-contact-code-form";
import type { HostedTelegramProofButton } from "@/src/components/hosted-onboarding/hosted-telegram-proof-button";
import type { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

const mocks = vi.hoisted(() => ({
  invalidated: vi.fn(), reloaded: vi.fn(), request: vi.fn(), completed: vi.fn(), declined: vi.fn(), logout: vi.fn(), navigate: vi.fn(),
  contact: null as ComponentProps<typeof HostedContactCodeForm> | null,
  telegram: null as ComponentProps<typeof HostedTelegramProofButton> | null,
  consent: null as ComponentProps<typeof HostedLegalConsentCard> | null,
}));
vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({
  BROWSER_VAULT_SESSION_ENDING_LEASE_MS: 30_000,
  publishBrowserVaultSessionEnding: vi.fn(), publishBrowserVaultSessionInvalidation: mocks.invalidated,
}));
vi.mock("@/src/components/hosted-onboarding/client-api", () => ({ requestHostedOnboardingJson: mocks.request }));
vi.mock("@/src/components/hosted-onboarding/hosted-app-session-client", async (original) => ({ ...await original<typeof import("@/src/components/hosted-onboarding/hosted-app-session-client")>(), declineHostedLaunchConsent: mocks.declined, logoutHostedAppSession: mocks.logout }));
vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({ navigateHostedAuthRedirect: mocks.navigate, reloadCurrentHostedAuthDocument: mocks.reloaded }));
vi.mock("@/src/components/hosted-onboarding/hosted-contact-code-form", () => ({ HostedContactCodeForm: (props: ComponentProps<typeof HostedContactCodeForm>) => {
  mocks.contact = props; return createElement("button", { type: "button" }, "Send code");
} }));
vi.mock("@/src/components/hosted-onboarding/hosted-telegram-proof-button", () => ({ HostedTelegramProofButton: (props: ComponentProps<typeof HostedTelegramProofButton>) => {
  mocks.telegram = props; return createElement("button", { type: "button" }, "Continue with Telegram");
} }));
vi.mock("@/src/components/legal/hosted-legal-consent-card", () => ({ HostedLegalConsentCard: (props: ComponentProps<typeof HostedLegalConsentCard>) => {
  mocks.consent = props; return createElement("p", null, "Review consent");
} }));
import { HostedFirstPartyAuthPanel } from "@/src/components/hosted-onboarding/hosted-first-party-auth-panel";

const acceptedConsent: HostedConsentStatus = {
  ok: true, schema: "murph.hosted-consent-status.v1", generatedAt: "2026-09-09T12:00:00Z",
  launchGranted: true, documents: [], scopes: [], launchScopes: [],
};
const payload: HostedPrivyCompletionPayload = {
  inviteCode: "synthetic-invite", joinUrl: "/join/synthetic-invite", launchConsentGranted: true,
  messagingSetupRequired: false, stage: "active", status: {
    billing: { defaultPlanCode: null, plans: [] }, capabilities: { billingReady: true, phoneAuthReady: true },
    invite: null, messagingSetupRequired: false, stage: "active", telegramStartRequired: false,
    session: { authenticated: true, expiresAt: "2099-01-01T00:00:00Z", matchesInvite: true },
  },
};
let rendered: Awaited<ReturnType<typeof renderClientComponent>> | null = null;
beforeEach(() => {
  vi.resetAllMocks(); mocks.contact = null; mocks.telegram = null; mocks.consent = null;
  mocks.request.mockImplementation(async ({ url }: { url: string }) => url.endsWith("/complete") ? payload : { ok: true, memberId: "synthetic-member" });
  mocks.declined.mockResolvedValue(undefined); mocks.logout.mockResolvedValue(undefined);
});
afterEach(async () => { await rendered?.cleanup(); rendered = null; });
async function render(props: Partial<ComponentProps<typeof HostedFirstPartyAuthPanel>> = {}) {
  rendered = await renderClientComponent(createElement(HostedFirstPartyAuthPanel, {
    methods: ["phone", "email", "telegram"], onCompleted: mocks.completed,
    requireLaunchConsentOnCompletion: true, ...props,
  }));
  return rendered;
}
async function verify() { await act(async () => { await mocks.contact!.onVerify("+15555550127", "123456", new AbortController().signal); }); }
async function click(label: string) {
  const button = [...rendered!.container.querySelectorAll("button")].find((entry) => entry.textContent === label);
  expect(button).toBeDefined();
  await act(async () => { button!.dispatchEvent(new rendered!.window.Event("click", { bubbles: true })); });
}

test("login uses fixed first-party routes and completes without signing out existing sessions", async () => {
  await render({ inviteCode: "synthetic-referral" });
  await act(async () => { await mocks.contact!.onSend("+15555550127", new AbortController().signal); });
  expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ url: "/api/auth/otp/send", payload: { kind: "phone", value: "+15555550127" } }));
  await verify();
  expect(mocks.request.mock.calls.map(([input]) => input.url)).toEqual(["/api/auth/otp/send", "/api/auth/otp/verify", "/api/auth/complete"]);
  expect(mocks.request.mock.calls[1][0].payload).toMatchObject({ kind: "phone", value: "+15555550127", code: "123456", inviteCode: "synthetic-referral" });
  expect(mocks.completed).toHaveBeenCalledWith(payload);
  expect(mocks.logout).not.toHaveBeenCalled();
});

test("bootstrap outages retry account loading without another OTP verification", async () => {
  let attempts = 0;
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    if (url.endsWith("/complete")) { if (++attempts === 1) throw new Error("Your account is temporarily unavailable."); return payload; }
    return { ok: true, memberId: "synthetic-member" };
  });
  await render(); await verify();
  expect(mocks.completed).not.toHaveBeenCalled();
  expect(rendered!.container.textContent).toContain("You’re signed in");
  expect(rendered!.container.textContent).toContain("temporarily unavailable");
  await click("Continue");
  expect(mocks.request.mock.calls.filter(([input]) => input.url.endsWith("/verify"))).toHaveLength(1);
  expect(mocks.request.mock.calls.filter(([input]) => input.url.endsWith("/complete"))).toHaveLength(2);
  expect(mocks.completed).toHaveBeenCalledWith(payload);
});

test.each(["active", "checkout"] as const)("%s completion waits for current launch consent", async (stage) => {
  let granted = false;
  mocks.request.mockImplementation(async ({ url }: { url: string }) => url.endsWith("/complete")
    ? { ...payload, stage, launchConsentGranted: granted } : { ok: true, memberId: "synthetic-member" });
  await render(); await verify();
  expect(rendered!.container.textContent).toContain("Review consent");
  expect(mocks.completed).not.toHaveBeenCalled();
  granted = true;
  await act(async () => { await mocks.consent!.onAccepted?.(acceptedConsent); });
  expect(mocks.completed).toHaveBeenCalledWith(expect.objectContaining({ stage, launchConsentGranted: true }));
});

test("decline fences a pending acceptance and late account-loading results", async () => {
  let calls = 0;
  let finish!: (value: HostedPrivyCompletionPayload) => void;
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    if (!url.endsWith("/complete")) return { ok: true, memberId: "synthetic-member" };
    if (++calls === 1) return { ...payload, launchConsentGranted: false };
    return new Promise((resolve) => { finish = resolve; });
  });
  await render(); await verify();
  let acceptance!: Promise<void> | void;
  await act(async () => { acceptance = mocks.consent!.onAccepted?.(acceptedConsent); });
  await act(async () => { mocks.consent!.onDecline?.(); });
  expect(mocks.declined).toHaveBeenCalledOnce();
  await act(async () => { finish(payload); await acceptance; });
  expect(mocks.completed).not.toHaveBeenCalled();
  expect(rendered!.container.textContent).not.toContain("Review consent");
  expect(rendered!.container.textContent).toContain("Send code");
});

test("an unconfirmed login does not use a pre-existing session or fall back to a provider", async () => {
  mocks.request.mockRejectedValue(new Error("Sign-in is temporarily unavailable."));
  await render();
  await expect(mocks.contact!.onVerify("+15555550127", "123456", new AbortController().signal)).rejects.toThrow("unavailable");
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(mocks.completed).not.toHaveBeenCalled();
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(rendered!.container.textContent).not.toContain("You’re signed in");
});

test("Telegram signs in through the same consent and product completion owner", async () => {
  await render({ methods: ["telegram"] });
  expect(mocks.telegram!.purpose).toBe("login");
  await act(async () => { await mocks.telegram!.onProof("synthetic-id-token", new AbortController().signal); });
  expect(mocks.request.mock.calls.map(([input]) => input.url)).toEqual(["/api/auth/telegram/verify", "/api/auth/complete"]);
  expect(mocks.completed).toHaveBeenCalledWith(payload);
});

test("closing during product bootstrap prevents a late completion callback", async () => {
  let finish!: (value: HostedPrivyCompletionPayload) => void;
  mocks.request.mockImplementation(async ({ url }: { url: string }) => url.endsWith("/complete")
    ? new Promise((resolve) => { finish = resolve; }) : { ok: true, memberId: "synthetic-member" });
  await render();
  let pending!: Promise<void>;
  await act(async () => { pending = mocks.contact!.onVerify("+15555550127", "123456", new AbortController().signal); });
  await rendered!.cleanup(); rendered = null;
  await act(async () => { finish(payload); await pending; });
  expect(mocks.completed).not.toHaveBeenCalled();
});

test.each(["phone", "telegram"] as const)("clears the previous vault at %s login headers even when its response cannot be read", async (method) => {
  mocks.request.mockImplementation(async (input: { url: string; onSuccessfulResponseHeaders?: () => void; onSuccessfulResponseError?: () => void }) => {
    if (!input.url.endsWith("/verify")) throw new Error("Unexpected completion after failed response.");
    input.onSuccessfulResponseHeaders?.();
    expect(mocks.invalidated).toHaveBeenCalledOnce();
    input.onSuccessfulResponseError?.();
    throw new Error("response body unavailable");
  });
  await render({ methods: [method] });
  await act(async () => {
    const signal = new AbortController().signal;
    const operation = method === "phone"
      ? mocks.contact!.onVerify("+15555550127", "123456", signal)
      : mocks.telegram!.onProof("synthetic-telegram-proof", signal);
    await expect(operation).rejects.toThrow("response body unavailable");
  });
  expect(mocks.reloaded).toHaveBeenCalledOnce();
  expect(mocks.completed).not.toHaveBeenCalled();
  expect(mocks.logout).not.toHaveBeenCalled();
});
