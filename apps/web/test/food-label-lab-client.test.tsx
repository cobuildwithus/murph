import { act, createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { PublicProductDetail } from "@murphai/contracts";
import { PUBLIC_PRODUCTS_SCHEMA_VERSION } from "@murphai/contracts";

import { FOOD_LABEL_DESIGN_PRODUCTS } from "@/app/design/food-label-lab-study";
import { FoodLabelLab } from "@/src/components/food-label-lab/food-label-lab";

import { renderClientComponent } from "./render-client-component";

vi.mock("next/image", () => ({
  default: (props: {
    alt?: string;
    className?: string;
    height?: number;
    src: string;
    width?: number;
  }) => createElement("img", props),
}));

vi.mock("@/src/components/ui/sheet", () => ({
  Sheet: (input: { children?: ReactNode; open?: boolean }) =>
    input.open ? createElement("div", null, input.children) : null,
  SheetContent: (input: { children?: ReactNode }) =>
    createElement("aside", null, input.children),
  SheetDescription: (input: { children?: ReactNode }) =>
    createElement("p", null, input.children),
  SheetFooter: (input: { children?: ReactNode }) =>
    createElement("footer", null, input.children),
  SheetHeader: (input: { children?: ReactNode }) =>
    createElement("header", null, input.children),
  SheetTitle: (input: { children?: ReactNode }) =>
    createElement("h2", null, input.children),
}));

const fetchMock = vi.fn<typeof fetch>();
let cleanup: (() => Promise<void>) | null = null;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
  vi.unstubAllGlobals();
});

describe("FoodLabelLab", () => {
  test("keeps the query in a private POST and builds the visible comparison", async () => {
    const [first, second] = FOOD_LABEL_DESIGN_PRODUCTS;
    if (!first || !second) {
      throw new Error("Food Label Lab design products are missing.");
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
        results: {
          supplements: [],
          foods: [searchHit(first), searchHit(second)],
        },
      }))
      .mockResolvedValueOnce(detailResponse(first))
      .mockResolvedValueOnce(detailResponse(second));

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    await click(findButton(rendered.container, "plain Greek yogurt"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [searchUrl, searchInit] = fetchMock.mock.calls[0] ?? [];
    expect(searchUrl).toBe("/api/public/v1/products/search");
    expect(searchInit?.method).toBe("POST");
    expect(searchInit?.credentials).toBe("omit");
    expect(searchInit?.referrerPolicy).toBe("no-referrer");
    expect(searchInit?.cache).toBe("no-store");
    expect(JSON.parse(String(searchInit?.body))).toEqual({
      query: "plain Greek yogurt",
      kinds: ["food"],
      limitPerKind: 6,
    });
    expect(rendered.replaceState).not.toHaveBeenCalled();

    const addButtons = findProductButtons(rendered.container);
    expect(addButtons).toHaveLength(2);

    await click(addButtons[0]);
    await click(findProductButtons(rendered.container).find(
      (button) => !button.disabled,
    ));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(rendered.container.textContent).toContain("Top match · 3 of 4");
    expect(rendered.container.textContent).toContain("Evidence: partial");
    expect(rendered.container.textContent).toContain("No alerts shown");
    expect(rendered.container.textContent).toContain("4 of 57 observations");
    expect(rendered.container.querySelector('section[aria-label="Food comparison"]'))
      .not.toBeNull();
  });

  test("shows a short rate-limit recovery state", async () => {
    fetchMock.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    await click(findButton(rendered.container, "plain Greek yogurt"));

    expect(rendered.container.textContent).toContain(
      "Too many searches. Wait a minute and try again.",
    );
  });

  test("keeps exact test semantics in the compact evidence sheet", async () => {
    const product = makeEvidenceProduct();
    const secondProduct = FOOD_LABEL_DESIGN_PRODUCTS[1];
    if (!secondProduct) {
      throw new Error("Second Food Label Lab design product is missing.");
    }
    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, {
        initialProducts: [product, secondProduct],
        webMcpEnabled: false,
      }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    await click(findButton(rendered.container, "0 alerts"));

    const text = document.body.textContent ?? rendered.container.textContent ?? "";
    expect(text).toContain("0.00001 ppm");
    expect(text).toContain("From 0.1 ppm (upper bound not reported)");
    expect(text).toContain("Up to 0.2 ppm (lower bound not reported)");
    expect(text).toContain("Not detected (reported in ppb)");
    expect(text).toContain("Detected (reported in ng/g)");
    expect(text).toContain("Trace (reported in mcg/kg)");
    expect(text).toContain("Normalized: 0.012 ppm · per unit of product mass");
    expect(text).toContain("Above this screening threshold");
    expect(text).toContain("Did not exceed this screening threshold");
    expect(text).toContain("No comparable screening threshold");
    expect(text).toContain("Screening references are not product safety determinations.");
    expect(text).not.toContain("Below threshold");
    expect(text).not.toContain("Shown observations cover exact samples");
  });

});

