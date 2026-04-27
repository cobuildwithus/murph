import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { assertContract, sharePackSchema } from "@murphai/contracts";

import {
  buildSharePackFromVault,
  importSharePackIntoVault,
  initializeVault,
  readFood,
  readRegimen,
  readRecipe,
  upsertFood,
  upsertRegimen,
  upsertRecipe,
} from "../src/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("share packs export one food with attached supplement regimens and import the full bundle", async () => {
  const sourceVault = await makeTempDirectory("murph-share-pack-source");
  const destinationVault = await makeTempDirectory("murph-share-pack-destination");

  await initializeVault({ vaultRoot: sourceVault });
  await initializeVault({ vaultRoot: destinationVault });

  const creatine = await upsertRegimen({
    vaultRoot: sourceVault,
    title: "Creatine monohydrate",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
  });
  const collagen = await upsertRegimen({
    vaultRoot: sourceVault,
    title: "Collagen peptides",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
  });
  const fiber = await upsertRegimen({
    vaultRoot: sourceVault,
    title: "Inulin fiber",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
  });
  const smoothie = await upsertFood({
    vaultRoot: sourceVault,
    title: "Morning Smoothie",
    kind: "smoothie",
    serving: "1 smoothie",
    ingredients: ["banana", "blueberries", "protein powder"],
    attachedRegimenIds: [
      creatine.record.entity.regimenId,
      collagen.record.entity.regimenId,
      fiber.record.entity.regimenId,
    ],
  });

  const pack = await buildSharePackFromVault({
    vaultRoot: sourceVault,
    foods: [{ id: smoothie.record.foodId }],
    includeAttachedRegimens: true,
    logMeal: {
      food: {
        id: smoothie.record.foodId,
      },
    },
  });

  assert.equal(pack.entities.length, 4);
  const exportedFood = pack.entities.find((entity) => entity.kind === "food");
  assert.ok(exportedFood);
  assert.equal(exportedFood?.payload.title, "Morning Smoothie");
  assert.deepEqual(
    [...(exportedFood?.payload.attachedRegimenRefs ?? [])].sort(),
    pack.entities
      .filter((entity) => entity.kind === "regimen")
      .map((entity) => entity.ref)
      .sort(),
  );
  assert.equal(pack.afterImport?.logMeal?.foodRef, exportedFood?.ref);

  const imported = await importSharePackIntoVault({
    vaultRoot: destinationVault,
    pack,
  });
  assert.equal(imported.regimens.length, 3);
  assert.ok(imported.regimens.every((record) => typeof record.regimenId === "string"));
  assert.equal(imported.foods.length, 1);
  assert.ok(imported.meal);

  const importedFood = await readFood({
    vaultRoot: destinationVault,
    foodId: imported.foods[0]?.foodId,
  });
  assert.equal(importedFood.title, "Morning Smoothie");
  assert.equal(importedFood.attachedRegimenIds?.length, 3);
});

test("share packs dedupe repeated recipe selections and fall back to the first entity title when no explicit title is provided", async () => {
  const sourceVault = await makeTempDirectory("murph-share-pack-recipe-dedupe-source");
  const destinationVault = await makeTempDirectory("murph-share-pack-recipe-dedupe-destination");

  await initializeVault({ vaultRoot: sourceVault });
  await initializeVault({ vaultRoot: destinationVault });

  const recipe = await upsertRecipe({
    vaultRoot: sourceVault,
    title: "Sheet Pan Salmon Bowls",
    status: "saved",
    ingredients: ["2 salmon fillets", "2 cups cooked rice"],
    steps: ["Roast the broccoli.", "Add the salmon and finish roasting."],
  });

  const pack = await buildSharePackFromVault({
    vaultRoot: sourceVault,
    recipes: [
      { id: recipe.record.recipeId },
      { id: recipe.record.recipeId },
    ],
  });

  assert.equal(pack.title, "Sheet Pan Salmon Bowls");
  assert.equal(pack.entities.length, 1);
  assert.equal(pack.entities[0]?.kind, "recipe");

  const imported = await importSharePackIntoVault({
    vaultRoot: destinationVault,
    pack,
  });

  assert.equal(imported.recipes.length, 1);

  const importedRecipe = await readRecipe({
    vaultRoot: destinationVault,
    recipeId: imported.recipes[0]?.recipeId,
  });
  assert.equal(importedRecipe.title, "Sheet Pan Salmon Bowls");
});

