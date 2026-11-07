import assert from "node:assert/strict";
import { test, vi } from "vitest";

import {
  createDeviceProviderRegistry,
  createImporters,
  createSamplePresetRegistry,
  prepareCsvSampleImport,
  prepareAssessmentResponseImport,
  resolveSampleImportConfig,
} from "../src/index.ts";
import { assertAssessmentImportPort } from "../src/assessment/core-port.ts";
import { assertCanonicalWritePort } from "../src/core-port.ts";
import { createTempFile } from "./test-helpers.ts";

const coreModuleCalls = vi.hoisted(
  (): {
    importDocument: unknown[];
    addMeal: unknown[];
    validateSampleImport: unknown[];
    importSamples: unknown[];
    importDeviceBatch: unknown[];
    importAssessmentResponse: unknown[];
  } => ({
    importDocument: [],
    addMeal: [],
    validateSampleImport: [],
    importSamples: [],
    importDeviceBatch: [],
    importAssessmentResponse: [],
  }),
);

vi.mock("@murphai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/core")>();

  return {
    ...actual,
    DEFAULT_TIMEZONE: "UTC",
    importDocument: async (payload: unknown) => {
      coreModuleCalls.importDocument.push(payload);
      return { ok: true, kind: "document" as const };
    },
    addMeal: async (payload: unknown) => {
      coreModuleCalls.addMeal.push(payload);
      return { ok: true, kind: "meal" as const };
    },
    validateSampleImport: async (payload: unknown) => {
      coreModuleCalls.validateSampleImport.push(payload);
    },
    importSamples: async (payload: unknown) => {
      coreModuleCalls.importSamples.push(payload);
      return {
        count: 1,
        manifestPath: "raw/samples/steps/import_mock/manifest.json",
        records: [{ id: "smp_mock_01" }],
        shardPaths: ["ledger/samples/2026/2026-03.jsonl"],
        transformId: "xfm_mock",
      };
    },
    importDeviceBatch: async (payload: unknown) => {
      coreModuleCalls.importDeviceBatch.push(payload);
      return { ok: true, kind: "device-batch" as const };
    },
    importAssessmentResponse: async (payload: unknown) => {
      coreModuleCalls.importAssessmentResponse.push(payload);
      return { ok: true, kind: "assessment" as const };
    },
    loadVault: async () => ({
      metadata: {
        timezone: "UTC",
      },
    }),
  };
});

test("createImporters builds default registries when options are omitted", () => {
  const importers = createImporters();

  assert.equal(importers.presetRegistry.list().length, 0);
  assert.ok(importers.deviceProviderRegistry.list().length > 0);
});

