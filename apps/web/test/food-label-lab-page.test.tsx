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
  test("publishes the short indexable food route with a value-led empty state", () => {
    const markup = renderToStaticMarkup(createElement(FoodPage));

    expect(metadata.title).toBe("Food comparison | Murph");
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.robots).toEqual({ follow: true, index: true });
    expect(markup).toContain("Compare foods by the label and by the lab");
    expect(markup).toContain("Product, brand, or UPC");
    expect(markup).toContain("Try an example:");
    expect(markup).toContain("Greek yogurt");
    expect(markup).toContain("Works with browser agents");
    expect(markup).not.toContain("prepared-meals.svg");
    expect(markup).not.toContain("Is it Murph Safe?");
  });

  test("shows one quiet winner per row and an evidence meter instead of counts", () => {
    const markup = renderToStaticMarkup(
      createElement(FoodLabelLab, {
        initialProducts: FOOD_LABEL_DESIGN_PRODUCTS,
        webMcpEnabled: false,
      }),
    );

    expect(markup).toContain("Lowest marked");
    expect(markup).toContain("Highest marked");
    expect(markup).toContain("of 5 record parts");
    expect(markup).toContain("comparable rows");
    expect(markup).not.toContain("Top match");
    expect(markup).not.toContain("Evidence: partial");
    expect(markup).not.toContain("0 alerts");
    expect(markup).not.toContain("uppercase");
    expect(markup).not.toContain("Missing evidence is not safety evidence");
  });

  test("keeps the populated design state offline and shows package size", () => {
    const markup = renderToStaticMarkup(
      createElement(FoodLabelLab, {
        initialProducts: FOOD_LABEL_DESIGN_PRODUCTS,
        webMcpEnabled: false,
      }),
    );

    expect(markup).toContain("Chobani");
    expect(markup).toContain("Straus");
    expect(markup).toContain("Fage");
    expect(markup).toContain("32 oz");
    expect(markup).toContain("150 g serving");
    expect(markup).toContain("Per 100 g");
    expect(markup).toContain("Add another product");
    expect(markup).not.toContain("CHOBANI");
    expect(markup).not.toContain("aria-orientation");
    expect(markup.match(/aria-label="Compare per serving"/gu)).toHaveLength(1);
  });

  test("keeps the table with a single product and offers an add target", () => {
    const [first] = FOOD_LABEL_DESIGN_PRODUCTS;
    const markup = renderToStaticMarkup(
      createElement(FoodLabelLab, {
        initialProducts: first ? [first] : [],
        webMcpEnabled: false,
      }),
    );

    expect(markup).toContain('aria-label="Food comparison"');
    expect(markup).toContain("1 of 4 products");
    expect(markup).toContain("Add a product to compare");
    expect(markup).not.toContain("comparable rows");
  });
});
