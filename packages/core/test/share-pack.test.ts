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
  readProtocolItem,
  readRecipe,
  upsertFood,
  upsertProtocolItem,
  upsertRecipe,
} from "../src/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("share packs export one food with attached supplement protocols and import the full bundle", async () => {
  const sourceVault = await makeTempDirectory("murph-share-pack-source");
  const destinationVault = await makeTempDirectory("murph-share-pack-destination");

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
      creatine.record.entity.protocolId,
      collagen.record.entity.protocolId,
      fiber.record.entity.protocolId,
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
  assert.ok(imported.protocols.every((record) => typeof record.protocolId === "string"));
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

test("share packs dedupe explicitly selected protocols that are also attached to exported foods", async () => {
  const sourceVault = await makeTempDirectory("murph-share-pack-dedupe-source");
  const destinationVault = await makeTempDirectory("murph-share-pack-dedupe-destination");

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
  const smoothie = await upsertFood({
    vaultRoot: sourceVault,
    title: "Morning Smoothie",
    kind: "smoothie",
    serving: "1 smoothie",
    ingredients: ["banana", "creatine"],
    attachedProtocolIds: [creatine.record.entity.protocolId],
  });

  const pack = await buildSharePackFromVault({
    vaultRoot: sourceVault,
    foods: [{ id: smoothie.record.foodId }],
    protocols: [{ id: creatine.record.entity.protocolId }],
  });

  const exportedProtocolEntities = pack.entities.filter((entity) => entity.kind === "protocol");
  const exportedFood = pack.entities.find((entity) => entity.kind === "food");

  assert.equal(exportedProtocolEntities.length, 1);
  assert.equal(pack.entities.length, 2);
  assert.deepEqual(exportedFood?.payload.attachedProtocolRefs, exportedProtocolEntities.map((entity) => entity.ref));

  const imported = await importSharePackIntoVault({
    vaultRoot: destinationVault,
    pack,
  });

  const importedFood = await readFood({
    vaultRoot: destinationVault,
    foodId: imported.foods[0]?.foodId,
  });

  assert.equal(imported.protocols.length, 1);
  assert.equal(imported.foods.length, 1);
  assert.equal(importedFood.attachedProtocolIds?.length, 1);
});

test("share packs can omit attached protocols while normalizing meal follow-up fields", async () => {
  const sourceVault = await makeTempDirectory("murph-share-pack-meal-source");
  const destinationVault = await makeTempDirectory("murph-share-pack-meal-destination");

  await initializeVault({ vaultRoot: sourceVault });
  await initializeVault({ vaultRoot: destinationVault });

  const protocol = await upsertProtocolItem({
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
    attachedProtocolIds: [protocol.record.entity.protocolId],
  });

  const pack = await buildSharePackFromVault({
    vaultRoot: sourceVault,
    foods: [{ id: food.record.foodId }],
    protocols: [{ id: protocol.record.entity.protocolId }],
    includeAttachedProtocols: false,
    logMeal: {
      food: { id: food.record.foodId },
      note: "  Keep this meal  ",
      occurredAt: Date.parse("2026-03-26T12:34:56.000Z"),
    },
  });

  const exportedProtocolEntities = pack.entities.filter((entity) => entity.kind === "protocol");
  const exportedFood = pack.entities.find((entity) => entity.kind === "food");

  assert.equal(exportedProtocolEntities.length, 1);
  assert.equal(exportedFood?.payload.attachedProtocolRefs, undefined);
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
  assert.equal(imported.foods[0]?.attachedProtocolIds?.length, 1);
  assert.equal(imported.meal?.event.note, "Shared meal: Morning Smoothie\n\nKeep this meal");
  assert.equal(imported.meal?.event.occurredAt, "2026-03-26T12:34:56.000Z");
});

