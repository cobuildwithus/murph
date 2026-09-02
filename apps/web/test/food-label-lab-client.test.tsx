import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { PublicProductDetail } from "@murphai/contracts";
import { PUBLIC_PRODUCTS_SCHEMA_VERSION } from "@murphai/contracts";

import { FOOD_LABEL_DESIGN_PRODUCTS } from "@/app/design/food-label-lab-study";
import {
  FOOD_EXAMPLES,
  FoodLabelLab,
} from "@/src/components/food-label-lab/food-label-lab";

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

vi.mock("@/src/components/ui/input", () => ({
  Input({ inputSize, onChange, ...props }: ComponentProps<"input"> & {
    inputSize?: string;
  }) {
    void inputSize;
    return createElement("input", { ...props, onInput: onChange });
  },
}));

vi.mock("@/src/components/ui/scroll-area", () => ({
  ScrollArea: (input: { children?: ReactNode }) =>
    createElement("div", null, input.children),
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
  test("an example loads exact product details and keeps a partial example usable", async () => {
    const [first, second] = FOOD_LABEL_DESIGN_PRODUCTS;
    const example = FOOD_EXAMPLES[0];
    if (!first || !second || !example) {
      throw new Error("Food Label Lab design products are missing.");
    }
    fetchMock.mockImplementation(async (resource) => {
      const url = String(resource);
      if (url.endsWith(encodeURIComponent(example.productRefs[0]))) {
        return detailResponse(first);
      }
      if (url.endsWith(encodeURIComponent(example.productRefs[1]))) {
        return detailResponse(second);
      }
      return new Response("missing", { status: 404 });
    });

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    await click(findButton(rendered.container, example.label));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toMatch(/^\/api\/public\/v1\/products\/food_/u);
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
      expect(init?.cache).toBe("no-store");
    }
    expect(rendered.replaceState).not.toHaveBeenCalled();

    const text = rendered.container.textContent ?? "";
    expect(rendered.container.querySelector('section[aria-label="Food comparison"]')).not.toBeNull();
    expect(text).toContain("2 of 4 products");
    expect(text).toContain("Chobani");
    expect(text).toContain("Straus");
    expect(text).toContain("Add another product");
    expect(text).toContain("Lowest marked");
    expect(text).toContain("leads 3 of 4 comparable rows");
    expect(text).not.toContain("Top match");
    expect(text).not.toContain("observations");
    expect(text).not.toContain("Evidence: partial");
  });

  test("typing shows deduplicated suggestions and a pick starts the comparison with one product", async () => {
    const [first, second] = FOOD_LABEL_DESIGN_PRODUCTS;
    if (!first || !second) {
      throw new Error("Food Label Lab design products are missing.");
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
        results: {
          supplements: [],
          foods: [
            searchHit(first),
            { ...searchHit(second), productRef: "food_design_duplicate", upc: first.upc },
            searchHit(second),
          ],
        },
      }))
      .mockResolvedValueOnce(detailResponse(first))
      .mockResolvedValueOnce(jsonResponse({
        schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
        results: { supplements: [], foods: [searchHit(second)] },
      }));

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    const input = rendered.container.querySelector<HTMLInputElement>("#food-comparison-search");
    if (!input) {
      throw new Error("Search input did not render.");
    }
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.placeholder).toContain("UPC");

    await act(async () => {
      input.value = "chobani";
      input.dispatchEvent(new rendered.window.Event("input", { bubbles: true }));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [searchUrl, searchInit] = fetchMock.mock.calls[0] ?? [];
    expect(searchUrl).toBe("/api/public/v1/products/search");
    expect(searchInit?.method).toBe("POST");
    expect(searchInit?.credentials).toBe("omit");
    expect(JSON.parse(String(searchInit?.body))).toEqual({
      query: "chobani",
      kinds: ["food"],
      limitPerKind: 6,
    });

    const options = findProductButtons(rendered.container);
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.getAttribute("role"))).toEqual(["option", "option"]);
    expect(options[0]?.textContent).toContain("Chobani");
    expect(options[0]?.textContent).toContain("Plain Nonfat Greek Yogurt");
    expect(options[0]?.textContent).toContain("57 linked tests");
    expect(options[1]?.textContent).toContain("32 oz");
    expect(rendered.container.textContent).not.toContain("GREEK YOGURT");
    expect(rendered.container.textContent).not.toContain("0 observations");

    await click(options[0]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const text = rendered.container.textContent ?? "";
    expect(rendered.container.querySelector('section[aria-label="Food comparison"]')).not.toBeNull();
    expect(text).toContain("1 of 4 products");
    expect(text).toContain("Add a product to compare");
    expect(text).toContain("Similar by name");
    expect(input.value).toBe("");
    expect(findProductButtons(rendered.container).map((button) => button.dataset.foodProductRef))
      .toEqual([second.productRef]);
  });

  test("shows a short rate-limit recovery state", async () => {
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    await click(findButton(rendered.container, FOOD_EXAMPLES[0]?.label ?? ""));

    expect(rendered.container.textContent).toContain(
      "Too many searches. Wait a minute and try again.",
    );
  });

  test("the evidence meter opens one combined drawer with honest statuses", async () => {
    const product = makeEvidenceProduct();
    const [, straus, fage] = FOOD_LABEL_DESIGN_PRODUCTS;
    if (!straus || !fage) {
      throw new Error("Food Label Lab design products are missing.");
    }
    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, {
        initialProducts: [product, straus, fage],
        webMcpEnabled: false,
      }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    const tableText = rendered.container.querySelector('section[aria-label="Food comparison"]')?.textContent ?? "";
    expect(tableText).toContain("1 above a screening limit");
    expect(tableText).not.toContain("No observations");
    expect(tableText).not.toContain("gaps");

    const meters = [...rendered.container.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => /of 5 record parts/u.test(button.textContent ?? ""));
    expect(meters).toHaveLength(3);
    await click(meters[0]);

    const text = document.body.textContent ?? rendered.container.textContent ?? "";
    expect(text).toContain("of 5 record parts");
    expect(text).toContain("1 above a screening limit");
    expect(text).toContain("1 within a comparable limit");
    expect(text).toContain("6 measured, no comparable limit");
    expect(text).toContain("known gaps");
    expect(text).toContain("Show 8 returned results");
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
    expect(text).toContain("Screening limits are references, not safety verdicts.");
    expect(text).not.toContain("Below threshold");

    await click(meters[2]);
    const fageText = document.body.textContent ?? "";
    expect(fageText).toContain("1 result shown");
    expect(fageText).toContain("1 above a screening limit");
    expect(fageText).not.toContain("no comparable limit");
  });

  test("an untested product reads as not tested, never as safe", async () => {
    const [first, second] = FOOD_LABEL_DESIGN_PRODUCTS;
    if (!first || !second) {
      throw new Error("Food Label Lab design products are missing.");
    }
    const untested = structuredClone(first);
    untested.productRef = "food_design_untested";
    untested.productTests = {
      status: "no_known_product_tests",
      total: 0,
      returned: 0,
      truncated: false,
      observations: [],
      alerts: [],
    };
    untested.unknowns = [
      { code: "NO_LINKED_PRODUCT_TESTS", title: "No linked product tests", description: "Synthetic gap." },
    ];
    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, {
        initialProducts: [untested, second],
        webMcpEnabled: false,
      }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    const meter = [...rendered.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => /of 5 record parts/u.test(button.textContent ?? ""));
    expect(meter?.textContent).toContain("3 of 5 record parts");
    await click(meter);

    const text = document.body.textContent ?? "";
    expect(text).toContain("Not tested");
    expect(text).toContain("No product-level test is linked to this exact record.");
    expect(text).toContain("No other known gaps");
    expect(text).not.toContain("within a comparable limit");
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
  product.productTests.alerts = [{
    analyte: normalized.analyte,
    concernLevel: "medium",
    result: normalized.result,
    threshold: normalized.screening.threshold,
    source: normalized.source,
    testedProduct: normalized.testedProduct,
  }];
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
