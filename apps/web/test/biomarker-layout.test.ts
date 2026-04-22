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
    createElement(BiomarkersLayout, {
      children: createElement("div", { "data-biomarker-page": "true" }, "biomarker"),
    }),
  );

  assert.match(markup, /#global-footer \{ display: none; \}/);
  assert.match(markup, /data-dashboard-sidebar="true"/);
  assert.match(markup, /data-biomarker-page="true"/);
  assert.match(markup, /class="flex min-h-screen flex-col md:flex-row"/);
  assert.match(markup, /<main class="flex-1 overflow-y-auto bg-background">/);
});
