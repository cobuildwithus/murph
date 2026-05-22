import assert from "node:assert/strict";
import { test, vi } from "vitest";

import {
  addMeal,
  createDeviceProviderRegistry,
  createImporters,
  createSamplePresetRegistry,
  importCsvSamples,
  importDocument,
  parseDelimitedRows,
  prepareCsvSampleImport,
  prepareAssessmentResponseImport,
  prepareMealImport,
  resolveSampleImportConfig,
} from "../src/index.ts";
import type { DocumentImportPayload } from "../src/core-port.ts";
import { assertAssessmentImportPort } from "../src/assessment/core-port.ts";
import { assertCanonicalWritePort } from "../src/core-port.ts";
import { createCorePortSpy, createTempFile } from "./test-helpers.ts";

const coreModuleCalls = vi.hoisted(
  (): {
    importDocument: unknown[];
    addMeal: unknown[];
    importSamples: unknown[];
    importDeviceBatch: unknown[];
    importAssessmentResponse: unknown[];
  } => ({
    importDocument: [],
    addMeal: [],
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

test("importDocument delegates a core-shaped document payload", async () => {
  const filePath = await createTempFile("labs.pdf", "pdf-placeholder", "murph-importers-coverage-");
  const { calls, corePort } = createCorePortSpy();

  const result = await importDocument<{ ok: boolean; kind: string }>(
    {
      filePath,
      note: "  annual lab packet  ",
      occurredAt: "2026-03-11T14:00:00-05:00",
    },
    { corePort },
  );

  const [documentPayload] = calls.documents;

  assert.ok(documentPayload);
  assert.deepEqual(result, { ok: true, kind: "document" });
  assert.equal(calls.documents.length, 1);
  assert.equal((documentPayload as { sourcePath: string }).sourcePath, filePath);
});

test("addMeal validates attachments and maps to addMeal-compatible input", async () => {
  const photoPath = await createTempFile("dinner.jpg", "image-placeholder", "murph-importers-coverage-");
  const audioPath = await createTempFile(
    "dinner-note.m4a",
    "audio-placeholder",
    "murph-importers-coverage-",
  );
  const { calls, corePort } = createCorePortSpy();

  await addMeal(
    {
      photoPath,
      audioPath,
      note: "  salmon and rice  ",
      occurredAt: new Date("2026-03-11T18:30:00Z"),
    },
    { corePort },
  );

  const [mealPayload] = calls.meals;

  assert.ok(mealPayload);
  assert.equal(calls.meals.length, 1);
  assert.equal((mealPayload as { photoPath: string }).photoPath, photoPath);
});

test("addMeal accepts structured-only meal input with ingredients and nutrition", async () => {
  const { calls, corePort } = createCorePortSpy();

  await addMeal(
    {
      source: "derived",
      ingredients: [" salmon  ", "rice"],
      nutrition: {
        totals: {
          calories: 690,
          proteinGrams: 42,
        },
        provenance: {
          source: "estimated",
        },
      },
    },
    { corePort },
  );

  const [mealPayload] = calls.meals;

  assert.ok(mealPayload);
  assert.equal((mealPayload as { photoPath?: string }).photoPath, undefined);
  assert.equal((mealPayload as { audioPath?: string }).audioPath, undefined);
  assert.equal((mealPayload as { source?: string }).source, "derived");
  assert.deepEqual((mealPayload as { ingredients?: string[] }).ingredients, ["salmon", "rice"]);
  assert.deepEqual((mealPayload as { nutrition?: unknown }).nutrition, {
    totals: {
      calories: 690,
      proteinGrams: 42,
    },
    provenance: {
      source: "estimated",
    },
  });
});

test("addMeal accepts text-only meal notes without requiring a photo", async () => {
  const { calls, corePort } = createCorePortSpy();

  await addMeal(
    {
      note: "soup",
    },
    { corePort },
  );

  const [mealPayload] = calls.meals;
  assert.ok(mealPayload);
  assert.equal((mealPayload as { photoPath?: string }).photoPath, undefined);
  assert.equal((mealPayload as { audioPath?: string }).audioPath, undefined);
  assert.equal((mealPayload as { note: string }).note, "soup");
});

test("addMeal rejects requests without any supported meal content", async () => {
  const { corePort } = createCorePortSpy();

  await assert.rejects(
    () =>
      addMeal(
        {
        },
        { corePort },
      ),
    /photoPath, audioPath, note, ingredients, or nutrition/,
  );
});

test("importCsvSamples parses rows and emits recordedAt values for core", async () => {
  const filePath = await createTempFile(
    "heart-rate.csv",
    [
      "timestamp,bpm,device,context",
      "2026-03-11T08:00:00Z,72,watch,resting",
      "2026-03-11T08:05:00Z,75,watch,\"post, walk\"",
    ].join("\n"),
    "murph-importers-coverage-",
  );
  const { calls, corePort } = createCorePortSpy();
  const presetRegistry = createSamplePresetRegistry([
    {
      id: "vendor-watch-heart-rate",
      stream: "heart_rate",
      tsColumn: "timestamp",
      valueColumn: "bpm",
      unit: "bpm",
      metadataColumns: ["device", "context"],
      source: "device",
    },
  ]);

  await importCsvSamples(
    {
      filePath,
      presetId: "vendor-watch-heart-rate",
    },
    { corePort, presetRegistry },
  );

  const [samplePayload] = calls.samples;

  assert.ok(samplePayload);
  assert.equal(calls.samples.length, 1);
  assert.equal((samplePayload as { stream: string }).stream, "heart_rate");
});

test("importCsvSamples ignores the removed vault alias and still handles escaped quotes and CRLF rows", async () => {
  const filePath = await createTempFile(
    "sleep.csv",
    [
      "timestamp,bpm,context\r",
      '2026-03-11T08:00:00Z,72,"watch ""alpha"""\r',
      "2026-03-11T08:05:00Z,75,resting\r",
      "",
    ].join("\n"),
    "murph-importers-coverage-",
  );
  const { calls, corePort } = createCorePortSpy();

  await importCsvSamples(
    {
      filePath,
      vault: "fixture-vault",
      stream: "heart_rate",
      tsColumn: "timestamp",
      valueColumn: "bpm",
      unit: "bpm",
      delimiter: ",",
    },
    { corePort },
  );

  const [samplePayload] = calls.samples;
  assert.ok(samplePayload);
  assert.equal((samplePayload as { vaultRoot?: string }).vaultRoot, undefined);

  const escapedRows = parseDelimitedRows(
    'timestamp,bpm,context\r\n2026-03-11T08:00:00Z,72,"watch ""alpha"""',
    ",",
  );
  assert.deepEqual(escapedRows[1], [
    "2026-03-11T08:00:00Z",
    "72",
    'watch "alpha"',
  ]);
});

test("importCsvSamples rejects blank sample rows and unterminated quoted fields", async () => {
  const blankRowsPath = await createTempFile(
    "blank.csv",
    ["timestamp,bpm", "", "   ,   ", ""].join("\n"),
    "murph-importers-coverage-",
  );
  const brokenQuotesPath = await createTempFile(
    "broken.csv",
    ['timestamp,bpm', '"2026-03-11T08:00:00Z,72'].join("\n"),
    "murph-importers-coverage-",
  );
  const { corePort } = createCorePortSpy();

  await assert.rejects(
    () =>
      importCsvSamples(
        {
          filePath: blankRowsPath,
          stream: "heart_rate",
          tsColumn: "timestamp",
          valueColumn: "bpm",
          unit: "bpm",
        },
        { corePort },
      ),
    /did not contain any importable sample rows/,
  );

  await assert.throws(
    () => parseDelimitedRows('timestamp,bpm\n"2026-03-11T08:00:00Z,72', ","),
    /unterminated quoted field/,
  );

  await assert.rejects(
    () =>
      importCsvSamples(
        {
          filePath: brokenQuotesPath,
          stream: "heart_rate",
          tsColumn: "timestamp",
          valueColumn: "bpm",
          unit: "bpm",
        },
        { corePort },
      ),
    /unterminated quoted field/,
  );
});

test("importDocument accepts a narrow core port with only the called export", async () => {
  const filePath = await createTempFile("visit-note.txt", "note", "murph-importers-coverage-");

  const result = await importDocument<string>(
    { filePath },
    {
      corePort: {
        async importDocument(payload: DocumentImportPayload) {
          return payload.title;
        },
      },
    },
  );

  assert.equal(result, "visit-note.txt");
});

test("prepareMealImport requires canonical vaultRoot and omits missing audio", async () => {
  const photoPath = await createTempFile("breakfast.jpg", "image-placeholder", "murph-importers-coverage-");

  const payload = await prepareMealImport({
    photoPath,
    vaultRoot: "/tmp/example-vault",
    note: "  eggs and fruit  ",
  });

  assert.equal(payload.photoPath, photoPath);
  assert.equal(payload.audioPath, undefined);
  assert.equal(payload.vaultRoot, "/tmp/example-vault");
  assert.equal(payload.note, "eggs and fruit");
});

test("prepareMealImport accepts note-only meal input", async () => {
  const payload = await prepareMealImport({
    vaultRoot: "/tmp/example-vault",
    note: "  eggs and fruit  ",
  });

  assert.equal(payload.photoPath, undefined);
  assert.equal(payload.audioPath, undefined);
  assert.equal(payload.vaultRoot, "/tmp/example-vault");
  assert.equal(payload.note, "eggs and fruit");
});

test("prepareMealImport preserves structured-only meal data", async () => {
  const payload = await prepareMealImport({
    vaultRoot: "/tmp/example-vault",
    source: "derived",
    ingredients: [" salmon  ", "rice"],
    nutrition: {
      totals: {
        calories: 690,
      },
      provenance: {
        source: "estimated",
      },
    },
  });

  assert.equal(payload.photoPath, undefined);
  assert.equal(payload.audioPath, undefined);
  assert.equal(payload.vaultRoot, "/tmp/example-vault");
  assert.equal(payload.source, "derived");
  assert.deepEqual(payload.ingredients, ["salmon", "rice"]);
  assert.deepEqual(payload.nutrition, {
    totals: {
      calories: 690,
    },
    provenance: {
      source: "estimated",
    },
  });
});

test("prepareMealImport accepts ingredients-only structured meals", async () => {
  const payload = await prepareMealImport({
    vaultRoot: "/tmp/example-vault",
    ingredients: [" salmon  ", "rice"],
  });

  assert.equal(payload.photoPath, undefined);
  assert.equal(payload.audioPath, undefined);
  assert.equal(payload.note, undefined);
  assert.deepEqual(payload.ingredients, ["salmon", "rice"]);
  assert.equal(payload.nutrition, undefined);
});

test("prepareCsvSampleImport skips blank rows and omits empty metadata columns", async () => {
  const filePath = await createTempFile(
    "glucose.csv",
    [
      "recorded,value",
      "",
      "2026-03-11T08:00:00Z,92",
      "",
      "2026-03-11T09:00:00Z,95",
      "",
    ].join("\n"),
    "murph-importers-coverage-",
  );

  const plan = await prepareCsvSampleImport({
    filePath,
    vaultRoot: "/tmp/canonical-vault",
    vault: "/tmp/example-vault",
    stream: "glucose",
    tsColumn: "recorded",
    valueColumn: "value",
    unit: "mg_dL",
    delimiter: ",",
  });

  const [payload] = plan.imports;

  assert.ok(payload);
  assert.equal(plan.vaultRoot, "/tmp/canonical-vault");
  assert.equal(plan.tsColumn, "recorded");
  assert.equal(payload.payload.importConfig.metadataColumns, undefined);
  assert.equal(payload.importedCount, 2);
  assert.equal(payload.payload.batchProvenance?.sourceFileName, "glucose.csv");
  assert.equal(payload.payload.batchProvenance?.importConfig?.valueColumn, "value");
  assert.equal(payload.payload.batchProvenance?.rowCount, 2);
  assert.equal(payload.payload.batchProvenance?.skippedCount, 0);
  assert.deepEqual(payload.payload.batchProvenance?.skipReasons, []);
  assert.equal(payload.payload.samples[0]?.recordedAt, "2026-03-11T08:00:00.000Z");
  assert.equal(payload.payload.samples[1]?.value, 95);
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

test("prepareCsvSampleImport rejects header-only files", async () => {
  const filePath = await createTempFile(
    "header-only.csv",
    "recorded,value\n",
    "murph-importers-coverage-",
  );

  await assert.rejects(
    () =>
      prepareCsvSampleImport({
        filePath,
        stream: "heart_rate",
        tsColumn: "recorded",
        valueColumn: "value",
        unit: "bpm",
        delimiter: ",",
      }),
    /header row and at least one data row/,
  );
});

test("parseDelimitedRows rejects malformed delimiters and unterminated quoted fields", () => {
  assert.throws(
    () => parseDelimitedRows("a|b\n1|2\n", "||"),
    /single character/,
  );
  assert.throws(
    () => parseDelimitedRows('a,b\n1,"two\n', ","),
    /unterminated quoted field/,
  );
});
