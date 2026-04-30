import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedSidebarAuthSnapshot: async () => ({
    authenticated: false,
    label: null,
  }),
}));

vi.mock("@/src/components/dashboard/sidebar", () => ({
  Sidebar() {
    return createElement("div", {
      "data-dashboard-sidebar": "true",
    });
  },
}));

import BiomarkersLayout from "../app/biomarkers/layout";

test("BiomarkersLayout renders biomarker pages inside the shared dashboard shell", async () => {
  const markup = renderToStaticMarkup(
    await BiomarkersLayout({
      children: createElement(
        "div",
        { "data-biomarker-page": "true" },
        "biomarker",
      ),
    }),
  );

  assert.match(markup, /#global-footer \{ display: none; \}/);
  assert.match(markup, /data-dashboard-sidebar="true"/);
  assert.match(markup, /data-biomarker-page="true"/);
  assert.match(markup, /data-slot="sidebar-wrapper"/);
  assert.match(markup, /data-slot="sidebar-inset"/);
  assert.match(markup, /<main class="flex-1 px-6 py-8 md:px-14 md:py-10">/);
});
