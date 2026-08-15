import {
  extractIsoDatePrefix,
  MEAL_MICRONUTRIENT_DEFINITIONS,
  type MealMicronutrientKey,
} from "@murphai/contracts";
import type { CanonicalEntity } from "./canonical-entities.ts";

import {
  listEntities,
  readVault,
  type VaultReadModel,
} from "./model.ts";

export interface MealNutritionMetricTotal {
  total: number | null;
  mealCount: number;
}

export interface MealNutritionTotals {
  calories: MealNutritionMetricTotal;
  proteinGrams: MealNutritionMetricTotal;
  carbsGrams: MealNutritionMetricTotal;
  fatGrams: MealNutritionMetricTotal;
  fiberGrams: MealNutritionMetricTotal;
}

export interface MealNutritionDayTotal {
  date: string;
  mealCount: number;
  totals: MealNutritionTotals;
}

export interface MealNutritionTotalsOptions {
  from?: string;
  to?: string;
}

export interface MealNutritionTotalsResult {
  from: string | null;
  to: string | null;
  mealCount: number;
  totals: MealNutritionTotals;
  days: MealNutritionDayTotal[];
}

export type MealNutrientKey = "waterGrams" | MealMicronutrientKey;
export type MealNutrientCategory = "water" | "mineral" | "trace_element" | "vitamin";
export type MealNutrientUnit = "g" | "mg" | "mcg";

export interface MealNutrientTotal {
  key: MealNutrientKey;
  label: string;
  category: MealNutrientCategory;
  unit: MealNutrientUnit;
  total: number | null;
  contributingMealCount: number;
}

export interface MealNutrientDayTotal {
  date: string;
  mealCount: number;
  nutrients: MealNutrientTotal[];
}

export interface MealNutrientTotalsResult {
  from: string | null;
  to: string | null;
  mealCount: number;
  nutrients: MealNutrientTotal[];
  days: MealNutrientDayTotal[];
}

type NutritionMetricKey =
  | "calories"
  | "proteinGrams"
  | "carbsGrams"
  | "fatGrams"
  | "fiberGrams";

type NutritionMetricState = {
  total: number;
  mealCount: number;
};

type NutritionAccumulator = Record<NutritionMetricKey, NutritionMetricState>;

interface MealNutrientDefinition {
  key: MealNutrientKey;
  label: string;
  category: MealNutrientCategory;
  unit: MealNutrientUnit;
  source: "totals" | "micros";
}

type MealNutrientAccumulator = Map<MealNutrientKey, NutritionMetricState>;

const NUTRITION_METRIC_KEYS: NutritionMetricKey[] = [
  "calories",
  "proteinGrams",
  "carbsGrams",
  "fatGrams",
  "fiberGrams",
];

const MEAL_NUTRIENT_DEFINITIONS: readonly MealNutrientDefinition[] = Object.freeze([
  {
    category: "water",
    key: "waterGrams",
    label: "Water",
    source: "totals",
    unit: "g",
  },
  ...MEAL_MICRONUTRIENT_DEFINITIONS.map((definition) => ({
    ...definition,
    source: "micros" as const,
  })),
]);

function createNutritionAccumulator(): NutritionAccumulator {
  return {
    calories: { total: 0, mealCount: 0 },
    proteinGrams: { total: 0, mealCount: 0 },
    carbsGrams: { total: 0, mealCount: 0 },
    fatGrams: { total: 0, mealCount: 0 },
    fiberGrams: { total: 0, mealCount: 0 },
  };
}