test("share packs dedupe explicitly selected regimens that are also attached to exported foods", async () => {
  const sourceVault = await makeTempDirectory("murph-share-pack-dedupe-source");
  const destinationVault = await makeTempDirectory("murph-share-pack-dedupe-destination");

  await initializeVault({ vaultRoot: sourceVault });
  await initializeVault({ vaultRoot: destinationVault });

  const creatine = await upsertRegimen({
    vaultRoot: sourceVault,
    title: "Creatine monohydrate",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
  });
  const smoothie = await upsertFood({
    vaultRoot: sourceVault,
    title: "Morning Smoothie",
    kind: "smoothie",
    serving: "1 smoothie",
    ingredients: ["banana", "creatine"],
    attachedRegimenIds: [creatine.record.entity.regimenId],
  });

  const pack = await buildSharePackFromVault({
    vaultRoot: sourceVault,
    foods: [{ id: smoothie.record.foodId }],
    regimens: [{ id: creatine.record.entity.regimenId }],
  });

  const exportedRegimenEntities = pack.entities.filter((entity) => entity.kind === "regimen");
  const exportedFood = pack.entities.find((entity) => entity.kind === "food");

  assert.equal(exportedRegimenEntities.length, 1);
  assert.equal(pack.entities.length, 2);
  assert.deepEqual(exportedFood?.payload.attachedRegimenRefs, exportedRegimenEntities.map((entity) => entity.ref));

  const imported = await importSharePackIntoVault({
    vaultRoot: destinationVault,
    pack,
  });

  const importedFood = await readFood({
    vaultRoot: destinationVault,
    foodId: imported.foods[0]?.foodId,
  });

  assert.equal(imported.regimens.length, 1);
  assert.equal(imported.foods.length, 1);
  assert.equal(importedFood.attachedRegimenIds?.length, 1);
});

test("share packs can omit attached regimens while normalizing meal follow-up fields", async () => {
  const sourceVault = await makeTempDirectory("murph-share-pack-meal-source");
  const destinationVault = await makeTempDirectory("murph-share-pack-meal-destination");

  await initializeVault({ vaultRoot: sourceVault });
  await initializeVault({ vaultRoot: destinationVault });

  const regimen = await upsertRegimen({
    vaultRoot: sourceVault,
    title: "Collagen peptides",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
  });
  const food = await upsertFood({
    vaultRoot: sourceVault,
    title: "Morning Smoothie",
    kind: "smoothie",
    serving: "1 smoothie",
    ingredients: ["banana", "collagen"],
    attachedRegimenIds: [regimen.record.entity.regimenId],
  });

  const pack = await buildSharePackFromVault({
    vaultRoot: sourceVault,
    foods: [{ id: food.record.foodId }],
    regimens: [{ id: regimen.record.entity.regimenId }],
    includeAttachedRegimens: false,
    logMeal: {
      food: { id: food.record.foodId },
      note: "  Keep this meal  ",
      occurredAt: Date.parse("2026-03-26T12:34:56.000Z"),
    },
  });

  const exportedRegimenEntities = pack.entities.filter((entity) => entity.kind === "regimen");
  const exportedFood = pack.entities.find((entity) => entity.kind === "food");

  assert.equal(exportedRegimenEntities.length, 1);
  assert.equal(exportedFood?.payload.attachedRegimenRefs, undefined);
  assert.deepEqual(pack.afterImport?.logMeal, {
    foodRef: exportedFood?.ref,
    note: "Keep this meal",
    occurredAt: "2026-03-26T12:34:56.000Z",
  });

  const imported = await importSharePackIntoVault({
    vaultRoot: destinationVault,
    pack,
  });

  assert.equal(imported.foods.length, 1);
  assert.equal(imported.foods[0]?.attachedRegimenIds?.length, 1);
  assert.equal(imported.meal?.event.note, "Shared meal: Morning Smoothie\n\nKeep this meal");
  assert.equal(imported.meal?.event.occurredAt, "2026-03-26T12:34:56.000Z");
});

