import "server-only";

import { isRecord } from "./primitives";

type FoodNutritionRow = {
  name: string;
  amount: { value: number | null; unit: string | null; display: string | null } | null;
  dailyValuePercent: number | null;
  basis: "per_serving" | "per_100_g";
};

type NormalizedFoodNutritionLabel = {
  serving: {
    description: string | null;
    amount: number | null;
    unit: string | null;
    grams: number | null;
  } | null;
  nutrition: {
    basis: "per_serving" | "per_100_g" | "mixed" | "unavailable";
    rows: FoodNutritionRow[];
  };
};

export function normalizeFoodNutritionLabel(input: {
  label: unknown;
  servingGrams: number | null;
}): NormalizedFoodNutritionLabel {
  const label = isRecord(input.label) ? input.label : {};
  return {
    serving: readServing(label, input.servingGrams),
    nutrition: readNutrition(label),
  };
}

function readServing(
  label: Record<string, unknown>,
  servingGrams: number | null,
): NormalizedFoodNutritionLabel["serving"] {
  const fallbackGrams = readPositiveNumber(servingGrams);

  if (Array.isArray(label.servingSizes)) {
    for (const candidate of label.servingSizes.slice(0, 20)) {
      const text = readText(candidate, 512);
      if (text) {
        return {
          description: text,
          amount: null,
          unit: null,
          grams: fallbackGrams,
        };
      }

      if (!isRecord(candidate)) {
        continue;
      }

      const description = firstText(
        candidate.description,
        candidate.text,
        candidate.servingSize,
      );
      const amount = readPositiveNumber(candidate.amount);
      const unit = readText(candidate.unit, 64);
      const grams = readPositiveNumber(candidate.grams) ?? fallbackGrams;

      if ([description, amount, unit, grams].some((value) => value !== null)) {
        return { description, amount, unit, grams };
      }
    }
  }

  if (Array.isArray(label.portions)) {
    for (const candidate of label.portions.slice(0, 20)) {
      if (!isRecord(candidate)) {
        continue;
      }

      const description = firstText(
        candidate.description,
        candidate.text,
      );
      const amount = readPositiveNumber(candidate.amount);
      const unit = readText(candidate.unit, 64);
      const grams = readPositiveNumber(candidate.gramWeight) ?? fallbackGrams;

      if ([description, amount, unit, grams].some((value) => value !== null)) {
        return { description, amount, unit, grams };
      }
    }
  }

  const description = readText(label.householdServing, 512);
  const amount = readPositiveNumber(label.servingSize);
  const unit = readText(label.servingSizeUnit, 64);
  const grams = fallbackGrams;

  if (!description && amount == null && !unit && grams == null) {
    return null;
  }

  return {
    description,
    amount,
    unit,
    grams,
  };
}

function readNutrition(
  label: Record<string, unknown>,
): NormalizedFoodNutritionLabel["nutrition"] {
  const groups: Array<{
    basis: FoodNutritionRow["basis"];
    rows: unknown[];
  }> = [];

  if (Array.isArray(label.nutrientsPerServing)) {
    groups.push({ basis: "per_serving", rows: label.nutrientsPerServing });
  }
  if (Array.isArray(label.nutritionRows)) {
    groups.push({ basis: "per_serving", rows: label.nutritionRows });
  }
  if (Array.isArray(label.nutrientsPer100g)) {
    groups.push({ basis: "per_100_g", rows: label.nutrientsPer100g });
  }

  const sourceRows = groups.flatMap((group) =>
    group.rows.flatMap((candidate) => {
      const row = readNutritionRow(candidate, group.basis);
      return row ? [row] : [];
    }),
  );
  const boundedSourceRows = sourceRows.slice(0, 256);
  const calories = readNonnegativeNumber(label.calories);
  const hasCaloriesRow = boundedSourceRows.some((row) =>
    row.name.toLowerCase() === "calories");
  const caloriesRow: FoodNutritionRow | null =
    calories !== null && !hasCaloriesRow
      ? {
          name: "Calories",
          amount: readMeasuredValue(label.calories, "kcal"),
          dailyValuePercent: null,
          basis: "per_serving",
        }
      : null;
  const rows = (
    caloriesRow ? [caloriesRow, ...boundedSourceRows] : boundedSourceRows
  ).slice(0, 256);

  if (rows.length === 0) {
    return {
      basis: "unavailable",
      rows: [],
    };
  }

  const bases = new Set(rows.map((row) => row.basis));
  return {
    basis: bases.size > 1
      ? "mixed"
      : bases.has("per_100_g")
        ? "per_100_g"
        : bases.has("per_serving")
          ? "per_serving"
          : "unavailable",
    rows,
  };
}

function readNutritionRow(
  value: unknown,
  basis: FoodNutritionRow["basis"],
): FoodNutritionRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readText(value.name, 512);
  if (!name) {
    return null;
  }

  return {
    name,
    amount: readMeasuredValue(value.amount ?? value.value, value.unit),
    dailyValuePercent: readPercent(value.dailyValue),
    basis,
  };
}

function readMeasuredValue(
  rawValue: unknown,
  rawUnit: unknown,
): FoodNutritionRow["amount"] {
  const value = readNonnegativeNumber(rawValue);
  const display = readDisplayText(rawValue);
  const unit = readText(rawUnit, 64);

  if (value == null && display == null && unit == null) {
    return null;
  }

  return {
    value,
    unit,
    display,
  };
}

function readDisplayText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(value);
  }
  return readText(value, 256);
}

function readPercent(value: unknown): number | null {
  if (typeof value === "string") {
    return readNonnegativeNumber(value.trim().replace(/%$/u, ""));
  }
  return readNonnegativeNumber(value);
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = readNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function readNonnegativeNumber(value: unknown): number | null {
  const parsed = readNumber(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!/^(?:\d+|\d*\.\d+)$/u.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readText(value, 16_000);
    if (text) {
      return text;
    }
  }
  return null;
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized.length <= maxLength
    ? normalized
    : normalized.slice(0, maxLength).trimEnd();
}
