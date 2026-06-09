import assert from "node:assert/strict";

import { test, vi } from "vitest";

import {
  createVaultReadModel,
  readMealNutritionTotals,
  summarizeMealNutritionTotals,
  type CanonicalEntity,
} from "../src/index.ts";
import * as modelModule from "../src/model.ts";

function createMealEntity(
  entityId: string,
  occurredAt: CanonicalEntity["occurredAt"],
  attributes: CanonicalEntity["attributes"],
  overrides: Partial<CanonicalEntity> = {},
): CanonicalEntity {
  return {
    entityId,
    primaryLookupId: entityId,
    lookupIds: [entityId],
    family: "event",
    recordClass: "ledger",
    kind: "meal",
    status: "active",
    occurredAt,
    date: typeof occurredAt === "string" && occurredAt.length > 0
      ? occurredAt.slice(0, 10)
      : null,
    path: `ledger/events/${entityId}.jsonl`,
    title: "Meal",
    body: null,
    attributes,
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: null,
    tags: [],
    ...overrides,
  };
}

test("summarizeMealNutritionTotals aggregates range and day totals from meal nutrition", () => {
  const readModel = createVaultReadModel({
    vaultRoot: "./vault",
    entities: [
      createMealEntity("meal_1", "2026-04-10T12:00:00.000Z", {
        mealId: "meal_1",
        nutrition: {
          totals: {
            calories: 620,
            proteinGrams: 42,
            carbsGrams: 55,
            fatGrams: 21,
          },
        },
      }),
      createMealEntity("meal_2", "2026-04-10T19:00:00.000Z", {
        mealId: "meal_2",
        nutrition: {
          totals: {
            calories: 480,
            proteinGrams: 28,
            carbsGrams: 38,
            fiberGrams: 9,
          },
        },
      }),
      createMealEntity("meal_3", "2026-04-11T08:15:00.000Z", {
        mealId: "meal_3",
        nutrition: {
          totals: {
            calories: 390,
            proteinGrams: 24,
            fatGrams: 13,
            fiberGrams: 6,
          },
        },
      }),
      createMealEntity("meal_4", "2026-04-12T08:15:00.000Z", {
        mealId: "meal_4",
        nutrition: {
          totals: {
            calories: 999,
            proteinGrams: 99,
          },
        },
      }),
    ],
  });

  const result = summarizeMealNutritionTotals(readModel, {
    from: "2026-04-10",
    to: "2026-04-11",
  });

  assert.equal(result.mealCount, 3);
  assert.deepEqual(result.totals, {
    calories: { total: 1490, mealCount: 3 },
    proteinGrams: { total: 94, mealCount: 3 },
    carbsGrams: { total: 93, mealCount: 2 },
    fatGrams: { total: 34, mealCount: 2 },
    fiberGrams: { total: 15, mealCount: 2 },
  });
  assert.deepEqual(result.days, [
    {
      date: "2026-04-10",
      mealCount: 2,
      totals: {
        calories: { total: 1100, mealCount: 2 },
        proteinGrams: { total: 70, mealCount: 2 },
        carbsGrams: { total: 93, mealCount: 2 },
        fatGrams: { total: 21, mealCount: 1 },
        fiberGrams: { total: 9, mealCount: 1 },
      },
    },
    {
      date: "2026-04-11",
      mealCount: 1,
      totals: {
        calories: { total: 390, mealCount: 1 },
        proteinGrams: { total: 24, mealCount: 1 },
        carbsGrams: { total: null, mealCount: 0 },
        fatGrams: { total: 13, mealCount: 1 },
        fiberGrams: { total: 6, mealCount: 1 },
      },
    },
  ]);
});

test("summarizeMealNutritionTotals ignores malformed nutrition and handles fallback dates", () => {
  const readModel = createVaultReadModel({
    vaultRoot: "./vault",
    entities: [
      createMealEntity("meal_bad_attrs", "2026-04-12T08:00:00.000Z", {}),
      createMealEntity("meal_missing_totals", "2026-04-12T09:00:00.000Z", {
        mealId: "meal_missing_totals",
        nutrition: {
          provenance: {
            source: "estimated",
          },
        },
      }),
      createMealEntity("meal_bad_number", "2026-04-12T10:00:00.000Z", {
        mealId: "meal_bad_number",
        nutrition: {
          totals: {
            calories: Number.NaN,
            proteinGrams: 30,
          },
        },
      }),
      createMealEntity(
        "meal_fallback_date",
        "2026-04-13T07:30:00.000Z",
        {
          mealId: "meal_fallback_date",
          nutrition: {
            totals: {
              calories: 410,
              proteinGrams: 24,
            },
          },
        },
        {
          date: null,
        },
      ),
      createMealEntity(
        "meal_without_day_bucket",
        null,
        {
          mealId: "meal_without_day_bucket",
          nutrition: {
            totals: {
              calories: 250,
              fiberGrams: 7,
            },
          },
        },
        {
          date: null,
        },
      ),
    ],
  });

  const result = summarizeMealNutritionTotals(readModel);

  assert.equal(result.from, null);
  assert.equal(result.to, null);
  assert.equal(result.mealCount, 5);
  assert.deepEqual(result.totals, {
    calories: { total: 660, mealCount: 2 },
    proteinGrams: { total: 54, mealCount: 2 },
    carbsGrams: { total: null, mealCount: 0 },
    fatGrams: { total: null, mealCount: 0 },
    fiberGrams: { total: 7, mealCount: 1 },
  });
  assert.deepEqual(result.days, [
    {
      date: "2026-04-12",
      mealCount: 3,
      totals: {
        calories: { total: null, mealCount: 0 },
        proteinGrams: { total: 30, mealCount: 1 },
        carbsGrams: { total: null, mealCount: 0 },
        fatGrams: { total: null, mealCount: 0 },
        fiberGrams: { total: null, mealCount: 0 },
      },
    },
    {
      date: "2026-04-13",
      mealCount: 1,
      totals: {
        calories: { total: 410, mealCount: 1 },
        proteinGrams: { total: 24, mealCount: 1 },
        carbsGrams: { total: null, mealCount: 0 },
        fatGrams: { total: null, mealCount: 0 },
        fiberGrams: { total: null, mealCount: 0 },
      },
    },
  ]);
});

