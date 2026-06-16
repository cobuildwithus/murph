export interface WholeFoodsNutritionRow {
  name: string;
  amount: string | null;
  percent: string | null;
  level: string | null;
}

export interface WholeFoodsNutritionFacts {
  caloriesAmount?: string;
  servingsPerContainer?: string;
  servingSize?: string;
  macronutrients?: WholeFoodsNutritionRow[];
  vitaminsAndMinerals?: WholeFoodsNutritionRow[];
}

export interface WholeFoodsNormalizedNutrient {
  id?: number;
  number?: string;
  name: string;
  value: number;
  unit: string;
  sourceName?: string;
  sourceAmount?: string | null;
  percentDailyValue?: number | null;
  lessThan?: boolean;
}

export interface WholeFoodsProduct {
  id: string;
  canonicalKey: string;
  dataOrigin: "whole_foods_market";
  dataOriginId: string;
  dataOriginUrl: string | null;
  dataOriginPriority: number;
  name: string;
  brand: string | null;
  upc: null;
  offMarket: boolean;
  searchText: string;
  label: {
    source: "whole_foods_market";
    asin: string;
    programType?: string;
    category?: Record<string, string>;
    ingredients?: string;
    dietTypes?: string[];
    servingSize?: number;
    servingSizeUnit?: "g";
    householdServing?: string;
    servingsPerContainer?: number;
    calories?: number;
    nutrientsPerServing?: WholeFoodsNormalizedNutrient[];
    nutrientsPer100g?: WholeFoodsNormalizedNutrient[];
    nutritionFacts?: WholeFoodsNutritionFacts;
    productImageCount?: number;
  };
  hasNutritionFacts: boolean;
  hasIngredients: boolean;
}

export function compactText(value: unknown): string | null;
export function discoverProductUrlsFromHtml(html: string, baseUrl?: string): string[];
export function extractNextDataFromHtml(html: string): unknown;
export function extractWholeFoodsProductFromHtml(html: string, sourceUrl?: string | null): WholeFoodsProduct | null;
export function normalizeWholeFoodsProduct(aapiData: Record<string, unknown>, sourceUrl?: string | null): WholeFoodsProduct | null;
export function fetchProductHtml(url: string, options: {
  contextDevFallback?: boolean;
  timeoutMs: number;
}): Promise<{ method: "direct" | "context_dev"; text: string; url: string }>;
export function buildPreparedFoodCsvRow(product: WholeFoodsProduct, sampleDate: string): string;
export function preparedFoodCsvHeader(): string;
