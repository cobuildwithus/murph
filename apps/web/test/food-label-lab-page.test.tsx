import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/src/components/food-label-lab/food-label-webmcp", () => ({
  FoodLabelWebMcp() {
    return null;
  },
}));

import { FOOD_LABEL_DESIGN_PRODUCTS } from "@/app/design/food-label-lab-study";
import {
  buildFoodBrandSearchUrl,
  selectFoodBrandLogoUrl,
} from "@/src/components/food-label-lab/food-brand-visual";
import { FoodLabelLab } from "@/src/components/food-label-lab/food-label-lab";
import { metadata } from "../app/food/page";

beforeEach(() => {
  vi.stubEnv("BRANDFETCH_CLIENT_ID", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Food Label Lab page", () => {
  test("publishes dedicated indexable metadata and a food share card", () => {
    expect(metadata.title).toBe("Compare food labels and ingredients | Murph");
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.robots).toEqual({ follow: true, index: true });
    expect(metadata.alternates).toEqual({ canonical: "/food" });
    expect(metadata.openGraph).toMatchObject({
      images: [{ height: 630, url: "/food/opengraph-image.jpg", width: 1200 }],
      type: "website",
      url: "/food",
    });
  });

  test("builds a contextual Brandfetch search and accepts only matching CDN icons", () => {
    const searchUrl = buildFoodBrandSearchUrl(
      "Example Brand",
      "protein bars",
      "client_example",
    );
    expect(searchUrl).not.toBeNull();
    const parsed = new URL(searchUrl ?? "https://invalid.example");

    expect(parsed.origin).toBe("https://api.brandfetch.io");
    expect(parsed.pathname).toBe("/v2/search/Example%20Brand%20protein%20bars");
    expect(parsed.searchParams.get("c")).toBe("client_example");
    expect(buildFoodBrandSearchUrl("Example Brand", null, "short")).toBeNull();
    expect(buildFoodBrandSearchUrl(null, "food", "client_example")).toBeNull();

    expect(
      selectFoodBrandLogoUrl(
        [
          {
            name: "Another Brand",
            icon: "https://cdn.brandfetch.io/another/icon",
          },
          {
            name: "Example Brand Foods",
            icon: "https://cdn.brandfetch.io/example/icon",
          },
        ],
        "Example Brand",
      ),
    ).toBe("https://cdn.brandfetch.io/example/icon");
    expect(
      selectFoodBrandLogoUrl(
        [
          {
            name: "Example Brand",
            icon: "https://images.example.com/icon.png",
          },
        ],
        "Example Brand",
      ),
    ).toBeNull();
  });

  test("shows one quiet winner per row and one Murph note per product", () => {
    const markup = renderToStaticMarkup(
      createElement(FoodLabelLab, {
        initialProducts: FOOD_LABEL_DESIGN_PRODUCTS,
        webMcpEnabled: false,
      }),
    );

    expect(markup).not.toContain("Lowest marked");
    expect(markup).not.toContain("Highest marked");
    expect(markup).toContain('data-food-winner="lowest"');
    expect(markup).toContain('data-food-winner="highest"');
    expect(markup).toContain('aria-label="Murph grade');
    expect(markup).toContain("Saturated fat");
    expect(markup).toContain("Sodium");
    expect(markup).toContain("Nutrition basis");
    expect(markup).not.toContain('aria-label="100% evidence coverage"');
    expect(markup).not.toContain("comparable rows");
    expect(markup).not.toContain("Top match");
    expect(markup).not.toContain("Evidence: partial");
    expect(markup).not.toContain("0 alerts");
    expect(markup).not.toContain("uppercase");
    expect(markup).not.toContain("Missing evidence is not safety evidence");
  });

  test("shows a quiet icon when a nutrient is not on the label", () => {
    const source = FOOD_LABEL_DESIGN_PRODUCTS[0];
    if (!source) {
      throw new Error("Food Label Lab design product is missing.");
    }
    const product = structuredClone(source);
    product.nutrition.rows = product.nutrition.rows.filter(
      (row) => !row.name.toLowerCase().includes("saturated"),
    );
    const markup = renderToStaticMarkup(
      createElement(FoodLabelLab, {
        initialProducts: [product],
        webMcpEnabled: false,
      }),
    );

    expect(markup).toContain('data-food-missing-label="Not on label"');
    expect(markup).not.toContain(">Not on label<");
  });

  test("keeps a stable illustration while Brandfetch resolves", () => {
    const markup = renderToStaticMarkup(
      createElement(FoodLabelLab, {
        initialProducts: FOOD_LABEL_DESIGN_PRODUCTS,
        brandfetchClientId: "client_example",
        webMcpEnabled: false,
      }),
    );

    expect(markup).toContain('data-food-brand-visual="illustration"');
    expect(markup).toContain('data-food-product-header="brand-tint"');
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
    expect(markup).toContain("150 g");
    expect(markup).toContain("Per 100 g");
    expect(markup).not.toContain("Add product");
    expect(markup).not.toContain("150 g serving");
    expect(markup).not.toContain("CHOBANI");
    expect(markup).not.toContain("aria-orientation");
    expect(markup.match(/aria-label="Compare per serving"/gu)).toHaveLength(1);
  });

  test("keeps the table with a single product and reserves stable comparison slots", () => {
    const [first] = FOOD_LABEL_DESIGN_PRODUCTS;
    const markup = renderToStaticMarkup(
      createElement(FoodLabelLab, {
        initialProducts: first ? [first] : [],
        webMcpEnabled: false,
      }),
    );

    expect(markup).toContain('aria-label="Food comparison"');
    expect(markup).not.toContain("product selected");
    expect(markup).not.toContain("Add product");
    expect(markup.match(/<col(?:\s|>)/gu)).toHaveLength(5);
    expect(markup).not.toContain("comparable rows");
  });
});
