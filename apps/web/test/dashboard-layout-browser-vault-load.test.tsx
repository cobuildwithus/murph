import assert from "node:assert/strict";

import { isValidElement, type ReactNode } from "react";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedDashboardLayoutAuthSnapshot: vi.fn(),
  readHostedConsentStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedDashboardLayoutAuthSnapshot: mocks.getHostedDashboardLayoutAuthSnapshot,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  hasHostedHistoricalLaunchConsent: () => false,
  readHostedConsentStatus: mocks.readHostedConsentStatus,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({}),
}));

vi.mock("@/src/components/dashboard/dashboard-shell", () => ({
  DashboardShell: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/src/components/dashboard/dashboard-critical-load-error", () => ({
  DashboardCriticalLoadError: () => null,
}));

vi.mock("@/src/components/legal/dashboard-legal-consent-gate", () => ({
  DashboardLegalConsentGate: () => null,
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider: ({ children }: { children: ReactNode }) => children,
}));

async function renderLayoutProviderProps(): Promise<{
  initialMemberId: string | null;
  loadEnabled: boolean;
}> {
  const { default: DashboardLayout } = await import("../app/(dashboard)/layout");
  const element = await DashboardLayout({ children: null });

  assert.ok(isValidElement(element), "the dashboard layout should render an element");

  const props = element.props as {
    initialMemberId?: unknown;
    loadEnabled?: unknown;
  };

  assert.equal(typeof props.loadEnabled, "boolean");
  assert.ok(props.initialMemberId === null || typeof props.initialMemberId === "string");

  return {
    initialMemberId: props.initialMemberId as string | null,
    loadEnabled: props.loadEnabled as boolean,
  };
}

function readyAuthSnapshot(member: { id: string } | null) {
  return {
    pageAuth: {
      authenticated: member !== null,
      authenticatedMember: member,
      session: member === null ? null : { member },
    },
    sidebarAuth: { authenticated: member !== null, label: null },
    status: "ready" as const,
  };
}

beforeEach(() => {
  vi.resetModules();
  mocks.getHostedDashboardLayoutAuthSnapshot.mockReset();
  mocks.readHostedConsentStatus.mockReset();
});

// A signed-out visitor reaches the dashboard route group without a redirect, so
// the layout is the only place that can stop the provider from posting a vault
// session request that has no member to load. Without this gate the rejected
// request surfaces "Your dashboard session expired" to someone who never
// signed in.
test("a signed-out dashboard visitor never starts a browser vault load", async () => {
  mocks.getHostedDashboardLayoutAuthSnapshot.mockResolvedValue(readyAuthSnapshot(null));

  const props = await renderLayoutProviderProps();

  assert.equal(props.loadEnabled, false);
  assert.equal(props.initialMemberId, null);
  assert.equal(mocks.readHostedConsentStatus.mock.calls.length, 0);
});

test("an authenticated member with launch consent still starts a browser vault load", async () => {
  mocks.getHostedDashboardLayoutAuthSnapshot.mockResolvedValue(
    readyAuthSnapshot({ id: "usr_dashboard_member" }),
  );
  mocks.readHostedConsentStatus.mockResolvedValue({ launchGranted: true });

  const props = await renderLayoutProviderProps();

  assert.equal(props.loadEnabled, true);
  assert.equal(props.initialMemberId, "usr_dashboard_member");
});

test("an authenticated member missing launch consent still blocks the browser vault load", async () => {
  mocks.getHostedDashboardLayoutAuthSnapshot.mockResolvedValue(
    readyAuthSnapshot({ id: "usr_dashboard_member" }),
  );
  mocks.readHostedConsentStatus.mockResolvedValue({ launchGranted: false });

  const props = await renderLayoutProviderProps();

  assert.equal(props.loadEnabled, false);
  assert.equal(props.initialMemberId, "usr_dashboard_member");
});

// An unreadable consent record must not lock an authenticated member out of
// their own dashboard data; that fallback predates this change and stays.
test("an authenticated member keeps the vault load when consent is unreadable", async () => {
  mocks.getHostedDashboardLayoutAuthSnapshot.mockResolvedValue(
    readyAuthSnapshot({ id: "usr_dashboard_member" }),
  );
  mocks.readHostedConsentStatus.mockRejectedValue(new Error("consent store unavailable"));

  const props = await renderLayoutProviderProps();

  assert.equal(props.loadEnabled, true);
  assert.equal(props.initialMemberId, "usr_dashboard_member");
});
