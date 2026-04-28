import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("@/src/components/dashboard/sidebar", () => ({
  Sidebar() {
    return createElement("div", {
      "data-dashboard-sidebar": "true",
    });
  },
}));

import BiomarkersLayout from "../app/biomarkers/layout";

test("BiomarkersLayout renders biomarker pages inside the shared dashboard shell", () => {
  const markup = renderToStaticMarkup(
    createElement(
      BiomarkersLayout,
      null,
      createElement("div", { "data-biomarker-page": "true" }, "biomarker"),
    ),
  );

  assert.match(markup, /#global-footer \{ display: none; \}/);
  assert.match(markup, /data-dashboard-sidebar="true"/);
  assert.match(markup, /data-biomarker-page="true"/);
  assert.match(markup, /data-slot="sidebar-wrapper"/);
  assert.match(markup, /data-slot="sidebar-inset"/);
  assert.match(markup, /<main class="flex-1">/);
});
