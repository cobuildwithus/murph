import assert from "node:assert/strict";

import { test } from "vitest";

import { VaultError } from "../src/errors.ts";
import {
  normalizeFoodNutrition,
  normalizeMealNutrition,
  normalizeNutritionData,
  normalizeNutritionProvenance,
} from "../src/nutrition.ts";

test("nutrition helpers normalize optional top-level nutrition objects", () => {
  assert.equal(normalizeNutritionData(undefined, "nutrition"), undefined);
  assert.equal(normalizeNutritionData({}, "nutrition"), undefined);
  assert.deepEqual(
    normalizeFoodNutrition(
      {
        perServing: {
          calories: 320,
          proteinGrams: 18,
        },
        provenance: {
          source: "label",
          confidence: "high",
        },
      },
      "nutrition",
    ),
    {
      perServing: {
        calories: 320,
        proteinGrams: 18,
      },
      provenance: {
        source: "label",
        confidence: "high",
      },
    },
  );
  assert.deepEqual(
    normalizeMealNutrition(
      {
        totals: {
          calories: 640,
          carbsGrams: 52,
        },
      },
      "nutrition",
    ),
    {
      totals: {
        calories: 640,
        carbsGrams: 52,
      },
    },
  );
});

test("nutrition helpers reject invalid shapes and require provenance source", () => {
  assert.equal(normalizeNutritionProvenance({}, "nutrition.provenance"), undefined);
  assert.equal(normalizeFoodNutrition({}, "nutrition"), undefined);
  assert.equal(normalizeMealNutrition({}, "nutrition"), undefined);

  assert.throws(
    () => normalizeNutritionData("invalid", "nutrition"),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "nutrition must be an object.",
  );
  assert.throws(
    () => normalizeNutritionData({ calories: -1 }, "nutrition"),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "nutrition.calories must be >= 0.",
  );
  assert.throws(
    () => normalizeNutritionProvenance({ confidence: "high" }, "nutrition.provenance"),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "nutrition.provenance.source is required.",
  );
});
