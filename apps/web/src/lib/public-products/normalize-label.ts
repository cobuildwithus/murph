import "server-only";

import type { PublicProductDetail, PublicProductKind } from "@murphai/contracts";

import { isRecord } from "../primitives";

type PublicProductUnknownCode = PublicProductDetail["unknowns"][number]["code"];

export interface NormalizedPublicProductLabel {
  serving: PublicProductDetail["serving"];
  ingredients: PublicProductDetail["ingredients"];
  nutrition: PublicProductDetail["nutrition"];
  unknownCodes: PublicProductUnknownCode[];
}

export function normalizePublicProductLabel(input: {
  kind: PublicProductKind;
  label: unknown;
  servingGrams: number | null;
}): NormalizedPublicProductLabel {
  const label = isRecord(input.label) ? input.label : {};
  const active = readIngredientRows(label.ingredientRows, 200);
  const other = readOtherIngredientRows(label);
  const statement = firstText(label.ingredientText, label.ingredients);
  const otherStatement = readText(label.otherIngredients, 16_000);
  const ingredients = {
    structure: active.length > 0 || other.length > 0
      ? "structured" as const
      : statement || otherStatement
        ? "statement_only" as const
        : "unavailable" as const,
    statement,
    otherStatement,
    active,
    other,
  };
  const nutrition = readNutrition(label, input.kind);
  const serving = readServing(label, input.servingGrams);
  const unknownCodes: PublicProductUnknownCode[] = [
    "FORMULA_REVISION_NOT_TRACKED",
  ];

  if (ingredients.structure === "statement_only") {
    unknownCodes.push("INGREDIENTS_STATEMENT_ONLY");
  } else if (ingredients.structure === "unavailable") {
    unknownCodes.push("INGREDIENTS_UNAVAILABLE");
  }

  if (nutrition.basis === "unavailable") {
    unknownCodes.push("NUTRITION_UNAVAILABLE");
  }

  if (serving?.grams == null) {
    unknownCodes.push("SERVING_MASS_UNAVAILABLE");
  }

  return {
    serving,
    ingredients,
    nutrition,
    unknownCodes,
  };
}

function readIngredientRows(
  value: unknown,
  limit: number,
): PublicProductDetail["ingredients"]["active"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, limit).flatMap((candidate) => {
    const ingredient = readIngredient(candidate);
    return ingredient ? [ingredient] : [];
  });
}

function readIngredient(
  value: unknown,
): PublicProductDetail["ingredients"]["active"][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readText(value.name, 512);
  if (!name) {
    return null;
  }

  const childRows = Array.isArray(value.nestedRows)
    ? value.nestedRows
    : Array.isArray(value.ingredients)
      ? value.ingredients
      : [];
  const children = childRows.slice(0, 50).flatMap((candidate) => {
    const child = readIngredientChild(candidate);
    return child ? [child] : [];
  });

  return {
    ...readIngredientChildFields(value, name),
    children,
  };
}

function readIngredientChild(
  value: unknown,
): PublicProductDetail["ingredients"]["active"][number]["children"][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readText(value.name, 512);
  return name ? readIngredientChildFields(value, name) : null;
}

function readIngredientChildFields(
  row: Record<string, unknown>,
  name: string,
): PublicProductDetail["ingredients"]["active"][number]["children"][number] {
  return {
    name,
    amount: readMeasuredValue(row.amount, row.unit),
    dailyValuePercent: readPercent(row.dailyValue),
    notes: readText(row.notes, 2_000),
  };
}

function readOtherIngredientRows(
  label: Record<string, unknown>,
): PublicProductDetail["ingredients"]["other"] {
  const nestedOther = isRecord(label.otheringredients)
    ? label.otheringredients.ingredients
    : undefined;
  const source = Array.isArray(label.otherIngredients)
    ? label.otherIngredients
    : Array.isArray(nestedOther)
      ? nestedOther
      : [];

  return source.slice(0, 200).flatMap((candidate) => {
    const ingredient = readIngredient(candidate);
    return ingredient ? [ingredient] : [];
  });
}

function readServing(
  label: Record<string, unknown>,
  servingGrams: number | null,
): PublicProductDetail["serving"] {
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

      if (description || amount !== null || unit || grams !== null) {
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

      if (description || amount !== null || unit || grams !== null) {
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
  kind: PublicProductKind,
): PublicProductDetail["nutrition"] {
  const groups: Array<{
    basis: PublicProductDetail["nutrition"]["rows"][number]["basis"];
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
  const caloriesRow: PublicProductDetail["nutrition"]["rows"][number] | null =
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
        : kind === "supplement" || bases.has("per_serving")
          ? "per_serving"
          : "unavailable",
    rows,
  };
}

function readNutritionRow(
  value: unknown,
  basis: PublicProductDetail["nutrition"]["rows"][number]["basis"],
): PublicProductDetail["nutrition"]["rows"][number] | null {
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
): PublicProductDetail["ingredients"]["active"][number]["amount"] {
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
