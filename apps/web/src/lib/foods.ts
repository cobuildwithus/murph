import "server-only";

import type {
  ProductContaminantSummary,
  ProductLabelDetail,
  ProductLabelsQueryClient,
  ProductLabelSearchItem,
  PublicProductLabelRecord,
  PublicProductLabelSearchItem,
  PublicProductTestEvidence,
} from "./product-labels";
import {
  createProductLabelsQueries,
  createPublicProductLabelsQueries,
  getDefaultProductLabelsPool,
} from "./product-labels";
import { normalizePublicProductLabel } from "./public-products/normalize-label";

const GENERIC_FOOD_DATA_ORIGINS = [
  "usda_foundation",
  "usda_sr_legacy",
  "usda_fndds",
] as const;
const FOOD_MEAL_NUTRITION_ROW_LIMIT = 16;
const FOOD_MEAL_CONTAMINANT_ALERT_LIMIT = 5;
const FOOD_MEAL_CONTAMINANT_OBSERVATION_LIMIT = 5;
const FOOD_MEAL_NUTRIENT_NAME_PATTERNS = [
  /^(?:calories?|energy)(?:\b|\s*\()/u,
  /^protein\b/u,
  /^(?:carbohydrate|total carbohydrate|carbs?)\b/u,
  /^(?:total lipid \(fat\)|total fat|fat)\b/u,
  /^(?:fiber|dietary fiber|fiber, total dietary)\b/u,
] as const;

export type FoodSearchItem = ProductLabelSearchItem;
export type FoodDetail = ProductLabelDetail;
export type FoodNutritionSearchItem = Omit<
  FoodSearchItem,
  "contaminants" | "label"
> & {
  contaminantSummary: FoodContaminantSearchSummary;
  label: {
    nutrition: ReturnType<typeof normalizePublicProductLabel>["nutrition"];
    serving: ReturnType<typeof normalizePublicProductLabel>["serving"];
  };
};

export type FoodContaminantSearchSummary = {
  status: ProductContaminantSummary["status"];
  murphConcernLevel: ProductContaminantSummary["murphConcernLevel"];
  alertCount: number;
  alertsTruncated: boolean;
  alerts: Array<{
    contaminantKey: string;
    contaminantName: string;
    concernLevel: "low" | "medium" | "high";
    result: {
      operator: ProductContaminantSummary["alerts"][number]["result"]["operator"];
      value: number;
      unit: string;
      basis: string;
    };
    threshold: {
      value: number;
      unit: string;
      basis: string;
      authority: string;
      name: string;
    };
    screeningPolicy?: {
      id: string;
      assumedBodyWeightKg: number;
      assumedServingsPerDay: number;
      servingGrams: number;
      exposure: {
        value: number;
        unit: string;
        basis: string;
      };
      ratio: number;
    };
    source: {
      name: string;
      reportDate: string | null;
    };
  }>;
  observationCount: number;
  observationsTruncated: boolean;
  observations: Array<{
    contaminantKey: string;
    contaminantName: string;
    result: {
      operator: ProductContaminantSummary["observations"][number]["result"]["operator"];
      value: number | null;
      upperValue: number | null;
      unit: string;
      basis: string;
    };
    source: {
      name: string;
      reportDate: string | null;
    };
  }>;
};

let defaultFoodsQueriesInstance: ReturnType<typeof createFoodsQueries> | null =
  null;
let defaultPublicFoodsQueriesInstance: ReturnType<
  typeof createPublicFoodsQueries
> | null = null;

export function createFoodsQueries(client: ProductLabelsQueryClient): {
  getFoodById: (input: {
    id: string;
    includeOffMarket: boolean;
  }) => Promise<FoodDetail | null>;
  getFoodByUpc: (input: {
    includeOffMarket: boolean;
    upc: string;
  }) => Promise<FoodDetail | null>;
  searchFoods: (input: {
    genericOnly?: boolean;
    includeOffMarket: boolean;
    limit: number;
    q: string;
  }) => Promise<FoodSearchItem[]>;
} {
  const queries = createProductLabelsQueries(client, "foods", {
    genericSearch: {
      dataOrigins: GENERIC_FOOD_DATA_ORIGINS,
    },
  });

  return {
    getFoodById: queries.getById,
    getFoodByUpc: queries.getByUpc,
    searchFoods: queries.search,
  };
}

export function createPublicFoodsQueries(client: ProductLabelsQueryClient): {
  searchPublicFoods: (input: {
    limit: number;
    q: string;
  }) => Promise<PublicProductLabelSearchItem[]>;
  getPublicFoodRecordById: (input: {
    id: string;
  }) => Promise<PublicProductLabelRecord | null>;
  getPublicFoodEvidence: (input: {
    id: string;
  }) => Promise<PublicProductTestEvidence>;
} {
  const queries = createPublicProductLabelsQueries(client, "foods", {
    excludedDataOrigins: GENERIC_FOOD_DATA_ORIGINS,
  });

  return {
    searchPublicFoods: queries.searchCompact,
    getPublicFoodRecordById: queries.getRecordById,
    getPublicFoodEvidence: queries.getEvidence,
  };
}

export async function searchFoods(input: {
  q: string;
  limit: number;
  includeOffMarket: boolean;
  genericOnly?: boolean;
}): Promise<FoodSearchItem[]> {
  return await defaultFoodsQueries().searchFoods(input);
}

export async function getFoodById(input: {
  id: string;
  includeOffMarket: boolean;
}): Promise<FoodDetail | null> {
  return await defaultFoodsQueries().getFoodById(input);
}

export async function getFoodByUpc(input: {
  includeOffMarket: boolean;
  upc: string;
}): Promise<FoodDetail | null> {
  return await defaultFoodsQueries().getFoodByUpc(input);
}

export function toFoodNutritionSearchItem(
  item: FoodSearchItem,
): FoodNutritionSearchItem {
  const normalized = normalizePublicProductLabel({
    kind: "food",
    label: item.label,
    servingGrams: null,
  });
  const mealNutritionRows = normalized.nutrition.rows
    .filter((row) => {
      const name = row.name.trim().toLowerCase();
      return FOOD_MEAL_NUTRIENT_NAME_PATTERNS.some((pattern) =>
        pattern.test(name));
    })
    .slice(0, FOOD_MEAL_NUTRITION_ROW_LIMIT);

  return {
    id: item.id,
    dataOrigin: item.dataOrigin,
    dataOriginId: item.dataOriginId,
    name: item.name,
    brand: item.brand,
    upc: item.upc,
    offMarket: item.offMarket,
    contaminantSummary: toFoodContaminantSearchSummary(item.contaminants),
    label: {
      nutrition: {
        basis: mealNutritionRows.length > 0
          ? normalized.nutrition.basis
          : "unavailable",
        rows: mealNutritionRows,
      },
      serving: normalized.serving,
    },
  };
}

function toFoodContaminantSearchSummary(
  contaminants: ProductContaminantSummary,
): FoodContaminantSearchSummary {
  const alerts = contaminants.alerts
    .slice(0, FOOD_MEAL_CONTAMINANT_ALERT_LIMIT)
    .map((alert) => ({
      contaminantKey: alert.contaminantKey,
      contaminantName: alert.contaminantName,
      concernLevel: alert.concernLevel,
      result: {
        operator: alert.result.operator,
        value: alert.result.value,
        unit: alert.result.unit,
        basis: alert.result.basis,
      },
      threshold: {
        value: alert.threshold.value,
        unit: alert.threshold.unit,
        basis: alert.threshold.basis,
        authority: alert.threshold.authority,
        name: alert.threshold.name,
      },
      ...(alert.screeningPolicy
        ? {
          screeningPolicy: {
            id: alert.screeningPolicy.id,
            assumedBodyWeightKg:
              alert.screeningPolicy.assumedBodyWeightKg,
            assumedServingsPerDay:
              alert.screeningPolicy.assumedServingsPerDay,
            servingGrams: alert.screeningPolicy.servingGrams,
            exposure: {
              value: alert.screeningPolicy.exposure.value,
              unit: alert.screeningPolicy.exposure.unit,
              basis: alert.screeningPolicy.exposure.basis,
            },
            ratio: alert.screeningPolicy.ratio,
          },
        }
        : {}),
      source: {
        name: alert.source.name,
        reportDate: alert.source.reportDate,
      },
    }));
  const observations = contaminants.observations
    .slice(0, FOOD_MEAL_CONTAMINANT_OBSERVATION_LIMIT)
    .map((observation) => ({
      contaminantKey: observation.contaminantKey,
      contaminantName: observation.contaminantName,
      result: {
        operator: observation.result.operator,
        value: observation.result.value,
        upperValue: observation.result.upperValue ?? null,
        unit: observation.result.unit,
        basis: observation.result.basis,
      },
      source: {
        name: observation.source.name,
        reportDate: observation.source.reportDate,
      },
    }));

  return {
    status: contaminants.status,
    murphConcernLevel: contaminants.murphConcernLevel,
    alertCount: contaminants.alertCount,
    alertsTruncated: contaminants.alertCount > alerts.length,
    alerts,
    observationCount: contaminants.observationCount,
    observationsTruncated:
      contaminants.observationCount > observations.length,
    observations,
  };
}

export async function searchPublicFoods(input: {
  q: string;
  limit: number;
}): Promise<PublicProductLabelSearchItem[]> {
  return await defaultPublicFoodsQueries().searchPublicFoods(input);
}

export async function getPublicFoodRecordById(input: {
  id: string;
}): Promise<PublicProductLabelRecord | null> {
  return await defaultPublicFoodsQueries().getPublicFoodRecordById(input);
}

export async function getPublicFoodEvidence(input: {
  id: string;
}): Promise<PublicProductTestEvidence> {
  return await defaultPublicFoodsQueries().getPublicFoodEvidence(input);
}

function defaultFoodsQueries(): ReturnType<typeof createFoodsQueries> {
  defaultFoodsQueriesInstance ??= createFoodsQueries(
    getDefaultProductLabelsPool(),
  );

  return defaultFoodsQueriesInstance;
}

function defaultPublicFoodsQueries(): ReturnType<typeof createPublicFoodsQueries> {
  defaultPublicFoodsQueriesInstance ??= createPublicFoodsQueries(
    getDefaultProductLabelsPool(),
  );

  return defaultPublicFoodsQueriesInstance;
}
