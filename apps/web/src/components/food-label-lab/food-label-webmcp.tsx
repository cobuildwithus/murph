"use client";

import { useEffect, useRef } from "react";

export interface FoodWebMcpSearchResult {
  productRef: string;
  name: string;
  brand: string | null;
  linkedObservations: number;
}

export interface FoodWebMcpComparisonResult {
  products: Array<{
    productRef: string;
    name: string;
    brand: string | null;
    alertsShown: number;
    alertsLowerBound: boolean;
    observationTotal: number;
    observationReturned: number;
    observationsTruncated: boolean;
    evidence: string;
  }>;
  basis: "per_100_g" | "per_serving";
  topMatchProductRefs: string[];
}

export interface FoodLabelWebMcpActions {
  search: (query: string, limit: number) => Promise<FoodWebMcpSearchResult[]>;
  compare: (productRefs: string[]) => Promise<FoodWebMcpComparisonResult>;
  getCurrentComparison: () => FoodWebMcpComparisonResult;
  showEvidence: (
    productRef: string,
    view: "tests" | "gaps",
  ) => { opened: boolean; productRef: string; view: "tests" | "gaps" };
}

interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: unknown) => unknown | Promise<unknown>;
}

interface WebMcpModelContext {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
}

declare global {
  interface Document {
    modelContext?: WebMcpModelContext;
  }
}

export const FOOD_WEBMCP_TOOL_NAMES = [
  "search_food_products",
  "compare_food_products",
  "get_food_comparison",
  "show_food_evidence",
] as const;

const PRODUCT_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    productRef: { type: "string" },
    name: { type: "string" },
    brand: { type: ["string", "null"] },
    alertsShown: { type: "integer", minimum: 0, maximum: 5 },
    alertsLowerBound: { type: "boolean" },
    observationTotal: { type: "integer", minimum: 0 },
    observationReturned: { type: "integer", minimum: 0, maximum: 20 },
    observationsTruncated: { type: "boolean" },
    evidence: { type: "string", enum: ["limited", "partial", "reported"] },
  },
  required: [
    "productRef",
    "name",
    "brand",
    "alertsShown",
    "alertsLowerBound",
    "observationTotal",
    "observationReturned",
    "observationsTruncated",
    "evidence",
  ],
  additionalProperties: false,
} as const;

const COMPARISON_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    products: { type: "array", maxItems: 4, items: PRODUCT_SUMMARY_SCHEMA },
    basis: { type: "string", enum: ["per_100_g", "per_serving"] },
    topMatchProductRefs: {
      type: "array",
      maxItems: 4,
      items: { type: "string" },
    },
  },
  required: ["products", "basis", "topMatchProductRefs"],
  additionalProperties: false,
} as const;

export function FoodLabelWebMcp(input: { actions: FoodLabelWebMcpActions }) {
  const actionsRef = useRef(input.actions);

  useEffect(() => {
    actionsRef.current = input.actions;
  }, [input.actions]);

  useEffect(() => {
    const modelContext = document.modelContext;
    if (typeof modelContext?.registerTool !== "function") {
      return;
    }

    const controller = new AbortController();
    const tools = createFoodWebMcpTools(actionsRef);

    void Promise.all(
      tools.map((tool) =>
        Promise.resolve(modelContext.registerTool(tool, { signal: controller.signal })),
      ),
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error("Food WebMCP tool registration failed:", error);
      }
    });

    return () => controller.abort();
  }, []);

  return null;
}

function createFoodWebMcpTools(
  actionsRef: React.RefObject<FoodLabelWebMcpActions>,
): WebMcpTool[] {
  return [
    {
      name: "search_food_products",
      description:
        "Search branded foods on the open Murph Food page. Returns short exact product choices for a later comparison.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 2, maxLength: 128 },
          limit: { type: "integer", minimum: 1, maximum: 6, default: 6 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          total: { type: "integer", minimum: 0, maximum: 6 },
          results: {
            type: "array",
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                productRef: { type: "string" },
                name: { type: "string" },
                brand: { type: ["string", "null"] },
                linkedObservations: { type: "integer", minimum: 0 },
              },
              required: ["productRef", "name", "brand", "linkedObservations"],
              additionalProperties: false,
            },
          },
        },
        required: ["total", "results"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const value = readObject(rawInput);
        assertOnlyKeys(value, ["query", "limit"]);
        const query = readBoundedString(value.query, 2, 128, "query");
        const limit = value.limit === undefined
          ? 6
          : readBoundedInteger(value.limit, 1, 6, "limit");
        const results = await actionsRef.current.search(query, limit);
        return { total: results.length, results };
      },
    },
    {
      name: "compare_food_products",
      description:
        "Compare two to four exact branded foods and show the result on the open page. Use productRef values returned by search_food_products.",
      inputSchema: {
        type: "object",
        properties: {
          productRefs: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            uniqueItems: true,
            items: {
              type: "string",
              pattern: "^food_[A-Za-z0-9_-]{1,1024}$",
            },
          },
        },
        required: ["productRefs"],
        additionalProperties: false,
      },
      outputSchema: COMPARISON_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const value = readObject(rawInput);
        assertOnlyKeys(value, ["productRefs"]);
        const productRefs = readProductRefs(value.productRefs);
        return actionsRef.current.compare(productRefs);
      },
    },
    {
      name: "get_food_comparison",
      description:
        "Read the compact result currently visible on the open Murph Food page.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      outputSchema: COMPARISON_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (rawInput) => {
        const value = readObject(rawInput);
        assertOnlyKeys(value, []);
        return actionsRef.current.getCurrentComparison();
      },
    },
    {
      name: "show_food_evidence",
      description:
        "Open the tested-sample summary or known evidence gaps for a product already in the visible comparison.",
      inputSchema: {
        type: "object",
        properties: {
          productRef: {
            type: "string",
            pattern: "^food_[A-Za-z0-9_-]{1,1024}$",
          },
          view: { type: "string", enum: ["tests", "gaps"] },
        },
        required: ["productRef", "view"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          opened: { type: "boolean" },
          productRef: { type: "string" },
          view: { type: "string", enum: ["tests", "gaps"] },
        },
        required: ["opened", "productRef", "view"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (rawInput) => {
        const value = readObject(rawInput);
        assertOnlyKeys(value, ["productRef", "view"]);
        const productRef = readFoodProductRef(value.productRef);
        const view = value.view;
        if (view !== "tests" && view !== "gaps") {
          throw new Error("view must be tests or gaps.");
        }
        return actionsRef.current.showEvidence(productRef, view);
      },
    },
  ];
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool input must be an object.");
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new Error(`Unexpected tool input: ${unexpected}.`);
  }
}

function readBoundedString(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be text.`);
  }
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`${field} must be ${minimum} to ${maximum} characters.`);
  }
  return normalized;
}

function readBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isInteger(value) || typeof value !== "number") {
    throw new Error(`${field} must be an integer.`);
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function readProductRefs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    throw new Error("productRefs must contain two to four products.");
  }
  const refs = value.map(readFoodProductRef);
  if (new Set(refs).size !== refs.length) {
    throw new Error("productRefs must be unique.");
  }
  return refs;
}

function readFoodProductRef(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^food_[A-Za-z0-9_-]{1,1024}$/u.test(value)
  ) {
    throw new Error("productRef must identify a branded food.");
  }
  return value;
}