test("createImporters delegates through the default core runtime exports", async () => {
  const documentFilePath = await createTempFile("visit-note.txt", "note", "murph-importers-coverage-");
  const mealPhotoPath = await createTempFile("breakfast.jpg", "image-placeholder", "murph-importers-coverage-");
  const assessmentFilePath = await createTempFile(
    "sleep-survey.json",
    "{\"ok\":true}",
    "murph-importers-coverage-",
  );
  const csvFilePath = await createTempFile(
    "samples.csv",
    ["timestamp,value", "2026-03-11T08:00:00Z,1"].join("\n"),
    "murph-importers-coverage-",
  );
  const deviceProviderRegistry = createDeviceProviderRegistry([
    {
      provider: "test-provider",
      displayName: "Test Provider",
      transportModes: ["sdk_ingestion"] as const,
      normalization: {
        metricFamilies: ["body"] as const,
        snapshotParser: "passthrough",
      },
      sourcePriorityHints: {
        defaultPriority: 1,
        metricFamilies: {},
      },
      async normalizeSnapshot(snapshot: unknown) {
        return {
          provider: "test-provider",
          provenance: { snapshot },
        };
      },
    },
  ]);

  const importers = createImporters({ deviceProviderRegistry });

  const documentResult = await importers.importDocument({
    filePath: documentFilePath,
  });
  const mealResult = await importers.addMeal({
    photoPath: mealPhotoPath,
    note: "soup",
  });
  const sampleResult = await importers.importCsvSamples({
    filePath: csvFilePath,
    stream: "steps",
    tsColumn: "timestamp",
    valueColumn: "value",
    unit: "count",
  });
  const assessmentResult = await importers.importAssessmentResponse({
    filePath: assessmentFilePath,
    source: "manual",
  });
  const deviceBatchResult = await importers.importDeviceProviderSnapshot({
    provider: "test-provider",
    snapshot: { source: "device" },
  });

  assert.deepEqual(documentResult, { ok: true, kind: "document" });
  assert.deepEqual(mealResult, { ok: true, kind: "meal" });
  assert.deepEqual(sampleResult, {
    importedCount: 1,
    imports: [
      {
        importedCount: 1,
        ledgerFiles: ["ledger/samples/2026/2026-03.jsonl"],
        lookupIds: ["smp_mock_01"],
        manifestPath: "raw/samples/steps/import_mock/manifest.json",
        skipReasons: [],
        skippedCount: 0,
        stream: "steps",
        timeZone: "UTC",
        transformId: "xfm_mock",
        tsColumn: "timestamp",
        unit: "count",
        valueColumn: "value",
      },
    ],
    ledgerFiles: ["ledger/samples/2026/2026-03.jsonl"],
    lookupIds: ["smp_mock_01"],
    metadataColumns: [],
    skippedCount: 0,
    timeZone: "UTC",
    tsColumn: "timestamp",
  });
  assert.deepEqual(assessmentResult, { ok: true, kind: "assessment" });
  assert.deepEqual(deviceBatchResult, { ok: true, kind: "device-batch" });
  assert.equal(coreModuleCalls.importDocument.length, 1);
  assert.equal(coreModuleCalls.addMeal.length, 1);
  assert.equal(coreModuleCalls.validateSampleImport.length, 1);
  assert.equal(coreModuleCalls.importSamples.length, 1);
  assert.equal(coreModuleCalls.importAssessmentResponse.length, 1);
  assert.equal(coreModuleCalls.importDeviceBatch.length, 1);
  assert.equal(importers.presetRegistry.list().length, 0);
});

test("assertCanonicalWritePort binds methods and rejects invalid ports", () => {
  const port = {
    label: "canonical-port",
    importDocument() {
      return this.label;
    },
    addMeal() {
      return this.label;
    },
    validateSampleImport() {
      return this.label;
    },
    importSamples() {
      return this.label;
    },
    importDeviceBatch() {
      return this.label;
    },
  };

  const resolved = assertCanonicalWritePort(port);

  assert.equal(
    resolved.importDocument({ sourcePath: "documents/lab.pdf", title: "lab.pdf" }),
    "canonical-port",
  );
  assert.equal(resolved.addMeal({ note: "soup" }), "canonical-port");
  assert.equal(
    resolved.validateSampleImport({
      stream: "steps",
      unit: "count",
      sourcePath: "samples.csv",
      importConfig: {
        delimiter: ",",
        tsColumn: "timestamp",
        valueColumn: "value",
        metadataColumns: [],
      },
      samples: [],
    }),
    "canonical-port",
  );
  assert.equal(
    resolved.importSamples({
      stream: "steps",
      unit: "count",
      sourcePath: "samples.csv",
      importConfig: {
        delimiter: ",",
        tsColumn: "timestamp",
        valueColumn: "value",
        metadataColumns: [],
      },
      samples: [],
    }),
    "canonical-port",
  );
  assert.equal(resolved.importDeviceBatch({ provider: "device" }), "canonical-port");

  assert.throws(() => assertCanonicalWritePort(undefined), /must be an object/);
  assert.throws(
    () =>
      assertCanonicalWritePort({
        importDocument() {
          return "ok";
        },
        addMeal() {
          return "ok";
        },
        validateSampleImport() {
          return "ok";
        },
        importSamples() {
          return "ok";
        },
      }),
    /importDeviceBatch must be a function/,
  );
});

