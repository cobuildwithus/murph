import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  FOOD_WEBMCP_TOOL_NAMES,
  FoodLabelWebMcp,
  type FoodLabelWebMcpActions,
} from "@/src/components/food-label-lab/food-label-webmcp";

import { renderClientComponent } from "./render-client-component";

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

    await expect(compare.execute({ productRefs: ["food_one"] })).rejects.toThrow(
      "two to four",
    );
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
    const result = await Promise.resolve(showEvidence.execute({
      productRef: "food_one",
      view: "gaps",
    }));
    expect(result).toEqual({
      opened: true,
      productRef: "food_one",
      view: "gaps",
    });
    expect(actions.showEvidence).toHaveBeenCalledWith("food_one", "gaps");
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
