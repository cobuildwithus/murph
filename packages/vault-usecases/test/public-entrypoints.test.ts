import assert from "node:assert/strict";

import { test } from "vitest";

import * as helpersModule from "../src/helpers.ts";
import * as indexModule from "../src/index.ts";
import * as recordsModule from "../src/records.ts";
import * as runtimeModule from "../src/runtime.ts";
import * as testingModule from "../src/testing.ts";
import * as vaultServicesModule from "../src/vault-services.ts";
import * as workoutsModule from "../src/workouts.ts";

test("public entrypoints expose the expected symbols", () => {
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