test("share packs preserve empty-link exports, normalize related protocol links, and accept Date and string meal timestamps", async () => {
  const sourceVault = await makeTempDirectory("murph-share-pack-link-source");
  const destinationVault = await makeTempDirectory("murph-share-pack-link-destination");

  await initializeVault({ vaultRoot: sourceVault });
  await initializeVault({ vaultRoot: destinationVault });

  const standaloneProtocol = await upsertProtocolItem({
    vaultRoot: sourceVault,
    title: "Magnesium glycinate",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
  });
  const linkedProtocol = await upsertProtocolItem({
    vaultRoot: sourceVault,
    title: "Sleep support stack",
    kind: "supplement",
    group: "supplement",
    startedOn: "2026-03-01",
    schedule: "daily",
    relatedProtocolIds: [standaloneProtocol.record.entity.protocolId],
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
    protocols: [
      { id: standaloneProtocol.record.entity.protocolId },
      { id: linkedProtocol.record.entity.protocolId },
    ],
    recipes: [{ id: recipe.record.recipeId }],
    foods: [{ id: food.record.foodId }],
    logMeal: {
      food: { id: food.record.foodId },
      note: "   ",
      occurredAt: new Date("2026-03-26T12:34:56.000Z"),
    },
  });

  const exportedStandaloneProtocol = pack.entities.find(
    (entity) => entity.kind === "protocol" && entity.payload.title === "Magnesium glycinate",
  );
  const exportedLinkedProtocol = pack.entities.find(
    (entity) => entity.kind === "protocol" && entity.payload.title === "Sleep support stack",
  );
  const exportedRecipe = pack.entities.find((entity) => entity.kind === "recipe");
  const exportedFood = pack.entities.find((entity) => entity.kind === "food");

  assert.equal(pack.title, "Standalone share pack");
  assert.equal(exportedStandaloneProtocol?.payload.links, undefined);
  assert.deepEqual(exportedLinkedProtocol?.payload.links, [
    {
      type: "related_protocol",
      targetId: standaloneProtocol.record.entity.protocolId,
    },
  ]);
  assert.equal(exportedRecipe?.payload.links, undefined);
  assert.equal(exportedFood?.payload.links, undefined);
  assert.equal(exportedFood?.payload.attachedProtocolRefs, undefined);
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

  assert.equal(imported.protocols.length, 2);
  assert.equal(imported.recipes.length, 1);
  assert.equal(imported.foods.length, 1);
  assert.equal(imported.meal?.event.note, "Shared meal: Simple Recovery Bowl");
  assert.equal(imported.meal?.event.occurredAt, "2026-03-26T12:34:56.000Z");

  const linkedProtocolPack = assertContract(sharePackSchema, {
    schemaVersion: "murph.share-pack.v1",
    title: "Protocol relation pack",
    createdAt: "2026-03-26T12:34:56.000Z",
    entities: [
      {
        kind: "protocol",
        ref: "protocol:supplement:sleep-support-stack",
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

  const importedLinkedProtocolPack = await importSharePackIntoVault({
    vaultRoot: destinationVault,
    pack: linkedProtocolPack,
  });

  assert.equal(importedLinkedProtocolPack.protocols.length, 1);
  assert.equal(importedLinkedProtocolPack.foods.length, 1);
  assert.equal(importedLinkedProtocolPack.meal?.event.note, "Shared meal: Recovery sidecar");
  assert.equal(importedLinkedProtocolPack.meal?.event.occurredAt, "2026-03-26T12:34:56.000Z");

  const importedLinkedProtocol = await readProtocolItem({
    vaultRoot: destinationVault,
    protocolId: importedLinkedProtocolPack.protocols[0]?.protocolId,
  });

  assert.deepEqual(importedLinkedProtocol.entity.links, [
    {
      type: "supports_goal",
      targetId: "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
    },
    {
      type: "addresses_condition",
      targetId: "cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
    },
  ]);
  assert.deepEqual(importedLinkedProtocol.entity.relatedGoalIds, [
    "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
  ]);
  assert.deepEqual(importedLinkedProtocol.entity.relatedConditionIds, [
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
      schemaVersion: "murph.share-pack.v1",
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

test("share packs reject empty exports without any titled entity", async () => {
  const vaultRoot = await makeTempDirectory("murph-share-pack-empty-title");

  await initializeVault({ vaultRoot });

  await assert.rejects(
    () => buildSharePackFromVault({ vaultRoot }),
    /Share packs require at least one entity with a title\./u,
  );
});

test("share packs reuse bank payload projections for protocol, recipe, and food exports", async () => {
  const vaultRoot = await makeTempDirectory("murph-share-pack-payloads");
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
    attachedProtocolIds: [protocol.record.entity.protocolId],
  });

  const pack = await buildSharePackFromVault({
    vaultRoot,
    foods: [{ id: food.record.foodId }],
    protocols: [{ id: protocol.record.entity.protocolId }],
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
        type: "related_protocol",
        targetId: protocol.record.entity.protocolId,
      },
    ],
    autoLogDaily: {
      time: "12:30",
    },
    attachedProtocolRefs: exportedProtocol ? [exportedProtocol.ref] : [],
  });
});

test("share pack imports create fresh destination records instead of overwriting same-slug entities", async () => {
  const sourceVault = await makeTempDirectory("murph-share-pack-copy-source");
  const destinationVault = await makeTempDirectory("murph-share-pack-copy-destination");

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
    attachedProtocolIds: [sourceProtocol.record.entity.protocolId],
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
    protocols: [{ id: sourceProtocol.record.entity.protocolId }],
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

  assert.notEqual(imported.protocols[0]?.protocolId, existingProtocol.record.entity.protocolId);
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