test("summarizeMealNutritionTotals keeps the latest imported meal revision", () => {
  const readModel = createVaultReadModel({
    vaultRoot: "./vault",
    entities: [
      createMealEntity("evt_old_imported_meal", "2026-04-14T08:00:00.000Z", {
        externalRef: {
          system: "junction",
          resourceType: "junction-cronometer-meal",
          resourceId: "meal-1",
          facet: "meal",
        },
        mealId: "meal_imported_1",
        nutrition: {
          totals: {
            calories: 400,
            proteinGrams: 10,
          },
        },
        recordedAt: "2026-04-14T08:01:00.000Z",
        source: "device",
      }),
      createMealEntity("evt_new_imported_meal", "2026-04-14T08:00:00.000Z", {
        externalRef: {
          system: "junction",
          resourceType: "junction-cronometer-meal",
          resourceId: "meal-1",
          facet: "meal",
        },
        mealId: "meal_imported_1",
        nutrition: {
          totals: {
            calories: 425,
            proteinGrams: 12,
          },
        },
        recordedAt: "2026-04-14T08:05:00.000Z",
        source: "device",
      }),
      createMealEntity("evt_old_imported_no_ref", "2026-04-14T12:00:00.000Z", {
        mealId: "meal_imported_without_ref",
        nutrition: {
          totals: {
            calories: 500,
            carbsGrams: 20,
          },
        },
        recordedAt: "2026-04-14T12:01:00.000Z",
        source: "device",
      }),
      createMealEntity("evt_new_imported_no_ref", "2026-04-14T12:00:00.000Z", {
        mealId: "meal_imported_without_ref",
        nutrition: {
          totals: {
            calories: 540,
            carbsGrams: 24,
          },
        },
        recordedAt: "2026-04-14T12:03:00.000Z",
        source: "device",
      }),
      createMealEntity("evt_manual_same_meal", "2026-04-14T19:00:00.000Z", {
        mealId: "meal_imported_1",
        nutrition: {
          totals: {
            calories: 100,
          },
        },
        recordedAt: "2026-04-14T19:01:00.000Z",
        source: "manual",
      }),
    ],
  });

  const result = summarizeMealNutritionTotals(readModel);

  assert.equal(result.mealCount, 3);
  assert.deepEqual(result.totals, {
    calories: { total: 1065, mealCount: 3 },
    proteinGrams: { total: 12, mealCount: 1 },
    carbsGrams: { total: 24, mealCount: 1 },
    fatGrams: { total: null, mealCount: 0 },
    fiberGrams: { total: null, mealCount: 0 },
  });
  assert.deepEqual(result.days, [
    {
      date: "2026-04-14",
      mealCount: 3,
      totals: {
        calories: { total: 1065, mealCount: 3 },
        proteinGrams: { total: 12, mealCount: 1 },
        carbsGrams: { total: 24, mealCount: 1 },
        fatGrams: { total: null, mealCount: 0 },
        fiberGrams: { total: null, mealCount: 0 },
      },
    },
  ]);
});

test("readMealNutritionTotals reads the vault before summarizing", async () => {
  const readModel = createVaultReadModel({
    vaultRoot: "./vault",
    entities: [
      createMealEntity("meal_1", "2026-04-14T08:00:00.000Z", {
        mealId: "meal_1",
        nutrition: {
          totals: {
            calories: 500,
          },
        },
      }),
    ],
  });
  const readVaultSpy = vi
    .spyOn(modelModule, "readVault")
    .mockResolvedValue(readModel);

  try {
    const result = await readMealNutritionTotals("./vault", {
      from: "2026-04-14",
      to: "2026-04-14",
    });

    assert.equal(readVaultSpy.mock.calls.length, 1);
    assert.deepEqual(readVaultSpy.mock.calls[0], ["./vault"]);
    assert.equal(result.mealCount, 1);
    assert.equal(result.totals.calories.total, 500);
    assert.equal(result.days[0]?.date, "2026-04-14");
  } finally {
    readVaultSpy.mockRestore();
  }
});
