import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { assertContract, sharePackSchema } from "@healthybob/contracts";

import {
  buildSharePackFromVault,
  importSharePackIntoVault,
  initializeVault,
  readFood,
  upsertFood,
  upsertProtocolItem,
  upsertRecipe,
} from "../src/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("share packs export one food with attached supplement protocols and import the full bundle", async () => {
  const sourceVault = await makeTempDirectory("healthybob-share-pack-source");
  const destinationVault = await makeTempDirectory("healthybob-share-pack-destination");

  await initializeVault({ vaultRoot: sourceVault });
  await initializeVault({ vaultRoot: destinationVault });

  const creatine = await upsertProtocolItem({
    vaultRoot: sourceVault,
    title: "Creatine monohydrate",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
  });
  const collagen = await upsertProtocolItem({
    vaultRoot: sourceVault,
    title: "Collagen peptides",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
  });
  const fiber = await upsertProtocolItem({
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
    attachedProtocolIds: [
      creatine.record.protocolId,
      collagen.record.protocolId,
      fiber.record.protocolId,
    ],
    autoLogDaily: {
      time: "08:00",
    },
  });

  const pack = await buildSharePackFromVault({
    vaultRoot: sourceVault,
    foods: [{ id: smoothie.record.foodId }],
    includeAttachedProtocols: true,
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
  assert.equal(exportedFood?.payload.autoLogDaily?.time, "08:00");
  assert.deepEqual(
    [...(exportedFood?.payload.attachedProtocolRefs ?? [])].sort(),
    pack.entities
      .filter((entity) => entity.kind === "protocol")
      .map((entity) => entity.ref)
      .sort(),
  );
  assert.equal(pack.afterImport?.logMeal?.foodRef, exportedFood?.ref);

  const imported = await importSharePackIntoVault({
    vaultRoot: destinationVault,
    pack,
  });
  assert.equal(imported.protocols.length, 3);
  assert.equal(imported.foods.length, 1);
  assert.ok(imported.meal);

  const importedFood = await readFood({
    vaultRoot: destinationVault,
    foodId: imported.foods[0]?.foodId,
  });
  assert.equal(importedFood.title, "Morning Smoothie");
  assert.equal(importedFood.autoLogDaily?.time, "08:00");
  assert.equal(importedFood.attachedProtocolIds?.length, 3);
});

test("share packs reject attached refs and post-import meal refs that point at the wrong entity kind", () => {
  assert.throws(
    () => assertContract(sharePackSchema, {
      schemaVersion: "hb.share-pack.v1",
      title: "Broken smoothie",
      createdAt: "2026-03-26T12:00:00.000Z",
      entities: [
        {
          kind: "food",
          ref: "food:morning-smoothie",
          payload: {
            title: "Morning Smoothie",
            status: "active",
            attachedProtocolRefs: ["food:powder"],
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
    /Food entity refs must target protocol share entities/u,
  );

  assert.throws(
    () => assertContract(sharePackSchema, {
      schemaVersion: "hb.share-pack.v1",
      title: "Broken post-import log",
      createdAt: "2026-03-26T12:00:00.000Z",
      entities: [
        {
          kind: "protocol",
          ref: "protocol:creatine",
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
          foodRef: "protocol:creatine",
        },
      },
    }, "share pack"),
    /afterImport\.logMeal\.foodRef must target a food share entity/u,
  );
});

test("share packs reuse bank payload projections for protocol, recipe, and food exports", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-share-pack-payloads");
  await initializeVault({ vaultRoot });

  const protocol = await upsertProtocolItem({
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
    autoLogDaily: {
      time: "12:30",
    },
    attachedProtocolIds: [protocol.record.protocolId],
  });

  const pack = await buildSharePackFromVault({
    vaultRoot,
    foods: [{ id: food.record.foodId }],
    protocols: [{ id: protocol.record.protocolId }],
    recipes: [{ id: recipe.record.recipeId }],
    includeAttachedProtocols: true,
  });

  const exportedProtocol = pack.entities.find((entity) => entity.kind === "protocol");
  const exportedRecipe = pack.entities.find((entity) => entity.kind === "recipe");
  const exportedFood = pack.entities.find((entity) => entity.kind === "food");

  assert.deepEqual(exportedProtocol?.payload, {
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
    autoLogDaily: {
      time: "12:30",
    },
    attachedProtocolRefs: exportedProtocol ? [exportedProtocol.ref] : [],
  });
});

test("share pack imports create fresh destination records instead of overwriting same-slug entities", async () => {
  const sourceVault = await makeTempDirectory("healthybob-share-pack-copy-source");
  const destinationVault = await makeTempDirectory("healthybob-share-pack-copy-destination");

  await initializeVault({ vaultRoot: sourceVault });
  await initializeVault({ vaultRoot: destinationVault });

  const sourceProtocol = await upsertProtocolItem({
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
    attachedProtocolIds: [sourceProtocol.record.protocolId],
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
    protocols: [{ id: sourceProtocol.record.protocolId }],
    recipes: [{ id: sourceRecipe.record.recipeId }],
  });

  const existingProtocol = await upsertProtocolItem({
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

  assert.notEqual(imported.protocols[0]?.protocolId, existingProtocol.record.protocolId);
  assert.notEqual(imported.foods[0]?.foodId, existingFood.record.foodId);
  assert.notEqual(imported.recipes[0]?.recipeId, existingRecipe.record.recipeId);

  const preservedFood = await readFood({
    vaultRoot: destinationVault,
    foodId: existingFood.record.foodId,
  });
  assert.equal(preservedFood.kind, "drink");
  assert.deepEqual(preservedFood.ingredients, ["water"]);
  assert.equal(preservedFood.attachedProtocolIds, undefined);

  const importedFood = await readFood({
    vaultRoot: destinationVault,
    foodId: imported.foods[0]?.foodId,
  });
  assert.equal(importedFood.kind, "smoothie");
  assert.deepEqual(importedFood.ingredients, ["banana", "creatine"]);
  assert.equal(importedFood.attachedProtocolIds?.length, 1);
});