function makeEvidenceProduct(): PublicProductDetail {
  const sourceProduct = FOOD_LABEL_DESIGN_PRODUCTS[0];
  if (!sourceProduct) {
    throw new Error("Food Label Lab design product is missing.");
  }
  const product = structuredClone(sourceProduct);
  const sourceObservation = product.productTests.observations[0];
  if (!sourceObservation) {
    throw new Error("Food Label Lab design observation is missing.");
  }

  function observation(
    id: string,
  ): PublicProductDetail["productTests"]["observations"][number] {
    const value = structuredClone(sourceObservation);
    value.id = id;
    delete value.sample;
    return value;
  }

  const precise = observation("precise");
  precise.result = { basis: "product_mass", operator: "eq", unit: "ppm", value: 0.00001 };
  precise.normalizedResult = null;
  precise.screening = null;

  const lowerRange = observation("lower-range");
  lowerRange.result = { basis: "product_mass", operator: "range", unit: "ppm", value: 0.1 };
  lowerRange.normalizedResult = null;
  lowerRange.screening = null;

  const upperRange = observation("upper-range");
  upperRange.result = {
    basis: "product_mass",
    operator: "range",
    unit: "ppm",
    upperValue: 0.2,
    value: null,
  };
  upperRange.normalizedResult = null;
  upperRange.screening = null;

  const notDetected = observation("not-detected");
  notDetected.result = { basis: "product_mass", operator: "not_detected", unit: "ppb", value: null };
  notDetected.normalizedResult = null;
  notDetected.screening = null;

  const detected = observation("detected");
  detected.result = { basis: "product_mass", operator: "detected", unit: "ng/g", value: null };
  detected.normalizedResult = null;
  detected.screening = null;

  const trace = observation("trace");
  trace.result = { basis: "product_mass", operator: "trace", unit: "mcg/kg", value: null };
  trace.normalizedResult = null;
  trace.screening = null;

  const normalized = observation("normalized");
  normalized.result = { basis: "product_mass", operator: "eq", unit: "ng/g", value: 12 };
  normalized.normalizedResult = { basis: "product_mass", unit: "ppm", value: 0.012 };
  normalized.screening = {
    comparison: "exceeds",
    threshold: {
      authority: "Synthetic authority",
      basis: "product_mass",
      name: "Synthetic screening threshold",
      unit: "ppm",
      url: null,
      value: 0.01,
    },
  };

  const equality = observation("equality");
  equality.result = { basis: "product_mass", operator: "eq", unit: "ppm", value: 0.01 };
  equality.normalizedResult = { basis: "product_mass", unit: "ppm", value: 0.01 };
  equality.screening = {
    comparison: "does_not_exceed",
    threshold: {
      authority: "Synthetic authority",
      basis: "product_mass",
      name: "Synthetic screening threshold",
      unit: "ppm",
      url: null,
      value: 0.01,
    },
  };

  product.productTests.observations = [
    precise,
    lowerRange,
    upperRange,
    notDetected,
    detected,
    trace,
    normalized,
    equality,
  ];
  product.productTests.returned = product.productTests.observations.length;
  product.productTests.total = product.productTests.observations.length;
  product.productTests.truncated = false;
  return product;
}

function searchHit(product: (typeof FOOD_LABEL_DESIGN_PRODUCTS)[number]) {
  return {
    productRef: product.productRef,
    kind: "food" as const,
    name: product.name,
    brand: product.brand,
    upc: product.upc,
    source: { key: product.source.key, name: product.source.name },
    productTests: {
      status: product.productTests.status,
      total: product.productTests.total,
    },
  };
}

function detailResponse(product: (typeof FOOD_LABEL_DESIGN_PRODUCTS)[number]) {
  return jsonResponse({
    schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
    product,
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function findProductButtons(container: HTMLElement): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      "button[data-food-product-ref]",
    ),
  ];
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

async function click(button: HTMLButtonElement | undefined) {
  if (!button) {
    throw new Error("Expected button did not render.");
  }
  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}
