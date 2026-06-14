import {
  type FoodNutrition,
  MEAL_MICRONUTRIENT_KEYS,
  type MealMicronutrients,
  type MealNutrition,
  NUTRITION_CONFIDENCE_LEVELS,
  NUTRITION_PROVENANCE_SOURCES,
  type NutritionConfidenceLevel,
  type NutritionData,
  type NutritionProvenance,
  type NutritionProvenanceSource,
} from "@murphai/contracts";

import { optionalEnum, optionalString } from "./history/shared.ts";
import { requireObject, optionalFiniteNumber, stripUndefined } from "./bank/shared.ts";
import { VaultError } from "./errors.ts";

export function normalizeNutritionData(
  value: unknown,
  fieldName: string,
): NutritionData | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const object = requireObject(value, fieldName);
  if (Object.keys(object).length === 0) {
    return undefined;
  }

  const normalized = stripUndefined({
    calories: optionalFiniteNumber(object.calories, `${fieldName}.calories`, 0),
    proteinGrams: optionalFiniteNumber(object.proteinGrams, `${fieldName}.proteinGrams`, 0),
    carbsGrams: optionalFiniteNumber(object.carbsGrams, `${fieldName}.carbsGrams`, 0),
    fatGrams: optionalFiniteNumber(object.fatGrams, `${fieldName}.fatGrams`, 0),
    fiberGrams: optionalFiniteNumber(object.fiberGrams, `${fieldName}.fiberGrams`, 0),
    waterGrams: optionalFiniteNumber(object.waterGrams, `${fieldName}.waterGrams`, 0),
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeMealMicronutrients(
  value: unknown,
  fieldName: string,
): MealMicronutrients | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const object = requireObject(value, fieldName);
  const normalized: MealMicronutrients = {};
  for (const key of MEAL_MICRONUTRIENT_KEYS) {
    const numeric = optionalFiniteNumber(object[key], `${fieldName}.${key}`, 0);
    if (numeric !== undefined) {
      normalized[key] = numeric;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeNutritionProvenance(
  value: unknown,
  fieldName: string,
): NutritionProvenance | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const object = requireObject(value, fieldName);
  if (Object.keys(object).length === 0) {
    return undefined;
  }
  const source = optionalEnum(
    object.source,
    NUTRITION_PROVENANCE_SOURCES,
    `${fieldName}.source`,
  ) as NutritionProvenanceSource | undefined;
  if (!source) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName}.source is required.`);
  }

  const normalized = stripUndefined({
    source,
    confidence: optionalEnum(
      object.confidence,
      NUTRITION_CONFIDENCE_LEVELS,
      `${fieldName}.confidence`,
    ) as NutritionConfidenceLevel | undefined,
    sourceDetail: optionalString(object.sourceDetail, `${fieldName}.sourceDetail`, 240),
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeWrappedNutrition(
  value: unknown,
  fieldName: string,
  metricField: "perServing",
): FoodNutrition | undefined;
function normalizeWrappedNutrition(
  value: unknown,
  fieldName: string,
  metricField: "totals",
): MealNutrition | undefined;
function normalizeWrappedNutrition(
  value: unknown,
  fieldName: string,
  metricField: "perServing" | "totals",
): FoodNutrition | MealNutrition | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const object = requireObject(value, fieldName);
  if (Object.keys(object).length === 0) {
    return undefined;
  }

  const provenance = normalizeNutritionProvenance(
    object.provenance,
    `${fieldName}.provenance`,
  );

  if (metricField === "perServing") {
    const normalized = stripUndefined({
      perServing: normalizeNutritionData(object.perServing, `${fieldName}.perServing`),
      provenance,
    });

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  const normalized = stripUndefined({
    totals: normalizeNutritionData(object.totals, `${fieldName}.totals`),
    micros: normalizeMealMicronutrients(object.micros, `${fieldName}.micros`),
    provenance,
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeFoodNutrition(
  value: unknown,
  fieldName: string,
): FoodNutrition | undefined {
  return normalizeWrappedNutrition(value, fieldName, "perServing");
}

export function normalizeMealNutrition(
  value: unknown,
  fieldName: string,
): MealNutrition | undefined {
  return normalizeWrappedNutrition(value, fieldName, "totals");
}