test("share packs preserve empty-link exports, normalize related regimen links, and accept Date and string meal timestamps", async () => {
  const sourceVault = await makeTempDirectory("murph-share-pack-link-source");
  const destinationVault = await makeTempDirectory("murph-share-pack-link-destination");

  await initializeVault({ vaultRoot: sourceVault });
  await initializeVault({ vaultRoot: destinationVault });

  const standaloneRegimen = await upsertRegimen({
    vaultRoot: sourceVault,
    title: "Magnesium glycinate",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
  });
  const linkedRegimen = await upsertRegimen({
    vaultRoot: sourceVault,
    title: "Sleep support stack",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
    relatedRegimenIds: [standaloneRegimen.record.entity.regimenId],
  });
  const recipe = await upsertRecipe({
    vaultRoot: sourceVault,
    title: "Simple Recovery Bowl",
    status: "saved",
    ingredients: ["rice", "salmon", "greens"],
    steps: ["Assemble the bowl."],
  });
  const food = await upsertFood({
    vaultRoot: sourceVault,
    title: "Simple Recovery Bowl",
    kind: "bowl",
    serving: "1 bowl",
    ingredients: ["rice", "salmon", "greens"],
  });

  const pack = await buildSharePackFromVault({
    vaultRoot: sourceVault,
    title: "  Standalone share pack  ",
    regimens: [
      { id: standaloneRegimen.record.entity.regimenId },
      { id: linkedRegimen.record.entity.regimenId },
    ],
    recipes: [{ id: recipe.record.recipeId }],
    foods: [{ id: food.record.foodId }],
    logMeal: {
      food: { id: food.record.foodId },
      note: "   ",
      occurredAt: new Date("2026-03-26T12:34:56.000Z"),
    },
  });

  const exportedStandaloneRegimen = pack.entities.find(
    (entity) => entity.kind === "regimen" && entity.payload.title === "Magnesium glycinate",
  );
  const exportedLinkedRegimen = pack.entities.find(
    (entity) => entity.kind === "regimen" && entity.payload.title === "Sleep support stack",
  );
  const exportedRecipe = pack.entities.find((entity) => entity.kind === "recipe");
  const exportedFood = pack.entities.find((entity) => entity.kind === "food");

  assert.equal(pack.title, "Standalone share pack");
  assert.equal(exportedStandaloneRegimen?.payload.links, undefined);
  assert.deepEqual(exportedLinkedRegimen?.payload.links, [
    {
      type: "related_regimen",
      targetId: standaloneRegimen.record.entity.regimenId,
    },
  ]);
  assert.equal(exportedRecipe?.payload.links, undefined);
  assert.equal(exportedFood?.payload.links, undefined);
  assert.equal(exportedFood?.payload.attachedRegimenRefs, undefined);
  assert.deepEqual(pack.afterImport?.logMeal, {
    foodRef: exportedFood?.ref,
    occurredAt: "2026-03-26T12:34:56.000Z",
  });

  const stringTimestampPack = await buildSharePackFromVault({
    vaultRoot: sourceVault,
    title: "Standalone share pack",
    foods: [{ id: food.record.foodId }],
    logMeal: {
      food: { id: food.record.foodId },
      occurredAt: "2026-03-27T12:34:56.000Z",
    },
  });
  assert.equal(stringTimestampPack.afterImport?.logMeal?.occurredAt, "2026-03-27T12:34:56.000Z");

  const imported = await importSharePackIntoVault({
    vaultRoot: destinationVault,
    pack,
  });

  assert.equal(imported.regimens.length, 2);
  assert.equal(imported.recipes.length, 1);
  assert.equal(imported.foods.length, 1);
  assert.equal(imported.meal?.event.note, "Shared meal: Simple Recovery Bowl");
  assert.equal(imported.meal?.event.occurredAt, "2026-03-26T12:34:56.000Z");

  const linkedRegimenPack = assertContract(sharePackSchema, {
    schemaVersion: "murph.share-pack.v1",
    title: "Regimen relation pack",
    createdAt: "2026-03-26T12:34:56.000Z",
    entities: [
      {
        kind: "regimen",
        ref: "regimen:supplement:sleep-support-stack",
        payload: {
          title: "Sleep support stack",
          kind: "supplement",
          status: "active",
          startedOn: "2026-03-01",
          schedule: "daily",
          links: [
            {
              type: "supports_goal",
              targetId: "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
            },
            {
              type: "addresses_condition",
              targetId: "cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
            },
          ],
        },
      },
      {
        kind: "food",
        ref: "food:recovery-sidecar",
        payload: {
          title: "Recovery sidecar",
          kind: "bowl",
          serving: "1 bowl",
        },
      },
    ],
    afterImport: {
      logMeal: {
        foodRef: "food:recovery-sidecar",
        occurredAt: "2026-03-26T12:34:56.000Z",
      },
    },
  }, "share pack");

  const importedLinkedRegimenPack = await importSharePackIntoVault({
    vaultRoot: destinationVault,
    pack: linkedRegimenPack,
  });

  assert.equal(importedLinkedRegimenPack.regimens.length, 1);
  assert.equal(importedLinkedRegimenPack.foods.length, 1);
  assert.equal(importedLinkedRegimenPack.meal?.event.note, "Shared meal: Recovery sidecar");
  assert.equal(importedLinkedRegimenPack.meal?.event.occurredAt, "2026-03-26T12:34:56.000Z");

  const importedLinkedRegimen = await readRegimen({
    vaultRoot: destinationVault,
    regimenId: importedLinkedRegimenPack.regimens[0]?.regimenId,
  });

  assert.deepEqual(importedLinkedRegimen.entity.links, [
    {
      type: "supports_goal",
      targetId: "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
    },
    {
      type: "addresses_condition",
      targetId: "cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
    },
  ]);
  assert.deepEqual(importedLinkedRegimen.entity.relatedGoalIds, [
    "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
  ]);
  assert.deepEqual(importedLinkedRegimen.entity.relatedConditionIds, [
    "cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
  ]);
});

