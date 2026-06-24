import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedSidebarAuthSnapshot: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedSidebarAuthSnapshot: mocks.getHostedSidebarAuthSnapshot,
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
  mocks.getHostedSidebarAuthSnapshot.mockResolvedValue({
    authenticated: false,
    label: null,
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
  expect(mocks.getHostedSidebarAuthSnapshot).toHaveBeenCalledWith();
});
