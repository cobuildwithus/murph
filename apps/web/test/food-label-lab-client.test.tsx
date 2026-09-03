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
  default: ({
    unoptimized,
    ...props
  }: ComponentProps<"img"> & {
    unoptimized?: boolean;
  }) => {
    void unoptimized;
    return createElement("img", props);
  },
}));

vi.mock("@/src/components/ui/input", () => ({
  Input({
    inputSize,
    onChange,
    ...props
  }: ComponentProps<"input"> & {
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
  test("an example selects its category's popular search results", async () => {
    const [first, second] = FOOD_LABEL_DESIGN_PRODUCTS;
    const example = FOOD_EXAMPLES[0];
    if (!first || !second || !example) {
      throw new Error("Food Label Lab design products are missing.");
    }
    fetchMock.mockImplementation(async (resource) => {
      const url = String(resource);
      if (url === "/api/public/v1/products/search") {
        return jsonResponse({
          schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
          results: {
            supplements: [],
            foods: [searchHit(first), searchHit(second)],
          },
        });
      }
      if (url.endsWith(encodeURIComponent(first.productRef))) {
        return detailResponse(first);
      }
      if (url.endsWith(encodeURIComponent(second.productRef))) {
        return detailResponse(second);
      }
      return new Response("missing", { status: 404 });
    });

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    expect(
      rendered.container
        .querySelector("section[data-compact]")
        ?.getAttribute("data-compact"),
    ).toBe("false");
    expect(rendered.container.textContent).toContain(
      "Compare 2M+ foods, see what’s inside",
    );
    await click(findButton(rendered.container, example.label));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "/api/public/v1/products/search",
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      foodSearchOrder: "popular",
      limitPerKind: 30,
      query: example.label,
    });
    for (const [url, init] of fetchMock.mock.calls.slice(1)) {
      expect(String(url)).toMatch(/^\/api\/public\/v1\/products\/food_/u);
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
      expect(init?.cache).toBe("no-store");
    }
    expect(rendered.replaceState).toHaveBeenCalledTimes(1);
    const sharedUrl = new URL(String(rendered.replaceState.mock.calls[0]?.[2]));
    expect(sharedUrl.pathname).toBe("/food");
    expect(sharedUrl.searchParams.get("compare")).toBe(
      [first.productRef, second.productRef].join(","),
    );
    const text = rendered.container.textContent ?? "";
    expect(
      rendered.container.querySelector('section[aria-label="Food comparison"]'),
    ).not.toBeNull();
    expect(
      rendered.container
        .querySelector("section[data-compact]")
        ?.getAttribute("data-compact"),
    ).toBe("true");
    expect(text).not.toContain("products selected");
    expect(text).toContain("Chobani");
    expect(text).toContain("Straus");
    expect(text).not.toContain("Add product");
    expect(text).not.toContain("Lowest marked");
    expect(
      rendered.container.querySelector('[data-food-winner="lowest"]'),
    ).not.toBeNull();
    expect(text).not.toContain("comparable rows");
    expect(text).not.toContain("Top match");
    expect(text).not.toContain("observations");
    expect(text).not.toContain("Evidence: partial");
    expect(text).not.toContain("Calories detail");
    expect(
      rendered.container.querySelector<HTMLInputElement>(
        "#food-comparison-search",
      )?.value,
    ).toBe(example.label);

    const metricButton = rendered.container.querySelector<HTMLButtonElement>(
      'section[aria-label="Food comparison"] tbody td button:not([aria-label^="Evidence"])',
    );
    await click(metricButton ?? undefined);
    expect(rendered.container.querySelector("aside")).not.toBeNull();
    expect(
      rendered.container.querySelector('section[aria-label="Product details"]'),
    ).not.toBeNull();
    expect(
      rendered.container.querySelector(
        'button[aria-label="Show evidence coverage, known gaps, and record source"]',
      ),
    ).not.toBeNull();

    await click(findButton(rendered.container, "Clear"));
    expect(
      rendered.container.querySelector('section[aria-label="Food comparison"]'),
    ).toBeNull();
    expect(rendered.container.textContent).toContain("Greek yogurt");
    expect(
      rendered.container
        .querySelector("section[data-compact]")
        ?.getAttribute("data-compact"),
    ).toBe("false");
    expect(
      rendered.container.querySelector<HTMLInputElement>(
        "#food-comparison-search",
      )?.value,
    ).toBe("");
  });

  test("typing shows deduplicated suggestions and a pick starts the comparison with one product", async () => {
    const [first, second] = FOOD_LABEL_DESIGN_PRODUCTS;
    if (!first || !second) {
      throw new Error("Food Label Lab design products are missing.");
    }
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
          results: {
            supplements: [],
            foods: [
              searchHit(first),
              {
                ...searchHit(second),
                productRef: "food_design_duplicate",
                upc: first.upc,
              },
              searchHit(second),
            ],
          },
        }),
      )
      .mockResolvedValueOnce(detailResponse(first))
      .mockResolvedValueOnce(
        jsonResponse({
          schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
          results: { supplements: [], foods: [searchHit(second)] },
        }),
      );

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    const input = rendered.container.querySelector<HTMLInputElement>(
      "#food-comparison-search",
    );
    if (!input) {
      throw new Error("Search input did not render.");
    }
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.placeholder).toBe("Product, category, or UPC");

    await act(async () => {
      input.value = "chobani";
      input.dispatchEvent(
        new rendered.window.Event("input", { bubbles: true }),
      );
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
      foodComparisonReadyOnly: true,
      query: "chobani",
      kinds: ["food"],
      limitPerKind: 25,
      offsetPerKind: 0,
    });

    const options = findProductButtons(rendered.container);
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.getAttribute("role"))).toEqual([
      "option",
      "option",
    ]);
    expect(options[0]?.textContent).toContain("Chobani");
    expect(options[0]?.textContent).toContain("Plain Nonfat Greek Yogurt");
    expect(options[0]?.textContent).toContain("57 linked tests");
    expect(options[1]?.textContent).toContain("32 oz");
    expect(
      rendered.container.querySelector("[data-food-category-option]")
        ?.textContent,
    ).toContain("Compare “chobani” products");
    expect(rendered.container.textContent).not.toContain("UPC 818290012108");
    expect(rendered.container.textContent).not.toContain("GREEK YOGURT");
    expect(rendered.container.textContent).not.toContain("0 observations");

    await click(options[0]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const text = rendered.container.textContent ?? "";
    expect(
      rendered.container.querySelector('section[aria-label="Food comparison"]'),
    ).not.toBeNull();
    expect(text).not.toContain("product selected");
    expect(text).not.toContain("Add product");
    expect(text).not.toContain("Add more chobani to compare");
    expect(text).toContain("Add more greek yogurt to compare");
    expect(input.value).toBe("chobani");
    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)),
    ).toMatchObject({
      foodSearchOrder: "popular",
      query: "greek yogurt",
    });
    expect(
      findProductButtons(rendered.container).map(
        (button) => button.dataset.foodProductRef,
      ),
    ).toEqual([second.productRef]);
  });

  test("the category option compares the first four usable products without a nested result scroll", async () => {
    const [first, second, third] = FOOD_LABEL_DESIGN_PRODUCTS;
    if (!first || !second || !third) {
      throw new Error("Food Label Lab design products are missing.");
    }
    const fourth = structuredClone(first);
    fourth.productRef = "food_design_fourth";
    fourth.name = "Honey Greek Yogurt";
    fourth.brand = "Fourth Brand";
    fourth.upc = "000000000004";
    const products = [first, second, third, fourth];

    fetchMock.mockImplementation(async (resource) => {
      const url = String(resource);
      if (url === "/api/public/v1/products/search") {
        return jsonResponse({
          schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
          results: { supplements: [], foods: products.map(searchHit) },
        });
      }
      const productRef = decodeURIComponent(url.split("/").at(-1) ?? "");
      const product = products.find(
        (candidate) => candidate.productRef === productRef,
      );
      return product
        ? detailResponse(product)
        : new Response("missing", { status: 404 });
    });

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    const input = rendered.container.querySelector<HTMLInputElement>(
      "#food-comparison-search",
    );
    if (!input) {
      throw new Error("Search input did not render.");
    }

    await act(async () => {
      input.value = "greek yogurt";
      input.dispatchEvent(
        new rendered.window.Event("input", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    const categoryOption = rendered.container.querySelector<HTMLButtonElement>(
      "[data-food-category-option]",
    );
    expect(categoryOption?.textContent).toContain(
      "Compare “greek yogurt” products",
    );
    await click(categoryOption ?? undefined);

    const text = rendered.container.textContent ?? "";
    expect(text).not.toContain("products selected");
    expect(input.value).toBe("greek yogurt");
    const relatedList = rendered.container.querySelector<HTMLElement>(
      "[data-food-related-products]",
    );
    expect(relatedList).toBeNull();
    expect(
      rendered.container.querySelectorAll("[data-food-product-header]"),
    ).toHaveLength(4);
  });

  test("submitting an autocomplete query runs one category search", async () => {
    const [first, second] = FOOD_LABEL_DESIGN_PRODUCTS;
    if (!first || !second) {
      throw new Error("Food Label Lab design products are missing.");
    }
    const products = [first, second];
    fetchMock.mockImplementation(async (resource) => {
      const url = String(resource);
      if (url === "/api/public/v1/products/search") {
        return jsonResponse({
          schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
          results: { supplements: [], foods: products.map(searchHit) },
        });
      }
      const productRef = decodeURIComponent(url.split("/").at(-1) ?? "");
      const product = products.find(
        (candidate) => candidate.productRef === productRef,
      );
      return product
        ? detailResponse(product)
        : new Response("missing", { status: 404 });
    });

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    const input = rendered.container.querySelector<HTMLInputElement>(
      "#food-comparison-search",
    );
    const form = rendered.container.querySelector<HTMLFormElement>(
      'form[role="search"]',
    );
    if (!input || !form) {
      throw new Error("Food search did not render.");
    }

    await act(async () => {
      input.value = "greek yogurt";
      input.dispatchEvent(
        new rendered.window.Event("input", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await act(async () => {
      form.dispatchEvent(
        new rendered.window.Event("submit", {
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const searchRequests = fetchMock.mock.calls.filter(
      ([resource]) => String(resource) === "/api/public/v1/products/search",
    );
    expect(searchRequests).toHaveLength(2);
    expect(JSON.parse(String(searchRequests[0]?.[1]?.body))).not.toHaveProperty(
      "foodSearchOrder",
    );
    expect(JSON.parse(String(searchRequests[1]?.[1]?.body))).toMatchObject({
      foodSearchOrder: "popular",
      query: "greek yogurt",
    });
    expect(
      rendered.container.querySelectorAll("[data-food-product-header]"),
    ).toHaveLength(2);
  });

  test("related products load in complete four-row desktop batches", async () => {
    const source = FOOD_LABEL_DESIGN_PRODUCTS[0];
    if (!source) {
      throw new Error("Food Label Lab design product is missing.");
    }
    const products = Array.from({ length: 34 }, (_, index) => {
      const product = structuredClone(source);
      product.productRef = `food_page_${index + 1}`;
      product.name = `Protein bar ${index + 1}`;
      product.brand = `Brand ${index + 1}`;
      product.upc = String(index + 1).padStart(12, "0");
      return product;
    });
    fetchMock.mockImplementation(async (resource, init) => {
      const url = String(resource);
      if (url === "/api/public/v1/products/search") {
        const body = JSON.parse(String(init?.body)) as {
          limitPerKind: number;
          offsetPerKind: number;
        };
        const page = products.slice(
          body.offsetPerKind,
          body.offsetPerKind + body.limitPerKind,
        );
        return jsonResponse({
          schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
          results: { supplements: [], foods: page.map(searchHit) },
        });
      }
      const productRef = decodeURIComponent(url.split("/").at(-1) ?? "");
      const product = products.find(
        (candidate) => candidate.productRef === productRef,
      );
      return product
        ? detailResponse(product)
        : new Response("missing", { status: 404 });
    });

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    Object.defineProperty(rendered.window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    const input = rendered.container.querySelector<HTMLInputElement>(
      "#food-comparison-search",
    );
    if (!input) {
      throw new Error("Search input did not render.");
    }

    await act(async () => {
      input.value = "protein bars";
      input.dispatchEvent(
        new rendered.window.Event("input", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    const searchSection = input.closest<HTMLElement>(
      "section[data-suggestions-open]",
    );
    expect(searchSection?.dataset.suggestionsOpen).toBe("true");
    expect(searchSection?.className).toContain(
      "data-[suggestions-open=true]:z-30",
    );
    await click(
      rendered.container.querySelector<HTMLButtonElement>(
        "[data-food-category-option]",
      ) ?? undefined,
    );

    const relatedList = rendered.container.querySelector<HTMLElement>(
      "[data-food-related-products]",
    );
    const desktopVisibleCount = () =>
      [...(relatedList?.children ?? [])].filter(
        (item) =>
          !item.classList.contains("hidden") ||
          item.classList.contains("sm:block") ||
          item.classList.contains("lg:block"),
      ).length;
    expect(relatedList).not.toBeNull();
    expect(relatedList?.className).not.toContain("overflow-y-auto");
    expect(relatedList?.children).toHaveLength(26);
    expect(desktopVisibleCount()).toBe(12);
    expect(
      relatedList?.querySelector<HTMLButtonElement>("button")?.dataset
        .foodProductRef,
    ).toBe(products[4]?.productRef);
    expect(relatedList?.children[11]?.className).toContain("lg:block");
    expect(rendered.container.textContent).not.toContain("12 loaded");
    expect(rendered.container.textContent).toContain(
      "Add more protein bars to compare",
    );

    await act(async () => {
      input.value = "snickers";
      input.dispatchEvent(
        new rendered.window.Event("input", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(rendered.container.textContent).toContain(
      "Add more protein bars to compare",
    );
    expect(rendered.container.textContent).not.toContain(
      "Add more snickers to compare",
    );

    const table = rendered.container.querySelector<HTMLTableElement>(
      'section[aria-label="Food comparison"] table',
    );
    const tableScroller = rendered.container.querySelector<HTMLDivElement>(
      "[data-food-comparison-scroll]",
    );
    const rightShadow = rendered.container.querySelector<HTMLElement>(
      '[data-food-scroll-shadow="right"]',
    );
    expect(table?.style.width).toBe("max(100%, 1148px)");
    expect(table?.querySelectorAll("col")[0]?.getAttribute("style")).toContain(
      "148px",
    );
    expect(table?.querySelectorAll("col")[1]?.getAttribute("style")).toContain(
      "calc((100% - 148px) / 4)",
    );
    expect(rightShadow?.dataset.visible).toBe("false");
    expect(rightShadow?.className).toContain("bg-linear-to-r");
    expect(rightShadow?.className).toContain("right-0");
    expect(rightShadow?.className).toContain("w-24");
    expect(rightShadow?.className).toContain("via-card/75");
    if (!tableScroller) {
      throw new Error("Food comparison scroll container did not render.");
    }
    Object.defineProperties(tableScroller, {
      clientWidth: { configurable: true, value: 1304 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 1304 },
    });
    await act(async () => {
      tableScroller.dispatchEvent(new rendered.window.Event("scroll"));
    });
    expect(rightShadow?.dataset.visible).toBe("false");

    Object.defineProperties(tableScroller, {
      clientWidth: { configurable: true, value: 390 },
      scrollWidth: { configurable: true, value: 1304 },
    });
    await act(async () => {
      tableScroller.dispatchEvent(new rendered.window.Event("scroll"));
    });
    expect(rightShadow?.dataset.visible).toBe("false");

    Object.defineProperties(tableScroller, {
      clientWidth: { configurable: true, value: 1304 },
      scrollWidth: { configurable: true, value: 1304 },
    });
    await act(async () => {
      tableScroller.dispatchEvent(new rendered.window.Event("scroll"));
    });
    expect(rightShadow?.dataset.visible).toBe("false");

    const addedProductRef = products[4]?.productRef;
    const cardToAdd = addedProductRef
      ? rendered.container.querySelector<HTMLButtonElement>(
          `button[data-food-product-ref="${addedProductRef}"]`,
        )
      : null;
    await click(cardToAdd ?? undefined);
    const addedCard = addedProductRef
      ? rendered.container.querySelector<HTMLButtonElement>(
          `button[data-food-product-ref="${addedProductRef}"]`,
        )
      : null;
    expect(addedCard).not.toBeNull();
    expect(addedCard?.textContent).toContain("Added");
    expect(addedCard?.disabled).toBe(true);
    expect(table?.style.width.match(/clamp\(250px/gu)).toHaveLength(5);
    expect(table?.querySelectorAll("col")[0]?.getAttribute("style")).toContain(
      "148px",
    );
    expect(table?.querySelectorAll("col")[1]?.getAttribute("style")).toContain(
      "clamp(250px",
    );
    Object.defineProperty(tableScroller, "scrollWidth", {
      configurable: true,
      value: 1593,
    });
    await act(async () => {
      tableScroller.dispatchEvent(new rendered.window.Event("scroll"));
    });
    expect(rightShadow?.dataset.visible).toBe("true");
    tableScroller.scrollLeft = 289;
    await act(async () => {
      tableScroller.dispatchEvent(new rendered.window.Event("scroll"));
    });
    expect(rightShadow?.dataset.visible).toBe("false");

    const requestCountBeforeLoadMore = fetchMock.mock.calls.length;
    await click(findButton(rendered.container, "Load more"));

    expect(fetchMock).toHaveBeenCalledTimes(requestCountBeforeLoadMore);
    expect(desktopVisibleCount()).toBe(24);

    await click(findButton(rendered.container, "Load more"));

    expect(fetchMock).toHaveBeenCalledTimes(requestCountBeforeLoadMore + 1);
    const loadMoreRequest = fetchMock.mock.calls.at(-1)?.[1];
    expect(JSON.parse(String(loadMoreRequest?.body))).toMatchObject({
      foodComparisonReadyOnly: true,
      foodSearchOrder: "popular",
      limitPerKind: 12,
      offsetPerKind: 30,
      query: "protein bars",
    });
    expect(relatedList?.children).toHaveLength(30);
    expect(desktopVisibleCount()).toBe(30);
    expect(rendered.container.textContent).not.toContain("24 loaded");
  });

  test("related pagination stays inside the public search boundary", async () => {
    const source = FOOD_LABEL_DESIGN_PRODUCTS[0];
    if (!source) {
      throw new Error("Food Label Lab design product is missing.");
    }
    const products = Array.from({ length: 250 }, (_, index) => {
      const product = structuredClone(source);
      product.productRef = `food_boundary_${index + 1}`;
      product.name = `Protein bar ${index + 1}`;
      product.brand = `Brand ${index + 1}`;
      product.upc = String(index + 1).padStart(12, "0");
      return product;
    });
    fetchMock.mockImplementation(async (resource, init) => {
      const url = String(resource);
      if (url === "/api/public/v1/products/search") {
        const body = JSON.parse(String(init?.body)) as {
          limitPerKind: number;
          offsetPerKind: number;
        };
        return jsonResponse({
          schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
          results: {
            supplements: [],
            foods: products
              .slice(body.offsetPerKind, body.offsetPerKind + body.limitPerKind)
              .map(searchHit),
          },
        });
      }
      const productRef = decodeURIComponent(url.split("/").at(-1) ?? "");
      const product = products.find(
        (candidate) => candidate.productRef === productRef,
      );
      return product
        ? detailResponse(product)
        : new Response("missing", { status: 404 });
    });

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    Object.defineProperty(rendered.window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    const input = rendered.container.querySelector<HTMLInputElement>(
      "#food-comparison-search",
    );
    if (!input) {
      throw new Error("Search input did not render.");
    }

    await act(async () => {
      input.value = "protein bars";
      input.dispatchEvent(
        new rendered.window.Event("input", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await click(
      rendered.container.querySelector<HTMLButtonElement>(
        "[data-food-category-option]",
      ) ?? undefined,
    );

    for (let index = 0; index < 30; index += 1) {
      const loadMore = findButton(rendered.container, "Load more");
      if (!loadMore) {
        break;
      }
      await click(loadMore);
    }

    const pageRequests = fetchMock.mock.calls
      .filter(
        ([resource]) => String(resource) === "/api/public/v1/products/search",
      )
      .map(
        ([, init]) =>
          JSON.parse(String(init?.body)) as {
            foodSearchOrder?: string;
            limitPerKind: number;
            offsetPerKind: number;
          },
      )
      .filter((body) => body.foodSearchOrder === "popular");
    expect(pageRequests.at(-1)).toMatchObject({
      limitPerKind: 30,
      offsetPerKind: 220,
    });
    expect(
      pageRequests.every(
        (body) =>
          body.offsetPerKind <= 220 &&
          body.offsetPerKind + body.limitPerKind <= 250,
      ),
    ).toBe(true);
    expect(
      rendered.container.querySelectorAll("[data-food-related-products] > li"),
    ).toHaveLength(246);
  });

  test("rejects an all-zero label with no linked lab data", async () => {
    const source = FOOD_LABEL_DESIGN_PRODUCTS[0];
    if (!source) {
      throw new Error("Food Label Lab design product is missing.");
    }
    const allZero = structuredClone(source);
    allZero.productRef = "food_all_zero";
    allZero.name = "Apple Soda";
    for (const row of allZero.nutrition.rows) {
      if (row.amount) {
        row.amount.value = 0;
        row.amount.display = "0";
      }
    }
    allZero.productTests = {
      status: "no_known_product_tests",
      total: 0,
      returned: 0,
      truncated: false,
      observations: [],
      alerts: [],
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
          results: { supplements: [], foods: [searchHit(allZero)] },
        }),
      )
      .mockResolvedValueOnce(detailResponse(allZero));

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;
    const input = rendered.container.querySelector<HTMLInputElement>(
      "#food-comparison-search",
    );
    if (!input) {
      throw new Error("Search input did not render.");
    }

    await act(async () => {
      input.value = "apple soda";
      input.dispatchEvent(
        new rendered.window.Event("input", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await click(findProductButtons(rendered.container)[0]);

    expect(
      rendered.container.querySelector('section[aria-label="Food comparison"]'),
    ).toBeNull();
    expect(input.value).toBe("apple soda");
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

  test("the Murph note leads to one combined drawer with honest statuses", async () => {
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

    const tableText =
      rendered.container.querySelector('section[aria-label="Food comparison"]')
        ?.textContent ?? "";
    expect(tableText).not.toContain("1 above a screening limit");
    expect(rendered.container.querySelector(".bg-destructive")).toBeNull();
    expect(tableText).not.toContain("No observations");
    expect(tableText).not.toContain("gaps");

    const notes = [
      ...rendered.container.querySelectorAll<HTMLButtonElement>(
        "button[data-food-murph-grade]",
      ),
    ];
    expect(notes).toHaveLength(3);
    expect(notes[0]?.getAttribute("aria-label")).toBe(
      "Murph grade E. Open product details.",
    );
    await click(notes[0]);

    expect(
      document.body.querySelector("[data-food-murph-summary]"),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        '[data-food-ingredient-list="independent-columns"]',
      ),
    ).not.toBeNull();
    const noteReasons = document.body.querySelectorAll(
      "[data-food-murph-summary] > li",
    );
    expect(noteReasons.length).toBeGreaterThanOrEqual(1);
    expect(noteReasons.length).toBeLessThanOrEqual(3);
    expect(
      findButtonByAriaLabel(document.body, "Overview")?.querySelector(
        "[data-stable-tab-label]",
      ),
    ).not.toBeNull();
    expect(
      findButtonByAriaLabel(document.body, "Lab tests")?.querySelector(
        "[data-stable-tab-label]",
      ),
    ).not.toBeNull();
    expect(findButtonByAriaLabel(document.body, "Data gaps")).toBeUndefined();
    expect(
      document.body.querySelector('[aria-label="100% evidence coverage"]'),
    ).not.toBeNull();
    await click(findButtonByAriaLabel(document.body, "Lab tests"));
    expect(
      document.body.querySelector('[data-lab-state="alert"]'),
    ).not.toBeNull();
    expect(document.body.querySelectorAll("[data-analyte]")).toHaveLength(1);
    expect(
      document.body.querySelectorAll("[data-observation-id]"),
    ).toHaveLength(8);
    expect(
      [
        ...document.body.querySelectorAll<HTMLElement>(
          '[data-slot="test-result"]',
        ),
      ].map((element) => element.textContent?.trim()),
    ).toEqual([
      "0.00001 ppm",
      "From 0.1 ppm (upper bound not reported)",
      "Up to 0.2 ppm (lower bound not reported)",
      "Not detected (reported in ppb)",
      "Detected (reported in ng/g)",
      "Trace (reported in mcg/kg)",
      "12 ng/g",
      "0.01 ppm",
    ]);
    expect(
      document.body.querySelectorAll('[data-slot="screening-outcome"]'),
    ).toHaveLength(8);

    expect(
      findButtonByAriaLabel(
        document.body,
        "Show evidence coverage, known gaps, and record source",
      ),
    ).toBeDefined();

    await click(notes[2]);
    await click(findButtonByAriaLabel(document.body, "Lab tests"));
    expect(
      document.body.querySelector('[data-lab-state="alert"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelectorAll("[data-observation-id]"),
    ).toHaveLength(1);
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
      {
        code: "NO_LINKED_PRODUCT_TESTS",
        title: "No linked product tests",
        description: "Synthetic gap.",
      },
    ];
    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, {
        initialProducts: [untested, second],
        webMcpEnabled: false,
      }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    const note = rendered.container.querySelector<HTMLButtonElement>(
      "button[data-food-murph-grade]",
    );
    if (!note) {
      throw new Error("Murph note did not render.");
    }
    expect(note.getAttribute("aria-label")).toBe(
      "Murph grade A. Open product details.",
    );
    await click(note);
    await click(findButtonByAriaLabel(document.body, "Lab tests"));

    expect(
      document.body.querySelector('[data-lab-state="unavailable"]'),
    ).not.toBeNull();
    expect(document.body.querySelector("[data-analyte]")).toBeNull();
    expect(
      document.body.querySelector('[data-lab-state="unavailable"]')
        ?.textContent,
    ).toBe("No lab tests");
    expect(document.body.textContent).not.toContain(
      "No product-level test is linked to this exact record.",
    );

    expect(findButtonByAriaLabel(document.body, "Data gaps")).toBeUndefined();
    expect(document.body.querySelector("[data-gap-code]")).toBeNull();
  });

  test("keeps grouped subingredients behind the parent ingredient", async () => {
    const source = FOOD_LABEL_DESIGN_PRODUCTS[0];
    if (!source) {
      throw new Error("Food Label Lab design product is missing.");
    }
    const product = structuredClone(source);
    product.ingredients.statement =
      "PROTEIN BLEND (MILK PROTEIN ISOLATE, WHEY PROTEIN ISOLATE), SUCRALOSE";

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, {
        initialProducts: [product],
        webMcpEnabled: false,
      }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    const grade = rendered.container.querySelector<HTMLButtonElement>(
      "button[data-food-murph-grade]",
    );
    await click(grade ?? undefined);

    const ingredientSection = document.body.querySelector(
      '[aria-label="Product details"]',
    );
    expect(ingredientSection?.textContent).not.toContain(
      "Milk Protein Isolate",
    );
    const parent = findButtonByAriaLabel(document.body, "About Protein Blend");
    const name = parent?.querySelector("span");
    const icon = parent?.querySelector("svg");
    if (!name || !icon) {
      throw new Error("Grouped ingredient marker did not render.");
    }
    expect(Boolean(name.compareDocumentPosition(icon) & 4)).toBe(true);
  });

  test("restores a shared comparison from public product references", async () => {
    const [first, second] = FOOD_LABEL_DESIGN_PRODUCTS;
    if (!first || !second) {
      throw new Error("Food Label Lab design products are missing.");
    }
    fetchMock.mockImplementation(async (resource) => {
      const url = String(resource);
      if (url === "/api/public/v1/products/search") {
        return jsonResponse({
          schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
          results: { supplements: [], foods: [] },
        });
      }
      if (url.endsWith(encodeURIComponent(first.productRef))) {
        return detailResponse(first);
      }
      if (url.endsWith(encodeURIComponent(second.productRef))) {
        return detailResponse(second);
      }
      return new Response("missing", { status: 404 });
    });
    const missingProductRef = "food_missing";
    const compare = encodeURIComponent(
      [first.productRef, missingProductRef, second.productRef].join(","),
    );
    const href = `https://www.withmurph.ai/food?compare=${compare}&basis=per_serving`;

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, { webMcpEnabled: false }),
      {
        location: {
          hash: "",
          href,
          origin: "https://www.withmurph.ai",
          pathname: "/food",
          search: `?compare=${compare}&basis=per_serving`,
        },
        requireButton: false,
      },
    );
    cleanup = rendered.cleanup;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(
      rendered.container.querySelectorAll("[data-food-product-header]"),
    ).toHaveLength(2);
    expect(
      findButton(rendered.container, "Per serving")?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      fetchMock.mock.calls.filter(([resource]) =>
        /^\/api\/public\/v1\/products\/food_/u.test(String(resource)),
      ),
    ).toHaveLength(3);
    expect(rendered.container.textContent).toContain(
      "1 product from this shared comparison could not be loaded.",
    );
  });

  test("keeps the table on per 100 g when no selected product supports per-serving values", async () => {
    const source = FOOD_LABEL_DESIGN_PRODUCTS[0];
    if (!source) {
      throw new Error("Food Label Lab design product is missing.");
    }
    const product = structuredClone(source);
    if (product.serving) {
      product.serving.grams = null;
      product.serving.unit = "ml";
    }
    for (const row of product.nutrition.rows) {
      row.basis = "per_100_g";
    }

    const rendered = await renderClientComponent(
      createElement(FoodLabelLab, {
        initialBasis: "per_serving",
        initialProducts: [product],
        webMcpEnabled: false,
      }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    expect(
      rendered.container
        .querySelector('[aria-label="Food comparison"]')
        ?.getAttribute("data-food-basis"),
    ).toBe("per_100_g");
    expect(
      rendered.container.querySelector('[aria-label="Compare per serving"]'),
    ).toBeNull();
    expect(rendered.container.textContent).not.toContain(
      "Serving mass not reported",
    );
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
  precise.result = {
    basis: "product_mass",
    operator: "eq",
    unit: "ppm",
    value: 0.00001,
  };
  precise.normalizedResult = null;
  precise.screening = null;

  const lowerRange = observation("lower-range");
  lowerRange.result = {
    basis: "product_mass",
    operator: "range",
    unit: "ppm",
    value: 0.1,
  };
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
  notDetected.result = {
    basis: "product_mass",
    operator: "not_detected",
    unit: "ppb",
    value: null,
  };
  notDetected.normalizedResult = null;
  notDetected.screening = null;

  const detected = observation("detected");
  detected.result = {
    basis: "product_mass",
    operator: "detected",
    unit: "ng/g",
    value: null,
  };
  detected.normalizedResult = null;
  detected.screening = null;

  const trace = observation("trace");
  trace.result = {
    basis: "product_mass",
    operator: "trace",
    unit: "mcg/kg",
    value: null,
  };
  trace.normalizedResult = null;
  trace.screening = null;

  const normalized = observation("normalized");
  normalized.result = {
    basis: "product_mass",
    operator: "eq",
    unit: "ng/g",
    value: 12,
  };
  normalized.normalizedResult = {
    basis: "product_mass",
    unit: "ppm",
    value: 0.012,
  };
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
  equality.result = {
    basis: "product_mass",
    operator: "eq",
    unit: "ppm",
    value: 0.01,
  };
  equality.normalizedResult = {
    basis: "product_mass",
    unit: "ppm",
    value: 0.01,
  };
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
  product.productTests.alerts = [
    {
      analyte: normalized.analyte,
      concernLevel: "medium",
      result: normalized.result,
      threshold: normalized.screening.threshold,
      source: normalized.source,
      testedProduct: normalized.testedProduct,
    },
  ];
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

function findButton(
  container: HTMLElement,
  text: string,
): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

function findButtonByAriaLabel(
  container: HTMLElement,
  label: string,
): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label") === label,
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