test("share packs reject attached refs and post-import meal refs that point at the wrong entity kind", () => {
  assert.throws(
    () => assertContract(sharePackSchema, {
      schemaVersion: "murph.share-pack.v1",
      title: "Broken smoothie",
      createdAt: "2026-03-26T12:00:00.000Z",
      entities: [
        {
          kind: "food",
          ref: "food:morning-smoothie",
          payload: {
            title: "Morning Smoothie",
            status: "active",
            attachedRegimenRefs: ["food:powder"],
          },
        },
        {
          kind: "food",
          ref: "food:powder",
          payload: {
            title: "Creatine scoop",
            status: "active",
          },
        },
      ],
      afterImport: {
        logMeal: {
          foodRef: "food:powder",
        },
      },
    }, "share pack"),
    /Food entity refs must target regimen share entities/u,
  );

  assert.throws(
    () => assertContract(sharePackSchema, {
      schemaVersion: "murph.share-pack.v1",
      title: "Broken post-import log",
      createdAt: "2026-03-26T12:00:00.000Z",
      entities: [
        {
          kind: "regimen",
          ref: "regimen:creatine",
          payload: {
            title: "Creatine monohydrate",
            kind: "supplement",
            status: "active",
            startedOn: "2026-03-01",
            group: "supplement",
          },
        },
      ],
      afterImport: {
        logMeal: {
          foodRef: "regimen:creatine",
        },
      },
    }, "share pack"),
    /afterImport\.logMeal\.foodRef must target a food share entity/u,
  );
});

test("share packs reject empty exports without any titled entity", async () => {
  const vaultRoot = await makeTempDirectory("murph-share-pack-empty-title");

  await initializeVault({ vaultRoot });

  await assert.rejects(
    () => buildSharePackFromVault({ vaultRoot }),
    /Share packs require at least one entity with a title\./u,
  );
});

