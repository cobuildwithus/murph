import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { BiomarkerBrowseCard } from "../src/components/biomarkers/biomarker-browse-card";

it("renders a compact latest private value when available", () => {
  const markup = renderToStaticMarkup(
    createElement(BiomarkerBrowseCard, {
      category: "heart-health",
      privateValue: {
        dateLabel: "29 Apr",
        sourceLabel: "Wearable summary",
        stale: false,
        unit: "bpm",
        valueLabel: "57",
      },
      routeId: "resting-heart-rate",
      summary: "A lower resting heart rate can reflect improved recovery.",
      title: "Resting Heart Rate",
      unit: "bpm",
    }),
  );

  expect(markup).toContain("Your latest");
  expect(markup).toContain("57 bpm");
  expect(markup).toContain("Wearable summary - 29 Apr");
  expect(markup).not.toContain("stale");
});
