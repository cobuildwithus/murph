import { act, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PUBLIC_PRODUCTS_SCHEMA_VERSION } from "@murphai/contracts";

import { FOOD_LABEL_DESIGN_PRODUCTS } from "@/app/design/food-label-lab-study";
import { FoodLabelLab } from "@/src/components/food-label-lab/food-label-lab";
import {
  FOOD_WEBMCP_TOOL_NAMES,
  FoodLabelWebMcp,
  type FoodLabelWebMcpActions,
} from "@/src/components/food-label-lab/food-label-webmcp";

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

interface CapturedTool {
  name: string;
  annotations: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown) => unknown | Promise<unknown>;
}

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
  vi.unstubAllGlobals();
});

describe("FoodLabelWebMcp", () => {
  test("registers the bounded route tools and aborts every registration on unmount", async () => {
    const captured: unknown[] = [];
    const signals: AbortSignal[] = [];
    const element = createElement(FoodLabelWebMcp, { actions: makeActions() });
    const rendered = await renderWithModelContext(
      element,
      (tool: unknown, options?: { signal?: AbortSignal }) => {
        captured.push(tool);
        if (options?.signal) {
          signals.push(options.signal);
        }
      },
    );
    cleanup = rendered.cleanup;

    expect(captured.map(getToolName)).toEqual(FOOD_WEBMCP_TOOL_NAMES);
    expect(signals).toHaveLength(FOOD_WEBMCP_TOOL_NAMES.length);
    for (const signal of signals) {
      expect(signal.aborted).toBe(false);
    }

    await cleanup();
    cleanup = null;
    for (const signal of signals) {
      expect(signal.aborted).toBe(true);
    }
  });

  test("keeps search small and makes compare depend on exact refs", async () => {
    const captured: unknown[] = [];
    const actions = makeActions();
    const rendered = await renderWithModelContext(
      createElement(FoodLabelWebMcp, { actions }),
      (tool: unknown) => {
        captured.push(tool);
      },
    );
    cleanup = rendered.cleanup;

    const search = findTool(captured, "search_food_products");
    const compare = findTool(captured, "compare_food_products");

    await expect(search.execute({ query: "plain yogurt", limit: 3 })).resolves.toEqual({
      total: 1,
      results: [
        {
          productRef: "food_one",
          name: "Plain Yogurt",
          brand: "Example",
          linkedObservations: 2,
        },
      ],
    });
    expect(actions.search).toHaveBeenCalledWith("plain yogurt", 3);
    expect(search.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(search.inputSchema).toMatchObject({
      properties: { limit: { maximum: 10 } },
    });
    expect(compare.inputSchema).toMatchObject({
      properties: { productRefs: { maxItems: 10 } },
    });

    await expect(compare.execute({ productRefs: ["food_one"] })).rejects.toThrow(
      "two to ten",
    );
    await expect(compare.execute({
      productRefs: Array.from({ length: 11 }, (_, index) => `food_${index}`),
    })).rejects.toThrow("two to ten");
    await expect(search.execute({ query: "plain yogurt", extra: true })).rejects.toThrow(
      "Unexpected tool input: extra",
    );
    await expect(compare.execute({
      productRefs: ["food_one", "food_two"],
    })).resolves.toEqual(expect.objectContaining({
      basis: "per_100_g",
      topMatchProductRefs: ["food_one"],
    }));
    expect(actions.compare).toHaveBeenCalledWith(["food_one", "food_two"]);
  });

  test("uses the current page state for evidence disclosure", async () => {
    const captured: unknown[] = [];
    const actions = makeActions();
    const rendered = await renderWithModelContext(
      createElement(FoodLabelWebMcp, { actions }),
      (tool: unknown) => {
        captured.push(tool);
      },
    );
    cleanup = rendered.cleanup;

    const showEvidence = findTool(captured, "show_food_evidence");
    expect(showEvidence.inputSchema).toMatchObject({
      properties: { view: { enum: ["product", "tests", "gaps"] } },
    });
    const result = await Promise.resolve(
      showEvidence.execute({
        productRef: "food_one",
        view: "product",
      }),
    );
    expect(result).toEqual({
      opened: true,
      productRef: "food_one",
      view: "product",
    });
    expect(actions.showEvidence).toHaveBeenCalledWith("food_one", "product");
  });

  test("returns the same bounded metric comparison that the page shows", async () => {
    const products = structuredClone(FOOD_LABEL_DESIGN_PRODUCTS);
    const [first, second, third] = products;
    if (!first || !second || !third) {
      throw new Error("Food Label Lab design products are missing.");
    }
    setMetricValue(first, "Total Sugars", 5, "per_serving");
    setMetricValue(second, "Total Sugars", 4, "per_serving");
    setMetricValue(third, "Total Sugars", 4);
    if (!second.serving) {
      throw new Error("Second Food Label Lab product serving is missing.");
    }
    second.serving.grams = 121;
    third.nutrition.rows = third.nutrition.rows.filter(
      (row) => row.name !== "Sodium, Na",
    );
    const byRef = new Map(products.map((product) => [product.productRef, product]));
    vi.stubGlobal("fetch", vi.fn(async (resource: RequestInfo | URL) => {
      const url = readRequestUrl(resource);
      const productRef = decodeURIComponent(url.split("/").at(-1) ?? "");
      const product = byRef.get(productRef);
      if (!product) {
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify({
        schema: PUBLIC_PRODUCTS_SCHEMA_VERSION,
        product,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const captured: unknown[] = [];
    const rendered = await renderWithModelContext(
      createElement(FoodLabelLab),
      (tool: unknown) => captured.push(tool),
    );
    cleanup = rendered.cleanup;

    const compare = findTool(captured, "compare_food_products");
    let comparison: unknown;
    await act(async () => {
      comparison = await compare.execute({
        productRefs: products.map((product) => product.productRef),
      });
      await Promise.resolve();
    });
    const comparisonRecord = requireRecord(comparison, "comparison result");
    const metrics = requireRecordArray(comparisonRecord.metrics, "comparison metrics");
    const sugars = findMetricResult(metrics, "sugars");
    const sodium = findMetricResult(metrics, "sodium");

    expect(sugars).toMatchObject({
      complete: true,
      winnerProductRefs: [first.productRef, second.productRef],
    });
    expect(sugars.values).toEqual(expect.arrayContaining([
      { productRef: first.productRef, unit: "g", value: 3.3 },
      { productRef: second.productRef, unit: "g", value: 3.3 },
    ]));
    expect(sodium).toMatchObject({ complete: false, winnerProductRefs: [] });
    expect(comparisonRecord.comparableMetricCount).toBe(5);
    expect(rendered.container.querySelectorAll(
      '[data-food-metric="sugars"] [data-food-winner="lowest"]',
    )).toHaveLength(2);

    const servingButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Compare per serving"]',
    );
    if (!servingButton) {
      throw new Error("Per-serving comparison button did not render.");
    }
    await act(async () => {
      servingButton.click();
      await Promise.resolve();
    });
    const current = await findTool(captured, "get_food_comparison").execute({});
    const currentRecord = requireRecord(current, "current comparison");
    expect(currentRecord.basis).toBe("per_serving");
    expect(currentRecord.metrics).toHaveLength(6);
    const currentSugars = findMetricResult(
      requireRecordArray(currentRecord.metrics, "current comparison metrics"),
      "sugars",
    );
    expect(currentSugars.values).toEqual(expect.arrayContaining([
      { productRef: first.productRef, unit: "g", value: 5 },
      { productRef: second.productRef, unit: "g", value: 4 },
    ]));
    expect(currentSugars.winnerProductRefs).toEqual([second.productRef]);
  });
});

async function renderWithModelContext(
  element: ReactElement,
  registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void,
) {
  return renderClientComponent(element, {
    requireButton: false,
    hydrateFrom: {
      markup: renderToStaticMarkup(element),
      prepareDom(container) {
        Object.defineProperty(container.ownerDocument, "modelContext", {
          configurable: true,
          value: { registerTool },
        });
      },
    },
  });
}

function makeActions(): FoodLabelWebMcpActions {
  const comparison = {
    basis: "per_100_g" as const,
    comparableMetricCount: 4,
    metrics: [
      {
        metric: "calories" as const,
        preference: "lower" as const,
        complete: true,
        values: [{ productRef: "food_one", value: 90, unit: "kcal" }],
        winnerProductRefs: ["food_one"],
      },
    ],
    topMatchProductRefs: ["food_one"],
    products: [
      {
        productRef: "food_one",
        name: "Plain Yogurt",
        brand: "Example",
        alertsShown: 0,
        alertsLowerBound: false,
        observationTotal: 2,
        observationReturned: 2,
        observationsTruncated: false,
        evidence: "partial",
        wins: 4,
      },
    ],
  };
  return {
    search: vi.fn(async () => [
      {
        productRef: "food_one",
        name: "Plain Yogurt",
        brand: "Example",
        linkedObservations: 2,
      },
    ]),
    compare: vi.fn(async () => comparison),
    getCurrentComparison: vi.fn(() => comparison),
    showEvidence: vi.fn((productRef, view) => ({ opened: true, productRef, view })),
  };
}

function getToolName(value: unknown): string {
  return findToolShape(value).name;
}

function findTool(values: unknown[], name: string): CapturedTool {
  const candidate = values.find((value) => {
    if (!value || typeof value !== "object" || !("name" in value)) {
      return false;
    }
    return value.name === name;
  });
  if (!candidate) {
    throw new Error(`WebMCP tool ${name} was not registered.`);
  }
  return findToolShape(candidate);
}

function findToolShape(value: unknown): CapturedTool {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.execute !== "function" ||
    !isRecord(value.annotations) ||
    !isRecord(value.inputSchema)
  ) {
    throw new Error("Captured WebMCP tool has an invalid shape.");
  }
  const execute = value.execute;
  return {
    name: value.name,
    execute: (input) => execute(input),
    annotations: value.annotations,
    inputSchema: value.inputSchema,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequestUrl(resource: RequestInfo | URL): string {
  if (typeof resource === "string") return resource;
  if (resource instanceof URL) return resource.href;
  return resource.url;
}

function setMetricValue(
  product: (typeof FOOD_LABEL_DESIGN_PRODUCTS)[number],
  metricName: string,
  value: number,
  basis: "per_100_g" | "per_serving" = "per_100_g",
) {
  const metric = product.nutrition.rows.find((row) => row.name === metricName);
  if (!metric?.amount) {
    throw new Error(`Metric ${metricName} is missing from the design product.`);
  }
  metric.amount.value = value;
  metric.amount.display = String(value);
  metric.basis = basis;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireRecordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`${label} must be an object array.`);
  }
  return value;
}

function findMetricResult(
  metrics: Record<string, unknown>[],
  metric: string,
): Record<string, unknown> {
  const result = metrics.find((candidate) => candidate.metric === metric);
  if (!result) {
    throw new Error(`Metric result ${metric} is missing.`);
  }
  return result;
}
