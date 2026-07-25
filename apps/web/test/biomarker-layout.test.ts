import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedDashboardLayoutAuthSnapshot: vi.fn(),
  hostedConsentGrantFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/biomarkers",
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedDashboardLayoutAuthSnapshot:
    mocks.getHostedDashboardLayoutAuthSnapshot,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    hostedConsentGrant: {
      findMany: mocks.hostedConsentGrantFindMany,
    },
  }),
}));

vi.mock("@/src/components/dashboard/sidebar", () => ({
  Sidebar() {
    return createElement("div", {
      "data-dashboard-sidebar": "true",
    });
  },
}));

import DashboardLayout from "../app/(dashboard)/layout";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHostedDashboardLayoutAuthSnapshot.mockResolvedValue({
    pageAuth: {
      authenticatedMember: null,
    },
    sidebarAuth: {
      authenticated: false,
      label: null,
    },
    status: "ready",
  });
  mocks.hostedConsentGrantFindMany.mockResolvedValue([]);
});

test("the dashboard layout is the single shell owner for biomarker pages", async () => {
  assert.equal(
    existsSync(new URL("../app/(dashboard)/biomarkers/layout.tsx", import.meta.url)),
    false,
  );

  const markup = renderToStaticMarkup(
    await DashboardLayout({
      children: createElement(
        "div",
        { "data-biomarker-page": "true" },
        "biomarker",
      ),
    }),
  );

  assert.doesNotMatch(markup, /site-footer/);
  assert.doesNotMatch(markup, /data-hosted-privy-boundary="true"/);
  assert.match(markup, /data-dashboard-sidebar="true"/);
  assert.match(markup, /data-biomarker-page="true"/);
  assert.match(markup, /data-slot="sidebar-wrapper"/);
  assert.match(markup, /data-slot="sidebar-inset"/);
  assert.match(markup, /<main class="flex-1 px-4 py-8 md:px-14 md:py-10">/);
  expect(mocks.getHostedDashboardLayoutAuthSnapshot).toHaveBeenCalledWith();
});

