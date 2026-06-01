import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { BiomarkerLayoutClient } from "../app/(dashboard)/biomarkers/[biomarkerId]/biomarker-layout-client";
import { resolveHealthCommonsBiomarkerShell } from "@/src/lib/health-commons/biomarker-projections";

test("biomarker detail layout hides route tab navigation", () => {
  const biomarker = resolveHealthCommonsBiomarkerShell("resting-heart-rate");

  if (!biomarker) {
    throw new Error("Expected the resting-heart-rate biomarker shell.");
  }

  const markup = renderToStaticMarkup(
    createElement(BiomarkerLayoutClient, {
      biomarker,
    }, createElement("div", null, "overview")),
  );

  expect(markup).toContain("overview");
  expect(markup).not.toContain('aria-label="Biomarker tabs"');
  expect(markup).not.toContain('data-tab-value="overview"');
  expect(markup).not.toContain('data-tab-value="research"');
  expect(markup).not.toContain('href="/biomarkers/resting-heart-rate/research"');
});
