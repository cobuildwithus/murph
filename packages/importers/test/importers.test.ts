import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import * as coreRuntime from "@murphai/core";
import {
  addMeal,
  createSamplePresetRegistry,
  importCsvSamples,
  importDocument,
  parseDelimitedRows,
  prepareCsvSampleImport,
  prepareMealImport,
  profileCsvSampleFile,
  summarizeSampleSeries,
} from "../src/index.ts";
import type { DocumentImportPayload } from "../src/index.ts";
import { createCorePortSpy, createTempFile } from "./test-helpers.ts";

test("importDocument delegates a core-shaped document payload", async () => {
  const filePath = await createTempFile("labs.pdf", "pdf-placeholder");
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
  assert.equal(documentPayload.sourcePath, filePath);
  assert.equal(documentPayload.title, "labs.pdf");
  assert.equal(documentPayload.note, "annual lab packet");
});

test("addMeal validates attachments and maps to addMeal-compatible input", async () => {
  const photoPath = await createTempFile("dinner.jpg", "image-placeholder");
  const audioPath = await createTempFile("dinner-note.m4a", "audio-placeholder");
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
  assert.equal(mealPayload.photoPath, photoPath);
  assert.equal(mealPayload.audioPath, audioPath);
  assert.equal(mealPayload.note, "salmon and rice");
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
  assert.equal(mealPayload.photoPath, undefined);
  assert.equal(mealPayload.audioPath, undefined);
  assert.equal(mealPayload.source, "derived");
  assert.deepEqual(mealPayload.ingredients, ["salmon", "rice"]);
  assert.deepEqual(mealPayload.nutrition, {
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
  assert.equal(mealPayload.photoPath, undefined);
  assert.equal(mealPayload.audioPath, undefined);
  assert.equal(mealPayload.note, "soup");
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
  assert.equal(samplePayload.stream, "heart_rate");
  assert.equal(samplePayload.unit, "bpm");
  assert.equal(samplePayload.source, "device");
  assert.equal(samplePayload.sourcePath, filePath);
  assert.equal(samplePayload.samples.length, 2);
  assert.equal(samplePayload.samples[1]?.recordedAt, "2026-03-11T08:05:00.000Z");
  assert.equal(samplePayload.batchProvenance?.sourceFileName, "heart-rate.csv");
  assert.equal(samplePayload.batchProvenance?.importConfig?.metadataColumns?.length, 2);
  assert.equal(samplePayload.batchProvenance?.rowCount, 2);
  assert.equal(samplePayload.batchProvenance?.skippedCount, 0);
  assert.deepEqual(samplePayload.batchProvenance?.skipReasons, []);
});

test("importCsvSamples auto-imports multiple recognizable sample columns and normalizes suffixed values", async () => {
  const filePath = await createTempFile(
    "o2ring-multi.csv",
    [
      "Time,Oxygen Level,Pulse Rate,Steps",
      '00:55:47 Apr 17 2026,88%,75 bpm,"1,234"',
      '00:55:48 Apr 17 2026,89%,74 bpm,"1,235"',
      "09:16:00 Apr 17 2026,--,--,--",
    ].join("\n"),
  );
  const { calls, corePort } = createCorePortSpy();

  const result = await importCsvSamples(
    {
      filePath,
    },
    { corePort },
  );

  assert.equal(calls.samples.length, 3);
  assert.deepEqual(calls.samples.map((payload) => payload.stream), [
    "spo2",
    "heart_rate",
    "steps",
  ]);
  assert.equal(calls.samples[0]?.samples[0]?.value, 88);
  assert.equal(calls.samples[1]?.samples[0]?.value, 75);
  assert.equal(calls.samples[2]?.samples[0]?.value, 1234);
  assert.equal(result.importedCount, 6);
  assert.equal(result.skippedCount, 3);
  assert.deepEqual(
    result.imports.map((entry) => ({
      stream: entry.stream,
      skippedCount: entry.skippedCount,
      transformId: entry.transformId,
    })),
    [
      { stream: "spo2", skippedCount: 1, transformId: "xfm_spy" },
      { stream: "heart_rate", skippedCount: 1, transformId: "xfm_spy" },
      { stream: "steps", skippedCount: 1, transformId: "xfm_spy" },
    ],
  );
});

test("profileCsvSampleFile exposes a non-mutating CSV plan with source hints and optional summaries", async () => {
  const filePath = await createTempFile(
    "O2Ring-export.csv",
    [
      "Time,Oxygen Level,Pulse Rate,Motion",
      "00:55:47 Apr 17 2026,96%,75 bpm,0",
      "00:55:48 Apr 17 2026,89%,74 bpm,0",
      "00:55:49 Apr 17 2026,97%,73 bpm,0",
      "   ,   ,   ,   ",
    ].join("\n"),
  );
  const { calls } = createCorePortSpy();

  const profile = await profileCsvSampleFile({
    filePath,
    includeSummary: true,
    summaryProfile: "oxygen-night",
  });

  assert.equal(calls.samples.length, 0);
  assert.equal(profile.file.kind, "csv");
  assert.equal(profile.file.fileName, "O2Ring-export.csv");
  assert.equal(profile.file.blankRowCount, 1);
  assert.equal(profile.time.timestampColumn, "Time");
  assert.equal(profile.sourceHints[0]?.id, "wellue-o2ring-csv");
  assert.deepEqual(
    profile.columns
      .filter((column) => column.role === "sample_value")
      .map((column) => [column.name, column.stream]),
    [
      ["Oxygen Level", "spo2"],
      ["Pulse Rate", "heart_rate"],
    ],
  );
  assert.equal(profile.series.find((entry) => entry.stream === "spo2")?.importableCount, 3);
  assert.equal(profile.summaries?.find((entry) => entry.stream === "spo2")?.thresholds[1]?.below, 90);
  assert.equal(profile.summaries?.find((entry) => entry.stream === "spo2")?.screen?.level, "normal_oxygen_trace");
});

test("summarizeSampleSeries computes threshold burden, runs, and gaps", () => {
  const summary = summarizeSampleSeries({
    stream: "spo2",
    unit: "%",
    profile: "oxygen-night",
    samples: [
      { recordedAt: "2026-04-17T00:00:00.000Z", value: 96 },
      { recordedAt: "2026-04-17T00:00:01.000Z", value: 89 },
      { recordedAt: "2026-04-17T00:00:02.000Z", value: 88 },
      { recordedAt: "2026-04-17T00:00:10.000Z", value: 97 },
      { recordedAt: "2026-04-17T00:00:11.000Z", value: 87 },
    ],
  });

  assert.equal(summary.sampleCount, 5);
  assert.equal(summary.sampleIntervalSeconds, 1);
  assert.deepEqual(summary.gaps.map((gap) => gap.durationSeconds), [8]);
  assert.deepEqual(
    summary.thresholds.map((threshold) => ({
      below: threshold.below,
      sampleCount: threshold.sampleCount,
      runCount: threshold.runCount,
      longestRunSeconds: threshold.longestRunSeconds,
    })),
    [
      { below: 92, sampleCount: 3, runCount: 2, longestRunSeconds: 2 },
      { below: 90, sampleCount: 3, runCount: 2, longestRunSeconds: 2 },
      { below: 88, sampleCount: 1, runCount: 1, longestRunSeconds: 1 },
    ],
  );
});

test("createSamplePresetRegistry rejects duplicate preset ids", () => {
  const registry = createSamplePresetRegistry();

  registry.register({
    id: "duplicate",
    stream: "steps",
    tsColumn: "ts",
    valueColumn: "value",
    unit: "count",
  });

  assert.throws(
    () =>
      registry.register({
        id: "duplicate",
        stream: "steps",
        tsColumn: "ts",
        valueColumn: "value",
        unit: "count",
      }),
    /already registered/,
  );
});

test("parseDelimitedRows handles quoted commas", () => {
  const rows = parseDelimitedRows('a,b\n1,"two,three"\n', ",");
  assert.deepEqual(rows, [
    ["a", "b"],
    ["1", "two,three"],
  ]);
});

test("addMeal keeps canonical vaultRoot and ignores the removed vault alias", async () => {
  const photoPath = await createTempFile("breakfast.jpg", "image-placeholder");
  const photoDirectory = await mkdtemp(join(tmpdir(), "murph-importers-photo-"));
  const { calls, corePort } = createCorePortSpy();

  await addMeal(
    {
      photoPath,
      vault: "fixture-vault",
      note: "  oatmeal  ",
    },
    { corePort },
  );

  const [mealPayload] = calls.meals;
  assert.ok(mealPayload);
  assert.equal(mealPayload.vaultRoot, undefined);
  assert.equal(mealPayload.audioPath, undefined);
  assert.equal(mealPayload.note, "oatmeal");

  await assert.rejects(
    () =>
      addMeal(
        {
          photoPath: photoDirectory,
        },
        { corePort },
      ),
    /photoPath must point to a file/,
  );
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
  assert.equal(samplePayload.vaultRoot, undefined);
  assert.equal(samplePayload.samples.length, 2);

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
  );
  const brokenQuotesPath = await createTempFile(
    "broken.csv",
    ['timestamp,bpm', '"2026-03-11T08:00:00Z,72'].join("\n"),
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
  const filePath = await createTempFile("visit-note.txt", "note");

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
  const photoPath = await createTempFile("breakfast.jpg", "image-placeholder");

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

test("prepareMealImport accepts micronutrient-only structured meals", async () => {
  const payload = await prepareMealImport({
    vaultRoot: "/tmp/example-vault",
    nutrition: {
      micros: {
        vitaminB12Mcg: 2.4,
      },
    },
  });

  assert.deepEqual(payload.nutrition, {
    micros: {
      vitaminB12Mcg: 2.4,
    },
  });
});

test("prepareCsvSampleImport skips blank rows and omits empty metadata columns", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-"));
  await coreRuntime.initializeVault({ vaultRoot });
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
  );

  const plan = await prepareCsvSampleImport({
    filePath,
    vaultRoot,
    vault: "/tmp/example-vault",
    stream: "glucose",
    tsColumn: "recorded",
    valueColumn: "value",
    unit: "mg_dL",
    delimiter: ",",
  });

  const [payload] = plan.imports;

  assert.ok(payload);
  assert.equal(plan.vaultRoot, vaultRoot);
  assert.equal(plan.tsColumn, "recorded");
  assert.equal(plan.metadataColumns, undefined);
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

test("prepareCsvSampleImport infers SpO2 imports from O2Ring-style CSV rows and skips placeholder values", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-"));
  await coreRuntime.initializeVault({ vaultRoot });
  await coreRuntime.updateVaultSummary({
    vaultRoot,
    timezone: "Asia/Kuala_Lumpur",
  });

  const filePath = await createTempFile(
    "o2ring.csv",
    [
      "Time,Oxygen Level,Pulse Rate,Motion",
      "00:55:47 Apr 17 2026,88,75,0",
      "00:55:48 Apr 17 2026,89,74,0",
      "09:16:00 Apr 17 2026,--,--,0",
    ].join("\n"),
  );

  const plan = await prepareCsvSampleImport({
    filePath,
    vaultRoot,
    stream: "SpO2",
    metadataColumns: ["Motion"],
  });

  const [payload] = plan.imports;

  assert.ok(payload);
  assert.equal(payload.stream, "spo2");
  assert.equal(payload.unit, "%");
  assert.equal(plan.tsColumn, "Time");
  assert.equal(payload.valueColumn, "Oxygen Level");
  assert.deepEqual(payload.payload.importConfig.metadataColumns, ["Motion"]);
  assert.equal(payload.importedCount, 2);
  assert.equal(payload.payload.samples[0]?.recordedAt, "2026-04-16T16:55:47.000Z");
  assert.equal(payload.payload.samples[0]?.value, 88);
  assert.equal(payload.payload.batchProvenance?.rowCount, 3);
  assert.equal(payload.payload.batchProvenance?.skippedCount, 1);
  assert.deepEqual(payload.payload.batchProvenance?.skipReasons, [
    { reason: "non-numeric value", count: 1 },
  ]);
});

test("prepareCsvSampleImport only treats comma numeric separators as thousands grouping", async () => {
  const filePath = await createTempFile(
    "comma-numbers.csv",
    [
      "timestamp,bpm",
      '2026-03-11T08:00:00Z,"1,234"',
      '2026-03-11T08:05:00Z,"1,23"',
    ].join("\n"),
  );

  const plan = await prepareCsvSampleImport({
    filePath,
    stream: "heart_rate",
    tsColumn: "timestamp",
    valueColumn: "bpm",
    unit: "bpm",
  });
  const [payload] = plan.imports;

  assert.ok(payload);
  assert.equal(payload.importedCount, 1);
  assert.equal(payload.skippedCount, 1);
  assert.equal(payload.payload.samples[0]?.value, 1234);
  assert.deepEqual(payload.payload.batchProvenance?.skipReasons, [
    { reason: "non-numeric value", count: 1 },
  ]);
});

test("prepareCsvSampleImport infers the stream from valueColumn when no stream is provided", async () => {
  const filePath = await createTempFile(
    "pulse-rate.csv",
    [
      "Time,Pulse Rate,Device",
      "00:55:47 Apr 17 2026,75,watch",
      "00:55:48 Apr 17 2026,74,watch",
    ].join("\n"),
  );

  const plan = await prepareCsvSampleImport({
    filePath,
    valueColumn: "Pulse Rate",
    metadataColumns: ["Device"],
  });

  const [payload] = plan.imports;

  assert.ok(payload);
  assert.equal(plan.timeZone, "UTC");
  assert.equal(plan.tsColumn, "Time");
  assert.equal(payload.stream, "heart_rate");
  assert.equal(payload.unit, "bpm");
  assert.equal(payload.valueColumn, "Pulse Rate");
  assert.equal(payload.importedCount, 2);
  assert.equal(payload.payload.importConfig.valueColumn, "Pulse Rate");
  assert.equal(payload.payload.samples[0]?.recordedAt, "2026-04-17T00:55:47.000Z");
  assert.equal(payload.payload.batchProvenance?.rowCount, 2);
  assert.equal(payload.payload.batchProvenance?.skippedCount, 0);
});

test("prepareCsvSampleImport rejects header-only files", async () => {
  const filePath = await createTempFile("header-only.csv", "recorded,value\n");

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

test("importDocument with the real core runtime writes an immutable raw manifest sidecar", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-"));
  const filePath = await createTempFile("labs.pdf", "pdf-placeholder");

  await coreRuntime.initializeVault({ vaultRoot });

  const result = await importDocument<{
    documentId: string;
    raw: {
      relativePath: string;
    };
    manifestPath: string;
  }>(
    {
      filePath,
      vaultRoot,
      note: "baseline import",
    },
    { corePort: coreRuntime },
  );

  assert.match(
    result.manifestPath,
    new RegExp(String.raw`^raw/documents/.+/manifest\.${result.documentId}\.[^/]+\.json$`, "u"),
  );

  const manifest = JSON.parse(
    await readFile(join(vaultRoot, result.manifestPath), "utf8"),
  ) as {
    importKind: string;
    importId: string;
    artifacts: Array<{
      relativePath: string;
      sha256: string;
    }>;
  };

  assert.equal(manifest.importKind, "document");
  assert.equal(manifest.importId, result.documentId);
  assert.equal(manifest.artifacts[0]?.relativePath, result.raw.relativePath);
  assert.match(String(manifest.artifacts[0]?.sha256), /^[a-f0-9]{64}$/u);
});

test("importCsvSamples with the real core runtime writes a batch manifest with row provenance", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-"));
  const filePath = await createTempFile(
    "heart-rate.csv",
    [
      "timestamp,bpm,device,context",
      "2026-03-11T08:00:00Z,72,watch,resting",
      "2026-03-11T08:05:00Z,75,watch,walk",
    ].join("\n"),
  );

  await coreRuntime.initializeVault({ vaultRoot });

  const result = await importCsvSamples(
    {
      filePath,
      vaultRoot,
      stream: "heart_rate",
      tsColumn: "timestamp",
      valueColumn: "bpm",
      unit: "bpm",
      delimiter: ",",
      metadataColumns: ["device", "context"],
    },
    { corePort: coreRuntime },
  );

  assert.equal(result.importedCount, 2);
  assert.equal(result.lookupIds.length, 2);
  assert.equal(result.imports.length, 1);
  assert.match(String(result.imports[0]?.transformId), /^xfm_/u);
  assert.match(
    String(result.imports[0]?.manifestPath),
    new RegExp(
      String.raw`^raw/samples/heart_rate/.+/manifest\.${String(result.imports[0]?.transformId)}\.[^/]+\.json$`,
      "u",
    ),
  );

  const manifest = JSON.parse(
    await readFile(join(vaultRoot, result.imports[0]?.manifestPath ?? ""), "utf8"),
  ) as {
    importKind: string;
    provenance: {
      importedCount: number;
      rowCount: number;
      skippedCount: number;
      skipReasons: Array<{ reason: string; count: number }>;
      importConfig: {
        metadataColumns?: string[];
      };
    };
  };

  assert.equal(manifest.importKind, "sample_batch");
  assert.equal(manifest.provenance.importedCount, 2);
  assert.equal(manifest.provenance.rowCount, 2);
  assert.equal(manifest.provenance.skippedCount, 0);
  assert.deepEqual(manifest.provenance.skipReasons, []);
  assert.deepEqual(manifest.provenance.importConfig.metadataColumns, [
    "device",
    "context",
  ]);
});