function createMealNutrientAccumulator(): MealNutrientAccumulator {
  return new Map(
    MEAL_NUTRIENT_DEFINITIONS.map(({ key }) => [
      key,
      { total: 0, mealCount: 0 },
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function selectMealNutritionTotals(
  attributes: Record<string, unknown>,
): Record<string, unknown> | null {
  const nutrition = attributes.nutrition;
  if (!isRecord(nutrition)) {
    return null;
  }

  const totals = nutrition.totals;
  return isRecord(totals) ? totals : null;
}

function readNutritionMetricValue(
  attributes: Record<string, unknown>,
  metric: NutritionMetricKey,
): number | null {
  const totals = selectMealNutritionTotals(attributes);
  return totals ? asFiniteNumber(totals[metric]) : null;
}

function readMealNutrientValue(
  attributes: Record<string, unknown>,
  definition: MealNutrientDefinition,
): number | null {
  const nutrition = attributes.nutrition;
  if (!isRecord(nutrition)) {
    return null;
  }

  const source = nutrition[definition.source];
  return isRecord(source) ? asFiniteNumber(source[definition.key]) : null;
}

function toMealNutritionTotals(
  accumulator: NutritionAccumulator,
): MealNutritionTotals {
  return {
    calories: {
      total:
        accumulator.calories.mealCount > 0 ? accumulator.calories.total : null,
      mealCount: accumulator.calories.mealCount,
    },
    proteinGrams: {
      total:
        accumulator.proteinGrams.mealCount > 0
          ? accumulator.proteinGrams.total
          : null,
      mealCount: accumulator.proteinGrams.mealCount,
    },
    carbsGrams: {
      total:
        accumulator.carbsGrams.mealCount > 0 ? accumulator.carbsGrams.total : null,
      mealCount: accumulator.carbsGrams.mealCount,
    },
    fatGrams: {
      total:
        accumulator.fatGrams.mealCount > 0 ? accumulator.fatGrams.total : null,
      mealCount: accumulator.fatGrams.mealCount,
    },
    fiberGrams: {
      total:
        accumulator.fiberGrams.mealCount > 0 ? accumulator.fiberGrams.total : null,
      mealCount: accumulator.fiberGrams.mealCount,
    },
  };
}

function toMealNutrientTotals(
  accumulator: MealNutrientAccumulator,
): MealNutrientTotal[] {
  return MEAL_NUTRIENT_DEFINITIONS.map((definition) => {
    const state = accumulator.get(definition.key);
    const contributingMealCount = state?.mealCount ?? 0;

    return {
      category: definition.category,
      contributingMealCount,
      key: definition.key,
      label: definition.label,
      total: contributingMealCount > 0 ? state?.total ?? null : null,
      unit: definition.unit,
    };
  });
}

function mealDate(record: CanonicalEntity): string | null {
  if (typeof record.date === "string" && record.date.length > 0) {
    return record.date;
  }

  if (typeof record.occurredAt === "string" && record.occurredAt.length > 0) {
    return extractIsoDatePrefix(record.occurredAt);
  }

  return null;
}

function mealRevisionKey(record: CanonicalEntity): string | null {
  // Only device imports produce revisions of the same upstream meal; manual
  // meals are append-only and never collapse, even when they carry an
  // externalRef.
  if (!isRecord(record.attributes) || readString(record.attributes.source) !== "device") {
    return null;
  }

  const externalRef = record.attributes.externalRef;
  if (isRecord(externalRef)) {
    const system = readString(externalRef.system);
    const resourceType = readString(externalRef.resourceType);
    const resourceId = readString(externalRef.resourceId);
    const facet = readString(externalRef.facet);
    if (system && resourceType && resourceId) {
      return JSON.stringify(["externalRef", system, resourceType, resourceId, facet]);
    }
  }

  const mealId = readString(record.attributes.mealId);
  return mealId ? JSON.stringify(["deviceMeal", mealId]) : null;
}

function revisionTimestampMillis(value: unknown): number {
  const timestamp = readString(value);
  if (!timestamp) {
    return Number.NEGATIVE_INFINITY;
  }

  const millis = Date.parse(timestamp);
  return Number.isFinite(millis) ? millis : Number.NEGATIVE_INFINITY;
}

function isLaterMealRevision(candidate: CanonicalEntity, current: CanonicalEntity): boolean {
  const candidateRecordedAt = revisionTimestampMillis(candidate.attributes.recordedAt);
  const currentRecordedAt = revisionTimestampMillis(current.attributes.recordedAt);
  if (candidateRecordedAt !== currentRecordedAt) {
    return candidateRecordedAt > currentRecordedAt;
  }

  const candidateOccurredAt = revisionTimestampMillis(candidate.occurredAt);
  const currentOccurredAt = revisionTimestampMillis(current.occurredAt);
  if (candidateOccurredAt !== currentOccurredAt) {
    return candidateOccurredAt > currentOccurredAt;
  }

  return candidate.entityId.localeCompare(current.entityId) > 0;
}

// Imported meal corrections land as distinct ledger records (each revision
// hashes to its own event id), so totals must collapse them here rather than
// relying on the read model's same-id revision collapse.
function selectLatestMealRevisions(meals: readonly CanonicalEntity[]): CanonicalEntity[] {
  const unkeyedMeals: CanonicalEntity[] = [];
  const latestByKey = new Map<string, CanonicalEntity>();

  for (const meal of meals) {
    const key = mealRevisionKey(meal);
    if (!key) {
      unkeyedMeals.push(meal);
      continue;
    }

    const current = latestByKey.get(key);
    if (!current || isLaterMealRevision(meal, current)) {
      latestByKey.set(key, meal);
    }
  }

  return [...unkeyedMeals, ...latestByKey.values()];
}

function selectMealNutritionRecords(
  readModel: VaultReadModel,
  options: MealNutritionTotalsOptions,
): CanonicalEntity[] {
  const latestMeals = selectLatestMealRevisions(listEntities(readModel, {
    families: ["event"],
    kinds: ["meal"],
  }));

  return latestMeals.filter((meal) => {
    const date = mealDate(meal);
    if (options.from && (!date || date < options.from)) {
      return false;
    }
    if (options.to && date && date > options.to) {
      return false;
    }
    return true;
  });
}

export function summarizeMealNutritionTotals(
  readModel: VaultReadModel,
  options: MealNutritionTotalsOptions = {},
): MealNutritionTotalsResult {
  const meals = selectMealNutritionRecords(readModel, options);

  const totals = createNutritionAccumulator();
  const days = new Map<
    string,
    {
      mealCount: number;
      totals: NutritionAccumulator;
    }
  >();

  for (const meal of meals) {
    if (!isRecord(meal.attributes)) {
      continue;
    }

    const date = mealDate(meal);
    const dayState = date
      ? days.get(date) ?? {
          mealCount: 0,
          totals: createNutritionAccumulator(),
        }
      : null;

    for (const metric of NUTRITION_METRIC_KEYS) {
      const metricValue = readNutritionMetricValue(meal.attributes, metric);
      if (metricValue === null) {
        continue;
      }

      totals[metric].total += metricValue;
      totals[metric].mealCount += 1;

      if (dayState) {
        dayState.totals[metric].total += metricValue;
        dayState.totals[metric].mealCount += 1;
      }
    }

    if (date && dayState) {
      dayState.mealCount += 1;
      days.set(date, dayState);
    }
  }

  return {
    from: options.from ?? null,
    to: options.to ?? null,
    mealCount: meals.length,
    totals: toMealNutritionTotals(totals),
    days: [...days.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, day]) => ({
        date,
        mealCount: day.mealCount,
        totals: toMealNutritionTotals(day.totals),
      })),
  };
}

export function summarizeMealNutrientTotals(
  readModel: VaultReadModel,
  options: MealNutritionTotalsOptions = {},
): MealNutrientTotalsResult {
  const meals = selectMealNutritionRecords(readModel, options);
  const nutrients = createMealNutrientAccumulator();
  const days = new Map<
    string,
    {
      mealCount: number;
      nutrients: MealNutrientAccumulator;
    }
  >();

  for (const meal of meals) {
    if (!isRecord(meal.attributes)) {
      continue;
    }

    const date = mealDate(meal);
    const dayState = date
      ? days.get(date) ?? {
          mealCount: 0,
          nutrients: createMealNutrientAccumulator(),
        }
      : null;

    for (const definition of MEAL_NUTRIENT_DEFINITIONS) {
      const nutrientValue = readMealNutrientValue(meal.attributes, definition);
      if (nutrientValue === null) {
        continue;
      }

      const nutrientState = nutrients.get(definition.key);
      if (nutrientState) {
        nutrientState.total += nutrientValue;
        nutrientState.mealCount += 1;
      }

      const dayNutrientState = dayState?.nutrients.get(definition.key);
      if (dayNutrientState) {
        dayNutrientState.total += nutrientValue;
        dayNutrientState.mealCount += 1;
      }
    }

    if (date && dayState) {
      dayState.mealCount += 1;
      days.set(date, dayState);
    }
  }

  return {
    from: options.from ?? null,
    to: options.to ?? null,
    mealCount: meals.length,
    nutrients: toMealNutrientTotals(nutrients),
    days: [...days.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, day]) => ({
        date,
        mealCount: day.mealCount,
        nutrients: toMealNutrientTotals(day.nutrients),
      })),
  };
}

export async function readMealNutritionTotals(
  vaultRoot: string,
  options: MealNutritionTotalsOptions = {},
): Promise<MealNutritionTotalsResult> {
  const readModel = await readVault(vaultRoot);
  return summarizeMealNutritionTotals(readModel, options);
}

export async function readMealNutrientTotals(
  vaultRoot: string,
  options: MealNutritionTotalsOptions = {},
): Promise<MealNutrientTotalsResult> {
  const readModel = await readVault(vaultRoot);
  return summarizeMealNutrientTotals(readModel, options);
}