test("dashboard layout leaves access decisions to dashboard pages", async () => {
  mocks.getHostedDashboardLayoutAuthSnapshot.mockResolvedValueOnce({
    pageAuth: {
      authenticatedMember: {
        id: "member_123",
      },
    },
    sidebarAuth: {
      authenticated: true,
      label: null,
    },
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    await DashboardLayout({
      children: createElement(
        "div",
        { "data-dashboard-child": "true" },
        "dashboard child",
      ),
    }),
  );

  assert.match(markup, /data-dashboard-sidebar="true"/);
  assert.match(markup, /data-dashboard-child="true"/);
});

test("dashboard layout shows retryable neutral chrome when session auth is unavailable", async () => {
  mocks.getHostedDashboardLayoutAuthSnapshot.mockResolvedValueOnce({
    status: "unavailable",
  });

  const markup = renderToStaticMarkup(
    await DashboardLayout({
      children: createElement(
        "div",
        { "data-dashboard-child": "true" },
        "dashboard child",
      ),
    }),
  );

  assert.match(markup, /Your dashboard could not be loaded/);
  assert.match(markup, /Try again/);
  assert.doesNotMatch(markup, /data-dashboard-sidebar="true"/);
  assert.doesNotMatch(markup, /data-dashboard-child="true"/);
  assert.doesNotMatch(markup, /Log in or sign up/);
});

test("dashboard layout keeps pages usable while showing stale legal acceptance", async () => {
  mocks.getHostedDashboardLayoutAuthSnapshot.mockResolvedValueOnce({
    pageAuth: {
      authenticatedMember: { id: "member_current" },
    },
    sidebarAuth: {
      authenticated: true,
      label: null,
    },
    status: "ready",
  });
  mocks.hostedConsentGrantFindMany.mockResolvedValueOnce([
    createStoredLaunchConsentGrant("launch.legal", {
      "health-ai-safety-disclosure": "2026-04-29",
      "privacy-policy": "2026-06-24",
      "terms-of-service": "2026-04-29",
    }),
    createStoredLaunchConsentGrant("launch.health-data", {
      "consumer-health-data-notice": "2026-04-29",
    }),
  ]);

  const markup = renderToStaticMarkup(
    await DashboardLayout({
      children: createElement(
        "div",
        { "data-dashboard-child": "true" },
        "dashboard child",
      ),
    }),
  );

  assert.match(markup, /data-dashboard-legal-consent-gate="true"/);
  assert.match(markup, /Review what changed/u);
  assert.match(markup, /Current documents/u);
  assert.match(markup, /data-dashboard-child="true"/);
  expect(mocks.hostedConsentGrantFindMany).toHaveBeenCalledWith({
    orderBy: [{ scope: "asc" }],
    where: { memberId: "member_current" },
  });
});

test.each([
  {
    grants: [],
    label: "no historical launch grants",
  },
  {
    grants: [
      createStoredLaunchConsentGrant("launch.legal", {
        "health-ai-safety-disclosure": "2026-07-23",
        "privacy-policy": "2026-07-23",
        "terms-of-service": "2026-07-23",
      }),
    ],
    label: "one historical launch grant",
  },
])("dashboard layout keeps generic consent recovery visible with $label", async ({
  grants,
}) => {
  mocks.getHostedDashboardLayoutAuthSnapshot.mockResolvedValueOnce({
    pageAuth: {
      authenticatedMember: { id: "member_recovery" },
    },
    sidebarAuth: {
      authenticated: true,
      label: null,
    },
    status: "ready",
  });
  mocks.hostedConsentGrantFindMany.mockResolvedValueOnce(grants);

  const markup = renderToStaticMarkup(
    await DashboardLayout({
      children: createElement(
        "div",
        { "data-dashboard-child": "true" },
        "dashboard child",
      ),
    }),
  );

  assert.match(markup, /data-dashboard-legal-consent-gate="true"/);
  assert.match(markup, /Finish your consent/u);
  assert.match(markup, /Required documents/u);
  assert.doesNotMatch(markup, /Review what changed/u);
  assert.match(markup, /data-dashboard-child="true"/);
});

test("dashboard layout keeps pages usable when the consent reminder cannot load", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.getHostedDashboardLayoutAuthSnapshot.mockResolvedValueOnce({
    pageAuth: {
      authenticatedMember: { id: "member_current" },
    },
    sidebarAuth: {
      authenticated: true,
      label: null,
    },
    status: "ready",
  });
  mocks.hostedConsentGrantFindMany.mockRejectedValueOnce(
    new Error("consent store unavailable"),
  );

  const markup = renderToStaticMarkup(
    await DashboardLayout({
      children: createElement(
        "div",
        { "data-dashboard-child": "true" },
        "dashboard child",
      ),
    }),
  );

  assert.match(markup, /data-dashboard-child="true"/);
  assert.doesNotMatch(markup, /data-dashboard-legal-consent-gate="true"/);
  expect(warn).toHaveBeenCalledWith(
    "Dashboard legal consent reminder is temporarily unavailable.",
  );
  warn.mockRestore();
});

function createStoredLaunchConsentGrant(
  scope: "launch.health-data" | "launch.legal",
  documentVersionsJson: Record<string, string>,
) {
  const recordedAt = new Date("2026-04-29T00:00:00.000Z");

  return {
    createdAt: recordedAt,
    documentVersionsJson,
    grantedAt: recordedAt,
    id: `hbcg_${scope.replace(".", "_")}`,
    lastEventId: `hbce_${scope.replace(".", "_")}`,
    memberId: "member_current",
    revokedAt: null,
    scope,
    source: "hosted onboarding",
    status: "granted",
    updatedAt: recordedAt,
  };
}
