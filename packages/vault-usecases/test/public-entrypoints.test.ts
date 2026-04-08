import assert from "node:assert/strict";

import { test } from "vitest";

test("public entrypoints expose the expected symbols", async () => {
  const indexModule = await import("../src/index.ts");
  const helpersModule = await import("../src/helpers.ts");
  const recordsModule = await import("../src/records.ts");
  const runtimeModule = await import("../src/runtime.ts");
  const testingModule = await import("../src/testing.ts");
  const vaultServicesModule = await import("../src/vault-services.ts");
  const workoutsModule = await import("../src/workouts.ts");

  assert.equal(typeof indexModule.normalizeInputFileOption, "function");
  assert.equal(typeof indexModule.normalizeRepeatableFlagOption, "function");
  assert.equal(typeof indexModule.inputFileOptionSchema.parse, "function");

  assert.equal(typeof helpersModule.resolveVaultRelativePath, "function");
  assert.equal(typeof helpersModule.preparePatchedUpsertPayload, "function");
  assert.equal(typeof helpersModule.inferVaultLinkKind, "function");

  assert.equal(typeof recordsModule.renderAutoLoggedFoodMealNote, "function");
  assert.equal(typeof recordsModule.scaffoldProviderPayload, "function");
  assert.equal(typeof recordsModule.parseRecipePayload, "function");

  assert.equal(typeof runtimeModule.createUnwiredMethod, "function");
  assert.equal(typeof runtimeModule.loadIntegratedRuntime, "function");
  assert.equal(typeof runtimeModule.createRuntimeUnavailableError, "function");

  assert.equal(typeof testingModule.applyRecordPatch, "function");
  assert.equal(typeof testingModule.appendJournalText, "function");
  assert.equal(typeof testingModule.createExplicitHealthCoreServices, "function");

  assert.equal(typeof vaultServicesModule.createIntegratedVaultServices, "function");
  assert.equal(typeof vaultServicesModule.createUnwiredVaultServices, "function");

  assert.equal(typeof workoutsModule.resolveWorkoutCapture, "function");
  assert.equal(typeof workoutsModule.buildStructuredWorkoutActivitySessionDraft, "function");
  assert.equal(typeof workoutsModule.workoutLookupSchema.parse, "function");
});
