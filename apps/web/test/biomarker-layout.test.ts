import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedDashboardLayoutAuthSnapshot: vi.fn(),
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
