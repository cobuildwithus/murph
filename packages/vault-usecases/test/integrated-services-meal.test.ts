import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import { importWithMocks } from "./mock-import.ts";

afterEach(() => {
  vi.doUnmock("../src/usecases/runtime.ts");
  vi.restoreAllMocks();
});

test("integrated core addMeal forwards structured meal fields to core", async () => {
  const normalizedNutrition = {
    totals: {
      calories: 690,
      proteinGrams: 42,
    },
    provenance: {
      source: "estimated" as const,
      confidence: "medium" as const,
    },
  };
  const addMeal = vi.fn(async (input: Record<string, unknown>) => ({
    mealId: "meal_01JTESTMEALADDPARITY00000000",
    event: {
      id: "evt_01JTESTMEALADDPARITY00000000",
      occurredAt: input.occurredAt ?? null,
      note: "Normalized meal note",
      source: "manual" as const,
      ingredients: ["salmon", "rice"],
      nutrition: normalizedNutrition,
    },
    manifestPath: "raw/meals/2026/03/meal_01JTESTMEALADDPARITY00000000/manifest.json",
    photo: null,
    audio: null,
  }));
  const loadCoreRuntime = vi.fn(async () => ({
    addMeal,
  }));
  const loadQueryRuntime = vi.fn();

  const integratedServicesModule = await importWithMocks<
    typeof import("../src/usecases/integrated-services.ts")
  >("../src/usecases/integrated-services.ts", {
    "../src/usecases/runtime.ts": () => ({
      createUnwiredMethod: vi.fn(),
      loadCoreRuntime,
      loadImporterRuntime: vi.fn(),
      loadQueryRuntime,
    }),
  });

  const services = integratedServicesModule.createIntegratedVaultServices();
  const nutrition = {
    totals: {
      calories: 690,
      proteinGrams: 42,
    },
    provenance: {
      source: "estimated" as const,
    },
  };

  const result = await services.core.addMeal({
    vault: "./vault",
    requestId: null,
    occurredAt: "2026-03-11T18:30:00.000Z",
    note: "  salmon rice bowl  ",
    source: "derived",
    ingredients: [" salmon ", "rice", "salmon"],
    nutrition,
  });

  assert.deepEqual(addMeal.mock.calls, [[{
    vaultRoot: "./vault",
    photoPath: undefined,
    audioPath: undefined,
    note: "  salmon rice bowl  ",
    occurredAt: "2026-03-11T18:30:00.000Z",
    source: "derived",
    ingredients: [" salmon ", "rice", "salmon"],
    nutrition,
  }]]);
  assert.deepEqual(result, {
    vault: "./vault",
    mealId: "meal_01JTESTMEALADDPARITY00000000",
    eventId: "evt_01JTESTMEALADDPARITY00000000",
    lookupId: "meal_01JTESTMEALADDPARITY00000000",
    occurredAt: "2026-03-11T18:30:00.000Z",
    photoPath: null,
    audioPath: null,
    manifestFile: "raw/meals/2026/03/meal_01JTESTMEALADDPARITY00000000/manifest.json",
    note: "Normalized meal note",
    source: "manual",
    ingredients: ["salmon", "rice"],
    nutrition: normalizedNutrition,
  });
  assert.equal(loadCoreRuntime.mock.calls.length, 1);
  assert.equal(loadQueryRuntime.mock.calls.length, 0);
});