test("assertAssessmentImportPort binds the import function and rejects invalid ports", () => {
  const port = {
    label: "assessment-port",
    importAssessmentResponse() {
      return this.label;
    },
  };

  const resolved = assertAssessmentImportPort(port);

  assert.equal(
    resolved.importAssessmentResponse({
      sourcePath: "assessment.json",
      title: "assessment.json",
    }),
    "assessment-port",
  );
  assert.throws(() => assertAssessmentImportPort(null), /must be an object/);
  assert.throws(
    () => assertAssessmentImportPort({}),
    /importAssessmentResponse must be a function/,
  );
});

test("createSamplePresetRegistry exposes has, get, and list helpers", () => {
  const registry = createSamplePresetRegistry([
    {
      id: "beta",
      stream: "heart_rate",
      tsColumn: "timestamp",
      valueColumn: "value",
      unit: "bpm",
    },
    {
      id: "alpha",
      stream: "steps",
      tsColumn: "timestamp",
      valueColumn: "value",
      unit: "count",
    },
  ]);

  assert.equal(registry.has(" alpha "), true);
  assert.equal(registry.get("beta")?.stream, "heart_rate");
  assert.deepEqual(registry.list().map((preset) => preset.id), ["alpha", "beta"]);
});

test("resolveSampleImportConfig rejects unknown presets and normalizes null metadataColumns", () => {
  assert.throws(
    () =>
      resolveSampleImportConfig(
        {
          presetId: "missing-preset",
          stream: "steps",
          tsColumn: "timestamp",
          valueColumn: "value",
          unit: "count",
        },
        {
          get() {
            return undefined;
          },
        },
      ),
    /sample preset "missing-preset" is not registered/,
  );

  assert.deepEqual(
    resolveSampleImportConfig({
      stream: "steps",
      tsColumn: "timestamp",
      valueColumn: "value",
      unit: "count",
      delimiter: ",",
      metadataColumns: null,
    }),
    {
      delimiter: ",",
      stream: "steps",
      tsColumn: "timestamp",
      valueColumn: "value",
      unit: "count",
      metadataColumns: [],
    },
  );
});

test("prepareAssessmentResponseImport defaults the title from the file basename", async () => {
  const filePath = await createTempFile(
    "sleep-survey.json",
    "{\"ok\":true}",
    "murph-importers-coverage-",
  );

  const payload = await prepareAssessmentResponseImport({
    filePath: `  ${filePath}  `,
    vaultRoot: "  canonical-vault  ",
    source: "  manual  ",
    extra: "kept for passthrough parsing",
  });

  assert.deepEqual(payload, {
    vaultRoot: "canonical-vault",
    sourcePath: filePath,
    title: "sleep-survey.json",
    source: "manual",
  });
});

test("prepareCsvSampleImport infers SpO2 sample columns and skips placeholder rows", async () => {
  const filePath = await createTempFile(
    "o2ring.csv",
    [
      "Time,Oxygen Level,Pulse Rate,Motion",
      "2026-04-17 00:55:47,88,75,0",
      "2026-04-17 00:55:48,89,74,0",
      "2026-04-17 09:16:00,--,--,0",
    ].join("\n"),
    "murph-importers-coverage-",
  );

  const plan = await prepareCsvSampleImport({
    filePath,
    vaultRoot: "/tmp/canonical-vault",
    stream: "SpO2",
    metadataColumns: ["Motion"],
  });

  const [payload] = plan.imports;

  assert.ok(payload);
  assert.equal(payload.stream, "spo2");
  assert.equal(payload.unit, "%");
  assert.equal(plan.tsColumn, "Time");
  assert.equal(payload.valueColumn, "Oxygen Level");
  assert.equal(payload.importedCount, 2);
  assert.equal(payload.payload.samples[0]?.recordedAt, "2026-04-17T00:55:47.000Z");
  assert.equal(payload.payload.batchProvenance?.rowCount, 3);
  assert.equal(payload.payload.batchProvenance?.skippedCount, 1);
  assert.deepEqual(payload.payload.batchProvenance?.skipReasons, [
    { reason: "non-numeric value", count: 1 },
  ]);
});
