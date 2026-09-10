import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { HostedLoginMethodSettings } from "@/src/components/settings/hosted-login-method-settings";
import type { HostedPasskeySettings } from "@/src/components/settings/hosted-passkey-settings";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), snapshot: vi.fn(), approval: vi.fn(),
  connections: vi.fn(), passkeys: vi.fn(), provider: vi.fn(), prisma: {},
}));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({ getHostedPageAuthSnapshot: mocks.auth }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/src/lib/hosted-onboarding/account-settings-snapshot", () => ({ readHostedAccountSettingsPageSnapshot: mocks.snapshot }));
vi.mock("@/src/lib/sensitive-actions/secure-approval-status", () => ({ readHostedSecureApprovalStatus: mocks.approval }));
vi.mock("@/src/lib/sensitive-actions/passkey-rollout", () => ({ isApprovalPasskeyEnrollmentEnabled: () => true }));
vi.mock("@/src/components/hosted-onboarding/privy-provider", () => ({ HostedPrivyProvider: ({ children }: { children: ReactNode }) => { mocks.provider(); return children; } }));
vi.mock("@/src/components/ui/auth-button", () => ({ AuthButton: ({ children }: { children: ReactNode }) => createElement("button", null, children) }));
vi.mock("@/src/components/settings/hosted-login-method-settings", () => ({ HostedLoginMethodSettings: (props: ComponentProps<typeof HostedLoginMethodSettings>) => {
  mocks.connections(props); return createElement("p", null, "Connected accounts");
} }));
vi.mock("@/src/components/settings/hosted-passkey-settings", () => ({ HostedPasskeySettings: (props: ComponentProps<typeof HostedPasskeySettings>) => {
  mocks.passkeys(props); return createElement("p", null, "Approval passkeys");
} }));
import AccountSettingsPage from "../app/settings/accounts/page";

const account = {
  email: { address: "synthetic@example.com", verifiedAt: "2026-09-09T12:00:00Z" },
  phone: { number: null, verifiedAt: null }, telegram: { telegramUserId: null }, referralIdentityKey: "synthetic-referral",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ authenticated: true, authenticatedMember: { id: "synthetic-member", billingStatus: "not_started" }, session: { privyUserId: null } });
  mocks.snapshot.mockResolvedValue({ account, billingRef: null, routing: null });
  mocks.approval.mockResolvedValue({ method: "initial", status: "not_configured" });
});
afterEach(() => { vi.unstubAllEnvs(); });

test.each(["initial", "passkey"] as const)("%s protection does not mount legacy SDK state", async (method) => {
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "synthetic-app");
  mocks.approval.mockResolvedValue({ method, status: method === "initial" ? "not_configured" : "configured" });
  renderToStaticMarkup(await AccountSettingsPage({ searchParams: Promise.resolve({}) }));
  expect(mocks.provider).not.toHaveBeenCalled();
  expect(mocks.passkeys).toHaveBeenCalledOnce();
});

test("an unmigrated factor retains its temporary SDK provider", async () => {
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "synthetic-app");
  mocks.approval.mockResolvedValue({ status: "configured" });
  renderToStaticMarkup(await AccountSettingsPage({ searchParams: Promise.resolve({}) }));
  expect(mocks.provider).toHaveBeenCalledOnce();
});

test("unfinished signup can reach canonical account connections and initial passkey setup", async () => {
  const markup = renderToStaticMarkup(await AccountSettingsPage({ searchParams: Promise.resolve({}) }));
  expect(mocks.snapshot).toHaveBeenCalledWith({ memberId: "synthetic-member", prisma: mocks.prisma });
  expect(mocks.connections).toHaveBeenCalledWith({ account });
  expect(mocks.passkeys).toHaveBeenCalledWith({ authenticated: true, enrollmentEnabled: true, secureApprovalStatus: { method: "initial", status: "not_configured" } });
  expect(markup).toContain('href="/join"');
  expect(markup).toContain('id="security"');
});

test("signed-out entry requests login before any account or factor read", async () => {
  mocks.auth.mockResolvedValue({ authenticated: false, authenticatedMember: null, session: null });
  const markup = renderToStaticMarkup(await AccountSettingsPage({ searchParams: Promise.resolve({ companion: "ios" }) }));
  expect(markup).toContain("Sign in");
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.approval).not.toHaveBeenCalled();
  expect(mocks.connections).not.toHaveBeenCalled();
});

test.each([
  ["ios", "ai.withmurph.app://account-settings"],
  ["ios-dev", "ai.withmurph.app.dev://account-settings"],
] as const)("%s returns through a fixed callback containing no credential or member identity", async (companion, expected) => {
  const markup = renderToStaticMarkup(await AccountSettingsPage({ searchParams: Promise.resolve({ companion }) }));
  expect(markup).toContain(`href="${expected}"`);
  expect(markup).not.toContain("synthetic-member");
  expect(markup).not.toContain("?token");
});

test.each(["https://untrusted.example/return", ["ios", "ios-dev"]])("unrecognized or duplicate companion targets cannot choose a redirect", async (companion) => {
  const markup = renderToStaticMarkup(await AccountSettingsPage({ searchParams: Promise.resolve({ companion }) }));
  expect(markup).toContain('href="/join"');
  expect(markup).not.toContain("untrusted.example");
  expect(markup).not.toContain("://account-settings");
});
