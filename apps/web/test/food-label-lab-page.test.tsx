import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/src/components/food-label-lab/food-label-webmcp", () => ({
  FoodLabelWebMcp() {
    return null;
  },
}));

import { FOOD_LABEL_DESIGN_PRODUCTS } from "@/app/design/food-label-lab-study";
import { FoodLabelLab } from "@/src/components/food-label-lab/food-label-lab";
import FoodPage, { metadata } from "../app/food/page";

describe("Food Label Lab page", () => {
  test("publishes the short indexable food route", () => {
    const markup = renderToStaticMarkup(createElement(FoodPage));

    expect(metadata.title).toBe("Food comparison | Murph");
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.robots).toEqual({ follow: true, index: true });
    expect(markup).toContain("Compare plain Greek yogurts");
    expect(markup).toContain("Choose foods to compare");
    expect(markup).not.toContain("Is it Murph Safe?");
  });

  test("shows conclusions before raw evidence in the populated study", () => {
    const markup = renderToStaticMarkup(
      createElement(FoodLabelLab, {
        initialProducts: FOOD_LABEL_DESIGN_PRODUCTS,
        webMcpEnabled: false,
      }),
    );

    expect(markup).toContain("Top match · 3 of 4");
    expect(markup).toContain("Highest");
    expect(markup).toContain("Lowest");
    expect(markup).toContain("Evidence: partial");
    expect(markup).toContain("0 alerts");
    expect(markup).not.toContain("Details");
    expect(markup).not.toContain("Missing evidence is not safety evidence");
  });

  test("keeps the populated design state offline", () => {
    const markup = renderToStaticMarkup(
      createElement(FoodLabelLab, {
        initialProducts: FOOD_LABEL_DESIGN_PRODUCTS,
        webMcpEnabled: false,
      }),
    );

    expect(markup).toContain("Chobani");
    expect(markup).toContain("Straus");
    expect(markup).toContain("Fage");
    expect(markup).toContain("Per 100 g");
  });
});
