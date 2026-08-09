import assert from "node:assert/strict";

import { test } from "vitest";

import * as helpersModule from "../src/helpers.ts";
import * as capturesModule from "../src/captures.ts";
import * as encountersModule from "../src/encounters.ts";
import * as exportPacksModule from "../src/export-packs.ts";
import * as indexModule from "../src/index.ts";
import * as preferencesModule from "../src/preferences.ts";
import * as recordsModule from "../src/records.ts";
import * as runtimeModule from "../src/runtime.ts";
import * as testingModule from "../src/testing.ts";
import * as vaultServicesModule from "../src/vault-services.ts";
import * as workoutsModule from "../src/workouts.ts";

test("public entrypoints expose the expected symbols", () => {
  assert.equal(typeof indexModule.normalizeInputFileOption, "function");
  assert.equal(typeof indexModule.normalizeRepeatableFlagOption, "function");
  assert.equal(typeof indexModule.inputFileOptionSchema.parse, "function");
  assert.equal(typeof indexModule.showAssistantPersonality, "function");
  assert.equal(typeof indexModule.setAssistantPersonalitySetting, "function");
  assert.equal(typeof indexModule.resetAssistantPersonalitySetting, "function");
  assert.equal(typeof indexModule.resetAllAssistantPersonalitySettings, "function");

  assert.equal(typeof preferencesModule.showAssistantPersonality, "function");
  assert.equal(typeof preferencesModule.setAssistantPersonalitySetting, "function");
  assert.equal(typeof preferencesModule.resetAssistantPersonalitySetting, "function");
  assert.equal(typeof preferencesModule.resetAllAssistantPersonalitySettings, "function");

  assert.equal(typeof helpersModule.resolveVaultRelativePath, "function");
  assert.equal(typeof helpersModule.preparePatchedUpsertPayload, "function");
  assert.equal(typeof helpersModule.inferVaultLinkKind, "function");

  assert.equal(typeof capturesModule.addCaptureRecord, "function");
  assert.equal(typeof capturesModule.listCaptureRecords, "function");
  assert.equal(typeof capturesModule.showCaptureRecord, "function");
  assert.equal(typeof capturesModule.showCaptureManifest, "function");
  assert.equal(typeof capturesModule.captureLookupSchema.parse, "function");

  assert.equal(typeof encountersModule.importEncounterBundleRecord, "function");
  assert.equal(typeof encountersModule.scaffoldEncounterBundlePayload, "function");
  assert.equal(Object.hasOwn(encountersModule, "saveEncounterBundleRecord"), false);

  assert.equal(typeof exportPacksModule.readMaterializedExportPackReceipt, "function");
  assert.equal(typeof exportPacksModule.retireMaterializedExportPack, "function");

  assert.equal(typeof recordsModule.renderAutoLoggedFoodMealNote, "function");
  assert.equal(typeof recordsModule.scaffoldProviderPayload, "function");
  assert.equal(typeof recordsModule.parseRecipePayload, "function");

  assert.equal(typeof runtimeModule.createUnwiredMethod, "function");
  assert.equal(typeof runtimeModule.loadIntegratedRuntime, "function");
  assert.equal(typeof runtimeModule.createRuntimeUnavailableError, "function");

  assert.equal(Object.hasOwn(helpersModule, "applyRecordPatch"), false);
  assert.equal(Object.hasOwn(helpersModule, "appendJournalText"), false);
  assert.equal(Object.hasOwn(helpersModule, "createExplicitHealthCoreServices"), false);
  assert.equal(Object.hasOwn(helpersModule, "createExplicitHealthQueryServices"), false);
  assert.equal(typeof testingModule.applyRecordPatch, "function");
  assert.equal(typeof testingModule.appendJournalText, "function");
  assert.equal(typeof testingModule.createExplicitHealthCoreServices, "function");

  assert.equal(typeof vaultServicesModule.createIntegratedVaultServices, "function");
  assert.equal(typeof vaultServicesModule.createUnwiredVaultServices, "function");

  assert.equal(typeof workoutsModule.resolveWorkoutCapture, "function");
  assert.equal(typeof workoutsModule.buildStructuredWorkoutActivitySessionDraft, "function");
  assert.equal(typeof workoutsModule.workoutLookupSchema.parse, "function");
  assert.equal(Object.hasOwn(workoutsModule, "showWorkoutMeasurementRecord"), false);
  assert.equal(Object.hasOwn(workoutsModule, "listWorkoutMeasurementRecords"), false);
  assert.equal(Object.hasOwn(workoutsModule, "showWorkoutMeasurementManifest"), false);
});