test("share packs reuse bank payload projections for regimen, recipe, and food exports", async () => {
  const vaultRoot = await makeTempDirectory("murph-share-pack-payloads");
  await initializeVault({ vaultRoot });

  const regimen = await upsertRegimen({
    vaultRoot,
    title: "Fish Oil",
    slug: "fish-oil",
    kind: "supplement",
    group: "supplement/omega",
    status: "active",
    startedOn: "2026-03-01",
    substance: "omega-3",
    dose: 2000,
    unit: "mg",
    schedule: "daily",
    brand: "Nordic Naturals",
    manufacturer: "Nordic Naturals",
    servingSize: "2 softgels",
    ingredients: [
      {
        compound: "EPA",
        label: "Eicosapentaenoic acid",
        amount: 600,
        unit: "mg",
        note: "From anchovy oil.",
      },
    ],
    relatedGoalIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
    relatedConditionIds: ["cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9"],
  });
  const recipe = await upsertRecipe({
    vaultRoot,
    title: "Sheet Pan Salmon Bowls",
    slug: "sheet-pan-salmon-bowls",
    status: "saved",
    summary: "A reliable salmon bowl for weeknights.",
    cuisine: "mediterranean",
    dishType: "dinner",
    source: "Family notes",
    servings: 2,
    prepTimeMinutes: 15,
    cookTimeMinutes: 20,
    totalTimeMinutes: 35,
    tags: ["protein", "weeknight"],
    ingredients: ["2 salmon fillets", "2 cups cooked rice"],
    steps: ["Roast the broccoli.", "Add the salmon and finish roasting."],
    relatedGoalIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
    relatedConditionIds: ["cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9"],
  });
  const food = await upsertFood({
    vaultRoot,
    title: "Usual Salmon Bowl",
    slug: "usual-salmon-bowl",
    status: "active",
    summary: "My standard salmon lunch.",
    kind: "bowl",
    brand: "Home",
    vendor: "Kitchen",
    location: "Home",
    serving: "1 bowl",
    aliases: ["usual salmon bowl"],
    ingredients: ["salmon", "rice", "broccoli"],
    tags: ["lunch", "favorite"],
    note: "Usually add lemon.",
    attachedRegimenIds: [regimen.record.entity.regimenId],
  });

  const pack = await buildSharePackFromVault({
    vaultRoot,
    foods: [{ id: food.record.foodId }],
    regimens: [{ id: regimen.record.entity.regimenId }],
    recipes: [{ id: recipe.record.recipeId }],
    includeAttachedRegimens: true,
  });

  const exportedRegimen = pack.entities.find((entity) => entity.kind === "regimen");
  const exportedRecipe = pack.entities.find((entity) => entity.kind === "recipe");
  const exportedFood = pack.entities.find((entity) => entity.kind === "food");

  assert.deepEqual(exportedRegimen?.payload, {
    slug: "fish-oil",
    title: "Fish Oil",
    kind: "supplement",
    status: "active",
    startedOn: "2026-03-01",
    substance: "omega-3",
    dose: 2000,
    unit: "mg",
    schedule: "daily",
    brand: "Nordic Naturals",
    manufacturer: "Nordic Naturals",
    servingSize: "2 softgels",
    ingredients: [
      {
        compound: "EPA",
        label: "Eicosapentaenoic acid",
        amount: 600,
        unit: "mg",
        note: "From anchovy oil.",
      },
    ],
    relatedGoalIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
    relatedConditionIds: ["cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9"],
    links: [
      {
        type: "supports_goal",
        targetId: "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      },
      {
        type: "addresses_condition",
        targetId: "cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
      },
    ],
    group: "supplement/omega",
  });
  assert.deepEqual(exportedRecipe?.payload, {
    slug: "sheet-pan-salmon-bowls",
    title: "Sheet Pan Salmon Bowls",
    status: "saved",
    summary: "A reliable salmon bowl for weeknights.",
    cuisine: "mediterranean",
    dishType: "dinner",
    source: "Family notes",
    servings: 2,
    prepTimeMinutes: 15,
    cookTimeMinutes: 20,
    totalTimeMinutes: 35,
    tags: ["protein", "weeknight"],
    ingredients: ["2 salmon fillets", "2 cups cooked rice"],
    steps: ["Roast the broccoli.", "Add the salmon and finish roasting."],
    relatedGoalIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
    relatedConditionIds: ["cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9"],
    links: [
      {
        type: "supports_goal",
        targetId: "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      },
      {
        type: "addresses_condition",
        targetId: "cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
      },
    ],
  });
  assert.deepEqual(exportedFood?.payload, {
    slug: "usual-salmon-bowl",
    title: "Usual Salmon Bowl",
    status: "active",
    summary: "My standard salmon lunch.",
    kind: "bowl",
    brand: "Home",
    vendor: "Kitchen",
    location: "Home",
    serving: "1 bowl",
    aliases: ["usual salmon bowl"],
    ingredients: ["salmon", "rice", "broccoli"],
    tags: ["favorite", "lunch"],
    note: "Usually add lemon.",
    links: [
      {
        type: "related_regimen",
        targetId: regimen.record.entity.regimenId,
      },
    ],
    attachedRegimenRefs: exportedRegimen ? [exportedRegimen.ref] : [],
  });
});

test("share pack imports create fresh destination records instead of overwriting same-slug entities", async () => {
  const sourceVault = await makeTempDirectory("murph-share-pack-copy-source");
  const destinationVault = await makeTempDirectory("murph-share-pack-copy-destination");

  await initializeVault({ vaultRoot: sourceVault });
  await initializeVault({ vaultRoot: destinationVault });

  const sourceRegimen = await upsertRegimen({
    vaultRoot: sourceVault,
    title: "Creatine monohydrate",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
  });
  const sourceFood = await upsertFood({
    vaultRoot: sourceVault,
    title: "Morning Smoothie",
    kind: "smoothie",
    serving: "1 smoothie",
    ingredients: ["banana", "creatine"],
    attachedRegimenIds: [sourceRegimen.record.entity.regimenId],
  });
  const sourceRecipe = await upsertRecipe({
    vaultRoot: sourceVault,
    title: "Morning Smoothie",
    status: "saved",
    ingredients: ["banana", "milk"],
    steps: ["Blend everything."],
  });

  const pack = await buildSharePackFromVault({
    vaultRoot: sourceVault,
    foods: [{ id: sourceFood.record.foodId }],
    regimens: [{ id: sourceRegimen.record.entity.regimenId }],
    recipes: [{ id: sourceRecipe.record.recipeId }],
  });

  const existingRegimen = await upsertRegimen({
    vaultRoot: destinationVault,
    title: "Creatine monohydrate",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-01-01",
    schedule: "weekly",
  });
  const existingFood = await upsertFood({
    vaultRoot: destinationVault,
    title: "Morning Smoothie",
    kind: "drink",
    ingredients: ["water"],
  });
  const existingRecipe = await upsertRecipe({
    vaultRoot: destinationVault,
    title: "Morning Smoothie",
    status: "saved",
    ingredients: ["ice"],
    steps: ["Pour."],
  });

  const imported = await importSharePackIntoVault({
    vaultRoot: destinationVault,
    pack,
  });

  assert.notEqual(imported.regimens[0]?.regimenId, existingRegimen.record.entity.regimenId);
  assert.notEqual(imported.foods[0]?.foodId, existingFood.record.foodId);
  assert.notEqual(imported.recipes[0]?.recipeId, existingRecipe.record.recipeId);

  const preservedFood = await readFood({
    vaultRoot: destinationVault,
    foodId: existingFood.record.foodId,
  });
  assert.equal(preservedFood.kind, "drink");
  assert.deepEqual(preservedFood.ingredients, ["water"]);
  assert.equal(preservedFood.attachedRegimenIds, undefined);

  const importedFood = await readFood({
    vaultRoot: destinationVault,
    foodId: imported.foods[0]?.foodId,
  });
  assert.equal(importedFood.kind, "smoothie");
  assert.deepEqual(importedFood.ingredients, ["banana", "creatine"]);
  assert.equal(importedFood.attachedRegimenIds?.length, 1);
});
