import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test, vi } from "vitest";
import * as core from "@murphai/core";
import {
  initializeVault,
  readFood,
  readProvider,
  readRecipe,
  readScheduledLog,
  upsertDailyFoodScheduledLog,
  upsertFood,
  upsertProvider,
  upsertRecipe,
} from "@murphai/core";
import { deleteFoodRecord, editFoodRecord, renameFoodRecord } from "../src/usecases/food.ts";
import { editProviderRecord } from "../src/usecases/provider-event.ts";
import { editRecipeRecord } from "../src/usecases/recipe.ts";

const vaults: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(vaults.splice(0).map((vaultRoot) => rm(vaultRoot, { recursive: true, force: true })));
});

async function createVault() {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-bank-edits-"));
  vaults.push(vaultRoot);
  await initializeVault({ vaultRoot });
  return vaultRoot;
}

test("concurrent food edits and renames retain each independent field change", async () => {
  const vault = await createVault();
  const { record: food } = await upsertFood({ vaultRoot: vault, title: "Berry Smoothie", note: "Original note", serving: "One glass" });
  await Promise.all([
    editFoodRecord({ vault, lookup: food.foodId, set: ['note="Updated note"'] }),
    editFoodRecord({ vault, lookup: food.foodId, set: ['serving="Two glasses"'] }),
  ]);
  assert.equal((await readFood({ vaultRoot: vault, foodId: food.foodId })).note, "Updated note");
  assert.equal((await readFood({ vaultRoot: vault, foodId: food.foodId })).serving, "Two glasses");

  await Promise.all([
    renameFoodRecord({ vault, lookup: food.foodId, title: "Summer Smoothie" }),
    editFoodRecord({ vault, lookup: food.foodId, set: ['note="Final note"'] }),
  ]);
  const renamed = await readFood({ vaultRoot: vault, foodId: food.foodId });
  assert.equal(renamed.title, "Summer Smoothie");
  assert.equal(renamed.note, "Final note");
  assert.deepEqual(renamed.aliases, ["Berry Smoothie"]);
});

test("concurrent recipe and provider edits retain each independent field change", async () => {
  const vault = await createVault();
  const { record: recipe } = await upsertRecipe({ vaultRoot: vault, title: "Rice Bowl", summary: "Original summary", servings: 1 });
  await Promise.all([
    editRecipeRecord({ vault, lookup: recipe.recipeId, set: ['summary="Updated summary"'] }),
    editRecipeRecord({ vault, lookup: recipe.recipeId, set: ["servings=2"] }),
  ]);
  const updatedRecipe = await readRecipe({ vaultRoot: vault, recipeId: recipe.recipeId });
  assert.equal(updatedRecipe.summary, "Updated summary");
  assert.equal(updatedRecipe.servings, 2);

  const provider = await upsertProvider({ vaultRoot: vault, title: "Primary Care", note: "Original note", location: "Original clinic" });
  await Promise.all([
    editProviderRecord({ vault, lookup: provider.providerId, set: ['note="Updated note"'] }),
    editProviderRecord({ vault, lookup: provider.providerId, set: ['location="New clinic"'] }),
  ]);
  const updatedProvider = await readProvider({ vaultRoot: vault, providerId: provider.providerId });
  assert.equal(updatedProvider.note, "Updated note");
  assert.equal(updatedProvider.location, "New clinic");
  assert.match(updatedProvider.markdown, /Updated note/);
});

test("a failed schedule archive leaves food available for a successful deletion retry", async () => {
  const vault = await createVault();
  const { record: food } = await upsertFood({ vaultRoot: vault, title: "Berry Smoothie" });
  const { record: schedule } = await upsertDailyFoodScheduledLog({ vaultRoot: vault, foodId: food.foodId, localTime: "09:00" });
  const schedulePath = path.join(vault, schedule.relativePath);
  const originalSchedule = await readFile(schedulePath, "utf8");
  await writeFile(schedulePath, "---\ninvalid: [\n", "utf8");

  await assert.rejects(deleteFoodRecord({ vault, lookup: food.foodId }));
  assert.equal((await readFood({ vaultRoot: vault, foodId: food.foodId })).foodId, food.foodId);

  await writeFile(schedulePath, originalSchedule, "utf8");
  assert.equal((await deleteFoodRecord({ vault, lookup: food.foodId })).deleted, true);
  assert.equal((await readScheduledLog({ vaultRoot: vault, scheduledLogId: schedule.scheduledLogId })).status, "archived");
  await assert.rejects(readFood({ vaultRoot: vault, foodId: food.foodId }), { code: "VAULT_FOOD_MISSING" });
});


test("clearing attached regimens removes their persisted food links", async () => {
  const vault = await createVault();
  const regimenId = "reg_01JNV422Y2M5ZBV64ZP4N1DRB1";
  const { record: food } = await upsertFood({
    vaultRoot: vault,
    title: "Berry Smoothie",
    attachedRegimenIds: [regimenId],
  });
  const before = await readFood({ vaultRoot: vault, foodId: food.foodId });
  assert.deepEqual(before.links, [{ type: "related_regimen", targetId: regimenId }]);
  await editFoodRecord({ vault, lookup: food.foodId, clear: ["attachedRegimenIds"] });
  const after = await readFood({ vaultRoot: vault, foodId: food.foodId });
  assert.equal(after.attachedRegimenIds, undefined);
  assert.deepEqual(after.links, []);
});

test("food deletion prevents a concurrent daily schedule from being reactivated", async () => {
  const vault = await createVault();
  const { record: food } = await upsertFood({ vaultRoot: vault, title: "Berry Smoothie" });
  const { record: schedule } = await upsertDailyFoodScheduledLog({ vaultRoot: vault, foodId: food.foodId, localTime: "09:00" });
  let reachedDelete!: () => void;
  const beforeDelete = new Promise<void>((resolve) => { reachedDelete = resolve; });
  let allowDelete!: () => void;
  const continueDelete = new Promise<void>((resolve) => { allowDelete = resolve; });
  const deleteFood = core.deleteFood;
  vi.spyOn(core, "deleteFood").mockImplementation(async (input) => {
    reachedDelete();
    await continueDelete;
    return deleteFood(input);
  });

  const deleting = deleteFoodRecord({ vault, lookup: food.foodId });
  await beforeDelete;
  const rescheduling = upsertDailyFoodScheduledLog({ vaultRoot: vault, foodId: food.foodId, localTime: "10:00" }).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    await Promise.race([rescheduling, new Promise((resolve) => setTimeout(resolve, 100))]);
  } finally {
    allowDelete();
  }
  await deleting;
  const result = await rescheduling;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal((result.error as { code: string }).code, "VAULT_FOOD_MISSING");
  assert.equal((await readScheduledLog({ vaultRoot: vault, scheduledLogId: schedule.scheduledLogId })).status, "archived");
  await assert.rejects(readFood({ vaultRoot: vault, foodId: food.foodId }), { code: "VAULT_FOOD_MISSING" });
}, 5_000);
